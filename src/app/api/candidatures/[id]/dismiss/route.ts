/**
 * POST /api/candidatures/[id]/dismiss — classement sans suite INDIVIDUEL.
 *
 * `id` = identifiant d'ANALYSE (clé du menu Candidatures). Raisons
 * individuelles uniquement (candidat_retire / sans_reponse / doublon /
 * invalide) — `campagne_cloturee` et `poste_pourvu` sont réservées aux flux
 * campagne (clôture, GO). Cœur partagé `dismissCandidature` (void HITL,
 * classement conditionnel, briefs, mail sous claim, journal).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import { dismissCandidature } from '@/lib/candidatures/dismissal';
import { getCandidateAnalysis } from '@/lib/db/repos/candidate-analyses';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { INDIVIDUAL_DISMISSAL_REASONS, DismissalReasonSchema } from '@/types/dismissal';

export const runtime = 'nodejs';

const RequestSchema = z.object({
  reason: DismissalReasonSchema.refine(
    (r) => INDIVIDUAL_DISMISSAL_REASONS.includes(r),
    { message: 'Raison réservée aux flux campagne (clôture / GO).' },
  ),
  sendMail: z.boolean(),
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

  try {
    const analysis = await getCandidateAnalysis(id);
    if (!analysis) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const user = await getApiUser();
    const result = await dismissCandidature(analysis, {
      reason: parsed.reason,
      sendMail: parsed.sendMail,
      dismissedBy: 'user',
      dismissedByUser: user
        ? { userId: user.id, email: user.email ?? null }
        : null,
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
