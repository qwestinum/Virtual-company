'use client';

/**
 * La liste, sans état ni appel réseau — rendue telle quelle par les tests.
 *
 * Ordre de lecture voulu (ajustement du 14/09/2026) : en tête, le compteur et,
 * s'il y a lieu, le bandeau de couverture ; puis les lignes ; et SEULEMENT à la
 * fin, là où le recruteur arrive après avoir balayé, « 50 de plus » — ou, la
 * réserve vide, « 100 profils examinés — modifiez la requête » à sa place.
 */

import type { ReactNode } from 'react';

import { BATCH_SIZE } from '@/lib/sourcing/selection';
import type { ExpansionState } from '@/lib/sourcing/expansion';
import type { ProfilesView } from '@/lib/sourcing/profiles-view';
import type { SourcingProfileView } from '@/types/sourcing';

import { CoverageBanner } from './CoverageBanner';
import { SourcingProfileRow } from './SourcingProfileRow';

export type RowExtras = {
  slot?: (p: SourcingProfileView) => ReactNode;
  actions?: (p: SourcingProfileView) => ReactNode;
};

export function SourcingResultsList({
  view,
  expansion,
  onToggle,
  onSingleChange,
  onMore,
  promoting,
  extras = {},
}: {
  view: ProfilesView;
  expansion: ExpansionState;
  onToggle: (id: string) => void;
  onSingleChange: (single: boolean) => void;
  onMore: () => void;
  promoting: boolean;
  extras?: RowExtras;
}) {
  const latest = view.groups[0];
  const shown = latest?.profiles.length ?? 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 font-body text-[12.5px] text-stone-600">
        <span data-testid="profiles-counter">
          {shown} profil{shown > 1 ? 's' : ''} affiché{shown > 1 ? 's' : ''} · {view.reserveCount} en réserve
        </span>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={expansion.single} onChange={(e) => onSingleChange(e.target.checked)} />
          Déplier une ligne à la fois
        </label>
      </div>

      {view.coverage.limited ? <CoverageBanner coverage={view.coverage} /> : null}

      {view.groups.map((group, i) => (
        <div key={group.search.id} className="flex flex-col gap-1.5">
          {view.groups.length > 1 ? (
            <p className="font-body text-[12px] text-stone-500">
              {i === 0 ? 'Dernière recherche' : 'Recherche précédente'} : « {group.search.query} »
            </p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {group.profiles.map((p) => (
              <SourcingProfileRow
                key={p.id}
                profile={p}
                expanded={expansion.open.has(p.id)}
                onToggle={onToggle}
                slot={extras.slot?.(p)}
                actions={extras.actions?.(p)}
              />
            ))}
          </ul>
        </div>
      ))}

      <div data-testid="list-end">
        {view.reserveCount > 0 ? (
          <button
            type="button"
            disabled={promoting}
            onClick={onMore}
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 font-body text-[13px] font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40"
          >
            {Math.min(BATCH_SIZE, view.reserveCount)} de plus
          </button>
        ) : view.exhausted ? (
          <p className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 font-body text-[13px] text-stone-700">
            {latest?.search.returned ?? 100} profils examinés — modifiez la requête pour relancer.
          </p>
        ) : null}
      </div>
    </section>
  );
}
