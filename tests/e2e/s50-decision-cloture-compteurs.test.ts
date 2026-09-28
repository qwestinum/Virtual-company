/**
 * S50 — DÉCISION, CLÔTURE ET COMPTEURS DE LA CAMPAGNE, AU CLIC
 * (rapport de bugs du 28/09/2026, campagne 221).
 *
 * Une campagne de test, deux candidats invités dont l'entretien est passé
 * depuis deux jours, jamais pointé :
 *   S50.1 — la carte les réclame : « 2 entretiens passés sans confirmation » ;
 *   S50.2 — (bug 4) « Entretien réalisé » puis verdict « Retenir » sur l'un :
 *           la carte n'en réclame plus qu'un ; (bug 1) AUCUN dialogue « Poste
 *           pourvu » ne s'ouvre après le verdict ;
 *   S50.3 — (bug 2) le second retenu aussi, clôture en désignant l'un d'eux :
 *           la carte compte l'entonnoir — Retenu 2, Recruté 1 — et le taux de
 *           conversion ; plus rien n'est réclamé.
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
const CAMP = `CAMP-E2E-s50-${TAG}`;
const A = { id: `can_e2e50_a_${TAG}`, uid: `u_e2e50_a_${TAG}`, name: `Awa Suivi${TAG}` };
const B = { id: `can_e2e50_b_${TAG}`, uid: `u_e2e50_b_${TAG}`, name: `Jean Suivi${TAG}` };
const CARD = `[data-campaign-card="${CAMP}"]`;

let browser: Browser;
let page: Page;
let recruiter: TestRecruiter;

async function seed(d: typeof A): Promise<void> {
  const now = new Date();
  const email = `${d.uid}@orqa-e2e.invalid`;
  const { error } = await db().from('candidate_analyses').insert({
    id: d.id,
    uid: d.uid,
    campaign_id: CAMP,
    candidate_name: d.name,
    candidate_email: email,
    file_name: 'cv.pdf',
    source: 'email',
    received_at: now.toISOString(),
    total_score: 88,
    status: 'accepted',
    criteria_version: 'e2e-s50',
    computed_at: now.toISOString(),
    decision_zone: 'auto_accept',
    decided_by: 'auto',
    application: {
      candidate: { fullName: d.name, email, phone: null, fileName: 'cv.pdf', source: 'email', receivedAt: now.toISOString() },
      scoringResult: { totalScore: 88, status: 'accepted', decisionZone: 'auto_accept', breakdown: [], criteriaVersion: 'e2e-s50', computedAt: now.toISOString() },
      narration: { summary: 'Dossier de test E2E.', strengths: [], weaknesses: [], justification: 'Test.' },
    },
  });
  if (error) throw new Error(`S50 : dossier non créé — ${error.message}`);
  // Un rendez-vous d'AVANT-HIER, jamais pointé.
  const start = new Date(now.getTime() - 50 * 3_600_000);
  const brief = await db().from('interview_briefs').insert({
    campaign_id: CAMP,
    candidate_email: email,
    candidate_name: d.name,
    status: 'scheduled',
    questions: [],
    candidate_snapshot: { fullName: d.name, email },
    uid: d.uid,
    booking_uid: `e2e50-${d.uid}`,
    interview_start_at: start.toISOString(),
    interview_end_at: new Date(start.getTime() + 30 * 60_000).toISOString(),
    booked_at: start.toISOString(),
  });
  if (brief.error) throw new Error(`S50 : briefing non créé — ${brief.error.message}`);
}

async function ouvrirLaCarte(): Promise<void> {
  await page.goto(`${BASE_URL}/campagnes?campagne=${encodeURIComponent(CAMP)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(CARD, { timeout: 90_000 });
  await attendreHydratation(page, CARD);
  const entete = page.locator(`${CARD} [aria-expanded="false"]`).first();
  if (await entete.count()) await entete.click();
  await page.waitForSelector(`${CARD} [data-role="campaign-card-counters"] a`, { timeout: 30_000 });
}

async function tuile(label: string): Promise<number> {
  const liens = page.locator(`${CARD} [data-role="campaign-card-counters"] a`);
  for (let i = 0; i < (await liens.count()); i++) {
    const texte = ((await liens.nth(i).textContent()) ?? '').replace(/\s+/g, ' ').trim();
    if (texte.replace(/^[^A-Za-zÀ-ÿ]*\d+\s*/, '').trim() === label) return Number(texte.match(/\d+/)?.[0]);
  }
  throw new Error(`tuile « ${label} » absente`);
}

