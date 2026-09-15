/**
 * Indisponibilités externes côté module — tests PURS.
 *
 *   1. le verdict : une source illisible ne vaut JAMAIS « libre » ;
 *   2. le moteur : les intervalles externes retirent des créneaux, avec le
 *      même battement que les réservations.
 */
import { describe, expect, it } from 'vitest';

import { resolveExternalBusy, type ExternalBusyPolicy } from '../external-busy';
import { workingMinutesBetween } from '../working-time';
import { computeSlots, findOfferedSlot, type SlotEngineInput } from '../slots';

const INTERVAL = { startAt: '2026-09-07T08:00:00.000Z', endAt: '2026-09-07T09:00:00.000Z' };

const POLICY: ExternalBusyPolicy = {
  requested: { from: '2026-09-06T00:00:00.000Z', to: '2026-09-08T00:00:00.000Z' },
  workingMinutesSince: () => 30,
  toleranceMinutes: 120,
};

const COPY = {
  intervals: [INTERVAL],
  readAt: '2026-09-07T06:00:00.000Z',
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-10-01T00:00:00.000Z',
};

const unavailable = (lastGood: typeof COPY | null) =>
  ({ kind: 'unavailable', lastGood, failingSince: '2026-09-07T06:30:00.000Z' }) as const;

describe('resolveExternalBusy', () => {
  it('sans source : rien à soustraire, rien à bloquer', () => {
    expect(resolveExternalBusy({ kind: 'not_configured' }, 'live', POLICY)).toEqual({
      intervals: [],
      check: 'none',
      blocked: false,
      state: 'none',
    });
  });

  it('source lue : ses intervalles, vérifiés en direct à la confirmation', () => {
    const answer = { kind: 'ok' as const, intervals: [INTERVAL], readAt: '2026-09-01T00:00:00.000Z' };
    expect(resolveExternalBusy(answer, 'live', POLICY)).toEqual({
      intervals: [INTERVAL],
      check: 'live',
      blocked: false,
      state: 'verified',
    });
    expect(resolveExternalBusy(answer, 'snapshot', POLICY)).toMatchObject({ check: 'snapshot', state: 'verified' });
  });

  it('source muette, copie récente qui couvre la fenêtre : TOLÉRÉE, sur la copie, et marquée', () => {
    expect(resolveExternalBusy(unavailable(COPY), 'live', POLICY)).toEqual({
      intervals: [INTERVAL],
      check: 'snapshot',
      blocked: false,
      state: 'tolerated',
    });
  });

  it('la tolérance est INCLUSIVE : pile 2 h ouvrées passe, une minute de plus bloque', () => {
    expect(
      resolveExternalBusy(unavailable(COPY), 'live', { ...POLICY, workingMinutesSince: () => 120 }),
    ).toMatchObject({ state: 'tolerated' });
    expect(
      resolveExternalBusy(unavailable(COPY), 'live', { ...POLICY, workingMinutesSince: () => 121 }),
    ).toEqual({ intervals: [], check: 'snapshot', blocked: true, state: 'blocked' });
  });

  it('sans copie : BLOQUÉ', () => {
    expect(resolveExternalBusy(unavailable(null), 'snapshot', POLICY)).toMatchObject({ blocked: true });
  });

  it('copie qui ne couvre pas la fenêtre demandée : BLOQUÉ (elle n’a rien vu au-delà)', () => {
    const narrow = { ...COPY, to: '2026-09-07T12:00:00.000Z' };
    expect(resolveExternalBusy(unavailable(narrow), 'live', POLICY)).toMatchObject({ blocked: true });
  });
});

describe('workingMinutesBetween', () => {
  // Grille 9h-12h et 14h-18h, du lundi au vendredi, à Paris.
  const rules = [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startMinute: 9 * 60, endMinute: 12 * 60 },
    { weekday, startMinute: 14 * 60, endMinute: 18 * 60 },
  ]);
  const base = { timezone: 'Europe/Paris', rules, exceptions: [] };

  it('ne compte que les heures de la grille', () => {
    // Lundi 7/09/2026, 10h00 → 15h30 locales (CEST) : 2 h + 1 h 30.
    expect(
      workingMinutesBetween({ ...base, from: '2026-09-07T08:00:00.000Z', to: '2026-09-07T13:30:00.000Z' }),
    ).toBe(210);
  });

  it('ne fait pas vieillir une panne pendant le week-end', () => {
    // Vendredi 11/09 17h00 → lundi 14/09 10h00 : 1 h le vendredi, 1 h le lundi.
    expect(
      workingMinutesBetween({ ...base, from: '2026-09-11T15:00:00.000Z', to: '2026-09-14T08:00:00.000Z' }),
    ).toBe(120);
  });

  it('retire une journée d’absence', () => {
    expect(
      workingMinutesBetween({
        ...base,
        exceptions: [{ id: 'x', day: '2026-09-14', startMinute: null, endMinute: null, label: null }],
        from: '2026-09-11T15:00:00.000Z',
        to: '2026-09-14T08:00:00.000Z',
      }),
    ).toBe(60);
  });

  it('lit la grille en heure MURALE le jour du changement d’heure', () => {
    // Dimanche 25/10/2026 : 25 heures. Grille dominicale 9h-12h. De minuit à
    // 10h00 locale CET (= 09:00Z) : 1 h ouvrée (9h → 10h). Compter « 540 min
    // après minuit » placerait 9h à 8h murale et rendrait 2 h.
    expect(
      workingMinutesBetween({
        ...base,
        rules: [{ weekday: 7, startMinute: 9 * 60, endMinute: 12 * 60 }],
        from: '2026-10-24T22:00:00.000Z',
        to: '2026-10-25T09:00:00.000Z',
      }),
    ).toBe(60);
  });

  it('rend 0 pour une période vide ou inversée', () => {
    expect(workingMinutesBetween({ ...base, from: '2026-09-07T10:00:00.000Z', to: '2026-09-07T10:00:00.000Z' })).toBe(0);
    expect(workingMinutesBetween({ ...base, from: '2026-09-08T10:00:00.000Z', to: '2026-09-07T10:00:00.000Z' })).toBe(0);
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
