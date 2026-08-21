/**
 * Consommation des événements de réservation — le remplaçant du webhook.
 *
 * Même rôle que `POST /api/webhooks/calcom`, mais la file nous appartient :
 * pas de signature à vérifier, pas de parsing tolérant, et une livraison
 * at-least-once garantie par l'outbox du module. En échange, ce
 * consommateur DOIT être idempotent par `event.id` — d'où le claim deux
 * phases, calqué sur celui du webhook (`claims-policy`, même TTL).
 *
 * Contrat avec le module : LEVER = « pas traité, remets-moi ça au prochain
 * drain » (la ligne d'outbox reste en attente, avec sa dernière erreur).
 * Revenir normalement = « traité, ne me le redonne plus ». Aucun état
 * intermédiaire : c'est ce qui rend le rejeu sûr.
 *
 * Le rapprochement se fait par le CONTEXTE du lien (uid + analyse + campagne),
 * jamais par l'email : c'est tout l'intérêt d'avoir émis un lien nominatif.
 */
import { getSynthesisRecipientsForCampaign } from '@/lib/campaign/synthesis-recipients';
import { buildInterviewIcs } from '@/lib/calendar/ics';
import {
  claimBookingEventDelivery,
  confirmBookingEventDelivery,
  releaseBookingEventDelivery,
} from '@/lib/db/repos/booking-events';
import {
  getBriefByBookingUid,
  markBriefAwaitingBooking,
  updateBriefBookingFacts,
} from '@/lib/db/repos/interview-briefs';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { sendEmail } from '@/lib/email/client';
import { deliverBriefForBooking } from '@/lib/interview/deliver-brief';
import {
  describeMeetingLocation,
  formatDateTime,
  getBooking,
  resolveSeries,
  type SchedEvent,
  type SchedEventBooking,
} from '@/lib/scheduling';

import { parseBookingContext, type BookingContext } from './campaign-booking';

/** Levée pour demander un nouveau passage du drain. */
class RetryEventError extends Error {
  constructor(reason: string) {
    super(`scheduling_event_retry: ${reason}`);
    this.name = 'RetryEventError';
  }
}

export async function handleSchedulingEvent(event: SchedEvent): Promise<void> {
  const verdict = await claimBookingEventDelivery(event.id, event.type);
  if (verdict === 'already_handled') return; // rejeu prouvé : rien à refaire
  if (verdict === 'in_flight') {
    // Une autre passe traite peut-être cet événement : on DIFFÈRE plutôt que
    // de courir avec elle (le drain repassera, et verra confirmé ou périmé).
    throw new RetryEventError('claim_in_flight');
  }

  try {
    switch (event.type) {
      case 'booking.created':
        await onBookingCreated(event);
        break;
      case 'booking.cancelled':
        await onBookingCancelled(event);
        break;
      case 'booking.rescheduled':
        await onBookingRescheduled(event);
        break;
      default:
        // Type réservé (V2) : on l'acquitte sans rien faire plutôt que de le
        // laisser tourner en boucle dans la file.
        break;
    }
  } catch (err) {
    await releaseBookingEventDelivery(event.id);
    throw err;
  }
  await confirmBookingEventDelivery(event.id);
}

// ─── booking.created — la livraison du briefing ─────────────────────────

async function onBookingCreated(event: SchedEvent): Promise<void> {
  const booking = event.booking;
  const context = parseBookingContext(booking.context);

  // Pas de contexte = pas notre affaire. Un lien émis par ORQA en porte
  // TOUJOURS un ; une réservation sans contexte vient d'ailleurs (harnais de
  // démonstration, autre intégration, ligne d'outbox oubliée). Retomber sur le
  // rapprochement par email enverrait alors un « à rattacher » à de vraies
  // adresses, à propos d'un rendez-vous fantôme — c'est exactement ce qui
  // s'est produit au premier drain sur l'environnement de dev. On TRACE, et
  // on acquitte : rejouer ne changerait rien.
  if (!context) {
    await journalBooking(null, {
      action: 'interview_booking_unmatched',
      booking,
      extra: { reason: 'no_host_context' },
    });
    return;
  }

  const result = await deliverBriefForBooking({
    bookingUid: booking.id,
    attendeeEmail: booking.attendee.email,
    attendeeName: booking.attendee.name,
    startTime: booking.startAt,
    endTime: booking.endAt,
    location: describeMeetingLocation(booking.meetingLocation),
    identity: context,
  });

  await journalBooking(context, {
    action:
      result.status === 'unmatched'
        ? 'interview_booking_unmatched'
        : result.status === 'regenerated_delivered'
          ? 'interview_brief_regenerated'
          : 'interview_brief_delivered',
    booking,
    extra: {
      status: result.status,
      providerMessageId: result.messageId ?? null,
      error: result.error,
    },
  });

  // Échec TRANSITOIRE (envoi, régénération de trame) ⇒ on relâche et le drain
  // re-tentera. Une issue terminale (candidature introuvable, aucune adresse
  // de synthèse) est acquittée : la rejouer ne changerait rien.
  if (!result.ok && result.retryable) {
    throw new RetryEventError(result.error ?? 'delivery_failed');
  }
}

