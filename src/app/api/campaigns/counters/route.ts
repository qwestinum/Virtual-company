/**
 * GET /api/campaigns/counters?campaignIds=A,B,C — les compteurs de TOUTES les
 * cartes affichées, en UN appel.
 *
 * ⚠️ C'est une décision de latence, pas d'architecture. Les compteurs d'une
 * carte doivent s'afficher AVEC la liste : les charger au dépliage faisait
 * apparaître des chiffres après coup, sur un écran dont c'est justement la
 * première information. Et un appel par carte aurait fait quinze lectures là
 * où une suffit.
 *
 * Même source que le ruban de Candidatures (`computeStageCountsByCampaign`),
 * donc les deux ne peuvent pas diverger — il n'y a qu'un calcul.
 *
 * Deux lectures seulement, quel que soit le nombre de campagnes : les analyses
 * du périmètre, et les briefings programmés. Elles partent ENSEMBLE.
 */
import { NextResponse } from 'next/server';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { listBriefsByStatus } from '@/lib/db/repos/interview-briefs';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { BUSINESS_NOTIFICATION_THRESHOLDS } from '@/lib/notifications/config';
import { selectUnpointedBriefs } from '@/lib/notifications/business-signals';
import { computeStageCountsByCampaign } from '@/lib/reporting/stage-signals';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<NextResponse> {
  const user = await getApiUser();
  if (!user) return unauthorizedResponse();

  const brut = new URL(request.url).searchParams.get('campaignIds') ?? '';
  const ids = brut.split(',').filter(Boolean);
  if (ids.length === 0) return NextResponse.json({ byCampaign: {} });

  const now = Date.now();
  try {
    const [parCampagne, briefs] = await Promise.all([
      computeStageCountsByCampaign(ids, now),
      listBriefsByStatus('scheduled').catch(() => []),
    ]);

    // Entretiens PASSÉS que personne n'a confirmés — même seuil que le signal
    // métier (24 h), pour que la carte et l'alerte disent la même chose.
    const cutoff =
      now - BUSINESS_NOTIFICATION_THRESHOLDS.interviewPointingAgeHours * 3_600_000;
    const aConfirmer = new Map<string, number>();
    for (const brief of selectUnpointedBriefs(briefs, cutoff)) {
      if (!brief.campaignId) continue;
      aConfirmer.set(brief.campaignId, (aConfirmer.get(brief.campaignId) ?? 0) + 1);
    }

    const byCampaign: Record<
      string,
      {
        counts: ReturnType<typeof Object>;
        received: number;
        aValiderOldestDays: number | null;
        entretiensAConfirmer: number;
      }
    > = {};
    for (const [id, entry] of parCampagne) {
      byCampaign[id] = {
        counts: entry.counts,
        received: entry.total,
        aValiderOldestDays: entry.oldestWaitingDays,
        entretiensAConfirmer: aConfirmer.get(id) ?? 0,
      };
    }

    return NextResponse.json(
      { byCampaign },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    console.error('[api/campaigns/counters] échec', err);
    return NextResponse.json({ error: 'counters_failed' }, { status: 500 });
  }
}
