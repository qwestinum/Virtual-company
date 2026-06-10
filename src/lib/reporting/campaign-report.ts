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

import { CV_SOURCE_LABELS } from '@/types/cv-source';
import type {
  CampaignAnalysisDatum,
  CampaignIssueKind,
  CampaignReportData,
  CampaignReportSend,
  CampaignReportSummary,
  CampaignVolumes,
  ChannelPerformance,
  ScoreBucket,
} from '@/types/reporting';

/** Mois de conservation RGPD par défaut (référence documentée, pas de réglage). */
export const RGPD_RETENTION_MONTHS = 24;
/** Référence time-to-hire (jours) faute de baseline historique stockée. */
export const TIME_TO_HIRE_REFERENCE_DAYS = 45;
/** Seuils de déclenchement des recommandations. */
const ARBITRATION_HIGH = 0.2;
const RETENTION_LOW = 0.1;
const RETENTION_HIGH = 0.6;
/** En deçà, statistiques peu significatives (encart PDF + reco). */
export const LOW_VOLUME_THRESHOLD = 5;

export type CampaignReportMeta = {
  campaignId: string;
  campaignName: string;
  jobTitle: string;
  launchedAt: string;
  closedAt: string;
  donneurOrdre: { label: string; role: string | null } | null;
  donneurOrdreId: string | null;
  siteLabel: string | null;
};

/** Nombre de jours pleins entre deux dates ISO (≥ 0). */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export function computeVolumes(analyses: CampaignAnalysisDatum[]): CampaignVolumes {
  return {
    received: analyses.length,
    retained: analyses.filter((a) => a.status === 'accepted').length,
    rejected: analyses.filter((a) => a.status === 'rejected').length,
    arbitrated: analyses.filter((a) => a.humanIntervention).length,
  };
}

export function computeIssue(analyses: CampaignAnalysisDatum[]): {
  issue: CampaignIssueKind;
  recruitedCount: number;
} {
  const recruitedCount = analyses.filter((a) => a.recruited).length;
  return { issue: recruitedCount > 0 ? 'recruited' : 'no_hire', recruitedCount };
}

/** Distribution des scores en 5 tranches (alignées sur les paliers ORQA). */
export function scoreDistribution(scores: number[]): ScoreBucket[] {
  const buckets: ScoreBucket[] = [
    { label: '0–39', count: 0 },
    { label: '40–59', count: 0 },
    { label: '60–74', count: 0 },
    { label: '75–89', count: 0 },
    { label: '90–100', count: 0 },
  ];
  for (const s of scores) {
    const i = s < 40 ? 0 : s < 60 ? 1 : s < 75 ? 2 : s < 90 ? 3 : 4;
    buckets[i]!.count += 1;
  }
  return buckets;
}

/** Écart-type (population) ; null si moins de 2 valeurs. */
export function stdDev(scores: number[]): number | null {
  if (scores.length < 2) return null;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance =
    scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  return Math.round(Math.sqrt(variance) * 10) / 10;
}

export function channelPerformance(
  analyses: CampaignAnalysisDatum[],
): ChannelPerformance[] {
  const by = new Map<string, ChannelPerformance>();
  for (const a of analyses) {
    const channelLabel = CV_SOURCE_LABELS[a.source] ?? a.source;
    const row =
      by.get(channelLabel) ??
      { channelLabel, volume: 0, retained: 0, retentionRate: 0, recruited: 0 };
    row.volume += 1;
    if (a.status === 'accepted') row.retained += 1;
    if (a.recruited) row.recruited += 1;
    by.set(channelLabel, row);
  }
  const rows = [...by.values()];
  for (const r of rows) {
    r.retentionRate = r.volume > 0 ? Math.round((r.retained / r.volume) * 100) : 0;
  }
  return rows.sort((a, b) => b.retained - a.retained || b.volume - a.volume);
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Ajoute `months` à une date ISO, renvoie ISO (jour conservé au mieux). */
export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
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
  if (scoring.arbitrationRate >= ARBITRATION_HIGH) {
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
  opts?: { retentionMonths?: number },
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
  };

  return { ...partial, recommendations: buildRecommendations(partial) };
}
