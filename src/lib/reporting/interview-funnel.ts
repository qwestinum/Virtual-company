/**
 * Du CV au recrutement — l'entonnoir d'une campagne et l'information des
 * candidats reçus en entretien. PUR et testé (feat/feedback-candidat, lot 5).
 *
 * Des TRAJECTOIRES (« passés par »), pas des étapes courantes : un retenu est
 * aussi un invité et un reçu en entretien. Sources : colonnes de l'analyse et
 * marqueurs COURANTS (dernier-gagne) — une décision corrigée compte pour son
 * état actuel.
 *
 *   reçues → invités (acceptés sur CV) → entretiens (réalisés) → retenus
 *   (verdict positif) → recrutés (désignés à la clôture).
 *
 * Taux de placement = recrutés / retenus, seulement quand un recruté est
 * désigné (sinon il ne mesure rien). Candidats informés = reçus en entretien
 * dont la décision est posée (verdict, ou classement sans suite), et qui ont
 * été informés (message parti, ou prévenus par le recruteur).
 */

import { feedbackInforms, type CandidateFeedback } from '@/types/candidate-feedback';

export type InterviewFunnel = {
  received: number;
  invited: number;
  interviewed: number;
  retained: number;
  hired: number;
  /** % arrondi ; `null` tant qu'aucun recruté n'est désigné. */
  placementRate: number | null;
  /** `null` : lecture des messages indisponible, ou aucun décidé après entretien. */
  informed: { total: number; informed: number } | null;
};

export function computeInterviewFunnel(
  analyses: readonly { id: string; uid: string; status: string; dismissedAt: string | null }[],
  signals: {
    interviewMarks: ReadonlyMap<string, 'realized' | 'missed'>;
    validationMarks: ReadonlyMap<string, 'validated' | 'rejected'>;
    hiredUids: ReadonlySet<string>;
  },
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
    if (a.status === 'accepted') invited += 1;
    const verdict = signals.validationMarks.get(a.uid) ?? null;
    if (signals.interviewMarks.get(a.uid) === 'realized') {
      interviewed += 1;
      if (verdict !== null || a.dismissedAt !== null) {
        decidedAfterInterview += 1;
        if (informedIds.has(a.id)) informed += 1;
      }
    }
    if (verdict === 'validated') {
      retained += 1;
      if (signals.hiredUids.has(a.uid)) hired += 1;
    }
  }
  return {
    received: analyses.length,
    invited,
    interviewed,
    retained,
    hired,
    placementRate: hired > 0 && retained > 0 ? Math.round((hired / retained) * 100) : null,
    informed:
      feedback === null || decidedAfterInterview === 0
        ? null
        : { total: decidedAfterInterview, informed },
  };
}
