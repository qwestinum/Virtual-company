'use client';

/**
 * « Activité » — sous-onglet de Pilotage : la répartition par zone, le fil
 * d'activité et l'équipe d'agents.
 *
 * Ces trois blocs occupaient l'écran d'accueil (l'ancien « Bureau »). Ils n'y
 * avaient pas leur place : ils montrent le SYSTÈME au travail, là où le
 * recruteur vient chercher SON travail. Ils ne sont pas supprimés pour autant
 * — l'effet « une équipe au travail » est le différenciateur du produit en
 * démonstration. Ils sont simplement là où l'on regarde la mesure.
 *
 * Aucun chemin de données neuf : même `useDashboardData` qu'avant.
 */

import { AgentDetailsPanel } from '@/components/agents/AgentDetailsPanel';
import { HRDepartmentView } from '@/components/agents/HRDepartmentView';
import { ActivityCard } from '@/components/dashboard/ActivityCard';
import { ZoneDistribution } from '@/components/bureau/ZoneDistribution';
import { useDashboardData } from '@/hooks/useDashboardData';
import { EMPTY_ZONE_COUNTS } from '@/lib/dashboard/derive-metrics';

export function ActivityPanel() {
  const { data } = useDashboardData();

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <ZoneDistribution zones={data?.zones ?? EMPTY_ZONE_COUNTS} />
        <ActivityCard activity={data?.activity ?? []} />
      </div>

      <section className="relative h-[520px] overflow-hidden rounded-[14px] border border-orqa-ligne bg-white">
        <HRDepartmentView />
        <AgentDetailsPanel />
      </section>
    </div>
  );
}
