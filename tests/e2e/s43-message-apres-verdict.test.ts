/**
 * S43 — MESSAGE AU CANDIDAT APRÈS LE VERDICT (feat/feedback-candidat, lot 2).
 *
 * Le recruteur pose un verdict sur un dossier « Entretien fait » et choisit
 * comment le candidat est informé — c'est cliqué, pas lu dans une chaîne :
 *   1. choisir un verdict NE suffit PAS : le bouton d'enregistrement reste
 *      désarmé tant que le choix de message n'est pas fait ;
 *   2. « Envoyer ce message » : le texte proposé est pré-rempli (prénom, pas
 *      de variable résiduelle), il part, UNE ligne `candidate_feedback`
 *      `channel=mail` est écrite, statut final posé (jamais `pending`) ;
 *   3. « Je préviens moi-même » : AUCUN envoi (aucun verrou d'envoi posé),
 *      une ligne avec le seul canal, sans corps.
 *
 * Deux dossiers de TEST sont créés sur une campagne active puis effacés.
 * Verdict « Ne pas retenir » dans les deux cas : « Retenir » ouvre le flux
 * « poste pourvu » sur la campagne, sans rapport avec ce qu'on teste ici.
 *
 * La boîte de test : `E2E_FEEDBACK_INBOX` (sous-adresse d'une boîte que vous
 * lisez). Posée, le message doit être PARTI (`sent`) et se vérifie à l'œil
 * dans la boîte ; absente, l'adresse est en `.invalid` et on n'exige que
 * « statut final posé » — le chemin d'envoi est prouvé par les tests unitaires.
 */
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import { assertAppIsUp, attendreHydratation, launchBrowser, signIn } from './helpers/browser';
import { pickCampaign } from './helpers/campaign';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

const TAG = randomUUID().slice(0, 6);
const INBOX = process.env.E2E_FEEDBACK_INBOX?.trim() || null;
type Dossier = { id: string; uid: string; name: string; email: string };
const ENVOI: Dossier = {
  id: `can_e2e_fb_send_${TAG}`,
  uid: `e2e_fb_send_${TAG}`,
  name: `Awa Envoi${TAG}`,
  email: INBOX ?? `fb-send-${TAG}@orqa-e2e.invalid`,
};
const PREVIENT: Dossier = {
  id: `can_e2e_fb_self_${TAG}`,
  uid: `e2e_fb_self_${TAG}`,
  name: `Jean Previent${TAG}`,
  email: `fb-self-${TAG}@orqa-e2e.invalid`,
};

async function seed(d: Dossier, campaignId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db().from('candidate_analyses').insert({
    id: d.id,
    uid: d.uid,
    campaign_id: campaignId,
    candidate_name: d.name,
    candidate_email: d.email,
    file_name: 'cv.pdf',
    source: 'email',
    received_at: now,
    total_score: 88,
    status: 'accepted',
    criteria_version: 'e2e-s43',
    computed_at: now,
    decision_zone: 'auto_accept',
    decided_by: 'auto',
    application: {
      candidate: { fullName: d.name, email: d.email, phone: null, fileName: 'cv.pdf', source: 'email', receivedAt: now },
      scoringResult: { totalScore: 88, status: 'accepted', decisionZone: 'auto_accept', breakdown: [], criteriaVersion: 'e2e-s43', computedAt: now },
      narration: { summary: 'Dossier de test E2E.', strengths: [], weaknesses: [], justification: 'Test.' },
    },
  });
  if (error) throw new Error(`S43 : dossier de test non créé — ${error.message}`);
  const marker = await db().from('journal').insert({
    campaign_id: campaignId,
    actor: 'user',
    action: 'candidate_interview_marked',
    payload: { uid: d.uid, candidate: d.name, status: 'realized' },
  });
  if (marker.error) throw new Error(`S43 : marqueur d'entretien non posé — ${marker.error.message}`);
}

async function feedbackRows(analysisId: string) {
  const { data } = await db().from('candidate_feedback').select('*').eq('analysis_id', analysisId);
  return (data ?? []) as { channel: string; mail_status: string | null; body: string | null; id: string }[];
}

