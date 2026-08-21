/**
 * Phase EXTRACTION → SCORING du CV Analyzer (C4). Server-only.
 *
 * Inversion du runtime (séparation extraction / scoring / narration) :
 *   1. le LLM extrait les données candidat factuelles ANNEXES,
 *   2. le LLM rend une DÉCISION par critère (jamais une note),
 *   3. `scoreCandidat` (code pur) calcule le `ScoreResult`.
 *
 * Tout passe par `chatCompleteJson` (déterministe seed/temperature, validation
 * Zod, retry × 3). Gestion d'une `AIValidationError` (échec après retry) PAR
 * PHASE : candidat → fiche minimale (l'email reste résolu déterministe depuis
 * le texte du CV) ; ledger → relevé vide ; narration → fallback déterministe
 * (toutes erreurs confondues, transport compris — cosmétique, jamais fatal) ;
 * VERDICTS → `AnalysisUnavailableError` : SANS verdicts il n'y a pas
 * d'analyse — on ne fabrique JAMAIS de score fantôme (l'ancien fallback
 * `non_verifiable` produisait un refus auto envoyé à tort, audit C2). Les
 * erreurs transport (`AIProviderError`) remontent telles quelles.
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
import { AIValidationError, AnalysisUnavailableError } from '@/lib/ai/errors';
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
import { assertNoUnprovenNegative } from '@/lib/scoring/verdict-integrity';
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

/**
 * Méthodes autorisées à CONCLURE en local sur une preuve littérale. L'hybride
 * en est exclu à dessein : chez lui, un mot-clé trouvé n'est qu'un indice à
 * faire vérifier en contexte par le modèle.
 */
function isKeywordOnlyMethod(method: VerificationMethod): boolean {
  return method === 'keywords_exact' || method === 'keywords_with_variants';
}

/**
 * Verdict déterministe d'un critère mots-clés — UNIQUEMENT quand un mot-clé a
 * été trouvé. `null` sinon : le critère part alors au modèle.
 *
 * C'est la règle issue de l'incident du 21/08/2026 (cf. `verdict-integrity`) :
 * trouver un mot-clé est une preuve littérale qui autorise à conclure sans
 * appeler le modèle ; ne PAS le trouver ne prouve rien du tout. Un CV qui dit
 * « Consultant SI & AMOA » ne contient pas la chaîne « Consultant MOA », et un
 * parcours « Trade Finance — Société Générale » ne contient pas « secteur
 * financier » : conclure « non » là-dessus, c'est juger l'orthographe du
 * candidat, pas ses compétences.
 */
