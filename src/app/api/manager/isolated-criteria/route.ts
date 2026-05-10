import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  IsolatedManagerError,
  runIsolatedCriteriaTurn,
  type IsolatedTurnInput,
} from '@/lib/agents/manager-isolated';
import { AIProviderError } from '@/lib/ai/errors';
import { IsolatedCriteriaInProgressSchema } from '@/types/isolated-criteria';

export const runtime = 'nodejs';
export const maxDuration = 60;

const TurnSchema = z.object({
  role: z.enum(['user', 'manager']),
  content: z.string().min(1),
});

const RequestSchema = z.object({
  messages: z.array(TurnSchema).min(1).max(40),
  criteria: IsolatedCriteriaInProgressSchema,
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

  try {
    const result = await runIsolatedCriteriaTurn({
      history: parsed.messages,
      criteria: parsed.criteria,
    } as IsolatedTurnInput);
    return NextResponse.json({
      response: result.response,
      pendingSwitch: result.pendingSwitch,
      metrics: result.metrics,
    });
  } catch (err) {
    if (err instanceof IsolatedManagerError) {
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
