/**
 * /api/reporting/audit/candidates — liste filtrable des analyses candidat
 * pour la sélection de l'audit candidat (cf. docs/specs/reporting.md §5.3).
 *
 * Filtres (query params, ET logique) : search, campaignId, status, from, to.
 */
import { NextResponse } from 'next/server';

import { listCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import {
  JOURNEY_FILTER_STATES,
  journeyFilterKey,
  type JourneyFilterState,
} from '@/lib/reporting/candidate-journey';
import {
  journeyFromSignals,
  loadJourneySignals,
} from '@/lib/reporting/journey-lookup';
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

  // Filtre d'état de parcours (dérivé, donc appliqué post-enrichissement).
  const stageRaw = params.get('stage');
  const stageFilter = (JOURNEY_FILTER_STATES as readonly string[]).includes(
    stageRaw ?? '',
  )
    ? (stageRaw as JourneyFilterState)
    : null;

  try {
    const candidates = await listCandidateAnalyses(filters);
    // Enrichit chaque candidat avec son parcours dérivé du journal + file HITL.
    // Un seul scan (toutes campagnes) → signaux partagés.
    const signals = await loadJourneySignals();
    const enriched = candidates.map((c) => ({
      ...c,
      journey: journeyFromSignals(signals, c.uid, c.status, c.decisionZone, c.decidedBy),
    }));
    const filtered = stageFilter
      ? enriched.filter((c) => journeyFilterKey(c.journey) === stageFilter)
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
