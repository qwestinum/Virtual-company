/**
 * /api/vivier/validations — worklist org-level des prises de contact vivier en
 * attente (Session V3, §5). Renvoie les campagnes ayant ≥1 proposition
 * `identified`, avec leur compteur, triées par charge décroissante, et le total
 * (badge de navigation). Lecture seule.
 */
import { NextResponse } from 'next/server';

import { listPendingByCampaign } from '@/lib/db/repos/vivier-preselection';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const campaigns = await listPendingByCampaign();
    const total = campaigns.reduce((sum, c) => sum + c.pendingCount, 0);
    return NextResponse.json({ campaigns, total });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      // Mode dégradé (démo sans Supabase) : worklist vide, pas d'erreur dure.
      return NextResponse.json({ campaigns: [], total: 0 });
    }
    return NextResponse.json(
      { error: 'validations_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}
