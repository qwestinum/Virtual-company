/**
 * GET  /api/sourcing/campaigns/[id]/profiles       — la liste à examiner.
 * POST /api/sourcing/campaigns/[id]/profiles       — « 50 de plus » (depuis la réserve, sans appel au moteur).
 *
 * La liste est enrichie À L'AFFICHAGE, jamais stockée : mentions (la fiche de
 * scoring peut avoir changé depuis la recherche) et indice « vivier » (le
 * vivier aussi). Préférences du recruteur et ses approches sur la campagne.
 */
import type { User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { getSearchRunPayload, listSourcingProfiles, listSourcingSearches, promoteReserve } from '@/lib/db/repos/sourcing';
import { countRecruiterApproachesForCampaign, getSourcingPreferences } from '@/lib/db/repos/sourcing-approaches';
import { computeMentions } from '@/lib/sourcing/mentions';
import { yieldFromRunPayload } from '@/lib/sourcing/search-yield';
import { buildProfilesView } from '@/lib/sourcing/profiles-view';
import { BATCH_SIZE } from '@/lib/sourcing/selection';
import { guardSourcingCampaign } from '@/lib/sourcing/server/route-guard';
import { findVivierHints } from '@/lib/sourcing/server/vivier-hints';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import { fdpText } from '@/types/job-post';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

async function view(campaign: ActiveCampaign, user: User) {
  const [searches, profiles, preferences, myApproaches] = await Promise.all([
    listSourcingSearches(campaign.id),
    listSourcingProfiles(campaign.id, ['to_review', 'contacted', 'reserve']),
    getSourcingPreferences(user.id),
    countRecruiterApproachesForCampaign(user.id, campaign.id).catch(() => 0),
  ]);
  const base = buildProfilesView(searches, profiles, fdpText(campaign.fdp, 'location'));
  const criteria = campaign.scoringSheet?.criteria ?? [];
  const shown = base.groups.flatMap((g) => g.profiles);
  const latest = searches.find((s) => s.id === base.groups[0]?.search.id) ?? null;
  const [hints, runPayload] = await Promise.all([
    findVivierHints(shown),
    // Fail-soft : sans bilan, l'écran dit ce qu'il sait, il ne devine pas.
    latest ? getSearchRunPayload(campaign.id, latest.id).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    ...base,
    latestYield: latest ? yieldFromRunPayload(runPayload, latest.newAfterDedup) : null,
    groups: base.groups.map((g) => ({
      ...g,
      profiles: g.profiles.map((p) => ({
        ...p,
        mentions: computeMentions(p.snapshot, criteria),
        vivierCandidateId: hints.get(p.id) ?? null,
      })),
    })),
    preferences,
    myApproaches,
  };
}

function failure(err: unknown): NextResponse {
  if (err instanceof SupabaseNotConfiguredError) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }
  return NextResponse.json({ error: 'sourcing_profiles_failed', message: (err as Error).message }, { status: 500 });
}

export async function GET(_request: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardSourcingCampaign(id);
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json(await view(guard.value.campaign, guard.value.user), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return failure(err);
  }
}

export async function POST(_request: Request, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardSourcingCampaign(id);
  if (!guard.ok) return guard.response;
  try {
    const searches = await listSourcingSearches(id);
    const latest = searches[0];
    const promoted = latest ? await promoteReserve(latest.id, BATCH_SIZE) : 0;
    return NextResponse.json(
      { promoted, ...(await view(guard.value.campaign, guard.value.user)) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return failure(err);
  }
}
