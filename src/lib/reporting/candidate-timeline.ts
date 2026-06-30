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
  /** Journal imap_outreach_mail (mode invite, sent). */
  invitationSentAt: string | null;
  /** Journal imap_outreach_mail (mode reject, sent). */
  rejectionSentAt: string | null;
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
};

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
  push(
    'validated',
    facts.validatedAt,
    'Candidat validé',
    'Acceptation tranchée en zone de validation',
    'positive',
  );
  push(
    'invited',
    facts.invitationSentAt,
    'Invitation envoyée',
    null,
    'positive',
  );
  push('rejected_mail', facts.rejectionSentAt, 'Refus envoyé', null, 'negative');
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

  events.sort((a, b) => {
    const ra = STEP_RANK[a.key] ?? 99;
    const rb = STEP_RANK[b.key] ?? 99;
    if (ra !== rb) return ra - rb;
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    return a.key < b.key ? -1 : 1;
  });
  return events;
}
