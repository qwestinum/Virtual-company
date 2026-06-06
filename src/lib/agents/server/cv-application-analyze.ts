/**
 * Phase EXTRACTION → SCORING du CV Analyzer (C4). Server-only.
 *
 * Inversion du runtime (séparation extraction / scoring / narration) :
 *   1. le LLM extrait les données candidat factuelles ANNEXES,
 *   2. le LLM rend une DÉCISION par critère (jamais une note),
 *   3. `scoreCandidat` (code pur) calcule le `ScoreResult`.
 *
 * Tout passe par `chatCompleteJson` (déterministe seed/temperature, validation
 * Zod, retry × 3). Une `AIValidationError` (échec après retry) dégrade
 * proprement : décisions → toutes `non_verifiable` + `llmFailure` ; candidat →
 * fiche minimale (l'email reste résolu déterministe depuis le texte du CV).
 *
 * Seul chemin d'analyse CV depuis 6d (l'ancien `cv-analyzer-execute.ts` est
 * supprimé). `ScoringSheet` est OBLIGATOIRE — le mode tâche isolée (analyse
 * sans fiche) est hors périmètre produit v1.
 */

import { z } from 'zod';

import {
  buildCandidateExtractionSystemPrompt,
  buildCandidateExtractionUserPrompt,
  buildVerdictsSystemPrompt,
  buildVerdictsUserPrompt,
} from '@/lib/agents/cv-extraction-prompts';
import { resolveCandidateEmail } from '@/lib/agents/candidate-email';
import {
  buildFallbackNarration,
  buildNarrationSystemPrompt,
  buildNarrationUserPrompt,
} from '@/lib/agents/cv-narration';
import { AIValidationError } from '@/lib/ai/errors';
import { chatCompleteJson } from '@/lib/ai/provider';
import { scoreCandidat, type LlmCriterionVerdict } from '@/lib/scoring';
import {
  CVApplicationSchema,
  CVNarrationSchema,
  JobApplicationDataSchema,
  type CVApplication,
  type CVNarration,
} from '@/types/cv-analysis';
import type { CVSource } from '@/types/cv-source';
import { LlmDecisionSchema, type ScoringSheet } from '@/types/scoring';

/** Sous-ensemble FACTUEL extrait par le LLM (le code complète les métadonnées système). */
const ExtractedCandidateSchema = z
  .object({
    fullName: z.string().min(1),
    email: z.string().email().nullable().catch(null),
    phone: z.string().nullable(),
    detectedLanguage: z.string().nullable(),
    rightToWork: z.boolean().nullable(),
    location: z.string().nullable(),
    photoPresent: z.boolean(),
  })
  .strict();
type ExtractedCandidate = z.infer<typeof ExtractedCandidateSchema>;

const VerdictsResponseSchema = z.object({
  verdicts: z.array(
    z.object({
      criterionId: z.string().min(1),
      llmDecision: LlmDecisionSchema,
      llmJustification: z.string().min(1),
      llmCVQuote: z.string(),
    }),
  ),
});

export type AnalyzeCVApplicationInput = {
  cvText: string;
  fileName: string;
  /** Fiche de scoring OBLIGATOIRE (pas d'analyse sans grille en v1). */
  sheet: ScoringSheet;
  source: CVSource;
  /** Date de réception ISO 8601 (métadonnée système). */
  receivedAt: string;
  /** Seuil d'acceptation (sinon sheet.acceptanceThreshold, sinon défaut). */
  acceptanceThreshold?: number;
  /** Étiquette de version de fiche (réelle en C7). */
  criteriaVersion?: string;
  /** Horodatage ISO 8601 du calcul (sinon laissé au défaut de scoreCandidat). */
  computedAt?: string;
};

export type AnalyzeCVApplicationOutput = {
  application: CVApplication;
  metrics: { durationMs: number; tokensUsed: number; costEstimate: number };
  /** Observabilité : quelle(s) phase(s) LLM a/ont échoué (fallback appliqué). */
  llmFailures: { candidate: boolean; verdicts: boolean; narration: boolean };
};

