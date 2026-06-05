/**
 * Fiche de scoring (Phase 4) — artefact distinct de la fiche de poste.
 *
 * La fiche de poste sert à rédiger l'annonce et garder la traçabilité
 * du cadrage. La fiche de scoring sert au CV Analyzer pour évaluer
 * objectivement chaque candidature : liste de critères pondérés avec
 * un niveau de criticité, et un signal knockout pour les critères
 * rédhibitoires (absence → score automatique 0 sur le CV).
 *
 * Modèle de poids hybride (cf. memory/project_scoring_sheet.md) :
 *   - chaque niveau a un poids par défaut canonique,
 *   - chaque critère peut surcharger ce poids individuellement
 *     ("Ajuster" inline → champ weight).
 *
 * Les critères rédhibitoires sont traités à part : leur poids
 * n'intervient PAS dans la moyenne pondérée — leur seule présence
 * conditionne l'éligibilité du CV (knockout). Si un critère
 * rédhibitoire est absent du CV, le score final est forcé à 0.
 */

import { z } from 'zod';

export const SCORING_LEVELS = [
  'redhibitoire',
  'obligatoire',
  'critique',
  'tres_important',
  'important',
  'souhaitable',
] as const;

export const ScoringLevelSchema = z.enum(SCORING_LEVELS);
export type ScoringLevel = z.infer<typeof ScoringLevelSchema>;

/**
 * Alias de vocabulaire métier : la « criticité » d'un critère EST son niveau.
 * `CriticityLevel` et `ScoringLevel` désignent exactement le même ensemble —
 * l'alias existe pour que le code de scoring (décisions, échecs) parle
 * « criticité » sans introduire un second type qui pourrait diverger.
 */
export type CriticityLevel = ScoringLevel;

export const SCORING_LEVEL_LABELS: Record<ScoringLevel, string> = {
  redhibitoire: 'Rédhibitoire',
  obligatoire: 'Obligatoire',
  critique: 'Critique',
  tres_important: 'Très important',
  important: 'Important',
  souhaitable: 'Souhaitable',
};

/**
 * Couleur par niveau (utilisée par l'UI scoring-sheet-editor).
 * Dégradé du plus rouge (rédhibitoire) au plus apaisé (souhaitable).
 */
export const SCORING_LEVEL_COLORS: Record<ScoringLevel, string> = {
  redhibitoire: '#dc2626', // red-600
  obligatoire: '#ea580c', // orange-600
  critique: '#d97706', // amber-600
  tres_important: '#65a30d', // lime-600
  important: '#0891b2', // cyan-600
  souhaitable: '#6366f1', // indigo-500
};

/**
 * Poids par défaut par niveau. Rédhibitoire = 0 dans la moyenne
 * pondérée car traité par knockout (cf. ci-dessus). Les autres
 * niveaux pondèrent le score normalisé entre 0 et 10.
 */
export const DEFAULT_WEIGHTS: Record<ScoringLevel, number> = {
  redhibitoire: 0,
  obligatoire: 10,
  critique: 8,
  tres_important: 6,
  important: 4,
  souhaitable: 2,
};

export const ScoringCriterionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  level: ScoringLevelSchema,
  /**
   * Poids effectif du critère dans la moyenne pondérée. Par défaut
   * `DEFAULT_WEIGHTS[level]`, surchargeable par le DRH via "Ajuster".
   * Doit rester ≥ 0. Pour `redhibitoire`, ce champ est conservé pour
   * cohérence mais n'intervient pas dans le score (knockout pur).
   */
  weight: z.number().min(0),
});
export type ScoringCriterion = z.infer<typeof ScoringCriterionSchema>;

export const ScoringSheetSchema = z.object({
  campaignId: z.string().min(1),
  criteria: z.array(ScoringCriterionSchema),
  isValidated: z.boolean(),
});
export type ScoringSheet = z.infer<typeof ScoringSheetSchema>;

/**
 * Construit un critère avec poids dérivé du niveau (chemin nominal,
 * sans override). Utilisé par la proposition LLM côté serveur et par
 * l'ajout manuel côté UI.
 */
