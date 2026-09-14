import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from '@/lib/async/concurrency';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapWithConcurrency', () => {
  it('ne dépasse JAMAIS la limite de tâches en vol', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 23 }, (_, i) => i), 5, async (i) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick(1 + (i % 3));
      inFlight -= 1;
      return i;
    });
    expect(peak).toBe(5);
  });

  it('rend les résultats dans l’ordre des entrées, pas d’achèvement', async () => {
    const out = await mapWithConcurrency([30, 1, 20, 2], 4, async (ms) => {
      await tick(ms);
      return ms;
    });
    expect(out).toEqual([30, 1, 20, 2]);
  });

  it('traite chaque élément exactement une fois', async () => {
    const seen: number[] = [];
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 5, async (i) => {
      seen.push(i);
    });
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it('liste vide ⇒ aucun appel', async () => {
    let calls = 0;
    expect(await mapWithConcurrency([], 5, async () => (calls += 1))).toEqual([]);
    expect(calls).toBe(0);
  });

  it('une erreur remonte, sans lancer de nouvelle tâche après elle', async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4, 5], 1, async (i) => {
        started.push(i);
        if (i === 2) throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(started).toEqual([0, 1, 2]);
  });

  it('refuse une limite invalide', async () => {
    await expect(mapWithConcurrency([1], 0, async () => 1)).rejects.toThrow();
  });
});
