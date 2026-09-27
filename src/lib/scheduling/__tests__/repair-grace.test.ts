/**
 * Le filet de rattrapage de l'outbox ne touche JAMAIS une réservation encore
 * en cours de confirmation (27/09/2026, régression S13.3).
 *
 * Faux client enregistreur : chaque requête rend une liste vide, on lit les
 * filtres posés sur la table des réservations. La requête elle-même doit
 * porter la borne d'âge — un tri côté code arriverait après la lecture.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';

import { drainPendingEvents, REPAIR_GRACE_MS } from '../events';
import { configureScheduling } from '../runtime';

type Call = { table: string; method: string; args: unknown[] };

function recordingClient(calls: Call[]): SupabaseClient {
  const builder = (table: string): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, method: string) {
          if (method === 'then') {
            return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
          }
          return (...args: unknown[]) => {
            calls.push({ table, method, args });
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient;
}

const NOW = new Date('2026-09-27T12:00:00.000Z');
let calls: Call[];

beforeEach(() => {
  calls = [];
  configureScheduling({ supabase: recordingClient(calls), now: () => NOW });
});

describe('drainPendingEvents — filet de rattrapage', () => {
  it('ne lit que les réservations plus anciennes que le délai de grâce', async () => {
    await drainPendingEvents();

    const bookingFilters = calls.filter((c) => c.table === 'sched_bookings');
    const upper = bookingFilters.find((c) => c.method === 'lt' && c.args[0] === 'created_at');
    expect(upper?.args[1]).toBe(new Date(NOW.getTime() - REPAIR_GRACE_MS).toISOString());
    // La fenêtre de réparation, elle, reste bornée par le bas.
    const lower = bookingFilters.find((c) => c.method === 'gte' && c.args[0] === 'created_at');
    expect(lower?.args[1]).toBe(new Date(NOW.getTime() - 24 * 3_600_000).toISOString());
  });

  it('le délai de grâce couvre largement une séquence de confirmation', () => {
    // Quelques centaines de millisecondes en pratique ; une minute au moins.
    expect(REPAIR_GRACE_MS).toBeGreaterThanOrEqual(60_000);
  });
});
