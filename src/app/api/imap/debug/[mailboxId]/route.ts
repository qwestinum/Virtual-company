/**
 * GET /api/imap/debug/[mailboxId] — dump les N derniers emails
 * (sujet, from, date, attachements) sans aucun filtrage.
 *
 * Outil de diagnostic exclusif : permet de comparer ce que le
 * poller VOIT vs ce que le DRH PENSE avoir envoyé. Si un mail
 * apparaît ici mais pas dans la liste IMAP standard, c'est probable
 * un problème de matching subject ou de last_uid_seen trop avancé.
 *
 * Query params :
 *   ?limit=20 (max 100)
 *   ?since=<uid> — dump à partir de cet UID (par défaut, les N
 *                  derniers en partant du plus récent)
 *   ?force=1 — bypass le last_uid_seen, scanne depuis UID 1
 */
import { NextResponse } from 'next/server';
import { simpleParser } from 'mailparser';

import { decryptCredential } from '@/lib/crypto/mailbox-credentials';
import { getMailboxWithSecrets } from '@/lib/db/repos/mailboxes';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { openConnection } from '@/lib/imap/client';

export const runtime = 'nodejs';
export const maxDuration = 60;

type DebugMessage = {
  uid: number | string;
  subject: string | null;
  from: string | null;
  date: string | null;
  attachments: Array<{ filename: string | null; mime: string | null; size: number }>;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ mailboxId: string }> },
): Promise<NextResponse> {
  const { mailboxId } = await context.params;
  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10), 1),
    100,
  );

  let row;
  try {
    row = await getMailboxWithSecrets(mailboxId);
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
  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let password: string;
  try {
    password = decryptCredential(row.encrypted_password);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'decryption_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  const client = await openConnection({
    host: row.imap_host,
    port: row.imap_port,
    secure: row.imap_ssl,
    user: row.user_email,
    password,
  });

  const messages: DebugMessage[] = [];

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const status = await client.status('INBOX', {
        messages: true,
        uidNext: true,
      });
      const uidNext = status.uidNext ?? 1;
      // On veut les LIMIT messages les plus RÉCENTS. Stratégie : on
      // fetch une fenêtre généreuse (`uidNext - limit*2:*`), on
      // accumule TOUS les messages dans cette fenêtre, puis on coupe
      // pour ne garder que les `limit` plus hauts en UID (les
      // serveurs IMAP retournent typiquement en ordre UID croissant ;
      // ne pas couper côté boucle sinon on récolte les + anciens).
      const fromUid = Math.max(uidNext - limit * 2 - 5, 1);
      const range = `${fromUid}:*`;
      const allInWindow: DebugMessage[] = [];

      for await (const message of client.fetch(
        range,
        { uid: true, envelope: true, source: true },
        { uid: true },
      )) {
        if (!message.source) continue;
        let parsed;
        try {
          parsed = await simpleParser(message.source);
        } catch (err) {
          allInWindow.push({
            uid: message.uid ?? '?',
            subject: `<parse_error: ${err instanceof Error ? err.message : 'unknown'}>`,
            from: null,
            date: null,
            attachments: [],
          });
          continue;
        }
        allInWindow.push({
          uid: message.uid ?? '?',
          subject: parsed.subject ?? null,
          from: parsed.from?.text ?? null,
          date: parsed.date?.toISOString() ?? null,
          attachments: (parsed.attachments ?? []).map((a) => ({
            filename: a.filename ?? null,
            mime: a.contentType ?? null,
            size: a.size ?? 0,
          })),
        });
      }

      // Trie par UID desc et prend les `limit` plus récents.
      allInWindow.sort((a, b) => {
        const ua = typeof a.uid === 'number' ? a.uid : 0;
        const ub = typeof b.uid === 'number' ? b.uid : 0;
        return ub - ua;
      });
      messages.push(...allInWindow.slice(0, limit));

      return NextResponse.json({
        mailboxId,
        host: row.imap_host,
        user: row.user_email,
        inboxStatus: {
          totalMessages: status.messages ?? 0,
          uidNext: status.uidNext ?? null,
          lastUidSeen: row.last_uid_seen,
        },
        scannedRange: range,
        windowTotal: allInWindow.length,
        returned: messages.length,
        messages,
      });
    } finally {
      lock.release();
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: 'fetch_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
}
