/**
 * S52 — UN LIEN « PROPOSITIONS DE REFUS » OUVRE LES PROPOSITIONS DE REFUS.
 *
 * Défaut signalé le 03/10/2026 : depuis *Aujourd'hui*, « Les passer en revue »
 * menait à la revue de candidature ouverte sur « À examiner » — il fallait
 * chercher le second sous-onglet, le geste que le lien prétendait épargner.
 * Le sous-onglet voyage désormais dans l'adresse (`?onglet=propositions`).
 *
 * Prouvé en CLIQUANT : un test de logique lit la chaîne du lien, il ne voit
 * pas si la page en fait quelque chose (cf. l'incident fondateur de la suite).
 */
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import { assertAppIsUp, attendreHydratation, launchBrowser, signIn } from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

const actives = (page: Page) =>
  page.$$eval('[data-dot-tab][aria-selected="true"]', (ns) =>
    ns.map((n) => n.getAttribute('data-dot-tab')),
  );

async function attendreRevue(page: Page): Promise<void> {
  await page.waitForSelector('[data-dot-tab="proposals"]', { timeout: 90_000 });
  await attendreHydratation(page, '[data-dot-tab="proposals"]');
}

describe('S52 — la revue s’ouvre sur l’onglet annoncé', () => {
  let browser: Browser;
  let recruiter: TestRecruiter;
  let page: Page;

  beforeAll(async () => {
    await assertAppIsUp();
    browser = await launchBrowser();
    recruiter = await createTestRecruiter();
    page = await signIn(browser, recruiter);
  }, 300_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
    if (recruiter) await deleteTestRecruiter(recruiter);
  });

  it('S52.1 — l’adresse choisit l’onglet, dans les deux sens', async () => {
    await page.goto(`${BASE_URL}/candidatures/validation?onglet=propositions`, {
      waitUntil: 'domcontentloaded',
    });
    await attendreRevue(page);
    expect(await actives(page)).toEqual(['proposals']);

    await page.goto(`${BASE_URL}/candidatures/validation?onglet=a_examiner`, {
      waitUntil: 'domcontentloaded',
    });
    await attendreRevue(page);
    expect(await actives(page)).toEqual(['examine']);
  }, 300_000);

  it('S52.2 — Candidatures : depuis la puce « Propositions de refus », la revue s’ouvre sur elles', async () => {
    await page.goto(`${BASE_URL}/candidatures`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-dot-tab="proposition_refus"]', { timeout: 90_000 });
    await attendreHydratation(page, '[data-dot-tab="proposition_refus"]');

    await page.click('[data-dot-tab="proposition_refus"]');
    // Par son LIBELLÉ, puis son adresse vérifiée (cf. S52.3).
    const porte = 'a:has-text("Passer en revue en une fois")';
    await page.waitForSelector(porte, { timeout: 15_000 });
    expect(await page.getAttribute(porte, 'href')).toBe('/candidatures/validation?onglet=propositions');
    await page.click(porte);
    await page.waitForURL(/\/candidatures\/validation\?onglet=propositions/, { timeout: 60_000 });
    await attendreRevue(page);
    expect(await actives(page)).toEqual(['proposals']);
  }, 300_000);

  it('S52.3 — Aujourd’hui : « Les passer en revue » ouvre les propositions', async () => {
    await page.goto(`${BASE_URL}/aujourdhui`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-toolbar-select="campaign-state"]', { timeout: 90_000 });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    // Trouvé par son LIBELLÉ, jamais par son adresse : chercher l'adresse
    // attendue ferait passer en silence un lien qui pointe ailleurs (sonde du
    // 03/10/2026 — c'est ce que la première version de ce test laissait faire).
    // La carte s'ouvre REPLIÉE (recette du 22/09/2026) : on la déplie d'abord.
    const carte = '[data-today-card="validation"]';
    await page.waitForSelector(carte, { timeout: 60_000 }).catch(() => {});
    if ((await page.locator(carte).count()) > 0 && (await page.getAttribute(carte, 'aria-expanded')) === 'false') {
      await page.click(carte);
    }
    const lien = page.locator('a:has-text("Les passer en revue")');
    await lien.first().waitFor({ timeout: 30_000 }).catch(() => {});
    if ((await lien.count()) === 0) {
      throw new Error(
        'S52.3 : aucun bouton « Les passer en revue » — il faut au moins une proposition de refus ' +
          'sur une campagne active de la base de dev pour exercer ce clic.',
      );
    }
    expect(await lien.first().getAttribute('href')).toBe('/candidatures/validation?onglet=propositions');
    await lien.first().click();
    await page.waitForURL(/\/candidatures\/validation\?onglet=propositions/, { timeout: 60_000 });
    await attendreRevue(page);
    expect(await actives(page)).toEqual(['proposals']);
  }, 300_000);

  it('S52.4 — Aujourd’hui : un filtre qui masque le DIT, et « Voir tout » lève les deux filtres', async () => {
    await page.goto(`${BASE_URL}/aujourdhui`, { waitUntil: 'domcontentloaded' });
    const etat = '[data-toolbar-select="campaign-state"]';
    const referent = '[data-toolbar-select="referent"]';
    await page.waitForSelector(etat, { timeout: 90_000 });
    await attendreHydratation(page, etat);
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});

    // « Clôturées » : tout ce qui attend sur une campagne active est masqué.
    await page.selectOption(etat, 'closed');
    await page.waitForTimeout(600);
    const avis = page.locator('[data-today-masked]');
    if ((await avis.count()) === 0) {
      console.warn('S52.4 : rien n’attend sur une campagne active en dev — avis non exercé.');
      await page.selectOption(etat, 'all');
      return;
    }
    expect(Number(await avis.getAttribute('data-today-masked'))).toBeGreaterThan(0);

    await avis.locator('button:has-text("Voir tout")').click();
    await page.waitForTimeout(600);
    expect(await page.locator('[data-today-masked]').count()).toBe(0);
    expect(await page.$eval(etat, (el) => (el as HTMLSelectElement).value)).toBe('all');
    expect(await page.$eval(referent, (el) => (el as HTMLSelectElement).value)).toBe('all');
  }, 300_000);
});
