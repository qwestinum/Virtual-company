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
import type { ExternalBusyRequest } from '@/lib/scheduling';

import { isBusyCalendarEnabled } from '../flag';
import { createIcsBusyProvider } from '../provider';

const NOW = new Date('2026-10-01T06:00:00.000Z');
const SECRET_URL = 'https://outlook.live.com/owa/calendar/x/SECRET-TOKEN/calendar.ics';

const REQUEST: ExternalBusyRequest = {
  resource: { id: 'r-1', externalRef: '11111111-1111-1111-1111-111111111111', timezone: 'Europe/Paris' },
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-11-01T00:00:00.000Z',
  freshness: 'live',
};

const ICS = (...lines: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');

const fetched = (body: string): CalendarFetchResult => ({ ok: true, body, provider: 'microsoft', durationMs: 12 });

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
