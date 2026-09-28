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

/**
 * Une famille de lignes du journal comptée pour un agent. `payloadEquals`
 * restreint aux lignes dont le payload porte ces valeurs (comparées en
 * texte) — c'est ce qui distingue « un message ENVOYÉ » d'une tentative.
 */
export type JournalSource = {
  action: string;
  payloadEquals?: Readonly<Record<string, string>>;
};

export type AgentBandEntry = {
  /** Identifiant CANONIQUE de l'agent — celui qui résout son avatar. */
  id: string;
  /** Nom affiché, celui de la fiche d'agent. */
  name: string;
  /** Ce qu'il fait, en trois mots. */
  role: string;
  /** Lignes de journal comptées — la SOURCE du chiffre. */
  sources: readonly JournalSource[];
  /** Ce que le chiffre compte, au singulier et au pluriel. */
  unit: { one: string; many: string };
};

export const AGENT_BAND: readonly AgentBandEntry[] = [
  {
    id: 'agent.cv-analyzer',
    name: 'CV Analyzer',
    role: 'Lit et note les CV',
    sources: [{ action: 'imap_cv_analyzed' }],
    unit: { one: 'candidature analysée', many: 'candidatures analysées' },
  },
  {
    id: 'agent.scheduler',
    name: 'Scheduler',
    role: 'Cale les rendez-vous',
    // Le briefing est DÉLIVRÉ au moment où le créneau est confirmé : c'est le
    // marqueur le plus fidèle d'« un entretien a été pris ».
    sources: [{ action: 'interview_brief_delivered' }],
    unit: { one: 'entretien pris', many: 'entretiens pris' },
  },
  {
    id: 'agent.publisher',
    name: 'Publisher',
    role: 'Met les annonces en ligne',
    sources: [{ action: 'apec_offer_status_changed' }],
    unit: { one: 'annonce mise à jour', many: 'annonces mises à jour' },
  },
  {
    id: 'agent.mail-composer',
    name: 'Mail Composer',
    role: 'Écrit aux candidats',
    // ⚠️ TOUS les mails écrits à un candidat, et seulement ceux PARTIS
    // (27/09/2026). La bande ne comptait que `imap_outreach_mail` — les envois
    // AUTOMATIQUES : une acceptation envoyée après la décision du recruteur,
    // une invitation renvoyée depuis Entretiens, une invitation du vivier ou
    // l'avis d'un classement sans suite restaient invisibles, et le Mail
    // Composer affichait 0 juste après un envoi. « Message envoyé » ne compte
    // ni une tentative échouée, ni un envoi volontairement sauté, ni un envoi
    // sans service configuré. Un nouvel envoi au candidat s'AJOUTE ici.
    sources: [
      { action: 'imap_outreach_mail', payloadEquals: { status: 'sent' } },
      { action: 'hitl_validation_sent', payloadEquals: { mailSent: 'true' } },
      { action: 'interview_link_reissued', payloadEquals: { mailSent: 'true' } },
      { action: 'candidature_dismissed', payloadEquals: { mailSent: 'true' } },
      { action: 'vivier_invitation_sent', payloadEquals: { status: 'sent' } },
      // Message après décision (feat/feedback-candidat) — seulement s'il est
      // PARTI : ni un « je préviens moi-même », ni un doublon bloqué.
      { action: 'candidate_feedback_recorded', payloadEquals: { mailStatus: 'sent' } },
    ],
    unit: { one: 'message envoyé', many: 'messages envoyés' },
  },
  {
    id: 'agent.job-writer',
    name: 'Job Writer',
    role: 'Rédige les annonces',
    sources: [{ action: 'job_writer_rendered' }],
    unit: { one: 'annonce rédigée', many: 'annonces rédigées' },
  },
  {
    id: 'agent.manager-rh',
    name: 'Manager RH',
    role: 'Applique vos décisions',
    sources: [{ action: 'candidate_validation_marked' }],
    unit: { one: 'décision appliquée', many: 'décisions appliquées' },
  },
] as const;

/** « 3 candidatures analysées » · « 0 candidature analysée ». */
export function agentCountLabel(entry: AgentBandEntry, count: number): string {
  return `${count} ${count > 1 ? entry.unit.many : entry.unit.one}`;
}

/**
 * Les deux fenêtres d'activité proposées sous la bande.
 *
 * ⚠️ DEUX, et pas un curseur. Le point de la fenêtre fixe reste entier : deux
 * chiffres ne se comparent que si l'on sait sur quoi ils portent. Offrir un
 * CHOIX entre deux fenêtres NOMMÉES ne casse pas ça — ce qui le casserait,
 * c'est une fenêtre qui bouge sans qu'on l'ait demandé, comme l'ancienne
 * « depuis votre dernière visite ».
 *
 * Les LIBELLÉS vivent dans le lexique (`PHRASES.equipe`), pas ici : une
 * seconde copie finirait par dire autre chose que l'écran.
 */
export const BAND_WINDOWS = {
  semaine: { jours: 7 },
  mois: { jours: 30 },
} as const;

export type BandWindow = keyof typeof BAND_WINDOWS;

/** Une valeur venue de l'URL n'est pas une fenêtre : on la vérifie. */
export function parseBandWindow(brut: string | null): BandWindow {
  return brut === 'mois' ? 'mois' : 'semaine';
}

/**
 * Début de la fenêtre d'activité — 7 ou 30 jours glissants, selon la fenêtre
 * CHOISIE (défaut : la semaine).
 *
 * ⚠️ Elle était indexée sur la dernière visite du recruteur. Deux défauts, et
 * le second est le vrai : la fenêtre vivait dans le navigateur (donc une par
 * machine), et surtout elle CHANGEAIT d'une visite à l'autre — « 12 CV
 * analysés » un jour et « 3 » le lendemain ne se comparent pas, et rien à
 * l'écran ne disait pourquoi. Une fenêtre nommée se lit, se compare, et se
 * dit en trois mots sous la bande.
 */
export function bandWindowStart(
  nowMs: number,
  fenetre: BandWindow = 'semaine',
): string {
  return new Date(nowMs - BAND_WINDOWS[fenetre].jours * 86_400_000).toISOString();
}
