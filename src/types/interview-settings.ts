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
   * Lien d'agenda (Calendly/Cal.com) injecté dans [lien d'agenda]. Au niveau
   * organisation. VIDE ⇒ l'envoi d'une acceptation est bloqué (« lien d'agenda
   * non configuré dans les paramètres »). Chaîne libre (URL validée à l'envoi)
   * pour tolérer une sauvegarde des autres réglages avant d'avoir le lien.
   */
  agendaLink: z.string().max(2048),
  /** Nom de l'organisation, injecté dans [organisation]. Vide ⇒ repli. */
  organisationName: z.string().max(200),
  /** Nom du recruteur signataire, injecté dans [nom du recruteur]. Vide ⇒ repli. */
  recruiterName: z.string().max(200),
});

export type InterviewConfig = z.infer<typeof InterviewConfigSchema>;

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

export const DEFAULT_INTERVIEW_CONFIG: InterviewConfig = {
  acceptanceTemplate: DEFAULT_INTERVIEW_ACCEPTANCE_TEMPLATE,
  rejectionTemplate: DEFAULT_INTERVIEW_REJECTION_TEMPLATE,
  agendaLink: '',
  organisationName: '',
  recruiterName: '',
};
