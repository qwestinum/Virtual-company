'use client';

/**
 * Édition des DEUX seuils de décision (HITL 3 zones, lot 2).
 *
 * Remplace le slider mono-poignée. Deux poignées sur l'échelle 0..100 →
 * trois zones : refus auto (< bas), validation humaine (bas..haut),
 * acceptation auto (≥ haut). L'invariant bas ≤ haut est garanti ici (les
 * poignées ne se croisent jamais) ET en base (CHECK). Persistance débouncée à
 * la relâche ; prise d'acte Manager UNE fois, avec les valeurs finales. Pas de
 * recompute rétroactif des candidats déjà analysés.
 */

import { useState } from 'react';

import { pushManagerAcknowledgment } from '@/lib/chat/manager-acknowledgments';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import { useCampaignsStore } from '@/stores/campaigns-store';

import { SaveBanner } from './SaveBanner';

const FLASH_MS = 3000;

export type DecisionThresholdsBlockProps = { campaign: ActiveCampaign };

/** Re-monte le bloc si les seuils externes changent (pattern React 19 « key »). */
export function DecisionThresholdsBlock({
  campaign,
}: DecisionThresholdsBlockProps) {
  return (
    <DecisionThresholdsInner
      key={`${campaign.id}-${campaign.thresholdLow}-${campaign.thresholdHigh}`}
      campaign={campaign}
    />
  );
}

function DecisionThresholdsInner({ campaign }: DecisionThresholdsBlockProps) {
  const setThresholds = useCampaignsStore((s) => s.setThresholds);
  const baseLow = campaign.thresholdLow;
  const baseHigh = campaign.thresholdHigh;
  const [low, setLow] = useState(baseLow);
  const [high, setHigh] = useState(baseHigh);
  const [flash, setFlash] = useState<string | null>(null);

  const onCommit = () => {
    if (low === baseLow && high === baseHigh) return;
    setThresholds(campaign.id, low, high);
    pushManagerAcknowledgment({
      kind: 'thresholds_changed',
      campaignId: campaign.id,
      campaignName: campaign.name,
      previousLow: baseLow,
      previousHigh: baseHigh,
      nextLow: low,
      nextHigh: high,
    });
    setFlash(
      low === high
        ? `Seuils collés à ${low} — plus de zone de validation, tout est automatique. Appliqué aux prochaines candidatures.`
        : `Zone de validation ${low}–${high} enregistrée. Appliquée aux prochaines candidatures.`,
    );
    window.setTimeout(() => setFlash(null), FLASH_MS);
  };

  // Les poignées ne se croisent jamais (invariant bas ≤ haut).
  const onLow = (v: number) => setLow(Math.min(v, high));
  const onHigh = (v: number) => setHigh(Math.max(v, low));

  const grayWidth = high - low;
  const hint =
    low === high
      ? 'Aucune zone de validation — tout est automatique.'
      : low === 0 && high === 100
        ? 'Toutes les candidatures passent en validation humaine.'
        : `Refus auto < ${low} · validation ${low}–${high} · acceptation auto ≥ ${high}`;

  return (
    <div>
      <SaveBanner message={flash} />

      {/* Barre 3 zones */}
      <div
        style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden' }}
        aria-hidden
      >
        <div style={{ width: `${low}%`, background: 'var(--dash-red)' }} />
        <div style={{ width: `${grayWidth}%`, background: 'var(--dash-orange)' }} />
        <div style={{ width: `${100 - high}%`, background: 'var(--dash-green)' }} />
      </div>

      <div
        className="font-data"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 8,
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        <span style={{ color: 'var(--dash-red)' }}>Refus auto &lt; {low}</span>
        <span style={{ color: 'var(--dash-green)' }}>Accept. auto ≥ {high}</span>
      </div>

      <label className="font-body" style={labelStyle}>
        Seuil bas (refus auto en dessous)
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={low}
          onChange={(e) => onLow(Number(e.currentTarget.value))}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
          style={{ width: '100%', accentColor: 'var(--dash-red)' }}
          aria-label="Seuil bas (refus automatique)"
        />
      </label>

      <label className="font-body" style={labelStyle}>
        Seuil haut (acceptation auto au-dessus)
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={high}
          onChange={(e) => onHigh(Number(e.currentTarget.value))}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
          style={{ width: '100%', accentColor: 'var(--dash-green)' }}
          aria-label="Seuil haut (acceptation automatique)"
        />
      </label>

      <p
        className="font-body"
        style={{
          marginTop: 12,
          fontSize: 12,
          color: 'var(--dash-text-secondary)',
          lineHeight: 1.5,
        }}
      >
        {hint} Les candidatures de la zone du milieu sont mises en validation
        humaine ; les extrêmes sont traités automatiquement. Le changement
        s&apos;applique aux prochaines candidatures — on ne reclasse pas les CV
        déjà analysés.
      </p>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 14,
  fontSize: 12,
  color: 'var(--dash-text-secondary)',
};
