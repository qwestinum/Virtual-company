/**
 * /api/campaigns/[id] — PATCH ciblé (Session 5, round 1).
 *
 * Sert aux mises à jour partielles fréquentes :
 *   - changement de statut (paused / closed / recompute)
 *   - ajout d'un canal publié
 *   - marquage sources confirmées
 *
 * Pour les changements lourds (FDP, scoringSheet), passer par PUT
 * /api/campaigns avec le snapshot complet.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { patchCampaign } from '@/lib/db/repos/campaigns';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { CampaignStatusSchema } from '@/types/campaign-status';
import { PublicationChannelSchema } from '@/types/publication-channel';

export const runtime = 'nodejs';

const PatchSchema = z.object({
  status: CampaignStatusSchema.optional(),
  publishedChannels: z.array(PublicationChannelSchema).optional(),
  sourcesConfirmed: z.boolean().optional(),
  threshold: z.number().int().min(0).max(100).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  let parsed: z.infer<typeof PatchSchema>;
  try {
    parsed = PatchSchema.parse(await request.json());
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
    const updated = await patchCampaign(id, parsed);
    if (!updated) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ campaign: updated });
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
