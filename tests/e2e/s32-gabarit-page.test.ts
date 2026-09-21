/**
 * S32 — AUCUNE RUPTURE D'UN ÉCRAN À L'AUTRE.
 *
 * On NAVIGUE entre les cinq modules de premier niveau, à fenêtre constante, et
 * on mesure la boîte du conteneur de page. Une différence de coordonnée ou de
 * largeur est un échec : c'est exactement ce que l'œil voit quand la page se
 * rétrécit et se recentre en changeant d'onglet.
 *
 * Mesuré AVANT correction : conteneur de 1400 px sur Campagnes, 896 px sur
 * Entretiens et Sourcing (504 px de moins), pleine largeur sur Candidatures —
 * qui peignait en plus un fond bleu-gris au lieu du sand. Titre de page de
 * x = 28 à x = 296 selon l'onglet, et Pilotage sans titre du tout.
 *
 * ⚠️ Aucun test de logique ne dit ça : « le composant monte PageShell » est une
 * chaîne de caractères ; « les cinq écrans occupent la même boîte » est une
 * mesure. La garde structurelle (`page-shell.test.ts`) tient l'autre moitié —
 * qu'aucun écran ne se refasse un conteneur à lui.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';

import { BASE_URL } from './setup';
import { assertAppIsUp, launchBrowser, signIn } from './helpers/browser';
import {
  createTestRecruiter,
  deleteTestRecruiter,
  type TestRecruiter,
} from './helpers/session';

/** Les cinq entrées de la barre, dans l'ordre où on les parcourt. */
const MODULES: readonly [string, string][] = [
  ['Aujourd’hui', '/aujourdhui'],
  ['Campagnes', '/campagnes'],
  ['Candidatures', '/candidatures'],
  ['Entretiens', '/entretiens'],
  ['Pilotage', '/pilotage'],
];

type Boite = { x: number; largeur: number; titreX: number | null; titreY: number | null };

let browser: Browser;
let page: Page;
let recruiter: TestRecruiter;

beforeAll(async () => {
  await assertAppIsUp();
  recruiter = await createTestRecruiter();
  browser = await launchBrowser();
  page = await signIn(browser, recruiter);
  // Fenêtre CONSTANTE : une mesure prise à deux tailles ne compare rien.
  await page.setViewportSize({ width: 1440, height: 900 });
}, 300_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  if (recruiter) await deleteTestRecruiter(recruiter);
});

async function mesurer(route: string): Promise<Boite> {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-page-container]', { timeout: 90_000 });
  // Le contenu arrive après coup sur plusieurs écrans : on mesure une page
  // posée, pas une page en train de se remplir.
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const c = document.querySelector('[data-page-container]') as HTMLElement;
    const r = c.getBoundingClientRect();
    const h1 = document.querySelector('h1');
    const rh = h1?.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      largeur: Math.round(r.width),
      titreX: rh ? Math.round(rh.x) : null,
      titreY: rh ? Math.round(rh.y) : null,
    };
  });
}

describe('S32 — le gabarit de page', () => {
  it('S32.1 — les cinq modules occupent EXACTEMENT la même boîte', async () => {
    const mesures = new Map<string, Boite>();
    for (const [nom, route] of MODULES) {
      mesures.set(nom, await mesurer(route));
    }

    const reference = mesures.get('Campagnes')!;
    for (const [nom, boite] of mesures) {
      // Une différence > 0 px est un échec : c'est la rupture qu'on voit.
      expect(boite.x, `${nom} : le conteneur ne commence pas au même x`).toBe(reference.x);
      expect(boite.largeur, `${nom} : le conteneur n’a pas la même largeur`).toBe(
        reference.largeur,
      );
    }
  }, 300_000);

  it('S32.2 — le titre de page est au même endroit sur les cinq', async () => {
    const positions: string[] = [];
    for (const [nom, route] of MODULES) {
      const b = await mesurer(route);
      expect(b.titreX, `${nom} : aucun titre de page`).not.toBeNull();
      positions.push(`${nom}=${b.titreX},${b.titreY}`);
    }
    const distinctes = new Set(positions.map((p) => p.split('=')[1]));
    expect([...distinctes], positions.join(' · ')).toHaveLength(1);
  }, 300_000);

  it('S32.3 — aucun écran ne peint son propre fond de page', async () => {
    const fonds: string[] = [];
    for (const [nom, route] of MODULES) {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-page-shell]', { timeout: 90_000 });
      const fond = await page.evaluate(
        () =>
          getComputedStyle(document.querySelector('[data-page-shell]') as HTMLElement)
            .backgroundColor,
      );
      fonds.push(`${nom}=${fond}`);
    }
    // Transparent partout : le fond vient du workspace, et lui seul.
    const distincts = new Set(fonds.map((f) => f.split('=')[1]));
    expect([...distincts], fonds.join(' · ')).toEqual(['rgba(0, 0, 0, 0)']);
  }, 300_000);
});
