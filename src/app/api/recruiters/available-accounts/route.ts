/**
 * GET /api/recruiters/available-accounts — comptes Supabase Auth pas encore
 * référencés comme recruteurs (ADMIN uniquement). Alimente le sélecteur
 * d'ajout : l'admin choisit un compte dans la liste au lieu de recopier un
 * UUID depuis le dashboard. Liste vide = tous les comptes sont référencés →
 * inviter d'abord le compte (runbook multi-utilisateur §3).
 */
import { NextResponse } from 'next/server';

import { requireAdminApiUser } from '@/lib/auth/require-api-user';
import { listAvailableAuthAccounts } from '@/lib/db/repos/recruiters';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const denied = await requireAdminApiUser();
  if (denied) return denied;
  try {
    return NextResponse.json({ accounts: await listAvailableAuthAccounts() });
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
