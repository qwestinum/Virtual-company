/**
 * GET /api/vivier/[id]/profile?campaignId=… — synthèse et historique d'un
 * profil du vivier, pour la ligne DÉPLIABLE de l'écran « Chercher dans le
 * vivier » (28/09/2026). Lecture seule.
 *
 * Historique = les candidatures reçues de cette adresse (poste, date, score,
 * étape COURANTE — même dérivation que la liste Candidatures) et les
 * sollicitations depuis le vivier sur les autres campagnes. Chaque lecture
 * annexe est fail-soft : une étape illisible ne masque pas la synthèse.
 */
import { NextResponse } from 'next/server';

import { listCampaignJobTitles } from '@/lib/db/repos/campaigns';
import { listAnalysesByEmail } from '@/lib/db/repos/candidate-analyses';
import { getVivierCandidate, getVivierEntities, getVivierProfileExtras } from '@/lib/db/repos/vivier';
import { listProposalsForCandidate } from '@/lib/db/repos/vivier-preselection';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { CANDIDATE_STAGE_LABELS } from '@/lib/reporting/candidate-stage';
import { loadStageSignals, stageFor } from '@/lib/reporting/stage-signals';
import { jobTitleOf } from '@/lib/vivier/last-applied-job';
import { buildVivierProfile } from '@/lib/vivier/profile-summary';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const currentCampaignId = new URL(request.url).searchParams.get('campaignId') ?? '';
  try {
    const candidate = await getVivierCandidate(id);
    if (!candidate) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const [entities, extras, analyses, proposals] = await Promise.all([
      getVivierEntities(id).catch(() => null),
      getVivierProfileExtras(id).catch(() => ({ skills: [], titleAnchors: [] })),
      listAnalysesByEmail(candidate.email).catch(() => []),
      listProposalsForCandidate(id).catch(() => []),
    ]);

    const campaignIds = [
      ...analyses.map((a) => a.campaignId).filter((c): c is string => Boolean(c)),
      ...proposals.map((p) => p.campaignId),
    ];
    const titles = await listCampaignJobTitles(campaignIds).catch(() => new Map());
    const jobTitle = (campaignId: string | null): string => {
      const c = campaignId ? titles.get(campaignId) : undefined;
      return c ? jobTitleOf(c) : campaignId ?? 'Hors campagne';
    };

    // Étape COURANTE de chaque candidature, par campagne (quelques-unes au plus).
    const signalsByCampaign = new Map<string, Awaited<ReturnType<typeof loadStageSignals>> | null>();
    for (const cid of new Set(analyses.map((a) => a.campaignId ?? ''))) {
      signalsByCampaign.set(cid, await loadStageSignals(cid ? { campaignId: cid } : {}).catch(() => null));
    }

    const profile = buildVivierProfile({
      title: candidate.title,
      titleAnchors: extras.titleAnchors,
      skills: extras.skills,
      entities,
      applications: analyses.map((a) => {
        const signals = signalsByCampaign.get(a.campaignId ?? '');
        return {
          analysisId: a.id,
          campaignId: a.campaignId,
          jobTitle: jobTitle(a.campaignId),
          receivedAt: a.receivedAt,
          score: a.totalScore,
          stageLabel: signals ? CANDIDATE_STAGE_LABELS[stageFor(a, signals)] : '—',
        };
      }),
      proposals,
      jobTitleOf: (cid) => jobTitle(cid),
      currentCampaignId,
    });
    return NextResponse.json({ profile });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: 'profile_failed' }, { status: 500 });
  }
}
