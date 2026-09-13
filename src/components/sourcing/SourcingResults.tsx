'use client';

/**
 * Liste des profils à examiner (spec §14.3). L'ordre est celui du moteur.
 * « 50 de plus » puise dans la réserve de la dernière recherche, sans appel.
 */

import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { ProfilesView } from '@/lib/sourcing/profiles-view';

import { CoverageBanner } from './CoverageBanner';
import { SourcingProfileCard } from './SourcingProfileCard';

export function SourcingResults({ campaignId, version }: { campaignId: string; version: number }) {
  const [view, setView] = useState<ProfilesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/sourcing/campaigns/${encodeURIComponent(campaignId)}/profiles`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setView((await res.json()) as ProfilesView);
      setError(null);
    } catch {
      setError('La liste n’a pas pu être chargée.');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, version]);

  const more = async () => {
    setPromoting(true);
    try {
      const res = await fetch(url, { method: 'POST' });
      if (res.ok) setView((await res.json()) as ProfilesView);
    } finally {
      setPromoting(false);
    }
  };

  if (loading && !view) {
    return (
      <p className="font-body text-[13px] text-stone-500">
        <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Chargement des profils…
      </p>
    );
  }
  if (error) return <p className="font-body text-[13px] text-rose-700">{error}</p>;
  if (!view || view.groups.length === 0) {
    return (
      <p className="font-body text-[13px] italic text-stone-400">
        Aucune recherche pour cette campagne. Relisez la requête, puis lancez-la.
      </p>
    );
  }

  const shownLatest = view.groups[0]?.profiles.length ?? 0;

  return (
    <section className="flex flex-col gap-4">
      {view.coverage.limited ? <CoverageBanner coverage={view.coverage} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 font-body text-[12.5px] text-stone-600">
        <span>
          {shownLatest} affiché{shownLatest > 1 ? 's' : ''} · {view.reserveCount} en réserve
        </span>
        {view.reserveCount > 0 ? (
          <button
            type="button"
            disabled={promoting}
            onClick={() => void more()}
            className="rounded-md border border-stone-300 px-3 py-1 font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40"
          >
            {Math.min(50, view.reserveCount)} de plus
          </button>
        ) : null}
      </div>

      {view.groups.map((group, i) => (
        <div key={group.search.id} className="flex flex-col gap-2">
          {i > 0 || view.groups.length > 1 ? (
            <p className="font-body text-[12px] text-stone-500">
              {i === 0 ? 'Dernière recherche' : 'Recherche précédente'} : « {group.search.query} »
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {group.profiles.map((p) => (
              <SourcingProfileCard key={p.id} profile={p} />
            ))}
          </ul>
        </div>
      ))}

      {view.exhausted ? (
        <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 font-body text-[13px] text-stone-700">
          {view.groups[0]?.search.returned ?? 100} profils examinés — modifiez la requête pour relancer.
        </p>
      ) : null}
    </section>
  );
}
