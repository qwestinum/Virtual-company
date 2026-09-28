/**
 * Renvoyer un lien de réservation à un candidat — cœur PARTAGÉ.
 *
 * Deux situations, un seul message :
 *   - `reschedule` : le cabinet reprend le créneau qu'il avait donné. Le
 *     rendez-vous est décommandé SANS prévenir le candidat, parce que le
 *     message qui suit le lui dit — avec des excuses et un nouveau lien.
 *   - `reinvite`   : le candidat a annulé lui-même. On lui rouvre la porte.
 *   - `no_show`    : le candidat ne s'est pas présenté et le recruteur lui
 *     repropose un créneau (dialog d'absence). Le rendez-vous MANQUÉ est
 *     décommandé sans le notifier, les liens encore actifs sont révoqués, le
 *     briefing redevient « en attente de réservation » TOUT DE SUITE — le
 *     dossier redescend en « Invité » (étape dérivée du briefing, aucun état
 *     parallèle) et repasse « RDV pris » à la prochaine réservation. Une
 *     DEUXIÈME absence ne rouvre pas une troisième fois : `repeated_no_show`,
 *     et le signal métier le dit (feat/feedback-candidat → fix/vivier-replanif).
 *
 * Ce qu'on ne fait PLUS : enchaîner une annulation « votre rendez-vous est
 * annulé » puis une invitation « votre candidature est retenue ». Deux mails,
 * dont un qui réannonce une nouvelle déjà reçue, au moment précis où on lui
 * prend son créneau. La suite des deux gestes vit donc ici, côté serveur, et
 * non plus dans l'écran : un échec réseau entre les deux laissait le candidat
 * décommandé et jamais réinvité.
 */
import { NO_SHOW_RESCHEDULED_CAUSE, REISSUE_ACTION } from './reissue-constants';
import { buildInterviewMail } from '@/lib/agents/server/interview-mail';
import { getSynthesisReplyToForCampaign } from '@/lib/campaign/synthesis-recipients';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { sendEmail } from '@/lib/email/client';
import { getLatestBriefByUid, markBriefAwaitingBooking } from '@/lib/db/repos/interview-briefs';
import { listJournalEntriesByActions } from '@/lib/db/repos/journal';
import { queueInterviewBrief } from '@/lib/interview/queue-brief';
import { formatDateTime } from '@/lib/scheduling';
import {
  cancelBookingForAnalysis,
  createCampaignBookingContext,
  isNativeSchedulingCampaign,
  nextReissueKey,
  revokeCampaignBookingLink,
} from '@/lib/scheduling-host/campaign-booking';
import { cvApplicationToMailCandidate } from '@/types/mail-candidate';

export type ReissueKind = 'reschedule' | 'reinvite' | 'no_show';

export { NO_SHOW_RESCHEDULED_CAUSE, REISSUE_ACTION } from './reissue-constants';

export type ReissueOutcome =
  | { status: 'sent' | 'send_failed'; error?: string | null }
  | { status: 'not_found' }
  | { status: 'dismissed' }
  | { status: 'not_native' }
  | { status: 'no_candidate_email' }
  | { status: 'link_unavailable'; error: string }
  /** Deuxième absence : pas de troisième relance. */
  | { status: 'repeated_no_show' };

/**
 * Phrase factuelle en tête du message. Écrite ICI et pas dans le modèle
 * éditable : au moment où le DRH rédige son modèle, il ne peut pas savoir qui
 * annulera ni quand.
 */
function introFor(kind: ReissueKind, previousStartAt: string | null): string {
  const when = previousStartAt
    ? ` prévu le ${formatDateTime(previousStartAt, 'Europe/Paris')}`
    : '';
  switch (kind) {
    case 'reschedule':
      return `Nous sommes désolés : nous devons décaler l’entretien${when} que vous aviez réservé.`;
    case 'no_show':
      // Un fait, sans reproche : le candidat a pu avoir un empêchement.
      return `Nous n’avons pas pu nous rencontrer lors de l’entretien${when}. Si vous le souhaitez, vous pouvez choisir un nouveau créneau.`;
    case 'reinvite':
      return `Vous avez annulé l’entretien${when} que vous aviez réservé — nous restons bien sûr intéressés par votre candidature.`;
  }
}

