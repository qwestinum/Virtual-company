import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chatCompleteJsonMock = vi.fn();

vi.mock('@/lib/ai/provider', () => ({
  chatCompleteJson: (...args: unknown[]) => chatCompleteJsonMock(...args),
  DETERMINISTIC_SEED: 42,
}));

import { AIValidationError } from '@/lib/ai/errors';
import { remapVerdictsToCriteria } from '@/lib/agents/server/cv-application-analyze';
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

const LEDGER_OK = {
  yearsExperience: 8,
  tools: ['Excel'],
  methodologies: ['IFRS'],
  skills: ['comptabilité générale'],
  domains: ['finance'],
};

// Le LLM renvoie le NUMÉRO du critère (1..N), remappé vers le vrai id par
// remapVerdictsToCriteria. Ordre de sheet() : 1=ko, 2=cap, 3=s1, 4=s2.
const VERDICTS_OK = {
  verdicts: [
    { criterionId: '1', llmDecision: 'satisfait', llmJustification: 'Diplôme présent.', llmCVQuote: 'Master' },
    { criterionId: '2', llmDecision: 'satisfait', llmJustification: '8 ans.', llmCVQuote: '8 ans' },
    { criterionId: '3', llmDecision: 'satisfait', llmJustification: 'IFRS.', llmCVQuote: 'IFRS' },
    { criterionId: '4', llmDecision: 'satisfait', llmJustification: 'Anglais.', llmCVQuote: 'Anglais courant' },
  ],
};

