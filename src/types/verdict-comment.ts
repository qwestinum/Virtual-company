/**
 * Commentaire du recruteur qui motive un verdict final — contrat partagé
 * client/serveur. PUR. Spec : docs/specs/compte-rendu-entretien.md §2.3, §14.
 *
 * AJOUT SEUL : un commentaire ne se modifie jamais (déclencheur en base). Il
 * porte le verdict POUR LEQUEL il a été écrit : un verdict corrigé ensuite ne
 * le fait pas passer pour la justification du nouveau.
 */

export type FinalVerdict = 'validated' | 'rejected';

export type VerdictComment = {
  id: string;
  analysisId: string;
  uid: string;
  campaignId: string | null;
  /** Le verdict pour lequel ce commentaire a été écrit. */
  verdict: FinalVerdict;
  body: string;
  /** Identité de SESSION serveur ; `null` = non enregistrée (jamais inventée). */
  authorUserId: string | null;
  authorEmail: string | null;
  createdAt: string;
};

/** Corps de `POST /api/candidatures/[id]/verdict`. */
export type VerdictRequest = {
  status: FinalVerdict;
  comment: string;
};

/** Réponse 200 de la route de verdict. */
export type VerdictResult = {
  status: 'decided';
  verdict: FinalVerdict;
  commentId: string;
};

/**
 * Refus de la route, lisibles par l'écran :
 *   - `comment_too_thin` (400) — le commentaire n'a pas le minimum de sens ;
 *   - `not_awaiting_verdict` (409) — l'étape a bougé (verdict déjà posé
 *     ailleurs, entretien dé-pointé…) : l'écran recharge.
 */
export type VerdictRefusal =
  | { error: 'comment_too_thin'; message: string }
  | { error: 'not_awaiting_verdict'; stage: string };
