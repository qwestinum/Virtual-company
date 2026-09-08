/**
 * La référence client — clé d'idempotence chez l'Apec. PUR.
 *
 * `ProfileId` fait au plus 20 caractères et doit être unique chez l'Apec **à
 * jamais** : la réutiliser rend `API_390_MORE_THAN_ONE_REF_FOUND_ERROR`.
 *
 * `CAMP-YYYY-NNN` fait 13 caractères, et c'est la MÊME chaîne qui voyage dans
 * l'objet des mails de candidature, sur le jobboard de démonstration et dans
 * ORQA. Le fil de traçabilité reste entier : un recruteur qui voit
 * `CAMP-2026-288` sur apec.fr retrouve la campagne sans traduction.
 *
 * ── LA REPUBLICATION EXIGE UNE RÉFÉRENCE NEUVE ──────────────────────────────
 *
 * Une offre fermée ne se rouvre pas : il faut en créer une autre, donc une
 * autre référence. Le suffixe est le RANG de la tentative, comme la génération
 * `analysisId#r2` du module de réservation : ré-émettre avec la clé d'origine
 * rendrait fidèlement un refus.
 *
 * `CAMP-2026-288-2` fait 15 caractères, `-999` en fait 17 : on reste sous la
 * borne même au millième essai, ce qui n'arrivera jamais mais évite d'avoir à
 * y penser.
 */

/** Longueur maximale d'un `ProfileId` (API_309). */
export const CLIENT_REFERENCE_MAX = 20;

/**
 * Référence de la n-ième tentative pour une campagne. `attempt` commence à 1,
 * et la première ne porte AUCUN suffixe — la référence nominale reste
 * exactement l'identifiant de campagne.
 */
export function buildClientReference(campaignId: string, attempt: number): string {
  const base = campaignId.trim();
  if (attempt <= 1) return base;
  return `${base}-${attempt}`;
}

/**
 * La référence tient-elle dans la borne ? Rendu à l'écran AVANT publication.
 *
 * Un identifiant de campagne inhabituellement long (import, reprise d'un autre
 * outil) ferait échouer la publication sur un code que rien ne laisse deviner.
 * Mieux vaut le dire avant.
 */
export function isClientReferenceValid(reference: string): boolean {
  const value = reference.trim();
  return value.length > 0 && value.length <= CLIENT_REFERENCE_MAX;
}

/**
 * Rang de la prochaine tentative, à partir des références DÉJÀ utilisées pour
 * cette campagne. PUR — la liste vient de la base, la règle est ici.
 *
 * On compte les lignes plutôt que de lire le plus grand suffixe : une ligne
 * dont la référence a été saisie à la main (reprise d'une offre créée sur
 * apec.fr) n'a pas forcément notre forme, et une lecture de suffixe la
 * manquerait — puis réattribuerait une référence déjà prise.
 */
export function nextAttempt(existingReferences: readonly string[]): number {
  return existingReferences.length + 1;
}
