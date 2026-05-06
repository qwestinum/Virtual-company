'use client';

import { Check, FolderOpen, Inbox, Upload } from 'lucide-react';

import { cn } from '@/lib/utils';

export type SourceKind = 'manuel' | 'dossier' | 'flux';

export type SourcePickerProps = {
  selected: 'manuel' | null;
  disabled?: boolean;
  onPick: (source: 'manuel') => void;
};

type Option = {
  id: SourceKind;
  label: string;
  hint: string;
  icon: typeof Upload;
  available: boolean;
};

const OPTIONS: Option[] = [
  {
    id: 'manuel',
    label: 'Manuel',
    hint: 'Téléverser un ou plusieurs CV via le trombone',
    icon: Upload,
    available: true,
  },
  {
    id: 'dossier',
    label: 'Dossier',
    hint: 'Sélectionner un dossier complet',
    icon: FolderOpen,
    available: false,
  },
  {
    id: 'flux',
    label: 'Flux',
    hint: 'Boîte mail, jobboard, ATS connecté',
    icon: Inbox,
    available: false,
  },
];

export function SourcePicker({
  selected,
  disabled,
  onPick,
}: SourcePickerProps) {
  return (
    <div className="mt-2 grid gap-1.5">
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const isSelected = selected === opt.id && opt.id === 'manuel';
        const clickable = opt.available && !disabled;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && opt.id === 'manuel' && onPick(opt.id)}
            className={cn(
              'group w-full flex items-center gap-3 rounded-xl border px-3 py-2.5',
              'transition-all text-left',
              opt.available
                ? 'border-stone-200 bg-white hover:border-stone-400 hover:shadow-sm'
                : 'border-stone-200 bg-stone-50/60 cursor-not-allowed',
              isSelected && 'border-emerald-400 bg-emerald-50',
              disabled && 'opacity-60 pointer-events-none',
            )}
          >
            <span
              className={cn(
                'h-8 w-8 grid place-items-center rounded-lg shrink-0',
                opt.available
                  ? 'bg-stone-100 text-stone-700 group-hover:bg-stone-200'
                  : 'bg-stone-100 text-stone-400',
                isSelected && 'bg-emerald-100 text-emerald-700',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-display font-semibold text-[13px] text-stone-900 flex items-center gap-2">
                {opt.label}
                {!opt.available ? (
                  <span className="font-body text-[9.5px] uppercase tracking-wide text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                    Bientôt disponible
                  </span>
                ) : null}
                {isSelected ? (
                  <span className="font-body text-[9.5px] uppercase tracking-wide text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                    <Check className="h-3 w-3" aria-hidden /> Sélectionné
                  </span>
                ) : null}
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
