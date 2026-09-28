/**
 * Désignation COURANTE du recruté d'une candidature — lecture serveur
 * (feat/feedback-candidat, lot 5). Pliage dernier-gagne du marqueur
 * `candidate_hired_marked` : une désignation annulée rend `null`.
 */

import {
  emptyHiredState,
  foldHiredMark,
  HIRED_MARKER_ACTION,
} from '@/lib/candidatures/decision-markers';
import { listJournalEntriesByActions } from '@/lib/db/repos/journal';

/** Date de la désignation courante, ou `null` (jamais désigné, ou annulé). */
export async function loadHiredAt(uid: string, campaignId: string | null): Promise<string | null> {
  const entries = await listJournalEntriesByActions([HIRED_MARKER_ACTION], {
    campaignId: campaignId ?? undefined,
  });
  let state = emptyHiredState();
  for (const e of entries) {
    if (e.payload.uid !== uid) continue;
    state = foldHiredMark(state, e.payload, e.createdAt);
  }
  return state.effect === 'hired' ? state.at : null;
}
