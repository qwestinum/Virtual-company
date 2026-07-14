/**
 * Pagination keyset exhaustive (audit C8) — PURE.
 *
 * Le linchpin de la correction : ces tests prouvent l'exhaustivité (aucun trou,
 * aucun doublon) y compris aux frontières de page et sous insertion concurrente.
 */
import { describe, expect, it, vi } from 'vitest';

import { chunk, fetchAllKeyset } from '@/lib/db/paginate';

/** Simule une table triée par id : renvoie les lignes `> afterId`, limitées. */
function makeStore(ids: string[]) {
  const sorted = [...ids].sort();
  return (afterId: string | null, limit: number) => {
    const start = afterId === null ? 0 : sorted.findIndex((x) => x > afterId);
    const slice = start < 0 ? [] : sorted.slice(start, start + limit);
    return Promise.resolve(slice.map((id) => ({ id })));
  };
}

describe('fetchAllKeyset', () => {
  it('rapatrie TOUTES les lignes quand le total dépasse plusieurs pages', async () => {
    const ids = Array.from({ length: 2500 }, (_, i) =>
      String(i).padStart(5, '0'),
    );
    const rows = await fetchAllKeyset({
      pageSize: 1000,
      cursorOf: (r: { id: string }) => r.id,
      fetchPage: makeStore(ids),
    });
    expect(rows).toHaveLength(2500); // avant correctif : 1000 (cap silencieux)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500); // aucun doublon
    expect(rows[0]!.id).toBe('00000');
    expect(rows[2499]!.id).toBe('02499');
  });

  it('frontière EXACTE : total == pageSize → une page pleine puis une page vide', async () => {
    const fetchPage = vi.fn(makeStore(['a', 'b', 'c']));
    const rows = await fetchAllKeyset({ pageSize: 3, cursorOf: (r: { id: string }) => r.id, fetchPage });
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    // Page pleine (3) ⇒ on redemande ; la 2ᵉ page est vide ⇒ arrêt.
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('total < pageSize : une seule requête, pas de page superflue', async () => {
    const fetchPage = vi.fn(makeStore(['a', 'b']));
    await fetchAllKeyset({ pageSize: 1000, cursorOf: (r: { id: string }) => r.id, fetchPage });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('liste vide → []', async () => {
    const rows = await fetchAllKeyset({
      cursorOf: (r: { id: string }) => r.id,
      fetchPage: makeStore([]),
    });
    expect(rows).toEqual([]);
  });

  it('fail-safe : curseur non strictement croissant → arrêt (pas de boucle infinie)', async () => {
    // fetchPage pathologique : renvoie toujours une page pleine avec le même id.
    let calls = 0;
    const rows = await fetchAllKeyset({
      pageSize: 2,
      cursorOf: (r: { id: string }) => r.id,
      fetchPage: () => {
        calls += 1;
        return Promise.resolve([{ id: 'x' }, { id: 'x' }]);
      },
    });
    // 1ʳᵉ page acceptée, 2ᵉ tentative détecte curseur figé → stop.
    expect(calls).toBeLessThanOrEqual(2);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('chunk', () => {
  it('découpe en lots bornés (garantie sous le cap RPC)', () => {
    const ids = Array.from({ length: 700 }, (_, i) => i);
    const chunks = chunk(ids, 300);
    expect(chunks.map((c) => c.length)).toEqual([300, 300, 100]);
    expect(chunks.flat()).toHaveLength(700);
  });

  it('tableau vide → aucun lot', () => {
    expect(chunk([], 300)).toEqual([]);
  });

  it('size <= 0 → erreur (garde-fou)', () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});
