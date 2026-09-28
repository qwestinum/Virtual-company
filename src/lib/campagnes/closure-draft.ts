/**
 * Brouillon du dialogue de CLÔTURE — logique PURE et testée
 * (feat/feedback-candidat, lot 4). CLIENT-SAFE.
 *
 * Trois décisions, dans l'ordre où l'écran les pose :
 *   1. le recrutement est-il CONCLU ? (sinon : clôture sans recrutement) ;
 *   2. s'il l'est et qu'il y a des retenus : QUI est recruté — un OU PLUSIEURS
 *      (une campagne peut aboutir à plusieurs recrutements, 28/09/2026),
 *      désignation HUMAINE explicite, jamais pré-cochée ; « ne pas préciser »
 *      reste un choix (on ne bloque jamais une clôture) ;
 *   3. pour chaque retenu NON sélectionné : le message au candidat, l'un des
 *      deux gestes OBLIGATOIRE (envoyer / je préviens moi-même) — ces dossiers
 *      passent en « Non retenu », c'est une décision qui les concerne.
 * Les candidatures encore OUVERTES gardent leur classement sans suite groupé.
 */

import type { ClosureRetenu } from '@/lib/candidatures/dismissal-batch';
import type { FeedbackChoice } from '@/types/candidate-feedback';

export type ClosureOutcome = 'conclu' | 'non_conclu';

/** `unspecified` : conclu, sans désigner qui (choix explicite). */
export type HiredChoice = { kind: 'designated'; analysisIds: string[] } | { kind: 'unspecified' };

/**
 * Coche / décoche un retenu. « Ne pas préciser » est EXCLUSIF : cocher un
 * retenu le quitte ; tout décocher revient à « rien de choisi » (le bouton de
 * clôture attend alors un choix).
 */
export function toggleHired(current: HiredChoice | null, analysisId: string): HiredChoice | null {
  const ids = current?.kind === 'designated' ? current.analysisIds : [];
  const next = ids.includes(analysisId) ? ids.filter((x) => x !== analysisId) : [...ids, analysisId];
  return next.length > 0 ? { kind: 'designated', analysisIds: next } : null;
}

/** Les recrutés cochés (vide si « ne pas préciser » ou rien de choisi). */
export function hiredIds(draft: ClosureDraft): string[] {
  return draft.hired?.kind === 'designated' ? draft.hired.analysisIds : [];
}

export type ClosureDraft = {
  outcome: ClosureOutcome | null;
  hired: HiredChoice | null;
  /** Message au candidat, par retenu non sélectionné (clé = analysisId). */
  feedbacks: Readonly<Record<string, FeedbackChoice | null>>;
  dismissOpen: boolean;
  sendMail: boolean;
};

export function initialClosureDraft(hasRetenu: boolean): ClosureDraft {
  return {
    // Pré-remplissage historique du motif (« poste pourvu » dès qu'un GO
    // existe) ; la DÉSIGNATION, elle, n'est jamais pré-cochée.
    outcome: hasRetenu ? 'conclu' : null,
    hired: null,
    feedbacks: {},
    dismissOpen: true,
    sendMail: true,
  };
}

/** La désignation n'a de sens que sur un recrutement conclu, avec des retenus. */
export function asksForHire(draft: ClosureDraft, retenus: readonly ClosureRetenu[]): boolean {
  return draft.outcome === 'conclu' && retenus.length > 0;
}

/** Les retenus qui passeront en « Non retenu » (cause : non sélectionné). */
export function notSelected(
  draft: ClosureDraft,
  retenus: readonly ClosureRetenu[],
): ClosureRetenu[] {
  if (!asksForHire(draft, retenus) || draft.hired?.kind !== 'designated') return [];
  const hired = new Set(draft.hired.analysisIds);
  return retenus.filter((r) => !hired.has(r.analysisId));
}

/** Motif du classement sans suite des candidatures ouvertes. */
export function closureDismissalReason(
  outcome: ClosureOutcome,
): 'poste_pourvu' | 'campagne_cloturee' {
  return outcome === 'conclu' ? 'poste_pourvu' : 'campagne_cloturee';
}

/** Ce qui manque encore — `[]` = le bouton de clôture est armé. */
export function closureMissing(
  draft: ClosureDraft,
  retenus: readonly ClosureRetenu[],
): ('outcome' | 'hired' | 'feedback')[] {
  const missing: ('outcome' | 'hired' | 'feedback')[] = [];
  if (draft.outcome === null) missing.push('outcome');
  if (asksForHire(draft, retenus) && draft.hired === null) missing.push('hired');
  if (notSelected(draft, retenus).some((r) => !draft.feedbacks[r.analysisId])) {
    missing.push('feedback');
  }
  return missing;
}

/** Corps de `POST /api/campaigns/[id]/close`. */
export type ClosureRequest = {
  outcome: ClosureOutcome;
  hiredAnalysisIds: string[];
  notSelected: { analysisId: string; feedback: FeedbackChoice }[];
  dismissOpen: boolean;
  reason: 'poste_pourvu' | 'campagne_cloturee';
  sendMail: boolean;
};

export function closureRequest(
  draft: ClosureDraft,
  retenus: readonly ClosureRetenu[],
  openTotal: number,
): ClosureRequest | null {
  if (closureMissing(draft, retenus).length > 0 || draft.outcome === null) return null;
  const hiredAnalysisIds = asksForHire(draft, retenus) ? hiredIds(draft) : [];
  return {
    outcome: draft.outcome,
    hiredAnalysisIds,
    notSelected: notSelected(draft, retenus).map((r) => ({
      analysisId: r.analysisId,
      feedback: draft.feedbacks[r.analysisId]!,
    })),
    dismissOpen: draft.dismissOpen && openTotal > 0,
    reason: closureDismissalReason(draft.outcome),
    sendMail: draft.sendMail,
  };
}
