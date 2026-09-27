/**
 * POST /api/validations/[id]/settle — clôt une fiche de validation dont le
 * dossier n'attend PLUS de décision.
 *
 * Sens inverse de `/api/validations/requeue` : là on rendait décidable une
 * analyse sans fiche ; ici on retire une fiche que plus rien ne justifie.
 * Cf. `docs/ops/plan-coherence-file-analyse-2026-09-20.md` (lots 0 et 1).
 *
 * La route ne décide de rien : elle RÉSOUT le dossier depuis la fiche, puis
 * délègue à l'écrivain unique de clôture — le même que celui du re-scoring.
 * La cohérence est donc re-jugée sur l'état relu en base, jamais sur ce que
 * l'écran croyait savoir.
 */
import { NextResponse } from 'next/server';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { getPendingValidation } from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { analysisIdForValidation } from '@/lib/hitl/analysis-key';
import {
  settleValidationsForAnalysisId,
  settleValidationsForUid,
  type SettleOptions,
} from '@/lib/hitl/settle';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getApiUser();
  if (!user) return unauthorizedResponse();
  const { id } = await ctx.params;

  try {
    const validation = await getPendingValidation(id);
    if (!validation) {
      return NextResponse.json({ error: 'validation_not_found' }, { status: 404 });
    }

    const opts: SettleOptions = {
      actor: { userId: user.id, email: user.email ?? null },
      journalActor: 'user',
      context: { via: 'hub' },
    };
    // L'identifiant d'analyse d'abord (globalement unique), l'uid en repli —
    // c'est la clé de rapprochement du reste du produit.
    const analysisId = analysisIdForValidation(validation);
    const uid = typeof validation.payload?.uid === 'string' ? validation.payload.uid : null;
    let outcome = analysisId
      ? await settleValidationsForAnalysisId(analysisId, opts)
      : ({ kind: 'analysis_not_found' } as const);
    if (outcome.kind === 'analysis_not_found' && uid) {
      outcome = await settleValidationsForUid(uid, opts);
    }

    switch (outcome.kind) {
      case 'settled':
        return NextResponse.json(
          { status: 'settled', reason: outcome.reason, validationIds: outcome.validationIds },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      case 'nothing_open':
        // Déjà close, ou engagée entre-temps : pour l'appelant, la fiche n'est
        // plus en attente — c'est le résultat qu'il demandait.
        return NextResponse.json(
          { status: 'already_settled' },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      case 'send_in_flight':
        return NextResponse.json({ error: 'send_in_flight' }, { status: 409 });
      case 'still_awaiting':
      case 'unknown':
        // On ne retire pas un arbitrage sur un doute.
        return NextResponse.json(
          { error: 'still_awaiting', coherence: outcome.kind },
          { status: 409 },
        );
      case 'analysis_not_found':
        return NextResponse.json({ error: 'analysis_not_found' }, { status: 409 });
    }
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'not_persisted' }, { status: 503 });
    }
    console.error('[validations/settle] échec', err);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500 });
  }
}
