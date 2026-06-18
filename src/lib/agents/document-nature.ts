/**
 * Reconnaissance LÉGÈRE de la nature d'un document déposé (server-only).
 *
 * Ce n'est PAS une extraction : on classe seulement le document pour router la
 * réaction du Manager (lecture seule). Trois natures utiles :
 *   - `cv`            : le CV d'une personne → analysable (capacité autorisée).
 *   - `appel_offres`  : appel d'offres / fiche de poste / brief de recrutement
 *                       → à utiliser dans le menu Campagnes, JAMAIS analysé ni
 *                       comptabilisé comme un CV.
 *   - `autre`         : tout le reste → pas un CV, on n'analyse pas.
 *
 * Le statut `illisible` (texte non extractible) est posé par la route appelante,
 * pas par ce classifieur.
 *
 * Provider via l'abstraction `chatCompleteJson` (OpenAI par défaut).
 */

import { z } from 'zod';

import { chatCompleteJson } from '@/lib/ai/provider';

export const DOCUMENT_NATURES = ['cv', 'appel_offres', 'autre'] as const;
export const DocumentNatureSchema = z.object({
  nature: z.enum(DOCUMENT_NATURES),
  /** Justification courte (une phrase) — utile au debug, non affichée. */
  raison: z.string().catch(''),
});
export type DocumentNatureResult = z.infer<typeof DocumentNatureSchema>;

/** On classe sur le début du document : la nature se lit dès les premières lignes. */
const MAX_CLASSIFY_CHARS = 4000;

function buildSystemPrompt(): string {
  return [
    "Tu classes la NATURE d'un document RH déposé dans un chat. Tu ne l'analyses pas en détail : tu décides seulement de quel type de document il s'agit.",
    '',
    'Trois natures possibles :',
    "- \"cv\" : le CV / curriculum vitae d'UNE personne (parcours, expériences, formation, compétences, coordonnées d'un individu candidat).",
    '- "appel_offres" : un appel d\'offres, une fiche de poste, une annonce ou un brief de recrutement (décrit un POSTE à pourvoir : missions, profil recherché, « nous recherchons », contrat, rémunération du poste).',
    '- "autre" : tout le reste (contrat, facture, présentation, note, document sans rapport avec une candidature ou un poste).',
    '',
    "Distinction clé : un CV parle d'UNE personne et de SON parcours ; un appel d'offres décrit un poste que l'entreprise cherche à POURVOIR. En cas de doute entre cv et appel_offres, regarde si le document présente un individu (cv) ou un besoin de recrutement (appel_offres).",
    '',
    'Réponds STRICTEMENT en JSON : { "nature": "cv" | "appel_offres" | "autre", "raison": "<une phrase>" }.',
  ].join('\n');
}

/**
 * Classe la nature d'un document à partir de son TEXTE déjà extrait. Lève
 * `AIProviderError` / `AIValidationError` (l'appelant traduit). Pure côté
 * effets : aucune écriture, aucune persistance.
 */
export async function detectDocumentNature(
  text: string,
): Promise<DocumentNatureResult> {
  const clipped = text.slice(0, MAX_CLASSIFY_CHARS);
  const { data } = await chatCompleteJson(
    [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: `Document à classer :\n"""\n${clipped}\n"""`,
      },
    ],
    DocumentNatureSchema,
    { temperature: 0 },
  );
  return data;
}
