/**
 * Garde d'ENVOI d'un mail HITL — PUR.
 *
 * Le mail part selon ce que l'écran montre (`mode`), la finalisation (journal,
 * analyse, révocation du lien de réservation) selon la décision EN BASE. S'ils
 * divergent, le candidat reçoit une invitation pendant que tout le produit le
 * compte refusé — et son lien de réservation meurt. Défaut attrapé par la
 * régression S4 le 27/09/2026 (une remise en file réécrivait la décision).
 *
 * La réservation (`reserve-send`) refuse déjà une décision qui diverge ; cette
 * garde est la seconde ceinture, posée à l'endroit même où le mail part :
 * la fiche doit être RÉSERVÉE et sa décision doit être celle du mail.
 */
import type { HitlDecision, PendingValidationStatus } from '@/types/hitl';

export type HitlSendMode = 'invite' | 'reject';

export type HitlSendGuard =
  | { ok: true }
  | { ok: false; error: 'validation_not_found' | 'not_reserved' | 'decision_mismatch' };

export function decisionForMode(mode: HitlSendMode): HitlDecision {
  return mode === 'invite' ? 'accept' : 'reject';
}

export function checkHitlSend(
  fiche: { status: PendingValidationStatus; decision: HitlDecision } | null,
  mode: HitlSendMode,
): HitlSendGuard {
  if (!fiche) return { ok: false, error: 'validation_not_found' };
  // `sent` : le claim d'envoi rendra `duplicate` — un réessai reste sûr.
  if (fiche.status !== 'sending' && fiche.status !== 'sent') {
    return { ok: false, error: 'not_reserved' };
  }
  if (fiche.decision !== decisionForMode(mode)) {
    return { ok: false, error: 'decision_mismatch' };
  }
  return { ok: true };
}
