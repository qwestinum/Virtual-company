/**
 * Extracteur de pré-remplissage de campagne (server-only).
 *
 * LIT un document (appel d'offres ou notes de réunion) et en extrait un
 * brouillon de campagne — champs FACTUELS + pondérations SUGGÉRÉES. Couche
 * COMMUNE aux deux chemins de création (formulaire + chat Manager). Aucune
 * persistance ici : on rend l'objet structuré, l'humain valide ensuite.
 *
 * À NE PAS CONFONDRE avec le Job Writer (qui GÉNÈRE une fiche de poste) :
 * ici on ne crée rien, on relève ce qui est ÉCRIT dans le document.
 *
 * Provider via l'abstraction `chatCompleteJson` (OpenAI par défaut, Anthropic
 * routable) — validation Zod + retry intégrés.
 */

import {
  CampaignPrefillSchema,
  type CampaignPrefill,
  SUGGESTABLE_LEVELS,
} from '@/types/campaign-prefill';
import { chatCompleteJson } from '@/lib/ai/provider';

/** Borne le texte envoyé au LLM (un document de cadrage tient largement). */
const MAX_DOCUMENT_CHARS = 24_000;

function buildSystemPrompt(): string {
  return [
    "Tu es un assistant RH qui LIT un document de cadrage de recrutement (appel d'offres structuré OU notes de réunion décousues) et en extrait, SANS RIEN INVENTER, les éléments d'une campagne.",
    '',
    'RÈGLES ABSOLUES :',
    "- Tu extrais UNIQUEMENT ce qui est présent dans le document. Un champ non trouvé → value: null. Tu n'inventes ni ne déduis JAMAIS une valeur absente.",
    "- Information contradictoire (ex. « 45K… non 50 ») : retiens la DERNIÈRE mention et renseigne `conflit` pour la signaler comme à vérifier.",
    "- `extraitSource` = le passage EXACT du document qui justifie la valeur (copié tel quel, court). null si la valeur est null.",
    '',
    'DEUX CATÉGORIES :',
    "A) FACTUELS (extraction directe) : jobTitle (intitulé), contractType (CDI/CDD/freelance/stage si écrit), location, salaryRange (seulement si un salaire est ÉCRIT), seniority (junior/confirmé/senior), startDate, mainMissions (liste — inclus-y le descriptif du poste s'il y en a un), keySkills (compétences attendues, liste).",
    "B) PONDÉRATIONS SUGGÉRÉES (ton jugement) : suggestedCriteria — propose les critères que le document MET EN AVANT, avec un niveau d'importance. Ce sont des SUGGESTIONS, jamais des paramètres actifs.",
    `   Niveaux autorisés UNIQUEMENT : ${SUGGESTABLE_LEVELS.join(', ')} (du plus fort au plus faible).`,
    '',
    'HORS PÉRIMÈTRE ABSOLU — ne produis JAMAIS :',
    "- de seuil d'acceptation de campagne ;",
    '- de critère « rédhibitoire » ou « obligatoire » (flags éliminatoires) : ces leviers sont réservés à la saisie humaine. Même si le document dit « impératif », classe au plus haut en « critique », jamais en éliminatoire.',
    '',
    "Réponds STRICTEMENT par un objet JSON conforme au schéma demandé, sans texte autour.",
  ].join('\n');
}

function buildUserPrompt(documentText: string): string {
  const clipped = documentText.slice(0, MAX_DOCUMENT_CHARS);
  return [
    'Voici le document de cadrage à analyser :',
    '"""',
    clipped,
    '"""',
    '',
    'Extrais le pré-remplissage de campagne (champs factuels + pondérations suggérées) en respectant les règles. Champ absent → null.',
  ].join('\n');
}

/**
 * Extrait un `CampaignPrefill` depuis le TEXTE d'un document déjà extrait
 * (PDF/DOCX via `extractCVText`, ou texte brut). Déterministe (temperature 0
 * par défaut côté `chatCompleteJson`). Lève `AIProviderError` (transport) ou
 * `AIValidationError` (schéma non respecté après retries) — l'appelant traduit.
 */
export async function extractCampaignPrefill(
  documentText: string,
): Promise<CampaignPrefill> {
  const { data } = await chatCompleteJson(
    [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(documentText) },
    ],
    CampaignPrefillSchema,
  );
  return data;
}
