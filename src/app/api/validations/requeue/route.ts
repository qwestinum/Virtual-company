/**
 * POST /api/validations/requeue — rend décidable une candidature en attente
 * dont la fiche de validation manque (« validation orpheline »).
 *
 * Diagnostic : `docs/ops/diagnostic-validations-orphelines-2026-09-20.md`.
 *
 * ⚠️ N'ENVOIE RIEN. Mettre en file, c'est demander un clic humain — jamais le
 * remplacer. La cible est RELUE et validée côté serveur (le client ne décide
 * pas de ce qui est réparable) : zone d'attente, non classée, jamais tranchée
 * par un humain.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { requeueValidationForAnalysis } from '@/lib/hitl/requeue';

export const runtime = 'nodejs';

const BodySchema = z.object({ analysisId: z.string().min(1) });

/** Motif → message métier, adressé au recruteur (jamais un code technique). */
const REFUSAL_MESSAGES: Record<string, string> = {
  no_campaign:
    "Cette candidature n'est rattachée à aucune campagne : il n'y a pas de file où la remettre.",
  not_awaiting:
    "Cette candidature n'attend pas de décision — sa zone ne relève pas de la validation humaine.",
  decided_by_human:
    'Une décision a déjà été prise sur ce dossier. Pour la corriger, utilisez « Corriger la décision ».',
  dismissed:
    'Cette candidature est classée sans suite. Rouvrez-la d’abord si vous voulez la décider.',
};

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getApiUser();
  if (!user) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    const outcome = await requeueValidationForAnalysis(parsed.data.analysisId, {
      userId: user.id,
      email: user.email ?? null,
    });

    switch (outcome.kind) {
      case 'requeued':
      case 'already_queued':
        return NextResponse.json(
          { status: outcome.kind, validationId: outcome.validationId },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      case 'not_found':
        return NextResponse.json({ error: 'analysis_not_found' }, { status: 404 });
      case 'refused':
        return NextResponse.json(
          { error: outcome.reason, message: REFUSAL_MESSAGES[outcome.reason] },
          { status: 409 },
        );
      case 'not_persisted':
        // Rien n'a été écrit : on le DIT, plutôt que de rendre un succès qui
        // laisserait croire le dossier réparé.
        return NextResponse.json({ error: 'not_persisted' }, { status: 503 });
    }
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'not_persisted' }, { status: 503 });
    }
    console.error('[validations/requeue] échec', err);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500 });
  }
}
