import { describe, expect, it } from 'vitest';

import { aggregateSourcingCosts, costWindowStart } from '@/lib/sourcing/costs';

const NOW = new Date('2026-09-14T10:00:00Z');

describe('suivi d’exploitation — par mois, heure de Paris', () => {
  it('cumule recherches et coûts par mois, mois vides compris, plus récent en tête', () => {
    const s = aggregateSourcingCosts(
      [
        { createdAt: '2026-09-02T09:00:00Z', exaCostUsd: 0.097 },
        { createdAt: '2026-09-10T09:00:00Z', exaCostUsd: 0.097 },
        { createdAt: '2026-07-15T09:00:00Z', exaCostUsd: 0.022 },
      ],
      [{ createdAt: '2026-09-02T08:59:00Z', llmCostUsd: 0.0059 }],
      NOW,
    );
    expect(s.months).toHaveLength(12);
    expect(s.months[0]).toMatchObject({ month: '2026-09', searches: 2, exaCostUsd: 0.194, generations: 1, llmCostUsd: 0.0059 });
    expect(s.months[1]).toMatchObject({ month: '2026-08', searches: 0 });
    expect(s.months[2]).toMatchObject({ month: '2026-07', searches: 1, exaCostUsd: 0.022 });
    expect(s.total).toMatchObject({ searches: 3, exaCostUsd: 0.216, generations: 1 });
  });

  it('minuit à Paris le 1er du mois appartient au NOUVEAU mois (22 h UTC la veille, en été)', () => {
    const s = aggregateSourcingCosts([{ createdAt: '2026-08-31T22:30:00Z', exaCostUsd: 0.1 }], [], NOW);
    expect(s.months[0]).toMatchObject({ month: '2026-09', searches: 1 });
  });

  it('un coût non communiqué est COMPTÉ comme tel, pas additionné comme zéro en silence', () => {
    const s = aggregateSourcingCosts([{ createdAt: '2026-09-02T09:00:00Z', exaCostUsd: null }], [], NOW);
    expect(s.months[0]).toMatchObject({ searches: 1, searchesWithoutCost: 1, exaCostUsd: 0 });
  });

  it('fenêtre : début du plus ancien mois agrégé', () => {
    expect(costWindowStart(NOW, 12)).toBe('2025-09-30T22:00:00.000Z');
  });
});
