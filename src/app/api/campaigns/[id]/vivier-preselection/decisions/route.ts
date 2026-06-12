/**
 * /api/campaigns/[id]/vivier-preselection/decisions — décisions de validation
 * vivier (Session V3, §5.3). Accepter la prise de contact / Rejeter, en
 * unitaire ou en masse. Chaque décision est tracée au journal.
 *
 * « Accepter la prise de contact » DÉCLENCHE l'envoi de l'invitation à postuler
 * (action à permission : c'est l'acte explicite de l'utilisateur qui envoie) ;
 * l'envoi fait passer la proposition à `contacted`. « Rejeter » pose `rejected`.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { markRejected } from '@/lib/db/repos/vivier-preselection';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { sendVivierInvitation } from '@/lib/vivier/invitation-send';

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
    let updated: string[];
    if (body.decision === 'reject') {
      updated = await markRejected(campaignId, body.candidateIds, actor);
    } else {
      // Accepter ⇒ envoi de l'invitation (qui marque `contacted`). On ne retient
      // que les candidats effectivement contactés.
      const results = await Promise.all(
        body.candidateIds.map((id) =>
          sendVivierInvitation(campaignId, id, actor),
        ),
      );
      updated = body.candidateIds.filter((_, i) => results[i]?.contacted);
    }

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
