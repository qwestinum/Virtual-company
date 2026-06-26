/**
 * Calcul PUR du rapport MULTI-campagnes (cf. docs/specs/reporting.md §4).
 *
 * CLIENT-SAFE, déterministe, testable. Agrège plusieurs campagnes clôturées
 * sur une période + filtres, produit volumes cumulés, taux moyens pondérés,
 * répartition par campagne, performance transverse par canal, distribution de
 * scoring globale et recommandations TRANSVERSES (règles — pas de LLM).
 *
 * Réutilise les primitives mutualisées d'`aggregations.ts` (aucune
 * duplication avec le rapport de campagne).
 */

import {
  ARBITRATION_HIGH_RATE,
  CHANNEL_DOMINANT_SHARE,
  RGPD_RETENTION_MONTHS,
  SITE_RETENTION_GAP_PTS,
  TIME_TO_HIRE_REFERENCE_DAYS,
  channelPerformance,
  computeVolumes,
  daysBetween,
  pct,
  scoreDistribution,
  stdDev,
} from '@/lib/reporting/aggregations';
import { HITL_ZONES_RECALIBRATION } from '@/lib/reporting/campaign-report';
import type {
  CampaignAnalysisDatum,
  CampaignReportSummary,
  MultiCampaignFilterLabels,
  MultiCampaignPerCampaignRow,
  MultiCampaignPreview,
  MultiCampaignReportData,
} from '@/types/reporting';

/** Un rapport de campagne unitaire (résumé + détail aplati) en entrée. */
export type CampaignReportUnit = {
  summary: CampaignReportSummary;
  analyses: CampaignAnalysisDatum[];
};

export type MultiCampaignInput = {
  period: { from: string; to: string };
  filters: MultiCampaignFilterLabels;
  reports: CampaignReportUnit[];
};

/** Aperçu réactif (3 chiffres-clés) — calculé côté client depuis les résumés. */
export function aggregatePreview(
  summaries: CampaignReportSummary[],
): MultiCampaignPreview {
  return {
    campaignCount: summaries.length,
    totalReceived: summaries.reduce((n, s) => n + s.volumes.received, 0),
    totalRetained: summaries.reduce((n, s) => n + s.volumes.retained, 0),
    totalRecruited: summaries.reduce((n, s) => n + s.recruitedCount, 0),
  };
}

function perCampaignRow(s: CampaignReportSummary): MultiCampaignPerCampaignRow {
  return {
    campaignId: s.campaignId,
    jobTitle: s.jobTitle,
    donneurLabel: s.donneurOrdre?.label ?? '—',
    siteLabel: s.siteLabel ?? '—',
    closedAt: s.closedAt,
    durationDays: s.durationDays,
    received: s.volumes.received,
    retentionRate: pct(s.volumes.retained, s.volumes.received),
    timeToHireDays: s.recruitedCount > 0 ? s.durationDays : null,
    issue: s.issue,
  };
}

/** Taux de retenue par site (pour la reco de divergence inter-sites). */
function siteRetentionStats(
  reports: CampaignReportUnit[],
): { label: string; rate: number }[] {
  const by = new Map<string, { received: number; retained: number }>();
  for (const { summary } of reports) {
    const label = summary.siteLabel;
    if (!label) continue;
    const acc = by.get(label) ?? { received: 0, retained: 0 };
    acc.received += summary.volumes.received;
    acc.retained += summary.volumes.retained;
    by.set(label, acc);
  }
  return [...by.entries()]
    .filter(([, v]) => v.received > 0)
    .map(([label, v]) => ({ label, rate: pct(v.retained, v.received) }));
}

