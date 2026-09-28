/**
 * Cœur SERVEUR du classement sans suite — partagé par l'action individuelle,
 * la clôture de campagne et le flux GO (jamais deux implémentations).
 *
 * Protocole ordonné (concurrence maîtrisée) :
 *   1. void de la validation HITL `pending` (conditionnel) — un `sending`
 *      (envoi en cours) REFUSE le classement (`deferred_sending`) : un mail
 *      part peut-être, on ne classe pas sous incertitude ;
 *   2. classement conditionnel de l'analyse (`dismissed_at is null`, un seul
 *      gagnant, idempotent) ;
 *   3. annulation des briefs d'entretien ouverts (booking posthume bloqué),
 *      puis, en réservation native, révocation du lien et décommande d'un
 *      rendez-vous à venir SANS notifier le candidat (une seule voix) ;
 *   4. message au candidat OPTIONNEL, par le chemin UNIQUE des messages après
 *      décision (`recordFeedback`, feat/feedback-candidat) : gabarit « Sans
 *      suite » des Réglages avec [motif], ou « je préviens moi-même ». Même
 *      clé de verrou deux-phases qu'avant (`candidature_dismissal`/analysisId/
 *      `dismiss`) : un seul message sans suite par candidature, quel que soit
 *      le chemin (individuel, clôture, rail) ;
 *   5. journal honnête : `candidature_dismissed` (+ statut mail réel),
 *      `candidature_dismissal_mail_not_sent` si le mail demandé n'est pas parti.
 */

import {
  feedbackContextFor,
  loadFeedbackBase,
  recordFeedback,
  type FeedbackBase,
  type RecordFeedbackOutcome,
} from '@/lib/candidatures/feedback';
import { dismissalMotif, renderFeedbackProposal } from '@/lib/candidatures/feedback-template';
import {
  dismissCandidateAnalysis,
  revertCandidateAnalysisDismissal,
} from '@/lib/db/repos/candidate-analyses';
import {
  cancelOpenBriefsForCandidate,
  getLatestBriefByUid,
  markBriefAwaitingBooking,
  restoreCancelledBriefsForCandidate,
} from '@/lib/db/repos/interview-briefs';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  listOpenValidationsForUid,
  listVoidValidations,
  unvoidPendingValidation,
  voidPendingValidation,
} from '@/lib/db/repos/pending-validations';
import {
  cancelBookingForAnalysis,
  createCampaignBookingContext,
  type CampaignBookingContext,
  isBookingStillConfirmed,
  revokeCampaignBookingLink,
} from '@/lib/scheduling-host/campaign-booking';
import { dismissalMailAllowed, type DismissalReason } from '@/types/dismissal';
import type { DecidedBy, HumanDecider } from '@/types/hitl';
import type { CandidateAnalysisSummary } from '@/types/reporting';
import type { FeedbackChoice } from '@/types/candidate-feedback';

export type DismissalMailStatus =
  | 'sent'
  | 'duplicate'
  | 'skipped_no_email'
  | 'skipped_no_config'
  | 'send_failed'
  | 'not_requested'
  | 'not_applicable'
  /** « Je préviens moi-même » : aucun envoi, le canal est tracé. */
  | 'self_informed';

export type DismissCandidatureResult =
  | {
      status: 'dismissed';
      mailStatus: DismissalMailStatus;
      /** Le message au candidat (ligne `candidate_feedback`), s'il y en a un. */
      feedback: RecordFeedbackOutcome | { error: 'record_failed' } | null;
    }
  | { status: 'already_dismissed' }
  | { status: 'deferred_sending' }
  | { status: 'not_found' };

/**
 * Ce qu'une série de classements d'une MÊME campagne peut partager : le
 * contexte de réservation (campagne, cible) et la base des messages
 * (gabarits, signataire, poste). Créé par l'appelant pour la durée de SA
 * requête — jamais conservé au-delà.
 */
