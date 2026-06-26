'use client';

/**
 * Éditeur des DEUX seuils de décision pour un brouillon de campagne (HITL 3
 * zones, lot 2). Présentational (pas de store) : l'état vit dans le sheet de
 * création tant que la campagne n'est pas créée. Trois zones : refus auto
 * (< bas), validation humaine (bas..haut), acceptation auto (≥ haut).
 * Invariant bas ≤ haut garanti ici (les poignées ne se croisent pas).
 */

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
  const onLow = (v: number) => onChange(Math.min(v, high), high);
  const onHigh = (v: number) => onChange(low, Math.max(v, low));
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
        style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden' }}
        aria-hidden
      >
        <div style={{ width: `${low}%`, background: 'var(--dash-red)' }} />
        <div style={{ width: `${high - low}%`, background: 'var(--dash-orange)' }} />
        <div style={{ width: `${100 - high}%`, background: 'var(--dash-green)' }} />
      </div>

      <label className="font-body" style={labelStyle}>
        Seuil bas — refus auto en dessous ({low})
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={low}
          onChange={(e) => onLow(Number(e.currentTarget.value))}
          style={{ width: '100%', accentColor: 'var(--dash-red)' }}
          aria-label="Seuil bas (refus automatique)"
        />
      </label>

      <label className="font-body" style={labelStyle}>
        Seuil haut — acceptation auto au-dessus ({high})
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={high}
          onChange={(e) => onHigh(Number(e.currentTarget.value))}
          style={{ width: '100%', accentColor: 'var(--dash-green)' }}
          aria-label="Seuil haut (acceptation automatique)"
        />
      </label>

      <p
        className="font-body"
        style={{
          marginTop: 10,
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

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 12,
  fontSize: 12,
  color: 'var(--dash-text-secondary)',
};
