/**
 * S33 — CLIQUER UNE CANDIDATURE OUVRE SON DÉTAIL.
 *
 * ⚠️ Le numéro : S31 est déjà la suite des champs de formulaire. Celle-ci
 * prend le suivant libre.
 *
 * Candidatures était déclaré « conservé, aucun changement de structure » — et
 * un écran conservé qui régresse sans qu'un test le voie est exactement ce que
 * la règle du chantier veut empêcher. D'où ce test de FUMÉE : le geste central
 * de l'écran, cliqué.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';

import { BASE_URL } from './setup';
import { assertAppIsUp, attendreHydratation, launchBrowser, signIn } from './helpers/browser';
import {
  createTestRecruiter,
  deleteTestRecruiter,
  type TestRecruiter,
} from './helpers/session';

let browser: Browser;
let page: Page;
let recruiter: TestRecruiter;

/** Les lignes de la liste — le bouton que le recruteur clique. */
const lignes = (p: Page) => p.locator('[data-candidature-row]');
/** Le panneau de détail. */
const panneau = (p: Page) => p.locator('[data-candidature-panel]');

async function ouvrirLaListe(url = `${BASE_URL}/candidatures`): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1', { timeout: 90_000 });
  await attendreHydratation(page, 'h1', 90_000);
  await lignes(page).first().waitFor({ timeout: 90_000 });
}

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

describe('S33 — le détail d’une candidature', () => {
  it('S33.1 — cliquer une ligne ouvre le panneau, VISIBLE à l’écran', async () => {
    await ouvrirLaListe();
    await lignes(page).first().click();
    await panneau(page).waitFor({ state: 'visible', timeout: 30_000 });

    // ⚠️ « Présent dans le DOM » ne suffit pas : le panneau a régressé en
    // restant monté mais rendu HORS de l'écran, sous la liste, avec une
    // hauteur nulle. C'est la boîte qu'on mesure.
    const boite = await panneau(page).boundingBox();
    expect(boite, 'le panneau n’a aucune boîte').not.toBeNull();
    expect(boite!.width, 'panneau sans largeur').toBeGreaterThan(200);
    expect(boite!.height, 'panneau sans hauteur').toBeGreaterThan(200);
    const fenetre = page.viewportSize()!;
    expect(boite!.x, 'panneau hors de l’écran').toBeLessThan(fenetre.width);
    expect(boite!.y, 'panneau sous le pli').toBeLessThan(fenetre.height);
  }, 300_000);

  it('S33.1bis — la liste ne BOUGE PAS quand le panneau s’ouvre', async () => {
    // Lui réserver sa place en resserrant le contenu faisait sauter toute la
    // liste au moment du clic : on perdait des yeux la ligne qu'on venait de
    // choisir. Et le panneau se cale sur le bord de la COLONNE DE CONTENU,
    // jamais sur celui de la fenêtre — contre le bord de l'écran, il flottait
    // loin de la liste, sans rapport visible avec la ligne cliquée.
    await ouvrirLaListe();
    const avant = await lignes(page).first().boundingBox();
    await lignes(page).first().click();
    await panneau(page).waitFor({ state: 'visible', timeout: 30_000 });
    const apres = await lignes(page).first().boundingBox();
    expect(apres!.x, 'la liste s’est déplacée').toBe(avant!.x);
    expect(apres!.width, 'la liste a rétréci').toBe(avant!.width);

    const boite = await panneau(page).boundingBox();
    const colonne = await page
      .locator('[data-page-container]')
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return Math.round(r.right - parseFloat(s.paddingRight));
      });
    // Le bord droit du panneau EST celui du contenu, pas celui de la fenêtre.
    expect(Math.round(boite!.x + boite!.width)).toBe(colonne);
  }, 300_000);

  it('S33.2 — le panneau porte ses actions de décision', async () => {
    // Les quatre gestes de la fiche : pointer l'entretien (réalisé / absent),
    // classer sans suite, corriger la décision. Selon l'étape du dossier, tous
    // ne sont pas offerts — mais le panneau n'est jamais MUET.
    const texte = (await panneau(page).textContent()) ?? '';
    const gestes = [
      'Entretien réalisé',
      'Absent',
      'Classer sans suite',
      'Corriger la décision',
      'Ouvrir la fiche',
    ].filter((g) => texte.includes(g));
    expect(gestes.length, `aucune action dans le panneau : ${texte.slice(0, 200)}`).toBeGreaterThan(0);
  }, 300_000);

  it('S33.3 — cliquer une autre ligne REMPLACE le contenu du panneau', async () => {
    const total = await lignes(page).count();
    if (total < 2) return; // Une seule candidature en base : rien à comparer.
    const avant = await panneau(page).textContent();
    await lignes(page).nth(1).click();
    await expect
      .poll(() => panneau(page).textContent(), { timeout: 30_000 })
      .not.toBe(avant);
    expect(await panneau(page).count(), 'deux panneaux ouverts').toBe(1);
  }, 300_000);

  it('S33.4 — fermer le panneau le ferme', async () => {
    await panneau(page).locator('[aria-label="Fermer"]').first().click();
    await panneau(page).waitFor({ state: 'detached', timeout: 30_000 });
  }, 300_000);

  it('S33.5 — l’ouverture survit à un filtre porté par l’ADRESSE', async () => {
    // Le filtre par URL est arrivé avec la refonte : c'est un suspect naturel
    // d'une régression du clic, et donc un cas à tenir.
    await ouvrirLaListe(`${BASE_URL}/candidatures?statut=a_valider`);
    await lignes(page).first().click();
    await panneau(page).waitFor({ state: 'visible', timeout: 30_000 });
    const boite = await panneau(page).boundingBox();
    expect(boite!.height).toBeGreaterThan(200);
  }, 300_000);
});
