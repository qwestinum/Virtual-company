import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chatCompleteJsonMock = vi.fn();

vi.mock('@/lib/ai/provider', () => ({
  chatCompleteJson: (...args: unknown[]) => chatCompleteJsonMock(...args),
  DETERMINISTIC_SEED: 42,
}));

import { buildCriterion, type ScoringSheet } from '@/types/scoring';

function rawStub(content: string) {
  return {
    content,
    model: 'gpt-4o-mini',
    usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    costEstimate: 0.001,
    durationMs: 40,
  };
}
function jsonResult(data: unknown) {
  return { data, raw: rawStub(JSON.stringify(data)), attempts: 1 };
}

const CANDIDATE_OK = {
  fullName: 'Jean Test',
  email: 'jean@mail.com',
  phone: null,
  detectedLanguage: 'fr',
  rightToWork: true,
  location: 'Paris',
  photoPresent: false,
};
const LEDGER_OK = { yearsExperience: 5, tools: [], methodologies: [], skills: [], domains: [] };
const NARRATION_OK = {
  summary: 'Profil aligné.',
  strengths: [],
  weaknesses: [],
  justification: 'Au-dessus du seuil.',
};

const CV_TEXT = 'Jean Test — Master. React et Node, anglais courant. jean@mail.com';
const BASE_INPUT = {
  cvText: CV_TEXT,
  fileName: 'cv.pdf',
  source: 'manual' as const,
  receivedAt: '2026-06-06T09:00:00.000Z',
  computedAt: '2026-06-06T09:00:00.000Z',
};

describe('analyzeCVApplication — dispatcher hybride', () => {
  beforeEach(() => chatCompleteJsonMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('grille mixte : critère déterministe vérifié en local, LLM pour le reste', async () => {
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-T',
      isValidated: true,
      acceptanceThreshold: 75,
      criteria: [
        buildCriterion({
          id: 'tech',
          label: 'React',
          level: 'important',
          verificationMethod: 'keywords_exact',
          keywords: ['React'],
        }),
        buildCriterion({ id: 'lang', label: 'Anglais', level: 'important' }),
      ],
    };
    // Le prompt verdicts ne porte QUE le sous-ensemble LLM ([lang]) → 1 verdict.
    const VERDICTS = {
      verdicts: [
        { criterionId: '1', llmDecision: 'satisfait', llmJustification: 'Anglais courant.', llmCVQuote: 'anglais courant' },
      ],
    };
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK))
      .mockResolvedValueOnce(jsonResult(LEDGER_OK))
      .mockResolvedValueOnce(jsonResult(VERDICTS))
      .mockResolvedValueOnce(jsonResult(NARRATION_OK));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet });

    expect(chatCompleteJsonMock).toHaveBeenCalledTimes(4);
    const byId = new Map(out.application.scoringResult.breakdown.map((b) => [b.criterionId, b]));
    // Critère déterministe : satisfait via mots-clés, méthode tracée, citation du CV.
    expect(byId.get('tech')!.llmDecision).toBe('satisfait');
    expect(byId.get('tech')!.verificationMethodUsed).toBe('keywords_exact');
    expect(byId.get('tech')!.llmCVQuote).toMatch(/React/);
    // Critère LLM : verdict mocké, méthode llm_with_quote.
    expect(byId.get('lang')!.verificationMethodUsed).toBe('llm_with_quote');
  });

  it('grille tout-déterministe : AUCUN appel verdicts/ledger LLM', async () => {
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-T',
      isValidated: true,
      criteria: [
        buildCriterion({ id: 'a', label: 'React', level: 'important', verificationMethod: 'keywords_exact', keywords: ['React'] }),
        buildCriterion({ id: 'b', label: 'Kubernetes', level: 'important', verificationMethod: 'keywords_with_variants', keywords: ['Kubernetes', 'k8s'] }),
      ],
    };
    // Plus de ledger ni de verdicts LLM : seuls candidat + narration sont appelés.
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK))
      .mockResolvedValueOnce(jsonResult(NARRATION_OK));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet });

    expect(chatCompleteJsonMock).toHaveBeenCalledTimes(2);
    const byId = new Map(out.application.scoringResult.breakdown.map((b) => [b.criterionId, b]));
    expect(byId.get('a')!.llmDecision).toBe('satisfait'); // React présent
    expect(byId.get('b')!.llmDecision).toBe('non'); // ni Kubernetes ni k8s
    expect(byId.get('a')!.verificationMethodUsed).toBe('keywords_exact');
    expect(byId.get('a')!.matchedKeywords).toEqual(['React']);
    expect(byId.get('b')!.matchedKeywords).toEqual([]); // cherché, rien trouvé
    expect(out.llmFailures.verdicts).toBe(false);
  });
});

