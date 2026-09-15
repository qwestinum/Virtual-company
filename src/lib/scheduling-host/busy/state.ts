/**
 * État de l'agenda publié d'un recruteur, et ce qu'on lui en dit. PUR.
 *
 *   healthy   : la dernière lecture a réussi ;
 *   tolerated : l'agenda ne répond plus, mais la dernière lecture réussie date
 *               de moins de la tolérance (2 h OUVRÉES) — ses créneaux restent
 *               proposés sur cette lecture, et chaque RDV pris le porte ;
 *   blocked   : au-delà, ou jamais lu — ses créneaux ne sont plus proposés.
 *
 * Même horloge partout : le temps OUVRÉ depuis la dernière lecture réussie.
 * Le signal s'allume à 1 h ouvrée, donc toujours avant le blocage.
 *
 * Aucun message ne parle technique (ni code HTTP, ni « ICS ») et aucun ne
 * contient l'URL : le recruteur doit savoir QUOI FAIRE.
 *
 * Spec : docs/specs/agenda-externe.md §6.4, §7.3.
 */
import type { BusyCalendarState } from '@/lib/db/repos/busy-snapshots';

/** Minutes ouvrées avant que le signal s'allume. */
export const BUSY_CALENDAR_SIGNAL_MINUTES = 60;

export function classifyBusyCalendarState(input: {
  failing: boolean;
  readAt: string | null;
  workingMinutesSinceRead: number | null;
  toleranceMinutes: number;
}): BusyCalendarState {
  if (!input.failing) return 'healthy';
  if (!input.readAt || input.workingMinutesSinceRead === null) return 'blocked';
  return input.workingMinutesSinceRead <= input.toleranceMinutes ? 'tolerated' : 'blocked';
}

export function isBusyCalendarSignalDue(input: {
  failing: boolean;
  readAt: string | null;
  workingMinutesSinceRead: number | null;
}): boolean {
  if (!input.failing) return false;
  if (!input.readAt || input.workingMinutesSinceRead === null) return true;
  return input.workingMinutesSinceRead > BUSY_CALENDAR_SIGNAL_MINUTES;
}

/** Ce que la panne demande au recruteur. Le code détaillé ne sort jamais d'ici. */
export type BusyFailureCause = 'unpublished' | 'unreadable' | 'unreachable' | 'link';

export function causeOfFailure(code: string | null): BusyFailureCause {
  switch (code) {
    case 'http_status':
    case 'not_calendar':
    case 'suspicious_empty':
      return 'unpublished';
    case 'parse_error':
    case 'truncated':
    case 'too_large':
    case 'recurrence_overflow':
      return 'unreadable';
    case 'timeout':
    case 'network':
    case 'too_many_redirects':
      return 'unreachable';
    default:
      // URL indéchiffrable, hôte refusé, redirection refusée : le lien lui-même.
      return 'link';
  }
}

const ACTION: Record<BusyFailureCause, string> = {
  unpublished:
    'Ton agenda ne semble plus publié. Republie ton agenda, puis colle le nouveau lien dans tes disponibilités.',
  unreadable:
    'Le lien ne mène plus à un agenda lisible. Vérifie que tu as bien copié le lien de publication de ton agenda.',
  unreachable:
    'ORQA ne parvient plus à joindre ton agenda. Si cela dure, republie-le et mets le lien à jour.',
  link: 'Le lien enregistré pour ton agenda n’est plus utilisable. Republie ton agenda et colle le nouveau lien.',
};

/** « 14h05 » dans le fuseau de la ressource. */
export function formatClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone })
    .format(new Date(iso))
    .replace(':', 'h');
}

export function buildBusyCalendarSignalMessage(input: {
  state: BusyCalendarState;
  readAt: string | null;
  failureCode: string | null;
  timeZone: string;
}): string {
  const action = ACTION[causeOfFailure(input.failureCode)];
  if (input.state === 'tolerated' && input.readAt) {
    return `ORQA ne parvient plus à lire ton agenda (dernière lecture à ${formatClock(input.readAt, input.timeZone)}). Tes créneaux restent proposés pour l’instant, mais seront suspendus si rien ne change. ${action}`;
  }
  return `Tes créneaux d’entretien ne sont plus proposés : ORQA ne parvient plus à lire ton agenda. ${action}`;
}

export function buildBusyCalendarBlockedEmail(input: {
  displayName: string;
  failureCode: string | null;
  failingSince: string;
  timeZone: string;
  settingsUrl: string;
}): { subject: string; html: string } {
  const action = ACTION[causeOfFailure(input.failureCode)];
  const since = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: input.timeZone,
  }).format(new Date(input.failingSince));
  const consequence =
    'Tant que ce n’est pas réglé, les candidats qui ouvrent leur lien de réservation voient tes créneaux comme momentanément indisponibles : aucun entretien ne peut être pris sur ton agenda.';

  const html = [
    `<p>Bonjour ${escapeHtml(input.displayName)},</p>`,
    `<p>ORQA ne parvient plus à lire ton agenda depuis <strong>${escapeHtml(since)}</strong>.</p>`,
    `<p>${escapeHtml(consequence)}</p>`,
    `<p><strong>Que faire :</strong> ${escapeHtml(action)}</p>`,
    `<p><a href="${escapeHtml(input.settingsUrl)}">Ouvrir mes disponibilités</a></p>`,
    '<p>Dès que ton agenda est de nouveau lisible, tes créneaux sont proposés à nouveau, sans autre geste.</p>',
  ].join('\n');

  return { subject: 'Tes créneaux d’entretien ne sont plus proposés', html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
