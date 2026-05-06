'use client';

import { Briefcase, FileText } from 'lucide-react';

import { cn } from '@/lib/utils';

export type CampaignHeaderProps = {
  campaignId: string;
  status?: string;
};

export function CampaignHeader({ campaignId, status }: CampaignHeaderProps) {
  const isTask = campaignId.startsWith('TASK-');
  const Icon = isTask ? FileText : Briefcase;
  const kind = isTask ? 'Sollicitation' : 'Campagne';
  const sub = status ?? (isTask ? 'Livrable atomique' : 'En cours de cadrage');

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-4 py-2.5 border-b border-stone-200',
        isTask ? 'bg-amber-50/70' : 'bg-stone-50/80',
      )}
    >
      <Icon
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          isTask ? 'text-amber-700' : 'text-stone-600',
        )}
        aria-hidden
      />
      <div className="min-w-0 flex flex-col leading-tight">
        <span className="font-display text-[10px] uppercase tracking-[0.18em] text-stone-500">
          {kind}
        </span>
        <span className="font-body text-[12px] text-stone-800 truncate">
          <span className="font-data font-semibold tracking-tight">
            {campaignId}
          </span>
          <span className="font-normal text-stone-500"> — {sub}</span>
        </span>
      </div>
    </div>
  );
}
