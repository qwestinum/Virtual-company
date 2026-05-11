/**
 * /api/tasks — list + upsert pour les sollicitations TASK-XXXX
 * (Session 5, round 1).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { listTasks, upsertTask } from '@/lib/db/repos/tasks-archived';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { CampaignStatusSchema } from '@/types/campaign-status';
import { IsolatedCriteriaInProgressSchema } from '@/types/isolated-criteria';

export const runtime = 'nodejs';

const TaskSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: CampaignStatusSchema,
  criteria: IsolatedCriteriaInProgressSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

function notConfigured(): NextResponse {
  return NextResponse.json(
    { error: 'supabase_not_configured' },
    { status: 503 },
  );
}

export async function GET(): Promise<NextResponse> {
  try {
    const tasks = await listTasks();
    return NextResponse.json({ tasks });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  let parsed: z.infer<typeof TaskSchema>;
  try {
    parsed = TaskSchema.parse(await request.json());
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
    const saved = await upsertTask(parsed);
    return NextResponse.json({ task: saved });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
