/**
 * Scoreur de candidature — fonction PURE et déterministe (C2).
 *
 * Cœur de la séparation extraction / scoring / narration formalisée en C1 :
 *   - le LLM (phase extraction, C4) rend une DÉCISION par critère
 *     (`LlmCriterionVerdict`) — jamais une note ;
 *   - `scoreCandidat` applique criticité + poids selon `DECISION_OUTCOME_MATRIX`
 *     et produit un `ScoreResult` structuré — SANS appel LLM, sans side effect,
 *     sans randomisation, sans `Date.now()` ;
 *   - la narration (C5) repart du `ScoreResult`, jamais l'inverse.
 *
 * Formule (arbitrage DRH, option B) :
 *   - base = Σ_SOFT(poids × facteur) / Σ_SOFT(poids) × 100 — SOFT_WEIGHTED SEULS.
 *     Les critères HARD (rédhibitoire + obligatoire) FILTRENT, ils n'entrent pas
 *     dans la moyenne. facteur : satisfait 1 / partiel 0.5 / non 0 / non_verif 0.
 *   - SIGNAL_BONUS : bonus ≤ 5/critère, cumul ≤ 15 (dormant aujourd'hui — aucun
 *     niveau ne s'y mappe).
 *   - HARD_KNOCKOUT raté (non / non_verif) → statut `rejected`, SCORE RÉEL
 *     CONSERVÉ (jamais forcé à 0 — audit / repêchage cross-poste).
 *   - HARD_CAP raté → score plafonné à (seuil - 1) → tombe en rejected par le seuil.
 *   - score ENTIER (arrondi). statut = knockout || score < seuil ? rejected : accepted.
 *
 * Déterminisme strict : pour des décisions données, la sortie est mathématiquement
 * fixée. Toute variance = bug. Testé en exactitude (tolérance 0), jamais via un
 * appel LLM réel (cf. memory/feedback_pure_function_test_purity.md).
 */

import { z } from 'zod';

import { DEFAULT_CV_THRESHOLD } from '@/types/cv-analysis';
import {
  criterionBehavior,
  DECISION_OUTCOME_MATRIX,
  DEFAULT_VERIFICATION_METHOD,
  LlmDecisionSchema,
  ScoreResultSchema,
  type CandidateStatus,
  type CriterionDecision,
  type CriterionFailure,
  type DecisionOutcome,
  type LlmDecision,
  type ScoringBehavior,
  type ScoringCriterion,
  type ScoringSheet,
  type ScoreResult,
} from '@/types/scoring';

/** Ratio de contribution d'une décision `partiel`. */
export const PARTIAL_RATIO = 0.5;
/** Bonus maximal d'UN critère SIGNAL_BONUS (en points). */
export const SIGNAL_BONUS_PER_CRITERION_MAX = 5;
/** Bonus cumulé maximal de tous les critères SIGNAL_BONUS. */
export const SIGNAL_BONUS_TOTAL_MAX = 15;

/** Horodatage sentinelle : la fonction pure ne lit jamais l'horloge. C4 injecte la vraie valeur. */
const UNSET_COMPUTED_AT = '1970-01-01T00:00:00.000Z';
const UNSET_CRITERIA_VERSION = 'unversioned';

export class ScoringError extends Error {
  constructor(
    public readonly code: 'unscorable_sheet',
    message: string,
  ) {
    super(message);
    this.name = 'ScoringError';
  }
}

/**
 * Verdict rendu par le LLM POUR UN CRITÈRE (entrée du scoreur). Sous-ensemble
 * de `CriterionDecision` : le code y ajoutera ensuite poids, behavior et
 * contribution (dérivés de la fiche, copiés pour l'audit).
 *
 * `llmFailure` (C4) : si le LLM échoue après retry × 3, l'extraction pose ce
 * drapeau ; le scoreur traite alors le critère comme `non_verifiable`.
 */
export const LlmCriterionVerdictSchema = z.object({
  criterionId: z.string().min(1),
  llmDecision: LlmDecisionSchema,
  llmJustification: z.string().min(1),
  llmCVQuote: z.string(),
  llmFailure: z.boolean().optional(),
});
export type LlmCriterionVerdict = z.infer<typeof LlmCriterionVerdictSchema>;

export type ScoreOptions = {
  /** Surcharge le seuil d'acceptation (sinon sheet.acceptanceThreshold, sinon 75). */
  acceptanceThreshold?: number;
  /** Étiquette de version de fiche (réelle en C7 ; sentinelle ici). */
  criteriaVersion?: string;
  /** Horodatage ISO 8601 du calcul (C4 fournit la vraie valeur ; pureté préservée). */
  computedAt?: string;
};

