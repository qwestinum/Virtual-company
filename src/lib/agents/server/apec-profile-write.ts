/**
 * Exécution du rédacteur de profil APEC (server-only).
 *
 * Tout l'appel modèle passe par `chatCompleteJson` (règle du projet : jamais
 * d'accès direct au SDK) — validation Zod + reprises comprises. Le cadrage et
 * la normalisation sont PURS, dans `apec-profile-prompts.ts`.
 */

import { z } from 'zod';

import {
  APEC_PROFILE_MAX_CHARS,
  APEC_PROFILE_MIN_CHARS,
  buildApecProfileSystemPrompt,
  buildApecProfileUserPrompt,
  normalizeApecProfile,
  type ApecProfileInput,
} from '@/lib/agents/apec-profile-prompts';
import { chatCompleteJson } from '@/lib/ai/provider';

/**
 * Les bornes de longueur vivent dans le SCHÉMA, pas dans un contrôle après
 * coup : un profil trop court se re-demande au modèle (avec l'erreur en clair),
 * il ne se rallonge pas tout seul et ne se tronque jamais.
 */
export const ApecProfileSchema = z.object({
  profil: z
    .string()
    .trim()
    .min(APEC_PROFILE_MIN_CHARS)
    .max(APEC_PROFILE_MAX_CHARS),
});

/**
 * Rédige le profil. Lève (`AIProviderError` / `AIValidationError`) si le
 * service est indisponible ou si le modèle n'a pas tenu le format : l'appelant
 * retombe alors sur le report des compétences clés, jamais sur un champ vide
 * dont personne ne saurait pourquoi il l'est.
 */
export async function writeApecProfile(input: ApecProfileInput): Promise<string> {
  const { data } = await chatCompleteJson(
    [
      { role: 'system', content: buildApecProfileSystemPrompt() },
      { role: 'user', content: buildApecProfileUserPrompt(input) },
    ],
    ApecProfileSchema,
    // Un profil est un texte : la graine fixe et la température 0 du défaut
    // conviennent — deux ouvertures du même panneau donnent le même profil, ce
    // qui vaut mieux qu'un texte qui change sous les yeux du recruteur.
    { maxTokens: 400 },
  );
  return normalizeApecProfile(data.profil);
}
