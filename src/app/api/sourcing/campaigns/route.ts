/**
 * GET /api/sourcing/campaigns — campagnes actives, référent, compteurs, et
 * « mes approches ce mois ». 404 si le module est éteint.
 */
import { DateTime } from 'luxon';
import { NextResponse } from 'next/server';

import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  countApproachesSince,
  countersForCampaigns,
  listActiveCampaignsForSourcing,
} from '@/lib/db/repos/sourcing';
import { prepareReferentContext } from '@/lib/referent/context';
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
    // Ce qui ne dépend pas de la liste des campagnes part tout de suite
    // (recruteurs, compte du mois) ; la session est celle de la garde, jamais
    // relue. Les erreurs sont décidées dans l'ordre d'avant : la liste d'abord.
    const referentContextFor = prepareReferentContext({ user });
    const myApproachesPromise = countApproachesSince(user.id, startOfMonthParis());
    myApproachesPromise.catch(() => undefined);
    const campaigns = await listActiveCampaignsForSourcing();
    const ids = campaigns.map((c) => c.id);
    const [referents, myApproachesThisMonth, counters] = await Promise.all([
      referentContextFor(ids),
      myApproachesPromise,
      countersForCampaigns(ids),
    ]);
    const items: SourcingCampaignSummary[] = campaigns.map((c) => ({
      campaignId: c.id,
      name: c.name,
      referent: referents.referentByCampaign[c.id] ?? null,
      ...counters.get(c.id)!,
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
