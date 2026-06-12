import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  renderJobAdMarkdown,
  suggestJobAdFileName,
  withVivierRgpdMention,
} from '@/lib/agents/job-writer-render';
import {
  JobWriterError,
  executeJobWriter,
} from '@/lib/agents/server/job-writer-execute';
import { AIProviderError } from '@/lib/ai/errors';
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { getSenderEmail } from '@/lib/email/addresses';
import { FDPInProgressSchema } from '@/types/field-collection';
import { JobAdResultSchema } from '@/types/job-writer';
import { PublicationChannelSchema } from '@/types/publication-channel';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RequestSchema = z.object({
  fdp: FDPInProgressSchema,
  taskId: z.string().min(1).optional(),
  /**
   * Réseau de publication ciblé. Influence le ton/format de l'annonce
   * via buildJobAdSystemPrompt. Par défaut (omis), l'annonce est
   * produite en mode `generic` (multi-réseaux).
   */
  channel: PublicationChannelSchema.optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  let parsed;
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

  const taskId = parsed.taskId ?? `task_${Date.now().toString(36)}`;

  try {
    const output = await executeJobWriter({
      taskId,
      correlationId: taskId,
      agentId: 'agent.job-writer',
      payload: { fdp: parsed.fdp, channel: parsed.channel },
      context: {
        campaignId: parsed.fdp.campaignId,
        priority: 'normal',
        requestedBy: 'agent.manager-rh',
      },
    });

    const parsedAd = JobAdResultSchema.parse(output.data.ad);
    // Mention RGPD vivier (§7) apposée déterministe — contact = intake/expéditeur.
    const settings = await getAppSettings();
    const contact = settings?.intakeEmail || (await getSenderEmail()) || '';
    const ad = withVivierRgpdMention(parsedAd, contact);
    const markdown = renderJobAdMarkdown(ad);
    const fileName = suggestJobAdFileName(ad.title);

    return NextResponse.json({
      ad,
      markdown,
      fileName,
      metrics: output.metrics,
    });
  } catch (err) {
    if (err instanceof JobWriterError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 502 },
      );
    }
    if (err instanceof AIProviderError) {
      const status = err.code === 'config_missing' ? 500 : 502;
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status },
      );
    }
    return NextResponse.json(
      {
        error: 'unexpected_error',
        message: err instanceof Error ? err.message : 'Unexpected error.',
      },
      { status: 500 },
    );
  }
}
