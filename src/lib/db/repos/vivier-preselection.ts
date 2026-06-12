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
    contactedAt: row.contacted_at,
    rejectedAt: row.rejected_at,
    decidedBy: row.decided_by,
    appliedAt: row.applied_at,
  }));
}

/** Une campagne avec des prises de contact vivier en attente (worklist §5). */
export type PendingCampaignSummary = {
  campaignId: string;
  campaignName: string;
  pendingCount: number;
};

/**
 * Liste les campagnes ayant au moins une proposition `identified` en attente,
 * avec le compteur, triées par charge décroissante. Agrégation en base (RPC)
 * puis résolution des noms en une requête. Une campagne sans attente n'apparaît
 * pas (rien à traiter → rien à montrer).
 */
export async function listPendingByCampaign(): Promise<PendingCampaignSummary[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase.rpc('vivier_pending_by_campaign');
  if (error) throw new Error(`listPendingByCampaign: ${error.message}`);
  const counts = ((data ?? []) as {
    campaign_id: string;
    pending_count: number;
  }[]).map((r) => ({ campaignId: r.campaign_id, pendingCount: Number(r.pending_count) }));
  if (counts.length === 0) return [];

  const ids = counts.map((c) => c.campaignId);
  const { data: camps, error: campErr } = await supabase
    .from('campaigns')
    .select('id, name')
    .in('id', ids);
  if (campErr) throw new Error(`listPendingByCampaign(noms): ${campErr.message}`);
  const names = new Map(
    ((camps ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );

  return counts
    .map((c) => ({
      campaignId: c.campaignId,
      campaignName: names.get(c.campaignId) ?? c.campaignId,
      pendingCount: c.pendingCount,
    }))
    .sort((a, b) => b.pendingCount - a.pendingCount);
}

/** Une entrée de l'historique de sollicitation d'un candidat (vue détaillée §5.2). */
export type CandidateProposalHistory = {
  campaignId: string;
  state: 'identified' | 'contacted' | 'rejected';
  contactedAt: string | null;
  rejectedAt: string | null;
  appliedAt: string | null;
};

/** Historique des propositions d'un candidat, toutes campagnes (vue détaillée). */
export async function listProposalsForCandidate(
  candidateId: string,
): Promise<CandidateProposalHistory[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('campaign_id, state, contacted_at, rejected_at, applied_at')
    .eq('candidate_id', candidateId)
    .order('generated_at', { ascending: false });
  if (error) throw new Error(`listProposalsForCandidate: ${error.message}`);
  return ((data ?? []) as {
    campaign_id: string;
    state: CandidateProposalHistory['state'];
    contacted_at: string | null;
    rejected_at: string | null;
    applied_at: string | null;
  }[]).map((r) => ({
    campaignId: r.campaign_id,
    state: r.state,
    contactedAt: r.contacted_at,
    rejectedAt: r.rejected_at,
    appliedAt: r.applied_at,
  }));
}

/** Email joint depuis le dossier (lecture cooldown). */
type EmailJoinRow = { vivier_candidates: { email: string } | null };

function emailsOf(rows: EmailJoinRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const email = r.vivier_candidates?.email;
    if (email) out.push(email.trim().toLowerCase());
  }
  return out;
}

/**
 * Marque des propositions `identified` comme `contacted` (invitation envoyée).
 * Transition ATOMIQUE état↔date : pose `contacted_at` + `decided_by` dans la
 * même opération. La garde `state = identified` rend l'appel idempotent (une
 * ligne déjà contactée/rejetée n'est jamais retouchée). Renvoie les ids mutés.
 */
export async function markContacted(
  campaignId: string,
  candidateIds: string[],
  actor: string,
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      state: 'contacted',
      contacted_at: new Date().toISOString(),
      decided_by: actor,
    })
    .eq('campaign_id', campaignId)
    .in('candidate_id', candidateIds)
    .eq('state', 'identified')
    .select('candidate_id');
  if (error) throw new Error(`markContacted: ${error.message}`);
  return ((data ?? []) as { candidate_id: string }[]).map((r) => r.candidate_id);
}

/**
 * Marque des propositions `identified` comme `rejected` (prise de contact
 * refusée). Transition ATOMIQUE : pose `rejected_at` + `decided_by`. Idempotent
 * (garde `state = identified`). Renvoie les ids mutés.
 */
export async function markRejected(
  campaignId: string,
  candidateIds: string[],
  actor: string,
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      state: 'rejected',
      rejected_at: new Date().toISOString(),
      decided_by: actor,
    })
    .eq('campaign_id', campaignId)
    .in('candidate_id', candidateIds)
    .eq('state', 'identified')
    .select('candidate_id');
  if (error) throw new Error(`markRejected: ${error.message}`);
  return ((data ?? []) as { candidate_id: string }[]).map((r) => r.candidate_id);
}

/**
 * Rapprochement (§6.3) : note qu'un candidat CONTACTÉ a postulé à la campagne.
 * Pose `applied_at` une seule fois (première candidature — `applied_at is null`),
 * uniquement sur une proposition `contacted`. Renvoie true si nouvellement posé.
 */
export async function recordApplied(
  campaignId: string,
  candidateId: string,
): Promise<boolean> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ applied_at: new Date().toISOString() })
    .eq('campaign_id', campaignId)
    .eq('candidate_id', candidateId)
    .eq('state', 'contacted')
    .is('applied_at', null)
    .select('candidate_id');
  if (error) throw new Error(`recordApplied: ${error.message}`);
  return ((data ?? []) as unknown[]).length > 0;
}

/**
 * Emails (normalisés) des candidats CONTACTÉS depuis `sinceIso` — fenêtre de
 * cooldown GLOBAL (toutes campagnes confondues, §7).
 */
export async function listContactedEmailsSince(
  sinceIso: string,
): Promise<string[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('vivier_candidates(email)')
    .eq('state', 'contacted')
    .gte('contacted_at', sinceIso);
  if (error) throw new Error(`listContactedEmailsSince: ${error.message}`);
  return emailsOf((data ?? []) as unknown as EmailJoinRow[]);
}

/**
 * Emails (normalisés) des candidats REJETÉS pour une campagne donnée —
 * exclusion PAR campagne (éligibles ailleurs, §7).
 */
export async function listRejectedEmailsForCampaign(
  campaignId: string,
): Promise<string[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('vivier_candidates(email)')
    .eq('campaign_id', campaignId)
    .eq('state', 'rejected');
  if (error) throw new Error(`listRejectedEmailsForCampaign: ${error.message}`);
  return emailsOf((data ?? []) as unknown as EmailJoinRow[]);
}
