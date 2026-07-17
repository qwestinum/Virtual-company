import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hydrateArtifactsForCampaign,
  pushArtifact,
  retryFailedArtifactPushes,
} from '@/lib/db/sync/artifacts-sync';
import { useArtifactsStore } from '@/stores/artifacts-store';
import { useSyncStatusStore } from '@/stores/sync-status-store';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useArtifactsStore.setState({ byId: {} });
  useSyncStatusStore.getState().reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pushArtifact', () => {
  it('does not POST when the artifact has no owner', async () => {
    await pushArtifact({
      artifact: {
        id: 'art_1',
        name: 'x.md',
        mime: 'text/markdown',
        createdAt: '2026-05-12T00:00:00Z',
        campaignId: null,
        taskId: null,
        kind: 'fdp',
      },
      content: 'x',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not POST when the artifact has no kind', async () => {
    await pushArtifact({
      artifact: {
        id: 'art_1',
        name: 'x.md',
        mime: 'text/markdown',
        createdAt: '2026-05-12T00:00:00Z',
        campaignId: 'CAMP-1',
      },
      content: 'x',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs to /api/artifacts and back-updates the store with publicUrl', async () => {
    useArtifactsStore.setState({
      byId: {
        art_1: {
          id: 'art_1',
          name: 'fdp.md',
          mime: 'text/markdown',
          createdAt: '2026-05-12T00:00:00Z',
          campaignId: 'CAMP-1',
          kind: 'fdp',
          content: '# FDP',
          publicUrl: null,
          storagePath: null,
        },
      },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        artifact: {
          publicUrl: 'https://example.com/storage/x',
          storagePath: 'campagnes/CAMP-1/fdp.md',
        },
      }),
    });
    await pushArtifact({
      artifact: useArtifactsStore.getState().byId.art_1!,
      content: '# FDP',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/artifacts');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      id: 'art_1',
      campaignId: 'CAMP-1',
      kind: 'fdp',
      name: 'fdp.md',
      content: '# FDP',
      mime: 'text/markdown',
    });
    expect(useArtifactsStore.getState().byId.art_1!.publicUrl).toBe(
      'https://example.com/storage/x',
    );
    expect(useArtifactsStore.getState().byId.art_1!.storagePath).toBe(
      'campagnes/CAMP-1/fdp.md',
    );
  });

  it('marque l’échec réseau au registre de synchro (audit C7), sans crash', async () => {
    useArtifactsStore.setState({
      byId: {
        art_1: {
          id: 'art_1',
          name: 'fdp.md',
          mime: 'text/markdown',
          createdAt: '2026-05-12T00:00:00Z',
          campaignId: 'CAMP-1',
          kind: 'fdp',
          publicUrl: null,
        },
      },
    });
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(
      pushArtifact({
        artifact: useArtifactsStore.getState().byId.art_1!,
        content: '# FDP',
      }),
    ).resolves.toBeUndefined();
    // publicUrl reste null — pas de crash — mais l'échec est SIGNALÉ.
    expect(useArtifactsStore.getState().byId.art_1!.publicUrl).toBeNull();
    expect(
      useSyncStatusStore.getState().failedArtifacts.art_1,
    ).toMatchObject({ content: '# FDP' });
  });

  it('503 (Supabase non configuré) = démo volatile, PAS un échec', async () => {
    useArtifactsStore.setState({
      byId: {
        art_1: {
          id: 'art_1',
          name: 'fdp.md',
          mime: 'text/markdown',
          createdAt: '2026-05-12T00:00:00Z',
          campaignId: 'CAMP-1',
          kind: 'fdp',
          publicUrl: null,
        },
      },
    });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await pushArtifact({
      artifact: useArtifactsStore.getState().byId.art_1!,
      content: '# FDP',
    });
    expect(useSyncStatusStore.getState().failedArtifacts).toEqual({});
  });

  it('retryFailedArtifactPushes rejoue le CONTENU et lève le drapeau au succès', async () => {
    useArtifactsStore.setState({
      byId: {
        art_1: {
          id: 'art_1',
          name: 'fdp.md',
          mime: 'text/markdown',
          createdAt: '2026-05-12T00:00:00Z',
          campaignId: 'CAMP-1',
          kind: 'fdp',
          publicUrl: null,
        },
      },
    });
    // 1er push : 500 → marqué.
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await pushArtifact({
      artifact: useArtifactsStore.getState().byId.art_1!,
      content: '# FDP',
    });
    expect(useSyncStatusStore.getState().failedArtifacts.art_1).toBeDefined();
    // Retry : 200 → repoussé avec le même contenu, drapeau levé.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ artifact: { publicUrl: 'u', storagePath: 'p' } }),
    });
    await retryFailedArtifactPushes();
    expect(useSyncStatusStore.getState().failedArtifacts).toEqual({});
    const retryBody = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    expect(retryBody.content).toBe('# FDP');
  });

  it('does not back-update on non-OK HTTP', async () => {
    useArtifactsStore.setState({
      byId: {
        art_1: {
          id: 'art_1',
          name: 'fdp.md',
          mime: 'text/markdown',
          createdAt: '2026-05-12T00:00:00Z',
          campaignId: 'CAMP-1',
          kind: 'fdp',
          publicUrl: null,
        },
      },
    });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await pushArtifact({
      artifact: useArtifactsStore.getState().byId.art_1!,
      content: '# FDP',
    });
    expect(useArtifactsStore.getState().byId.art_1!.publicUrl).toBeNull();
  });
});

describe('hydrateArtifactsForCampaign', () => {
  it('seeds the store with metadata-only artifacts', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        artifacts: [
          {
            id: 'art_hydrated',
            campaignId: 'CAMP-1',
            taskId: null,
            kind: 'fdp',
            name: 'fdp.md',
            mime: 'text/markdown',
            publicUrl: 'https://example.com/storage/y',
            storagePath: 'campagnes/CAMP-1/fdp.md',
            createdAt: '2026-05-12T00:00:00Z',
          },
        ],
      }),
    });
    await hydrateArtifactsForCampaign('CAMP-1');
    const hydrated = useArtifactsStore.getState().byId.art_hydrated;
    expect(hydrated).toBeDefined();
    expect(hydrated!.publicUrl).toBe('https://example.com/storage/y');
    expect(hydrated!.content).toBeUndefined();
  });

  it('preserves a local artifact with content over a hydrated one', async () => {
    useArtifactsStore.setState({
      byId: {
        art_1: {
          id: 'art_1',
          name: 'local.md',
          mime: 'text/markdown',
          createdAt: '2026-05-12T00:00:00Z',
          content: '# local content',
          campaignId: 'CAMP-1',
          kind: 'fdp',
        },
      },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        artifacts: [
          {
            id: 'art_1',
            campaignId: 'CAMP-1',
            taskId: null,
            kind: 'fdp',
            name: 'should-not-overwrite.md',
            mime: 'text/markdown',
            publicUrl: 'https://example.com/different',
            storagePath: 'x',
            createdAt: '2026-05-12T00:00:00Z',
          },
        ],
      }),
    });
    await hydrateArtifactsForCampaign('CAMP-1');
    // Le local est préservé : name + content inchangés.
    const art = useArtifactsStore.getState().byId.art_1!;
    expect(art.name).toBe('local.md');
    expect(art.content).toBe('# local content');
  });
});
