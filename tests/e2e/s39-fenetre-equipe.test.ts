/**
 * S39 — LA FENÊTRE DE LA BANDE D'ÉQUIPE SE CHOISIT VRAIMENT.
 *
 * Sous la bande d'Aujourd'hui, deux boutons : « cette semaine » · « ce
 * mois-ci ». Un test de logique vérifie la durée ; il ne voit pas si le clic
 * relance la requête, ni s'il part vers Pilotage — la bande entière est un
 * lien, et le sélecteur a été posé HORS de ce lien exprès.
 *
 * Trois choses, prouvées en cliquant :
 *   1. le clic interroge le serveur avec la fenêtre choisie ;
 *   2. le bouton actif change, et l'on reste sur Aujourd'hui ;
 *   3. le mois compte au moins autant que la semaine — il la contient.
 */
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import { assertAppIsUp, launchBrowser, signIn } from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

const lireComptes = (page: Page) =>
  page.$$eval('[data-agent-count]', (ns) =>
    ns.map((n) => Number(n.getAttribute('data-agent-count'))),
  );

describe('S39 — fenêtre de la bande d’équipe', () => {
  let browser: Browser;
  let recruiter: TestRecruiter;
  let page: Page;

  beforeAll(async () => {
    await assertAppIsUp();
    browser = await launchBrowser();
    recruiter = await createTestRecruiter();
    page = await signIn(browser, recruiter);
    await page.setViewportSize({ width: 1440, height: 900 });
  }, 300_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
    if (recruiter) await deleteTestRecruiter(recruiter);
  });

  it('S39.1 — « ce mois-ci » relance la requête, sans quitter Aujourd’hui', async () => {
    const premiere = page.waitForResponse(
      (r) => r.url().includes('/api/today?fenetre=semaine') && r.ok(),
      { timeout: 90_000 },
    );
    await page.goto(`${BASE_URL}/aujourdhui`, { waitUntil: 'domcontentloaded' });
    await premiere;
    await page.waitForSelector('[data-band-window="mois"]', { timeout: 90_000 });
    await page.waitForTimeout(500);

    expect(await page.getAttribute('[data-band-window="semaine"]', 'aria-pressed')).toBe('true');
    expect(await page.getAttribute('[data-band-window="mois"]', 'aria-pressed')).toBe('false');
    const semaine = await lireComptes(page);
    expect(semaine.length, 'la bande n’affiche aucun agent').toBeGreaterThan(0);

    const reponseMois = page.waitForResponse(
      (r) => r.url().includes('/api/today?fenetre=mois') && r.ok(),
      { timeout: 30_000 },
    );
    await page.click('[data-band-window="mois"]');
    const corps = (await (await reponseMois).json()) as { fenetre?: string };
    // Le serveur DIT la fenêtre qu'il a appliquée — pas celle qu'on espérait.
    expect(corps.fenetre).toBe('mois');
    await page.waitForTimeout(500);

    // Le sélecteur est HORS du lien : le clic ne part pas vers Pilotage.
    expect(new URL(page.url()).pathname).toBe('/aujourdhui');
    expect(await page.getAttribute('[data-band-window="mois"]', 'aria-pressed')).toBe('true');
    expect(await page.getAttribute('[data-band-window="semaine"]', 'aria-pressed')).toBe('false');

    // Le mois contient la semaine : aucun compte ne peut y baisser.
    const mois = await lireComptes(page);
    expect(mois.length).toBe(semaine.length);
    mois.forEach((n, i) => expect(n, `agent ${i}`).toBeGreaterThanOrEqual(semaine[i]!));

    // Et l'on revient.
    const retour = page.waitForResponse(
      (r) => r.url().includes('/api/today?fenetre=semaine') && r.ok(),
      { timeout: 30_000 },
    );
    await page.click('[data-band-window="semaine"]');
    await retour;
    await page.waitForTimeout(500);
    expect(await page.getAttribute('[data-band-window="semaine"]', 'aria-pressed')).toBe('true');
  }, 300_000);
});
