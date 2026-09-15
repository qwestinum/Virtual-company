/**
 * Adaptateur agenda publié → port du module. Aucun réseau, aucune base :
 * la fiche et la lecture HTTP sont injectées.
 *
 * Ce qui est protégé :
 *   - « aucun agenda » et « agenda illisible » ne se confondent JAMAIS ;
 *   - à chaque étage, un échec rend `unavailable`, pas une liste vide ;
 *   - un export Google COMPLET ne laisse sortir que des bornes ;
 *   - l'URL ne fuit dans aucune réponse.
 */
import { describe, expect, it } from 'vitest';

import type { CalendarFetchResult } from '@/lib/calendar/busy-ics/fetch';
import type { BusySnapshot } from '@/lib/db/repos/busy-snapshots';
import type { ExternalBusyRequest } from '@/lib/scheduling';

import { isBusyCalendarEnabled } from '../flag';
import {
  createIcsBusyProvider,
  type BusyReadObservation,
  type BusySnapshotStore,
} from '../provider';

const NOW = new Date('2026-10-01T06:00:00.000Z');
const SECRET_URL = 'https://outlook.live.com/owa/calendar/x/SECRET-TOKEN/calendar.ics';

const REQUEST: ExternalBusyRequest = {
  resource: {
    id: 'r-1',
    externalRef: '11111111-1111-1111-1111-111111111111',
    timezone: 'Europe/Paris',
    horizonDays: 30,
  },
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-11-01T00:00:00.000Z',
  freshness: 'live',
};

