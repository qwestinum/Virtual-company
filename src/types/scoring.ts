/**
 * Fiche de scoring (Phase 4) — artefact distinct de la fiche de poste.
 *
 * La fiche de poste sert à rédiger l'annonce et garder la traçabilité
 * du cadrage. La fiche de scoring sert au CV Analyzer pour évaluer
 * objectivement chaque candidature : liste de critères pondérés avec
 * un niveau de criticité, et un signal knockout pour les critères
 * rédhibitoires (absence → rejet sur le CV).
 *
 * Modèle de poids hybride (cf. memory/project_scoring_sheet.md) :
 *   - chaque niveau a un poids par défaut canonique,
 *   - chaque critère peut surcharger ce poids individuellement
 *     ("Ajuster" inline → champ weight).
 *
 * Les critères rédhibitoires sont traités à part : leur poids
 * n'intervient PAS dans la moyenne pondérée — leur seule présence
 * conditionne l'éligibilité du CV (knockout). Un critère rédhibitoire
 * non démontré force le statut `rejected` (le score réel est néanmoins
 * conservé pour l'audit — cf. CandidateStatus / DECISION_OUTCOME_MATRIX).
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
  /**
   * Seuil d'acceptation (0-100) configurable par campagne. Optionnel :
   * `scoreCandidat` retombe sur `DEFAULT_CV_THRESHOLD` (75) si absent. Co-localisé
   * avec la fiche car c'est un paramètre de scoring propre à la campagne.
   */
  acceptanceThreshold: z.number().int().min(0).max(100).optional(),
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
  'HARD_KNOCKOUT', // dur non démontré ⇒ rejected (score réel conservé pour audit)
  'HARD_CAP', //      dur non démontré ⇒ score plafonné à (seuil - 1) ⇒ rejected par le seuil
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
 *   - redhibitoire   → HARD_KNOCKOUT : non démontré ⇒ rejected.
 *   - obligatoire    → HARD_CAP      : non démontré ⇒ cap, jamais auto-rejet sec.
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
 * citation littérale du CV. Les 4 valeurs sont conservées pour l'audit même si
 * seules `non` et `non_verifiable` mènent à un échec sur critère dur.
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
 * Statut métier d'un candidat — DEUX valeurs seulement.
 *
 * Pourquoi 2 et pas plus : un rejet « knockout » et un rejet « par score »
 * déclenchent le MÊME comportement aval (mail de refus du Rejection Writer) ;
 * les distinguer au niveau du statut SYSTÈME n'apporte rien fonctionnellement.
 * L'information fine (knockout vs cap vs score, unsatisfied vs unverifiable)
 * reste disponible dans `breakdown` / `hardFailures` pour le recruteur qui
 * audite ou filtre (sujet UI — C6).
 *
 *   - 'accepted' : score ≥ seuil d'acceptation ET tous les critères durs
 *                  démontrés → Scheduler envoie l'invitation.
 *   - 'rejected' : tout le reste → Rejection Writer envoie le mail de refus.
 *
 * Précédence (appliquée par `scoreCandidat`, C2, sur un breakdown COMPLET) :
 *   1. HARD_KNOCKOUT non satisfait OU non vérifiable → rejected (marqueur
 *      knockout dans hardFailures ; le SCORE RÉEL est conservé tel quel, jamais
 *      forcé à 0 — un repêchage cross-poste reste auditable).
 *   2. HARD_CAP non satisfait OU non vérifiable → score plafonné à (seuil - 1)
 *      → tombe en rejected par le seuil.
 *   3. score ≥ seuil d'acceptation → accepted.
 *   4. score < seuil d'acceptation → rejected.
 *
 * Seuil d'acceptation = `DEFAULT_CV_THRESHOLD` (75) par défaut, configurable
 * par campagne (cf. cv-analysis.ts).
 */
export const CANDIDATE_STATUSES = ['accepted', 'rejected'] as const;
export const CandidateStatusSchema = z.enum(CANDIDATE_STATUSES);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

/**
 * Libellés métier des statuts — SOURCE UNIQUE pour l'UI, le rapport, les mails
 * et les logs. Jamais de « accepted »/« rejected » bruts côté donneur d'ordre.
 */
export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  accepted: 'Retenu',
  rejected: 'Écarté',
};

/**
 * Effet d'un verdict (behavior × décision) sur le scoring d'UN critère.
 * Contrat métier — les politiques de points sont qualitatives ici ; les nombres
 * sont figés en C2 (PARTIAL_RATIO = 0.5, plafond HARD_CAP = seuil - 1,
 * SIGNAL_BONUS ≤ 5 par critère et ≤ 15 cumulé).
 */
export type DecisionOutcome = {
  /** Politique de contribution en points (full / half / zero). */
  points: 'full' | 'half' | 'zero';
  /**
   * true ⇒ knockout : statut forcé à `rejected` + entrée dans `hardFailures`.
   * Le SCORE RÉEL n'est PAS modifié (conservé pour l'audit / repêchage).
   */
  knockout: boolean;
  /** true ⇒ score total plafonné à (seuil - 1) ⇒ tombe en rejected via le seuil. */
  capsTotal: boolean;
  /** Statut imposé indépendamment du score : 'rejected' (knockout) ou null (le seuil décide). */
  forcedStatus: CandidateStatus | null;
};

