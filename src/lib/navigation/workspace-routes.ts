/**
 * Navigation du workspace Recrutement — SOURCE UNIQUE, pure, testée.
 *
 * ⚠️ Ce module existe parce qu'avant lui il n'existait AUCUNE URL dans le
 * produit : les 8 onglets et tous leurs sous-onglets vivaient dans un
 * `useState`, et le seul `router.push` du workspace menait à `/settings`.
 * Conséquences mesurées à l'audit du 20/09/2026 : pas de favori, pas de bouton
 * Précédent, aucun lien partageable, et rien où pointer pour un signal métier
 * (les deux signaux APEC visaient la racine du workspace sans pouvoir dire de
 * quelle campagne ils parlaient).
 *
 * Tout ce qui concerne « quelle adresse pour quel écran » se décide ICI :
 * la barre de navigation, les redirections des anciennes adresses et les
 * cibles des signaux lisent le même tableau. Deux tables parallèles
 * divergeraient, et la divergence serait silencieuse — un lien qui tombe sur
 * un écran vide ne fait rougir aucun compilateur.
 */

import type { CandidateStage } from '@/lib/reporting/candidate-stage';
import type { BusinessSignalTarget } from '@/types/notifications';

// ── Les cinq entrées de premier niveau ──────────────────────────────────────

export type WorkspaceEntryId =
  | 'aujourdhui'
  | 'campagnes'
  | 'candidatures'
  | 'entretiens'
  | 'pilotage';

export type WorkspaceEntry = {
  id: WorkspaceEntryId;
  label: string;
  href: string;
};

/**
 * L'ordre EST celui de la barre : ce qui attend une action d'abord, l'objet
 * ensuite, la mesure en dernier. « Réglages » n'y figure pas — c'est un
 * réglage, pas une destination de travail ; il reste sur l'engrenage.
 */
export const WORKSPACE_ENTRIES: readonly WorkspaceEntry[] = [
  { id: 'aujourdhui', label: "Aujourd'hui", href: '/aujourdhui' },
  { id: 'campagnes', label: 'Campagnes', href: '/campagnes' },
  { id: 'candidatures', label: 'Candidatures', href: '/candidatures' },
  { id: 'entretiens', label: 'Entretiens', href: '/entretiens' },
  { id: 'pilotage', label: 'Pilotage', href: '/pilotage' },
] as const;

/** Entrée par défaut : l'écran de ce qui attend, jamais un organigramme. */
export const DEFAULT_WORKSPACE_PATH = '/aujourdhui';

/**
 * Quelle entrée surligner pour un chemin donné.
 *
 * Les sous-routes comptent pour leur parent (`/candidatures/validation` reste
 * « Candidatures ») : une barre qui s'éteint dès qu'on descend d'un cran ferait
 * croire qu'on a quitté la section.
 */
export function workspaceEntryForPath(
  pathname: string,
): WorkspaceEntryId | null {
  for (const entry of WORKSPACE_ENTRIES) {
    if (pathname === entry.href || pathname.startsWith(`${entry.href}/`)) {
      return entry.id;
    }
  }
  return null;
}

// ── Paramètres de filtre portés par l'URL ───────────────────────────────────

/**
 * Noms des paramètres, en français : ils sont VISIBLES dans la barre
 * d'adresse et dans les liens qu'on se partage. `?statut=a_valider` se lit,
 * `?s=av` non.
 */
export const PARAM = {
  campagne: 'campagne',
  statut: 'statut',
  section: 'section',
  /** Trajectoire (« passé par… »), distincte de l'étape COURANTE. */
  parcours: 'parcours',
} as const;

export type CandidaturesFilter = {
  campaignId?: string | null;
  stage?: CandidateStage | null;
  /**
   * Trajectoire d'un compteur de carte campagne : « tous ceux passés par
   * l'invitation / par l'entretien », y compris ceux qui ont avancé depuis.
   * ⚠️ Ce n'est PAS l'étape courante — la maquette v2 §B.1 a tranché de faire
   * passer les compteurs de carte en étapes courantes (lot 3), après quoi ce
   * paramètre n'aura plus d'émetteur. Il reste ici tant qu'il en a un.
   */
  parcours?: 'invitation' | 'entretien' | null;
};

