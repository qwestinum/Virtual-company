/**
 * Sous-onglet « Propositions de refus » — QUI y figure.
 *
 * Depuis la mise en conformité RGPD (18/08/2026), **aucun refus ne part sans un
 * humain** : la zone sous le seuil bas n'envoie plus rien, elle met en file.
 * Ces candidatures-là — et elles seules — peuplent le sous-onglet.
 *
 * ⚠️ LA PARTITION SE LIT SUR LA ZONE FIGÉE AU SCORING
 * (`candidate_analyses.decision_zone`), **jamais** en recomparant le score au
 * seuil courant de la campagne. Les seuils bougent ; la zone d'une candidature
 * déjà analysée, non — c'est la règle du modèle (« le changement s'applique aux
 * prochaines candidatures, on ne reclasse pas les CV déjà analysés »).
 *
 * Le défaut que cette règle corrige a été observé : une candidature analysée en
 * ZONE GRISE, donc « à examiner », s'est retrouvée dans les propositions de
 * refus après un simple déplacement du seuil bas. Comparer au seuil courant
 * revient à re-juger un dossier avec un barème qu'il n'a jamais connu.
 *
 * Deux réglages différents, à ne pas confondre :
 *   - le seuil bas DÉCIDE de la zone, au moment de l'analyse ;
 *   - la zone, une fois posée, DÉCIDE du sous-onglet, pour toujours.
 *
 * Fonctions PURES (aucun accès base).
 */

import type { DecisionZone } from '@/types/hitl';

/**
 * Une validation en attente est-elle PROPOSÉE au refus ?
 *
 * Uniquement si sa zone d'analyse est `proposed_reject`. Une zone absente
 * (ligne orpheline, analyse jamais persistée, ligne antérieure au modèle) n'est
 * JAMAIS proposée : on ne propose pas un refus sur une donnée qu'on n'a pas —
 * elle reste dans « À examiner », où un humain la regarde.
 *
 * `auto_reject` (LEGACY) n'y figure pas non plus : sous l'ancien régime, ces
 * refus étaient partis tout seuls sans jamais passer par la file. Une ligne de
 * file portant cette zone est une anomalie, pas une proposition.
 */
export function isRejectionProposal(
  zone: DecisionZone | null | undefined,
): boolean {
  return zone === 'proposed_reject';
}

/**
 * Partition de la file d'attente en deux sous-onglets.
 *
 * PARTITION STRICTE : toute validation est dans exactement une des deux listes.
 * C'est l'invariant qui protège le sous-onglet « À examiner » — il ne perd
 * rien. Une zone inconnue, une analyse introuvable, une acceptation en attente
 * restent dans `toExamine`, jamais escamotées.
 *
 * Une validation dont la décision proposée est `accept` n'est JAMAIS proposée
 * au refus, quelle que soit sa zone : elle a été mise en file comme une
 * acceptation, la basculer dans une fournée de refus inverserait un jugement
 * déjà porté.
 */
export function partitionRejectionProposals<
  V extends {
    id: string;
    decision: 'accept' | 'reject';
  },
>(
  validations: readonly V[],
  /** Zone d'analyse par identifiant de validation (clé = `V.id`). */
  zoneByValidation: Readonly<Record<string, DecisionZone | null | undefined>>,
): { proposals: V[]; toExamine: V[] } {
  const proposals: V[] = [];
  const toExamine: V[] = [];
  for (const v of validations) {
    const proposed =
      v.decision === 'reject' && isRejectionProposal(zoneByValidation[v.id]);
    (proposed ? proposals : toExamine).push(v);
  }
  return { proposals, toExamine };
}

/**
 * Tri des propositions : score DÉCROISSANT.
 *
 * Les plus hauts scores sont ceux qui frôlent le seuil — les cas limites, ceux
 * qu'on regrette de refuser sans les avoir regardés. Ils passent donc en tête,
 * là où l'œil s'arrête. Les scores les plus bas, eux, sont ceux dont le refus
 * ne fait aucun doute : les enfouir en fin de liste est sans risque.
 * Départage stable par id pour un rendu déterministe.
 */
export function sortRejectionProposals<
  V extends { id: string; score: number | null },
>(proposals: readonly V[]): V[] {
  return [...proposals].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id),
  );
}

