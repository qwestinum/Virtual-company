import { describe, expect, it } from 'vitest';

import { searchExistingJobDescriptions } from '@/lib/storage/job-descriptions';

describe('searchExistingJobDescriptions (Session 3 stub)', () => {
  it('returns an empty array for any query', async () => {
    expect(await searchExistingJobDescriptions('comptable senior')).toEqual([]);
    expect(await searchExistingJobDescriptions('')).toEqual([]);
    expect(await searchExistingJobDescriptions('  ')).toEqual([]);
  });

  it('is a Promise — preserves async contract for Session 5', () => {
    const result = searchExistingJobDescriptions('x');
    expect(result).toBeInstanceOf(Promise);
  });
});
