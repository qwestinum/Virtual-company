/**
 * S42 — BUGS DU 22/09/2026 : panneau de candidature et fenêtre d'approche.
 *
 * CANDIDATURES
 *   1. Le panneau de détail se REFERME quand on change d'onglet d'étape — il
 *      restait ouvert sur un dossier absent de la nouvelle liste.
 *   2. Sur un dossier « Entretien fait », les boutons de décision sont
 *      ATTEIGNABLES : le panneau, haut de `100vh − 150px` quelle que soit sa
 *      position, débordait sous le pied de page (bouton « Retenu » mesuré à
 *      905 px pour une zone visible arrêtée à 826).
 *   3. Plus de mention « S'il est rédigé, ce commentaire… » sous le champ.
 *
 * SOURCING — la rédaction du message passe par le modèle et prend du temps.
 * La route est INTERCEPTÉE avec 2 s de latence : on teste ce que l'écran fait
 * PENDANT l'attente, sans appel au modèle ni approche réelle en base.
 *   4. La fenêtre s'ouvre AU CLIC et dit qu'elle rédige.
 *   5. Elle est CENTRÉE, et le fond est flouté.
 *   6. Changer de format ne la ferme PAS : le nouveau format est coché tout
 *      de suite, puis le message arrive.
 */
import type { Browser, Page, Route } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import { assertAppIsUp, attendreHydratation, launchBrowser, signIn } from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

const LATENCE = 2_000;

describe('S42 — panneau de candidature et fenêtre d’approche', () => {
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

  it('S42.1 — Entretien fait : décision atteignable, sans mention ; le panneau se referme au changement d’onglet', async () => {
    await page.goto(`${BASE_URL}/candidatures`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-dot-tab="entretien_fait"]', { timeout: 90_000 });
    await attendreHydratation(page, '[data-dot-tab="entretien_fait"]');
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.click('[data-dot-tab="entretien_fait"]');
    await page.waitForTimeout(2_000);
    expect(
      await page.locator('[data-candidature-row]').count(),
      'aucune candidature « Entretien fait » dans le jeu de dev',
    ).toBeGreaterThan(0);

    await page.click('[data-candidature-row]');
    await page.waitForSelector('[data-candidature-panel] button:has-text("Retenu")', {
      timeout: 30_000,
      state: 'attached',
    });
    await page.waitForTimeout(1_000);

    // Le contenu du panneau défilé jusqu'au bout : le bouton doit être DANS
    // la zone visible de la page, pas sous le pied de page.
    const mesure = await page.evaluate(() => {
      const col = document.querySelector('[data-candidature-panel-column]')!;
      const defile = [...col.querySelectorAll<HTMLElement>('*')].find(
        (e) => e.scrollHeight > e.clientHeight + 5,
      );
      if (defile) defile.scrollTop = defile.scrollHeight;
      let zone: HTMLElement | null = col.parentElement;
      while (zone && !['auto', 'scroll'].includes(getComputedStyle(zone).overflowY)) {
        zone = zone.parentElement;
      }
      const bouton = [...col.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Retenu',
      )!;
      return {
        basBouton: Math.round(bouton.getBoundingClientRect().bottom),
        basZone: Math.round(zone ? zone.getBoundingClientRect().bottom : innerHeight),
      };
    });
    expect(mesure.basBouton, JSON.stringify(mesure)).toBeLessThanOrEqual(mesure.basZone);

    const texte = (await page.textContent('[data-candidature-panel]')) ?? '';
    expect(texte).not.toContain('S’il est rédigé');
    expect(texte).not.toContain('droit d’accès');

    await page.click('[data-dot-tab="invite"]');
    await page.waitForSelector('[data-candidature-panel]', { state: 'detached', timeout: 10_000 });
  }, 300_000);

  it('S42.2 — Sourcing : la fenêtre s’ouvre au clic, centrée et floutée, et survit au changement de format', async () => {
    const formats: string[] = [];
    await page.route('**/api/sourcing/profiles/*/approaches', async (route: Route) => {
      const corps = (route.request().postDataJSON() ?? {}) as { format?: string };
      const format = corps.format ?? 'connection_note';
      formats.push(format);
      await new Promise((r) => setTimeout(r, LATENCE));
      const url = 'https://orqa.exemple.fr/s/JetonDeTest';
      await route.fulfill({
        json: {
          approachId: `app_test_${formats.length}`,
          channel: 'linkedin',
          format,
          limit: format === 'inmail' ? 1900 : 300,
          url,
          profileUrl: 'https://www.linkedin.com/in/test',
          subject: null,
          message: `Message ${format} ${url}`,
          mailto: null,
          email: null,
        },
      });
    });
    await page.route('**/api/sourcing/approaches/*', (route: Route) => route.fulfill({ json: { ok: true } }));
    await page.route('**/api/sourcing/preferences', (route: Route) => route.fulfill({ json: { ok: true } }));

    await page.goto(`${BASE_URL}/sourcing`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-sourcing-action]', { timeout: 90_000 });
    await attendreHydratation(page, '[data-sourcing-action]');
    const detail = page.locator('[data-sourcing-action]', { hasText: 'Détail' }).first();
    expect(await detail.count(), 'aucune campagne sourcée dans le jeu de dev').toBe(1);
    await detail.click();
    const connecter = page.locator('[data-profile-row] button', { hasText: 'Se connecter' }).first();
    await connecter.waitFor({ timeout: 60_000 });
    await attendreHydratation(page, '[data-profile-row] button');

    const t0 = Date.now();
    await connecter.click();
    // 4. La fenêtre est là AVANT la réponse du serveur, et dit qu'elle rédige.
    await page.waitForSelector('[data-approach-preparing]', { timeout: LATENCE - 500 });
    expect(Date.now() - t0, 'la fenêtre a attendu la rédaction').toBeLessThan(LATENCE);

    // 5. Centrée, fond flouté.
    const geo = await page.evaluate(() => {
      const d = document.querySelector('[data-approach-dialog]')!.getBoundingClientRect();
      const fond = getComputedStyle(document.querySelector('[data-approach-backdrop]')!);
      return {
        dx: Math.abs(d.left + d.width / 2 - innerWidth / 2),
        dy: Math.abs(d.top + d.height / 2 - innerHeight / 2),
        flou: fond.backdropFilter,
      };
    });
    expect(geo.dx, JSON.stringify(geo)).toBeLessThanOrEqual(2);
    expect(geo.dy, JSON.stringify(geo)).toBeLessThanOrEqual(2);
    expect(geo.flou, JSON.stringify(geo)).toContain('blur');

    // Le message arrive.
    await page.waitForSelector('[data-approach-dialog] textarea', { timeout: LATENCE * 3 });
    expect(await page.inputValue('[data-approach-dialog] textarea')).toContain('connection_note');

    // 6. Changer de format : la fenêtre RESTE, InMail est coché tout de suite.
    await page.click('[data-approach-format="inmail"]');
    await page.waitForTimeout(150);
    expect(await page.locator('[data-approach-dialog]').count()).toBe(1);
    expect(await page.isChecked('[data-approach-format="inmail"]')).toBe(true);
    expect(await page.locator('[data-approach-redrafting]').count()).toBe(1);
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-approach-dialog] textarea') as HTMLTextAreaElement | null)
          ?.value.includes('inmail') ?? false,
      undefined,
      { timeout: LATENCE * 3 },
    );
    expect(await page.locator('[data-approach-redrafting]').count()).toBe(0);
    expect(formats).toEqual(['connection_note', 'inmail']);

    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-approach-dialog]', { state: 'detached', timeout: 5_000 });
  }, 300_000);
});
