/**
 * /api/campaigns — list + upsert (Session 5, round 1).
 *
 * GET : retourne la liste des campagnes archivées (ordre `created_at`
 *       ascendant — c'est l'ordre affiché par le sélecteur).
 * PUT : upsert d'une campagne complète. Le client envoie le snapshot
 *       complet (avec fdp + scoringSheet + channels + sourcesConfirmed
 *       + status + timestamps). Idempotent.
 *
 * Mode dégradé : si Supabase n'est pas configuré, on répond
 * `503 supabase_not_configured`. Le client interprète ça comme un
 * signal pour rester volatile, sans crash.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { reconcileLifecycle } from '@/lib/campaign/lifecycle';
import { listCampaigns, upsertCampaign } from '@/lib/db/repos/campaigns';
import { archiveFdp } from '@/lib/db/repos/fdps-archived';
import { archiveScoringSheet } from '@/lib/db/repos/scoring-sheets';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { CampaignStatusSchema } from '@/types/campaign-status';
import { CVSourceSchema } from '@/types/cv-source';
import { FDPInProgressSchema } from '@/types/field-collection';
import { PublicationChannelSchema } from '@/types/publication-channel';
import { ScoringSheetSchema } from '@/types/scoring';

export const runtime = 'nodejs';

const CampaignSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: CampaignStatusSchema,
  fdp: FDPInProgressSchema,
  scoringSheet: ScoringSheetSchema.nullable(),
  publishedChannels: z.array(PublicationChannelSchema),
  sourcesConfirmed: z.boolean(),
  // Optionnels pour rester rétro-compat avec un client encore en cours
  // de déploiement qui n'enverrait pas le champ. Défauts côté repo.
  threshold: z.number().int().min(0).max(100).optional(),
  sources: z.array(CVSourceSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function notConfigured(): NextResponse {
  return NextResponse.json(
    { error: 'supabase_not_configured' },
    { status: 503 },
  );
}

export async function GET(): Promise<NextResponse> {
  try {
    const campaigns = await listCampaigns();
    return NextResponse.json({ campaigns });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  let parsed: z.infer<typeof CampaignSchema>;
  try {
    parsed = CampaignSchema.parse(await request.json());
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
    const sources = parsed.sources ?? ['manual'];
    const saved = await upsertCampaign({
      ...parsed,
      threshold: parsed.threshold ?? 75,
      sources,
      // lifecycle non persisté (campaignToRow le drop) — fourni pour
      // satisfaire le type ActiveCampaign ; re-dérivé au chargement.
      lifecycle: reconcileLifecycle(null, {
        fdpValidated: parsed.fdp.isValidated,
        scoringValidated: parsed.scoringSheet?.isValidated === true,
        scoringStarted: parsed.scoringSheet != null,
        sourcesConfirmed: parsed.sourcesConfirmed,
        hasPublishedChannel: (parsed.publishedChannels ?? []).length > 0,
      }),
    });
    // À la première validation de la FDP, on alimente l'index de
    // pré-recherche. Idempotent côté repo (upsert).
    if (saved.fdp.isValidated) {
      await archiveFdp(saved.id, saved.fdp);
    }
    // Historisation des fiches de scoring validées (audit, hors round 1
    // côté lecture mais on écrit dès maintenant pour ne pas perdre la
    // trace).
    if (saved.scoringSheet?.isValidated) {
      await archiveScoringSheet(saved.scoringSheet);
    }
    return NextResponse.json({ campaign: saved });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
