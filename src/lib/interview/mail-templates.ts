/**
 * Rendu DÉTERMINISTE des messages candidat d'entretien (acceptation+invitation,
 * refus) — réplique du mécanisme vivier (§6.1). Substitution de variables dans
 * un template éditable en settings, sans aucun appel LLM. Pur (testable sans I/O).
 *
 * Variables du socle commun : [prénom], [nom], [intitulé du poste],
 * [nom de la campagne], [organisation], [nom du recruteur].
 * Variable spécifique acceptation : [lien d'agenda] (le candidat y choisit son
 * créneau — il n'y a AUCUNE info de RDV pré-définie dans le message).
 * Variable spécifique nouveau créneau : [intro] (le fait : qui a décalé, quand).
 * Variable spécifique vivier : [origine] (d'où vient la sollicitation — vide
 * pour une candidature ordinaire ; placée par le code si le modèle l'omet).
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
  /**
   * Phrase factuelle du message de nouveau créneau : QUI a décalé et QUAND.
   * Écrite par le code — un modèle éditable ne peut pas savoir, au moment où
   * le DRH le rédige, si c'est le cabinet ou le candidat qui annulera.
   */
  intro?: string;
  /**
   * Phrase d'origine d'une candidature créée depuis le vivier (« vous nous
   * aviez adressé votre candidature le … »). Vide pour toutes les autres.
   */
  origine?: string;
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
  return placeOrigin(template, vars.origine ?? '')
    .replaceAll('[prénom]', vars.prenom)
    .replaceAll('[nom]', vars.nom)
    .replaceAll('[intitulé du poste]', vars.jobTitle)
    .replaceAll('[nom de la campagne]', vars.campaignName)
    .replaceAll('[organisation]', vars.organisation)
    .replaceAll('[Organisation]', vars.organisation)
    .replaceAll('[nom du recruteur]', vars.recruiterName)
    .replaceAll("[lien d'agenda]", vars.agendaLink)
    .replaceAll('[lien d’agenda]', vars.agendaLink)
    .replaceAll('[intro]', vars.intro ?? '');
}

const ORIGIN_MARK = '[origine]';

/**
 * Pose la phrase d'origine. Le modèle la place avec `[origine]` ; s'il ne la
 * place pas, elle va après la formule d'appel (premier paragraphe) — une
 * sollicitation qui ne dit pas d'où elle vient se lit comme un démarchage.
 * Vide ⇒ la variable disparaît sans laisser de paragraphe blanc.
 */
export function placeOrigin(template: string, origine: string): string {
  if (template.includes(ORIGIN_MARK)) {
    const replaced = template.replaceAll(ORIGIN_MARK, origine);
    return origine ? replaced : replaced.replace(/\n{3,}/g, '\n\n').replace(/^\s+/, '');
  }
  if (!origine) return template;
  const cut = template.indexOf('\n\n');
  return cut < 0 ? `${origine}\n\n${template}` : `${template.slice(0, cut)}\n\n${origine}${template.slice(cut)}`;
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
/**
 * Objet du message de NOUVEAU CRÉNEAU. Il ne reprend pas « candidature
 * retenue » : dans une boîte de réception, ce serait indiscernable du message
 * déjà reçu, et personne ne l'ouvrirait.
 */
export function rescheduleSubject(jobTitle: string | null): string {
  const t = jobTitle?.trim();
  return clampSubject(
    t ? `Nouveau créneau à choisir — ${t}` : 'Nouveau créneau d’entretien à choisir',
  );
}

export function acceptanceSubject(jobTitle: string | null): string {
  const t = jobTitle?.trim();
  return clampSubject(
    t ? `Votre candidature retenue — ${t}` : 'Votre candidature a retenu notre attention',
  );
}

/** Objet déterministe du message de refus. */
/**
 * Objet de l'invitation d'un profil du VIVIER : une opportunité, jamais une
 * « candidature retenue » — la personne n'a pas postulé à ce poste.
 */
export function vivierOpportunitySubject(jobTitle: string | null): string {
  const t = jobTitle?.trim();
  return clampSubject(t ? `Une opportunité : ${t}` : 'Une opportunité qui pourrait vous intéresser');
}

export function rejectionSubject(jobTitle: string | null): string {
  const t = jobTitle?.trim();
  return clampSubject(t ? `Votre candidature au poste de ${t}` : 'Votre candidature');
}
