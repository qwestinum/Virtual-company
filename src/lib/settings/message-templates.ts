/**
 * Catalogue des MODÈLES DE MESSAGES éditables dans les Paramètres — PUR.
 *
 * Neuf textes, portés par deux réglages différents (`interviewConfig` pour huit
 * d'entre eux, `vivierConfig` pour l'invitation à candidater). Ils vivaient
 * dans deux sections sous des titres génériques (« Template du message
 * d'invitation » apparaissait DEUX fois, pour deux messages distincts) : on ne
 * savait pas lequel partait quand.
 *
 * ⚠️ SOURCE UNIQUE : la famille « Modèles de messages » (titre, moment
 * d'envoi, variables), l'index de recherche et les résumés repliés lisent ce
 * tableau. Un modèle ajouté ici apparaît partout ; ajouté ailleurs, il
 * manquerait à la recherche.
 */
import {
  DEFAULT_INTERVIEW_CONFIG,
  type InterviewConfig,
} from '@/types/interview-settings';
import { DEFAULT_VIVIER_CONFIG, type VivierConfig } from '@/types/vivier-settings';

export type InterviewTemplateKey =
  | 'acceptanceTemplate'
  | 'rejectionTemplate'
  | 'rescheduleTemplate'
  | 'feedbackRetainedTemplate'
  | 'feedbackNotRetainedTemplate'
  | 'feedbackNoShowTemplate'
  | 'feedbackDismissedTemplate'
  | 'vivierInvitationTemplate';

export type MessageTemplateRef =
  | { scope: 'interview'; key: InterviewTemplateKey }
  | { scope: 'vivier'; key: 'invitationTemplate' };

export type MessageTemplate = {
  /** Identifiant de section (stable : clé d'ancre et de recherche). */
  id: string;
  ref: MessageTemplateRef;
  /** Nom du message — ce que le recruteur cherche. */
  title: string;
  /** Moment où il part, en une phrase. */
  when: string;
  /** Variables disponibles et précautions propres à ce message. */
  hint: string;
  /** Mots que l'on tape pour le retrouver, en plus du titre. */
  keywords: string[];
};

