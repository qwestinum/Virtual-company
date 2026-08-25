/**
 * Frise DATÉE du parcours d'un candidat (niveau 3 du menu Candidatures).
 * PUR, CLIENT-SAFE, testable. Remplace `buildCandidateHistory` (3 événements
 * fixes) par une frise réelle : on croise les faits datés disponibles
 * (analyse + journal + vivier + réservation) en une liste TRIÉE.
 *
 * Le `CandidateJourney` est un ÉTAT (4 phases), pas une frise — ce module
 * apporte les horodatages que le journey ne porte pas. Chaque fait absent
 * (date null) est simplement omis : pas d'événement inventé.
 */

import type { CandidateStatus } from '@/types/scoring';

export type TimelineTone = 'neutral' | 'positive' | 'negative' | 'pending';

export type TimelineEvent = {
  /** Clé stable (React key + dédup). */
  key: string;
  /** Horodatage ISO 8601. */
  at: string;
  label: string;
  detail: string | null;
  tone: TimelineTone;
};

/** Faits datés extraits côté serveur (analyse + journal + vivier + entretien). */
export type CandidateTimelineFacts = {
  receivedAt: string;
  source: string;
  fileName: string;
  /** computedAt résolu (repli createdAt côté appelant). */
  analyzedAt: string;
  totalScore: number;
  criteriaVersion: string;
  status: CandidateStatus;
  decisionJustification: string;
  fromVivier: boolean;
  /** vivier_preselections.contacted_at (repêchage). */
  vivierContactedAt: string | null;
  /** vivier_preselections.applied_at (rapprochement). */
  vivierAppliedAt: string | null;
  /** Journal hitl_validation_sent (decision accept) — candidat validé (gris accepté). */
  validatedAt: string | null;
  /** Journal imap_outreach_mail (mode invite, sent) OU hitl accept mail parti. */
  invitationSentAt: string | null;
  /**
   * Journal imap_outreach_mail (mode reject, sent) OU hitl_validation_sent
   * (decision reject, mailSent) — le refus d'un gris tranché par un humain
   * était MUET dans la frise avant ce second cas.
   */
  rejectionSentAt: string | null;
  /** true si le refus vient d'une validation humaine (flux HITL), pas du refus auto. */
  rejectionViaValidation: boolean;
  /** Identité du valideur humain (candidate_analyses.decided_by_user_email). */
  decidedByUserEmail: string | null;
  /** interview_briefs.scheduled (par UID) — RDV pris. */
  scheduledAt: string | null;
  /** Journal candidate_interview_marked = realized. */
  interviewRealizedAt: string | null;
  /** Journal candidate_interview_marked = missed. */
  interviewMissedAt: string | null;
  /** Journal candidate_validation_marked = validated. */
  finalValidatedAt: string | null;
  /** Journal candidate_validation_marked = rejected. */
  finalRejectedAt: string | null;
  /**
   * Corrections de décision (`decision_corrected`), de la plus ancienne à la
   * plus récente. Une LISTE, pas un fait daté unique : un dossier peut être
   * corrigé deux fois, et masquer la première réécrirait l'histoire.
   */
  corrections: {
    at: string;
    previousLabel: string | null;
    nextLabel: string | null;
    /** `null` = auteur non enregistré (marqueur antérieur à la capture). */
    by: string | null;
    reason: string | null;
  }[];
  /** candidate_analyses.dismissed_at — classement sans suite (terminal). */
  dismissedAt: string | null;
  /** Libellé du motif de classement (null si non classée). */
  dismissalReasonLabel: string | null;
};

/** Date « inconnue » sentinelle (analyses historiques sans computedAt). */
function isUnknownDate(iso: string): boolean {
  return !iso || iso.startsWith('1970-01-01');
}

/**
 * Rang LOGIQUE de chaque étape dans le pipeline. Le tri se fait par rang PUIS
 * par date : ça garantit l'ordre métier (réception AVANT analyse, etc.) même
 * quand deux horodatages sont à la même seconde / légèrement inversés (l'ancien
 * tri purement chronologique mettait « Analyse » avant « Réception »).
 */
const STEP_RANK: Record<string, number> = {
  vivier_contacted: 1,
  received: 2,
  vivier_applied: 3,
  analyzed: 4,
  validated: 5,
  invited: 5,
  rejected_mail: 5,
  scheduled: 6,
  interview_realized: 7,
  interview_missed: 7,
  final_validated: 8,
  final_rejected: 8,
  dismissed: 9,
  // Après tout le reste : une correction suit le fait qu'elle corrige, et le
  // marqueur qu'elle pose est horodaté à la même seconde qu'elle.
  correction: 10,
};

