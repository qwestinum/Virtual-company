/**
 * GET /api/sourcing/campaigns — campagnes actives, référent, compteurs, et
 * « mes approches ce mois ». 404 si le module est éteint.
 */
import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';

import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  countApproachesSince,
  countersForCampaign,
  listActiveCampaignsForSourcing,
} from '@/lib/db/repos/sourcing';
import { loadReferentContext } from '@/lib/referent/context';
import { guardSourcing } from '@/lib/sourcing/server/route-guard';
import type { SourcingCampaignSummary } from '@/types/sourcing';

export const runtime = 'nodejs';

/** Premier jour du mois courant à minuit, heure de Paris (heure d'été comprise). */
function startOfMonthParis(): string {
  return DateTime.now().setZone('Europe/Paris').startOf('month').toUTC().toISO() ?? new Date(0).toISOString();
}

export async function GET(): Promise<NextResponse> {
  const guard = await guardSourcing();
  if (!guard.ok) return guard.response;
  const user = guard.value;

  try {
    const campaigns = await listActiveCampaignsForSourcing();
    const [referents, myApproachesThisMonth, counters] = await Promise.all([
      loadReferentContext(campaigns.map((c) => c.id)),
      countApproachesSince(user.id, startOfMonthParis()),
      Promise.all(campaigns.map((c) => countersForCampaign(c.id))),
    ]);
    const items: SourcingCampaignSummary[] = campaigns.map((c, i) => ({
      campaignId: c.id,
      name: c.name,
      referent: referents.referentByCampaign[c.id] ?? null,
      ...counters[i]!,
    }));
    return NextResponse.json(
      { campaigns: items, myApproachesThisMonth },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: 'sourcing_campaigns_failed', message: (err as Error).message }, { status: 500 });
  }
}