export type DismissalSharedContext = {
  bookingContext?: CampaignBookingContext;
  feedbackBase?: () => Promise<FeedbackBase>;
};

export function createDismissalSharedContext(
  campaignId: string,
  actor: HumanDecider | null = null,
): DismissalSharedContext {
  const bookingContext = createCampaignBookingContext(campaignId);
  let base: Promise<FeedbackBase> | null = null;
  return {
    bookingContext,
    feedbackBase: () => (base ??= loadFeedbackBase(campaignId, actor)),
  };
}

/**
 * Le message « Sans suite » PROPOSÉ par les Réglages, tel qu'un envoi groupé
 * le fait partir (aucun aperçu par dossier : c'est le comportement de la
 * clôture). `null` : raison sans message (doublon, invalide) ou pas d'adresse.
 */
export function groupDismissalMessage(
  base: FeedbackBase,
  analysis: Pick<CandidateAnalysisSummary, 'candidateName' | 'candidateEmail'>,
  reason: DismissalReason,
): FeedbackChoice | null {
  const motif = dismissalMotif(reason);
  if (!motif || !analysis.candidateEmail) return null;
  const ctx = feedbackContextFor(base, analysis);
  const { subject, body } = renderFeedbackProposal(ctx.templates.feedbackDismissedTemplate, {
    ...ctx.vars,
    motif,
  });
  return { mode: 'send', subject, body };
}

/**
 * Trouve la validation HITL ouverte (pending/sending) d'une candidature —
 * rapprochée par uid + campagne (même règle que les compteurs).
 */
async function findOpenValidationId(
  analysis: CandidateAnalysisSummary,
): Promise<string | null> {
  // Lecture ciblée sur l'uid (même filtre, même ordre) plutôt que la file
  // entière relue pour chaque dossier.
  const pending = await listOpenValidationsForUid(analysis.uid);
  const match = pending.find(
    (v) =>
      v.payload?.uid === analysis.uid &&
      (analysis.campaignId === null || v.campaignId === analysis.campaignId),
  );
  return match?.id ?? null;
}

export type DismissCandidatureOptions = {
  reason: DismissalReason;
  /**
   * Le message au candidat : le choix de l'écran (individuel) ou le gabarit
   * rendu par le lot (clôture). `null` : aucun message. La matrice par raison
   * reste le garde-fou en aval — jamais de message pour doublon/invalide.
   */
  message: FeedbackChoice | null;
  /** 'user' = action individuelle / confirmation humaine ; 'auto' réservé aux
   * flux système futurs (aujourd'hui tous les chemins passent par un humain). */
  dismissedBy: DecidedBy;
  dismissedByUser: HumanDecider | null;
  actor: string;
};

/**
 * Classe UNE candidature sans suite (protocole complet, cf. header).
 * Idempotent : rejouer rend `already_dismissed` sans effet de bord.
 */
