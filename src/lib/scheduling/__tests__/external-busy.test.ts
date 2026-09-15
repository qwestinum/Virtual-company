/**
 * Indisponibilités externes côté module — tests PURS.
 *
 *   1. le verdict : une source illisible ne vaut JAMAIS « libre » ;
 *   2. le moteur : les intervalles externes retirent des créneaux, avec le
 *      même battement que les réservations.
 */
import { describe, expect, it } from 'vitest';

import { resolveExternalBusy } from '../external-busy';
import { computeSlots, findOfferedSlot, type SlotEngineInput } from '../slots';

const INTERVAL = { startAt: '2026-09-07T08:00:00.000Z', endAt: '2026-09-07T09:00:00.000Z' };

describe('resolveExternalBusy', () => {
  it('sans source : rien à soustraire, rien à bloquer', () => {
    expect(resolveExternalBusy({ kind: 'not_configured' }, 'live')).toEqual({
      intervals: [],
      check: 'none',
      blocked: false,
    });
  });

  it('source lue : ses intervalles, vérifiés en direct à la confirmation', () => {
    const answer = { kind: 'ok' as const, intervals: [INTERVAL], readAt: '2026-09-01T00:00:00.000Z' };
    expect(resolveExternalBusy(answer, 'live')).toEqual({ intervals: [INTERVAL], check: 'live', blocked: false });
    expect(resolveExternalBusy(answer, 'snapshot')).toEqual({
      intervals: [INTERVAL],
      check: 'snapshot',
      blocked: false,
    });
  });

  it('source illisible : BLOQUÉ, avec ou sans dernière lecture connue', () => {
    expect(
      resolveExternalBusy({ kind: 'unavailable', lastGood: null, failingSince: '2026-09-01T00:00:00.000Z' }, 'live'),
    ).toMatchObject({ blocked: true });
    expect(
      resolveExternalBusy(
        {
          kind: 'unavailable',
          lastGood: { intervals: [INTERVAL], readAt: '2026-08-31T23:59:00.000Z' },
          failingSince: '2026-09-01T00:00:00.000Z',
        },
        'snapshot',
      ),
    ).toMatchObject({ blocked: true });
  });
});

describe('computeSlots — intervalles externes', () => {
  // Lundi 7 septembre 2026, 9h-12h Paris (CEST) : 9h, 10h, 11h locales.
  const base: SlotEngineInput = {
    timezone: 'Europe/Paris',
    slotDurationMinutes: 45,
    bufferMinutes: 15,
    minNoticeMinutes: 0,
    horizonDays: 60,
    rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 12 * 60 }],
    exceptions: [],
    busy: [],
    from: '2026-09-07T00:00:00.000Z',
    to: '2026-09-07T23:59:59.000Z',
    now: '2026-09-01T00:00:00.000Z',
  };
  const starts = (input: SlotEngineInput) => computeSlots(input).map((s) => s.startAt);

  it('sans champ externe : le moteur d’avant', () => {
    expect(starts(base)).toEqual([
      '2026-09-07T07:00:00.000Z',
      '2026-09-07T08:00:00.000Z',
      '2026-09-07T09:00:00.000Z',
    ]);
  });

  it('retire le créneau couvert ET applique le battement autour de la plage externe', () => {
    // Réunion 10h-10h30 locale (08:00Z-08:30Z) : 10h tombe (couvert).
    // 11h reste : 10h30 + 15 min de battement = 10h45, avant 11h.
    // 9h reste : fin 9h45 + 15 min = 10h00, collé sans chevauchement.
    expect(
      starts({
        ...base,
        externalBusy: [{ startAt: '2026-09-07T08:00:00.000Z', endAt: '2026-09-07T08:30:00.000Z' }],
      }),
    ).toEqual(['2026-09-07T07:00:00.000Z', '2026-09-07T09:00:00.000Z']);

    // Réunion 10h-10h50 locale : 10h50 + 15 min = 11h05 > 11h ⇒ 11h tombe.
    expect(
      starts({
        ...base,
        externalBusy: [{ startAt: '2026-09-07T08:00:00.000Z', endAt: '2026-09-07T08:50:00.000Z' }],
      }),
    ).toEqual(['2026-09-07T07:00:00.000Z']);
  });

  it('la revalidation de confirmation voit la même chose que l’offre', () => {
    const input = { ...base, externalBusy: [INTERVAL] };
    expect(findOfferedSlot(input, '2026-09-07T08:00:00.000Z')).toBeNull();
    expect(findOfferedSlot(input, '2026-09-07T07:00:00.000Z')).toEqual({
      startAt: '2026-09-07T07:00:00.000Z',
      endAt: '2026-09-07T07:45:00.000Z',
    });
  });
});
