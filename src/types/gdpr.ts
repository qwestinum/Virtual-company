/**
 * Effacement RGPD — modèle partagé.
 * Procédure : docs/ops/purge-rgpd-candidat.md
 */

/**
 * L'ENSEMBLE D'IDENTIFIANTS d'un candidat, résolu UNE fois au début de la
 * purge. Tout le reste s'y rattache : aucune étape ne relance une recherche
 * par le nom, ce qui est la garantie de non-débordement sur un homonyme
 * (§7.3 de la procédure).
 */
export type ErasureIdentity = {
  /** Adresses normalisées (minuscules) : la principale et ses variantes. */
  emails: string[];
  /** Noms complets tels qu'extraits — servent au caviardage, JAMAIS au ciblage. */
  names: string[];
  phones: string[];

  analysisIds: string[];
  uids: string[];
  /** Couples (boîte, message) reconstitués depuis `can_imap_<boîte>_<uid>`. */
  imapRefs: { mailboxId: string; uid: string }[];
  /** `CAMP-…` et `TASK-…` confondus : ce sont les mêmes dossiers de stockage. */
  campaignIds: string[];
  /** Noms de fichiers de CV, tels que reçus. */
  fileNames: string[];

  vivierIds: string[];
  briefIds: string[];
  validationIds: string[];
  linkTokens: string[];
  bookingIds: string[];
  artifactIds: string[];
  unmatchedIds: string[];
  /** Chemins de stockage connus par la base (les orphelins s'ajoutent après). */
  storagePaths: string[];
};

/** Compteurs par catégorie — le seul contenu de `gdpr_erasure_requests.scope`. */
export type ErasureCounts = {
  analyses: number;
  validations: number;
  interviewBriefs: number;
  vivierDossiers: number;
  bookingLinks: number;
  bookings: number;
  artifactRows: number;
  storageFilesDeleted: number;
  storageFilesRewritten: number;
  unmatchedRows: number;
  retryRows: number;
  journalEntries: number;
};

export const EMPTY_ERASURE_COUNTS: ErasureCounts = {
  analyses: 0,
  validations: 0,
  interviewBriefs: 0,
  vivierDossiers: 0,
  bookingLinks: 0,
  bookings: 0,
  artifactRows: 0,
  storageFilesDeleted: 0,
  storageFilesRewritten: 0,
  unmatchedRows: 0,
  retryRows: 0,
  journalEntries: 0,
};

/** Ce que la purge a trouvé, avant d'agir. */
export type ErasureInventory = {
  identity: ErasureIdentity;
  counts: ErasureCounts;
  /** Déjà traité par une purge antérieure — sert au rejeu (« 0 à effacer »). */
  alreadyErased: ErasureCounts;
  /** Fichiers de stockage repérés, avec ce qu'on compte en faire. */
  storage: StorageTarget[];
};

/**
 * `review` n'est pas un demi-verdict : c'est le refus explicite de trancher
 * seul. Un fichier qui porte le NOM du candidat sans son adresse peut
 * appartenir à un homonyme. L'outil le SIGNALE à l'opérateur au lieu de
 * l'effacer — un effacement de trop est irréversible et frappe quelqu'un qui
 * n'a rien demandé.
 */
export type StorageAction = 'delete' | 'rewrite' | 'review' | 'keep';

export type StorageTarget = {
  path: string;
  action: StorageAction;
  /** Pourquoi cette décision — repris tel quel dans le constat. */
  why: string;
};

/** Résultat d'un contrôle de ré-identification (§7.4). */
export type ReidentificationFinding = {
  /** Chemin tenté : « uid → file d'attente », « analysisId → lien », … */
  path: string;
  location: string;
  /** Ce qui a été retrouvé. Jamais imprimé en clair dans le rapport client. */
  evidence: string;
};

/**
 * Un constat du contrôle. Il NOMME son champ et sa raison : « journal#594 »
 * seul oblige à rouvrir la ligne à la main, « journal#594 · fileNames[0] ·
 * champ non caviardé » se tranche en une seconde. Une alerte qu'on ne peut
 * pas trier finit par ne plus être lue.
 */
export type VerifyFinding = {
  /** Table et clé : `journal#594`. */
  location: string;
  /** Chemin dans la ligne : `payload.fileNames[0]`. */
  field: string;
  /** Ce qui a déclenché : champ du registre, adresse, jeton de nom nommé. */
  trigger: string;
  /** Fragment court. JAMAIS transmis au responsable de traitement. */
  sample: string;
};

/**
 * Une occurrence du NOM du sujet sur une ligne HORS de son périmètre : un
 * homonyme probable, donc la ligne d'un TIERS.
 *
 * ⚠️ Elle ne porte PAS d'extrait, et c'est structurel : recopier la valeur
 * reviendrait à sortir la donnée d'un tiers du système pour la poser dans un
 * fichier d'effacement. Elle dit OÙ regarder, à un humain, sur sa console —
 * le livrable, lui, n'en connaît que le NOMBRE.
 */
export type HomonymWarning = {
  /** Table et clé : `candidate_analyses#…`. Aucune valeur du tiers. */
  location: string;
  /** Colonne concernée. */
  field: string;
  /** Le jeton DU SUJET qui a répondu — jamais la valeur trouvée. */
  trigger: string;
};

export type VerifyOutcome = {
  /**
   * `not_run` n'est pas un échec : c'est le verdict d'un périmètre VIDE, où
   * le contrôle n'a pas d'objet. Il est DISTINCT de `clean` — « je n'ai rien
   * trouvé à contrôler » et « j'ai contrôlé, tout est propre » ne se disent
   * pas de la même façon au responsable de traitement.
   */
  status: VerificationStatus;
  /** Nombre de lignes réellement auditées. Toutes appartiennent au sujet. */
  auditedRows: number;
  /** Occurrences du nom hors du périmètre : homonymes probables, à trancher. */
  homonymWarnings: HomonymWarning[];
  /** La liste d'homonymes a-t-elle été bornée ? Un inventaire tronqué le DIT. */
  homonymsTruncated: boolean;
  /** Résidus dans le périmètre : ce sont des ÉCHECS. */
  residues: VerifyFinding[];
  /** Chemins de ré-identification qui ont abouti : ce sont des ÉCHECS. */
  reidentification: ReidentificationFinding[];
};

/**
 * Verdict du contrôle, tel qu'il est CONSERVÉ avec la trace de la demande.
 * C'est lui qui interdit à un rejeu ultérieur de produire un rapport
 * d'apparence complète alors qu'un contrôle antérieur avait échoué.
 */
export type VerificationStatus = 'clean' | 'residues' | 'not_run';

export type VerificationTrace = {
  status: VerificationStatus;
  checkedAt: string | null;
  residueCount: number;
  reidentificationCount: number;
  homonymCount: number;
  /**
   * Emplacements en échec, SANS extrait : ils désignent une ligne à rouvrir,
   * ils ne recopient pas la donnée qu'on est en train d'effacer.
   */
  locations: string[];
};

export type ErasureStatus = 'dry_run' | 'executed' | 'partial';
