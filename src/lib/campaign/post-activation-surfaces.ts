/**
 * Ce qui ne s'ouvre qu'une fois la campagne ACTIVE.
 *
 * Deux surfaces de la campagne agissent sur le monde extérieur : publier une
 * annonce (jobboard de démonstration, apec.fr) et présélectionner dans le
 * vivier — la présélection débouche sur des invitations à candidater. Les
 * proposer sur une campagne encore en brouillon serait inviter des candidats
 * dont les CV ne seraient PAS analysés à l'arrivée : le chemin email exige une
 * campagne `active`. On les ouvre donc après l'activation, jamais avant.
 *
 * Recensé ICI et nulle part ailleurs : l'écran de création lit un brouillon
 * (canaux + flux en état local) et l'écran post-création lit la campagne
 * enregistrée. Deux listes tenues en parallèle finiraient par diverger — une
 * surface s'ouvrirait d'un côté sans que l'autre garde la feuille ouverte pour
 * la montrer. Pur — testé.
 */

import type { CVSource } from '@/types/cv-source';
import type { PublicationChannel } from '@/types/publication-channel';

/**
 * Canaux porteurs d'un CONTENU réellement publié quelque part — l'ordre est
 * celui de l'affichage. Les autres canaux ne sont qu'une intention de
 * diffusion : il n'y a rien à rédiger.
 */
export const CHANNELS_WITH_CONTENT: PublicationChannel[] = ['generic', 'apec'];

export function hasChannelContent(channel: PublicationChannel): boolean {
  return CHANNELS_WITH_CONTENT.includes(channel);
}

export type PostActivationSurfaces = {
  /** Canaux dont l'annonce se rédige et se publie (dans l'ordre canonique). */
  contentChannels: PublicationChannel[];
  /** Présélection vivier — proposée seulement si le flux vivier est actif. */
  vivier: boolean;
  /** Y a-t-il quelque chose à faire après l'activation ? */
  any: boolean;
};

export function listPostActivationSurfaces(
  channels: readonly PublicationChannel[],
  sources: readonly CVSource[],
): PostActivationSurfaces {
  // L'ordre vient de CHANNELS_WITH_CONTENT, pas de l'ordre de sélection du
  // DRH : deux campagnes aux mêmes canaux montrent le même écran.
  const contentChannels = CHANNELS_WITH_CONTENT.filter((c) =>
    channels.includes(c),
  );
  const vivier = sources.includes('vivier');
  return {
    contentChannels,
    vivier,
    any: contentChannels.length > 0 || vivier,
  };
}
