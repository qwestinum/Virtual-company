/**
 * Cause d'écartement d'une candidature — dérivée PURE du `ScoreResult` (C6/6b).
 *
 * Sert au rapport (décomposition des écartés) et au bloc chat (indicateur par
 * CV). Aide le recruteur à diagnostiquer sa fiche : trop de knockouts =
 * verrouillage excessif, trop sous seuil = critères mous mal calibrés.
 *
 * Précédence (du plus sévère au moins) : knockout > cap > sous le seuil.
 * Un CV `accepted` n'a pas de cause (null).
 */

import { criterionBehavior, type ScoreResult } from '@/types/scoring';

export type RejectionCause = 'knockout' | 'cap' | 'below_threshold';

/** Libellés courts des causes (sans emoji — l'emoji est une décision UI). */
export const REJECTION_CAUSE_LABELS: Record<RejectionCause, string> = {
  knockout: 'knockout',
  cap: 'cap obligatoire',
  below_threshold: 'sous seuil',
};

/** Vrai si un critère rédhibitoire (HARD_KNOCKOUT) a échoué. */
export function isKnockout(result: ScoreResult): boolean {
  return result.hardFailures.some(
    (h) => criterionBehavior(h.criticityLevel) === 'HARD_KNOCKOUT',
  );
}

/** Vrai si un critère HARD_CAP a échoué (déclenche le plafond). */
export function hasCapFailure(result: ScoreResult): boolean {
  return result.hardFailures.some(
    (h) => criterionBehavior(h.criticityLevel) === 'HARD_CAP',
  );
}

/**
 * Cause d'écartement d'un `rejected`, ou `null` si `accepted`. Précédence :
 * knockout (rédhibitoire) > cap (obligatoire) > sous le seuil.
 */
export function rejectionCause(result: ScoreResult): RejectionCause | null {
  if (result.status === 'accepted') return null;
  if (isKnockout(result)) return 'knockout';
  if (hasCapFailure(result)) return 'cap';
  return 'below_threshold';
}
