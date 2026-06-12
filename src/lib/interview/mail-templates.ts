/**
 * Rendu DÉTERMINISTE des messages candidat d'entretien (acceptation+invitation,
 * refus) — réplique du mécanisme vivier (§6.1). Substitution de variables dans
 * un template éditable en settings, sans aucun appel LLM. Pur (testable sans I/O).
 *
 * Variables du socle commun : [prénom], [nom], [intitulé du poste],
 * [nom de la campagne], [organisation], [nom du recruteur].
 * Variable spécifique acceptation : [lien d'agenda] (le candidat y choisit son
 * créneau — il n'y a AUCUNE info de RDV pré-définie dans le message).
 */

export type InterviewMailVars = {
  prenom: string;
  nom: string;
  jobTitle: string;
  campaignName: string;
  organisation: string;
  recruiterName: string;
  /** Lien d'agenda (acceptation). Vide/placeholder pour le refus (non utilisé). */
  agendaLink: string;
};

/** Sépare un nom complet en prénom (1er token) + nom (reste). */
export function splitCandidateName(fullName: string): {
  prenom: string;
  nom: string;
} {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { prenom: '', nom: '' };
  const [prenom, ...rest] = parts;
  return { prenom, nom: rest.join(' ') };
}

/**
 * Substitue les variables du template. Le placeholder [lien d'agenda] est
 * accepté avec apostrophe droite OU typographique (les éditeurs en insèrent
 * souvent une typographique sans que le DRH s'en rende compte).
 */
export function renderInterviewMail(
  template: string,
  vars: InterviewMailVars,
): string {
  return template
    .replaceAll('[prénom]', vars.prenom)
    .replaceAll('[nom]', vars.nom)
    .replaceAll('[intitulé du poste]', vars.jobTitle)
    .replaceAll('[nom de la campagne]', vars.campaignName)
    .replaceAll('[organisation]', vars.organisation)
    .replaceAll('[Organisation]', vars.organisation)
    .replaceAll('[nom du recruteur]', vars.recruiterName)
    .replaceAll("[lien d'agenda]", vars.agendaLink)
    .replaceAll('[lien d’agenda]', vars.agendaLink);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convertit le texte du mail en HTML simple (paragraphes), échappé, avec les
 * URLs http(s) rendues cliquables (le lien d'agenda doit l'être pour le
 * candidat). L'échappement précède l'auto-lien : seules les URL « propres »
 * (sans &, <, espaces) sont liées — suffisant pour un lien Calendly/Cal.com.
 */
export function interviewMailTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const escaped = escapeHtml(para).replace(/\n/g, '<br/>');
      const linked = escaped.replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1">$1</a>',
      );
      return `<p>${linked}</p>`;
    })
    .join('\n');
}

/** Tronque un objet d'email à une longueur raisonnable (mots préservés). */
function clampSubject(s: string, max = 78): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Objet déterministe du message d'acceptation. */
export function acceptanceSubject(jobTitle: string | null): string {
  const t = jobTitle?.trim();
  return clampSubject(
    t ? `Votre candidature retenue — ${t}` : 'Votre candidature a retenu notre attention',
  );
}

/** Objet déterministe du message de refus. */
export function rejectionSubject(jobTitle: string | null): string {
  const t = jobTitle?.trim();
  return clampSubject(t ? `Votre candidature au poste de ${t}` : 'Votre candidature');
}
