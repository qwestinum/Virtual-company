/**
 * GET /api/admin/sourcing-costs — suivi d'exploitation du module Sourcing.
 *
 * ADMIN seulement : le coût du moteur de profils est inclus dans l'abonnement,
 * il n'est jamais montré au recruteur. Rendu par mois, pour ce cabinet (un
 * déploiement ORQA = un cabinet). Ne dépend PAS du flag : un module éteint
 * après usage garde son historique de coûts.
 */
import { NextResponse } from 'next/server';

import { requireAdminApiUser } from '@/lib/auth/require-api-user';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { listJournalEntriesByActions } from '@/lib/db/repos/journal';
import { listSearchCostsSince } from '@/lib/db/repos/sourcing';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { aggregateSourcingCosts, costWindowStart } from '@/lib/sourcing/costs';
import { resolveOrganizationName } from '@/types/branding';

export const runtime = 'nodejs';

const MONTHS = 12;

export async function GET(): Promise<NextResponse> {
  const denied = await requireAdminApiUser();
  if (denied) return denied;
  const now = new Date();
  try {
    const since = costWindowStart(now, MONTHS);
    const [searches, journal, settings] = await Promise.all([
      listSearchCostsSince(since),
      listJournalEntriesByActions(['sourcing_query_generated']),
      getAppSettings().catch(() => null),
    ]);
    const sinceMs = Date.parse(since);
    const generations = journal
      .filter((e) => Date.parse(e.createdAt) >= sinceMs)
      .map((e) => ({
        createdAt: e.createdAt,
        llmCostUsd: typeof e.payload?.llmCostUsd === 'number' ? e.payload.llmCostUsd : null,
      }));
    return NextResponse.json(
      {
        cabinet: resolveOrganizationName(settings),
        ...aggregateSourcingCosts(searches, generations, now, MONTHS),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: 'sourcing_costs_failed', message: (err as Error).message }, { status: 500 });
  }
}
