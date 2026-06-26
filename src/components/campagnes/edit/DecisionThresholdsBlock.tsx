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
import { ThreeZoneRange } from './ThreeZoneRange';

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

  const hint =
    low === high
      ? 'Aucune zone de validation — tout est automatique.'
      : low === 0 && high === 100
        ? 'Toutes les candidatures passent en validation humaine.'
        : `Refus auto < ${low} · validation ${low}–${high} · acceptation auto ≥ ${high}`;

  return (
    <div>
      <SaveBanner message={flash} />

      <div
        className="font-data"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 4,
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        <span style={{ color: 'var(--dash-red)' }}>Refus auto &lt; {low}</span>
        <span style={{ color: 'var(--dash-orange)' }}>Validation</span>
        <span style={{ color: 'var(--dash-green)' }}>Accept. auto ≥ {high}</span>
      </div>

      {/* Slider unique, deux poignées, 3 zones colorées en direct. */}
      <ThreeZoneRange
        low={low}
        high={high}
        onChange={(lo, hi) => {
          setLow(lo);
          setHigh(hi);
        }}
        onCommit={onCommit}
      />

      <p
        className="font-body"
        style={{
          marginTop: 8,
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
