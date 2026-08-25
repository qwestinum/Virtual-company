/**
 * Signaux d'étape (menu Candidatures) — chargement SERVEUR EXHAUSTIF.
 *
 * Le calcul de l'étape (`deriveCandidateStage`, pur) a besoin, pour chaque
 * candidat, de quelques signaux d'overlay. Tous proviennent de SOURCES
 * COMPLÈTES, jamais d'un scan de journal tronqué (cf. le cap 500 de
 * `loadJourneySignals`, réservé au Dashboard résiduel) :
 *
 *   - gris en attente  → `pending_validations` (status='pending'), table complète
 *   - RDV pris         → `interview_briefs` (status='scheduled'), par email
 *   - entretien/valid.  → journal, MAIS seulement 2 actions BAS VOLUME, paginées
 *                          en entier (`listJournalEntriesByActions`, sans cap 500)
 *
 * C'est ce qui garantit que le ruban de compteurs reflète TOUS les candidats du
 * périmètre, pas seulement les 500 dernières entrées de journal.
 */

import {
  emptyInterviewState,
  emptyValidationState,
  foldInterviewMark,
  foldValidationMark,
  INTERVIEW_MARKER_ACTION,
  VALIDATION_MARKER_ACTION,
  type InterviewMarkEffect,
  type MarkerState,
  type ValidationMarkEffect,
} from '@/lib/candidatures/decision-markers';
import { listScheduledInterviewUids } from '@/lib/db/repos/interview-briefs';
import { listJournalEntriesByActions } from '@/lib/db/repos/journal';
import { listPendingValidations } from '@/lib/db/repos/pending-validations';
import {
  type CandidateStage,
  type CandidateStageCounts,
  deriveCandidateStage,
  tallyStages,
} from '@/lib/reporting/candidate-stage';
import {
  countCandidateAnalyses,
  listAllCandidateAnalyses,
} from '@/lib/db/repos/candidate-analyses';
import type { CandidateAnalysisSummary } from '@/types/reporting';

const INTERVIEW_ACTION = INTERVIEW_MARKER_ACTION;
const VALIDATION_ACTION = VALIDATION_MARKER_ACTION;

export type StageSignals = {
  /** uids présents dans la file HITL en `pending` (gris à trancher). */
  pendingUids: Set<string>;
  /** uids d'analyse avec une réservation Cal.com (`scheduled`) — RATTACHÉ PAR UID. */
  scheduledUids: Set<string>;
  /** uid → dernier marqueur entretien (journal, dernier-gagne). */
  interviewMarks: Map<string, 'realized' | 'missed'>;
  /**
   * uid → date (ISO) du marqueur entretien RETENU (le même que interviewMarks,
   * même passe dernier-gagne). Sert au signal métier « entretien réalisé sans
   * décision depuis N jours » — pas de relecture parallèle du journal.
   */
  interviewMarkedAt: Map<string, string>;
  /** uid → dernier marqueur validation finale (journal, dernier-gagne). */
  validationMarks: Map<string, 'validated' | 'rejected'>;
};

/** Périmètre du ruban / des compteurs : campagne(s) + période (JAMAIS la recherche). */
export type StagePerimeter = {
  campaignId?: string;
  /** Ensemble de campagnes (ex. « actives »). Prioritaire sur campaignId. */
  campaignIds?: string[];
  from?: string;
  to?: string;
};

function payloadUid(payload: Record<string, unknown>): string | null {
  return typeof payload.uid === 'string' ? payload.uid : null;
}

/**
 * Charge les signaux d'overlay du périmètre. Best-effort : toute lecture qui
 * échoue retombe sur un set/map vide (l'étape dégrade vers les colonnes seules).
 */
