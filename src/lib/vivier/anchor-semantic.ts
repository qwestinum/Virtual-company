/**
 * Bloc 2 sémantique MULTI-ANCRES (présélection Vivier — Phase 2).
 *
 * Le Bloc 2 ne compare plus l'intitulé du poste au seul titre déclaré (souvent
 * bruité), mais à CHAQUE ancre du candidat (déclaré + 2 derniers postes). Les
 * cosinus par ancre sont calculés en SQL (RPC `match_vivier_anchors`) ; ce module
 * applique la logique de décision, PURE et testée :
 *
 *   - PORTE D'ENTRÉE = cosinus BRUT : une ancre admet le candidat si sa
 *     similarité brute ≥ `floor` (proximité de rôle ; un titre déclaré pollué ne
 *     plombe plus l'admission puisqu'un poste propre peut ouvrir la porte).
 *   - SCORE = cosinus × DÉCOTE d'ancienneté (`anchorWeight(depth)`) : le rôle
 *     courant prime, le rôle passé est repêché mais légèrement en dessous.
 *   - On retient l'ancre au meilleur SCORE décoté parmi celles qui passent la
 *     porte ; son `depth` sert à l'explicabilité (libellé d'ancre).
 */

import { anchorWeight } from '@/lib/vivier/title-anchors';

/** Une similarité brute par ancre (sortie du RPC). */
export type AnchorSimilarity = { depth: number; similarity: number };

/** Meilleure ancre retenue au Bloc 2. */
export type AnchorSemanticMatch = {
  /** Score = cosinus brut × décote (clé de classement, alimente finalScore). */
  similarity: number;
  /** Cosinus brut de l'ancre retenue (avant décote). */
  rawSimilarity: number;
  /** Profondeur de l'ancre retenue (0/1/2) — explicabilité + décote. */
  depth: number;
};

/**
 * Choisit la meilleure ancre : admission sur le cosinus BRUT ≥ `floor`, score
 * = brut × décote, meilleur score décoté retenu. null si aucune ancre n'atteint
 * le seuil (candidat non qualifié au Bloc 2). Liste vide ⇒ null.
 */
export function pickBestAnchor(
  perAnchor: AnchorSimilarity[],
  weights: number[],
  floor: number,
): AnchorSemanticMatch | null {
  let best: AnchorSemanticMatch | null = null;
  for (const a of perAnchor) {
    if (a.similarity < floor) continue; // porte sur le BRUT
    const decayed = a.similarity * anchorWeight(a.depth, weights);
    if (!best || decayed > best.similarity) {
      best = { similarity: decayed, rawSimilarity: a.similarity, depth: a.depth };
    }
  }
  return best;
}
