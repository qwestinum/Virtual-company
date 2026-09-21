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


import { CampaignsList } from './CampaignsList';
import { UnsavedChangesBanner } from './UnsavedChangesBanner';
import { CampaignCreateSheet } from './edit/CampaignCreateSheet';
import type { BlockKey } from './edit/CampaignEditAccordion';
import { CampaignEditSheet } from './edit/CampaignEditSheet';

export function CampaignsWorkspace({
  focusCampaignId = null,
  openCreate = false,
  openSection = null,
}: {
  /**
   * Navigation croisée : un quadrant de carte campagne (« CV reçus »,
   * « Entretiens »…) ouvre l'onglet Candidatures pré-filtré sur la campagne
   * (+ préset du quadrant). Optionnel : absent = quadrants non cliquables.
   */
  /** Campagne à ouvrir, désignée par l'URL (« retour à la campagne »). */
  focusCampaignId?: string | null;
  /**
   * `/campagnes?nouvelle=1` — ouvre la création d'emblée. C'est ce qui rend le
   * raccourci de l'accueil possible sans dupliquer la feuille, et ce qui la
   * rendra adressable quand elle deviendra l'assistant (lot 5) : le raccourci
   * ne changera pas.
   */
  openCreate?: boolean;
  /**
   * Bloc d'édition à ouvrir (`?ouvrir=vivier`). C'est ce qui fait que
   * « Chercher dans le vivier », depuis la carte, dépose devant le vivier —
   * un bouton qui nomme un geste doit déposer devant ce geste.
   */
  openSection?: BlockKey | null;
} = {}) {
  // Une section demandée par l'URL implique d'OUVRIR la campagne : sans ça le
  // lien déposerait sur la liste, et le geste nommé resterait à chercher.
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(
    openSection ? (focusCampaignId ?? null) : null,
  );
  const [creating, setCreating] = useState(openCreate);


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
        <UnsavedChangesBanner />
        <CampaignsList
          focusCampaignId={focusCampaignId}
          onEditCampaign={setEditingCampaignId}
          onCreateCampaign={() => setCreating(true)}
        />
      </div>
      {editingCampaignId ? (
        <CampaignEditSheet
          campaignId={editingCampaignId}
          initialSection={openSection ?? undefined}
          onClose={() => setEditingCampaignId(null)}
        />
      ) : null}
      {creating ? (
        <CampaignCreateSheet onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}
