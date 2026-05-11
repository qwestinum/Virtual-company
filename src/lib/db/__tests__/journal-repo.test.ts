import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/supabase-server', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/db/supabase-server')
  >('@/lib/db/supabase-server');
  return {
    ...actual,
    requireServerSupabase: vi.fn(),
  };
});

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { requireServerSupabase } from '@/lib/db/supabase-server';

const requireServerSupabaseMock = vi.mocked(requireServerSupabase);

describe('journal repo', () => {
  beforeEach(() => {
    requireServerSupabaseMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inserts an entry with sane defaults', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    requireServerSupabaseMock.mockReturnValue({ from } as never);

    await appendJournalEntry({ action: 'pause_campaign' });
    expect(from).toHaveBeenCalledWith('journal');
    const row = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.action).toBe('pause_campaign');
    expect(row.campaign_id).toBeNull();
    expect(row.actor).toBe('user');
    expect(row.payload).toEqual({});
  });

  it('passes through optional fields', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert }),
    } as never);

    await appendJournalEntry({
      action: 'threshold_changed',
      campaignId: 'CAMP-0001',
      actor: 'manager_ai',
      payload: { from: 60, to: 75 },
    });
    const row = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.campaign_id).toBe('CAMP-0001');
    expect(row.actor).toBe('manager_ai');
    expect(row.payload).toEqual({ from: 60, to: 75 });
  });

  it('throws on supabase error', async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ error: { message: 'permission denied' } });
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert }),
    } as never);
    await expect(
      appendJournalEntry({ action: 'foo' }),
    ).rejects.toThrow(/appendJournalEntry: permission denied/);
  });
});