function pointsToFactor(points: DecisionOutcome['points']): number {
  if (points === 'full') return 1;
  if (points === 'half') return PARTIAL_RATIO;
  return 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type ScoredRow = {
  criterion: ScoringCriterion;
  behavior: ScoringBehavior;
  verdict: LlmCriterionVerdict;
  decision: LlmDecision;
  factor: number;
};

/**
 * Calcule le `ScoreResult` d'une candidature à partir des décisions par critère
 * (déjà extraites) et de la fiche de scoring. Pure et déterministe.
 *
 * Le breakdown est TOUJOURS complet (tous les critères de la fiche, même en cas
 * de knockout — aucun court-circuit). Une décision manquante pour un critère de
 * la fiche est traitée comme `non_verifiable`. Les décisions dont le
 * `criterionId` n'existe pas dans la fiche sont ignorées.
 */
export function scoreCandidat(
  decisions: LlmCriterionVerdict[],
  sheet: ScoringSheet,
  options: ScoreOptions = {},
): ScoreResult {
  const scorableCount = sheet.criteria.filter(
    (c) => criterionBehavior(c.level) !== 'SIGNAL_BONUS',
  ).length;
  if (scorableCount === 0) {
    throw new ScoringError(
      'unscorable_sheet',
      'Fiche non scorable : au moins un critère non-SIGNAL est requis.',
    );
  }

  const acceptanceThreshold =
    options.acceptanceThreshold ??
    sheet.acceptanceThreshold ??
    DEFAULT_CV_THRESHOLD;
  const criteriaVersion = options.criteriaVersion ?? UNSET_CRITERIA_VERSION;
  const computedAt = options.computedAt ?? UNSET_COMPUTED_AT;

  const verdictById = new Map(decisions.map((d) => [d.criterionId, d]));

  let softNumerator = 0;
  let softDenominator = 0;
  let signalRaw = 0;
  let knockout = false;
  let capTriggered = false;
  const hardFailures: CriterionFailure[] = [];
  const rows: ScoredRow[] = [];

  // 1ʳᵉ passe — agrégats. On a besoin de softDenominator avant de figer les
  // contributions effectives (2ᵉ passe).
  for (const criterion of sheet.criteria) {
    const provided = verdictById.get(criterion.id);
    const verdict: LlmCriterionVerdict = provided ?? {
      criterionId: criterion.id,
      llmDecision: 'non_verifiable',
      llmJustification:
        'Critère non évalué : aucune décision fournie pour ce critère.',
      llmCVQuote: '',
    };
    // Échec LLM après retry (C4) ⇒ traité comme non vérifiable.
    const decision: LlmDecision = verdict.llmFailure
      ? 'non_verifiable'
      : verdict.llmDecision;

    const behavior = criterionBehavior(criterion.level);
    const outcome = DECISION_OUTCOME_MATRIX[behavior][decision];
    const factor = pointsToFactor(outcome.points);

    if (behavior === 'SOFT_WEIGHTED') {
      softNumerator += criterion.weight * factor;
      softDenominator += criterion.weight;
    } else if (behavior === 'SIGNAL_BONUS') {
      signalRaw += factor * SIGNAL_BONUS_PER_CRITERION_MAX;
    }

    if (outcome.knockout) knockout = true;
    if (outcome.capsTotal) capTriggered = true;
    if (outcome.knockout || outcome.capsTotal) {
      hardFailures.push({
        criterionId: criterion.id,
        criterionLabel: criterion.label,
        criticityLevel: criterion.level,
        reason: decision === 'non' ? 'unsatisfied' : 'unverifiable',
      });
    }

    rows.push({ criterion, behavior, verdict, decision, factor });
  }

  const baseScore =
    softDenominator > 0 ? (softNumerator / softDenominator) * 100 : 0;
  const bonus = Math.min(signalRaw, SIGNAL_BONUS_TOTAL_MAX);
  let rawScore = baseScore + bonus;
  if (capTriggered) rawScore = Math.min(rawScore, acceptanceThreshold - 1);

  const totalScore = Math.max(0, Math.min(100, Math.round(rawScore)));
  const status: CandidateStatus =
    knockout || totalScore < acceptanceThreshold ? 'rejected' : 'accepted';

  // 2ᵉ passe — breakdown avec contribution effective (au score 0-100). HARD =
  // 0 (hors moyenne, ils filtrent). SOFT = part du score ; SIGNAL = bonus brut.
  const breakdown: CriterionDecision[] = rows.map(
    ({ criterion, behavior, verdict, decision, factor }) => {
      let contribution = 0;
      if (behavior === 'SOFT_WEIGHTED') {
        contribution =
          softDenominator > 0
            ? round2(((criterion.weight * factor) / softDenominator) * 100)
            : 0;
      } else if (behavior === 'SIGNAL_BONUS') {
        contribution = round2(factor * SIGNAL_BONUS_PER_CRITERION_MAX);
      }
      return {
        criterionId: criterion.id,
        criterionLabel: criterion.label,
        criticityLevel: criterion.level,
        weight: criterion.weight,
        behavior,
        llmDecision: decision,
        llmJustification: verdict.llmJustification,
        llmCVQuote: verdict.llmCVQuote,
        contribution,
        // Trace la méthode appliquée (coalescée pour les grilles antérieures).
        verificationMethodUsed:
          criterion.verificationMethod ?? DEFAULT_VERIFICATION_METHOD,
      };
    },
  );

  // Garde-fou : la sortie respecte le contrat ScoreResult (score entier, etc.).
  return ScoreResultSchema.parse({
    totalScore,
    status,
    breakdown,
    hardFailures,
    criteriaVersion,
    computedAt,
  });
}
