import { z } from 'zod';

import { ScoringSheetSchema } from './scoring';

/**
 * Critères passés au CV Analyzer. Dérivés de la FDP en mode campagne ;
 * en tâche isolée hors campagne, seul `freeText` est renseigné — le
 * Manager y consigne l'instruction libre du DRH.
 *
 * Phase 4.4 — Si une fiche de scoring validée est disponible, elle
 * est jointe via `scoringSheet` : le LLM s'en sert comme grille
 * pondérée pour produire le score, et le knockout sur un critère
 * rédhibitoire absent ramène le score à 0.
 */
export const CVAnalysisCriteriaSchema = z.object({
  jobTitle: z.string().optional(),
  seniority: z.string().optional(),
  contractType: z.string().optional(),
  location: z.string().optional(),
  salaryRange: z.string().optional(),
  mainMissions: z.array(z.string()).optional(),
  keySkills: z.array(z.string()).optional(),
  experienceYears: z.number().nonnegative().optional(),
  freeText: z.string().optional(),
  scoringSheet: ScoringSheetSchema.optional(),
});

export const CVAnalysisResultSchema = z.object({
  fileName: z.string().min(1),
  candidateName: z.string().min(1),
  skills: z.array(z.string().min(1)),
  experienceYears: z.number().nonnegative(),
  score: z.number().min(0).max(100),
  summary: z.string().min(1),
  strengths: z.array(z.string().min(1)),
  weaknesses: z.array(z.string()),
  aboveThreshold: z.boolean(),
});

export const CVBatchSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  aboveThreshold: z.number().int().nonnegative(),
  threshold: z.number().min(0).max(100),
  perCV: z.array(CVAnalysisResultSchema),
});

export type CVAnalysisCriteria = z.infer<typeof CVAnalysisCriteriaSchema>;
export type CVAnalysisResult = z.infer<typeof CVAnalysisResultSchema>;
export type CVBatchSummary = z.infer<typeof CVBatchSummarySchema>;

/**
 * Seuil d'acceptation hardcodé pour la Session 4. La spec §6.3 prévoit
 * un slider direct UI en Session 5 ; tant que le réglage n'est pas
 * exposé, on tient sur 75 (cohérent avec les exemples du brief).
 */
export const DEFAULT_CV_THRESHOLD = 75;
