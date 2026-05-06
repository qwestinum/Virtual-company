'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Nom de l'événement DOM émis quand le donneur d'ordre valide la FDP.
 * Cet événement matérialise le jalon R1 → R2 (cf. spec §3.1) et sera
 * l'input de la future R2 (lancement effectif de la campagne) en
 * Session 4+. R2 n'est pas implémentée en Session 3.
 */
export const FDP_VALIDATED_EVENT = 'fdp_validated';

export type FdpValidatedEventDetail = {
  campaignId: string;
};

export type ValidateFDPButtonProps = {
  campaignId: string;
  isComplete: boolean;
  isValidated: boolean;
  disabled?: boolean;
  onValidate: () => void;
};

export function ValidateFDPButton({
  campaignId,
  isComplete,
  isValidated,
  disabled,
  onValidate,
}: ValidateFDPButtonProps) {
  if (!isComplete || isValidated) return null;

  function handleClick() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<FdpValidatedEventDetail>(FDP_VALIDATED_EVENT, {
          detail: { campaignId },
        }),
      );
    }
    onValidate();
  }

  return (
    <div className="px-4 py-3 border-t border-stone-200 bg-white/85 backdrop-blur">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={cn(
          'w-full flex items-center justify-center gap-2',
          'rounded-2xl bg-emerald-600 text-white',
          'px-4 py-2.5 font-display font-semibold text-[13px]',
          'shadow-sm transition-all',
          'hover:bg-emerald-700 hover:shadow',
          'disabled:opacity-50 disabled:pointer-events-none',
        )}
      >
        <Check className="h-4 w-4" aria-hidden />
        <span>{formatValidateLabel(campaignId)}</span>
      </button>
    </div>
  );
}

export function formatValidateLabel(campaignId: string): string {
  if (campaignId.startsWith('TASK-')) {
    return `Valider la fiche — ${campaignId}`;
  }
  return `Valider la fiche de poste — ${campaignId}`;
}
