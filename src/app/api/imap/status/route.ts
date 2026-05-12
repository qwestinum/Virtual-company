/**
 * GET /api/imap/status — diagnostic IMAP (Session 5 round 5).
 *
 * Retourne en une réponse :
 *   - le statut du scheduler (running, lastRun, intervalMs)
 *   - chaque mailbox avec son dernier poll, son erreur éventuelle,
 *     et la liste des campagnes qu'elle écoute
 *   - les 30 dernières entrées du journal liées à IMAP (préfixe
 *     « imap_ »)
 *
 * Sert à valider rapidement que la chaîne fonctionne sans avoir à
 * ouvrir 3 onglets Supabase.
 */
import { NextResponse } from 'next/server';

import { listJournalEntries } from '@/lib/db/repos/journal';
import {
  listCampaignsForMailbox,
  listMailboxes,
} from '@/lib/db/repos/mailboxes';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  ensureSchedulerStarted,
  getSchedulerStatus,
} from '@/lib/imap/scheduler';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  // Force le démarrage si pas encore lancé — utile pour diagnostiquer
  // une instance qui aurait crashé.
  ensureSchedulerStarted();
  const scheduler = getSchedulerStatus();

  try {
    const mailboxes = await listMailboxes();
    const enriched = await Promise.all(
      mailboxes.map(async (mb) => {
        const associatedCampaigns = await listCampaignsForMailbox(mb.id);
        return { ...mb, associatedCampaigns };
      }),
    );
    const recentJournal = await listJournalEntries({
      actionPrefix: 'imap_',
      limit: 30,
    });
    return NextResponse.json({
      scheduler,
      mailboxes: enriched,
      recentJournal,
    });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json(
        { error: 'supabase_not_configured', scheduler },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message, scheduler },
      { status: 500 },
    );
  }
}
