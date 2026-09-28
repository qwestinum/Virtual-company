/**
 * /api/candidatures/[id]/feedback — informer le candidat APRÈS COUP
 * (feat/feedback-candidat, lot 5) : rattrape un verdict posé avant le
 * chantier, ou un message qui n'est pas parti.
 *
 * GET  : { expectedKind, reason, informed, lastAttempt } — la situation lue
 *        côté serveur (étape + marqueurs RELUS).
 * POST : { feedback } — le type de message se DÉDUIT de l'état du dossier,
 *        jamais du client ; même chemin que la décision (`recordFeedback`,
 *        verrou deux-phases : un message du même type ne repart jamais).
 *        Aucune décision n'est posée ici.
 *
 *   409 { error: 'nothing_to_announce' } — la situation n'appelle aucun message
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import { recordFeedback } from '@/lib/candidatures/feedback';
import {
  checkFeedbackChoice,
  FEEDBACK_REFUSAL_MESSAGES,
  FeedbackChoiceSchema,
} from '@/lib/candidatures/feedback-choice';
import { expectedFeedbackKind, feedbackStatus } from '@/lib/candidatures/feedback-status';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { listFeedbackByAnalyses } from '@/lib/db/repos/candidate-feedback';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { loadStageSignals, stageFor } from '@/lib/reporting/stage-signals';
import type { CandidateAnalysisSummary } from '@/types/reporting';

export const runtime = 'nodejs';

async function situation(analysis: CandidateAnalysisSummary) {
  const signals = await loadStageSignals(analysis.campaignId ? { campaignId: analysis.campaignId } : {});
  return expectedFeedbackKind({
    stage: stageFor(analysis, signals),
    validationMarked: signals.validationMarks.get(analysis.uid) ?? null,
    interviewMarked: signals.interviewMarks.get(analysis.uid) ?? null,
    dismissalReason: analysis.dismissalReason,
  });
}

function failure(err: unknown): NextResponse {
  if (err instanceof SupabaseNotConfiguredError) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }
  return NextResponse.json({ error: 'db_error', message: (err as Error).message }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const analysis = await getCandidateAnalysis(id);
    if (!analysis) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const [kind, rows] = await Promise.all([situation(analysis), listFeedbackByAnalyses([id])]);
    return NextResponse.json({ ...feedbackStatus(kind, rows), reason: analysis.dismissalReason });
  } catch (err) {
    return failure(err);
  }
}

const BodySchema = z.object({ feedback: FeedbackChoiceSchema });

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
      { error: 'feedback_required', message: FEEDBACK_REFUSAL_MESSAGES.feedback_required },
      { status: 400 },
    );
  }
  try {
    const [analysis, user] = await Promise.all([getCandidateAnalysis(id), getApiUser()]);
    if (!analysis) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const kind = await situation(analysis);
    if (!kind) {
      return NextResponse.json(
        { error: 'nothing_to_announce', message: 'La situation de ce dossier n’appelle aucun message.' },
        { status: 409 },
      );
    }
    const refusal = checkFeedbackChoice(body.feedback, { candidateEmail: analysis.candidateEmail });
    if (refusal) {
      return NextResponse.json({ error: refusal, message: FEEDBACK_REFUSAL_MESSAGES[refusal] }, { status: 400 });
    }
    const feedback = await recordFeedback({
      analysis,
      kind,
      choice: body.feedback,
      actor: user ? { userId: user.id, email: user.email ?? null } : null,
      cause: 'manual_followup',
    });
    return NextResponse.json({ status: 'recorded', feedback });
  } catch (err) {
    return failure(err);
  }
}
