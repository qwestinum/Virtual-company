/**
 * Rendu du message d'invitation à postuler (Session V3, §6.1). DÉTERMINISTE :
 * substitution de variables dans le template (éditable en settings), suivie de
 * l'AJOUT systématique de la mention RGPD (§8.1) — toujours présente, quelles
 * que soient les éditions. C'est une invitation à CANDIDATER, jamais à un
 * entretien. Pur (testable sans I/O).
 */

import { buildVivierRgpdMention } from './rgpd-mention';

export type InvitationVars = {
  prenom: string;
  jobTitle: string;
  campaignName: string;
  /** Adresse où le candidat envoie sa candidature ([adresse de réception]). */
  receptionAddress: string;
  organisation: string;
  /** Adresse de contact pour la suppression des données (mention RGPD). */
  rgpdContact: string;
};

/** Substitue les variables et appose la mention RGPD. Renvoie le TEXTE brut. */
export function renderVivierInvitation(
  template: string,
  vars: InvitationVars,
): string {
  const body = template
    .replaceAll('[prénom]', vars.prenom)
    .replaceAll('[intitulé du poste]', vars.jobTitle)
    .replaceAll('[nom de la campagne]', vars.campaignName)
    .replaceAll('[adresse de réception]', vars.receptionAddress)
    .replaceAll('[Organisation]', vars.organisation);
  return `${body}\n\n${buildVivierRgpdMention(vars.rgpdContact)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Convertit le texte de l'invitation en HTML simple (paragraphes), échappé. */
export function invitationTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}
