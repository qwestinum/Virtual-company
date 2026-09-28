/**
 * Réglages des messages candidat d'entretien (acceptation+invitation, refus).
 * Portés par AppSettings (colonne jsonb `interview_config`). Mécanisme
 * répliqué du vivier (§9) : templates ÉDITABLES en settings, rendus de manière
 * DÉTERMINISTE à l'envoi (plus de génération LLM à la volée).
 *
 * Simplification de l'invitation à l'entretien : le message d'acceptation ne
 * contient AUCUNE info de RDV (date/heure/lieu/durée/interlocuteur). Il porte
 * un unique [lien d'agenda] (Calendly/Cal.com) sur lequel le candidat choisit
 * lui-même son créneau. Le lien est une config AU NIVEAU ORGANISATION, posée
 * une fois ici ; sans lui, l'envoi d'une acceptation est bloqué.
 */

import { z } from 'zod';

/** Schéma de validation (source unique, consommé par /api/settings). */
export const InterviewConfigSchema = z.object({
  /** Template du message d'acceptation + invitation à l'entretien. */
  acceptanceTemplate: z.string().min(1).max(5000),
  /** Template du message de refus candidat. */
  rejectionTemplate: z.string().min(1).max(5000),
  /**
   * Template du message « choisir un NOUVEAU créneau » — envoyé quand un
   * rendez-vous déjà pris tombe (le cabinet décale, ou le candidat a annulé).
   *
   * Il existe pour une raison précise : réutiliser le message d'acceptation
   * annoncerait une seconde fois au candidat qu'il est retenu, alors qu'il le
   * sait et qu'il avait déjà un créneau. `[intro]` porte le fait — qui a
   * décalé, et quand — et il est écrit par le code, pas par le modèle.
   *
   * `.default` : les configurations enregistrées avant ce champ restent
   * valides et reçoivent le texte par défaut.
   */
  rescheduleTemplate: z
    .string()
    .min(1)
    .max(5000)
    .default(() => DEFAULT_INTERVIEW_RESCHEDULE_TEMPLATE),
  /**
   * Lien d'agenda (Calendly/Cal.com) injecté dans [lien d'agenda]. Au niveau
   * organisation. VIDE ⇒ l'envoi d'une acceptation est bloqué (« lien d'agenda
   * non configuré dans les paramètres »). Chaîne libre (URL validée à l'envoi)
   * pour tolérer une sauvegarde des autres réglages avant d'avoir le lien.
   */
  /**
   * Template de l'invitation envoyée à un profil du VIVIER invité depuis une
   * campagne (28/09/2026). Ce n'est pas une acceptation : la personne n'a pas
   * postulé à ce poste. Le message parle d'une OPPORTUNITÉ, et `[origine]`
   * (écrit par le code) dit d'où vient la sollicitation.
   * `.default` : une configuration enregistrée avant ce champ reste valide.
   */
  vivierInvitationTemplate: z
    .string()
    .min(1)
    .max(5000)
    .default(() => DEFAULT_VIVIER_INVITATION_TEMPLATE),
  agendaLink: z.string().max(2048),
  /** Nom de l'organisation, injecté dans [organisation]. Vide ⇒ repli. */
  organisationName: z.string().max(200),
  /** Nom du recruteur signataire, injecté dans [nom du recruteur]. Vide ⇒ repli. */
  recruiterName: z.string().max(200),
  /**
   * Import de transcription d'entretien pour proposer un compte rendu
   * (docs/specs/compte-rendu-entretien.md §9, §14.4). Activé par défaut ;
   * un DPO client peut refuser que ses entretiens transitent par le
   * fournisseur de modèle — éteint, le bouton d'import disparaît et le compte
   * rendu reste rédigeable à la main. `.default` : une configuration
   * enregistrée avant ce champ reste valide.
   */
  transcriptImportEnabled: z.boolean().default(true),
  /**
   * Messages au candidat APRÈS DÉCISION (feat/feedback-candidat, 28/09/2026).
   * Proposés au recruteur au moment de la décision, pré-remplis, relus et
   * retouchables avant envoi. Variables : [prénom], [intitulé du poste],
   * [organisation], [prénom du recruteur], [nom du recruteur], et selon le
   * gabarit [prochaine étape] (retenu) ou [motif] (sans suite).
   * ⚠️ Le commentaire du recruteur n'est PAS une variable, et ne le sera pas.
   * `.default` : une configuration enregistrée avant ces champs reste valide.
   */
  feedbackRetainedTemplate: z
    .string()
    .min(1)
    .max(5000)
    .default(() => DEFAULT_FEEDBACK_RETAINED_TEMPLATE),
  feedbackNotRetainedTemplate: z
    .string()
    .min(1)
    .max(5000)
    .default(() => DEFAULT_FEEDBACK_NOT_RETAINED_TEMPLATE),
  feedbackNoShowTemplate: z
    .string()
    .min(1)
    .max(5000)
    .default(() => DEFAULT_FEEDBACK_NO_SHOW_TEMPLATE),
  feedbackDismissedTemplate: z
    .string()
    .min(1)
    .max(5000)
    .default(() => DEFAULT_FEEDBACK_DISMISSED_TEMPLATE),
});

