/**
 * Helpers PURS de suggestion de variantes de mots-clés (Phase 3b). Testables
 * en env node. Le post-traitement serveur ET le composant les partagent.
 */

/** Cap dur de propositions retournées à l'utilisateur. */
export const MAX_SUGGESTED_VARIANTS = 15;

/**
 * Nettoie et déduplique les variantes proposées par le LLM : trim, retrait des
 * vides, dédup INSENSIBLE À LA CASSE vs `existing` ET inter-variantes, puis cap.
 * Préserve la casse et l'ordre d'apparition des propositions.
 */
export function dedupeVariants(
  suggested: string[],
  existing: string[],
  cap = MAX_SUGGESTED_VARIANTS,
): string[] {
  const seen = new Set(existing.map((k) => k.trim().toLowerCase()));
  const out: string[] = [];
  for (const raw of suggested) {
    const v = raw.trim();
    if (v.length === 0) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

/** Bascule la sélection d'une variante (ajoute / retire). PUR. */
export function toggleVariant(selected: string[], variant: string): string[] {
  return selected.includes(variant)
    ? selected.filter((v) => v !== variant)
    : [...selected, variant];
}
