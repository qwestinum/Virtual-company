/**
 * Helpers PURS de saisie des champs LISTE (missions/compétences) de l'éditeur
 * FDP. Extraits de `FDPInlineEditor` pour le garder sous 200 lignes. Aucune
 * dépendance React/DOM — testables unitairement.
 */

/** Valeur d'un champ liste (missions/compétences) → texte du textarea. */
export function listValueToText(value: unknown): string {
  return Array.isArray(value)
    ? value.join('\n')
    : typeof value === 'string'
      ? value
      : '';
}

/**
 * Frappe : conserve le texte BRUT (lignes non trimées, vides incluses). Garantit
 * `listValueToText(parseListInputRaw(t)) === t` pour tout `t` non vide — c'est ce
 * round-trip exact qui empêche le curseur de sauter en fin de paragraphe.
 */
export function parseListInputRaw(text: string): string[] | undefined {
  return text.trim().length === 0 ? undefined : text.split('\n');
}

/** Blur : normalise (trim de chaque ligne + suppression des lignes vides). */
export function normalizeListInput(text: string): string[] | undefined {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.length === 0 ? undefined : lines;
}
