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
  buildLedgerSystemPrompt,
  buildLedgerUserPrompt,
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
import {
  findMatchedKeywords,
  matchKeywordsForHybrid,
  scoreCandidat,
  type LlmCriterionVerdict,
} from '@/lib/scoring';
import {
  CVApplicationSchema,
  CVFactLedgerSchema,
  CVNarrationSchema,
  EMPTY_CV_FACT_LEDGER,
  JobApplicationDataSchema,
  type CVApplication,
  type CVFactLedger,
  type CVNarration,
} from '@/types/cv-analysis';
import type { CVSource } from '@/types/cv-source';
import {
  LlmDecisionSchema,
  type ScoringCriterion,
  type ScoringSheet,
  type VerificationMethod,
} from '@/types/scoring';

/** Méthode coalescée (défaut llm_with_quote pour les grilles antérieures). */
function methodOf(c: ScoringCriterion): VerificationMethod {
  return c.verificationMethod ?? 'llm_with_quote';
}

/** Méthodes 100% déterministes (vérifiées en local, sans LLM). */
function isKeywordOnlyMethod(method: VerificationMethod): boolean {
  return method === 'keywords_exact' || method === 'keywords_with_variants';
}

/** Verdict déterministe d'un critère mots-clés, au format `LlmCriterionVerdict`. */
function keywordVerdict(
  cvText: string,
  criterion: ScoringCriterion,
): LlmCriterionVerdict {
  const { matched, citation } = findMatchedKeywords(cvText, criterion.keywords ?? []);
  const found = matched.length > 0;
  return {
    criterionId: criterion.id,
    llmDecision: found ? 'satisfait' : 'non',
    llmJustification: found
      ? `Mots-clés trouvés dans le CV (vérification déterministe) : ${matched.join(', ')}.`
      : 'Aucun des mots-clés attendus n’a été trouvé dans le CV (vérification déterministe).',
    llmCVQuote: citation,
    matchedKeywords: matched,
  };
}

/** Verdict hybride SANS match : `non` immédiat, sans appel LLM (étape 2a). */
function hybridNoMatchVerdict(criterion: ScoringCriterion): LlmCriterionVerdict {
  return {
    criterionId: criterion.id,
    llmDecision: 'non',
    llmJustification:
      'Aucun mot-clé gardien trouvé dans le CV — critère non satisfait (méthode hybride, sans appel LLM).',
    llmCVQuote: '',
    matchedKeywords: [],
  };
}

