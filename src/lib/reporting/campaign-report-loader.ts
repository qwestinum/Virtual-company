/**
 * Assemblage SERVEUR d'un rapport de campagne pour une campagne donnée —
 * mutualisé entre la route PDF (cache) et la route d'envoi mail.
 *
 * Charge la campagne + ses analyses + signaux de parcours + donneur/site +
 * envois journal, puis délègue le calcul au module PUR `campaign-report.ts`.
 */

import { getCampaign } from '@/lib/db/repos/campaigns';
import { listCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import { getDonneurOrdre } from '@/lib/db/repos/donneurs-ordre';
import { listJournalEntries } from '@/lib/db/repos/journal';
import { getSite } from '@/lib/db/repos/sites';
import { countVivierMetricsForCampaign } from '@/lib/db/repos/vivier-preselection';
import {
  buildCampaignReportData,
  buildCampaignReportSummary,
  type CampaignReportMeta,
} from '@/lib/reporting/campaign-report';
import { analysisToDatum } from '@/lib/reporting/analysis-datum';
import { campaignReportFileName } from '@/lib/reporting/campaign-report-display';
import { loadJourneySignals } from '@/lib/reporting/journey-lookup';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import type {
  CampaignAnalysisDatum,
  CampaignReportData,
  CampaignReportSend,
} from '@/types/reporting';

function jobTitleOf(c: ActiveCampaign): string {
  const v = c.fdp?.fields?.job_title?.value;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : c.name;
}

export type AssembledCampaignReport = {
  data: CampaignReportData;
  fileName: string;
  jobTitle: string;
  closedAt: string;
};

/**
 * Assemble le rapport d'une campagne CLÔTURÉE. Retourne null si la campagne
 * est introuvable ou non clôturée (l'appelant traduit en 404).
 */
export async function assembleCampaignReport(
  campaignId: string,
): Promise<AssembledCampaignReport | null> {
  const campaign = await getCampaign(campaignId);
  if (!campaign || campaign.status !== 'closed') return null;

  const [analyses, signals, sentJournal, vivierCounts] = await Promise.all([
    listCandidateAnalyses({ campaignId, limit: 1000 }),
    loadJourneySignals({ campaignId }),
    listJournalEntries({
      actionPrefix: 'campaign_report_sent',
      campaignId,
      limit: 500,
    }),
    countVivierMetricsForCampaign(campaignId),
  ]);

  const data: CampaignAnalysisDatum[] = analyses.map((a) =>
    analysisToDatum(a, signals),
  );

  const donneur = campaign.donneurOrdreId
    ? await getDonneurOrdre(campaign.donneurOrdreId)
    : null;
  const site = campaign.siteId ? await getSite(campaign.siteId) : null;

  const launchedAt = campaign.launchedAt ?? campaign.createdAt;
  const closedAt = campaign.closedAt ?? campaign.updatedAt;
  const jobTitle = jobTitleOf(campaign);

  const meta: CampaignReportMeta = {
    campaignId: campaign.id,
    campaignName: campaign.name,
    jobTitle,
    launchedAt,
    closedAt,
    donneurOrdre: donneur
      ? {
          label:
            donneur.firstName && donneur.firstName.trim().length > 0
              ? `${donneur.firstName.trim()} ${donneur.lastName}`
              : donneur.lastName,
          role: donneur.role,
        }
      : null,
    donneurOrdreId: campaign.donneurOrdreId,
    siteId: campaign.siteId,
    siteLabel: site?.name ?? null,
  };

  const sends: CampaignReportSend[] = sentJournal.map((e) => ({
    at: e.createdAt,
    to: Array.isArray(e.payload?.to)
      ? (e.payload.to as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    subject: typeof e.payload?.subject === 'string' ? e.payload.subject : '',
  }));

  const summary = buildCampaignReportSummary(meta, data, sends, null);
  // Mobilisation vivier : on n'expose la métrique que si au moins un candidat a
  // été contacté (sinon la campagne n'a pas utilisé le vivier).
  const vivier = vivierCounts.contacted > 0 ? vivierCounts : null;
  return {
    data: buildCampaignReportData(summary, data, { vivier }),
    fileName: campaignReportFileName(jobTitle, closedAt),
    jobTitle,
    closedAt,
  };
}
