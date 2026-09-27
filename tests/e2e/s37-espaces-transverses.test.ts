/**
 * S37 — LA BARRE DU HAUT : atterrissage direct et espaces transverses.
 *
 * Le fil d'Ariane « Lobby / RH / Recrutement » décrivait une hiérarchie que
 * personne ne parcourait. À sa place, trois espaces qui TRAVERSENT les
 * campagnes — Vivier, Sourcing, Diffusion — et un logo qui ramène au travail
 * du jour.
 *
 * ⚠️ Ce que ce test protège n'est visible nulle part dans le code : qu'un lien
 * OUVRE sa page, qu'une ancienne adresse REDIRIGE au lieu de rendre 404, et
 * qu'aucune quatrième porte vers les validations ne soit réapparue en haut.
 */
// NB : `page.$$eval` est l'API d'évaluation DOM de Playwright — elle exécute
// la fonction FOURNIE ICI dans la page, jamais une chaîne venue d'ailleurs.
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import { assertAppIsUp, launchBrowser, signIn } from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

const ESPACES = [
  { id: 'vivier', route: '/vivier', titre: 'Vivier de candidats' },
  { id: 'sourcing', route: '/sourcing', titre: 'Sourcing' },
  { id: 'diffusion', route: '/diffusion', titre: 'Diffusion' },
  {
    id: 'revue',
    route: '/candidatures/validation',
    titre: 'Revue de candidature',
  },
];

describe('S37 — barre du haut', () => {
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

  it('S37.1 — les trois liens ouvrent leur page', async () => {
    for (const e of ESPACES) {
      await page.goto(`${BASE_URL}/aujourdhui`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(`[data-top-espace="${e.id}"]`, { timeout: 90_000 });
      await page.click(`[data-top-espace="${e.id}"]`);
      await page.waitForURL((u) => u.pathname === e.route, { timeout: 60_000 });
      // La page est RENDUE, pas seulement adressée : son titre est là.
      await page.waitForSelector(`h1:has-text("${e.titre}")`, { timeout: 90_000 });
      // Et elle garde la coquille : la colonne reste à gauche.
      expect(
        await page.locator('[data-workspace-sidebar]').count(),
        `${e.id} : pas de colonne`,
      ).toBe(1);
    }
  }, 400_000);

  it('S37.2 — le logo ramène à Aujourd’hui', async () => {
    await page.goto(`${BASE_URL}/diffusion`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-top-logo]', { timeout: 90_000 });
    await page.click('[data-top-logo]');
    await page.waitForURL((u) => u.pathname === '/aujourdhui', { timeout: 60_000 });
  }, 300_000);

  it('S37.3 — les anciennes adresses redirigent, jamais 404', async () => {
    for (const ancienne of ['/app', '/rh', '/rh/recrutement']) {
      const res = await page.goto(`${BASE_URL}${ancienne}`, {
        waitUntil: 'domcontentloaded',
      });
      expect(res?.status(), `${ancienne} : statut`).toBeLessThan(400);
      await page.waitForURL((u) => u.pathname === '/aujourdhui', { timeout: 60_000 });
    }
  }, 400_000);

  it('S37.4 — la barre ne porte QUE les quatre espaces', async () => {
    // ⚠️ « Revue de candidature » n'est pas une troisième porte vers la
    // décision à l'unité : c'est la revue GROUPÉE. La décision dossier par
    // dossier reste sous la puce « À valider » de Candidatures.
    await page.goto(`${BASE_URL}/aujourdhui`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-top-espace="vivier"]', { timeout: 90_000 });
    const espaces = await page.$$eval('[data-top-espace]', (ns) =>
      ns.map((n) => n.getAttribute('data-top-espace')),
    );
    expect(espaces).toEqual(['vivier', 'sourcing', 'diffusion', 'revue']);
    // Et plus de fil d'Ariane vers un lobby qui n'existe plus.
    expect(await page.locator('a[href="/app"]').count()).toBe(0);
  }, 300_000);

  it('S37.5 — Sourcing ouvre la base des campagnes actives, sans coût', async () => {
    await page.goto(`${BASE_URL}/sourcing`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1:has-text("Sourcing")', { timeout: 90_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1_200);

    // Une campagne déjà sourcée propose « Détail », une campagne vierge
    // « Sourcer » — jamais les deux sur la même ligne.
    const actions = await page.$$eval('[data-sourcing-action]', (ns) =>
      ns.map((n) => n.getAttribute('data-sourcing-action')),
    );
    for (const a of actions) expect(['detail', 'sourcer']).toContain(a);

    // ⚠️ AUCUNE INDICATION DE COÛT. Le budget vit dans l'administration : un
    // recruteur n'a pas à connaître le prix d'une recherche pour décider s'il
    // en a besoin.
    const texte = (await page.textContent('[data-page-body]')) ?? '';
    for (const interdit of ['€', 'Coût', 'coût du moteur']) {
      expect(texte, `« ${interdit} » n'a rien à faire sur cet écran`).not.toContain(
        interdit,
      );
    }
  }, 300_000);
});
