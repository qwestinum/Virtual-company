/**
 * /api/campaigns/[id]/vivier-preselection/decisions — décisions de validation
 * vivier (Session V3, §5.3). Accepter la prise de contact / Rejeter, en
 * unitaire ou en masse. Chaque décision est tracée au journal.
 *
 * En V3 commit 2, « accepter » pose l'état `contacted` (transition atomique).
 * L'ENVOI réel de l'invitation (qui conditionne le passage à contacté) est
 * câblé au commit suivant (message d'invitation) — il s'insère AVANT le mark.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  markContacted,
  markRejected,
} from '@/lib/db/repos/vivier-preselection';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  candidateIds: z.array(z.string().min(1)).min(1).max(200),
  decision: z.enum(['accept', 'reject']),
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
    const updated =
      body.decision === 'reject'
        ? await markRejected(campaignId, body.candidateIds, actor)
        : await markContacted(campaignId, body.candidateIds, actor);

    await appendJournalEntry({
      action:
        body.decision === 'reject'
          ? 'vivier_contact_rejected'
          : 'vivier_contact_accepted',
      actor,
      campaignId,
      payload: { candidateIds: updated, decision: body.decision },
    });

    return NextResponse.json({ updated });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'decision_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}
