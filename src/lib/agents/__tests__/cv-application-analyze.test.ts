import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chatCompleteJsonMock = vi.fn();

vi.mock('@/lib/ai/provider', () => ({
  chatCompleteJson: (...args: unknown[]) => chatCompleteJsonMock(...args),
  DETERMINISTIC_SEED: 42,
}));

import { AIValidationError } from '@/lib/ai/errors';
import { buildCriterion, type ScoringSheet } from '@/types/scoring';

function sheet(): ScoringSheet {
  return {
    campaignId: 'CAMP-T',
    isValidated: true,
    acceptanceThreshold: 75,
    criteria: [
      buildCriterion({ id: 'ko', label: 'Diplôme requis', level: 'redhibitoire' }),
      buildCriterion({ id: 'cap', label: '5+ ans', level: 'obligatoire' }),
      buildCriterion({ id: 's1', label: 'IFRS', level: 'critique', weight: 8 }),
      buildCriterion({ id: 's2', label: 'Anglais', level: 'important', weight: 4 }),
    ],
  };
}

function rawStub(content: string, tokens = 100, cost = 0.001, dur = 40) {
  return {
    content,
    model: 'gpt-4o-mini',
    usage: { promptTokens: tokens / 2, completionTokens: tokens / 2, totalTokens: tokens },
    costEstimate: cost,
    durationMs: dur,
  };
}

function jsonResult(data: unknown, tokens = 100, cost = 0.001, dur = 40) {
  return { data, raw: rawStub(JSON.stringify(data), tokens, cost, dur), attempts: 1 };
}

const CANDIDATE_OK = {
  fullName: 'Jean Test',
  email: 'jean.test@mail.com',
  phone: '+33 6 00 00 00 00',
  detectedLanguage: 'fr',
  rightToWork: true,
  location: 'Paris',
  photoPresent: false,
};

const VERDICTS_OK = {
  verdicts: [
    { criterionId: 'ko', llmDecision: 'satisfait', llmJustification: 'Diplôme présent.', llmCVQuote: 'Master' },
    { criterionId: 'cap', llmDecision: 'satisfait', llmJustification: '8 ans.', llmCVQuote: '8 ans' },
    { criterionId: 's1', llmDecision: 'satisfait', llmJustification: 'IFRS.', llmCVQuote: 'IFRS' },
    { criterionId: 's2', llmDecision: 'satisfait', llmJustification: 'Anglais.', llmCVQuote: 'Anglais courant' },
  ],
};

const CV_TEXT =
  'Jean Test — Master CCA. 8 ans en comptabilité générale. IFRS, anglais courant. jean.test@mail.com';

const BASE_INPUT = {
  cvText: CV_TEXT,
  fileName: 'cv-jean.pdf',
  source: 'manual' as const,
  receivedAt: '2026-06-06T09:00:00.000Z',
  computedAt: '2026-06-06T09:00:00.000Z',
};

