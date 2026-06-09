/**
 * /api/donneurs-ordre/[id] — PATCH (édition des champs et/ou archivage soft).
 * `archived: true|false` (dés)archive ; les autres champs éditent l'entité.
 * Pas de DELETE dur : on conserve l'entité pour l'historique/audit.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  archiveDonneurOrdre,
  patchDonneurOrdre,
} from '@/lib/db/repos/donneurs-ordre';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { DonneurOrdrePatchSchema } from '@/types/organisation';

export const runtime = 'nodejs';

const PatchSchema = DonneurOrdrePatchSchema.extend({
  archived: z.boolean().optional(),
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
    let result = null;
    if (parsed.archived !== undefined) {
      result = await archiveDonneurOrdre(id, parsed.archived);
    }
    const hasFieldEdits =
      parsed.firstName !== undefined ||
      parsed.lastName !== undefined ||
      parsed.email !== undefined ||
      parsed.role !== undefined;
    if (hasFieldEdits) {
      const patched = await patchDonneurOrdre(id, parsed);
      if (patched) result = patched;
    }
    if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ donneurOrdre: result });
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
