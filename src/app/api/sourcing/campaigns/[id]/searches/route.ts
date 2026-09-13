/**
 * POST /api/sourcing/campaigns/[id]/searches — lance UNE recherche (100 profils).
 *
 * La requête envoyée est celle que le recruteur a sous les yeux ; la requête
 * générée voyage avec elle pour mesurer l'écart (spec §17.3). Le coût de
 * l'appel est enregistré dans `sourcing_searches` pour l'administration et
 * n'apparaît PAS dans la réponse. Le bouton se désarme au clic côté écran.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { ExaError } from '@/lib/sourcing/server/exa';
import { guardSourcingCampaign } from '@/lib/sourcing/server/route-guard';
import { runSourcingSearch } from '@/lib/sourcing/server/run-search';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BodySchema = z.object({
  query: z.string().trim().min(3).max(400),
  queryGenerated: z.string().trim().max(400),
  queryMethod: z.enum(['llm', 'deterministic']),
  language: z.enum(['fr', 'en']),
});

const EXA_MESSAGES: Record<ExaError['kind'], { status: number; message: string }> = {
  unauthorized: { status: 502, message: 'Le service de recherche de profils refuse la connexion.' },
  rate_limited: { status: 429, message: 'Trop de recherches en peu de temps — réessayez dans une minute.' },
  unavailable: { status: 502, message: 'Le service de recherche de profils ne répond pas pour le moment.' },
  invalid_response: { status: 502, message: 'Le service de recherche de profils a renvoyé une réponse illisible.' },
};

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

  try {
    const result = await runSourcingSearch({
      campaignId: id,
      userId: guard.value.user.id,
      actorEmail: guard.value.user.email ?? null,
      ...body.data,
    });
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof ExaError) {
      const m = EXA_MESSAGES[err.kind];
      return NextResponse.json({ error: `exa_${err.kind}`, message: m.message }, { status: m.status });
    }
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: 'sourcing_search_failed', message: (err as Error).message }, { status: 500 });
  }
}
