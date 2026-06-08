import Anthropic from '@anthropic-ai/sdk';
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
import { zodToAnthropicToolSchema } from './zod-to-anthropic-schema';

if (typeof window !== 'undefined') {
  throw new AIProviderError(
    'client_context',
    'src/lib/ai/provider.ts must be imported from server code only.',
  );
}

// Modèle chat par défaut (pour tout appel qui ne passe pas `model`
// explicitement). Surchargeable via `OPENAI_CHAT_MODEL` dans .env.local
// pour tester un autre modèle (ex. gpt-4o) sans toucher au code — l'env
// étant figé au démarrage, un redémarrage du serveur dev est requis.
const DEFAULT_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-4o-mini';
const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1';
const DEFAULT_TIMEOUT_MS = 30_000;

// Modèle Anthropic par défaut pour le chemin JSON (analyse CV). Surchargeable
// via ANTHROPIC_CHAT_MODEL. Cf. `chatCompleteJson` (routage CV_ANALYZER_PROVIDER).
const DEFAULT_ANTHROPIC_MODEL =
  process.env.ANTHROPIC_CHAT_MODEL?.trim() || 'claude-sonnet-4-6';
// `max_tokens` est OBLIGATOIRE côté Anthropic (contrairement à OpenAI). Valeur
// confortable pour les verdicts d'une grande grille ; surchargeable par appel.
const DEFAULT_ANTHROPIC_MAX_TOKENS = 8192;
// Nom de l'outil unique forcé pour contraindre la sortie JSON (équivalent du
// « JSON mode » OpenAI). Le modèle DOIT appeler cet outil ; on lit son `input`.
const ANTHROPIC_JSON_TOOL_NAME = 'emit_result';

let cachedClient: OpenAI | null = null;
let cachedAnthropic: Anthropic | null = null;

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

function getAnthropicClient(): Anthropic {
  if (cachedAnthropic) return cachedAnthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new AIProviderError(
      'config_missing',
      'ANTHROPIC_API_KEY is not set in the environment.',
    );
  }
  cachedAnthropic = new Anthropic({ apiKey, timeout: DEFAULT_TIMEOUT_MS });
  return cachedAnthropic;
}

export function __resetClientForTests(): void {
  cachedClient = null;
  cachedAnthropic = null;
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
 *
 * ROUTAGE FOURNISSEUR (`CV_ANALYZER_PROVIDER`) : `openai` (défaut) ou `anthropic`.
 * En mode `anthropic`, l'appel part vers Sonnet 4.6 (`messages.create` + outil
 * forcé) ; mêmes garanties (validation Zod + retry × N). LIMITE : Anthropic
 * n'expose PAS de graine (`seed`) → le déterminisme « bit-à-bit » du pipeline
 * d'extraction/scoring (assuré côté OpenAI par seed 42 + temperature 0) n'est
 * PAS reproductible côté Anthropic ; seule `temperature` (défaut 0) est appliquée.
 */
export async function chatCompleteJson<T>(
  messages: ChatCompletionMessageParam[],
  schema: z.ZodType<T>,
  options: ChatCompleteJsonOptions = {},
): Promise<ChatCompleteJsonResult<T>> {
  const provider = (process.env.CV_ANALYZER_PROVIDER ?? 'openai')
    .trim()
    .toLowerCase();
  if (provider === 'anthropic') {
    return anthropicCompleteJson(messages, schema, options);
  }

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

// ── Chemin Anthropic (Sonnet 4.6) ───────────────────────────────────────────

type AnthropicMessage = { role: 'user' | 'assistant'; content: string };

/**
 * Sépare le message `system` (top-level chez Anthropic, pas dans `messages[]`)
 * des tours user/assistant. Plusieurs blocs `system` sont concaténés. Exporté
 * pour test unitaire (mapping pur, sans réseau).
 */
export function splitMessagesForAnthropic(
  messages: ChatCompletionMessageParam[],
): { system: string; messages: AnthropicMessage[] } {
  const systemParts: string[] = [];
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    const content =
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    if (m.role === 'system') {
      systemParts.push(content);
      continue;
    }
    out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
  }
  return { system: systemParts.join('\n\n'), messages: out };
}

