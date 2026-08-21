/**
 * NON-RÉGRESSION — le veto du pré-filtre (incident CAMP-2026-288, 21/08/2026).
 *
 * Un consultant SI de quatre ans d'expérience, AMOA et Trade Finance, a obtenu
 * **0/100, tous critères à « non »**, et a été proposé au refus. Ni l'extraction
 * (3 197 caractères parfaitement lisibles) ni le prompt n'étaient en cause : le
 * modèle n'a JAMAIS été appelé. Quatre listes de mots-clés ne trouvaient pas
 * leurs chaînes exactes, et le pré-filtre en concluait « non ».
 *
 * Le piège est le VOCABULAIRE, et c'est pour ça qu'il est vicieux : le CV dit
 * « Consultant SI & AMOA » quand la fiche cherche « Consultant MOA » ; il dit
 * « Trade Finance — Société Générale » quand elle cherche « secteur financier ».
 * Aucun humain ne raterait ça. Aucun modèle non plus — il n'était pas consulté.
 *
 * ⚠️ Le CV ci-dessous est SYNTHÉTIQUE. Le document d'origine porte le nom,
 * l'email et le téléphone d'une personne réelle : le verser dans un dépôt de
 * code en ferait une conservation sans base légale ni durée. Seule la STRUCTURE
 * du piège est reproduite, avec les listes de mots-clés RÉELLES de la fiche —
 * elles ne sont pas des données personnelles, et ce sont elles qui échouaient.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chatCompleteJsonMock = vi.fn();

vi.mock('@/lib/ai/provider', () => ({
  chatCompleteJson: (...args: unknown[]) => chatCompleteJsonMock(...args),
  DETERMINISTIC_SEED: 42,
}));

import { buildCriterion, type ScoringSheet } from '@/types/scoring';

/** Même forme que le CV réel : riche, explicite, et pourtant « hors vocabulaire ». */
const CV_TEXT = [
  'CONSULTANT SI & AMOA | PRODUCT MANAGER DIGITAL (4 ANS D’EXPÉRIENCE)',
  'Consultant SI et Product Manager certifié, pilotage de projets digitaux',
  'complexes (Transport & Logistique, Banque & Finance / Trade Finance).',
  'Gestion de Projet & AMOA : cadrage fonctionnel, recueil des besoins,',
  'cahier des charges, user stories, recettes métiers (UAT), analyse d’impact.',
  'Outils : Agile (Scrum / Kanban), JIRA, Confluence, Figma.',
  'Product Manager SI Trade Finance — grande banque française, 2022-2025 :',
  'pilotage de l’adoption des plateformes digitales auprès de 50+ multinationales,',
  'conformité et risques bancaires (KYC, Sanctions/Embargos OFAC, UE, ONU).',
].join('\n');

/** Les listes de mots-clés RÉELLES de la fiche CAMP-2026-288. */
const SHEET: ScoringSheet = {
  campaignId: 'CAMP-T-288',
  isValidated: true,
  criteria: [
    buildCriterion({
      id: 'moa',
      label: 'MOA',
      level: 'critique',
      verificationMethod: 'hybrid_keywords_llm',
      keywords: ['MOA digitale', 'MOA fonctionnelle', 'Responsable MOA', 'Consultant MOA', 'Pilotage MOA', 'Gestion MOA', 'Expert MOA', 'business analyst'],
    }),
    buildCriterion({
      id: 'finance',
      label: 'Expertise dans le secteur financier',
      level: 'tres_important',
      verificationMethod: 'keywords_with_variants',
      keywords: ['secteur financier', 'épargne salariale', 'retraite', 'asset servicing', 'industrie financière', 'gestion de patrimoine', 'conseil financier', 'planification financière'],
    }),
    buildCriterion({
      id: 'ux',
      label: 'Maîtrise des parcours digitaux et UX',
      level: 'important',
      verificationMethod: 'keywords_with_variants',
      keywords: ['parcours digitaux', 'UX', 'portails web', 'espaces clients'],
    }),
    buildCriterion({
      id: 'genai',
      label: 'Connaissance des outils GenAI appliqués',
      level: 'souhaitable',
      verificationMethod: 'keywords_with_variants',
      keywords: ['GenAI', 'génération de cas de test', 'analyse de données'],
    }),
  ],
};

const CANDIDATE = {
  fullName: 'Candidat Synthétique',
  email: 'candidat@example.test',
  phone: null,
  detectedLanguage: 'fr',
  rightToWork: true,
  location: 'Paris',
  photoPresent: false,
};
const LEDGER = {
  yearsExperience: 4,
  tools: ['JIRA', 'Confluence', 'Figma'],
  methodologies: ['Agile', 'Scrum'],
  skills: ['AMOA', 'cadrage fonctionnel', 'UAT'],
  domains: ['Trade Finance', 'Banque'],
};
const NARRATION = {
  summary: 'Profil aligné.',
  strengths: ['AMOA', 'Trade Finance'],
  weaknesses: [],
  justification: 'Au-dessus du seuil.',
};

