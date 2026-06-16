/**
 * Compétences ATTENDUES côté fiche de poste (présélection Vivier — Chantier 3).
 *
 * Source V1 : le champ FDP `key_skills` (« Compétences clés »), atomisé de façon
 * DÉTERMINISTE (pas d'appel LLM côté poste) en items unitaires, dans le même
 * registre que les compétences extraites du CV. Découpe les énumérations,
 * normalise, déduplique. Poids égal en V1 (criticité = V2, hors scope).
 *
 * Pur et testé. La valeur du champ peut être une chaîne libre OU un tableau
 * (selon la saisie) — les deux sont gérés.
 */

/** Séparateurs d'énumération côté saisie humaine (distincts des séparateurs de titre). */
const SKILL_SEPARATORS = /[,;\n/•·|]| et /g;

/** Longueur minimale d'un item retenu (évite le bruit « , » → « »). */
const MIN_SKILL_LEN = 2;

function atomizeOne(raw: string): string[] {
  return raw
    .split(SKILL_SEPARATORS)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SKILL_LEN);
}

/**
 * Atomise la valeur d'un champ `key_skills` (string ou string[]) en compétences
 * unitaires dédupliquées (insensible à la casse, ordre préservé). Valeur
 * absente / vide ⇒ liste vide (aucune attente ⇒ aucun signal compétences).
 */
export function atomizeJobSkills(value: unknown): string[] {
  const rawItems: string[] = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string'
      ? [value]
      : [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawItems) {
    for (const item of atomizeOne(raw)) {
      const key = item.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}
