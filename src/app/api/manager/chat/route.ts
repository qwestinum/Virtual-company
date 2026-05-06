import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  ManagerError,
  runManagerTurn,
  type ConversationTurn,
} from '@/lib/agents/manager';
import { AIProviderError } from '@/lib/ai/errors';
import { FDPInProgressSchema } from '@/types/field-collection';

export const runtime = 'nodejs';

const TurnSchema = z.object({
  role: z.enum(['user', 'manager']),
  content: z.string().min(1),
});

const RequestSchema = z.object({
  messages: z.array(TurnSchema).min(1).max(40),
  fdp: FDPInProgressSchema.nullable().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  let parsedBody: z.infer<typeof RequestSchema>;
  try {
    const json = await request.json();
    parsedBody = RequestSchema.parse(json);
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
    const result = await runManagerTurn({
      history: parsedBody.messages as ConversationTurn[],
      fdp: parsedBody.fdp ?? null,
    });

    return NextResponse.json({
      classification: result.classification,
      response: result.response,
      campaignId: result.campaignId,
      preSearchHits: result.preSearchHits,
      metrics: result.metrics,
    });
  } catch (err) {
    if (err instanceof ManagerError) {
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
