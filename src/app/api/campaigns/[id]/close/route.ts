/**
 * POST /api/campaigns/[id]/close — clôture DÉDIÉE d'une campagne.
 *
 * Répare au passage un trou historique : la clôture UI passait par le store +
 * PUT snapshot (debouncé), qui ne pose JAMAIS `closed_at` — seule cette route
 * (via `patchCampaign status:'closed'`) le fait.
 *
 * Corps {dismissOpen, reason?, sendMail?} : si `dismissOpen`, les candidatures
 * ouvertes sont classées sans suite (récapitulées AVANT par GET
 * /open-candidatures, confirmation humaine explicite — jamais silencieux).
 * Raisons de clôture : `campagne_cloturee` ou `poste_pourvu` (clôture après GO).
 * Les gris en cours d'envoi sont sautés et signalés dans le résumé.
 */
import { NextResponse, after } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import { purgeCampaignSourcing } from '@/lib/sourcing/server/maintenance';
import {
  closeWithDismissals,
  type BatchDismissalSummary,
} from '@/lib/candidatures/dismissal-batch';
import { getCampaign, patchCampaign } from '@/lib/db/repos/campaigns';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RequestSchema = z.object({
  dismissOpen: z.boolean(),
  reason: z.enum(['campagne_cloturee', 'poste_pourvu']).optional(),
  sendMail: z.boolean().optional(),
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
    const existing = await getCampaign(id);
    if (!existing) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const updated = await patchCampaign(id, { status: 'closed' });
    if (!updated) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    let summary: BatchDismissalSummary | null = null;
    // Au-delà de 20 dossiers, le lot part sur le rail : la réponse le DIT
    // (`dismissalQueued`) plutôt que de rendre un résumé qui n'existe pas encore.
    let dismissalQueued: { total: number } | null = null;
    if (parsed.dismissOpen) {
      const user = await getApiUser();
      const outcome = await closeWithDismissals(id, {
        reason: parsed.reason ?? 'campagne_cloturee',
        sendMail: parsed.sendMail ?? false,
        dismissedByUser: user
          ? { userId: user.id, email: user.email ?? null }
          : null,
        actor: 'user',
      });
      if (outcome.kind === 'done') summary = outcome.summary;
      else dismissalQueued = { total: outcome.total };
    }

    // Sourcing : les profils trouvés pour cette campagne ne lui survivent pas
    // (spec sourcing §12.1). Après la réponse, fail-soft ; le rail de drain
    // rattrape une purge manquée.
    after(() => purgeCampaignSourcing(id, 'closure'));

    return NextResponse.json({ campaign: updated, summary, dismissalQueued });
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