const FEEDBACK_VARIABLES =
  'Variables : [prénom], [intitulé du poste], [organisation], [prénom du recruteur], ' +
  '[nom du recruteur]. Signé du recruteur, qui relit et peut retoucher le texte avant ' +
  'l’envoi ; le commentaire du recruteur n’y est jamais repris. La mention ' +
  'd’information sur les données est ajoutée automatiquement.';

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: 'modele-invitation-entretien',
    ref: { scope: 'interview', key: 'acceptanceTemplate' },
    title: 'Invitation à l’entretien (candidature retenue)',
    when: 'Part quand une candidature est acceptée, automatiquement ou après votre validation.',
    hint:
      'Variables : [prénom], [nom], [intitulé du poste], [nom de la campagne], [organisation], ' +
      '[nom du recruteur], et [lien d’agenda] (le candidat y choisit son créneau). Aucune ' +
      'date, heure ni lieu : le message ne fixe pas le rendez-vous.',
    keywords: ['acceptation', 'accepté', 'invitation', 'entretien', 'agenda', 'créneau', 'retenu'],
  },
  {
    id: 'modele-refus-cv',
    ref: { scope: 'interview', key: 'rejectionTemplate' },
    title: 'Refus sur CV',
    when: 'Part quand vous refusez une candidature après lecture du CV (« À valider »).',
    hint:
      'Variables : [prénom], [nom], [intitulé du poste], [nom de la campagne], [organisation], ' +
      '[nom du recruteur]. Le motif interne d’analyse n’est jamais exposé au candidat.',
    keywords: ['refus', 'refusé', 'écarté', 'rejet', 'cv', 'non retenu'],
  },
  {
    id: 'modele-nouveau-creneau',
    ref: { scope: 'interview', key: 'rescheduleTemplate' },
    title: 'Nouveau créneau à choisir',
    when:
      'Part quand un rendez-vous déjà pris tombe (le cabinet décale, le candidat annule) ou ' +
      'quand un absent est re-convoqué.',
    hint:
      'Il ne réannonce pas la sélection : le candidat l’a déjà reçue. Variables : les mêmes que ' +
      'l’invitation, plus [intro] (la phrase de fait — qui a décalé et quand, rédigée ' +
      'automatiquement) et [lien d’agenda].',
    keywords: ['créneau', 'report', 'décaler', 'annulation', 'déplacer', 'rendez-vous', 'absent'],
  },
  {
    id: 'modele-retenu-apres-entretien',
    ref: { scope: 'interview', key: 'feedbackRetainedTemplate' },
    title: 'Retenu après l’entretien',
    when: 'Proposé quand vous retenez le candidat après l’entretien.',
    hint:
      'Suite du processus, jamais une promesse d’embauche. [prochaine étape] reprend ce que ' +
      'vous précisez au moment de la décision ; vide, une phrase d’attente la remplace. ' +
      FEEDBACK_VARIABLES,
    keywords: ['retenu', 'verdict', 'décision', 'entretien', 'suite', 'prochaine étape'],
  },
  {
    id: 'modele-non-retenu-apres-entretien',
    ref: { scope: 'interview', key: 'feedbackNotRetainedTemplate' },
    title: 'Non retenu après l’entretien',
    when:
      'Proposé après un verdict négatif, et à un retenu non sélectionné à la clôture de la ' +
      'campagne.',
    hint: FEEDBACK_VARIABLES,
    keywords: ['non retenu', 'refus', 'verdict', 'décision', 'entretien', 'clôture'],
  },
  {
    id: 'modele-absent',
    ref: { scope: 'interview', key: 'feedbackNoShowTemplate' },
    title: 'Absent à l’entretien',
    when: 'Proposé quand un candidat absent à l’entretien est classé non retenu.',
    hint: FEEDBACK_VARIABLES,
    keywords: ['absent', 'absence', 'no-show', 'non venu', 'entretien'],
  },
  {
    id: 'modele-sans-suite',
    ref: { scope: 'interview', key: 'feedbackDismissedTemplate' },
    title: 'Candidature classée sans suite',
    when:
      'Proposé quand une candidature est classée sans suite, à l’unité ou à la clôture de la ' +
      'campagne.',
    hint:
      'Ce n’est pas un refus : le recrutement s’arrête pour une raison externe. [motif] porte ' +
      'la phrase propre à la raison (poste pourvu, campagne close, retrait…). ' +
      FEEDBACK_VARIABLES,
    keywords: ['sans suite', 'clôture', 'poste pourvu', 'classement', 'motif'],
  },
  {
    id: 'modele-opportunite-vivier',
    ref: { scope: 'interview', key: 'vivierInvitationTemplate' },
    title: 'Opportunité proposée à un profil du vivier',
    when: 'Part quand vous invitez un profil depuis « Chercher dans le vivier » d’une campagne.',
    hint:
      'La personne n’a pas postulé à ce poste : le message parle d’une opportunité (objet « Une ' +
      'opportunité : [intitulé du poste] »). Variables : celles de l’invitation à l’entretien, ' +
      'plus [origine] (sa candidature d’origine ou son entrée au vivier, rédigée ' +
      'automatiquement) et [lien d’agenda].',
    keywords: ['vivier', 'opportunité', 'inviter', 'invitation', 'profil'],
  },
  {
    id: 'modele-invitation-candidater',
    ref: { scope: 'vivier', key: 'invitationTemplate' },
    title: 'Invitation à candidater (présélection du vivier)',
    when: 'Part quand un profil présélectionné du vivier est contacté (validation du vivier).',
    hint:
      'Variables : [prénom], [intitulé du poste], [référence] (l’identifiant de campagne à ' +
      'reprendre en objet — indispensable au rattachement de la réponse), [nom de la ' +
      'campagne], [adresse de réception], [Organisation]. La mention RGPD est ajoutée ' +
      'automatiquement.',
    keywords: ['vivier', 'invitation', 'candidater', 'présélection', 'référence', 'contact'],
  },
];

export type TemplateSources = {
  interviewConfig: InterviewConfig;
  vivierConfig: VivierConfig;
};

/** Le texte proposé par défaut — celui que « Rétablir » remet. */
export function defaultTemplateText(ref: MessageTemplateRef): string {
  return ref.scope === 'vivier'
    ? DEFAULT_VIVIER_CONFIG.invitationTemplate
    : DEFAULT_INTERVIEW_CONFIG[ref.key];
}

/**
 * Le texte en vigueur. Une configuration enregistrée avant l'apparition d'un
 * modèle n'en porte pas : c'est alors le texte proposé qui part.
 */
export function currentTemplateText(ref: MessageTemplateRef, s: TemplateSources): string {
  const stored =
    ref.scope === 'vivier' ? s.vivierConfig.invitationTemplate : s.interviewConfig[ref.key];
  return stored ?? defaultTemplateText(ref);
}

/** Ligne lue section repliée : le moment, et si le texte a été retouché. */
export function templateSummary(t: MessageTemplate, s: TemplateSources): string {
  const custom = currentTemplateText(t.ref, s) !== defaultTemplateText(t.ref);
  return `${custom ? 'Texte personnalisé' : 'Texte proposé'} · ${t.when}`;
}
