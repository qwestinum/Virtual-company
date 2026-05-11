/**
 * /api/journal — append d'une entrée d'audit (Session 5, round 1).
 *
 * Spec §6.3. Pour l'instant on n'expose pas la lecture côté front
 * (debug Supabase Studio suffit). Si Supabase n'est pas configuré, on
 * répond 204 silencieux pour ne pas casser un parcours UI.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

const EntrySchema = z.object({
  action: z.string().min(1),
  campaignId: z.string().min(1).nullable().optional(),
  actor: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  let parsed: z.infer<typeof EntrySchema>;
  try {
    parsed = EntrySchema.parse(await request.json());
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
    await appendJournalEntry(parsed);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