// ─── booking.cancelled — retour en attente de réservation ───────────────

async function onBookingCancelled(event: SchedEvent): Promise<void> {
  const booking = event.booking;
  const context = parseBookingContext(booking.context);

  // Retour à `awaiting_booking` : la candidature reste invitée, elle n'a
  // simplement plus de créneau. AUCUNE réémission automatique de lien (V1) —
  // c'est une décision humaine, signalée dans l'onglet Entretiens.
  // Le briefing est lu AVANT la transition : elle efface `booking_uid`, qui
  // est justement la clé de recherche. Le lire après rendrait `null`, et le
  // message partirait sans le nom du candidat ni sa campagne — donc à la
  // liste globale au lieu des destinataires de CETTE campagne.
  const brief = await getBriefByBookingUid(booking.id).catch(() => null);
  const restored = await markBriefAwaitingBooking(booking.id);
  const mailStatus = await notifySynthesis('cancelled', booking, brief);

  await journalBooking(context, {
    action: 'interview_booking_cancelled',
    booking,
    extra: {
      cancelledBy: booking.cancelledBy ?? null,
      cancelReason: booking.cancelReason ?? null,
      briefsReopened: restored,
      mailStatus,
      // Un rendez-vous annulé par l'organisation est presque toujours un
      // effet de bord d'un autre geste (classement sans suite) ; l'annulation
      // par l'invité, elle, appelle une relance.
      needsAction: booking.cancelledBy === 'attendee',
    },
  });
}

// ─── booking.rescheduled — mise à jour des faits ────────────────────────

async function onBookingRescheduled(event: SchedEvent): Promise<void> {
  const booking = event.booking;
  const context = parseBookingContext(booking.context);
  const previousId = booking.rescheduledFrom ?? null;

  // Le briefing suit l'ANCIEN identifiant ; sur rejeu, il porte déjà le
  // nouveau — on regarde les deux plutôt que de supposer.
  const brief =
    (previousId ? await getBriefByBookingUid(previousId) : null) ??
    (await getBriefByBookingUid(booking.id));

  // Ni contexte ni briefing : ce rendez-vous n'est pas le nôtre (même raison
  // qu'à la création). On trace sans écrire de mail à personne.
  if (!context && !brief) {
    await journalBooking(null, {
      action: 'interview_booking_unmatched',
      booking,
      extra: { reason: 'no_host_context', type: 'rescheduled' },
    });
    return;
  }

  if (previousId) {
    await updateBriefBookingFacts(previousId, {
      bookingUid: booking.id,
      interviewStartAt: booking.startAt,
      interviewEndAt: booking.endAt,
      interviewLocation: describeMeetingLocation(booking.meetingLocation),
      deliveredMessageId: brief?.deliveredMessageId ?? null,
    });
  }

  const mailStatus = await notifySynthesis('rescheduled', event.booking, brief);

  await journalBooking(context, {
    action: 'interview_booking_rescheduled',
    booking,
    extra: {
      previousBookingUid: previousId,
      previousStartAt: booking.previousStartAt ?? null,
      mailStatus,
    },
  });
}

/**
 * Mail COURT aux adresses de synthèse, avec l'invitation d'agenda à jour.
 *
 * ORQA porte TOUTE la communication vers l'équipe : le module se tait de ce
 * côté (`notifyOrganizer: false`). Sans ces messages, un déplacement ou une
 * annulation ne se verrait que dans l'onglet Entretiens — le recruteur
 * garderait un créneau fantôme dans son agenda.
 *
 * L'UID de l'invitation est celui de la SÉRIE (racine de la chaîne), pas
 * celui de la nouvelle réservation : c'est la seule façon pour l'agenda du
 * recruteur de DÉPLACER l'événement (ou de le RETIRER) au lieu d'en créer un
 * second. Le rang dans la chaîne fournit le `SEQUENCE`, qui dit quelle
 * version l'emporte.
 */
