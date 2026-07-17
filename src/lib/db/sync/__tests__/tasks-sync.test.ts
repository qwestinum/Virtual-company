/**
 * Audit C7 — le push de fond des tâches ne perd plus en silence : l'issue est
 * remontée au registre de synchro (même contrat que campaigns-sync).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { persistTask, retryFailedTaskPushes } from '@/lib/db/sync/tasks-sync';
import type { ArchivedTask } from '@/stores/tasks-store';
import { useSyncStatusStore } from '@/stores/sync-status-store';

const SNAPSHOT = { id: 'TASK-2026-001', name: 'Analyse CV DAF' } as unknown as ArchivedTask;

type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function makeRes(status: number, body?: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body ?? {},
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  useSyncStatusStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('persistTask — issue de persistance remontée (pas d’avalage)', () => {
  it('200 → { ok: true, demo: false } et PUT /api/tasks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeRes(200, { task: {} }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await persistTask(SNAPSHOT);

    expect(out).toEqual({ ok: true, demo: false });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tasks',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('503 (Supabase non configuré) → succès démo volatile, PAS un échec', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeRes(503)));
    const out = await persistTask(SNAPSHOT);
    expect(out).toEqual({ ok: true, demo: true });
  });

  it('500 avec message serveur → échec dur avec message remonté', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeRes(500, { message: 'db indisponible' })),
    );
    const out = await persistTask(SNAPSHOT);
    expect(out).toEqual({ ok: false, status: 500, error: 'db indisponible' });
  });

  it('réseau coupé (fetch rejette) → échec dur', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const out = await persistTask(SNAPSHOT);
    expect(out).toEqual({ ok: false, error: 'offline' });
  });
});

describe('retryFailedTaskPushes — rejoue et met à jour le registre', () => {
  it('échec marqué → retry réussi → drapeau levé', async () => {
    useSyncStatusStore.getState().markTaskFailed(SNAPSHOT);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeRes(200, {})));

    await retryFailedTaskPushes();

    expect(useSyncStatusStore.getState().failedTasks).toEqual({});
  });

  it('retry qui échoue encore → la tâche reste marquée', async () => {
    useSyncStatusStore.getState().markTaskFailed(SNAPSHOT);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeRes(500, {})));

    await retryFailedTaskPushes();

    expect(
      useSyncStatusStore.getState().failedTasks['TASK-2026-001'],
    ).toBeDefined();
  });
});
