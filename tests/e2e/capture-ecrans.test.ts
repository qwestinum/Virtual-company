/**
 * CAPTURE des cinq onglets, côte à côte, MÊME FENÊTRE, MÊME ZOOM.
 *
 * Deux rendus : à 100 % (on lit les lignes) et à 50 % (on juge la page d'un
 * coup d'œil — c'est à cette taille qu'une rupture de rythme se voit).
 *
 * Ce n'est pas un test : il ne conclut rien. C'est la preuve visuelle qu'un
 * test de clic ne peut pas donner — « les lignes se ressemblent-elles ? » se
 * juge à l'œil, pas au `expect`. Il vit dans la suite E2E parce que c'est le
 * seul endroit du dépôt où un navigateur existe.
 *
 * Lancement : `npm run test:e2e -- capture-trois-ecrans` (application ouverte).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import sharp from 'sharp';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { BASE_URL } from './setup';
import {
  assertAppIsUp,
  attendreHydratation,
  launchBrowser,
  signIn,
} from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

/** Une largeur de colonne, et la même pour les trois. */
const LARGEUR = 1280;
const HAUTEUR = 900;
const DOSSIER = resolve(process.cwd(), 'tests/e2e/captures');
/**
 * Captures du KIT COMMERCIAL — versionnées, elles. Nommées par écran, prises
 * sur le jeu de démonstration, à la même fenêtre et au même zoom.
 */
const KIT = resolve(process.cwd(), 'docs/captures');

const ECRANS = [
  { nom: 'aujourdhui', route: '/aujourdhui', titre: 'Aujourd' },
  { nom: 'campagnes', route: '/campagnes', titre: 'campagnes' },
  { nom: 'candidatures', route: '/candidatures', titre: 'Candidatures' },
  { nom: 'entretiens', route: '/entretiens', titre: 'Entretiens' },
  { nom: 'pilotage', route: '/pilotage', titre: 'Pilotage' },
];

