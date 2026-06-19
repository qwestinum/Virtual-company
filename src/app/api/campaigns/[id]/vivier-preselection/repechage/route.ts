/**
 * /api/campaigns/[id]/vivier-preselection/repechage — REPÊCHAGE manuel d'un
 * candidat (issu de la recherche mot-clé) vers la liste de validation.
 *
 *   POST { candidateId, matchTerm? } : injecte le candidat en `identified`
 *     (réactive un `rejected` ; no-op sur un `contacted`). Tracé au journal.
 *
 * Le candidat apparaît ensuite dans /validations-vivier comme tout candidat
 * présélectionné, à valider au même niveau (cycle identifié/contacté/rejeté).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { repechageToPreselection } from '@/lib/db/repos/vivier-preselection';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  candidateId: z.string().min(1),
  matchTerm: z.string().trim().min(1).max(120).optional(),
});

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id: campaignId } = await context.params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Requête invalide.',
      },
      { status: 400 },
    );
  }

  const actor = 'user';
  try {
    const membership = await repechageToPreselection(
      campaignId,
      body.candidateId,
      body.matchTerm ?? null,
    );
    // On ne trace que le repêchage effectif (un `contacted` est laissé intact).
    if (membership === 'identified') {
      await appendJournalEntry({
        action: 'vivier_repechage',
        actor,
        campaignId,
        payload: { candidateId: body.candidateId, matchTerm: body.matchTerm ?? null },
      });
    }
    return NextResponse.json({ membership });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'repechage_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}
