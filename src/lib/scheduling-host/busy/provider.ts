/**
 * Source d'indisponibilités du module de réservation : l'agenda publié du
 * recruteur (ICS). C'est l'ADAPTATEUR — le module ne sait rien d'une URL,
 * d'un fournisseur ni d'un format ; il reçoit des bornes, une date de lecture,
 * et, quand l'agenda ne répond plus, la dernière copie réussie.
 *
 * Chaîne d'une lecture : URL chiffrée de la fiche → déchiffrement → lecture
 * HTTP (règle d'acceptation, redirections contrôlées) → parseur en liste
 * blanche → intervalles → copie en base. À chaque étage, un échec rend
 * `unavailable` — jamais `ok` avec une liste vide, jamais un message qui
 * porterait l'URL.
 *
 * Deux fraîcheurs :
 *   - `snapshot` (l'offre) : la copie sert si elle a moins d'une minute ;
 *     sinon on relit. Pendant une panne, on ne relit pas plus d'une fois par
 *     minute — une page de créneaux ne martèle pas un agenda qui ne répond pas ;
 *   - `live` (la confirmation) : toujours relu.
 *
 * Spec : docs/specs/agenda-externe.md §3, §5, §6.
 */
import { fetchBusyCalendar, type CalendarFetchResult } from '@/lib/calendar/busy-ics/fetch';
import { parseBusyIcs } from '@/lib/calendar/busy-ics/parse';
import { isUnpublishMeasured } from '@/lib/calendar/busy-ics/providers';
import type { BusySnapshot } from '@/lib/db/repos/busy-snapshots';
import type { RecruiterCalendarUrl } from '@/lib/db/repos/recruiters';
import type {
  BusyInterval,
  BusyProvider,
  ExternalBusyAnswer,
  ExternalBusyRequest,
} from '@/lib/scheduling';

export type BusySnapshotStore = {
  get(recruiterId: string): Promise<BusySnapshot | null>;
  recordSuccess(input: {
    recruiterId: string;
    intervals: BusyInterval[];
    windowFrom: string;
    windowTo: string;
    occurrenceCount: number;
    readAt: string;
  }): Promise<void>;
  /** Rend le début de la panne réellement retenu. */
  recordFailure(input: {
    recruiterId: string;
    code: string;
    attemptedAt: string;
    previous: BusySnapshot | null;
  }): Promise<string>;
};

export type BusyReadObservation = {
  recruiterId: string;
  resource: ExternalBusyRequest['resource'];
  previous: BusySnapshot | null;
  at: string;
} & ({ ok: true } | { ok: false; code: string; failingSince: string });

export type IcsBusyProviderDeps = {
  /** URL en clair de la ressource (clé externe = identifiant du recruteur). */
  loadCalendarUrl(resourceExternalRef: string): Promise<RecruiterCalendarUrl>;
  fetchCalendar?: (url: string) => Promise<CalendarFetchResult>;
  /** Copie en base. Absente ⇒ aucune copie : chaque lecture est fraîche, sans tolérance. */
  store?: BusySnapshotStore;
  /** Prévenu de chaque lecture RÉELLE (transitions d'état, email). Ne doit jamais lever. */
  observe?: (observation: BusyReadObservation) => Promise<void>;
  now?: () => Date;
  /** Âge maximal d'une copie servie à l'offre, et intervalle minimal entre deux relectures en panne. */
  snapshotFreshMs?: number;
};

export const DEFAULT_SNAPSHOT_FRESH_MS = 60_000;

/** Seuil du filet de révocation silencieuse (hôtes à dépublication non mesurée). */
export const SUSPICIOUS_EMPTY_PREVIOUS_COUNT = 5;

const DAY_MS = 86_400_000;

