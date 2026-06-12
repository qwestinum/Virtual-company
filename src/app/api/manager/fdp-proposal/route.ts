import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  runFdpProposal,
  FdpProposalError,
} from '@/lib/agents/server/fdp-proposal-execute';
import { AIProviderError } from '@/lib/ai/errors';
import { FieldKeySchema } from '@/types/field-collection';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RequestSchema = z.object({
  jobTitle: z.string().min(1),
  /** Champs déjà renseignés (cohérence) — optionnel. */
  fields: z.partialRecord(FieldKeySchema, z.unknown()).optional(),
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
    const output = await runFdpProposal({
      jobTitle: parsed.jobTitle,
      known: parsed.fields,
    });
    return NextResponse.json({ fields: output.fields, metrics: output.metrics });
  } catch (err) {
    if (err instanceof FdpProposalError) {
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
