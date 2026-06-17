/**
 * Décision de sauvegarde d'une édition inline de fiche de poste (pure, testée).
 *
 * Extrait de `FDPEditBlock.onSave` pour rendre la règle vérifiable hors React.
 * Deux invariants métier :
 *
 *  1. L'INTITULÉ de la campagne SUIT le champ `job_title` édité (source de
 *     vérité unique). Repli sur le nom courant si le titre est vidé.
 *  2. Une édition ne DÉVALIDE une FDP que si elle a RÉGRESSÉ : un champ requis
 *     auparavant rempli redevient vide. Sinon on PRÉSERVE la validation
 *     acquise — un simple changement de titre ne renvoie pas une campagne
 *     validée en brouillon. (Une FDP jamais validée se valide dès qu'elle
 *     devient complète.)
 */

import {
  computeIsComplete,
  FIELD_KEYS,
  type FDPInProgress,
} from '@/types/field-collection';

export function resolveFdpEditSave(
  previous: FDPInProgress,
  draft: FDPInProgress,
  currentName: string,
): { finalFdp: FDPInProgress; name: string } {
  const isComplete = computeIsComplete(draft.fields);
  const wasValidated = previous.isValidated;
  const regressed = FIELD_KEYS.some((key) => {
    const before = previous.fields[key];
    const after = draft.fields[key];
    return (
      before?.required === true &&
      before.status === 'filled' &&
      after?.status !== 'filled'
    );
  });
  const isValidated = wasValidated ? !regressed : isComplete;
  const editedTitle =
    typeof draft.fields.job_title?.value === 'string'
      ? draft.fields.job_title.value.trim()
      : '';
  return {
    finalFdp: { ...draft, isComplete, isValidated },
    name: editedTitle || currentName,
  };
}
