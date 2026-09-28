/**
 * Message au candidat après décision — contrat partagé client/serveur. PUR.
 * Branche feat/feedback-candidat (28/09/2026).
 *
 * Au moment d'une décision qui clôt une candidature reçue en entretien (retenu,
 * non retenu, absent, sans suite), le recruteur choisit l'un de deux gestes,
 * l'un des deux obligatoire : ENVOYER le message (gabarit pré-rempli, relu,
 * retouchable) ou PRÉVENIR LUI-MÊME (téléphone, messagerie personnelle, autre).
 * Jamais le silence, jamais l'envoi forcé.
 *
 * ⚠️ Le commentaire du recruteur (`verdict_comments`) n'est JAMAIS une source
 * de ce message : aucun type de ce module ne peut le recevoir.
 */

/** Le gabarit d'origine, donc la situation annoncée au candidat. */
export const FEEDBACK_KINDS = ['retenu', 'non_retenu', 'absent', 'sans_suite'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** `mail` = envoyé par ORQA ; les autres = « je préviens moi-même ». */
export const FEEDBACK_CHANNELS = ['mail', 'telephone', 'mail_personnel', 'autre'] as const;
export type FeedbackChannel = (typeof FEEDBACK_CHANNELS)[number];

export const SELF_FEEDBACK_CHANNELS = ['telephone', 'mail_personnel', 'autre'] as const;
export type SelfFeedbackChannel = (typeof SELF_FEEDBACK_CHANNELS)[number];

/**
 * Statut d'un envoi. `pending` = ligne écrite, envoi non confirmé (jamais lu
 * comme « envoyé »). `duplicate` = un message du même type était déjà parti
 * pour cette candidature (verrou d'envoi) : rien n'est reparti.
 */
export type FeedbackMailStatus =
  | 'pending'
  | 'sent'
  | 'duplicate'
  | 'send_failed'
  | 'skipped_no_email'
  | 'skipped_no_config';

export type CandidateFeedback = {
  id: string;
  analysisId: string;
  uid: string;
  campaignId: string | null;
  kind: FeedbackKind;
  channel: FeedbackChannel;
  /** Précision libre du canal (« autre ») ; jamais le contenu d'un échange. */
  channelNote: string | null;
  /** Objet et corps TELS QU'ENVOYÉS — `null` hors canal `mail`. */
  subject: string | null;
  body: string | null;
  /** `null` hors canal `mail`. */
  mailStatus: FeedbackMailStatus | null;
  sentAt: string | null;
  /** Identité de SESSION serveur ; `null` = non enregistrée (jamais inventée). */
  authorUserId: string | null;
  authorEmail: string | null;
  createdAt: string;
};

/**
 * Le choix posé avec une décision — champ du corps des routes de décision.
 * `send` porte le message tel que relu à l'écran ; `self` le canal choisi.
 */
export type FeedbackChoice =
  | { mode: 'send'; subject: string; body: string }
  | { mode: 'self'; channel: SelfFeedbackChannel; note?: string | null };

/** Libellés courts d'écran (lexique). */
export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  retenu: 'Retenu',
  non_retenu: 'Non retenu',
  absent: 'Absent',
  sans_suite: 'Sans suite',
};

export const FEEDBACK_CHANNEL_LABELS: Record<FeedbackChannel, string> = {
  mail: 'Message envoyé par ORQA',
  telephone: 'Téléphone',
  mail_personnel: 'Messagerie personnelle',
  autre: 'Autre',
};

/**
 * Le candidat est-il INFORMÉ par cette ligne ? Un « je préviens moi-même »
 * compte (le recruteur l'a déclaré) ; un envoi ne compte que s'il est parti.
 * `duplicate` compte : un message du même type était déjà parti.
 */
export function feedbackInforms(f: Pick<CandidateFeedback, 'channel' | 'mailStatus'>): boolean {
  if (f.channel !== 'mail') return true;
  return f.mailStatus === 'sent' || f.mailStatus === 'duplicate';
}

/** Réponse de `GET /api/candidatures/[id]/feedback-proposal`. */
export type FeedbackProposal = {
  kind: FeedbackKind;
  /** Gabarit des Réglages — rendu CÔTÉ ÉCRAN (la prochaine étape se saisit en direct). */
  template: string;
  vars: {
    prenom: string;
    jobTitle: string;
    organisation: string;
    recruiterFirstName: string;
    recruiterName: string;
    /** Phrase [motif] d'un « sans suite » ; absente sinon. */
    motif?: string;
  };
  /** Destinataire ; `null` ⇒ seul « je préviens moi-même » est possible. */
  candidateEmail: string | null;
  /** Adresse où arriveront les réponses (Reply-To). */
  replyTo: string | null;
  /** Mention d'information apposée en pied, hors gabarit — montrée, non éditable. */
  rgpdFooter: string;
  /** Un message du même type a déjà informé le candidat (rien ne repartirait). */
  alreadyInformed: { channel: FeedbackChannel; at: string } | null;
};
