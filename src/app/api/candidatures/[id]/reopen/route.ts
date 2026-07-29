/**
 * POST /api/candidatures/[id]/reopen — réouverture d'un classement sans suite
 * posé par ERREUR. Lève le classement (conditionnel), restaure la validation
 * voidée et les briefs annulés. Le mail d'information déjà parti ne se
 * dé-envoie pas (l'UI le rappelle avant confirmation).
 */
import { NextResponse } from 'next/server';

import { reopenCandidature } from '@/lib/candidatures/dismissal';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const analysis = await getCandidateAnalysis(id);
    if (!analysis) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const result = await reopenCandidature(analysis, 'user');
    if (result === 'not_dismissed') {
      return NextResponse.json({ error: 'not_dismissed' }, { status: 409 });
    }
    return NextResponse.json({ status: 'reopened' });
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
