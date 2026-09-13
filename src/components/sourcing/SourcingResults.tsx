'use client';

/**
 * Liste des profils à examiner — conteneur (chargement, « 50 de plus »,
 * lignes dépliées). Le rendu vit dans `SourcingResultsList`.
 */

import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { INITIAL_EXPANSION, setSingle, toggleRow, type ExpansionState } from '@/lib/sourcing/expansion';
import type { ProfilesView } from '@/lib/sourcing/profiles-view';

import { SourcingResultsList, type RowExtras } from './SourcingResultsList';

export function SourcingResults({
  campaignId,
  version,
  extras,
}: {
  campaignId: string;
  version: number;
  extras?: RowExtras;
}) {
  const [view, setView] = useState<ProfilesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expansion, setExpansion] = useState<ExpansionState>(INITIAL_EXPANSION);
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

  return (
    <SourcingResultsList
      view={view}
      expansion={expansion}
      onToggle={(id) => setExpansion((s) => toggleRow(s, id))}
      onSingleChange={(single) => setExpansion((s) => setSingle(s, single))}
      onMore={() => void more()}
      promoting={promoting}
      extras={extras}
    />
  );
}
