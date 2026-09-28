/**
 * GET /api/candidatures/[id]/feedback-proposal?kind=…&reason=… — le message
 * PROPOSÉ au recruteur au moment d'une décision (feat/feedback-candidat).
 *
 * Lecture seule : rien n'est écrit, rien n'est envoyé. Le gabarit et ses
 * variables sont rendus côté écran (la prochaine étape se saisit en direct).
 * Le signataire est le recruteur de la SESSION.
 *
 *   200 FeedbackProposal
 *   400 { error: 'invalid_request' }
 *   404 { error: 'not_found' }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import { loadFeedbackContext } from '@/lib/candidatures/feedback';
import { dismissalMotif, FEEDBACK_TEMPLATE_FIELD } from '@/lib/candidatures/feedback-template';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { listFeedbackByAnalyses } from '@/lib/db/repos/candidate-feedback';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { buildVivierRgpdMention } from '@/lib/vivier/rgpd-mention';
import {
  FEEDBACK_KINDS,
  feedbackInforms,
  type FeedbackProposal,
} from '@/types/candidate-feedback';
import { DismissalReasonSchema } from '@/types/dismissal';

export const runtime = 'nodejs';

const QuerySchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  reason: DismissalReasonSchema.optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  const parsed = QuerySchema.safeParse({
    kind: params.get('kind'),
    reason: params.get('reason') ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const { kind, reason } = parsed.data;

  try {
    const [analysis, user] = await Promise.all([getCandidateAnalysis(id), getApiUser()]);
    if (!analysis) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const [ctx, previous] = await Promise.all([
      loadFeedbackContext(analysis, user ? { userId: user.id, email: user.email ?? null } : null),
      listFeedbackByAnalyses([analysis.id]),
    ]);
    const informed = previous.filter((f) => f.kind === kind && feedbackInforms(f)).at(-1);
    const motif = kind === 'sans_suite' && reason ? dismissalMotif(reason) : null;

    const body: FeedbackProposal = {
      kind,
      template: ctx.templates[FEEDBACK_TEMPLATE_FIELD[kind]],
      vars: { ...ctx.vars, ...(motif ? { motif } : {}) },
      candidateEmail: ctx.candidateEmail,
      replyTo: ctx.replyTo,
      rgpdFooter: buildVivierRgpdMention(ctx.rgpdContact),
      alreadyInformed: informed ? { channel: informed.channel, at: informed.createdAt } : null,
    };
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: 'db_error', message: (err as Error).message }, { status: 500 });
  }
}
