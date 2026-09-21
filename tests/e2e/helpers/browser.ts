/**
 * Le navigateur de la suite E2E, et la seule façon de s'y connecter.
 *
 * ⚠️ On passe par le VRAI formulaire de connexion (`/login`), pas par une
 * injection de cookie. Poser un cookie de session à la main teste la fabrique
 * de cookies, pas le produit — et le jour où le chemin d'authentification
 * casse, une suite qui l'a contourné reste verte.
 */
import { chromium, type Browser, type Page } from 'playwright-core';

import { BASE_URL } from '../setup';
import type { TestRecruiter } from './session';

/**
 * Chromium à utiliser. `E2E_CHROME_PATH` l'emporte (poste sans dépendances
 * système complètes, binaire d'une autre révision) ; sinon celui que
 * playwright-core a installé.
 */
function executablePath(): string | undefined {
  return process.env.E2E_CHROME_PATH || undefined;
}

export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ executablePath: executablePath() });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      'Suite E2E : impossible de lancer Chromium. Installe-le avec ' +
        '`npx playwright-core install chromium` (et `install-deps` sur une ' +
        'machine nue), ou désigne un binaire avec E2E_CHROME_PATH.\n' +
        detail,
    );
  }
}

/** Vérifie que `npm run dev` répond AVANT de lancer quoi que ce soit. */
export async function assertAppIsUp(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/login`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`statut ${res.status}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Suite E2E : l'application ne répond pas sur ${BASE_URL}. ` +
        'Lance `npm run dev` avant (et E2E_BASE_URL si le port diffère).\n' +
        detail,
    );
  }
}

/** Ouvre une page déjà connectée, par le formulaire réel. */
export async function signIn(browser: Browser, recruiter: TestRecruiter): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: 30_000 });

  // ⚠️ La saisie doit survivre à l'HYDRATATION. Un `fill` posé avant que React
  // ait repris la page est écrasé par le premier rendu contrôlé : les champs
  // redeviennent vides et le bouton reste désactivé — 30 s d'attente pour un
  // clic qui n'arrivera jamais. On saisit, et on ne clique que quand le bouton
  // s'active RÉELLEMENT, en resaisissant tant qu'il ne s'active pas.
  const submit = page.locator('button[type="submit"]');
  const deadline = Date.now() + 30_000;
  for (;;) {
    await page.fill('#email', recruiter.email);
    await page.fill('#password', recruiter.password);
    if (await submit.isEnabled()) break;
    if (Date.now() > deadline) {
      throw new Error('Suite E2E : le bouton « Se connecter » ne s’active pas (page hydratée ?).');
    }
    await page.waitForTimeout(250);
  }
  await submit.click();

  // La connexion aboutit quand on n'est plus sur /login. Une erreur d'auth
  // s'affiche en `role="alert"` : on la NOMME plutôt que d'attendre en vain.
  const sortie = page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  const echec = page
    .waitForSelector('form [role="alert"]', { timeout: 30_000 })
    .then(async (el) => {
      throw new Error(`Suite E2E : connexion refusée — ${(await el.textContent())?.trim()}`);
    });
  await Promise.race([sortie, echec]);

  return page;
}
