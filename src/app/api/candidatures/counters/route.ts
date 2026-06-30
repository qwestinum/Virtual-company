/**
 * /api/candidatures/counters — compteurs EXHAUSTIFS du ruban (menu
 * Candidatures). Périmètre = campagne + période UNIQUEMENT (jamais la recherche
 * texte). Recalculé côté client sur changement de périmètre, pas à la frappe.
 *
 * Exhaustivité : `computeStageCounts` charge TOUT le périmètre (paginé) +
 * signaux complets → dérive l'étape de chaque candidat → agrège. Jamais basé
 * sur un journal tronqué (cf. stage-signals.ts).
 */
import { NextResponse } from 'next/server';

import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { computeStageCounts } from '@/lib/reporting/stage-signals';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const campaignIdsRaw = params.get('campaignIds');
  const perimeter = {
    campaignId: params.get('campaignId') ?? undefined,
    campaignIds: campaignIdsRaw ? campaignIdsRaw.split(',').filter(Boolean) : undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
  };
  try {
    const { counts, total } = await computeStageCounts(perimeter);
    return NextResponse.json({ counts, total });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