export type InterviewsFilter = {
  campaignId?: string | null;
  section?: 'a_pointer' | 'awaiting' | 'historique' | null;
};

/** Construit une URL en n'écrivant QUE les paramètres réellement posés. */
function withParams(
  base: string,
  params: readonly (readonly [string, string | null | undefined])[],
): string {
  const search = new URLSearchParams();
  for (const [key, value] of params) {
    if (value != null && value !== '') search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * La création de campagne — UNE adresse, appelée depuis Campagnes comme depuis
 * *Aujourd'hui*. Avec un identifiant, elle REPREND ce brouillon là où il en
 * est ; sans, elle part d'une campagne neuve.
 *
 * ⚠️ Deux raccourcis qui ouvriraient deux surfaces différentes seraient deux
 * chemins de création à tenir d'accord — et l'un des deux finirait en retard
 * sur l'autre.
 */
export function nouvelleCampagneHref(campaignId?: string | null): string {
  return campaignId
    ? `/campagnes/nouvelle?${PARAM.campagne}=${encodeURIComponent(campaignId)}`
    : '/campagnes/nouvelle';
}

export function candidaturesHref(filter: CandidaturesFilter = {}): string {
  return withParams('/candidatures', [
    [PARAM.campagne, filter.campaignId],
    [PARAM.statut, filter.stage],
    [PARAM.parcours, filter.parcours],
  ]);
}

export function interviewsHref(filter: InterviewsFilter = {}): string {
  return withParams('/entretiens', [
    [PARAM.campagne, filter.campaignId],
    [PARAM.section, filter.section],
  ]);
}

// ── Lecture des paramètres (le sens inverse) ────────────────────────────────

const STAGES: readonly CandidateStage[] = [
  'a_valider',
  'invite',
  'rdv_pris',
  'entretien_fait',
  'retenu',
  'non_retenu',
  'refus_auto',
  'sans_suite',
];

/**
 * Lit les filtres depuis l'URL. Une valeur inconnue est IGNORÉE, jamais une
 * erreur : une adresse tapée de travers ou un lien vieilli doit rendre l'écran
 * non filtré, pas une page cassée.
 */
export function readCandidaturesFilter(
  params: URLSearchParams,
): CandidaturesFilter {
  const rawStage = params.get(PARAM.statut);
  const rawParcours = params.get(PARAM.parcours);
  return {
    campaignId: params.get(PARAM.campagne) || null,
    stage: STAGES.includes(rawStage as CandidateStage)
      ? (rawStage as CandidateStage)
      : null,
    parcours:
      rawParcours === 'invitation' || rawParcours === 'entretien'
        ? rawParcours
        : null,
  };
}

export function readInterviewsFilter(params: URLSearchParams): InterviewsFilter {
  const rawSection = params.get(PARAM.section);
  return {
    campaignId: params.get(PARAM.campagne) || null,
    section:
      rawSection === 'a_pointer' ||
      rawSection === 'awaiting' ||
      rawSection === 'historique'
        ? rawSection
        : null,
  };
}

// ── Cible d'un signal métier ────────────────────────────────────────────────

/**
 * Adresse vers laquelle mène un signal. Avant la refonte, un signal ne pouvait
 * que désigner un ONGLET : il n'existait aucune adresse où pointer. Deux
 * signaux APEC visaient donc la racine du workspace, sans pouvoir dire de
 * quelle campagne ils parlaient.
 *
 * `{ tab: 'validations' }` reste dans le type parce que des signaux déjà
 * écrits le portent ; il mène désormais là où sa population a déménagé.
 */
export function signalHref(target: BusinessSignalTarget): string {
  if ('route' in target) return target.route;
  switch (target.tab) {
    case 'validations':
      return candidaturesHref({ stage: 'a_valider' });
    case 'candidatures':
      return candidaturesHref({ stage: target.stage });
    case 'entretiens':
      return interviewsHref({ section: target.section });
    default:
      return DEFAULT_WORKSPACE_PATH;
  }
}
