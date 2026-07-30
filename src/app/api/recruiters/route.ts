/**
 * /api/recruiters — référentiel des recruteurs. ADMIN UNIQUEMENT (gestion
 * des comptes de l'espace : liste, ajout, lien Cal.com, rôle, désactivation).
 *
 * L'AJOUT suppose que le compte Supabase Auth existe déjà (invitation depuis
 * le dashboard Supabase — les signups publics sont désactivés) : on référence
 * ici son auth.users.id. Procédure complète : docs/ops/multi-utilisateur.md.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminApiUser } from '@/lib/auth/require-api-user';
import { insertRecruiter, listRecruiters } from '@/lib/db/repos/recruiters';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { RecruiterRoleSchema } from '@/types/recruiter';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const denied = await requireAdminApiUser();
  if (denied) return denied;
  try {
    return NextResponse.json({ recruiters: await listRecruiters() });
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

const CreateSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(200),
  email: z.string().email(),
  calcomLink: z.string().url().max(2048).nullable().optional(),
  role: RecruiterRoleSchema.optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireAdminApiUser();
  if (denied) return denied;
  let parsed: z.infer<typeof CreateSchema>;
  try {
    parsed = CreateSchema.parse(await request.json());
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
    const recruiter = await insertRecruiter(parsed);
    return NextResponse.json({ recruiter }, { status: 201 });
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
