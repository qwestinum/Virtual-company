/**
 * Le PARCOURS d'une campagne — combien de candidatures sont PASSÉES par
 * chaque étape. PUR, testé (28/09/2026).
 *
 * Règle du donneur d'ordre : « chaque candidature qui passe par un statut
 * augmente le compteur ». On lit la campagne comme un ENTONNOIR — reçues,
 * passées par la validation humaine, invitées, reçues en entretien, retenues,
 * recrutées — soldé par le TAUX DE CONVERSION = recrutés / reçues. Un recruté
 * a été retenu ; un retenu non sélectionné à la clôture a été retenu.
 *
 * ⚠️ Ce n'est PAS l'étape COURANTE (`stageFor`) : celle-ci partitionne (la
 * somme des étapes = reçues) et sert les PUCES de Candidatures, qui disent
 * où en est chaque dossier aujourd'hui. Les deux lectures coexistent.
 *
 * Une décision CORRIGÉE compte pour son état actuel (marqueurs dernier-gagne) :
 * une correction répare une erreur de saisie, elle n'est pas un passage. Seul
 * le « non retenu » POSÉ À LA CLÔTURE garde le passage par « Retenu ».
 */
import type { StageSignals } from '@/lib/reporting/stage-signals';
import type { DecisionZone } from '@/types/hitl';

export const TRAJECTORY_STEPS = ['a_valider', 'invite', 'entretien_fait', 'retenu', 'recrute'] as const;
export type TrajectoryStep = (typeof TRAJECTORY_STEPS)[number];

export type TrajectoryCounts = Record<'recues' | TrajectoryStep, number>;

export type TrajectorySignals = Pick<
  StageSignals,
  'interviewMarks' | 'validationMarks' | 'hiredUids' | 'notSelectedUids'
>;

type AnalysisLike = { uid: string; status: string; decisionZone: DecisionZone | null | undefined };

/** Zones passées par la validation humaine (arbitrage, proposition de refus). */
const HUMAN_REVIEW_ZONES: ReadonlySet<string> = new Set(['gray', 'proposed_reject']);

/**
 * La candidature est-elle PASSÉE par cette étape ? Monotone par construction :
 * recruté ⇒ retenu ⇒ entretien fait ⇒ invité (un recruté a été reçu, un reçu
 * en entretien a été invité — même si un marqueur intermédiaire manque).
 */
export function passedThrough(step: TrajectoryStep, a: AnalysisLike, s: TrajectorySignals): boolean {
  switch (step) {
    case 'recrute':
      // Même règle que l'étape (`deriveCandidateStage`) : désigné ET retenu —
      // une désignation dont le verdict a été corrigé ne recrute personne.
      return s.hiredUids.has(a.uid) && s.validationMarks.get(a.uid) === 'validated';
    case 'retenu':
      return (
        passedThrough('recrute', a, s) ||
        s.validationMarks.get(a.uid) === 'validated' ||
        s.notSelectedUids.has(a.uid)
      );
    case 'entretien_fait':
      return passedThrough('retenu', a, s) || s.interviewMarks.get(a.uid) === 'realized';
    case 'invite':
      return passedThrough('entretien_fait', a, s) || a.status === 'accepted';
    case 'a_valider':
      return HUMAN_REVIEW_ZONES.has(a.decisionZone ?? '');
  }
}

export function emptyTrajectoryCounts(): TrajectoryCounts {
  return { recues: 0, a_valider: 0, invite: 0, entretien_fait: 0, retenu: 0, recrute: 0 };
}

/** Ajoute une candidature aux compteurs (reçue + chaque étape traversée). */
export function addToTrajectory(counts: TrajectoryCounts, a: AnalysisLike, s: TrajectorySignals): void {
  counts.recues += 1;
  for (const step of TRAJECTORY_STEPS) if (passedThrough(step, a, s)) counts[step] += 1;
}

export function computeTrajectoryCounts(
  analyses: readonly AnalysisLike[],
  s: TrajectorySignals,
): TrajectoryCounts {
  const counts = emptyTrajectoryCounts();
  for (const a of analyses) addToTrajectory(counts, a, s);
  return counts;
}

/** Taux de conversion = recrutés / reçues, en % arrondi ; `null` sans candidature. */
export function conversionRate(counts: Pick<TrajectoryCounts, 'recues' | 'recrute'>): number | null {
  return counts.recues > 0 ? Math.round((counts.recrute / counts.recues) * 100) : null;
}

/**
 * Le filtre « passées par… » de Candidatures — ce qu'ouvre un compteur de la
 * carte : EXACTEMENT les candidatures qu'il compte. Clés d'URL en mots
 * (`?parcours=invitation`), les deux historiques gardées.
 */
export const PARCOURS_KEYS = ['validation', 'invitation', 'entretien', 'retenu', 'recrute'] as const;
export type ParcoursKey = (typeof PARCOURS_KEYS)[number];

export const PARCOURS_STEP: Record<ParcoursKey, TrajectoryStep> = {
  validation: 'a_valider',
  invitation: 'invite',
  entretien: 'entretien_fait',
  retenu: 'retenu',
  recrute: 'recrute',
};

export const STEP_PARCOURS: Record<TrajectoryStep, ParcoursKey> = {
  a_valider: 'validation',
  invite: 'invitation',
  entretien_fait: 'entretien',
  retenu: 'retenu',
  recrute: 'recrute',
};

/** Libellé du filtre actif (chip retirable). */
export const PASSAGE_LABELS: Record<TrajectoryStep, string> = {
  a_valider: 'Passées par la validation',
  invite: 'Passées par l’invitation',
  entretien_fait: 'Passées par l’entretien',
  retenu: 'Passées par « Retenu »',
  recrute: 'Recrutées',
};

export function parseParcours(raw: string | null): ParcoursKey | null {
  return (PARCOURS_KEYS as readonly string[]).includes(raw ?? '') ? (raw as ParcoursKey) : null;
}
