/**
 * Analyse CV — comportement sous PANNE LLM (correctif audit C2).
 *
 * Le principe testé : SOUS INCERTITUDE LLM, NE JAMAIS DÉCIDER NI ENVOYER.
 *   - verdicts inexploitables → `AnalysisUnavailableError` (aucun score
 *     fantôme, l'ancien fallback produisait un refus auto envoyé à tort) ;
 *   - erreur transport sur les verdicts → remonte telle quelle (le poller la
 *     classe re-tentable) ;
 *   - panne sur la NARRATION (cosmétique) → fallback déterministe, l'analyse
 *     aboutit — un CV bien scoré ne se perd pas pour un texte raté.
 *
 * `chatCompleteJson` est mocké : l'ordre des appels est déterministe —
 * 1. extraction candidat, 2. ledger, 3. verdicts, 4. narration.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { chatCompleteJsonMock } = vi.hoisted(() => ({
  chatCompleteJsonMock: vi.fn(),
}));

vi.mock('@/lib/ai/provider', () => ({ chatCompleteJson: chatCompleteJsonMock }));

import {
  AIProviderError,
  AIValidationError,
  AnalysisUnavailableError,
} from '@/lib/ai/errors';
import { analyzeCVApplication } from '@/lib/agents/server/cv-application-analyze';
import type { ScoringSheet } from '@/types/scoring';

const SHEET: ScoringSheet = {
  campaignId: 'CAMP-TEST',
  isValidated: true,
  criteria: [
    {
      id: 'crit-react',
      label: 'Maîtrise de React',
      level: 'important',
      weight: 2,
    },
  ],
};

const CV_TEXT =
  'Jean Test — Développeur front. Contact : jean.test@example.com. ' +
  'Cinq ans de React en production chez ACME.';

const INPUT = {
  cvText: CV_TEXT,
  fileName: 'cv-jean-test.pdf',
  sheet: SHEET,
  source: 'manual' as const,
  receivedAt: '2026-07-09T10:00:00.000Z',
  computedAt: '2026-07-09T10:00:00.000Z',
  thresholdLow: 40,
  thresholdHigh: 70,
};

function ok<T>(data: T) {
  return {
    data,
    raw: { durationMs: 1, usage: { totalTokens: 10 }, costEstimate: 0 },
    attempts: 1,
  };
}

const CANDIDATE_OK = ok({
  isCv: true,
  fullName: 'Jean Test',
  email: 'jean.test@example.com',
  phone: null,
  detectedLanguage: 'fr',
  rightToWork: null,
  location: null,
  photoPresent: false,
});

// Le LLM renvoie le NUMÉRO du critère (1..N), remappé vers le vrai id par
// remapVerdictsToCriteria (cf. le test principal du module).
const VERDICTS_OK = ok({
  verdicts: [
    {
      criterionId: '1',
      llmDecision: 'satisfait',
      llmJustification: 'Cinq ans de React en production.',
      llmCVQuote: 'Cinq ans de React en production chez ACME.',
    },
  ],
});

const NARRATION_OK = ok({
  summary: 'Profil solide.',
  strengths: ['React confirmé'],
  weaknesses: [],
  justification: 'Critère principal démontré.',
});

const validationFailure = () =>
  new AIValidationError('Réponse LLM invalide après 3 tentative(s).', 3, null);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('analyzeCVApplication — pannes LLM (audit C2)', () => {
  it('verdicts inexploitables (validation ×3) → AnalysisUnavailableError, AUCUN score produit', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(CANDIDATE_OK) // 1. candidat
      .mockRejectedValueOnce(validationFailure()) // 2. ledger (dégradable)
      .mockRejectedValueOnce(validationFailure()); // 3. verdicts → fatal

    await expect(analyzeCVApplication(INPUT)).rejects.toBeInstanceOf(
      AnalysisUnavailableError,
    );
    // La narration (4e appel) ne doit JAMAIS être tentée : l'analyse est
    // abandonnée avant tout scoring.
    expect(chatCompleteJsonMock).toHaveBeenCalledTimes(3);
  });

  it('erreur TRANSPORT sur les verdicts (rate limit) → remonte telle quelle', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(CANDIDATE_OK)
      .mockRejectedValueOnce(validationFailure()) // ledger dégradé
      .mockRejectedValueOnce(new AIProviderError('rate_limit', '429 TPM'));

    await expect(analyzeCVApplication(INPUT)).rejects.toBeInstanceOf(
      AIProviderError,
    );
  });

  it('panne sur la NARRATION (transport) → analyse ABOUTIE avec fallback déterministe', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(CANDIDATE_OK)
      .mockRejectedValueOnce(validationFailure()) // ledger dégradé
      .mockResolvedValueOnce(VERDICTS_OK)
      .mockRejectedValueOnce(new AIProviderError('timeout', 'timeout 30s'));

    const out = await analyzeCVApplication(INPUT);

    expect(out.llmFailures.narration).toBe(true);
    expect(out.llmFailures.ledger).toBe(true);
    // Le score est figé et la zone calculée : critère satisfait → 100 ≥ 70.
    expect(out.application.scoringResult.totalScore).toBe(100);
    expect(out.application.scoringResult.decisionZone).toBe('auto_accept');
    // Narration de repli non vide (jamais un rapport muet).
    expect(out.application.narration.summary.length).toBeGreaterThan(0);
  });

  it('chemin nominal : 4 appels, aucun échec signalé', async () => {
    chatCompleteJsonMock
      .mockResolvedValueOnce(CANDIDATE_OK)
      .mockResolvedValueOnce(
        ok({
          yearsExperience: 5,
          tools: ['React'],
          methodologies: [],
          skills: ['front-end'],
          domains: ['web'],
        }),
      )
      .mockResolvedValueOnce(VERDICTS_OK)
      .mockResolvedValueOnce(NARRATION_OK);

    const out = await analyzeCVApplication(INPUT);

    expect(out.llmFailures).toEqual({
      candidate: false,
      ledger: false,
      narration: false,
    });
    expect(out.application.candidate.fullName).toBe('Jean Test');
    expect(out.application.candidate.email).toBe('jean.test@example.com');
  });
});
