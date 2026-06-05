import OpenAI, {
  APIError,
  APIConnectionTimeoutError,
  RateLimitError,
} from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import type { Uploadable } from 'openai/core/uploads';

import type { z } from 'zod';

import { AIProviderError, AIValidationError } from './errors';
import { estimateCost } from './pricing';

if (typeof window !== 'undefined') {
  throw new AIProviderError(
    'client_context',
    'src/lib/ai/provider.ts must be imported from server code only.',
  );
}

const DEFAULT_CHAT_MODEL = 'gpt-4o-mini';
const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1';
const DEFAULT_TIMEOUT_MS = 30_000;

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
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

export function __resetClientForTests(): void {
  cachedClient = null;
}

export type ChatCompleteParams = {
  messages: ChatCompletionMessageParam[];
  model?: string;
  temperature?: number;
  jsonMode?: boolean;
  maxTokens?: number;
  /**
   * Graine de reproductibilité OpenAI (best-effort). Omise par défaut pour ne
   * pas changer le comportement des agents créatifs (job-writer, mail-composer).
   * Les appels déterministes (extraction/scoring — C4) passent `seed` explicite.
   */
  seed?: number;
};

export type ChatCompleteResult = {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costEstimate: number;
  durationMs: number;
};

export async function chatComplete(
  params: ChatCompleteParams,
): Promise<ChatCompleteResult> {
  const model = params.model ?? DEFAULT_CHAT_MODEL;
  const client = getClient();
  const startedAt = Date.now();

  const body: ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: params.messages,
    temperature: params.temperature ?? 0.3,
    max_tokens: params.maxTokens,
    seed: params.seed,
    response_format: params.jsonMode ? { type: 'json_object' } : undefined,
  };

  let response;
  try {
    response = await client.chat.completions.create(body);
  } catch (err) {
    throw mapOpenAIError(err);
  }

  const choice = response.choices[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new AIProviderError(
      'invalid_response',
      'Empty completion content returned by OpenAI.',
    );
  }

  const promptTokens = response.usage?.prompt_tokens ?? 0;
  const completionTokens = response.usage?.completion_tokens ?? 0;
  const totalTokens = response.usage?.total_tokens ?? promptTokens + completionTokens;

  return {
    content,
    model: response.model,
    usage: { promptTokens, completionTokens, totalTokens },
    costEstimate: estimateCost(response.model, promptTokens, completionTokens),
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Graine déterministe par défaut des appels JSON validés (extraction/scoring).
 * Fixe pour la reproductibilité ; surchargeable via les options.
 */
export const DETERMINISTIC_SEED = 42;
const DEFAULT_MAX_VALIDATION_ATTEMPTS = 3;

export type ChatCompleteJsonOptions = {
  model?: string;
  maxTokens?: number;
  /** Défaut 0 (déterminisme). */
  temperature?: number;
  /** Défaut DETERMINISTIC_SEED (42). */
  seed?: number;
  /** Nombre maximal de tentatives (1 initiale + reprises). Défaut 3. */
  maxAttempts?: number;
};

export type ChatCompleteJsonResult<T> = {
  data: T;
  /** Métriques de l'appel ayant réussi (la dernière tentative). */
  raw: ChatCompleteResult;
  /** Nombre de tentatives consommées (1 = succès au premier essai). */
  attempts: number;
};

/**
 * Appel LLM en mode JSON STRICT, déterministe (temperature 0 + seed 42 par
 * défaut), avec validation Zod de la sortie et retry × N (défaut 3) sur échec
 * de parsing ou de schéma. Aucune sortie non validée n'est jamais renvoyée :
 * après épuisement des tentatives, lève `AIValidationError` (que l'extraction
 * C4 traduit en `non_verifiable` + `llmFailure`).
 *
 * À chaque reprise, une consigne de correction est injectée dans la conversation
 * (la réponse fautive + un rappel du format), pour que le modèle corrige plutôt
 * que de répéter à l'identique malgré la graine fixe. Les erreurs de transport
 * (`AIProviderError`) ne sont PAS retentées ici : elles se propagent immédiatement.
 */
export async function chatCompleteJson<T>(
  messages: ChatCompletionMessageParam[],
  schema: z.ZodType<T>,
  options: ChatCompleteJsonOptions = {},
): Promise<ChatCompleteJsonResult<T>> {
  const temperature = options.temperature ?? 0;
  const seed = options.seed ?? DETERMINISTIC_SEED;
  const maxAttempts = Math.max(
    1,
    options.maxAttempts ?? DEFAULT_MAX_VALIDATION_ATTEMPTS,
  );

  const convo: ChatCompletionMessageParam[] = [...messages];
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // AIProviderError (transport/API) se propage directement, sans retry.
    // Copie défensive : `convo` est muté entre tentatives, on en fige un
    // instantané par appel (évite tout aliasing côté client OpenAI).
    const raw = await chatComplete({
      messages: [...convo],
      model: options.model,
      maxTokens: options.maxTokens,
      temperature,
      seed,
      jsonMode: true,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.content);
    } catch (err) {
      lastError = err;
      pushCorrection(convo, raw.content, err);
      continue;
    }

    const validated = schema.safeParse(parsed);
    if (validated.success) {
      return { data: validated.data, raw, attempts: attempt };
    }
    lastError = validated.error;
    pushCorrection(convo, raw.content, validated.error);
  }

  throw new AIValidationError(
    `Réponse LLM invalide après ${maxAttempts} tentative(s).`,
    maxAttempts,
    lastError,
  );
}

function pushCorrection(
  convo: ChatCompletionMessageParam[],
  previousContent: string,
  error: unknown,
): void {
  const detail = error instanceof Error ? error.message : String(error);
  convo.push(
    { role: 'assistant', content: previousContent },
    {
      role: 'user',
      content:
        "⚠️ Ta réponse précédente n'était pas un JSON valide conforme au schéma " +
        `attendu. Erreur : ${detail.slice(0, 300)}. Renvoie UNIQUEMENT un objet ` +
        'JSON strictement conforme, sans aucun texte autour.',
    },
  );
}

export type TranscribeParams = {
  audio: Uploadable;
  model?: string;
  language?: string;
};

export type TranscribeResult = {
  text: string;
  model: string;
  durationMs: number;
};

export async function transcribe(
  params: TranscribeParams,
): Promise<TranscribeResult> {
  const model = params.model ?? DEFAULT_TRANSCRIPTION_MODEL;
  const client = getClient();
  const startedAt = Date.now();

  try {
    const result = await client.audio.transcriptions.create({
      file: params.audio,
      model,
      language: params.language,
      response_format: 'json',
    });
    return {
      text: result.text,
      model,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    throw mapOpenAIError(err);
  }
}

function mapOpenAIError(err: unknown): AIProviderError {
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
    err instanceof Error ? err.message : 'Unknown OpenAI error',
    err,
  );
}

export { estimateCost };
