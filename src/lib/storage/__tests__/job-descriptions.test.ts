import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// On mocke le repo Supabase pour piloter le contrat sans toucher au
// vrai client. La fonction `searchExistingJobDescriptions` est mince —
// les tests vérifient les chemins : configured, not_configured, short
// query, erreur DB.
vi.mock('@/lib/db/repos/fdps-archived', () => ({
  searchFdps: vi.fn(),
}));

import { searchFdps } from '@/lib/db/repos/fdps-archived';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { searchExistingJobDescriptions } from '@/lib/storage/job-descriptions';

const searchFdpsMock = vi.mocked(searchFdps);

describe('searchExistingJobDescriptions', () => {
  beforeEach(() => {
    searchFdpsMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns [] for empty or short queries without touching the repo', async () => {
    expect(await searchExistingJobDescriptions('')).toEqual([]);
    expect(await searchExistingJobDescriptions('  ')).toEqual([]);
    expect(await searchExistingJobDescriptions('a')).toEqual([]);
    expect(searchFdpsMock).not.toHaveBeenCalled();
  });

  it('returns the repo hits when Supabase is configured', async () => {
    searchFdpsMock.mockResolvedValueOnce([
      {
        id: 'CAMP-0001',
        title: 'Comptable senior',
        archivedAt: '2026-04-01T00:00:00Z',
        fdp: {
          campaignId: 'CAMP-0001',
          fields: {} as never,
          isComplete: true,
          isValidated: true,
        },
      },
    ]);
    const hits = await searchExistingJobDescriptions('comptable');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.id).toBe('CAMP-0001');
    expect(searchFdpsMock).toHaveBeenCalledWith('comptable');
  });

  it('returns [] silently when Supabase is not configured', async () => {
    searchFdpsMock.mockRejectedValueOnce(new SupabaseNotConfiguredError());
    expect(await searchExistingJobDescriptions('comptable senior')).toEqual([]);
  });

  it('returns [] on other DB errors (manager must keep conversing)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    searchFdpsMock.mockRejectedValueOnce(new Error('connection refused'));
    expect(await searchExistingJobDescriptions('comptable senior')).toEqual([]);
  });

  it('is a Promise — preserves async contract', () => {
    expect(searchExistingJobDescriptions('x')).toBeInstanceOf(Promise);
  });
});
