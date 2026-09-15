/**
 * Relève périodique — ordonnancement pur, sans base ni réseau.
 */
import { describe, expect, it } from 'vitest';

import type { BusySnapshot } from '@/lib/db/repos/busy-snapshots';
import type { ExternalBusyAnswer, ExternalBusyRequest, Resource } from '@/lib/scheduling';

import { refreshBusyCalendarsWith, type BusyRefreshDeps } from '../refresh';

const NOW = new Date('2026-09-15T08:00:00.000Z');

const resource = (id: string, overrides: Partial<Resource> = {}): Resource => ({
  id: `res-${id}`,
  externalRef: id,
  displayName: id,
  timezone: 'Europe/Paris',
  slotDurationMinutes: 45,
  bufferMinutes: 15,
  minNoticeMinutes: 0,
  horizonDays: 30,
  meetingLocation: null,
  notifyEmail: null,
  isActive: true,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...overrides,
});

const snapshot = (recruiterId: string, attemptedAt: string | null): BusySnapshot => ({
  recruiterId,
  intervals: [],
  windowFrom: null,
  windowTo: null,
  occurrenceCount: 0,
  readAt: null,
  attemptedAt,
  failingSince: null,
  failureCode: null,
  lastState: null,
});

function deps(overrides: Partial<BusyRefreshDeps> & { answers?: Record<string, ExternalBusyAnswer | Error> } = {}) {
  const reads: ExternalBusyRequest[] = [];
  const { answers = {}, ...rest } = overrides;
  const base: BusyRefreshDeps = {
    provider: {
      async read(request) {
        reads.push(request);
        const answer = answers[request.resource.externalRef];
        if (answer instanceof Error) throw answer;
        return answer ?? { kind: 'ok', intervals: [], readAt: NOW.toISOString() };
      },
    },
    listRecruiterIds: async () => ['a', 'b', 'c'],
    listSnapshots: async () => [],
    getResource: async (id) => resource(id),
    claim: async () => true,
    now: () => NOW,
    concurrency: 1,
    ...rest,
  };
  return { deps: base, reads };
}

describe('refreshBusyCalendarsWith', () => {
  it('lit chaque agenda en direct, sur l’horizon de sa ressource', async () => {
    const { deps: d, reads } = deps({ getResource: async (id) => resource(id, { horizonDays: 10 }) });
    const report = await refreshBusyCalendarsWith(d);
    expect(report).toMatchObject({ enabled: true, recruiters: 3, ok: 3, failed: 0, deferred: 0 });
    expect(reads[0]).toEqual({
      resource: { id: 'res-a', externalRef: 'a', timezone: 'Europe/Paris', horizonDays: 10 },
      from: '2026-09-15T08:00:00.000Z',
      to: '2026-09-25T08:00:00.000Z',
      freshness: 'live',
    });
  });

  it('commence par les agendas jamais tentés, puis les plus anciens', async () => {
    const { deps: d, reads } = deps({
      listSnapshots: async () => [
        snapshot('a', '2026-09-15T07:59:00.000Z'),
        snapshot('c', '2026-09-15T07:00:00.000Z'),
      ],
    });
    await refreshBusyCalendarsWith(d);
    expect(reads.map((r) => r.resource.externalRef)).toEqual(['b', 'c', 'a']);
  });

  it('un agenda en panne, ou une source qui lève, ne fait pas échouer la passe', async () => {
    const { deps: d } = deps({
      answers: {
        a: { kind: 'unavailable', lastGood: null, failingSince: NOW.toISOString() },
        b: new Error('boom'),
      },
    });
    expect(await refreshBusyCalendarsWith(d)).toMatchObject({ ok: 1, failed: 2 });
  });

  it('ignore une ressource désactivée ou absente, sans la lire', async () => {
    const { deps: d, reads } = deps({
      getResource: async (id) => (id === 'a' ? null : resource(id, { isActive: id !== 'b' })),
    });
    expect(await refreshBusyCalendarsWith(d)).toMatchObject({ ok: 1, skippedInactive: 2 });
    expect(reads.map((r) => r.resource.externalRef)).toEqual(['c']);
  });

  it('ne lit pas un agenda qu’une autre passe a déjà réservé', async () => {
    const { deps: d, reads } = deps({ claim: async (id) => id !== 'b' });
    expect(await refreshBusyCalendarsWith(d)).toMatchObject({ ok: 2, skippedClaimed: 1 });
    expect(reads.map((r) => r.resource.externalRef)).toEqual(['a', 'c']);
  });

  it('s’arrête au budget et laisse le reste à la passe suivante', async () => {
    let t = 0;
    const { deps: d, reads } = deps({
      clock: () => t,
      budgetMs: 1_000,
      getResource: async (id) => {
        t += 600; // chaque lecture « coûte » 600 ms
        return resource(id);
      },
    });
    expect(await refreshBusyCalendarsWith(d)).toMatchObject({ ok: 2, deferred: 1 });
    expect(reads).toHaveLength(2);
  });

  it('lit en parallèle, sans dépasser la borne', async () => {
    let inFlight = 0;
    let peak = 0;
    const { deps: d } = deps({
      concurrency: 2,
      listRecruiterIds: async () => ['a', 'b', 'c', 'd', 'e'],
      provider: {
        async read() {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
          return { kind: 'ok', intervals: [], readAt: NOW.toISOString() };
        },
      },
    });
    expect(await refreshBusyCalendarsWith(d)).toMatchObject({ ok: 5 });
    expect(peak).toBe(2);
  });

  it('connecteur sans source : rien n’est lu', async () => {
    const { deps: d } = deps({ provider: null });
    expect(await refreshBusyCalendarsWith(d)).toMatchObject({ enabled: false, recruiters: 0, ok: 0 });
  });

  it('le rapport ne contient que des compteurs', async () => {
    const { deps: d } = deps();
    const report = await refreshBusyCalendarsWith(d);
    expect(Object.values(report).every((v) => typeof v === 'number' || typeof v === 'boolean')).toBe(true);
  });
});
