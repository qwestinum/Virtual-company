'use client';

/**
 * Primitives d'affichage des lignes d'entretien — extraites de `ScheduledList`
 * (limite de 200 lignes par composant). Aucune logique métier.
 */

import type { ScheduledRow } from '@/lib/interviews/pipeline-rows';

/** Sections de l'onglet, dans l'ordre d'AFFICHAGE : ce qui attend passe devant. */
export const SECTIONS: {
  key: ScheduledRow['section'];
  title: string;
  hint?: string;
}[] = [
  {
    key: 'a_pointer',
    title: 'À pointer',
    hint: 'Entretiens passés : dites ce qui s’est produit.',
  },
  { key: 'a_venir', title: 'À venir' },
  {
    key: 'verdict_attendu',
    title: 'Entretien fait — en attente de verdict',
  },
];

export function Action({
  tone = 'neutral',
  disabled,
  onClick,
  children,
}: {
  tone?: 'positive' | 'negative' | 'neutral';
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
      className={`rounded-md border px-2.5 py-1 font-body text-[12px] font-semibold disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}

export function formatSlot(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
