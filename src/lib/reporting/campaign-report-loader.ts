/**
 * Assemblage SERVEUR d'un rapport de campagne pour une campagne donnée —
 * mutualisé entre la route PDF (cache) et la route d'envoi mail.
 *
 * Charge la campagne + ses analyses + signaux de parcours + donneur/site +
 * envois journal, puis délègue le calcul au module PUR `campaign-report.ts`.
 */

import { getCampaign } from '@/lib/db/repos/campaigns';
import { listAllCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
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
 * La campagne d'un rapport : trouvée ET clôturée, sinon `null` (404 côté
 * appelant). Exposée pour que la route PDF puisse consulter son cache — dont la
 * clé ne dépend QUE de la campagne — avant d'assembler quoi que ce soit.
 */
export async function loadReportableCampaign(
  campaignId: string,
): Promise<ActiveCampaign | null> {
  const campaign = await getCampaign(campaignId);
  if (!campaign || campaign.status !== 'closed') return null;
  return campaign;
}

/**
 * Nom du fichier PDF (et donc clé du cache) : intitulé de poste + date de
 * clôture, rien d'autre. Identique à `AssembledCampaignReport.fileName`.
 */
export function campaignReportFileNameOf(campaign: ActiveCampaign): string {
  return campaignReportFileName(
    jobTitleOf(campaign),
    campaign.closedAt ?? campaign.updatedAt,
  );
}

/**
 * Assemble le rapport d'une campagne CLÔTURÉE. Retourne null si la campagne
 * est introuvable ou non clôturée (l'appelant traduit en 404).
 *
 * `preloaded` : la campagne déjà relue par `loadReportableCampaign` sur la même
 * requête — on ne la relit pas.
 */
export async function assembleCampaignReport(
  campaignId: string,
  preloaded?: { campaign: ActiveCampaign },
): Promise<AssembledCampaignReport | null> {
  const campaign = preloaded
    ? preloaded.campaign
    : await loadReportableCampaign(campaignId);
  if (!campaign) return null;

  // Donneur d'ordre et site partent AVEC les autres lectures ; ils sont
  // attendus APRÈS, pour que l'échec éventuel d'une lecture principale reste
  // celui qui est rapporté (même précédence qu'en séquence). Rejets muets tant
  // qu'on ne les attend pas.
  const donneurP = campaign.donneurOrdreId
    ? getDonneurOrdre(campaign.donneurOrdreId)
    : Promise.resolve(null);
  const siteP = campaign.siteId ? getSite(campaign.siteId) : Promise.resolve(null);
  void donneurP.catch(() => undefined);
  void siteP.catch(() => undefined);

  const [analyses, signals, sentJournal, vivierCounts] = await Promise.all([
    // EXHAUSTIF (audit C8/A10) : un rapport de campagne à > 1000 candidatures
    // était tronqué et présenté comme définitif au client.
    listAllCandidateAnalyses({ campaignId }),
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

  const donneur = await donneurP;
  const site = await siteP;

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
