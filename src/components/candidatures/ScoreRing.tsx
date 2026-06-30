'use client';

/**
 * Anneau de score ORQA (conic-gradient). Couleur par palier : vert ≥75,
 * ambre ≥60, rouge sinon. Cœur blanc + valeur mono. Tailles sm/md/lg.
 */

const SIZES = {
  sm: { box: 'h-12 w-12', inset: 'inset-[5px]', text: 'text-[13px]' },
  md: { box: 'h-16 w-16', inset: 'inset-[6px]', text: 'text-[18px]' },
  lg: { box: 'h-[72px] w-[72px]', inset: 'inset-[7px]', text: 'text-[20px]' },
} as const;

function ringColor(score: number): string {
  if (score >= 75) return 'var(--color-orqa-vert)';
  if (score >= 60) return 'var(--color-orqa-ambre)';
  return 'var(--color-orqa-rouge)';
}

export function ScoreRing({
  score,
  size = 'md',
}: {
  score: number;
  size?: keyof typeof SIZES;
}) {
  const s = SIZES[size];
  const pct = Math.max(0, Math.min(100, score));
  const color = ringColor(score);
  return (
    <span
      className={`relative grid shrink-0 place-items-center rounded-full ${s.box}`}
      style={{
        background: `conic-gradient(${color} 0 ${pct}%, var(--color-orqa-brume2) ${pct}% 100%)`,
      }}
    >
      <span className={`absolute rounded-full bg-white ${s.inset}`} />
      <span className={`relative font-data font-medium text-orqa-nuit ${s.text}`}>
        {score}
      </span>
    </span>
  );
}
