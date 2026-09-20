/**
 * La bande d'équipe d'*Aujourd'hui* — SIX agents, UN chiffre chacun. PUR.
 *
 * C'est la mimétique « une équipe au travail », ramenée à ce qu'elle peut
 * prouver : un rôle et un compte. Pas de bulle, pas de message, pas de voix —
 * un agent qui « parle » sur l'écran d'accueil demande à être lu, et l'écran
 * d'accueil n'est pas là pour être lu.
 *
 * ⚠️ RÈGLE ABSOLUE : chaque chiffre vient du JOURNAL, jamais d'une estimation.
 * Un compteur inventé sur un écran d'accueil est le genre de détail qui tient
 * une démonstration et ruine la confiance le jour où quelqu'un le recoupe.
 * Zéro activité rend donc **0**, et surtout pas « rien pour l'instant » : le
 * zéro est une information, la phrase est une excuse.
 *
 * Chaque agent porte les actions de journal qui le concernent, et le LIBELLÉ
 * exact de ce que le chiffre compte. Deux agents peuvent compter des choses
 * différentes à partir de familles voisines — ce qui compte est que le libellé
 * dise précisément ce que le nombre mesure.
 */

export type AgentBandEntry = {
  /** Identifiant CANONIQUE de l'agent — celui qui résout son avatar. */
  id: string;
  /** Nom affiché, celui de la fiche d'agent. */
  name: string;
  /** Ce qu'il fait, en trois mots. */
  role: string;
  /** Actions de journal comptées — la SOURCE du chiffre. */
  actions: readonly string[];
  /** Ce que le chiffre compte, au singulier et au pluriel. */
  unit: { one: string; many: string };
};

export const AGENT_BAND: readonly AgentBandEntry[] = [
  {
    id: 'agent.cv-analyzer',
    name: 'CV Analyzer',
    role: 'Lit et note les CV',
    actions: ['imap_cv_analyzed'],
    unit: { one: 'candidature analysée', many: 'candidatures analysées' },
  },
  {
    id: 'agent.scheduler',
    name: 'Scheduler',
    role: 'Cale les rendez-vous',
    // Le briefing est DÉLIVRÉ au moment où le créneau est confirmé : c'est le
    // marqueur le plus fidèle d'« un entretien a été pris ».
    actions: ['interview_brief_delivered'],
    unit: { one: 'entretien pris', many: 'entretiens pris' },
  },
  {
    id: 'agent.publisher',
    name: 'Publisher',
    role: 'Met les annonces en ligne',
    actions: ['apec_offer_status_changed'],
    unit: { one: 'annonce mise à jour', many: 'annonces mises à jour' },
  },
  {
    id: 'agent.mail-composer',
    name: 'Mail Composer',
    role: 'Écrit aux candidats',
    actions: ['imap_outreach_mail'],
    unit: { one: 'message envoyé', many: 'messages envoyés' },
  },
  {
    id: 'agent.job-writer',
    name: 'Job Writer',
    role: 'Rédige les annonces',
    actions: ['job_writer_rendered'],
    unit: { one: 'annonce rédigée', many: 'annonces rédigées' },
  },
  {
    id: 'agent.manager-rh',
    name: 'Manager RH',
    role: 'Applique vos décisions',
    actions: ['candidate_validation_marked'],
    unit: { one: 'décision appliquée', many: 'décisions appliquées' },
  },
] as const;

/** Toutes les actions à charger, sans doublon — une seule lecture par action. */
export const AGENT_BAND_ACTIONS: string[] = [
  ...new Set(AGENT_BAND.flatMap((a) => a.actions)),
];

/** « 3 candidatures analysées » · « 0 candidature analysée ». */
export function agentCountLabel(entry: AgentBandEntry, count: number): string {
  return `${count} ${count > 1 ? entry.unit.many : entry.unit.one}`;
}

/** La fenêtre de la bande d'équipe, en jours. FIXE. */
export const BAND_WINDOW_DAYS = 7;

/**
 * Début de la fenêtre d'activité — les SEPT DERNIERS JOURS, toujours.
 *
 * ⚠️ Elle était indexée sur la dernière visite du recruteur. Deux défauts, et
 * le second est le vrai : la fenêtre vivait dans le navigateur (donc une par
 * machine), et surtout elle CHANGEAIT d'une visite à l'autre — « 12 CV
 * analysés » un jour et « 3 » le lendemain ne se comparent pas, et rien à
 * l'écran ne disait pourquoi. Une fenêtre fixe se lit, se compare, et se dit
 * en trois mots sous la bande.
 */
export function bandWindowStart(nowMs: number): string {
  return new Date(nowMs - BAND_WINDOW_DAYS * 86_400_000).toISOString();
}
