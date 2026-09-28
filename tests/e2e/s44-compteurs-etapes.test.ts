/**
 * S44 — LES ÉTAPES À L'ÉCRAN (feat/feedback-candidat, lot 3, carte revue le
 * 28/09/2026).
 *
 *   1. La carte campagne dépliée montre le FUNNEL POSITIF sur une rangée —
 *      Reçues · À valider · Invité · Entretien fait · Retenu · Recruté — et
 *      chaque compteur porte sa définition au survol.
 *   2. CHAQUE compteur de la carte égale SA puce dans Candidatures (même
 *      campagne), et « Reçues » égale le total de Candidatures filtré sur la
 *      campagne. La partition « dix étapes = Reçues » est tenue sur les PUCES
 *      (régression S6), plus sur la carte.
 *   3. Le ruban de Candidatures porte les dix puces, dans l'ordre du lexique.
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

const CARTE = ['Reçues', 'À valider', 'Invité', 'Entretien fait', 'Retenu', 'Recruté'];

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

describe('S44 — de la carte à la puce', () => {
  let tuiles: Tuile[] = [];

  it('S44.1 — la carte : le funnel positif, définition au survol', async () => {
    await page.goto(`${BASE_URL}/campagnes`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-campaign-card]', { timeout: 90_000 });
    await attendreHydratation(page, '[data-campaign-card]');
    const entete = page.locator('[data-campaign-card] [aria-expanded="false"]').first();
    if (await entete.count()) await entete.click();
    await page.waitForSelector('[data-role="campaign-card-counters"] a', { timeout: 30_000 });

    tuiles = await lireTuiles();
    expect(tuiles.map((t) => t.label)).toEqual(CARTE);
    for (const t of tuiles.slice(1)) {
      expect(t.titre, t.label).toMatch(new RegExp(`^${t.label} — .{6,}`));
    }
  }, 300_000);

  it('S44.2 — chaque compteur égale sa puce ; « Reçues » égale le total filtré campagne', async () => {
    expect(tuiles.length).toBe(CARTE.length);
    for (const t of tuiles) {
      const statut = new URL(t.href, BASE_URL).searchParams.get('statut') ?? 'toutes';
      await page.goto(`${BASE_URL}${t.href}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(`[data-dot-tab="${statut}"][aria-selected="true"]`, {
        timeout: 60_000,
      });
      // Les compteurs se chargent après la page : on attend qu'ils portent un chiffre.
      await expect
        .poll(async () => (await page.textContent(`[data-dot-tab="${statut}"]`)) ?? '', {
          timeout: 30_000,
        })
        .toMatch(/\d/);
      const texte = (await page.textContent(`[data-dot-tab="${statut}"]`)) ?? '';
      expect(Number(texte.match(/\d+/)?.[0] ?? NaN), `${t.label} (${statut})`).toBe(t.valeur);
    }
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
