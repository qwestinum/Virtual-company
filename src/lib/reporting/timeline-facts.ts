/**
 * Extraction SERVEUR des faits datés d'un candidat pour la frise (niveau 3).
 * Croise l'analyse, le journal (actions ciblées, filtrées par uid), le vivier
 * et la réservation d'entretien → `CandidateTimelineFacts` (consommé par le
 * helper PUR `buildCandidateTimeline`). Best-effort : toute lecture KO retombe
 * sur des faits absents (la frise se réduit, elle ne casse pas).
 */

import { getScheduledInterviewByUid } from '@/lib/db/repos/interview-briefs';
import { listJournalEntriesByActions } from '@/lib/db/repos/journal';
import type { CandidateTimelineFacts } from '@/lib/reporting/candidate-timeline';
import type { CandidateAnalysisDetail } from '@/types/reporting';

const OUTREACH_ACTION = 'imap_outreach_mail';
const INTERVIEW_ACTION = 'candidate_interview_marked';
const VALIDATION_ACTION = 'candidate_validation_marked';
/** Validation HITL d'un gris envoyée (accept/reject) — par uid. */
const HITL_SENT_ACTION = 'hitl_validation_sent';

function resolveAnalyzedAt(detail: CandidateAnalysisDetail): string {
  return detail.computedAt && !detail.computedAt.startsWith('1970')
    ? detail.computedAt
    : detail.createdAt;
}

export async function extractCandidateTimelineFacts(
  detail: CandidateAnalysisDetail,
  vivierOrigin: { contactedAt: string | null; appliedAt: string | null } | null,
): Promise<CandidateTimelineFacts> {
  const uid = detail.uid;

  // Faits PAR-UID (cohérent avec le parcours). Le RDV vient d'interview_briefs
  // rattaché PAR UID (fiable, ≠ email) ; le reste, du journal filtré par uid.
  const [entries, rdv] = await Promise.all([
    listJournalEntriesByActions(
      [OUTREACH_ACTION, INTERVIEW_ACTION, VALIDATION_ACTION, HITL_SENT_ACTION],
      { campaignId: detail.campaignId ?? undefined },
    ).catch(() => []),
    getScheduledInterviewByUid(uid).catch(() => null),
  ]);

  // Journal trié created_at DESC → la 1ʳᵉ occurrence par fait est la plus
  // récente (on ne réécrit jamais une valeur déjà posée).
  let invitationSentAt: string | null = null;
  let rejectionSentAt: string | null = null;
  let validatedAt: string | null = null;
  let interviewRealizedAt: string | null = null;
  let interviewMissedAt: string | null = null;
  let finalValidatedAt: string | null = null;
  let finalRejectedAt: string | null = null;

  for (const e of entries) {
    if (String(e.payload.uid) !== uid) continue;
    const status = e.payload.status;
    if (e.action === OUTREACH_ACTION && status === 'sent') {
      const mode = e.payload.mode;
      if (mode === 'invite' && !invitationSentAt) invitationSentAt = e.createdAt;
      else if (mode === 'reject' && !rejectionSentAt) rejectionSentAt = e.createdAt;
    } else if (e.action === INTERVIEW_ACTION) {
      if (status === 'realized' && !interviewRealizedAt) interviewRealizedAt = e.createdAt;
      else if (status === 'missed' && !interviewMissedAt) interviewMissedAt = e.createdAt;
    } else if (e.action === VALIDATION_ACTION) {
      if (status === 'validated' && !finalValidatedAt) finalValidatedAt = e.createdAt;
      else if (status === 'rejected' && !finalRejectedAt) finalRejectedAt = e.createdAt;
    } else if (e.action === HITL_SENT_ACTION) {
      // Validation d'un gris ENVOYÉE en acceptation → « Candidat validé ».
      if (e.payload.decision === 'accept' && !validatedAt) validatedAt = e.createdAt;
    }
  }

  return {
    receivedAt: detail.receivedAt,
    source: detail.source,
    fileName: detail.fileName,
    analyzedAt: resolveAnalyzedAt(detail),
    totalScore: detail.totalScore,
    criteriaVersion: detail.application.scoringResult.criteriaVersion,
    status: detail.status,
    decisionJustification: detail.application.narration.justification,
    fromVivier: detail.fromVivier,
    vivierContactedAt: vivierOrigin?.contactedAt ?? null,
    vivierAppliedAt: vivierOrigin?.appliedAt ?? null,
    validatedAt,
    invitationSentAt,
    rejectionSentAt,
    scheduledAt: rdv?.startAt ?? rdv?.bookedAt ?? null,
    interviewRealizedAt,
    interviewMissedAt,
    finalValidatedAt,
    finalRejectedAt,
  };
}
