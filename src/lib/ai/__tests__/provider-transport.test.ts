/**
 * Budget de transport PAR APPEL — `timeoutMs` / `maxTransportRetries`.
 *
 * Ce qui est prouvé ici : les options atteignent bien le SDK, sur les DEUX
 * chemins (`chatCompleteJson` part chez Anthropic quand
 * `CV_ANALYZER_PROVIDER=anthropic`), et leur absence ne change RIEN à l'appel
 * existant (aucun second argument). Sans la seconde garantie, chaque appelant
 * du provider hériterait d'un changement de comportement qu'il n'a pas demandé.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const chatCreateMock = vi.fn();
const anthropicCreateMock = vi.fn();

vi.mock('openai', async () => {
  const actual = await vi.importActual<typeof import('openai')>('openai');
  class MockOpenAI {
    chat = { completions: { create: chatCreateMock } };
    audio = { transcriptions: { create: vi.fn() } };
  }
  return { ...actual, default: MockOpenAI, OpenAI: MockOpenAI };
});

vi.mock('@anthropic-ai/sdk', async () => {
  const actual = await vi.importActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk');
  class MockAnthropic {
    messages = { create: anthropicCreateMock };
  }
  return { ...actual, default: MockAnthropic, Anthropic: MockAnthropic };
});

const Schema = z.object({ ok: z.boolean() });

function openAiOk(content = '{"ok":true}') {
  return {
    model: 'gpt-4o-mini',
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function anthropicOk() {
  return {
    model: 'claude-sonnet-4-6',
    content: [{ type: 'tool_use', id: 't1', name: 'emit_result', input: { ok: true } }],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

beforeEach(async () => {
  chatCreateMock.mockReset();
  anthropicCreateMock.mockReset();
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  const mod = await import('@/lib/ai/provider');
  mod.__resetClientForTests();
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CV_ANALYZER_PROVIDER;
});

describe('sdkRequestOptions', () => {
  it('rien de fixé ⇒ undefined (le SDK garde ses défauts)', async () => {
    const { sdkRequestOptions } = await import('@/lib/ai/provider');
    expect(sdkRequestOptions({})).toBeUndefined();
  });

  it('traduit vers le vocabulaire du SDK', async () => {
    const { sdkRequestOptions } = await import('@/lib/ai/provider');
    expect(sdkRequestOptions({ timeoutMs: 25_000, maxTransportRetries: 0 })).toEqual({
      timeout: 25_000,
      maxRetries: 0,
    });
  });

  it('refuse une valeur absurde plutôt que de la transmettre', async () => {
    const { sdkRequestOptions } = await import('@/lib/ai/provider');
    expect(() => sdkRequestOptions({ timeoutMs: 0 })).toThrow(RangeError);
    expect(() => sdkRequestOptions({ timeoutMs: Number.NaN })).toThrow(RangeError);
    expect(() => sdkRequestOptions({ maxTransportRetries: -1 })).toThrow(RangeError);
    expect(() => sdkRequestOptions({ maxTransportRetries: 1.5 })).toThrow(RangeError);
  });
});

describe('chemin OpenAI', () => {
  it('chatComplete sans budget : un seul argument, comme avant', async () => {
    chatCreateMock.mockResolvedValueOnce(openAiOk('hello'));
    const { chatComplete } = await import('@/lib/ai/provider');
    await chatComplete({ messages: [{ role: 'user', content: 'ping' }] });
    expect(chatCreateMock.mock.calls[0]).toHaveLength(1);
  });

  it('chatComplete avec budget : les options partent au SDK', async () => {
    chatCreateMock.mockResolvedValueOnce(openAiOk('hello'));
    const { chatComplete } = await import('@/lib/ai/provider');
    await chatComplete({
      messages: [{ role: 'user', content: 'ping' }],
      timeoutMs: 25_000,
      maxTransportRetries: 0,
    });
    expect(chatCreateMock.mock.calls[0][1]).toEqual({ timeout: 25_000, maxRetries: 0 });
  });

  it('chatCompleteJson propage le budget à CHAQUE tentative de validation', async () => {
    chatCreateMock
      .mockResolvedValueOnce(openAiOk('pas du json'))
      .mockResolvedValueOnce(openAiOk('{"ok":true}'));
    const { chatCompleteJson } = await import('@/lib/ai/provider');
    const out = await chatCompleteJson([{ role: 'user', content: 'x' }], Schema, {
      maxAttempts: 2,
      timeoutMs: 25_000,
      maxTransportRetries: 0,
    });
    expect(out.attempts).toBe(2);
    expect(chatCreateMock).toHaveBeenCalledTimes(2);
    for (const call of chatCreateMock.mock.calls) {
      expect(call[1]).toEqual({ timeout: 25_000, maxRetries: 0 });
    }
  });

  it('chatCompleteJson sans budget : un seul argument, comme avant', async () => {
    chatCreateMock.mockResolvedValueOnce(openAiOk());
    const { chatCompleteJson } = await import('@/lib/ai/provider');
    await chatCompleteJson([{ role: 'user', content: 'x' }], Schema);
    expect(chatCreateMock.mock.calls[0]).toHaveLength(1);
  });
});

describe('chemin Anthropic (CV_ANALYZER_PROVIDER=anthropic)', () => {
  it('le budget atteint messages.create', async () => {
    process.env.CV_ANALYZER_PROVIDER = 'anthropic';
    anthropicCreateMock.mockResolvedValueOnce(anthropicOk());
    const { chatCompleteJson } = await import('@/lib/ai/provider');
    await chatCompleteJson([{ role: 'user', content: 'x' }], Schema, {
      timeoutMs: 25_000,
      maxTransportRetries: 1,
    });
    expect(chatCreateMock).not.toHaveBeenCalled();
    expect(anthropicCreateMock.mock.calls[0][1]).toEqual({ timeout: 25_000, maxRetries: 1 });
  });

  it('sans budget : un seul argument, comme avant', async () => {
    process.env.CV_ANALYZER_PROVIDER = 'anthropic';
    anthropicCreateMock.mockResolvedValueOnce(anthropicOk());
    const { chatCompleteJson } = await import('@/lib/ai/provider');
    await chatCompleteJson([{ role: 'user', content: 'x' }], Schema);
    expect(anthropicCreateMock.mock.calls[0]).toHaveLength(1);
  });
});
