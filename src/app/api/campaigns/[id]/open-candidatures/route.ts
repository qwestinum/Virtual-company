/**
 * /api/campaigns/[id]/open-candidatures — candidatures OUVERTES d'une campagne.
 *
 * GET  : récapitulatif pour les dialogs (clôture / GO) — compteurs par étape
 *        ouverte + `hasRetenu` (pré-coche « poste pourvu »).
 * POST : classement sans suite EN MASSE (flux GO « poste pourvu » sans
 *        clôturer la campagne). Corps {reason, sendMail}. La clôture passe
 *        par POST /api/campaigns/[id]/close (qui réutilise le même cœur).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import {
  dismissOpenCandidatures,
  recapOpenCandidatures,
} from '@/lib/candidatures/dismissal-batch';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { DismissalReasonSchema } from '@/types/dismissal';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const campaign = await getCampaign(id);
    if (!campaign) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json(await recapOpenCandidatures(id));
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

const BatchSchema = z.object({
  reason: DismissalReasonSchema,
  sendMail: z.boolean(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  let parsed: z.infer<typeof BatchSchema>;
  try {
    parsed = BatchSchema.parse(await request.json());
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
    const campaign = await getCampaign(id);
    if (!campaign) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const user = await getApiUser();
    const summary = await dismissOpenCandidatures(id, {
      reason: parsed.reason,
      sendMail: parsed.sendMail,
      dismissedByUser: user
        ? { userId: user.id, email: user.email ?? null }
        : null,
      actor: 'user',
    });
    return NextResponse.json({ summary });
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
