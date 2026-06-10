/**
 * Primitives d'AGRÉGATION du module Reporting — mutualisées entre le rapport
 * de campagne et le rapport multi-campagnes (cf. docs/specs/reporting.md §3-§4).
 *
 * CLIENT-SAFE, PUR, déterministe, testable : aucune I/O. Source unique des
 * calculs (volumes, taux, durées, distribution de scoring, performance par
 * canal) ET des seuils de référence des recommandations.
 *
 * Seuils = HYPOTHÈSES INITIALES, à recalibrer sur données réelles (cf. spec).
 */

import { CV_SOURCE_LABELS } from '@/types/cv-source';
import type {
  CampaignAnalysisDatum,
  CampaignVolumes,
  ChannelPerformance,
  ScoreBucket,
} from '@/types/reporting';

// ── Seuils de référence (documentés dans docs/specs/reporting.md §4.x) ──────

/** Mois de conservation RGPD appliqués par défaut. */
export const RGPD_RETENTION_MONTHS = 24;
/**
 * Time-to-hire (jours) au-delà duquel on signale un délai élevé. Intention :
 * détecter les campagnes lentes (goulots diffusion/validation/entretien).
 */
export const TIME_TO_HIRE_REFERENCE_DAYS = 45;
/**
 * Taux d'arbitrage manuel au-delà duquel on suspecte un décalage grille ↔
 * réalité du marché (verdicts IA souvent corrigés à la main).
 */
export const ARBITRATION_HIGH_RATE = 0.2;
/**
 * Part des retenus produite par un canal au-delà de laquelle il est jugé
 * dominant (à privilégier sur les prochaines campagnes).
 */
export const CHANNEL_DOMINANT_SHARE = 0.4;
/**
 * Écart (points de %) de taux de retenue entre deux sites au-delà duquel une
 * harmonisation des pratiques est suggérée.
 */
export const SITE_RETENTION_GAP_PTS = 20;
/** En deçà, statistiques individuelles peu significatives. */
export const LOW_VOLUME_THRESHOLD = 5;

// ── Calculs ─────────────────────────────────────────────────────────────────

/** Pourcentage entier `part / whole` (0 si whole = 0). */
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Nombre de jours pleins entre deux dates ISO (≥ 0). */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** Ajoute `months` à une date ISO, renvoie ISO (jour conservé au mieux). */
export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

export function computeVolumes(analyses: CampaignAnalysisDatum[]): CampaignVolumes {
  return {
    received: analyses.length,
    retained: analyses.filter((a) => a.status === 'accepted').length,
    rejected: analyses.filter((a) => a.status === 'rejected').length,
    arbitrated: analyses.filter((a) => a.humanIntervention).length,
  };
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

/** Performance par canal de réception (groupé, taux de retenue, tri retenus). */
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
    r.retentionRate = pct(r.retained, r.volume);
  }
  return rows.sort((a, b) => b.retained - a.retained || b.volume - a.volume);
}
