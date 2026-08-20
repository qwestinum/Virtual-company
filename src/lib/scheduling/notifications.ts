/**
 * Envoi des notifications : gabarit + invitation d'agenda, remis au transport
 * injecté. Le module COMPOSE, l'hôte ACHEMINE.
 *
 * Deux principes de robustesse :
 *   - une notification qui échoue n'annule JAMAIS un rendez-vous. Le rendez-vous
 *     est un fait acquis en base ; un message perdu est ennuyeux, un rendez-vous
 *     perdu est grave. Toutes les erreurs sont donc absorbées ici ;
 *   - l'invitation d'agenda accompagne chaque message, avec la même identité de
 *     série d'un bout à l'autre : réserver, déplacer et annuler agissent sur le
 *     MÊME événement dans l'agenda de l'invité (cf. `series.ts`).
 */
import { buildBookingIcs, icsContentType, icsMethodFor } from './ics';
import {
  bookingCancelledForAttendee,
  bookingCancelledForOrganizer,
  bookingConfirmedForAttendee,
  bookingConfirmedForOrganizer,
  bookingRescheduledForAttendee,
  bookingRescheduledForOrganizer,
  type MailContent,
  type TemplateContext,
} from './mail-templates';
import { resolveSeries } from './series';
import {
  branding,
  icsDomain,
  labels,
  mailer,
  manageUrl,
  notifiesOrganizer,
  nowIso,
  organizationName,
  type MailAttachment,
} from './runtime';
import type { Booking } from './types';

type Audience = 'attendee' | 'organizer';

function templateContext(booking: Booking, audience: Audience): TemplateContext {
  return {
    labels: labels(),
    organizationName: organizationName(),
    logoUrl: branding().logoUrl,
    // Le lien de gestion n'appartient qu'à l'invité : c'est SON jeton.
    manageUrl: audience === 'attendee' ? safeManageUrl(booking.manageToken) : null,
  };
}

function safeManageUrl(manageToken: string): string | null {
  try {
    const url = manageUrl(manageToken);
    // Sans URL publique configurée, on n'envoie pas un lien tronqué.
    return /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Construit la pièce d'agenda. `null` si la date est inutilisable — on envoie
 * alors le message sans invitation plutôt que rien du tout.
 */
async function buildInvitation(params: {
  booking: Booking;
  cancelled: boolean;
  organizerEmail: string | null;
  organizerName: string;
  summary: string;
}): Promise<MailAttachment | null> {
  const series = await resolveSeries(params.booking).catch(() => null);
  if (!series) return null;

  const hasOrganizer = Boolean(params.organizerEmail);
  const method = icsMethodFor({ cancelled: params.cancelled, hasOrganizer });

  const content = buildBookingIcs({
    uid: series.rootId,
    // Une annulation est une révision de plus de l'événement : sans cet
    // incrément, les clients d'agenda ignorent parfois le retrait.
    sequence: params.cancelled ? series.sequence + 1 : series.sequence,
    startAt: params.booking.startAt,
    endAt: params.booking.endAt,
    summary: params.summary,
    location: params.booking.meetingLocation,
    stampAt: nowIso(),
    attendee: {
      name: params.booking.attendee.name,
      email: params.booking.attendee.email,
    },
    organizer: params.organizerEmail
      ? { name: params.organizerName, email: params.organizerEmail }
      : null,
    cancelled: params.cancelled,
    domain: icsDomain(),
  });
  if (!content) return null;

  return {
    filename: 'rendez-vous.ics',
    contentBase64: Buffer.from(content, 'utf8').toString('base64'),
    contentType: icsContentType(method),
  };
}

/**
 * Message vers la personne qui REÇOIT le rendez-vous. Silencieux quand l'hôte
 * a déclaré s'en charger — deux messages pour un même fait, c'en est un de
 * trop, et c'est toujours le plus pauvre qui arrive en premier.
 */
async function deliverToOrganizer(
  to: string | null,
  mail: MailContent,
  invitation: MailAttachment | null,
): Promise<void> {
  if (!notifiesOrganizer()) return;
  await deliver(to, mail, invitation);
}

async function deliver(
  to: string | null,
  mail: MailContent,
  invitation: MailAttachment | null,
): Promise<void> {
  const port = mailer();
  if (!port || !to) return;
  await port
    .send({
      to: [to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(invitation ? { attachments: [invitation] } : {}),
    })
    .catch(() => undefined);
}

/** Titre de l'événement d'agenda. Le module n'invente jamais un nom. */
function summary(): string {
  const org = organizationName();
  return org ? `Rendez-vous — ${org}` : 'Rendez-vous';
}

// ─── Les trois moments ──────────────────────────────────────────────────

export async function notifyBookingConfirmed(
  booking: Booking,
  organizerEmail: string | null,
  organizerName = 'Organisateur',
): Promise<void> {
  const invitation = await buildInvitation({
    booking,
    cancelled: false,
    organizerEmail,
    organizerName,
    summary: summary(),
  });

  await deliver(
    booking.attendee.email,
    bookingConfirmedForAttendee(booking, templateContext(booking, 'attendee')),
    invitation,
  );
  await deliverToOrganizer(
    organizerEmail,
    bookingConfirmedForOrganizer(
      booking,
      templateContext(booking, 'organizer'),
      booking.attendee.timezone,
    ),
    invitation,
  );
}

export async function notifyBookingRescheduled(
  booking: Booking,
  previous: Booking,
  organizerEmail: string | null,
  organizerName = 'Organisateur',
): Promise<void> {
  const invitation = await buildInvitation({
    booking,
    cancelled: false,
    organizerEmail,
    organizerName,
    summary: summary(),
  });

  await deliver(
    booking.attendee.email,
    bookingRescheduledForAttendee(
      booking,
      previous,
      templateContext(booking, 'attendee'),
    ),
    invitation,
  );
  await deliverToOrganizer(
    organizerEmail,
    bookingRescheduledForOrganizer(
      booking,
      previous,
      templateContext(booking, 'organizer'),
      booking.attendee.timezone,
    ),
    invitation,
  );
}

/**
 * `notifyAttendee: false` existe pour l'hôte qui communique lui-même : deux
 * voix pour un même fait, c'en est une de trop.
 */
export async function notifyBookingCancelled(
  booking: Booking,
  organizerEmail: string | null,
  notifyAttendee: boolean,
  organizerName = 'Organisateur',
): Promise<void> {
  const invitation = await buildInvitation({
    booking,
    cancelled: true,
    organizerEmail,
    organizerName,
    summary: summary(),
  });

  if (notifyAttendee) {
    await deliver(
      booking.attendee.email,
      bookingCancelledForAttendee(booking, templateContext(booking, 'attendee')),
      invitation,
    );
  }
  await deliverToOrganizer(
    organizerEmail,
    bookingCancelledForOrganizer(
      booking,
      templateContext(booking, 'organizer'),
      booking.attendee.timezone,
    ),
    invitation,
  );
}
