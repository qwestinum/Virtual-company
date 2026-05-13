'use client';

/**
 * Boutons d'action de statut sur une carte campagne (Session 6).
 *
 * Combinaison disponible selon le statut courant :
 *   - active   → Suspendre, Éditer, Clôturer
 *   - paused   → Reprendre, Éditer, Clôturer
 *   - draft / in_progress → Activer, Éditer
 *   - closed   → (lecture seule, juste Éditer)
 *
 * Chaque action mute le store + déclenche la prise d'acte du Manager
 * via `pushManagerAcknowledgment` (cf. spec §6.3 — synchronisation
 * chat/interface). Clôture demande une confirmation native (browser
 * confirm()) car elle est irréversible.
 */

import {
  pushManagerAcknowledgment,
  type AcknowledgmentAction,
} from '@/lib/chat/manager-acknowledgments';
import { useCampaignsStore } from '@/stores/campaigns-store';

export type CampaignActionStatus =
  | 'active'
  | 'paused'
  | 'draft'
  | 'in_progress'
  | 'closed';

export type CampaignStatusActionsProps = {
  status: CampaignActionStatus;
  campaignId: string;
  onEdit: () => void;
};

export function CampaignStatusActions({
  status,
  campaignId,
  onEdit,
}: CampaignStatusActionsProps) {
  const updateStatus = useCampaignsStore((s) => s.updateStatus);
  const getById = useCampaignsStore((s) => s.getById);

  const ack = (kind: AcknowledgmentAction['kind']) => {
    const camp = getById(campaignId);
    if (!camp) return;
    if (
      kind === 'campaign_paused' ||
      kind === 'campaign_resumed' ||
      kind === 'campaign_closed' ||
      kind === 'campaign_activated'
    ) {
      pushManagerAcknowledgment({
        kind,
        campaignId,
        campaignName: camp.name,
      });
    }
  };

  const onPause = () => {
    updateStatus(campaignId, 'paused');
    ack('campaign_paused');
  };
  const onResume = () => {
    updateStatus(campaignId, 'active');
    ack('campaign_resumed');
  };
  const onActivate = () => {
    updateStatus(campaignId, 'active');
    ack('campaign_activated');
  };
  const onClose = () => {
    const ok = window.confirm(
      'Clôturer cette campagne ? Cette action est définitive — les agents arrêteront tout traitement automatique.',
    );
    if (!ok) return;
    updateStatus(campaignId, 'closed');
    ack('campaign_closed');
  };

  return (
    <>
      {status === 'active' ? (
        <ActionButton
          variant="warning"
          icon="⏸"
          label="Suspendre"
          onClick={onPause}
        />
      ) : null}
      {status === 'paused' ? (
        <ActionButton
          variant="success"
          icon="▶️"
          label="Reprendre"
          onClick={onResume}
        />
      ) : null}
      {status === 'draft' || status === 'in_progress' ? (
        <ActionButton
          variant="success"
          icon="🚀"
          label="Activer"
          onClick={onActivate}
        />
      ) : null}
      <ActionButton
        variant="neutral"
        icon="✏️"
        label="Éditer"
        onClick={onEdit}
      />
      {status === 'active' || status === 'paused' ? (
        <ActionButton
          variant="danger"
          icon="⏹"
          label="Clôturer"
          onClick={onClose}
        />
      ) : null}
    </>
  );
}

type Variant = 'success' | 'warning' | 'danger' | 'neutral';

function ActionButton({
  variant,
  icon,
  label,
  onClick,
}: {
  variant: Variant;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  const styles: Record<Variant, { bg: string; color: string }> = {
    success: {
      bg: 'rgba(21,163,100,0.1)',
      color: 'var(--dash-green)',
    },
    warning: {
      bg: 'rgba(213,160,0,0.12)',
      color: 'var(--dash-yellow)',
    },
    danger: {
      bg: 'rgba(229,72,77,0.08)',
      color: 'var(--dash-red)',
    },
    neutral: {
      bg: 'var(--dash-surface)',
      color: 'var(--dash-text-secondary)',
    },
  };
  const s = styles[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-body"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '6px 14px',
        borderRadius: 8,
        border: variant === 'neutral' ? '1px solid var(--dash-border)' : 'none',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 600,
        transition: 'filter 0.15s',
        background: s.bg,
        color: s.color,
      }}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  );
}
