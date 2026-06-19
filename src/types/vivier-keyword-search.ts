/**
 * Types de la RECHERCHE PAR MOT-CLÉ du vivier (plein-texte exacte).
 *
 * Fonction STRICTEMENT distincte de la présélection sémantique : elle RETROUVE
 * une chaîne exacte dans le CV intégral (full-text Postgres), sans embedding,
 * sans seuil, sans variante. Elle permet de REPÊCHER manuellement un candidat
 * vers la liste de validation d'une campagne. Voir docs/specs/vivier.md.
 */

/**
 * Présence du candidat dans la liste de validation de la campagne courante :
 *   - `none`       : absent ⇒ bouton « Ajouter à la liste de validation » ;
 *   - `identified` : déjà présent (en attente) ⇒ pas de bouton ;
 *   - `contacted`  : déjà engagé (invité) ⇒ pas de bouton (état terminal) ;
 *   - `rejected`   : rejeté ⇒ bouton « Repêcher » (le repêchage RÉACTIVE).
 */
export type VivierKeywordMembership =
  | 'none'
  | 'identified'
  | 'contacted'
  | 'rejected';

/** Un résultat de recherche mot-clé (org-level), enrichi de sa présence campagne. */
export type VivierKeywordResult = {
  candidateId: string;
  nom: string;
  prenom: string | null;
  /** Titre extrait, repli sur le dernier poste (ancre depth 1). */
  title: string | null;
  /**
   * Extrait du CV contenant le mot cherché, surligné via les sentinelles
   * `[[HL]]…[[/HL]]` (transformées en <mark> côté client APRÈS échappement —
   * jamais de HTML brut injecté).
   */
  snippet: string;
  /** Présence du candidat dans la liste de validation de la campagne. */
  membership: VivierKeywordMembership;
};
