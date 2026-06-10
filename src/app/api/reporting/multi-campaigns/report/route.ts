/**
 * GET /api/reporting/multi-campaigns/report — PDF du rapport multi-campagnes.
 *
 * Génération À LA VOLÉE (pas de cache stable, ≠ rapport de campagne) : chaque
 * appel produit un nouveau PDF horodaté en page 1. Période + filtres passés en
 * query (?from&to&search&donneur&site). Cf. docs/specs/reporting.md §4.
 */
import { NextResponse } from 'next/server';

import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { defaultMultiCampaignPeriod } from '@/lib/reporting/multi-campaign-report-display';
import { renderMultiCampaignReportPdf } from '@/lib/reporting/multi-campaign-report-pdf';
import { assembleMultiCampaignReport } from '@/lib/reporting/multi-campaign-report-loader';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const p = new URL(request.url).searchParams;
  const fallback = defaultMultiCampaignPeriod(new Date());
  const from = p.get('from') || fallback.from;
  const to = p.get('to') || fallback.to;

  try {
    const { data, fileName } = await assembleMultiCampaignReport({
      from,
      to,
      search: p.get('search') ?? undefined,
      donneurOrdreId: p.get('donneur') ?? undefined,
      siteId: p.get('site') ?? undefined,
    });
    const pdf = await renderMultiCampaignReportPdf({
      data,
      generatedAtIso: new Date().toISOString(),
    });
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'pdf_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
