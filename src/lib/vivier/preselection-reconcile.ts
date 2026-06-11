/**
 * Réconciliation idempotente de la short-list persistée (Session V2,
 * docs/specs/vivier.md §4 + décision de session « état dès la V2 »).
 *
 * PUR (testable sans I/O). Garantit que toute relance de présélection :
 *   - ne DUPLIQUE jamais une proposition (clé = candidate_id) ;
 *   - PRÉSERVE les décisions futures (V3) : une ligne `contacted`/`rejected`
 *     n'est ni écrasée ni supprimée, et un candidat décidé n'est jamais
 *     ré-introduit comme `identified` ;
 *   - PURGE les `identified` périmés (sortis de la nouvelle short-list).
 *
 * L'idempotence vit donc dans la donnée (réconciliation par contenu), pas dans
 * l'hypothèse d'un appelant unique.
 */

import type { ShortlistEntry } from '@/types/vivier-preselection';

export type ExistingPreselectionRow = {
  candidateId: string;
  state: 'identified' | 'contacted' | 'rejected';
};

export type PreselectionReconciliation = {
  /** Entrées à (ré)écrire en `identified` (scores rafraîchis). */
  toUpsert: ShortlistEntry[];
  /** Candidats `identified` périmés à supprimer (jamais les décidés). */
  toDeleteCandidateIds: string[];
};

export function reconcilePreselection(
  existing: ExistingPreselectionRow[],
  fresh: ShortlistEntry[],
): PreselectionReconciliation {
  const decided = new Set(
    existing.filter((r) => r.state !== 'identified').map((r) => r.candidateId),
  );
  // Ne jamais ressusciter un candidat décidé (contacted/rejected) en identified.
  const toUpsert = fresh.filter((e) => !decided.has(e.candidateId));
  const freshIds = new Set(toUpsert.map((e) => e.candidateId));
  // Purge les identified qui ne sont plus dans la short-list ; ne touche JAMAIS
  // une ligne décidée.
  const toDeleteCandidateIds = existing
    .filter((r) => r.state === 'identified' && !freshIds.has(r.candidateId))
    .map((r) => r.candidateId);
  return { toUpsert, toDeleteCandidateIds };
}
