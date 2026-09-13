/**
 * POST /api/sourcing/campaigns/[id]/query — rédige la requête depuis la fiche.
 * N'appelle PAS le moteur de profils et n'écrit rien dans le module : le
 * recruteur relit, corrige, puis lance (route `searches`).
 *
 * Le coût de la génération est journalisé pour le suivi d'administration et
 * RETIRÉ de la réponse : l'écran du recruteur n'affiche aucun coût.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { campaignToQueryFiche } from '@/lib/sourcing/fiche';
import { guardSourcingCampaign } from '@/lib/sourcing/server/route-guard';
import { generateSourcingQuery } from '@/lib/sourcing/server/generate-query';
import type { PublicGeneratedQuery } from '@/types/sourcing';

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

  const { llmCostUsd, ...generated } = await generateSourcingQuery(
    campaignToQueryFiche(guard.value.campaign),
    body.data.language,
  );

  // Donnée d'exploitation — lue par le tableau de bord d'administration.
  await appendJournalEntry({
    action: 'sourcing_query_generated',
    campaignId: id,
    actor: guard.value.user.email ?? 'utilisateur',
    payload: { method: generated.method, language: generated.language, llmCostUsd, actorUserId: guard.value.user.id },
  }).catch(() => {});

  const response: PublicGeneratedQuery = generated;
  return NextResponse.json({ generated: response }, { headers: { 'Cache-Control': 'no-store' } });
}
