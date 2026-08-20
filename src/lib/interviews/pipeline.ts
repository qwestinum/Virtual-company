/**
 * Chargement de la page « Entretiens » — assemblage serveur.
 *
 * Une passe, quatre lectures, aucune requête par ligne :
 *   1. les briefings des deux statuts (pagination keyset, jamais tronquée) ;
 *   2. les analyses de ces candidatures (uid → identité + étape) ;
 *   3. les signaux d'étape (mêmes marqueurs que le ruban Candidatures) ;
 *   4. les liens natifs des campagnes concernées.
 *
 * La jointure `uid → analysisId` est indispensable : un briefing porte l'uid
 * d'analyse, alors que l'état d'un lien natif est indexé par l'identifiant
 * d'analyse. Une seule requête pour toute la page (`uidIn`), bas volume.
 */
import { listAllCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import { listCampaigns } from '@/lib/db/repos/campaigns';
import { listBriefsByStatus } from '@/lib/db/repos/interview-briefs';
import { listRecruiters } from '@/lib/db/repos/recruiters';
import { BUSINESS_NOTIFICATION_THRESHOLDS } from '@/lib/notifications/config';
import { loadStageSignals, stageFor } from '@/lib/reporting/stage-signals';
import { listLinksForTarget, listOrphanTargets } from '@/lib/scheduling';
import { parseBookingContext } from '@/lib/scheduling-host/campaign-booking';
import { ensureSchedulingConfigured } from '@/lib/scheduling-host/configure';
import type { InterviewBrief } from '@/types/interview-brief';

import {
  buildAwaitingRows,
  buildScheduledRows,
  type AwaitingRow,
  type BriefFacts,
  type ScheduledRow,
} from './pipeline-rows';

export type OrphanRow = {
  campaignId: string;
  campaignName: string | null;
  activeLinks: number;
};

type Decorated<T> = T & { campaignName: string | null; ownerName: string | null };

export type InterviewPipeline = {
  awaiting: Decorated<AwaitingRow>[];
  /** Entretiens à venir et entretiens passés à pointer. */
  scheduled: Decorated<ScheduledRow>[];
  /** Entretiens pointés « réalisé » : il ne manque que la décision. */
  verdict: Decorated<ScheduledRow>[];
  orphans: OrphanRow[];
  /**
   * Compteurs des LISTES RENDUES, pas des tables.
   *
   * Le compte brut d'`interview_briefs` annonçait 5 là où l'écran montrait 3 :
   * il ignorait le filtre « candidature encore ouverte » et la déduplication.
   * Un compteur qui ne compte pas ce qu'on voit détruit la confiance dans les
   * deux. « Exhaustif » veut dire NON TRONQUÉ (lecture keyset), pas « brut ».
   */
  counts: {
    awaiting: number;
    scheduled: number;
    verdict: number;
    toPoint: number;
    /**
     * Briefings écartés faute de candidature retrouvable — anomalie de
     * données, affichée plutôt que tue.
     */
    unresolved: number;
  };
};

function toFacts(brief: InterviewBrief): BriefFacts {
  return {
    briefId: brief.id,
    uid: brief.uid,
    campaignId: brief.campaignId,
    candidateName: brief.candidateName,
    candidateEmail: brief.candidateEmail,
    jobTitle: brief.jobTitle,
    updatedAt: brief.updatedAt,
    createdAt: brief.createdAt,
    interviewStartAt: brief.interviewStartAt,
    interviewEndAt: brief.interviewEndAt,
    interviewLocation: brief.interviewLocation,
    bookingUid: brief.bookingUid,
  };
}

export async function loadInterviewPipeline(
  filter: { campaignId?: string | null } = {},
  nowMs = Date.now(),
): Promise<InterviewPipeline> {
  const campaignId = filter.campaignId ?? null;

  const [awaitingBriefs, scheduledBriefs] = await Promise.all([
    listBriefsByStatus('awaiting_booking', { campaignId }),
    listBriefsByStatus('scheduled', { campaignId }),
  ]);

  const uids = [
    ...new Set(
      [...awaitingBriefs, ...scheduledBriefs]
        .map((b) => b.uid)
        .filter((u): u is string => u !== null),
    ),
  ];

  const [analyses, signals, campaigns, recruiters] = await Promise.all([
    uids.length > 0
      ? listAllCandidateAnalyses({ uidIn: uids }).catch(() => [])
      : Promise.resolve([]),
    loadStageSignals(campaignId ? { campaignId } : {}).catch(() => null),
    listCampaigns().catch(() => []),
    listRecruiters().catch(() => []),
  ]);

  const analysisByUid = new Map(analyses.map((a) => [a.uid, a]));
  const stageOf = (uid: string): string | null => {
    const analysis = analysisByUid.get(uid);
    if (!analysis || !signals) return null;
    return stageFor(analysis, signals);
  };
  const analysisIdOf = (uid: string): string | null =>
    analysisByUid.get(uid)?.id ?? null;

  // Liens natifs, campagne par campagne — uniquement celles qui en ont.
  const linkStatusByAnalysis = new Map<string, AwaitingRow['linkStatus']>();
  const nativeCampaigns = campaigns.filter(
    (c) => c.schedulingNative && (!campaignId || c.id === campaignId),
  );
  if (nativeCampaigns.length > 0) {
    await ensureSchedulingConfigured();
    for (const campaign of nativeCampaigns) {
      for (const link of await listLinksForTarget(campaign.id).catch(() => [])) {
        const key =
          parseBookingContext(link.context)?.analysisId ?? link.idempotencyKey;
        // La génération la plus récente fait foi : un lien réémis remplace le
        // précédent, et c'est SON état que la page doit montrer.
        const known = linkStatusByAnalysis.get(key);
        if (!known || link.status === 'active') {
          linkStatusByAnalysis.set(key, link.status);
        }
      }
    }
  }

  const campaignNames = new Map(campaigns.map((c) => [c.id, c.name]));
  const ownerNames = new Map(recruiters.map((r) => [r.id, r.displayName]));
  const ownerByCampaign = new Map(
    campaigns.map((c) => [c.id, c.ownerUserId ? ownerNames.get(c.ownerUserId) ?? null : null]),
  );
  const decorate = <T extends { campaignId: string | null }>(row: T) => ({
    ...row,
    campaignName: row.campaignId ? (campaignNames.get(row.campaignId) ?? null) : null,
    ownerName: row.campaignId ? (ownerByCampaign.get(row.campaignId) ?? null) : null,
  });

  const awaitingBuilt = buildAwaitingRows(awaitingBriefs.map(toFacts), {
    nowMs,
    thresholdDays: BUSINESS_NOTIFICATION_THRESHOLDS.invitationAgeDays,
    stageOf,
    analysisIdOf,
    linkStatusOf: (analysisId) => linkStatusByAnalysis.get(analysisId) ?? null,
  });

  const scheduledBuilt = buildScheduledRows(scheduledBriefs.map(toFacts), {
    nowMs,
    pointingAgeHours: BUSINESS_NOTIFICATION_THRESHOLDS.interviewPointingAgeHours,
    stageOf,
    analysisIdOf,
  });

  const awaiting = awaitingBuilt.rows.map(decorate);
  // L'attente de verdict a son propre onglet : ce n'est plus un entretien à
  // organiser, c'est une décision à prendre.
  const scheduled = scheduledBuilt.rows
    .filter((r) => r.section !== 'verdict_attendu')
    .map(decorate);
  const verdict = scheduledBuilt.rows
    .filter((r) => r.section === 'verdict_attendu')
    .map(decorate);

  const orphans = (await listOrphanTargets().catch(() => []))
    .filter((o) => !campaignId || o.target.externalRef === campaignId)
    .map((o) => ({
      campaignId: o.target.externalRef,
      campaignName: campaignNames.get(o.target.externalRef) ?? null,
      activeLinks: o.activeLinks,
    }));

  return {
    awaiting,
    scheduled,
    verdict,
    orphans,
    counts: {
      awaiting: awaiting.length,
      scheduled: scheduled.length,
      verdict: verdict.length,
      toPoint: scheduled.filter((r) => r.section === 'a_pointer').length,
      unresolved: awaitingBuilt.unresolved + scheduledBuilt.unresolved,
    },
  };
}
