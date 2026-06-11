/**
 * Abstraction du fournisseur d'embeddings (Vivier — Session V1).
 *
 * Même pattern multi-provider que `provider.ts` (CV_ANALYZER_PROVIDER) : le
 * routage se fait par `EMBEDDING_PROVIDER` (défaut `openai`, modèle
 * `text-embedding-3-small`). D'autres implémentations (Mistral, modèle local)
 * se branchent ici sans toucher au reste du code (indexation, recherche).
 *
 * ⚠️ NON-COMPARABILITÉ INTER-PROVIDERS : deux fournisseurs (ou deux modèles)
 * produisent des espaces vectoriels DIFFÉRENTS et NON comparables entre eux.
 * Une similarité cosinus n'a de sens qu'entre vecteurs du MÊME (provider,
 * model). Conséquence : toute bascule de fournisseur ou de modèle impose une
 * RÉINDEXATION COMPLÈTE du vivier (`npm run reindex:vivier`). Le couple
 * (provider, model) est stocké avec chaque vecteur (table vivier_embeddings)
 * précisément pour détecter et corriger ces incohérences.
 *
 * Server-only (utilise la clé OpenAI). Ne jamais importer côté client.
 */

import OpenAI, {
  APIError,
  APIConnectionTimeoutError,
  RateLimitError,
} from 'openai';

import { AIProviderError } from './errors';
import { estimateCost } from './pricing';

if (typeof window !== 'undefined') {
  throw new AIProviderError(
    'client_context',
    'src/lib/ai/embeddings.ts must be imported from server code only.',
  );
}

/**
 * Modèle d'embedding par défaut. Surchargeable via `OPENAI_EMBEDDING_MODEL`.
 * Sa DIMENSION (1536 pour text-embedding-3-small) doit rester alignée avec la
 * colonne `vector(1536)` de la migration : changer de modèle pour une autre
 * dimension impose d'ajuster la DDL ET de réindexer.
 */
const FALLBACK_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_TIMEOUT_MS = 30_000;

/** Modèle effectif (lu de l'env à chaque appel, défaut text-embedding-3-small). */
function resolveModel(): string {
  return process.env.OPENAI_EMBEDDING_MODEL?.trim() || FALLBACK_EMBEDDING_MODEL;
}

/**
 * Plafond de troncature des textes longs. Le modèle d'embedding OpenAI accepte
 * ~8191 tokens en entrée ; au-delà l'appel échoue. Plutôt que d'embarquer un
 * tokenizer, on tronque par NOMBRE DE CARACTÈRES avec une marge prudente
 * (~4 caractères/token ⇒ ~7500 tokens pour 30 000 caractères, sous la limite).
 * La coupe se fait sur une frontière de mot proche pour ne pas casser un token
 * au milieu. Comportement documenté et déterministe : même texte ⇒ même coupe.
 */
export const EMBEDDING_MAX_CHARS = 30_000;

export type EmbedResult = {
  /** Vecteur dense normalisé renvoyé par le fournisseur. */
  vector: number[];
  /** Fournisseur effectif (ex. `openai`) — stocké avec le vecteur. */
  provider: string;
  /** Modèle effectif (ex. `text-embedding-3-small`) — stocké avec le vecteur. */
  model: string;
  /** Coût estimé en USD (best-effort, tokens d'entrée). */
  costEstimate: number;
  durationMs: number;
};

let cachedClient: OpenAI | null = null;

function getEmbeddingClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new AIProviderError(
      'config_missing',
      'OPENAI_API_KEY is not set in the environment.',
    );
  }
  cachedClient = new OpenAI({ apiKey, timeout: DEFAULT_TIMEOUT_MS });
  return cachedClient;
}

export function __resetEmbeddingClientForTests(): void {
  cachedClient = null;
}

/**
 * Tronque proprement un texte sous la limite de tokens du modèle d'embedding.
 * Pur et déterministe (exporté pour test unitaire). Coupe sur le dernier
 * espace avant la limite quand il en reste un dans la zone finale, sinon coupe
 * net à `EMBEDDING_MAX_CHARS`.
 */
export function truncateForEmbedding(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= EMBEDDING_MAX_CHARS) return normalized;
  const hard = normalized.slice(0, EMBEDDING_MAX_CHARS);
  const lastSpace = hard.lastIndexOf(' ');
  // Ne reculer jusqu'à l'espace que s'il est « proche » de la fin (évite de
  // jeter trop de contenu si le texte n'a aucun espace dans la zone finale).
  if (lastSpace >= EMBEDDING_MAX_CHARS - 200) return hard.slice(0, lastSpace);
  return hard;
}

/** Provider d'embeddings effectif (lu de l'env, défaut openai). */
function resolveProvider(): string {
  return (process.env.EMBEDDING_PROVIDER ?? 'openai').trim().toLowerCase();
}

/**
 * Génère l'embedding sémantique d'un texte. Tronque les textes trop longs
 * (cf. `truncateForEmbedding`). Lève `AIProviderError` (transport/config) — le
 * service d'indexation traite l'échec en repassant le dossier en `failed`.
 *
 * Le seul provider implémenté en V1 est `openai`. Tout autre `EMBEDDING_PROVIDER`
 * lève `config_missing` (branchement à venir, sans changement ailleurs).
 */
export async function embedText(text: string): Promise<EmbedResult> {
  const provider = resolveProvider();
  if (provider !== 'openai') {
    throw new AIProviderError(
      'config_missing',
      `EMBEDDING_PROVIDER='${provider}' non supporté (seul 'openai' est implémenté en V1).`,
    );
  }

  const input = truncateForEmbedding(text);
  if (input.length === 0) {
    throw new AIProviderError(
      'invalid_response',
      'Texte vide : impossible de générer un embedding.',
    );
  }

  const model = resolveModel();
  const client = getEmbeddingClient();
  const startedAt = Date.now();

  let response;
  try {
    response = await client.embeddings.create({ model, input });
  } catch (err) {
    throw mapOpenAIEmbeddingError(err);
  }

  const vector = response.data[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new AIProviderError(
      'invalid_response',
      'Réponse embedding vide renvoyée par OpenAI.',
    );
  }

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  return {
    vector,
    provider: 'openai',
    model: response.model || model,
    costEstimate: estimateCost(response.model || model, promptTokens, 0),
    durationMs: Date.now() - startedAt,
  };
}

function mapOpenAIEmbeddingError(err: unknown): AIProviderError {
  if (err instanceof AIProviderError) return err;
  if (err instanceof RateLimitError) {
    return new AIProviderError('rate_limit', err.message, err);
  }
  if (err instanceof APIConnectionTimeoutError) {
    return new AIProviderError('timeout', err.message, err);
  }
  if (err instanceof APIError) {
    return new AIProviderError('api_error', err.message, err);
  }
  return new AIProviderError(
    'api_error',
    err instanceof Error ? err.message : 'Unknown OpenAI embedding error',
    err,
  );
}
