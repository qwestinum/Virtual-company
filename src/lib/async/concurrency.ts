/**
 * Concurrence BORNÉE — au plus `limit` tâches en vol à la fois.
 *
 * Les résultats sont rendus dans l'ORDRE DES ENTRÉES, quel que soit l'ordre
 * d'achèvement. Une tâche qui lève fait échouer l'ensemble après que les
 * tâches déjà lancées ont fini (aucune tâche n'est abandonnée en vol) ; les
 * appelants qui veulent un résultat par élément capturent eux-mêmes.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`mapWithConcurrency: limite invalide (${limit})`);
  }
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;

  async function worker(): Promise<void> {
    while (failure === null && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await task(items[index] as T, index);
      } catch (error) {
        failure ??= { error };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  if (failure !== null) throw (failure as { error: unknown }).error;
  return results;
}
