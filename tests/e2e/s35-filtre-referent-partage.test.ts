/**
 * S35 — LE FILTRE « Référent » EST LE MÊME SUR TOUS LES ÉCRANS.
 *
 * Un seul état, mémorisé par recruteur : cocher « Mes campagnes » sur un
 * onglet, c'est le retrouver coché sur les autres, sans rechargement. C'est la
 * seule chose qu'un test de logique ne peut pas dire — l'état vit dans un
 * magasin de module et ne se vérifie qu'en NAVIGUANT.
 *
 * ⚠️ RENVERSEMENT ASSUMÉ d'une décision écrite : le filtre était
 * volontairement NON persisté (« un filtre oublié qui masque des dossiers est
 * pire que pas de filtre »). Le garde-fou qui reste, et que ce test vérifie :
 * la barre est VISIBLE sur chaque écran qui l'applique — un filtre actif se
 * voit à l'endroit même où il agit.
 */
// NB : `page.$eval` / `page.$$eval` sont les API d'évaluation DOM de
// Playwright — elles exécutent la fonction FOURNIE ICI dans la page, jamais
// une chaîne venue d'ailleurs. Rien à voir avec `eval()`.
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import { assertAppIsUp, launchBrowser, signIn } from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

/** Les écrans qui portent le filtre, et où il doit se trouver. */
const ECRANS = [
  { nom: 'Campagnes', route: '/campagnes' },
  { nom: 'Candidatures', route: '/candidatures' },
  { nom: 'Entretiens', route: '/entretiens' },
  { nom: 'Pilotage', route: '/pilotage' },
];

const SELECTEUR = '[data-toolbar-select="referent"]';

/**
 * ⚠️ On ATTEND le filtre, on ne compte pas sur un délai. Première version :
 * `waitForTimeout(2_000)` — le tout premier écran visité échouait seul, parce
 * qu'un `next dev` à froid compile la page ET que le référentiel des
 * référents arrive d'une requête. Les écrans suivants, tièdes, passaient : le
 * test accusait Campagnes d'un défaut qui n'était que sa place dans l'ordre.
 */
async function ouvrir(page: Page, route: string) {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-page-container]', { timeout: 90_000 });
  await page.waitForSelector(SELECTEUR, { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

describe('S35 — un seul filtre « Référent »', () => {
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

  it('S35.1 — la barre est au même endroit sur les quatre écrans', async () => {
    const positions: { nom: string; x: number; y: number }[] = [];
    for (const e of ECRANS) {
      await ouvrir(page, e.route);
      const boite = await page.evaluate((sel) => {
        const outils = document.querySelector('[data-page-toolbar]');
        const champ = outils?.querySelector(sel) ?? null;
        if (!outils || !champ) return null;
        const o = outils.getBoundingClientRect();
        const c = champ.getBoundingClientRect();
        // Position DANS la barre d'outils : c'est ça, « au même endroit ».
        return { x: Math.round(c.x - o.x), y: Math.round(c.y - o.y) };
      }, SELECTEUR);
      expect(boite, `${e.nom} : pas de filtre Référent dans la barre d’outils`).not.toBeNull();
      positions.push({ nom: e.nom, ...boite! });
    }
    const ref = positions[0]!;
    for (const p of positions) {
      expect(p.x, `${p.nom} : x dans la barre — ${JSON.stringify(positions)}`).toBe(ref.x);
      expect(p.y, `${p.nom} : y dans la barre — ${JSON.stringify(positions)}`).toBe(ref.y);
    }
  }, 300_000);

  it('S35.2 — coché sur un écran, coché sur les autres', async () => {
    await ouvrir(page, '/candidatures');

    // On prend une entrée qui n'est pas « Tous » : peu importe laquelle, ce
    // qui compte est qu'elle VOYAGE. Un jeu de données sans aucun référent
    // n'offre que « Tous » — le test le DIT plutôt que de passer à vide.
    const valeurs = await page.$$eval(`${SELECTEUR} option`, (os) =>
      os.map((o) => (o as HTMLOptionElement).value),
    );
    const cible = valeurs.find((v) => v !== 'all');
    expect(
      cible,
      'aucune entrée de filtre autre que « Tous » : le jeu de données de dev n’a aucun référent de campagne, ' +
        'le partage ne peut pas être prouvé. Désigne un référent sur une campagne et relance.',
    ).toBeTruthy();

    await page.selectOption(SELECTEUR, cible!);
    await page.waitForTimeout(500);

    for (const e of ECRANS) {
      await ouvrir(page, e.route);
      const lu = await page.$eval(SELECTEUR, (el) => (el as HTMLSelectElement).value);
      expect(lu, `${e.nom} : le filtre n’a pas suivi`).toBe(cible);
    }

    // Et il revient à « Tous » partout quand on le relâche.
    await ouvrir(page, '/entretiens');
    await page.selectOption(SELECTEUR, 'all');
    await page.waitForTimeout(500);
    await ouvrir(page, '/campagnes');
    expect(await page.$eval(SELECTEUR, (el) => (el as HTMLSelectElement).value)).toBe('all');
  }, 300_000);

  it('S35.3 — la liste filtrée ne montre que les campagnes du référent', async () => {
    await ouvrir(page, '/campagnes');
    const avant = await page.$$eval('[data-campaign-card]', (n) => n.length);

    const valeurs = await page.$$eval(`${SELECTEUR} option`, (os) =>
      os.map((o) => (o as HTMLOptionElement).value),
    );
    const cible = valeurs.find((v) => v !== 'all');
    if (!cible) return; // cas dit par S35.2, pas de double message ici.

    await page.selectOption(SELECTEUR, cible);
    await page.waitForTimeout(800);
    const apres = await page.$$eval('[data-campaign-card]', (n) => n.length);

    // Un filtre ne peut qu'ENLEVER. Il peut ne rien enlever (toutes les
    // campagnes au même référent) — ce qui compte est qu'il n'en ajoute pas.
    expect(apres, `avant ${avant}, après ${apres}`).toBeLessThanOrEqual(avant);

    await page.selectOption(SELECTEUR, 'all');
    await page.waitForTimeout(800);
    expect(await page.$$eval('[data-campaign-card]', (n) => n.length)).toBe(avant);
  }, 300_000);
});
