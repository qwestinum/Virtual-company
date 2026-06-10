/**
 * Assemblage SERVEUR du rapport multi-campagnes (cf. docs/specs/reporting.md
 * §4). Charge tous les rapports de campagnes clôturées (loader mutualisé),
 * filtre par période + filtres complémentaires, puis délègue l'agrégation au
 * module PUR `multi-campaign-report.ts`. Génération à la volée (aucun cache).
 */

import { getDonneurOrdre } from '@/lib/db/repos/donneurs-ordre';
import { getSite } from '@/lib/db/repos/sites';
import {
  donneurDisplayLabel,
  loadClosedCampaignReports,
} from '@/lib/reporting/closed-campaigns-loader';
import { filterCampaignSummaries } from '@/lib/reporting/campaign-report-display';
import { multiCampaignReportFileName } from '@/lib/reporting/multi-campaign-report-display';
import { buildMultiCampaignReportData } from '@/lib/reporting/multi-campaign-report';
import type { MultiCampaignReportData } from '@/types/reporting';

export type MultiCampaignQuery = {
  from: string;
  to: string;
  search?: string;
  donneurOrdreId?: string;
  siteId?: string;
};

export type AssembledMultiCampaignReport = {
  data: MultiCampaignReportData;
  fileName: string;
};

export async function assembleMultiCampaignReport(
  query: MultiCampaignQuery,
): Promise<AssembledMultiCampaignReport> {
  const reports = await loadClosedCampaignReports();

  const allowed = new Set(
    filterCampaignSummaries(
      reports.map((r) => r.summary),
      {
        search: query.search,
        from: query.from,
        to: query.to,
        donneurOrdreId: query.donneurOrdreId,
        siteId: query.siteId,
      },
    ).map((s) => s.campaignId),
  );
  const matched = reports.filter((r) => allowed.has(r.summary.campaignId));

  // Libellés des filtres (couverture PDF + nom de fichier).
  let donneurLabel: string | null = null;
  if (query.donneurOrdreId) {
    const d = await getDonneurOrdre(query.donneurOrdreId);
    donneurLabel = d ? donneurDisplayLabel(d.firstName, d.lastName) : null;
  }
  let siteLabel: string | null = null;
  if (query.siteId) {
    const site = await getSite(query.siteId);
    siteLabel = site?.name ?? null;
  }

  const data = buildMultiCampaignReportData({
    period: { from: query.from, to: query.to },
    filters: { search: query.search?.trim() || null, donneurLabel, siteLabel },
    reports: matched,
  });

  return {
    data,
    fileName: multiCampaignReportFileName(query.from, query.to, {
      donneurLabel,
      siteLabel,
    }),
  };
}
