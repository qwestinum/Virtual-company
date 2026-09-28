/**
 * S49 — VIVIER DANS LA CAMPAGNE : VOIR LE CV, INVITER, AU CLIC
 * (fix/vivier-replanif-filtres, point 1).
 *
 * Campagnes → « Chercher dans le vivier » : la recherche PAR MOT-CLÉ rend un
 * profil, et ses résultats portent les gestes sur place (retour du donneur
 * d'ordre, 28/09 : chercher, retenir, fermer, rouvrir n'avait pas de sens).
 * « CV » ouvre l'aperçu en panneau latéral ; « Inviter » y crée la candidature
 * et envoie l'invitation. Attendu :
 *   - l'aperçu montre le CV (texte d'un fichier non PDF) et la présélection ;
 *   - après « Inviter », l'écran DIT que l'invitation est partie ;
 *   - en base : une candidature d'origine vivier, décidée par l'humain, en
 *     zone acceptée, un briefing en attente de réservation, AUCUNE fiche de
 *     validation.
 *
 * ⚠️ Une vraie analyse tourne (le serveur de dev appelle le modèle) sur le
 * texte du CV de test. Le mail part à `E2E_FEEDBACK_INBOX` (sous-adresse)
 * quand elle est posée, sinon à une adresse `.invalid`.
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
const NAME = `Vivier Test${TAG}`;
/** Second profil, trouvé par le même mot-clé : celui qu'on ÉCARTE. */
const NAME2 = `Vivier Ecarte${TAG}`;
const CAPTURES = resolve(process.cwd(), 'docs/ux/captures/vivier-inviter');
const KEYWORD = `orqa${TAG}`;
const CV_TEXT = `${NAME}\n${KEYWORD}\nBusiness Analyst — 8 ans d'expérience en AMOA bancaire.\nRecueil du besoin, rédaction de spécifications, recette, pilotage de lots.\nOutils : JIRA, Confluence, SQL.`;

function emailFor(): string {
  if (!INBOX) return `s49-${TAG}@orqa-e2e.invalid`;
  const [local, domain] = INBOX.split('@');
  return `${local}${local!.includes('+') ? '-' : '+'}viv${TAG}@${domain}`;
}

let browser: Browser;
let page: Page;
let recruiter: TestRecruiter;
let campaignId = '';
let vivierId = '';
let vivierId2 = '';
let restoreSources: string[] | null = null;
const analysisId = () => `can_viv_${campaignId}_${vivierId}`;

beforeAll(async () => {
  await assertAppIsUp();
  const { data: natives } = await db()
    .from('campaigns')
    .select('id, sources, scoring_sheet')
    .eq('status', 'active')
    .eq('scheduling_native', true);
  const usable = (natives ?? []).filter((c) => (c.scoring_sheet as { isValidated?: boolean } | null)?.isValidated);
  const chosen = usable.find((c) => (c.sources as string[]).includes('vivier')) ?? usable[0];
  if (!chosen) throw new Error('S49 : aucune campagne active, native et à grille validée sur le dev.');
  campaignId = chosen.id as string;
  if (!(chosen.sources as string[]).includes('vivier')) {
    // Le vivier doit être une source de la campagne pour que l'écran l'ouvre ;
    // remis à l'identique en fin de test.
    restoreSources = chosen.sources as string[];
    await db().from('campaigns').update({ sources: [...restoreSources, 'vivier'] }).eq('id', campaignId);
  }

  const cand = await db()
    .from('vivier_candidates')
    .insert({
      email: emailFor(),
      nom: NAME,
      cv_file_name: `cv-${TAG}.txt`,
      cv_text: CV_TEXT,
      source: 'manual_upload',
      indexing_status: 'indexed',
    })
    .select('id')
    .single();
  if (cand.error) throw new Error(`S49 : profil vivier non créé — ${cand.error.message}`);
  vivierId = cand.data.id as string;
  const cand2 = await db()
    .from('vivier_candidates')
    .insert({
      email: `s49b-${TAG}@orqa-e2e.invalid`,
      nom: NAME2,
      cv_file_name: `cv2-${TAG}.txt`,
      cv_text: `${NAME2}\n${KEYWORD}\nContrôleur de gestion, 5 ans.`,
      source: 'manual_upload',
      indexing_status: 'indexed',
    })
    .select('id')
    .single();
  if (cand2.error) throw new Error(`S49 : second profil non créé — ${cand2.error.message}`);
  vivierId2 = cand2.data.id as string;

  recruiter = await createTestRecruiter();
  browser = await launchBrowser();
  page = await signIn(browser, recruiter);
  await page.setViewportSize({ width: 1440, height: 1000 });
  mkdirSync(CAPTURES, { recursive: true });
}, 300_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  if (recruiter) await deleteTestRecruiter(recruiter);
  if (vivierId && campaignId) {
    const id = analysisId();
    await db().from('sched_booking_links').delete().like('idempotency_key', `${id}%`);
    await db().from('interview_briefs').delete().eq('uid', id);
    await db().from('journal').delete().eq('payload->>uid', id);
    await db().from('imap_outreach_claims').delete().eq('uid', id);
    await db().from('artifacts_meta').delete().like('id', `art_viv_cv_${campaignId}_${vivierId}`);
    await db().from('candidate_analyses').delete().eq('id', id);
    await db().from('vivier_candidates').delete().eq('id', vivierId);
  }
  if (vivierId2) {
    await db().from('journal').delete().eq('campaign_id', campaignId).eq('action', 'vivier_contact_rejected').contains('payload', { candidateIds: [vivierId2] });
    await db().from('vivier_candidates').delete().eq('id', vivierId2);
  }
  if (restoreSources) await db().from('campaigns').update({ sources: restoreSources }).eq('id', campaignId);
});