export async function analyzeCVApplication(
  input: AnalyzeCVApplicationInput,
): Promise<AnalyzeCVApplicationOutput> {
  const metrics = { durationMs: 0, tokensUsed: 0, costEstimate: 0 };
  /**
   * Agrège les métriques des appels LLM RÉUSSIS (candidat + verdicts).
   *
   * Limite assumée (MVP) : `chatCompleteJson` ne renvoie que les métriques de
   * la tentative aboutie, pas le coût des reprises internes (retry × 3). En cas
   * de reprises, le coût réel est donc sous-estimé. Amélioration (exposer un
   * cumul tokens/coût des tentatives depuis `chatCompleteJson`) reportée en
   * polish post-MVP — non prioritaire.
   */
  const accumulate = (raw: {
    durationMs: number;
    usage: { totalTokens: number };
    costEstimate: number;
  }): void => {
    metrics.durationMs += raw.durationMs;
    metrics.tokensUsed += raw.usage.totalTokens;
    metrics.costEstimate += raw.costEstimate;
  };

  // 1. Extraction des données candidat (factuel annexe).
  let extracted: ExtractedCandidate | null = null;
  let candidateFailed = false;
  try {
    const r = await chatCompleteJson(
      [
        { role: 'system', content: buildCandidateExtractionSystemPrompt() },
        {
          role: 'user',
          content: buildCandidateExtractionUserPrompt(input.cvText, input.fileName),
        },
      ],
      ExtractedCandidateSchema,
    );
    extracted = r.data;
    accumulate(r.raw);
  } catch (err) {
    if (!(err instanceof AIValidationError)) throw err; // erreurs transport → remontent
    candidateFailed = true;
  }

  // 2. Extraction des décisions par critère.
  let verdicts: LlmCriterionVerdict[];
  let verdictsFailed = false;
  try {
    const r = await chatCompleteJson(
      [
        { role: 'system', content: buildVerdictsSystemPrompt() },
        { role: 'user', content: buildVerdictsUserPrompt(input.cvText, input.sheet) },
      ],
      VerdictsResponseSchema,
    );
    verdicts = r.data.verdicts;
    accumulate(r.raw);
  } catch (err) {
    if (!(err instanceof AIValidationError)) throw err;
    verdictsFailed = true;
    // Fallback : aucune décision exploitable ⇒ tous les critères non vérifiables,
    // marqués llmFailure pour traçabilité. scoreCandidat appliquera knockout/cap.
    verdicts = input.sheet.criteria.map((c) => ({
      criterionId: c.id,
      llmDecision: 'non_verifiable',
      llmJustification:
        'Décision indisponible : échec de l’extraction LLM après plusieurs tentatives.',
      llmCVQuote: '',
      llmFailure: true,
    }));
  }

  // Email résolu de façon DÉTERMINISTE depuis le texte du CV (anti-hallucination),
  // y compris si l'extraction candidat a échoué.
  const emailResolution = resolveCandidateEmail(
    input.cvText,
    extracted?.email ?? null,
  );

  const candidate = JobApplicationDataSchema.parse({
    fullName: extracted?.fullName ?? 'Candidat non identifié',
    email: emailResolution.email,
    phone: extracted?.phone ?? null,
    detectedLanguage: extracted?.detectedLanguage ?? null,
    fileName: input.fileName,
    source: input.source,
    receivedAt: input.receivedAt,
    rightToWork: extracted?.rightToWork ?? null,
    location: extracted?.location ?? null,
    photoPresent: extracted?.photoPresent ?? false,
  });

  // 3. Score calculé par le CODE — le LLM ne note jamais.
  const scoringResult = scoreCandidat(verdicts, input.sheet, {
    acceptanceThreshold: input.acceptanceThreshold,
    criteriaVersion: input.criteriaVersion,
    computedAt: input.computedAt,
  });

  // 4. Narration RH rédigée À PARTIR du ScoreResult — ne touche jamais au score.
  let narration: CVNarration;
  let narrationFailed = false;
  try {
    const r = await chatCompleteJson(
      [
        { role: 'system', content: buildNarrationSystemPrompt() },
        {
          role: 'user',
          content: buildNarrationUserPrompt(scoringResult, candidate.fullName),
        },
      ],
      CVNarrationSchema,
      { temperature: 0.4 }, // prose : un peu de souplesse, score déjà figé
    );
    narration = r.data;
    accumulate(r.raw);
  } catch (err) {
    if (!(err instanceof AIValidationError)) throw err;
    narrationFailed = true;
    // Fallback déterministe dérivé du même ScoreResult (narration depuis le score).
    narration = buildFallbackNarration(scoringResult);
  }

  const application = CVApplicationSchema.parse({
    candidate,
    scoringResult,
    narration,
  });

  return {
    application,
    metrics,
    llmFailures: {
      candidate: candidateFailed,
      verdicts: verdictsFailed,
      narration: narrationFailed,
    },
  };
}
