/**
 * Gestes de l'assistant de création, pour S30.
 *
 * Tout passe par des repères STABLES (`data-field`, `data-source`,
 * `data-role="next"`, `data-step`) : compter des rangées reviendrait à faire
 * dépendre le test de l'ordre des champs, exactement ce qui bouge.
 */
import type { Page } from 'playwright-core';

import { BASE_URL } from '../setup';
import { attendreHydratation } from './browser';

export const ASSISTANT_URL = `${BASE_URL}/campagnes/nouvelle`;

/**
 * Ouvre l'assistant et n'en rend la main QUE quand React a repris la page.
 *
 * ⚠️ Attendre l'apparition d'un champ ne suffit pas : le HTML arrive avant
 * l'hydratation, et une saisie posée dans cette fenêtre est effacée par le
 * premier rendu contrôlé. Le défaut ne se voyait qu'en jouant S29 AVANT S30 —
 * le serveur alors chaud sert la page instantanément, et c'est l'hydratation
 * qui devient la lente. C'est la même leçon qu'à la connexion.
 */
export async function ouvrirAssistant(p: Page, url = ASSISTANT_URL): Promise<void> {
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.locator('[data-field="job_title"], [data-step]').first().waitFor({ timeout: 90_000 });
  const vivante = await attendreHydratation(p, '[data-role="next"]', 90_000);
  if (!vivante) {
    throw new Error(
      'Suite E2E : l’assistant n’a pas été repris par le navigateur — ' +
        'serveur de dev encore en compilation ?',
    );
  }
}

export const suivant = (p: Page) => p.locator('[data-role="next"]');
export const bandeEnregistrement = (p: Page) => p.locator('[data-saved]');
/**
 * ⚠️ `[data-role="blocked-reason"]` et NON `[role="status"]` : le bandeau de
 * notifications du workspace en porte un lui aussi, et « le premier de la
 * page » lisait donc le mauvais texte dès qu'une alerte s'affichait.
 */
export const raison = (p: Page) => p.locator('[data-role="blocked-reason"]');
export const etapeDuRail = (p: Page, step: string) => p.locator(`[data-step="${step}"]`);

/** L'étape affichée, lue sur le rail — jamais déduite d'un titre. */
export async function etapeCourante(p: Page): Promise<string | null> {
  return p.locator('[data-step][data-state="current"]').first().getAttribute('data-step');
}

async function champ(p: Page, key: string, valeur: string): Promise<void> {
  const bloc = p.locator(`[data-field="${key}"]`);
  await bloc.waitFor({ timeout: 30_000 });
  const select = bloc.locator('select');
  if ((await select.count()) > 0) {
    await select.selectOption(valeur);
    return;
  }
  const saisie = bloc.locator('input, textarea').first();
  await saisie.fill(valeur);
  // La normalisation des listes se fait au blur : sans ça, missions et
  // compétences resteraient « en cours de frappe ».
  await saisie.blur();
}

/** Remplit la fiche de poste en entier — c'est ce qu'exige l'étape « Le poste ». */
export async function remplirLePoste(p: Page, intitule: string): Promise<void> {
  await champ(p, 'job_title', intitule);
  await champ(p, 'seniority', 'confirmé');
  await p.locator('[data-field="contract_type"] button', { hasText: 'CDI' }).first().click();
  await champ(p, 'location', 'Paris (hybride)');
  await champ(p, 'salary_range', '45 – 55 k€');
  await champ(p, 'start_date', 'janvier 2027');
  await champ(p, 'main_missions', 'Concevoir les services de l’API');
  await champ(p, 'key_skills', 'Node.js');
}

/** Clique « Suivant » et attend que le rail ait réellement changé d'étape. */
export async function cliquerSuivant(p: Page, attendue: string): Promise<void> {
  await suivant(p).click();
  await p.waitForFunction(
    (step) =>
      document.querySelector('[data-step][data-state="current"]')?.getAttribute('data-step') === step,
    attendue,
    { timeout: 60_000 },
  );
}
