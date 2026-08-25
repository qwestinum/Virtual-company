/**
 * GET /api/candidatures/[id]/correction-context — ce que le dialog de
 * correction doit AFFICHER avant toute confirmation : l'état actuel, ce qui a
 * déjà été déclenché, et les nouveaux états valides.
 *
 * Lecture seule, accessible à tout recruteur authentifié (le proxy garde déjà
 * `/api` en deny-by-default) : tout est tracé, il n'y a pas de garde de rôle.
 * `current: null` ⇒ rien à corriger, l'action ne doit pas s'afficher.
 */
import { NextResponse } from 'next/server';

import { loadDecisionCorrectionContext } from '@/lib/candidatures/correction-context';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const analysis = await getCandidateAnalysis(id);
    if (!analysis) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json(
      await loadDecisionCorrectionContext(analysis),
      { headers: { 'Cache-Control': 'no-store' } },
    );
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
