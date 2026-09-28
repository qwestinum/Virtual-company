/**
 * Le contenu DÉPLIÉ d'une carte campagne — quatre blocs. PUR, testé.
 *
 * ① compteurs-filtres · ② ce qui attend · ③ trouver des candidats · ④ actions
 *
 * ⚠️ OPTION A (maquette v2 §B.1) : les compteurs sont des ÉTAPES COURANTES,
 * plus des trajectoires. Avant, « Shortlistés / Invités » comptait tous ceux
 * PASSÉS par l'invitation : mesuré sur CAMP-2026-221, la carte affichait 2
 * quand la puce « Invité » affichait 0, les deux candidats ayant avancé
 * depuis. Cliquer un chiffre et atterrir sur une liste vide est pire que deux
 * mots différents.
 *
 * Conséquence directe : chaque compteur porte LE MÊME MOT que la puce vers
 * laquelle il mène, et le même nombre — parce qu'il vient de la MÊME source
 * (`computeStageCounts`, celle du ruban). Aucun invariant à maintenir : il n'y
 * a qu'une comptabilité.
 *
 * La trajectoire (« combien sont passés par l'invitation en tout ») n'est pas
 * perdue : c'est une mesure de performance, sa place est le rapport de
 * campagne — pas la carte.
 */

import {
  CANDIDATE_STAGE_DEFINITIONS,
  CANDIDATE_STAGE_LABELS,
  type CandidateStage,
  type CandidateStageCounts,
} from '@/lib/reporting/candidate-stage';
import {
  candidaturesHref,
  interviewsHref,
} from '@/lib/navigation/workspace-routes';

// ── ① Compteurs-filtres ─────────────────────────────────────────────────────

export type CardCounter = {
  key: string;
  /** Le MÊME mot que la puce de destination. */
  label: string;
  count: number;
  href: string;
  /** Définition au survol (lexique). */
  definition: string;
  /** Icône et couleur de la tuile — celles de la carte existante. */
  icon: string;
  color: string;
};

/**
 * Les étapes de la carte : TOUTES, en deux rangées (arbitrage du 28/09/2026 —
 * « un tableau dont les chiffres se recoupent est un tableau qu'on croit » :
 * les dix font « Reçues »). Rangée « en cours », puis rangée « issues ».
 *
 * ⚠️ TABLEAUX, pas un Record : un test vérifie que les deux rangées couvrent
 * exactement `CANDIDATE_STAGES` — une étape ajoutée au domaine sans place ici
 * ferait mentir la somme.
 */
export const CARD_ROW_EN_COURS: readonly CandidateStage[] = [
  'a_valider',
  'proposition_refus',
  'invite',
  'rdv_pris',
  'entretien_fait',
];
export const CARD_ROW_ISSUES: readonly CandidateStage[] = [
  'retenu',
  'recrute',
  'ecarte',
  'non_retenu',
  'sans_suite',
];

/** Icône + couleur par étape — les jetons de la carte existante. */
const APPARENCE: Record<'recues' | CandidateStage, { icon: string; color: string }> = {
  recues: { icon: '📄', color: 'var(--dash-blue)' },
  a_valider: { icon: '⏳', color: 'var(--dash-yellow)' },
  proposition_refus: { icon: '🗂️', color: 'var(--dash-orange)' },
  invite: { icon: '✉️', color: 'var(--dash-purple)' },
  rdv_pris: { icon: '📅', color: 'var(--dash-teal)' },
  entretien_fait: { icon: '🤝', color: 'var(--dash-blue)' },
  retenu: { icon: '✅', color: 'var(--dash-green)' },
  recrute: { icon: '🏁', color: 'var(--dash-green)' },
  ecarte: { icon: '✖️', color: 'var(--dash-red)' },
  non_retenu: { icon: '⛔', color: 'var(--dash-red)' },
  sans_suite: { icon: '📁', color: 'var(--dash-text-secondary)' },
};

export type CardCounterRows = {
  recues: CardCounter;
  enCours: CardCounter[];
  issues: CardCounter[];
};

export function buildCardCounters(
  campaignId: string,
  received: number,
  counts: CandidateStageCounts,
): CardCounterRows {
  const tile = (stage: CandidateStage): CardCounter => ({
    key: stage,
    label: CANDIDATE_STAGE_LABELS[stage],
    definition: CANDIDATE_STAGE_DEFINITIONS[stage],
    count: counts[stage],
    // ⚠️ TOUS vers Candidatures, SANS EXCEPTION : chaque puce existe là, et un
    // compteur qui changerait d'écran selon l'étape obligerait à deviner où
    // l'on va. Entretiens se rejoint par « ce qui attend ».
    href: candidaturesHref({ campaignId, stage }),
    ...APPARENCE[stage],
  });
  return {
    recues: {
      key: 'recues',
      // « Reçues » n'est pas une étape : c'est le total, et il reste
      // cliquable — vers la campagne, tous statuts confondus.
      label: 'Reçues',
      definition: 'Toutes les candidatures de la campagne.',
      count: received,
      href: candidaturesHref({ campaignId }),
      ...APPARENCE.recues,
    },
    enCours: CARD_ROW_EN_COURS.map(tile),
    issues: CARD_ROW_ISSUES.map(tile),
  };
}

// ── ② Ce qui attend ─────────────────────────────────────────────────────────

