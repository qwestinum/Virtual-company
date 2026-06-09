'use client';

/**
 * Badge de score — pastille RONDE avec le pourcentage (jamais un nombre nu).
 * Teinte selon le niveau (vert ≥75, ambre ≥60, rose sinon).
 */
export function ScoreBadge({
  score,
  size = 'md',
}: {
  score: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  const tone =
    score >= 75
      ? 'border-emerald-500 text-emerald-700 bg-emerald-50'
      : score >= 60
        ? 'border-amber-500 text-amber-700 bg-amber-50'
        : 'border-rose-500 text-rose-700 bg-rose-50';
  const dim =
    size === 'lg'
      ? 'h-16 w-16 text-[18px]'
      : size === 'sm'
        ? 'h-9 w-9 text-[11px]'
        : 'h-12 w-12 text-[14px]';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border-2 font-display font-bold ${tone} ${dim}`}
      title={`Score ${score}%`}
    >
      {score}%
    </span>
  );
}
