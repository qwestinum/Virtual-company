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
  fieldExtractions: z.record(FieldKeySchema, z.unknown()).optional(),
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
    .record(IsolatedCriteriaKeySchema, z.unknown())
    .optional(),
});

export type ChipPlacement = z.infer<typeof ChipPlacementSchema>;
export type ChipSet = z.infer<typeof ChipSetSchema>;
export type ManagerResponse = z.infer<typeof ManagerResponseSchema>;
export type IsolatedManagerResponse = z.infer<
  typeof IsolatedManagerResponseSchema
>;
