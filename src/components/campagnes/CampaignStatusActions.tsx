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
 * chat/interface). La clôture passe par `CampaignDismissFlowDialog`
 * (récapitulatif des candidatures en cours + classement sans suite optionnel,
 * POST /api/campaigns/[id]/close — qui pose closed_at), plus jamais un
 * window.confirm silencieux.
 */

import { useState } from 'react';

import { CampaignDismissFlowDialog } from '@/components/campagnes/CampaignDismissFlowDialog';
import { canActivate } from '@/lib/campaign/lifecycle';

import { ActionButton } from './ActionButton';
import { formatMissingPhases } from '@/lib/campaign/phase-labels';
import {
  pushManagerAcknowledgment,
  type AcknowledgmentAction,
} from '@/lib/chat/manager-acknowledgments';
import { triggerVivierPreselection } from '@/lib/vivier/trigger-preselection';
import { nouvelleCampagneHref } from '@/lib/navigation/workspace-routes';
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
    // Source Vivier cochée ⇒ déclenche la présélection (endpoint idempotent).
    if (camp?.sources.includes('vivier')) {
      triggerVivierPreselection(campaignId);
    }
  };
  const [closing, setClosing] = useState(false);
  const onClosed = () => {
    setClosing(false);
    // Le serveur a déjà posé status='closed' + closed_at ; on aligne le store
    // (le PUT snapshot re-poussera le même statut, sans toucher closed_at).
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
      {/* Un brouillon se REPREND là où il en est — c'est la contrepartie du
          « vous pouvez fermer » de l'assistant : sans porte de retour, la
          promesse serait vide. « Continuer la création » et non « Reprendre »,
          déjà pris par la sortie de pause. */}
      {status === 'draft' || status === 'in_progress' ? (
        <ActionButton
          variant="neutral"
          icon="✍️"
          label="Continuer la création"
          href={nouvelleCampagneHref(campaignId)}
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
          onClick={() => setClosing(true)}
        />
      ) : null}
      {closing ? (
        <CampaignDismissFlowDialog
          campaignId={campaignId}
          mode="close"
          onCancel={() => setClosing(false)}
          onDone={onClosed}
        />
      ) : null}
    </>
  );
}
