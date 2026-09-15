/**
 * Saisie de l'agenda publié par le recruteur : LECTURE D'ESSAI et messages.
 *
 * Une URL ne s'enregistre qu'après avoir été lue avec succès (on n'enregistre
 * pas un lien illisible). La lecture d'essai passe par la MÊME chaîne que la
 * relève — règle d'acceptation, redirections contrôlées, parseur en liste
 * blanche — et ne stocke rien : c'est l'enregistrement qui décide.
 *
 * Aucune réponse ne contient l'URL. Les messages parlent au recruteur (tu),
 * sans code technique, et disent quoi faire.
 *
 * Spec : docs/specs/agenda-externe.md §8.
 */
import { fetchBusyCalendar, type CalendarFetchResult } from '@/lib/calendar/busy-ics/fetch';
import { parseBusyIcs } from '@/lib/calendar/busy-ics/parse';
import type { CalendarProviderId } from '@/lib/calendar/busy-ics/providers';
import type { BusyInterval } from '@/lib/scheduling';

/** Fenêtre du compte affiché à la saisie : « sur les 30 prochains jours ». */
export const PROBE_COUNT_DAYS = 30;

const DAY_MS = 86_400_000;

export type BusyCalendarProbe =
  | {
      ok: true;
      provider: CalendarProviderId;
      /** Plages occupées (fusionnées) qui touchent les 30 prochains jours. */
      upcomingCount: number;
      /** Aucun événement bloquant sur toute la fenêtre lue : valide, mais on le dit. */
      empty: boolean;
      /** Le lien publie le détail des rendez-vous (présence constatée). */
      carriesDetails: boolean;
      /** Pour amorcer la copie à l'enregistrement — jamais renvoyé au navigateur. */
      seed: { intervals: BusyInterval[]; occurrenceCount: number; windowFrom: string; windowTo: string };
    }
  | { ok: false; code: string };

export async function probeBusyCalendar(
  rawUrl: string,
  context: {
    timezone: string;
    horizonDays: number;
    now: Date;
    fetchCalendar?: (url: string) => Promise<CalendarFetchResult>;
  },
): Promise<BusyCalendarProbe> {
  const fetched = await (context.fetchCalendar ?? ((url: string) => fetchBusyCalendar(url)))(rawUrl).catch(
    (): CalendarFetchResult => ({ ok: false, code: 'network', durationMs: 0 }),
  );
  if (!fetched.ok) return { ok: false, code: fetched.code };

  const nowMs = context.now.getTime();
  const windowFrom = new Date(nowMs - DAY_MS).toISOString();
  const windowTo = new Date(nowMs + (Math.max(context.horizonDays, PROBE_COUNT_DAYS) + 2) * DAY_MS).toISOString();
  const parsed = parseBusyIcs(fetched.body, { from: windowFrom, to: windowTo, fallbackZone: context.timezone });
  if (!parsed.ok) return { ok: false, code: parsed.code };

  const countEnd = nowMs + PROBE_COUNT_DAYS * DAY_MS;
  const upcomingCount = parsed.intervals.filter(
    (i) => Date.parse(i.endAt) > nowMs && Date.parse(i.startAt) < countEnd,
  ).length;

  return {
    ok: true,
    provider: fetched.provider,
    upcomingCount,
    empty: parsed.occurrenceCount === 0,
    carriesDetails: parsed.carriesDetails,
    seed: { intervals: parsed.intervals, occurrenceCount: parsed.occurrenceCount, windowFrom, windowTo },
  };
}

// ─── Messages ───────────────────────────────────────────────────────────

/** Pourquoi le lien ne peut pas être retenu, et quoi faire. */
export function probeFailureMessage(code: string): string {
  switch (code) {
    case 'invalid_url':
      return 'Ce n’est pas une adresse valide. Copie le lien de publication de ton agenda en entier (il commence par https://).';
    case 'host_not_allowed':
      return 'Ce lien ne vient pas d’Outlook. Pour l’instant, seuls les agendas Outlook (Outlook.com et Microsoft 365) sont pris en charge.';
    case 'provider_not_accepted':
      return 'Les agendas Google ne sont pas encore pris en charge. Seuls les agendas Outlook (Outlook.com et Microsoft 365) le sont pour l’instant.';
    case 'http_status':
    case 'not_calendar':
      return 'Ce lien ne mène pas à un agenda publié. Vérifie que tu as copié le lien ICS (et non le lien HTML), et que ton agenda est toujours publié.';
    case 'truncated':
    case 'too_large':
    case 'parse_error':
    case 'recurrence_overflow':
      return 'Ton agenda n’a pas pu être lu en entier. Réessaie ; si cela persiste, republie-le et colle le nouveau lien.';
    case 'timeout':
    case 'network':
      return 'Ton agenda ne répond pas pour le moment. Réessaie dans un instant.';
    case 'redirect_refused':
    case 'too_many_redirects':
      return 'Ce lien renvoie vers un site qui n’est pas celui de ton agenda : il n’a pas été suivi. Copie le lien de publication directement depuis Outlook.';
    default:
      return 'Ce lien n’a pas pu être lu. Vérifie qu’il s’agit bien du lien ICS de ton agenda publié.';
  }
}

export function probeSuccessMessage(probe: { upcomingCount: number; empty: boolean }): string {
  if (probe.empty) {
    return 'Agenda lu, mais vide sur les 30 prochains jours. Vérifie qu’il s’agit bien du bon calendrier.';
  }
  const n = probe.upcomingCount;
  return `Agenda lu : ${n} plage${n > 1 ? 's' : ''} occupée${n > 1 ? 's' : ''} sur les 30 prochains jours.`;
}

export const DETAILS_WARNING =
  'Ce lien publie le détail de tes rendez-vous. ORQA n’en garde que les horaires, mais le plus sûr est de publier ton agenda en « Peut voir quand je suis occupé ».';
