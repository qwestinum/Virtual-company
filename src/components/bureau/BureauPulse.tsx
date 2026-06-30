'use client';

/**
 * Colonne gauche du Bureau — le « pouls » de la solution (récit Process First).
 * Répartition par zone (ce que la solution traite) + fil d'activité (la preuve
 * vivante qu'elle travaille). RÉUTILISE `useDashboardData` (même endpoint/hook
 * que le dashboard admin, pas de 2e chemin de données) + `ActivityCard` (prop
 * `fill`). Seul `ZoneDistribution` est neuf.
 */

import { ActivityCard } from '@/components/dashboard/ActivityCard';
import { useDashboardData } from '@/hooks/useDashboardData';
import { EMPTY_ZONE_COUNTS } from '@/lib/dashboard/derive-metrics';

import { ZoneDistribution } from './ZoneDistribution';

export function BureauPulse() {
  const { data } = useDashboardData();
  const zones = data?.zones ?? EMPTY_ZONE_COUNTS;
  const activity = data?.activity ?? [];

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col gap-3 overflow-hidden border-r border-orqa-ligne bg-orqa-brume p-3">
      <ZoneDistribution zones={zones} />
      <ActivityCard activity={activity} fill />
    </aside>
  );
}
