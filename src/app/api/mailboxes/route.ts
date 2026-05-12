/**
 * /api/mailboxes — list + create (Session 5 round 5).
 *
 * Le password en clair arrive dans le POST, est chiffré côté serveur
 * via MAILBOX_ENCRYPTION_KEY, puis stocké. Jamais retourné dans le
 * GET (cf. MailboxPublic — strip encrypted_password).
 *
 * Au premier hit, on lance lazily le scheduler IMAP. Ainsi une
 * instance qui ne configure jamais de mailbox ne paie aucun coût
 * I/O.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { encryptCredential, MailboxCryptoError } from '@/lib/crypto/mailbox-credentials';
import { insertMailbox, listMailboxes } from '@/lib/db/repos/mailboxes';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { ensureSchedulerStarted } from '@/lib/imap/scheduler';

export const runtime = 'nodejs';

const CreateSchema = z.object({
  label: z.string().min(1).max(120),
  imapHost: z.string().min(1).max(255),
  imapPort: z.number().int().min(1).max(65535),
  imapSsl: z.boolean(),
  userEmail: z.string().email(),
  password: z.string().min(1).max(512),
  isEnabled: z.boolean().optional(),
});

function notConfigured(): NextResponse {
  return NextResponse.json(
    { error: 'supabase_not_configured' },
    { status: 503 },
  );
}

function generateId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `mb_${globalThis.crypto.randomUUID()}`;
  }
  return `mb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function GET(): Promise<NextResponse> {
  try {
    const mailboxes = await listMailboxes();
    // Démarre le scheduler dès qu'on consulte la liste — typiquement
    // un GET au mount de /settings/mailboxes ou du picker dans le chat.
    ensureSchedulerStarted();
    return NextResponse.json({ mailboxes });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
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

  let encrypted: string;
  try {
    encrypted = encryptCredential(parsed.password);
  } catch (err) {
    if (err instanceof MailboxCryptoError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: 'crypto_error', message: (err as Error).message },
      { status: 500 },
    );
  }

  try {
    const created = await insertMailbox({
      id: generateId(),
      label: parsed.label,
      imapHost: parsed.imapHost,
      imapPort: parsed.imapPort,
      imapSsl: parsed.imapSsl,
      userEmail: parsed.userEmail,
      encryptedPassword: encrypted,
      isEnabled: parsed.isEnabled,
    });
    ensureSchedulerStarted();
    return NextResponse.json({ mailbox: created });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