/** Sous-ensemble FACTUEL extrait par le LLM (le code complète les métadonnées système). */
const ExtractedCandidateSchema = z
  .object({
    /** Le document est-il une candidature (CV) ? false ⇒ doc non reconnu. */
    isCv: z.boolean().catch(true),
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

/**
 * Remappe les `criterionId` renvoyés par le LLM vers les VRAIS ids de la fiche.
 *
 * Le prompt présente les critères NUMÉROTÉS (1..N) et demande au LLM de reporter
 * ce numéro — bien plus fiable que lui faire recopier un `crit_<UUID>`, qu'il
 * mal-recopiait : les verdicts ne matchaient alors plus la fiche, les critères
 * retombaient en `non_verifiable` → scores bas ET variables d'un run à l'autre.
 * On accepte aussi le vrai id (si le modèle l'a renvoyé). Verdict non mappable
 * (numéro hors plage / id inconnu) → ignoré (le scoreur le traitera en
 * `non_verifiable`).
 */
export function remapVerdictsToCriteria(
  rawVerdicts: z.infer<typeof VerdictsResponseSchema>['verdicts'],
  criteria: ScoringSheet['criteria'],
): LlmCriterionVerdict[] {
  const realIds = new Set(criteria.map((c) => c.id));
  const out: LlmCriterionVerdict[] = [];
  for (const v of rawVerdicts) {
    let id: string | null = null;
    if (realIds.has(v.criterionId)) {
      id = v.criterionId;
    } else {
      const idx = Number(v.criterionId);
      if (Number.isInteger(idx) && idx >= 1 && idx <= criteria.length) {
        id = criteria[idx - 1].id;
      }
    }
    if (id) out.push({ ...v, criterionId: id });
  }
  return out;
}

export type AnalyzeCVApplicationInput = {
  cvText: string;
  fileName: string;
  /** Fiche de scoring OBLIGATOIRE (pas d'analyse sans grille en v1). */
  sheet: ScoringSheet;
  source: CVSource;
  /** Date de réception ISO 8601 (métadonnée système). */
  receivedAt: string;
  /** DÉPRÉCIÉ (lot 2) — seuil unique = poignées collées. Préférer low/high. */
  acceptanceThreshold?: number;
  /** Seuil bas (lot 2) : score < bas → refus auto. */
  thresholdLow?: number;
  /** Seuil haut (lot 2) : score ≥ haut → acceptation auto ; entre = zone grise. */
  thresholdHigh?: number;
  /** Étiquette de version de fiche (réelle en C7). */
  criteriaVersion?: string;
  /** Horodatage ISO 8601 du calcul (sinon laissé au défaut de scoreCandidat). */
  computedAt?: string;
};

export type AnalyzeCVApplicationOutput = {
  application: CVApplication;
  metrics: { durationMs: number; tokensUsed: number; costEstimate: number };
  /** Observabilité : quelle(s) phase(s) LLM a/ont échoué (fallback appliqué). */
  llmFailures: {
    candidate: boolean;
    ledger: boolean;
    verdicts: boolean;
    narration: boolean;
  };
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

  // Document non reconnu comme un CV (facture, lettre, doc vide…). On NE
  // récupère AUCUN email (ne pas grappiller une adresse au hasard — ex. celle
  // du recruteur) : candidat anonyme, écarté, narration explicite. Court-circuit
  // (pas d'appel verdicts ni narration LLM).
  if (extracted && extracted.isCv === false) {
    const candidate = JobApplicationDataSchema.parse({
      fullName: 'Candidat anonyme',
      email: null,
      phone: null,
      detectedLanguage: extracted.detectedLanguage,
      fileName: input.fileName,
      source: input.source,
      receivedAt: input.receivedAt,
      rightToWork: null,
      location: null,
      photoPresent: false,
    });
    const verdicts: LlmCriterionVerdict[] = input.sheet.criteria.map((c) => ({
      criterionId: c.id,
      llmDecision: 'non_verifiable',
      llmJustification: 'Document non reconnu comme un CV.',
      llmCVQuote: '',
    }));
    const scoringResult = scoreCandidat(verdicts, input.sheet, {
      acceptanceThreshold: input.acceptanceThreshold,
      thresholdLow: input.thresholdLow,
      thresholdHigh: input.thresholdHigh,
      criteriaVersion: input.criteriaVersion,
      computedAt: input.computedAt,
    });
    const narration: CVNarration = {
      summary:
        'Document non reconnu comme un CV : aucune information de candidature exploitable.',
      strengths: [],
      weaknesses: ['Le document ne semble pas être un CV / une candidature.'],
      justification:
        'Écarté — le document ne constitue pas une candidature analysable, aucun contact exploitable.',
    };
    return {
      application: CVApplicationSchema.parse({ candidate, scoringResult, narration }),
      metrics,
      llmFailures: {
        candidate: candidateFailed,
        ledger: false,
        verdicts: false,
        narration: false,
      },
    };
  }

  // Dispatcher hybride (cf. docs/specs/scoring-hybrid.md §3a, §5.1) : partition
  // en 3 voies.
  //   - déterministe (keywords_exact/with_variants) → vérifié EN LOCAL, sans LLM ;
  //   - hybride (hybrid_keywords_llm) → pré-check des mots-clés gardiens :
  //       · aucun trouvé → verdict `non` LOCAL (sans LLM) ;
  //       · au moins un trouvé → rejoint le batch LLM avec contexte enrichi
  //         (« nécessaires mais pas suffisants ») ;
  //   - LLM pur (llm_with_quote / défaut) → batch LLM.
  // Grille tout-LLM (défaut) ⇒ déterministe/hybride vides, `hybridContext`
  // vide ⇒ user prompt IDENTIQUE ⇒ mêmes appels, même ordre (non-régression).
  const deterministicVerdicts: LlmCriterionVerdict[] = [];
  const llmCriteria: ScoringCriterion[] = [];
  const hybridContext = new Map<string, string[]>(); // criterionId → gardiens trouvés

  for (const c of input.sheet.criteria) {
    const method = methodOf(c);
    if (isKeywordOnlyMethod(method)) {
      deterministicVerdicts.push(keywordVerdict(input.cvText, c));
    } else if (method === 'hybrid_keywords_llm') {
      const { found } = matchKeywordsForHybrid(input.cvText, c.keywords ?? []);
      if (found.length === 0) {
        deterministicVerdicts.push(hybridNoMatchVerdict(c)); // étape 2a, sans LLM
      } else {
        llmCriteria.push(c); // étape 2b : batch LLM + contexte
        hybridContext.set(c.id, found);
      }
    } else {
      llmCriteria.push(c); // llm_with_quote / défaut
    }
  }

  let ledgerFailed = false;
  let verdictsFailed = false;
  let llmVerdicts: LlmCriterionVerdict[] = [];

  if (llmCriteria.length > 0) {
    const llmSheet: ScoringSheet = { ...input.sheet, criteria: llmCriteria };

    // 1bis. Relevé de faits (ledger) — SOURCE CANONIQUE des critères LLM.
    // Extrait UNE fois ; les verdicts s'y ancrent pour qu'un même fait
    // (« Xray ») ne soit pas jugé présent ici et absent là. Dégrade proprement :
    // un échec → relevé vide, les verdicts se rabattent sur le seul texte du CV.
    let ledger: CVFactLedger = EMPTY_CV_FACT_LEDGER;
    try {
      const r = await chatCompleteJson(
        [
          { role: 'system', content: buildLedgerSystemPrompt() },
          { role: 'user', content: buildLedgerUserPrompt(input.cvText, input.fileName) },
        ],
        CVFactLedgerSchema,
      );
      ledger = r.data;
      accumulate(r.raw);
    } catch (err) {
      if (!(err instanceof AIValidationError)) throw err;
      ledgerFailed = true;
    }

    // 2. Extraction des décisions des critères LLM, ANCRÉES sur le relevé.
    try {
      const r = await chatCompleteJson(
        [
          { role: 'system', content: buildVerdictsSystemPrompt() },
          {
            role: 'user',
            content: buildVerdictsUserPrompt(
              input.cvText,
              llmSheet,
              ledger,
              hybridContext,
            ),
          },
        ],
        VerdictsResponseSchema,
      );
      llmVerdicts = remapVerdictsToCriteria(r.data.verdicts, llmCriteria).map(
        (v) =>
          // Reporte les gardiens trouvés sur le verdict hybride (affichage Phase 4).
          hybridContext.has(v.criterionId)
            ? { ...v, matchedKeywords: hybridContext.get(v.criterionId) }
            : v,
      );
      accumulate(r.raw);
    } catch (err) {
      if (!(err instanceof AIValidationError)) throw err;
      verdictsFailed = true;
      // Fallback : aucune décision exploitable ⇒ critères LLM non vérifiables,
      // marqués llmFailure pour traçabilité. scoreCandidat appliquera knockout/cap.
      llmVerdicts = llmCriteria.map((c) => ({
        criterionId: c.id,
        llmDecision: 'non_verifiable',
        llmJustification:
          'Décision indisponible : échec de l’extraction LLM après plusieurs tentatives.',
        llmCVQuote: '',
        llmFailure: true,
      }));
    }
  }

  // Fusion déterministe + LLM (l'ordre est indifférent : scoreCandidat indexe
  // par criterionId et itère la fiche complète).
  const verdicts: LlmCriterionVerdict[] = [
    ...deterministicVerdicts,
    ...llmVerdicts,
  ];

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
    thresholdLow: input.thresholdLow,
    thresholdHigh: input.thresholdHigh,
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
      ledger: ledgerFailed,
      verdicts: verdictsFailed,
      narration: narrationFailed,
    },
  };
}