export async function dismissCandidature(
  analysis: CandidateAnalysisSummary,
  opts: DismissCandidatureOptions,
  shared?: DismissalSharedContext,
): Promise<DismissCandidatureResult> {
  // 1. Fermer la validation HITL ouverte AVANT le classement — la porte
  // d'envoi est verrouillée en premier (un void n'est plus réservable).
  const validationId = await findOpenValidationId(analysis);
  let voidedValidationId: string | null = null;
  if (validationId) {
    const outcome = await voidPendingValidation(validationId);
    if (outcome === 'in_flight') return { status: 'deferred_sending' };
    // `already_sent` : la décision est partie entre-temps — on classe quand
    // même (le classement domine l'étape dérivée), la trace mail existe.
    if (outcome === 'voided') voidedValidationId = validationId;
  }

  // 2. Classement conditionnel (un seul gagnant).
  const outcome = await dismissCandidateAnalysis({
    analysisId: analysis.id,
    reason: opts.reason,
    dismissedBy: opts.dismissedBy,
    dismissedByUser: opts.dismissedByUser,
  });
  if (outcome === 'not_found') return { status: 'not_found' };
  if (outcome === 'already_dismissed') return { status: 'already_dismissed' };

  // Contexte de réservation : celui du lot s'il y en a un, sinon un contexte
  // propre à ce classement. Les LIENS, eux, sont relus pour chaque dossier (un
  // lien émis pendant une clôture doit être révoqué) : seules la campagne et
  // la cible, stables, sont partagées.
  const bookingContext = analysis.campaignId
    ? (shared?.bookingContext?.fork() ?? createCampaignBookingContext(analysis.campaignId))
    : undefined;
  // La base du message part dès maintenant (elle ne dépend de rien de ce qui
  // suit) ; l'ENVOI, lui, reste après les étapes 3 et 3 bis.
  const wantsMessage = opts.message !== null && dismissalMailAllowed(opts.reason);
  const baseP = wantsMessage
    ? (shared?.feedbackBase?.() ?? loadFeedbackBase(analysis.campaignId, opts.dismissedByUser))
    : null;
  baseP?.catch(() => undefined);

  // 3. Briefs d'entretien : annulation best-effort (un échec ne doit pas
  // annuler le classement déjà posé — signalé au journal via mailStatus).
  try {
    await cancelOpenBriefsForCandidate({
      uid: analysis.uid,
      campaignId: analysis.campaignId,
      email: analysis.candidateEmail,
    });
  } catch (err) {
    console.error('[dismissal] cancelOpenBriefsForCandidate failed', err);
  }

  // 3 bis. Réservation NATIVE : le lien meurt vraiment, et un rendez-vous à
  // venir est décommandé. `notifyAttendee: false` — le mail d'information de
  // l'étape 4 porte déjà la nouvelle ; deux messages pour un même fait, c'est
  // une voix de trop. Best-effort, comme les briefs.
  let bookingCancelled = false;
  try {
    // Toujours dans CET ordre : une révocation en échec n'annule pas le
    // rendez-vous (et le journal le dit). Le contexte partagé évite seulement
    // de relire campagne, cible et liens entre les deux gestes.
    await revokeCampaignBookingLink(
      analysis.campaignId,
      analysis.id,
      `classée sans suite (${opts.reason})`,
      bookingContext,
    );
    bookingCancelled =
      (await cancelBookingForAnalysis({
        campaignId: analysis.campaignId,
        analysisId: analysis.id,
        reason: 'candidature classée sans suite',
        notifyAttendee: false,
        context: bookingContext,
      })) === 'cancelled';
  } catch (err) {
    console.error('[dismissal] révocation/annulation de réservation KO', err);
  }

  // 4. Message au candidat — le chemin unique des messages après décision.
  let mailStatus: DismissalMailStatus = dismissalMailAllowed(opts.reason)
    ? 'not_requested'
    : 'not_applicable';
  let feedback: RecordFeedbackOutcome | { error: 'record_failed' } | null = null;
  if (wantsMessage && opts.message && baseP) {
    try {
      feedback = await recordFeedback({
        analysis,
        kind: 'sans_suite',
        choice: opts.message,
        actor: opts.dismissedByUser,
        cause: opts.reason,
        context: feedbackContextFor(await baseP, analysis),
      });
      const sent = feedback.mailStatus;
      mailStatus =
        feedback.channel !== 'mail'
          ? 'self_informed'
          : sent === null || sent === 'pending'
            ? 'send_failed'
            : sent;
    } catch (err) {
      console.error('[dismissal] message au candidat KO', err);
      feedback = { error: 'record_failed' };
      mailStatus = opts.message.mode === 'send' ? 'send_failed' : 'not_requested';
    }
  }

  // 5. Journal honnête.
  await appendJournalEntry({
    action: 'candidature_dismissed',
    actor: opts.actor,
    campaignId: analysis.campaignId,
    payload: {
      uid: analysis.uid,
      analysisId: analysis.id,
      candidateName: analysis.candidateName,
      candidateEmail: analysis.candidateEmail,
      reason: opts.reason,
      voidedValidationId,
      // Le rendez-vous décommandé au nom de l'organisation : le candidat n'en
      // reçoit PAS d'avis séparé (une seule voix), donc la trace vit ici.
      bookingCancelled,
      mailStatus,
      mailSent: mailStatus === 'sent' || mailStatus === 'duplicate',
      ...(feedback && !('error' in feedback) ? { feedbackId: feedback.feedbackId } : {}),
    },
  });
  if (opts.message?.mode === 'send' && wantsMessage && mailStatus !== 'sent' && mailStatus !== 'duplicate') {
    await appendJournalEntry({
      action: 'candidature_dismissal_mail_not_sent',
      actor: opts.actor,
      campaignId: analysis.campaignId,
      payload: {
        uid: analysis.uid,
        analysisId: analysis.id,
        candidateName: analysis.candidateName,
        candidateEmail: analysis.candidateEmail,
        reason: opts.reason,
        mailStatus,
      },
    });
  }

  return { status: 'dismissed', mailStatus, feedback };
}

