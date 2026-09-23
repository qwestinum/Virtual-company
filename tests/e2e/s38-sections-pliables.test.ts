/**
 * S38 — CE QUI SE REPLIE SE REPLIE VRAIMENT.
 *
 * Deux écrans ont gagné un pli : les FAMILLES de Réglages, et les SECTIONS
 * d'Aujourd'hui. Un pli est une action d'interface — il ne se prouve qu'en
 * cliquant. Un test de logique lirait `aria-expanded` dans le code sans voir
 * si le contenu disparaît.
 *
 * ⚠️ Ce qui est vérifié n'est pas « le bouton existe » mais « le contenu
 * DISPARAÎT et le titre RESTE » : un pli qui masque le titre avec le reste ne
 * laisse rien où re-cliquer.
 */
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import {
  assertAppIsUp,
  attendreHydratation,
  launchBrowser,
  signIn,
} from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

const FAMILLES = [
  'Décision & candidats',
  'Identité & équipe',
  'Réception & envoi des mails',
  'Intégrations',
];

describe('S38 — sections pliables', () => {
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

  it('S38.1 — les quatre familles de Réglages se replient', async () => {
    await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-settings-group]', { timeout: 90_000 });
    await attendreHydratation(page, '[data-settings-group]');

    const presentes = await page.$$eval('[data-settings-group]', (ns) =>
      ns.map((n) => n.getAttribute('data-settings-group')),
    );
    expect(presentes).toEqual(FAMILLES);

    for (const famille of FAMILLES) {
      const bouton = `[data-settings-group="${famille}"]`;
      // REPLIÉES au départ (22/09/2026) : la page s'ouvre sur quatre titres.
      expect(await page.getAttribute(bouton, 'aria-expanded'), famille).toBe('false');
      // …bordés du jaune qui les garde repérables, SANS aplat.
      const cadre = await page.$eval(bouton, (b) => {
        const c = getComputedStyle(b);
        return { fond: c.backgroundColor, filet: c.borderTopColor, style: c.borderTopStyle };
      });
      expect(cadre.filet, famille).toBe('rgb(235, 187, 88)');
      expect(cadre.style, famille).toBe('solid');
      expect(cadre.fond, famille).toBe('rgba(0, 0, 0, 0)');

      const panneau = await page.getAttribute(bouton, 'aria-controls');
      expect(panneau, `${famille} : pas de panneau`).toBeTruthy();
      const visible = () =>
        page.evaluate((id) => !!document.getElementById(id), panneau!);
      expect(await visible(), `${famille} : panneau présent avant le clic`).toBe(false);

      await page.click(bouton);
      await page.waitForTimeout(250);
      expect(await page.getAttribute(bouton, 'aria-expanded'), famille).toBe('true');
      expect(await visible(), `${famille} : ne s’ouvre pas`).toBe(true);

      await page.click(bouton);
      await page.waitForTimeout(250);
      expect(await page.getAttribute(bouton, 'aria-expanded'), famille).toBe('false');
      // Le CONTENU disparaît…
      expect(await visible(), `${famille} : le contenu est resté`).toBe(false);
      // …et le titre RESTE : sinon il n'y a plus rien où re-cliquer.
      expect(await page.locator(bouton).count(), `${famille} : titre perdu`).toBe(1);

    }
  }, 400_000);

  it('S38.3 — les campagnes arrivent toutes pliées', async () => {
    await page.goto(`${BASE_URL}/campagnes`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-campaign-card]', { timeout: 90_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1_500);

    const etats = await page.$$eval('[data-campaign-card] [aria-expanded]', (ns) =>
      ns.map((n) => n.getAttribute('aria-expanded')),
    );
    expect(etats.length, 'aucune campagne dans le jeu de dev').toBeGreaterThan(0);
    // Aucune dépliée d'office — pas même la première de la page.
    expect(etats.filter((e) => e === 'true'), etats.join(' · ')).toHaveLength(0);

    // …et elles s'ouvrent toujours au clic.
    const entete = page.locator('[data-campaign-card] [aria-expanded="false"]').first();
    await entete.click();
    await page.waitForTimeout(500);
    expect(await entete.getAttribute('aria-expanded')).toBe('true');
  }, 300_000);

  it('S38.2 — les sections d’Aujourd’hui se replient sur leur titre', async () => {
    await page.goto(`${BASE_URL}/aujourdhui`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page-container]', { timeout: 90_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1_500);

    const cartes = (
      await page.$$eval('[data-today-card]', (ns) =>
        ns.map((n) => n.getAttribute('data-today-card')),
      )
    ).filter((id): id is string => id !== null);
    // Les cartes dépendent des données : on exige seulement qu'il y en ait,
    // et que chacune tienne sa promesse. Zéro carte = jeu de données vide,
    // et le test le DIT plutôt que de passer à vide.
    expect(
      cartes.length,
      'aucune carte sur Aujourd’hui — le jeu de données de dev n’a rien qui attend',
    ).toBeGreaterThan(0);

    for (const id of cartes) {
      const bouton = `[data-today-card="${id}"]`;
      const titre = await page.textContent(`${bouton} h2`);
      expect(titre?.trim(), `${id} : pas de titre`).toBeTruthy();

      // REPLIÉE à l'ouverture de l'application (22/09/2026).
      expect(await page.getAttribute(bouton, 'aria-expanded'), id).toBe('false');
      const panneau = await page.getAttribute(bouton, 'aria-controls');
      const visible = () =>
        page.evaluate((p) => !!document.getElementById(p), panneau!);
      expect(await visible(), `${id} : contenu visible avant le clic`).toBe(false);

      await page.click(bouton);
      await page.waitForTimeout(250);
      expect(await page.getAttribute(bouton, 'aria-expanded'), id).toBe('true');
      expect(await visible(), `${id} : ne s’ouvre pas`).toBe(true);

      await page.click(bouton);
      await page.waitForTimeout(250);
      expect(await page.getAttribute(bouton, 'aria-expanded'), id).toBe('false');
      expect(await visible(), `${id} : le contenu est resté`).toBe(false);
      // Repliée, la carte n'affiche QUE son titre — et c'est le même.
      expect((await page.textContent(`${bouton} h2`))?.trim(), id).toBe(titre?.trim());
    }
  }, 400_000);
});