function rawStub(content: string) {
  return {
    content,
    model: 'gpt-4o',
    usage: { promptTokens: 900, completionTokens: 300, totalTokens: 1200 },
    costEstimate: 0.01,
    durationMs: 800,
  };
}
const jsonResult = (data: unknown) => ({ data, raw: rawStub(JSON.stringify(data)), attempts: 1 });

describe('veto du pré-filtre — CAMP-2026-288', () => {
  beforeEach(() => chatCompleteJsonMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('AUCUN mot-clé ne matche — et pourtant les 4 critères partent au modèle', async () => {
    const VERDICTS = {
      verdicts: [
        { criterionId: '1', llmDecision: 'satisfait', llmJustification: 'AMOA explicite.', llmCVQuote: 'CONSULTANT SI & AMOA' },
        { criterionId: '2', llmDecision: 'satisfait', llmJustification: 'Trade Finance bancaire.', llmCVQuote: 'Product Manager SI Trade Finance' },
        { criterionId: '3', llmDecision: 'partiel', llmJustification: 'Figma, adoption digitale.', llmCVQuote: 'plateformes digitales' },
        { criterionId: '4', llmDecision: 'non', llmJustification: 'Rien sur la GenAI.', llmCVQuote: '' },
      ],
    };
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE))
      .mockResolvedValueOnce(jsonResult(LEDGER))
      .mockResolvedValueOnce(jsonResult(VERDICTS))
      .mockResolvedValueOnce(jsonResult(NARRATION));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({
      cvText: CV_TEXT,
      fileName: 'cv-synthetique.pdf',
      sheet: SHEET,
      source: 'email',
      receivedAt: '2026-08-21T18:31:00.000Z',
      computedAt: '2026-08-21T18:31:00.000Z',
      thresholdLow: 20,
      thresholdHigh: 90,
    });

    // AVANT : 2 appels (candidat + narration), zéro lecture, 0/100.
    // APRÈS : ledger + verdicts, les 4 critères présentés au modèle.
    expect(chatCompleteJsonMock).toHaveBeenCalledTimes(4);
    const verdictsPrompt = chatCompleteJsonMock.mock.calls[2][0][1].content as string;
    for (const label of ['MOA', 'Expertise dans le secteur financier', 'Maîtrise des parcours digitaux et UX', 'Connaissance des outils GenAI appliqués']) {
      expect(verdictsPrompt).toContain(label);
    }

    const { scoringResult } = out.application;
    // Le score n'est plus 0 : il reflète ce que le modèle a lu.
    expect(scoringResult.totalScore).toBeGreaterThan(20);
    expect(scoringResult.decisionZone).not.toBe('proposed_reject');

    // INVARIANT : chaque « non » a été rendu par un chemin qui a lu le CV.
    for (const b of scoringResult.breakdown.filter((x) => x.llmDecision === 'non')) {
      expect(b.decidedBy).toBe('llm');
    }
  });

  it('le critère CRITIQUE « MOA » ne peut plus être éteint sans lecture', async () => {
    // C'est celui qui pesait 8 et qui, seul, condamnait la candidature.
    const VERDICTS = {
      verdicts: [
        { criterionId: '1', llmDecision: 'satisfait', llmJustification: 'AMOA = MOA amont.', llmCVQuote: 'Gestion de Projet & AMOA' },
      ],
    };
    chatCompleteJsonMock
      .mockResolvedValueOnce(jsonResult(CANDIDATE))
      .mockResolvedValueOnce(jsonResult(LEDGER))
      .mockResolvedValueOnce(jsonResult(VERDICTS))
      .mockResolvedValueOnce(jsonResult(NARRATION));

    const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
    const out = await analyzeCVApplication({
      cvText: CV_TEXT,
      fileName: 'cv-synthetique.pdf',
      sheet: { ...SHEET, criteria: [SHEET.criteria[0]] },
      source: 'email',
      receivedAt: '2026-08-21T18:31:00.000Z',
      computedAt: '2026-08-21T18:31:00.000Z',
      thresholdLow: 20,
      thresholdHigh: 90,
    });

    const moa = out.application.scoringResult.breakdown.find((b) => b.criterionId === 'moa')!;
    expect(moa.llmDecision).toBe('satisfait');
    expect(moa.decidedBy).toBe('llm');
    expect(moa.llmCVQuote).toContain('AMOA');
  });
});
