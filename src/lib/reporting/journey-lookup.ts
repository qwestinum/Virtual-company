/**
 * Chargement des signaux de parcours candidat pour l'audit (SERVEUR).
 *
 * Réutilise la dérivation EXISTANTE du dashboard (`journalToCandidatesList`)
 * sur le journal + la file HITL (`pending_validations`) : même source de
 * vérité, aucune logique dupliquée. L'audit LIT ces signaux en lecture seule
 * (cf. `deriveJourneyFor`).
 *
 * IMPORTANT : on NE filtre PAS les candidats en attente HITL (contrairement
 * au dashboard) — l'audit doit justement les afficher « en attente de
 * validation ». On expose donc `pendingUids` à part.
 *
 * Best-effort : sans Supabase ou sur erreur → maps vides (l'audit retombe
 * sur le verdict de screening seul).
 */

import {
  journalToCandidatesList,
  type CandidateRow,
} from '@/lib/dashboard/derive-metrics';
import { listJournalEntries } from '@/lib/db/repos/journal';
import { listPendingValidations } from '@/lib/db/repos/pending-validations';
import {
  deriveJourneyFor,
  type CandidateJourney,
} from '@/lib/reporting/candidate-journey';
import type { CandidateStatus } from '@/types/scoring';

export type JourneySignals = {
  /** uid → CandidateRow (statut dashboard, marqueurs entretien/validation). */
  markers: Map<string, CandidateRow>;
  /** uids en attente de validation HITL (analyse non encore envoyée). */
  pendingUids: Set<string>;
};

export async function loadJourneySignals(opts?: {
  campaignId?: string;
}): Promise<JourneySignals> {
  try {
    const [rows, pending] = await Promise.all([
      listJournalEntries({ campaignId: opts?.campaignId, limit: 500 }),
      listPendingValidations(),
    ]);
    // Pas de pendingUids passé ici → les candidats en attente RESTENT dans
    // la liste (on veut les afficher « en attente de validation »).
    const candidates = journalToCandidatesList(rows);
    const pendingUids = new Set(
      pending
        .map((v) => (typeof v.payload?.uid === 'string' ? v.payload.uid : null))
        .filter((u): u is string => u !== null),
    );
    return {
      markers: new Map(candidates.map((c) => [c.id, c])),
      pendingUids,
    };
  } catch {
    return { markers: new Map(), pendingUids: new Set() };
  }
}

/**
 * Dérive le parcours d'une analyse à partir des signaux chargés. Centralise
 * le mapping CandidateRow → entrée de dérivation (réutilisé par tous les
 * endpoints audit).
 */
export function journeyFromSignals(
  signals: JourneySignals,
  uid: string,
  screeningStatus: CandidateStatus,
): CandidateJourney {
  const row = signals.markers.get(uid);
  return deriveJourneyFor(
    screeningStatus,
    row
      ? {
          dashboardStatus: row.status,
          interviewMarked: row.interviewMarked,
          validationMarked: row.validationMarked,
          recommendation: row.recommendation,
        }
      : undefined,
    signals.pendingUids.has(uid),
  );
}
