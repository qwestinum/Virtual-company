/**
 * Ce qu'il faut SAVOIR avant de corriger une décision — lecture SERVEUR.
 *
 * La moitié la plus importante du dialog n'est pas la liste des nouveaux
 * états : c'est ce qui a DÉJÀ été déclenché. Corriger ne rembobine rien — un
 * mail parti reste parti, un lien révoqué reste mort, un rendez-vous confirmé
 * reste au calendrier. Le dialog doit donc le dire AVANT la confirmation.
 *
 * Le bloc d'effets n'est JAMAIS vide : quand rien n'est parti, on l'écrit. Un
 * bloc absent se lit comme « pas vérifié », pas comme « rien à signaler ».
 */

import {
  correctionNoticesFor,
  correctionOptionsFor,
  resolveCurrentDecision,
} from '@/lib/candidatures/correction-options';
import { listJournalEntriesByActions } from '@/lib/db/repos/journal';
import {
  CANDIDATE_STAGE_LABELS,
  type CandidateStage,
} from '@/lib/reporting/candidate-stage';
import { loadStageSignals, stageFor } from '@/lib/reporting/stage-signals';
import { bookingLinkStateForAnalysis } from '@/lib/scheduling-host/campaign-booking';
import type {
  CorrectionSideEffect,
  CurrentDecision,
  DecisionCorrectionContext,
} from '@/types/decision-correction';
import type { CandidateAnalysisSummary } from '@/types/reporting';

const HITL_SENT_ACTION = 'hitl_validation_sent';
const HITL_NOT_SENT_ACTION = 'hitl_mail_not_sent';
const OUTREACH_ACTION = 'imap_outreach_mail';
const DISMISSED_ACTION = 'candidature_dismissed';

function frDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function frDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Faits d'envoi rattachés à CETTE candidature (par uid), les plus récents d'abord. */
type MailFacts = {
  /** Mail effectivement parti (décision HITL, refus/invitation auto). */
  sentAt: string | null;
  sentKind: 'invite' | 'reject' | 'dismissal' | null;
  /** Décision prise mais mail NON parti (panne ou choix). */
  notSentCause: 'skipped_by_user' | 'send_failed' | null;
  /** Horodatage + auteur de la décision de screening, quand ils existent. */
  hitlDecidedAt: string | null;
};

async function loadMailFacts(
  analysis: CandidateAnalysisSummary,
): Promise<MailFacts> {
  const facts: MailFacts = {
    sentAt: null,
    sentKind: null,
    notSentCause: null,
    hitlDecidedAt: null,
  };
  const entries = await listJournalEntriesByActions(
    [HITL_SENT_ACTION, HITL_NOT_SENT_ACTION, OUTREACH_ACTION, DISMISSED_ACTION],
    { campaignId: analysis.campaignId ?? undefined },
  ).catch(() => []);

  // Journal DESC : la première occurrence par fait est la plus récente.
  for (const e of entries) {
    if (text(e.payload.uid) !== analysis.uid) continue;
    if (e.action === HITL_SENT_ACTION) {
      if (!facts.hitlDecidedAt) facts.hitlDecidedAt = e.createdAt;
      if (e.payload.mailSent === true && !facts.sentAt) {
        facts.sentAt = e.createdAt;
        facts.sentKind = e.payload.decision === 'accept' ? 'invite' : 'reject';
      }
    } else if (e.action === HITL_NOT_SENT_ACTION) {
      if (!facts.notSentCause) {
        // Le journal DISTINGUE le choix de la panne — les confondre ferait
        // lire un incident là où il y a une décision, et inversement.
        facts.notSentCause =
          e.payload.cause === 'skipped_by_user' ? 'skipped_by_user' : 'send_failed';
      }
    } else if (e.action === OUTREACH_ACTION && e.payload.status === 'sent') {
      if (!facts.sentAt) {
        facts.sentAt = e.createdAt;
        facts.sentKind = e.payload.mode === 'invite' ? 'invite' : 'reject';
      }
    } else if (e.action === DISMISSED_ACTION) {
      if (e.payload.mailStatus === 'sent' && !facts.sentAt) {
        facts.sentAt = e.createdAt;
        facts.sentKind = 'dismissal';
      }
    }
  }
  return facts;
}

const MAIL_KIND_LABEL: Record<NonNullable<MailFacts['sentKind']>, string> = {
  invite: 'Un mail d’invitation a été envoyé',
  reject: 'Un mail de refus a été envoyé',
  dismissal: 'Un mail d’information a été envoyé',
};

