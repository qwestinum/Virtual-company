'use client';

import { Check, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { CampaignPickerEntry } from '@/stores/chat-store';

export type CampaignPickerProps = {
  pendingId: string;
  campaigns: CampaignPickerEntry[];
  selectedCampaignId: string | null;
  disabled?: boolean;
  onPick: (pendingId: string, campaignId: string) => void;
};

export function CampaignPicker({
  pendingId,
  campaigns,
  selectedCampaignId,
  disabled,
  onPick,
}: CampaignPickerProps) {
  if (campaigns.length === 0) return null;
  return (
    <div className="mt-2 grid gap-1.5">
      {campaigns.map((c) => {
        const isSelected = selectedCampaignId === c.id;
        const clickable = !disabled && !selectedCampaignId;
        return (
          <button
            key={c.id}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onPick(pendingId, c.id)}
            className={cn(
              'group w-full flex items-center gap-3 rounded-xl border px-3 py-2.5',
              'transition-all text-left',
              clickable
                ? 'border-stone-200 bg-white hover:border-stone-400 hover:shadow-sm'
                : 'border-stone-200 bg-stone-50/60 cursor-not-allowed',
              isSelected && 'border-emerald-400 bg-emerald-50',
            )}
          >
            <span className="font-data text-[10.5px] tracking-tight text-stone-500 shrink-0">
              {c.id}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-display font-semibold text-[13px] text-stone-900 truncate block">
                {c.name}
              </span>
              <span className="font-body text-[11px] text-stone-500 block truncate">
                {c.jobTitle}
              </span>
            </span>
            {isSelected ? (
              <Check
                className="h-4 w-4 text-emerald-600 shrink-0"
                aria-hidden
              />
            ) : (
              <ChevronRight
                className="h-4 w-4 text-stone-400 shrink-0 group-hover:text-stone-600"
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
