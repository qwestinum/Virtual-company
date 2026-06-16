/**
 * Décomposition d'un titre en blocs (présélection Vivier — refonte titre déter.).
 *
 * Un titre composé (« Test Manager / QA Lead », « Comptable et Auditeur ») doit
 * matcher chaque rôle indépendamment. On le découpe en blocs sur des séparateurs
 * explicites, ET on conserve le titre complet comme candidat supplémentaire
 * (ceinture + bretelles).
 *
 * RÈGLE CRITIQUE — le tiret ne sépare QUE s'il est entouré d'espaces (« - » /
 * « – »). Un tiret collé fait partie du mot et ne découpe pas : « Sous-directeur »,
 * « Ingénieur-conseil », « QA-Lead » restent intacts. Les séparateurs ` et `,
 * ` - `, ` – ` embarquent leurs espaces, donc ne matchent que correctement
 * entourés. Pur et déterministe (séparateurs injectables depuis la config).
 */

/** Séparateurs par défaut. ` et `/` - `/` – ` portent leurs espaces (cf. règle tiret). */
export const DEFAULT_TITLE_SEPARATORS = [
  '/',
  '|',
  '&',
  ' et ',
  ' - ',
  ' – ',
] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Découpe `title` en blocs distincts puis renvoie [titre complet, ...blocs],
 * trimés, vides retirés, dédupliqués (insensible à la casse). Le titre complet
 * est toujours en tête. Titre vide ⇒ liste vide.
 *
 * Chaque bloc reste une UNITÉ (« Test Manager »), on ne descend jamais au mot
 * isolé (« test » + « manager ») — c'est ce découpage en mots qui ramenait du
 * bruit.
 */
export function splitTitleIntoBlocks(
  title: string,
  separators: readonly string[] = DEFAULT_TITLE_SEPARATORS,
): string[] {
  const full = title.trim();
  if (!full) return [];

  const re = new RegExp(separators.map(escapeRegExp).join('|'), 'g');
  const blocks = full
    .split(re)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [full, ...blocks]) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}
