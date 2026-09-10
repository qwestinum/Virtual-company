/**
 * Exécution du rédacteur des textes d'offre APEC (server-only).
 *
 * Tout l'appel modèle passe par `chatCompleteJson` (règle du projet : jamais
 * d'accès direct au SDK) — validation Zod et reprises comprises. Le cadrage et
 * la normalisation sont PURS, dans `apec-offer-text-prompts.ts`.
 */

import { z } from 'zod';

import {
  apecTextBounds,
  buildApecOfferTextSystemPrompt,
  buildApecOfferTextUserPrompt,
  normalizeApecText,
  type ApecOfferTextInput,
  type ApecTextBounds,
} from '@/lib/agents/apec-offer-text-prompts';
import { chatCompleteJson } from '@/lib/ai/provider';
import { ADEP_LIMITS } from '@/lib/jobboards/adep/validate';

/**
 * Les bornes de longueur sont CELLES DE L'APEC, portées par le schéma — pas un
 * contrôle après coup, et pas une borne maison. Un texte hors bornes se
 * re-demande au modèle (avec l'erreur en clair) ; il ne se tronque jamais.
 */
export function apecOfferTextSchema(bounds: ApecTextBounds) {
  return z.object({
    descriptif: z
      .string()
      .trim()
      .min(bounds.descriptionMin)
      .max(bounds.descriptionMax),
    profil: z.string().trim().min(bounds.profileMin).max(bounds.profileMax),
  });
}

/** Le schéma aux bornes brutes de l'Apec — celui que les tests éprouvent. */
export const ApecOfferTextSchema = apecOfferTextSchema(
  apecTextBounds(ADEP_LIMITS),
);

export type ApecOfferText = {
  positionDescription: string;
  profileDescription: string;
};

/**
 * Rédige les deux textes. Lève (`AIProviderError` / `AIValidationError`) si le
 * service est indisponible ou si le modèle n'a pas tenu le format : l'appelant
 * garde alors le report des listes de la fiche, jamais un champ vide dont
 * personne ne saurait pourquoi il l'est.
 */
export async function writeApecOfferText(
  input: ApecOfferTextInput,
  /**
   * Caractères à laisser libres dans le descriptif pour la mention RGPD que
   * l'appelant apposera ensuite. Le cadrage ET le schéma s'alignent dessus.
   */
  reservedForMention = 0,
): Promise<ApecOfferText> {
  const bounds = apecTextBounds(ADEP_LIMITS, reservedForMention);
  const { data } = await chatCompleteJson(
    [
      { role: 'system', content: buildApecOfferTextSystemPrompt(bounds) },
      { role: 'user', content: buildApecOfferTextUserPrompt(input) },
    ],
    apecOfferTextSchema(bounds),
    // Deux textes d'environ 150 mots : le budget doit les contenir tous les
    // deux, sinon la réponse est coupée et le JSON invalide.
    // Température 0 et graine fixe (défauts) : deux ouvertures du même panneau
    // donnent le même texte, ce qui vaut mieux qu'une offre qui change sous les
    // yeux du recruteur.
    { maxTokens: 1_600 },
  );
  return {
    positionDescription: normalizeApecText(data.descriptif),
    profileDescription: normalizeApecText(data.profil),
  };
}