const ICS = (...lines: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');

const fetched = (body: string): CalendarFetchResult => ({
  ok: true,
  body,
  provider: 'microsoft',
  host: 'outlook.live.com',
  durationMs: 12,
});

function provider(overrides: Partial<Parameters<typeof createIcsBusyProvider>[0]> = {}) {
  return createIcsBusyProvider({
    loadCalendarUrl: async () => ({ kind: 'url', url: SECRET_URL }),
    fetchCalendar: async () => fetched(ICS('UID:a', 'DTSTART:20261020T080000Z', 'DTEND:20261020T090000Z')),
    now: () => NOW,
    ...overrides,
  });
}

describe('createIcsBusyProvider', () => {
  it('rend les intervalles d’un agenda lu', async () => {
    expect(await provider().read(REQUEST)).toEqual({
      kind: 'ok',
      intervals: [{ startAt: '2026-10-20T08:00:00.000Z', endAt: '2026-10-20T09:00:00.000Z' }],
      readAt: NOW.toISOString(),
    });
  });

  it('un agenda VIDE est lu, pas en panne', async () => {
    const empty = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
    expect(await provider({ fetchCalendar: async () => fetched(empty) }).read(REQUEST)).toEqual({
      kind: 'ok',
      intervals: [],
      readAt: NOW.toISOString(),
    });
  });

  it('sans agenda déclaré : `not_configured`, sans lire quoi que ce soit', async () => {
    let fetches = 0;
    const p = provider({
      loadCalendarUrl: async () => ({ kind: 'none' }),
      fetchCalendar: async () => {
        fetches += 1;
        return fetched('');
      },
    });
    expect(await p.read(REQUEST)).toEqual({ kind: 'not_configured' });
    expect(fetches).toBe(0);
  });

  it.each([
    ['URL indéchiffrable', { loadCalendarUrl: async () => ({ kind: 'unreadable' as const }) }],
    [
      'fiche illisible (base en panne)',
      {
        loadCalendarUrl: async () => {
          throw new Error(`boom ${SECRET_URL}`);
        },
      },
    ],
    [
      'URL dépubliée (302 → page HTML)',
      { fetchCalendar: async (): Promise<CalendarFetchResult> => ({ ok: false, code: 'not_calendar', durationMs: 40 }) },
    ],
    [
      'lecture qui lève',
      {
        fetchCalendar: async (): Promise<CalendarFetchResult> => {
          throw new Error(`fetch failed ${SECRET_URL}`);
        },
      },
    ],
    ['document illisible', { fetchCalendar: async () => fetched('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VCALENDAR') }],
  ])('%s : `unavailable`, jamais une liste vide, jamais l’URL', async (_label, overrides) => {
    const answer = await provider(overrides).read(REQUEST);
    expect(answer).toEqual({ kind: 'unavailable', lastGood: null, failingSince: NOW.toISOString() });
    expect(JSON.stringify(answer)).not.toContain('SECRET-TOKEN');
  });

  it('un export Google complet ne laisse sortir que des bornes', async () => {
    const google = ICS(
      'UID:SECRET-UID@google.com',
      'DTSTART:20261020T080000Z',
      'DTEND:20261020T090000Z',
      'SUMMARY:SECRET-SUMMARY',
      'DESCRIPTION:SECRET-DESCRIPTION',
      'LOCATION:SECRET-LOCATION',
      'ATTENDEE;CN=SECRET-ATTENDEE:mailto:secret@exemple.test',
      'ORGANIZER;CN=SECRET-ORGANIZER:mailto:orga@exemple.test',
    );
    const answer = await provider({ fetchCalendar: async () => fetched(google) }).read(REQUEST);
    expect(JSON.stringify(answer)).not.toMatch(/SECRET|exemple\.test/i);
    expect(answer).toMatchObject({ kind: 'ok', intervals: [{ startAt: '2026-10-20T08:00:00.000Z' }] });
  });

  it('interprète une journée entière dans le fuseau de la ressource', async () => {
    // 15 octobre 2026 à Paris (CEST, +02:00).
    const allDay = ICS('UID:c', 'DTSTART;VALUE=DATE:20261015', 'DTEND;VALUE=DATE:20261016');
    const answer = await provider({ fetchCalendar: async () => fetched(allDay) }).read(REQUEST);
    expect(answer).toMatchObject({
      intervals: [{ startAt: '2026-10-14T22:00:00.000Z', endAt: '2026-10-15T22:00:00.000Z' }],
    });
  });
});

describe('isBusyCalendarEnabled — fail-closed', () => {
  const KEY = 'a'.repeat(64);

  it('allumé seulement sur `1` strict ET une clé bien formée', () => {
    expect(isBusyCalendarEnabled({ BUSY_CALENDAR_ENABLED: '1', MAILBOX_ENCRYPTION_KEY: KEY })).toBe(true);
    expect(isBusyCalendarEnabled({ BUSY_CALENDAR_ENABLED: ' 1 ', MAILBOX_ENCRYPTION_KEY: KEY })).toBe(true);
  });

  it.each([
    [{}],
    [{ BUSY_CALENDAR_ENABLED: 'true', MAILBOX_ENCRYPTION_KEY: KEY }],
    [{ BUSY_CALENDAR_ENABLED: '', MAILBOX_ENCRYPTION_KEY: KEY }],
    [{ BUSY_CALENDAR_ENABLED: '0', MAILBOX_ENCRYPTION_KEY: KEY }],
    [{ BUSY_CALENDAR_ENABLED: '1' }],
    [{ BUSY_CALENDAR_ENABLED: '1', MAILBOX_ENCRYPTION_KEY: 'court' }],
  ])('éteint pour %j', (env) => {
    expect(isBusyCalendarEnabled(env)).toBe(false);
  });
});

// ─── Copie en base (lot B) ──────────────────────────────────────────────

const BUSY_ICS = ICS('UID:a', 'DTSTART:20261020T080000Z', 'DTEND:20261020T090000Z');
const FIVE_EVENTS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  ...[1, 2, 3, 4, 5].flatMap((d) => [
    'BEGIN:VEVENT',
    `UID:e${d}`,
    `DTSTART:2026101${d}T080000Z`,
    `DTEND:2026101${d}T090000Z`,
    'END:VEVENT',
  ]),
  'END:VCALENDAR',
  '',
].join('\r\n');
const EMPTY_ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

