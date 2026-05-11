import { NextResponse } from 'next/server';
import { z } from 'zod';

import { patchTaskStatus } from '@/lib/db/repos/tasks-archived';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { CampaignStatusSchema } from '@/types/campaign-status';

export const runtime = 'nodejs';

const PatchSchema = z.object({ status: CampaignStatusSchema });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  let parsed: z.infer<typeof PatchSchema>;
  try {
    parsed = PatchSchema.parse(await request.json());
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
    const updated = await patchTaskStatus(id, parsed.status);
    if (!updated) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ task: updated });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
