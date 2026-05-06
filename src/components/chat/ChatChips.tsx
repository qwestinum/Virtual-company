'use client';

import { cn } from '@/lib/utils';
import type { ChipPlacement, ChipSet } from '@/types/manager-response';

export type ChatChipsProps = {
  chips: ChipSet;
  onSelect: (option: string) => void;
  disabled?: boolean;
};

export function ChatChips({ chips, onSelect, disabled }: ChatChipsProps) {
  return (
    <div
      role="group"
      aria-label="Suggestions de réponse"
      data-placement={chips.placement}
      className={cn(
        'flex flex-wrap gap-1.5',
        placementContainerClass(chips.placement),
      )}
    >
      {chips.options.map((opt) => (
        <button
          key={opt}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(opt)}
          className={cn(
            'font-body text-[12px] leading-tight',
            'px-3 py-1.5 rounded-full transition-all shadow-sm',
            'bg-white border border-stone-200 text-stone-800',
            'hover:bg-stone-100 hover:border-stone-300 hover:shadow',
            'disabled:opacity-50 disabled:pointer-events-none',
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

/**
 * Exposé pour les tests et pour les consommateurs qui ont besoin de
 * placer le conteneur dans un layout particulier (ex. inline dans une
 * bulle vs above_input dans la zone de saisie).
 */
export function placementContainerClass(p: ChipPlacement): string {
  switch (p) {
    case 'below_bubble':
      return 'mt-2 ml-10 px-1';
    case 'above_input':
      return 'px-4 pt-3 pb-1 border-t border-stone-200 bg-white/85 backdrop-blur';
    case 'inline':
      return 'mt-2.5';
  }
}
