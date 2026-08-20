/**
 * Grille de disponibilités — helpers purs.
 *
 * On teste surtout ce qui produirait une grille MENTEUSE : une plage inversée
 * (le moteur l'ignore en silence) et deux plages qui se chevauchent (le
 * recruteur croit ouvrir plus, il ouvre autre chose).
 */
import { describe, expect, it } from 'vitest';

import {
  minutesToTime,
  nextRuleFor,
  timeToMinutes,
  totalOpenMinutes,
  validateRules,
} from '@/lib/interviews/availability-form';

describe('conversion heure ⇄ minutes', () => {
  it('rend toujours deux chiffres (ce qu’exige un champ horaire)', () => {
    expect(minutesToTime(545)).toBe('09:05');
    expect(minutesToTime(0)).toBe('00:00');
    expect(minutesToTime(1440)).toBe('24:00');
  });

  it('borne les valeurs aberrantes au lieu de rendre une heure impossible', () => {
    expect(minutesToTime(-30)).toBe('00:00');
    expect(minutesToTime(5000)).toBe('24:00');
  });

  it('relit une saisie valide, refuse le reste', () => {
    expect(timeToMinutes('09:05')).toBe(545);
    expect(timeToMinutes('9:05')).toBe(545);
    expect(timeToMinutes('24:00')).toBe(1440);
    expect(timeToMinutes('')).toBeNull();
    expect(timeToMinutes('25:00')).toBeNull();
    expect(timeToMinutes('12:75')).toBeNull();
    expect(timeToMinutes('midi')).toBeNull();
  });
});

describe('validateRules', () => {
  it('accepte plusieurs plages par jour — c’est tout l’intérêt', () => {
    expect(
      validateRules([
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 840, endMinute: 1080 },
        { weekday: 3, startMinute: 600, endMinute: 660 },
      ]),
    ).toEqual([]);
  });

  it('refuse une plage qui se termine avant de commencer', () => {
    const errors = validateRules([{ weekday: 2, startMinute: 720, endMinute: 540 }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Mardi');
  });

  it('refuse une plage vide (début = fin) — elle n’offre aucun créneau', () => {
    expect(validateRules([{ weekday: 4, startMinute: 600, endMinute: 600 }])).toHaveLength(
      1,
    );
  });

  it('refuse deux plages qui se chevauchent le MÊME jour', () => {
    const errors = validateRules([
      { weekday: 5, startMinute: 540, endMinute: 720 },
      { weekday: 5, startMinute: 660, endMinute: 900 },
    ]);
    expect(errors.some((e) => e.includes('chevauchent'))).toBe(true);
  });

  it('deux plages identiques sur des jours DIFFÉRENTS ne se chevauchent pas', () => {
    expect(
      validateRules([
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 2, startMinute: 540, endMinute: 720 },
      ]),
    ).toEqual([]);
  });

  it('deux plages qui se touchent bout à bout sont valides', () => {
    expect(
      validateRules([
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 720, endMinute: 900 },
      ]),
    ).toEqual([]);
  });
});

describe('nextRuleFor', () => {
  it('propose une matinée quand le jour est vide', () => {
    expect(nextRuleFor(3, [])).toEqual({
      weekday: 3,
      startMinute: 540,
      endMinute: 720,
    });
  });

  it('propose une plage APRÈS la dernière du jour — jamais un chevauchement', () => {
    const existing = [{ weekday: 3, startMinute: 540, endMinute: 720 }];
    const next = nextRuleFor(3, existing);
    expect(next.startMinute).toBeGreaterThanOrEqual(720);
    expect(validateRules([...existing, next])).toEqual([]);
  });

  it('ne déborde jamais de la journée', () => {
    const next = nextRuleFor(6, [{ weekday: 6, startMinute: 1300, endMinute: 1400 }]);
    expect(next.endMinute).toBeLessThanOrEqual(1440);
    expect(next.startMinute).toBeLessThan(next.endMinute);
  });
});

describe('totalOpenMinutes', () => {
  it('somme les plages ouvertes et ignore les plages absurdes', () => {
    expect(
      totalOpenMinutes([
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 2, startMinute: 720, endMinute: 540 },
      ]),
    ).toBe(180);
  });
});
