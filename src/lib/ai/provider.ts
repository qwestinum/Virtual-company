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

import { AIProviderError } from './errors';
import { estimateCost } from './pricing';

if (typeof window !== 'undefined') {
  throw new AIProviderError(
    'client_context',
    'src/lib/ai/provider.ts must be imported from server code only.',
  );
}

const DEFAULT_CHAT_MODEL = 'gpt-4o-mini';
const DEFAULT_TRANSCRIPTION_MODEL = 'whisper-1';
const DEFAULT_TIMEOUT_MS = 10_000;

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
