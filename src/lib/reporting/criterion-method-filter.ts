/**
 * Filtre par MÉTHODE de vérification de la liste des critères (audit candidat,
 * Phase 4.2). PUR & client-safe : compteurs par méthode présente et filtrage.
 */

import {
  DEFAULT_VERIFICATION_METHOD,
  VERIFICATION_METHODS,
  type CriterionDecision,
  type VerificationMethod,
} from '@/types/scoring';

/** Méthode d'une décision, coalescée pour les grilles antérieures. */
export function decisionMethod(d: CriterionDecision): VerificationMethod {
  return d.verificationMethodUsed ?? DEFAULT_VERIFICATION_METHOD;
}

/** Compteur par méthode PRÉSENTE, dans l'ordre canonique des méthodes. */
export function criterionMethodCounts(
  breakdown: CriterionDecision[],
): { method: VerificationMethod; count: number }[] {
  const counts = new Map<VerificationMethod, number>();
  for (const d of breakdown) {
    const m = decisionMethod(d);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return VERIFICATION_METHODS.filter((m) => counts.has(m)).map((m) => ({
    method: m,
    count: counts.get(m)!,
  }));
}

/** Filtre les critères par méthode ; `null` = toutes. PUR. */
export function filterByMethod(
  breakdown: CriterionDecision[],
  method: VerificationMethod | null,
): CriterionDecision[] {
  return method === null
    ? breakdown
    : breakdown.filter((d) => decisionMethod(d) === method);
}
