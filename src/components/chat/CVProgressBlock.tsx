'use client';

import { cn } from '@/lib/utils';

export type CVProgressBlockProps = {
  processed: number;
  total: number;
};

export function CVProgressBlock({ processed, total }: CVProgressBlockProps) {
  const safeTotal = Math.max(total, 1);
  const ratio = Math.min(processed / safeTotal, 1);
  const percent = Math.round(ratio * 100);
  const isDone = processed >= total;
  return (
    <div className="mt-2 grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-body text-[11.5px] font-medium text-stone-600">
          {processed} / {total} CV traités
        </span>
        <span className="font-display text-[10.5px] font-semibold text-stone-700 tabular-nums">
          {percent}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            isDone ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
