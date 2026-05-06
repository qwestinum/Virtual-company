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
        'flex items-center gap-2.5 px-4 py-2.5 border-b',
        isTask
          ? 'bg-amber-50 border-amber-200'
          : 'bg-indigo-50 border-indigo-200',
      )}
    >
      <Icon
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          isTask ? 'text-amber-700' : 'text-indigo-700',
        )}
        aria-hidden
      />
      <div className="min-w-0 flex flex-col leading-tight">
        <span
          className={cn(
            'font-display text-[10px] uppercase tracking-[0.18em] font-semibold',
            isTask ? 'text-amber-700' : 'text-indigo-700',
          )}
        >
          {kind}
        </span>
        <span className="font-body text-[12px] truncate">
          <span
            className={cn(
              'font-data font-semibold tracking-tight',
              isTask ? 'text-amber-900' : 'text-indigo-900',
            )}
          >
            {campaignId}
          </span>
          <span
            className={cn(
              'font-normal',
              isTask ? 'text-amber-700/80' : 'text-indigo-700/80',
            )}
          >
            {' '}
            — {sub}
          </span>
        </span>
      </div>
    </div>
  );
}
