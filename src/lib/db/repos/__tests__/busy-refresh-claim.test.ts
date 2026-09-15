/**
 * Relève des agendas déployée AVANT sa migration (runbook
 * `docs/ops/configuration-client.md`).
 *
 * Le code du lot C lit et écrit `recruiter_busy_snapshots.refresh_claimed_at`.
 * Tant que la colonne n'existe pas, la réservation de relève échoue sur
 * « colonne inconnue ». Ce qui doit en sortir : la passe LIT QUAND MÊME. Une
 * réservation impossible veut dire « pas de protection contre deux passes
 * simultanées », jamais « ne pas relire » — sinon un agenda dépublié resterait
 * silencieux jusqu'à la migration.
 *
 * Et symétriquement : une AUTRE panne de base ne doit pas être prise pour une
 * colonne absente (la réservation n'est pas accordée à l'aveugle).
 *
 * Aucune base : le client Supabase est simulé, requête par requête.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type DbError = { code: string; message: string };
type Call = { table: string; operation: 'update' | 'upsert'; filters: string[] };

const state: { updateError: DbError | null; upsertError: DbError | null; calls: Call[] } = {
  updateError: null,
  upsertError: null,
  calls: [],
};

/** Client minimal : chaque requête enregistre ce qu'on lui demande et rend l'erreur programmée. */
function fakeClient() {
  return {
    from(table: string) {
      const request = (operation: Call['operation']) => {
        const call: Call = { table, operation, filters: [] };
        state.calls.push(call);
        const error = operation === 'update' ? state.updateError : state.upsertError;
        const builder = {
          eq: (column: string) => {
            call.filters.push(`eq:${column}`);
            return builder;
          },
          or: (filter: string) => {
            call.filters.push(`or:${filter.split(',')[0]}`);
            return builder;
          },
          select: () => builder,
          then: (resolve: (value: { data: unknown[] | null; error: DbError | null }) => unknown) =>
            resolve({ data: error ? null : [], error }),
        };
        return builder;
      };
      return { update: () => request('update'), upsert: () => request('upsert') };
    },
  };
}

vi.mock('@/lib/db/supabase-server', async () => {
  class SupabaseNotConfiguredError extends Error {}
  return { SupabaseNotConfiguredError, requireServerSupabase: () => fakeClient() };
});

import { claimBusyRefresh } from '@/lib/db/repos/busy-snapshots';
import type { ExternalBusyRequest, Resource } from '@/lib/scheduling';
import { refreshBusyCalendarsWith } from '@/lib/scheduling-host/busy/refresh';

const NOW = '2026-09-15T08:00:00.000Z';
const RECRUITER = '11111111-1111-1111-1111-111111111111';

/** Les deux formes réelles de « colonne inconnue » : PostgREST (cache de schéma) et Postgres. */
const COLUMN_MISSING: Record<string, DbError> = {
  postgrest: {
    code: 'PGRST204',
    message: "Could not find the 'refresh_claimed_at' column of 'recruiter_busy_snapshots' in the schema cache",
  },
  postgres: {
    code: '42703',
    message: 'column recruiter_busy_snapshots.refresh_claimed_at does not exist',
  },
};

beforeEach(() => {
  state.updateError = null;
  state.upsertError = null;
  state.calls = [];
});

describe('claimBusyRefresh — colonne refresh_claimed_at absente', () => {
  it.each(Object.entries(COLUMN_MISSING))('%s : la réservation est ACCORDÉE (on relit)', async (_label, error) => {
    state.updateError = error;
    expect(await claimBusyRefresh(RECRUITER, NOW, 50_000)).toBe(true);
    // Elle a bien tenté la réservation conditionnelle avant de conclure.
    expect(state.calls[0]).toMatchObject({ table: 'recruiter_busy_snapshots', operation: 'update' });
  });

  it.each(Object.entries(COLUMN_MISSING))(
    '%s sur la création de ligne (agenda jamais lu) : accordée aussi',
    async (_label, error) => {
      state.upsertError = error; // l'update passe mais ne touche aucune ligne
      expect(await claimBusyRefresh(RECRUITER, NOW, 50_000)).toBe(true);
      expect(state.calls.map((c) => c.operation)).toEqual(['update', 'upsert']);
    },
  );

  it('une AUTRE panne de base n’est pas prise pour une colonne absente : réservation refusée', async () => {
    state.updateError = { code: '57014', message: 'canceling statement due to statement timeout' };
    expect(await claimBusyRefresh(RECRUITER, NOW, 50_000)).toBe(false);
  });
});

describe('refreshBusyCalendarsWith — passe complète, déployée avant la migration', () => {
  it('la passe LIT l’agenda malgré la colonne absente', async () => {
    state.updateError = COLUMN_MISSING.postgrest!;
    const reads: ExternalBusyRequest[] = [];
    const resource: Resource = {
      id: 'res-1',
      externalRef: RECRUITER,
      displayName: 'Camille',
      timezone: 'Europe/Paris',
      slotDurationMinutes: 45,
      bufferMinutes: 15,
      minNoticeMinutes: 0,
      horizonDays: 30,
      meetingLocation: null,
      notifyEmail: null,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    };

    const report = await refreshBusyCalendarsWith({
      provider: {
        async read(request) {
          reads.push(request);
          return { kind: 'unavailable', lastGood: null, failingSince: NOW };
        },
      },
      listRecruiterIds: async () => [RECRUITER],
      listSnapshots: async () => [],
      getResource: async () => resource,
      claim: claimBusyRefresh, // le VRAI repo, sur la base simulée
      now: () => new Date(NOW),
    });

    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ resource: { externalRef: RECRUITER }, freshness: 'live' });
    expect(report).toMatchObject({ recruiters: 1, failed: 1, skippedClaimed: 0 });
  });
});
