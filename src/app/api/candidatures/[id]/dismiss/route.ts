/**
 * POST /api/candidatures/[id]/dismiss — classement sans suite INDIVIDUEL.
 *
 * `id` = identifiant d'ANALYSE (clé du menu Candidatures). Raisons
 * individuelles uniquement (candidat_retire / sans_reponse / doublon /
 * invalide) — `campagne_cloturee` et `poste_pourvu` sont réservées aux flux
 * campagne (clôture, GO). Cœur partagé `dismissCandidature` (void HITL,
 * classement conditionnel, briefs, journal).
 *
 * Message au candidat (feat/feedback-candidat, 28/09/2026) : pour une raison
 * qui appelle un message (DISMISSAL_MAIL_POLICY ≠ 'never'), le choix est
 * OBLIGATOIRE — envoyer le gabarit « sans suite » relu à l'écran, ou prévenir
 * soi-même — et contrôlé AVANT le classement. Doublon / invalide : jamais de
 * message, aucun choix demandé. Le message part par `feedback.ts`, sous la
 * MÊME clé de verrou que l'envoi groupé de la clôture : un seul par candidature.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import { dismissCandidature } from '@/lib/candidatures/dismissal';
import {
  checkFeedbackChoice,
  FEEDBACK_REFUSAL_MESSAGES,
  FeedbackChoiceSchema,
} from '@/lib/candidatures/feedback-choice';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  dismissalMailAllowed,
  DismissalReasonSchema,
  INDIVIDUAL_DISMISSAL_REASONS,
} from '@/types/dismissal';

export const runtime = 'nodejs';

const RequestSchema = z.object({
  reason: DismissalReasonSchema.refine(
    (r) => INDIVIDUAL_DISMISSAL_REASONS.includes(r),
    { message: 'Raison réservée aux flux campagne (clôture / GO).' },
  ),
  feedback: FeedbackChoiceSchema.optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  let parsed: z.infer<typeof RequestSchema>;
  try {
    parsed = RequestSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Invalid request body.',
      },
      { status: 400 },
    );
  }

  const needsMessage = dismissalMailAllowed(parsed.reason);
  const feedback = needsMessage ? parsed.feedback : undefined;
  if (needsMessage && !feedback) {
    return NextResponse.json(
      { error: 'feedback_required', message: FEEDBACK_REFUSAL_MESSAGES.feedback_required },
      { status: 400 },
    );
  }

  try {
    const analysis = await getCandidateAnalysis(id);
    if (!analysis) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (feedback) {
      const refusal = checkFeedbackChoice(feedback, { candidateEmail: analysis.candidateEmail });
      if (refusal) {
        return NextResponse.json(
          { error: refusal, message: FEEDBACK_REFUSAL_MESSAGES[refusal] },
          { status: 400 },
        );
      }
    }
    const user = await getApiUser();
    const actor = user ? { userId: user.id, email: user.email ?? null } : null;
    const result = await dismissCandidature(analysis, {
      reason: parsed.reason,
      message: feedback ?? null,
      dismissedBy: 'user',
      dismissedByUser: actor,
      actor: 'user',
    });
    if (result.status === 'not_found') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (result.status === 'deferred_sending') {
      // Un envoi de validation est en cours (≤ TTL 5 min) — jamais classer
      // sous incertitude ; le client réessaie après résolution.
      return NextResponse.json({ error: 'send_in_flight' }, { status: 409 });
    }
    // Le message est porté PAR le classement (même verrou que l'envoi groupé) :
    // `result.feedback` dit ce qu'il en est advenu.
    return NextResponse.json(result);
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
