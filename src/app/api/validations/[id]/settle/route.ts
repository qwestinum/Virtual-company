/**
 * POST /api/validations/[id]/settle — clôt une fiche de validation dont le
 * dossier n'attend PLUS de décision.
 *
 * Sens inverse de `/api/validations/requeue` : là on rendait décidable une
 * analyse sans fiche ; ici on retire une fiche que plus rien ne justifie.
 * Cf. `docs/ops/plan-coherence-file-analyse-2026-09-20.md` (lot 0).
 *
 * ⚠️ N'ENVOIE RIEN, et ne décide RIEN. Clore n'est pas refuser : la fiche
 * passe `void` — « fermée, jamais tranchée, jamais envoyée » —, le verdict de
 * screening, la zone et `decided_by` de l'analyse restent INTACTS.
 *
 * ⚠️ La cohérence est RE-JUGÉE ici, sur l'état relu en base. Le client ne
 * décide pas de ce qui est clôturable : une fiche qui attend réellement une
 * décision ne doit pas pouvoir être retirée par un écran périmé.
 */
import { NextResponse } from 'next/server';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { getCandidateAnalysis, listCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  getPendingValidation,
  voidPendingValidation,
} from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { analysisIdForValidation } from '@/lib/hitl/analysis-key';
import {
  checkValidationCoherence,
  type AnalysisFacts,
} from '@/lib/hitl/queue-coherence';

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
    // Un envoi est peut-être EN COURS : on ne clôt jamais sous incertitude.
    // Même règle que le classement sans suite, pour la même raison.
    if (validation.status === 'sending') {
      return NextResponse.json({ error: 'send_in_flight' }, { status: 409 });
    }

    const facts = await loadAnalysisFacts(validation);
    const coherence = checkValidationCoherence(facts);
    if (coherence.kind !== 'settled') {
      // `awaiting` comme `unknown` : on ne retire pas un arbitrage sur un doute.
      return NextResponse.json(
        { error: 'still_awaiting', coherence: coherence.kind },
        { status: 409 },
      );
    }

    const outcome = await voidPendingValidation(id);
    if (outcome === 'not_found') {
      return NextResponse.json({ error: 'validation_not_found' }, { status: 404 });
    }
    if (outcome !== 'voided') {
      // Déjà close, ou engagée entre-temps : c'est un succès pour l'appelant
      // (la fiche n'est plus en attente), et on ne journalise pas une clôture
      // qui n'a pas eu lieu.
      return NextResponse.json({ status: outcome }, { headers: { 'Cache-Control': 'no-store' } });
    }

    await appendJournalEntry({
      action: 'validation_settled',
      actor: user.email ?? 'user',
      campaignId: validation.campaignId,
      payload: {
        validationId: id,
        uid: validation.payload?.uid ?? null,
        analysisId: analysisIdForValidation(validation),
        candidate: validation.candidateName,
        reason: coherence.reason,
        decisionZone: facts?.decisionZone ?? null,
        actorUserId: user.id,
        actorEmail: user.email ?? null,
      },
    }).catch(() => {});

    return NextResponse.json(
      { status: 'settled', reason: coherence.reason },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'not_persisted' }, { status: 503 });
    }
    console.error('[validations/settle] échec', err);
    return NextResponse.json({ error: 'unexpected_error' }, { status: 500 });
  }
}

/**
 * L'analyse rapprochée. Par l'identifiant porté (ou dérivé) d'abord — il est
 * globalement unique —, par l'uid en repli, qui est la clé de rapprochement du
 * reste du produit.
 */
async function loadAnalysisFacts(validation: {
  id: string;
  payload?: Record<string, unknown> | null;
}): Promise<AnalysisFacts> {
  const analysisId = analysisIdForValidation(validation);
  if (analysisId) {
    const detail = await getCandidateAnalysis(analysisId).catch(() => null);
    if (detail) {
      return {
        decisionZone: detail.decisionZone,
        decidedBy: detail.decidedBy,
        dismissedAt: detail.dismissedAt,
      };
    }
  }
  const uid = validation.payload?.uid;
  if (typeof uid !== 'string' || !uid) return null;
  const [row] = await listCandidateAnalyses({ uidIn: [uid], limit: 1 });
  if (!row) return null;
  return {
    decisionZone: row.decisionZone,
    decidedBy: row.decidedBy,
    dismissedAt: row.dismissedAt,
  };
}