/** Rang d'un événement — les corrections sont numérotées (clé React unique). */
function rankOf(key: string): number {
  if (key.startsWith('correction_')) return STEP_RANK.correction;
  return STEP_RANK[key] ?? 99;
}

/**
 * Assemble la frise. Événements omis si leur date est absente/sentinelle.
 * Tri par RANG de pipeline puis date (ordre métier garanti).
 */
export function buildCandidateTimeline(
  facts: CandidateTimelineFacts,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const push = (
    key: string,
    at: string | null,
    label: string,
    detail: string | null,
    tone: TimelineTone,
  ): void => {
    if (!at || isUnknownDate(at)) return;
    events.push({ key, at, label, detail, tone });
  };

  push(
    'received',
    facts.receivedAt,
    'Candidature reçue',
    `Canal : ${facts.source} · ${facts.fileName}`,
    'neutral',
  );
  push(
    'vivier_contacted',
    facts.vivierContactedAt,
    'Invité depuis le vivier',
    facts.fromVivier ? 'Repêché du vivier pour cette campagne' : null,
    'neutral',
  );
  push(
    'analyzed',
    facts.analyzedAt,
    'Analyse et scoring',
    `Score ${facts.totalScore}/100 · grille ${facts.criteriaVersion}`,
    'neutral',
  );
  push(
    'vivier_applied',
    facts.vivierAppliedAt,
    'Candidature rapprochée du vivier',
    null,
    'neutral',
  );
  const decider = facts.decidedByUserEmail
    ? ` · par ${facts.decidedByUserEmail}`
    : '';
  push(
    'validated',
    facts.validatedAt,
    'Candidat validé',
    `Acceptation tranchée en zone de validation${decider}`,
    'positive',
  );
  push(
    'invited',
    facts.invitationSentAt,
    'Invitation envoyée',
    null,
    'positive',
  );
  push(
    'rejected_mail',
    facts.rejectionSentAt,
    'Refus envoyé',
    facts.rejectionViaValidation
      ? `Refus tranché en zone de validation${decider}`
      : null,
    'negative',
  );
  // « RDV pris » : réservation Cal.com rattachée PAR UID (fiable, ≠ email) →
  // n'apparaît que pour la candidature réellement réservée.
  push(
    'scheduled',
    facts.scheduledAt,
    'Rendez-vous pris',
    'Entretien réservé via Cal.com',
    'positive',
  );
  push(
    'interview_realized',
    facts.interviewRealizedAt,
    'Entretien réalisé',
    null,
    'positive',
  );
  push(
    'interview_missed',
    facts.interviewMissedAt,
    'Entretien non réalisé',
    null,
    'negative',
  );
  push(
    'final_validated',
    facts.finalValidatedAt,
    'Retenu définitivement',
    null,
    'positive',
  );
  push('final_rejected', facts.finalRejectedAt, 'Non retenu', null, 'negative');
  // Classement sans suite : terminal NEUTRE (jamais un refus).
  push(
    'dismissed',
    facts.dismissedAt,
    'Classée sans suite',
    facts.dismissalReasonLabel ? `Motif : ${facts.dismissalReasonLabel}` : null,
    'neutral',
  );

  // Corrections — le journal est en AJOUT SEUL : le fait corrigé reste dans la
  // frise, la correction se pose APRÈS lui. On ne réécrit jamais l'histoire,
  // on l'allonge.
  facts.corrections.forEach((c, i) => {
    const transition =
      c.previousLabel && c.nextLabel
        ? `${c.previousLabel} → ${c.nextLabel}`
        : (c.nextLabel ?? c.previousLabel);
    const author = c.by ? ` · par ${c.by}` : '';
    const detail = [transition ? `${transition}${author}` : author.trim(), c.reason]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(' — ');
    push(
      `correction_${i}`,
      c.at,
      'Décision corrigée',
      detail || null,
      'neutral',
    );
  });

  events.sort((a, b) => {
    const ra = rankOf(a.key);
    const rb = rankOf(b.key);
    if (ra !== rb) return ra - rb;
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    return a.key < b.key ? -1 : 1;
  });
  return events;
}