/**
 * Matrice de décision métier — comportement × verdict LLM → effet de scoring.
 * La règle est lisible dans le code (pas seulement dans la spec) :
 *
 *                    | satisfait | partiel   | non             | non_verifiable
 *  ------------------|-----------|-----------|-----------------|----------------
 *  HARD_KNOCKOUT     | full pts  | half pts  | KNOCKOUT→reject | KNOCKOUT→reject
 *  HARD_CAP          | full pts  | half pts  | CAP (seuil-1)   | CAP (seuil-1)
 *  SOFT_WEIGHTED     | full pts  | half pts  | 0 pts           | 0 pts (audit)
 *  SIGNAL_BONUS      | bonus     | half bonus| 0 (neutre)      | 0 (neutre)
 *
 * Modèle à 2 statuts : `non` et `non_verifiable` produisent le MÊME effet sur un
 * critère dur (knockout ou cap). La distinction est conservée pour l'audit via
 * `CriterionFailure.reason` (unsatisfied vs unverifiable) et le
 * `behavior`/`criticityLevel` du breakdown — jamais au niveau du statut.
 *
 * Knockout NE force PAS le score à 0 : il force seulement le statut `rejected`
 * et marque `hardFailures`. Le score réel (calculé hors knockout) est conservé
 * pour qu'un recruteur puisse auditer ou envisager un repêchage cross-poste.
 *
 * Cas de bord — critère binaire : un critère binaire (diplôme acquis ou non) se
 * calibre côté LLM en `satisfait`/`non` ; le code applique `partiel = half pts`
 * sans escalade — un `partiel` n'est jamais un échec, c'est un niveau d'atteinte
 * intermédiaire.
 */
export const DECISION_OUTCOME_MATRIX: Record<
  ScoringBehavior,
  Record<LlmDecision, DecisionOutcome>
> = {
  HARD_KNOCKOUT: {
    satisfait: { points: 'full', knockout: false, capsTotal: false, forcedStatus: null },
    partiel: { points: 'half', knockout: false, capsTotal: false, forcedStatus: null },
    non: { points: 'zero', knockout: true, capsTotal: false, forcedStatus: 'rejected' },
    non_verifiable: { points: 'zero', knockout: true, capsTotal: false, forcedStatus: 'rejected' },
  },
  HARD_CAP: {
    satisfait: { points: 'full', knockout: false, capsTotal: false, forcedStatus: null },
    partiel: { points: 'half', knockout: false, capsTotal: false, forcedStatus: null },
    non: { points: 'zero', knockout: false, capsTotal: true, forcedStatus: null },
    non_verifiable: { points: 'zero', knockout: false, capsTotal: true, forcedStatus: null },
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
 * l'audit, sans dupliquer toute la `CriterionDecision`. Contient knockout ET
 * cap : `criticityLevel` (redhibitoire vs obligatoire) et le `behavior` joint
 * via `criterionId` dans `breakdown` permettent de distinguer ce qui s'est
 * passé. Le détail complet reste accessible dans `breakdown` via `criterionId`.
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
 * `totalScore` est ENTIER (arrondi en sortie). Pour un candidat knockouté, ce
 * score reste le score RÉEL calculé hors knockout (peut donc être élevé) — le
 * statut `rejected` suffit à l'exclure du flow `accepted`.
 *
 * `criteriaVersion` / `computedAt` ancrent l'audit dans le temps. En C1 ce sont
 * de simples étiquettes ; la machine de versionnement de fiche qui les
 * alimentera réellement est C7 (hors session).
 */
export const ScoreResultSchema = z.object({
  totalScore: z.number().int().min(0).max(100),
  status: CandidateStatusSchema,
  /**
   * Breakdown TOUJOURS complet : tous les critères sont évalués, même pour un
   * candidat knockouté. Aucun court-circuit — la précédence n'est appliquée
   * qu'à la fin, sur un breakdown intégral (réutilisation cross-poste, audit
   * qualité, robustesse à un changement ultérieur de criticité). Un éventuel
   * mode `fastFail` resterait opt-in, jamais le défaut.
   */
  breakdown: z.array(CriterionDecisionSchema),
  hardFailures: z.array(CriterionFailureSchema),
  criteriaVersion: z.string().min(1),
  /** Horodatage ISO 8601 du calcul. */
  computedAt: z.string().min(1),
});
export type ScoreResult = z.infer<typeof ScoreResultSchema>;

/**
 * Indique si un critère est rédhibitoire — utile au CV Analyzer pour traiter
 * le knockout sans dupliquer la logique. Passe par `CRITICITY_TO_BEHAVIOR`
 * (source unique) : équivaut à `criterionBehavior(level) === 'HARD_KNOCKOUT'`.
 */
export function isKnockoutCriterion(criterion: ScoringCriterion): boolean {
  return criterionBehavior(criterion.level) === 'HARD_KNOCKOUT';
}
