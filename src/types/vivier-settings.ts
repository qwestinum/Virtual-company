/**
 * Réglages vivier de l'organisation (Session V3, docs/specs/vivier.md §9).
 * Portés par AppSettings (colonne jsonb). L'UI d'édition arrive avec la section
 * Settings ; les défauts ci-dessous tiennent tant qu'elle n'a pas été touchée.
 */

import { z } from 'zod';

/** Mode de contact : validation manuelle (défaut) ou contact automatique. */
export type VivierContactMode = 'manual' | 'auto';

/** Schéma de validation (source unique, consommé par /api/settings). */
export const VivierConfigSchema = z.object({
  /** Manuel : envoi sur acceptation explicite. Auto : envoi après présélection. */
  contactMode: z.enum(['manual', 'auto']),
  /** Template du message d'invitation (variables [prénom], [intitulé du poste]…). */
  invitationTemplate: z.string().min(1).max(5000),
  /** Durée du cooldown anti-sollicitation, en jours. */
  cooldownDays: z.number().int().min(0).max(3650),
  /** Plafond de la short-list (remplace la constante V2). */
  shortlistCap: z.number().int().min(1).max(500),
  /**
   * Plancher de similarité cosinus (0..1) : sous ce seuil, un candidat est jugé
   * non pertinent et écarté de la short-list. À calibrer sur le corpus.
   */
  similarityFloor: z.number().min(0).max(1),
  /** Nom de l'organisation, injecté dans [Organisation]. Vide ⇒ repli. */
  organisationName: z.string().max(200),
});

export type VivierConfig = z.infer<typeof VivierConfigSchema>;

/**
 * Template par défaut du message d'invitation à postuler (spec §6.1). Variables
 * résolues à l'envoi. La mention RGPD est AJOUTÉE automatiquement au rendu
 * (toujours présente, indépendamment des éditions du template).
 */
export const DEFAULT_VIVIER_INVITATION_TEMPLATE = [
  'Bonjour [prénom],',
  '',
  'Nous avons été en contact par le passé et nous nous permettons de revenir vers vous. Nous avons actuellement une opportunité qui pourrait correspondre à votre profil : [intitulé du poste].',
  '',
  'Si cette opportunité vous intéresse, envoyez-nous votre candidature à [adresse de réception].',
  '',
  'IMPORTANT : indiquez impérativement la référence « [référence] » dans l’objet de votre email. C’est indispensable pour que votre candidature soit rattachée à cette opportunité — sans cette référence en objet, elle ne pourra pas être traitée.',
  '',
  'Bien cordialement,',
  '[Organisation]',
].join('\n');

export const DEFAULT_VIVIER_CONFIG: VivierConfig = {
  contactMode: 'manual',
  invitationTemplate: DEFAULT_VIVIER_INVITATION_TEMPLATE,
  cooldownDays: 90,
  shortlistCap: 50,
  similarityFloor: 0.2,
  organisationName: '',
};
