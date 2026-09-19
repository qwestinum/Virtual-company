/**
 * POST /api/candidatures/[id]/verdict — pose le verdict final MOTIVÉ.
 * Spec : docs/specs/compte-rendu-entretien.md §4.2, §14.
 *
 * Le SEUL chemin d'un verdict final : `/api/journal` refuse l'action
 * `candidate_validation_marked`. Le commentaire est exigé ICI, pas à l'écran
 * — un écran n'est qu'un reflet de la règle.
 *
 * L'AUTEUR vient de la session serveur (`getApiUser`), jamais du corps.
 *
 *   200 { status: 'decided', verdict, commentId }
 *   400 { error: 'comment_too_thin', message }   — la phrase à montrer
 *   404 { error: 'not_found' }
 *   409 { error: 'not_awaiting_verdict', stage } — l'état a bougé : recharger
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import { postFinalVerdict } from '@/lib/candidatures/verdict';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

/** Borne haute : un commentaire motive une décision, il ne remplace pas le CR. */
const MAX_COMMENT = 4000;

const BodySchema = z.object({
  status: z.enum(['validated', 'rejected']),
  comment: z.string().max(MAX_COMMENT),
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
    // Un commentaire absent n'est pas une requête « mal formée » pour
    // l'humain : c'est un commentaire manquant, et on le lui dit comme tel.
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: 'Choisissez un verdict et motivez-le (4 000 caractères au plus).',
      },
      { status: 400 },
    );
  }

  const userP = getApiUser();
  void userP.catch(() => undefined);

  try {
    const analysis = await getCandidateAnalysis(id);
    if (!analysis) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const user = await userP;
    const outcome = await postFinalVerdict({
      analysis,
      verdict: body.status,
      comment: body.comment,
      actor: user ? { userId: user.id, email: user.email ?? null } : null,
    });

    switch (outcome.status) {
      case 'decided':
        return NextResponse.json({
          status: 'decided',
          verdict: outcome.verdict,
          commentId: outcome.commentId,
        });
      case 'comment_too_thin':
        return NextResponse.json(
          { error: 'comment_too_thin', message: outcome.message },
          { status: 400 },
        );
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