describe('S49 — la recherche dans le vivier porte ses gestes, sur place', () => {
  it('S49.1 — un résultat se DÉPLIE : pourquoi, synthèse, historique, CV', async () => {
    await page.goto(`${BASE_URL}/campagnes/${encodeURIComponent(campaignId)}/vivier`, { waitUntil: 'domcontentloaded' });
    // Ouvrir l'écran lance la recherche : le bouton de relance se réactive à la fin.
    await page.getByRole('button', { name: 'Relancer la recherche vivier' }).waitFor({ timeout: 90_000 });
    await attendreHydratation(page, 'input[placeholder="Mot-clé exact (ex. SAP)"]');
    await page.fill('input[placeholder="Mot-clé exact (ex. SAP)"]', KEYWORD);
    await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
    const ligne = page.locator('li', { hasText: NAME });
    await ligne.waitFor({ timeout: 60_000 });
    // Les trois gestes, sans rien déplier.
    for (const role of ['vivier-preview', 'vivier-reject', 'vivier-invite-row']) {
      expect(await ligne.locator(`[data-role="${role}"]`).count(), role).toBe(1);
    }
    await ligne.locator('[data-role="vivier-expand"]').click();
    const detail = ligne.locator('[data-role="vivier-profile-detail"]');
    await detail.waitFor();
    await expect.poll(() => detail.textContent(), { timeout: 30_000 }).toContain('Historique');
    const text = (await detail.textContent()) ?? '';
    for (const bloc of ['Pourquoi ce profil', 'Synthèse', 'Historique', 'Voir le CV']) expect(text).toContain(bloc);
    await page.screenshot({ path: `${CAPTURES}/0-resultat-deplie.png` });
  }, 300_000);

  it('S49.2 — « Écarter » sur un résultat : écarté pour CETTE campagne, rien de créé ni d’envoyé', async () => {
    const ligne = page.locator('li', { hasText: NAME2 });
    await ligne.locator('[data-role="vivier-reject"]').click();
    await expect.poll(() => ligne.textContent(), { timeout: 30_000 }).toContain('Écarté pour cette campagne');
    const { data: pre } = await db()
      .from('vivier_preselections')
      .select('state')
      .eq('campaign_id', campaignId)
      .eq('candidate_id', vivierId2);
    expect(pre?.[0]?.state).toBe('rejected');
    const { data: analyses } = await db().from('candidate_analyses').select('id').eq('id', `can_viv_${campaignId}_${vivierId2}`);
    expect(analyses ?? []).toHaveLength(0);
  }, 300_000);

  it('S49.3 — « CV » ouvre l’aperçu, « Inviter » y crée la candidature et envoie l’invitation', async () => {
    const ligne = page.locator('li', { hasText: NAME });
    await ligne.locator('[data-role="vivier-preview"]').first().click();
    const apercu = page.locator('[data-role="vivier-cv-preview"]');
    await apercu.waitFor();
    await expect.poll(() => apercu.textContent(), { timeout: 30_000 }).toContain('AMOA bancaire');
    expect(await apercu.textContent()).toContain(`Trouvé par la recherche « ${KEYWORD} »`);
    expect(await apercu.getByRole('button', { name: 'Écarter' }).count()).toBe(1);
    await page.screenshot({ path: `${CAPTURES}/1-apercu-cv.png` });

    await apercu.locator('[data-role="vivier-invite"]').click();
    const notice = page.locator('[data-role="vivier-invite-notice"]');
    await notice.waitFor({ timeout: 120_000 });
    expect(await notice.textContent()).toContain('est invité');
    await apercu.waitFor({ state: 'detached' });

    const { data: row } = await db()
      .from('candidate_analyses')
      .select('source, decided_by, decision_zone, from_vivier, vivier_candidate_id')
      .eq('id', analysisId())
      .single();
    expect(row).toMatchObject({
      source: 'vivier', decided_by: 'user', decision_zone: 'auto_accept', from_vivier: true, vivier_candidate_id: vivierId,
    });
    const { data: briefs } = await db().from('interview_briefs').select('status').eq('uid', analysisId());
    expect(briefs?.map((b) => b.status)).toEqual(['awaiting_booking']);
    const { data: validations } = await db().from('pending_validations').select('id').eq('payload->>uid', analysisId());
    expect(validations ?? []).toHaveLength(0);
    // Le résultat dit désormais qu'il est contacté — plus de bouton « Inviter ».
    await expect.poll(() => ligne.textContent(), { timeout: 30_000 }).toContain('Déjà contacté');
    await page.screenshot({ path: `${CAPTURES}/2-apres-inviter.png` });
  }, 300_000);
});
