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
import type { UnusableBreakdown } from '@/lib/sourcing/search-yield';
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
};

/** Rendu à l'écran du recruteur : aucun coût (il reste en base, pour l'administration). */
export type RunSearchResult = {
  searchId: string;
  returned: number;
  unusable: number;
  /** Pourquoi les inexploitables le sont — pour qu'une réponse anormale se lise. */
  unusableBreakdown: UnusableBreakdown;
  toReview: number;
  reserve: number;
  skipped: { alreadySeen: number; excluded: number; opposed: number; duplicates: number };
};

export async function runSourcingSearch(input: RunSearchInput): Promise<RunSearchResult> {
  const outcome = await searchPeople(input.query);
  const pepper = process.env[SOURCING_PEPPER_ENV];

  const candidates: Candidate[] = [];
  // ⚠️ Chaque cause COMPTÉE À PART (25/09/2026) : le 24/09, 89 résultats sur
  // 100 sont tombés dans un compteur unique « inutilisable », et plus rien ne
  // permettait de dire si le moteur avait changé de format ou renvoyé autre
  // chose que des profils.
  const breakdown: UnusableBreakdown = { malformed: outcome.unreadable, notAProfile: 0, noName: 0 };
  for (const { rank, result } of outcome.results) {
    const normalized = normalizeProfileUrl(result.url);
    if (!normalized) {
      breakdown.notAProfile += 1;
      continue;
    }
    const snapshot = projectExaResult(result);
    if (!snapshot) {
      breakdown.noName += 1;
      continue;
    }
    candidates.push({ rank, fingerprint: profileFingerprint(normalized, pepper), snapshot });
  }
  const unusable = breakdown.malformed + breakdown.notAProfile + breakdown.noName;

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
    // La génération est tracée à part (`sourcing_query_generated`) : le client
    // ne porte plus aucun montant, il ne peut donc pas en déclarer un.
    llmCostUsd: null,
  });

  // ⚠️ L'ÉCHEC D'INSERTION NE DOIT PAS ÊTRE MUET. La ligne de recherche est
  // écrite AVANT les profils — elle porte l'identifiant qu'ils référencent,
  // l'ordre est donc forcé. Si l'insertion tombe, il reste une recherche
  // PAYÉE (l'appel au moteur a eu lieu) et AUCUN profil : à l'écran, la
  // campagne affiche « dernière recherche il y a 4 j · 0 vu », strictement
  // indistinguable de « la recherche n'a rien trouvé de nouveau ».
  //
  // C'est arrivé le 17/09/2026 sur CAMP-2026-095 : deux recherches à 100
  // résultats, 100 nouveaux après dédoublonnage, ZÉRO profil en base, et pas
  // une ligne de journal — parce que `sourcing_search_run` s'écrit APRÈS
  // l'insertion. On trace donc l'échec avant de relancer l'erreur.
  try {
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
  } catch (err) {
    await appendJournalEntry({
      action: 'sourcing_search_not_stored',
      campaignId: input.campaignId,
      actor: input.actorEmail ?? 'utilisateur',
      payload: {
        searchId,
        attendus: selection.fresh.length,
        cause: err instanceof Error ? err.message : String(err),
      },
    }).catch(() => undefined);
    throw err;
  }

  const result: RunSearchResult = {
    searchId,
    returned: outcome.results.length + outcome.unreadable,
    unusable,
    unusableBreakdown: breakdown,
    toReview: selection.fresh.filter((f) => f.state === 'to_review').length,
    reserve: selection.fresh.filter((f) => f.state === 'reserve').length,
    skipped: {
      alreadySeen: selection.skipped.already_seen,
      excluded: selection.skipped.excluded,
      opposed: selection.skipped.opposed,
      duplicates: selection.skipped.duplicate_in_response,
    },
  };

  // Aucune donnée personnelle, aucun montant : des compteurs et la méthode. Le
  // coût vit dans `sourcing_searches` ; la requête aussi.
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
      unusableBreakdown: breakdown,
      // Chemins et natures des écarts, JAMAIS une valeur : aucune donnée personnelle.
      malformedFields: outcome.malformedFields,
      newAfterDedup: selection.fresh.length,
      skipped: result.skipped,
      latencyMs: outcome.latencyMs,
      actorUserId: input.userId,
    },
  }).catch(() => {});

  return result;
}
