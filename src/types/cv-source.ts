/**
 * Sources de réception de CV (Phase 3.2 — Publisher-ready).
 *
 * Une source représente un canal d'arrivée de CV vers le système :
 *   - `manual`  : le DRH téléverse via le trombone (toujours opérationnel)
 *   - autres    : un PublicationChannel qui a aussi un flux entrant
 *                 (LinkedIn API, Indeed scraping, WTTJ via webhook, etc.)
 *                 Ces flux automatiques seront branchés plus tard via le
 *                 futur agent Publisher (MCP / API). Pour Session 4,
 *                 ils sont représentés dans l'UI mais non opérationnels.
 *
 * La configuration de sources d'une campagne est portée par un block
 * UI `cv-sources-picker` (chat-store). Le DRH peut activer/désactiver
 * chaque source ; les sources des channels choisis pour les annonces
 * sont activées par défaut.
 */

import { z } from 'zod';

import {
  PublicationChannelSchema,
  type PublicationChannel,
} from './publication-channel';

export const CV_SOURCE_MANUAL = 'manual';
export const CV_SOURCE_EMAIL = 'email';
export const CV_SOURCE_LOCAL_FOLDER = 'local_folder';

export const CVSourceSchema = z.union([
  z.literal(CV_SOURCE_MANUAL),
  z.literal(CV_SOURCE_EMAIL),
  z.literal(CV_SOURCE_LOCAL_FOLDER),
  PublicationChannelSchema,
]);
export type CVSource = z.infer<typeof CVSourceSchema>;

/**
 * Ordre d'affichage dans le picker. Manual en tête, puis les sources
 * « hors réseau » (mail + dossier local) à configurer plus tard, puis
 * les réseaux de publication branchables au Publisher.
 */
export const CV_SOURCES: CVSource[] = [
  'manual',
  'email',
  'local_folder',
  'linkedin',
  'indeed',
  'welcome_to_the_jungle',
  'apec',
  'france_travail',
  // 'generic' n'a pas de flux entrant — pas une plateforme spécifique.
];

export const CV_SOURCE_LABELS: Record<CVSource, string> = {
  manual: 'Upload manuel',
  email: 'Boîte mail générique',
  local_folder: 'Emplacement local',
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  welcome_to_the_jungle: 'Welcome to the Jungle',
  apec: 'APEC',
  france_travail: 'France Travail',
  generic: 'Générique',
};

export const CV_SOURCE_HINTS: Record<CVSource, string> = {
  manual: 'Téléverser les CV via le trombone',
  email: 'Réception auto depuis une boîte mail configurée',
  local_folder: 'Surveillance d\'un dossier local (à configurer)',
  linkedin: 'Réception auto via LinkedIn (Publisher — bientôt)',
  indeed: 'Réception auto via Indeed (Publisher — bientôt)',
  welcome_to_the_jungle:
    'Réception auto via Welcome to the Jungle (Publisher — bientôt)',
  apec: 'Réception auto via APEC (Publisher — bientôt)',
  france_travail: 'Réception auto via France Travail (Publisher — bientôt)',
  generic: '',
};

/**
 * Sources opérationnelles en Session 4. Les autres sont affichées mais
 * non fonctionnelles (placeholders à configurer plus tard ou via le
 * futur Publisher).
 */
export const CV_SOURCE_OPERATIONAL: Record<CVSource, boolean> = {
  manual: true,
  // Round 5 — IMAP polling opérationnel. Une boîte mail configurée
  // dans /settings/mailboxes peut être associée à une campagne pour
  // déclencher l'analyse automatique des CV reçus par email.
  email: true,
  local_folder: false,
  linkedin: false,
  indeed: false,
  welcome_to_the_jungle: false,
  apec: false,
  france_travail: false,
  generic: false,
};

/**
 * Construit la config par défaut d'une cv-sources-picker à partir des
 * channels choisis pour les annonces. Règle :
 *   - `manual` toujours activé par défaut (filet de sécurité),
 *   - chaque channel choisi → source homonyme activée par défaut,
 *   - les autres sources de la liste sont présentes mais désactivées.
 */
export function buildDefaultSourcesConfig(
  publishedChannels: PublicationChannel[],
): Record<CVSource, boolean> {
  const config = {} as Record<CVSource, boolean>;
  for (const source of CV_SOURCES) {
    config[source] = false;
  }
  // `manual` toujours actif par défaut. `email` et `local_folder`
  // restent désactivés tant que le DRH ne les a pas configurés.
  config.manual = true;
  for (const channel of publishedChannels) {
    if (channel === 'generic') continue;
    config[channel] = true;
  }
  return config;
}
