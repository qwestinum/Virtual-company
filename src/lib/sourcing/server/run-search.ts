/**
 * Une recherche de profils, de bout en bout — sans aucun appel LLM par profil.
 * Spec : docs/specs/sourcing.md §1.1, §2, §7.
 *
 *   moteur (1 appel, 100) → projection (coupe des sections au point unique)
 *   → empreinte salée → dédoublonnage (vus, exclus, opposés) → 50 à examiner
 *   + réserve → enregistrement → journal (sans donnée personnelle).
 */
import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  insertSourcingProfiles,
  insertSourcingSearch,
  listKnownFingerprints,
} from '@/lib/db/repos/sourcing';
import { normalizeProfileUrl, profileFingerprint, SOURCING_PEPPER_ENV } from '@/lib/sourcing/fingerprint';
import { projectExaResult } from '@/lib/sourcing/ingest';
import { selectFreshProfiles, type Candidate } from '@/lib/sourcing/selection';
import { EXA_NUM_RESULTS, searchPeople } from '@/lib/sourcing/server/exa';
import type { QueryMethod, SourcingLanguage } from '@/types/sourcing';

export type RunSearchInput = {
  campaignId: string;
  userId: string;
  actorEmail: string | null;
  query: string;
  queryGenerated: string;
  queryMethod: QueryMethod;
  language: SourcingLanguage;
  llmCostUsd: number;
};

export type RunSearchResult = {
  searchId: string;
  returned: number;
  unusable: number;
  toReview: number;
  reserve: number;
  skipped: { alreadySeen: number; excluded: number; opposed: number; duplicates: number };
  exaCostUsd: number | null;
};

export async function runSourcingSearch(input: RunSearchInput): Promise<RunSearchResult> {
  const outcome = await searchPeople(input.query);
  const pepper = process.env[SOURCING_PEPPER_ENV];

  const candidates: Candidate[] = [];
  let unusable = outcome.unreadable;
  for (const { rank, result } of outcome.results) {
    const snapshot = projectExaResult(result);
    const normalized = normalizeProfileUrl(result.url);
    if (!snapshot || !normalized) {
      unusable += 1;
      continue;
    }
    candidates.push({ rank, fingerprint: profileFingerprint(normalized, pepper), snapshot });
  }

  const known = await listKnownFingerprints(
    input.campaignId,
    candidates.map((c) => c.fingerprint),
  );
  const selection = selectFreshProfiles(candidates, known);

  const searchId = await insertSourcingSearch({
    campaignId: input.campaignId,
    createdBy: input.userId,
    query: input.query,
    queryGenerated: input.queryGenerated,
    queryMethod: input.queryMethod,
    language: input.language,
    requested: EXA_NUM_RESULTS,
    returned: outcome.results.length + outcome.unreadable,
    newAfterDedup: selection.fresh.length,
    exaRequestId: outcome.requestId,
    exaCostUsd: outcome.costUsd,
    llmCostUsd: input.llmCostUsd,
  });

  await insertSourcingProfiles(
    input.campaignId,
    selection.fresh.map((f) => ({
      searchId,
      fingerprint: f.fingerprint,
      exaRank: f.rank,
      state: f.state,
      snapshot: f.snapshot,
    })),
  );

  const result: RunSearchResult = {
    searchId,
    returned: outcome.results.length + outcome.unreadable,
    unusable,
    toReview: selection.fresh.filter((f) => f.state === 'to_review').length,
    reserve: selection.fresh.filter((f) => f.state === 'reserve').length,
    skipped: {
      alreadySeen: selection.skipped.already_seen,
      excluded: selection.skipped.excluded,
      opposed: selection.skipped.opposed,
      duplicates: selection.skipped.duplicate_in_response,
    },
    exaCostUsd: outcome.costUsd,
  };

  // Aucune donnée personnelle : des compteurs, la méthode, le coût. La requête
  // décrit un poste ; elle est déjà dans `sourcing_searches`.
  await appendJournalEntry({
    action: 'sourcing_search_run',
    campaignId: input.campaignId,
    actor: input.actorEmail ?? 'utilisateur',
    payload: {
      searchId,
      language: input.language,
      queryMethod: input.queryMethod,
      queryEdited: input.query.trim() !== input.queryGenerated.trim(),
      returned: result.returned,
      unusable,
      newAfterDedup: selection.fresh.length,
      skipped: result.skipped,
      exaCostUsd: outcome.costUsd,
      llmCostUsd: input.llmCostUsd,
      latencyMs: outcome.latencyMs,
      actorUserId: input.userId,
    },
  }).catch(() => {});

  return result;
}
