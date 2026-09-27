/**
 * Setup de la suite E2E — celle qui CLIQUE.
 *
 * ⚠️ RÈGLE DU CHANTIER (21/09/2026) : une action d'interface n'est livrée que
 * si un test l'a CLIQUÉE. Les tests de logique pure ne suffisent plus pour une
 * porte, un bouton ou un lien — ils lisent une chaîne de caractères, ils ne
 * voient pas ce que le navigateur en fait.
 *
 * DIFFÉRENCE AVEC LA RÉGRESSION (tests/regression/) :
 *   - là-bas : l'application est FERMÉE, les routes sont appelées en direct,
 *     le LLM et l'email sont bouchonnés ;
 *   - ici : l'application TOURNE (`npm run dev`), un vrai navigateur ouvre de
 *     vraies pages et clique de vrais liens. Rien n'est bouchonné — on ne peut
 *     pas bouchonner un navigateur depuis le processus de test.
 *
 * Conséquence : les deux suites ne se lancent pas ensemble. La régression
 * mesure des compteurs globaux qu'un serveur vivant décale.
 *
 * GARDE-FOU PROJET identique à la régression : la suite crée un recruteur de
 * test en base. Elle refuse de démarrer si `REGRESSION_PROJECT_REF` est absent
 * ou ne correspond pas au projet Supabase pointé. La prod n'a pas cette
 * variable : impossible de la viser par accident.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const allowedRef = process.env.REGRESSION_PROJECT_REF ?? '';
const actualRef = url ? new URL(url).hostname.split('.')[0] : '';

if (!allowedRef) {
  throw new Error(
    'Suite E2E REFUSÉE : REGRESSION_PROJECT_REF absent de .env.local. ' +
      'Ajoute REGRESSION_PROJECT_REF=<ref du projet Supabase DEV> pour autoriser ' +
      'explicitement cet environnement (jamais la prod).',
  );
}
if (!actualRef || actualRef !== allowedRef) {
  throw new Error(
    `Suite E2E REFUSÉE : le projet pointé (${actualRef || 'aucun'}) ` +
      `ne correspond pas à REGRESSION_PROJECT_REF (${allowedRef}).`,
  );
}

/** L'application que le navigateur va ouvrir. `npm run dev` sert 3001 ici. */
export const BASE_URL = (process.env.E2E_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
