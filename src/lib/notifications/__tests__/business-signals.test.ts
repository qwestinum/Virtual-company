import { describe, expect, it } from 'vitest';

import {
  buildHolidaysUnblockedMessage,
  buildInterviewsAwaitingMessage,
  buildInterviewsPointingMessage,
  buildPendingValidationsMessage,
  cutoffIso,
  daysSinceIso,
  formatHolidayDay,
  selectOverdueRealizedUids,
  selectUnblockedHolidays,
  selectUnpointedBriefs,
} from '@/lib/notifications/business-signals';

const NOW = Date.parse('2026-07-26T12:00:00.000Z');
const DAY = 86_400_000;

describe('daysSinceIso', () => {
  it('jours entiers écoulés (plancher)', () => {
    expect(daysSinceIso('2026-07-20T12:00:00.000Z', NOW)).toBe(6);
    expect(daysSinceIso('2026-07-25T13:00:00.000Z', NOW)).toBe(0); // 23 h
    expect(daysSinceIso('2026-07-23T11:59:00.000Z', NOW)).toBe(3);
  });

  it('jamais négatif (horloge légèrement en avance)', () => {
    expect(daysSinceIso('2026-07-27T12:00:00.000Z', NOW)).toBe(0);
  });
});

describe('cutoffIso', () => {
  it('borne « plus vieux que N jours »', () => {
    expect(cutoffIso(NOW, 3)).toBe('2026-07-23T12:00:00.000Z');
  });
});

describe('messages (singulier / pluriel)', () => {
  it('validations en attente — pluriel avec le plus ancien', () => {
    expect(buildPendingValidationsMessage(3, 3, 6)).toBe(
      '3 candidats attendent votre validation depuis plus de 3 jours — le plus ancien depuis 6 jours.',
    );
  });

  it('validations en attente — singulier', () => {
    expect(buildPendingValidationsMessage(1, 3, 4)).toBe(
      '1 candidat attend votre validation depuis plus de 3 jours — le plus ancien depuis 4 jours.',
    );
  });

  it('entretiens sans décision — pluriel et singulier', () => {
    expect(buildInterviewsAwaitingMessage(2)).toBe(
      '2 candidats ont passé leur entretien et attendent votre décision.',
    );
    expect(buildInterviewsAwaitingMessage(1)).toBe(
      '1 candidat a passé son entretien et attend votre décision.',
    );
  });
});

describe('selectOverdueRealizedUids', () => {
  const marks = new Map<string, 'realized' | 'missed'>([
    ['u-vieux', 'realized'],
    ['u-recent', 'realized'],
    ['u-manque', 'missed'],
    ['u-sans-date', 'realized'],
  ]);
  const markedAt = new Map<string, string>([
    ['u-vieux', new Date(NOW - 5 * DAY).toISOString()],
    ['u-recent', new Date(NOW - 1 * DAY).toISOString()],
    ['u-manque', new Date(NOW - 9 * DAY).toISOString()],
  ]);

  it('retient les realized plus vieux que le cutoff, ignore missed et sans date', () => {
    const out = selectOverdueRealizedUids(marks, markedAt, NOW - 2 * DAY);
    expect(out).toEqual(['u-vieux']);
  });

  it('cutoff strict : un marqueur posé EXACTEMENT au cutoff n’est pas retenu', () => {
    const at = new Map([['u-limite', new Date(NOW - 2 * DAY).toISOString()]]);
    const m = new Map<string, 'realized' | 'missed'>([['u-limite', 'realized']]);
    expect(selectOverdueRealizedUids(m, at, NOW - 2 * DAY)).toEqual([]);
  });
});

