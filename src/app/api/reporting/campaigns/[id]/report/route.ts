/**
 * GET /api/reporting/campaigns/[id]/report — PDF du rapport de campagne.
 *
 * CACHE STABLE (≠ audit candidat) : la campagne est figée à sa clôture, le
 * rapport ne change pas. Première génération → rendu + upload Storage +
 * trace journal. Appels suivants → PDF en cache resservi. `?force=1` force
 * le recalcul et écrase le cache (menu « Régénérer »).
 */
import { NextResponse } from 'next/server';

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { renderCampaignReportPdf } from '@/lib/reporting/campaign-report-pdf';
import { assembleCampaignReport } from '@/lib/reporting/campaign-report-loader';
import { downloadArtifact, uploadArtifactBinary } from '@/lib/storage/blob';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const force = new URL(request.url).searchParams.get('force') === '1';

  try {
    const report = await assembleCampaignReport(id);
    if (!report) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const { data, fileName } = report;
    const cachePath = `campagnes/${id}/${fileName}`;

    // Cache stable : on resert le PDF stocké (sauf régénération forcée).
    if (!force) {
      const cached = await downloadArtifact(cachePath);
      if (cached) return pdfResponse(cached, fileName, 'hit');
    }

    const pdf = await renderCampaignReportPdf({
      data,
      generatedAtIso: new Date().toISOString(),
    });

    // Met en cache (upsert : la régénération écrase). Best-effort.
    try {
      await uploadArtifactBinary({
        owner: { kind: 'campaign', id },
        name: fileName,
        content: pdf,
        mimeType: 'application/pdf',
      });
      await appendJournalEntry({
        action: 'campaign_report_generated',
        actor: 'reporting',
        campaignId: id,
        payload: { fileName, regenerated: force },
      });
    } catch (err) {
      if (!(err instanceof SupabaseNotConfiguredError)) {
        console.error('[campaign-report] cache/journal failed', err);
      }
    }

    return pdfResponse(pdf, fileName, force ? 'regenerated' : 'miss');
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'pdf_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}

function pdfResponse(pdf: Buffer, fileName: string, cacheState: string): NextResponse {
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
      'X-Report-Cache': cacheState,
    },
  });
}
