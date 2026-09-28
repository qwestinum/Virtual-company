/**
 * Du CV au recrutement — l'entonnoir d'une campagne et l'information des
 * candidats reçus en entretien. PUR et testé (feat/feedback-candidat, lot 5).
 *
 * Des TRAJECTOIRES (« passés par »), pas des étapes courantes : un retenu est
 * aussi un invité et un reçu en entretien, un recruté est un retenu, un retenu
 * non sélectionné à la clôture reste un retenu. MÊME règle que la carte de
 * campagne (`passedThrough`, `campaign-trajectory.ts`) — les deux ne peuvent
 * pas diverger. Une décision corrigée compte pour son état actuel.
 *
 *   reçues → invités (acceptés sur CV) → entretiens (réalisés) → retenus
 *   (verdict positif) → recrutés (désignés à la clôture).
 *
 * Taux de placement = recrutés / retenus, seulement quand un recruté est
 * désigné (sinon il ne mesure rien). Candidats informés = reçus en entretien
 * dont la décision est posée (verdict, ou classement sans suite), et qui ont
 * été informés (message parti, ou prévenus par le recruteur).
 */

import { conversionRate, passedThrough, type TrajectorySignals } from '@/lib/reporting/campaign-trajectory';
import type { DecisionZone } from '@/types/hitl';
import { feedbackInforms, type CandidateFeedback } from '@/types/candidate-feedback';

export type InterviewFunnel = {
  received: number;
  invited: number;
  interviewed: number;
  retained: number;
  hired: number;
  /** % arrondi ; `null` tant qu'aucun recruté n'est désigné. */
  placementRate: number | null;
  /** Recrutés / reçues, % arrondi ; `null` sans candidature. */
  conversionRate: number | null;
  /** `null` : lecture des messages indisponible, ou aucun décidé après entretien. */
  informed: { total: number; informed: number } | null;
};

export function computeInterviewFunnel(
  analyses: readonly {
    id: string;
    uid: string;
    status: string;
    decisionZone?: DecisionZone | null;
    dismissedAt: string | null;
  }[],
  signals: TrajectorySignals,
  feedback: readonly Pick<CandidateFeedback, 'analysisId' | 'channel' | 'mailStatus'>[] | null,
): InterviewFunnel {
  const informedIds = new Set(
    (feedback ?? []).filter((f) => feedbackInforms(f)).map((f) => f.analysisId),
  );
  let invited = 0;
  let interviewed = 0;
  let retained = 0;
  let hired = 0;
  let decidedAfterInterview = 0;
  let informed = 0;
  for (const a of analyses) {
    const traj = { uid: a.uid, status: a.status, decisionZone: a.decisionZone };
    if (passedThrough('invite', traj, signals)) invited += 1;
    const verdict = signals.validationMarks.get(a.uid) ?? null;
    if (passedThrough('entretien_fait', traj, signals)) {
      interviewed += 1;
      if (verdict !== null || a.dismissedAt !== null) {
        decidedAfterInterview += 1;
        if (informedIds.has(a.id)) informed += 1;
      }
    }
    if (passedThrough('retenu', traj, signals)) retained += 1;
    if (passedThrough('recrute', traj, signals)) hired += 1;
  }
  return {
    received: analyses.length,
    invited,
    interviewed,
    retained,
    hired,
    placementRate: hired > 0 && retained > 0 ? Math.round((hired / retained) * 100) : null,
    conversionRate: conversionRate({ recues: analyses.length, recrute: hired }),
    informed:
      feedback === null || decidedAfterInterview === 0
        ? null
        : { total: decidedAfterInterview, informed },
  };
}
