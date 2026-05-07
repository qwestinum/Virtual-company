import { z } from 'zod';

/**
 * Critères de pré-collecte pour analyse CV en mode tâche isolée
 * (Session 4 — flux ajouté après le routing CV).
 *
 * Sous-ensemble strict de la FDP : 4 champs minimum nécessaires pour
 * que le CV Analyzer ait quelque chose de solide à scorer. Pas de
 * fourchette salariale, pas de localisation, pas de missions — on est
 * sur une analyse atomique, pas un cycle de campagne.
 *
 * Cycle de vie similaire à FDPInProgress : isComplete une fois les 4
 * champs remplis, isValidated une fois le DRH a cliqué le bouton vert
 * « Valider et lancer l'analyse ».
 */

export const ISOLATED_CRITERIA_KEYS = [
  'job_title',
  'seniority',
  'key_skills',
  'experience_years',
] as const;

export const IsolatedCriteriaKeySchema = z.enum(ISOLATED_CRITERIA_KEYS);

export const ISOLATED_CRITERIA_LABELS: Record<
  (typeof ISOLATED_CRITERIA_KEYS)[number],
  string
> = {
  job_title: 'Intitulé du poste',
  seniority: 'Séniorité',
  key_skills: 'Compétences clés',
  experience_years: 'Expérience minimale (années)',
};

export const IsolatedCriteriaFieldStatusValueSchema = z.enum([
  'empty',
  'in_progress',
  'filled',
]);

export const IsolatedCriteriaFieldStatusSchema = z.object({
  key: IsolatedCriteriaKeySchema,
  label: z.string().min(1),
  status: IsolatedCriteriaFieldStatusValueSchema,
  value: z.unknown().optional(),
});

export const IsolatedCriteriaInProgressSchema = z.object({
  taskId: z.string().min(1),
  fields: z.record(
    IsolatedCriteriaKeySchema,
    IsolatedCriteriaFieldStatusSchema,
  ),
  isComplete: z.boolean(),
  isValidated: z.boolean(),
});

export type IsolatedCriteriaKey = z.infer<typeof IsolatedCriteriaKeySchema>;
export type IsolatedCriteriaFieldStatus = z.infer<
  typeof IsolatedCriteriaFieldStatusSchema
>;
export type IsolatedCriteriaInProgress = z.infer<
  typeof IsolatedCriteriaInProgressSchema
>;

export function buildEmptyIsolatedCriteria(
  taskId: string,
): IsolatedCriteriaInProgress {
  const fields = {} as Record<
    IsolatedCriteriaKey,
    IsolatedCriteriaFieldStatus
  >;
  for (const key of ISOLATED_CRITERIA_KEYS) {
    fields[key] = {
      key,
      label: ISOLATED_CRITERIA_LABELS[key],
      status: 'empty',
    };
  }
  return { taskId, fields, isComplete: false, isValidated: false };
}

export function computeIsolatedCriteriaComplete(
  fields: Record<IsolatedCriteriaKey, IsolatedCriteriaFieldStatus>,
): boolean {
  for (const key of ISOLATED_CRITERIA_KEYS) {
    if (fields[key]?.status !== 'filled') return false;
  }
  return true;
}
