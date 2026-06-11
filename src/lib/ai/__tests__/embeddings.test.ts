import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AIProviderError } from '@/lib/ai/errors';

const embeddingsCreateMock = vi.fn();

vi.mock('openai', async () => {
  const actual = await vi.importActual<typeof import('openai')>('openai');
  class MockOpenAI {
    embeddings = { create: embeddingsCreateMock };
  }
  return { ...actual, default: MockOpenAI, OpenAI: MockOpenAI };
});

function okEmbedding(vector: number[], model = 'text-embedding-3-small') {
  return {
    model,
    data: [{ embedding: vector }],
    usage: { prompt_tokens: 12, total_tokens: 12 },
  };
}

describe('truncateForEmbedding', () => {
  it('laisse intact un texte court', async () => {
    const { truncateForEmbedding } = await import('@/lib/ai/embeddings');
    expect(truncateForEmbedding('  bonjour  ')).toBe('bonjour');
  });

  it('tronque les textes au-delà de la limite de caractères', async () => {
    const { truncateForEmbedding, EMBEDDING_MAX_CHARS } = await import(
      '@/lib/ai/embeddings'
    );
    const long = 'a'.repeat(EMBEDDING_MAX_CHARS + 5000);
    const out = truncateForEmbedding(long);
    expect(out.length).toBeLessThanOrEqual(EMBEDDING_MAX_CHARS);
    expect(out.length).toBeGreaterThan(0);
  });

  it('coupe sur une frontière de mot proche de la fin quand elle existe', async () => {
    const { truncateForEmbedding, EMBEDDING_MAX_CHARS } = await import(
      '@/lib/ai/embeddings'
    );
    // Espace à 80 caractères de la limite ⇒ dans la zone de recul (≤200).
    const head = 'x'.repeat(EMBEDDING_MAX_CHARS - 80);
    const tail = 'y'.repeat(5000);
    const out = truncateForEmbedding(`${head} ${tail}`);
    expect(out).toBe(head);
    expect(out.endsWith(' ')).toBe(false);
  });
});

describe('embedText — routage provider + mapping', () => {
  beforeEach(async () => {
    embeddingsCreateMock.mockReset();
    const mod = await import('@/lib/ai/embeddings');
    mod.__resetEmbeddingClientForTests();
    process.env.OPENAI_API_KEY = 'sk-test';
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENAI_EMBEDDING_MODEL;
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENAI_EMBEDDING_MODEL;
  });

  it('route par défaut vers openai et renvoie vecteur + métadonnées provider/model', async () => {
    embeddingsCreateMock.mockResolvedValueOnce(okEmbedding([0.1, 0.2, 0.3]));
    const { embedText } = await import('@/lib/ai/embeddings');
    const r = await embedText('un CV de test bien rempli');
    expect(r.vector).toEqual([0.1, 0.2, 0.3]);
    expect(r.provider).toBe('openai');
    expect(r.model).toBe('text-embedding-3-small');
    expect(r.costEstimate).toBeGreaterThanOrEqual(0);
    const call = embeddingsCreateMock.mock.calls[0][0];
    expect(call.model).toBe('text-embedding-3-small');
  });

  it('tronque le texte trop long avant l’appel', async () => {
    embeddingsCreateMock.mockResolvedValueOnce(okEmbedding([1, 2]));
    const { embedText, EMBEDDING_MAX_CHARS } = await import('@/lib/ai/embeddings');
    await embedText('b'.repeat(EMBEDDING_MAX_CHARS + 10_000));
    const call = embeddingsCreateMock.mock.calls[0][0];
    expect(call.input.length).toBeLessThanOrEqual(EMBEDDING_MAX_CHARS);
  });

  it('honore OPENAI_EMBEDDING_MODEL', async () => {
    process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-3-large';
    embeddingsCreateMock.mockResolvedValueOnce(
      okEmbedding([0.5], 'text-embedding-3-large'),
    );
    const { embedText } = await import('@/lib/ai/embeddings');
    const r = await embedText('texte');
    expect(r.model).toBe('text-embedding-3-large');
    expect(embeddingsCreateMock.mock.calls[0][0].model).toBe(
      'text-embedding-3-large',
    );
  });

  it('lève config_missing si OPENAI_API_KEY absent', async () => {
    delete process.env.OPENAI_API_KEY;
    const { embedText } = await import('@/lib/ai/embeddings');
    await expect(embedText('x')).rejects.toMatchObject({
      name: 'AIProviderError',
      code: 'config_missing',
    });
  });

  it('lève config_missing pour un provider non supporté', async () => {
    process.env.EMBEDDING_PROVIDER = 'mistral';
    const { embedText } = await import('@/lib/ai/embeddings');
    await expect(embedText('x')).rejects.toMatchObject({
      name: 'AIProviderError',
      code: 'config_missing',
    });
    expect(embeddingsCreateMock).not.toHaveBeenCalled();
  });

  it('lève invalid_response sur texte vide', async () => {
    const { embedText } = await import('@/lib/ai/embeddings');
    await expect(embedText('   ')).rejects.toMatchObject({
      code: 'invalid_response',
    });
    expect(embeddingsCreateMock).not.toHaveBeenCalled();
  });

  it('propage une erreur API mappée en AIProviderError', async () => {
    embeddingsCreateMock.mockRejectedValueOnce(new Error('boom réseau'));
    const { embedText } = await import('@/lib/ai/embeddings');
    await expect(embedText('texte')).rejects.toBeInstanceOf(AIProviderError);
  });
});
