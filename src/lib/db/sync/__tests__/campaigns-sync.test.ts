import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelScheduledCampaignPush,
  persistCampaign,
  retryFailedCampaignPushes,
} from '@/lib/db/sync/campaigns-sync';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import { useSyncStatusStore } from '@/stores/sync-status-store';

// Snapshot minimal — le contenu n'influence pas la logique d'issue de
// persistCampaign (elle ne dépend que de la réponse HTTP).
const SNAPSHOT = { id: 'CAMP-2026-099', name: 'Test' } as unknown as ActiveCampaign;

type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function makeRes(status: number, body?: unknown, nonJson = false): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (nonJson) throw new Error('not json');
      return body ?? {};
    },
  };
}

describe('persistCampaign — issue de persistance remontée (pas d’avalage)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('200 → { ok: true, demo: false } et PUT /api/campaigns', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeRes(200, { campaign: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await persistCampaign(SNAPSHOT);

    expect(out).toEqual({ ok: true, demo: false });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/campaigns',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('503 (Supabase non configuré) → succès démo volatile, PAS un échec', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeRes(503)));
    const out = await persistCampaign(SNAPSHOT);
    expect(out).toEqual({ ok: true, demo: true });
  });

  it('500 avec message serveur → échec dur avec message remonté', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeRes(500, { message: 'db indisponible' })),
    );
    const out = await persistCampaign(SNAPSHOT);
    expect(out).toEqual({ ok: false, status: 500, error: 'db indisponible' });
  });

  it('422 avec champ error → échec dur', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeRes(422, { error: 'invalid_scoring_sheet' })),
    );
    const out = await persistCampaign(SNAPSHOT);
    expect(out).toEqual({
      ok: false,
      status: 422,
      error: 'invalid_scoring_sheet',
    });
  });

  it('réponse non-JSON sur erreur → repli sur le code HTTP', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeRes(500, null, true)));
    const out = await persistCampaign(SNAPSHOT);
    expect(out).toEqual({ ok: false, status: 500, error: 'HTTP 500' });
  });

  it('erreur réseau (fetch rejette) → échec dur, jamais avalé', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Failed to fetch')),
    );
    const out = await persistCampaign(SNAPSHOT);
    expect(out).toEqual({ ok: false, error: 'Failed to fetch' });
  });

  it('cancelScheduledCampaignPush sur un id inconnu ne lève pas', () => {
    expect(() => cancelScheduledCampaignPush('CAMP-INCONNU')).not.toThrow();
  });
});

describe('retryFailedCampaignPushes — rejoue le sync de fond en échec', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSyncStatusStore.getState().reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useSyncStatusStore.getState().reset();
  });

  it('retry réussi → lève le drapeau « non enregistrée »', async () => {
    useSyncStatusStore.getState().markCampaignFailed(SNAPSHOT);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeRes(200, {})));

    await retryFailedCampaignPushes();

    expect(useSyncStatusStore.getState().failedList()).toHaveLength(0);
  });

  it('retry encore en échec → garde le drapeau (pas de perte silencieuse)', async () => {
    useSyncStatusStore.getState().markCampaignFailed(SNAPSHOT);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeRes(500, {})));

    await retryFailedCampaignPushes();

    expect(useSyncStatusStore.getState().failedList()).toHaveLength(1);
  });

  it('503 (démo) au retry → considéré OK, drapeau levé', async () => {
    useSyncStatusStore.getState().markCampaignFailed(SNAPSHOT);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeRes(503)));

    await retryFailedCampaignPushes();

    expect(useSyncStatusStore.getState().failedList()).toHaveLength(0);
  });
});
