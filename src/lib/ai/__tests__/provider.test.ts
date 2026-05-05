import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
