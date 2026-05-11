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

import {
  insertArtifactMeta,
  listArtifactsByCampaign,
  listArtifactsByTask,
} from '@/lib/db/repos/artifacts';
import { requireServerSupabase } from '@/lib/db/supabase-server';

const requireServerSupabaseMock = vi.mocked(requireServerSupabase);

describe('artifacts repo', () => {
  beforeEach(() => {
    requireServerSupabaseMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('insertArtifactMeta rejects when both owners are provided', async () => {
    requireServerSupabaseMock.mockReturnValue({ from: vi.fn() } as never);
    await expect(
      insertArtifactMeta({
        id: 'art_1',
        campaignId: 'CAMP-1',
        taskId: 'TASK-1',
        kind: 'fdp',
        name: 'fdp.md',
      }),
    ).rejects.toThrow(/either campaignId OR taskId/);
  });

  it('insertArtifactMeta rejects when no owner is provided', async () => {
    requireServerSupabaseMock.mockReturnValue({ from: vi.fn() } as never);
    await expect(
      insertArtifactMeta({
        id: 'art_1',
        campaignId: null,
        taskId: null,
        kind: 'fdp',
        name: 'fdp.md',
      }),
    ).rejects.toThrow(/at least one of campaignId or taskId/);
  });

  it('insertArtifactMeta maps fields (incl. storage_*) and returns the row', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'art_1',
        campaign_id: 'CAMP-1',
        task_id: null,
        kind: 'fdp',
        name: 'fdp.md',
        mime: 'text/markdown',
        storage_bucket: 'artifacts',
        storage_path: 'campagnes/CAMP-1/fdp.md',
        public_url: 'https://example.com/storage/x',
        metadata: { source: 'manager' },
        created_at: '2026-05-11T00:00:00Z',
      },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    requireServerSupabaseMock.mockReturnValue({ from } as never);

    const result = await insertArtifactMeta({
      id: 'art_1',
      campaignId: 'CAMP-1',
      taskId: null,
      kind: 'fdp',
      name: 'fdp.md',
      storageBucket: 'artifacts',
      storagePath: 'campagnes/CAMP-1/fdp.md',
      publicUrl: 'https://example.com/storage/x',
      metadata: { source: 'manager' },
    });

    expect(from).toHaveBeenCalledWith('artifacts_meta');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'art_1',
        campaign_id: 'CAMP-1',
        task_id: null,
        kind: 'fdp',
        storage_bucket: 'artifacts',
        storage_path: 'campagnes/CAMP-1/fdp.md',
        public_url: 'https://example.com/storage/x',
      }),
    );
    expect(result.id).toBe('art_1');
    expect(result.storagePath).toBe('campagnes/CAMP-1/fdp.md');
    expect(result.publicUrl).toBe('https://example.com/storage/x');
  });

  it('listArtifactsByCampaign filters by campaign_id', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    requireServerSupabaseMock.mockReturnValue({ from } as never);

    await listArtifactsByCampaign('CAMP-1');
    expect(eq).toHaveBeenCalledWith('campaign_id', 'CAMP-1');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  it('listArtifactsByTask filters by task_id', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    } as never);

    await listArtifactsByTask('TASK-1');
    expect(eq).toHaveBeenCalledWith('task_id', 'TASK-1');
  });
});
