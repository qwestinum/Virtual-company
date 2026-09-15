/**
 * Relève périodique des agendas publiés (lot C).
 *
 * Sans elle, l'état d'un agenda n'avance qu'aux lectures déclenchées par un
 * candidat : une URL morte sans visite ne prévient personne. La relève lit
 * CHAQUE agenda configuré à chaque passe, par la MÊME source que la
 * confirmation (`live`) — donc mêmes règles d'acceptation, même copie en base,
 * mêmes transitions, même email à l'entrée en suspension. Aucune seconde règle.
 *
 * Une passe :
 *   - périmètre : recruteurs actifs avec agenda déclaré, dont la ressource est
 *     active (un agenda qui n'offre rien n'a pas à être lu) ;
 *   - ordre : les agendas relus il y a le plus longtemps d'abord — une passe
 *     interrompue par son budget reprend là où elle a laissé les plus en retard ;
 *   - parallélisme borné, budget de temps borné (la fonction a 60 s en face) ;
 *   - réservation par recruteur : deux passes qui se chevauchent ne lisent pas
 *     le même agenda ensemble ;
 *   - un agenda en échec ne fait JAMAIS échouer la passe.
 *
 * Le rapport ne contient que des compteurs : ni URL, ni identité, ni intervalle.
 *
 * Spec : docs/specs/agenda-externe.md §3.2.
 */
import {
  claimBusyRefresh,
  listBusySnapshots,
  type BusySnapshot,
} from '@/lib/db/repos/busy-snapshots';
import { listRecruiterIdsWithCalendar } from '@/lib/db/repos/recruiters';
import {
  getBusyProvider,
  getResource,
  type BusyProvider,
  type Resource,
} from '@/lib/scheduling';

import { ensureSchedulingConfigured } from '../configure';
import { isBusyCalendarEnabled } from './flag';

export type BusyRefreshReport = {
  enabled: boolean;
  recruiters: number;
  ok: number;
  failed: number;
  skippedInactive: number;
  skippedClaimed: number;
  /** Laissés à la passe suivante faute de budget. */
  deferred: number;
  durationMs: number;
  /** La passe elle-même a échoué (liste des agendas illisible, ports absents). */
  error?: 'refresh_failed';
};

export type BusyRefreshDeps = {
  provider: BusyProvider | null;
  listRecruiterIds: () => Promise<string[]>;
  listSnapshots: (ids: readonly string[]) => Promise<BusySnapshot[]>;
  getResource: (externalRef: string) => Promise<Resource | null>;
  claim: (recruiterId: string, nowIso: string, ttlMs: number) => Promise<boolean>;
  now?: () => Date;
  /** Horloge monotone (budget). */
  clock?: () => number;
  budgetMs?: number;
  concurrency?: number;
  claimTtlMs?: number;
};

/** Laisse une large marge sous les 60 s de la fonction : une lecture lancée peut durer 5 s. */
export const DEFAULT_REFRESH_BUDGET_MS = 40_000;
export const DEFAULT_REFRESH_CONCURRENCY = 5;
/** Plus court que la cadence du cron (60 s) : la passe suivante n'est jamais bloquée par celle-ci. */
export const DEFAULT_REFRESH_CLAIM_TTL_MS = 50_000;

const DAY_MS = 86_400_000;

export async function refreshBusyCalendarsWith(deps: BusyRefreshDeps): Promise<BusyRefreshReport> {
  const clock = deps.clock ?? (() => performance.now());
  const now = deps.now ?? (() => new Date());
  const startedAt = clock();
  const report: BusyRefreshReport = {
    enabled: deps.provider !== null,
    recruiters: 0,
    ok: 0,
    failed: 0,
    skippedInactive: 0,
    skippedClaimed: 0,
    deferred: 0,
    durationMs: 0,
  };
  const finish = () => ({ ...report, durationMs: Math.round(clock() - startedAt) });
  const provider = deps.provider;
  if (!provider) return finish();

  const ids = await deps.listRecruiterIds();
  report.recruiters = ids.length;
  if (ids.length === 0) return finish();

  const snapshots = await deps.listSnapshots(ids).catch(() => [] as BusySnapshot[]);
  const attempted = new Map(snapshots.map((s) => [s.recruiterId, s.attemptedAt ?? '']));
  // Jamais tenté ('') d'abord, puis du plus ancien au plus récent.
  const queue = [...ids].sort((a, b) => (attempted.get(a) ?? '').localeCompare(attempted.get(b) ?? ''));

  const budgetMs = deps.budgetMs ?? DEFAULT_REFRESH_BUDGET_MS;
  const ttlMs = deps.claimTtlMs ?? DEFAULT_REFRESH_CLAIM_TTL_MS;

  const worker = async (): Promise<void> => {
    for (;;) {
      const recruiterId = queue.shift();
      if (recruiterId === undefined) return;
      if (clock() - startedAt > budgetMs) {
        report.deferred += 1;
        continue;
      }
      try {
        const resource = await deps.getResource(recruiterId);
        if (!resource || !resource.isActive) {
          report.skippedInactive += 1;
          continue;
        }
        const at = now();
        if (!(await deps.claim(recruiterId, at.toISOString(), ttlMs))) {
          report.skippedClaimed += 1;
          continue;
        }
        const answer = await provider.read({
          resource: {
            id: resource.id,
            externalRef: resource.externalRef,
            timezone: resource.timezone,
            horizonDays: resource.horizonDays,
          },
          from: at.toISOString(),
          to: new Date(at.getTime() + resource.horizonDays * DAY_MS).toISOString(),
          freshness: 'live',
        });
        if (answer.kind === 'ok') report.ok += 1;
        else if (answer.kind === 'unavailable') report.failed += 1;
        else report.skippedInactive += 1; // URL retirée entre la liste et la lecture
      } catch {
        report.failed += 1;
      }
    }
  };

  const concurrency = Math.max(1, deps.concurrency ?? DEFAULT_REFRESH_CONCURRENCY);
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return finish();
}

/**
 * Relève branchée sur l'application : flag, ports du module, repos. Ne lève
 * jamais — le rail qui l'appelle (cron, tick de dev) ne doit pas tomber pour
 * un agenda. Une panne de la passe elle-même est DITE (`error`), pas déguisée
 * en « connecteur éteint ».
 */
export async function refreshBusyCalendars(): Promise<BusyRefreshReport> {
  const empty: BusyRefreshReport = {
    enabled: isBusyCalendarEnabled(),
    recruiters: 0,
    ok: 0,
    failed: 0,
    skippedInactive: 0,
    skippedClaimed: 0,
    deferred: 0,
    durationMs: 0,
  };
  if (!empty.enabled) return empty;
  try {
    await ensureSchedulingConfigured();
    return await refreshBusyCalendarsWith({
      provider: getBusyProvider(),
      listRecruiterIds: listRecruiterIdsWithCalendar,
      listSnapshots: listBusySnapshots,
      getResource,
      claim: claimBusyRefresh,
    });
  } catch {
    // Jamais le détail : il pourrait citer une valeur de la base.
    console.error('[busy-calendars] relève en échec');
    return { ...empty, error: 'refresh_failed' };
  }
}
