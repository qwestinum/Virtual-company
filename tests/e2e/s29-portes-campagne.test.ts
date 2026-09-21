/**
 * S29 — LES PORTES DE LA CARTE CAMPAGNE S'OUVRENT VRAIMENT.
 *
 * « Chercher dans le vivier » et « Diffuser l'annonce » sont des liens vers
 * `/campagnes?campagne=…&ouvrir=vivier|channels`. Deux livraisons les ont
 * annoncés branchés alors qu'ils ne l'étaient pas : les tests de l'époque
 * lisaient la CHAÎNE du lien et la PRÉSENCE des mots dans le code — aucun ne
 * pouvait voir ce que le navigateur en faisait. Ils cliquent ici.
 *
 * Le défaut réel : `CampaignsWorkspace` décidait d'ouvrir la feuille dans
 * l'initialiseur d'un `useState`, qui ne s'exécute qu'AU MONTAGE. Or ces liens
 * mènent à la page DÉJÀ affichée : Next ne remonte rien, l'initialiseur ne
 * repasse jamais, la feuille ne s'ouvrait pas. Le même lien ouvert depuis
 * *Aujourd'hui* marchait — parce que là, c'est un changement d'écran.
 *
 * D'où les trois cas ci-dessous, et le troisième n'est pas du luxe : une fois
 * l'URL consommée, re-cliquer la MÊME porte doit continuer de fonctionner.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';

import { BASE_URL } from './setup';
import { assertAppIsUp, launchBrowser, signIn } from './helpers/browser';
import { pickCampaign, type E2ECampaign } from './helpers/campaign';
import {
  createTestRecruiter,
  deleteTestRecruiter,
  type TestRecruiter,
} from './helpers/session';

let browser: Browser;
let page: Page;
let recruiter: TestRecruiter;
let campagne: E2ECampaign;

/**
 * Le bouton d'un bloc de l'accordéon, repéré par son titre visible.
 *
 * ⚠️ SCOPÉ À LA FEUILLE : les cartes campagne de la liste portent elles aussi
 * `aria-expanded`. Chercher dans toute la page ferait passer une carte dépliée
 * pour un bloc ouvert.
 */
function blocDeLAccordeon(p: Page, titre: string) {
  return p.locator('[role="dialog"] button[aria-expanded]', { hasText: titre }).first();
}

/** La tuile-porte de la carte campagne, repérée par son libellé. */
function porte(p: Page, libelle: string) {
  return p.locator('a', { hasText: libelle }).first();
}

async function ouvrirLaCarte(): Promise<void> {
  await page.goto(`${BASE_URL}/campagnes?campagne=${encodeURIComponent(campagne.id)}`, {
    waitUntil: 'domcontentloaded',
  });
  // Généreux EXPRÈS : sur un serveur de dev à froid, /campagnes se compile au
  // premier passage. Un budget serré ferait passer une compilation pour une
  // porte cassée.
  await page.waitForSelector('text=Gestion des campagnes', { timeout: 90_000 });
  // Le bloc « Trouver des candidats » n'apparaît qu'une fois la carte dépliée
  // ET ses états chargés (trois lectures qui tombent séparément).
  await page.waitForSelector('text=Trouver des candidats', { timeout: 60_000 });
  await porte(page, 'Chercher dans le vivier').waitFor({ timeout: 60_000 });
}

async function fermerLaFeuille(): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 15_000 });
}

beforeAll(async () => {
  await assertAppIsUp();
  campagne = await pickCampaign();
  recruiter = await createTestRecruiter();
  browser = await launchBrowser();
  page = await signIn(browser, recruiter);
}, 120_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  if (recruiter) await deleteTestRecruiter(recruiter);
});

describe('S29 — les portes de la carte campagne', () => {
  it('S29.1 — « Chercher dans le vivier » ouvre le vivier, pas la liste', async () => {
    await ouvrirLaCarte();
    await porte(page, 'Chercher dans le vivier').click();

    // La feuille d'édition s'ouvre…
    await page.waitForSelector('[role="dialog"]', { timeout: 20_000 });
    // …et c'est bien le VIVIER qui est déplié, pas le bloc par défaut.
    const vivier = blocDeLAccordeon(page, 'Vivier');
    await expect.poll(() => vivier.getAttribute('aria-expanded'), { timeout: 20_000 }).toBe('true');

    // Le panneau est RÉELLEMENT rendu — un accordéon ouvert sur du vide serait
    // la même porte morte sous un autre nom.
    await page
      .locator('text=Relancer la recherche vivier')
      .waitFor({ state: 'visible', timeout: 20_000 });
    if (campagne.hasVivierProposal) {
      await page
        .locator('text=à examiner')
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 });
    }

    // Aucun autre bloc de la feuille n'est ouvert en même temps — un
    // accordéon qui ouvrirait tout n'aurait rien déposé devant rien.
    expect(
      await page.locator('[role="dialog"] button[aria-expanded="true"]').count(),
    ).toBe(1);
  }, 180_000);

  it('S29.2 — « Diffuser l’annonce » ouvre les canaux de diffusion', async () => {
    await fermerLaFeuille();
    await porte(page, 'Diffuser l’annonce').click();

    await page.waitForSelector('[role="dialog"]', { timeout: 20_000 });
    const canaux = blocDeLAccordeon(page, 'Canaux de diffusion');
    await expect.poll(() => canaux.getAttribute('aria-expanded'), { timeout: 20_000 }).toBe('true');
  }, 180_000);

  it('S29.3 — la même porte, une seconde fois, ouvre encore', async () => {
    await fermerLaFeuille();
    await porte(page, 'Chercher dans le vivier').click();
    await page.waitForSelector('[role="dialog"]', { timeout: 20_000 });
    await expect
      .poll(() => blocDeLAccordeon(page, 'Vivier').getAttribute('aria-expanded'), { timeout: 20_000 })
      .toBe('true');

    await fermerLaFeuille();
    await porte(page, 'Chercher dans le vivier').click();
    await page.waitForSelector('[role="dialog"]', { timeout: 20_000 });
    await expect
      .poll(() => blocDeLAccordeon(page, 'Vivier').getAttribute('aria-expanded'), { timeout: 20_000 })
      .toBe('true');
  }, 180_000);

  it('S29.4 — le lien collé dans la barre d’adresse ouvre la même chose', async () => {
    // Le chemin qui, lui, marchait déjà : un MONTAGE. Il reste vert — on n'a
    // pas échangé un défaut contre l'autre.
    await page.goto(
      `${BASE_URL}/campagnes?campagne=${encodeURIComponent(campagne.id)}&ouvrir=vivier`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForSelector('[role="dialog"]', { timeout: 30_000 });
    await expect
      .poll(() => blocDeLAccordeon(page, 'Vivier').getAttribute('aria-expanded'), { timeout: 20_000 })
      .toBe('true');
  }, 180_000);
});
