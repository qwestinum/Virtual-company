/**
 * Indisponibilités externes — lecture par le port et verdict.
 *
 * Le module pose une question à la source injectée et décide de ce qu'il fait
 * de la réponse. La décision est PURE (`resolveExternalBusy`) : elle se teste
 * sans base, sans source, sans horloge.
 *
 * Invariant non négociable : une source qui existe mais n'a pas pu être lue
 * ne vaut JAMAIS « libre ». Trois états :
 *
 *   - vérifiée : la source a répondu ;
 *   - tolérée  : elle ne répond plus, mais sa dernière lecture réussie date de
 *                moins que la tolérance (en temps OUVRÉ) ET couvre la fenêtre
 *                demandée — on s'en sert, et la réservation le porte
 *                (`check: 'snapshot'`) pour que quelqu'un le sache ;
 *   - bloquée  : au-delà, ou sans copie qui couvre la fenêtre — aucune offre,
 *                aucune confirmation.
 *
 * Spec : docs/specs/agenda-externe.md §6.4.
 */
import { busyProvider, nowIso } from './runtime';
import type {
  AvailabilityCheck,
  BusyInterval,
  ExternalBusyAnswer,
  ExternalBusyRequest,
  Resource,
} from './types';

export type ExternalBusyState = 'none' | 'verified' | 'tolerated' | 'blocked';

export type ExternalBusyVerdict = {
  intervals: BusyInterval[];
  check: AvailabilityCheck;
  /** true ⇒ aucune offre, aucune confirmation : la source n'a pas été vérifiée. */
  blocked: boolean;
  state: ExternalBusyState;
};

export type ExternalBusyPolicy = {
  /** Fenêtre que l'appelant va juger (UTC ISO). */
  requested: { from: string; to: string };
  /** Minutes OUVRÉES écoulées depuis `readAt`. */
  workingMinutesSince: (readAt: string) => number;
  toleranceMinutes: number;
};

/** Marge d'un jour : les bords d'une fenêtre UTC débordent sur les journées locales. */
const WINDOW_MARGIN_MS = 86_400_000;

export function resolveExternalBusy(
  answer: ExternalBusyAnswer,
  freshness: ExternalBusyRequest['freshness'],
  policy: ExternalBusyPolicy,
): ExternalBusyVerdict {
  switch (answer.kind) {
    case 'not_configured':
      return { intervals: [], check: 'none', blocked: false, state: 'none' };
    case 'ok':
      return {
        intervals: answer.intervals,
        check: freshness === 'live' ? 'live' : 'snapshot',
        blocked: false,
        state: 'verified',
      };
    case 'unavailable': {
      const copy = answer.lastGood;
      const usable =
        copy !== null &&
        covers(copy, policy.requested) &&
        policy.workingMinutesSince(copy.readAt) <= policy.toleranceMinutes;
      return usable
        ? { intervals: copy.intervals, check: 'snapshot', blocked: false, state: 'tolerated' }
        : { intervals: [], check: 'snapshot', blocked: true, state: 'blocked' };
    }
    default:
      return assertNever(answer);
  }
}

/** La copie a-t-elle VU toute la fenêtre ? Sinon elle ne dit rien de ce qui déborde. */
function covers(copy: { from: string; to: string }, requested: { from: string; to: string }): boolean {
  const copyFrom = Date.parse(copy.from);
  const copyTo = Date.parse(copy.to);
  const from = Date.parse(requested.from);
  const to = Date.parse(requested.to);
  if (![copyFrom, copyTo, from, to].every(Number.isFinite)) return false;
  return copyFrom <= from && copyTo >= to;
}

/**
 * Interroge la source injectée. Sans source : `not_configured`. Une source qui
 * LÈVE est traitée comme illisible, sans copie — jamais comme vide.
 */
export async function readExternalBusy(
  resource: Pick<Resource, 'id' | 'externalRef' | 'timezone' | 'horizonDays'>,
  window: { from: string; to: string },
  freshness: ExternalBusyRequest['freshness'],
): Promise<ExternalBusyAnswer> {
  const provider = busyProvider();
  if (!provider) return { kind: 'not_configured' };

  try {
    return await provider.read({
      resource: {
        id: resource.id,
        externalRef: resource.externalRef,
        timezone: resource.timezone,
        horizonDays: resource.horizonDays,
      },
      ...widen(window),
      freshness,
    });
  } catch {
    return { kind: 'unavailable', lastGood: null, failingSince: nowIso() };
  }
}

/** Fenêtre réellement jugée par le moteur : la demande, élargie d'un jour de chaque côté. */
export function widen(window: { from: string; to: string }): { from: string; to: string } {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  return {
    from: Number.isFinite(from) ? new Date(from - WINDOW_MARGIN_MS).toISOString() : window.from,
    to: Number.isFinite(to) ? new Date(to + WINDOW_MARGIN_MS).toISOString() : window.to,
  };
}

function assertNever(value: never): never {
  throw new Error(`réponse de source inattendue: ${JSON.stringify(value)}`);
}
