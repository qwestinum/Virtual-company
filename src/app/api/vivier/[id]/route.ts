/**
 * /api/vivier/[id] — détail (GET), édition des tags (PATCH), suppression
 * cascade (DELETE) d'un dossier vivier.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getLatestApplicationByEmail } from '@/lib/db/repos/candidate-analyses';
import { getCampaign } from '@/lib/db/repos/campaigns';
import {
  getVivierCandidate,
  getVivierEntities,
  updateVivierTags,
} from '@/lib/db/repos/vivier';
import { listProposalsForCandidate } from '@/lib/db/repos/vivier-preselection';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { deleteVivierCandidate } from '@/lib/vivier/candidates';
import type { ActiveCampaign } from '@/stores/campaigns-store';

export const runtime = 'nodejs';

/** Intitulé de poste d'une campagne (FDP), repli sur le nom. */
function jobTitleOf(c: ActiveCampaign): string {
  const v = c.fdp?.fields?.job_title?.value;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : c.name;
}

/**
 * Dernier poste auquel le candidat a postulé (dérivé de candidate_analyses →
 * campagne). null s'il n'a jamais postulé. Best-effort (n'échoue pas le détail).
 */
async function lastApplicationFor(
  email: string | null,
): Promise<{ jobTitle: string; at: string } | null> {
  if (!email) return null;
  try {
    const latest = await getLatestApplicationByEmail(email);
    if (!latest?.campaignId) return null;
    const campaign = await getCampaign(latest.campaignId);
    if (!campaign) return null;
    return { jobTitle: jobTitleOf(campaign), at: latest.receivedAt };
  } catch {
    return null;
  }
}

function notConfigured(): NextResponse {
  return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
}

function dbError(err: unknown): NextResponse {
  if (err instanceof SupabaseNotConfiguredError) return notConfigured();
  return NextResponse.json(
    { error: 'db_error', message: (err as Error).message },
    { status: 500 },
  );
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const candidate = await getVivierCandidate(id);
    if (!candidate) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    const [entities, history, lastApplication] = await Promise.all([
      getVivierEntities(id),
      // Historique de sollicitation (vue détaillée §5.2) — toutes campagnes.
      listProposalsForCandidate(id),
      // Dernier poste auquel le candidat a postulé (dérivé, §5.2 « titre/fonction »).
      lastApplicationFor(candidate.email),
    ]);
    return NextResponse.json({ candidate, entities, history, lastApplication });
  } catch (err) {
    return dbError(err);
  }
}

const PatchSchema = z.object({
  tags: z.array(z.string().trim().min(1)).max(50),
});

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  let parsed: z.infer<typeof PatchSchema>;
  try {
    parsed = PatchSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Requête invalide.',
      },
      { status: 400 },
    );
  }
  // Déduplication des tags (insensible à la casse, ordre préservé).
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of parsed.tags) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(t);
  }
  try {
    const candidate = await updateVivierTags(id, tags);
    if (!candidate) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ candidate });
  } catch (err) {
    return dbError(err);
  }
}

const DeleteSchema = z.object({
  reason: z.enum(['candidate_request', 'internal_decision']),
});

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  // Le motif est obligatoire (trace RGPD). Body JSON attendu.
  let parsed: z.infer<typeof DeleteSchema>;
  try {
    parsed = DeleteSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message:
          err instanceof Error
            ? err.message
            : 'Motif de suppression requis (candidate_request | internal_decision).',
      },
      { status: 400 },
    );
  }
  try {
    const { deleted } = await deleteVivierCandidate(id, { reason: parsed.reason });
    if (!deleted) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return dbError(err);
  }
}
