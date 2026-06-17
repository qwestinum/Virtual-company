'use client';

import { Briefcase, FilePlus2, FileText, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { CampaignPickerEntry } from '@/stores/chat-store';

export type CVRoutePickerProps = {
  pendingId: string;
  fileCount: number;
  activeCampaigns: CampaignPickerEntry[];
  selected: 'new' | 'existing' | 'isolated' | 'brief' | null;
  disabled?: boolean;
  onPick: (
    pendingId: string,
    route: 'new' | 'existing' | 'isolated' | 'brief',
  ) => void;
};

type Option = {
  id: 'new' | 'existing' | 'isolated' | 'brief';
  label: string;
  hint: string;
  icon: typeof Briefcase;
};

/**
 * Désactivé temporairement : les briques « tâche isolée » (TASK-XXXX) ne
 * fonctionnent pas correctement. On ne propose donc que les parcours
 * campagne. Repasser à `true` pour réafficher l'option — toute la
 * mécanique isolated reste branchée en aval.
 */
const ISOLATED_TASK_ENABLED = false;

export function CVRoutePicker({
  pendingId,
  fileCount,
  activeCampaigns,
  selected,
  disabled,
  onPick,
}: CVRoutePickerProps) {
  const noActive = activeCampaigns.length === 0;
  const options: Option[] = [
    {
      id: 'new',
      label: 'Nouvelle campagne',
      hint: 'Créer une CAMP-XXXX et y rattacher ces CV',
      icon: FilePlus2,
    },
    {
      id: 'existing',
      label: noActive
        ? 'Campagne en cours (aucune)'
        : `Campagne en cours (${activeCampaigns.length})`,
      hint: noActive
        ? 'Aucune campagne active pour le moment'
        : 'Choisir une campagne existante dans la liste',
      icon: Briefcase,
    },
    ...(ISOLATED_TASK_ENABLED
      ? [
          {
            id: 'isolated' as const,
            label: 'Tâche isolée',
            hint: 'Analyse atomique sans campagne (TASK-XXXX)',
            icon: Sparkles,
          },
        ]
      : []),
    // Désambiguïsation : le document déposé n'est peut-être pas un CV mais un
    // brief (appel d'offres / notes) à partir duquel cadrer une campagne. Ne
    // proposé que pour un fichier unique (un cadrage = un document).
    ...(fileCount === 1
      ? [
          {
            id: 'brief' as const,
            label: 'Appel d’offres / notes',
            hint: 'Pré-remplir une campagne à partir de ce document',
            icon: FileText,
          },
        ]
      : []),
  ];

  return (
    <div className="mt-2 grid gap-1.5">
      <p className="font-body text-[11px] text-stone-500 mb-1">
        {fileCount > 1
          ? `${fileCount} CV à rattacher`
          : '1 document reçu'}
      </p>
      {options.map((opt) => {
        const Icon = opt.icon;
        const isSelected = selected === opt.id;
        const isDisabledForExisting = opt.id === 'existing' && noActive;
        const clickable = !disabled && !isDisabledForExisting && !selected;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onPick(pendingId, opt.id)}
            className={cn(
              'group w-full flex items-center gap-3 rounded-xl border px-3 py-2.5',
              'transition-all text-left',
              !isDisabledForExisting && !disabled && !selected
                ? 'border-stone-200 bg-white hover:border-stone-400 hover:shadow-sm'
                : 'border-stone-200 bg-stone-50/60 cursor-not-allowed',
              isSelected && 'border-emerald-400 bg-emerald-50',
              isDisabledForExisting && 'opacity-60',
            )}
          >
            <span
              className={cn(
                'h-8 w-8 grid place-items-center rounded-lg shrink-0',
                isSelected
                  ? 'bg-emerald-100 text-emerald-700'
                  : isDisabledForExisting
                    ? 'bg-stone-100 text-stone-400'
                    : 'bg-stone-100 text-stone-700 group-hover:bg-stone-200',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-display font-semibold text-[13px] text-stone-900">
                {opt.label}
              </span>
              <span className="font-body text-[11.5px] text-stone-500 block leading-snug">
                {opt.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
