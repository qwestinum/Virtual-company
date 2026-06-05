import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AIProviderError } from '@/lib/ai/errors';
import { estimateCost } from '@/lib/ai/pricing';

const chatCreateMock = vi.fn();
const audioCreateMock = vi.fn();

vi.mock('openai', async () => {
  const actual = await vi.importActual<typeof import('openai')>('openai');
  class MockOpenAI {
    chat = { completions: { create: chatCreateMock } };
    audio = { transcriptions: { create: audioCreateMock } };
  }
  return { ...actual, default: MockOpenAI, OpenAI: MockOpenAI };
});

function okCompletion(content: string, model = 'gpt-4o-mini') {
  return {
    model,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

describe('estimateCost', () => {
  it('computes gpt-4o-mini cost', () => {
    const cost = estimateCost('gpt-4o-mini', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.75, 5);
  });

  it('computes gpt-4o cost', () => {
    const cost = estimateCost('gpt-4o', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(12.5, 5);
  });

  it('returns 0 for unknown model', () => {
    expect(estimateCost('unknown-model', 1000, 1000)).toBe(0);
  });
});

describe('chatComplete', () => {
  beforeEach(async () => {
    chatCreateMock.mockReset();
    audioCreateMock.mockReset();
    const mod = await import('@/lib/ai/provider');
    mod.__resetClientForTests();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('throws AIProviderError when OPENAI_API_KEY is missing', async () => {
    const { chatComplete } = await import('@/lib/ai/provider');
    await expect(
      chatComplete({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(AIProviderError);
  });

  it('returns mapped result on success', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    chatCreateMock.mockResolvedValueOnce({
      model: 'gpt-4o-mini',
      choices: [{ message: { content: 'hello world' } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    });

    const { chatComplete } = await import('@/lib/ai/provider');
    const result = await chatComplete({
      messages: [{ role: 'user', content: 'ping' }],
    });

    expect(result.content).toBe('hello world');
    expect(result.usage.totalTokens).toBe(15);
    expect(result.costEstimate).toBeGreaterThanOrEqual(0);
    expect(chatCreateMock).toHaveBeenCalledOnce();
    const call = chatCreateMock.mock.calls[0][0];
    expect(call.model).toBe('gpt-4o-mini');
  });

  it('throws invalid_response when content is empty', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    chatCreateMock.mockResolvedValueOnce({
      model: 'gpt-4o-mini',
      choices: [{ message: { content: '' } }],
      usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
    });
    const { chatComplete } = await import('@/lib/ai/provider');
    await expect(
      chatComplete({ messages: [{ role: 'user', content: 'ping' }] }),
    ).rejects.toMatchObject({
      name: 'AIProviderError',
      code: 'invalid_response',
    });
  });

  it('passes response_format json_object when jsonMode true', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    chatCreateMock.mockResolvedValueOnce({
      model: 'gpt-4o-mini',
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    });
    const { chatComplete } = await import('@/lib/ai/provider');
    await chatComplete({
      messages: [{ role: 'user', content: 'ping' }],
      jsonMode: true,
    });
    const call = chatCreateMock.mock.calls[0][0];
    expect(call.response_format).toEqual({ type: 'json_object' });
  });
});

describe('chatComplete — déterminisme (seed)', () => {
  beforeEach(async () => {
    chatCreateMock.mockReset();
    const mod = await import('@/lib/ai/provider');
    mod.__resetClientForTests();
    process.env.OPENAI_API_KEY = 'sk-test';
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('passe le seed au body quand fourni', async () => {
    chatCreateMock.mockResolvedValueOnce(okCompletion('hi'));
    const { chatComplete } = await import('@/lib/ai/provider');
    await chatComplete({ messages: [{ role: 'user', content: 'x' }], seed: 42 });
    expect(chatCreateMock.mock.calls[0][0].seed).toBe(42);
  });

  it('omet le seed et garde temperature 0.3 par défaut (non-régression)', async () => {
    chatCreateMock.mockResolvedValueOnce(okCompletion('hi'));
    const { chatComplete } = await import('@/lib/ai/provider');
    await chatComplete({ messages: [{ role: 'user', content: 'x' }] });
    const body = chatCreateMock.mock.calls[0][0];
    expect(body.seed).toBeUndefined();
    expect(body.temperature).toBe(0.3);
  });
});

describe('chatCompleteJson — validation Zod stricte + retry', () => {
  const SchemaT = z.object({ value: z.number() });

  beforeEach(async () => {
    chatCreateMock.mockReset();
    const mod = await import('@/lib/ai/provider');
    mod.__resetClientForTests();
    process.env.OPENAI_API_KEY = 'sk-test';
  });
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('défaut déterministe : temperature 0 + seed 42 + json_object', async () => {
    chatCreateMock.mockResolvedValueOnce(okCompletion('{"value":1}'));
    const { chatCompleteJson } = await import('@/lib/ai/provider');
    const r = await chatCompleteJson([{ role: 'user', content: 'x' }], SchemaT);
    expect(r.data).toEqual({ value: 1 });
    expect(r.attempts).toBe(1);
    const body = chatCreateMock.mock.calls[0][0];
    expect(body.temperature).toBe(0);
    expect(body.seed).toBe(42);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('réessaie sur JSON invalide puis réussit (correction injectée)', async () => {
    chatCreateMock
      .mockResolvedValueOnce(okCompletion('pas du json'))
      .mockResolvedValueOnce(okCompletion('{"value":7}'));
    const { chatCompleteJson } = await import('@/lib/ai/provider');
    const r = await chatCompleteJson([{ role: 'user', content: 'x' }], SchemaT);
    expect(r.data).toEqual({ value: 7 });
    expect(r.attempts).toBe(2);
    expect(chatCreateMock).toHaveBeenCalledTimes(2);
    const firstMsgs = chatCreateMock.mock.calls[0][0].messages;
    const secondMsgs = chatCreateMock.mock.calls[1][0].messages;
    expect(secondMsgs.length).toBeGreaterThan(firstMsgs.length);
  });

  it('réessaie sur schéma invalide (JSON ok, mauvaise forme)', async () => {
    chatCreateMock
      .mockResolvedValueOnce(okCompletion('{"value":"pas-un-nombre"}'))
      .mockResolvedValueOnce(okCompletion('{"value":3}'));
    const { chatCompleteJson } = await import('@/lib/ai/provider');
    const r = await chatCompleteJson([{ role: 'user', content: 'x' }], SchemaT);
    expect(r.data).toEqual({ value: 3 });
    expect(r.attempts).toBe(2);
  });

  it('échoue après 3 tentatives ⇒ AIValidationError (attempts=3)', async () => {
    chatCreateMock.mockResolvedValue(okCompletion('toujours invalide'));
    const { chatCompleteJson } = await import('@/lib/ai/provider');
    const { AIValidationError } = await import('@/lib/ai/errors');
    const err = await chatCompleteJson(
      [{ role: 'user', content: 'x' }],
      SchemaT,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AIValidationError);
    expect(err.attempts).toBe(3);
    expect(chatCreateMock).toHaveBeenCalledTimes(3);
  });

  it('ne réessaie PAS sur erreur API (propagation immédiate)', async () => {
    chatCreateMock.mockRejectedValueOnce(new Error('boom réseau'));
    const { chatCompleteJson } = await import('@/lib/ai/provider');
    await expect(
      chatCompleteJson([{ role: 'user', content: 'x' }], SchemaT),
    ).rejects.toBeInstanceOf(AIProviderError);
    expect(chatCreateMock).toHaveBeenCalledTimes(1);
  });

  it('seed / temperature surchargeables via options', async () => {
    chatCreateMock.mockResolvedValueOnce(okCompletion('{"value":1}'));
    const { chatCompleteJson } = await import('@/lib/ai/provider');
    await chatCompleteJson([{ role: 'user', content: 'x' }], SchemaT, {
      seed: 7,
      temperature: 0.5,
    });
    const body = chatCreateMock.mock.calls[0][0];
    expect(body.seed).toBe(7);
    expect(body.temperature).toBe(0.5);
  });
});
