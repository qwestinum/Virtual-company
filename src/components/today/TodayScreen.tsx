'use client';

import { useState } from 'react';

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

import type { BandWindow } from '@/lib/today/agents-band';

import { TodayBoardView } from './TodayBoardView';
import { useTodayBoard } from './useTodayBoard';
import { useTodayTeam } from './useTodayTeam';

export function TodayScreen() {
  const state = useTodayBoard();
  // La fenêtre d'activité de la bande — « cette semaine » ou « ce mois-ci ».
  // Elle vit ICI parce qu'elle décide de la REQUÊTE, pas seulement du texte.
  const [fenetre, setFenetre] = useState<BandWindow>('semaine');
  const team = useTodayTeam(fenetre);
  // On ne sonde PAS depuis ici : seule la bande de répartition vient de cette
  // route, et elle ne bouge pas entre deux clics. Rechargée à chaque affichage.
  const { data } = useDashboardData({ poll: false });
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

  // ⚠️ PLUS D'ÉCRAN D'ATTENTE GLOBAL. Un « Chargement… » qui remplace toute la
  // page fait payer à l'écran entier le prix de la lecture la plus lente :
  // mesuré, rien ne se peignait avant 1,5 s. La vue se rend tout de suite, et
  // chaque carte porte son propre squelette jusqu'à ce que SA donnée arrive.
  return (
    <TodayBoardView
      fenetre={fenetre}
      onFenetre={setFenetre}
      board={state.board}
      pending={state.pending}
      currentUserId={state.currentUserId}
      firstName={team.firstName}
      agentCounts={team.agentCounts}
      zones={data?.zones ?? null}
      campaignLabel={campaignLabel}
      partial={state.partial}
      onReload={state.reload}
    />
  );
}
