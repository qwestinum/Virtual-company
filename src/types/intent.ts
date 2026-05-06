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
});

export type Intent = z.infer<typeof IntentSchema>;
export type IntentClassification = z.infer<typeof IntentClassificationSchema>;