export function buildCriterion(input: {
  id: string;
  label: string;
  level: ScoringLevel;
  weight?: number;
}): ScoringCriterion {
  return {
    id: input.id,
    label: input.label,
    level: input.level,
    weight: input.weight ?? DEFAULT_WEIGHTS[input.level],
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Comportements de scoring (C1 — refactor extraction / scoring / narration).
//
// Le vocabulaire métier (les 6 niveaux ci-dessus) reste la SEULE chose que le
// recruteur manipule. Le CODE, lui, raisonne en COMPORTEMENTS techniques.
// `CRITICITY_TO_BEHAVIOR` est l'UNIQUE traduction métier → technique : aucune
// autre fonction ne doit ré-encoder « ce niveau a tel comportement » — tout
// passe par cette table (cf. `criterionBehavior` / `isKnockoutCriterion`).
//
// Le LLM ne calcule JAMAIS le score : il rend une décision par critère
// (`LlmDecision`), et le code applique criticité + poids selon la matrice
// `DECISION_OUTCOME_MATRIX`. Le calcul numérique vit dans `scoreCandidat` (C2).
// ───────────────────────────────────────────────────────────────────────────

export const SCORING_BEHAVIORS = [
  'HARD_KNOCKOUT', // absence ⇒ score forcé à 0, point final (statut knocked_out)
  'HARD_CAP', //      échec ⇒ score plafonné + statut borderline (jamais auto-rejet)
  'SOFT_WEIGHTED', //  contribution proportionnelle au poids, pas de cap
  'SIGNAL_BONUS', //   bonus uniquement, jamais de malus ni de cap
] as const;

export const ScoringBehaviorSchema = z.enum(SCORING_BEHAVIORS);
export type ScoringBehavior = z.infer<typeof ScoringBehaviorSchema>;

/**
 * Traduction explicite des 6 niveaux de criticité métier vers les
 * comportements de scoring techniques. Source de vérité UNIQUE du mapping
 * (cf. memory/feedback_single_source_of_truth.md).
 *
 * Arbitrage DRH acté :
 *   - redhibitoire   → HARD_KNOCKOUT : seul niveau pouvant mettre le total à 0.
 *   - obligatoire    → HARD_CAP      : dur, mais jamais d'auto-rejet (spec §4.5).
 *   - critique       → SOFT_WEIGHTED : écart coûteux mais non bloquant (poids fort).
 *   - tres_important → SOFT_WEIGHTED
 *   - important      → SOFT_WEIGHTED
 *   - souhaitable    → SOFT_WEIGHTED
 *
 * `SIGNAL_BONUS` n'est PAS utilisé par le mapping actuel : il reste défini dans
 * le type pour accueillir un futur niveau « bonus » sans changer le contrat.
 */
export const CRITICITY_TO_BEHAVIOR: Record<ScoringLevel, ScoringBehavior> = {
  redhibitoire: 'HARD_KNOCKOUT',
  obligatoire: 'HARD_CAP',
  critique: 'SOFT_WEIGHTED',
  tres_important: 'SOFT_WEIGHTED',
  important: 'SOFT_WEIGHTED',
  souhaitable: 'SOFT_WEIGHTED',
};

/** Accesseur unique du comportement d'un niveau — passe TOUJOURS par la table. */
export function criterionBehavior(level: ScoringLevel): ScoringBehavior {
  return CRITICITY_TO_BEHAVIOR[level];
}

/**
 * Décision rendue par le LLM POUR UN CRITÈRE lors de l'évaluation (phase 2 du
 * pipeline extraction → scoring → narration). Le LLM ne produit JAMAIS de
 * note : seulement ce verdict qualitatif, assorti d'une justification et d'une
 * citation littérale du CV.
 */
export const LLM_DECISIONS = [
  'satisfait',
  'partiel',
  'non',
  'non_verifiable',
] as const;
export const LlmDecisionSchema = z.enum(LLM_DECISIONS);
export type LlmDecision = z.infer<typeof LlmDecisionSchema>;

/**
 * Statut métier d'un candidat à l'issue du scoring. Chaque valeur porte une
 * conséquence aval EXPLICITE (pas de statut technique sans valeur métier) :
 *   - 'accepted'    : score ≥ seuil et aucune escalade dure → Scheduler.
 *   - 'rejected'    : score < seuil, aucune escalade dure   → Rejection Writer.
 *   - 'borderline'  : ≥ 1 critère dur non satisfait ou non vérifiable →
 *                     le Manager arbitre (jamais d'auto-rejet, spec §4.5).
 *   - 'knocked_out' : ≥ 1 critère HARD_KNOCKOUT non satisfait → score 0,
 *                     sort du flow normal.
 *
 * Précédence (appliquée par `scoreCandidat`, C2, sur un breakdown COMPLET) :
 *   1. HARD_KNOCKOUT non satisfait   → knocked_out
 *   2. HARD_KNOCKOUT non vérifiable  → borderline (hard_unverifiable)
 *   3. HARD_CAP non satisfait        → borderline + cap appliqué (hard_capped)
 *   4. HARD_CAP non vérifiable       → borderline sans cap (hard_cap_unverifiable)
 *   5. score ≥ seuil acceptance      → accepted
 *   6. score < seuil rejection       → rejected
 *   7. sinon (zone d'incertitude)    → borderline (score_in_uncertainty_zone)
 * DEUX seuils, pas un (cf. `ScoringThresholds`). accepted/rejected ne sont
 * JAMAIS produits par un critère isolé : ils dépendent de la comparaison
 * score/seuils, calculée à l'agrégation (C2).
 */
export const CANDIDATE_STATUSES = [
  'accepted',
  'rejected',
  'borderline',
  'knocked_out',
] as const;
export const CandidateStatusSchema = z.enum(CANDIDATE_STATUSES);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

/**
 * Le modèle de décision a DEUX seuils, pas un :
 *   - `acceptance` : score ≥ acceptance ⇒ `accepted` ;
 *   - `rejection`  : score < rejection ⇒ `rejected` ;
 *   - entre les deux ⇒ `borderline` pur (zone d'incertitude, arbitrage Manager).
 *
 * Migration depuis l'ancien seuil unique : `DEFAULT_CV_THRESHOLD` (= 75, dans
 * cv-analysis.ts) devient le seuil `acceptance`. `rejection` est NOUVEAU ; sa
 * valeur par défaut (50) est PROVISOIRE et sera calibrée en C2 (numérique).
 * Tant que les consommateurs legacy (route, flow) ne sont pas migrés (C4), ils
 * continuent d'utiliser le seuil unique — `ScoringThresholds` est le contrat
 * cible. `rejection ≤ acceptance` est invariant (sinon pas de zone borderline).
 */
export const ScoringThresholdsSchema = z
  .object({
    acceptance: z.number().min(0).max(100),
    rejection: z.number().min(0).max(100),
  })
  .refine((t) => t.rejection <= t.acceptance, {
    message: 'rejection doit être ≤ acceptance (sinon zone borderline incohérente).',
  });
export type ScoringThresholds = z.infer<typeof ScoringThresholdsSchema>;

/**
 * Défaut cible. `acceptance` reprend l'ancien seuil unique (75) ; `rejection`
 * (50) est provisoire, à calibrer en C2. Volontairement défini ici (et non
 * importé de cv-analysis.ts) pour éviter un cycle d'import — l'alignement avec
 * `DEFAULT_CV_THRESHOLD` est à maintenir jusqu'à la migration C4.
 */
export const DEFAULT_SCORING_THRESHOLDS: ScoringThresholds = {
  acceptance: 75,
  rejection: 50,
};

/**
 * Raison du passage en `borderline` — le Manager qui arbitre doit savoir
 * POURQUOI pour prioriser : tous les borderlines ne se valent pas. Présent
 * SSI `status === 'borderline'`. Mappe la précédence (cf. `CandidateStatus`) :
 *   - 'hard_unverifiable'        : critère rédhibitoire non vérifiable (#2).
 *   - 'hard_capped'              : critère HARD_CAP non satisfait, cap appliqué (#3).
 *   - 'hard_cap_unverifiable'    : critère HARD_CAP non vérifiable, sans cap (#4).
 *   - 'score_in_uncertainty_zone': rejection ≤ score < acceptance (#7).
 * Si plusieurs causes coexistent, la plus prioritaire l'emporte (même ordre que
 * la précédence : hard_unverifiable > hard_capped > hard_cap_unverifiable >
 * score_in_uncertainty_zone).
 */
export const BORDERLINE_REASONS = [
  'hard_unverifiable',
  'hard_capped',
  'hard_cap_unverifiable',
  'score_in_uncertainty_zone',
] as const;
export const BorderlineReasonSchema = z.enum(BORDERLINE_REASONS);
export type BorderlineReason = z.infer<typeof BorderlineReasonSchema>;

/**
 * Effet d'un verdict (behavior × décision) sur le scoring d'UN critère.
 * Contrat métier — les politiques de points sont qualitatives ici ; le ratio
 * numérique exact (`half`, valeur du plafond `capsTotal`, échelle du bonus)
 * est figé et testé en C2, mais le PRINCIPE est posé dès C1.
 */
export type DecisionOutcome = {
  /** Politique de contribution en points (full / half / zero). */
  points: 'full' | 'half' | 'zero';
  /** true ⇒ knockout sec : le score total est forcé à 0. */
  knockout: boolean;
  /** true ⇒ le score total est plafonné (cap HARD_CAP non satisfait). */
  capsTotal: boolean;
  /**
   * Statut imposé par ce verdict, indépendamment du seuil. `null` ⇒ pas
   * d'escalade : le statut final (accepted/rejected) est décidé au seuil (C2).
   */
  forcedStatus: CandidateStatus | null;
};

/**
 * Matrice de décision métier — comportement × verdict LLM → effet de scoring.
 * C'est la règle, lisible dans le code (pas seulement dans la spec) :
 *
 *                    | satisfait | partiel   | non          | non_verifiable
 *  ------------------|-----------|-----------|--------------|----------------
 *  HARD_KNOCKOUT     | full pts  | half pts  | KNOCKOUT     | BORDERLINE
 *  HARD_CAP          | full pts  | half pts  | CAP + border | BORDERLINE
 *  SOFT_WEIGHTED     | full pts  | half pts  | 0 pts        | 0 pts (audit)
 *  SIGNAL_BONUS      | bonus     | half bonus| 0 (neutre)   | 0 (neutre)
 *
 * Principe métier clé : un critère DUR non vérifiable ne déclenche JAMAIS
 * d'auto-rejet (ni knockout, ni cap). Si le CV ne dit rien, le candidat
 * bascule en `borderline` et le Manager humain tranche (demande de complément
 * ou décision sur la base disponible). Alignement strict avec spec §4.5.
 *
 * Cas de bord — critère binaire : si le recruteur considère un critère comme
 * binaire (diplôme acquis ou non), c'est au LLM de calibrer sa décision en
 * `satisfait` ou `non` — le code ne traite PAS ce cas spécialement, il applique
 * la règle générale `partiel = half pts`. Un `partiel` n'est jamais un échec :
 * c'est un niveau d'atteinte intermédiaire, donc pas d'escalade de statut.
 */
export const DECISION_OUTCOME_MATRIX: Record<
  ScoringBehavior,
  Record<LlmDecision, DecisionOutcome>
> = {
  HARD_KNOCKOUT: {
    satisfait: { points: 'full', knockout: false, capsTotal: false, forcedStatus: null },
    partiel: { points: 'half', knockout: false, capsTotal: false, forcedStatus: null },
    non: { points: 'zero', knockout: true, capsTotal: false, forcedStatus: 'knocked_out' },
    non_verifiable: { points: 'zero', knockout: false, capsTotal: false, forcedStatus: 'borderline' },
  },
  HARD_CAP: {
    satisfait: { points: 'full', knockout: false, capsTotal: false, forcedStatus: null },
    partiel: { points: 'half', knockout: false, capsTotal: false, forcedStatus: null },
    non: { points: 'zero', knockout: false, capsTotal: true, forcedStatus: 'borderline' },
    non_verifiable: { points: 'zero', knockout: false, capsTotal: false, forcedStatus: 'borderline' },
  },
  SOFT_WEIGHTED: {
    satisfait: { points: 'full', knockout: false, capsTotal: false, forcedStatus: null },
    partiel: { points: 'half', knockout: false, capsTotal: false, forcedStatus: null },
    non: { points: 'zero', knockout: false, capsTotal: false, forcedStatus: null },
    non_verifiable: { points: 'zero', knockout: false, capsTotal: false, forcedStatus: null },
  },
  SIGNAL_BONUS: {
    satisfait: { points: 'full', knockout: false, capsTotal: false, forcedStatus: null },
    partiel: { points: 'half', knockout: false, capsTotal: false, forcedStatus: null },
    non: { points: 'zero', knockout: false, capsTotal: false, forcedStatus: null },
    non_verifiable: { points: 'zero', knockout: false, capsTotal: false, forcedStatus: null },
  },
};

/**
 * Décision auditée pour un critère, telle qu'elle figure dans un ScoreResult.
 *
 * AUDITABILITÉ NON NÉGOCIABLE : les attributs descriptifs du critère (label,
 * criticité, poids, comportement) sont COPIÉS ici au moment du scoring —
 * jamais re-lus depuis la fiche. Un ScoreResult reste donc relisable à
 * l'identique même si la fiche évolue ensuite (versioning de fiche = C7).
 * `criterionId` n'est conservé QUE comme clé de jointure (lookup depuis
 * `hardFailures`), pas comme substitut aux attributs copiés.
 */
export const CriterionDecisionSchema = z.object({
  criterionId: z.string().min(1),
  criterionLabel: z.string().min(1),
  criticityLevel: ScoringLevelSchema,
  weight: z.number().min(0),
  behavior: ScoringBehaviorSchema,
  llmDecision: LlmDecisionSchema,
  llmJustification: z.string().min(1),
  /** Citation littérale du CV qui fonde la décision. '' admis si non vérifiable. */
  llmCVQuote: z.string(),
  /** Points effectivement apportés au total par ce critère (calcul C2). */
  contribution: z.number(),
});
export type CriterionDecision = z.infer<typeof CriterionDecisionSchema>;

/**
 * Index minimal d'un échec sur critère dur — pour l'affichage rapide et
 * l'audit, sans dupliquer toute la `CriterionDecision`. Le détail complet
 * reste accessible dans `breakdown` via `criterionId`.
 *   - reason 'unsatisfied'  : décision 'non' sur un critère dur.
 *   - reason 'unverifiable' : décision 'non_verifiable' sur un critère dur.
 */
export const CriterionFailureSchema = z.object({
  criterionId: z.string().min(1),
  criterionLabel: z.string().min(1),
  criticityLevel: ScoringLevelSchema,
  reason: z.enum(['unsatisfied', 'unverifiable']),
});
export type CriterionFailure = z.infer<typeof CriterionFailureSchema>;

/**
 * Résultat de scoring structuré et explicable — JAMAIS un simple nombre
 * (règle d'explicabilité native). Produit par `scoreCandidat` (C2), consommé
 * par la narration LLM (C5) puis le dashboard (C6).
 *
 * `criteriaVersion` / `computedAt` ancrent l'audit dans le temps. En C1 ce
 * sont de simples étiquettes ; la machine de versionnement de fiche qui les
 * alimentera réellement est C7 (hors session).
 */
export const ScoreResultSchema = z
  .object({
    totalScore: z.number().min(0).max(100),
    status: CandidateStatusSchema,
    /**
     * Raison du borderline (cf. `BorderlineReason`). Présent SSI
     * `status === 'borderline'` — invariant garanti par le refine ci-dessous.
     */
    borderlineReason: BorderlineReasonSchema.optional(),
    /**
     * Breakdown TOUJOURS complet : tous les critères sont évalués, même pour un
     * `knocked_out`. Aucun court-circuit — la précédence n'est appliquée qu'à la
     * fin, sur un breakdown intégral. Raisons : réutilisation cross-poste (un
     * knocked_out peut intéresser ailleurs), audit qualité, robustesse à un
     * changement ultérieur de criticité. Un éventuel mode `fastFail` resterait
     * opt-in, jamais le défaut.
     */
    breakdown: z.array(CriterionDecisionSchema),
    hardFailures: z.array(CriterionFailureSchema),
    criteriaVersion: z.string().min(1),
    /** Horodatage ISO 8601 du calcul. */
    computedAt: z.string().min(1),
  })
  .refine(
    (r) => (r.status === 'borderline') === (r.borderlineReason !== undefined),
    {
      message:
        'borderlineReason doit être défini SSI status === "borderline".',
      path: ['borderlineReason'],
    },
  );
export type ScoreResult = z.infer<typeof ScoreResultSchema>;

/**
 * Indique si un critère est rédhibitoire — utile au CV Analyzer pour traiter
 * le knockout sans dupliquer la logique. Passe par `CRITICITY_TO_BEHAVIOR`
 * (source unique) : équivaut à `criterionBehavior(level) === 'HARD_KNOCKOUT'`.
 */
export function isKnockoutCriterion(criterion: ScoringCriterion): boolean {
  return criterionBehavior(criterion.level) === 'HARD_KNOCKOUT';
}