/** Copie en mémoire, même contrat que le repo. */
function memoryStore(initial: BusySnapshot | null = null) {
  let row = initial;
  const store: BusySnapshotStore & { current: () => BusySnapshot | null } = {
    current: () => row,
    async get() {
      return row;
    },
    async recordSuccess(input) {
      row = {
        recruiterId: input.recruiterId,
        intervals: input.intervals,
        windowFrom: input.windowFrom,
        windowTo: input.windowTo,
        occurrenceCount: input.occurrenceCount,
        readAt: input.readAt,
        attemptedAt: input.readAt,
        failingSince: null,
        failureCode: null,
        lastState: row?.lastState ?? null,
      };
    },
    async recordFailure(input) {
      const failingSince = input.previous?.failingSince ?? input.attemptedAt;
      row = {
        ...(row ?? {
          recruiterId: input.recruiterId,
          intervals: [],
          windowFrom: null,
          windowTo: null,
          occurrenceCount: 0,
          readAt: null,
          lastState: null,
        }),
        attemptedAt: input.attemptedAt,
        failingSince,
        failureCode: input.code,
      };
      return failingSince;
    },
  };
  return store;
}

function clock(start: string) {
  let t = Date.parse(start);
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

describe('createIcsBusyProvider — copie en base', () => {
  function setup(bodies: (string | CalendarFetchResult)[], host = 'outlook.live.com') {
    const store = memoryStore();
    const time = clock('2026-10-01T06:00:00.000Z');
    const observations: BusyReadObservation[] = [];
    let fetches = 0;
    const provider = createIcsBusyProvider({
      loadCalendarUrl: async () => ({ kind: 'url', url: SECRET_URL }),
      fetchCalendar: async () => {
        const next = bodies[Math.min(fetches, bodies.length - 1)] as string | CalendarFetchResult;
        fetches += 1;
        return typeof next === 'string' ? { ...fetched(next), host } : next;
      },
      store,
      observe: async (o) => {
        observations.push(o);
      },
      now: time.now,
    });
    return { provider, store, time, observations, fetches: () => fetches };
  }
  const OFFER = { ...REQUEST, freshness: 'snapshot' as const };
  const DEAD: CalendarFetchResult = { ok: false, code: 'not_calendar', durationMs: 30 };

  it('écrit la copie sur toute la fenêtre offrable, pas seulement la demande', async () => {
    const { provider, store } = setup([BUSY_ICS]);
    await provider.read(REQUEST);
    expect(store.current()).toMatchObject({
      intervals: [{ startAt: '2026-10-20T08:00:00.000Z', endAt: '2026-10-20T09:00:00.000Z' }],
      windowFrom: '2026-09-30T06:00:00.000Z',
      // horizon 30 j + 2 j de marge
      windowTo: '2026-11-02T06:00:00.000Z',
      readAt: '2026-10-01T06:00:00.000Z',
      failingSince: null,
    });
  });

  it('sert l’offre depuis une copie de moins d’une minute, sans relire', async () => {
    const { provider, time, fetches } = setup([BUSY_ICS]);
    await provider.read(OFFER);
    time.advance(59_000);
    expect(await provider.read(OFFER)).toMatchObject({ kind: 'ok', readAt: '2026-10-01T06:00:00.000Z' });
    expect(fetches()).toBe(1);
    time.advance(2_000);
    await provider.read(OFFER);
    expect(fetches()).toBe(2);
  });

  it('la confirmation relit TOUJOURS, même avec une copie de la seconde', async () => {
    const { provider, fetches } = setup([BUSY_ICS]);
    await provider.read(OFFER);
    await provider.read(REQUEST);
    expect(fetches()).toBe(2);
  });

  it('en panne : garde la copie, la rend comme dernière lecture, et date la panne à sa PREMIÈRE occurrence', async () => {
    const { provider, store, time } = setup([BUSY_ICS, DEAD]);
    await provider.read(REQUEST);
    time.advance(10 * 60_000);
    const first = await provider.read(REQUEST);
    time.advance(10 * 60_000);
    const second = await provider.read(REQUEST);
    const lastGood = {
      intervals: [{ startAt: '2026-10-20T08:00:00.000Z', endAt: '2026-10-20T09:00:00.000Z' }],
      readAt: '2026-10-01T06:00:00.000Z',
      from: '2026-09-30T06:00:00.000Z',
      to: '2026-11-02T06:00:00.000Z',
    };
    expect(first).toEqual({ kind: 'unavailable', lastGood, failingSince: '2026-10-01T06:10:00.000Z' });
    expect(second).toEqual({ kind: 'unavailable', lastGood, failingSince: '2026-10-01T06:10:00.000Z' });
    expect(store.current()).toMatchObject({ failureCode: 'not_calendar', attemptedAt: '2026-10-01T06:20:00.000Z' });
  });

  it('en panne, l’offre ne relit pas plus d’une fois par minute', async () => {
    const { provider, time, fetches } = setup([BUSY_ICS, DEAD]);
    await provider.read(REQUEST);
    time.advance(5 * 60_000);
    await provider.read(OFFER); // relit : copie trop vieille → panne constatée
    time.advance(20_000);
    expect(await provider.read(OFFER)).toMatchObject({ kind: 'unavailable' });
    expect(fetches()).toBe(2);
  });

  it('une lecture réussie efface la panne', async () => {
    const { provider, store, time } = setup([BUSY_ICS, DEAD, EMPTY_ICS]);
    await provider.read(REQUEST);
    time.advance(60_000);
    await provider.read(REQUEST);
    time.advance(60_000);
    expect(await provider.read(REQUEST)).toMatchObject({ kind: 'ok', intervals: [] });
    expect(store.current()).toMatchObject({ failingSince: null, failureCode: null });
  });

  it('prévient l’observateur des lectures RÉELLES seulement', async () => {
    const { provider, time, observations } = setup([BUSY_ICS, DEAD]);
    await provider.read(REQUEST);
    time.advance(60_000);
    await provider.read(REQUEST);
    time.advance(10_000);
    await provider.read(OFFER); // pas de relecture : pas d'observation
    expect(observations.map((o) => (o.ok ? 'ok' : o.code))).toEqual(['ok', 'not_calendar']);
    expect(JSON.stringify(observations)).not.toContain('SECRET-TOKEN');
  });

  it('filet de révocation silencieuse : un hôte NON MESURÉ qui tombe à zéro est une panne', async () => {
    const { provider, store, time } = setup([FIVE_EVENTS, EMPTY_ICS], 'outlook.office365.com');
    await provider.read(REQUEST);
    time.advance(60_000);
    expect(await provider.read(REQUEST)).toMatchObject({ kind: 'unavailable' });
    expect(store.current()).toMatchObject({ failureCode: 'suspicious_empty', occurrenceCount: 5 });
  });

  it('pas de filet sur un hôte dont la dépublication est mesurée : un vide y est un vide', async () => {
    const { provider, time } = setup([FIVE_EVENTS, EMPTY_ICS], 'outlook.live.com');
    await provider.read(REQUEST);
    time.advance(60_000);
    expect(await provider.read(REQUEST)).toMatchObject({ kind: 'ok', intervals: [] });
  });

  it('pas de filet sous le seuil : un agenda de quatre rendez-vous peut se vider', async () => {
    const four = ICS('UID:a', 'DTSTART:20261020T080000Z', 'DTEND:20261020T090000Z');
    const { provider, time } = setup([four, EMPTY_ICS], 'outlook.office365.com');
    await provider.read(REQUEST);
    time.advance(60_000);
    expect(await provider.read(REQUEST)).toMatchObject({ kind: 'ok' });
  });
});
