/**
 * POST /api/mailboxes/test-credentials — teste des credentials IMAP
 * fournis dans le body, SANS toucher à la DB. Sert au formulaire
 * settings pour valider avant le clic « Enregistrer ».
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { testConnection } from '@/lib/imap/client';
import { describeMailboxIssues } from '@/lib/mailboxes/form-messages';

export const runtime = 'nodejs';
export const maxDuration = 30;

const Schema = z.object({
  imapHost: z.string().min(1),
  imapPort: z.number().int().min(1).max(65535),
  imapSsl: z.boolean(),
  userEmail: z.string().email(),
  password: z.string().min(1).max(512),
});

export async function POST(request: Request): Promise<NextResponse> {
  let parsed: z.infer<typeof Schema>;
  {
    const body: unknown = await request.json().catch(() => null);
    const result = Schema.safeParse(body);
    if (!result.success) {
      // Même forme que l'échec d'une connexion (`ok:false` + `error`) : le
      // formulaire affiche `error` — il recevait jusqu'ici « invalid_request ».
      return NextResponse.json(
        { ok: false, error: describeMailboxIssues(result.error.issues, 'test') },
        { status: 400 },
      );
    }
    parsed = result.data;
  }
  const result = await testConnection({
    host: parsed.imapHost,
    port: parsed.imapPort,
    secure: parsed.imapSsl,
    user: parsed.userEmail,
    password: parsed.password,
  });
  return NextResponse.json(result);
}
