/**
 * Étape COURANTE d'une candidature dans le pipeline (menu Candidatures).
 * PUR, CLIENT-SAFE, testable. Helper UNIQUE partagé par le ruban de compteurs
 * ET par chaque ligne de la liste — un seul chemin de dérivation, jamais deux.
 *
 * Granularité « pipeline » (7 étapes) plus fine que le `CandidateJourney`
 * (4 phases) : c'est l'« où en est ce candidat MAINTENANT », pas la frise des
 * phases. Les deux dérivent des mêmes signaux ; ce module ne lit QUE des champs
 * issus de SOURCES COMPLÈTES (colonnes candidate_analyses + tables
 * pending_validations / interview_briefs + 2 marqueurs journal bas-volume) —
 * JAMAIS d'un scan de journal tronqué (cf. compteurs exhaustifs).
 *
 * Échelle « le plus avancé gagne » (priorité décroissante) :
 *   1. Retenu (GO définitif humain)
 *   2. Non retenu (refus après process : validation/entretien)
 *   3. Entretien fait
 *   4. RDV pris (réservation Cal.com)
 *   5. Invité (accepté, en attente des étapes d'entretien)
 *   6. À valider (zone grise, décision humaine en attente)
 *   7. Refus auto (zone auto_reject, décision système)
 */

import type { DecidedBy, DecisionZone } from '@/types/hitl';
import type { CandidateStatus } from '@/types/scoring';

export const CANDIDATE_STAGES = [
  'retenu',
  'entretien_fait',
  'rdv_pris',
  'invite',
  'a_valider',
  'non_retenu',
  'refus_auto',
] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

/** Signaux d'étape — tous issus de sources COMPLÈTES (jamais tronquées). */
export type CandidateStageInput = {
  /** Verdict de screening (candidate_analyses.status). */
  status: CandidateStatus;
  /** Zone figée au scoring (candidate_analyses.decision_zone). */
  decisionZone: DecisionZone | null;
  /** Acteur de la décision (candidate_analyses.decided_by). */
  decidedBy: DecidedBy | null;
  /** Présent dans pending_validations en `pending` (gris en attente d'un humain). */
  isPendingValidation: boolean;
  /** Une réservation Cal.com existe (interview_briefs.status='scheduled'). */
  hasScheduledInterview: boolean;
  /** Marqueur journal entretien (candidate_interview_marked) — bas volume. */
  interviewMarked: 'realized' | 'missed' | null;
  /** Marqueur journal validation finale (candidate_validation_marked) — bas volume. */
  validationMarked: 'validated' | 'rejected' | null;
};

/**
 * Dérive l'étape courante. Ordre = échelle ci-dessus. Note sur « Invité » :
 * l'acceptation EST une colonne (status='accepted'), l'invitation en découle —
 * on ne dépend donc pas du journal d'envoi (haut volume). Un accepté sans étape
 * d'entretien postérieure est « Invité ».
 */
export function deriveCandidateStage(input: CandidateStageInput): CandidateStage {
  // 1-2 — décision finale humaine (marqueur journal, bas volume).
  if (input.validationMarked === 'validated') return 'retenu';
  if (input.validationMarked === 'rejected') return 'non_retenu';

  // 3 — entretien marqué réalisé / manqué (marqueur journal, clé par uid → fiable).
  if (input.interviewMarked === 'realized') return 'entretien_fait';
  if (input.interviewMarked === 'missed') return 'non_retenu';

  // 4 — réservation Cal.com reçue. GARDE : uniquement pour un candidat ACCEPTÉ.
  // Le signal « RDV » est rapproché par EMAIL (interview_briefs) ; sans cette
  // garde, un gris/refusé dont l'email a une réservation (ré-analyse du même
  // email, données de test) serait FAUSSEMENT tagué « RDV pris ». On ne réserve
  // un entretien qu'APRÈS acceptation → exiger status='accepted' lève l'ambiguïté.
  if (input.status === 'accepted' && input.hasScheduledInterview) return 'rdv_pris';

  // 5 — accepté (auto_accept OU gris accepté par l'humain) → invité, en attente
  // des étapes d'entretien.
  if (input.status === 'accepted') return 'invite';

  // 6 — gris encore en attente d'une décision humaine.
  if (input.isPendingValidation) return 'a_valider';

  // 7 — rejeté : distinguer le refus HUMAIN d'un gris (zone 'gray' immuable,
  // décision tranchée) du refus AUTOMATIQUE système (auto_reject / legacy).
  if (input.decisionZone === 'gray') return 'non_retenu';
  return 'refus_auto';
}

// ─── Présentation (libellés + tonalité) ───────────────────────────────────

export const CANDIDATE_STAGE_LABELS: Record<CandidateStage, string> = {
  retenu: 'Retenu',
  entretien_fait: 'Entretien fait',
  rdv_pris: 'RDV pris',
  invite: 'Invité',
  a_valider: 'À valider',
  non_retenu: 'Non retenu',
  refus_auto: 'Refus auto',
};

export type CandidateStageTone = 'positive' | 'progress' | 'pending' | 'negative';

export const CANDIDATE_STAGE_TONES: Record<CandidateStage, CandidateStageTone> = {
  retenu: 'positive',
  entretien_fait: 'progress',
  rdv_pris: 'progress',
  invite: 'progress',
  a_valider: 'pending',
  non_retenu: 'negative',
  refus_auto: 'negative',
};

/** Ordre d'affichage du ruban (pipeline → terminaux). */
export const CANDIDATE_STAGE_RIBBON_ORDER: CandidateStage[] = [
  'a_valider',
  'invite',
  'rdv_pris',
  'entretien_fait',
  'retenu',
  'non_retenu',
  'refus_auto',
];

export type CandidateStageCounts = Record<CandidateStage, number>;

/** Compteurs à zéro (base de l'agrégation). */
export function emptyStageCounts(): CandidateStageCounts {
  return {
    retenu: 0,
    entretien_fait: 0,
    rdv_pris: 0,
    invite: 0,
    a_valider: 0,
    non_retenu: 0,
    refus_auto: 0,
  };
}

/** Agrège une liste d'étapes en compteurs (ruban). */
export function tallyStages(stages: Iterable<CandidateStage>): CandidateStageCounts {
  const counts = emptyStageCounts();
  for (const s of stages) counts[s] += 1;
  return counts;
}
