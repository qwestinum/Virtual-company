/**
 * TOUTE GRILLE QUI NE VIENT PAS DE LA MAIN DU RECRUTEUR ARRIVE EN ATTENTE DE
 * CONFIRMATION — quel que soit le chemin qui l'a remplie.
 *
 * ⚠️ Le drapeau `suggere` n'était posé que par UN chemin : le document déposé.
 * « Proposer la grille » et la reprise d'une campagne comparable le
 * contournaient, et leurs critères entraient donc comme s'ils avaient été
 * écrits par le recruteur — aucun bandeau, aucune confirmation, et le
 * garde-fou d'activation (`countUntreatedSuggestions`) restait muet. Une grille
 * décide qui est écarté : elle ne doit jamais s'installer sans un regard.
 *
 * Pur, testé. Le point d'application est ici, et seulement ici : trois
 * chemins qui posent le drapeau chacun de leur côté finiraient par diverger, et
 * le quatrième l'oublierait.
 */

import type { ScoringCriterion } from '@/types/scoring';

/**
 * Marque TOUS les critères reçus comme « suggérés », donc à confirmer ou à
 * écarter, un par un ou d'un geste par le bandeau qui les chapeaute.
 *
 * ⚠️ TOUS, sans exception — y compris ceux qu'une campagne d'archive portait
 * déjà confirmés. Une confirmation donnée il y a six mois sur un AUTRE poste
 * n'est pas une confirmation pour celui-ci : ce qui est repris est une
 * proposition, pas un acquis.
 *
 * La fonction ne s'applique qu'à une grille qui ARRIVE (modèle, archive,
 * document). Une grille déjà à l'écran et déjà tranchée ne repasse pas par ici.
 */
export function markAsSuggested(
  criteria: readonly ScoringCriterion[],
): ScoringCriterion[] {
  return criteria.map((c) => ({ ...c, suggere: true }));
}
