import { z } from 'zod';

import { FieldKeySchema } from './field-collection';
import { IsolatedCriteriaKeySchema } from './isolated-criteria';

export const ChipPlacementSchema = z.enum([
  'below_bubble',
  'above_input',
  'inline',
]);

export const ChipSetSchema = z.object({
  placement: ChipPlacementSchema,
  options: z.array(z.string().min(1)).min(2).max(5),
});

export const ManagerResponseSchema = z.object({
  message: z.string().min(1),
  chips: ChipSetSchema.optional(),
  fieldExtractions: z.partialRecord(FieldKeySchema, z.unknown()).optional(),
  /**
   * Champ FDP que CE tour PROPOSE/demande (celui que vise un éventuel chip
   * « Ajuster »). Permet à l'UI de savoir quel UNIQUE champ éditer en place,
   * sans le deviner depuis `fieldExtractions` (qui contient tout l'extrait).
   * Obligatoire côté prompt en MODE PROPOSITION ; optionnel ici (fallback).
   * `.catch(undefined)` : une valeur hors enum (hallucination LLM) est
   * ignorée plutôt que de faire échouer tout le tour.
   */
  proposalField: FieldKeySchema.optional().catch(undefined),
});

/**
 * Variante de réponse Manager pour la pré-collecte des critères CV
 * isolés. Mêmes shape (message + chips + fieldExtractions) mais
 * fieldExtractions est typé sur les 4 clés isolées au lieu des 8
 * clés FDP. Fichier séparé du runtime serveur pour rester importable
 * client-side comme type.
 */
export const IsolatedManagerResponseSchema = z.object({
  message: z.string().min(1),
  chips: ChipSetSchema.optional(),
  fieldExtractions: z
    .partialRecord(IsolatedCriteriaKeySchema, z.unknown())
    .optional(),
});

export type ChipPlacement = z.infer<typeof ChipPlacementSchema>;
export type ChipSet = z.infer<typeof ChipSetSchema>;
export type ManagerResponse = z.infer<typeof ManagerResponseSchema>;
export type IsolatedManagerResponse = z.infer<
  typeof IsolatedManagerResponseSchema
>;
