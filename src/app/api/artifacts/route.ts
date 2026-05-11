/**
 * /api/artifacts — list (par owner) + create (Session 5 round 2).
 *
 * GET ?campaign_id=CAMP-XXXX  → list par campagne
 * GET ?task_id=TASK-XXXX      → list par tâche
 * POST                        → crée un artefact (Supabase Storage + meta)
 *
 * Le POST orchestre :
 *   1. uploadArtifact dans le bucket Storage (best effort)
 *   2. insertArtifactMeta dans Supabase
 *
 * Mode dégradé : si l'upload Storage échoue (réseau, quota, conf
 * invalide), on continue avec storage_* = null. La trace metadata
 * reste, l'app continue à fonctionner — on ne casse pas un parcours.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  insertArtifactMeta,
  listArtifactsByCampaign,
  listArtifactsByTask,
} from '@/lib/db/repos/artifacts';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { uploadArtifact } from '@/lib/storage/blob';

export const runtime = 'nodejs';

const CreateSchema = z
  .object({
    id: z.string().min(1),
    campaignId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    kind: z.enum(['fdp', 'job_ad', 'cv_report', 'scoring_sheet', 'other']),
    name: z.string().min(1),
    content: z.string().min(1),
    mime: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (val) => Boolean(val.campaignId) !== Boolean(val.taskId),
    { message: 'Provide exactly one of campaignId or taskId.' },
  );

function notConfigured(): NextResponse {
  return NextResponse.json(
    { error: 'supabase_not_configured' },
    { status: 503 },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const campaignId = url.searchParams.get('campaign_id');
  const taskId = url.searchParams.get('task_id');
  if ((campaignId && taskId) || (!campaignId && !taskId)) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: 'Provide exactly one of campaign_id or task_id.',
      },
      { status: 400 },
    );
  }

  try {
    const items = campaignId
      ? await listArtifactsByCampaign(campaignId)
      : await listArtifactsByTask(taskId!);
    return NextResponse.json({ artifacts: items });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let parsed: z.infer<typeof CreateSchema>;
  try {
    parsed = CreateSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Invalid request body.',
      },
      { status: 400 },
    );
  }

  // 1. Upload dans le bucket Storage (best effort).
  let storageBucket: string | null = null;
  let storagePath: string | null = null;
  let publicUrl: string | null = null;
  try {
    const owner = parsed.campaignId
      ? { kind: 'campaign' as const, id: parsed.campaignId }
      : { kind: 'task' as const, id: parsed.taskId! };
    const result = await uploadArtifact({
      owner,
      name: parsed.name,
      content: parsed.content,
      mimeType: parsed.mime ?? 'text/markdown',
    });
    storageBucket = result.bucket;
    storagePath = result.path;
    publicUrl = result.publicUrl;
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      // Supabase pas configuré → on ne peut même pas écrire la
      // metadata, autant retourner 503 directement.
      return notConfigured();
    }
    // Autre erreur (quota, MIME refusé par le bucket, etc.) :
    // on log côté serveur et on continue avec storage_* = null.
    // Le DRH récupère au pire le blob téléchargeable côté client.
    console.error('[artifacts] Storage upload failed', err);
  }

  // 2. Insertion de la metadata.
  try {
    const meta = await insertArtifactMeta({
      id: parsed.id,
      campaignId: parsed.campaignId ?? null,
      taskId: parsed.taskId ?? null,
      kind: parsed.kind,
      name: parsed.name,
      mime: parsed.mime ?? 'text/markdown',
      storageBucket,
      storagePath,
      publicUrl,
      metadata: parsed.metadata,
    });
    return NextResponse.json({ artifact: meta });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
