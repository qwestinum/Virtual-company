/**
 * Extraction SERVEUR des faits datés d'un candidat pour la frise (niveau 3).
 * Croise l'analyse, le journal (actions ciblées, filtrées par uid), le vivier
 * et la réservation d'entretien → `CandidateTimelineFacts` (consommé par le
 * helper PUR `buildCandidateTimeline`). Best-effort : toute lecture KO retombe
 * sur des faits absents (la frise se réduit, elle ne casse pas).
 */

import {
  DECISION_CORRECTED_ACTION,
  INTERVIEW_MARKER_ACTION,
  readInterviewMark,
  readValidationMark,
  VALIDATION_MARKER_ACTION,
} from '@/lib/candidatures/decision-markers';
import { getScheduledInterviewByUid } from '@/lib/db/repos/interview-briefs';
import { listVerdictCommentsByAnalyses } from '@/lib/db/repos/verdict-comments';
import { getInterviewReport } from '@/lib/db/repos/interview-reports';
import { interviewReportMention } from '@/lib/candidatures/interview-report-mention';
import {
  listJournalEntriesByActions,
  type JournalEntry,
} from '@/lib/db/repos/journal';
import type { CandidateTimelineFacts } from '@/lib/reporting/candidate-timeline';
import { pickActions } from '@/lib/reporting/journal-preload';
import { DISMISSAL_REASON_LABELS } from '@/types/dismissal';
import type { CandidateAnalysisDetail } from '@/types/reporting';

const OUTREACH_ACTION = 'imap_outreach_mail';
const INTERVIEW_ACTION = INTERVIEW_MARKER_ACTION;
const VALIDATION_ACTION = VALIDATION_MARKER_ACTION;
/** Corrections de décision — plusieurs par candidature, toutes affichées. */
const CORRECTION_ACTION = DECISION_CORRECTED_ACTION;
/** Validation HITL d'un gris envoyée (accept/reject) — par uid. */
const HITL_SENT_ACTION = 'hitl_validation_sent';

/** Actions du journal lues pour la frise. */
export const TIMELINE_JOURNAL_ACTIONS: readonly string[] = [
  OUTREACH_ACTION,
  INTERVIEW_ACTION,
  VALIDATION_ACTION,
  HITL_SENT_ACTION,
  CORRECTION_ACTION,
];

type VivierOriginFacts = { contactedAt: string | null; appliedAt: string | null } | null;

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function resolveAnalyzedAt(detail: CandidateAnalysisDetail): string {
  return detail.computedAt && !detail.computedAt.startsWith('1970')
    ? detail.computedAt
    : detail.createdAt;
}