export type CardAwaiting = { key: string; text: string; href: string };

/**
 * Seulement ce qui attend vraiment — trois lignes au plus : arbitrer, passer
 * les propositions de refus en revue, confirmer les entretiens passés.
 *
 * Une carte qui énumère tout ce qui pourrait se faire ne dit plus ce qui doit
 * se faire. Une campagne sans rien en attente n'affiche pas ce bloc.
 */
export function buildCardAwaiting(
  campaignId: string,
  input: {
    /** Zone grise en attente d'arbitrage. */
    aValider: number;
    /** Ancienneté du plus ancien dossier à arbitrer, en jours. */
    aValiderOldestDays: number | null;
    /** Propositions de refus en attente de la revue groupée. */
    propositionsRefus: number;
    /** Entretiens passés que personne n'a confirmés. */
    entretiensAConfirmer: number;
  },
): CardAwaiting[] {
  const lignes: CardAwaiting[] = [];

  // Deux files, deux lignes (arbitrage du 28/09/2026) : l'une attend un
  // arbitrage, l'autre une revue groupée — même découpage qu'« Aujourd'hui ».
  if (input.aValider > 0) {
    const age =
      input.aValiderOldestDays !== null && input.aValiderOldestDays > 0
        ? ` — la plus ancienne depuis ${input.aValiderOldestDays} jour${input.aValiderOldestDays > 1 ? 's' : ''}`
        : '';
    lignes.push({
      key: 'a_valider',
      text: `${input.aValider} à arbitrer${age}`,
      href: candidaturesHref({ campaignId, stage: 'a_valider' }),
    });
  }

  if (input.propositionsRefus > 0) {
    const n = input.propositionsRefus;
    lignes.push({
      key: 'proposition_refus',
      text: `${n} proposition${n > 1 ? 's' : ''} de refus à passer en revue`,
      href: candidaturesHref({ campaignId, stage: 'proposition_refus' }),
    });
  }

  if (input.entretiensAConfirmer > 0) {
    const n = input.entretiensAConfirmer;
    lignes.push({
      key: 'entretiens',
      text: `${n} entretien${n > 1 ? 's' : ''} passé${n > 1 ? 's' : ''} sans confirmation`,
      href: interviewsHref({ campaignId, section: 'a_pointer' }),
    });
  }

  return lignes;
}

// ── ③ Trouver des candidats ─────────────────────────────────────────────────

export type CardSource = {
  key: 'annonce' | 'vivier' | 'approches';
  label: string;
  icon: string;
  color: string;
  /** L'état, en français d'utilisateur. Jamais vide : « rien » se dit. */
  state: string;
  /** `null` quand le geste n'est pas offert — la raison est dans `reason`. */
  href: string | null;
  /** Pourquoi c'est fermé. Rendu SEULEMENT quand `href` est nul. */
  reason: string | null;
};

export type CardSourceFacts = {
  /** Statut de la campagne : rien ne se diffuse depuis un brouillon. */
  isDraft: boolean;
  annonce: string;
  vivier: string;
  approches: string;
  /** Module Sourcing éteint : l'entrée n'est pas offerte, et c'est dit. */
  sourcingEnabled: boolean;
};

/**
 * Les trois portes d'entrée de candidatures.
 *
 * ⚠️ FERMÉES SUR UN BROUILLON, et la raison est ÉCRITE. Diffuser depuis un
 * brouillon fait arriver des candidatures que le chemin email n'analysera pas
 * (il ne traite que les campagnes actives) : on appellerait des CV pour les
 * laisser tomber. Un bouton grisé sans un mot ne déplace pas le besoin, il le
 * supprime — d'où la raison à côté.
 */
export function buildCardSources(
  campaignId: string,
  facts: CardSourceFacts,
): CardSource[] {
  const bloque = facts.isDraft
    ? 'Activez la campagne d’abord : un brouillon ne reçoit rien.'
    : null;

  return [
    {
      key: 'annonce',
      label: 'Diffuser l’annonce',
      icon: '📣',
      color: 'var(--dash-blue)',
      state: facts.annonce,
      // ⚠️ Un ÉCRAN, plus un bloc d'accordéon : « Diffuser l'annonce » ouvrait
      // la feuille d'édition sur neuf blocs dont un seul était demandé. Le
      // geste nommé occupe l'écran, et il a sa propre adresse (partageable,
      // rechargeable, atteignable par un signal).
      href: bloque ? null : `/campagnes/${encodeURIComponent(campaignId)}/annonce`,
      reason: bloque,
    },
    {
      key: 'vivier',
      label: 'Chercher dans le vivier',
      icon: '🗂️',
      color: 'var(--dash-green)',
      state: facts.vivier,
      href: bloque ? null : `/campagnes/${encodeURIComponent(campaignId)}/vivier`,
      reason: bloque,
    },
    {
      key: 'approches',
      label: 'Approcher des profils',
      icon: '🔎',
      color: 'var(--dash-purple)',
      state: facts.approches,
      href:
        bloque || !facts.sourcingEnabled
          ? null
          : `/campagnes/sourcing?campagne=${encodeURIComponent(campaignId)}`,
      reason: facts.sourcingEnabled
        ? bloque
        : 'Cette fonction n’est pas activée sur votre installation.',
    },
  ];
}
