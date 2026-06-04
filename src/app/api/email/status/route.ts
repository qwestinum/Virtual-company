/**
 * GET /api/email/status?id=<resend_message_id>
 *
 * Diagnostic de délivrabilité : résout un message-id Resend (stocké dans
 * le journal `imap_outreach_mail` / `imap_outreach_brief` sous
 * `providerMessageId`) vers son dernier évènement de livraison
 * ('delivered', 'bounced', 'complained', 'sent'…). Permet de trancher
 * entre « livré », « bounce » et « accepté mais jamais livré » (spam)
 * sans attendre un webhook.
 */
import { NextResponse } from 'next/server';

import { getEmailDeliveryStatus } from '@/lib/email/client';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json(
      { error: 'missing_id', message: 'Paramètre `id` requis.' },
      { status: 400 },
    );
  }
  const status = await getEmailDeliveryStatus(id);
  return NextResponse.json(status, { status: status.ok ? 200 : 502 });
}