export async function loadStageSignals(
  perimeter: StagePerimeter = {},
): Promise<StageSignals> {
  const [pending, scheduledUids, markers] = await Promise.all([
    listPendingValidations().catch(() => []),
    listScheduledInterviewUids(perimeter.campaignId).catch(
      () => new Set<string>(),
    ),
    listJournalEntriesByActions([INTERVIEW_ACTION, VALIDATION_ACTION], {
      campaignId: perimeter.campaignId,
    }).catch(() => []),
  ]);

  const pendingUids = new Set<string>();
  for (const v of pending) {
    const uid = payloadUid(v.payload ?? {});
    if (uid) pendingUids.add(uid);
  }

  // Dernier-gagne délégué à `foldInterviewMark`/`foldValidationMark` : la
  // comparaison de dates y précède TOUJOURS l'interprétation de la valeur.
  // L'ancienne boucle filtrait `realized|missed` AVANT de retenir l'uid — un
  // marqueur gommé (`cleared`) était donc ignoré et le marquage ANTÉRIEUR
  // reprenait la main : la correction n'aurait rien changé à l'écran.
  const interviewStates = new Map<string, MarkerState<InterviewMarkEffect>>();
  const validationStates = new Map<string, MarkerState<ValidationMarkEffect>>();
  for (const entry of markers) {
    const uid = payloadUid(entry.payload);
    if (!uid) continue;
    if (entry.action === INTERVIEW_ACTION) {
      interviewStates.set(
        uid,
        foldInterviewMark(
          interviewStates.get(uid) ?? emptyInterviewState(),
          entry.payload,
          entry.createdAt,
        ),
      );
    } else if (entry.action === VALIDATION_ACTION) {
      validationStates.set(
        uid,
        foldValidationMark(
          validationStates.get(uid) ?? emptyValidationState(),
          entry.payload,
          entry.createdAt,
        ),
      );
    }
  }

  // Un marqueur gommé n'entre PAS dans les maps : l'uid en est absent, et
  // `stageFor` retombe sur les colonnes — exactement comme s'il n'avait
  // jamais été marqué.
  const interviewMarks = new Map<string, 'realized' | 'missed'>();
  const interviewMarkedAt = new Map<string, string>();
  for (const [uid, state] of interviewStates) {
    if (state.effect === null || state.at === null) continue;
    interviewMarks.set(uid, state.effect);
    interviewMarkedAt.set(uid, state.at);
  }
  const validationMarks = new Map<string, 'validated' | 'rejected'>();
  for (const [uid, state] of validationStates) {
    if (state.effect !== null) validationMarks.set(uid, state.effect);
  }

  return {
    pendingUids,
    scheduledUids,
    interviewMarks,
    interviewMarkedAt,
    validationMarks,
  };
}

/** Dérive l'étape courante d'un candidat à partir des signaux chargés. */
export function stageFor(
  c: CandidateAnalysisSummary,
  signals: StageSignals,
): CandidateStage {
  return deriveCandidateStage({
    status: c.status,
    decisionZone: c.decisionZone,
    decidedBy: c.decidedBy,
    isPendingValidation: signals.pendingUids.has(c.uid),
    // « RDV pris » rattaché par UID (≠ email) : une réservation pour CETTE
    // candidature, pas pour un autre traitement du même email.
    hasScheduledInterview: signals.scheduledUids.has(c.uid),
    interviewMarked: signals.interviewMarks.get(c.uid) ?? null,
    validationMarked: signals.validationMarks.get(c.uid) ?? null,
    // Classement sans suite — colonne dénormalisée, pas un signal chargé :
    // domine tout dans la dérivation (terminal).
    isDismissed: c.dismissedAt !== null,
  });
}

/**
 * Compteurs EXHAUSTIFS du ruban. Charge TOUT le périmètre (campagne + période,
 * paginé en interne) + les signaux complets, dérive l'étape de CHAQUE candidat
 * via le helper partagé, puis agrège. Jamais de recherche texte ici : le ruban
 * reflète le périmètre, pas la liste filtrée à la frappe.
 */
export async function computeStageCounts(
  perimeter: StagePerimeter = {},
): Promise<{ counts: CandidateStageCounts; total: number }> {
  const [all, signals] = await Promise.all([
    listAllCandidateAnalyses({
      campaignId: perimeter.campaignId,
      campaignIds: perimeter.campaignIds,
      from: perimeter.from,
      to: perimeter.to,
    }),
    loadStageSignals(perimeter),
  ]);
  const counts = tallyStages(all.map((c) => stageFor(c, signals)));
  return { counts, total: all.length };
}

/** Total exact du périmètre (sans dériver les étapes) — secours / cohérence. */
export async function perimeterTotal(
  perimeter: StagePerimeter = {},
): Promise<number> {
  return countCandidateAnalyses({
    campaignId: perimeter.campaignId,
    campaignIds: perimeter.campaignIds,
    from: perimeter.from,
    to: perimeter.to,
  });
}
