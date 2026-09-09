/**
 * Dépublier, republier, ou relire le statut d'une offre APEC.
 *
 * Les trois gestes partagent une route parce qu'ils partagent tout le reste :
 * même offre, même identité, même mise à jour de cache. Les séparer donnerait
 * trois fichiers identiques à un verbe près.
 *
 * `refresh` est une LECTURE qui écrit un cache. Elle ne journalise que les
 * TRANSITIONS de statut — la leçon du 21/08 : `imap_mailbox_skipped`, réécrite
 * à chaque relève, a évincé 475 lignes sur 500 du fil d'activité du Bureau.
 * Une offre relue toutes les trente secondes ferait exactement pareil.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  AdepCredentialsError,
  refreshAdepStatus,
  transitionAdepPosting,
} from '@/lib/jobboards/adep/service';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BodySchema = z.object({
  action: z.enum(['suspend', 'republish', 'refresh']),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getApiUser();
  if (!user) return unauthorizedResponse();
  const { id } = await context.params;

  let action: 'suspend' | 'republish' | 'refresh';
  try {
    action = BodySchema.parse(await request.json()).action;
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    if (action === 'refresh') {
      const result = await refreshAdepStatus({
        campaignId: id,
        ownerUserId: campaign.ownerUserId,
      });
      if (result.changed && result.posting) {
        // Uniquement sur TRANSITION.
        await appendJournalEntry({
          action: 'apec_offer_status_changed',
          actor: 'apec',
          campaignId: id,
          payload: {
            status: result.posting.remoteStatus,
            apecPositionNumero: result.posting.apecPositionNumero,
          },
        }).catch(() => {});
      }
      if (result.read.kind === 'not_found' && result.read.resolved) {
        // Une TRANSITION elle aussi : elle ne peut se produire qu'une fois,
        // la ligne passant à `failed`. Le fil peut donc la porter sans
        // rejouer la leçon du 21/08.
        await appendJournalEntry({
          action: 'apec_offer_attempt_closed',
          actor: user.email ?? 'utilisateur',
          campaignId: id,
          payload: { clientReference: result.posting?.clientReference ?? null },
        }).catch(() => {});
      }
      // `read` voyage avec `changed`, et ce n'est pas redondant : une lecture
      // qui n'a pas abouti rend `changed: false`, exactement comme une lecture
      // qui a abouti sans rien trouver de neuf. Sans le verdict, l'écran ne
      // peut que présenter une panne comme une bonne nouvelle.
      return NextResponse.json({
        posting: result.posting,
        changed: result.changed,
        read: result.read,
        simulated: result.simulated,
      });
    }

    const result = await transitionAdepPosting({
      campaignId: id,
      ownerUserId: campaign.ownerUserId,
      action,
    });

    if (result.outcome.kind === 'changed' || result.outcome.kind === 'already_in_state') {
      await appendJournalEntry({
        action: action === 'suspend' ? 'apec_offer_suspended' : 'apec_offer_republished',
        actor: user.email ?? 'utilisateur',
        campaignId: id,
        payload: {
          apecPositionNumero: result.posting?.apecPositionNumero ?? null,
          alreadyInState: result.outcome.kind === 'already_in_state',
          simulated: result.simulated,
        },
      }).catch(() => {});
    }

    const status =
      result.outcome.kind === 'changed' || result.outcome.kind === 'already_in_state'
        ? 200
        : result.outcome.kind === 'refused'
          ? 409
          : 503;
    return NextResponse.json(
      { outcome: result.outcome, posting: result.posting, simulated: result.simulated },
      { status },
    );
  } catch (err) {
    if (err instanceof AdepCredentialsError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 409 });
    }
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    console.error('[api/campaigns/adep/transition] failed', err);
    return NextResponse.json({ error: 'transition_failed' }, { status: 500 });
  }
}