function keywordVerdict(
  cvText: string,
  criterion: ScoringCriterion,
): LlmCriterionVerdict | null {
  const { matched, citation } = findMatchedKeywords(cvText, criterion.keywords ?? []);
  if (matched.length === 0) return null;
  return {
    criterionId: criterion.id,
    llmDecision: 'satisfait',
    llmJustification: `Mots-clés trouvés dans le CV (vérification déterministe) : ${matched.join(', ')}.`,
    llmCVQuote: citation,
    matchedKeywords: matched,
    decidedBy: 'keyword_match',
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
  /**
   * Le document a-t-il été reconnu comme une CANDIDATURE par l'extraction ?
   * `false` = court-circuit « Candidat anonyme » (lettre de motivation, doc
   * annexe…). Permet à l'appelant multi-PJ (poller IMAP) de préférer une
   * autre PJ du même mail plutôt que de persister l'anonyme. Une extraction
   * candidat en échec (`llmFailures.candidate`) reste `true` : on ne peut pas
   * PROUVER que le document n'est pas un CV.
   */
  isCv: boolean;
  metrics: { durationMs: number; tokensUsed: number; costEstimate: number };
  /**
   * Observabilité : quelle(s) phase(s) LLM DÉGRADABLE(S) a/ont échoué
   * (fallback appliqué). La phase verdicts n'y figure plus : son échec ne
   * dégrade pas, il ABANDONNE l'analyse (`AnalysisUnavailableError`) — jamais
   * de score fantôme (audit C2).
   */
  llmFailures: {
    candidate: boolean;
    ledger: boolean;
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
      isCv: false,
      metrics,
      llmFailures: {
        candidate: candidateFailed,
        ledger: false,
        narration: false,
      },
    };
  }

  // Dispatcher (cf. docs/specs/scoring-hybrid.md §3a, §5.1). Depuis le
  // 21/08/2026, une règle vaut pour TOUTE méthode à mots-clés :
  //
  //   un mot-clé ABSENT ne prouve RIEN → le critère part au modèle.
  //
  // Le pré-filtre perd donc son droit de VETO : il ne peut plus refuser un
  // candidat que personne n'a lu (incident CAMP-2026-288 : 0/100 sur un CV
  // riche, quatre critères éteints sans un seul appel LLM, parce que le CV
  // disait « Consultant SI & AMOA » et non « Consultant MOA »).
  //
  // Ce que fait un mot-clé TROUVÉ dépend en revanche de la méthode, et cette
  // différence-là est délibérée :
  //   - `keywords_exact` / `keywords_with_variants` → la présence littérale
  //     SUFFIT : verdict « satisfait » local, appel LLM économisé.
  //   - `hybrid_keywords_llm` → la présence est NÉCESSAIRE MAIS PAS
  //     SUFFISANTE, et le critère part quand même au modèle avec les gardiens
  //     en contexte. C'est toute la raison d'être de l'hybride : « MOA » peut
  //     apparaître dans « j'ai assisté le Consultant MOA », où le candidat est
  //     l'objet et non le sujet. Conclure sur la seule présence y fabriquerait
  //     des faux POSITIFS, symétriques du faux négatif qu'on vient de corriger.
  //
  // Grille tout-LLM (défaut) ⇒ déterministe vide, `hybridContext` vide ⇒ user
  // prompt IDENTIQUE ⇒ mêmes appels, même ordre (non-régression).
  const deterministicVerdicts: LlmCriterionVerdict[] = [];
  const llmCriteria: ScoringCriterion[] = [];
  const hybridContext = new Map<string, string[]>(); // criterionId → gardiens trouvés

  for (const c of input.sheet.criteria) {
    const method = methodOf(c);
    if (method === 'hybrid_keywords_llm') {
      // Toujours au modèle. Les gardiens trouvés l'aident à trancher ; leur
      // absence ne le dispense pas de lire.
      llmCriteria.push(c);
      const { found } = matchKeywordsForHybrid(input.cvText, c.keywords ?? []);
      if (found.length > 0) hybridContext.set(c.id, found);
      continue;
    }
    if (isKeywordOnlyMethod(method)) {
      const verdict = keywordVerdict(input.cvText, c);
      if (verdict) {
        deterministicVerdicts.push(verdict);
        continue;
      }
      // Aucun mot-clé : on DÉFÈRE, et le modèle reçoit le critère NU — sans la
      // liste qui vient d'échouer, pour ne pas l'ancrer sur un vocabulaire
      // dont on vient de constater qu'il ne colle pas à ce CV.
      llmCriteria.push(c);
      continue;
    }
    llmCriteria.push(c); // llm_with_quote / défaut
  }

  // INVARIANT « un non sans preuve n'est pas un verdict » : le chemin
  // déterministe ne peut produire que des « satisfait ». Une violation est un
  // défaut de conception, pas une entrée invalide — on lève plutôt que de
  // rattraper en silence.
  assertNoUnprovenNegative(deterministicVerdicts);

  let ledgerFailed = false;
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
        (v) => ({
          ...v,
          // Ces verdicts SORTENT du modèle, qui a reçu le CV : c'est ce qui
          // les autorise à conclure négativement (cf. `verdict-integrity`).
          decidedBy: 'llm' as const,
          // Reporte les gardiens trouvés sur le verdict hybride (affichage Phase 4).
          ...(hybridContext.has(v.criterionId)
            ? { matchedKeywords: hybridContext.get(v.criterionId) }
            : {}),
        }),
      );
      accumulate(r.raw);
    } catch (err) {
      if (!(err instanceof AIValidationError)) throw err;
      // SANS verdicts, il n'y a PAS d'analyse. L'ancien fallback fabriquait
      // des `non_verifiable` ⇒ score ≈ 0 (voire knockout sur un rédhibitoire)
      // ⇒ REFUS AUTO envoyé au candidat pour une panne technique (audit C2).
      // Principe : sous incertitude LLM, ne jamais décider ni envoyer —
      // l'appelant re-tente (poller : rails minRetryUid) ou remonte l'échec
      // (chat : 503 explicite).
      throw new AnalysisUnavailableError(
        'Verdicts LLM inexploitables après plusieurs tentatives — analyse abandonnée, aucun score produit.',
        err,
      );
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
    // TOUTES les erreurs (validation ET transport) : la narration est
    // cosmétique — une panne ici ne doit JAMAIS faire échouer une analyse
    // dont le score est déjà figé (un CV bien analysé ne se perd pas pour un
    // texte raté — audit C2, exigence 3). Trace explicite, jamais muet.
    narrationFailed = true;
    console.error(
      '[cv-analyze] narration LLM échouée — fallback déterministe appliqué',
      err,
    );
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
    isCv: true,
    metrics,
    llmFailures: {
      candidate: candidateFailed,
      ledger: ledgerFailed,
      narration: narrationFailed,
    },
  };
}
