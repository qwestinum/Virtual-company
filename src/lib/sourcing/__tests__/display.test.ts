import { describe, expect, it } from 'vitest';

import { indexedAgeLabel, periodLabel, tenureLabel } from '@/lib/sourcing/display';

const NOW = new Date('2026-09-13T10:00:00Z');

describe('formats de carte', () => {
  it('périodes au mois pour les postes, à l’année pour la formation', () => {
    expect(periodLabel('2023-05-01', null)).toBe('05/2023 – auj.');
    expect(periodLabel('2019-09-01', '2023-04-01')).toBe('09/2019 – 04/2023');
    expect(periodLabel('2014', '2016')).toBe('2014 – 2016');
    expect(periodLabel(null, null)).toBeNull();
  });

  it('ancienneté dans le poste', () => {
    expect(tenureLabel('2024-05-01', NOW)).toBe('depuis 2 ans 4 mois');
    expect(tenureLabel('2026-03-01', NOW)).toBe('depuis 6 mois');
    expect(tenureLabel('2026-09-01', NOW)).toBe('depuis moins d’un mois');
    expect(tenureLabel('2020', NOW)).toBeNull();
  });

  it('fraîcheur de l’indexation', () => {
    expect(indexedAgeLabel('2026-08-06T10:00:00Z', NOW)).toBe('profil indexé il y a 38 jours');
    expect(indexedAgeLabel('pas une date', NOW)).toBeNull();
  });
});
