import { describe, expect, it } from 'vitest';

import { scoreCandidat } from '@/lib/scoring';
import { buildCriterion, type ScoringSheet } from '@/types/scoring';

describe('scoreCandidat — verificationMethodUsed', () => {
  const sheet: ScoringSheet = {
    campaignId: 'CAMP-1',
    isValidated: true,
    criteria: [
      buildCriterion({
        id: 'c1',
        label: 'React',
        level: 'important',
        verificationMethod: 'keywords_exact',
        keywords: ['React'],
      }),
      buildCriterion({ id: 'c2', label: 'Relationnel', level: 'important' }),
    ],
  };

  it('stampe la méthode du critère (et coalesce le défaut llm_with_quote)', () => {
    const result = scoreCandidat(
      [
        { criterionId: 'c1', llmDecision: 'satisfait', llmJustification: 'ok', llmCVQuote: 'React' },
        { criterionId: 'c2', llmDecision: 'satisfait', llmJustification: 'ok', llmCVQuote: 'x' },
      ],
      sheet,
    );
    const byId = new Map(result.breakdown.map((b) => [b.criterionId, b]));
    expect(byId.get('c1')!.verificationMethodUsed).toBe('keywords_exact');
    // Critère sans verificationMethod → coalescé au défaut.
    expect(byId.get('c2')!.verificationMethodUsed).toBe('llm_with_quote');
  });
});
