'use client';

import { Check, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { CVBatchSummary } from '@/types/cv-analysis';

export type CVBatchSummaryBlockProps = {
  summary: CVBatchSummary;
};

export function CVBatchSummaryBlock({ summary }: CVBatchSummaryBlockProps) {
  if (summary.perCV.length === 0) return null;
  return (
    <div className="mt-2 grid gap-1.5">
      {summary.perCV.map((cv) => (
        <div
          key={cv.fileName}
          className={cn(
            'flex items-center gap-3 rounded-xl border px-3 py-2',
            cv.aboveThreshold
              ? 'border-emerald-200 bg-emerald-50/60'
              : 'border-stone-200 bg-stone-50/60',
          )}
        >
          <span
            className={cn(
              'h-7 w-7 grid place-items-center rounded-full shrink-0',
              cv.aboveThreshold
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-stone-200 text-stone-600',
            )}
          >
            {cv.aboveThreshold ? (
              <Check className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Minus className="h-3.5 w-3.5" aria-hidden />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-display font-semibold text-[12.5px] text-stone-900 block truncate">
              {cv.candidateName}
            </span>
            <span className="font-body text-[10.5px] text-stone-500 block truncate">
              {cv.fileName}
            </span>
          </span>
          <span
            className={cn(
              'font-display font-bold text-[13px] tabular-nums shrink-0 px-2 py-0.5 rounded-full',
              cv.aboveThreshold
                ? 'text-emerald-700 bg-white border border-emerald-200'
                : 'text-stone-600 bg-white border border-stone-200',
            )}
          >
            {cv.score}
          </span>
        </div>
      ))}
    </div>
  );
}
