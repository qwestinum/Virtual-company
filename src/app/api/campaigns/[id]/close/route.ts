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
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import {
  dismissOpenCandidatures,
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
    if (parsed.dismissOpen) {
      const user = await getApiUser();
      summary = await dismissOpenCandidatures(id, {
        reason: parsed.reason ?? 'campagne_cloturee',
        sendMail: parsed.sendMail ?? false,
        dismissedByUser: user
          ? { userId: user.id, email: user.email ?? null }
          : null,
        actor: 'user',
      });
      await appendJournalEntry({
        action: 'campaign_closure_dismissals',
        actor: 'user',
        campaignId: id,
        payload: { reason: parsed.reason ?? 'campagne_cloturee', ...summary },
      });
    }

    return NextResponse.json({ campaign: updated, summary });
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
