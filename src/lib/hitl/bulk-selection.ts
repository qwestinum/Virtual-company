/**
 * Sélection multiple du refus groupé — logique PURE.
 *
 * Deux garanties, et elles ne sont pas décoratives : une fournée de refus part
 * sur ce que la sélection désigne, donc une sélection qui déborde de ce que
 * l'écran montre serait un envoi que personne n'a relu.
 *
 *  1. JAMAIS de sélection invisible : `selectedAmong` intersecte toujours avec
 *     les dossiers réellement affichés — un id resté dans le panier après un
 *     changement de liste ne peut pas ressortir.
 *  2. Changer de filtre REPART d'une ardoise propre : la sélection porte sa
 *     propre `filterKey`, et `syncSelectionToFilter` la vide dès que la clé
 *     bouge. C'est un ajustement d'état pendant le rendu (pas un effet) — la
 *     sélection n'est jamais rendue une seule frame de trop.
 */

export type BulkSelection = {
  /** Clé du filtre sous lequel cette sélection a été constituée. */
  filterKey: string;
  ids: ReadonlySet<string>;
};

export function emptySelection(filterKey: string): BulkSelection {
  return { filterKey, ids: new Set() };
}

/**
 * Rend la sélection TELLE QUELLE si le filtre n'a pas bougé (identité stable :
 * l'appelant peut comparer par référence pour éviter un re-render inutile),
 * une sélection vide sinon.
 *
 * `frozen` GÈLE la sélection le temps d'une fournée en vol : la confirmation
 * nomme les candidats un par un et affiche une progression — la voir se vider
 * en cours d'exécution serait alarmant, et le lot qui part est de toute façon
 * celui qui a été confirmé, pas celui que le filtre montre maintenant. Le
 * recalage a lieu au dégel, à la fin de la fournée.
 */
export function syncSelectionToFilter(
  selection: BulkSelection,
  filterKey: string,
  frozen = false,
): BulkSelection {
  if (frozen || selection.filterKey === filterKey) return selection;
  return emptySelection(filterKey);
}

export function toggleSelection(
  selection: BulkSelection,
  id: string,
): BulkSelection {
  const ids = new Set(selection.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { filterKey: selection.filterKey, ids };
}

/** Tout cocher / tout décocher, borné aux dossiers VISIBLES. */
export function setAllSelected(
  selection: BulkSelection,
  visibleIds: readonly string[],
  selected: boolean,
): BulkSelection {
  return {
    filterKey: selection.filterKey,
    ids: selected ? new Set(visibleIds) : new Set(),
  };
}

/** Les dossiers visibles ET sélectionnés — jamais rien d'autre. */
export function selectedAmong<V extends { id: string }>(
  visible: readonly V[],
  selection: BulkSelection,
): V[] {
  return visible.filter((v) => selection.ids.has(v.id));
}

export function isAllSelected(
  visible: readonly { id: string }[],
  selection: BulkSelection,
): boolean {
  return visible.length > 0 && visible.every((v) => selection.ids.has(v.id));
}