/**
 * Variante Anthropic de `chatCompleteJson`. Force un outil unique dont
 * `input_schema` provient du schéma Zod (cf. `zodToAnthropicToolSchema`) —
 * équivalent du JSON mode OpenAI. Valide la sortie avec le MÊME schéma Zod et
 * applique le MÊME retry × N. Pas de `seed` (non supporté par Anthropic) :
 * `temperature` (défaut 0) est le seul levier de stabilité.
 */
async function anthropicCompleteJson<T>(
  messages: ChatCompletionMessageParam[],
  schema: z.ZodType<T>,
  options: ChatCompleteJsonOptions,
): Promise<ChatCompleteJsonResult<T>> {
  const temperature = options.temperature ?? 0;
  const maxAttempts = Math.max(
    1,
    options.maxAttempts ?? DEFAULT_MAX_VALIDATION_ATTEMPTS,
  );
  const model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS;
  const inputSchema = zodToAnthropicToolSchema(schema);
  const { system, messages: baseMessages } = splitMessagesForAnthropic(messages);
  const client = getAnthropicClient();

  const convo: AnthropicMessage[] = [...baseMessages];
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: convo.map((m) => ({ role: m.role, content: m.content })),
        tools: [
          {
            name: ANTHROPIC_JSON_TOOL_NAME,
            description:
              'Renvoie le résultat structuré demandé, strictement conforme au schéma.',
            input_schema: inputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: ANTHROPIC_JSON_TOOL_NAME },
      });
    } catch (err) {
      throw mapAnthropicError(err);
    }

    const durationMs = Date.now() - startedAt;
    const promptTokens = response.usage.input_tokens;
    const completionTokens = response.usage.output_tokens;
    const totalTokens = promptTokens + completionTokens;
    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    const raw: ChatCompleteResult = {
      content:
        toolBlock && toolBlock.type === 'tool_use'
          ? JSON.stringify(toolBlock.input)
          : '',
      model: response.model,
      usage: { promptTokens, completionTokens, totalTokens },
      costEstimate: estimateCost(response.model, promptTokens, completionTokens),
      durationMs,
    };

    if (!toolBlock || toolBlock.type !== 'tool_use') {
      lastError = new Error("Aucun bloc 'tool_use' renvoyé par Anthropic.");
      pushAnthropicCorrection(convo, '', lastError);
      continue;
    }

    const validated = schema.safeParse(toolBlock.input);
    if (validated.success) {
      return { data: validated.data, raw, attempts: attempt };
    }
    lastError = validated.error;
    pushAnthropicCorrection(convo, JSON.stringify(toolBlock.input), validated.error);
  }

  throw new AIValidationError(
    `Réponse LLM invalide après ${maxAttempts} tentative(s).`,
    maxAttempts,
    lastError,
  );
}

/**
 * Reprise Anthropic : on n'ajoute PAS le tour `assistant` (un `tool_use` non
 * suivi d'un `tool_result` est invalide côté API) — on empile un message `user`
 * de correction. Anthropic fusionne les messages `user` consécutifs.
 */
function pushAnthropicCorrection(
  convo: AnthropicMessage[],
  previousContent: string,
  error: unknown,
): void {
  const detail = error instanceof Error ? error.message : String(error);
  convo.push({
    role: 'user',
    content:
      `⚠️ Ta réponse précédente (${previousContent.slice(0, 200)}) n'était pas ` +
      `conforme au schéma attendu. Erreur : ${detail.slice(0, 300)}. Rappelle ` +
      `le format et renvoie le résultat via l'outil ${ANTHROPIC_JSON_TOOL_NAME}.`,
  });
}

function mapAnthropicError(err: unknown): AIProviderError {
  if (err instanceof AIProviderError) return err;
  if (err instanceof Anthropic.RateLimitError) {
    return new AIProviderError('rate_limit', err.message, err);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AIProviderError('timeout', err.message, err);
  }
  if (err instanceof Anthropic.APIError) {
    return new AIProviderError('api_error', err.message, err);
  }
  return new AIProviderError(
    'api_error',
    err instanceof Error ? err.message : 'Unknown Anthropic error',
    err,
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
