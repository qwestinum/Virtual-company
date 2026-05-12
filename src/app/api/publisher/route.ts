/**
 * /api/publisher — simulation de publication (Session 5 round 4).
 *
 * POST { campaignId, channel, jobAdName? } → genère une preuve, écrit
 * un artefact markdown dans Storage, retourne la preuve.
 *
 * La carte Publisher côté workspace est gérée par le caller (ManagerChat
 * via manager-flow) qui marque busy/idle autour de l'appel.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  renderPublicationProofMarkdown,
  simulatePublication,
} from '@/lib/agents/publisher-simulate';
import { insertArtifactMeta } from '@/lib/db/repos/artifacts';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { uploadArtifact } from '@/lib/storage/blob';
import { PublicationChannelSchema } from '@/types/publication-channel';

export const runtime = 'nodejs';

const RequestSchema = z.object({
  artifactId: z.string().min(1),
  campaignId: z.string().min(1),
  channel: PublicationChannelSchema,
});

export async function POST(request: Request): Promise<NextResponse> {
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

  const proof = simulatePublication(parsed.channel);
  const markdown = renderPublicationProofMarkdown(proof);
  const fileName = `preuve-publication-${parsed.channel}.md`;

  let publicUrl: string | null = null;
  let storagePath: string | null = null;
  let storageBucket: string | null = null;
  try {
    const upload = await uploadArtifact({
      owner: parsed.campaignId.startsWith('TASK-')
        ? { kind: 'task', id: parsed.campaignId }
        : { kind: 'campaign', id: parsed.campaignId },
      name: fileName,
      content: markdown,
    });
    storageBucket = upload.bucket;
    storagePath = upload.path;
    publicUrl = upload.publicUrl;
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[publisher] storage upload failed', err);
    }
  }

  try {
    await insertArtifactMeta({
      id: parsed.artifactId,
      campaignId: parsed.campaignId.startsWith('TASK-')
        ? null
        : parsed.campaignId,
      taskId: parsed.campaignId.startsWith('TASK-') ? parsed.campaignId : null,
      kind: 'other',
      name: fileName,
      mime: 'text/markdown',
      storageBucket,
      storagePath,
      publicUrl,
      metadata: {
        kind: 'publication_proof',
        channel: proof.channel,
        url: proof.url,
        postId: proof.postId,
        publishedAt: proof.publishedAt,
      },
    });
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[publisher] insertArtifactMeta failed', err);
    }
  }

  return NextResponse.json({ proof, fileName, publicUrl });
}
