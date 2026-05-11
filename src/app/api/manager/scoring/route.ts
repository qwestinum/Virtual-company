import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  runScoringProposal,
  ScoringProposalError,
} from '@/lib/agents/server/scoring-execute';
import { AIProviderError } from '@/lib/ai/errors';
import { FDPInProgressSchema } from '@/types/field-collection';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RequestSchema = z.object({
  fdp: FDPInProgressSchema,
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
    const output = await runScoringProposal(parsed.fdp);
    return NextResponse.json({
      criteria: output.criteria,
      metrics: output.metrics,
    });
  } catch (err) {
    if (err instanceof ScoringProposalError) {
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
