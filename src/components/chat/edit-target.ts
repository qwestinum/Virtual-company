/**
 * Résolution DÉTERMINISTE du champ que « Ajuster » doit éditer pour une bulle
 * Manager. Doctrine « le LLM propose, le code verrouille » : le bon
 * fonctionnement d'« Ajuster » ne doit PAS dépendre de ce que le LLM a pensé à
 * renseigner (`proposalField`), qu'il oublie aléatoirement — typiquement sur
 * l'intitulé du poste ou les champs longs (missions / compétences), ce qui fait
 * retomber la réponse sur le bandeau fallback « Continuer / Ajuster » sans
 * aucune cible. Sans cette résolution, le clic « Ajuster » paraît inopérant.
 */

import type { ChatMessage } from '@/stores/chat-store';
import {
  FIELD_KEYS,
  type FDPInProgress,
  type FieldKey,
} from '@/types/field-collection';

/**
 * Clés des champs à éditer, par ordre de priorité :
 *   1. `proposalField` explicite (le LLM a désigné le champ proposé) ;
 *   2. sinon, les champs extraits ce tour (une valeur a été proposée ET
 *      appliquée à la FDP → on édite ces champs-là) ;
 *   3. sinon (AUCUN ancrage : le Manager a posé une question sans proposer de
 *      valeur, ou le LLM a tout oublié) → le champ EN COURS de collecte, soit
 *      le premier non rempli. Comme aucune valeur n'a été appliquée dans ce
 *      cas, ce champ est exactement celui que la bulle évoque.
 *
 * Renvoie `[]` quand la FDP est complète et qu'aucun ancrage n'existe : il n'y
 * a alors rien à proposer en place (l'appelant déplie la checklist).
 *
 * Pure : aucune lecture de store ni de DOM — tout passe par les arguments,
 * ce qui la rend testable et garantit que « ouvrable » et « champs affichés »
 * ne peuvent pas diverger (l'origine du bug précédent).
 */
export function resolveEditableFieldKeys(
  message: Pick<ChatMessage, 'proposalField' | 'proposedExtractions'>,
  fdp: FDPInProgress,
): FieldKey[] {
  if (message.proposalField && fdp.fields[message.proposalField]) {
    return [message.proposalField];
  }
  const extracted = (
    Object.keys(message.proposedExtractions ?? {}) as FieldKey[]
  ).filter((k) => fdp.fields[k]);
  if (extracted.length > 0) return extracted;
  const target = FIELD_KEYS.find((k) => fdp.fields[k]?.status !== 'filled');
  return target ? [target] : [];
}
