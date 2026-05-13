/**
 * GET /api/campaigns/[id]/mailboxes — liste les mailboxes associées
 * à une campagne (Session 6 v3).
 *
 * Renvoie un tableau d'ids. Le front croise ensuite avec `/api/mailboxes`
 * pour afficher les noms. En mode dégradé (Supabase absent), on
 * renvoie une liste vide pour ne pas casser l'UI.
 */
import { NextResponse } from 'next/server';

import { listMailboxesForCampaign } from '@/lib/db/repos/mailboxes';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { error: 'invalid_request', message: 'campaign id required' },
      { status: 400 },
    );
  }
  try {
    const mailboxIds = await listMailboxesForCampaign(id);
    return NextResponse.json({ mailboxIds });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ mailboxIds: [] });
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