const NARRATION_OK = {
  summary: 'Profil solide, globalement aligné sur les critères de la campagne.',
  strengths: ['Maîtrise IFRS', 'Anglais courant'],
  weaknesses: [],
  justification: "Au-dessus du seuil d'acceptation sans échec rédhibitoire.",
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

  it('chemin nominal : extraction candidat + relevé + décisions → scoreCandidat → CVApplication', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK))
      .mockResolvedValueOnce(jsonResult(LEDGER_OK))
      .mockResolvedValueOnce(jsonResult(VERDICTS_OK))
      .mockResolvedValueOnce(jsonResult(NARRATION_OK));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });

    // Le LLM est appelé quatre fois (candidat, relevé, décisions, narration).
    expect(chatCompleteJsonMock).toHaveBeenCalledTimes(4);
    // Candidat : factuel annexe + métadonnées système ajoutées par le code.
    expect(out.application.candidate.fullName).toBe('Jean Test');
    expect(out.application.candidate.fileName).toBe('cv-jean.pdf');
    expect(out.application.candidate.source).toBe('manual');
    expect(out.application.candidate.receivedAt).toBe('2026-06-06T09:00:00.000Z');
    // Score calculé par le CODE : tous satisfaits → 100, accepted.
    expect(out.application.scoringResult.totalScore).toBe(100);
    expect(out.application.scoringResult.status).toBe('accepted');
    expect(out.application.scoringResult.hardFailures).toEqual([]);
    // Narration présente.
    expect(out.application.narration.summary).toMatch(/profil solide/i);
    expect(out.llmFailures).toEqual({
      candidate: false,
      ledger: false,
      verdicts: false,
      narration: false,
    });
  });

  it('email résolu de façon déterministe depuis le CV (corrige un email LLM erroné)', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult({ ...CANDIDATE_OK, email: 'faux@halluciné.com' }))
      .mockResolvedValueOnce(jsonResult(LEDGER_OK))
      .mockResolvedValueOnce(jsonResult(VERDICTS_OK))
      .mockResolvedValueOnce(jsonResult(NARRATION_OK));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });
    // L'email retenu est celui réellement présent dans le CV, pas celui du LLM.
    expect(out.application.candidate.email).toBe('jean.test@mail.com');
  });

  it('échec extraction décisions (AIValidationError) → fallback non_verifiable + llmFailure → rejected', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK))
      .mockResolvedValueOnce(jsonResult(LEDGER_OK))
      .mockRejectedValueOnce(new AIValidationError('invalide', 3, null))
      .mockResolvedValueOnce(jsonResult(NARRATION_OK));

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
      .mockResolvedValueOnce(jsonResult(LEDGER_OK))
      .mockResolvedValueOnce(jsonResult(VERDICTS_OK))
      .mockResolvedValueOnce(jsonResult(NARRATION_OK));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });

    expect(out.llmFailures.candidate).toBe(true);
    // Email résolu déterministe depuis le texte du CV même sans extraction LLM.
    expect(out.application.candidate.email).toBe('jean.test@mail.com');
    expect(out.application.candidate.fileName).toBe('cv-jean.pdf');
    // Les décisions ont, elles, réussi → score nominal.
    expect(out.application.scoringResult.status).toBe('accepted');
  });

  it('échec extraction relevé (ledger) → fallback relevé vide, verdicts et score inchangés', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK))
      .mockRejectedValueOnce(new AIValidationError('invalide', 3, null))
      .mockResolvedValueOnce(jsonResult(VERDICTS_OK))
      .mockResolvedValueOnce(jsonResult(NARRATION_OK));
    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });
    // Le relevé a échoué mais les verdicts tournent quand même (texte du CV seul).
    expect(out.llmFailures.ledger).toBe(true);
    expect(out.llmFailures.verdicts).toBe(false);
    expect(out.application.scoringResult.status).toBe('accepted');
  });

  it('document non reconnu comme un CV (isCv:false) → candidat anonyme, email null, rejeté, court-circuit (1 seul appel LLM)', async () => {
    chatCompleteJsonMock.mockResolvedValueOnce(
      jsonResult({ ...CANDIDATE_OK, isCv: false, fullName: 'Candidat anonyme', email: null }),
    );

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });

    // Verdicts + narration court-circuités → un seul appel LLM (extraction candidat).
    expect(chatCompleteJsonMock).toHaveBeenCalledTimes(1);
    expect(out.application.candidate.fullName).toBe('Candidat anonyme');
    // Email FORCÉ à null — on ne grappille aucune adresse (ex. celle du recruteur).
    expect(out.application.candidate.email).toBeNull();
    expect(out.application.scoringResult.status).toBe('rejected');
    expect(out.application.narration.summary).toMatch(/non reconnu comme un CV/i);
    expect(
      out.application.scoringResult.breakdown.every((b) => b.llmDecision === 'non_verifiable'),
    ).toBe(true);
  });

  it('agrège les métriques des quatre appels LLM', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK, 120, 0.002, 30))
      .mockResolvedValueOnce(jsonResult(LEDGER_OK, 100, 0.001, 25))
      .mockResolvedValueOnce(jsonResult(VERDICTS_OK, 200, 0.003, 50))
      .mockResolvedValueOnce(jsonResult(NARRATION_OK, 80, 0.001, 20));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });
    expect(out.metrics.tokensUsed).toBe(500);
    expect(out.metrics.costEstimate).toBeCloseTo(0.007, 6);
    expect(out.metrics.durationMs).toBe(125);
  });

  it('passe les schémas Zod à chatCompleteJson (sortie validée avant scoring)', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK))
      .mockResolvedValueOnce(jsonResult(LEDGER_OK))
      .mockResolvedValueOnce(jsonResult(VERDICTS_OK))
      .mockResolvedValueOnce(jsonResult(NARRATION_OK));
    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });
    // 2e argument de chaque appel = un schéma Zod (présence d'un safeParse).
    for (const call of chatCompleteJsonMock.mock.calls) {
      expect(typeof call[1]?.safeParse).toBe('function');
    }
  });

  it('la narration n’altère JAMAIS le score (invariant C5)', async () => {
    // La narration "prétend" un autre score dans sa prose : sans effet.
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK))
      .mockResolvedValueOnce(jsonResult(LEDGER_OK))
      .mockResolvedValueOnce(jsonResult(VERDICTS_OK))
      .mockResolvedValueOnce(
        jsonResult({
          summary: 'Score de 12/100 selon ma propre estimation.',
          strengths: [],
          weaknesses: ['rien'],
          justification: 'À mon avis ce candidat vaut 12.',
        }),
      );
    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });
    // Le score reste celui calculé par scoreCandidat (tous satisfaits → 100).
    expect(out.application.scoringResult.totalScore).toBe(100);
    expect(out.application.scoringResult.status).toBe('accepted');
    expect(out.llmFailures.narration).toBe(false);
  });

  it('échec narration (AIValidationError) → fallback déterministe dérivé du ScoreResult', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE_OK))
      .mockResolvedValueOnce(jsonResult(LEDGER_OK))
      .mockResolvedValueOnce(jsonResult(VERDICTS_OK))
      .mockRejectedValueOnce(new AIValidationError('invalide', 3, null));
    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({ ...BASE_INPUT, sheet: sheet() });

    expect(out.llmFailures.narration).toBe(true);
    // Le score n'est pas affecté par l'échec de narration.
    expect(out.application.scoringResult.totalScore).toBe(100);
    // La narration de secours reflète le score (dérivée du ScoreResult).
    expect(out.application.narration.summary).toMatch(/100\/100/);
    expect(out.application.narration.summary).toMatch(/retenu/i);
  });
});

