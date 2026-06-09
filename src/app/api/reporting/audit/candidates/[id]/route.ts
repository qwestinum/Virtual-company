/**
 * /api/reporting/audit/candidates/[id] — détail complet d'une analyse
 * candidat (CVApplication intégral) pour la vue critère-par-critère de
 * l'audit candidat (cf. docs/specs/reporting.md §5.3).
 */
import { NextResponse } from 'next/server';

import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { deriveJourneyFor } from '@/lib/reporting/candidate-journey';
import { loadCandidateMarkers } from '@/lib/reporting/journey-lookup';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const candidate = await getCandidateAnalysis(id);
    if (!candidate) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    // Enrichit avec le parcours dérivé du journal (lecture seule).
    const markers = await loadCandidateMarkers({
      campaignId: candidate.campaignId ?? undefined,
    });
    const journey = deriveJourneyFor(
      candidate.status,
      markers.get(candidate.uid),
    );
    return NextResponse.json({ candidate: { ...candidate, journey } });
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