export type InterviewConfig = z.infer<typeof InterviewConfigSchema>;

/**
 * Template par défaut du message de NOUVEAU CRÉNEAU. Il ne réannonce pas la
 * sélection : le candidat l'a déjà reçue, et la lui répéter au moment où on
 * lui prend son créneau sonnerait faux.
 */
export const DEFAULT_INTERVIEW_RESCHEDULE_TEMPLATE = [
  'Bonjour [prénom],',
  '',
  '[intro]',
  '',
  'Vous pouvez choisir un nouveau créneau qui vous convient ici : [lien d’agenda]',
  '',
  'Merci de votre compréhension, et au plaisir d’échanger avec vous.',
  '',
  'Bien cordialement,',
  '[nom du recruteur]',
  '[organisation]',
].join('\n');

/**
 * Template par défaut du message d'ACCEPTATION + invitation à l'entretien.
 * Variables résolues à l'envoi. AUCUNE info de RDV — un unique [lien d'agenda]
 * que le candidat utilise pour choisir son créneau.
 */
export const DEFAULT_INTERVIEW_ACCEPTANCE_TEMPLATE = [
  'Bonjour [prénom],',
  '',
  'Votre candidature au poste de [intitulé du poste] a retenu toute notre attention, et nous serions ravis de vous rencontrer en entretien.',
  '',
  'Pour convenir d’un créneau, je vous invite à choisir directement le moment qui vous convient le mieux via notre agenda en ligne : [lien d’agenda]',
  '',
  'Au plaisir d’échanger avec vous très prochainement.',
  '',
  'Bien cordialement,',
  '[nom du recruteur]',
  '[organisation]',
].join('\n');

/**
 * Template par défaut de l'invitation d'un profil du VIVIER. Jamais « votre
 * candidature est retenue » : la personne n'a pas postulé à ce poste.
 */
export const DEFAULT_VIVIER_INVITATION_TEMPLATE = [
  'Bonjour [prénom],',
  '',
  '[origine]',
  '',
  'Nous recrutons aujourd’hui pour le poste de [intitulé du poste], et votre parcours correspond à ce que nous recherchons. Nous serions ravis d’échanger avec vous au sujet de cette opportunité.',
  '',
  'Si elle vous intéresse, vous pouvez choisir directement le créneau qui vous convient via notre agenda en ligne : [lien d’agenda]',
  '',
  'Au plaisir d’échanger avec vous.',
  '',
  'Bien cordialement,',
  '[nom du recruteur]',
  '[organisation]',
].join('\n');

/**
 * Template par défaut du message de REFUS candidat. Courtois et factuel, sans
 * exposer de motif interne (le verdict d'analyse ne sort jamais vers le
 * candidat). Le DRH peut le personnaliser en settings.
 */
export const DEFAULT_INTERVIEW_REJECTION_TEMPLATE = [
  'Bonjour [prénom],',
  '',
  'Nous vous remercions de l’intérêt porté au poste de [intitulé du poste] et du temps consacré à votre candidature.',
  '',
  'Après étude attentive, nous ne donnerons pas suite à votre profil pour cette opportunité. Ce choix ne remet nullement en cause vos compétences ; il traduit l’adéquation recherchée pour ce poste précis.',
  '',
  'Nous vous souhaitons une pleine réussite dans la suite de votre parcours.',
  '',
  'Bien cordialement,',
  '[nom du recruteur]',
  '[organisation]',
].join('\n');

// ─── Messages au candidat après décision ─────────────────────────────────
// Signés du recruteur (Reply-To = son adresse) : pas de bloc « cet outil ne
// décide pas » — la décision est humaine. La mention d'information RGPD est
// apposée par le code, HORS gabarit, à l'envoi.

