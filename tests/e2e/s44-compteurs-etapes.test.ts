/**
 * S44 — LES DIX ÉTAPES À L'ÉCRAN (feat/feedback-candidat, lot 3).
 *
 *   1. La carte campagne dépliée montre « Reçues » puis DIX compteurs, et
 *      leur somme fait « Reçues » — un tableau dont les chiffres se recoupent
 *      est un tableau qu'on croit (arbitrage du 28/09/2026).
 *   2. Chaque compteur porte sa définition au survol (le libellé reste court).
 *   3. Cliquer « Recruté » — une puce à zéro est un état normal — ouvre
 *      Candidatures avec LA MÊME puce active, et le même chiffre.
 *   4. Le ruban de Candidatures porte les dix puces, dans l'ordre du lexique.
 */
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import { assertAppIsUp, attendreHydratation, launchBrowser, signIn } from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

const ORDRE = [
  'À valider',
  'Propositions de refus',
  'Invité',
  'RDV pris',
  'Entretien fait',
  'Retenu',
  'Recruté',
  'Écarté',
  'Non retenu',
  'Sans suite',
];

let browser: Browser;
let page: Page;
let recruiter: TestRecruiter;

beforeAll(async () => {
  await assertAppIsUp();
  recruiter = await createTestRecruiter();
  browser = await launchBrowser();
  page = await signIn(browser, recruiter);
  await page.setViewportSize({ width: 1440, height: 900 });
}, 300_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  if (recruiter) await deleteTestRecruiter(recruiter);
});

type Tuile = { label: string; valeur: number; titre: string; href: string };

async function lireTuiles(): Promise<Tuile[]> {
  return page.$$eval('[data-role="campaign-card-counters"] a', (liens) =>
    liens.map((a) => {
      const texte = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
      const valeur = Number(texte.match(/\d+/)?.[0] ?? NaN);
      const label = texte.replace(/^[^A-Za-zÀ-ÿ]*\d+\s*/, '').trim();
      return {
        label,
        valeur,
        titre: a.getAttribute('title') ?? '',
        href: a.getAttribute('href') ?? '',
      };
    }),
  );
}

describe('S44 — les dix étapes, de la carte à la puce', () => {
  it('S44.1 — la carte : Reçues + dix compteurs dont la somme fait Reçues ; définition au survol', async () => {
    await page.goto(`${BASE_URL}/campagnes`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-campaign-card]', { timeout: 90_000 });
    await attendreHydratation(page, '[data-campaign-card]');
    const entete = page.locator('[data-campaign-card] [aria-expanded="false"]').first();
    if (await entete.count()) await entete.click();
    await page.waitForSelector('[data-role="campaign-card-counters"] a', { timeout: 30_000 });

    const tuiles = await lireTuiles();
    expect(tuiles.map((t) => t.label)).toEqual(['Reçues', ...ORDRE]);
    const [recues, ...etapes] = tuiles;
    const somme = etapes.reduce((n, t) => n + t.valeur, 0);
    expect(somme, JSON.stringify(tuiles.map((t) => [t.label, t.valeur]))).toBe(recues!.valeur);
    for (const t of etapes) {
      expect(t.titre, t.label).toMatch(new RegExp(`^${t.label} — .{6,}`));
    }
  }, 300_000);

  it('S44.2 — cliquer « Recruté » ouvre la MÊME puce, avec le même chiffre', async () => {
    const tuile = (await lireTuiles()).find((t) => t.label === 'Recruté')!;
    await page.click('[data-role="campaign-card-counters"] a[href*="statut=recrute"]');
    await page.waitForURL(/statut=recrute/, { timeout: 30_000 });
    await page.waitForSelector('[data-dot-tab="recrute"][aria-selected="true"]', { timeout: 60_000 });
    const texte = (await page.textContent('[data-dot-tab="recrute"]')) ?? '';
    expect(texte).toContain('Recruté');
    expect(Number(texte.match(/\d+/)?.[0] ?? NaN)).toBe(tuile.valeur);
  }, 300_000);

  it('S44.3 — le ruban de Candidatures porte les dix puces, dans l’ordre', async () => {
    await page.goto(`${BASE_URL}/candidatures`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-dot-tab="recrute"]', { timeout: 90_000 });
    const labels = await page.$$eval('[data-dot-tab]:not([data-dot-tab="toutes"])', (els) =>
      els.map((e) => (e.textContent ?? '').replace(/\d+/g, '').trim()),
    );
    expect(labels.slice(0, 10)).toEqual(ORDRE);
    const titre = await page.getAttribute('[data-dot-tab="ecarte"]', 'title');
    expect(titre).toContain('antérieurs au 18/08');
  }, 300_000);
});
