/**
 * Commentaire du recruteur qui motive un verdict final — FACULTATIF depuis le
 * 19/09/2026 — contrat partagé client/serveur. PUR. Spec : docs/specs/compte-rendu-entretien.md §2.3, §14.
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
  /** FACULTATIF (19/09/2026) : absent ou vide ⇒ verdict sans commentaire. */
  comment?: string | null;
};

/** Réponse 200 de la route de verdict. */
export type VerdictResult = {
  status: 'decided';
  verdict: FinalVerdict;
  /** `null` : verdict posé sans commentaire. */
  commentId: string | null;
};

/**
 * Refus de la route, lisible par l'écran : `not_awaiting_verdict` (409) —
 * l'étape a bougé (verdict déjà posé ailleurs, entretien dé-pointé…) : l'écran
 * recharge.
 */
export type VerdictRefusal = { error: 'not_awaiting_verdict'; stage: string };
