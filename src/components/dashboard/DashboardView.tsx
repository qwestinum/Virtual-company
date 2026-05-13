'use client';

/**
 * Vue racine du dashboard (Session 6).
 *
 * Compose toutes les sections : header, KPIs, campagnes, et la bottom
 * grid candidats + activité + agents. Gère aussi l'ouverture du Sheet
 * d'édition campagne via un id local — pas de routing modal externe
 * pour rester self-contained.
 *
 * La largeur disponible est partagée avec le chat à droite : la grille
 * KPI s'auto-ajuste (minmax(140px, 1fr)) et la bottom grid devient
 * une colonne quand l'espace manque (< 900px).
 */

import { useState } from 'react';

import type {
  ActivityItem,
  AgentMetric,
  CandidateRow,
} from '@/lib/dashboard/derive-metrics';
import { useDashboardData } from '@/hooks/useDashboardData';

import { ActivityCard } from './ActivityCard';
import { AgentsCard } from './AgentsCard';
import { CampaignsList } from './CampaignsList';
import { CandidatesCard } from './CandidatesCard';
import { DashboardHeader } from './DashboardHeader';
import { KPIGrid } from './KPIGrid';
import { CampaignCreateSheet } from './edit/CampaignCreateSheet';
import { CampaignEditSheet } from './edit/CampaignEditSheet';

export function DashboardView() {
  const { data, isStale, refresh } = useDashboardData();
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(
    null,
  );
  const [creating, setCreating] = useState(false);

  const offline = data?.offline ?? false;
  const kpis = data?.kpis ?? {
    cvReceived: 0,
    shortlisted: 0,
    interviews: 0,
    go: 0,
    conversion: 0,
    costEstimate: 0,
  };
  const candidates = data?.candidates ?? [];
  const agents = data?.agents ?? [];
  const activity = data?.activity ?? [];

  return (
    <div
      className="font-body"
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        background: 'transparent',
        color: 'var(--dash-text)',
      }}
    >
      <div style={{ padding: '24px 28px 60px', maxWidth: 1400, margin: '0 auto' }}>
        <DashboardHeader offline={offline} isStale={isStale} />
        <KPIGrid kpis={kpis} />
        <CampaignsList
          candidates={candidates}
          onEditCampaign={setEditingCampaignId}
          onCreateCampaign={() => setCreating(true)}
        />
        <BottomGrid
          candidates={candidates}
          activity={activity}
          agents={agents}
          onCandidateAction={refresh}
        />
      </div>
      {editingCampaignId ? (
        <CampaignEditSheet
          campaignId={editingCampaignId}
          onClose={() => setEditingCampaignId(null)}
        />
      ) : null}
      {creating ? (
        <CampaignCreateSheet onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}

function BottomGrid({
  candidates,
  activity,
  agents,
  onCandidateAction,
}: {
  candidates: CandidateRow[];
  activity: ActivityItem[];
  agents: AgentMetric[];
  onCandidateAction: () => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: 20,
        marginTop: 24,
      }}
    >
      <CandidatesCard candidates={candidates} onAction={onCandidateAction} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <ActivityCard activity={activity} />
        <AgentsCard agents={agents} />
      </div>
    </div>
  );
}
