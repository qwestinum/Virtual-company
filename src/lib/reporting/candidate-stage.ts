/**
 * Étape COURANTE d'une candidature dans le pipeline (menu Candidatures).
 * PUR, CLIENT-SAFE, testable. Helper UNIQUE partagé par le ruban de compteurs
 * ET par chaque ligne de la liste — un seul chemin de dérivation, jamais deux.
 *
 * Granularité « pipeline » (10 étapes) plus fine que le `CandidateJourney`
 * (4 phases) : c'est l'« où en est ce candidat MAINTENANT », pas la frise des
 * phases. Les deux dérivent des mêmes signaux ; ce module ne lit QUE des champs
 * issus de SOURCES COMPLÈTES (colonnes candidate_analyses + tables
 * pending_validations / interview_briefs + 3 marqueurs journal bas-volume) —
 * JAMAIS d'un scan de journal tronqué (cf. compteurs exhaustifs).
 *
 * Le MOT distingue le moment (lexique, feat/feedback-candidat 28/09/2026) :
 * Invité / Écarté sur CV, Retenu / Non retenu après entretien — un libellé à
 * l'écran, la définition au survol (`CANDIDATE_STAGE_DEFINITIONS`).
 *
 * Échelle « le plus avancé gagne » (priorité décroissante) :
 *   0. Sans suite (classement terminal, raison externe — domine TOUT état
 *      ouvert : jamais une évaluation, cf. src/types/dismissal.ts)
 *   1. Recruté (désigné à la clôture — marqueur humain explicite)
 *   2. Retenu (verdict positif après entretien, présenté au client)
 *   3. Non retenu (verdict négatif après entretien, non sélectionné, absent)
 *   4. Entretien fait
 *   5. RDV pris
 *   6. Invité (accepté, en attente des étapes d'entretien)
 *   7. À valider (zone grise, arbitrage humain en attente)
 *      Propositions de refus (sous le seuil bas, revue groupée en attente)
 *   8. Écarté (refusé sur CV par le recruteur ; inclut les refus automatiques
 *      antérieurs au 18/08 — la ZONE `auto_reject` reste en base, intacte)
 */

import {
  isAwaitingHumanZone,
  type DecidedBy,
  type DecisionZone,
} from '@/types/hitl';
import type { CandidateStatus } from '@/types/scoring';

export const CANDIDATE_STAGES = [
  'recrute',
  'retenu',
  'entretien_fait',
  'rdv_pris',
  'invite',
  'a_valider',
  'proposition_refus',
  'sans_suite',
  'non_retenu',
  'ecarte',
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
  /** Désignation du recruté (candidate_hired_marked) — bas volume. */
  hiredMarked: boolean;
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

  // 1 — désigné recruté à la clôture. Une désignation ne vaut que sur un
  // dossier RETENU : sans verdict positif courant (verdict corrigé ensuite),
  // elle ne fabrique pas un recruté — on ne déduit jamais une embauche.
  if (input.hiredMarked && input.validationMarked === 'validated') return 'recrute';

  // 2-3 — décision finale humaine (marqueur journal, bas volume).
  if (input.validationMarked === 'validated') return 'retenu';
  if (input.validationMarked === 'rejected') return 'non_retenu';

  // 4 — entretien marqué réalisé / manqué (marqueur journal, clé par uid → fiable).
  if (input.interviewMarked === 'realized') return 'entretien_fait';
  if (input.interviewMarked === 'missed') return 'non_retenu';

  // 5 — réservation reçue. GARDE : uniquement pour un candidat ACCEPTÉ.
  // Le signal « RDV » est rapproché par EMAIL (interview_briefs) ; sans cette
  // garde, un gris/refusé dont l'email a une réservation (ré-analyse du même
  // email, données de test) serait FAUSSEMENT tagué « RDV pris ». On ne réserve
  // un entretien qu'APRÈS acceptation → exiger status='accepted' lève l'ambiguïté.
  if (input.status === 'accepted' && input.hasScheduledInterview) return 'rdv_pris';

  // 6 — accepté (auto_accept OU gris accepté par l'humain) → invité, en attente
  // des étapes d'entretien.
  if (input.status === 'accepted') return 'invite';

  // 7 — encore en attente d'une décision humaine. La ZONE figée au scoring
  // départage les deux files (même règle que `partitionRejectionProposals`) :
  // sous le seuil bas ⇒ proposition de refus, sinon arbitrage.
  const awaitingStage: CandidateStage =
    input.decisionZone === 'proposed_reject' ? 'proposition_refus' : 'a_valider';
  if (input.isPendingValidation) return awaitingStage;

  // 8 — rejeté sur CV. Deux cas à ne pas confondre :
  //   a. un HUMAIN a tranché (quelle que soit la zone) → « Écarté ». C'est le
  //      test qui prime : depuis la conformité RGPD, un refus sous le seuil
  //      bas est lui aussi tranché par une personne.
  if (input.decidedBy === 'user') return 'ecarte';
  //   b. zone en attente d'un humain mais AUCUNE ligne de file : la mise en
  //      file a échoué (le gate a différé, rien n'est parti). C'est un dossier
  //      à traiter, pas un refus consommé.
  if (isAwaitingHumanZone(input.decisionZone)) return awaitingStage;
  //   c. reste le refus AUTOMATIQUE de l'ancien régime (`auto_reject`, ou
  //      ligne legacy sans zone) : compté « Écarté » (arbitrage du 28/09/2026,
  //      l'infobulle le dit).
  return 'ecarte';
}

