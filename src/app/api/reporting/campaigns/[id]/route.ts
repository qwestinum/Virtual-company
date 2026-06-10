/**
 * GET /api/reporting/campaigns/[id] — données complètes du rapport d'une
 * campagne clôturée (JSON) pour la vue détail consultable à l'écran (cf.
 * docs/specs/reporting.md §3). Lecture seule ; ne génère ni ne met en cache
 * de PDF (c'est le rôle de la route `/report`).
 */
import { NextResponse } from 'next/server';

import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { assembleCampaignReport } from '@/lib/reporting/campaign-report-loader';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const report = await assembleCampaignReport(id);
    if (!report) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ data: report.data });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
