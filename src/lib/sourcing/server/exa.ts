/**
 * Appel au moteur de profils — UN appel par recherche, 100 résultats.
 * Spec : docs/specs/sourcing.md §1.1, §2.3-2.4.
 *
 * Pourquoi toujours 100, jamais 50 puis 50 : changer `numResults` CHANGE la
 * tête de liste (mesuré : 39 profils communs sur 50). La « suite » d'une
 * recherche n'existe pas chez le moteur ; elle vit dans la réserve locale.
 *
 * Seul appel réseau du module vers un tiers. La clé ne quitte jamais le serveur.
 */
import { ExaResultSchema, ExaSearchResponseSchema, type ExaResult } from '@/lib/sourcing/exa-schema';
import { malformedFieldLabels, MAX_MALFORMED_FIELDS } from '@/lib/sourcing/search-yield';

const ENDPOINT = 'https://api.exa.ai/search';
export const EXA_NUM_RESULTS = 100;
const TEXT_MAX_CHARACTERS = 10_000;
const TIMEOUT_MS = 30_000;

export type ExaFailure = 'unauthorized' | 'rate_limited' | 'unavailable' | 'invalid_response';

export class ExaError extends Error {
  constructor(
    readonly kind: ExaFailure,
    message: string,
  ) {
    super(message);
    this.name = 'ExaError';
  }
}

export type ExaSearchOutcome = {
  requestId: string | null;
  costUsd: number | null;
  results: { rank: number; result: ExaResult }[];
  /** Résultats illisibles écartés — comptés, jamais silencieux. */
  unreadable: number;
  /** Les champs fautifs des résultats illisibles, sans valeur (`malformedFieldLabels`). */
  malformedFields: string[];
  latencyMs: number;
};

export async function searchPeople(query: string): Promise<ExaSearchOutcome> {
  const key = process.env.EXA_API_KEY?.trim();
  if (!key) throw new ExaError('unauthorized', 'EXA_API_KEY absente');

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        query,
        type: 'auto',
        category: 'people',
        numResults: EXA_NUM_RESULTS,
        contents: { text: { maxCharacters: TEXT_MAX_CHARACTERS }, highlights: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (err) {
    throw new ExaError('unavailable', err instanceof Error ? err.message : String(err));
  }

  if (res.status === 401 || res.status === 403) throw new ExaError('unauthorized', `HTTP ${res.status}`);
  if (res.status === 429) throw new ExaError('rate_limited', 'HTTP 429');
  if (!res.ok) throw new ExaError('unavailable', `HTTP ${res.status}`);

  const parsed = ExaSearchResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ExaError('invalid_response', parsed.error.message);

  const results: ExaSearchOutcome['results'] = [];
  let unreadable = 0;
  const malformed = new Set<string>();
  parsed.data.results.forEach((raw, i) => {
    const r = ExaResultSchema.safeParse(raw);
    if (r.success) results.push({ rank: i + 1, result: r.data });
    else {
      unreadable += 1;
      for (const label of malformedFieldLabels(r.error.issues)) {
        if (malformed.size < MAX_MALFORMED_FIELDS) malformed.add(label);
      }
    }
  });

  return {
    requestId: parsed.data.requestId ?? null,
    costUsd: parsed.data.costDollars?.total ?? null,
    results,
    unreadable,
    malformedFields: [...malformed],
    latencyMs: Date.now() - started,
  };
}
