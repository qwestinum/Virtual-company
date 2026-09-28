/**
 * Clôture d'une campagne — issue du recrutement, désignation des recrutés
 * (un OU PLUSIEURS, 28/09/2026), retenus non sélectionnés. Cœur SERVEUR (feat/feedback-candidat, lot 4).
 *
 * Deux temps, et c'est l'ordre qui porte les garanties :
 *   1. `checkClosure` — tout est CONTRÔLÉ avant la moindre écriture, contre
 *      l'état RELU (jamais celui de l'écran) : le recruté désigné est bien un
 *      retenu courant ; chaque autre retenu a son message (l'un des deux
 *      gestes, obligatoire) et rien que lui ; chaque message est recevable.
 *      Un refus ne laisse RIEN de posé.
 *   2. `applyClosureDecisions` — désignation (marqueur `candidate_hired_marked`,
 *      humain explicite, jamais déduit), puis pour chaque non sélectionné le
 *      verdict canonique `rejected` + cause `not_selected_at_closure` suivi de
 *      son message par le chemin UNIQUE des messages (`recordFeedback` : un
 *      mail au plus chacun, verrou deux-phases).
 * L'écriture de `campaign_closed` (issue + recruté, identifiants seulement)
 * est faite par la route, une fois TOUT le reste posé.
 */

import { buildHiredMarkerEntry, buildValidationMarkerEntry } from '@/lib/candidatures/decision-markers';
import { recordFeedback, type RecordFeedbackOutcome } from '@/lib/candidatures/feedback';
import {
  checkFeedbackChoice,
  FEEDBACK_REFUSAL_MESSAGES,
  type FeedbackChoiceRefusal,
} from '@/lib/candidatures/feedback-choice';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import type { FeedbackChoice } from '@/types/candidate-feedback';
import type { HumanDecider } from '@/types/hitl';
import type { CandidateAnalysisSummary } from '@/types/reporting';

export { CAMPAIGN_CLOSED_ACTION, NOT_SELECTED_CAUSE } from './closure-constants';
import { NOT_SELECTED_CAUSE } from './closure-constants';

export type ClosureOutcome = 'conclu' | 'non_conclu';

export type ClosureDecisionInput = {
  outcome: ClosureOutcome;
  /** Les recrutés désignés — vide : aucun désigné (« ne pas préciser »). */
  hiredAnalysisIds: string[];
  notSelected: { analysisId: string; feedback: FeedbackChoice }[];
};

export type ClosureRefusal = {
  error:
    | 'hire_without_conclusion'
    | 'invalid_hire'
    | 'not_selected_without_hire'
    | 'not_selected_mismatch'
    | 'feedback_required'
    | FeedbackChoiceRefusal;
  message: string;
  analysisId?: string;
};

/** Contrôle PUR contre les retenus RELUS. `null` = recevable. */
export function checkClosure(
  input: ClosureDecisionInput,
  retenus: readonly Pick<CandidateAnalysisSummary, 'id' | 'candidateEmail'>[],
): ClosureRefusal | null {
  const hired = new Set(input.hiredAnalysisIds);
  if (input.outcome === 'non_conclu' && (hired.size > 0 || input.notSelected.length > 0)) {
    return {
      error: 'hire_without_conclusion',
      message: 'Une clôture sans recrutement ne désigne personne.',
    };
  }
  if (hired.size === 0) {
    return input.notSelected.length > 0
      ? {
          error: 'not_selected_without_hire',
          message: 'Sans recruté désigné, aucun retenu ne change de statut.',
        }
      : null;
  }
  const byId = new Map(retenus.map((r) => [r.id, r]));
  for (const id of hired) {
    if (!byId.has(id)) {
      return {
        error: 'invalid_hire',
        message: 'Ce candidat n’est plus retenu sur la campagne : l’écran se met à jour.',
        analysisId: id,
      };
    }
  }
  const given = new Map(input.notSelected.map((n) => [n.analysisId, n.feedback]));
  for (const id of given.keys()) {
    if (hired.has(id) || !byId.has(id)) {
      return {
        error: 'not_selected_mismatch',
        message: 'La liste des retenus a changé : l’écran se met à jour.',
        analysisId: id,
      };
    }
  }
  for (const r of retenus) {
    if (hired.has(r.id)) continue;
    const feedback = given.get(r.id);
    if (!feedback) {
      return {
        error: 'feedback_required',
        message: FEEDBACK_REFUSAL_MESSAGES.feedback_required,
        analysisId: r.id,
      };
    }
    const refusal = checkFeedbackChoice(feedback, { candidateEmail: r.candidateEmail });
    if (refusal) return { error: refusal, message: FEEDBACK_REFUSAL_MESSAGES[refusal], analysisId: r.id };
  }
  return null;
}

export type NotSelectedOutcome = {
  analysisId: string;
  feedback: RecordFeedbackOutcome | { error: 'record_failed' };
};

/** Écritures de la désignation — APRÈS `checkClosure`, jamais sans. */
export async function applyClosureDecisions(args: {
  input: ClosureDecisionInput;
  retenus: readonly CandidateAnalysisSummary[];
  actor: HumanDecider | null;
}): Promise<NotSelectedOutcome[]> {
  const { input, retenus, actor } = args;
  if (input.hiredAnalysisIds.length === 0) return [];
  const identity = { actorUserId: actor?.userId ?? null, actorEmail: actor?.email ?? null };

  // Un marqueur PAR recruté — la désignation est individuelle.
  for (const hiredId of new Set(input.hiredAnalysisIds)) {
    const hired = retenus.find((r) => r.id === hiredId)!;
    const hiredEntry = buildHiredMarkerEntry({
      uid: hired.uid,
      candidateName: hired.candidateName,
      campaignId: hired.campaignId,
      value: 'hired',
    });
    await appendJournalEntry({ ...hiredEntry, actor: 'user', payload: { ...hiredEntry.payload, ...identity } });
  }

  const outcomes: NotSelectedOutcome[] = [];
  for (const { analysisId, feedback } of input.notSelected) {
    const analysis = retenus.find((r) => r.id === analysisId)!;
    const marker = buildValidationMarkerEntry({
      uid: analysis.uid,
      candidateName: analysis.candidateName,
      campaignId: analysis.campaignId,
      value: 'rejected',
      cause: NOT_SELECTED_CAUSE,
    });
    await appendJournalEntry({ ...marker, actor: 'user', payload: { ...marker.payload, ...identity } });
    let recorded: NotSelectedOutcome['feedback'];
    try {
      recorded = await recordFeedback({
        analysis,
        kind: 'non_retenu',
        choice: feedback,
        actor,
        cause: NOT_SELECTED_CAUSE,
      });
    } catch {
      // Le verdict EST posé : seul le message a échoué, et la fiche le dira.
      recorded = { error: 'record_failed' };
    }
    outcomes.push({ analysisId, feedback: recorded });
  }
  return outcomes;
}