export async function reissueBookingLink(params: {
  analysisId: string;
  kind: ReissueKind;
  /** Rendez-vous à décommander d'abord (replanification). */
  actorUserId: string | null;
}): Promise<ReissueOutcome> {
  const analysis = await getCandidateAnalysis(params.analysisId);
  if (!analysis) return { status: 'not_found' };
  // Une candidature classée sans suite a vu ses liens révoqués : lui en
  // renvoyer un la rouvrirait par la bande.
  if (analysis.dismissedAt) return { status: 'dismissed' };

  const campaignId = analysis.campaignId;
  // Une campagne hors campagne (tâche isolée) n'a ni référent ni agenda.
  if (!campaignId) return { status: 'not_native' };
  if (!analysis.candidateEmail) return { status: 'no_candidate_email' };

  // COEXISTENCE : en régime Cal.com il n'y a ni lien à révoquer ni clé à
  // incrémenter — seulement le message à renvoyer, avec le lien d'agenda
  // résolu comme d'habitude. Refuser ici laisserait le bouton principal de la
  // page grisé pour la moitié du parc pendant toute la coexistence.
  //
  // Contexte de réservation résolu UNE fois pour toute la requête (campagne,
  // cible, liens, ressource du référent), transmis à chaque étape.
  const bookingContext = createCampaignBookingContext(campaignId);
  // Lectures dont on aura besoin quoi qu'il arrive, lancées dès maintenant :
  // la réponse de relecture du destinataire, et le briefing (seule source du
  // créneau tombé si aucun rendez-vous natif n'est trouvé — et dans ce cas
  // aucune annulation n'a eu lieu, il n'a donc pas pu changer entre-temps).
  const replyToPromise = getSynthesisReplyToForCampaign(campaignId);
  const briefPromise = getLatestBriefByUid(analysis.uid).catch(() => null);
  replyToPromise.catch(() => undefined);
  const native = await isNativeSchedulingCampaign(campaignId, bookingContext);

  // 0. Absence : une deuxième ne rouvre pas une troisième fois.
  if (params.kind === 'no_show' && (await previousNoShows(campaignId, analysis.uid)) >= 1) {
    return { status: 'repeated_no_show' };
  }

  // 1. Décommander, SANS notifier : le message qui suit porte la nouvelle.
  let previousStartAt: string | null = null;
  if ((params.kind === 'reschedule' || params.kind === 'no_show') && native) {
    const cancelled = await cancelBookingForAnalysis({
      campaignId,
      analysisId: analysis.id,
      reason:
        params.kind === 'no_show'
          ? 'candidat absent — nouveau créneau proposé'
          : 'replanification par le cabinet',
      notifyAttendee: false,
      onBooking: (booking) => {
        previousStartAt = booking.startAt;
      },
      context: bookingContext,
    });
    if (cancelled === 'none') {
      // Rien à décommander : on continue quand même — l'objectif est que le
      // candidat reçoive un lien valide, pas que l'annulation ait eu lieu.
      console.warn('[reissue] aucun rendez-vous confirmé à décommander');
    }
  }

  // 1 bis. Absence : le dossier redescend en « Invité » SANS attendre le rail.
  // Les liens encore actifs meurent (le nouveau part juste après), et le
  // briefing repasse « en attente de réservation » — en natif, le
  // consommateur de l'annulation le ferait dans la minute ; en Cal.com, rien
  // ne le ferait. L'étape se DÉRIVE de ce briefing : aucun état parallèle.
  if (params.kind === 'no_show') {
    if (native) {
      await revokeCampaignBookingLink(
        campaignId,
        analysis.id,
        'candidat absent — lien remplacé',
        bookingContext,
      ).catch((err) => console.error('[reissue] révocation KO', err));
    }
    const brief = await briefPromise;
    if (brief?.status === 'scheduled' && brief.bookingUid) {
      await markBriefAwaitingBooking(brief.bookingUid).catch((err) =>
        console.error('[reissue] remise en attente du briefing KO', err),
      );
    }
  }

  // 2. UN message : excuses (ou accusé d'annulation) + nouveau lien.
  // Régime Cal.com : le créneau tombé se lit sur le briefing, seule trace du
  // rendez-vous côté ORQA (la réservation vit chez le prestataire).
  if (!previousStartAt) {
    const brief = await briefPromise;
    previousStartAt = brief?.interviewStartAt ?? null;
  }

  const candidate = cvApplicationToMailCandidate(analysis.application);
  // Une clé neuve n'a de sens que pour un lien nominatif ; en Cal.com, le lien
  // est le même pour tout le monde et n'a pas de génération.
  const linkKey = native
    ? await nextReissueKey(campaignId, analysis.id, bookingContext)
    : analysis.id;
  const built = await buildInterviewMail({
    mode: 'reschedule',
    campaignId,
    jobTitle: null,
    candidate,
    analysisId: analysis.id,
    linkKey,
    uid: analysis.uid,
    intro: introFor(params.kind, previousStartAt),
    bookingContext,
  });
  if (built.blocked) {
    return {
      status: 'link_unavailable',
      error: built.blockedReason ?? 'native_link_unavailable',
    };
  }

  const replyTo = (await replyToPromise) || undefined;
  // 3. Le briefing doit être EN ATTENTE pour que la prochaine réservation le
  // trouve. Idempotent par (campagne, email). Il était déjà mis en file que
  // l'envoi ait réussi ou non : les deux gestes sont indépendants et partent
  // ensemble ; le journal, lui, attend les deux.
  const [sent] = await Promise.all([
    sendEmail({
      to: analysis.candidateEmail,
      subject: built.mail.subject,
      html: built.mail.html,
      replyTo,
    }),
    queueInterviewBrief({
      campaignId,
      jobTitle: null,
      candidate,
      actor: 'user',
      uid: analysis.uid,
    }).catch((err) => console.error('[reissue] mise en file KO', err)),
  ]);

  // Littéral, pas la constante : la garde du Mail Composer lit dans le SOURCE
  // les actions qui portent un statut d'envoi (REISSUE_ACTION === ceci).
  await appendJournalEntry({
    action: 'interview_link_reissued',
    actor: 'user',
    campaignId,
    payload: {
      uid: analysis.uid,
      analysisId: analysis.id,
      kind: params.kind,
      ...(params.kind === 'no_show' ? { cause: NO_SHOW_RESCHEDULED_CAUSE } : {}),
      regime: native ? 'native' : 'calcom',
      linkKey,
      previousStartAt,
      candidateName: analysis.candidateName,
      candidateEmail: analysis.candidateEmail,
      mailStatus: sent.ok ? 'sent' : (sent.error ?? 'send_failed'),
      mailSent: sent.ok,
      decidedByUserId: params.actorUserId,
    },
  }).catch(() => {});

  return sent.ok
    ? { status: 'sent' }
    : { status: 'send_failed', error: sent.error ?? null };
}

/** Nombre de replanifications après absence déjà faites pour ce dossier. */
async function previousNoShows(campaignId: string, uid: string): Promise<number> {
  const entries = await listJournalEntriesByActions([REISSUE_ACTION], { campaignId });
  return entries.filter((e) => e.payload.uid === uid && e.payload.kind === 'no_show').length;
}
