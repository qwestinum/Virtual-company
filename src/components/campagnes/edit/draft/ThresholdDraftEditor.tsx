'use client';

/**
 * Éditeur des DEUX seuils de décision pour un brouillon de campagne (HITL 3
 * zones, lot 2). Présentational : l'état vit dans le sheet de création tant que
 * la campagne n'est pas créée. Un seul slider à deux poignées (ThreeZoneRange)
 * affiche les 3 zones — refus auto / validation / acceptation auto.
 */

import { ThreeZoneRange } from '../ThreeZoneRange';

export type ThresholdDraftEditorProps = {
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
};

export function ThresholdDraftEditor({
  low,
  high,
  onChange,
}: ThresholdDraftEditorProps) {
  const hint =
    low === high
      ? 'Aucune zone de validation — tout est automatique.'
      : `Refus auto < ${low} · validation ${low}–${high} · acceptation auto ≥ ${high}`;

  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 12,
        background: 'var(--dash-warm)',
        border: '1px solid var(--dash-border)',
      }}
    >
      <div
        className="font-data"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 4,
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        <span style={{ color: 'var(--dash-red)' }}>Refus auto &lt; {low}</span>
        <span style={{ color: 'var(--dash-orange)' }}>Validation</span>
        <span style={{ color: 'var(--dash-green)' }}>Accept. auto ≥ {high}</span>
      </div>

      <ThreeZoneRange low={low} high={high} onChange={onChange} />

      <p
        className="font-body"
        style={{
          marginTop: 8,
          fontSize: 12,
          color: 'var(--dash-text-secondary)',
          lineHeight: 1.4,
        }}
      >
        {hint}
      </p>
    </div>
  );
}
