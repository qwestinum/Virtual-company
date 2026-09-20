/**
 * Libellés des TROIS zones de décision — source unique, pure, testée.
 *
 * Pourquoi un module plutôt que deux littéraux : le curseur de CRÉATION
 * (`draft/ThresholdDraftEditor`) et le curseur d'ÉDITION
 * (`DecisionThresholdsBlock`) affichent le même objet et ont divergé. Le second
 * a été corrigé le 18/08/2026 quand l'envoi automatique de refus a été retiré ;
 * le premier est resté sur « Refus auto < N » — donc le formulaire de création
 * a continué d'enseigner un comportement supprimé, à l'écran, pendant un mois.
 *
 * Deux textes parallèles décrivant une même règle finissent par diverger, et la
 * divergence est SILENCIEUSE (rien ne compile en rouge). D'où un seul endroit.
 *
 * ⚠️ Règle de fond, pas de vocabulaire : sous le seuil bas, AUCUN mail ne part.
 * La candidature est mise en file et *proposée* au refus ; un humain tranche.
 * Le seuil bas EST le seuil de proposition de refus — il n'y en a pas d'autre.
 */

/** Les trois repères posés au-dessus du curseur. */
export type ThresholdZoneLabels = {
  /** Sous le seuil bas — mise en file, jamais un envoi. */
  low: string;
  /** Entre les deux seuils — décision humaine. */
  middle: string;
  /** Au-dessus du seuil haut — la SEULE zone qui envoie encore seule. */
  high: string;
};

export function thresholdZoneLabels(
  low: number,
  high: number,
): ThresholdZoneLabels {
  return {
    low: `Proposé au refus < ${low}`,
    middle: 'À examiner',
    high: `Accept. auto ≥ ${high}`,
  };
}

/** Phrase de récapitulation sous le curseur, y compris aux deux cas limites. */
export function thresholdZoneHint(low: number, high: number): string {
  if (low === high) {
    return `Aucune zone d’examen : sous ${low} proposé au refus, au-dessus accepté automatiquement.`;
  }
  if (low === 0 && high === 100) {
    return 'Toutes les candidatures passent en validation humaine.';
  }
  return `Proposé au refus < ${low} · à examiner ${low}–${high} · acceptation auto ≥ ${high}`;
}

/**
 * Ce que le curseur doit DIRE, et que seule l'édition disait. Repris mot pour
 * mot des deux côtés — c'est le point sur lequel le client a été mal informé.
 */
export const NO_AUTOMATIC_REJECTION = 'Aucun refus n’est envoyé automatiquement';
