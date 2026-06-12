/**
 * Calcul PUR du rapport de campagne (cf. docs/specs/reporting.md §3).
 *
 * CLIENT-SAFE, déterministe, testable : aucune I/O. La route assemble les
 * entrées (campagne, analyses aplaties, envois journal) ; ce module calcule
 * volumes, performances, distribution de scoring et recommandations (RÈGLES
 * simples — pas de LLM dans cette session).
 *
 * Proxies documentés (faute de données plus fines) :
 *   - canal = canal de RÉCEPTION du CV (source), pas d'attribution diffusion ;
 *   - time-to-hire = lancement → clôture quand recrutement (sinon null) ;
 *   - taux de réponse = part des candidats ayant reçu une communication.
 */

import {
  ARBITRATION_HIGH_RATE,
  LOW_VOLUME_THRESHOLD,
  RGPD_RETENTION_MONTHS,
  TIME_TO_HIRE_REFERENCE_DAYS,
  addMonthsIso,
  channelPerformance,
  computeVolumes,
  daysBetween,
  pct,
  scoreDistribution,
  stdDev,
} from '@/lib/reporting/aggregations';
import type {
  CampaignAnalysisDatum,
  CampaignIssueKind,
  CampaignReportData,
  CampaignReportSend,
  CampaignReportSummary,
} from '@/types/reporting';

// Re-export des primitives + seuils mutualisés (API stable : les importeurs
// existants — tests, loader, route — continuent d'importer depuis ce module).
export {
  RGPD_RETENTION_MONTHS,
  TIME_TO_HIRE_REFERENCE_DAYS,
  LOW_VOLUME_THRESHOLD,
  daysBetween,
  computeVolumes,
  scoreDistribution,
  stdDev,
  channelPerformance,
  addMonthsIso,
} from '@/lib/reporting/aggregations';

/** Seuils de retenue propres aux recos d'une campagne unique (internes). */
const RETENTION_LOW = 0.1;
const RETENTION_HIGH = 0.6;

export type CampaignReportMeta = {
  campaignId: string;
  campaignName: string;
  jobTitle: string;
  launchedAt: string;
  closedAt: string;
  donneurOrdre: { label: string; role: string | null } | null;
  donneurOrdreId: string | null;
  siteId: string | null;
  siteLabel: string | null;
};

export function computeIssue(analyses: CampaignAnalysisDatum[]): {
  issue: CampaignIssueKind;
  recruitedCount: number;
} {
  const recruitedCount = analyses.filter((a) => a.recruited).length;
  return { issue: recruitedCount > 0 ? 'recruited' : 'no_hire', recruitedCount };
}

/** Construit le résumé (carte + base du PDF). */
export function buildCampaignReportSummary(
  meta: CampaignReportMeta,
  analyses: CampaignAnalysisDatum[],
  sends: CampaignReportSend[],
  generatedAt: string | null,
): CampaignReportSummary {
  const volumes = computeVolumes(analyses);
  const { issue, recruitedCount } = computeIssue(analyses);
  return {
    campaignId: meta.campaignId,
    campaignName: meta.campaignName,
    jobTitle: meta.jobTitle,
    launchedAt: meta.launchedAt,
    closedAt: meta.closedAt,
    durationDays: daysBetween(meta.launchedAt, meta.closedAt),
    donneurOrdre: meta.donneurOrdre,
    donneurOrdreId: meta.donneurOrdreId,
    siteId: meta.siteId,
    siteLabel: meta.siteLabel,
    volumes,
    issue,
    recruitedCount,
    generatedAt,
    sends: [...sends].sort((a, b) => b.at.localeCompare(a.at)),
  };
}

