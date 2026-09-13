/**
 * Forme d'une réponse `POST /search` (catégorie `people`) — telle que MESURÉE le
 * 13/09/2026 (docs/specs/sourcing.md §2.1), pas telle que documentée.
 *
 * Tolérante par nécessité (tout est facultatif : un profil sans parcours
 * existe), stricte par construction : `z.object` RETIRE les clés inconnues.
 * Ce que le moteur ajoutera demain (une photo de plus, un champ de contact)
 * n'atteint donc jamais la projection — il n'existe pas pour elle.
 */
import { z } from 'zod';

const Str = z.string().nullish();

const DatesSchema = z.object({ from: Str, to: Str }).nullish();

const WorkEntrySchema = z.object({
  title: Str,
  location: Str,
  dates: DatesSchema,
  company: z.object({ name: Str }).nullish(),
});

const EducationEntrySchema = z.object({
  degree: Str,
  dates: DatesSchema,
  institution: z.object({ name: Str }).nullish(),
});

const PersonPropertiesSchema = z.object({
  name: Str,
  firstName: Str,
  location: Str,
  workHistory: z.array(WorkEntrySchema).nullish(),
  educationHistory: z.array(EducationEntrySchema).nullish(),
});

export const ExaResultSchema = z.object({
  id: Str,
  url: z.string(),
  title: Str,
  publishedDate: Str,
  text: Str,
  highlights: z.array(z.string()).nullish(),
  entities: z.array(z.object({ properties: PersonPropertiesSchema.nullish() })).nullish(),
});
export type ExaResult = z.infer<typeof ExaResultSchema>;

export const ExaSearchResponseSchema = z.object({
  requestId: Str,
  results: z.array(z.unknown()).default([]),
  costDollars: z.object({ total: z.number().nullish() }).nullish(),
});
export type ExaSearchResponse = z.infer<typeof ExaSearchResponseSchema>;