function mailSideEffects(
  current: CurrentDecision,
  facts: MailFacts,
  candidateEmail: string | null,
): CorrectionSideEffect[] {
  // Un marquage d'entretien ou un verdict final ne déclenche AUCUN envoi :
  // c'est un fait du produit, pas une observation du journal — on l'affirme.
  if (current.kind === 'interview' || current.kind === 'final_verdict') {
    return [
      {
        code: 'no_mail',
        text: 'Aucun message n’est parti pour cette décision : un marquage d’entretien ou un verdict final ne déclenche aucun envoi.',
        emphasis: 'info',
      },
    ];
  }
  const out: CorrectionSideEffect[] = [];
  if (facts.sentAt && facts.sentKind) {
    const to = candidateEmail ? ` à ${candidateEmail}` : '';
    out.push({
      code: 'mail_sent',
      text: `${MAIL_KIND_LABEL[facts.sentKind]} le ${frDate(facts.sentAt)}${to} — la correction ne l’annule pas.`,
      emphasis: 'warning',
    });
  } else if (facts.notSentCause) {
    out.push({
      code: 'mail_not_sent',
      text:
        facts.notSentCause === 'skipped_by_user'
          ? 'La décision a été enregistrée sans envoi (envoi volontairement sauté) : le candidat n’a jamais été contacté.'
          : 'La décision a été enregistrée mais le mail n’est PAS parti (échec d’envoi) : le candidat n’a jamais été contacté.',
      emphasis: 'warning',
    });
  } else {
    out.push({
      code: 'no_mail',
      text: 'Aucun message n’est parti pour cette décision.',
      emphasis: 'info',
    });
  }
  return out;
}

/**
 * Assemble le contexte servi au dialog. `current === null` ⇒ rien à corriger :
 * l'action ne doit PAS s'afficher.
 */
export async function loadDecisionCorrectionContext(
  analysis: CandidateAnalysisSummary,
): Promise<DecisionCorrectionContext> {
  const signals = await loadStageSignals(
    analysis.campaignId ? { campaignId: analysis.campaignId } : {},
  );
  const stage: CandidateStage = stageFor(analysis, signals);
  const current = resolveCurrentDecision({
    stage,
    interviewEffect: signals.interviewMarks.get(analysis.uid) ?? null,
    validationEffect: signals.validationMarks.get(analysis.uid) ?? null,
    dismissalReason: analysis.dismissalReason,
  });

  const base = {
    analysisId: analysis.id,
    uid: analysis.uid,
    candidateName: analysis.candidateName,
    campaignId: analysis.campaignId,
    stage,
    stageLabel: CANDIDATE_STAGE_LABELS[stage],
  };

  if (!current) {
    return {
      ...base,
      current: null,
      decidedAt: null,
      decidedBy: null,
      sideEffects: [],
      options: [],
      notices: [],
    };
  }

  const [facts, linkState, scheduled] = await Promise.all([
    loadMailFacts(analysis),
    bookingLinkStateForAnalysis(analysis.campaignId, analysis.id),
    loadScheduledInterview(analysis.uid),
  ]);

  const sideEffects = mailSideEffects(
    current,
    facts,
    analysis.candidateEmail,
  );

  // Lien de réservation. Le régime Cal.com n'a pas d'objet lien : on le dit.
  if (linkState === null) {
    sideEffects.push({
      code: 'link_none',
      text: 'Réservation Cal.com : il n’existe aucun lien nominatif à interroger pour cette campagne.',
      emphasis: 'info',
    });
  } else if (linkState.hasActive) {
    sideEffects.push({
      code: 'link_active',
      text: 'Un lien de réservation est encore actif. Il sera désactivé si vous écartez la candidature — aucune notification n’est envoyée.',
      emphasis: 'warning',
    });
  } else if (linkState.statuses.includes('revoked')) {
    sideEffects.push({
      code: 'link_revoked',
      text: 'Le lien de réservation a été révoqué. La correction ne le réactive pas.',
      emphasis: 'info',
    });
  }

  if (scheduled) {
    sideEffects.push({
      code: 'booking_confirmed',
      text: `Un rendez-vous est confirmé le ${frDateTime(scheduled)}. La correction ne l’annule pas.`,
      emphasis: 'warning',
    });
  }

  return {
    ...base,
    current,
    decidedAt: decidedAtFor(current, analysis, signals.interviewMarkedAt, facts),
    // Les marqueurs journalisés avant la capture d'identité n'ont AUCUN
    // auteur : `null` est la réponse honnête, et le dialog l'écrit.
    decidedBy:
      current.kind === 'dismissal'
        ? (analysis.dismissedByUser?.email ?? null)
        : current.kind === 'screening_decision'
          ? (analysis.decidedByUser?.email ?? null)
          : null,
    sideEffects,
    options: correctionOptionsFor(current),
    notices: correctionNoticesFor(current),
  };
}

function decidedAtFor(
  current: CurrentDecision,
  analysis: CandidateAnalysisSummary,
  interviewMarkedAt: ReadonlyMap<string, string>,
  facts: MailFacts,
): string | null {
  switch (current.kind) {
    case 'interview':
      return interviewMarkedAt.get(analysis.uid) ?? null;
    case 'final_verdict':
      // Le verdict n'a pas d'horodatage exposé par les signaux d'étape : on
      // préfère ne rien afficher plutôt qu'une date approchée.
      return null;
    case 'screening_decision':
      return facts.hitlDecidedAt;
    case 'dismissal':
      return analysis.dismissedAt;
    default:
      return null;
  }
}

async function loadScheduledInterview(uid: string): Promise<string | null> {
  const { getScheduledInterviewByUid } = await import(
    '@/lib/db/repos/interview-briefs'
  );
  const rdv = await getScheduledInterviewByUid(uid).catch(() => null);
  return rdv?.startAt ?? null;
}
