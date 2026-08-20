/**
 * PATCH /api/recruiters/[id] — édition d'un recruteur (ADMIN uniquement) :
 * nom affiché, lien Cal.com, rôle, désactivation douce. Jamais de DELETE
 * (un recruteur parti reste référencé par ses actions passées).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminApiUser } from '@/lib/auth/require-api-user';
import { patchRecruiter } from '@/lib/db/repos/recruiters';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { syncRecruiterResourceFromProfile } from '@/lib/scheduling-host/recruiter-resource';
import { RecruiterRoleSchema } from '@/types/recruiter';

export const runtime = 'nodejs';

const PatchSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  // '' côté UI = retirer le lien → null (repli agenda global).
  calcomLink: z.string().url().max(2048).nullable().optional(),
  role: RecruiterRoleSchema.optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const denied = await requireAdminApiUser();
  if (denied) return denied;
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
    const recruiter = await patchRecruiter(id, parsed);
    if (!recruiter) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    // La désactivation douce du référentiel se propage à l'agenda : la
    // ressource cesse d'offrir des créneaux (les rendez-vous déjà pris, eux,
    // restent — ils appartiennent au candidat autant qu'au recruteur). Le nom
    // affiché suit aussi : c'est lui que voit le candidat.
    if (parsed.isActive !== undefined || parsed.displayName !== undefined) {
      await syncRecruiterResourceFromProfile(recruiter).catch((err) =>
        console.error('[recruiters] synchro de la ressource KO', err),
      );
    }
    return NextResponse.json({ recruiter });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
