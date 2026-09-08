/**
 * Port générique de publication sur un site d'emploi.
 *
 * ── CE QUE LE PORT SAIT, ET CE QU'IL IGNORE ─────────────────────────────────
 *
 * Il connaît quatre gestes — publier, lire le statut, dépublier, republier — et
 * la forme des issues possibles. Il ne connaît NI l'Apec, NI le SOAP, NI aucun
 * code d'erreur : `AdepSepPublisher` traduit tout cela avant de rendre la main.
 * L'appelant (l'écran, la route) n'a donc jamais à savoir qu'un
 * `API_390_MORE_THAN_ONE_REF_FOUND_ERROR` signifie « elle existe déjà ».
 *
 * Le port est paramétré par le type d'offre parce que chaque plateforme a ses
 * champs obligatoires, et qu'un dénominateur commun les perdrait. Il n'y a
 * qu'un adaptateur pour l'instant, et c'est volontaire : pas de second avant
 * que le premier soit en production.
 *
 * ── LA RÈGLE QUI STRUCTURE TOUT : PUBLIER N'EST PAS IDEMPOTENT ──────────────
 *
 * `openPosition` crée une offre. Rejouer un appel dont on n'a pas vu la réponse
 * en créerait une seconde, et l'Apec n'a aucun moyen de fusionner. La seule
 * chose partagée entre nous et la plateforme est la **référence client** : elle
 * est donc la clé d'idempotence, et l'issue `already_published` existe pour que
 * l'appelant apprenne « c'était déjà fait » sans jamais devoir republier pour
 * s'en assurer.
 *
 * D'où aussi `uncertain`, qui est la seule issue interdisant tout rejeu
 * automatique : elle dit « je ne sais pas si l'offre existe, et je n'ai pas pu
 * le vérifier ». Un humain tranche, en regardant chez la plateforme. La
 * confondre avec `unavailable` — où l'on SAIT que rien n'a été créé — est
 * exactement le raccourci qui fabriquerait des doublons.
 */

/** Issue d'une tentative de publication. */
export type PublishOutcome<TStatus> =
  /** Créée à l'instant. */
  | { kind: 'published'; remoteId: string; status: TStatus | null }
  /**
   * Elle existait déjà sous cette référence, et on est allé la LIRE — soit
   * après un incident de transport, soit parce que la plateforme a répondu
   * « référence déjà prise ». Ce n'est pas un échec.
   */
  | { kind: 'already_published'; remoteId: string; status: TStatus; recovered: true }
  /** La plateforme a examiné l'offre et l'a refusée. Rien n'a été créé. */
  | { kind: 'rejected'; issues: RemoteIssue[] }
  /**
   * L'appel n'a pas abouti et on a PU VÉRIFIER que rien n'existe. Rejouable
   * tel quel.
   */
  | { kind: 'unavailable'; reason: string }
  /**
   * On ne sait pas si l'offre existe. **Ne jamais rejouer automatiquement.**
   * L'appelant journalise, montre la référence, et laisse un humain vérifier.
   */
  | { kind: 'uncertain'; reason: string };

/** Issue d'une lecture de statut. */
export type StatusOutcome<TStatus> =
  | { kind: 'found'; status: TStatus }
  /** La plateforme ne connaît pas cette référence. Réponse VALIDE, pas panne. */
  | { kind: 'not_found' }
  | { kind: 'unavailable'; reason: string };

/** Issue d'un changement d'état (dépublier / republier). */
export type TransitionOutcome<TStatus> =
  | { kind: 'changed'; status: TStatus | null }
  /** Elle y était déjà. La plateforme le dit, ce n'est pas une erreur. */
  | { kind: 'already_in_state' }
  /** Refusé par une règle de la plateforme (fenêtre fermée, état terminal…). */
  | { kind: 'refused'; issues: RemoteIssue[] }
  | { kind: 'unavailable'; reason: string };

/**
 * Un problème remonté par la plateforme, déjà traduit.
 *
 * `code` reste brut : c'est lui qu'on colle au support, et il ne doit jamais
 * être perdu au profit du seul message français.
 */
export type RemoteIssue = {
  /** Code de la plateforme (`330`), ou `null` si elle n'en donne pas. */
  code: string | null;
  /** Phrase montrable à un recruteur. */
  message: string;
  /** Champ de l'offre visé, quand la plateforme le désigne. */
  field?: string;
  /** Bloquant, ou simple remarque. */
  blocking: boolean;
};

/**
 * L'identité d'une offre chez la plateforme. La référence CLIENT est la nôtre
 * et fait foi ; l'identifiant distant est celui de la plateforme.
 */
export type RemoteRef = {
  clientReference: string;
  remoteId?: string | null;
};

export interface JobBoardPublisher<TOffer, TStatus> {
  /** Nom du canal, pour le journal (`apec`). */
  readonly channel: string;

  /**
   * Publie. Ne rejoue JAMAIS d'elle-même : sur incertitude, elle réconcilie
   * par la référence client et rend `already_published` ou `uncertain`.
   */
  publish(offer: TOffer): Promise<PublishOutcome<TStatus>>;

  getStatus(ref: RemoteRef): Promise<StatusOutcome<TStatus>>;

  /** Dépublier. */
  suspend(ref: RemoteRef): Promise<TransitionOutcome<TStatus>>;

  /** Republier — peut être refusé (chez l'Apec, au-delà de 30 jours). */
  republish(ref: RemoteRef): Promise<TransitionOutcome<TStatus>>;
}
