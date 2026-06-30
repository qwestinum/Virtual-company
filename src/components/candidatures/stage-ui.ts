/**
 * Présentation UI des étapes de candidature + date intelligente. CLIENT.
 * Les libellés/ordre viennent du domaine (`candidate-stage.ts`) ; ici on ne
 * fait que la couleur d'affichage et le formatage de date relatif.
 */

import type {
  CandidateStage,
  CandidateStageTone,
} from '@/lib/reporting/candidate-stage';

// ── Tokens ORQA par étape (classes Tailwind `orqa-*`, source unique) ────────

/** Pastille de statut : texte + fond clair. */
export const STAGE_PILL_CLASS: Record<CandidateStage, string> = {
  retenu: 'text-orqa-vert bg-orqa-vert-bg',
  entretien_fait: 'text-orqa-nuit2 bg-orqa-brume2',
  rdv_pris: 'text-orqa-violet bg-orqa-violet-bg',
  invite: 'text-orqa-ciel bg-orqa-cielbg',
  a_valider: 'text-orqa-ambre bg-orqa-ambre-bg',
  non_retenu: 'text-orqa-rouge bg-orqa-rouge-bg',
  refus_auto: 'text-orqa-rouge bg-orqa-rouge-bg',
};

/** Point/tick de couleur pleine (ruban, légende, barre de carte). */
export const STAGE_DOT_CLASS: Record<CandidateStage, string> = {
  retenu: 'bg-orqa-vert',
  entretien_fait: 'bg-orqa-nuit2',
  rdv_pris: 'bg-orqa-violet',
  invite: 'bg-orqa-ciel',
  a_valider: 'bg-orqa-ambre',
  non_retenu: 'bg-orqa-rouge',
  refus_auto: 'bg-orqa-rouge',
};

/**
 * Rang de l'étape dans le mini-pipeline de ligne (1→5). Les terminaux négatifs
 * (refus auto / non retenu) sortent du pipeline → `0` (rendu « écarté »).
 */
export const STAGE_STEP: Record<CandidateStage, number> = {
  a_valider: 1,
  invite: 2,
  rdv_pris: 3,
  entretien_fait: 4,
  retenu: 5,
  refus_auto: 0,
  non_retenu: 0,
};

/** Initiales (max 2) pour l'avatar. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Couleur (texte sur fond clair) par tonalité d'étape. */
export const STAGE_TONE_COLOR: Record<CandidateStageTone, string> = {
  positive: '#15803d', // green-700
  progress: '#4338ca', // indigo-700
  pending: '#b45309', // amber-700
  negative: '#b91c1c', // red-700
};

/** Fond pastille (clair) par tonalité. */
export const STAGE_TONE_BG: Record<CandidateStageTone, string> = {
  positive: '#dcfce7',
  progress: '#e0e7ff',
  pending: '#fef3c7',
  negative: '#fee2e2',
};

/**
 * Date intelligente :
 *   - aujourd'hui → « aujourd'hui à 15h33 » (heure À LA MINUTE, zéro-paddée)
 *   - hier        → « hier à 10h02 »
 *   - 2–6 jours   → « il y a N jours »
 *   - 1–8 sem.    → « il y a N semaine(s) »
 *   - au-delà     → date absolue « 24 juin 2026 »
 * `now` injectable (tests).
 */
export function formatSmartDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';

  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const time = `${hh}h${mm}`;

  // Différence en JOURS CALENDAIRES (minuit local), pas en heures écoulées.
  const startOfDay = (x: Date): number =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);

  if (days <= 0) return `aujourd'hui à ${time}`;
  if (days === 1) return `hier à ${time}`;
  if (days < 7) return `il y a ${days} jours`;
  if (days < 60) {
    const weeks = Math.floor(days / 7);
    return `il y a ${weeks} semaine${weeks > 1 ? 's' : ''}`;
  }
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Les étapes terminales n'offrent aucune action (consultation seule). */
export function isTerminalStage(stage: CandidateStage): boolean {
  return stage === 'retenu' || stage === 'non_retenu' || stage === 'refus_auto';
}
