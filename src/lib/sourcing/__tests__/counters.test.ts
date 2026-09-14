import { describe, expect, it } from 'vitest';

import { aggregateSourcingCounters, compareTimestamps } from '@/lib/sourcing/counters';

describe('compareTimestamps', () => {
  it('ordre chronologique à la microseconde, fractions tronquées par la base comprises', () => {
    expect(compareTimestamps('2026-09-14T10:00:00+00:00', '2026-09-14T10:00:00.1+00:00')).toBeLessThan(0);
    expect(compareTimestamps('2026-09-14T10:00:00.5+00:00', '2026-09-14T10:00:00.123456+00:00')).toBeGreaterThan(0);
    expect(compareTimestamps('2026-09-14T10:00:00.000001+00:00', '2026-09-14T10:00:00.000002+00:00')).toBeLessThan(0);
    expect(compareTimestamps('2026-09-14T10:00:00.12+00:00', '2026-09-14T10:00:00.120000+00:00')).toBe(0);
  });

  it('tient compte du fuseau', () => {
    expect(compareTimestamps('2026-09-14T12:00:00+02:00', '2026-09-14T10:30:00+00:00')).toBeLessThan(0);
  });

  it('format inconnu : repli sur l’ordre des chaînes', () => {
    expect(compareTimestamps('b', 'a')).toBeGreaterThan(0);
  });
});

describe('aggregateSourcingCounters', () => {
  it('reproduit les comptages par campagne, zéros compris, dans l’ordre demandé', () => {
    const out = aggregateSourcingCounters(['A', 'B', 'C'], {
      shownProfiles: [{ campaign_id: 'A' }, { campaign_id: 'A' }, { campaign_id: 'B' }, { campaign_id: 'Z' }],
      declinedExclusions: [{ campaign_id: 'A' }, { campaign_id: null }],
      approaches: [
        { campaign_id: 'A', status: 'active' },
        { campaign_id: 'A', status: 'submitted' },
        { campaign_id: 'B', status: 'submitted' },
      ],
      searches: [
        { campaign_id: 'A', created_at: '2026-09-01T10:00:00.5+00:00' },
        { campaign_id: 'A', created_at: '2026-09-01T10:00:00.123456+00:00' },
        { campaign_id: 'B', created_at: '2026-08-01T10:00:00+00:00' },
      ],
    });
    expect([...out.keys()]).toEqual(['A', 'B', 'C']);
    expect(out.get('A')).toEqual({ seen: 3, approached: 2, manifested: 1, lastSearchAt: '2026-09-01T10:00:00.5+00:00' });
    expect(out.get('B')).toEqual({ seen: 1, approached: 1, manifested: 1, lastSearchAt: '2026-08-01T10:00:00+00:00' });
    expect(out.get('C')).toEqual({ seen: 0, approached: 0, manifested: 0, lastSearchAt: null });
  });
});
