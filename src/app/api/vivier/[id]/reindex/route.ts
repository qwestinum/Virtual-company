/**
 * /api/vivier/[id]/reindex — re-tentative manuelle d'indexation d'un dossier
 * (typiquement après un statut `failed`). Synchrone ici : l'utilisateur a
 * demandé explicitement la reprise et en attend le résultat.
 */
import { NextResponse } from 'next/server';

import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { indexVivierCandidate } from '@/lib/vivier/indexing';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const result = await indexVivierCandidate(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'reindex_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}