async function notifySynthesis(
  kind: 'rescheduled' | 'cancelled',
  eventBooking: SchedEventBooking,
  brief: { campaignId: string | null; candidateName: string; jobTitle: string | null } | null,
): Promise<'sent' | 'skipped_no_recipient' | 'send_failed'> {
  const recipients = await getSynthesisRecipientsForCampaign(
    brief?.campaignId ?? null,
  ).catch(() => [] as string[]);
  if (recipients.length === 0) return 'skipped_no_recipient';

  // Série résolue depuis la base : l'événement ne porte que son parent direct.
  const full = await getBooking(eventBooking.id).catch(() => null);
  const series = full
    ? await resolveSeries(full).catch(() => null)
    : null;

  const who = brief?.candidateName ?? eventBooking.attendee.name;
  const label = brief?.jobTitle ? ` (${brief.jobTitle})` : '';
  const when = formatDateTime(eventBooking.startAt, eventBooking.attendee.timezone);
  const where = describeMeetingLocation(eventBooking.meetingLocation);

  const cancelled = kind === 'cancelled';
  const ics = buildInterviewIcs({
    bookingUid: series?.rootId ?? eventBooking.id,
    // Une annulation est une révision de plus : sans l'incrément, plusieurs
    // clients d'agenda ignorent purement et simplement le retrait.
    sequence: (series?.sequence ?? 0) + (cancelled ? 1 : 0) || 1,
    startAt: eventBooking.startAt,
    endAt: eventBooking.endAt,
    summary: `Entretien — ${who}${label}`,
    description: cancelled
      ? `Rendez-vous annulé (créneau du ${when}).`
      : `Rendez-vous déplacé au ${when}.`,
    location: where,
    stampAt: new Date().toISOString(),
    cancelled,
  });

  const by =
    eventBooking.cancelledBy === 'attendee' ? 'le candidat' : 'le cabinet';
  const result = await sendEmail({
    to: recipients,
    subject: cancelled
      ? `Entretien annulé — ${who}, ${when}`
      : `Entretien déplacé — ${who}, ${when}`,
    html: cancelled
      ? `<p>L’entretien de ${escapeHtml(who)}${escapeHtml(label)} a été annulé par ${by}.</p>` +
        `<p><strong>Créneau libéré :</strong> ${escapeHtml(when)} (heure du candidat)</p>` +
        (eventBooking.cancelReason
          ? `<p><strong>Motif :</strong> ${escapeHtml(eventBooking.cancelReason)}</p>`
          : '') +
        `<p>La pièce jointe retire le rendez-vous de votre agenda. ` +
        `La candidature est repassée « en attente de réservation » — ` +
        `un lien peut être renvoyé depuis l’onglet Entretiens.</p>`
      : `<p>${escapeHtml(who)}${escapeHtml(label)} a déplacé son entretien.</p>` +
        `<p><strong>Nouveau créneau :</strong> ${escapeHtml(when)} (heure du candidat)</p>` +
        (where ? `<p><strong>Où :</strong> ${escapeHtml(where)}</p>` : '') +
        `<p>L’invitation jointe met à jour votre agenda.</p>`,
    ...(ics
      ? {
          attachments: [
            {
              filename: cancelled ? 'entretien-annule.ics' : 'entretien-deplace.ics',
              content: Buffer.from(ics, 'utf8').toString('base64'),
            },
          ],
        }
      : {}),
  });
  return result.ok ? 'sent' : 'send_failed';
}

// ─── Journal ────────────────────────────────────────────────────────────

async function journalBooking(
  context: BookingContext | null,
  args: {
    action: string;
    booking: SchedEventBooking;
    extra: Record<string, unknown>;
  },
): Promise<void> {
  await appendJournalEntry({
    action: args.action,
    actor: 'scheduling',
    campaignId: context?.campaignId ?? null,
    payload: {
      uid: context?.uid ?? null,
      analysisId: context?.analysisId ?? null,
      bookingUid: args.booking.id,
      attendeeEmail: args.booking.attendee.email,
      // Le fil d'activité du Bureau nomme les gens (« Rendez-vous pris avec
      // Claire Martin ») : sans ce champ il n'a qu'une adresse email, qu'il
      // refuse d'afficher — un fil qui parle en identifiants ne se lit pas.
      attendeeName: args.booking.attendee.name,
      startAt: args.booking.startAt,
      // Quel agenda a produit ce rendez-vous — l'équivalent natif de la
      // traçabilité `organizerEmail` du webhook.
      resourceRef: args.booking.resourceExternalRef,
      ...args.extra,
    },
  }).catch((err) => console.error('[scheduling-consumer] journal KO', err));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
