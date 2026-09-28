/**
 * Message au candidat après décision — rendu PUR, déterministe, CLIENT-SAFE.
 * Branche feat/feedback-candidat (28/09/2026).
 *
 * Le gabarit (éditable dans les Réglages) est rendu avec des variables
 * FERMÉES : `FeedbackTemplateVars` ne porte ni commentaire du recruteur, ni
 * compte rendu, ni score — et ce module n'importe aucun de leurs modules
 * (garde structurelle testée). Le texte rendu est une PROPOSITION : le
 * recruteur la relit et peut la retoucher avant envoi ; ce qui part est ce
 * qu'il a validé à l'écran.
 *
 * La mention d'information RGPD n'est PAS dans le gabarit : le code l'appose à
 * l'envoi (`finalizeFeedbackText`), une fois et une seule.
 */

import { splitCandidateName } from '@/lib/interview/mail-templates';
import { withRgpdMentionAppended } from '@/lib/vivier/rgpd-mention';
import type { FeedbackKind } from '@/types/candidate-feedback';
import type { DismissalReason } from '@/types/dismissal';
import {
  DEFAULT_FEEDBACK_NEXT_STEP,
  type InterviewConfig,
} from '@/types/interview-settings';

/** Variables d'un message — liste FERMÉE (aucun champ libre du dossier). */
export type FeedbackTemplateVars = Readonly<{
  prenom: string;
  jobTitle: string;
  organisation: string;
  recruiterFirstName: string;
  recruiterName: string;
  /** Gabarit « retenu » : texte libre saisi au moment de la décision. */
  nextStep?: string;
  /** Gabarit « sans suite » : phrase propre à la raison (`dismissalMotif`). */
  motif?: string;
}>;

/** Le champ de réglage qui porte le gabarit de chaque type de message. */
export const FEEDBACK_TEMPLATE_FIELD = {
  retenu: 'feedbackRetainedTemplate',
  non_retenu: 'feedbackNotRetainedTemplate',
  absent: 'feedbackNoShowTemplate',
  sans_suite: 'feedbackDismissedTemplate',
} as const satisfies Record<FeedbackKind, keyof InterviewConfig>;

/**
 * Phrase [motif] d'un « sans suite », par raison. `null` pour les raisons qui
 * n'appellent jamais de message (doublon, invalide — cf. DISMISSAL_MAIL_POLICY).
 * Ce n'est jamais un refus : la raison est externe à l'évaluation.
 */
export function dismissalMotif(reason: DismissalReason): string | null {
  switch (reason) {
    case 'poste_pourvu':
      return (
        'Le poste a été pourvu et le recrutement est désormais clos. Votre ' +
        'candidature n’a pas pu être examinée jusqu’au bout — cela ne ' +
        'présage en rien de la qualité de votre profil.'
      );
    case 'campagne_cloturee':
      return (
        'Le recrutement pour ce poste est clos. Votre candidature n’a pas pu ' +
        'être examinée jusqu’au bout — cela ne présage en rien de la qualité ' +
        'de votre profil.'
      );
    case 'sans_reponse':
      return 'Sans retour de votre part, nous clôturons votre dossier pour ce poste.';
    case 'candidat_retire':
      return 'Suite à votre retrait, nous clôturons votre dossier pour ce poste.';
    case 'doublon':
    case 'invalide':
      return null;
  }
}

/** Prénom d'un recruteur à partir de son nom affiché ; repli sur le nom entier. */
export function recruiterFirstName(displayName: string): string {
  return splitCandidateName(displayName).prenom || displayName.trim();
}

/** Prénom du candidat (premier mot du nom). */
export function candidateFirstName(fullName: string): string {
  return splitCandidateName(fullName).prenom;
}

export function feedbackSubject(jobTitle: string): string {
  return `Votre candidature — ${jobTitle}`;
}

/** Substitue les variables. Pur. */
export function renderFeedbackTemplate(template: string, vars: FeedbackTemplateVars): string {
  const nextStep = (vars.nextStep ?? '').trim() || DEFAULT_FEEDBACK_NEXT_STEP;
  return template
    .replaceAll('[prénom du recruteur]', vars.recruiterFirstName)
    .replaceAll('[nom du recruteur]', vars.recruiterName)
    .replaceAll('[prénom]', vars.prenom)
    .replaceAll('[intitulé du poste]', vars.jobTitle)
    .replaceAll('[organisation]', vars.organisation)
    .replaceAll('[Organisation]', vars.organisation)
    .replaceAll('[prochaine étape]', nextStep)
    .replaceAll('[motif]', (vars.motif ?? '').trim());
}

/** Le message proposé (objet + corps) pour un type donné, selon les Réglages. */
export function proposeFeedbackMessage(
  kind: FeedbackKind,
  config: Pick<InterviewConfig, (typeof FEEDBACK_TEMPLATE_FIELD)[FeedbackKind]>,
  vars: FeedbackTemplateVars,
): { subject: string; body: string } {
  const template = config[FEEDBACK_TEMPLATE_FIELD[kind]];
  return {
    subject: feedbackSubject(vars.jobTitle),
    body: collapseBlankLines(renderFeedbackTemplate(template, vars)),
  };
}

/**
 * Variables restées entre crochets après rendu (faute de frappe dans un
 * gabarit, variable inconnue) — l'écran les SIGNALE avant envoi, jamais ne
 * les envoie en silence.
 */
export function unresolvedPlaceholders(text: string): string[] {
  return [...new Set(text.match(/\[[^\]\n]{1,40}\]/g) ?? [])];
}

/** Texte final envoyé : le corps validé + la mention d'information RGPD. */
export function finalizeFeedbackText(body: string, rgpdContact: string): string {
  return withRgpdMentionAppended(body.trim(), rgpdContact);
}

/** Une variable vide laisse un paragraphe vide : on ne garde qu'une ligne blanche. */
function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
