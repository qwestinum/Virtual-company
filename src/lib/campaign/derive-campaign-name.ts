/**
 * Le nom d'une campagne SUIT l'intitulé du poste — source de vérité unique, et
 * c'est pour ça qu'on ne le saisit jamais deux fois.
 *
 * Le champ `job_title` de la fiche de poste PRIME (il a pu être édité après
 * coup) ; on retombe sur l'intitulé saisi à l'entrée s'il a été vidé, puis sur
 * un défaut. Pur — testé.
 *
 * Extrait de `CampaignCreateSheet` quand l'assistant (lot 5) l'a remplacée :
 * l'assistant n'avait aucune raison d'importer un helper depuis un composant
 * devenu mort.
 */

import type { FDPInProgress } from '@/types/field-collection';

export function deriveCampaignName(
  fdp: FDPInProgress,
  step1Title: string,
): string {
  const editedTitle =
    typeof fdp.fields.job_title?.value === 'string'
      ? fdp.fields.job_title.value.trim()
      : '';
  return editedTitle || step1Title.trim() || 'Nouvelle campagne';
}
