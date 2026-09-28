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
 * Trois lectures, quel que soit le nombre de campagnes, qui partent
 * ENSEMBLE : les briefings programmés, les analyses du périmètre, leurs
 * marqueurs.
 */
import { NextResponse } from 'next/server';

import { getApiUser, unauthorizedResponse } from '@/lib/auth/require-api-user';
import { listBriefsByStatus } from '@/lib/db/repos/interview-briefs';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { BUSINESS_NOTIFICATION_THRESHOLDS } from '@/lib/notifications/config';
import { selectUnpointedBriefs } from '@/lib/notifications/business-signals';
import type { TrajectoryCounts } from '@/lib/reporting/campaign-trajectory';
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
    // Entretiens PASSÉS depuis plus de 24 h — même seuil que l'alerte
    // d'Aujourd'hui. Seuls ceux dont le dossier est encore « Invité » ou « RDV
    // pris » attendent un pointage (`awaitsPointing`, règle partagée) : le
    // briefing reste « programmé » après la décision et ne prouve rien.
    const cutoff =
      now - BUSINESS_NOTIFICATION_THRESHOLDS.interviewPointingAgeHours * 3_600_000;
    const parCampagne = await computeStageCountsByCampaign(
      ids,
      now,
      listBriefsByStatus('scheduled')
        .catch(() => [])
        .then((briefs) => selectUnpointedBriefs(briefs, cutoff)),
    );

    const byCampaign: Record<
      string,
      {
        counts: ReturnType<typeof Object>;
        received: number;
        aValiderOldestDays: number | null;
        entretiensAConfirmer: number;
        trajectory: TrajectoryCounts;
      }
    > = {};
    for (const [id, entry] of parCampagne) {
      byCampaign[id] = {
        counts: entry.counts,
        received: entry.total,
        aValiderOldestDays: entry.oldestWaitingDays,
        entretiensAConfirmer: entry.unpointed,
        trajectory: entry.trajectory,
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
