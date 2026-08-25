'use client';

/**
 * Boutons partagés des actions candidature — extraits de `CandidatureActions`
 * (limite 200 lignes/fichier). Aucune logique métier ici : uniquement le rendu,
 * pour que le panneau (niveau 2) et la page (niveau 3) soient identiques au
 * pixel près.
 */

import type { CandidateListItem } from '@/types/reporting';

import { CorrectDecisionAction } from './CorrectDecisionAction';

/** Câblage unique de « Corriger la décision » — mêmes props partout. */
export function CorrectionButton({
  item,
  onActed,
  label,
}: {
  item: CandidateListItem;
  onActed: () => void;
  label?: string;
}) {
  return (
    <CorrectDecisionAction
      analysisId={item.id}
      candidateName={item.candidateName}
      stage={item.stage}
      onActed={onActed}
      label={label}
    />
  );
}

export function ActionButton({
  tone,
  disabled,
  onClick,
  children,
}: {
  tone: 'positive' | 'negative' | 'neutral';
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const cls =
    tone === 'positive'
      ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
      : tone === 'negative'
        ? 'border-rose-300 text-rose-700 hover:bg-rose-50'
        : 'border-stone-300 text-stone-600 hover:bg-stone-50';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 font-body text-[12px] font-semibold transition disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}
