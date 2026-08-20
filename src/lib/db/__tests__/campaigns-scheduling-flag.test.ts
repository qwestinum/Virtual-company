/**
 * Le flag « réservation native » ne doit JAMAIS voyager dans un snapshot.
 *
 * Le PUT `/api/campaigns` écrit la ligne ENTIÈRE à partir de l'état du client.
 * Si `scheduling_native` en faisait partie, un onglet ouvert avant l'activation
 * du flag le remettrait silencieusement à `false` à la première sauvegarde — et
 * les invitations suivantes repartiraient sur Cal.com sans que personne ne
 * l'ait demandé. C'est la classe de bug « perte silencieuse ».
 *
 * Le type `CampaignSnapshot` (Omit du champ) l'interdit déjà à la compilation ;
 * ce test le prouve à l'exécution, sur la ligne réellement envoyée à la base.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/supabase-server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db/supabase-server')>(
    '@/lib/db/supabase-server',
  );
  return { ...actual, requireServerSupabase: vi.fn() };
});

import { buildLifecycle } from '@/lib/campaign/lifecycle';
import { patchCampaign, upsertCampaign } from '@/lib/db/repos/campaigns';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { ActiveCampaign } from '@/stores/campaigns-store';

const requireServerSupabaseMock = vi.mocked(requireServerSupabase);

/** Ligne renvoyée par la base : le flag y est VRAI, comme en production. */
const ROW = {
  id: 'CAMP-0001',
  name: 'Comptable senior',
  status: 'active',
  fdp: { campaignId: 'CAMP-0001', fields: {}, isComplete: true, isValidated: true },
  scoring_sheet: null,
  published_channels: [],
  sources_confirmed: false,
  scheduling_native: true,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

function snapshot(): Omit<ActiveCampaign, 'schedulingNative'> {
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
    publishedChannels: [],
    sourcesConfirmed: false,
    sources: ['email'],
    thresholdLow: 10,
    thresholdHigh: 90,
    siteId: null,
    donneurOrdreId: null,
    ownerUserId: 'owner-1',
    status: 'active',
    lifecycle: buildLifecycle(),
    launchedAt: null,
    closedAt: null,
    prefillExtraction: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

function mockUpsert() {
  const single = vi.fn().mockResolvedValue({ data: ROW, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const upsert = vi.fn().mockReturnValue({ select });
  requireServerSupabaseMock.mockReturnValue({
    from: vi.fn().mockReturnValue({ upsert }),
  } as never);
  return upsert;
}

beforeEach(() => {
  requireServerSupabaseMock.mockReset();
});

describe('flag de réservation native — écriture', () => {
  it('le snapshot n’envoie AUCUNE colonne `scheduling_native`', async () => {
    const upsert = mockUpsert();
    await upsertCampaign(snapshot());

    const sentRow = upsert.mock.calls[0]![0] as Record<string, unknown>;
    // Pas seulement « pas à false » : la clé doit être ABSENTE, sinon
    // l'upsert écraserait la valeur existante.
    expect(Object.keys(sentRow)).not.toContain('scheduling_native');
  });

  it('la valeur en base survit à un snapshot et remonte dans le domaine', async () => {
    mockUpsert();
    const saved = await upsertCampaign(snapshot());
    expect(saved.schedulingNative).toBe(true);
  });

  it('une ligne SANS la colonne (base antérieure au lot 3) retombe sur false', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { ...ROW, scheduling_native: undefined },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select });
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ upsert }),
    } as never);

    const saved = await upsertCampaign(snapshot());
    expect(saved.schedulingNative).toBe(false);
  });

  it('le PATCH ciblé, lui, écrit bien la colonne — c’est le SEUL chemin', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: ROW, error: null });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eq = vi.fn().mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({ eq });
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ update }),
    } as never);

    await patchCampaign('CAMP-0001', { schedulingNative: true });
    expect(update).toHaveBeenCalledWith({ scheduling_native: true });
  });
});
