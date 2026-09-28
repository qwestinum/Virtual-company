/**
 * S45 — CLÔTURER UNE CAMPAGNE, AU CLIC (feat/feedback-candidat, lot 4).
 *
 * Trois campagnes JETABLES (jamais une campagne du dev : clôturer est
 * irréversible dans l'écran), deux retenus + un invité chacune :
 *   S45.1 — non conclu : les retenus restent « Retenu », aucun message ;
 *   S45.4 — plusieurs recrutements : deux cases cochées, deux « Recruté ».
 *   S45.2 — conclu sans préciser : idem, `campaign_closed` dit « conclu » ;
 *   S45.3 — conclu avec désignation : le bouton reste désarmé tant que
 *           l'autre retenu n'a pas son message ; puis un « Recruté », un « Non
 *           retenu » (cause), UN message parti ; l'invité classé sans suite.
 *
 * `E2E_FEEDBACK_INBOX` posée : le non-sélectionné a CETTE adresse et son
 * message doit être PARTI (`sent`) — à vérifier à l'œil dans la boîte.
 */
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testCampaignPayload } from '../regression/helpers/api';
import { BASE_URL } from './setup';
import { assertAppIsUp, attendreHydratation, launchBrowser, signIn } from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

const TAG = randomUUID().slice(0, 6);
const INBOX = process.env.E2E_FEEDBACK_INBOX?.trim() || null;
const campaigns: string[] = [];

type Seeded = { campaignId: string; a: string; b: string; open: string };

let browser: Browser;
let page: Page;
let recruiter: TestRecruiter;

async function seedAnalysis(campaignId: string, id: string, name: string, email: string, retenu: boolean) {
  const now = new Date().toISOString();
  const { error } = await db().from('candidate_analyses').insert({
    id,
    uid: `u_${id}`,
    campaign_id: campaignId,
    candidate_name: name,
    candidate_email: email,
    file_name: 'cv.pdf',
    source: 'email',
    received_at: now,
    total_score: 88,
    status: 'accepted',
    criteria_version: 'e2e-s45',
    computed_at: now,
    decision_zone: 'auto_accept',
    decided_by: 'auto',
    application: {
      candidate: { fullName: name, email, phone: null, fileName: 'cv.pdf', source: 'email', receivedAt: now },
      scoringResult: { totalScore: 88, status: 'accepted', decisionZone: 'auto_accept', breakdown: [], criteriaVersion: 'e2e-s45', computedAt: now },
      narration: { summary: 'Dossier de test E2E.', strengths: [], weaknesses: [], justification: 'Test.' },
    },
  });
  if (error) throw new Error(`S45 : dossier non créé — ${error.message}`);
  if (!retenu) return;
  const markers = await db().from('journal').insert([
    { campaign_id: campaignId, actor: 'user', action: 'candidate_interview_marked', payload: { uid: `u_${id}`, candidate: name, status: 'realized' } },
    { campaign_id: campaignId, actor: 'user', action: 'candidate_validation_marked', payload: { uid: `u_${id}`, candidate: name, status: 'validated' } },
  ]);
  if (markers.error) throw new Error(`S45 : marqueurs non posés — ${markers.error.message}`);
}

/** Une campagne active jetable, créée par l'API avec la session du navigateur. */
async function seedCampaign(slug: string): Promise<Seeded> {
  const campaignId = `CAMP-E2E-${slug}-${TAG}`;
  const res = await page.request.put(`${BASE_URL}/api/campaigns`, {
    data: testCampaignPayload({ id: campaignId, status: 'active', name: `[E2E] Clôture ${slug}` }),
  });
  if (!res.ok()) throw new Error(`S45 : campagne non créée — HTTP ${res.status()}`);
  campaigns.push(campaignId);
  const s = { campaignId, a: `can_e2e45_${slug}_a_${TAG}`, b: `can_e2e45_${slug}_b_${TAG}`, open: `can_e2e45_${slug}_o_${TAG}` };
  await seedAnalysis(campaignId, s.a, `Awa ${slug}`, INBOX ?? `s45-a-${TAG}@orqa-e2e.invalid`, true);
  await seedAnalysis(campaignId, s.b, `Jean ${slug}`, `s45-b-${TAG}@orqa-e2e.invalid`, true);
  await seedAnalysis(campaignId, s.open, `Hugo ${slug}`, `s45-o-${TAG}@orqa-e2e.invalid`, false);
  return s;
}

