/**
 * Repo Supabase — short-list de présélection vivier (Session V2, §4).
 *
 * `replacePreselection` persiste une short-list fraîche de façon IDEMPOTENTE et
 * NON DESTRUCTIVE des décisions : il réconcilie (cf. `reconcilePreselection`)
 * puis purge les `identified` périmés et upsert le reste — sans jamais toucher
 * les lignes `contacted`/`rejected`. `listPreselection` relit la short-list
 * persistée jointe au dossier (nom/email/fraîcheur) pour l'affichage.
 */

import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { VivierPreselectionRow } from '@/lib/db/types';
import {
  reconcilePreselection,
  type ExistingPreselectionRow,
} from '@/lib/vivier/preselection-reconcile';
import type {
  HardFilterMatch,
  ShortlistEntry,
} from '@/types/vivier-preselection';

const TABLE = 'vivier_preselections';

/**
 * Remplace la short-list `identified` d'une campagne par `entries`, en
 * préservant les lignes décidées (contacted/rejected). Idempotent.
 */
export async function replacePreselection(
  campaignId: string,
  entries: ShortlistEntry[],
): Promise<void> {
  const supabase = requireServerSupabase();

  const { data: existing, error: readErr } = await supabase
    .from(TABLE)
    .select('candidate_id, state')
    .eq('campaign_id', campaignId);
  if (readErr) throw new Error(`replacePreselection(read): ${readErr.message}`);

  const existingRows: ExistingPreselectionRow[] = (
    (existing ?? []) as { candidate_id: string; state: ExistingPreselectionRow['state'] }[]
  ).map((r) => ({ candidateId: r.candidate_id, state: r.state }));

  const { toUpsert, toDeleteCandidateIds } = reconcilePreselection(
    existingRows,
    entries,
  );

  if (toDeleteCandidateIds.length > 0) {
    const { error: delErr } = await supabase
      .from(TABLE)
      .delete()
      .eq('campaign_id', campaignId)
      .in('candidate_id', toDeleteCandidateIds);
    if (delErr) throw new Error(`replacePreselection(delete): ${delErr.message}`);
  }

  if (toUpsert.length > 0) {
    const generatedAt = new Date().toISOString();
    const rows = toUpsert.map((e) => ({
      campaign_id: campaignId,
      candidate_id: e.candidateId,
      state: 'identified' as const,
      similarity: e.similarity,
      freshness_factor: e.freshnessFactor,
      relevance_score: e.relevanceScore,
      passed_filters: e.passedFilters,
      rank: e.rank,
      generated_at: generatedAt,
    }));
    const { error: upErr } = await supabase
      .from(TABLE)
      .upsert(rows, { onConflict: 'campaign_id,candidate_id' });
    if (upErr) throw new Error(`replacePreselection(upsert): ${upErr.message}`);
  }
}

/** Ligne de présélection jointe au dossier (nom/email/fraîcheur) pour l'affichage. */
type PreselectionJoinedRow = VivierPreselectionRow & {
  vivier_candidates: { nom: string; email: string; updated_at: string } | null;
};

/** Relit la short-list persistée d'une campagne, ordonnée par rang. */
export async function listPreselection(
  campaignId: string,
): Promise<ShortlistEntry[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*, vivier_candidates(nom, email, updated_at)')
    .eq('campaign_id', campaignId)
    .order('rank', { ascending: true });
  if (error) throw new Error(`listPreselection: ${error.message}`);

  return ((data ?? []) as PreselectionJoinedRow[]).map((row) => ({
    candidateId: row.candidate_id,
    nom: row.vivier_candidates?.nom ?? '',
    email: row.vivier_candidates?.email ?? '',
    similarity: row.similarity,
    freshnessFactor: row.freshness_factor,
    relevanceScore: row.relevance_score,
    updatedAt: row.vivier_candidates?.updated_at ?? row.generated_at,
    passedFilters: (row.passed_filters ?? []) as HardFilterMatch[],
    rank: row.rank,
    state: row.state,
  }));
}
