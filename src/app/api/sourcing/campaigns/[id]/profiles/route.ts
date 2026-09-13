/**
 * GET  /api/sourcing/campaigns/[id]/profiles       — la liste à examiner.
 * POST /api/sourcing/campaigns/[id]/profiles       — « 50 de plus » (depuis la réserve, sans appel au moteur).
 */
import { NextResponse } from 'next/server';

import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { listSourcingProfiles, listSourcingSearches, promoteReserve } from '@/lib/db/repos/sourcing';
import { buildProfilesView } from '@/lib/sourcing/profiles-view';
import { BATCH_SIZE } from '@/lib/sourcing/selection';
import { guardSourcingCampaign } from '@/lib/sourcing/server/route-guard';
import { fdpText } from '@/types/job-post';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

async function view(campaignId: string, fdpLocation: string | null) {
  const [searches, profiles] = await Promise.all([
    listSourcingSearches(campaignId),
    listSourcingProfiles(campaignId, ['to_review', 'reserve']),
  ]);
  return buildProfilesView(searches, profiles, fdpLocation);
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
    const location = fdpText(guard.value.campaign.fdp, 'location');
    return NextResponse.json(await view(id, location), { headers: { 'Cache-Control': 'no-store' } });
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
    const location = fdpText(guard.value.campaign.fdp, 'location');
    return NextResponse.json({ promoted, ...(await view(id, location)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return failure(err);
  }
}
