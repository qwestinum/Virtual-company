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

import { canActivate } from '@/lib/campaign/lifecycle';
import { formatMissingPhases } from '@/lib/campaign/phase-labels';
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
  const activateCampaign = useCampaignsStore((s) => s.activateCampaign);
  const resumeCampaign = useCampaignsStore((s) => s.resumeCampaign);
  // Lecture RÉACTIVE de la campagne : la disponibilité d'« Activer » suit l'état
  // de la machine (canActivate) sans dépendre d'un re-render parent.
  const camp = useCampaignsStore((s) => s.byId[campaignId]);

  const ack = (kind: AcknowledgmentAction['kind']) => {
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

  const activation = camp ? canActivate(camp.lifecycle) : { ok: false, missing: [] };

  const onPause = () => {
    updateStatus(campaignId, 'paused');
    ack('campaign_paused');
  };
  const onResume = () => {
    resumeCampaign(campaignId);
    ack('campaign_resumed');
  };
  const onActivate = () => {
    // Verrou déterministe : le store refuse si la campagne n'est pas prête.
    if (!activateCampaign(campaignId)) return;
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
          disabled={!activation.ok}
          title={
            activation.ok
              ? undefined
              : `Validez d'abord ${formatMissingPhases(activation.missing)} avant d'activer.`
          }
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
  disabled = false,
  title,
}: {
  variant: Variant;
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
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
      disabled={disabled}
      title={title}
      className="font-body"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '6px 14px',
        borderRadius: 8,
        border: variant === 'neutral' ? '1px solid var(--dash-border)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12,
        fontWeight: 600,
        transition: 'filter 0.15s',
        background: s.bg,
        color: s.color,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  );
}