export function createIcsBusyProvider(deps: IcsBusyProviderDeps): BusyProvider {
  const fetchCalendar = deps.fetchCalendar ?? ((url: string) => fetchBusyCalendar(url));
  const now = deps.now ?? (() => new Date());
  const freshMs = deps.snapshotFreshMs ?? DEFAULT_SNAPSHOT_FRESH_MS;

  return {
    async read(request: ExternalBusyRequest): Promise<ExternalBusyAnswer> {
      const recruiterId = request.resource.externalRef;
      const at = now();
      const atIso = at.toISOString();

      let source: RecruiterCalendarUrl;
      try {
        source = await deps.loadCalendarUrl(recruiterId);
      } catch {
        return { kind: 'unavailable', lastGood: null, failingSince: atIso };
      }
      if (source.kind === 'none') return { kind: 'not_configured' };

      const previous = deps.store ? await deps.store.get(recruiterId).catch(() => null) : null;
      const lastGood = lastGoodOf(previous);

      // ── Offre : la copie récente suffit ────────────────────────────────
      if (request.freshness === 'snapshot' && previous) {
        const age = (iso: string | null) => (iso ? at.getTime() - Date.parse(iso) : Infinity);
        if (!previous.failingSince && lastGood && age(previous.readAt) <= freshMs && covers(lastGood, request)) {
          return { kind: 'ok', intervals: lastGood.intervals, readAt: lastGood.readAt };
        }
        // En panne et déjà retentée il y a moins d'une minute : on ne relit pas.
        if (previous.failingSince && age(previous.attemptedAt) <= freshMs) {
          return { kind: 'unavailable', lastGood, failingSince: previous.failingSince };
        }
      }

      // ── Lecture réelle ─────────────────────────────────────────────────
      const window = readWindow(request, at);
      const outcome =
        source.kind === 'unreadable'
          ? ({ ok: false, code: 'decrypt_failed' } as const)
          : await readFresh(source.url, window, request, previous, fetchCalendar);

      if (outcome.ok) {
        await deps.store?.recordSuccess({
          recruiterId,
          intervals: outcome.intervals,
          windowFrom: window.from,
          windowTo: window.to,
          occurrenceCount: outcome.occurrenceCount,
          readAt: atIso,
        }).catch(() => undefined);
        await safeObserve(deps, { recruiterId, resource: request.resource, previous, at: atIso, ok: true });
        return { kind: 'ok', intervals: outcome.intervals, readAt: atIso };
      }

      const failingSince = deps.store
        ? await deps.store
            .recordFailure({ recruiterId, code: outcome.code, attemptedAt: atIso, previous })
            .catch(() => previous?.failingSince ?? atIso)
        : atIso;
      await safeObserve(deps, {
        recruiterId,
        resource: request.resource,
        previous,
        at: atIso,
        ok: false,
        code: outcome.code,
        failingSince,
      });
      return { kind: 'unavailable', lastGood, failingSince };
    },
  };
}

type FreshOutcome =
  | { ok: true; intervals: BusyInterval[]; occurrenceCount: number }
  | { ok: false; code: string };

async function readFresh(
  url: string,
  window: { from: string; to: string },
  request: ExternalBusyRequest,
  previous: BusySnapshot | null,
  fetchCalendar: (url: string) => Promise<CalendarFetchResult>,
): Promise<FreshOutcome> {
  let fetched: CalendarFetchResult;
  try {
    fetched = await fetchCalendar(url);
  } catch {
    return { ok: false, code: 'network' };
  }
  if (!fetched.ok) return { ok: false, code: fetched.code };

  const parsed = parseBusyIcs(fetched.body, { ...window, fallbackZone: request.resource.timezone });
  if (!parsed.ok) return { ok: false, code: parsed.code };

  // Filet de révocation silencieuse : un hôte dont on n'a pas MESURÉ ce que
  // rend une URL dépubliée, qui passe brutalement d'un agenda rempli à rien.
  if (
    !isUnpublishMeasured(fetched.host) &&
    parsed.occurrenceCount === 0 &&
    (previous?.occurrenceCount ?? 0) >= SUSPICIOUS_EMPTY_PREVIOUS_COUNT
  ) {
    return { ok: false, code: 'suspicious_empty' };
  }
  return { ok: true, intervals: parsed.intervals, occurrenceCount: parsed.occurrenceCount };
}

/**
 * Fenêtre LUE : tout ce que le moteur peut offrir (de la veille à l'horizon,
 * marges comprises), et au moins la demande. La copie doit pouvoir servir
 * n'importe quelle page de créneaux, pas seulement celle qui l'a déclenchée.
 */
function readWindow(request: ExternalBusyRequest, at: Date): { from: string; to: string } {
  const standardFrom = at.getTime() - DAY_MS;
  const standardTo = at.getTime() + (request.resource.horizonDays + 2) * DAY_MS;
  const from = Math.min(Date.parse(request.from), standardFrom);
  const to = Math.max(Date.parse(request.to), standardTo);
  return {
    from: new Date(Number.isFinite(from) ? from : standardFrom).toISOString(),
    to: new Date(Number.isFinite(to) ? to : standardTo).toISOString(),
  };
}

function lastGoodOf(
  snapshot: BusySnapshot | null,
): { intervals: BusyInterval[]; readAt: string; from: string; to: string } | null {
  if (!snapshot?.readAt || !snapshot.windowFrom || !snapshot.windowTo) return null;
  return {
    intervals: snapshot.intervals,
    readAt: snapshot.readAt,
    from: snapshot.windowFrom,
    to: snapshot.windowTo,
  };
}

function covers(copy: { from: string; to: string }, request: { from: string; to: string }): boolean {
  return Date.parse(copy.from) <= Date.parse(request.from) && Date.parse(copy.to) >= Date.parse(request.to);
}

async function safeObserve(deps: IcsBusyProviderDeps, observation: BusyReadObservation): Promise<void> {
  if (!deps.observe) return;
  try {
    await deps.observe(observation);
  } catch {
    // Observer n'est jamais une raison de refuser une lecture.
  }
}
