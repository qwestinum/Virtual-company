'use client';

/**
 * Sheet latéral d'édition d'une campagne (Session 6).
 *
 * Slide-in à droite, overlay sombre cliquable pour fermer. Accueille
 * l'accordéon des 5 blocs éditables (FDP, Scoring, Canaux, Seuil,
 * Cycle de vie). Le composant gère uniquement le chrome ; chaque bloc
 * implémente ses propres mutations + prise d'acte Manager.
 *
 * Ferme sur :
 *   - clic sur l'overlay
 *   - bouton ✕
 *   - touche Escape
 */

import { useEffect } from 'react';

import { useCampaignsStore } from '@/stores/campaigns-store';

import { StatusPill, type PillKind } from '../StatusPill';
import { CampaignEditAccordion } from './CampaignEditAccordion';

export type CampaignEditSheetProps = {
  campaignId: string;
  onClose: () => void;
};

export function CampaignEditSheet({
  campaignId,
  onClose,
}: CampaignEditSheetProps) {
  const campaign = useCampaignsStore((s) => s.byId[campaignId] ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  if (!campaign) {
    return null;
  }

  const pillKind: PillKind =
    campaign.status === 'active'
      ? 'active'
      : campaign.status === 'paused'
        ? 'paused'
        : campaign.status === 'closed'
          ? 'closed'
          : 'draft';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Éditer ${campaign.name}`}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(2px)',
          border: 'none',
          cursor: 'pointer',
        }}
      />
      <aside
        style={{
          position: 'relative',
          width: 'min(560px, 100%)',
          height: '100%',
          background: 'var(--dash-surface)',
          boxShadow: '-20px 0 40px rgba(0,0,0,0.15)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'dash-fade-in 0.25s ease both',
        }}
      >
        <header
          style={{
            padding: '20px 22px 14px',
            borderBottom: '1px solid var(--dash-border)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h2
              className="font-display"
              style={{
                fontSize: 19,
                fontWeight: 800,
                margin: '0 0 8px',
                color: 'var(--dash-text)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span
                className="font-data"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--dash-text-tertiary)',
                  background: 'var(--dash-hover)',
                  padding: '2px 8px',
                  borderRadius: 6,
                  letterSpacing: '0.04em',
                }}
              >
                {campaign.id}
              </span>
              <span>{campaign.name}</span>
            </h2>
            <StatusPill kind={pillKind} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 22,
              color: 'var(--dash-text-tertiary)',
              padding: 4,
            }}
          >
            ×
          </button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px 28px' }}>
          <CampaignEditAccordion campaign={campaign} onClose={onClose} />
        </div>
      </aside>
    </div>
  );
}
