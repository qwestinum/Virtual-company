/**
 * Repo du module Sourcing — recherches, profils, exclusions, approches.
 * Schéma : bloc « MODULE SOURCING » de scripts/migrate.sql · Spec : docs/specs/sourcing.md §7.
 *
 * Zéro troncature silencieuse : les listes passent par la pagination keyset
 * (PostgREST plafonne à 1000 toute requête sans borne), les filtres `in` sont
 * découpés en lots.
 */

import { chunk, fetchAllKeyset } from '@/lib/db/paginate';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import type {
  ExaSnapshot,
  QueryMethod,
  SourcingLanguage,
  SourcingProfileState,
} from '@/types/sourcing';

const IN_CHUNK = 100;

export type SourcingSearch = {
  id: string;
  campaignId: string;
  query: string;
  queryGenerated: string;
  queryMethod: QueryMethod;
  language: SourcingLanguage;
  returned: number;
  newAfterDedup: number;
  exaCostUsd: number | null;
  llmCostUsd: number | null;
  createdAt: string;
};

type SearchRow = {
  id: string;
  campaign_id: string;
  query: string;
  query_generated: string;
  query_method: QueryMethod;
  language: SourcingLanguage;
  returned: number;
  new_after_dedup: number;
  exa_cost_usd: number | string | null;
  llm_cost_usd: number | string | null;
  created_at: string;
};

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

const toSearch = (r: SearchRow): SourcingSearch => ({
  id: r.id,
  campaignId: r.campaign_id,
  query: r.query,
  queryGenerated: r.query_generated,
  queryMethod: r.query_method,
  language: r.language,
  returned: r.returned,
  newAfterDedup: r.new_after_dedup,
  exaCostUsd: num(r.exa_cost_usd),
  llmCostUsd: num(r.llm_cost_usd),
  createdAt: r.created_at,
});

export async function insertSourcingSearch(input: {
  campaignId: string;
  createdBy: string | null;
  query: string;
  queryGenerated: string;
  queryMethod: QueryMethod;
  language: SourcingLanguage;
  requested: number;
  returned: number;
  newAfterDedup: number;
  exaRequestId: string | null;
  exaCostUsd: number | null;
  llmCostUsd: number | null;
}): Promise<string> {
  const { data, error } = await requireServerSupabase()
    .from('sourcing_searches')
    .insert({
      campaign_id: input.campaignId,
      created_by: input.createdBy,
      query: input.query,
      query_generated: input.queryGenerated,
      query_method: input.queryMethod,
      language: input.language,
      requested: input.requested,
      returned: input.returned,
      new_after_dedup: input.newAfterDedup,
      exa_request_id: input.exaRequestId,
      exa_cost_usd: input.exaCostUsd,
      llm_cost_usd: input.llmCostUsd,
    })
    .select('id')
    .single();
  if (error) throw new Error(`insertSourcingSearch: ${error.message}`);
  return (data as { id: string }).id;
}

