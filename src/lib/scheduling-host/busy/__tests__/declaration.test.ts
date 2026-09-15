/**
 * Saisie de l'agenda : lecture d'essai, messages, état affiché, flag cabinet.
 * Aucun réseau ni base.
 */
import { describe, expect, it } from 'vitest';

import type { CalendarFetchResult } from '@/lib/calendar/busy-ics/fetch';
import type { BusySnapshot } from '@/lib/db/repos/busy-snapshots';

import { isBusyCalendarActive } from '../active';
import { DETAILS_WARNING, probeBusyCalendar, probeFailureMessage, probeSuccessMessage } from '../declaration';
import { createIcsBusyProvider } from '../provider';
import { buildBusyCalendarStatus } from '../status';

const NOW = new Date('2026-09-15T08:00:00.000Z');
const KEY = 'a'.repeat(64);
const SECRET_URL = 'https://outlook.live.com/owa/calendar/x/SECRET-TOKEN/calendar.ics';

const ics = (...events: string[][]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR', ''].join(
    '\r\n',
  );
const served = (body: string): (() => Promise<CalendarFetchResult>) => async () => ({
  ok: true,
  body,
  provider: 'microsoft',
  host: 'outlook.live.com',
  durationMs: 10,
});
const probe = (fetchCalendar: () => Promise<CalendarFetchResult>) =>
  probeBusyCalendar(SECRET_URL, { timezone: 'Europe/Paris', horizonDays: 30, now: NOW, fetchCalendar });

