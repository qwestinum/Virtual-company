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
  /**
   * Intitulé du nouveau poste mentionné EXPLICITEMENT dans le dernier
   * message DRH, le cas échéant. Sert de garde-fou côté serveur : on
   * ne déclenche le switch dialog que si le LLM a pu nommer un poste
   * concret distinct du courant. Empêche les faux positifs sur des
   * messages courts ou ambigus (« ok », « oui », « senior ») où le
   * LLM pourrait pourtant retourner isDistinctNewCampaign=true à tort.
   *
   * `null` ou absent quand aucun poste n'est explicitement nommé.
   * Le LLM est instruit de N'EXTRAIRE QUE depuis le dernier message,
   * jamais depuis l'historique.
   */
  candidateNewJobTitle: z.string().min(1).nullable().optional(),
});

export type Intent = z.infer<typeof IntentSchema>;
export type IntentClassification = z.infer<typeof IntentClassificationSchema>;
