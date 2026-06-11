/**
 * Cycle factuel d'une proposition vivier (Session V3, docs/specs/vivier.md §6.2).
 *
 * Trois états, PAS un cycle de vie : on n'enregistre que des faits vérifiables
 * résultant d'actions internes.
 *   - `identified` — ressorti de la présélection (V2)
 *   - `rejected`   — prise de contact refusée en validation (terminal pour la campagne)
 *   - `contacted`  — invitation envoyée (terminal)
 *
 * Aucun statut spéculatif (a postulé / sans réponse / a décliné). Les seules
 * transitions autorisées partent de `identified`. PUR (testable sans I/O) — la
 * contrainte est aussi posée au niveau base (CHECK état↔dates).
 */

import type { VivierPreselectionState } from '@/types/vivier-preselection';

/** Décision humaine (ou auto) en validation vivier. */
export type ProposalDecision = 'accept' | 'reject';

const ALLOWED_TRANSITIONS: Record<
  VivierPreselectionState,
  VivierPreselectionState[]
> = {
  identified: ['contacted', 'rejected'],
  contacted: [], // terminal — un fait acté ne se défait pas
  rejected: [], // terminal pour cette campagne
};

/** État cible d'une décision : accepter ⇒ contacté (à l'envoi), rejeter ⇒ rejeté. */
export function decisionTargetState(
  decision: ProposalDecision,
): VivierPreselectionState {
  return decision === 'accept' ? 'contacted' : 'rejected';
}

/** Une transition est-elle factuellement autorisée ? (jamais de spéculatif). */
export function canTransition(
  from: VivierPreselectionState,
  to: VivierPreselectionState,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class ProposalTransitionError extends Error {
  constructor(
    public readonly from: VivierPreselectionState,
    public readonly to: VivierPreselectionState,
  ) {
    super(`Transition vivier interdite : ${from} → ${to}`);
    this.name = 'ProposalTransitionError';
  }
}

/** Lève si la transition n'est pas autorisée. */
export function assertTransition(
  from: VivierPreselectionState,
  to: VivierPreselectionState,
): void {
  if (!canTransition(from, to)) throw new ProposalTransitionError(from, to);
}
