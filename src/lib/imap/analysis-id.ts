/**
 * Identifiant d'analyse d'une candidature reçue par mail.
 *
 * `can_imap_<boîte>_<uid>` — la forme historique, extraite ici parce qu'elle
 * a cessé d'être un détail du poller : c'est la CLÉ D'IDEMPOTENCE du lien de
 * réservation natif, et la seule des deux qui soit globalement unique.
 *
 * L'uid IMAP seul ne l'est pas : il est unique PAR BOÎTE, et une campagne peut
 * en associer plusieurs (`campaign_mailboxes` est une table n:n). Deux
 * candidats de deux boîtes différentes peuvent donc porter l'uid `102` sur la
 * même campagne — d'où le préfixe par boîte, et d'où l'existence de ce
 * fichier plutôt que trois recopies de la même interpolation.
 */
export function imapAnalysisId(mailboxId: string, uid: string | number): string {
  return `can_imap_${mailboxId}_${uid}`;
}
