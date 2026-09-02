/**
 * Registre CANONIQUE des clés de charge utile porteuses d'identité — PUR.
 * Procédure : docs/ops/purge-rgpd-candidat.md §5.2.
 *
 * ─── POURQUOI UN REGISTRE, ET PAS DEUX LISTES ────────────────────────────
 * Le caviardage et le CONTRÔLE lisent la MÊME liste. Deux listes tenues côte
 * à côte auraient divergé, et la divergence aurait été SILENCIEUSE dans les
 * deux sens :
 *   · une clé que le contrôle sait détecter mais que le caviardage ignore
 *     ⇒ un résidu signalé à chaque exécution, jamais traité (c'est
 *     exactement ce qui est arrivé à `fileNames`) ;
 *   · une clé que le caviardage traite mais que le contrôle ignore
 *     ⇒ un effacement déclaré complet sans que rien ne l'ait vérifié.
 * Le test `identity-keys.test.ts` tient les DEUX SENS.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ LA COMPARAISON EST INSENSIBLE À LA CASSE, et ce n'est pas un confort.
 * Le journal écrit `fileName`, `fileNames`, `filename` selon les points
 * d'écriture (poller, rejeu, jobboard). Une comparaison exacte a laissé
 * passer `fileNames` — l'incident de référence : un nom de fichier construit
 * sur l'adresse du candidat (`yvanbisseg_yahoo.fr_PROFIL.pdf`) a survécu à
 * une purge déclarée complète, parce que la clé `filenames` du registre ne
 * répondait pas à la clé `fileNames` de la donnée.
 *
 * ⚠️ UNE CLÉ PEUT PORTER UNE LISTE. `fileNames`, `storedFiles`,
 * `unsupportedFiles` sont des TABLEAUX de chaînes ; `attachments` et
 * `rejectedAttachments` des tableaux d'OBJETS dont la clé interne est
 * `filename`. Le registre porte donc le singulier ET le pluriel : le
 * parcours descend dans les tableaux en conservant la clé du parent (pour
 * les listes de chaînes) et reprend la clé propre de chaque objet (pour les
 * listes d'objets). Les deux formes sont couvertes par construction.
 *
 * SOURCE : balayage exhaustif des 88 clés de charge utile écrites au journal
 * par les 63 points d'appel de `appendJournalEntry` (02/09/2026). Les clés
 * NON retenues et la raison de leur exclusion sont documentées plus bas — un
 * registre qui ne dit pas ce qu'il écarte ne se relit pas.
 */

/** Normalise une clé pour la comparaison : minuscules, sans séparateur. */
function normKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/gu, '');
}

/**
 * Clés systématiquement remplacées EN ENTIER dès qu'elles portent une chaîne
 * non vide, quelle que soit la valeur — c'est la ceinture qui n'a pas besoin
 * de RECONNAÎTRE la donnée pour la retirer.
 */
const IDENTITY_KEYS_RAW = [
  // ── Le candidat, nommé ──
  'candidate', // outreach, jobboard : porte le nom complet
  'candidateName',
  'candidateEmail',
  'email',
  'phone',
  'telephone',
  'nom',
  'prenom',

  // ── Le candidat, expéditeur ou destinataire d'un message ──
  'from',
  'fromAddr',
  'sentTo',
  'subject', // « Candidature — Dev Java » précédé du nom, très souvent

  // ── Le candidat, participant à un rendez-vous ──
  'attendeeName',
  'attendeeEmail',
  'attendeePhone',

  // ── Noms de fichiers : singulier, pluriel, et forme imbriquée ──
  // Un nom de CV est très souvent construit SUR l'adresse ou le nom
  // (`yvanbisseg_yahoo.fr_PROFIL.pdf`, `CV Jean Dupont.pdf`). C'est une
  // donnée personnelle à part entière, pas une métadonnée technique.
  'fileName',
  'fileNames',
  'filename',
  'filenames',
  'analyzedFileName',
  'cvFileName',
  'storedFiles',
  'unsupportedFiles',
  'attachments',
  'rejectedAttachments',

  // ── Chemins de stockage : ils EMBARQUENT le nom de fichier ──
  'storagePath',

  // ── Appréciation rédigée sur la personne ──
  // `summary` (outreach) est la synthèse du CV : c'est un jugement sur un
  // individu, exactement ce que le squelette d'analyse détruit par ailleurs.
  'summary',
] as const;

