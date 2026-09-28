/**
 * Le candidat est-il INFORMÉ de la décision qui le concerne aujourd'hui ?
 * Règles PURES et testées (feat/feedback-candidat, lot 5). CLIENT-SAFE.
 *
 * Le TYPE de message se DÉDUIT de l'état du dossier, jamais d'un choix de
 * l'écran : retenu → « Retenu » ; non retenu après un verdict → « Non retenu » ;
 * absent classé non retenu → « Absent » ; sans suite → « Sans suite » (sauf
 * doublon / invalide). Écarté sur CV, recruté, dossiers encore ouverts : pas
 * de message après décision à proposer ici (le tri sur CV a son propre mail ;
 * le recrutement relève du client).
 *
 * Sert l'action manuelle « Informer le candidat » de la fiche, qui rattrape
 * les verdicts posés avant le chantier — et ceux dont le message n'est pas
 * parti.
 */

import {
  feedbackInforms,
  type CandidateFeedback,
  type FeedbackKind,
} from '@/types/candidate-feedback';
import { dismissalMailAllowed, type DismissalReason } from '@/types/dismissal';
import type { CandidateStage } from '@/lib/reporting/candidate-stage';

export function expectedFeedbackKind(input: {
  stage: CandidateStage;
  validationMarked: 'validated' | 'rejected' | null;
  interviewMarked: 'realized' | 'missed' | null;
  dismissalReason: DismissalReason | null;
}): FeedbackKind | null {
  switch (input.stage) {
    case 'retenu':
      return 'retenu';
    case 'non_retenu':
      // Un verdict négatif prime ; sans verdict, c'est l'absence qui a décidé.
      if (input.validationMarked === 'rejected') return 'non_retenu';
      return input.interviewMarked === 'missed' ? 'absent' : 'non_retenu';
    case 'sans_suite':
      return input.dismissalReason && dismissalMailAllowed(input.dismissalReason)
        ? 'sans_suite'
        : null;
    default:
      return null;
  }
}

export type FeedbackStatus = {
  /** Le message que la situation appelle ; `null` = rien à annoncer ici. */
  expectedKind: FeedbackKind | null;
  /** La ligne qui a informé le candidat de CETTE situation, s'il y en a une. */
  informed: CandidateFeedback | null;
  /** La dernière tentative pour cette situation (même non aboutie). */
  lastAttempt: CandidateFeedback | null;
};

/** `rows` : les messages de la candidature, du plus ancien au plus récent. */
export function feedbackStatus(
  expectedKind: FeedbackKind | null,
  rows: readonly CandidateFeedback[],
): FeedbackStatus {
  if (!expectedKind) return { expectedKind: null, informed: null, lastAttempt: null };
  const ofKind = rows.filter((r) => r.kind === expectedKind);
  return {
    expectedKind,
    informed: [...ofKind].reverse().find((r) => feedbackInforms(r)) ?? null,
    lastAttempt: ofKind.at(-1) ?? null,
  };
}
