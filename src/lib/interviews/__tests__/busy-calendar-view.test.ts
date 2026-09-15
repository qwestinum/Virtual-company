import { describe, expect, it } from 'vitest';

import type { BusyCalendarStatus } from '@/types/busy-calendar';

import { busyCalendarHeadline, formatReadAgo } from '../busy-calendar-view';

const NOW = Date.parse('2026-09-15T12:00:00.000Z');
const status = (over: Partial<BusyCalendarStatus>): BusyCalendarStatus => ({
  available: true,
  configured: true,
  providerLabel: 'Outlook',
  state: 'healthy',
  readAt: '2026-09-15T11:58:00.000Z',
  failingSince: null,
  upcomingCount: 14,
  action: null,
  ...over,
});

describe('formatReadAgo', () => {
  it('parle comme on parle', () => {
    expect(formatReadAgo('2026-09-15T11:59:30.000Z', NOW)).toBe('à l’instant');
    expect(formatReadAgo('2026-09-15T11:48:00.000Z', NOW)).toBe('il y a 12 min');
    expect(formatReadAgo('2026-09-15T09:00:00.000Z', NOW)).toBe('il y a 3 h');
    expect(formatReadAgo('2026-09-13T07:42:00.000Z', NOW)).toBe('le 13/09 à 09:42');
  });
});

describe('busyCalendarHeadline', () => {
  it('sain : relu quand, combien', () => {
    expect(busyCalendarHeadline(status({}), NOW)).toEqual({
      tone: 'ok',
      text: 'Agenda Outlook relu il y a 2 min · 14 plages occupées sur les 30 prochains jours.',
    });
  });

  it('toléré, puis suspendu : le dit, sans jargon', () => {
    expect(busyCalendarHeadline(status({ state: 'tolerated' }), NOW).tone).toBe('warn');
    const blocked = busyCalendarHeadline(status({ state: 'blocked', failingSince: '2026-09-15T07:42:00.000Z' }), NOW);
    expect(blocked.tone).toBe('danger');
    expect(blocked.text).toContain('depuis 09:42');
    expect(blocked.text).toContain('ne sont plus proposés');
  });

  it('fonction éteinte par le cabinet, lien enregistré : il est IGNORÉ, et on le dit', () => {
    const text = busyCalendarHeadline(status({ available: false }), NOW).text;
    expect(text).toContain('désactivée pour ton cabinet');
    expect(text).toContain('pas pris en compte');
  });

  it('en attente de première lecture, et sans lien', () => {
    expect(busyCalendarHeadline(status({ state: 'pending', readAt: null }), NOW).text).toContain('première lecture');
    expect(busyCalendarHeadline(status({ configured: false, state: 'unconfigured' }), NOW).tone).toBe('muted');
  });
});
