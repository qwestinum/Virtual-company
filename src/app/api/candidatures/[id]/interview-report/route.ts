/**
 * /api/candidatures/[id]/interview-report — compte rendu d'entretien.
 * Spec : docs/specs/compte-rendu-entretien.md §3, §15.
 *
 *   GET → { report, criteria, writable }
 *   PUT { sections, action: 'draft' | 'verify' } → { report }
 *     409 interview_not_realized — aucun entretien marqué « réalisé »
 *     409 already_verified       — un compte rendu validé ne redevient pas brouillon
 *     400 empty_report           — un gabarit vide ne se valide pas
 *     401 session_required       — valider, c'est signer : il faut une session
 *
 * L'AUTEUR vient de la session serveur (`getApiUser`), jamais du corps.
 */
import { NextResponse } from 'next/server';

import { getApiUser } from '@/lib/auth/require-api-user';
import {
  loadInterviewReportView,
  saveReportFor,
} from '@/lib/candidatures/interview-report';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { InterviewReportSaveSchema } from '@/types/interview-report';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

function failure(err: unknown): NextResponse {
  if (err instanceof SupabaseNotConfiguredError) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }
  return NextResponse.json(
    { error: 'db_error', message: (err as Error).message },
    { status: 500 },
  );
}

export async function GET(_request: Request, context: Ctx): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const analysis = await getCandidateAnalysis(id);
    if (!analysis) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(await loadInterviewReportView(analysis));
  } catch (err) {
    return failure(err);
  }
}

export async function PUT(request: Request, context: Ctx): Promise<NextResponse> {
  const { id } = await context.params;
  const parsed = InterviewReportSaveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Compte rendu illisible ou trop long.' },
      { status: 400 },
    );
  }

  const userP = getApiUser();
  void userP.catch(() => undefined);
  try {
    const analysis = await getCandidateAnalysis(id);
    if (!analysis) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const user = await userP;
    const outcome = await saveReportFor({
      analysis,
      sections: parsed.data.sections,
      action: parsed.data.action,
      actor: user ? { userId: user.id, email: user.email ?? null } : null,
    });
    switch (outcome.status) {
      case 'saved':
        return NextResponse.json({ report: outcome.report });
      case 'interview_not_realized':
      case 'already_verified':
        return NextResponse.json({ error: outcome.status }, { status: 409 });
      case 'empty_report':
        return NextResponse.json({ error: outcome.status }, { status: 400 });
      case 'session_required':
        return NextResponse.json({ error: outcome.status }, { status: 401 });
      default: {
        const never: never = outcome;
        throw new Error(`Issue non traitée : ${JSON.stringify(never)}`);
      }
    }
  } catch (err) {
    return failure(err);
  }
}
