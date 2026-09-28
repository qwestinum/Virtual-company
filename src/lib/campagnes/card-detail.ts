/**
 * Le contenu DÉPLIÉ d'une carte campagne — quatre blocs. PUR, testé.
 *
 * ① compteurs-filtres · ② ce qui attend · ③ trouver des candidats · ④ actions
 *
 * ⚠️ LES COMPTEURS SONT UN ENTONNOIR (règle du donneur d'ordre, 28/09/2026) :
 * chaque candidature PASSÉE par une étape augmente son compteur — reçues,
 * passées par la validation, invitées, reçues en entretien, retenues,
 * recrutées — soldé par le taux de conversion (recrutés / reçues). Un recruté
 * a été retenu. L'option A de la maquette v2 (§B.1 : compteurs = étapes
 * COURANTES) est RENVERSÉE : sur une campagne clôturée, elle affichait
 * « Retenu 0 » quand deux candidats avaient été retenus.
 *
 * Le piège qui l'avait motivée — cliquer un chiffre et atterrir sur une liste
 * qui ne le montre pas — est tenu autrement : chaque compteur ouvre le filtre
 * de PARCOURS de Candidatures (`?parcours=…`, même règle `passedThrough`), qui
 * liste EXACTEMENT les candidatures comptées. Les puces de Candidatures, elles,
 * gardent l'étape courante.
 */

import { CANDIDATE_STAGE_LABELS } from '@/lib/reporting/candidate-stage';
import {
  conversionRate,
  STEP_PARCOURS,
  TRAJECTORY_STEPS,
  type TrajectoryCounts,
  type TrajectoryStep,
} from '@/lib/reporting/campaign-trajectory';
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
 * Les étapes de la carte : le FUNNEL POSITIF, sur UNE rangée. Les issues
 * négatives (Écarté, Non retenu, Sans suite) se lisent dans Candidatures et
 * Pilotage.
 */
export const CARD_STAGES = TRAJECTORY_STEPS;

/** Icône + couleur par étape — les jetons de la carte existante. */
const APPARENCE: Record<'recues' | TrajectoryStep, { icon: string; color: string }> = {
  recues: { icon: '📄', color: 'var(--dash-blue)' },
  a_valider: { icon: '⏳', color: 'var(--dash-yellow)' },
  invite: { icon: '✉️', color: 'var(--dash-purple)' },
  entretien_fait: { icon: '🤝', color: 'var(--dash-blue)' },
  retenu: { icon: '✅', color: 'var(--dash-green)' },
  recrute: { icon: '🏁', color: 'var(--dash-green)' },
};

/** Ce que compte chaque tuile — au survol, en mots d'utilisateur. */
const DEFINITION: Record<TrajectoryStep, string> = {
  a_valider: 'candidatures passées par la validation humaine (arbitrage ou proposition de refus).',
  invite: 'candidatures retenues sur CV et invitées à un entretien.',
  entretien_fait: 'candidatures dont l’entretien a eu lieu.',
  retenu: 'candidatures retenues après entretien — y compris les recrutés et les retenus non sélectionnés à la clôture.',
  recrute: 'candidats désignés recrutés à la clôture.',
};

export function buildCardCounters(campaignId: string, trajectory: TrajectoryCounts): CardCounter[] {
  return [
    {
      key: 'recues',
      // « Reçues » : le total, cliquable — vers la campagne, tous statuts.
      label: 'Reçues',
      definition: 'toutes les candidatures de la campagne.',
      count: trajectory.recues,
      href: candidaturesHref({ campaignId }),
      ...APPARENCE.recues,
    },
    ...CARD_STAGES.map((step) => ({
      key: step,
      label: CANDIDATE_STAGE_LABELS[step],
      definition: DEFINITION[step],
      count: trajectory[step],
      // Le filtre de PARCOURS : la liste ouverte montre exactement ce nombre.
      href: candidaturesHref({ campaignId, parcours: STEP_PARCOURS[step] }),
      ...APPARENCE[step],
    })),
  ];
}

/**
 * « Taux de conversion : 50 % — 1 recruté sur 2 candidatures reçues ».
 * `null` sans candidature (rien à convertir).
 */
export function conversionLine(trajectory: TrajectoryCounts): string | null {
  const rate = conversionRate(trajectory);
  if (rate === null) return null;
  const r = trajectory.recrute;
  const n = trajectory.recues;
  return `Taux de conversion : ${rate} % — ${r} recruté${r > 1 ? 's' : ''} sur ${n} candidature${n > 1 ? 's' : ''} reçue${n > 1 ? 's' : ''}`;
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
