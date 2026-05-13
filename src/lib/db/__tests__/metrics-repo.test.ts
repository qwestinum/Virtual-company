import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db/supabase-server', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/db/supabase-server')
  >('@/lib/db/supabase-server');
  return {
    ...actual,
    requireServerSupabase: vi.fn(),
  };
});

import {
  fetchMetricsRows,
  fetchMetricsRowsForCampaign,
} from '@/lib/db/repos/metrics';
import {
  requireServerSupabase,
  SupabaseNotConfiguredError,
} from '@/lib/db/supabase-server';

const mock = vi.mocked(requireServerSupabase);

function buildChain(rows: unknown[]) {
  const order = vi.fn().mockReturnThis();
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq = vi.fn().mockReturnThis();
  const like = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnValue({ order, limit, eq, like });
  // listJournalEntries enchaîne select().order().limit() puis éventuellement eq/like avant le await.
  // On rend les ré-affectations chainables en faisant pointer order et eq/like vers le même builder.
  order.mockReturnValue({ limit, eq, like });
  eq.mockReturnValue({ limit, eq, like });
  like.mockReturnValue({ limit, eq, like });
  return { from: vi.fn().mockReturnValue({ select }) };
}

describe('metrics repo', () => {
  beforeEach(() => {
    mock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retourne null quand supabase n est pas configuré', async () => {
    mock.mockImplementation(() => {
      throw new SupabaseNotConfiguredError();
    });
    expect(await fetchMetricsRows()).toBeNull();
    expect(await fetchMetricsRowsForCampaign('CAMP-1')).toBeNull();
  });

  it('agrège les rows quand supabase répond', async () => {
    const sample = [
      {
        id: 1,
        campaign_id: null,
        actor: 'imap_poller',
        action: 'imap_cv_received',
        payload: {},
        created_at: '2026-05-12T10:00:00Z',
      },
    ];
    mock.mockReturnValue(buildChain(sample) as never);
    const out = await fetchMetricsRows();
    expect(out?.rows).toHaveLength(1);
    expect(out?.rows[0].action).toBe('imap_cv_received');
  });

  it('propage les erreurs supabase non-503', async () => {
    mock.mockImplementation(() => {
      throw new Error('connection lost');
    });
    await expect(fetchMetricsRows()).rejects.toThrow('connection lost');
  });
});
