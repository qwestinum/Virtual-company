/**
 * /api/mailboxes/[id] — PATCH + DELETE (Session 5 round 5).
 *
 * PATCH : update partiel. Si `password` est dans le body (texte
 * clair), on le re-chiffre. Sinon on garde l'ancien.
 * DELETE : suppression complète (cascade sur campaign_mailboxes via
 * la FK ON DELETE CASCADE).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { encryptCredential, MailboxCryptoError } from '@/lib/crypto/mailbox-credentials';
import { deleteMailbox, patchMailbox } from '@/lib/db/repos/mailboxes';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

export const runtime = 'nodejs';

const PatchSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  imapHost: z.string().min(1).max(255).optional(),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapSsl: z.boolean().optional(),
  userEmail: z.string().email().optional(),
  password: z.string().min(1).max(512).optional(),
  isEnabled: z.boolean().optional(),
});

function notConfigured(): NextResponse {
  return NextResponse.json(
    { error: 'supabase_not_configured' },
    { status: 503 },
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  let parsed: z.infer<typeof PatchSchema>;
  try {
    parsed = PatchSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Invalid request body.',
      },
      { status: 400 },
    );
  }

  let encryptedPassword: string | undefined;
  if (parsed.password) {
    try {
      encryptedPassword = encryptCredential(parsed.password);
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
  }

  try {
    const updated = await patchMailbox(id, {
      label: parsed.label,
      imapHost: parsed.imapHost,
      imapPort: parsed.imapPort,
      imapSsl: parsed.imapSsl,
      userEmail: parsed.userEmail,
      encryptedPassword,
      isEnabled: parsed.isEnabled,
    });
    if (!updated) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ mailbox: updated });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    await deleteMailbox(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return notConfigured();
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
