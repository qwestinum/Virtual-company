/**
 * POST /api/candidatures/[id]/verdict — pose le verdict final MOTIVÉ.
 * Spec : docs/specs/compte-rendu-entretien.md §4.2, §14.
 *
 * Le SEUL chemin d'un verdict final : `/api/journal` refuse l'action
 * `candidate_validation_marked`. Le commentaire qui motive le verdict est
 * FACULTATIF (19/09/2026) ; s'il est écrit, il est enregistré avec lui.
 *
 * L'AUTEUR vient de la session serveur (`getApiUser`), jamais du corps.
 *
 * Le candidat est INFORMÉ, par l'un de deux gestes, l'un des deux OBLIGATOIRE
 * (feat/feedback-candidat, 28/09/2026) : `feedback.mode = 'send'` (le message
 * relu à l'écran part, signé du recruteur) ou `'self'` (le recruteur le
 * prévient lui-même, canal tracé). Règle SERVEUR : sans ce choix, rien n'est
 * posé. Le choix est contrôlé AVANT le verdict (adresse connue, commentaire
 * interne absent du message) ; l'envoi a lieu APRÈS — une panne d'envoi ne
 * défait pas la décision, elle se dit (`feedback.mailStatus`).
 *
 *   200 { status: 'decided', verdict, commentId, feedback }
 *       feedback = { feedbackId, kind, channel, mailStatus } | { error: 'record_failed' }
 *   400 { error: 'invalid_request', message }
 *   400 { error: 'feedback_required' | FeedbackChoiceRefusal, message }
 *   404 { error: 'not_found' }
 *   409 { error: 'not_awaiting_verdict', stage } — l'état a bougé : recharger
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import { recordFeedback, type RecordFeedbackOutcome } from '@/lib/candidatures/feedback';
import {
  checkFeedbackChoice,
  FEEDBACK_REFUSAL_MESSAGES,
  FeedbackChoiceSchema,
  feedbackKindForVerdict,
} from '@/lib/candidatures/feedback-choice';
import { postFinalVerdict } from '@/lib/candidatures/verdict';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

/** Borne haute : un commentaire motive une décision, il ne remplace pas le CR. */
const MAX_COMMENT = 4000;

const BodySchema = z.object({
  status: z.enum(['validated', 'rejected']),
  comment: z.string().max(MAX_COMMENT).nullable().optional(),
  // Optionnel AU SCHÉMA pour rendre un refus lisible (`feedback_required`)
  // plutôt qu'une erreur de format — mais jamais optionnel à la décision.
  feedback: FeedbackChoiceSchema.optional(),
});

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
      {
        error: 'invalid_request',
        message: 'Choisissez un verdict ; le commentaire fait 4 000 caractères au plus.',
      },
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

  const userP = getApiUser();
  void userP.catch(() => undefined);

  try {
    const analysis = await getCandidateAnalysis(id);
    if (!analysis) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    // Le choix de message, contrôlé AVANT toute écriture.
    const refusal = checkFeedbackChoice(feedback, {
      candidateEmail: analysis.candidateEmail,
      comment: body.comment,
    });
    if (refusal) {
      return NextResponse.json(
        { error: refusal, message: FEEDBACK_REFUSAL_MESSAGES[refusal] },
        { status: 400 },
      );
    }

    const user = await userP;
    const actor = user ? { userId: user.id, email: user.email ?? null } : null;
    const outcome = await postFinalVerdict({
      analysis,
      verdict: body.status,
      comment: body.comment,
      actor,
    });

    switch (outcome.status) {
      case 'decided': {
        let recorded: RecordFeedbackOutcome | { error: 'record_failed' };
        try {
          recorded = await recordFeedback({
            analysis,
            kind: feedbackKindForVerdict(outcome.verdict),
            choice: feedback,
            actor,
          });
        } catch {
          // Le verdict EST posé ; seul l'enregistrement du message a échoué.
          // L'écran le dit et la fiche propose « Informer le candidat ».
          recorded = { error: 'record_failed' };
        }
        return NextResponse.json({
          status: 'decided',
          verdict: outcome.verdict,
          commentId: outcome.commentId,
          feedback: recorded,
        });
      }
      case 'not_awaiting_verdict':
        return NextResponse.json(
          { error: 'not_awaiting_verdict', stage: outcome.stage },
          { status: 409 },
        );
      default: {
        const never: never = outcome;
        throw new Error(`Issue de verdict non traitée : ${JSON.stringify(never)}`);
      }
    }
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
