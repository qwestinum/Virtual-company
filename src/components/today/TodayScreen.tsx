'use client';

/**
 * *Aujourd'hui* — l'écran d'arrivée : ce qui vous attend, et rien d'autre.
 *
 * Il remplace le « Bureau », qui montrait la constellation des agents : une
 * image du SYSTÈME, là où le recruteur vient chercher SON travail. L'équipe
 * reste, ramenée à une bande de six chiffres ; le détail vit dans Pilotage.
 *
 * Ce fichier ne porte QUE le chargement. Toute la mise en page vit dans
 * `TodayBoardView`, qui se rend sans base ni session.
 */

import { useShallow } from 'zustand/react/shallow';

import { useDashboardData } from '@/hooks/useDashboardData';
import { selectActiveCampaigns, useCampaignsStore } from '@/stores/campaigns-store';

import { TodayBoardView } from './TodayBoardView';
import { useTodayBoard } from './useTodayBoard';
import { useTodayContext } from './useTodayContext';

export function TodayScreen() {
  const state = useTodayBoard();
  const context = useTodayContext();
  const { data } = useDashboardData();
  const campaigns = useCampaignsStore(useShallow(selectActiveCampaigns));

  /** L'intitulé du poste vient du briefing quand il l'a, du store sinon. */
  const campaignLabel = (id: string | null, jobTitle?: string | null) => {
    if (!id) return jobTitle ?? '—';
    const titre =
      jobTitle ??
      (() => {
        const v = campaigns.find((c) => c.id === id)?.fdp.fields.job_title?.value;
        return typeof v === 'string' && v.trim() ? v.trim() : null;
      })();
    return titre ? `${id} · ${titre}` : id;
  };

  if (state.kind === 'loading') {
    return (
      <div className="h-full overflow-auto px-6 py-6">
        <p
          className="font-body mx-auto w-full max-w-4xl"
          style={{ fontSize: 13, color: 'var(--dash-text-secondary)' }}
        >
          Chargement…
        </p>
      </div>
    );
  }

  return (
    <TodayBoardView
      board={state.board}
      firstName={context.firstName}
      agentCounts={context.agentCounts}
      zones={data?.zones ?? null}
      campaignLabel={campaignLabel}
      partial={state.partial}
      onReload={state.reload}
    />
  );
}
