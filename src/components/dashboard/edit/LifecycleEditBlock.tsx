'use client';

/**
 * Bloc cycle de vie d'une campagne (Session 6).
 *
 * Boutons d'action sur le statut, identiques à ceux de la carte
 * campagne mais regroupés ici avec un libellé explicite et une zone
 * dédiée. Permet aussi de fermer le Sheet après une clôture pour ne
 * pas laisser le DRH éditer une campagne fermée.
 */

import { pushManagerAcknowledgment } from '@/lib/chat/manager-acknowledgments';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import { useCampaignsStore } from '@/stores/campaigns-store';

export type LifecycleEditBlockProps = {
  campaign: ActiveCampaign;
  onClose: () => void;
};

export function LifecycleEditBlock({
  campaign,
  onClose,
}: LifecycleEditBlockProps) {
  const updateStatus = useCampaignsStore((s) => s.updateStatus);

  const ack = (
    kind:
      | 'campaign_paused'
      | 'campaign_resumed'
      | 'campaign_closed'
      | 'campaign_activated',
  ) =>
    pushManagerAcknowledgment({
      kind,
      campaignId: campaign.id,
      campaignName: campaign.name,
    });

  const onPause = () => {
    updateStatus(campaign.id, 'paused');
    ack('campaign_paused');
  };
  const onResume = () => {
    updateStatus(campaign.id, 'active');
    ack('campaign_resumed');
  };
  const onActivate = () => {
    updateStatus(campaign.id, 'active');
    ack('campaign_activated');
  };
  const onCloseCampaign = () => {
    const ok = window.confirm(
      'Clôturer cette campagne ? Les agents arrêteront tout traitement automatique.',
    );
    if (!ok) return;
    updateStatus(campaign.id, 'closed');
    ack('campaign_closed');
    onClose();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {campaign.status === 'active' ? (
        <ActionRow
          label="Suspendre la campagne"
          hint="La veille du CV Analyzer est mise en pause. Les candidatures reçues sont mises en file d’attente."
          onClick={onPause}
          variant="warning"
        />
      ) : null}
      {campaign.status === 'paused' ? (
        <ActionRow
          label="Reprendre la campagne"
          hint="La veille redémarre, les candidatures en attente sont traitées."
          onClick={onResume}
          variant="success"
        />
      ) : null}
      {campaign.status === 'draft' || campaign.status === 'in_progress' ? (
        <ActionRow
          label="Activer la campagne"
          hint="La diffusion démarre et le CV Analyzer écoute la boîte mail."
          onClick={onActivate}
          variant="success"
        />
      ) : null}
      {campaign.status === 'active' || campaign.status === 'paused' ? (
        <ActionRow
          label="Clôturer la campagne"
          hint="Action définitive. Le bilan est généré et les agents libérés."
          onClick={onCloseCampaign}
          variant="danger"
        />
      ) : null}
    </div>
  );
}

function ActionRow({
  label,
  hint,
  onClick,
  variant,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  variant: 'success' | 'warning' | 'danger';
}) {
  const palette: Record<typeof variant, { bg: string; color: string }> = {
    success: {
      bg: 'var(--dash-green-light)',
      color: 'var(--dash-green)',
    },
    warning: {
      bg: 'var(--dash-yellow-light)',
      color: 'var(--dash-yellow)',
    },
    danger: {
      bg: 'var(--dash-red-light)',
      color: 'var(--dash-red)',
    },
  };
  const p = palette[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '12px 14px',
        borderRadius: 10,
        border: 'none',
        background: p.bg,
        color: p.color,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span
        className="font-display"
        style={{ fontSize: 13, fontWeight: 700 }}
      >
        {label}
      </span>
      <span
        className="font-body"
        style={{
          fontSize: 12,
          fontWeight: 400,
          opacity: 0.85,
          color: p.color,
        }}
      >
        {hint}
      </span>
    </button>
  );
}
