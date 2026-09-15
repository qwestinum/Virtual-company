/**
 * Règle d'acceptation d'une lecture d'agenda. PURE.
 *
 * Arrêtée le 15/09/2026 sur mesure Outlook réelle : une URL dépubliée répond
 * 302 vers une page HTML d'erreur, jamais un calendrier vide. Une lecture est
 * donc ACCEPTÉE seulement si les quatre conditions sont réunies :
 *
 *   1. statut 200 (après redirections) ;
 *   2. `Content-Type: text/calendar` (paramètres admis) ;
 *   3. le corps contient `BEGIN:VCALENDAR` ;
 *   4. le corps contient `END:VCALENDAR` — un téléchargement coupé n'est pas
 *      un agenda court.
 *
 * Tout le reste est un échec de lecture. Un agenda VIDE (conditions réunies,
 * aucun événement) est valide : c'est au parseur de le dire, pas ici.
 */

export type CalendarResponseFailure = 'http_status' | 'not_calendar' | 'truncated';

export type CalendarResponseVerdict = { ok: true } | { ok: false; code: CalendarResponseFailure };

export function checkCalendarResponse(response: {
  status: number;
  contentType: string | null;
  body: string;
}): CalendarResponseVerdict {
  if (response.status !== 200) return { ok: false, code: 'http_status' };
  const mediaType = (response.contentType ?? '').split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'text/calendar') return { ok: false, code: 'not_calendar' };
  const begin = response.body.indexOf('BEGIN:VCALENDAR');
  if (begin === -1) return { ok: false, code: 'not_calendar' };
  if (response.body.indexOf('END:VCALENDAR', begin) === -1) {
    return { ok: false, code: 'truncated' };
  }
  return { ok: true };
}
