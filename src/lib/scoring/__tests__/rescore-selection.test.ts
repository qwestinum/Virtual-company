import { describe, expect, it } from 'vitest';

import {
  criteriaDecidedWithoutReading,
  potentialCeiling,
  rescoreEligibility,
} from '@/lib/scoring/rescore-selection';
import type { CriterionDecision } from '@/types/scoring';

function decision(over: Partial<CriterionDecision>): CriterionDecision {
  return {
    criterionId: 'c1',
    criterionLabel: 'MOA',
    criticityLevel: 'critique',
    weight: 8,
    behavior: 'SOFT_WEIGHTED',
    llmDecision: 'non',
    llmJustification: 'Aucun mot-clé.',
    llmCVQuote: '',
    contribution: 0,
    verificationMethodUsed: 'hybrid_keywords_llm',
    matchedKeywords: [],
    ...over,
  };
}

describe('criteriaDecidedWithoutReading', () => {
  it('repère la signature exacte du veto : non + mots-clés + aucun trouvé', () => {
    expect(criteriaDecidedWithoutReading([decision({})])).toHaveLength(1);
  });

  it('ÉPARGNE les analyses postérieures au correctif (decidedBy = llm)', () => {
    // Le critère d'arrêt de la réparation : une fois le parc rejoué, plus rien.
    expect(
      criteriaDecidedWithoutReading([decision({ decidedBy: 'llm' })]),
    ).toHaveLength(0);
  });

  it('épargne un « non » venu d’un critère purement LLM', () => {
    expect(
      criteriaDecidedWithoutReading([
        decision({ verificationMethodUsed: 'llm_with_quote' }),
      ]),
    ).toHaveLength(0);
  });

  it('épargne un critère où un mot-clé A été trouvé', () => {
    expect(
      criteriaDecidedWithoutReading([
        decision({ llmDecision: 'satisfait', matchedKeywords: ['AMOA'] }),
      ]),
    ).toHaveLength(0);
  });

  it('épargne « non_verifiable » : il n’affirme rien contre le candidat', () => {
    expect(
      criteriaDecidedWithoutReading([decision({ llmDecision: 'non_verifiable' })]),
    ).toHaveLength(0);
  });
});

describe('rescoreEligibility', () => {
  const open = { decidedBy: 'auto', dismissedAt: null, decisionZone: 'proposed_reject' };

  it('rejouable tant que personne n’a tranché et que rien n’est parti', () => {
    expect(rescoreEligibility(open)).toBe('replayable');
    expect(rescoreEligibility({ ...open, decisionZone: 'gray' })).toBe('replayable');
  });

  it('une décision HUMAINE se simule, ne s’écrase pas', () => {
    expect(rescoreEligibility({ ...open, decidedBy: 'user' })).toBe('human_decided');
  });

  it('un classement sans suite prime, même décidé automatiquement', () => {
    expect(
      rescoreEligibility({ ...open, dismissedAt: '2026-08-10T09:00:00Z' }),
    ).toBe('dismissed');
  });

  it('REFUS DÉJÀ PARTI (auto_reject legacy) : simulé, jamais appliqué en silence', () => {
    // Le candidat a reçu un mail. Recalculer son score ne le dé-refuse pas, et
    // le faire remonter sans rien dire donnerait l'illusion que c'est réglé.
    expect(rescoreEligibility({ ...open, decisionZone: 'auto_reject' })).toBe(
      'reject_sent',
    );
  });

  it('la hiérarchie des gardes : sans-suite > humain > refus parti', () => {
    expect(
      rescoreEligibility({
        decidedBy: 'user',
        dismissedAt: '2026-08-10T09:00:00Z',
        decisionZone: 'auto_reject',
      }),
    ).toBe('dismissed');
    expect(
      rescoreEligibility({ decidedBy: 'user', dismissedAt: null, decisionZone: 'auto_reject' }),
    ).toBe('human_decided');
  });
});

describe('potentialCeiling', () => {
  it('ordonne la réparation sans rien conclure', () => {
    const breakdown = [
      decision({ criterionId: 'moa', weight: 8 }),
      decision({ criterionId: 'fin', weight: 6 }),
      decision({
        criterionId: 'ok',
        weight: 6,
        llmDecision: 'satisfait',
        verificationMethodUsed: 'llm_with_quote',
        matchedKeywords: undefined,
      }),
    ];
    // 14 poids éteints sur 20 ⇒ +70 points possibles.
    expect(potentialCeiling(breakdown, 30)).toBe(100);
    expect(potentialCeiling(breakdown, 0)).toBe(70);
  });

  it('rien d’éteint ⇒ plafond = score actuel', () => {
    expect(
      potentialCeiling([decision({ decidedBy: 'llm' })], 42),
    ).toBe(42);
  });
});