describe('analyzeCVApplication', () => {
  beforeEach(() => {
    chatCompleteJsonMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('chemin nominal : extraction candidat + décisions → scoreCandidat → CVApplication', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK))
      .mockResolvedValueOnce(jsonResult(VERDICTS_OK));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });

    // Le LLM est appelé deux fois (candidat puis décisions).
    expect(chatCompleteJsonMock).toHaveBeenCalledTimes(2);
    // Candidat : factuel annexe + métadonnées système ajoutées par le code.
    expect(out.application.candidate.fullName).toBe('Jean Test');
    expect(out.application.candidate.fileName).toBe('cv-jean.pdf');
    expect(out.application.candidate.source).toBe('manual');
    expect(out.application.candidate.receivedAt).toBe('2026-06-06T09:00:00.000Z');
    // Score calculé par le CODE : tous satisfaits → 100, accepted.
    expect(out.application.scoringResult.totalScore).toBe(100);
    expect(out.application.scoringResult.status).toBe('accepted');
    expect(out.application.scoringResult.hardFailures).toEqual([]);
    expect(out.llmFailures).toEqual({ candidate: false, verdicts: false });
  });

  it('email résolu de façon déterministe depuis le CV (corrige un email LLM erroné)', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult({ ...CANDIDATE_OK, email: 'faux@halluciné.com' }))
      .mockResolvedValueOnce(jsonResult(VERDICTS_OK));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });
    // L'email retenu est celui réellement présent dans le CV, pas celui du LLM.
    expect(out.application.candidate.email).toBe('jean.test@mail.com');
  });

  it('échec extraction décisions (AIValidationError) → fallback non_verifiable + llmFailure → rejected', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK))
      .mockRejectedValueOnce(new AIValidationError('invalide', 3, null));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });

    expect(out.llmFailures.verdicts).toBe(true);
    // Tous les critères non vérifiables → knockout (ko) + cap → score 0, rejected.
    expect(out.application.scoringResult.totalScore).toBe(0);
    expect(out.application.scoringResult.status).toBe('rejected');
    const hf = out.application.scoringResult.hardFailures;
    expect(hf.map((h) => h.criterionId).sort()).toEqual(['cap', 'ko']);
    expect(hf.every((h) => h.reason === 'unverifiable')).toBe(true);
    // Le breakdown reflète le fallback.
    expect(
      out.application.scoringResult.breakdown.every((b) => b.llmDecision === 'non_verifiable'),
    ).toBe(true);
  });

  it('échec extraction candidat (AIValidationError) → candidat dégradé, email tout de même résolu du CV', async () => {
    chatCompleteJsonMock
      .mockRejectedValueOnce(new AIValidationError('invalide', 3, null))
      .mockResolvedValueOnce(jsonResult(VERDICTS_OK));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });

    expect(out.llmFailures.candidate).toBe(true);
    // Email résolu déterministe depuis le texte du CV même sans extraction LLM.
    expect(out.application.candidate.email).toBe('jean.test@mail.com');
    expect(out.application.candidate.fileName).toBe('cv-jean.pdf');
    // Les décisions ont, elles, réussi → score nominal.
    expect(out.application.scoringResult.status).toBe('accepted');
  });

  it('agrège les métriques des deux appels LLM', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK, 120, 0.002, 30))
      .mockResolvedValueOnce(jsonResult(VERDICTS_OK, 200, 0.003, 50));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });
    expect(out.metrics.tokensUsed).toBe(320);
    expect(out.metrics.costEstimate).toBeCloseTo(0.005, 6);
    expect(out.metrics.durationMs).toBe(80);
  });

  it('passe les schémas Zod à chatCompleteJson (sortie validée avant scoring)', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK))
      .mockResolvedValueOnce(jsonResult(VERDICTS_OK));
    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });
    // 2e argument de chaque appel = un schéma Zod (présence d'un safeParse).
    for (const call of chatCompleteJsonMock.mock.calls) {
      expect(typeof call[1]?.safeParse).toBe('function');
    }
  });
});

describe('cv-extraction-prompts', () => {
  it('le prompt candidat interdit explicitement la notation et liste le schéma factuel', async () => {
    const { buildCandidateExtractionSystemPrompt } = await import(
      '@/lib/agents/cv-extraction-prompts'
    );
    const p = buildCandidateExtractionSystemPrompt();
    expect(p).toMatch(/ne juges pas|tu ne notes pas/i);
    expect(p).toContain('fullName');
    expect(p).toContain('photoPresent');
    // L'extraction candidat interdit explicitement la production d'un score.
    expect(p).toMatch(/aucun score/i);
  });

  it('le prompt verdicts liste chaque criterionId et interdit le calcul de note', async () => {
    const { buildVerdictsSystemPrompt, buildVerdictsUserPrompt } = await import(
      '@/lib/agents/cv-extraction-prompts'
    );
    const sys = buildVerdictsSystemPrompt();
    expect(sys).toMatch(/sans calculer aucune note|le score est calculé ensuite/i);
    expect(sys).toContain('non_verifiable');

    const user = buildVerdictsUserPrompt('CV brut ici', sheet());
    for (const id of ['ko', 'cap', 's1', 's2']) {
      expect(user).toContain(`id="${id}"`);
    }
  });
});