async function waitForSettledRow(analysisId: string) {
  for (let i = 0; i < 60; i++) {
    const rows = await feedbackRows(analysisId);
    if (rows.length > 0 && rows[0]!.mail_status !== 'pending') return rows;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return feedbackRows(analysisId);
}

let browser: Browser;
let page: Page;
let recruiter: TestRecruiter;

beforeAll(async () => {
  await assertAppIsUp();
  const campaign = await pickCampaign();
  await seed(ENVOI, campaign.id);
  await seed(PREVIENT, campaign.id);
  recruiter = await createTestRecruiter();
  browser = await launchBrowser();
  page = await signIn(browser, recruiter);
  await page.setViewportSize({ width: 1440, height: 900 });
}, 300_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  if (recruiter) await deleteTestRecruiter(recruiter);
  const ids = [ENVOI.id, PREVIENT.id];
  const uids = [ENVOI.uid, PREVIENT.uid];
  await db().from('imap_outreach_claims').delete().in('uid', ids);
  await db().from('journal').delete().in('payload->>uid', uids);
  await db().from('candidate_analyses').delete().in('id', ids); // feedback en cascade
});

async function ouvrirLeDossier(d: Dossier): Promise<void> {
  await page.goto(`${BASE_URL}/candidatures`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-dot-tab="entretien_fait"]', { timeout: 90_000 });
  await attendreHydratation(page, '[data-dot-tab="entretien_fait"]');
  await page.click('[data-dot-tab="entretien_fait"]');
  await page.fill('input[placeholder="Rechercher un candidat…"]', d.name);
  const ligne = page.locator('[data-candidature-row]', { hasText: d.name });
  await ligne.first().waitFor({ timeout: 30_000 });
  await ligne.first().click();
  await page.waitForSelector('[data-candidature-panel] button[data-verdict="rejected"]', { timeout: 30_000 });
}

describe('S43 — informer le candidat au moment du verdict', () => {
  it('S43.1 — un verdict seul n’arme pas l’enregistrement ; « Envoyer » fait partir UN message', async () => {
    await ouvrirLeDossier(ENVOI);
    const panel = page.locator('[data-candidature-panel]');
    await panel.locator('button[data-verdict="rejected"]').click();

    const confirmer = panel.locator('button[data-role="confirm-verdict"]');
    await confirmer.waitFor({ timeout: 10_000 });
    expect(await confirmer.isDisabled(), 'verdict sans message : bouton armé').toBe(true);

    const envoyer = panel.locator('input[data-feedback-mode="send"]');
    await expect.poll(() => envoyer.isEnabled(), { timeout: 30_000 }).toBe(true);
    await envoyer.check();
    const corps = await panel.locator('textarea[data-role="feedback-body"]').inputValue();
    expect(corps).toContain('Bonjour Awa,');
    expect(corps).not.toMatch(/\[[^\]]+\]/);
    expect(await confirmer.isDisabled()).toBe(false);

    await confirmer.click();
    const rows = await waitForSettledRow(ENVOI.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.channel).toBe('mail');
    expect(rows[0]!.mail_status).not.toBe('pending');
    if (INBOX) expect(rows[0]!.mail_status).toBe('sent');
    expect(rows[0]!.body).toContain('Bonjour Awa,');
  }, 300_000);

  it('S43.2 — « Je préviens moi-même » : aucun envoi, le canal seul est noté', async () => {
    await ouvrirLeDossier(PREVIENT);
    const panel = page.locator('[data-candidature-panel]');
    await panel.locator('button[data-verdict="rejected"]').click();
    await panel.locator('input[data-feedback-mode="self"]').check();

    const confirmer = panel.locator('button[data-role="confirm-verdict"]');
    expect(await confirmer.isDisabled(), 'canal non choisi : bouton armé').toBe(true);
    await panel.locator('input[data-feedback-channel="telephone"]').check();
    expect(await confirmer.isDisabled()).toBe(false);

    await confirmer.click();
    const rows = await waitForSettledRow(PREVIENT.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'telephone', mail_status: null, body: null });

    const { data: claims } = await db().from('imap_outreach_claims').select('uid').eq('uid', PREVIENT.id);
    expect(claims ?? [], 'un verrou d’envoi a été posé : un mail est parti').toHaveLength(0);
  }, 300_000);
});
