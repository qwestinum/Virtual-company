import { describe, expect, it } from 'vitest';

import { formatCriterionMethod } from '@/lib/reporting/audit-display';
import {
  criterionMethodCounts,
  decisionMethod,
  filterByMethod,
} from '@/lib/reporting/criterion-method-filter';
import type { CriterionDecision, VerificationMethod } from '@/types/scoring';

function dec(p: Partial<CriterionDecision>): CriterionDecision {
  return {
    criterionId: 'c1',
    criterionLabel: 'Critère',
    criticityLevel: 'important',
    weight: 5,
    behavior: 'SOFT_WEIGHTED',
    llmDecision: 'satisfait',
    llmJustification: 'ok',
    llmCVQuote: '',
    contribution: 0,
    ...p,
  };
}

describe('formatCriterionMethod', () => {
  it('llm_with_quote (et défaut undefined) → « Vérification LLM », sans mots-clés', () => {
    expect(formatCriterionMethod(dec({}))).toEqual({
      label: 'Vérification LLM',
      foundKeywords: [],
    });
    expect(
      formatCriterionMethod(dec({ verificationMethodUsed: 'llm_with_quote' })).label,
    ).toBe('Vérification LLM');
  });

  it('keywords_exact / variants → « Mots-clés détectés » + liste', () => {
    expect(
      formatCriterionMethod(
        dec({ verificationMethodUsed: 'keywords_exact', matchedKeywords: ['React', 'Redux'] }),
      ),
    ).toEqual({ label: 'Mots-clés détectés', foundKeywords: ['React', 'Redux'] });
  });

  it('hybride AVEC match → « Mots-clés + Vérification LLM » + liste', () => {
    expect(
      formatCriterionMethod(
        dec({ verificationMethodUsed: 'hybrid_keywords_llm', matchedKeywords: ['management'] }),
      ),
    ).toEqual({ label: 'Mots-clés + Vérification LLM', foundKeywords: ['management'] });
  });

  it('hybride SANS match ([]) → « Aucun mot-clé trouvé »', () => {
    expect(
      formatCriterionMethod(
        dec({ verificationMethodUsed: 'hybrid_keywords_llm', matchedKeywords: [] }),
      ),
    ).toEqual({ label: 'Aucun mot-clé trouvé', foundKeywords: [] });
  });
});

describe('criterion-method-filter', () => {
  const breakdown = [
    dec({ criterionId: 'a', verificationMethodUsed: 'keywords_exact' }),
    dec({ criterionId: 'b', verificationMethodUsed: 'llm_with_quote' }),
    dec({ criterionId: 'c' }), // undefined → llm_with_quote
    dec({ criterionId: 'd', verificationMethodUsed: 'hybrid_keywords_llm' }),
  ];

  it('decisionMethod coalesce le défaut', () => {
    expect(decisionMethod(dec({}))).toBe('llm_with_quote');
  });

  it('criterionMethodCounts compte par méthode présente (ordre canonique)', () => {
    expect(criterionMethodCounts(breakdown)).toEqual([
      { method: 'keywords_exact', count: 1 },
      { method: 'llm_with_quote', count: 2 },
      { method: 'hybrid_keywords_llm', count: 1 },
    ]);
  });

  it('filterByMethod : null = toutes, sinon seulement la méthode', () => {
    expect(filterByMethod(breakdown, null)).toHaveLength(4);
    const llm = filterByMethod(breakdown, 'llm_with_quote' as VerificationMethod);
    expect(llm.map((d) => d.criterionId)).toEqual(['b', 'c']);
  });
});
