/**
 * S36 — LA COLONNE DE NAVIGATION.
 *
 * Une barre d'onglets horizontale est devenue une colonne à gauche. Ce qui doit
 * rester vrai n'est pas visible dans le code : que chaque entrée OUVRE sa page,
 * que la colonne tombe au même pixel sur les cinq, et qu'elle se replie sans
 * emporter la largeur du contenu.
 *
 * ⚠️ Le repli est en CSS (`max-[1099px]:`). Un test de logique ne peut pas le
 * voir — il faut un navigateur, et une vraie fenêtre de 1 000 px.
 */
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import { assertAppIsUp, launchBrowser, signIn } from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

const ENTREES = [
  { id: 'aujourdhui', route: '/aujourdhui' },
  { id: 'campagnes', route: '/campagnes' },
  { id: 'candidatures', route: '/candidatures' },
  { id: 'entretiens', route: '/entretiens' },
  { id: 'pilotage', route: '/pilotage' },
];

const COLONNE = '[data-workspace-sidebar]';

async function ouvrir(page: Page, route: string) {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(COLONNE, { timeout: 90_000 });
  await page.waitForTimeout(600);
}

describe('S36 — la colonne de navigation', () => {
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

  it('S36.1 — chaque entrée OUVRE sa page', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ouvrir(page, '/aujourdhui');
    for (const e of ENTREES) {
      await page.click(`[data-sidebar-entry="${e.id}"]`);
      await page.waitForURL((u) => u.pathname === e.route, { timeout: 60_000 });
      await page.waitForSelector('[data-page-container]', { timeout: 90_000 });
      // L'entrée cliquée est celle que les lecteurs d'écran annoncent.
      const courante = await page.getAttribute(
        `[data-sidebar-entry="${e.id}"]`,
        'aria-current',
      );
      expect(courante, `${e.id} : aria-current`).toBe('page');
    }
    // Et « Paramètres » quitte bien la barre du haut pour la colonne.
    await page.click('[data-sidebar-entry="reglages"]');
    await page.waitForURL((u) => u.pathname.startsWith('/settings'), { timeout: 60_000 });
  }, 400_000);

  it('S36.2 — Aujourd’hui est l’entrée par défaut', async () => {
    // ⚠️ PAS depuis `/` : la racine est la page publique, pas le workspace.
    // La porte d'entrée du workspace est son ancienne adresse, celle que
    // portent les favoris et les comptes rendus — c'est elle qui doit
    // déposer sur « Aujourd'hui ».
    await page.goto(`${BASE_URL}/rh/recrutement`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL((u) => u.pathname === '/aujourdhui', { timeout: 60_000 });
    await page.waitForSelector(COLONNE, { timeout: 90_000 });
    expect(
      await page.getAttribute('[data-sidebar-entry="aujourdhui"]', 'aria-current'),
    ).toBe('page');

    // Et elle est EN TÊTE de la colonne : le point de départ se lit avant
    // les sections, pas au milieu.
    const ordre = await page.$$eval('[data-sidebar-entry]', (ns) =>
      ns.map((n) => n.getAttribute('data-sidebar-entry')),
    );
    expect(ordre[0], JSON.stringify(ordre)).toBe('aujourdhui');
    expect(ordre[ordre.length - 1], JSON.stringify(ordre)).toBe('reglages');
  }, 300_000);

  it('S36.3 — la colonne est identique sur les cinq pages', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const boites: { id: string; x: number; w: number }[] = [];
    for (const e of ENTREES) {
      await ouvrir(page, e.route);
      const b = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), w: Math.round(r.width) };
      }, COLONNE);
      expect(b, `${e.id} : pas de colonne`).not.toBeNull();
      boites.push({ id: e.id, ...b! });
    }
    const ref = boites[0]!;
    for (const b of boites) {
      expect(b.x, `${b.id} : x — ${JSON.stringify(boites)}`).toBe(ref.x);
      expect(b.w, `${b.id} : largeur — ${JSON.stringify(boites)}`).toBe(ref.w);
    }
  }, 400_000);

  it('S36.4 — elle se replie à 1 000 px, et le contenu garde son cadre', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ouvrir(page, '/candidatures');
    const large = await page.evaluate((sel) => {
      const nav = document.querySelector(sel)!.getBoundingClientRect();
      const cont = document.querySelector('[data-page-container]')!.getBoundingClientRect();
      const libelle = document.querySelector(
        '[data-sidebar-entry="candidatures"] span',
      ) as HTMLElement | null;
      return {
        nav: Math.round(nav.width),
        contenu: Math.round(cont.width),
        libelleVisible: libelle ? libelle.getBoundingClientRect().width > 0 : false,
      };
    }, COLONNE);

    await page.setViewportSize({ width: 1000, height: 900 });
    await page.waitForTimeout(800);
    const etroit = await page.evaluate((sel) => {
      const nav = document.querySelector(sel)!.getBoundingClientRect();
      const cont = document.querySelector('[data-page-container]')!.getBoundingClientRect();
      const lien = document.querySelector('[data-sidebar-entry="candidatures"]');
      const libelle = lien?.querySelector('span') as HTMLElement | null;
      return {
        nav: Math.round(nav.width),
        contenu: Math.round(cont.width),
        libelleVisible: libelle ? libelle.getBoundingClientRect().width > 0 : false,
        // L'infobulle prend le relais du libellé.
        infobulle: lien?.getAttribute('title') ?? null,
      };
    }, COLONNE);

    const detail = JSON.stringify({ large, etroit });
    expect(large.libelleVisible, `libellé large — ${detail}`).toBe(true);
    expect(large.nav, `colonne large — ${detail}`).toBe(252);
    expect(etroit.nav, `colonne repliée — ${detail}`).toBe(64);
    expect(etroit.libelleVisible, `libellé replié — ${detail}`).toBe(false);
    expect(etroit.infobulle, `infobulle — ${detail}`).toBe('Candidatures');
    // ⚠️ Le contenu ne se rétrécit QUE de ce que la fenêtre a perdu : la
    // colonne lui rend même sa place. 1440−252 = 1188 ; 1000−64 = 936.
    expect(etroit.contenu, `contenu replié — ${detail}`).toBeGreaterThan(
      large.contenu - (1440 - 1000),
    );
  }, 400_000);

  it('S36.5 — les flèches déplacent le focus dans la colonne', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ouvrir(page, '/aujourdhui');
    await page.focus('[data-sidebar-entry="aujourdhui"]');
    await page.keyboard.press('ArrowDown');
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute('data-sidebar-entry')),
    ).toBe('campagnes');
    await page.keyboard.press('ArrowUp');
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute('data-sidebar-entry')),
    ).toBe('aujourdhui');
  }, 300_000);
});
