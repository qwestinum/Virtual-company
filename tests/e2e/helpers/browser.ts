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
 * Budget d'HYDRATATION — le temps laissé au navigateur pour que React reprenne
 * la page. Il est large EXPRÈS : sur un `next dev` qui démarre à froid, la
 * première compilation du bundle client de `/login` se compte en dizaines de
 * secondes. Ce n'est pas une marge de confort, c'est la durée réelle d'un
 * premier passage — et un budget trop court transforme un serveur lent en
 * « la connexion ne marche pas ».
 */
const HYDRATATION_MS = 150_000;
/** Une fois la page vivante, la saisie est affaire de millisecondes. */
const SAISIE_MS = 20_000;

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

/**
 * Vérifie que `npm run dev` répond AVANT de lancer quoi que ce soit — et
 * DÉCLENCHE au passage la compilation serveur de `/login`, pour que le
 * navigateur n'ait plus qu'à attendre le bundle client.
 */
export async function assertAppIsUp(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/login`, { signal: AbortSignal.timeout(120_000) });
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

/**
 * La page est-elle REPRISE par React ?
 *
 * On ne devine pas avec un délai : à l'hydratation, React accroche ses propres
 * clés (`__reactFiber$…`, `__reactProps$…`) sur le nœud du DOM. Tant qu'elles
 * sont absentes, le formulaire n'est qu'un squelette HTML — une saisie y est
 * écrasée par le premier rendu contrôlé.
 */
export async function attendreHydratation(
  page: Page,
  selector = '#email',
  timeout = HYDRATATION_MS,
): Promise<boolean> {
  return page
    .waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return !!el && Object.keys(el).some((k) => k.startsWith('__react'));
      },
      selector,
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}

/** Ouvre une page déjà connectée, par le formulaire réel. */
export async function signIn(browser: Browser, recruiter: TestRecruiter): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email', { timeout: HYDRATATION_MS });
  const vivante = await attendreHydratation(page, '#email');

  // On resaisit tant que le bouton ne s'active pas : même hydratée, la page
  // peut avoir avalé une saisie posée une frame trop tôt.
  const submit = page.locator('button[type="submit"]');
  const fin = Date.now() + SAISIE_MS;
  for (;;) {
    await page.fill('#email', recruiter.email);
    await page.fill('#password', recruiter.password);
    if (await submit.isEnabled()) break;
    if (Date.now() > fin) {
      // Deux causes, deux messages : confondre « l'application n'était pas
      // prête » et « le formulaire a changé » enverrait chercher au mauvais
      // endroit.
      throw new Error(
        vivante
          ? 'Suite E2E : les champs sont remplis et « Se connecter » reste désactivé. ' +
            'Le formulaire de connexion a-t-il changé (identifiants des champs, ' +
            'condition du bouton) ?'
          : `Suite E2E : /login n'a pas été reprise par le navigateur en ${Math.round(HYDRATATION_MS / 1000)} s. ` +
            'C\'est le symptôme d\'un serveur de dev qui compile à froid : ouvre ' +
            `${BASE_URL}/login une fois dans ton navigateur, attends l'affichage, puis relance ` +
            '`npm run test:e2e`.',
      );
    }
    await page.waitForTimeout(250);
  }
  await submit.click();

  // La connexion aboutit quand on n'est plus sur /login. Une erreur d'auth
  // s'affiche en `role="alert"` : on la NOMME plutôt que d'attendre en vain.
  const sortie = page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
  const echec = page
    .waitForSelector('form [role="alert"]', { timeout: 60_000 })
    .then(async (el) => {
      throw new Error(`Suite E2E : connexion refusée — ${(await el.textContent())?.trim()}`);
    });
  await Promise.race([sortie, echec]);

  return page;
}