async function ouvrirLaCloture(campaignId: string): Promise<void> {
  await page.goto(`${BASE_URL}/campagnes?campagne=${encodeURIComponent(campaignId)}`, { waitUntil: 'domcontentloaded' });
  const card = `[data-campaign-card="${campaignId}"]`;
  await page.waitForSelector(card, { timeout: 90_000 });
  await attendreHydratation(page, card);
  const entete = page.locator(`${card} [aria-expanded="false"]`).first();
  if (await entete.count()) await entete.click();
  await page.locator(card).getByRole('button', { name: 'Clôturer' }).first().click();
  await page.waitForSelector('[data-role="closure-outcome"]', { timeout: 30_000 });
}

async function confirmerEtAttendre(campaignId: string): Promise<void> {
  const bouton = page.locator('button[data-role="confirm-closure"]');
  await expect.poll(() => bouton.isEnabled(), { timeout: 10_000 }).toBe(true);
  await bouton.click();
  // `campaign_closed` est écrit EN DERNIER par la route (après la désignation,
  // les messages et le classement groupé) : c'est lui qui dit « terminé ».
  // Le statut `closed`, posé plus tôt, ne suffit pas.
  await expect
    .poll(async () => (await journal(campaignId, 'campaign_closed')).length, { timeout: 60_000 })
    .toBe(1);
  await page.waitForSelector('[role="dialog"][aria-label="Clôturer la campagne"]', {
    state: 'detached',
    timeout: 30_000,
  });
  expect((await db().from('campaigns').select('status').eq('id', campaignId).single()).data?.status).toBe(
    'closed',
  );
}

async function journal(campaignId: string, action: string) {
  const { data } = await db().from('journal').select('payload').eq('campaign_id', campaignId).eq('action', action);
  return (data ?? []).map((r) => r.payload as Record<string, unknown>);
}

async function feedbackOf(campaignId: string) {
  const { data } = await db().from('candidate_feedback').select('analysis_id, kind, channel, mail_status').eq('campaign_id', campaignId);
  return (data ?? []) as { analysis_id: string; kind: string; channel: string; mail_status: string | null }[];
}

beforeAll(async () => {
  await assertAppIsUp();
  recruiter = await createTestRecruiter();
  browser = await launchBrowser();
  page = await signIn(browser, recruiter);
  await page.setViewportSize({ width: 1440, height: 2400 });
}, 300_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  if (recruiter) await deleteTestRecruiter(recruiter);
  for (const id of campaigns) {
    const { data } = await db().from('candidate_analyses').select('id').eq('campaign_id', id);
    const ids = (data ?? []).map((r) => r.id as string);
    await db().from('imap_outreach_claims').delete().in('uid', ids);
    await db().from('candidate_analyses').delete().in('id', ids); // messages en cascade
    await db().from('journal').delete().eq('campaign_id', id);
    await db().from('campaigns').delete().eq('id', id);
  }
});

