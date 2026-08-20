/**
 * Renvoyer un lien de réservation à un candidat — cœur PARTAGÉ.
 *
 * Deux situations, un seul message :
 *   - `reschedule` : le cabinet reprend le créneau qu'il avait donné. Le
 *     rendez-vous est décommandé SANS prévenir le candidat, parce que le
 *     message qui suit le lui dit — avec des excuses et un nouveau lien.
 *   - `reinvite`   : le candidat a annulé lui-même. On lui rouvre la porte.
 *
 * Ce qu'on ne fait PLUS : enchaîner une annulation « votre rendez-vous est
 * annulé » puis une invitation « votre candidature est retenue ». Deux mails,
 * dont un qui réannonce une nouvelle déjà reçue, au moment précis où on lui
 * prend son créneau. La suite des deux gestes vit donc ici, côté serveur, et
 * non plus dans l'écran : un échec réseau entre les deux laissait le candidat
 * décommandé et jamais réinvité.
 */
import { buildInterviewMail } from '@/lib/agents/server/interview-mail';
import { getSynthesisReplyToForCampaign } from '@/lib/campaign/synthesis-recipients';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { sendEmail } from '@/lib/email/client';
import { getLatestBriefByUid } from '@/lib/db/repos/interview-briefs';
import { queueInterviewBrief } from '@/lib/interview/queue-brief';
import { formatDateTime } from '@/lib/scheduling';
import {
  cancelBookingForAnalysis,
  isNativeSchedulingCampaign,
  nextReissueKey,
} from '@/lib/scheduling-host/campaign-booking';
import { cvApplicationToMailCandidate } from '@/types/mail-candidate';

export type ReissueKind = 'reschedule' | 'reinvite';

export type ReissueOutcome =
  | { status: 'sent' | 'send_failed'; error?: string | null }
  | { status: 'not_found' }
  | { status: 'dismissed' }
  | { status: 'not_native' }
  | { status: 'no_candidate_email' }
  | { status: 'link_unavailable'; error: string };

/**
 * Phrase factuelle en tête du message. Écrite ICI et pas dans le modèle
 * éditable : au moment où le DRH rédige son modèle, il ne peut pas savoir qui
 * annulera ni quand.
 */
function introFor(kind: ReissueKind, previousStartAt: string | null): string {
  const when = previousStartAt
    ? ` prévu le ${formatDateTime(previousStartAt, 'Europe/Paris')}`
    : '';
  return kind === 'reschedule'
    ? `Nous sommes désolés : nous devons décaler l’entretien${when} que vous aviez réservé.`
    : `Vous avez annulé l’entretien${when} que vous aviez réservé — nous restons bien sûr intéressés par votre candidature.`;
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
  const native = await isNativeSchedulingCampaign(campaignId);

  // 1. Décommander, SANS notifier : le message qui suit porte la nouvelle.
  let previousStartAt: string | null = null;
  if (params.kind === 'reschedule' && native) {
    const cancelled = await cancelBookingForAnalysis({
      campaignId,
      analysisId: analysis.id,
      reason: 'replanification par le cabinet',
      notifyAttendee: false,
      onBooking: (booking) => {
        previousStartAt = booking.startAt;
      },
    });
    if (cancelled === 'none') {
      // Rien à décommander : on continue quand même — l'objectif est que le
      // candidat reçoive un lien valide, pas que l'annulation ait eu lieu.
      console.warn('[reissue] aucun rendez-vous confirmé à décommander');
    }
  }

  // 2. UN message : excuses (ou accusé d'annulation) + nouveau lien.
  // Régime Cal.com : le créneau tombé se lit sur le briefing, seule trace du
  // rendez-vous côté ORQA (la réservation vit chez le prestataire).
  if (!previousStartAt) {
    const brief = await getLatestBriefByUid(analysis.uid).catch(() => null);
    previousStartAt = brief?.interviewStartAt ?? null;
  }

  const candidate = cvApplicationToMailCandidate(analysis.application);
  // Une clé neuve n'a de sens que pour un lien nominatif ; en Cal.com, le lien
  // est le même pour tout le monde et n'a pas de génération.
  const linkKey = native
    ? await nextReissueKey(campaignId, analysis.id)
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
  });
  if (built.blocked) {
    return {
      status: 'link_unavailable',
      error: built.blockedReason ?? 'native_link_unavailable',
    };
  }

  const sent = await sendEmail({
    to: analysis.candidateEmail,
    subject: built.mail.subject,
    html: built.mail.html,
    replyTo: (await getSynthesisReplyToForCampaign(campaignId)) || undefined,
  });

  // 3. Le briefing doit être EN ATTENTE pour que la prochaine réservation le
  // trouve. Idempotent par (campagne, email).
  await queueInterviewBrief({
    campaignId,
    jobTitle: null,
    candidate,
    actor: 'user',
    uid: analysis.uid,
  }).catch((err) => console.error('[reissue] mise en file KO', err));

  await appendJournalEntry({
    action: 'interview_link_reissued',
    actor: 'user',
    campaignId,
    payload: {
      uid: analysis.uid,
      analysisId: analysis.id,
      kind: params.kind,
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
