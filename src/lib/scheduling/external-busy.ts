/**
 * Indisponibilités externes — lecture par le port et verdict.
 *
 * Le module pose une question à la source injectée et décide de ce qu'il fait
 * de la réponse. La décision est PURE (`resolveExternalBusy`) : elle se teste
 * sans base, sans source, sans horloge.
 *
 * Invariant non négociable : une source qui existe mais n'a pas pu être lue
 * ne vaut JAMAIS « libre ». Tant qu'aucune tolérance n'est définie, elle
 * bloque — mieux vaut un créneau indisponible un moment qu'un rendez-vous posé
 * sur une plage déjà prise ailleurs.
 */
import { busyProvider, nowIso } from './runtime';
import type {
  AvailabilityCheck,
  BusyInterval,
  ExternalBusyAnswer,
  ExternalBusyRequest,
  Resource,
} from './types';

export type ExternalBusyVerdict = {
  intervals: BusyInterval[];
  check: AvailabilityCheck;
  /** true ⇒ aucune offre, aucune confirmation : la source n'a pas été vérifiée. */
  blocked: boolean;
};

/** Marge d'un jour : les bords d'une fenêtre UTC débordent sur les journées locales. */
const WINDOW_MARGIN_MS = 86_400_000;

export function resolveExternalBusy(
  answer: ExternalBusyAnswer,
  freshness: ExternalBusyRequest['freshness'],
): ExternalBusyVerdict {
  switch (answer.kind) {
    case 'not_configured':
      return { intervals: [], check: 'none', blocked: false };
    case 'ok':
      return {
        intervals: answer.intervals,
        check: freshness === 'live' ? 'live' : 'snapshot',
        blocked: false,
      };
    case 'unavailable':
      return {
        intervals: answer.lastGood?.intervals ?? [],
        check: 'snapshot',
        blocked: true,
      };
    default:
      return assertNever(answer);
  }
}

/**
 * Interroge la source injectée. Sans source : `not_configured`. Une source qui
 * LÈVE est traitée comme illisible — jamais comme vide.
 */
export async function readExternalBusy(
  resource: Pick<Resource, 'id' | 'externalRef' | 'timezone'>,
  window: { from: string; to: string },
  freshness: ExternalBusyRequest['freshness'],
): Promise<ExternalBusyVerdict> {
  const provider = busyProvider();
  if (!provider) return resolveExternalBusy({ kind: 'not_configured' }, freshness);

  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  let answer: ExternalBusyAnswer;
  try {
    answer = await provider.read({
      resource: { id: resource.id, externalRef: resource.externalRef, timezone: resource.timezone },
      from: Number.isFinite(from) ? new Date(from - WINDOW_MARGIN_MS).toISOString() : window.from,
      to: Number.isFinite(to) ? new Date(to + WINDOW_MARGIN_MS).toISOString() : window.to,
      freshness,
    });
  } catch {
    answer = { kind: 'unavailable', lastGood: null, failingSince: nowIso() };
  }
  return resolveExternalBusy(answer, freshness);
}

function assertNever(value: never): never {
  throw new Error(`réponse de source inattendue: ${JSON.stringify(value)}`);
}
