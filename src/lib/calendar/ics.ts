/**
 * Génération d'un fichier iCalendar (.ics) pour un entretien (juin 2026).
 *
 * Joint au mail de briefing : les adresses de synthèse ne sont PAS invitées à
 * l'événement Cal.com (Cal.com n'invite que l'organisateur et le candidat), le
 * .ics leur permet d'ajouter l'entretien à leur propre agenda en un clic.
 *
 * METHOD:PUBLISH = « ajouter à mon agenda » (pas une invitation avec RSVP).
 * UID stable dérivé du booking → ré-ajouter met à jour au lieu de dupliquer.
 * Pur et testable ; CRLF + échappement conformes RFC 5545.
 */

export type InterviewIcsInput = {
  /** uid du booking Cal.com → UID stable de l'événement. */
  bookingUid: string;
  /** Début ISO 8601 (obligatoire — sans lui, pas d'événement). */
  startAt: string;
  /** Fin ISO 8601 ; à défaut, début + 30 min. */
  endAt: string | null;
  summary: string;
  description?: string | null;
  location?: string | null;
  /** Horodatage de génération (ISO) — injecté pour rester testable/déterministe. */
  stampAt: string;
};

/** Échappe les métacaractères de valeur texte iCalendar (RFC 5545 §3.3.11). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Date ISO → format iCalendar UTC `YYYYMMDDTHHMMSSZ`. `null` si non parsable. */
function toIcsUtc(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
}

/**
 * Construit le contenu .ics. `null` si le début est absent/invalide (on ne
 * joint alors aucun fichier — un événement sans date n'a pas de sens).
 */
export function buildInterviewIcs(input: InterviewIcsInput): string | null {
  const dtStart = toIcsUtc(input.startAt);
  if (!dtStart) return null;
  const dtStamp = toIcsUtc(input.stampAt) ?? dtStart;
  const dtEnd =
    (input.endAt ? toIcsUtc(input.endAt) : null) ??
    toIcsUtc(new Date(new Date(input.startAt).getTime() + 30 * 60_000).toISOString()) ??
    dtStart;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QWESTINUM//ORQA//FR',
    'METHOD:PUBLISH',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escapeText(input.bookingUid)}@orqa.qwestinum`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeText(input.summary)}`,
    input.description ? `DESCRIPTION:${escapeText(input.description)}` : '',
    input.location ? `LOCATION:${escapeText(input.location)}` : '',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter((l) => l !== '');

  // CRLF requis par la spec ; ligne finale terminée aussi.
  return lines.join('\r\n') + '\r\n';
}