describe('signal 3 — entretiens passés sans pointage', () => {
  it('retient les entretiens TERMINÉS avant le seuil', () => {
    const cutoff = Date.parse('2026-09-15T12:00:00.000Z');
    const kept = selectUnpointedBriefs(
      [
        { uid: 'a', interviewEndAt: '2026-09-14T10:00:00.000Z' },
        { uid: 'b', interviewEndAt: '2026-09-15T18:00:00.000Z' },
      ],
      cutoff,
    );
    expect(kept.map((b) => b.uid)).toEqual(['a']);
  });

  it('ignore un entretien SANS date de fin — on ne date pas ce qu’on ignore', () => {
    expect(
      selectUnpointedBriefs([{ uid: 'a', interviewEndAt: null }], Date.now()),
    ).toEqual([]);
  });

  it('ignore un briefing sans candidature rattachée', () => {
    expect(
      selectUnpointedBriefs(
        [{ uid: null, interviewEndAt: '2020-01-01T00:00:00.000Z' }],
        Date.now(),
      ),
    ).toEqual([]);
  });

  it('le message dit ce qu’on attend : un pointage, pas une décision', () => {
    expect(buildInterviewsPointingMessage(1)).toMatch(/réalisé ou absent/);
    expect(buildInterviewsPointingMessage(3)).toMatch(/^3 entretiens passés/);
  });
});

// ─── Signal 4 : jours fériés encore proposables ────────────────────────────

describe('selectUnblockedHolidays', () => {
  // 2026-11-11 = mercredi (férié) · 2026-11-01 = dimanche (férié)
  const OUVRE = [1, 2, 3, 4, 5];
  const base = {
    from: '2026-10-20',
    horizonDays: 30,
    openWeekdays: OUVRE,
    blockedDays: [] as string[],
  };

  it('signale un férié réservable dans l’horizon', () => {
    expect(selectUnblockedHolidays(base).map((h) => h.day)).toContain(
      '2026-11-11',
    );
  });

  it('ignore un férié AU-DELÀ de l’horizon — il n’est pas encore offert', () => {
    // 12 jours d'horizon : le 11 novembre n'est pas proposable, rien à corriger.
    expect(
      selectUnblockedHolidays({ ...base, horizonDays: 12 }),
    ).toEqual([]);
  });

  it('s’éteint dès que l’absence est posée', () => {
    // C'est l'extinction PAR CONSTRUCTION : aucun état parallèle à tenir.
    expect(
      selectUnblockedHolidays({ ...base, blockedDays: ['2026-11-11'] }),
    ).toEqual([]);
  });

  it('ignore un férié tombant un jour non travaillé', () => {
    const days = selectUnblockedHolidays(base).map((h) => h.day);
    expect(days).not.toContain('2026-11-01'); // dimanche
  });

  it('ne dit rien d’une ressource sans aucune règle', () => {
    // Sans règle, aucun créneau n'est proposé : il n'y a rien à bloquer, et
    // réclamer une action serait un faux positif permanent.
    expect(selectUnblockedHolidays({ ...base, openWeekdays: [] })).toEqual([]);
  });
});

describe('message du signal 4', () => {
  const NOEL = { day: '2026-12-25', label: 'Noël' };

  it('parle de VOTRE agenda — le signal est filtré par session', () => {
    // Un réglage personnel : le message s'adresse à la personne qui peut
    // le corriger, pas au « cabinet » en général.
    expect(buildHolidaysUnblockedMessage(1, NOEL)).toBe(
      'Votre agenda propose encore des créneaux le 25 décembre (Noël), qui est férié.',
    );
    expect(buildHolidaysUnblockedMessage(3, NOEL)).toBe(
      'Votre agenda propose encore des créneaux sur 3 jours fériés — le plus proche : 25 décembre (Noël).',
    );
  });

  it('formate la date sans bascule de fuseau', () => {
    // Minuit UTC ferait afficher la veille à l'ouest de Greenwich.
    expect(formatHolidayDay('2026-01-01')).toBe('1 janvier');
    expect(formatHolidayDay('2026-11-11')).toBe('11 novembre');
  });
});