/**
 * RETENU après entretien. « Retenu » = suite du processus (présenté au
 * client), JAMAIS une promesse d'embauche. [prochaine étape] vide ⇒ phrase de
 * repli (`DEFAULT_FEEDBACK_NEXT_STEP`).
 */
export const DEFAULT_FEEDBACK_RETAINED_TEMPLATE = [
  'Bonjour [prénom],',
  '',
  'Merci pour notre échange au sujet du poste de [intitulé du poste]. J’ai le plaisir de vous confirmer que votre candidature est retenue pour la suite du processus de recrutement.',
  '',
  '[prochaine étape]',
  '',
  'Je reste à votre disposition pour toute question : il vous suffit de répondre à ce message.',
  '',
  'Bien cordialement,',
  '[prénom du recruteur]',
  '[organisation]',
].join('\n');

/** Repli de [prochaine étape] quand le recruteur ne la précise pas. */
export const DEFAULT_FEEDBACK_NEXT_STEP =
  'Je reviens vers vous très prochainement pour vous en préciser les modalités.';

/** NON RETENU après entretien (y compris retenu non sélectionné à la clôture). */
export const DEFAULT_FEEDBACK_NOT_RETAINED_TEMPLATE = [
  'Bonjour [prénom],',
  '',
  'Merci pour le temps que vous nous avez consacré lors de notre entretien pour le poste de [intitulé du poste].',
  '',
  'Après réflexion, nous avons décidé de ne pas poursuivre avec votre candidature pour ce poste. Cette décision tient à l’adéquation recherchée pour ce poste précis ; elle ne remet pas en cause la qualité de votre parcours.',
  '',
  'Si vous souhaitez un retour plus détaillé sur notre échange, répondez simplement à ce message.',
  '',
  'Je vous souhaite une pleine réussite dans vos projets.',
  '',
  'Bien cordialement,',
  '[prénom du recruteur]',
  '[organisation]',
].join('\n');

/**
 * ABSENT à l'entretien, classé non retenu. Ne remercie pas d'un entretien qui
 * n'a pas eu lieu, et n'affirme pas qu'on est « sans nouvelles » (le candidat
 * a pu appeler).
 */
export const DEFAULT_FEEDBACK_NO_SHOW_TEMPLATE = [
  'Bonjour [prénom],',
  '',
  'Nous avions convenu d’un entretien pour le poste de [intitulé du poste], auquel vous n’avez pas pu vous présenter.',
  '',
  'Nous ne poursuivrons donc pas votre candidature pour ce poste. Si un empêchement indépendant de votre volonté vous a retenu, n’hésitez pas à répondre à ce message.',
  '',
  'Je vous souhaite une pleine réussite dans vos projets.',
  '',
  'Bien cordialement,',
  '[prénom du recruteur]',
  '[organisation]',
].join('\n');

/**
 * SANS SUITE — ce n'est PAS un refus : le recrutement s'arrête pour une raison
 * externe. [motif] porte la phrase propre à la raison, écrite par le code
 * (`dismissalMotif`). Un seul texte, pour le classement individuel ET l'envoi
 * groupé de la clôture.
 */
export const DEFAULT_FEEDBACK_DISMISSED_TEMPLATE = [
  'Bonjour [prénom],',
  '',
  'Je reviens vers vous au sujet de votre candidature au poste de [intitulé du poste].',
  '',
  '[motif]',
  '',
  'Merci de l’intérêt que vous avez porté à notre organisation.',
  '',
  'Bien cordialement,',
  '[prénom du recruteur]',
  '[organisation]',
].join('\n');

export const DEFAULT_INTERVIEW_CONFIG: InterviewConfig = {
  acceptanceTemplate: DEFAULT_INTERVIEW_ACCEPTANCE_TEMPLATE,
  rejectionTemplate: DEFAULT_INTERVIEW_REJECTION_TEMPLATE,
  rescheduleTemplate: DEFAULT_INTERVIEW_RESCHEDULE_TEMPLATE,
  vivierInvitationTemplate: DEFAULT_VIVIER_INVITATION_TEMPLATE,
  agendaLink: '',
  organisationName: '',
  recruiterName: '',
  transcriptImportEnabled: true,
  feedbackRetainedTemplate: DEFAULT_FEEDBACK_RETAINED_TEMPLATE,
  feedbackNotRetainedTemplate: DEFAULT_FEEDBACK_NOT_RETAINED_TEMPLATE,
  feedbackNoShowTemplate: DEFAULT_FEEDBACK_NO_SHOW_TEMPLATE,
  feedbackDismissedTemplate: DEFAULT_FEEDBACK_DISMISSED_TEMPLATE,
};
