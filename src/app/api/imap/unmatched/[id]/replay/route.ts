/**
 * POST /api/imap/unmatched/[id]/replay — REJEU d'un CV non rattaché (C11).
 *
 * Body : `{ campaignId }` — la campagne choisie par l'HUMAIN (le système ne
 * devine jamais un rattachement, cf. la règle `ambiguous` du poller).
 *
 * Le rejeu réutilise `processEmailAttachment` TEL QUEL — aucun chemin
 * parallèle : mêmes gardes (campagne active, fiche de scoring validée →
 * sinon trace `pendingScoringSheet`), même analyse, même gate HITL 3 zones,
 * mêmes claims d'idempotence `(mailbox, uid, mode)` (un re-rejeu ne renvoie
 * JAMAIS un mail déjà parti).
 *
 * Ordre anti-doublon (pattern « réserver l'état d'abord ») : la transition
 * `pending → replayed` est CONDITIONNELLE et posée AVANT le traitement — un
 * double POST a un seul gagnant (l'autre reçoit 409). Sur échec du
 * traitement, la ligne est rendue re-rejouable (best-effort), les claims
 * garantissant l'absence de double envoi.
 */
import { NextResponse } from 'next/server';

import { listCampaigns } from '@/lib/db/repos/campaigns';
import {
  getUnmatchedCv,
  reserveUnmatchedReplay,
  revertUnmatchedReplay,
} from '@/lib/db/repos/imap-unmatched-cvs';
import { getMailboxWithSecrets } from '@/lib/db/repos/mailboxes';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { processEmailAttachment } from '@/lib/imap/poller';
import { RetryablePollError } from '@/lib/imap/poll-retry';
import { downloadArtifact } from '@/lib/storage/blob';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  let campaignId: string;
  try {
    const body = (await request.json()) as { campaignId?: unknown };
    if (typeof body.campaignId !== 'string' || body.campaignId.trim() === '') {
      throw new Error('campaignId requis');
    }
    campaignId = body.campaignId.trim();
  } catch (err) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        message: err instanceof Error ? err.message : 'Body JSON invalide.',
      },
      { status: 400 },
    );
  }

  try {
    const row = await getUnmatchedCv(id);
    if (!row) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (!row.storage_path) {
      // Ligne tracée mais binaire jamais stocké (panne storage au poll) : le
      // rejeu est impossible, il faut demander un renvoi du mail.
      return NextResponse.json(
        {
          error: 'binary_unavailable',
          message:
            'Le fichier n’a pas pu être stocké à la réception — demander au candidat de renvoyer son mail.',
        },
        { status: 422 },
      );
    }

    // Mêmes règles que le chemin email nominal : seule une campagne ACTIVE
    // reçoit des candidatures.
    const campaigns = await listCampaigns();
    const campaign = campaigns.find((c) => c.id === campaignId);
    if (!campaign) {
      return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
    }
    if (campaign.status !== 'active') {
      return NextResponse.json(
        {
          error: 'campaign_not_active',
          message: `La campagne ${campaignId} n'est pas active (${campaign.status}) — réactive-la avant de rejouer.`,
        },
        { status: 409 },
      );
    }

    const mailbox = await getMailboxWithSecrets(row.mailbox_id);
    if (!mailbox) {
      return NextResponse.json({ error: 'mailbox_not_found' }, { status: 404 });
    }

    // Réservation AVANT tout effet de bord — un seul gagnant sous double POST.
    const reserved = await reserveUnmatchedReplay(id, campaignId);
    if (!reserved) {
      return NextResponse.json(
        { error: 'already_replayed', message: 'Déjà rejoué ou écarté.' },
        { status: 409 },
      );
    }

    const buffer = await downloadArtifact(row.storage_path);
    if (!buffer) {
      await revertUnmatchedReplay(id);
      return NextResponse.json(
        { error: 'download_failed', message: 'Binaire introuvable en Storage.' },
        { status: 502 },
      );
    }

    try {
      await processEmailAttachment({
        mailbox,
        campaign,
        fileName: row.file_name,
        mime: row.mime,
        buffer,
        uid: row.uid,
        subject: row.subject ?? '',
        from: row.from_addr,
        matchSource: 'replay',
      });
    } catch (procErr) {
      // Échec (transitoire ou non) : on rend la ligne re-rejouable — les
      // claims d'idempotence garantissent qu'un mail déjà parti ne repartira
      // pas au prochain essai.
      await revertUnmatchedReplay(id);
      const retryable = procErr instanceof RetryablePollError;
      return NextResponse.json(
        {
          error: retryable ? 'replay_deferred' : 'replay_failed',
          retryable: true,
          message:
            'Le rejeu n’a pas abouti — aucun état perdu, réessaie dans quelques minutes.',
        },
        { status: 502 },
      );
    }

    await appendJournalEntry({
      action: 'imap_unmatched_replayed',
      actor: 'user',
      campaignId,
      payload: {
        unmatchedId: id,
        mailboxId: row.mailbox_id,
        uid: row.uid,
        fileName: row.file_name,
        from: row.from_addr,
      },
    }).catch((jErr) =>
      console.error('[imap-unmatched] journal replay KO', jErr),
    );

    return NextResponse.json({ ok: true, campaignId });
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
}
