/**
 * POST /api/campaigns/[id]/close — clôture DÉDIÉE d'une campagne.
 *
 * Seul chemin qui pose `closed_at` (le PUT snapshot ne le fait pas).
 *
 * Corps (feat/feedback-candidat, lot 4) :
 *   { outcome: 'conclu'|'non_conclu', hiredAnalysisId, notSelected[{analysisId, feedback}],
 *     dismissOpen, reason, sendMail }
 *   - conclu + recruté désigné : marqueur `candidate_hired_marked` ; chaque AUTRE
 *     retenu passe « Non retenu » (cause `not_selected_at_closure`) avec SON
 *     message — obligatoire, contrôlé AVANT toute écriture (règle serveur) ;
 *   - conclu sans préciser / non conclu : aucun retenu ne change ;
 *   - candidatures OUVERTES : classement sans suite groupé (gabarit « Sans
 *     suite », motif selon l'issue) — inchangé, rail au-delà de 20 dossiers.
 * Journal : `campaign_closed` { outcome, hiredAnalysisId, notSelectedAnalysisIds }
 * — identifiants seulement, jamais un nom.
 *
 *   200 { campaign, summary, dismissalQueued, closure }
 *   400 { error: ClosureRefusal['error'] | 'invalid_request', message, analysisId? }
 *   404 { error: 'not_found' }
 */
import { NextResponse, after } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import {
  applyClosureDecisions,
  CAMPAIGN_CLOSED_ACTION,
  checkClosure,
  type NotSelectedOutcome,
} from '@/lib/campagnes/closure';
import { FeedbackChoiceSchema } from '@/lib/candidatures/feedback-choice';
import { purgeCampaignSourcing } from '@/lib/sourcing/server/maintenance';
import {
  closeWithDismissals,
  listOpenCandidatures,
  type BatchDismissalSummary,
} from '@/lib/candidatures/dismissal-batch';
import { getCampaign, patchCampaign } from '@/lib/db/repos/campaigns';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RequestSchema = z.object({
  dismissOpen: z.boolean(),
  reason: z.enum(['campagne_cloturee', 'poste_pourvu']).optional(),
  sendMail: z.boolean().optional(),
  // Absent (anciens appelants) ⇒ déduit du motif, sans désignation.
  outcome: z.enum(['conclu', 'non_conclu']).optional(),
  hiredAnalysisId: z.string().min(1).nullable().optional(),
  notSelected: z
    .array(z.object({ analysisId: z.string().min(1), feedback: FeedbackChoiceSchema }))
    .optional(),
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

  const decisions = {
    outcome: parsed.outcome ?? (parsed.reason === 'poste_pourvu' ? 'conclu' : 'non_conclu'),
    hiredAnalysisId: parsed.hiredAnalysisId ?? null,
    notSelected: parsed.notSelected ?? [],
  } as const;

  try {
    const existing = await getCampaign(id);
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const user = await getApiUser();
    const actor = user ? { userId: user.id, email: user.email ?? null } : null;

    // 1. Tout est contrôlé AVANT la moindre écriture, contre l'état RELU.
    const { retenuAnalyses } = await listOpenCandidatures(id);
    const refusal = checkClosure(
      { ...decisions, notSelected: [...decisions.notSelected] },
      retenuAnalyses,
    );
    if (refusal) return NextResponse.json(refusal, { status: 400 });

    // 2. La clôture elle-même.
    const updated = await patchCampaign(id, { status: 'closed' });
    if (!updated) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    // 3. Désignation du recruté et retenus non sélectionnés (un mail au plus
    //    chacun, par le chemin des messages après décision).
    const notSelected: NotSelectedOutcome[] = await applyClosureDecisions({
      input: { ...decisions, notSelected: [...decisions.notSelected] },
      retenus: retenuAnalyses,
      actor,
    });

    // 4. Candidatures encore ouvertes : classement sans suite groupé.
    let summary: BatchDismissalSummary | null = null;
    // Au-delà de 20 dossiers, le lot part sur le rail : la réponse le DIT
    // (`dismissalQueued`) plutôt que de rendre un résumé qui n'existe pas encore.
    let dismissalQueued: { total: number } | null = null;
    if (parsed.dismissOpen) {
      const outcome = await closeWithDismissals(id, {
        reason: parsed.reason ?? (decisions.outcome === 'conclu' ? 'poste_pourvu' : 'campagne_cloturee'),
        sendMail: parsed.sendMail ?? false,
        dismissedByUser: actor,
        actor: 'user',
      });
      if (outcome.kind === 'done') summary = outcome.summary;
      else dismissalQueued = { total: outcome.total };
    }

    // 5. La trace de la clôture — identifiants seulement, jamais un nom.
    await appendJournalEntry({
      action: CAMPAIGN_CLOSED_ACTION,
      actor: 'user',
      campaignId: id,
      payload: {
        // Le nom de la CAMPAGNE (jamais d'un candidat) : les lecteurs
        // historiques de cette action l'attendent.
        campaignName: existing.name,
        outcome: decisions.outcome,
        hiredAnalysisId: decisions.hiredAnalysisId,
        notSelectedAnalysisIds: decisions.notSelected.map((n) => n.analysisId),
        dismissOpen: parsed.dismissOpen,
        actorUserId: actor?.userId ?? null,
        actorEmail: actor?.email ?? null,
      },
    }).catch(() => undefined);

    // Sourcing : les profils trouvés pour cette campagne ne lui survivent pas
    // (spec sourcing §12.1). Après la réponse, fail-soft ; le rail de drain
    // rattrape une purge manquée.
    after(() => purgeCampaignSourcing(id, 'closure'));

    return NextResponse.json({
      campaign: updated,
      summary,
      dismissalQueued,
      closure: {
        outcome: decisions.outcome,
        hiredAnalysisId: decisions.hiredAnalysisId,
        notSelected,
      },
    });
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
