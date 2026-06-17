'use client';

/**
 * Édition complète et inline de la fiche de poste (Session 6 v2).
 *
 * L'utilisateur ne passe plus par le chat Manager pour modifier la FDP.
 * Tous les champs sont éditables ici, et un bouton « Enregistrer » écrit
 * la nouvelle version dans `campaigns-store` (qui se sync sur Supabase)
 * et pose une bannière de confirmation avec le résumé de l'impact.
 *
 * Si la FDP redevient incomplète après édition, on dévalide la FDP
 * (`isValidated = false`) et on remonte la campagne en `draft` —
 * cohérent avec le state machine déjà en place.
 */

import { useState } from 'react';

import { resolveFdpEditSave } from '@/lib/campaign/fdp-edit';
import { pushManagerAcknowledgment } from '@/lib/chat/manager-acknowledgments';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import { useCampaignsStore } from '@/stores/campaigns-store';
import {
  computeIsComplete,
  type FDPInProgress,
  type FieldKey,
  type FieldStatus,
} from '@/types/field-collection';

import { FDPInlineEditor } from './FDPInlineEditor';
import { SaveBanner, SaveFooter } from './SaveBanner';

const FLASH_MS = 3000;

export type FDPEditBlockProps = {
  campaign: ActiveCampaign;
};

export function FDPEditBlock({ campaign }: FDPEditBlockProps) {
  return (
    <FDPEditInner
      key={`${campaign.id}-${campaign.updatedAt}`}
      campaign={campaign}
    />
  );
}

function FDPEditInner({ campaign }: FDPEditBlockProps) {
  const [draft, setDraft] = useState<FDPInProgress>(() => ({
    ...campaign.fdp,
    fields: { ...campaign.fdp.fields },
  }));
  const [flash, setFlash] = useState<string | null>(null);
  const addCampaign = useCampaignsStore((s) => s.addCampaign);
  const recomputeStatus = useCampaignsStore((s) => s.recomputeStatus);

  const dirty = !sameFDP(draft, campaign.fdp);

  const patchField = (key: FieldKey, value: unknown) => {
    setDraft((current) => {
      const prev = current.fields[key];
      const filled = isFilled(value);
      const nextField: FieldStatus = {
        ...prev!,
        value,
        status: filled ? 'filled' : 'empty',
      };
      const nextFields = { ...current.fields, [key]: nextField };
      return {
        ...current,
        fields: nextFields,
        isComplete: computeIsComplete(nextFields),
      };
    });
  };

  const onSave = () => {
    const wasValidated = campaign.fdp.isValidated;
    const { finalFdp, name } = resolveFdpEditSave(
      campaign.fdp,
      draft,
      campaign.name,
    );
    const isValidated = finalFdp.isValidated;
    addCampaign({
      fdp: finalFdp,
      name,
      status: campaign.status,
      scoringSheet: campaign.scoringSheet,
      publishedChannels: campaign.publishedChannels,
      sourcesConfirmed: campaign.sourcesConfirmed,
      threshold: campaign.threshold,
    });
    // Cohérence statut/machine : addCampaign préserve le statut passé, donc une
    // FDP réellement régressée laisserait une campagne « active » incohérente.
    // recomputeStatus re-dérive depuis la machine (et préserve paused/closed).
    recomputeStatus(campaign.id);
    const impact =
      isValidated && !wasValidated
        ? 'La fiche est complète et revalidée — la diffusion peut redémarrer.'
        : !isValidated && wasValidated
          ? "La fiche redevient incomplète — la campagne repasse en cadrage tant qu'il manque des champs."
          : 'Les nouveaux champs s’appliquent immédiatement.';
    setFlash(`Fiche enregistrée. ${impact}`);
    pushManagerAcknowledgment({
      kind: 'scoring_updated', // réutilise une ack textuelle existante côté chat
      campaignId: campaign.id,
      campaignName: campaign.name,
    });
    window.setTimeout(() => setFlash(null), FLASH_MS);
  };

  return (
    <div>
      <SaveBanner message={flash} />
      <FDPInlineEditor fdp={draft} onPatch={patchField} />
      <SaveFooter>
        <button
          type="button"
          disabled={!dirty}
          onClick={onSave}
          className="font-display"
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: dirty
              ? 'linear-gradient(135deg, var(--dash-blue), var(--dash-purple))'
              : 'var(--dash-hover)',
            color: dirty ? '#fff' : 'var(--dash-text-tertiary)',
            cursor: dirty ? 'pointer' : 'not-allowed',
            fontSize: 12,
            fontWeight: 700,
            boxShadow: dirty
              ? '0 2px 10px rgba(47,110,235,0.3)'
              : undefined,
          }}
        >
          Enregistrer la fiche
        </button>
      </SaveFooter>
    </div>
  );
}

function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function sameFDP(a: FDPInProgress, b: FDPInProgress): boolean {
  const ka = Object.keys(a.fields);
  const kb = Object.keys(b.fields);
  if (ka.length !== kb.length) return false;
  for (const key of ka) {
    const fa = a.fields[key as FieldKey];
    const fb = b.fields[key as FieldKey];
    if (!fa || !fb) return false;
    if (JSON.stringify(fa.value ?? null) !== JSON.stringify(fb.value ?? null))
      return false;
  }
  return true;
}
