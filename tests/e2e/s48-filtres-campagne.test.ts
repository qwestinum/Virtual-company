/**
 * S48 — FILTRES DE CAMPAGNE : UNE LIGNE, CUMULATIFS, LISIBLES
 * (fix/vivier-replanif-filtres, point 3).
 *
 *   1. Sur Candidatures, Entretiens et Aujourd'hui, le périmètre (référent) et
 *      l'ÉTAT de campagne sont côte à côte, sur UNE rangée, dans cet ordre,
 *      suivis du libellé de ce qui est filtré. Sur Campagnes, l'état garde ses
 *      PUCES À POINT (retour du donneur d'ordre, 28/09) — même état partagé.
 *   2. Choisis sur un écran, ils sont RETROUVÉS sur les autres (un seul état,
 *      mémorisé par recruteur) — en naviguant, pas en rechargeant.
 *   3. Le libellé dit la combinaison (« … · suspendues (n …) »).
 */
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BASE_URL } from './setup';
import { assertAppIsUp, attendreHydratation, launchBrowser, signIn } from './helpers/browser';
import { createTestRecruiter, deleteTestRecruiter, type TestRecruiter } from './helpers/session';

const ECRANS = ['/campagnes', '/candidatures', '/entretiens', '/aujourdhui'];
const REFERENT = '[data-toolbar-select="referent"]';
const ETAT = '[data-toolbar-select="campaign-state"]';

let browser: Browser;
let page: Page;
let recruiter: TestRecruiter;

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

const PUCES = '[role="tablist"][aria-label="Filtrer les campagnes par statut"]';

/** L'état affiché : la puce active sur Campagnes, le sélecteur ailleurs. */
async function etatAffiche(chemin: string): Promise<string | null> {
  if (chemin === '/campagnes') {
    return page.$eval(`${PUCES} [aria-selected="true"]`, (e) => e.getAttribute('data-dot-tab'));
  }
  return page.$eval(ETAT, (e) => (e as HTMLSelectElement).value);
}

async function ouvrir(chemin: string): Promise<void> {
  await page.goto(`${BASE_URL}${chemin}`, { waitUntil: 'domcontentloaded' });
  const control = chemin === '/campagnes' ? PUCES : ETAT;
  await page.waitForSelector(control, { timeout: 90_000 });
  await attendreHydratation(page, control);
  // Les référents arrivent APRÈS l'état (contexte chargé en différé).
  await page
    .waitForFunction(
      (sel) => ((document.querySelector(sel) as HTMLSelectElement | null)?.options.length ?? 0) > 1,
      REFERENT,
      { timeout: 30_000 },
    )
    .catch(() => {});
}

describe('S48 — périmètre et état : une barre, un état partagé', () => {
  let referentChoisi = '';

  it('S48.1 — sur Candidatures : choisir un référent et « Suspendues »', async () => {
    await ouvrir('/candidatures');
    const options = await page.$$eval(`${REFERENT} option`, (os) =>
      os.map((o) => (o as HTMLOptionElement).value),
    );
    // Un référent RÉEL du dev (pas « Tous ») : le filtre doit restreindre.
    referentChoisi = options.find((v) => v.startsWith('recruiter:')) ?? options[0]!;
    await page.selectOption(REFERENT, referentChoisi);
    await page.selectOption(ETAT, 'paused');
    await expect
      .poll(() => page.textContent('[data-role="filter-result"]'), { timeout: 10_000 })
      .toMatch(/· suspendues \(\d+ /);
  }, 300_000);

  it.each(ECRANS)('S48.2 — %s : les deux filtres retrouvés', async (chemin) => {
    await ouvrir(chemin);
    await expect.poll(() => etatAffiche(chemin), { timeout: 10_000 }).toBe('paused');
    if ((await page.locator(REFERENT).count()) > 0) {
      expect(await page.$eval(REFERENT, (e) => (e as HTMLSelectElement).value)).toBe(referentChoisi);
      if (chemin !== '/campagnes') {
        const [r, s] = await Promise.all([
          page.locator(REFERENT).boundingBox(),
          page.locator(ETAT).boundingBox(),
        ]);
        // Même rangée, et l'état APRÈS le périmètre.
        expect(Math.abs(r!.y - s!.y), `${chemin} : deux rangées`).toBeLessThan(4);
        expect(s!.x).toBeGreaterThan(r!.x);
      }
    }
    expect(await page.textContent('[data-role="filter-result"]')).toMatch(/· suspendues \(/);
  }, 300_000);

  it('S48.2 bis — sur Campagnes, la puce « Actives » repose l’état pour tous les écrans', async () => {
    await ouvrir('/campagnes');
    await page.click(`${PUCES} [data-dot-tab="active"]`);
    await ouvrir('/candidatures');
    expect(await etatAffiche('/candidatures')).toBe('active');
    await page.selectOption(ETAT, 'paused');
    await expect.poll(() => page.textContent('[data-role="filter-result"]')).toMatch(/· suspendues \(/);
  }, 300_000);

  it('S48.3 — « Réinitialiser » rend « Tous » et « Actives », partout', async () => {
    await ouvrir('/candidatures');
    await page.getByRole('button', { name: 'Réinitialiser' }).first().click();
    await expect.poll(() => etatAffiche('/candidatures')).toBe('active');
    await ouvrir('/campagnes');
    expect(await etatAffiche('/campagnes')).toBe('active');
  }, 300_000);
});
