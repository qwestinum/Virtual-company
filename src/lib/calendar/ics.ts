/**
 * Génération d'un fichier iCalendar (.ics) pour un entretien (juin 2026).
 *
 * Joint au mail de briefing : les adresses de synthèse ne sont PAS invitées à
 * l'événement Cal.com (Cal.com n'invite que l'organisateur et le candidat), le
 * .ics leur permet d'ajouter l'entretien à leur propre agenda en un clic.
 *
 * CV « dans le RDV », double approche pour couvrir tous les clients :
 *   - LIEN signé du CV dans la description + ATTACH (URI) → cliquable sur
 *     Google Calendar / Outlook (qui ignorent les PJ binaires d'un .ics) ;
 *   - CV BINAIRE embarqué (ATTACH;ENCODING=BASE64) → Apple Calendar l'affiche.
 *
 * METHOD:PUBLISH = « ajouter à mon agenda ». UID stable dérivé du booking →
 * ré-ajouter met à jour au lieu de dupliquer. Pur et testable ; CRLF,
 * échappement et PLIAGE de lignes (≤ 75 car.) conformes RFC 5545.
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
  /**
   * Description HTML alternative (X-ALT-DESC;FMTTYPE=text/html) — rendue par les
   * clients qui la supportent (Outlook). `description` (texte brut) reste le
   * repli universel (Google/Apple). Le CV n'y est pas injecté (réservé au texte).
   */
  htmlDescription?: string | null;
  location?: string | null;
  /** Horodatage de génération (ISO) — injecté pour rester testable/déterministe. */
  stampAt: string;
  /** Lien signé du CV (cliquable Google/Outlook). */
  cvUrl?: string | null;
  /** CV binaire embarqué (Apple Calendar). */
  cvBinary?: { base64: string; filename: string; mimeType: string } | null;
};

/** Échappe les métacaractères de valeur TEXTE iCalendar (RFC 5545 §3.3.11). */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Plie une ligne de contenu à ≤ 75 caractères (RFC 5545 §3.1) : les lignes de
 * continuation commencent par une espace. Indispensable pour l'ATTACH base64
 * (sinon de nombreux parseurs échouent). Découpe par point de code pour ne
 * jamais casser un caractère.
 */
function foldLine(line: string): string {
  const chars = Array.from(line);
  if (chars.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  // 1re ligne : 75 ; continuations : 74 + l'espace de tête = 75.
  out.push(chars.slice(0, 75).join(''));
  i = 75;
  while (i < chars.length) {
    out.push(' ' + chars.slice(i, i + 74).join(''));
    i += 74;
  }
  return out.join('\r\n');
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

  // Description = synthèse + lien CV (cliquable sur Google Calendar).
  const descriptionParts = [
    input.description ?? '',
    input.cvUrl ? `CV du candidat : ${input.cvUrl}` : '',
  ].filter((p) => p !== '');
  const description = descriptionParts.join('\n\n');

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
    description ? `DESCRIPTION:${escapeText(description)}` : '',
    // Variante HTML (Outlook) — text-escapée comme toute valeur iCalendar.
    input.htmlDescription
      ? `X-ALT-DESC;FMTTYPE=text/html:${escapeText(input.htmlDescription)}`
      : '',
    input.location ? `LOCATION:${escapeText(input.location)}` : '',
    // ATTACH URI (valeur = URI, PAS de text-escaping) — lien cliquable.
    input.cvUrl ? `ATTACH;FMTTYPE=application/pdf:${input.cvUrl}` : '',
    // ATTACH binaire base64 — Apple Calendar. Plié par foldLine.
    input.cvBinary
      ? `ATTACH;FMTTYPE=${input.cvBinary.mimeType};ENCODING=BASE64;VALUE=BINARY;X-APPLE-FILENAME=${input.cvBinary.filename}:${input.cvBinary.base64}`
      : '',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter((l) => l !== '');

  // CRLF requis par la spec ; pliage de chaque ligne ; ligne finale terminée.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
