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
 *   0. Sans suite (classement terminal, raison externe — domine TOUT état
 *      ouvert : jamais une évaluation, cf. src/types/dismissal.ts)
 *   1. Retenu (GO définitif humain)
 *   2. Non retenu (refus après process : validation/entretien)
 *   3. Entretien fait
 *   4. RDV pris (réservation Cal.com)
 *   5. Invité (accepté, en attente des étapes d'entretien)
 *   6. À valider (zone grise OU proposée au refus, décision humaine en attente)
 *   7. Refus auto (zone auto_reject — LEGACY, ancien régime d'envoi automatique)
 */

import {
  isAwaitingHumanZone,
  type DecidedBy,
  type DecisionZone,
} from '@/types/hitl';
import type { CandidateStatus } from '@/types/scoring';

export const CANDIDATE_STAGES = [
  'retenu',
  'entretien_fait',
  'rdv_pris',
  'invite',
  'a_valider',
  'sans_suite',
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
  /** Présent dans pending_validations en `pending`/`sending` (attente humaine). */
  isPendingValidation: boolean;
  /** Une réservation Cal.com existe (interview_briefs.status='scheduled'). */
  hasScheduledInterview: boolean;
  /** Marqueur journal entretien (candidate_interview_marked) — bas volume. */
  interviewMarked: 'realized' | 'missed' | null;
  /** Marqueur journal validation finale (candidate_validation_marked) — bas volume. */
  validationMarked: 'validated' | 'rejected' | null;
  /** Classée sans suite (candidate_analyses.dismissed_at non null). */
  isDismissed: boolean;
};

/**
 * Dérive l'étape courante. Ordre = échelle ci-dessus. Note sur « Invité » :
 * l'acceptation EST une colonne (status='accepted'), l'invitation en découle —
 * on ne dépend donc pas du journal d'envoi (haut volume). Un accepté sans étape
 * d'entretien postérieure est « Invité ».
 */
export function deriveCandidateStage(input: CandidateStageInput): CandidateStage {
  // 0 — classée sans suite : terminal, domine TOUT (y compris les marqueurs) —
  // c'est ce qui éteint les signaux métier PAR CONSTRUCTION (stage ≠ ouvert).
  if (input.isDismissed) return 'sans_suite';

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

  // 6 — encore en attente d'une décision humaine (gris OU proposé au refus).
  if (input.isPendingValidation) return 'a_valider';

  // 7 — rejeté. Trois cas à ne pas confondre :
  //   a. un HUMAIN a tranché (quelle que soit la zone) → « Non retenu ». C'est
  //      le test qui prime : depuis la conformité RGPD, un refus sous le seuil
  //      bas est lui aussi tranché par une personne, et l'étiqueter « Refus
  //      auto » raconterait le contraire de ce qui s'est passé.
  if (input.decidedBy === 'user') return 'non_retenu';
  //   b. zone en attente d'un humain mais AUCUNE ligne de file : la mise en
  //      file a échoué (le gate a différé, rien n'est parti). C'est un dossier
  //      à traiter, pas un refus consommé.
  if (isAwaitingHumanZone(input.decisionZone)) return 'a_valider';
  //   c. reste le refus AUTOMATIQUE de l'ancien régime (`auto_reject`, ou
  //      ligne legacy sans zone) : là, le mail est bien parti tout seul.
  return 'refus_auto';
}

// ─── Présentation (libellés + tonalité) ───────────────────────────────────

export const CANDIDATE_STAGE_LABELS: Record<CandidateStage, string> = {
  retenu: 'Retenu',
  entretien_fait: 'Entretien fait',
  rdv_pris: 'RDV pris',
  invite: 'Invité',
  a_valider: 'À valider',
  sans_suite: 'Sans suite',
  non_retenu: 'Non retenu',
  // LEGACY : plus jamais produit — l'ancien régime où le refus partait seul.
  refus_auto: 'Refus auto',
};

export type CandidateStageTone =
  | 'positive'
  | 'progress'
  | 'pending'
  | 'negative'
  | 'neutral';

export const CANDIDATE_STAGE_TONES: Record<CandidateStage, CandidateStageTone> = {
  retenu: 'positive',
  entretien_fait: 'progress',
  rdv_pris: 'progress',
  invite: 'progress',
  a_valider: 'pending',
  // Ni vert ni rouge : un sans-suite n'est PAS une évaluation.
  sans_suite: 'neutral',
  non_retenu: 'negative',
  refus_auto: 'negative',
};

/** Ordre d'affichage du ruban (pipeline → terminaux). ⚠️ TABLEAU, pas un
 * Record : une étape absente ici est INVISIBLE dans le ruban sans erreur de
 * compilation — toute nouvelle étape doit y être ajoutée à la main. */
export const CANDIDATE_STAGE_RIBBON_ORDER: CandidateStage[] = [
  'a_valider',
  'invite',
  'rdv_pris',
  'entretien_fait',
  'retenu',
  'non_retenu',
  'refus_auto',
  'sans_suite',
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
    sans_suite: 0,
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
