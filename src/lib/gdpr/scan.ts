/**
 * Parcours EXHAUSTIFS pour la purge RGPD.
 *
 * PostgREST plafonne silencieusement à 1000 lignes toute requête sans borne
 * (cf. `src/lib/db/paginate.ts`). Un effacement qui raterait la 1001ᵉ ligne
 * serait pire qu'un effacement raté : il se déclarerait complet. On pagine donc
 * par KEYSET partout, avec deux variantes selon le type de clé — le curseur du
 * journal est un ENTIER, et le comparer comme une chaîne ferait s'arrêter la
 * pagination après « 10 » (car « 10 » < « 9 » en ordre lexical).
 *
 * Les filtres sont DÉCLARATIFS (`Filter[]`) plutôt qu'une closure sur le
 * constructeur de requête : le typage de ce constructeur ne se transporte pas
 * d'un appelant à l'autre sans `any`, et le projet n'en veut pas.
 *
 * Ces helpers prennent le client en ARGUMENT : la purge tourne depuis un script
 * avec un environnement explicite (`--env`), jamais sur le client global du
 * serveur — dont la configuration est figée au démarrage du processus.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE = 1000;

/** Une table absente = migration pas encore passée ici. Seul cas toléré. */
const MISSING_TABLE = new Set(['42P01', 'PGRST205']);

export function isMissingTable(err: { code?: string } | null | undefined): boolean {
  return !!err?.code && MISSING_TABLE.has(err.code);
}

export type Filter =
  | { op: 'eq'; col: string; value: string | number | boolean }
  | { op: 'in'; col: string; values: (string | number)[] }
  | { op: 'ilike'; col: string; value: string }
  | { op: 'isNull'; col: string }
  | { op: 'notNull'; col: string };

/**
 * Toutes les lignes d'une table, curseur sur une clé TEXTE (uuid, id applicatif).
 * Renvoie `[]` si la table n'existe pas ici — jamais une exception : un
 * environnement en retard d'une migration ne doit pas bloquer un effacement.
 *
 * Un filtre `in` sur une liste VIDE ne renvoie rien : on court-circuite, sinon
 * PostgREST reçoit `in.()` et rend une erreur de syntaxe.
 */
export async function pageAllByText<Row extends Record<string, unknown>>(
  db: SupabaseClient,
  table: string,
  select: string,
  cursorCol: string,
  filters: Filter[] = [],
  /**
   * Borne FACULTATIVE. Elle n'existe que pour les signaux qu'on affiche sans
   * les traiter (les homonymes probables du contrôle) : un effacement, lui,
   * ne se borne jamais — c'est la raison d'être de ce module. L'appelant qui
   * s'en sert DOIT dire à l'opérateur que sa liste est tronquée.
   */
  maxRows?: number,
): Promise<Row[]> {
  if (hasEmptyIn(filters)) return [];
  const out: Row[] = [];
  let after: string | null = null;
  for (;;) {
    let q = db.from(table).select(select).order(cursorCol, { ascending: true }).limit(PAGE);
    // Chaînage EN PLACE : `.eq()` & co. rendent le même type de constructeur,
    // ce qu'une fonction d'application générique ne sait pas exprimer sans
    // `any` — et le projet n'en veut pas.
    for (const f of filters) {
      if (f.op === 'eq') q = q.eq(f.col, f.value);
      else if (f.op === 'in') q = q.in(f.col, f.values);
      else if (f.op === 'ilike') q = q.ilike(f.col, f.value);
      else if (f.op === 'isNull') q = q.is(f.col, null);
      else q = q.not(f.col, 'is', null);
    }
    if (after !== null) q = q.gt(cursorCol, after);
    const { data, error } = await q;
    if (error) {
      if (isMissingTable(error)) return out;
      throw new Error(`purge/scan ${table}: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (maxRows !== undefined && out.length >= maxRows) return out.slice(0, maxRows);
    if (rows.length < PAGE) break;
    const next = String(rows[rows.length - 1]![cursorCol]);
    if (after !== null && next <= after) break; // fail-safe anti-boucle
    after = next;
  }
  return out;
}

/** Idem, curseur ENTIER (le journal). La comparaison est numérique. */
export async function pageAllByNumber<Row extends Record<string, unknown>>(
  db: SupabaseClient,
  table: string,
  select: string,
  cursorCol: string,
  filters: Filter[] = [],
): Promise<Row[]> {
  if (hasEmptyIn(filters)) return [];
  const out: Row[] = [];
  let after: number | null = null;
  for (;;) {
    let q = db.from(table).select(select).order(cursorCol, { ascending: true }).limit(PAGE);
    // Chaînage EN PLACE : `.eq()` & co. rendent le même type de constructeur,
    // ce qu'une fonction d'application générique ne sait pas exprimer sans
    // `any` — et le projet n'en veut pas.
    for (const f of filters) {
      if (f.op === 'eq') q = q.eq(f.col, f.value);
      else if (f.op === 'in') q = q.in(f.col, f.values);
      else if (f.op === 'ilike') q = q.ilike(f.col, f.value);
      else if (f.op === 'isNull') q = q.is(f.col, null);
      else q = q.not(f.col, 'is', null);
    }
    if (after !== null) q = q.gt(cursorCol, after);
    const { data, error } = await q;
    if (error) {
      if (isMissingTable(error)) return out;
      throw new Error(`purge/scan ${table}: ${error.message}`);
    }
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    const next = Number(rows[rows.length - 1]![cursorCol]);
    if (!Number.isFinite(next) || (after !== null && next <= after)) break;
    after = next;
  }
  return out;
}

function hasEmptyIn(filters: Filter[]): boolean {
  return filters.some((f) => f.op === 'in' && f.values.length === 0);
}

/**
 * Échappe les métacaractères `LIKE` d'une valeur cherchée en `ilike`. Une
 * adresse contenant `_` (courant) matcherait sinon n'importe quel caractère —
 * et une purge qui élargit sa cible toute seule est exactement ce qu'on ne
 * veut pas.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (c) => `\\${c}`);
}

/**
 * Liste RÉCURSIVE d'un préfixe du stockage. L'API `list` ne rend qu'un niveau
 * et marque les dossiers par un `id` nul — d'où la descente manuelle.
 *
 * `maxEntries` borne le parcours : sur un bucket où plus de mille dossiers de
 * campagne subsistent sans métadonnées (mesuré le 02/09/2026), un balayage non
 * borné bloquerait la commande. Atteindre la borne est SIGNALÉ à l'appelant,
 * jamais silencieux — un inventaire tronqué qui se tait est précisément le
 * défaut que cette purge existe pour éviter.
 */
export async function listStorageRecursive(
  db: SupabaseClient,
  bucket: string,
  prefix: string,
  maxEntries = 5000,
): Promise<{ paths: string[]; truncated: boolean }> {
  const paths: string[] = [];
  const queue: string[] = [prefix];

  while (queue.length > 0) {
    const dir = queue.shift()!;
    let offset = 0;
    for (;;) {
      const { data, error } = await db.storage
        .from(bucket)
        .list(dir, { limit: 100, offset });
      if (error) break; // dossier absent / inaccessible : rien à purger ici
      const entries = data ?? [];
      for (const e of entries) {
        const full = dir ? `${dir}/${e.name}` : e.name;
        if (e.id === null) queue.push(full);
        else paths.push(full);
      }
      if (paths.length >= maxEntries) return { paths, truncated: true };
      if (entries.length < 100) break;
      offset += 100;
    }
  }
  return { paths, truncated: false };
}
