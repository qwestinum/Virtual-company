/**
 * S41 — AUJOURD'HUI : BLOCS TRANSPARENTS BORDÉS DE GRIS, PAS DE RÉCAP, DE L'AIR.
 *
 * Trois demandes du 22/09/2026, vérifiées sur le RENDU (styles calculés) et
 * non sur le code : une couleur écrite juste mais écrasée ailleurs, ou un
 * jeton mal nommé qui fait tomber la déclaration, passerait une lecture du
 * source.
 *
 *   1. les trois blocs pliables sont TRANSPARENTS, bordés du gris soutenu
 *      du produit (`--dash-border-strong`, #d4cdc5) ;
 *      chaque icône de titre a sa PROPRE couleur ;
 *   2. ni la date ni la ligne « n à valider · n à conclure » sous le titre ;
 *   3. un écart plus grand entre la bande d'équipe et le premier bloc
 *      qu'entre les autres blocs de la page ;
 *   4. « cette semaine » / « ce mois-ci » sont des boutons SOBRES : une
 *      bordure, aucun fond.
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

  it('S41.1 — blocs transparents, bordure grise', async () => {
    const blocs = await page.$$eval('[data-today-card]', (ns) =>
      ns.map((n) => {
        const section = n.closest('section')!;
        const c = getComputedStyle(section);
        return {
          fondBloc: c.backgroundColor,
          fondEntete: getComputedStyle(n).backgroundColor,
          bordure: c.borderTopColor,
          filet: c.borderLeftColor,
          largeurFilet: c.borderLeftWidth,
        };
      }),
    );
    expect(blocs.length, 'aucun bloc sur Aujourd’hui').toBeGreaterThan(0);
    for (const b of blocs) {
      const d = JSON.stringify(b);
      expect(b.fondBloc, d).toBe('rgba(0, 0, 0, 0)');
      expect(b.fondEntete, d).toBe('rgba(0, 0, 0, 0)');
      // #d4cdc5 = --dash-border-strong.
      expect(b.bordure, d).toBe('rgb(212, 205, 197)');
      expect(b.filet, d).toBe('rgb(212, 205, 197)');
      expect(b.largeurFilet, d).toBe('3px');
    }
  });

  it('S41.1 bis — chaque icône de titre a sa propre couleur', async () => {
    const couleurs = await page.$$eval('[data-today-card] svg:first-child', (ns) =>
      ns.map((n) => getComputedStyle(n).color),
    );
    expect(new Set(couleurs).size, couleurs.join(' · ')).toBe(couleurs.length);
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
    // gap-5 (20 px) + la marge ajoutée (32 px).
    expect(ecarts!.sousBande, JSON.stringify(ecarts)).toBeGreaterThanOrEqual(52);
    if (ecarts!.entreBlocs !== null) {
      expect(ecarts!.sousBande).toBeGreaterThan(ecarts!.entreBlocs);
    }
  });

  it('S41.4 — les deux fenêtres sont des boutons sobres : bordure, aucun fond', async () => {
    const styles = await page.$$eval('[data-band-window]', (ns) =>
      ns.map((n) => {
        const c = getComputedStyle(n);
        return { bordure: c.borderTopWidth, style: c.borderTopStyle, fond: c.backgroundColor };
      }),
    );
    expect(styles.length).toBe(2);
    for (const s of styles) {
      expect(s.style, JSON.stringify(s)).toBe('solid');
      expect(s.bordure, JSON.stringify(s)).toBe('1px');
      expect(s.fond, JSON.stringify(s)).toBe('rgba(0, 0, 0, 0)');
    }
  });
});