/** Recommandations par RÈGLES (3 à 5, priorisées). Toujours au moins une. */
export function buildRecommendations(
  data: Omit<CampaignReportData, 'recommendations'>,
): string[] {
  const recs: string[] = [];
  const { summary, performance, channels, scoring } = data;
  const { volumes } = summary;

  if (summary.issue === 'no_hire') {
    recs.push(
      "Campagne clôturée sans recrutement finalisé — réévaluer l'attractivité de l'offre et la pertinence du vivier ciblé.",
    );
  }
  const top = channels[0];
  if (top && volumes.retained > 0 && top.retained > 0) {
    recs.push(
      `Le canal « ${top.channelLabel} » a produit ${pct(top.retained, volumes.retained)}% des candidats retenus — à privilégier pour une campagne similaire.`,
    );
  }
  if (
    performance.timeToHireDays !== null &&
    performance.timeToHireDays > TIME_TO_HIRE_REFERENCE_DAYS
  ) {
    recs.push(
      `Time-to-hire de ${performance.timeToHireDays} jours, supérieur à la référence de ${TIME_TO_HIRE_REFERENCE_DAYS} jours — identifier les goulots d'étranglement (diffusion, validation, entretiens).`,
    );
  }
  if (scoring.arbitrationRate >= ARBITRATION_HIGH_RATE) {
    recs.push(
      `Taux d'arbitrage manuel de ${Math.round(scoring.arbitrationRate * 100)}% — la grille de scoring mériterait une recalibration (verdicts IA souvent corrigés).`,
    );
  }
  const retentionRatio = volumes.received > 0 ? volumes.retained / volumes.received : 0;
  if (volumes.received > 0 && retentionRatio < RETENTION_LOW) {
    recs.push(
      `Taux de retenue de ${performance.retentionRate}% très faible — critères possiblement trop stricts ou sourcing à revoir.`,
    );
  } else if (retentionRatio > RETENTION_HIGH) {
    recs.push(
      `Taux de retenue de ${performance.retentionRate}% élevé — resserrer les critères permettrait de concentrer l'effort sur les meilleurs profils.`,
    );
  }
  if (summary.volumes.received < LOW_VOLUME_THRESHOLD) {
    recs.push(
      `Faible volume (${summary.volumes.received} candidature${summary.volumes.received > 1 ? 's' : ''}) — élargir la diffusion ou prolonger la période la prochaine fois.`,
    );
  }

  if (recs.length === 0) {
    recs.push(
      'Déroulé conforme aux attentes — aucun point critique détecté. Reconduire le dispositif pour les campagnes similaires.',
    );
  }
  return recs.slice(0, 5);
}

/** Construit les données complètes du rapport (alimente le PDF). */
export function buildCampaignReportData(
  summary: CampaignReportSummary,
  analyses: CampaignAnalysisDatum[],
  opts?: { retentionMonths?: number; vivier?: CampaignReportData['vivier'] },
): CampaignReportData {
  const { volumes } = summary;
  const scores = analyses.map((a) => a.totalScore);
  const channels = channelPerformance(analyses);
  const arbitrationRate =
    volumes.received > 0 ? volumes.arbitrated / volumes.received : 0;
  const contacted = analyses.filter((a) => a.contacted).length;
  const retentionMonths = opts?.retentionMonths ?? RGPD_RETENTION_MONTHS;

  const partial: Omit<CampaignReportData, 'recommendations'> = {
    summary,
    performance: {
      retentionRate: pct(volumes.retained, volumes.received),
      timeToHireDays:
        summary.recruitedCount > 0
          ? daysBetween(summary.launchedAt, summary.closedAt)
          : null,
      arbitrationRate,
      responseRate: pct(contacted, volumes.received),
    },
    channels,
    topChannelLabels: channels.filter((c) => c.retained > 0).slice(0, 2).map((c) => c.channelLabel),
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
      retentionMonths,
      plannedDeletionAt: addMonthsIso(summary.closedAt, retentionMonths),
    },
    lowVolume: volumes.received < LOW_VOLUME_THRESHOLD,
    vivier: opts?.vivier ?? null,
  };

  return { ...partial, recommendations: buildRecommendations(partial) };
}
