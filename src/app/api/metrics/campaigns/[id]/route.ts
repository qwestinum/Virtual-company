/**
 * /api/metrics/campaigns/[id] — métriques d'une campagne (Session 6).
 *
 * Renvoie les chiffres affichés à l'intérieur d'une carte campagne
 * dépliée : CV reçus, shortlistés, invités, entretiens, GO, score
 * moyen. Comme /api/metrics/global, le mode dégradé renvoie 200 +
 * un payload vide cohérent quand Supabase n'est pas configuré.
 */

import { NextResponse } from 'next/server';

import {
  journalToCampaignMetric,
} from '@/lib/dashboard/derive-metrics';
import { fetchMetricsRowsForCampaign } from '@/lib/db/repos/metrics';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'campaign id is required' },
      { status: 400 },
    );
  }

  const result = await fetchMetricsRowsForCampaign(id);
  if (!result) {
    return NextResponse.json({
      offline: true,
      metric: journalToCampaignMetric([], id),
    });
  }

  return NextResponse.json({
    offline: false,
    metric: journalToCampaignMetric(result.rows, id),
  });
}
