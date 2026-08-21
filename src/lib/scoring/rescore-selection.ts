/**
 * Repérage des analyses scorées sous le veto du pré-filtre. Pur, testé.
 *
 * Le 21/08/2026, un mot-clé absent valait « non ». Les analyses produites sous
 * cette règle portent une signature reconnaissable, et c'est elle qu'on lit ici
 * — pas une date, pas une version de fiche : la trace de ce qui s'est
 * réellement passé, critère par critère.
 *
 *   verdict NÉGATIF + méthode à mots-clés + AUCUN mot-clé trouvé
 *   + chemin ≠ `llm`  ⇒  ce critère a été refusé sans que le CV soit lu.
 *
 * La dernière condition est ce qui rend le repérage stable dans le temps :
 * depuis le correctif, un même critère refusé porte `decidedBy: 'llm'` et
 * n'entre plus dans la sélection. Le jour où le parc sera réparé, cette
 * fonction ne trouvera plus rien — et c'est le seul critère d'arrêt honnête.
 */

import type { CriterionDecision } from '@/types/scoring';

/** Les critères d'une analyse qui ont été éteints sans lecture du CV. */
export function criteriaDecidedWithoutReading(
  breakdown: CriterionDecision[],
): CriterionDecision[] {
  return breakdown.filter(
    (b) =>
      b.llmDecision === 'non' &&
      b.decidedBy !== 'llm' &&
      b.verificationMethodUsed !== undefined &&
      b.verificationMethodUsed !== 'llm_with_quote' &&
      (b.matchedKeywords ?? []).length === 0,
  );
}

/**
 * Ce qu'on a le droit de faire d'une analyse touchée.
 *
 *   - `replayable` : personne n'a tranché, rien n'est parti d'irréversible —
 *     on peut recalculer sans effacer d'acte.
 *   - `human_decided` : un humain a décidé en connaissance de cause. On
 *     SIMULE, on n'écrase pas : une décision prise vaut plus qu'un calcul
 *     refait, et rouvrir un dossier clos ferait plus de dégâts que le défaut.
 *   - `dismissed` : classée sans suite, terminal orthogonal — même règle.
 *   - `reject_sent` : zone `auto_reject`, la valeur LEGACY qui marque les
 *     refus RÉELLEMENT PARTIS sans validation, avant la bascule RGPD du
 *     18/08/2026. Le dossier n'a pas été tranché par un humain, mais le
 *     candidat, lui, a reçu un mail : recalculer son score ne le dé-refuse
 *     pas, et un score qui remonte en silence donnerait l'illusion que
 *     l'affaire est réglée. Ces cas-là appellent une décision humaine — vis-à-
 *     vis du candidat, pas de la base — et sont donc SIMULÉS, jamais appliqués
 *     automatiquement.
 */
export type RescoreEligibility =
  | 'replayable'
  | 'human_decided'
  | 'dismissed'
  | 'reject_sent';

export type AnalysisState = {
  decidedBy: string | null;
  dismissedAt: string | null;
  /** Zone figée au scoring. `auto_reject` ⇒ un refus est parti (legacy). */
  decisionZone: string | null;
};

export function rescoreEligibility(state: AnalysisState): RescoreEligibility {
  if (state.dismissedAt !== null) return 'dismissed';
  if (state.decidedBy === 'user') return 'human_decided';
  if (state.decisionZone === 'auto_reject') return 'reject_sent';
  return 'replayable';
}

/**
 * Plafond atteignable si les critères éteints avaient été jugés satisfaits.
 * Sert à ORDONNER la réparation (les dossiers qui pouvaient franchir le seuil
 * d'abord), jamais à conclure : seul le modèle, en relisant, dira la vérité.
 */
export function potentialCeiling(
  breakdown: CriterionDecision[],
  currentScore: number,
): number {
  const totalWeight = breakdown.reduce((s, b) => s + b.weight, 0);
  if (totalWeight === 0) return currentScore;
  const lost = criteriaDecidedWithoutReading(breakdown).reduce(
    (s, b) => s + b.weight,
    0,
  );
  return Math.min(100, Math.round(currentScore + (lost / totalWeight) * 100));
}
