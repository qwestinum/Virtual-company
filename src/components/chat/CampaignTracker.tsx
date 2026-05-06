'use client';

import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import { FIELD_KEYS, type FDPInProgress } from '@/types/field-collection';

export type CampaignTrackerProps = {
  fdp: FDPInProgress;
};

export function CampaignTracker({ fdp }: CampaignTrackerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const total = FIELD_KEYS.length;
  const filledCount = FIELD_KEYS.filter(
    (k) => fdp.fields[k]?.status === 'filled',
  ).length;
  const progressPct = Math.round((filledCount / total) * 100);

  return (
    <div className="border-b border-stone-200 bg-gradient-to-b from-white to-stone-50">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-stone-100/60 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {fdp.isComplete ? (
            <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 text-stone-500 animate-spin shrink-0" />
          )}
          <span className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-700 truncate">
            {fdp.campaignId}
          </span>
          <span className="font-body text-[11px] text-stone-500 shrink-0">
            {filledCount}/{total}
          </span>
        </div>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-stone-500 transition-transform',
            collapsed ? '-rotate-90' : '',
          )}
        />
      </button>

      <div className="px-4">
        <div className="h-1 w-full rounded-full bg-stone-200 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              fdp.isComplete ? 'bg-emerald-500' : 'bg-stone-700',
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {!collapsed ? (
        <ul className="px-4 py-3 space-y-1.5">
          {FIELD_KEYS.map((key) => {
            const field = fdp.fields[key];
            const filled = field?.status === 'filled';
            const inProgress = field?.status === 'in_progress';
            const value = filled ? formatValue(field.value) : null;
            return (
              <li
                key={key}
                className="flex items-start justify-between gap-3 text-[12px]"
              >
                <span
                  className={cn(
                    'flex items-center gap-1.5 font-display font-medium shrink-0',
                    filled ? 'text-stone-800' : 'text-stone-400',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      filled
                        ? 'bg-emerald-500'
                        : inProgress
                          ? 'bg-amber-400'
                          : 'bg-stone-300',
                    )}
                  />
                  {field?.label ?? key}
                </span>
                <span
                  className={cn(
                    'font-body text-right truncate min-w-0',
                    filled ? 'text-stone-700' : 'text-stone-400 italic',
                  )}
                >
                  {filled ? value : inProgress ? 'en cours…' : 'à préciser'}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="h-2" />
      )}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
      .join(', ');
  }
  return JSON.stringify(value);
}
