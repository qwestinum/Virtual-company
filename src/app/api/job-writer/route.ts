import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  JobWriterError,
  jobWriterAgent,
} from '@/lib/agents/contracts/job-writer';
import {
  renderJobAdMarkdown,
  suggestJobAdFileName,
} from '@/lib/agents/job-writer-render';
import { AIProviderError } from '@/lib/ai/errors';
import { FDPInProgressSchema } from '@/types/field-collection';
import { JobAdResultSchema } from '@/types/job-writer';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RequestSchema = z.object({
  fdp: FDPInProgressSchema,
  taskId: z.string().min(1).optional(),
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
    const output = await jobWriterAgent.execute({
      taskId,
      correlationId: taskId,
      agentId: jobWriterAgent.id,
      payload: { fdp: parsed.fdp },
      context: {
        campaignId: parsed.fdp.campaignId,
        priority: 'normal',
        requestedBy: 'agent.manager-rh',
      },
    });

    const ad = JobAdResultSchema.parse(output.data.ad);
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
