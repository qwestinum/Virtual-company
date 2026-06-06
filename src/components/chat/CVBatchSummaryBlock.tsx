'use client';

import { cn } from '@/lib/utils';
import { rejectionCause, REJECTION_CAUSE_LABELS } from '@/lib/scoring';
import type { CVApplication, CVBatchSummary } from '@/types/cv-analysis';
import { CANDIDATE_STATUS_LABELS } from '@/types/scoring';

export type CVBatchSummaryBlockProps = {
  summary: CVBatchSummary;
};

/**
 * Indicateur compact par CV — emoji + libellé de cause, pour repérer les cas à
 * regarder de près sans ouvrir le rapport complet (cf. maquette 6b).
 */
function indicator(cv: CVApplication): {
  emoji: string;
  label: string;
  accepted: boolean;
} {
  if (cv.scoringResult.status === 'accepted') {
    return { emoji: '✅', label: CANDIDATE_STATUS_LABELS.accepted, accepted: true };
  }
  const cause = rejectionCause(cv.scoringResult) ?? 'below_threshold';
  const emoji = cause === 'knockout' ? '🔴' : cause === 'cap' ? '🟠' : '⚪';
  return {
    emoji,
    label: `${CANDIDATE_STATUS_LABELS.rejected} (${REJECTION_CAUSE_LABELS[cause]})`,
    accepted: false,
  };
}

export function CVBatchSummaryBlock({ summary }: CVBatchSummaryBlockProps) {
  if (summary.perCV.length === 0) return null;
  return (
    <div className="mt-2 grid gap-1.5">
      {summary.perCV.map((cv) => {
        const ind = indicator(cv);
        return (
          <div
            key={cv.candidate.fileName}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-3 py-2',
              ind.accepted
                ? 'border-emerald-200 bg-emerald-50/60'
                : 'border-stone-200 bg-stone-50/60',
            )}
          >
            <span
              className="h-7 w-7 grid place-items-center rounded-full shrink-0 text-[15px] leading-none"
              aria-hidden
            >
              {ind.emoji}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-display font-semibold text-[12.5px] text-stone-900 block truncate">
                {cv.candidate.fullName}
              </span>
              <span className="font-body text-[10.5px] text-stone-500 block truncate">
                {cv.candidate.fileName} · {ind.label}
              </span>
            </span>
            <span
              className={cn(
                'font-display font-bold text-[13px] tabular-nums shrink-0 px-2 py-0.5 rounded-full bg-white border',
                ind.accepted
                  ? 'text-emerald-700 border-emerald-200'
                  : 'text-stone-600 border-stone-200',
              )}
            >
              {cv.scoringResult.totalScore}
            </span>
          </div>
        );
      })}
    </div>
  );
}
