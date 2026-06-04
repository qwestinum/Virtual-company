/**
 * Garde DÉTERMINISTE sur la SORTIE du LLM (Inc. 2b).
 *
 * Le Manager LLM ne possède pas le flux : il propose du CONTENU de FDP.
 * Sa sortie n'est jamais appliquée telle quelle — elle passe par cette
 * fonction pure qui :
 *   - ne garde QUE les 8 clés de la liste fermée (toute autre clé est
 *     ignorée, jamais propagée) ;
 *   - impose le TYPE attendu (champs liste = tableaux de strings non
 *     vides ; champs scalaires = strings non vides ; un nombre est
 *     toléré et converti) ;
 *   - trim et écarte les valeurs vides.
 *
 * Conséquence : aucune extraction malformée ou hors-périmètre ne peut
 * entrer dans la FDP, quel que soit le comportement du modèle.
 */

import { FIELD_KEYS, type FieldKey } from '@/types/field-collection';

const ARRAY_FIELDS: ReadonlySet<FieldKey> = new Set([
  'main_missions',
  'key_skills',
]);

function cleanStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return items.length > 0 ? items : null;
}

function cleanScalar(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/**
 * Assainit les `fieldExtractions` proposées par le LLM. Renvoie un objet
 * ne contenant que des champs valides, typés et non vides. Total : ne lève
 * jamais, accepte n'importe quelle entrée (y compris null/non-objet).
 */
export function sanitizeFieldExtractions(
  raw: unknown,
): Partial<Record<FieldKey, unknown>> {
  if (raw === null || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const out: Partial<Record<FieldKey, unknown>> = {};
  for (const key of FIELD_KEYS) {
    if (!(key in source)) continue;
    const value = source[key];
    if (ARRAY_FIELDS.has(key)) {
      const arr = cleanStringArray(value);
      if (arr) out[key] = arr;
    } else {
      const scalar = cleanScalar(value);
      if (scalar !== null) out[key] = scalar;
    }
  }
  return out;
}