/** Pointe l'entretien puis retient, par la fiche — comme le recruteur. */
async function realiseEtRetient(d: typeof A): Promise<void> {
  await page.goto(`${BASE_URL}/candidatures?campagne=${encodeURIComponent(CAMP)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[placeholder="Rechercher un candidat…"]', { timeout: 90_000 });
  await attendreHydratation(page, 'input[placeholder="Rechercher un candidat…"]');
  await page.fill('input[placeholder="Rechercher un candidat…"]', d.name);
  const ligne = page.locator('[data-candidature-row]', { hasText: d.name }).first();
  await ligne.waitFor({ timeout: 30_000 });
  await ligne.click();
  const panel = page.locator('[data-candidature-panel]');
  await panel.getByRole('button', { name: 'Entretien réalisé' }).click();
  await panel.locator('button[data-verdict="validated"]').waitFor({ timeout: 30_000 });
  await panel.locator('button[data-verdict="validated"]').click();
  await panel.locator('input[data-feedback-mode="self"]').check();
  await panel.locator('input[data-feedback-channel="telephone"]').check();
  await panel.locator('button[data-role="confirm-verdict"]').click();
  await expect
    .poll(async () => {
      const { data } = await db()
        .from('journal')
        .select('id')
        .eq('campaign_id', CAMP)
        .eq('action', 'candidate_validation_marked')
        .eq('payload->>uid', d.uid);
      return (data ?? []).length;
    }, { timeout: 30_000 })
    .toBe(1);
}

beforeAll(async () => {
  await assertAppIsUp();
  recruiter = await createTestRecruiter();
  browser = await launchBrowser();
  page = await signIn(browser, recruiter);
  await page.setViewportSize({ width: 1440, height: 2400 });
  const res = await page.request.put(`${BASE_URL}/api/campaigns`, {
    data: testCampaignPayload({ id: CAMP, status: 'active', name: `[E2E] Suivi ${TAG}` }),
  });
  if (!res.ok()) throw new Error(`S50 : campagne non créée — HTTP ${res.status()}`);
  await seed(A);
  await seed(B);
}, 300_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  if (recruiter) await deleteTestRecruiter(recruiter);
  await db().from('imap_outreach_claims').delete().in('uid', [A.id, B.id]);
  await db().from('interview_briefs').delete().eq('campaign_id', CAMP);
  await db().from('candidate_analyses').delete().in('id', [A.id, B.id]);
  await db().from('journal').delete().eq('campaign_id', CAMP);
  await db().from('campaigns').delete().eq('id', CAMP);
});

describe('S50 — une décision se propage à la campagne', () => {
  it('S50.1 — deux entretiens passés, jamais pointés : la carte les réclame', async () => {
    await ouvrirLaCarte();
    await expect
      .poll(() => page.locator(CARD).textContent(), { timeout: 30_000 })
      .toContain('2 entretiens passés sans confirmation');
  }, 300_000);

  it('S50.2 — pointé et retenu : plus réclamé, et AUCUN dialogue « Poste pourvu »', async () => {
    await realiseEtRetient(A);
    // Le dialogue s'ouvrait juste après le verdict : on lui laisse le temps.
    await page.waitForTimeout(2_000);
    expect(await page.getByText('Poste pourvu — candidatures restantes').count()).toBe(0);

    await ouvrirLaCarte();
    await expect
      .poll(() => page.locator(CARD).textContent(), { timeout: 30_000 })
      .toContain('1 entretien passé sans confirmation');
  }, 300_000);

  it('S50.3 — clôture, un recruté parmi deux retenus : Retenu 2, Recruté 1, conversion 50 %', async () => {
    await realiseEtRetient(B);
    await ouvrirLaCarte();
    expect(await page.locator(CARD).textContent()).not.toContain('sans confirmation');
    await expect.poll(() => tuile('Retenu'), { timeout: 30_000 }).toBe(2);

    await page.locator(CARD).getByRole('button', { name: 'Clôturer' }).first().click();
    await page.waitForSelector('[data-role="closure-outcome"]', { timeout: 30_000 });
    await page.click(`[data-closure-choice="hire-${A.id}"]`);
    const envoyer = page.locator('[data-role="closure-not-selected"] input[data-feedback-mode="self"]').first();
    await envoyer.check();
    await page.locator('[data-role="closure-not-selected"] input[data-feedback-channel="telephone"]').first().check();
    await page.locator('button[data-role="confirm-closure"]').click();
    await expect
      .poll(async () => {
        const { data } = await db().from('journal').select('id').eq('campaign_id', CAMP).eq('action', 'campaign_closed');
        return (data ?? []).length;
      }, { timeout: 60_000 })
      .toBe(1);

    // Clôturée : la carte ne s'affiche que sous « Toutes » ou « Clôturées ».
    await page.goto(`${BASE_URL}/campagnes?campagne=${encodeURIComponent(CAMP)}`, { waitUntil: 'domcontentloaded' });
    await ouvrirLaCarte();
    await page.screenshot({ path: '/tmp/claude-1000/-home-belfaqir-Virtual-company/1d7b3bf9-a637-4493-9a0f-eaf8b7724a58/scratchpad/s50-apres-cloture.png', fullPage: false });
    await expect.poll(() => tuile('Reçues'), { timeout: 30_000 }).toBe(2);
    expect(await tuile('Entretien fait')).toBe(2);
    expect(await tuile('Retenu')).toBe(2);
    expect(await tuile('Recruté')).toBe(1);
    expect(await page.textContent(`${CARD} [data-role="campaign-conversion"]`)).toContain('50 %');
  }, 300_000);
});
