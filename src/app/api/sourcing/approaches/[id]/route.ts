/**
 * POST /api/sourcing/approaches/[id]  { action: 'confirm', message, url } — le geste a eu lieu ;
 *                                     { action: 'cancel' }                 — le recruteur renonce.
 *
 * Confirmer : le message tel qu'il a été copié (éventuellement retouché) est
 * stocké AVEC l'emplacement `[lien]` à la place de l'URL, le profil passe
 * « contacté », l'exclusion de campagne est posée, et le journal le dit — sans
 * donnée personnelle. Annuler : le lien, jamais ouvert, est révoqué.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { confirmSourcingApproach, revokeSourcingApproach } from '@/lib/db/repos/sourcing-approaches';
import { MESSAGE_LIMITS, restorePlaceholder } from '@/lib/sourcing/message';
import { guardSourcingApproach } from '@/lib/sourcing/server/route-guard';

export const runtime = 'nodejs';

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm'), message: z.string().min(1).max(4000), url: z.string().url() }),
  z.object({ action: z.literal('cancel') }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const guard = await guardSourcingApproach(id);
  if (!guard.ok) return guard.response;
  const { approach, user } = guard.value;

  const body = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: 'invalid_request', message: body.error.message }, { status: 400 });
  if (approach.status !== 'active') {
    return NextResponse.json({ error: 'approach_not_active' }, { status: 409 });
  }

  if (body.data.action === 'cancel') {
    const revoked = await revokeSourcingApproach(approach.id);
    return NextResponse.json({ ok: revoked });
  }

  const stored = restorePlaceholder(body.data.message, body.data.url);
  if (!stored) {
    return NextResponse.json(
      { error: 'link_removed', message: 'Le lien a été retiré du message : la personne ne pourrait pas répondre.' },
      { status: 422 },
    );
  }
  if (approach.messageFormat === 'connection_note' && body.data.message.length > MESSAGE_LIMITS.connection_note) {
    return NextResponse.json(
      { error: 'too_long', message: `La note dépasse ${MESSAGE_LIMITS.connection_note} caractères.` },
      { status: 422 },
    );
  }

  try {
    await confirmSourcingApproach(approach, user.id, stored);
    await appendJournalEntry({
      action: 'sourcing_contact_initiated',
      campaignId: approach.campaignId,
      actor: user.email ?? 'utilisateur',
      payload: {
        approachId: approach.id,
        fingerprint: approach.fingerprint,
        recruiterId: user.id,
        channel: approach.channel,
        messageFormat: approach.messageFormat,
      },
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'confirm_failed', message: (err as Error).message }, { status: 500 });
  }
}
