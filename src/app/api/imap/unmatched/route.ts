/**
 * GET /api/imap/unmatched — liste les CV reçus SANS campagne reconnue (C11).
 *
 * Par défaut les `pending` (à rejouer via POST /api/imap/unmatched/[id]/replay
 * ou à écarter) ; `?status=replayed|dismissed` pour l'historique. Session
 * requise (deny-by-default du proxy). Pas d'UI dédiée en v1 (backlog) — cette
 * route est le point d'accès du rejeu.
 */
import { NextResponse } from 'next/server';

import { requireAdminApiUser } from '@/lib/auth/require-api-user';

import {
  listUnmatchedCvs,
  type UnmatchedCvStatus,
} from '@/lib/db/repos/imap-unmatched-cvs';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

const STATUSES: UnmatchedCvStatus[] = ['pending', 'replayed', 'dismissed'];

export async function GET(request: Request): Promise<NextResponse> {
  // Diagnostic technique — ADMIN uniquement (401 sans session, 403 member).
  const denied = await requireAdminApiUser();
  if (denied) return denied;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status') ?? 'pending';
  if (!STATUSES.includes(statusParam as UnmatchedCvStatus)) {
    return NextResponse.json(
      { error: 'invalid_status', message: `status ∈ ${STATUSES.join('|')}` },
      { status: 400 },
    );
  }
  try {
    const items = await listUnmatchedCvs(statusParam as UnmatchedCvStatus);
    return NextResponse.json({ items });
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
