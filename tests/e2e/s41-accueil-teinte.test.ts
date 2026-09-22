/**
 * S41 — AUJOURD'HUI : UNE SEULE TEINTE, PAS DE RÉCAP, DE L'AIR SOUS LA BANDE.
 *
 * Trois demandes du 22/09/2026, vérifiées sur le RENDU (styles calculés) et
 * non sur le code : une couleur écrite juste mais écrasée ailleurs, ou un
 * jeton mal nommé qui fait tomber la déclaration, passerait une lecture du
 * source.
 *
 *   1. les trois blocs pliables ont le MÊME fond d'en-tête, et c'est un
 *      dégradé partant de #ffe0ab ;
 *   2. ni la date ni la ligne « n à valider · n à conclure » sous le titre ;
 *   3. un écart plus grand entre la bande d'équipe et le premier bloc
 *      qu'entre les autres blocs de la page.
 */
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import { assertAppIsUp, launchBrowser, signIn } from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

describe('S41 — teinte unique d’Aujourd’hui', () => {
  let browser: Browser;
  let recruiter: TestRecruiter;
  let page: Page;

  beforeAll(async () => {
    await assertAppIsUp();
    browser = await launchBrowser();
    recruiter = await createTestRecruiter();
    page = await signIn(browser, recruiter);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/aujourdhui`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-today-card]', { timeout: 90_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
  }, 300_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
    if (recruiter) await deleteTestRecruiter(recruiter);
  });

  it('S41.1 — les blocs partagent le même dégradé #ffe0ab', async () => {
    const fonds = await page.$$eval('[data-today-card]', (ns) =>
      ns.map((n) => getComputedStyle(n).backgroundImage),
    );
    expect(fonds.length, 'aucun bloc sur Aujourd’hui').toBeGreaterThan(0);
    expect(new Set(fonds).size, fonds.join('\n')).toBe(1);
    // #ffe0ab = rgb(255, 224, 171).
    expect(fonds[0]).toMatch(/^linear-gradient\(.*rgb\(255, 224, 171\)/);
  });

  it('S41.2 — ni date ni ligne de récap sous le titre', async () => {
    const entete = (await page.textContent('header:has(h1)')) ?? '';
    expect(entete).not.toMatch(/lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche/i);
    expect(entete).not.toMatch(/à valider|à conclure|à régler/);
  });

  it('S41.3 — plus d’air sous la bande qu’entre deux blocs', async () => {
    const ecarts = await page.evaluate(() => {
      const bande = document.querySelector('[data-band-window]')?.closest('div')
        ?.parentElement;
      const cartes = [...document.querySelectorAll('[data-today-card]')].map((b) =>
        b.closest('section'),
      );
      if (!bande || !cartes[0]) return null;
      const bas = (e: Element) => e.getBoundingClientRect().bottom;
      const haut = (e: Element) => e.getBoundingClientRect().top;
      return {
        sousBande: Math.round(haut(cartes[0]) - bas(bande)),
        entreBlocs: cartes[1] ? Math.round(haut(cartes[1]) - bas(cartes[0]!)) : null,
      };
    });
    expect(ecarts, 'bande ou bloc introuvable').not.toBeNull();
    // gap-5 (20 px) + la marge ajoutée (16 px).
    expect(ecarts!.sousBande, JSON.stringify(ecarts)).toBeGreaterThanOrEqual(36);
    if (ecarts!.entreBlocs !== null) {
      expect(ecarts!.sousBande).toBeGreaterThan(ecarts!.entreBlocs);
    }
  });
});
