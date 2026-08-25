/**
 * Correction d'une décision candidat posée par erreur — contrat partagé
 * client/serveur. PUR (aucun import serveur).
 *
 * Principe : on ne défait rien, on POSE l'état voulu. La correction remet le
 * dossier dans l'état correct ; elle n'annule aucun effet déjà produit (un
 * mail parti reste parti) et ne déclenche AUCUN envoi, quel que soit le
 * nouvel état — même quand cet état correspondrait normalement à un envoi.
 * C'est ensuite à l'humain d'agir depuis les surfaces normales.
 */

import type { CandidateStage } from '@/lib/reporting/candidate-stage';
import type { DismissalReason } from '@/types/dismissal';

/** Nature de la décision corrigée — décide du writer canonique employé. */
export type CorrectionKind =
  | 'interview' // marqueur journal candidate_interview_marked
  | 'final_verdict' // marqueur journal candidate_validation_marked
  | 'screening_decision' // colonnes candidate_analyses (décision HITL / refus auto)
  | 'dismissal'; // colonnes dismissed_* + satellites (réouverture)

/**
 * Cibles de correction. Union FERMÉE : le serveur en fait un `switch`
 * exhaustif, une cible ajoutée sans traitement ne compile pas.
 */
export const CORRECTION_TARGETS = [
  'interview_realized',
  'interview_missed',
  'interview_cleared',
  'verdict_validated',
  'verdict_rejected',
  'verdict_cleared',
  'screening_accepted',
  'screening_rejected',
  'dismissal_reopen',
] as const;
export type CorrectionTarget = (typeof CORRECTION_TARGETS)[number];

export function isCorrectionTarget(value: unknown): value is CorrectionTarget {
  return (CORRECTION_TARGETS as readonly string[]).includes(value as string);
}

/** Une option proposée dans le dialog (jamais un choix qui ne mène nulle part). */
export type CorrectionOption = {
  target: CorrectionTarget;
  label: string;
  detail: string;
};

/**
 * Un effet DÉJÀ déclenché par la décision qu'on corrige. Toujours au moins un
 * élément : quand rien n'est parti, on l'écrit. Un bloc absent se lirait comme
 * « pas vérifié ».
 */
export type CorrectionSideEffect = {
  code:
    | 'mail_sent'
    | 'mail_not_sent'
    | 'no_mail'
    | 'link_revoked'
    | 'link_active'
    | 'link_none'
    | 'booking_confirmed';
  text: string;
  emphasis: 'warning' | 'info';
};

/** La décision courante, telle que le dialog l'annonce. */
export type CurrentDecision =
  | { kind: 'interview'; value: 'realized' | 'missed' }
  | { kind: 'final_verdict'; value: 'validated' | 'rejected' }
  | { kind: 'screening_decision'; value: 'accepted' | 'rejected'; auto: boolean }
  | { kind: 'dismissal'; reason: DismissalReason | null };

/** Ce que sert `GET /api/candidatures/[id]/correction-context`. */
export type DecisionCorrectionContext = {
  analysisId: string;
  uid: string;
  candidateName: string;
  campaignId: string | null;
  stage: CandidateStage;
  /** Libellé de l'état courant (« Non retenu »). */
  stageLabel: string;
  /** `null` ⇒ aucune décision corrigible : l'action ne s'affiche pas. */
  current: CurrentDecision | null;
  /** Horodatage de la décision corrigée (ISO), `null` si introuvable. */
  decidedAt: string | null;
  /**
   * Auteur de la décision. `null` = non enregistré — les marqueurs
   * journalisés avant la capture d'identité n'en portent aucun, et on
   * n'invente jamais un nom.
   */
  decidedBy: string | null;
  sideEffects: CorrectionSideEffect[];
  options: CorrectionOption[];
  /** Rappels affichés sous les options (ce que la correction NE fait pas). */
  notices: string[];
};

/** Corps de `POST /api/candidatures/[id]/correct-decision`. */
export type DecisionCorrectionRequest = {
  target: CorrectionTarget;
  /** Motif libre, facultatif, conservé au journal. */
  reason?: string;
};

export type DecisionCorrectionResult = {
  status: 'corrected';
  previousStage: CandidateStage;
  nextStage: CandidateStage;
  /** Un lien de réservation encore actif a-t-il été désactivé ? */
  linkRevoked: boolean;
};
