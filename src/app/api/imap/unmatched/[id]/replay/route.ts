/**
 * POST /api/imap/unmatched/[id]/replay — REJEU d'un CV non traité (C11 + C4).
 *
 * Body : `{ campaignId? }` — la campagne choisie par l'HUMAIN (le système ne
 * devine jamais un rattachement, cf. la règle `ambiguous` du poller). Pour une
 * ligne `pending_sheet` (C4), la campagne d'origine est connue : `campaignId`
 * est optionnel et se replie sur `row.campaign_id`.
 *
 * Le rejeu passe par le cœur partagé `replayUnmatchedCv` (le MÊME que le
 * drain automatique à la validation de fiche) : réservation conditionnelle
 * `pending → replayed` AVANT le traitement (un seul gagnant sous double POST),
 * `processEmailAttachment` TEL QUEL (même analyse, même gate HITL 3 zones,
 * mêmes claims d'idempotence — un re-rejeu ne renvoie JAMAIS un mail déjà
 * parti), ligne rendue re-rejouable sur échec.
 *
 * GARDES ici (avant toute réservation) : campagne existante, ACTIVE, et
 * FICHE DE SCORING VALIDÉE — rejouer sans fiche consommerait la ligne sans
 * analyse (cf. invariant documenté dans unmatched-replay.ts).
 */
import { NextResponse } from 'next/server';

import { listCampaigns } from '@/lib/db/repos/campaigns';
import { getUnmatchedCv } from '@/lib/db/repos/imap-unmatched-cvs';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { replayUnmatchedCv } from '@/lib/imap/unmatched-replay';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  let bodyCampaignId: string | null;
  try {
    const body = (await request.json()) as { campaignId?: unknown };
    if (body.campaignId !== undefined && typeof body.campaignId !== 'string') {
      throw new Error('campaignId doit être une chaîne');
    }
    bodyCampaignId =
      typeof body.campaignId === 'string' && body.campaignId.trim() !== ''
        ? body.campaignId.trim()
        : null;
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
    const campaignId = bodyCampaignId ?? row.campaign_id;
    if (!campaignId) {
      return NextResponse.json(
        {
          error: 'invalid_request',
          message:
            'campaignId requis — cette ligne n’a pas de campagne d’origine, l’humain doit la choisir.',
        },
        { status: 400 },
      );
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
    // avec une FICHE VALIDÉE traite des candidatures.
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
    if (campaign.scoringSheet?.isValidated !== true) {
      return NextResponse.json(
        {
          error: 'scoring_sheet_not_validated',
          message: `La fiche de scoring de ${campaignId} n'est pas validée — valide-la d'abord, le CV sera alors traité automatiquement (ou rejoue ensuite).`,
        },
        { status: 409 },
      );
    }

    const outcome = await replayUnmatchedCv({ row, campaign, actor: 'user' });
    switch (outcome.kind) {
      case 'done':
        return NextResponse.json({ ok: true, campaignId });
      case 'already_consumed':
        return NextResponse.json(
          { error: 'already_replayed', message: 'Déjà rejoué ou écarté.' },
          { status: 409 },
        );
      case 'binary_unavailable':
        return NextResponse.json(
          {
            error: 'binary_unavailable',
            message:
              'Le fichier n’a pas pu être stocké à la réception — demander au candidat de renvoyer son mail.',
          },
          { status: 422 },
        );
      case 'download_failed':
        return NextResponse.json(
          { error: 'download_failed', message: 'Binaire introuvable en Storage.' },
          { status: 502 },
        );
      case 'failed':
        return NextResponse.json(
          {
            error: outcome.retryable ? 'replay_deferred' : 'replay_failed',
            retryable: true,
            message:
              'Le rejeu n’a pas abouti — aucun état perdu, réessaie dans quelques minutes.',
          },
          { status: 502 },
        );
    }
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
