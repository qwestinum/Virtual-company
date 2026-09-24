/**
 * S29 — LES PORTES DE LA CARTE CAMPAGNE MÈNENT LÀ OÙ ELLES DISENT.
 *
 * Trois portes, trois gestes : chercher dans le vivier, diffuser l'annonce,
 * approcher des profils. Deux livraisons les ont annoncées branchées alors
 * qu'elles ne l'étaient pas : les tests de l'époque lisaient la CHAÎNE du lien
 * et la PRÉSENCE des mots dans le code — aucun ne pouvait voir ce que le
 * navigateur en faisait. Ils cliquent ici.
 *
 * Chaque porte ouvre désormais UN ÉCRAN À ELLE, à son adresse. Elles
 * déposaient avant sur la feuille d'édition, ouverte sur un accordéon de neuf
 * blocs dont un seul était demandé : on arrivait devant un formulaire complet
 * pour écrire un texte, ou pour trancher trois profils.
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
  it('S29.1 — « Chercher dans le vivier » ouvre le vivier, seul à l’écran', async () => {
    await ouvrirLaCarte();
    await porte(page, 'Chercher dans le vivier').click();
    await page.waitForURL((u) => u.pathname.endsWith('/vivier'), { timeout: 60_000 });
    await page.waitForSelector(`[data-focus="${campagne.id}"]`, { timeout: 60_000 });

    // Le panneau est RÉELLEMENT rendu — un écran ouvert sur du vide serait la
    // même porte morte sous un autre nom.
    await page
      .locator('text=Relancer la recherche vivier')
      .waitFor({ state: 'visible', timeout: 60_000 });
    if (campagne.hasVivierProposal) {
      await page.locator('text=à examiner').first().waitFor({ state: 'visible', timeout: 30_000 });
    }

    // Et RIEN d'autre : pas de feuille d'édition, pas d'accordéon.
    expect(await page.locator('[role="dialog"]').count()).toBe(0);
  }, 180_000);

  it('S29.2 — « Fermer » ramène À LA CAMPAGNE, pas à la liste nue', async () => {
    await page.locator('[data-focus] >> text=Fermer').click();
    await page.waitForURL(
      (u) => u.pathname === '/campagnes' && u.searchParams.get('campagne') === campagne.id,
      { timeout: 60_000 },
    );
  }, 180_000);

  it('S29.3 — « Diffuser l’annonce » ouvre l’annonce, seule à l’écran', async () => {
    await ouvrirLaCarte();
    await porte(page, 'Diffuser l’annonce').click();
    await page.waitForURL((u) => u.pathname.endsWith('/annonce'), { timeout: 60_000 });
    await page.waitForSelector(`[data-focus="${campagne.id}"]`, { timeout: 60_000 });
    expect(await page.locator('[role="dialog"]').count()).toBe(0);
  }, 180_000);

  it('S29.4 — la même porte, une seconde fois, ouvre encore', async () => {
    for (let i = 0; i < 2; i += 1) {
      await ouvrirLaCarte();
      await porte(page, 'Chercher dans le vivier').click();
      await page.waitForURL((u) => u.pathname.endsWith('/vivier'), { timeout: 60_000 });
      await page.waitForSelector(`[data-focus="${campagne.id}"]`, { timeout: 60_000 });
    }
  }, 180_000);

  it('S29.4bis — une porte PROPOSE ce qui n’est pas activé, au lieu de renvoyer', async () => {
    // Sur une campagne qui ne retient aucun canal à contenu, « Diffuser
    // l'annonce » offrait un lien vers les réglages : refaire le chemin pour
    // une case à cocher. Elle propose maintenant le choix sur place.
    await ouvrirLaCarte();
    await porte(page, 'Diffuser l’annonce').click();
    await page.waitForURL((u) => u.pathname.endsWith('/annonce'), { timeout: 60_000 });
    await page.waitForSelector(`[data-focus="${campagne.id}"]`, { timeout: 60_000 });

    // Deux cas, tous deux acceptables — ce qui ne l'est pas, c'est un
    // cul-de-sac : soit l'annonce est là, soit on propose de choisir le canal.
    const panneaux = await page.locator('[data-channel-content]').count();
    const propose = await page.locator('[data-optin]').count();
    expect(panneaux + propose).toBeGreaterThan(0);
    if (propose > 0) {
      // Le choix est offert, et il nomme les canaux réellement diffusables.
      expect(await page.locator('[data-optin-choice]').count()).toBeGreaterThan(0);
    }
  }, 180_000);

  it('S29.4ter — AUCUN canal à contenu n’est inatteignable depuis l’annonce', async () => {
    // Le choix du canal n'apparaissait qu'à ZÉRO canal retenu : une campagne
    // diffusée sur l'APEC ne pouvait plus jamais recevoir l'annonce générique
    // (jobboard de démonstration). Chaque canal doit être là, soit en
    // panneau, soit en choix proposé.
    await page.goto(`${BASE_URL}/campagnes/${encodeURIComponent(campagne.id)}/annonce`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector(`[data-focus="${campagne.id}"]`, { timeout: 90_000 });
    await page
      .locator('[data-channel-content], [data-optin]')
      .first()
      .waitFor({ timeout: 60_000 });
    // Sans page d'offres sur l'instance, l'annonce générique n'est PAS
    // proposée — c'est voulu (un choix qui s'enregistre puis disparaît).
    const res = await page.request.get(
      `${BASE_URL}/api/campaigns/${encodeURIComponent(campagne.id)}/job-post`,
    );
    const canaux = res.status() === 404 ? ['apec'] : ['generic', 'apec'];
    for (const canal of canaux) {
      const panneau = await page.locator(`[data-channel-content="${canal}"]`).count();
      const choix = await page.locator(`[data-optin-choice="${canal}"]`).count();
      expect(panneau + choix, `canal ${canal} inatteignable`).toBe(1);
    }
  }, 180_000);

  it('S29.4quater — filtré sur une campagne, la page ne passe pas SOUS le bandeau', async () => {
    // Le gabarit est en `position: absolute` : sans ancêtre positionné, il se
    // calait sur le cadre du workspace et le titre chevauchait « Filtré sur ».
    for (const ecran of ['candidatures', 'entretiens']) {
      await page.goto(`${BASE_URL}/${ecran}?campagne=${encodeURIComponent(campagne.id)}`, {
        waitUntil: 'domcontentloaded',
      });
      const barre = page.locator('[data-active-filters]');
      await barre.waitFor({ timeout: 90_000 });
      const titre = page.locator('[data-page-shell] h1').first();
      await titre.waitFor({ timeout: 60_000 });
      const b = (await barre.boundingBox())!;
      const t = (await titre.boundingBox())!;
      expect(t.y, `${ecran} : titre sous le bandeau`).toBeGreaterThanOrEqual(b.y + b.height);
    }
  }, 180_000);

  it('S29.5 — l’adresse collée dans la barre ouvre la même chose', async () => {
    await page.goto(`${BASE_URL}/campagnes/${encodeURIComponent(campagne.id)}/vivier`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector(`[data-focus="${campagne.id}"]`, { timeout: 90_000 });
    await page
      .locator('text=Relancer la recherche vivier')
      .waitFor({ state: 'visible', timeout: 60_000 });
  }, 180_000);
});
