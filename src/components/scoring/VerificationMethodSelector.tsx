'use client';

/**
 * Sélecteur de méthode de vérification d'un critère (fiche hybride, Phase 2).
 * Dropdown des 4 méthodes. Contrôlé : la valeur vit chez le parent.
 */

import { cn } from '@/lib/utils';
import {
  VERIFICATION_METHODS,
  VERIFICATION_METHOD_LABELS,
  type VerificationMethod,
} from '@/types/scoring';

export function VerificationMethodSelector({
  value = 'llm_with_quote',
  onChange,
  disabled = false,
}: {
  value?: VerificationMethod;
  onChange: (method: VerificationMethod) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="font-body text-[10px] font-semibold uppercase tracking-wide text-stone-400">
        Méthode
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as VerificationMethod)}
        disabled={disabled}
        className={cn(
          'font-display text-[11px] font-semibold px-1.5 py-1 rounded border min-w-[180px]',
          disabled
            ? 'border-transparent bg-transparent cursor-not-allowed text-stone-500'
            : 'border-stone-200 bg-white outline-none focus:border-stone-500 text-stone-700',
        )}
      >
        {VERIFICATION_METHODS.map((m) => (
          <option key={m} value={m}>
            {VERIFICATION_METHOD_LABELS[m]}
          </option>
        ))}
      </select>
    </label>
  );
}
