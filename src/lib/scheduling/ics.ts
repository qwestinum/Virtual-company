/**
 * Génération iCalendar — PURE, et interne au module (la frontière interdit
 * d'importer le générateur de l'application hôte).
 *
 * Trois formes, une seule identité :
 *   - réservation  → l'événement apparaît dans l'agenda ;
 *   - déplacement  → le MÊME événement change d'heure. C'est possible parce que
 *     l'UID vient de la RACINE de la chaîne, jamais de la ligne courante, et que
 *     `SEQUENCE` augmente : les clients d'agenda remplacent alors au lieu de
 *     dupliquer ;
 *   - annulation   → `METHOD:CANCEL` + `STATUS:CANCELLED`, qui retire l'entrée.
 *
 * Invitation ou simple ajout ? `METHOD:REQUEST` (avec ORGANIZER) donne une vraie
 * invitation, dont les réponses arrivent dans la boîte de l'organisateur — le
 * comportement attendu quand quelqu'un tient réellement le rendez-vous. Sans
 * adresse d'organisateur, une invitation n'est pas valide : on retombe sur
 * `METHOD:PUBLISH`, « ajouter à mon agenda ». Dans les deux cas
 * `ATTENDEE;RSVP=FALSE` : on ne réclame pas une réponse que personne n'attend.
 *
 * Conformité RFC 5545 : CRLF, échappement des valeurs texte, pliage des lignes
 * à 75 caractères.
 */
import { describeMeetingLocation } from './meeting-location';
import type { MeetingLocation } from './types';

export type IcsInput = {
  /** UID stable de la série (racine de la chaîne de déplacements). */
  uid: string;
  /** Rang dans la chaîne — croissant, jamais décroissant. */
  sequence: number;
  startAt: string;
  endAt: string;
  summary: string;
  description?: string | null;
  location: MeetingLocation | null;
  /** Horodatage de génération — injecté pour rester déterministe. */
  stampAt: string;
  attendee: { name: string; email: string };
  /** Adresse de l'organisateur. Absente ⇒ `METHOD:PUBLISH`. */
  organizer?: { name: string; email: string } | null;
  cancelled?: boolean;
  /** Domaine de l'UID — l'hôte n'est pas nommé en dur ici. */
  domain?: string;
};

const DEFAULT_DOMAIN = 'scheduling.invalid';

/** Échappe les métacaractères d'une valeur TEXTE iCalendar (RFC 5545 §3.3.11). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Plie une ligne à 75 caractères (RFC 5545 §3.1) ; les continuations commencent
 * par une espace. Découpe par point de code, pour ne jamais casser un caractère.
 */
function foldLine(line: string): string {
  const chars = Array.from(line);
  if (chars.length <= 75) return line;
  const out: string[] = [chars.slice(0, 75).join('')];
  for (let i = 75; i < chars.length; i += 74) {
    out.push(` ${chars.slice(i, i + 74).join('')}`);
  }
  return out.join('\r\n');
}

/** ISO → `YYYYMMDDTHHMMSSZ`. `null` si la date est illisible. */
function toIcsUtc(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Contenu du fichier. `null` si la date de début est inutilisable. */
export function buildBookingIcs(input: IcsInput): string | null {
  const dtStart = toIcsUtc(input.startAt);
  if (!dtStart) return null;
  const dtEnd = toIcsUtc(input.endAt) ?? dtStart;
  const dtStamp = toIcsUtc(input.stampAt) ?? dtStart;
  const domain = input.domain ?? DEFAULT_DOMAIN;

  const method = input.cancelled
    ? 'CANCEL'
    : input.organizer
      ? 'REQUEST'
      : 'PUBLISH';

  const locationLine = describeMeetingLocation(input.location);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Scheduling//Booking//FR',
    `METHOD:${method}`,
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escapeText(input.uid)}@${domain}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeText(input.summary)}`,
    input.description ? `DESCRIPTION:${escapeText(input.description)}` : '',
    locationLine ? `LOCATION:${escapeText(locationLine)}` : '',
    input.organizer
      ? `ORGANIZER;CN=${escapeText(input.organizer.name)}:mailto:${input.organizer.email}`
      : '',
    // RSVP=FALSE : l'invitation informe, elle ne réclame pas de réponse.
    `ATTENDEE;CN=${escapeText(input.attendee.name)};RSVP=FALSE:mailto:${input.attendee.email}`,
    `STATUS:${input.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter((line) => line !== '');

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** Nom de fichier joint — ASCII, sans espace, stable. */
export function icsFileName(prefix = 'rendez-vous'): string {
  return `${prefix}.ics`;
}

/**
 * Type MIME complet. Le paramètre `method` compte : sans lui, plusieurs clients
 * traitent le fichier comme une pièce jointe ordinaire au lieu d'une invitation.
 */
export function icsContentType(method: 'REQUEST' | 'PUBLISH' | 'CANCEL'): string {
  return `text/calendar; charset=utf-8; method=${method}`;
}

/** La méthode retenue pour un envoi donné — même règle que `buildBookingIcs`. */
export function icsMethodFor(params: {
  cancelled?: boolean;
  hasOrganizer: boolean;
}): 'REQUEST' | 'PUBLISH' | 'CANCEL' {
  if (params.cancelled) return 'CANCEL';
  return params.hasOrganizer ? 'REQUEST' : 'PUBLISH';
}
