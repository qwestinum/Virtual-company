/**
 * CE QU'ON PROPOSE À LA CRÉATION — et rien d'autre.
 *
 * Deux listes, et aucune n'est recopiée à la main : elles se DÉRIVENT des
 * référentiels du domaine. Une liste tenue en parallèle finirait par diverger,
 * et la divergence serait muette — un flux devenu opérationnel resterait
 * invisible, ou un flux inerte continuerait d'être offert.
 */

import { CV_SOURCE_OPERATIONAL, CV_SOURCES } from '@/types/cv-source';
import {
  PUBLICATION_CHANNEL_ORDER,
  type PublicationChannel,
} from '@/types/publication-channel';

/**
 * ⚠️ On ne propose à la CRÉATION que ce qui fonctionne vraiment. Un flux inerte
 * offert à quelqu'un qui monte sa campagne, c'est lui promettre des
 * candidatures qui n'arriveront pas. La liste vient de `CV_SOURCE_OPERATIONAL`
 * et non d'une copie : le jour où un flux devient opérationnel, il apparaît
 * ici sans qu'on y touche.
 */
export const FLUX_OFFERTS = CV_SOURCES.filter((s) => CV_SOURCE_OPERATIONAL[s]);

/** Les deux canaux réellement diffusables aujourd'hui. */
export const CANAUX_ACTIFS: readonly PublicationChannel[] = ['apec', 'generic'];
/**
 * LinkedIn est RETIRÉ de la création (rien ne le publie), les autres sont
 * montrés avec « bientôt » : masquer une destination qu'on prépare laisserait
 * croire qu'elle n'existera jamais.
 */
export const CANAUX_OFFERTS = PUBLICATION_CHANNEL_ORDER.filter((c) => c !== 'linkedin');
export const CANAUX_BIENTOT = CANAUX_OFFERTS.filter((c) => !CANAUX_ACTIFS.includes(c));
