/**
 * POST /api/candidatures/[id]/correct-decision — pose l'état voulu après une
 * décision prise par erreur.
 *
 * L'AUTEUR vient de la session serveur (`getApiUser`), jamais du corps de la
 * requête : c'est ce qui rend « corrigé par Sarah D. » vérifiable.
 *
 * Aucune garde de rôle : tout recruteur authentifié peut corriger, tout est
 * tracé. Le contexte est RELU ici (jamais celui qu'aurait envoyé le client) —
 * c'est lui qui valide la cible demandée.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import { loadDecisionCorrectionContext } from '@/lib/candidatures/correction-context';
import { applyDecisionCorrection } from '@/lib/candidatures/decision-correction';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { CORRECTION_TARGETS } from '@/types/decision-correction';

export const runtime = 'nodejs';

/** Motif libre : borné pour ne pas transformer le journal en dépotoir. */
const MAX_REASON = 500;

const BodySchema = z.object({
  target: z.enum(CORRECTION_TARGETS),
  reason: z.string().max(MAX_REASON).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Corps invalide.',
      },
      { status: 400 },
    );
  }

  try {
    const analysis = await getCandidateAnalysis(id);
    if (!analysis) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const user = await getApiUser();
    const correctionContext = await loadDecisionCorrectionContext(analysis);
    const outcome = await applyDecisionCorrection({
      analysis,
      context: correctionContext,
      target: body.target,
      reason: body.reason?.trim() || null,
      actor: user ? { userId: user.id, email: user.email ?? null } : null,
    });

    if (outcome.status === 'corrected') return NextResponse.json(outcome);
    // 409 : l'état a bougé sous les pieds de l'utilisateur (dossier déjà
    // corrigé ailleurs, plus rien à corriger). Le client recharge.
    return NextResponse.json({ error: outcome.status }, { status: 409 });
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
