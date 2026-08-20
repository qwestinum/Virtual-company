/**
 * Gabarits de messages — PURS : on entre des faits, il sort un objet et un
 * corps. Aucune base, aucun envoi, aucune horloge.
 *
 * Quatre gabarits, six messages : l'invité et la personne qui reçoit n'ont pas
 * besoin des mêmes informations. L'invité veut savoir quand, où, et comment
 * revenir en arrière ; la personne qui reçoit veut savoir qui vient et comment
 * la joindre.
 *
 * Deux règles d'écriture, tenues partout :
 *   - on ne promet rien que le module ne tienne. Jamais « répondez à ce
 *     message » : personne ne lit la boîte d'envoi ;
 *   - toute heure est suivie de son fuseau. Une heure nue dans un message est
 *     un rendez-vous manqué en puissance.
 */
import { formatDateTime, formatTimeRange, zoneLabel } from './format';
import { describeMeetingLocation } from './meeting-location';
import type { SchedulingLabels } from './labels';
import type { Booking, MeetingLocation } from './types';

export type MailContent = {
  subject: string;
  text: string;
  html: string;
};

export type TemplateContext = {
  labels: SchedulingLabels;
  /** Nom de l'organisation, si l'hôte en a fourni un. Sinon : pas de signature. */
  organizationName: string | null;
  /**
   * Logo de l'installation, placé en tête du message. Absent ⇒ le message
   * commence directement par son texte : jamais de cadre vide.
   */
  logoUrl?: string | null;
  /** Lien de gestion (annuler / déplacer) — absent pour la personne qui reçoit. */
  manageUrl?: string | null;
};

const LOCATION_HEADING: Record<MeetingLocation['type'], string> = {
  video: 'Visioconférence',
  in_person: 'Sur place',
  phone: 'Par téléphone',
};

/** « Visioconférence — https://… », ou null si aucun lieu n'est renseigné. */
function locationLine(location: MeetingLocation | null): string | null {
  if (!location) return null;
  const detail = describeMeetingLocation(location);
  return detail ? `${LOCATION_HEADING[location.type]} — ${detail}` : LOCATION_HEADING[location.type];
}

/** Instant + fuseau, toujours ensemble. */
function when(booking: Booking, timeZone: string): string {
  const zone = zoneLabel(timeZone);
  return `${formatDateTime(booking.startAt, timeZone)} (heure de ${zone})`;
}

