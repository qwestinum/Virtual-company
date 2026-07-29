/**
 * Mail d'information « classée sans suite » — template PUR, déterministe,
 * testable (modèle : invitation-template.ts). CLIENT-SAFE.
 *
 * Ce n'est PAS un refus : le texte ne doit jamais laisser croire à une
 * évaluation négative — le recrutement s'arrête pour une raison EXTERNE
 * (poste pourvu, campagne close, dossier resté sans réponse). Ton aligné
 * vivier : « nous conservons votre profil » + mention RGPD systématique
 * (rgpd-mention partagé).
 */

import { buildVivierRgpdMention } from '@/lib/vivier/rgpd-mention';
import type { DismissalReason } from '@/types/dismissal';

export type DismissalMailVars = {
  prenom: string;
  jobTitle: string;
  organisation: string;
  /** Adresse de contact pour la suppression des données (mention RGPD). */
  rgpdContact: string;
};

/** Corps par raison (seules les raisons « mailables » ont un corps). */
function bodyFor(reason: DismissalReason, vars: DismissalMailVars): string | null {
  const intro = `Bonjour ${vars.prenom},\n\nVous aviez candidaté au poste de ${vars.jobTitle}.`;
  const outro =
    'Votre profil reste dans notre vivier de candidatures : nous vous ' +
    'recontacterons si un poste correspondant à votre parcours s’ouvre.\n\n' +
    `Merci de l’intérêt que vous avez porté à notre organisation.\n\n${vars.organisation}`;
  switch (reason) {
    case 'poste_pourvu':
      return (
        `${intro}\n\nLe poste a été pourvu et le recrutement est désormais clos. ` +
        'Votre candidature n’a pas pu être examinée jusqu’au bout — ' +
        `cela ne présage en rien de la qualité de votre profil.\n\n${outro}`
      );
    case 'campagne_cloturee':
      return (
        `${intro}\n\nLe recrutement pour ce poste est clos. Votre candidature ` +
        'n’a pas pu être examinée jusqu’au bout — cela ne présage en ' +
        `rien de la qualité de votre profil.\n\n${outro}`
      );
    case 'sans_reponse':
      return (
        `${intro}\n\nSans retour de votre part, nous clôturons votre dossier ` +
        `pour ce poste.\n\n${outro}`
      );
    case 'candidat_retire':
      return (
        `${intro}\n\nSuite à votre retrait, nous clôturons votre dossier pour ` +
        `ce poste.\n\n${outro}`
      );
    case 'doublon':
    case 'invalide':
      // Jamais de mail pour ces raisons (matrice DISMISSAL_MAIL_POLICY).
      return null;
  }
}

export type DismissalMail = { subject: string; text: string };

/**
 * Compose le mail (texte brut) pour une raison donnée, mention RGPD apposée
 * systématiquement. `null` si la raison n'est pas mailable.
 */
export function renderDismissalMail(
  reason: DismissalReason,
  vars: DismissalMailVars,
): DismissalMail | null {
  const body = bodyFor(reason, vars);
  if (body === null) return null;
  return {
    subject: `Votre candidature — ${vars.jobTitle}`,
    text: `${body}\n\n${buildVivierRgpdMention(vars.rgpdContact)}`,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Texte → HTML simple (paragraphes), échappé — même rendu que l'invitation. */
export function dismissalTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}
