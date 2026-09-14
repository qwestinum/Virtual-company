import { describe, expect, it } from 'vitest';

import { lastGeneratedByCampaign, planRecencyChunks } from '@/lib/vivier/pending-recency';

const c = (campaignId: string, pendingCount: number) => ({ campaignId, pendingCount });

describe('planRecencyChunks', () => {
  it('groupe dans l’ordre sous le budget de lignes', () => {
    expect(planRecencyChunks([c('A', 400), c('B', 400), c('C', 200), c('D', 1)], 900, 100)).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ]);
  });

  it('une campagne au-delà du budget forme son propre lot', () => {
    expect(planRecencyChunks([c('A', 10), c('B', 5000), c('C', 10)], 900, 100)).toEqual([['A'], ['B'], ['C']]);
  });

  it('borne le nombre de campagnes par lot, et couvre toutes les campagnes une fois', () => {
    const counts = Array.from({ length: 250 }, (_, i) => c(`C${i}`, 1));
    const plan = planRecencyChunks(counts, 900, 100);
    expect(plan.map((p) => p.length)).toEqual([100, 100, 50]);
    expect(plan.flat()).toEqual(counts.map((x) => x.campaignId));
  });

  it('liste vide ⇒ aucun lot', () => {
    expect(planRecencyChunks([], 900, 100)).toEqual([]);
  });
});

describe('lastGeneratedByCampaign', () => {
  it('max par campagne, cumulable entre lots', () => {
    const acc = lastGeneratedByCampaign([
      { campaign_id: 'A', generated_at: '2026-09-01T00:00:00+00:00' },
      { campaign_id: 'A', generated_at: '2026-09-03T00:00:00+00:00' },
    ]);
    lastGeneratedByCampaign(
      [
        { campaign_id: 'A', generated_at: '2026-09-02T00:00:00+00:00' },
        { campaign_id: 'B', generated_at: '2026-08-01T00:00:00+00:00' },
      ],
      acc,
    );
    expect(Object.fromEntries(acc)).toEqual({
      A: '2026-09-03T00:00:00+00:00',
      B: '2026-08-01T00:00:00+00:00',
    });
  });
});