/**
 * Clés DÉLIBÉRÉMENT hors registre, et pourquoi. Cette liste n'a aucun effet
 * à l'exécution : elle existe pour qu'une relecture puisse contester une
 * exclusion plutôt que de se demander si la clé a simplement été oubliée.
 *
 * · `actorEmail`, `actorUserId`, `by`, `decidedByUserId`, `decidedByUserEmail`,
 *   `organizerEmail`, `organizerUsername` — le RECRUTEUR. Les effacer
 *   supprimerait l'auteur de l'acte, c'est-à-dire la preuve qu'un humain
 *   identifié l'a pris. Cf. `RECRUITER_KEYS`.
 * · `to` — dans `audit_candidat_sent` et `campaign_report_sent`, ce sont les
 *   destinataires INTERNES. Si le candidat venait à y figurer, la ceinture
 *   par VALEUR le rattraperait.
 * · `label` — libellé de la boîte relevée (celle du client), pas du candidat.
 * · `matchTerm`, `jobTitle` — un intitulé de poste ne désigne personne.
 * · `reason`, `error`, `previousReason` — textes libres techniques. Ils ne
 *   sont pas remplacés EN ENTIER (on y perdrait le motif, qui est le fait à
 *   conserver) mais ils sont CAVIARDÉS par la ceinture par valeur si le
 *   candidat y figure.
 * · `uid`, `analysisId`, `mailboxId`, `campaignId`, `messageId`, `taskId`,
 *   `bookingUid`, `token` — identifiants techniques CONSERVÉS de propos
 *   délibéré (§5.3). Le contrôle de ré-identification vérifie qu'ils ne
 *   mènent plus à personne ; les effacer ferait perdre le fil d'audit sans
 *   rien protéger.
 */
export const DELIBERATELY_EXCLUDED_KEYS = [
  'actorEmail', 'actorUserId', 'by', 'decidedByUserId', 'decidedByUserEmail',
  'organizerEmail', 'organizerUsername', 'to', 'label', 'matchTerm', 'jobTitle',
  'reason', 'error', 'previousReason', 'uid', 'analysisId', 'mailboxId',
  'campaignId', 'messageId', 'taskId', 'bookingUid', 'token',
] as const;

const IDENTITY_KEYS = new Set(IDENTITY_KEYS_RAW.map(normKey));

/**
 * Clés qui désignent le RECRUTEUR. Elles sont protégées EXPLICITEMENT : sans
 * cela, `email` couvrirait `actorEmail` le jour où quelqu'un normaliserait
 * les clés en supprimant les préfixes. La ceinture par valeur ne les menace
 * pas (elle ne compare qu'aux empreintes du CANDIDAT), mais la ceinture par
 * clé, elle, ne regarde pas la valeur : c'est ici que la garde doit vivre.
 */
const RECRUITER_KEYS = new Set(
  ['actorEmail', 'actorUserId', 'by', 'decidedByUserId', 'decidedByUserEmail',
   'organizerEmail', 'organizerUsername', 'executedBy', 'instructedBy'].map(normKey),
);

/**
 * Clés dont la valeur est un identifiant TECHNIQUE. Elles ne servent qu'au
 * contrôle, et seulement pour sa branche « homonyme probable » : un jeton, un
 * uuid ou un horodatage qui contiendrait par accident un jeton de nom n'est
 * pas un homonyme, c'est du bruit. Elles ne sont JAMAIS exemptées de la
 * branche « identifiant fort » — une adresse dans un identifiant reste un
 * résidu.
 */
const TECHNICAL_KEYS = new Set(
  ['id', 'uid', 'analysisId', 'mailboxId', 'campaignId', 'messageId', 'providerMessageId',
   'taskId', 'bookingUid', 'bookingId', 'briefId', 'validationId', 'artifactId',
   'unmatchedId', 'candidateId', 'candidateIds', 'vivierId', 'token', 'manageToken',
   'resourceRef', 'eventTypeId', 'startAt', 'createdAt', 'updatedAt', 'baselineUid',
   'batchId', 'requestRef'].map(normKey),
);

export function isIdentityKey(key: string): boolean {
  const k = normKey(key);
  if (RECRUITER_KEYS.has(k)) return false;
  return IDENTITY_KEYS.has(k);
}

export function isRecruiterKey(key: string): boolean {
  return RECRUITER_KEYS.has(normKey(key));
}

export function isTechnicalKey(key: string): boolean {
  return TECHNICAL_KEYS.has(normKey(key));
}

/** Lecture seule, pour les tests d'anti-divergence. */
export function identityKeyNames(): readonly string[] {
  return IDENTITY_KEYS_RAW;
}
