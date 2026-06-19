/**
 * /api/campaigns/[id]/vivier-keyword-search — recherche par MOT-CLÉ exacte sur
 * le vivier (plein-texte), STRICTEMENT distincte de la présélection sémantique.
 *
 *   POST { query } : retrouve les CV du vivier (org-level) contenant le(s)
 *                    mot(s), avec extrait surligné, et annote chaque résultat de
 *                    sa présence dans la liste de validation de la campagne.
 *
 * Aucune écriture, aucun seuil, aucun embedding : le mot est présent ou non.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { searchVivierFulltext } from '@/lib/db/repos/vivier';
import { getPreselectionStatesForCandidates } from '@/lib/db/repos/vivier-preselection';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import type { VivierKeywordResult } from '@/types/vivier-keyword-search';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

const BodySchema = z.object({ query: z.string().trim().min(1).max(120) });

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id: campaignId } = await context.params;

  let query: string;
  try {
    query = BodySchema.parse(await request.json()).query;
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Requête invalide.',
      },
      { status: 400 },
    );
  }

  try {
    const hits = await searchVivierFulltext(query);
    const states = await getPreselectionStatesForCandidates(
      campaignId,
      hits.map((h) => h.candidateId),
    );
    const results: VivierKeywordResult[] = hits.map((h) => ({
      candidateId: h.candidateId,
      nom: h.nom,
      prenom: h.prenom,
      title: h.title,
      snippet: h.snippet,
      membership: states.get(h.candidateId) ?? 'none',
    }));
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'keyword_search_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}