describe('probeBusyCalendar', () => {
  it('compte les plages occupées des 30 prochains jours, sans rien d’autre', async () => {
    const result = await probe(
      served(
        ics(
          ['UID:a', 'DTSTART:20260916T080000Z', 'DTEND:20260916T090000Z'],
          ['UID:b', 'DTSTART:20260920T080000Z', 'DTEND:20260920T090000Z'],
          // 31e jour : dans la fenêtre lue (horizon 30 j + 2 j), hors du compte des 30 jours
          ['UID:c', 'DTSTART:20261016T080000Z', 'DTEND:20261016T090000Z'],
        ),
      ),
    );
    expect(result).toMatchObject({ ok: true, provider: 'microsoft', upcomingCount: 2, empty: false, carriesDetails: false });
    expect(result.ok && result.seed.intervals).toHaveLength(3);
    expect(result.ok && result.seed.windowFrom).toBe('2026-09-14T08:00:00.000Z');
  });

  it('un agenda vide est lu — et signalé comme vide', async () => {
    expect(await probe(served(ics()))).toMatchObject({ ok: true, upcomingCount: 0, empty: true });
  });

  it('dit quand le lien publie le détail des rendez-vous', async () => {
    const result = await probe(
      served(ics(['UID:a', 'DTSTART:20260916T080000Z', 'DTEND:20260916T090000Z', 'LOCATION:Salle SECRET'])),
    );
    expect(result).toMatchObject({ ok: true, carriesDetails: true });
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('rend le code d’échec de la lecture, jamais l’URL', async () => {
    const failed = await probe(async () => ({ ok: false, code: 'not_calendar', durationMs: 5 }));
    expect(failed).toEqual({ ok: false, code: 'not_calendar' });
    const thrown = await probe(async () => {
      throw new Error(`fetch failed ${SECRET_URL}`);
    });
    expect(thrown).toEqual({ ok: false, code: 'network' });
  });
});

describe('messages de saisie', () => {
  it('chaque échec dit quoi faire, sans jargon ni code', () => {
    const codes = [
      'invalid_url',
      'host_not_allowed',
      'provider_not_accepted',
      'http_status',
      'not_calendar',
      'truncated',
      'parse_error',
      'timeout',
      'redirect_refused',
      'inconnu',
    ];
    for (const code of codes) {
      const message = probeFailureMessage(code);
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toContain(code);
      expect(message).not.toMatch(/HTTP|404|302|\bURL\b/);
    }
    expect(probeFailureMessage('not_calendar')).toContain('lien ICS');
    expect(probeFailureMessage('provider_not_accepted')).toContain('Google');
  });

  it('accorde le compte, et signale un agenda vide', () => {
    expect(probeSuccessMessage({ upcomingCount: 1, empty: false })).toBe(
      'Agenda lu : 1 plage occupée sur les 30 prochains jours.',
    );
    expect(probeSuccessMessage({ upcomingCount: 14, empty: false })).toBe(
      'Agenda lu : 14 plages occupées sur les 30 prochains jours.',
    );
    expect(probeSuccessMessage({ upcomingCount: 0, empty: true })).toContain('vide');
    expect(DETAILS_WARNING).toContain('Peut voir quand je suis occupé');
  });
});

describe('buildBusyCalendarStatus', () => {
  const snapshot = (over: Partial<BusySnapshot> = {}): BusySnapshot => ({
    recruiterId: 'r',
    intervals: [
      { startAt: '2026-09-16T08:00:00.000Z', endAt: '2026-09-16T09:00:00.000Z' },
      { startAt: '2026-09-01T08:00:00.000Z', endAt: '2026-09-01T09:00:00.000Z' }, // passée
    ],
    windowFrom: '2026-09-14T08:00:00.000Z',
    windowTo: '2026-10-17T08:00:00.000Z',
    occurrenceCount: 2,
    readAt: '2026-09-15T07:58:00.000Z',
    attemptedAt: '2026-09-15T07:58:00.000Z',
    failingSince: null,
    failureCode: null,
    lastState: 'healthy',
    ...over,
  });
  const base = { available: true, configured: true, providerLabel: 'Outlook', nowMs: NOW.getTime() };

  it('sans lien : rien d’autre à dire', () => {
    expect(buildBusyCalendarStatus({ ...base, configured: false, snapshot: null, evaluatedState: null })).toMatchObject({
      state: 'unconfigured',
      providerLabel: null,
    });
  });

  it('enregistré mais jamais lu : en attente', () => {
    expect(buildBusyCalendarStatus({ ...base, snapshot: null, evaluatedState: null })).toMatchObject({ state: 'pending' });
  });

  it('sain : plages À VENIR seulement, aucune action', () => {
    expect(buildBusyCalendarStatus({ ...base, snapshot: snapshot(), evaluatedState: 'healthy' })).toEqual({
      available: true,
      configured: true,
      providerLabel: 'Outlook',
      state: 'healthy',
      readAt: '2026-09-15T07:58:00.000Z',
      failingSince: null,
      upcomingCount: 1,
      action: null,
    });
  });

  it('en panne : l’état évalué et quoi faire', () => {
    const failing = snapshot({ failingSince: '2026-09-15T07:00:00.000Z', failureCode: 'not_calendar' });
    const status = buildBusyCalendarStatus({ ...base, snapshot: failing, evaluatedState: 'blocked' });
    expect(status).toMatchObject({ state: 'blocked', failingSince: '2026-09-15T07:00:00.000Z' });
    expect(status.action).toContain('Republie ton agenda');
  });
});

describe('isBusyCalendarActive — deux étages', () => {
  const on = { BUSY_CALENDAR_ENABLED: '1', MAILBOX_ENCRYPTION_KEY: KEY };

  it('déploiement éteint : faux, sans même lire le réglage du cabinet', async () => {
    let read = false;
    expect(
      await isBusyCalendarActive({
        env: {},
        loadCabinetEnabled: async () => {
          read = true;
          return true;
        },
      }),
    ).toBe(false);
    expect(read).toBe(false);
  });

  it('déploiement allumé : suit le cabinet', async () => {
    expect(await isBusyCalendarActive({ env: on, loadCabinetEnabled: async () => true })).toBe(true);
    expect(await isBusyCalendarActive({ env: on, loadCabinetEnabled: async () => false })).toBe(false);
  });

  it('réglage illisible : éteint', async () => {
    expect(
      await isBusyCalendarActive({
        env: on,
        loadCabinetEnabled: async () => {
          throw new Error('base injoignable');
        },
      }),
    ).toBe(false);
  });
});

describe('createIcsBusyProvider — cabinet éteint', () => {
  it('fait comme si aucun agenda n’était déclaré, sans rien lire', async () => {
    let touched = false;
    const provider = createIcsBusyProvider({
      isActive: async () => false,
      loadCalendarUrl: async () => {
        touched = true;
        return { kind: 'url', url: SECRET_URL };
      },
    });
    expect(
      await provider.read({
        resource: { id: 'r', externalRef: 'r', timezone: 'Europe/Paris', horizonDays: 30 },
        from: NOW.toISOString(),
        to: NOW.toISOString(),
        freshness: 'live',
      }),
    ).toEqual({ kind: 'not_configured' });
    expect(touched).toBe(false);
  });
});
