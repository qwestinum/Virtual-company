/**
 * Helpers PURS de saisie de mots-clés (UI de cadrage hybride, Phase 2).
 * Testables en env node, sans jsdom. Le composant `KeywordsInput` les consomme.
 */

/** Découpe une saisie libre (lignes / virgules) en mots-clés nettoyés non vides. */
export function parseKeywords(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Ajoute une saisie (potentiellement multiple) à la liste existante, en
 * ignorant les blancs et les doublons (insensibles à la casse). Préserve
 * l'ordre et la casse d'origine de l'existant.
 */
export function addKeywords(existing: string[], raw: string): string[] {
  const out = [...existing];
  const seen = new Set(existing.map((k) => k.toLowerCase()));
  for (const k of parseKeywords(raw)) {
    const key = k.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(k);
    }
  }
  return out;
}

/** Retire un mot-clé par index (no-op si hors borne). */
export function removeKeywordAt(keywords: string[], index: number): string[] {
  if (index < 0 || index >= keywords.length) return keywords;
  return keywords.filter((_, i) => i !== index);
}