describe('S45 — clôturer au clic', () => {
  it('S45.1 — non conclu : les retenus restent Retenu, aucun message', async () => {
    const s = await seedCampaign('nc');
    await ouvrirLaCloture(s.campaignId);
    await page.click('[data-closure-choice="non_conclu"]');
    expect(await page.locator('[data-closure-choice^="hire-"]').count()).toBe(0);
    await confirmerEtAttendre(s.campaignId);
    expect(await journal(s.campaignId, 'candidate_hired_marked')).toHaveLength(0);
    expect((await feedbackOf(s.campaignId)).filter((f) => f.kind !== 'sans_suite')).toHaveLength(0);
    expect((await journal(s.campaignId, 'campaign_closed'))[0]).toMatchObject({ outcome: 'non_conclu', hiredAnalysisIds: [] });
  }, 300_000);

  it('S45.2 — conclu sans préciser : aucun retenu ne change', async () => {
    const s = await seedCampaign('sp');
    await ouvrirLaCloture(s.campaignId);
    expect(await page.locator('button[data-role="confirm-closure"]').isDisabled(), 'recruté non choisi : bouton armé').toBe(true);
    await page.click('[data-closure-choice="hire-unspecified"]');
    await confirmerEtAttendre(s.campaignId);
    expect(await journal(s.campaignId, 'candidate_hired_marked')).toHaveLength(0);
    expect((await journal(s.campaignId, 'campaign_closed'))[0]).toMatchObject({ outcome: 'conclu', hiredAnalysisIds: [] });
  }, 300_000);

  it('S45.3 — conclu avec désignation : un Recruté, un Non retenu, UN message', async () => {
    const s = await seedCampaign('ds');
    await ouvrirLaCloture(s.campaignId);
    await page.click(`[data-closure-choice="hire-${s.b}"]`);
    await page.waitForSelector('[data-role="closure-not-selected"]');
    const bouton = page.locator('button[data-role="confirm-closure"]');
    expect(await bouton.isDisabled(), 'non-sélectionné sans message : bouton armé').toBe(true);

    const envoyer = page.locator('[data-role="closure-not-selected"] input[data-feedback-mode="send"]').first();
    await expect.poll(() => envoyer.isEnabled(), { timeout: 30_000 }).toBe(true);
    await envoyer.check();
    await confirmerEtAttendre(s.campaignId);

    const hired = await journal(s.campaignId, 'candidate_hired_marked');
    expect(hired).toHaveLength(1);
    expect(hired[0]).toMatchObject({ uid: `u_${s.b}`, status: 'hired' });
    const verdicts = await journal(s.campaignId, 'candidate_validation_marked');
    expect(verdicts.filter((v) => v.cause === 'not_selected_at_closure').map((v) => v.uid)).toEqual([`u_${s.a}`]);

    const feedback = await feedbackOf(s.campaignId);
    const nonRetenu = feedback.filter((f) => f.kind === 'non_retenu');
    expect(nonRetenu).toHaveLength(1);
    expect(nonRetenu[0]).toMatchObject({ analysis_id: s.a, channel: 'mail' });
    expect(nonRetenu[0]!.mail_status).not.toBe('pending');
    if (INBOX) expect(nonRetenu[0]!.mail_status).toBe('sent');
    expect(feedback.some((f) => f.analysis_id === s.b)).toBe(false);
    expect((await journal(s.campaignId, 'campaign_closed'))[0]).toMatchObject({
      outcome: 'conclu',
      hiredAnalysisIds: [s.b],
      notSelectedAnalysisIds: [s.a],
    });
  }, 300_000);

  it('S45.4 — plusieurs recrutements : les DEUX retenus cochés, aucun non-sélectionné, aucun message', async () => {
    const s = await seedCampaign('mx');
    await ouvrirLaCloture(s.campaignId);
    // Des CASES, pas des boutons radio : cocher le second garde le premier.
    await page.click(`[data-closure-choice="hire-${s.a}"]`);
    await page.click(`[data-closure-choice="hire-${s.b}"]`);
    expect(await page.locator(`[data-closure-choice="hire-${s.a}"]`).isChecked()).toBe(true);
    expect(await page.locator(`[data-closure-choice="hire-${s.b}"]`).isChecked()).toBe(true);
    expect(await page.locator('[data-role="closure-not-selected"]').count()).toBe(0);
    await confirmerEtAttendre(s.campaignId);

    const hired = await journal(s.campaignId, 'candidate_hired_marked');
    expect(hired.map((h) => h.uid).sort()).toEqual([`u_${s.a}`, `u_${s.b}`].sort());
    expect((await feedbackOf(s.campaignId)).filter((f) => f.kind === 'non_retenu')).toHaveLength(0);
    expect((await journal(s.campaignId, 'campaign_closed'))[0]).toMatchObject({
      outcome: 'conclu',
      hiredAnalysisIds: [s.a, s.b],
      notSelectedAnalysisIds: [],
    });
  }, 300_000);
});
