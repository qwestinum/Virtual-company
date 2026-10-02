/**
 * GET /api/mailboxes/activity — ce que chaque boîte a VU, lu dans le journal.
 *
 * « Plus de SQL pour savoir si une boîte voit son courrier » (incident S2I,
 * 01/10/2026). Pour chaque boîte, sur les 7 derniers jours : mails lus par la
 * relève, candidatures créées, mails ignorés et le dernier motif. Aucun
 * cache : le journal est la seule source. Route SÉPARÉE de la liste : si
 * cette lecture tombe, la liste des boîtes reste affichée.
 */
import { NextResponse } from 'next/server';

import { listJournalEntriesByActionsSince } from '@/lib/db/repos/journal';
import { listMailboxes } from '@/lib/db/repos/mailboxes';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { IGNORED_MAIL_ACTION, mailboxActivity, type MailboxActivity } from '@/lib/imap/mail-ignored';

export const runtime = 'nodejs';

const ACTIVITY_WINDOW_DAYS = 7;

export async function GET(): Promise<NextResponse> {
  try {
    const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
    const [mailboxes, entries] = await Promise.all([
      listMailboxes(),
      listJournalEntriesByActionsSince(['imap_cv_analyzed', IGNORED_MAIL_ACTION], since),
    ]);
    const rows = entries.map((e) => ({ action: e.action, created_at: e.createdAt, payload: e.payload }));
    const activity: Record<string, MailboxActivity> = {};
    for (const mb of mailboxes) activity[mb.id] = mailboxActivity(mb.id, rows);
    return NextResponse.json({ windowDays: ACTIVITY_WINDOW_DAYS, activity });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: 'activity_failed' }, { status: 500 });
  }
}
