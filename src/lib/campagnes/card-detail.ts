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
  /** Icône et couleur de la tuile — celles de la carte existante. */
  icon: string;
  color: string;
};

/**
 * Les étapes montrées sur la carte, dans l'ordre du pipeline.
 *
 * ⚠️ TABLEAU, pas un Record : une étape ajoutée au domaine n'apparaît pas ici
 * sans qu'on l'y mette, et c'est voulu — la carte est un résumé, pas le ruban.
 * Les terminaux (non retenu, sans suite) et « Entretien fait » restent à un
 * clic, dans Candidatures.
 */
const ETAPES_CARTE: CandidateStage[] = [
  'a_valider',
  'invite',
  'rdv_pris',
  'retenu',
];

/** Icône + couleur par étape — les jetons de la carte existante. */
const APPARENCE: Record<string, { icon: string; color: string }> = {
  recues: { icon: '📄', color: 'var(--dash-blue)' },
  a_valider: { icon: '⏳', color: 'var(--dash-yellow)' },
  invite: { icon: '✉️', color: 'var(--dash-purple)' },
  rdv_pris: { icon: '📅', color: 'var(--dash-teal)' },
  retenu: { icon: '✅', color: 'var(--dash-green)' },
};

export function buildCardCounters(
  campaignId: string,
  received: number,
  counts: CandidateStageCounts,
): CardCounter[] {
  return [
    {
      key: 'recues',
      // « Reçues » n'est pas une étape : c'est le total, et il reste
      // cliquable — vers la campagne, tous statuts confondus.
      label: 'Reçues',
      count: received,
      href: candidaturesHref({ campaignId }),
      ...APPARENCE.recues!,
    },
    ...ETAPES_CARTE.map((stage) => ({
      key: stage,
      label: CANDIDATE_STAGE_LABELS[stage],
      count: counts[stage],
      // ⚠️ TOUS vers Candidatures, SANS EXCEPTION — « Invité » et « RDV pris »
      // compris : leurs puces existent là, et un compteur qui changerait
      // d'écran selon l'étape obligerait à deviner où l'on va. Entretiens se
      // rejoint par « ce qui attend », jamais par un compteur.
      href: candidaturesHref({ campaignId, stage }),
      ...APPARENCE[stage]!,
    })),
  ];
}

// ── ② Ce qui attend ─────────────────────────────────────────────────────────

export type CardAwaiting = { key: string; text: string; href: string };

/**
 * DEUX LIGNES MAXIMUM, et seulement ce qui attend vraiment.
 *
 * Une carte qui énumère tout ce qui pourrait se faire ne dit plus ce qui doit
 * se faire. Une campagne sans rien en attente n'affiche pas ce bloc.
 */
export function buildCardAwaiting(
  campaignId: string,
  input: {
    aValider: number;
    /** Ancienneté du plus ancien dossier en attente, en jours. */
    aValiderOldestDays: number | null;
    /** Entretiens passés que personne n'a confirmés. */
    entretiensAConfirmer: number;
  },
): CardAwaiting[] {
  const lignes: CardAwaiting[] = [];

  if (input.aValider > 0) {
    const age =
      input.aValiderOldestDays !== null && input.aValiderOldestDays > 0
        ? ` — la plus ancienne depuis ${input.aValiderOldestDays} jour${input.aValiderOldestDays > 1 ? 's' : ''}`
        : '';
    lignes.push({
      key: 'a_valider',
      text: `${input.aValider} candidature${input.aValider > 1 ? 's' : ''} à valider${age}`,
      href: candidaturesHref({ campaignId, stage: 'a_valider' }),
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

  return lignes.slice(0, 2);
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
      href: bloque ? null : `/campagnes?campagne=${encodeURIComponent(campaignId)}&ouvrir=channels`,
      reason: bloque,
    },
    {
      key: 'vivier',
      label: 'Chercher dans le vivier',
      icon: '🗂️',
      color: 'var(--dash-green)',
      state: facts.vivier,
      href: bloque ? null : `/campagnes?campagne=${encodeURIComponent(campaignId)}&ouvrir=vivier`,
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
