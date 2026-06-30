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

const INTERVIEW_ACTION = 'candidate_interview_marked';
const VALIDATION_ACTION = 'candidate_validation_marked';

export type StageSignals = {
  /** uids présents dans la file HITL en `pending` (gris à trancher). */
  pendingUids: Set<string>;
  /** uids d'analyse avec une réservation Cal.com (`scheduled`) — RATTACHÉ PAR UID. */
  scheduledUids: Set<string>;
  /** uid → dernier marqueur entretien (journal, dernier-gagne). */
  interviewMarks: Map<string, 'realized' | 'missed'>;
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

  // Journal trié created_at DESC → la PREMIÈRE occurrence par uid est la plus
  // récente (dernier-gagne). On n'écrase donc jamais une entrée déjà posée.
  const interviewMarks = new Map<string, 'realized' | 'missed'>();
  const validationMarks = new Map<string, 'validated' | 'rejected'>();
  for (const entry of markers) {
    const uid = payloadUid(entry.payload);
    if (!uid) continue;
    const status = entry.payload.status;
    if (entry.action === INTERVIEW_ACTION) {
      if (
        !interviewMarks.has(uid) &&
        (status === 'realized' || status === 'missed')
      ) {
        interviewMarks.set(uid, status);
      }
    } else if (entry.action === VALIDATION_ACTION) {
      if (
        !validationMarks.has(uid) &&
        (status === 'validated' || status === 'rejected')
      ) {
        validationMarks.set(uid, status);
      }
    }
  }

  return { pendingUids, scheduledUids, interviewMarks, validationMarks };
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
