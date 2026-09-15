/**
 * Ce que l'écran « Agenda externe » écrit, à partir de l'état servi. PUR, et
 * sans import serveur : il tourne dans le navigateur.
 */
import type { BusyCalendarStatus } from '@/types/busy-calendar';

export type BusyCalendarTone = 'ok' | 'warn' | 'danger' | 'muted';

/** « à l’instant », « il y a 12 min », « il y a 3 h », « le 14/09 à 09:42 ». */
export function formatReadAgo(readAt: string, nowMs: number, timeZone = 'Europe/Paris'): string {
  const minutes = Math.floor((nowMs - Date.parse(readAt)) / 60_000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 24 * 60) return `il y a ${Math.floor(minutes / 60)} h`;
  return formatMoment(readAt, nowMs, timeZone);
}

/** « 09:42 » le jour même, « le 14/09 à 09:42 » sinon. */
export function formatMoment(iso: string, nowMs: number, timeZone = 'Europe/Paris'): string {
  const date = new Date(iso);
  const dayOf = (d: Date) => new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone }).format(d);
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone }).format(date);
  return dayOf(date) === dayOf(new Date(nowMs)) ? time : `le ${dayOf(date)} à ${time}`;
}

export function busyCalendarHeadline(
  status: BusyCalendarStatus,
  nowMs: number,
): { tone: BusyCalendarTone; text: string } {
  const who = status.providerLabel ? `Agenda ${status.providerLabel}` : 'Agenda';
  if (!status.available && status.configured) {
    return {
      tone: 'muted',
      text: 'Ton agenda externe est enregistré, mais la fonction est désactivée pour ton cabinet : il n’est pas pris en compte dans tes créneaux.',
    };
  }
  switch (status.state) {
    case 'unconfigured':
      return { tone: 'muted', text: 'Aucun agenda externe : seuls tes rendez-vous pris dans ORQA sont retirés de tes créneaux.' };
    case 'pending':
      return { tone: 'muted', text: `${who} enregistré — première lecture dans la minute.` };
    case 'healthy': {
      const n = status.upcomingCount ?? 0;
      const read = status.readAt ? ` relu ${formatReadAgo(status.readAt, nowMs)}` : '';
      return {
        tone: 'ok',
        text: `${who}${read} · ${n} plage${n > 1 ? 's' : ''} occupée${n > 1 ? 's' : ''} sur les 30 prochains jours.`,
      };
    }
    case 'tolerated':
      return {
        tone: 'warn',
        text: `Dernière lecture réussie ${status.readAt ? formatReadAgo(status.readAt, nowMs) : 'inconnue'} — ORQA continue avec cette lecture, et les rendez-vous pris entre-temps te seront signalés.`,
      };
    case 'blocked':
      return {
        tone: 'danger',
        text: `ORQA ne parvient plus à lire ton agenda${status.failingSince ? ` depuis ${formatMoment(status.failingSince, nowMs)}` : ''}. Tes créneaux ne sont plus proposés tant que ce n’est pas réglé.`,
      };
  }
}