// ─── Présentation (libellés + tonalité) ───────────────────────────────────

/** Libellé d'ÉCRAN — un ou deux mots, jamais un complément (lexique). */
export const CANDIDATE_STAGE_LABELS: Record<CandidateStage, string> = {
  a_valider: 'À valider',
  proposition_refus: 'Propositions de refus',
  invite: 'Invité',
  rdv_pris: 'RDV pris',
  entretien_fait: 'Entretien fait',
  retenu: 'Retenu',
  recrute: 'Recruté',
  ecarte: 'Écarté',
  non_retenu: 'Non retenu',
  sans_suite: 'Sans suite',
};

/** Définition longue — infobulle et lexique (docs/ux/lexique.md). */
export const CANDIDATE_STAGE_DEFINITIONS: Record<CandidateStage, string> = {
  a_valider: 'en zone d’arbitrage, attend une décision humaine.',
  proposition_refus: 'sous les critères, en attente de revue groupée.',
  invite: 'accepté sur CV (par les règles ou par un humain), invitation envoyée.',
  rdv_pris: 'créneau réservé.',
  entretien_fait: 'entretien confirmé, verdict attendu.',
  retenu: 'retenu par le cabinet après entretien, présenté au client.',
  recrute: 'désigné à la clôture d’une campagne conclue.',
  ecarte:
    'refusé sur CV par le recruteur (proposition validée ou arbitrage) ; inclut les refus automatiques antérieurs au 18/08.',
  non_retenu:
    'verdict négatif du cabinet après entretien, ou retenu non sélectionné à la clôture.',
  sans_suite: 'aucune décision prise (invitation sans réponse, clôture).',
};

/** Infobulle d'une étape : « Écarté — refusé sur CV par le recruteur… ». */
export function stageHint(stage: CandidateStage): string {
  return `${CANDIDATE_STAGE_LABELS[stage]} — ${CANDIDATE_STAGE_DEFINITIONS[stage]}`;
}

export type CandidateStageTone =
  | 'positive'
  | 'progress'
  | 'pending'
  | 'negative'
  | 'neutral';

export const CANDIDATE_STAGE_TONES: Record<CandidateStage, CandidateStageTone> = {
  recrute: 'positive',
  retenu: 'positive',
  entretien_fait: 'progress',
  rdv_pris: 'progress',
  invite: 'progress',
  a_valider: 'pending',
  proposition_refus: 'pending',
  // Ni vert ni rouge : un sans-suite n'est PAS une évaluation.
  sans_suite: 'neutral',
  non_retenu: 'negative',
  ecarte: 'negative',
};

/** Ordre d'affichage du ruban (pipeline → issues). ⚠️ TABLEAU, pas un
 * Record : une étape absente ici est INVISIBLE dans le ruban sans erreur de
 * compilation — un test vérifie qu'il couvre `CANDIDATE_STAGES`. */
export const CANDIDATE_STAGE_RIBBON_ORDER: CandidateStage[] = [
  'a_valider',
  'proposition_refus',
  'invite',
  'rdv_pris',
  'entretien_fait',
  'retenu',
  'recrute',
  'ecarte',
  'non_retenu',
  'sans_suite',
];

/**
 * Étapes OUVERTES — classables sans suite, listées dans le récapitulatif de
 * clôture. SOURCE UNIQUE (serveur : `dismissal-batch` ; écran : dialog de
 * clôture) — une liste d'exclusions tenue à côté avait divergé. `retenu` et
 * `recrute` sont des issues : on ne classe jamais sans suite un retenu.
 */
export const OPEN_CANDIDATE_STAGES: readonly CandidateStage[] = [
  'a_valider',
  'proposition_refus',
  'invite',
  'rdv_pris',
  'entretien_fait',
];

export type CandidateStageCounts = Record<CandidateStage, number>;

/** Compteurs à zéro (base de l'agrégation). */
export function emptyStageCounts(): CandidateStageCounts {
  return Object.fromEntries(CANDIDATE_STAGES.map((s) => [s, 0])) as CandidateStageCounts;
}

/** Agrège une liste d'étapes en compteurs (ruban). */
export function tallyStages(stages: Iterable<CandidateStage>): CandidateStageCounts {
  const counts = emptyStageCounts();
  for (const s of stages) counts[s] += 1;
  return counts;
}
