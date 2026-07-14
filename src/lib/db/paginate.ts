/**
 * Pagination KEYSET exhaustive (correctif audit C8 — troncatures silencieuses).
 *
 * Problème : PostgREST plafonne SILENCIEUSEMENT à 1000 lignes toute requête
 * sans `.range()`/`.limit()`. Des listes « maîtres » (univers de la
 * présélection vivier, exclusions, reindex) étaient donc tronquées et
 * présentées comme complètes — vivier aveugle au-delà de 1000.
 *
 * Pourquoi KEYSET (curseur sur la PK) plutôt qu'OFFSET :
 *   - EXHAUSTIVITÉ GARANTIE aux frontières de page : le curseur est une clé
 *     UNIQUE et STABLE (l'`id`, jamais un timestamp — deux lignes peuvent
 *     partager un instant, jamais un id). Une insertion/suppression pendant la
 *     pagination ne décale donc ni ne duplique aucune page, contrairement à
 *     l'offset qui glisse.
 *   - PERF À L'ÉCHELLE : chaque page est un *index range scan* (`id > cursor`
 *     = seek dans l'index PK), O(log n) par page — l'offset re-scanne depuis 0
 *     à chaque `range(offset, …)`, O(n·pages). Le vivier a vocation à grossir
 *     (c'est le moat) ⇒ on paie la complexité une fois, ça ne se re-casse plus.
 *
 * Factorise le pattern déjà éprouvé de `scripts/backfill-from-vivier.ts`.
 * Ordre imposé : `.order(<cursorColumn>, { ascending: true })` + `.gt(col,
 * cursor)` — l'appelant fournit une `fetchPage` qui applique ces deux clauses.
 */

const DEFAULT_PAGE_SIZE = 1000;

/**
 * Rapatrie TOUTES les lignes en paginant par keyset. `fetchPage(afterId,
 * limit)` doit : ordonner par la colonne curseur ASC, ne renvoyer que les
 * lignes `> afterId` (ou toutes si `afterId === null`), et limiter à `limit`.
 * `cursorOf(row)` extrait la valeur curseur (unique+stable) de la dernière
 * ligne d'une page.
 *
 * Terminaison : la boucle s'arrête dès qu'une page rend `< pageSize` lignes.
 * Garde anti-boucle-infinie : si une page pleine ne fait pas AVANCER le curseur
 * (curseur non strictement croissant — ne devrait jamais arriver sur une PK),
 * on stoppe pour ne pas tourner sans fin.
 */
export async function fetchAllKeyset<Row>(opts: {
  fetchPage: (afterId: string | null, limit: number) => Promise<Row[]>;
  cursorOf: (row: Row) => string;
  pageSize?: number;
}): Promise<Row[]> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const out: Row[] = [];
  let afterId: string | null = null;
  for (;;) {
    const page = await opts.fetchPage(afterId, pageSize);
    if (page.length === 0) break;
    out.push(...page);
    if (page.length < pageSize) break;
    const nextCursor = opts.cursorOf(page[page.length - 1]!);
    if (afterId !== null && nextCursor <= afterId) {
      // Curseur non strictement croissant : impossible sur une PK unique
      // ordonnée, mais on refuse de boucler à l'infini (fail-safe).
      break;
    }
    afterId = nextCursor;
  }
  return out;
}

/**
 * Découpe un tableau en lots de taille `size`. Sert à borner le RETOUR des RPC
 * set-returning multi-lignes (ex. `match_vivier_anchors` : jusqu'à 3 lignes par
 * candidat ⇒ chunk de 300 ⇒ ≤ 900 lignes/appel, sous le cap 1000). Garantie
 * DURE indépendante du volume total, en complément du filtre au seuil côté SQL.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk: size must be > 0');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
