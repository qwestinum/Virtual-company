'use client';

/**
 * Filtre par méthode de vérification en tête de la liste des critères de
 * l'audit candidat (Phase 4.2). Chips « Toutes » + une par méthode présente,
 * avec compteur. Contrôlé.
 */

import { cn } from '@/lib/utils';
import {
  VERIFICATION_METHOD_LABELS,
  type VerificationMethod,
} from '@/types/scoring';

export function CriterionMethodFilter({
  counts,
  total,
  selected,
  onSelect,
}: {
  counts: { method: VerificationMethod; count: number }[];
  total: number;
  selected: VerificationMethod | null;
  onSelect: (method: VerificationMethod | null) => void;
}) {
  if (counts.length <= 1) return null; // une seule méthode → filtre inutile

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip active={selected === null} onClick={() => onSelect(null)}>
        Toutes ({total})
      </Chip>
      {counts.map(({ method, count }) => (
        <Chip
          key={method}
          active={selected === method}
          onClick={() => onSelect(method)}
        >
          {VERIFICATION_METHOD_LABELS[method]} ({count})
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-0.5 font-body text-[11px] font-semibold transition-colors',
        active
          ? 'border-amber-400 bg-amber-50 text-amber-800'
          : 'border-stone-300 text-stone-600 hover:bg-stone-100',
      )}
    >
      {children}
    </button>
  );
}
