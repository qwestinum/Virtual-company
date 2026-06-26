/**
 * /api/validations/[id] — PATCH ciblé d'une validation suspendue (HITL).
 * Spec : docs/specs/hitl-validation-suspendue.md
 *
 * P4 : « Valider la décision » → confirmed = true (déverrouille la revue).
 * (L'envoi réel et le Switcher passeront par des routes dédiées en P5/P6.)
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser } from '@/lib/auth/require-api-user';
import {
  patchPendingValidation,
  type PendingValidationPatch,
} from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { HitlDecisionSchema } from '@/types/hitl';

export const runtime = 'nodejs';

// NB : l'identité du valideur n'est VOLONTAIREMENT pas dans ce schéma. Elle est
// injectée côté serveur depuis la session (getApiUser) — jamais lue du payload
// client (falsifiable). Lot 1 : capture « système vs humain » sur la confirmation.
const PatchSchema = z.object({
  confirmed: z.boolean().optional(),
  // P6 — Switcher : flip de la décision + régénération du brouillon.
  decision: HitlDecisionSchema.optional(),
  mailDraftArtifactId: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
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
  // Capture « qui a confirmé » UNIQUEMENT à la confirmation humaine. L'identité
  // vient de la session serveur (jamais du payload). Sur le chemin auto (cron
  // IMAP) il n'y a pas de session → cette route n'est pas empruntée.
  const patch: PendingValidationPatch = { ...parsed };
  if (parsed.confirmed === true) {
    const user = await getApiUser();
    patch.decidedBy = 'user';
    patch.decidedByUser = user
      ? { userId: user.id, email: user.email ?? null }
      : null;
  }

  try {
    const updated = await patchPendingValidation(id, patch);
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