describe('buildFallbackNarration — narration déterministe depuis le ScoreResult', () => {
  it('forces = SOFT démontrés, attentions = échecs durs + SOFT manqués', async () => {
    const { buildFallbackNarration } = await import('@/lib/agents/cv-narration');
    const score = {
      totalScore: 0,
      status: 'rejected' as const,
      criteriaVersion: 'v1',
      computedAt: '2026-06-06T00:00:00.000Z',
      hardFailures: [
        { criterionId: 'ko', criterionLabel: 'Diplôme requis', criticityLevel: 'redhibitoire' as const, reason: 'unsatisfied' as const },
      ],
      breakdown: [
        { criterionId: 'ko', criterionLabel: 'Diplôme requis', criticityLevel: 'redhibitoire' as const, weight: 0, behavior: 'HARD_KNOCKOUT' as const, llmDecision: 'non' as const, llmJustification: 'absent', llmCVQuote: '', contribution: 0 },
        { criterionId: 's1', criterionLabel: 'IFRS', criticityLevel: 'critique' as const, weight: 8, behavior: 'SOFT_WEIGHTED' as const, llmDecision: 'satisfait' as const, llmJustification: 'ok', llmCVQuote: 'IFRS', contribution: 40 },
        { criterionId: 's2', criterionLabel: 'SAP', criticityLevel: 'important' as const, weight: 4, behavior: 'SOFT_WEIGHTED' as const, llmDecision: 'non' as const, llmJustification: 'absent', llmCVQuote: '', contribution: 0 },
      ],
    };
    const n = buildFallbackNarration(score);
    expect(n.strengths).toContain('IFRS');
    expect(n.weaknesses).toContain('Diplôme requis (non satisfait)');
    expect(n.weaknesses).toContain('SAP');
    expect(n.summary).toMatch(/écarté/i);
    expect(n.justification).toMatch(/durs?/i);
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

  it('le prompt verdicts NUMÉROTE les critères (pas d’UUID à recopier) et interdit le calcul de note', async () => {
    const { buildVerdictsSystemPrompt, buildVerdictsUserPrompt } = await import(
      '@/lib/agents/cv-extraction-prompts'
    );
    const sys = buildVerdictsSystemPrompt();
    expect(sys).toMatch(/sans calculer aucune note|le score est calculé ensuite/i);
    expect(sys).toContain('non_verifiable');
    expect(sys).toMatch(/NUMÉRO/);
    // Garde-fous anti-hallucination : ancrage verbatim, pas d'invention de
    // domaine, pas de recalcul des années.
    expect(sys).toMatch(/ancrage|VERBATIM/i);
    expect(sys).toMatch(/domaine X.*domaine Y|n'attribue jamais/i);
    expect(sys).toMatch(/recalcule pas/i);
    // Le garde-fou couvre aussi « partiel » (pas d'analogie cross-domaine).
    expect(sys).toMatch(/partiel.*analogie|crédit partiel|analogie/i);
    // B — « non » réservé à une preuve d'absence ; manque de preuve = non_verifiable.
    expect(sys).toMatch(/affirme POSITIVEMENT|preuve d'ABSENCE/i);
    expect(sys).toMatch(/JAMAIS .?non/i);
    // A — ancrage sur le relevé de faits canonique partagé.
    expect(sys).toMatch(/RELEVÉ DE FAITS|source canonique/i);
    // #4 — ancrage sur l'objet/interlocuteur exact (clients ≠ équipes de dev).
    expect(sys).toMatch(/OBJET EXACT|interlocuteur/i);
    expect(sys).toMatch(/CLIENTS/);
    // #2 — couverture des critères multi-éléments + interdiction du substitut.
    expect(sys).toMatch(/COUVERTURE/i);
    expect(sys).toMatch(/substitut/i);
    expect(sys).toMatch(/Xray.*TestRail|TestRail.*Xray/i);

    const user = buildVerdictsUserPrompt('CV brut ici', sheet(), LEDGER_OK);
    // Critères présentés numérotés 1..N (le LLM reporte le numéro, pas l'UUID).
    expect(user).toContain('1. ');
    expect(user).toContain('4. ');
    expect(user).toContain('Diplôme requis');
    expect(user).not.toContain('id="'); // plus de round-trip d'id fragile
    // Le relevé de faits est injecté dans le prompt verdicts.
    expect(user).toMatch(/RELEVÉ DE FAITS/);
    expect(user).toContain('Excel'); // un outil du relevé
  });

  it('le prompt « ledger » liste des faits sans juger ni noter', async () => {
    const { buildLedgerSystemPrompt, buildLedgerUserPrompt } = await import(
      '@/lib/agents/cv-extraction-prompts'
    );
    const sys = buildLedgerSystemPrompt();
    expect(sys).toMatch(/ne juges pas|aucun jugement|aucune note/i);
    expect(sys).toContain('tools');
    expect(sys).toContain('yearsExperience');
    expect(sys).toMatch(/n'?INVENTE/i);
    // Pas de recalcul des années (cohérent avec le prompt verdicts).
    expect(sys).toMatch(/RECALCULE/i);
    const user = buildLedgerUserPrompt('CV brut ici', 'cv.pdf');
    expect(user).toContain('cv.pdf');
    expect(user).toContain('CV brut ici');
  });
});

describe('remapVerdictsToCriteria', () => {
  const V = (criterionId: string, llmDecision = 'satisfait') => ({
    criterionId,
    llmDecision: llmDecision as 'satisfait',
    llmJustification: 'x',
    llmCVQuote: '',
  });

  it('remappe les NUMÉROS (1..N) vers les vrais ids de la fiche', () => {
    const out = remapVerdictsToCriteria([V('1'), V('3', 'non')], sheet().criteria);
    expect(out.map((v) => v.criterionId)).toEqual(['ko', 's1']);
    expect(out[1].llmDecision).toBe('non');
  });

  it('accepte aussi le vrai id si le modèle l’a renvoyé', () => {
    const out = remapVerdictsToCriteria([V('s1')], sheet().criteria);
    expect(out[0].criterionId).toBe('s1');
  });

  it('ignore les ids non mappables (UUID mal recopié, numéro hors plage)', () => {
    const out = remapVerdictsToCriteria(
      [V('crit_bogus-uuid'), V('99'), V('0')],
      sheet().criteria,
    );
    expect(out).toHaveLength(0);
  });
});
