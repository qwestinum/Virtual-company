/**
 * POST /api/candidatures/[id]/no-show — le candidat ne s'est pas présenté, et
 * le recruteur le classe NON RETENU (feat/feedback-candidat, 28/09/2026).
 *
 * Le SEUL chemin de cette décision : `/api/journal` refuse le marqueur
 * `missed`. Comme pour le verdict, le choix de message est OBLIGATOIRE
 * (`feedback`, gabarit « absent ») et contrôlé AVANT le marqueur.
 * « Re-proposer un créneau » ne passe pas par ici : il ne décide rien.
 *
 *   200 { status: 'decided', feedback }
 *   400 { error: 'feedback_required' | FeedbackChoiceRefusal | 'invalid_request', message }
 *   404 { error: 'not_found' }
 *   409 { error: 'not_awaiting_interview', stage } — l'état a bougé : recharger
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import { recordFeedback, type RecordFeedbackOutcome } from '@/lib/candidatures/feedback';
import {
  checkFeedbackChoice,
  FEEDBACK_REFUSAL_MESSAGES,
  FeedbackChoiceSchema,
} from '@/lib/candidatures/feedback-choice';
import { postNoShow } from '@/lib/candidatures/no-show';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

const BodySchema = z.object({ feedback: FeedbackChoiceSchema.optional() });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Le message au candidat est incomplet.' },
      { status: 400 },
    );
  }
  const feedback = body.feedback;
  if (!feedback) {
    return NextResponse.json(
      { error: 'feedback_required', message: FEEDBACK_REFUSAL_MESSAGES.feedback_required },
      { status: 400 },
    );
  }

  try {
    const [analysis, user] = await Promise.all([getCandidateAnalysis(id), getApiUser()]);
    if (!analysis) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const refusal = checkFeedbackChoice(feedback, { candidateEmail: analysis.candidateEmail });
    if (refusal) {
      return NextResponse.json(
        { error: refusal, message: FEEDBACK_REFUSAL_MESSAGES[refusal] },
        { status: 400 },
      );
    }

    const actor = user ? { userId: user.id, email: user.email ?? null } : null;
    const outcome = await postNoShow({ analysis, actor });
    if (outcome.status === 'not_awaiting_interview') {
      return NextResponse.json(
        { error: 'not_awaiting_interview', stage: outcome.stage },
        { status: 409 },
      );
    }

    let recorded: RecordFeedbackOutcome | { error: 'record_failed' };
    try {
      recorded = await recordFeedback({ analysis, kind: 'absent', choice: feedback, actor });
    } catch {
      recorded = { error: 'record_failed' };
    }
    return NextResponse.json({ status: 'decided', feedback: recorded });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: 'db_error', message: (err as Error).message }, { status: 500 });
  }
}
