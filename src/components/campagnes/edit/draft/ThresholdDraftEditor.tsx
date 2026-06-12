'use client';

/**
 * Slider de seuil pour un brouillon de campagne (Session 6 v2).
 */

export type ThresholdDraftEditorProps = {
  value: number;
  onChange: (next: number) => void;
};

export function ThresholdDraftEditor({
  value,
  onChange,
}: ThresholdDraftEditorProps) {
  const accent =
    value >= 80
      ? 'var(--dash-green)'
      : value >= 60
        ? 'var(--dash-orange)'
        : 'var(--dash-red)';
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
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span
          className="font-body"
          style={{
            fontSize: 12,
            color: 'var(--dash-text-secondary)',
          }}
        >
          Score minimal pour shortlist
        </span>
        <span
          className="font-data"
          style={{ fontSize: 26, fontWeight: 800, color: accent }}
        >
          {value}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        style={{ width: '100%', accentColor: accent }}
        aria-label="Seuil d'acceptation"
      />
    </div>
  );
}
