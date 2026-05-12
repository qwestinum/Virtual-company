/**
 * POST /api/imap/poll-now — force un cycle de polling tout de suite,
 * sans attendre les 30s du scheduler (Session 5 round 5).
 *
 * Utilité diagnostic : tu envoies un mail à la boîte surveillée,
 * tu hit ce endpoint, tu vois le résultat dans la réponse. Pas besoin
 * de chronométrer.
 */
import { NextResponse } from 'next/server';

import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { pollAllMailboxes } from '@/lib/imap/poller';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(): Promise<NextResponse> {
  try {
    const outcomes = await pollAllMailboxes();
    return NextResponse.json({
      ok: true,
      polledAt: new Date().toISOString(),
      mailboxesPolled: outcomes.length,
      outcomes,
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured' },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'poll_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}
