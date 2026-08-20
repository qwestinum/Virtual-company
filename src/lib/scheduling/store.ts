/**
 * Accès base bas niveau, partagé par les modules fonctionnels.
 *
 * Deux services rendus ici :
 *
 *  1. Traduire une erreur PostgREST en `SchedulingStoreError` typée, en
 *     CONSERVANT le code Postgres : un 23505 est une course perdue attendue
 *     (le claim de créneau), pas une panne — les appelants en dépendent.
 *
 *  2. Paginer par KEYSET. PostgREST plafonne silencieusement à 1000 lignes
 *     toute requête sans fenêtre : une liste tronquée produirait des créneaux
 *     offerts alors qu'ils sont déjà pris. Le curseur est une clé UNIQUE et
 *     STABLE (id, token, external_ref — jamais un horodatage), donc une
 *     insertion concurrente ne décale ni ne duplique aucune page.
 */
import type { PostgrestError } from '@supabase/supabase-js';

import { SchedulingStoreError } from './errors';
import { db } from './runtime';

const PAGE_SIZE = 500;

export function table(name: string) {
  return db().from(name);
}

/** Réponse minimale commune à toutes les requêtes PostgREST. */
type QueryResult = { data: unknown; error: PostgrestError | null };

/** Lève une erreur typée si la requête a échoué. */
export function assertOk(
  operation: string,
  error: PostgrestError | null,
): asserts error is null {
  if (error) throw new SchedulingStoreError(operation, error.message, error.code);
}

/**
 * Rapatrie TOUTES les lignes. `build(afterCursor, limit)` doit ordonner par la
 * colonne curseur en ordre croissant et ne rendre que les lignes strictement
 * au-delà du curseur. `cursorOf` extrait cette valeur de la dernière ligne.
 */
export async function fetchAllKeyset<T>(
  operation: string,
  build: (afterCursor: string | null, limit: number) => PromiseLike<QueryResult>,
  cursorOf: (row: T) => string,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;

  for (;;) {
    const { data, error } = await build(cursor, PAGE_SIZE);
    assertOk(operation, error);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;

    const next = cursorOf(rows[rows.length - 1] as T);
    if (cursor !== null && next <= cursor) {
      // Curseur non strictement croissant : impossible sur une clé unique
      // ordonnée, mais on refuse de boucler sans fin.
      return all;
    }
    cursor = next;
  }
}

/** Découpe un tableau en lots — borne la taille de retour des requêtes `in()`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
