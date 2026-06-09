import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock supabase-server pour ne pas instancier le vrai client.
vi.mock('@/lib/db/supabase-server', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/db/supabase-server')
  >('@/lib/db/supabase-server');
  return {
    ...actual,
    requireServerSupabase: vi.fn(),
  };
});

import { buildLifecycle } from '@/lib/campaign/lifecycle';
import {
  listCampaigns,
  patchCampaign,
  upsertCampaign,
} from '@/lib/db/repos/campaigns';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { ActiveCampaign } from '@/stores/campaigns-store';

const requireServerSupabaseMock = vi.mocked(requireServerSupabase);

function buildCampaign(overrides: Partial<ActiveCampaign> = {}): ActiveCampaign {
  return {
    id: 'CAMP-0001',
    name: 'Comptable senior',
    fdp: {
      campaignId: 'CAMP-0001',
      fields: {} as never,
      isComplete: true,
      isValidated: true,
    },
    scoringSheet: null,
    publishedChannels: ['linkedin'],
    sourcesConfirmed: false,
    sources: ['manual'],
    threshold: 75,
    siteId: null,
    donneurOrdreId: null,
    status: 'in_progress',
    lifecycle: buildLifecycle(),
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

describe('campaigns repo', () => {
  beforeEach(() => {
    requireServerSupabaseMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists campaigns mapped to domain shape', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'CAMP-0001',
          name: 'Comptable senior',
          status: 'in_progress',
          fdp: {
            campaignId: 'CAMP-0001',
            fields: {},
            isComplete: true,
            isValidated: true,
          },
          scoring_sheet: null,
          published_channels: ['linkedin'],
          sources_confirmed: false,
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-01T00:00:00Z',
        },
      ],
      error: null,
    });
    const select = vi.fn().mockReturnValue({ order });
    const from = vi.fn().mockReturnValue({ select });
    requireServerSupabaseMock.mockReturnValue({
      from,
    } as never);

    const result = await listCampaigns();
    expect(from).toHaveBeenCalledWith('campaigns');
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('CAMP-0001');
    expect(result[0]!.publishedChannels).toEqual(['linkedin']);
    expect(result[0]!.scoringSheet).toBeNull();
    // Ligne sans `sources` → [] (PAS de défaut 'manual' réinjecté à la
    // réhydratation, sinon une campagne sans flux redeviendrait activable).
    expect(result[0]!.sources).toEqual([]);
    // Reporting (préparation) — ligne sans liens → null (campagne historique).
    expect(result[0]!.siteId).toBeNull();
    expect(result[0]!.donneurOrdreId).toBeNull();
  });

  it('upserts a campaign with onConflict id', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'CAMP-0001',
        name: 'Comptable senior',
        status: 'in_progress',
        fdp: {
          campaignId: 'CAMP-0001',
          fields: {},
          isComplete: true,
          isValidated: true,
        },
        scoring_sheet: null,
        published_channels: [],
        sources_confirmed: false,
        created_at: '2026-05-01T00:00:00Z',
        updated_at: '2026-05-01T00:00:00Z',
      },
      error: null,
    });
    const selectAfterUpsert = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select: selectAfterUpsert });
    const from = vi.fn().mockReturnValue({ upsert });
    requireServerSupabaseMock.mockReturnValue({ from } as never);

    const result = await upsertCampaign(
      buildCampaign({ siteId: 'SITE-1', donneurOrdreId: 'DO-1' }),
    );
    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0]!;
    expect(args[1]).toEqual({ onConflict: 'id' });
    // Reporting (préparation) — les liens campagne→site/donneur sont persistés.
    const sentRow = args[0] as {
      site_id: string | null;
      donneur_ordre_id: string | null;
    };
    expect(sentRow.site_id).toBe('SITE-1');
    expect(sentRow.donneur_ordre_id).toBe('DO-1');
    expect(result.id).toBe('CAMP-0001');
  });

  it('patchCampaign only updates the provided fields', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'CAMP-0001',
        name: 'Comptable senior',
        status: 'paused',
        fdp: {
          campaignId: 'CAMP-0001',
          fields: {},
          isComplete: true,
          isValidated: true,
        },
        scoring_sheet: null,
        published_channels: [],
        sources_confirmed: false,
        created_at: '2026-05-01T00:00:00Z',
        updated_at: '2026-05-02T00:00:00Z',
      },
      error: null,
    });
    const selectAfterUpdate = vi.fn().mockReturnValue({ maybeSingle });
    const eq = vi.fn().mockReturnValue({ select: selectAfterUpdate });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    requireServerSupabaseMock.mockReturnValue({ from } as never);

    const result = await patchCampaign('CAMP-0001', { status: 'paused' });
    expect(update).toHaveBeenCalledWith({ status: 'paused' });
    expect(eq).toHaveBeenCalledWith('id', 'CAMP-0001');
    expect(result?.status).toBe('paused');
  });

  it('patchCampaign returns null when patch is empty', async () => {
    requireServerSupabaseMock.mockReturnValue({ from: vi.fn() } as never);
    const result = await patchCampaign('CAMP-0001', {});
    expect(result).toBeNull();
  });

  it('listCampaigns throws on supabase error', async () => {
    const order = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'boom' } });
    const select = vi.fn().mockReturnValue({ order });
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    } as never);
    await expect(listCampaigns()).rejects.toThrow(/listCampaigns: boom/);
  });
});
