import { describe, expect, it } from 'vitest';

import {
  buildInterviewsAwaitingMessage,
  buildInterviewsPointingMessage,
  buildPendingValidationsMessage,
  cutoffIso,
  daysSinceIso,
  selectOverdueRealizedUids,
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
