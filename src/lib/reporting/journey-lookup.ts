/**
 * Chargement des marqueurs de parcours candidat pour l'audit (SERVEUR).
 *
 * Réutilise la dérivation EXISTANTE du dashboard (`journalToCandidatesList`)
 * sur le journal : même source de vérité, aucune logique dupliquée. L'audit
 * lit ces marqueurs en lecture seule pour dériver le parcours (cf.
 * `deriveJourneyFor`).
 *
 * Best-effort : en l'absence de Supabase (démo locale) ou sur erreur, on
 * renvoie une map vide → l'audit retombe sur le verdict de screening seul.
 */

import {
  journalToCandidatesList,
  type CandidateRow,
} from '@/lib/dashboard/derive-metrics';
import { listJournalEntries } from '@/lib/db/repos/journal';

/**
 * Map `uid → CandidateRow` (interviewMarked / validationMarked /
 * recommendation), reconstruite depuis le journal. `campaignId` restreint
 * le scan (plus léger) ; omettre pour les candidats hors campagne.
 */
export async function loadCandidateMarkers(opts?: {
  campaignId?: string;
}): Promise<Map<string, CandidateRow>> {
  try {
    const rows = await listJournalEntries({
      campaignId: opts?.campaignId,
      limit: 500,
    });
    const candidates = journalToCandidatesList(rows);
    return new Map(candidates.map((c) => [c.id, c]));
  } catch {
    return new Map();
  }
}
