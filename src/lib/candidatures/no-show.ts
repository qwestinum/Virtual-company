/**
 * Absence à l'entretien classée NON RETENUE — cœur SERVEUR.
 * feat/feedback-candidat (28/09/2026).
 *
 * Le marqueur `candidate_interview_marked { status: 'missed' }` dérive vers
 * `non_retenu` : c'est une DÉCISION, pas un constat (cf. NoShowDialog). Comme
 * le verdict final, elle a donc SON chemin : `/api/journal` refuse ce
 * marqueur, et la route `POST /api/candidatures/[id]/no-show` exige le choix
 * de message au candidat (gabarit « absent »).
 *
 * L'étape est RELUE ici, jamais crue du client : seul un dossier encore avant
 * l'entretien (invité, RDV pris) peut être classé absent. Un verdict posé
 * ailleurs entre-temps rend `not_awaiting_interview` et l'écran recharge.
 *
 * Aucun envoi ICI : le message est posé par la route, via `feedback.ts`.
 */

import {
  buildInterviewMarkerEntry,
} from '@/lib/candidatures/decision-markers';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import type { CandidateStage } from '@/lib/reporting/candidate-stage';
import { loadStageSignals, stageFor } from '@/lib/reporting/stage-signals';
import type { HumanDecider } from '@/types/hitl';
import type { CandidateAnalysisSummary } from '@/types/reporting';

/** Étapes où une absence peut être constatée puis tranchée. */
export const NO_SHOW_STAGES: readonly CandidateStage[] = ['invite', 'rdv_pris'];

export type NoShowOutcome =
  | { status: 'decided'; nextStage: CandidateStage }
  | { status: 'not_awaiting_interview'; stage: CandidateStage };

export async function postNoShow(args: {
  analysis: CandidateAnalysisSummary;
  actor: HumanDecider | null;
}): Promise<NoShowOutcome> {
  const { analysis, actor } = args;
  const perimeter = analysis.campaignId ? { campaignId: analysis.campaignId } : {};
  const stage = stageFor(analysis, await loadStageSignals(perimeter));
  if (!NO_SHOW_STAGES.includes(stage)) return { status: 'not_awaiting_interview', stage };

  const marker = buildInterviewMarkerEntry({
    uid: analysis.uid,
    candidateName: analysis.candidateName,
    campaignId: analysis.campaignId,
    value: 'missed',
  });
  await appendJournalEntry({
    ...marker,
    actor: 'user',
    payload: {
      ...marker.payload,
      actorUserId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
    },
  });
  const nextStage = stageFor(analysis, await loadStageSignals(perimeter));
  return { status: 'decided', nextStage };
}
