/**
 * GET /api/campaigns/[id]/card — les TROIS ÉTATS de sourcing d'une campagne.
 *
 * ⚠️ Les compteurs ne sont PLUS ici : ils arrivent avec la liste, en un appel
 * groupé (`/api/campaigns/counters`). Les charger au dépliage faisait
 * apparaître les chiffres après coup, sur un écran dont c'est la première
 * information. Ne restent ici que les trois états qui, eux, demandent des
 * lectures propres à une campagne — et qu'on ne regarde qu'en l'ouvrant.
 *
 * Les trois partent ENSEMBLE et tombent SÉPARÉMENT : une panne du vivier
 * devient « état indisponible », jamais zéro. Zéro serait une affirmation.
 */
import { NextResponse } from 'next/server';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { getCurrentJobPosting } from '@/lib/db/repos/job-postings';
import { countersForCampaign } from '@/lib/db/repos/sourcing';
import { listPreselection } from '@/lib/db/repos/vivier-preselection';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { republishDaysLeft } from '@/lib/jobboards/adep/panel-state';
import { isSourcingEnabled } from '@/lib/sourcing/flag';

export const runtime = 'nodejs';

const INDISPONIBLE = 'État indisponible pour le moment.';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getApiUser();
  if (!user) return unauthorizedResponse();

  const { id } = await params;
  const now = Date.now();

  try {
    const [campagne, posting, vivier, sourcing, sourcingOn] = await Promise.all([
      getCampaign(id).catch(() => null),
      getCurrentJobPosting(id, 'apec').catch(() => null),
      listPreselection(id).catch(() => null),
      countersForCampaign(id).catch(() => null),
      isSourcingEnabled().catch(() => false),
    ]);

    if (!campagne) {
      return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
    }

    return NextResponse.json(
      {
        sources: {
          isDraft: campagne.status !== 'active',
          sourcingEnabled: sourcingOn,
          annonce: annonceState(posting, now),
          vivier: vivierState(vivier),
          approches: approchesState(sourcing),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    console.error('[api/campaigns/card] échec', err);
    return NextResponse.json({ error: 'card_failed' }, { status: 500 });
  }
}

/** L'annonce, en français d'utilisateur. Une date, pas un code de statut. */
function annonceState(
  posting: { remoteStatus?: string | null; publishedAt?: string | null } | null,
  nowMs: number,
): string {
  if (!posting) return 'Aucune annonce diffusée.';
  const publiee = posting.publishedAt
    ? new Date(posting.publishedAt).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
      })
    : null;
  if (posting.remoteStatus === 'PUBLIEE') {
    return publiee ? `En ligne sur l’APEC depuis le ${publiee}.` : 'En ligne sur l’APEC.';
  }
  const reste = republishDaysLeft(posting.publishedAt ?? null, new Date(nowMs));
  if (reste !== null && reste > 0) {
    return `Suspendue — republiable pendant encore ${reste} jour${reste > 1 ? 's' : ''}.`;
  }
  return 'Suspendue — la fenêtre de republication est fermée.';
}

/** Le vivier : ce qui est inclus, ce qui attend un arbitrage. */
function vivierState(
  entries: { state?: string | null }[] | null,
): string {
  if (entries === null) return INDISPONIBLE;
  if (entries.length === 0) return 'Aucun profil du vivier retenu pour l’instant.';
  const aArbitrer = entries.filter((e) => e.state === 'identified').length;
  const contactes = entries.filter((e) => e.state === 'contacted').length;
  const bouts = [
    `${entries.length} profil${entries.length > 1 ? 's' : ''} retenu${entries.length > 1 ? 's' : ''}`,
    contactes > 0 ? `${contactes} invité${contactes > 1 ? 's' : ''} à postuler` : null,
    aArbitrer > 0 ? `${aArbitrer} à arbitrer` : null,
  ].filter(Boolean);
  return `${bouts.join(' · ')}.`;
}

/** Les approches : qui a été préparé, qui a répondu — et QUI envoie. */
function approchesState(
  counters: { approached?: number; manifested?: number } | null,
): string {
  if (counters === null) return INDISPONIBLE;
  const preparees = counters.approached ?? 0;
  if (preparees === 0) return 'Aucune approche préparée.';
  const reponses = counters.manifested ?? 0;
  return `${preparees} approche${preparees > 1 ? 's' : ''} préparée${preparees > 1 ? 's' : ''}, ${reponses} réponse${reponses > 1 ? 's' : ''} — vous envoyez vous-même.`;
}
