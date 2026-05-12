/**
 * POST /api/mailboxes/[id]/test — teste la connexion IMAP avec
 * les credentials stockés (déchiffrés) sans rien modifier.
 *
 * Sert au bouton « Tester » dans le formulaire settings après
 * création ou édit. Si on veut tester AVANT création, il y a
 * /api/mailboxes/test-credentials (ci-dessous, sans id).
 */
import { NextResponse } from 'next/server';

import { decryptCredential, MailboxCryptoError } from '@/lib/crypto/mailbox-credentials';
import { getMailboxWithSecrets } from '@/lib/db/repos/mailboxes';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { testConnection } from '@/lib/imap/client';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  let row;
  try {
    row = await getMailboxWithSecrets(id);
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
        error: err instanceof MailboxCryptoError ? err.code : 'decryption_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  const result = await testConnection({
    host: row.imap_host,
    port: row.imap_port,
    secure: row.imap_ssl,
    user: row.user_email,
    password,
  });
  return NextResponse.json(result);
}
