/**
 * Exécution serveur de la suggestion de variantes de mots-clés (Phase 3b).
 * Frontière server-only (importe provider.ts). La route
 * /api/scoring/suggest-keyword-variants appelle `runKeywordVariantsSuggestion`.
 */

import { z } from 'zod';

import { chatCompleteJson } from '@/lib/ai/provider';
import {
  buildKeywordVariantsSystemPrompt,
  buildKeywordVariantsUserPrompt,
} from '@/lib/agents/prompts/keyword-variants-suggestion';
import { dedupeVariants } from '@/lib/scoring/variant-selection';
import { VerificationMethodSchema } from '@/types/scoring';

/** Entrée validée (réutilisée par la route pour le 400). */
export const KeywordVariantsRequestSchema = z.object({
  criterionLabel: z.string().min(1).max(120),
  existingKeywords: z.array(z.string()).max(50).default([]),
  targetMethod: VerificationMethodSchema,
});
export type KeywordVariantsRequest = z.infer<typeof KeywordVariantsRequestSchema>;

/** Réponse LLM forcée en JSON. */
const LLMVariantsResponseSchema = z.object({
  variants: z.array(z.string().min(1)).min(1).max(20),
});

export async function runKeywordVariantsSuggestion(
  input: KeywordVariantsRequest,
): Promise<{ suggestedVariants: string[] }> {
  const { data } = await chatCompleteJson(
    [
      { role: 'system', content: buildKeywordVariantsSystemPrompt() },
      {
        role: 'user',
        content: buildKeywordVariantsUserPrompt(
          input.criterionLabel,
          input.existingKeywords,
          input.targetMethod,
        ),
      },
    ],
    LLMVariantsResponseSchema,
    { temperature: 0.5 },
  );

  // Post-traitement PUR : dédup vs existant + inter-variantes, cap à 15.
  return {
    suggestedVariants: dedupeVariants(data.variants, input.existingKeywords),
  };
}