describe('analyzeCVApplication — méthode hybride (Phase 3a)', () => {
  beforeEach(() => chatCompleteJsonMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('hybride SANS mot-clé gardien → « non » LOCAL, aucun appel verdicts/ledger', async () => {
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-T',
      isValidated: true,
      criteria: [
        buildCriterion({
          id: 'h',
          label: 'Management',
          level: 'important',
          verificationMethod: 'hybrid_keywords_llm',
          keywords: ['Kubernetes'], // absent du CV
        }),
      ],
    };
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK))
      .mockResolvedValueOnce(jsonResult(NARRATION_OK));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet });

    expect(chatCompleteJsonMock).toHaveBeenCalledTimes(2); // candidat + narration
    const h = out.application.scoringResult.breakdown.find((b) => b.criterionId === 'h')!;
    expect(h.llmDecision).toBe('non');
    expect(h.verificationMethodUsed).toBe('hybrid_keywords_llm');
    expect(h.matchedKeywords).toEqual([]); // cherché mais rien trouvé
  });

  it('hybride AVEC match → batch LLM + mention « nécessaires mais pas suffisants »', async () => {
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-T',
      isValidated: true,
      criteria: [
        buildCriterion({
          id: 'h',
          label: 'Expérience React',
          level: 'important',
          verificationMethod: 'hybrid_keywords_llm',
          keywords: ['React'], // présent dans le CV
        }),
      ],
    };
    const VERDICTS = {
      verdicts: [
        { criterionId: '1', llmDecision: 'satisfait', llmJustification: 'Sujet de l’action.', llmCVQuote: 'React' },
      ],
    };
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK))
      .mockResolvedValueOnce(jsonResult(LEDGER_OK))
      .mockResolvedValueOnce(jsonResult(VERDICTS))
      .mockResolvedValueOnce(jsonResult(NARRATION_OK));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet });

    expect(chatCompleteJsonMock).toHaveBeenCalledTimes(4);
    // 3e appel = verdicts ; le user prompt porte la mention hybride contextuelle.
    const verdictsUserPrompt = chatCompleteJsonMock.mock.calls[2][0][1].content as string;
    expect(verdictsUserPrompt).toMatch(/nécessaires mais pas suffisants/i);
    expect(verdictsUserPrompt).toMatch(/React/);
    const h = out.application.scoringResult.breakdown.find((b) => b.criterionId === 'h')!;
    expect(h.matchedKeywords).toEqual(['React']);
    expect(h.verificationMethodUsed).toBe('hybrid_keywords_llm');
  });

  it('grille mixte : LLM pur + hybride match + hybride no-match → 1 seul batch sur 2 critères', async () => {
    const sheet: ScoringSheet = {
      campaignId: 'CAMP-T',
      isValidated: true,
      criteria: [
        buildCriterion({ id: 'lang', label: 'Anglais', level: 'important' }),
        buildCriterion({ id: 'hm', label: 'React', level: 'important', verificationMethod: 'hybrid_keywords_llm', keywords: ['React'] }),
        buildCriterion({ id: 'hn', label: 'Cloud', level: 'important', verificationMethod: 'hybrid_keywords_llm', keywords: ['Kubernetes'] }),
      ],
    };
    const VERDICTS = {
      verdicts: [
        { criterionId: '1', llmDecision: 'satisfait', llmJustification: 'ok', llmCVQuote: 'anglais courant' },
        { criterionId: '2', llmDecision: 'satisfait', llmJustification: 'ok', llmCVQuote: 'React' },
      ],
    };
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK))
      .mockResolvedValueOnce(jsonResult(LEDGER_OK))
      .mockResolvedValueOnce(jsonResult(VERDICTS))
      .mockResolvedValueOnce(jsonResult(NARRATION_OK));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet });

    expect(chatCompleteJsonMock).toHaveBeenCalledTimes(4); // 1 seul batch verdicts
    const byId = new Map(out.application.scoringResult.breakdown.map((b) => [b.criterionId, b]));
    expect(byId.get('hn')!.llmDecision).toBe('non'); // hybride sans match, local
    expect(byId.get('hn')!.matchedKeywords).toEqual([]);
    expect(byId.get('hm')!.matchedKeywords).toEqual(['React']); // hybride avec match
    expect(byId.get('lang')!.verificationMethodUsed).toBe('llm_with_quote');
  });
});
