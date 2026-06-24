import { z } from 'zod';

export const FIELD_KEYS = [
  'job_title',
  'seniority',
  'contract_type',
  'location',
  'salary_range',
  'start_date',
  'main_missions',
  'key_skills',
] as const;

export const FieldKeySchema = z.enum(FIELD_KEYS);

export const FIELD_LABELS: Record<(typeof FIELD_KEYS)[number], string> = {
  job_title: 'Intitulé du poste',
  seniority: 'Séniorité',
  contract_type: 'Type de contrat',
  location: 'Localisation',
  salary_range: 'Fourchette salariale',
  start_date: 'Date cible de prise de poste',
  main_missions: 'Missions principales',
  key_skills: 'Compétences clés',
};

export const SenioritySchema = z.enum(['junior', 'confirmé', 'senior']);

// Options prédéfinies du type de contrat. Les 4 valeurs historiques (CDI, CDD,
// freelance, stage) sont CONSERVÉES telles quelles (rétro-compat des données +
// sortie LLM) ; on ajoute les contrats français courants. Le champ est désormais
// MULTI-VALEUR + saisie libre — lecture/canonicalisation dans
// `src/lib/fdp/contract-type.ts` (`asContractList`/`joinContracts`).
export const ContractTypeSchema = z.enum([
  'CDI',
  'CDD',
  'alternance',
  'apprentissage',
  'intérim',
  'stage',
  'freelance',
  'portage salarial',
  'CDI de chantier',
]);

export const FieldStatusValueSchema = z.enum(['empty', 'in_progress', 'filled']);

export const FieldStatusSchema = z.object({
  key: FieldKeySchema,
  label: z.string().min(1),
  status: FieldStatusValueSchema,
  value: z.unknown().optional(),
  required: z.boolean(),
});

export const FDPInProgressSchema = z.object({
  campaignId: z.string().min(1),
  fields: z.record(FieldKeySchema, FieldStatusSchema),
  isComplete: z.boolean(),
  isValidated: z.boolean(),
});

export type FieldKey = z.infer<typeof FieldKeySchema>;
export type Seniority = z.infer<typeof SenioritySchema>;
export type ContractType = z.infer<typeof ContractTypeSchema>;
export type FieldStatusValue = z.infer<typeof FieldStatusValueSchema>;
export type FieldStatus = z.infer<typeof FieldStatusSchema>;
export type FDPInProgress = z.infer<typeof FDPInProgressSchema>;

export function buildEmptyFDP(campaignId: string): FDPInProgress {
  const fields = {} as Record<FieldKey, FieldStatus>;
  for (const key of FIELD_KEYS) {
    fields[key] = {
      key,
      label: FIELD_LABELS[key],
      status: 'empty',
      required: true,
    };
  }
  return {
    campaignId,
    fields,
    isComplete: false,
    isValidated: false,
  };
}

export function computeIsComplete(
  fields: Record<FieldKey, FieldStatus>,
): boolean {
  for (const key of FIELD_KEYS) {
    const field = fields[key];
    if (!field) return false;
    if (field.required && field.status !== 'filled') return false;
  }
  return true;
}
