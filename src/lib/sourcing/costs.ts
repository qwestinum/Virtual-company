/**
 * Suivi d'exploitation du module Sourcing — PUR.
 *
 * Le coût du moteur de profils et de la rédaction des requêtes est un coût
 * d'exploitation, inclus dans l'abonnement : il ne s'affiche JAMAIS au
 * recruteur, seulement au tableau de bord d'administration, à côté du coût IA.
 * Découpage par MOIS (heure de Paris) : c'est la maille d'une facture.
 */
import { DateTime } from 'luxon';

export type SearchCostRow = { createdAt: string; exaCostUsd: number | null };
export type GenerationCostRow = { createdAt: string; llmCostUsd: number | null };

export type CostBucket = {
  /** `YYYY-MM`, heure de Paris. */
  month: string;
  searches: number;
  exaCostUsd: number;
  /** Recherches dont le moteur n'a pas communiqué de coût — dit, jamais compté zéro en silence. */
  searchesWithoutCost: number;
  generations: number;
  llmCostUsd: number;
};

export type SourcingCostSummary = { months: CostBucket[]; total: Omit<CostBucket, 'month'> };

const monthOf = (iso: string): string =>
  DateTime.fromISO(iso, { zone: 'utc' }).setZone('Europe/Paris').toFormat('yyyy-LL');

const round = (v: number): number => Math.round(v * 10_000) / 10_000;

/** Les `monthsBack` derniers mois, du plus récent au plus ancien, mois vides compris. */
export function aggregateSourcingCosts(
  searches: SearchCostRow[],
  generations: GenerationCostRow[],
  now: Date,
  monthsBack = 12,
): SourcingCostSummary {
  const current = DateTime.fromJSDate(now).setZone('Europe/Paris').startOf('month');
  const buckets = new Map<string, CostBucket>();
  for (let i = 0; i < monthsBack; i++) {
    const month = current.minus({ months: i }).toFormat('yyyy-LL');
    buckets.set(month, { month, searches: 0, exaCostUsd: 0, searchesWithoutCost: 0, generations: 0, llmCostUsd: 0 });
  }

  for (const s of searches) {
    const b = buckets.get(monthOf(s.createdAt));
    if (!b) continue;
    b.searches += 1;
    if (s.exaCostUsd === null) b.searchesWithoutCost += 1;
    else b.exaCostUsd += s.exaCostUsd;
  }
  for (const g of generations) {
    const b = buckets.get(monthOf(g.createdAt));
    if (!b) continue;
    b.generations += 1;
    b.llmCostUsd += g.llmCostUsd ?? 0;
  }

  const months = [...buckets.values()].map((b) => ({ ...b, exaCostUsd: round(b.exaCostUsd), llmCostUsd: round(b.llmCostUsd) }));
  const total = months.reduce(
    (t, b) => ({
      searches: t.searches + b.searches,
      exaCostUsd: round(t.exaCostUsd + b.exaCostUsd),
      searchesWithoutCost: t.searchesWithoutCost + b.searchesWithoutCost,
      generations: t.generations + b.generations,
      llmCostUsd: round(t.llmCostUsd + b.llmCostUsd),
    }),
    { searches: 0, exaCostUsd: 0, searchesWithoutCost: 0, generations: 0, llmCostUsd: 0 },
  );
  return { months, total };
}

/** Borne basse de la fenêtre agrégée (début du plus ancien mois), en ISO UTC. */
export function costWindowStart(now: Date, monthsBack = 12): string {
  return (
    DateTime.fromJSDate(now).setZone('Europe/Paris').startOf('month').minus({ months: monthsBack - 1 }).toUTC().toISO() ??
    new Date(0).toISOString()
  );
}