function range(booking: Booking, timeZone: string): string {
  return `${formatDateTime(booking.startAt, timeZone)} — ${formatTimeRange(
    booking.startAt,
    booking.endAt,
    timeZone,
  ).split(' — ')[1]} (heure de ${zoneLabel(timeZone)})`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Texte → HTML sobre. Les URL deviennent cliquables : dans un message d'agenda,
 * un lien de visioconférence qu'il faut copier-coller est un lien raté.
 */
function toHtml(text: string, logoUrl?: string | null): string {
  const body = escapeHtml(text)
    .split('\n')
    .map((line) =>
      line.replace(
        /(https?:\/\/[^\s<]+)/g,
        (url) => `<a href="${url}" style="color:#2f6d7a">${url}</a>`,
      ),
    )
    .map((line) => (line.trim() === '' ? '<div style="height:10px"></div>' : `<div>${line}</div>`))
    .join('');
  // Le logo passe par une URL absolue fournie par la configuration : les
  // clients de messagerie ne chargent pas d'image relative, et on ne veut pas
  // grossir chaque message d'une pièce jointe.
  const mark = logoUrl
    ? `<div style="margin:0 0 14px"><img src="${escapeHtml(logoUrl)}" alt="" style="max-height:44px;max-width:200px"></div>`
    : '';
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#22201b">${mark}${body}</div>`;
}

function compose(
  subject: string,
  lines: (string | null)[],
  context: TemplateContext,
): MailContent {
  const text = lines.filter((line): line is string => line !== null).join('\n');
  return { subject, text, html: toHtml(text, context.logoUrl) };
}

function signature(context: TemplateContext): string | null {
  return context.organizationName ? `\n${context.organizationName}` : null;
}

// ─── 1. Confirmation → l'invité ─────────────────────────────────────────

export function bookingConfirmedForAttendee(
  booking: Booking,
  context: TemplateContext,
): MailContent {
  const tz = booking.attendee.timezone;
  return compose(`Rendez-vous confirmé — ${formatDateTime(booking.startAt, tz)}`, [
    `Bonjour ${booking.attendee.name},`,
    '',
    'Votre rendez-vous est confirmé.',
    '',
    `Quand : ${range(booking, tz)}`,
    locationLine(booking.meetingLocation)
      ? `Où : ${locationLine(booking.meetingLocation)}`
      : null,
    '',
    'L’invitation jointe vous permet d’ajouter ce rendez-vous à votre agenda.',
    context.manageUrl ? '' : null,
    context.manageUrl
      ? `Besoin de le déplacer ou de l’annuler ? ${context.manageUrl}`
      : null,
    signature(context),
  ], context);
}

// ─── 2. Nouveau rendez-vous → la personne qui reçoit ────────────────────

export function bookingConfirmedForOrganizer(
  booking: Booking,
  context: TemplateContext,
  timeZone: string,
): MailContent {
  return compose(
    `Nouveau rendez-vous — ${booking.attendee.name}, ${formatDateTime(booking.startAt, timeZone)}`,
    [
      `${booking.attendee.name} a réservé un créneau.`,
      '',
      `Quand : ${range(booking, timeZone)}`,
      locationLine(booking.meetingLocation)
        ? `Où : ${locationLine(booking.meetingLocation)}`
        : null,
      `Contact : ${booking.attendee.email}${
        booking.attendee.phone ? ` — ${booking.attendee.phone}` : ''
      }`,
      '',
      'L’invitation jointe ajoute le rendez-vous à votre agenda.',
    ],
    context,
  );
}

// ─── 3. Déplacement ─────────────────────────────────────────────────────

export function bookingRescheduledForAttendee(
  booking: Booking,
  previous: Booking,
  context: TemplateContext,
): MailContent {
  const tz = booking.attendee.timezone;
  return compose(`Rendez-vous déplacé — ${formatDateTime(booking.startAt, tz)}`, [
    `Bonjour ${booking.attendee.name},`,
    '',
    'Votre rendez-vous a été déplacé.',
    '',
    `Nouveau créneau : ${range(booking, tz)}`,
    `Ancien créneau : ${when(previous, tz)}`,
    locationLine(booking.meetingLocation)
      ? `Où : ${locationLine(booking.meetingLocation)}`
      : null,
    '',
    'L’invitation jointe met à jour votre agenda ; l’ancien créneau y sera remplacé.',
    context.manageUrl ? '' : null,
    context.manageUrl ? `Gérer ce rendez-vous : ${context.manageUrl}` : null,
    signature(context),
  ], context);
}

export function bookingRescheduledForOrganizer(
  booking: Booking,
  previous: Booking,
  context: TemplateContext,
  timeZone: string,
): MailContent {
  return compose(
    `Rendez-vous déplacé — ${booking.attendee.name}, ${formatDateTime(booking.startAt, timeZone)}`,
    [
      `${booking.attendee.name} a déplacé son rendez-vous.`,
      '',
      `Nouveau créneau : ${range(booking, timeZone)}`,
      `Ancien créneau : ${when(previous, timeZone)}`,
      locationLine(booking.meetingLocation)
        ? `Où : ${locationLine(booking.meetingLocation)}`
        : null,
      `Contact : ${booking.attendee.email}`,
      '',
      'L’invitation jointe met à jour votre agenda.',
    ],
    context,
  );
}

// ─── 4. Annulation ──────────────────────────────────────────────────────

export function bookingCancelledForAttendee(
  booking: Booking,
  context: TemplateContext,
): MailContent {
  const tz = booking.attendee.timezone;
  return compose(`Rendez-vous annulé — ${formatDateTime(booking.startAt, tz)}`, [
    `Bonjour ${booking.attendee.name},`,
    '',
    `Votre rendez-vous du ${when(booking, tz)} a été annulé.`,
    '',
    'La pièce jointe retire l’événement de votre agenda.',
    signature(context),
  ], context);
}

export function bookingCancelledForOrganizer(
  booking: Booking,
  context: TemplateContext,
  timeZone: string,
): MailContent {
  const by = booking.cancelledBy === 'organizer' ? 'de votre côté' : 'par l’invité';
  return compose(
    `Rendez-vous annulé — ${booking.attendee.name}, ${formatDateTime(booking.startAt, timeZone)}`,
    [
      `Le rendez-vous avec ${booking.attendee.name} a été annulé ${by}.`,
      '',
      `Créneau libéré : ${range(booking, timeZone)}`,
      booking.cancelledReason ? `Motif : ${booking.cancelledReason}` : null,
      '',
      'La pièce jointe retire l’événement de votre agenda.',
    ],
    context,
  );
}
