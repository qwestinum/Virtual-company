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
import { listAwaitingWithoutRow } from '@/lib/hitl/orphan-scan';
import { requeueValidationForAnalysis } from '@/lib/hitl/requeue';

export const runtime = 'nodejs';

/**
 * Deux formes, un seul chemin de réparation :
 *   `{ analysisId }` — une candidature, depuis sa fiche ;
 *   `{ all: true }`  — TOUTES celles que le signal compte.
 *
 * ⚠️ En lot, le CLIENT NE CHOISIT PAS les cibles : le serveur les recalcule
 * avec la même sélection que le compteur (`listAwaitingWithoutRow`). Accepter
 * une liste d'identifiants reviendrait à laisser l'écran décider de ce qui est
 * réparable — et à réparer, un jour, ce qu'il avait en mémoire plutôt que ce
 * qui est vrai.
 */
const BodySchema = z.union([
  z.object({ analysisId: z.string().min(1) }),
  z.object({ all: z.literal(true) }),
]);

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

  const acteur = { userId: user.id, email: user.email ?? null };

  if ('all' in parsed.data) {
    try {
      return NextResponse.json(await requeueAllOrphans(acteur), {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (err) {
      if (err instanceof SupabaseNotConfiguredError) {
        return NextResponse.json({ error: 'not_persisted' }, { status: 503 });
      }
      console.error('[validations/requeue] lot en échec', err);
      return NextResponse.json({ error: 'unexpected_error' }, { status: 500 });
    }
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

/**
 * Remet en file TOUTES les candidatures orphelines.
 *
 * SÉQUENTIEL, comme le refus groupé : chacune passe par le chemin unitaire,
 * avec ses gardes et son écrivain. Un échec n'arrête pas la fournée — la
 * candidature reste orpheline, donc visible et retentable au prochain passage.
 *
 * Idempotent de bout en bout : l'identifiant de fiche est déterministe et la
 * fusion non destructive, donc rejouer ne crée jamais de second dossier.
 * N'ENVOIE RIEN : mettre en file, c'est demander un clic humain.
 */
async function requeueAllOrphans(acteur: {
  userId: string;
  email: string | null;
}): Promise<{
  status: 'done';
  requeued: number;
  alreadyQueued: number;
  failed: number;
}> {
  const orphelines = await listAwaitingWithoutRow();
  let requeued = 0;
  let alreadyQueued = 0;
  let failed = 0;

  for (const analyse of orphelines) {
    try {
      const outcome = await requeueValidationForAnalysis(analyse.id, acteur);
      if (outcome.kind === 'requeued') requeued += 1;
      else if (outcome.kind === 'already_queued') alreadyQueued += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  return { status: 'done', requeued, alreadyQueued, failed };
}