export async function listSourcingSearches(campaignId: string): Promise<SourcingSearch[]> {
  const db = requireServerSupabase();
  const rows = await fetchAllKeyset<SearchRow>({
    fetchPage: async (after, limit) => {
      let q = db.from('sourcing_searches').select('*').eq('campaign_id', campaignId).order('id').limit(limit);
      if (after) q = q.gt('id', after);
      const { data, error } = await q;
      if (error) throw new Error(`listSourcingSearches: ${error.message}`);
      return (data ?? []) as SearchRow[];
    },
    cursorOf: (r) => r.id,
  });
  return rows.map(toSearch).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type NewSourcingProfile = {
  searchId: string;
  fingerprint: string;
  exaRank: number;
  state: 'to_review' | 'reserve';
  snapshot: ExaSnapshot;
};

/**
 * Insertion idempotente : l'unicité (campagne, empreinte) tranche une course
 * entre deux recherches concurrentes — le second inséré ne l'est simplement pas.
 */
export async function insertSourcingProfiles(campaignId: string, profiles: NewSourcingProfile[]): Promise<void> {
  const db = requireServerSupabase();
  for (const part of chunk(profiles, IN_CHUNK)) {
    const { error } = await db.from('sourcing_profiles').upsert(
      part.map((p) => ({
        campaign_id: campaignId,
        search_id: p.searchId,
        fingerprint: p.fingerprint,
        exa_rank: p.exaRank,
        state: p.state,
        exa_snapshot: p.snapshot,
      })),
      { onConflict: 'campaign_id,fingerprint', ignoreDuplicates: true },
    );
    if (error) throw new Error(`insertSourcingProfiles: ${error.message}`);
  }
}

/**
 * Ce qui empêche un profil d'être montré de nouveau, limité aux empreintes de
 * la réponse : déjà vu sur la campagne, exclu de la campagne, opposé partout.
 */
export async function listKnownFingerprints(
  campaignId: string,
  fingerprints: string[],
): Promise<{ seen: Set<string>; excluded: Set<string>; opposed: Set<string> }> {
  const db = requireServerSupabase();
  const seen = new Set<string>();
  const excluded = new Set<string>();
  const opposed = new Set<string>();
  for (const part of chunk([...new Set(fingerprints)], IN_CHUNK)) {
    const profiles = await db
      .from('sourcing_profiles')
      .select('fingerprint')
      .eq('campaign_id', campaignId)
      .in('fingerprint', part);
    if (profiles.error) throw new Error(`listKnownFingerprints/profiles: ${profiles.error.message}`);
    for (const r of profiles.data ?? []) seen.add((r as { fingerprint: string }).fingerprint);

    const exclusions = await db
      .from('sourcing_exclusions')
      .select('fingerprint, campaign_id')
      .in('fingerprint', part);
    if (exclusions.error) throw new Error(`listKnownFingerprints/exclusions: ${exclusions.error.message}`);
    for (const r of (exclusions.data ?? []) as { fingerprint: string; campaign_id: string | null }[]) {
      if (r.campaign_id === null) opposed.add(r.fingerprint);
      else if (r.campaign_id === campaignId) excluded.add(r.fingerprint);
    }
  }
  return { seen, excluded, opposed };
}

export type StoredSourcingProfile = {
  id: string;
  searchId: string;
  exaRank: number;
  state: SourcingProfileState;
  snapshot: ExaSnapshot;
};

type ProfileRow = {
  id: string;
  search_id: string;
  exa_rank: number;
  state: SourcingProfileState;
  exa_snapshot: ExaSnapshot;
};

export async function listSourcingProfiles(
  campaignId: string,
  states: SourcingProfileState[],
): Promise<StoredSourcingProfile[]> {
  const db = requireServerSupabase();
  const rows = await fetchAllKeyset<ProfileRow>({
    fetchPage: async (after, limit) => {
      let q = db
        .from('sourcing_profiles')
        .select('id, search_id, exa_rank, state, exa_snapshot')
        .eq('campaign_id', campaignId)
        .in('state', states)
        .order('id')
        .limit(limit);
      if (after) q = q.gt('id', after);
      const { data, error } = await q;
      if (error) throw new Error(`listSourcingProfiles: ${error.message}`);
      return (data ?? []) as ProfileRow[];
    },
    cursorOf: (r) => r.id,
  });
  return rows.map((r) => ({
    id: r.id,
    searchId: r.search_id,
    exaRank: r.exa_rank,
    state: r.state,
    snapshot: r.exa_snapshot,
  }));
}

/** Passe les `n` profils suivants de la réserve d'une recherche en « à examiner », dans l'ordre du moteur. */
export async function promoteReserve(searchId: string, n: number): Promise<number> {
  const db = requireServerSupabase();
  const { data, error } = await db
    .from('sourcing_profiles')
    .select('id')
    .eq('search_id', searchId)
    .eq('state', 'reserve')
    .order('exa_rank', { ascending: true })
    .limit(n);
  if (error) throw new Error(`promoteReserve/select: ${error.message}`);
  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  if (ids.length === 0) return 0;
  const upd = await db.from('sourcing_profiles').update({ state: 'to_review' }).in('id', ids).eq('state', 'reserve');
  if (upd.error) throw new Error(`promoteReserve/update: ${upd.error.message}`);
  return ids.length;
}

async function exactCount(
  table: string,
  filters: (q: ReturnType<ReturnType<typeof requireServerSupabase>['from']>) => unknown,
): Promise<number> {
  const base = requireServerSupabase().from(table);
  const q = filters(base) as PromiseLike<{ count: number | null; error: { message: string } | null }>;
  const { count, error } = await q;
  if (error) throw new Error(`${table} count: ${error.message}`);
  return count ?? 0;
}

export type SourcingCounters = { seen: number; approached: number; manifested: number; lastSearchAt: string | null };

/**
 * « Vus » = profils montrés au recruteur (à examiner, contactés) + profils
 * déclinés (leur ligne est supprimée, l'exclusion en garde le compte). La
 * réserve n'est pas « vue » : personne ne l'a regardée.
 */
export async function countersForCampaign(campaignId: string): Promise<SourcingCounters> {
  const [shown, declined, approached, manifested, last] = await Promise.all([
    exactCount('sourcing_profiles', (q) =>
      q.select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).in('state', ['to_review', 'contacted']),
    ),
    exactCount('sourcing_exclusions', (q) =>
      q.select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('reason', 'declined'),
    ),
    exactCount('sourcing_approaches', (q) =>
      q.select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).neq('status', 'revoked'),
    ),
    exactCount('sourcing_approaches', (q) =>
      q.select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'submitted'),
    ),
    requireServerSupabase()
      .from('sourcing_searches')
      .select('created_at')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  if (last.error) throw new Error(`countersForCampaign/last: ${last.error.message}`);
  return {
    seen: shown + declined,
    approached,
    manifested,
    lastSearchAt: ((last.data ?? [])[0] as { created_at: string } | undefined)?.created_at ?? null,
  };
}

/** Campagnes actives — projection minimale, paginée (jamais `listCampaigns()`, plafonné à 1000). */
export async function listActiveCampaignsForSourcing(): Promise<{ id: string; name: string }[]> {
  const db = requireServerSupabase();
  return fetchAllKeyset<{ id: string; name: string }>({
    fetchPage: async (after, limit) => {
      let q = db.from('campaigns').select('id, name').eq('status', 'active').order('id').limit(limit);
      if (after) q = q.gt('id', after);
      const { data, error } = await q;
      if (error) throw new Error(`listActiveCampaignsForSourcing: ${error.message}`);
      return (data ?? []) as { id: string; name: string }[];
    },
    cursorOf: (r) => r.id,
  });
}

/** Approches (hors liens révoqués) d'un recruteur depuis une date. */
export async function countApproachesSince(recruiterId: string, sinceIso: string): Promise<number> {
  return exactCount('sourcing_approaches', (q) =>
    q
      .select('id', { count: 'exact', head: true })
      .eq('recruiter_id', recruiterId)
      .neq('status', 'revoked')
      .gte('initiated_at', sinceIso),
  );
}
