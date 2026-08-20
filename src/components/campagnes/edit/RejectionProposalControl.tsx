/**
 * ⚠️ FICHIER MORT — à supprimer :
 * `rm src/components/campagnes/edit/RejectionProposalControl.tsx`.
 *
 * A porté, quelques heures le 18/08/2026, un réglage « seuil de proposition de
 * refus » distinct des deux seuils de décision. Contresens : ce seuil EST le
 * seuil bas lui-même. Depuis la mise en conformité RGPD, la zone sous le seuil
 * bas n'envoie plus rien — elle propose. Il n'y a donc rien de plus à régler
 * ici, le bloc de seuils (`DecisionThresholdsBlock`) dit tout.
 *
 * Vidé plutôt que laissé en place : un composant orphelin encore compilable
 * finit toujours par être ré-importé « puisqu'il existe ».
 */
export {};
