/**
 * S40 — LES PUCES DE CANDIDATURES, ENTRETIENS ET PILOTAGE BASCULENT VRAIMENT.
 *
 * Essai du 22/09/2026 : les trois écrans prennent les puces à point coloré de
 * Diffusion et de « Revue de candidature », à la place des cartes-compteurs.
 * Un changement de composant de navigation ne se prouve qu'en cliquant : un
 * test de logique lirait la liste des puces sans voir si le clic change la
 * vue.
 *
 * Ce qui est vérifié, écran par écran :
 *   - Candidatures : une étape filtre (la porte de revue groupée apparaît
 *     sous « À valider ») ; « Toutes »
 *     retire le filtre (une puce ne se désélectionne pas, c'est elle qui
 *     rend ce que le second clic sur une carte rendait) ; son compte est la
 *     somme des étapes (partition).
 *   - Entretiens : la puce choisie devient l'active, et l'alerte « à
 *     confirmer », quand il y en a une, reste portée par « Programmés ».
 *   - Pilotage : la puce « Audit » ouvre bien l'audit.
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

/** Le premier nombre écrit dans la puce — son compte. */
const compteDe = (page: Page, cle: string) =>
  page.$eval(`[data-dot-tab="${cle}"] .font-data`, (n) =>
    Number((n.textContent ?? '').trim().split(/\s/)[0]),
  );

describe('S40 — puces de Candidatures, Entretiens et Pilotage', () => {
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

  it('S40.1 — Candidatures : une étape filtre, « Toutes » rend tout', async () => {
    await page.goto(`${BASE_URL}/candidatures`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-dot-tab="a_valider"]', { timeout: 90_000 });
    await attendreHydratation(page, '[data-dot-tab="a_valider"]');
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1_000);

    expect(await actives(page)).toEqual(['toutes']);

    // « Toutes » = la somme des étapes : les étapes forment une partition.
    const cles = (
      await page.$$eval('[data-dot-tab]', (ns) => ns.map((n) => n.getAttribute('data-dot-tab')))
    ).filter((c): c is string => c !== null && c !== 'toutes');
    let somme = 0;
    for (const c of cles) somme += await compteDe(page, c);
    expect(await compteDe(page, 'toutes')).toBe(somme);

    // ⚠️ L'étape choisie ici est un filtre LOCAL : elle ne s'écrit pas dans
    // l'adresse (comportement antérieur à l'essai, inchangé). On vérifie donc
    // son EFFET : la porte de revue groupée, attachée à « À valider ».
    // Par son libellé : la barre du haut porte un lien vers la même adresse.
    const porte = 'a[href="/candidatures/validation"]:has-text("Passer en revue en une fois")';
    expect(await page.locator(porte).count()).toBe(0);

    await page.click('[data-dot-tab="a_valider"]');
    await page.waitForSelector(porte, { timeout: 15_000 });
    expect(await actives(page)).toEqual(['a_valider']);

    await page.click('[data-dot-tab="toutes"]');
    await page.waitForSelector(porte, { state: 'detached', timeout: 15_000 });
    expect(await actives(page)).toEqual(['toutes']);
  }, 300_000);

  it('S40.2 — Entretiens : la puce choisie devient l’active', async () => {
    await page.goto(`${BASE_URL}/entretiens`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-dot-tab="awaiting"]', { timeout: 90_000 });
    await attendreHydratation(page, '[data-dot-tab="awaiting"]');
    await page.waitForTimeout(1_500);

    expect(await actives(page)).toEqual(['scheduled']);
    for (const cle of ['awaiting', 'verdict', 'scheduled']) {
      await page.click(`[data-dot-tab="${cle}"]`);
      await page.waitForTimeout(250);
      expect(await actives(page), cle).toEqual([cle]);
    }
    // L'alerte, quand il y en a une, vit DANS la puce « Programmés » — et
    // nulle part ailleurs parmi les puces.
    const alertes = await page.$$eval('[data-dot-tab]', (ns) =>
      ns
        .filter((n) => /à confirmer/.test(n.textContent ?? ''))
        .map((n) => n.getAttribute('data-dot-tab')),
    );
    expect(alertes.every((c) => c === 'scheduled'), JSON.stringify(alertes)).toBe(true);
  }, 300_000);

  it('S40.2bis — Entretiens : « Historique » montre le registre, et son adresse l’ouvre', async () => {
    // Un clic sur la puce affiche le registre (ou le dit vide) — jamais un
    // écran blanc ni la liste d'un autre onglet.
    await page.click('[data-dot-tab="history"]');
    await page.waitForTimeout(250);
    expect(await actives(page)).toEqual(['history']);
    const registre = await page.locator('[data-interview-history]').count();
    const vide = await page.locator('text=Aucun entretien passé.').count();
    expect(registre + vide).toBe(1);
    // Chaque ligne porte un verdict lisible.
    const verdicts = await page.$$eval('[data-history-verdict]', (ns) =>
      ns.map((n) => (n.textContent ?? '').trim()),
    );
    expect(verdicts.every((v) => v.length > 0)).toBe(true);

    // L'adresse ouvre directement l'onglet.
    await page.goto(`${BASE_URL}/entretiens?section=historique`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-dot-tab="history"]', { timeout: 90_000 });
    await attendreHydratation(page, '[data-dot-tab="history"]');
    expect(await actives(page)).toEqual(['history']);
  }, 300_000);

  it('S40.3 — Pilotage : « Audit » ouvre l’audit', async () => {
    await page.goto(`${BASE_URL}/pilotage`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-dot-tab="audit"]', { timeout: 90_000 });
    await attendreHydratation(page, '[data-dot-tab="audit"]');

    expect(await actives(page)).toEqual(['campaign']);
    await page.click('[data-dot-tab="multi"]');
    await page.waitForTimeout(250);
    expect(await actives(page)).toEqual(['multi']);
    await page.click('[data-dot-tab="audit"]');
    await page.waitForSelector('text=Audit candidat', { timeout: 60_000 });
    expect(await actives(page)).toEqual(['audit']);
  }, 300_000);
});
