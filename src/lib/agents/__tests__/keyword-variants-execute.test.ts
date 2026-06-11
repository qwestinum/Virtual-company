import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chatCompleteJsonMock = vi.fn();
vi.mock('@/lib/ai/provider', () => ({
  chatCompleteJson: (...args: unknown[]) => chatCompleteJsonMock(...args),
  DETERMINISTIC_SEED: 42,
}));

import {
  KeywordVariantsRequestSchema,
  runKeywordVariantsSuggestion,
} from '@/lib/agents/server/keyword-variants-execute';

function jsonResult(data: unknown) {
  return { data, raw: { content: JSON.stringify(data) }, attempts: 1 };
}

describe('KeywordVariantsRequestSchema', () => {
  it('rejette un payload invalide (label vide / méthode inconnue)', () => {
    expect(KeywordVariantsRequestSchema.safeParse({ criterionLabel: '' }).success).toBe(false);
    expect(
      KeywordVariantsRequestSchema.safeParse({
        criterionLabel: 'X',
        targetMethod: 'bogus',
      }).success,
    ).toBe(false);
  });
  it('accepte un payload valide, existingKeywords défaut []', () => {
    const r = KeywordVariantsRequestSchema.parse({
      criterionLabel: 'Python',
      targetMethod: 'keywords_with_variants',
    });
    expect(r.existingKeywords).toEqual([]);
  });
});

describe('runKeywordVariantsSuggestion', () => {
  beforeEach(() => chatCompleteJsonMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('renvoie les variantes LLM dédupliquées vs existingKeywords', async () => {
    chatCompleteJsonMock.mockResolvedValueOnce(
      jsonResult({ variants: ['Python', 'Django', 'django', 'Flask'] }),
    );
    const out = await runKeywordVariantsSuggestion({
      criterionLabel: 'Maîtrise de Python',
      existingKeywords: ['Python'],
      targetMethod: 'keywords_with_variants',
    });
    // 'Python' (déjà fourni) et 'django' (doublon) retirés.
    expect(out.suggestedVariants).toEqual(['Django', 'Flask']);
    expect(chatCompleteJsonMock).toHaveBeenCalledTimes(1);
  });
});
