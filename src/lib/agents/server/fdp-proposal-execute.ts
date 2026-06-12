/**
 * Exécution serveur de la proposition de fiche de poste (création directe d'une
 * campagne). Frontière server-only (importe provider.ts).
 *
 * À partir d'un intitulé, le LLM propose une valeur par champ. On valide
 * tolérant (énums `.catch`, listes coercées), on coerce les types attendus par
 * la FDP (missions/skills → string[], autres → string), et on force `job_title`
 * à la valeur fournie par le DRH. Calqué sur `runScoringProposal`.
 */

import { z } from 'zod';

import { chatComplete } from '@/lib/ai/provider';
import {
  ContractTypeSchema,
  SenioritySchema,
  type FieldKey,
} from '@/types/field-collection';

import {
  buildFdpProposalSystemPrompt,
  buildFdpProposalUserPrompt,
} from '../fdp-proposal-prompts';

export class FdpProposalError extends Error {
  constructor(
    public readonly code:
      | 'invalid_response_json'
      | 'invalid_response_shape',
    message: string,
  ) {
    super(message);
    this.name = 'FdpProposalError';
  }
}

/** Liste tolérante : array de strings OU une string unique (coercée). */
const StringListSchema = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .catch(undefined);

/** Schéma du JSON produit par le LLM. Tolérant : un champ invalide est écarté
 *  (`.catch(undefined)`) sans rejeter la proposition entière. */
const LLMFdpResponseSchema = z.object({
  fields: z.object({
    seniority: SenioritySchema.optional().catch(undefined),
    contract_type: ContractTypeSchema.optional().catch(undefined),
    location: z.string().optional().catch(undefined),
    salary_range: z.string().optional().catch(undefined),
    start_date: z.string().optional().catch(undefined),
    main_missions: StringListSchema,
    key_skills: StringListSchema,
  }),
});

export type FdpProposalMetrics = {
  durationMs: number;
  tokensUsed: number;
  costEstimate: number;
};

export type FdpProposalOutput = {
  fields: Partial<Record<FieldKey, unknown>>;
  metrics: FdpProposalMetrics;
};

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cleanList(value: string[] | string | undefined): string[] | undefined {
  if (value == null) return undefined;
  const arr = Array.isArray(value) ? value : [value];
  const cleaned = arr
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

export async function runFdpProposal(args: {
  jobTitle: string;
  known?: Partial<Record<FieldKey, unknown>>;
}): Promise<FdpProposalOutput> {
  const jobTitle = args.jobTitle.trim();

  const completion = await chatComplete({
    model: 'gpt-4o',
    jsonMode: true,
    temperature: 0.4,
    messages: [
      { role: 'system', content: buildFdpProposalSystemPrompt() },
      { role: 'user', content: buildFdpProposalUserPrompt(jobTitle, args.known) },
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(completion.content);
  } catch (err) {
    throw new FdpProposalError(
      'invalid_response_json',
      err instanceof Error ? err.message : 'Unparseable FDP proposal JSON.',
    );
  }

  let parsed: z.infer<typeof LLMFdpResponseSchema>;
  try {
    parsed = LLMFdpResponseSchema.parse(raw);
  } catch (err) {
    throw new FdpProposalError(
      'invalid_response_shape',
      err instanceof Error ? err.message : 'FDP proposal shape invalid.',
    );
  }

  const f = parsed.fields;
  const fields: Partial<Record<FieldKey, unknown>> = {};
  // job_title : toujours forcé à la valeur du DRH, jamais au gré du LLM.
  if (jobTitle) fields.job_title = jobTitle;
  if (f.seniority) fields.seniority = f.seniority;
  if (f.contract_type) fields.contract_type = f.contract_type;
  const location = cleanString(f.location);
  if (location) fields.location = location;
  const salary = cleanString(f.salary_range);
  if (salary) fields.salary_range = salary;
  const start = cleanString(f.start_date);
  if (start) fields.start_date = start;
  const missions = cleanList(f.main_missions);
  if (missions) fields.main_missions = missions;
  const skills = cleanList(f.key_skills);
  if (skills) fields.key_skills = skills;

  return {
    fields,
    metrics: {
      durationMs: completion.durationMs,
      tokensUsed: completion.usage.totalTokens,
      costEstimate: completion.costEstimate,
    },
  };
}
