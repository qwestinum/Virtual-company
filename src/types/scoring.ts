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

/**
 * Indique si un critère est rédhibitoire — utile au CV Analyzer
 * pour traiter le knockout sans dupliquer la logique.
 */
export function isKnockoutCriterion(criterion: ScoringCriterion): boolean {
  return criterion.level === 'redhibitoire';
}
