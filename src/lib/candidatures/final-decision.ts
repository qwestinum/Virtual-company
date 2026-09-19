/**
 * Verdict final et commentaire qui le motive — vue de LECTURE. PUR, CLIENT-SAFE.
 * Spec : docs/specs/compte-rendu-entretien.md §4.3, §7.
 *
 * Un seul endroit décide de ce que les lecteurs (PDF d'audit, frise, rapport,
 * dialog de correction) affichent. Trois cas, et aucun n'est tu :
 *   1. le verdict courant a SON commentaire (marqueur gagnant avec `commentId`) ;
 *   2. le verdict a été corrigé depuis : le dernier commentaire écrit reste
 *      montré, AVEC le verdict pour lequel il a été écrit — jamais comme s'il
 *      justifiait le nouveau (`commentMatches: false`) ;
 *   3. verdict antérieur à la règle, ou issu d'une correction sans commentaire :
 *      `comment: null`, que les lecteurs disent (« aucun commentaire
 *      enregistré ») plutôt que de laisser un blanc qui se lirait « pas vérifié ».
 */

import type { ValidationDecisionState } from '@/lib/candidatures/decision-markers';
import type { FinalVerdict, VerdictComment } from '@/types/verdict-comment';

export type FinalDecisionView = {
  verdict: FinalVerdict;
  decidedAt: string;
  comment: VerdictComment | null;
  /**
   * `true` : le commentaire a été écrit pour CE verdict. `false` : il en
   * justifiait un autre, corrigé depuis. Sans objet quand `comment` est nul.
   */
  commentMatches: boolean;
};

export const FINAL_VERDICT_LABELS: Record<FinalVerdict, string> = {
  validated: 'Retenu — GO définitif',
  rejected: 'Non retenu',
};

export function resolveFinalDecisionView(
  state: ValidationDecisionState,
  /** Commentaires de la candidature, dans n'importe quel ordre. */
  comments: VerdictComment[],
): FinalDecisionView | null {
  if (state.effect === null || state.at === null) return null;

  const linked = state.commentId
    ? (comments.find((c) => c.id === state.commentId) ?? null)
    : null;
  const comment = linked ?? latest(comments);

  return {
    verdict: state.effect,
    decidedAt: state.at,
    comment,
    commentMatches: comment !== null && comment.verdict === state.effect,
  };
}

function latest(comments: VerdictComment[]): VerdictComment | null {
  let best: VerdictComment | null = null;
  for (const c of comments) {
    if (!best || c.createdAt > best.createdAt || (c.createdAt === best.createdAt && c.id > best.id)) {
      best = c;
    }
  }
  return best;
}

/**
 * Indicateur du rapport de campagne : combien de verdicts finaux COURANTS
 * portent le commentaire écrit pour eux. Un verdict corrigé sans nouveau
 * commentaire ne compte pas comme motivé — il ne l'est pas.
 */
export function countMotivatedDecisions(
  states: Iterable<ValidationDecisionState>,
): { total: number; motivated: number } {
  let total = 0;
  let motivated = 0;
  for (const s of states) {
    if (s.effect === null) continue;
    total += 1;
    if (s.commentId !== null) motivated += 1;
  }
  return { total, motivated };
}