describe('capture des trois écrans', () => {
  let browser: Browser;
  let recruiter: TestRecruiter;
  let page: Page;

  beforeAll(async () => {
    await assertAppIsUp();
    browser = await launchBrowser();
    recruiter = await createTestRecruiter();
    page = await signIn(browser, recruiter);
    await page.setViewportSize({ width: LARGEUR, height: HAUTEUR });
  }, 300_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
    if (recruiter) await deleteTestRecruiter(recruiter);
  });

  it('côte à côte', async () => {
    await page.setViewportSize({ width: LARGEUR, height: HAUTEUR });
    // ⚠️ ON ATTEND LE CSS SERVI. Next reconstruit `globals.css` en différé :
    // QUATRE captures de la journée ont montré une ancienne couleur parce
    // qu'elles tiraient avant la reconstruction, et chaque fois j'ai cherché
    // le défaut dans le composant. Un jeton récent sert de témoin.
    await page.goto(`${BASE_URL}/aujourdhui`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--dash-accueil')
          .trim() !== '',
      undefined,
      { timeout: 120_000 },
    );
    mkdirSync(DOSSIER, { recursive: true });
    mkdirSync(KIT, { recursive: true });
    const morceaux: Buffer[] = [];

    for (const ecran of ECRANS) {
      await page.goto(`${BASE_URL}${ecran.route}`, { waitUntil: 'domcontentloaded' });
      // ⚠️ On attend le RÉSEAU AU REPOS, pas un délai deviné. Un délai de
      // 2,5 s suffisait quand la page était tiède ; sur un serveur de dev qui
      // compile, il a produit une planche entière de compteurs à ZÉRO et une
      // liste « Aucune campagne » — une capture qui montre un écran vide
      // prouve le contraire de ce qu'elle doit montrer.
      await page
        .waitForSelector(`text=${ecran.titre}`, { timeout: 90_000 })
        .catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(1_500);
      const png = await page.screenshot({ type: 'png' });
      writeFileSync(resolve(DOSSIER, `${ecran.nom}.png`), png);
      writeFileSync(resolve(KIT, `${ecran.nom}.png`), png);
      morceaux.push(Buffer.from(png));
    }

    // Assemblage : une colonne par onglet, un liseré entre elles pour qu'on
    // voie où l'une finit.
    const ECART = 12;
    const total = LARGEUR * ECRANS.length + ECART * (ECRANS.length - 1);
    const planche = await sharp({
      create: { width: total, height: HAUTEUR, channels: 3, background: '#3a3632' },
    })
      .composite(
        morceaux.map((input, i) => ({ input, left: i * (LARGEUR + ECART), top: 0 })),
      )
      .png()
      .toBuffer();

    await sharp(planche).toFile(resolve(DOSSIER, 'planche-100.png'));
    await sharp(planche).toFile(resolve(KIT, 'planche-100.png'));
    await sharp(planche)
      .resize(Math.round(total / 2), Math.round(HAUTEUR / 2))
      .toFile(resolve(KIT, 'planche-50.png'));

    // ── LA COLONNE REPLIÉE ────────────────────────────────────────────────
    // Sous 1 100 px, elle passe en icônes. Le repli est en CSS : il ne se
    // voit QUE dans une vraie fenêtre, à la vraie largeur.
    await page.setViewportSize({ width: 1000, height: HAUTEUR });
    const etroits: Buffer[] = [];
    for (const ecran of ECRANS) {
      await page.goto(`${BASE_URL}${ecran.route}`, { waitUntil: 'domcontentloaded' });
      await page
        .waitForSelector('[data-workspace-sidebar]', { timeout: 90_000 })
        .catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(1_200);
      const png = await page.screenshot({ type: 'png' });
      writeFileSync(resolve(KIT, `${ecran.nom}-1000.png`), png);
      etroits.push(Buffer.from(png));
    }
    const totalEtroit = 1000 * ECRANS.length + ECART * (ECRANS.length - 1);
    // ⚠️ DEUX PASSES. Enchaîner `.composite().resize()` ne fait pas ce qu'on
    // lit : sharp applique le redimensionnement AVANT la composition, donc la
    // toile rétrécit et les captures pleine taille n'y entrent plus
    // (« Image to composite must have same dimensions or smaller »). On
    // compose, on écrit en mémoire, puis on réduit.
    const plancheEtroite = await sharp({
      create: { width: totalEtroit, height: HAUTEUR, channels: 3, background: '#3a3632' },
    })
      .composite(etroits.map((input, i) => ({ input, left: i * (1000 + ECART), top: 0 })))
      .png()
      .toBuffer();
    await sharp(plancheEtroite)
      .resize(Math.round(totalEtroit / 2), Math.round(HAUTEUR / 2))
      .toFile(resolve(KIT, 'planche-1000.png'));
    await page.setViewportSize({ width: LARGEUR, height: HAUTEUR });
    await sharp(planche)
      .resize(Math.round(total / 2), Math.round(HAUTEUR / 2))
      .toFile(resolve(DOSSIER, 'planche-50.png'));
  }, 300_000);

  it('l’assistant et la carte campagne, pour le kit', async () => {
    mkdirSync(KIT, { recursive: true });

    // L'ASSISTANT, première étape — c'est l'écran qui porte la démonstration.
    await page.goto(`${BASE_URL}/campagnes/nouvelle`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page-container]', { timeout: 90_000 });
    await page.waitForTimeout(2_500);
    writeFileSync(
      resolve(KIT, 'assistant-creation.png'),
      await page.screenshot({ type: 'png' }),
    );

    // L'AUDIT CANDIDAT — la troisième surface qui liste des personnes, et
    // donc la troisième à devoir porter le même pavé orange.
    await page.goto(`${BASE_URL}/pilotage`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-counter="audit"]', { timeout: 90_000 });
    // ⚠️ ON ATTEND L'HYDRATATION. Le bouton existe en HTML avant que React ne
    // le reprenne : cliqué là, le clic tombe dans le vide, sans erreur et sans
    // trace. Mesuré : `aria-pressed` restait à `false` après le clic. C'est le
    // même piège que S29 au début du chantier, et le helper existe pour ça.
    await attendreHydratation(page, '[data-counter="audit"]');
    await page.click('[data-counter="audit"]');
    // Puis on attend la VUE, on ne devine pas : une version antérieure tirait
    // la capture 2 s après le clic et rendait l'écran précédent.
    await page.waitForSelector('text=Audit candidat', { timeout: 60_000 });
    await page.click('text=Audit candidat');
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
    writeFileSync(resolve(KIT, 'audit.png'), await page.screenshot({ type: 'png' }));

    // UNE CARTE CAMPAGNE DÉPLIÉE — les quadrants, les actions, le cycle de vie.
    // ⚠️ On la DÉPLIE : sans le clic, la capture était l'octet pour octet la
    // même que celle de l'écran Campagnes, et le kit aurait porté deux fois la
    // même image sous deux noms.
    await page.goto(`${BASE_URL}/campagnes`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-campaign-card]', { timeout: 90_000 });
    await page.waitForTimeout(1_500);
    const entete = page.locator('[data-campaign-card] [aria-expanded="false"]').first();
    if (await entete.count()) {
      await entete.click();
      await page.waitForTimeout(1_200);
    }
    writeFileSync(
      resolve(KIT, 'carte-campagne.png'),
      await page.screenshot({ type: 'png' }),
    );

    // LE VIVIER — un espace TRANSVERSE : il garde la barre du haut et la
    // colonne, mais n'est pas une entrée de celle-ci.
    await page.goto(`${BASE_URL}/vivier`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-workspace-sidebar]', { timeout: 90_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    writeFileSync(resolve(KIT, 'vivier.png'), await page.screenshot({ type: 'png' }));

    // SOURCING — la base des campagnes actives, avec « Détail » / « Sourcer ».
    await page.goto(`${BASE_URL}/sourcing`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-workspace-sidebar]', { timeout: 90_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    writeFileSync(resolve(KIT, 'sourcing.png'), await page.screenshot({ type: 'png' }));
  }, 300_000);
});
