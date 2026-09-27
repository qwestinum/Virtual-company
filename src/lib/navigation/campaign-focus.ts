/**
 * Où se trouve une campagne désignée par l'URL — PUR, testé.
 *
 * « Retour à la campagne » doit ouvrir LA campagne, pas la liste. Or la liste
 * n'en montre par défaut qu'une tranche : filtre « Actives » et pagination par
 * 5. Un lien qui déposerait sur la liste sans lever ces deux voiles tiendrait
 * sa promesse une fois sur deux — et échouerait en SILENCE, précisément pour
 * les campagnes qu'on a le plus de raisons de rouvrir : les suspendues et les
 * clôturées.
 *
 * D'où cette résolution : on élargit le filtre et on saute à la bonne page.
 */

export type CampaignFocus = {
  /** `true` : montrer TOUS les statuts, le temps d'atteindre la campagne. */
  showAllStatuses: boolean;
  /** Page (0-indexée) contenant la campagne, ou 0 si elle est introuvable. */
  page: number;
  /** La campagne à déplier, ou `null` si elle n'est pas dans la liste. */
  expandedId: string | null;
};

const NO_FOCUS: CampaignFocus = {
  showAllStatuses: false,
  page: 0,
  expandedId: null,
};

export function resolveCampaignFocus(
  /** Les campagnes DANS L'ORDRE D'AFFICHAGE, tous statuts confondus. */
  orderedIds: readonly string[],
  targetId: string | null | undefined,
  pageSize: number,
): CampaignFocus {
  if (!targetId) return NO_FOCUS;
  const index = orderedIds.indexOf(targetId);
  // Campagne inconnue (lien vieilli, campagne supprimée, liste pas encore
  // chargée) : on n'élargit rien et on ne déplie rien. Ouvrir « Toutes » sur
  // une cible absente changerait l'écran sans rien montrer de plus.
  if (index < 0) return NO_FOCUS;
  return {
    showAllStatuses: true,
    page: Math.floor(index / pageSize),
    expandedId: targetId,
  };
}