export async function extractCandidateTimelineFacts(
  detail: CandidateAnalysisDetail,
  /**
   * L'origine vivier, ou sa lecture EN COURS : la frise lance alors ses propres
   * lectures sans l'attendre. Un rejet remonte à l'appelant, comme si la
   * lecture avait été faite avant l'appel.
   */
  vivierOrigin: VivierOriginFacts | Promise<VivierOriginFacts>,
  /**
   * Lecture du journal déjà lancée par l'appelant, sur le MÊME périmètre
   * (`detail.campaignId`) et couvrant au moins `TIMELINE_JOURNAL_ACTIONS`.
   * Même repli qu'en interne : un rejet vaut une frise sans faits de journal.
   */
  preloaded: { journal?: Promise<JournalEntry[]> } = {},
): Promise<CandidateTimelineFacts> {
  const uid = detail.uid;

  // Faits PAR-UID (cohérent avec le parcours). Le RDV vient d'interview_briefs
  // rattaché PAR UID (fiable, ≠ email) ; le reste, du journal filtré par uid.
  const [origin, entries, rdv, comments, report] = await Promise.all([
    vivierOrigin,
    (preloaded.journal
      ? preloaded.journal.then((all) => pickActions(all, TIMELINE_JOURNAL_ACTIONS))
      : listJournalEntriesByActions([...TIMELINE_JOURNAL_ACTIONS], {
          campaignId: detail.campaignId ?? undefined,
        })
    ).catch(() => []),
    getScheduledInterviewByUid(uid).catch(() => null),
    // `null` si la lecture échoue : la frise se tait sur le commentaire plutôt
    // que d'affirmer qu'il n'y en a pas.
    listVerdictCommentsByAnalyses([detail.id]).catch(() => null),
    // Best-effort : un compte rendu illisible retire l'événement, sans plus.
    getInterviewReport(detail.id).catch(() => null),
  ]);

  // Journal trié created_at DESC → la 1ʳᵉ occurrence par fait est la plus
  // récente (on ne réécrit jamais une valeur déjà posée).
  let invitationSentAt: string | null = null;
  let rejectionSentAt: string | null = null;
  let rejectionViaValidation = false;
  let validatedAt: string | null = null;
  let interviewRealizedAt: string | null = null;
  let interviewMissedAt: string | null = null;
  let finalValidatedAt: string | null = null;
  let finalRejectedAt: string | null = null;
  const corrections: CandidateTimelineFacts['corrections'] = [];

  for (const e of entries) {
    if (String(e.payload.uid) !== uid) continue;
    const status = e.payload.status;
    if (e.action === OUTREACH_ACTION && status === 'sent') {
      const mode = e.payload.mode;
      if (mode === 'invite' && !invitationSentAt) invitationSentAt = e.createdAt;
      else if (mode === 'reject' && !rejectionSentAt) rejectionSentAt = e.createdAt;
    } else if (e.action === INTERVIEW_ACTION) {
      // La frise est une CHRONOLOGIE de faits, pas un état : un marquage
      // ensuite corrigé reste affiché, suivi de sa correction. `cleared` ne
      // pose donc aucun fait — c'est l'événement de correction qui parle.
      switch (readInterviewMark(e.payload)) {
        case 'realized':
          if (!interviewRealizedAt) interviewRealizedAt = e.createdAt;
          break;
        case 'missed':
          if (!interviewMissedAt) interviewMissedAt = e.createdAt;
          break;
        case 'cleared':
        case null:
          break;
      }
    } else if (e.action === VALIDATION_ACTION) {
      switch (readValidationMark(e.payload)) {
        case 'validated':
          if (!finalValidatedAt) finalValidatedAt = e.createdAt;
          break;
        case 'rejected':
          if (!finalRejectedAt) finalRejectedAt = e.createdAt;
          break;
        case 'cleared':
        case null:
          break;
      }
    } else if (e.action === CORRECTION_ACTION) {
      corrections.push({
        at: e.createdAt,
        previousLabel: asText(e.payload.previousLabel),
        nextLabel: asText(e.payload.nextLabel),
        by: asText(e.payload.by) ?? asText(e.payload.actorEmail),
        reason: asText(e.payload.reason),
      });
    } else if (e.action === HITL_SENT_ACTION) {
      // Validation d'un gris ENVOYÉE. `mailSent` = réalité de l'envoi
      // (journal honnête C5/C6) — un mail non parti a sa trace dédiée
      // `hitl_mail_not_sent`, on ne pose pas de fait « envoyé » dessus.
      const mailSent = e.payload.mailSent === true;
      if (e.payload.decision === 'accept') {
        // → « Candidat validé » + « Invitation envoyée » (l'invitation d'un
        // gris accepté part par CE flux, pas par imap_outreach_mail).
        if (!validatedAt) validatedAt = e.createdAt;
        if (mailSent && !invitationSentAt) invitationSentAt = e.createdAt;
      } else if (
        e.payload.decision === 'reject' &&
        mailSent &&
        !rejectionSentAt
      ) {
        // → « Refus envoyé ». L'ancien extracteur ignorait le reject HITL :
        // la frise d'un gris refusé par un humain s'arrêtait à l'analyse.
        rejectionSentAt = e.createdAt;
        rejectionViaValidation = true;
      }
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
    vivierContactedAt: origin?.contactedAt ?? null,
    vivierAppliedAt: origin?.appliedAt ?? null,
    validatedAt,
    invitationSentAt,
    rejectionSentAt,
    rejectionViaValidation,
    decidedByUserEmail: detail.decidedByUser?.email ?? null,
    scheduledAt: rdv?.startAt ?? rdv?.bookedAt ?? null,
    interviewRealizedAt,
    interviewMissedAt,
    finalValidatedAt,
    finalRejectedAt,
    interviewReport:
      report && report.status === 'verified' && report.verifiedAt
        ? { verifiedAt: report.verifiedAt, mention: interviewReportMention(report) }
        : null,
    verdictComments: comments
      ? comments.map((c) => ({
          at: c.createdAt,
          verdict: c.verdict,
          body: c.body,
          by: c.authorEmail,
        }))
      : null,
    // Ordre d'apparition : la plus ANCIENNE d'abord (le journal arrive DESC).
    corrections: [...corrections].reverse(),
    dismissedAt: detail.dismissedAt,
    dismissalReasonLabel: detail.dismissalReason
      ? DISMISSAL_REASON_LABELS[detail.dismissalReason]
      : null,
  };
}