export type ReopenResult = 'reopened' | 'not_dismissed';

/**
 * Rouvre une candidature classée par ERREUR : lève le classement, restaure la
 * validation voidée et les briefs annulés. Le mail d'information déjà parti ne
 * se dé-envoie pas (rappelé côté UI) — le claim confirmé reste en place, un
 * futur re-classement ne RE-enverra donc pas de mail (voulu).
 */
export async function reopenCandidature(
  analysis: CandidateAnalysisSummary,
  actor: string,
): Promise<ReopenResult> {
  const outcome = await revertCandidateAnalysisDismissal(analysis.id);
  if (outcome === 'not_dismissed') return 'not_dismissed';

  // Restaurations best-effort : la réouverture de l'analyse est le fait
  // principal ; le reste se répare à la main si un hoquet survient (journalisé).
  let restoredValidation = false;
  try {
    const validationId = await findVoidValidationId(analysis);
    if (validationId) {
      restoredValidation =
        (await unvoidPendingValidation(validationId)) === 'restored';
    }
  } catch (err) {
    console.error('[dismissal] unvoid failed', err);
  }
  let restoredBriefs = 0;
  try {
    restoredBriefs = await restoreCancelledBriefsForCandidate({
      uid: analysis.uid,
    });
    // La restauration relit `booking_uid` comme preuve d'un rendez-vous pris.
    // En réservation native, ce rendez-vous a pu être DÉCOMMANDÉ pendant le
    // classement : le briefing repart alors « en attente de réservation »
    // plutôt que d'afficher un créneau qui n'existe plus. Un identifiant hors
    // module (Cal.com) rend `null` ⇒ comportement historique conservé.
    const restored = await getLatestBriefByUid(analysis.uid).catch(() => null);
    const bookingUid = restored?.bookingUid ?? null;
    if ((await isBookingStillConfirmed(bookingUid)) === false && bookingUid) {
      await markBriefAwaitingBooking(bookingUid);
    }
  } catch (err) {
    console.error('[dismissal] brief restore failed', err);
  }

  await appendJournalEntry({
    action: 'candidature_dismissal_reverted',
    actor,
    campaignId: analysis.campaignId,
    payload: {
      uid: analysis.uid,
      analysisId: analysis.id,
      candidateName: analysis.candidateName,
      restoredValidation,
      restoredBriefs,
    },
  });
  return 'reopened';
}

/** Validation `void` de la candidature (pour la réouverture) — par uid. */
async function findVoidValidationId(
  analysis: CandidateAnalysisSummary,
): Promise<string | null> {
  const voided = await listVoidValidations();
  const match = voided.find(
    (v) =>
      v.payload?.uid === analysis.uid &&
      (analysis.campaignId === null || v.campaignId === analysis.campaignId),
  );
  return match?.id ?? null;
}
