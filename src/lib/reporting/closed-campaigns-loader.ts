/**
 * Chargement SERVEUR des campagnes clôturées + leurs données d'analyse, sous
 * forme de résumés (`CampaignReportSummary`) accompagnés du détail aplati
 * (`CampaignAnalysisDatum[]`). Mutualisé entre la liste du rapport de campagne
 * et le rapport multi-campagnes — un seul jeu de requêtes, aucune duplication.
 *
 * Les résumés sont « bruts » (sends = [], generatedAt = null) : la liste de
 * campagnes y surimpose la traçabilité journal ; le multi-campagnes ne s'en
 * sert pas.
 */

import { listClosedCampaigns } from '@/lib/db/repos/campaigns';
import { listCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import { listDonneursOrdre } from '@/lib/db/repos/donneurs-ordre';
import { listSites } from '@/lib/db/repos/sites';
import { analysisToDatum } from '@/lib/reporting/analysis-datum';
import {
  buildCampaignReportSummary,
  type CampaignReportMeta,
} from '@/lib/reporting/campaign-report';
import { loadJourneySignals } from '@/lib/reporting/journey-lookup';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import type {
  CampaignAnalysisDatum,
  CampaignReportSummary,
} from '@/types/reporting';

export type ClosedCampaignReport = {
  summary: CampaignReportSummary;
  analyses: CampaignAnalysisDatum[];
};

/** Intitulé de poste depuis la FDP, repli sur le nom de campagne. */
export function campaignJobTitle(c: ActiveCampaign): string {
  const v = c.fdp?.fields?.job_title?.value;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : c.name;
}

/** « Prénom Nom » (ou Nom seul). */
export function donneurDisplayLabel(
  firstName: string | null,
  lastName: string,
): string {
  return firstName && firstName.trim().length > 0
    ? `${firstName.trim()} ${lastName}`
    : lastName;
}

export async function loadClosedCampaignReports(): Promise<ClosedCampaignReport[]> {
  const [campaigns, analyses, signals, sites, donneurs] = await Promise.all([
    listClosedCampaigns(),
    listCandidateAnalyses({ limit: 1000 }),
    loadJourneySignals(),
    listSites({ includeArchived: true }),
    listDonneursOrdre({ includeArchived: true }),
  ]);

  const siteById = new Map(sites.map((s) => [s.id, s]));
  const donneurById = new Map(donneurs.map((d) => [d.id, d]));

  const datumByCampaign = new Map<string, CampaignAnalysisDatum[]>();
  for (const a of analyses) {
    if (!a.campaignId) continue;
    const arr = datumByCampaign.get(a.campaignId) ?? [];
    arr.push(analysisToDatum(a, signals));
    datumByCampaign.set(a.campaignId, arr);
  }

  return campaigns.map((c) => {
    const own = datumByCampaign.get(c.id) ?? [];
    const donneur = c.donneurOrdreId ? donneurById.get(c.donneurOrdreId) : null;
    const site = c.siteId ? siteById.get(c.siteId) : null;
    const meta: CampaignReportMeta = {
      campaignId: c.id,
      campaignName: c.name,
      jobTitle: campaignJobTitle(c),
      launchedAt: c.launchedAt ?? c.createdAt,
      closedAt: c.closedAt ?? c.updatedAt,
      donneurOrdre: donneur
        ? {
            label: donneurDisplayLabel(donneur.firstName, donneur.lastName),
            role: donneur.role,
          }
        : null,
      donneurOrdreId: c.donneurOrdreId,
      siteId: c.siteId,
      siteLabel: site?.name ?? null,
    };
    return {
      summary: buildCampaignReportSummary(meta, own, [], null),
      analyses: own,
    };
  });
}
