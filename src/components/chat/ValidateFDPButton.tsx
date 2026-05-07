'use client';

import { Check, Pencil } from 'lucide-react';

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
  /**
   * Nombre de champs encore vides quand `isComplete=false`. Affiché
   * dans le bouton ambré pour que le DRH sache combien de cases il
   * lui reste à remplir.
   */
  missingCount?: number;
  /**
   * Callback quand le DRH clique le bouton ambré « il manque X
   * champ(s) ». Utilisé par ManagerChat pour déplier la checklist et
   * ouvrir l'édition du premier champ vide.
   */
  onRequestComplete?: () => void;
};

export function ValidateFDPButton({
  campaignId,
  isComplete,
  isValidated,
  disabled,
  onValidate,
  missingCount = 0,
  onRequestComplete,
}: ValidateFDPButtonProps) {
  if (isValidated) return null;

  function handleValidate() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<FdpValidatedEventDetail>(FDP_VALIDATED_EVENT, {
          detail: { campaignId },
        }),
      );
    }
    onValidate();
  }

  // Variante incomplete : bouton ambré non-validant qui pointe le DRH
  // vers la checklist. C'est le filet de sécurité quand le LLM oublie
  // d'extraire un champ — sans ce bouton, l'UI ne donne aucun chemin
  // visible pour finir la campagne.
  if (!isComplete) {
    const label =
      missingCount > 1
        ? `Il manque ${missingCount} champs pour valider`
        : "Il manque 1 champ pour valider";
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
          title="Compléter le premier champ manquant"
        >
          <Pencil className="h-4 w-4" aria-hidden />
          <span>{label}</span>
        </button>
        <p className="font-body text-[10.5px] text-stone-500 text-center mt-1.5">
          Clique pour saisir la valeur, ou continue la conversation avec le Manager.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-t border-stone-200 bg-white/85 backdrop-blur">
      <button
        type="button"
        onClick={handleValidate}
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
        <Check className="h-4 w-4" aria-hidden />
        <span>
          {splitValidateLabel(campaignId).prefix}
          <span className="font-data tracking-tight ml-1.5">{campaignId}</span>
        </span>
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

/**
 * Variante segmentée — exposée pour permettre au rendu d'appliquer
 * font-data au campaignId tout en gardant la phrase en font-display.
 */
export function splitValidateLabel(campaignId: string): {
  prefix: string;
  campaignId: string;
} {
  return {
    prefix: campaignId.startsWith('TASK-')
      ? 'Valider la fiche'
      : 'Valider la fiche de poste',
    campaignId,
  };
}
