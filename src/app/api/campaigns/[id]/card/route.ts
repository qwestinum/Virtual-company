/**
 * GET /api/campaigns/[id]/card — tout ce que la carte DÉPLIÉE affiche.
 *
 * Une seule carte est dépliée à la fois : une lecture par ouverture, et les
 * cinq sources partent ENSEMBLE. Les enchaîner ferait attendre cinq fois.
 *
 * ⚠️ Les compteurs viennent de `computeStageCounts`, la MÊME source que le
 * ruban de Candidatures. C'est ce qui garantit qu'un chiffre de la carte égale
 * la puce vers laquelle il mène — sans invariant à maintenir, parce qu'il n'y
 * a qu'une comptabilité.
 *
 * Chaque source tombe SEULE : une panne du vivier ne doit pas effacer les
 * compteurs. L'état devient alors « indisponible », jamais zéro — zéro serait
 * une affirmation.
 */
import { NextResponse } from 'next/server';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { countCandidateAnalyses, listAllCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { getCurrentJobPosting } from '@/lib/db/repos/job-postings';
import { countersForCampaign } from '@/lib/db/repos/sourcing';
import { listPreselection } from '@/lib/db/repos/vivier-preselection';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { loadInterviewPipeline } from '@/lib/interviews/pipeline';
import { republishDaysLeft } from '@/lib/jobboards/adep/panel-state';
import { computeStageCounts } from '@/lib/reporting/stage-signals';
import { isSourcingEnabled } from '@/lib/sourcing/flag';

export const runtime = 'nodejs';

const INDISPONIBLE = 'État indisponible pour le moment.';

/** Jours entiers écoulés, jamais négatif. */
const joursDepuis = (iso: string, nowMs: number): number =>
  Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 86_400_000));

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getApiUser();
  if (!user) return unauthorizedResponse();

  const { id } = await params;
  const now = Date.now();

  try {
    const [campagne, stages, received, enAttente, pipeline, posting, vivier, sourcing, sourcingOn] =
      await Promise.all([
        getCampaign(id).catch(() => null),
        computeStageCounts({ campaignId: id }),
        countCandidateAnalyses({ campaignId: id }).catch(() => 0),
        // Les dossiers qui attendent, pour dater le plus ancien.
        listAllCandidateAnalyses({
          campaignId: id,
          decidedBy: 'auto',
          dismissed: false,
        }).catch(() => []),
        loadInterviewPipeline({ campaignId: id }).catch(() => null),
        getCurrentJobPosting(id, 'apec').catch(() => null),
        listPreselection(id).catch(() => null),
        countersForCampaign(id).catch(() => null),
        isSourcingEnabled().catch(() => false),
      ]);

    if (!campagne) {
      return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
    }

    const attente = enAttente.filter(
      (a) => a.decisionZone === 'gray' || a.decisionZone === 'proposed_reject',
    );
    const plusAncien = attente.length
      ? Math.max(...attente.map((a) => joursDepuis(a.createdAt, now)))
      : null;

    return NextResponse.json(
      {
        counts: stages.counts,
        received,
        awaiting: {
          aValider: stages.counts.a_valider,
          aValiderOldestDays: plusAncien,
          entretiensAConfirmer: pipeline?.counts.toPoint ?? 0,
        },
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
