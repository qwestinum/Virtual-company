/**
 * /api/validations/[id] — PATCH ciblé d'une validation suspendue (HITL).
 * Spec : docs/specs/hitl-validation-suspendue.md
 *
 * P4 : « Valider la décision » → confirmed = true (déverrouille la revue).
 * (L'envoi réel et le Switcher passeront par des routes dédiées en P5/P6.)
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { patchPendingValidation } from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

const PatchSchema = z.object({
  confirmed: z.boolean().optional(),
});

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
    const updated = await patchPendingValidation(id, parsed);
    if (!updated) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ validation: updated });
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
