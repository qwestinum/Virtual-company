import { z } from 'zod';

import { FieldKeySchema } from './field-collection';

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

export type ChipPlacement = z.infer<typeof ChipPlacementSchema>;
export type ChipSet = z.infer<typeof ChipSetSchema>;
export type ManagerResponse = z.infer<typeof ManagerResponseSchema>;
