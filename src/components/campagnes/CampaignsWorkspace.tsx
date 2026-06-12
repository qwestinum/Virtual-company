'use client';

/**
 * Onglet « Campagnes » du workspace recrutement.
 *
 * Héberge la gestion de campagne complète (liste, création, édition, actions de
 * cycle de vie), extraite de `DashboardView` sans changement de logique. Les
 * données candidats viennent de `useDashboardData()` (mêmes stats par carte) ;
 * l'ouverture des sheets d'édition/création se fait par id local, comme avant.
 *
 * L'hydratation du store campagnes est portée par `<HydrationGate />` du
 * workspace recrutement (déjà monté) — rien à initialiser ici.
 */

import { useState } from 'react';

import { useDashboardData } from '@/hooks/useDashboardData';

import { CampaignsList } from './CampaignsList';
import { CampaignCreateSheet } from './edit/CampaignCreateSheet';
import { CampaignEditSheet } from './edit/CampaignEditSheet';

export function CampaignsWorkspace() {
  const { data } = useDashboardData();
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(
    null,
  );
  const [creating, setCreating] = useState(false);

  const candidates = data?.candidates ?? [];

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
        <header style={{ marginBottom: 20 }}>
          <h1
            className="font-display"
            style={{ fontSize: 22, fontWeight: 800, color: 'var(--dash-text)' }}
          >
            Gestion des campagnes
          </h1>
          <p
            className="font-body"
            style={{ marginTop: 4, fontSize: 13, color: 'var(--dash-text-secondary)' }}
          >
            Vos campagnes de recrutement : création, édition, et pilotage du
            cycle de vie (suspendre, arrêter, reprendre).
          </p>
        </header>
        <CampaignsList
          candidates={candidates}
          onEditCampaign={setEditingCampaignId}
          onCreateCampaign={() => setCreating(true)}
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
