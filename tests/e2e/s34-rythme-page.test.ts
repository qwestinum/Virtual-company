/**
 * S34 — LE RYTHME VERTICAL est le même sur les cinq onglets.
 *
 * S32 mesure déjà le CADRE (x, largeur) : il était identique au pixel, et
 * c'est pour ça que le défaut a survécu. Ce qui sautait, c'était la SUITE —
 * mesuré le 21/09/2026 : premier champ à 104 px sous le conteneur sur
 * Candidatures et Entretiens mais 168 sur Pilotage, première ligne à 275 /
 * 284 / 334. Trois valeurs proches mais différentes se lisent comme trois
 * pages.
 *
 * Ce test mesure les ÉCARTS entre les fentes du gabarit (titre → onglets →
 * outils → compteurs → filet → corps), pas leurs positions absolues : la
 * hauteur d'un ruban dépend de son contenu, l'espace qui le précède non.
 *
 * Il vérifie aussi que le fond de page est UNI : le vieux Bureau peignait un
 * dégradé radial, trois taches floutées et une grille de points — un décor qui
 * se lit comme de l'information.
 */
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import { assertAppIsUp, launchBrowser, signIn } from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

const ONGLETS = [
  { nom: 'Aujourd’hui', route: '/aujourdhui' },
  { nom: 'Campagnes', route: '/campagnes' },
  { nom: 'Candidatures', route: '/candidatures' },
  { nom: 'Entretiens', route: '/entretiens' },
  { nom: 'Pilotage', route: '/pilotage' },
];

/** Les espacements NOMMÉS dans `PageShell` (RYTHME). */
const APRES_TITRE = 20;
const ENTRE_BLOCS = 16;
const APRES_FILET = 16;

type Mesure = {
  conteneur: { x: number; w: number } | null;
  titreY: number | null;
  ecarts: Record<string, number | null>;
  fond: { couleur: string; image: string };
};

describe('S34 — un seul rythme de page', () => {
  let browser: Browser;
  let recruiter: TestRecruiter;
  let page: Page;
  const mesures = new Map<string, Mesure>();

  beforeAll(async () => {
    await assertAppIsUp();
    browser = await launchBrowser();
    recruiter = await createTestRecruiter();
    page = await signIn(browser, recruiter);
    await page.setViewportSize({ width: 1440, height: 900 });

    for (const o of ONGLETS) {
      await page.goto(`${BASE_URL}${o.route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-page-container]', { timeout: 90_000 });
      await page.waitForTimeout(2_500);
      mesures.set(
        o.nom,
        await page.evaluate(() => {
          const cont = document.querySelector('[data-page-container]');
          const r = (sel: string) => {
            const el = cont?.querySelector(sel) ?? null;
            return el ? el.getBoundingClientRect() : null;
          };
          const entete = r('header');
          const onglets = r('[data-page-tabs]');
          const outils = r('[data-page-toolbar]');
          const compteurs = r('[data-page-counters]');
          const tete = r('[data-page-head]');
          const corps = r('[data-page-body]');
          const boite = cont?.getBoundingClientRect() ?? null;
          const titre = r('h1');
          const ecart = (a: DOMRect | null, b: DOMRect | null): number | null =>
            a && b ? Math.round(b.y - (a.y + a.height)) : null;
          const fond = getComputedStyle(
            document.querySelector('[data-workspace-background]') ?? document.body,
          );
          return {
            conteneur: boite
              ? { x: Math.round(boite.x), w: Math.round(boite.width) }
              : null,
            titreY: titre ? Math.round(titre.y - (boite?.y ?? 0)) : null,
            ecarts: {
              'titre→onglets': ecart(entete, onglets),
              'titre→outils': onglets ? null : ecart(entete, outils),
              'onglets→outils': ecart(onglets, outils),
              'outils→compteurs': ecart(outils, compteurs),
              'filet→corps': ecart(tete, corps),
            },
            fond: { couleur: fond.backgroundColor, image: fond.backgroundImage },
          };
        }),
      );
    }
  }, 400_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
    if (recruiter) await deleteTestRecruiter(recruiter);
  });

  it('S34.1 — même cadre : 0 px d’écart sur les cinq', () => {
    const boites = [...mesures.entries()].map(([n, m]) => [n, m.conteneur] as const);
    const ref = boites[0]![1];
    expect(ref, 'aucun conteneur mesuré').not.toBeNull();
    for (const [nom, b] of boites) {
      expect(b, `${nom} : pas de conteneur`).not.toBeNull();
      expect(b!.x, `${nom} : x`).toBe(ref!.x);
      expect(b!.w, `${nom} : largeur`).toBe(ref!.w);
    }
  });

  it('S34.2 — le titre tombe à la même hauteur partout', () => {
    const ys = [...mesures.entries()].map(([n, m]) => [n, m.titreY] as const);
    for (const [nom, y] of ys) {
      expect(y, `${nom} : pas de titre mesurable`).not.toBeNull();
      expect(y, `${nom} : hauteur du titre`).toBe(ys[0]![1]);
    }
  });

  it('S34.3 — les mêmes espacements entre les fentes', () => {
    const attendu: Record<string, number> = {
      'titre→onglets': APRES_TITRE,
      'titre→outils': APRES_TITRE,
      'onglets→outils': ENTRE_BLOCS,
      'outils→compteurs': ENTRE_BLOCS,
      'filet→corps': APRES_FILET,
    };
    const fautifs: string[] = [];
    for (const [nom, m] of mesures) {
      for (const [cle, valeur] of Object.entries(m.ecarts)) {
        // Une fente absente ne se mesure pas — et ne laisse aucun espace.
        if (valeur === null) continue;
        if (valeur !== attendu[cle]) {
          fautifs.push(`${nom} ${cle} = ${valeur} px (attendu ${attendu[cle]})`);
        }
      }
    }
    expect(fautifs, fautifs.join('\n')).toEqual([]);
  });

  it('S34.4 — fond de page UNI, sans dégradé ni pointillé', () => {
    for (const [nom, m] of mesures) {
      expect(m.fond.image, `${nom} : le fond porte une image`).toBe('none');
      expect(m.fond.couleur, `${nom} : le fond n’est pas le sand`).toBe(
        'rgb(250, 248, 245)',
      );
    }
  });
});
