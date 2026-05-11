/**
 * /api/fdps/search — pré-recherche L1 (Session 5, round 1).
 *
 * Interrogé par `searchExistingJobDescriptions` côté Manager. Retourne
 * `[]` si Supabase n'est pas configuré (mode démo local) plutôt qu'un
 * 503 — le Manager doit pouvoir continuer sa conversation même sans
 * persistance, juste sans annoncer de FDP comparable.
 */
import { NextResponse } from 'next/server';

import { searchFdps } from '@/lib/db/repos/fdps-archived';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  if (query.length === 0) {
    return NextResponse.json({ hits: [] });
  }

  try {
    const hits = await searchFdps(query);
    return NextResponse.json({ hits });
  } catch (err) {
    // Pas de Supabase = comportement Session 3 (silence métier côté
    // Manager). Tout autre erreur DB → 500 silencieux côté UI.
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ hits: [] });
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
