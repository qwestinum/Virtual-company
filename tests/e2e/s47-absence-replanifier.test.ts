/**
 * S47 — ABSENCE → REPROPOSER UN CRÉNEAU, AU CLIC (fix/vivier-replanif-filtres, point 2).
 *
 * Un rendez-vous PASSÉ non pointé (Entretiens → Programmés → « à pointer ») :
 * « Candidat absent » → « Re-proposer un créneau » → Confirmer. Attendu :
 *   - le briefing redevient « en attente de réservation » TOUT DE SUITE — la
 *     ligne quitte « Programmés » pour « En attente de réservation » ;
 *   - le dossier est compté « Invité », plus « RDV pris » ;
 *   - un nouveau lien est émis, la cause `no_show_rescheduled` est au journal.
 *
 * Campagne NATIVE du dev (référent avec disponibilités) : le dossier de test y
 * est créé puis effacé. Captures avant/après : `docs/ux/captures/replanif-absence/`.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient } from '@supabase/supabase-js';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import { assertAppIsUp, attendreHydratation, launchBrowser, signIn } from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

const db = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

const TAG = randomUUID().slice(0, 6);
const INBOX = process.env.E2E_FEEDBACK_INBOX?.trim() || null;
const ID = `can_e2e47_${TAG}`;
const UID = `e2e47_${TAG}`;
const NAME = `Absent Test${TAG}`;
const CAPTURES = resolve(process.cwd(), 'docs/ux/captures/replanif-absence');

let browser: Browser;
let page: Page;
let recruiter: TestRecruiter;
let campaignId = '';
let briefId = '';

beforeAll(async () => {
  await assertAppIsUp();
  const { data: natives } = await db()
    .from('campaigns')
    .select('id')
    .eq('status', 'active')
    .eq('scheduling_native', true)
    .limit(1);
  campaignId = natives?.[0]?.id as string;
  if (!campaignId) throw new Error('S47 : aucune campagne active en réservation native sur le dev.');

  const now = new Date();
  const email = INBOX ?? `s47-${TAG}@orqa-e2e.invalid`;
  const { error } = await db().from('candidate_analyses').insert({
    id: ID,
    uid: UID,
    campaign_id: campaignId,
    candidate_name: NAME,
    candidate_email: email,
    file_name: 'cv.pdf',
    source: 'email',
    received_at: now.toISOString(),
    total_score: 88,
    status: 'accepted',
    criteria_version: 'e2e-s47',
    computed_at: now.toISOString(),
    decision_zone: 'auto_accept',
    decided_by: 'auto',
    application: {
      candidate: { fullName: NAME, email, phone: null, fileName: 'cv.pdf', source: 'email', receivedAt: now.toISOString() },
      scoringResult: { totalScore: 88, status: 'accepted', decisionZone: 'auto_accept', breakdown: [], criteriaVersion: 'e2e-s47', computedAt: now.toISOString() },
      narration: { summary: 'Dossier de test E2E.', strengths: [], weaknesses: [], justification: 'Test.' },
    },
  });
  if (error) throw new Error(`S47 : dossier non créé — ${error.message}`);
  // Un rendez-vous d'HIER, jamais pointé.
  const start = new Date(now.getTime() - 26 * 3_600_000);
  const brief = await db()
    .from('interview_briefs')
    .insert({
      campaign_id: campaignId,
      candidate_email: email,
      candidate_name: NAME,
      status: 'scheduled',
      questions: [],
      candidate_snapshot: { fullName: NAME, email },
      uid: UID,
      booking_uid: `e2e47-booking-${TAG}`,
      interview_start_at: start.toISOString(),
      interview_end_at: new Date(start.getTime() + 30 * 60_000).toISOString(),
      booked_at: start.toISOString(),
    })
    .select('id')
    .single();
  if (brief.error) throw new Error(`S47 : briefing non créé — ${brief.error.message}`);
  briefId = brief.data.id as string;

  recruiter = await createTestRecruiter();
  browser = await launchBrowser();
  page = await signIn(browser, recruiter);
  await page.setViewportSize({ width: 1440, height: 1000 });
  mkdirSync(CAPTURES, { recursive: true });
}, 300_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  if (recruiter) await deleteTestRecruiter(recruiter);
  await db().from('sched_booking_links').delete().like('idempotency_key', `${ID}%`);
  await db().from('interview_briefs').delete().eq('uid', UID);
  await db().from('journal').delete().eq('payload->>uid', UID);
  await db().from('candidate_analyses').delete().eq('id', ID);
});

async function stageCounts(): Promise<{ invite: number; rdv_pris: number }> {
  const res = await page.request.get(`${BASE_URL}/api/candidatures/counters?campaignId=${campaignId}`);
  const json = (await res.json()) as { counts: { invite: number; rdv_pris: number } };
  return json.counts;
}

describe('S47 — un absent à qui l’on repropose un créneau redevient « Invité »', () => {
  it('Candidat absent → Re-proposer un créneau : la ligne passe en attente de réservation', async () => {
    const avant = await stageCounts();

    await page.goto(`${BASE_URL}/entretiens?campagne=${encodeURIComponent(campaignId)}&section=a_pointer`, {
      waitUntil: 'domcontentloaded',
    });
    const ligne = page.locator(`[data-list-row="${briefId}"]`);
    await ligne.waitFor({ timeout: 90_000 });
    await attendreHydratation(page, `[data-list-row="${briefId}"]`);
    await ligne.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${CAPTURES}/1-avant-programmes.png` });

    await page.locator('li', { has: ligne }).getByRole('button', { name: 'Candidat absent' }).click();
    const dialog = page.locator('[role="dialog"][aria-label="Suite à donner à l’absence"]');
    await dialog.waitFor();
    await dialog.getByText('Re-proposer un créneau').click();
    await dialog.locator('button[data-role="confirm-no-show"]').click();
    await dialog.waitFor({ state: 'detached', timeout: 60_000 });

    // Le briefing est de nouveau EN ATTENTE, sans attendre le rail.
    const { data: brief } = await db().from('interview_briefs').select('status').eq('id', briefId).single();
    expect(brief?.status).toBe('awaiting_booking');

    // « RDV pris » −1, « Invité » +1 : l'étape est dérivée du briefing.
    const apres = await stageCounts();
    expect(apres.rdv_pris).toBe(avant.rdv_pris - 1);
    expect(apres.invite).toBe(avant.invite + 1);

    // Un nouveau lien actif, et la cause au journal.
    const { data: links } = await db()
      .from('sched_booking_links')
      .select('status')
      .like('idempotency_key', `${ID}%`);
    expect((links ?? []).some((l) => l.status === 'active')).toBe(true);
    const { data: journal } = await db()
      .from('journal')
      .select('payload')
      .eq('action', 'interview_link_reissued')
      .eq('payload->>uid', UID);
    expect(journal?.[0]?.payload).toMatchObject({ kind: 'no_show', cause: 'no_show_rescheduled' });

    // La ligne a quitté « Programmés » pour « En attente de réservation ».
    await page.click('[data-dot-tab="awaiting"]');
    await page.locator(`[data-list-row="${briefId}"]`).waitFor({ timeout: 30_000 });
    await page.locator(`[data-list-row="${briefId}"]`).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${CAPTURES}/2-apres-en-attente.png` });
  }, 300_000);
});
