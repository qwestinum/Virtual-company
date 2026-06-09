/**
 * /api/reporting/audit/candidates — liste filtrable des analyses candidat
 * pour la sélection de l'audit candidat (cf. docs/specs/reporting.md §5.3).
 *
 * Filtres (query params, ET logique) : search, campaignId, status, from, to.
 */
import { NextResponse } from 'next/server';

import { listCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import {
  CANDIDATE_STAGES,
  deriveJourneyFor,
  type CandidateStage,
} from '@/lib/reporting/candidate-journey';
import { loadCandidateMarkers } from '@/lib/reporting/journey-lookup';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import type { CandidateAnalysisFilters } from '@/types/reporting';
import { CandidateStatusSchema } from '@/types/scoring';

export const runtime = 'nodejs';

function notConfigured(): NextResponse {
  return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const filters: CandidateAnalysisFilters = {};

  const search = params.get('search');
  if (search) filters.search = search;
  const campaignId = params.get('campaignId');
  if (campaignId) filters.campaignId = campaignId;
  const status = params.get('status');
  if (status) {
    const parsed = CandidateStatusSchema.safeParse(status);
    if (parsed.success) filters.status = parsed.data;
  }
  const from = params.get('from');
  if (from) filters.from = from;
  const to = params.get('to');
  if (to) filters.to = to;

  // Filtre d'étape de parcours (dérivé, donc appliqué post-enrichissement).
  const stageRaw = params.get('stage');
  const stageFilter = (CANDIDATE_STAGES as readonly string[]).includes(
    stageRaw ?? '',
  )
    ? (stageRaw as CandidateStage)
    : null;

  try {
    const candidates = await listCandidateAnalyses(filters);
    // Enrichit chaque candidat avec son parcours dérivé du journal. Un seul
    // scan journal (toutes campagnes) → map uid→marqueurs partagée.
    const markers = await loadCandidateMarkers();
    const enriched = candidates.map((c) => ({
      ...c,
      journey: deriveJourneyFor(c.status, markers.get(c.uid)),
    }));
    const filtered = stageFilter
      ? enriched.filter((c) => c.journey.stage === stageFilter)
      : enriched;
    return NextResponse.json({ candidates: filtered });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