export function buildMultiCampaignRecommendations(
  data: Omit<MultiCampaignReportData, 'recommendations'>,
  reports: CampaignReportUnit[],
): string[] {
  const recs: string[] = [];
  const { aggregateVolumes, channels, perCampaign, rates } = data;

  // 1. Canal dominant (≥ CHANNEL_DOMINANT_SHARE des retenus).
  // NEUTRALISÉ (lot 2c) : « retenus » ambigu avec 3 zones — cf. HITL_ZONES_RECALIBRATION.
  const top = channels[0];
  if (!HITL_ZONES_RECALIBRATION && top && top.retained > 0 && aggregateVolumes.retained > 0) {
    const share = top.retained / aggregateVolumes.retained;
    if (share >= CHANNEL_DOMINANT_SHARE) {
      recs.push(
        `Le canal « ${top.channelLabel} » a généré ${Math.round(share * 100)}% des retenus sur la période — à privilégier sur les prochaines campagnes.`,
      );
    }
  }

  // 2. Campagnes lentes (time-to-hire > référence).
  const slow = perCampaign.filter(
    (c) => c.timeToHireDays !== null && c.timeToHireDays > TIME_TO_HIRE_REFERENCE_DAYS,
  ).length;
  if (slow >= 2) {
    recs.push(
      `${slow} campagnes ont un time-to-hire supérieur à ${TIME_TO_HIRE_REFERENCE_DAYS} jours — investiguer les goulots d'étranglement communs (diffusion, validation, entretiens).`,
    );
  }

  // 3-5. NEUTRALISÉS (lot 2c) : arbitrage / retenue par site / canaux sans
  // retenu reposent sur des métriques binaires faussées par les 3 zones (gris
  // en attente comptés en refusés, validation grise = « arbitrage »). Repassent
  // au lot 3 après recalibrage — cf. HITL_ZONES_RECALIBRATION.
  if (!HITL_ZONES_RECALIBRATION) {
    if (rates.arbitrationRate >= ARBITRATION_HIGH_RATE) {
      recs.push(
        `Le taux d'arbitrage manuel est de ${Math.round(rates.arbitrationRate * 100)}%, supérieur au seuil de référence (${Math.round(ARBITRATION_HIGH_RATE * 100)}%) — possible décalage des grilles de scoring avec la réalité du marché.`,
      );
    }
    const sites = siteRetentionStats(reports).sort((a, b) => b.rate - a.rate);
    if (sites.length >= 2) {
      const hi = sites[0]!;
      const lo = sites[sites.length - 1]!;
      if (hi.rate - lo.rate > SITE_RETENTION_GAP_PTS) {
        recs.push(
          `Le site « ${hi.label} » (${hi.rate}% de retenue) présente un taux significativement différent du site « ${lo.label} » (${lo.rate}%) — harmonisation des pratiques à envisager.`,
        );
      }
    }
    if (data.underperformingChannelLabels.length > 0) {
      recs.push(
        `Canaux sans aucun retenu sur la période : ${data.underperformingChannelLabels.join(', ')} — réévaluer leur pertinence ou leur ciblage.`,
      );
    }
  }

  if (recs.length === 0) {
    recs.push(
      'Pilotage conforme sur la période — aucun signal transverse critique. Reconduire le dispositif.',
    );
  }
  return recs.slice(0, 5);
}

export function buildMultiCampaignReportData(
  input: MultiCampaignInput,
): MultiCampaignReportData {
  const { period, filters, reports } = input;
  const allAnalyses = reports.flatMap((r) => r.analyses);
  const aggregateVolumes = computeVolumes(allAnalyses);
  const totalRecruited = allAnalyses.filter((a) => a.recruited).length;
  const contacted = allAnalyses.filter((a) => a.contacted).length;
  const channels = channelPerformance(allAnalyses);
  const scores = allAnalyses.map((a) => a.totalScore);
  const arbitrationRate =
    aggregateVolumes.received > 0
      ? aggregateVolumes.arbitrated / aggregateVolumes.received
      : 0;

  const perCampaign = reports
    .map((r) => perCampaignRow(r.summary))
    .sort((a, b) => b.closedAt.localeCompare(a.closedAt));

  const tthValues = perCampaign
    .map((c) => c.timeToHireDays)
    .filter((d): d is number => d !== null);
  const avgTimeToHireDays =
    tthValues.length > 0
      ? Math.round(tthValues.reduce((a, b) => a + b, 0) / tthValues.length)
      : null;

  const partial: Omit<MultiCampaignReportData, 'recommendations'> = {
    period,
    filters,
    campaignCount: reports.length,
    aggregateVolumes,
    totalRecruited,
    rates: {
      retentionRate: pct(aggregateVolumes.retained, aggregateVolumes.received),
      avgTimeToHireDays,
      arbitrationRate,
      responseRate: pct(contacted, aggregateVolumes.received),
    },
    perCampaign,
    channels,
    topChannelLabels: channels.filter((c) => c.retained > 0).slice(0, 2).map((c) => c.channelLabel),
    underperformingChannelLabels: channels
      .filter((c) => c.volume > 0 && c.retained === 0)
      .map((c) => c.channelLabel),
    scoring: {
      distribution: scoreDistribution(scores),
      stdDev: stdDev(scores),
      average:
        scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : null,
      arbitrationRate,
    },
    rgpd: {
      totalCandidates: aggregateVolumes.received,
      retentionMonths: RGPD_RETENTION_MONTHS,
    },
  };

  return {
    ...partial,
    recommendations: buildMultiCampaignRecommendations(partial, reports),
  };
}

/** Durée totale de la période (jours) — utilitaire d'affichage. */
export function periodDays(period: { from: string; to: string }): number {
  return daysBetween(period.from, period.to);
}
