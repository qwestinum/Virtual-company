import { z } from 'zod';

export const IntentSchema = z.enum([
  'new_campaign',
  'campaign_followup',
  'out_of_campaign_task',
  'reporting_request',
  'other',
]);

export const IntentClassificationSchema = z.object({
  intent: IntentSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
  needsClarification: z.boolean(),
  /**
   * Renseigné par le classifier UNIQUEMENT quand une FDP est en cours
   * et que `currentJobTitle` est passé au prompt. Vrai si le DERNIER
   * message DRH évoque un poste manifestement différent du job_title
   * courant (« en fait je veux un développeur ») ; faux quand le DRH
   * continue simplement la collecte sur le poste en cours
   * (« senior », « Paris », « plutôt CDI »).
   *
   * Sert exclusivement à conditionner le dialogue de switch
   * déterministe dans manager.ts. Si non fourni par le LLM, traité
   * comme `false` (pas de switch).
   */
  isDistinctNewCampaign: z.boolean().optional(),
});

export type Intent = z.infer<typeof IntentSchema>;
export type IntentClassification = z.infer<typeof IntentClassificationSchema>;
