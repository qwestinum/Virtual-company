'use client';

/**
 * Édition du seuil d'acceptation (Session 6).
 *
 * Slider 0..100 avec preview live de la valeur. Persistance débouncée à
 * la mainup pour éviter une cascade de prises d'acte si le DRH ajuste
 * en continu. La prise d'acte Manager se fait UNE FOIS, avec la valeur
 * finale ; le store est mis à jour immédiatement pour que les autres
 * vues (KPIs, mini-stats) restent en cohérence.
 *
 * Pas de recompute rétroactif des candidats déjà analysés — le message
 * Manager le dit explicitement (cf. manager-acknowledgments).
 */

import { useState } from 'react';

import { pushManagerAcknowledgment } from '@/lib/chat/manager-acknowledgments';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import { useCampaignsStore } from '@/stores/campaigns-store';

import { SaveBanner } from './SaveBanner';

const FLASH_MS = 3000;

export type ThresholdEditBlockProps = {
  campaign: ActiveCampaign;
};

/**
 * Wrapper qui re-monte le bloc quand le seuil externe change (autre
 * mutation pendant que le sheet est ouvert). C'est le pattern React 19
 * canonique : "key prop" plutôt que setState dans useEffect.
 */
export function ThresholdEditBlock({ campaign }: ThresholdEditBlockProps) {
  return (
    <ThresholdEditInner
      key={`${campaign.id}-${campaign.threshold}`}
      campaign={campaign}
    />
  );
}

function ThresholdEditInner({ campaign }: ThresholdEditBlockProps) {
  const setThreshold = useCampaignsStore((s) => s.setThreshold);
  const baseline = campaign.threshold;
  const [local, setLocal] = useState(baseline);
  const [flash, setFlash] = useState<string | null>(null);

  const onCommit = () => {
    if (local === baseline) return;
    const previous = baseline;
    setThreshold(campaign.id, local);
    pushManagerAcknowledgment({
      kind: 'threshold_changed',
      campaignId: campaign.id,
      campaignName: campaign.name,
      previous,
      next: local,
    });
    setFlash(
      `Seuil passé de ${previous}% à ${local}% — le CV Analyzer applique la nouvelle valeur aux prochains CV.`,
    );
    window.setTimeout(() => setFlash(null), FLASH_MS);
  };

  const colorForValue =
    local >= 80
      ? 'var(--dash-green)'
      : local >= 60
        ? 'var(--dash-orange)'
        : 'var(--dash-red)';

  return (
    <div>
      <SaveBanner message={flash} />
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <span
          className="font-body"
          style={{
            fontSize: 13,
            color: 'var(--dash-text-secondary)',
          }}
        >
          Seuil actuel
        </span>
        <span
          className="font-data"
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: colorForValue,
          }}
        >
          {local}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={local}
        onChange={(e) => setLocal(Number(e.currentTarget.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        style={{
          width: '100%',
          accentColor: colorForValue,
        }}
        aria-label="Seuil d'acceptation"
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 6,
          fontSize: 11,
          color: 'var(--dash-text-tertiary)',
        }}
        className="font-data"
      >
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
      <p
        className="font-body"
        style={{
          marginTop: 14,
          fontSize: 12,
          color: 'var(--dash-text-secondary)',
          lineHeight: 1.5,
        }}
      >
        Le nouveau seuil s&apos;applique aux prochaines candidatures. Pour le
        moment on ne reclasse pas les CV déjà analysés — le Manager vous
        proposera un récap quand suffisamment de candidatures auront été
        évaluées avec la nouvelle valeur.
      </p>
    </div>
  );
}
