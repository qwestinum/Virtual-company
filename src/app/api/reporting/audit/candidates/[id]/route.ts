/**
 * /api/reporting/audit/candidates/[id] — détail complet d'une analyse
 * candidat (CVApplication intégral) pour la vue critère-par-critère de
 * l'audit candidat (cf. docs/specs/reporting.md §5.3).
 */
import { NextResponse } from 'next/server';

import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import {
  journeyFromSignals,
  loadJourneySignals,
} from '@/lib/reporting/journey-lookup';
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
    // Enrichit avec le parcours dérivé du journal + file HITL (lecture seule).
    const signals = await loadJourneySignals({
      campaignId: candidate.campaignId ?? undefined,
    });
    const journey = journeyFromSignals(
      signals,
      candidate.uid,
      candidate.status,
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
