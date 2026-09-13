/**
 * POST /api/sourcing/campaigns/[id]/query — rédige la requête depuis la fiche.
 * N'appelle PAS le moteur de profils et n'écrit rien : le recruteur relit,
 * corrige, puis lance (route `searches`).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { campaignToQueryFiche } from '@/lib/sourcing/fiche';
import { guardSourcingCampaign } from '@/lib/sourcing/server/route-guard';
import { generateSourcingQuery } from '@/lib/sourcing/server/generate-query';

export const runtime = 'nodejs';

const BodySchema = z.object({ language: z.enum(['fr', 'en']).default('fr') });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardSourcingCampaign(id);
  if (!guard.ok) return guard.response;

  const body = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: 'invalid_request', message: body.error.message }, { status: 400 });
  }

  const generated = await generateSourcingQuery(campaignToQueryFiche(guard.value.campaign), body.data.language);
  return NextResponse.json({ generated }, { headers: { 'Cache-Control': 'no-store' } });
}
