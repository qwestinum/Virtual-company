/**
 * Dérivation du PARCOURS candidat (cf. demande de traçabilité au-delà du
 * screening). CLIENT-SAFE, PUR, testable.
 *
 * Source de vérité unique : le JOURNAL (mêmes marqueurs que le dashboard
 * écrit — `candidate_interview_marked`, `candidate_validation_marked`, et
 * l'override HITL via `recommendation`). L'audit ne fait que LIRE et dériver
 * — il ne pilote rien (l'édition reste dans le dashboard).
 *
 * 5 étapes (option retenue) :
 *   Écarté (screening) · Retenu (screening) · Entretien réalisé ·
 *   Accepté définitivement · Refusé après entretien.
 *
 * + `humanIntervention` : la décision humaine CONTREDIT le verdict IA du
 *   screening (le recruteur a « switché » l'issue).
 */

import type { CandidateStatus } from '@/types/scoring';

export const CANDIDATE_STAGES = [
  'ecarte_screening',
  'retenu_screening',
  'entretien_realise',
  'accepte',
  'refuse_apres_entretien',
] as const;

export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

export const CANDIDATE_STAGE_LABELS: Record<CandidateStage, string> = {
  ecarte_screening: 'Écarté au screening',
  retenu_screening: 'Retenu au screening',
  entretien_realise: 'Entretien réalisé',
  accepte: 'Accepté définitivement',
  refuse_apres_entretien: 'Refusé après entretien',
};

/** Couleur d'accent par étape (pastilles UI / PDF). */
export const CANDIDATE_STAGE_COLORS: Record<CandidateStage, string> = {
  ecarte_screening: '#b91c1c', // red-700
  retenu_screening: '#0891b2', // cyan-700
  entretien_realise: '#7c3aed', // violet-600
  accepte: '#15803d', // green-700
  refuse_apres_entretien: '#b45309', // amber-700
};

/**
 * Signaux d'entrée, alignés sur ce que le dashboard dérive du journal
 * (`CandidateRow`) + le verdict de screening (analyse CV persistée).
 */
export type CandidateJourneyInput = {
  /** Verdict du screening (analyse CV). */
  screeningStatus: CandidateStatus;
  /** Marqueur DRH « entretien réalisé / non réalisé ». null = non marqué. */
  interviewMarked: 'realized' | 'missed' | null;
  /** Marqueur DRH « validation définitive / refus ». null = non marqué. */
  validationMarked: 'validated' | 'rejected' | null;
  /**
   * Recommandation finale telle qu'affichée au dashboard (intègre déjà
   * l'override HITL : un refus screening switché en acceptation = 'go').
   * Sert à détecter l'intervention humaine côté outreach.
   */
  recommendation: 'go' | 'no-go' | null;
};

export type CandidateJourney = {
  stage: CandidateStage;
  /** La décision humaine a-t-elle contredit le verdict IA du screening ? */
  humanIntervention: boolean;
};

/**
 * Dérive l'étape la plus AVANCÉE atteinte + le drapeau d'intervention
 * humaine. Précédence : validation définitive > refus > entretien réalisé >
 * non-présentation > retenu > écarté.
 */
export function deriveCandidateJourney(
  input: CandidateJourneyInput,
): CandidateJourney {
  const { screeningStatus, interviewMarked, validationMarked, recommendation } =
    input;
  const aiGo = screeningStatus === 'accepted';

  let stage: CandidateStage;
  if (validationMarked === 'validated') {
    stage = 'accepte';
  } else if (validationMarked === 'rejected') {
    stage = 'refuse_apres_entretien';
  } else if (interviewMarked === 'realized') {
    stage = 'entretien_realise';
  } else if (interviewMarked === 'missed') {
    stage = 'refuse_apres_entretien';
  } else if (aiGo || recommendation === 'go') {
    stage = 'retenu_screening';
  } else {
    stage = 'ecarte_screening';
  }

  // Intervention humaine = une décision humaine contredit le verdict IA du
  // screening. Deux familles de signaux :
  //   - override OUTREACH (HITL) : la recommandation finale du dashboard
  //     (qui intègre déjà le switch HITL) diffère du verdict IA. Pour un
  //     candidat retenu au screening, la reco par défaut est 'go' ; un 'go'
  //     qui tombe = un refus humain switché, et inversement.
  //   - décision FINALE contradictoire : validation d'un écarté, ou refus
  //     d'un recommandé, après entretien.
  const finalGo = recommendation === 'go';
  const humanIntervention =
    finalGo !== aiGo ||
    (validationMarked === 'validated' && !aiGo) ||
    (validationMarked === 'rejected' && aiGo);

  return { stage, humanIntervention };
}

/**
 * Variante tolérante pour l'enrichissement endpoint : dérive le parcours
 * à partir du verdict screening + des marqueurs journal éventuels. Sans
 * marqueurs (candidat jamais avancé manuellement), la recommandation
 * retombe sur le verdict screening (retenu → 'go', écarté → aucune).
 */
export function deriveJourneyFor(
  screeningStatus: CandidateStatus,
  markers?: {
    interviewMarked: 'realized' | 'missed' | null;
    validationMarked: 'validated' | 'rejected' | null;
    recommendation: 'go' | 'no-go' | null;
  },
): CandidateJourney {
  return deriveCandidateJourney({
    screeningStatus,
    interviewMarked: markers?.interviewMarked ?? null,
    validationMarked: markers?.validationMarked ?? null,
    recommendation:
      markers?.recommendation ??
      (screeningStatus === 'accepted' ? 'go' : null),
  });
}
