'use client';

/**
 * Édition des canaux de diffusion (Session 6).
 *
 * Toggles par canal sur la liste de `PUBLICATION_CHANNEL_ORDER`. Quand
 * un canal est activé, on l'ajoute à `publishedChannels` ; désactiver
 * le retire (le Publisher arrête la diffusion). Spec §6.3 — chaque
 * changement déclenche une prise d'acte du Manager.
 *
 * Side-effect : `sourcesConfirmed` passe à true dès qu'au moins un
 * canal est actif (la confirmation des sources). C'est cohérent avec
 * le flow existant côté chat.
 */

import { useState } from 'react';

import { pushManagerAcknowledgment } from '@/lib/chat/manager-acknowledgments';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import { useCampaignsStore } from '@/stores/campaigns-store';
import {
  PUBLICATION_CHANNEL_LABELS,
  PUBLICATION_CHANNEL_ORDER,
  type PublicationChannel,
} from '@/types/publication-channel';

import { SaveBanner } from './SaveBanner';

const FLASH_MS = 3000;

export type ChannelsEditBlockProps = {
  campaign: ActiveCampaign;
};

export function ChannelsEditBlock({ campaign }: ChannelsEditBlockProps) {
  const markPublished = useCampaignsStore((s) => s.markPublishedChannel);
  const markSources = useCampaignsStore((s) => s.markSourcesConfirmed);
  const updateState = useCampaignsStore.setState;
  const [flash, setFlash] = useState<string | null>(null);

  const setChannelEnabled = (
    channel: PublicationChannel,
    enabled: boolean,
  ) => {
    if (enabled) {
      markPublished(campaign.id, channel);
      markSources(campaign.id);
    } else {
      // Retrait : pas de mutator dédié dans le store — patch direct.
      updateState((state) => {
        const current = state.byId[campaign.id];
        if (!current) return state;
        return {
          ...state,
          byId: {
            ...state.byId,
            [campaign.id]: {
              ...current,
              publishedChannels: current.publishedChannels.filter(
                (c) => c !== channel,
              ),
              updatedAt: new Date().toISOString(),
            },
          },
        };
      });
    }
    pushManagerAcknowledgment({
      kind: 'channel_toggled',
      campaignId: campaign.id,
      campaignName: campaign.name,
      channel: PUBLICATION_CHANNEL_LABELS[channel],
      enabled,
    });
    setFlash(
      enabled
        ? `${PUBLICATION_CHANNEL_LABELS[channel]} activé — la diffusion repart sur ce canal.`
        : `${PUBLICATION_CHANNEL_LABELS[channel]} désactivé — les autres canaux continuent.`,
    );
    window.setTimeout(() => setFlash(null), FLASH_MS);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SaveBanner message={flash} />
      {PUBLICATION_CHANNEL_ORDER.map((channel) => {
        const enabled = campaign.publishedChannels.includes(channel);
        return (
          <ChannelToggle
            key={channel}
            label={PUBLICATION_CHANNEL_LABELS[channel]}
            enabled={enabled}
            onToggle={() => setChannelEnabled(channel, !enabled)}
          />
        );
      })}
    </div>
  );
}

function ChannelToggle({
  label,
  enabled,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderRadius: 10,
        background: enabled
          ? 'var(--dash-green-light)'
          : 'var(--dash-warm)',
        border: `1px solid ${enabled ? 'var(--dash-green)' : 'var(--dash-border)'}`,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <span
        className="font-body"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: enabled
            ? 'var(--dash-green)'
            : 'var(--dash-text-secondary)',
        }}
      >
        {label}
      </span>
      <ToggleSwitch on={enabled} />
    </button>
  );
}

function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'relative',
        width: 34,
        height: 18,
        borderRadius: 999,
        background: on ? 'var(--dash-green)' : 'var(--dash-border-strong)',
        transition: 'background 0.15s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 18 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }}
      />
    </span>
  );
}
