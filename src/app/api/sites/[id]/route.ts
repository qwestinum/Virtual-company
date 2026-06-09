/**
 * /api/sites/[id] — PATCH (édition des champs et/ou archivage soft).
 * `archived: true|false` (dés)archive ; les autres champs éditent le site.
 * Pas de DELETE dur : on conserve le site pour l'historique/audit.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { archiveSite, patchSite } from '@/lib/db/repos/sites';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { SitePatchSchema } from '@/types/organisation';

export const runtime = 'nodejs';

const PatchSchema = SitePatchSchema.extend({ archived: z.boolean().optional() });

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
      result = await archiveSite(id, parsed.archived);
    }
    const hasFieldEdits =
      parsed.name !== undefined ||
      parsed.type !== undefined ||
      parsed.city !== undefined ||
      parsed.postalCode !== undefined;
    if (hasFieldEdits) {
      const patched = await patchSite(id, parsed);
      if (patched) result = patched;
    }
    if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ site: result });
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
