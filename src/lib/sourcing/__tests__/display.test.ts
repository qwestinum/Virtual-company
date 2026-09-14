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

describe('parcours — durée, ordre, poste en cours', async () => {
  const { currentPositionOf, durationLabel, newestFirst, tenureLabel } = await import('@/lib/sourcing/display');
  const now = new Date('2026-09-14T00:00:00Z');

  it('durée calculée, bornes incluses ; en cours jusqu’à aujourd’hui ; année seule ⇒ rien', () => {
    expect(durationLabel('2019-09-01', '2024-04-01', now)).toBe('4 ans 8 mois');
    expect(durationLabel('2026-01-01', '2026-08-01', now)).toBe('8 mois');
    expect(durationLabel('2024-05-01', null, now)).toBe('2 ans 4 mois');
    expect(`depuis ${durationLabel('2024-05-01', null, now)}`).toBe(tenureLabel('2024-05-01', now));
    expect(durationLabel('2014', '2016', now)).toBeNull();
  });

  it('le plus récent en haut, indice d’origine conservé ; le poste en cours', () => {
    const items = [
      { title: 'A', from: '2015-01-01', to: '2018-12-01' },
      { title: 'C', from: '2024-05-01', to: null },
      { title: 'B', from: '2019-01-01', to: '2024-04-01' },
    ];
    expect(newestFirst(items).map((e) => `${e.item.title}${e.index}`)).toEqual(['C1', 'B2', 'A0']);
    expect(currentPositionOf(items)?.title).toBe('C');
    expect(currentPositionOf([items[0]!])).toBeNull();
  });
});
