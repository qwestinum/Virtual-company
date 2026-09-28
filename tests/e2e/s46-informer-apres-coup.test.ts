/**
 * S46 — INFORMER LE CANDIDAT APRÈS COUP (feat/feedback-candidat, lot 5).
 *
 * Un RETENU posé avant le chantier n'a reçu aucun message. Sa fiche le DIT
 * (« candidat non informé »), et « Informer le candidat » propose le message
 * « Retenu » — type déduit par le serveur, jamais choisi à l'écran. Cliqué :
 * une ligne `candidate_feedback`, la fiche passe à « informé ».
 *
 * `E2E_FEEDBACK_INBOX` posée : le candidat a CETTE adresse et le message doit
 * être PARTI ; sinon, « je préviens moi-même » (aucun envoi).
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
const ID = `can_e2e46_${TAG}`;
const UID = `e2e46_${TAG}`;
const NAME = `Awa Apres${TAG}`;

let browser: Browser;
let page: Page;
let recruiter: TestRecruiter;

beforeAll(async () => {
  await assertAppIsUp();
  const campaignId = (await pickCampaign()).id;
  const now = new Date().toISOString();
  const email = INBOX ?? `s46-${TAG}@orqa-e2e.invalid`;
  const { error } = await db().from('candidate_analyses').insert({
    id: ID,
    uid: UID,
    campaign_id: campaignId,
    candidate_name: NAME,
    candidate_email: email,
    file_name: 'cv.pdf',
    source: 'email',
    received_at: now,
    total_score: 88,
    status: 'accepted',
    criteria_version: 'e2e-s46',
    computed_at: now,
    decision_zone: 'auto_accept',
    decided_by: 'auto',
    application: {
      candidate: { fullName: NAME, email, phone: null, fileName: 'cv.pdf', source: 'email', receivedAt: now },
      scoringResult: { totalScore: 88, status: 'accepted', decisionZone: 'auto_accept', breakdown: [], criteriaVersion: 'e2e-s46', computedAt: now },
      narration: { summary: 'Dossier de test E2E.', strengths: [], weaknesses: [], justification: 'Test.' },
    },
  });
  if (error) throw new Error(`S46 : dossier non créé — ${error.message}`);
  // Un verdict « Retenu » posé À L'ANCIENNE : marqueur seul, aucun message.
  const markers = await db().from('journal').insert([
    { campaign_id: campaignId, actor: 'user', action: 'candidate_interview_marked', payload: { uid: UID, candidate: NAME, status: 'realized' } },
    { campaign_id: campaignId, actor: 'user', action: 'candidate_validation_marked', payload: { uid: UID, candidate: NAME, status: 'validated' } },
  ]);
  if (markers.error) throw new Error(`S46 : marqueurs non posés — ${markers.error.message}`);

  recruiter = await createTestRecruiter();
  browser = await launchBrowser();
  page = await signIn(browser, recruiter);
  await page.setViewportSize({ width: 1440, height: 1400 });
}, 300_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  if (recruiter) await deleteTestRecruiter(recruiter);
  await db().from('imap_outreach_claims').delete().eq('uid', ID);
  await db().from('journal').delete().eq('payload->>uid', UID);
  await db().from('candidate_analyses').delete().eq('id', ID); // messages en cascade
});

describe('S46 — informer le candidat depuis sa fiche', () => {
  it('« non informé » est dit ; « Informer le candidat » pose le message « Retenu »', async () => {
    await page.goto(`${BASE_URL}/candidatures`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-dot-tab="retenu"]', { timeout: 90_000 });
    await attendreHydratation(page, '[data-dot-tab="retenu"]');
    await page.click('[data-dot-tab="retenu"]');
    await page.fill('input[placeholder="Rechercher un candidat…"]', NAME);
    const ligne = page.locator('[data-candidature-row]', { hasText: NAME });
    await ligne.first().waitFor({ timeout: 30_000 });
    await ligne.first().click();

    const bloc = page.locator('[data-candidature-panel] [data-role="inform-candidate"]');
    await bloc.waitFor({ timeout: 30_000 });
    await expect.poll(() => bloc.locator('[data-informed="false"]').count(), { timeout: 10_000 }).toBe(1);
    expect(await bloc.textContent()).toContain('« Retenu »');

    await bloc.locator('button[data-role="open-inform"]').click();
    const confirmer = bloc.locator('button[data-role="confirm-inform"]');
    expect(await confirmer.isDisabled(), 'aucun choix : bouton armé').toBe(true);

    if (INBOX) {
      const envoyer = bloc.locator('input[data-feedback-mode="send"]');
      await expect.poll(() => envoyer.isEnabled(), { timeout: 30_000 }).toBe(true);
      await envoyer.check();
    } else {
      await bloc.locator('input[data-feedback-mode="self"]').check();
      await bloc.locator('input[data-feedback-channel="telephone"]').check();
    }
    await confirmer.click();
    await expect.poll(() => bloc.locator('[data-informed="true"]').count(), { timeout: 30_000 }).toBe(1);

    const { data } = await db().from('candidate_feedback').select('kind, channel, mail_status').eq('analysis_id', ID);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ kind: 'retenu' });
    if (INBOX) expect(data![0]).toMatchObject({ channel: 'mail', mail_status: 'sent' });
    else expect(data![0]).toMatchObject({ channel: 'telephone', mail_status: null });
  }, 300_000);
});
