'use client';

/**
 * Vue d'accueil du sous-onglet Audit (cf. docs/specs/reporting.md §5.1) :
 * trois cartes (Audit candidat, Audit campagne, Audit scoring). Seul l'audit
 * candidat est disponible ; les deux autres sont « Bientôt disponible ».
 */

import { FileSearch, GitBranch, SlidersHorizontal } from 'lucide-react';

type AuditCard = {
  key: 'candidat' | 'campagne' | 'scoring';
  title: string;
  description: string;
  icon: React.ReactNode;
  available: boolean;
};

const CARDS: AuditCard[] = [
  {
    key: 'candidat',
    title: 'Audit candidat',
    description: 'Comprendre pourquoi un candidat a été retenu ou écarté.',
    icon: <FileSearch className="h-6 w-6" aria-hidden />,
    available: true,
  },
  {
    key: 'campagne',
    title: 'Audit campagne',
    description: 'Analyser le déroulé temporel d’une campagne.',
    icon: <GitBranch className="h-6 w-6" aria-hidden />,
    available: false,
  },
  {
    key: 'scoring',
    title: 'Audit scoring',
    description: 'Évaluer la calibration d’une grille de scoring.',
    icon: <SlidersHorizontal className="h-6 w-6" aria-hidden />,
    available: false,
  },
];

export function AuditHome({ onOpenCandidat }: { onOpenCandidat: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-xl font-bold text-stone-900">Audit</h2>
        <p className="font-body text-[13px] text-stone-500">
          Analyse approfondie à la demande sur un objet précis.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {CARDS.map((card) => (
          <button
            key={card.key}
            type="button"
            disabled={!card.available}
            onClick={card.available ? onOpenCandidat : undefined}
            className={`flex flex-col gap-3 rounded-xl border p-5 text-left transition-colors ${
              card.available
                ? 'border-stone-200 bg-white hover:border-amber-300 hover:bg-amber-50/40'
                : 'cursor-default border-stone-200 bg-stone-50/60'
            }`}
          >
            <span
              className={`inline-flex h-11 w-11 items-center justify-center rounded-lg ${
                card.available
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-stone-200 text-stone-400'
              }`}
            >
              {card.icon}
            </span>
            <div>
              <p className="font-display text-[15px] font-bold text-stone-900">
                {card.title}
              </p>
              <p className="mt-1 font-body text-[12px] text-stone-500">
                {card.description}
              </p>
            </div>
            {!card.available ? (
              <span className="mt-auto inline-flex w-fit rounded-full bg-stone-200 px-2.5 py-0.5 font-body text-[11px] font-semibold text-stone-500">
                Bientôt disponible
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
