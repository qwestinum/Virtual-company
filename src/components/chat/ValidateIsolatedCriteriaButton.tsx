'use client';

import { Check, Pencil, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

export type ValidateIsolatedCriteriaButtonProps = {
  taskId: string;
  isComplete: boolean;
  isValidated: boolean;
  disabled?: boolean;
  missingCount?: number;
  onValidate: () => void;
  onRequestComplete?: () => void;
};

export function ValidateIsolatedCriteriaButton({
  taskId,
  isComplete,
  isValidated,
  disabled,
  missingCount = 0,
  onValidate,
  onRequestComplete,
}: ValidateIsolatedCriteriaButtonProps) {
  if (isValidated) return null;

  if (!isComplete) {
    const label =
      missingCount > 1
        ? `Il manque ${missingCount} critères pour lancer`
        : 'Il manque 1 critère pour lancer';
    return (
      <div className="px-4 py-3 border-t border-stone-200 bg-white/85 backdrop-blur">
        <button
          type="button"
          onClick={onRequestComplete}
          disabled={disabled || !onRequestComplete}
          className={cn(
            'w-full flex items-center justify-center gap-2',
            'rounded-2xl bg-amber-100 text-amber-800 border border-amber-300',
            'px-4 py-2.5 font-display font-semibold text-[13px]',
            'shadow-sm transition-all',
            'hover:bg-amber-200 hover:shadow',
            'disabled:opacity-50 disabled:pointer-events-none',
          )}
          title="Compléter le premier critère manquant"
        >
          <Pencil className="h-4 w-4" aria-hidden />
          <span>{label}</span>
        </button>
        <p className="font-body text-[10.5px] text-stone-500 text-center mt-1.5">
          Clique pour saisir, ou continue à dialoguer avec le Manager.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-t border-stone-200 bg-white/85 backdrop-blur">
      <button
        type="button"
        onClick={onValidate}
        disabled={disabled}
        className={cn(
          'w-full flex items-center justify-center gap-2',
          'rounded-2xl bg-emerald-600 text-white',
          'px-4 py-2.5 font-display font-semibold text-[13px]',
          'shadow-sm transition-all',
          'hover:bg-emerald-700 hover:shadow',
          'disabled:opacity-50 disabled:pointer-events-none',
          !disabled && 'btn-validate-pulse',
        )}
      >
        <Sparkles className="h-4 w-4" aria-hidden />
        <span>
          Valider et lancer l&apos;analyse
          <span className="font-data tracking-tight ml-1.5">{taskId}</span>
        </span>
        <Check className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
