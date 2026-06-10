/**
 * GET /api/reporting/multi-campaigns — données agrégées du rapport
 * multi-campagnes (JSON) pour la vue détail consultable à l'écran AVANT de
 * générer / envoyer (cf. docs/specs/reporting.md §4). Période + filtres en
 * query (?from&to&search&donneur&site). Lecture seule ; ne génère aucun PDF.
 */
import { NextResponse } from 'next/server';

import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { defaultMultiCampaignPeriod } from '@/lib/reporting/multi-campaign-report-display';
import { assembleMultiCampaignReport } from '@/lib/reporting/multi-campaign-report-loader';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  const p = new URL(request.url).searchParams;
  const fallback = defaultMultiCampaignPeriod(new Date());
  const from = p.get('from') || fallback.from;
  const to = p.get('to') || fallback.to;

  try {
    const { data } = await assembleMultiCampaignReport({
      from,
      to,
      search: p.get('search') ?? undefined,
      donneurOrdreId: p.get('donneur') ?? undefined,
      siteId: p.get('site') ?? undefined,
    });
    return NextResponse.json({ data });
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
