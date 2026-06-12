'use client';

/**
 * Worklist org-level des prises de contact vivier en attente (Session V3, §5).
 * Niveau 1 : campagnes ayant ≥1 proposition `identified` (compteur, triées par
 * charge). Niveau 2 (au clic) : candidats `identified` de la campagne à arbitrer
 * (réutilise VivierValidationList). Lecture + décision, rien à configurer.
 */

import { useCallback, useEffect, useState } from 'react';

import type { PendingCampaignSummary } from '@/lib/db/repos/vivier-preselection';
import type { ShortlistEntry } from '@/types/vivier-preselection';

import { VivierValidationList } from './VivierValidationList';

export function VivierValidationsWorklist() {
  const [campaigns, setCampaigns] = useState<PendingCampaignSummary[]>([]);
  const [selected, setSelected] = useState<PendingCampaignSummary | null>(null);
  const [entries, setEntries] = useState<ShortlistEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/vivier/validations');
      const data = (await res.json()) as { campaigns: PendingCampaignSummary[] };
      setCampaigns(data.campaigns ?? []);
      return data.campaigns ?? [];
    } catch {
      setCampaigns([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEntries = useCallback(async (campaignId: string) => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/vivier-preselection`);
      const data = (await res.json()) as { entries?: ShortlistEntry[] };
      setEntries((data.entries ?? []).filter((e) => e.state === 'identified'));
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  async function open(camp: PendingCampaignSummary) {
    setSelected(camp);
    await loadEntries(camp.campaignId);
  }

  // Après une décision : on rafraîchit la campagne ouverte ET la liste. Si la
  // campagne n'a plus d'attente, on revient au niveau 1 (elle en sort).
  async function onDecided() {
    if (!selected) return;
    await loadEntries(selected.campaignId);
    const fresh = await loadCampaigns();
    if (!fresh.some((c) => c.campaignId === selected.campaignId)) {
      setSelected(null);
    }
  }

  if (loading) {
    return <p className="font-body text-[13px] text-stone-400">Chargement…</p>;
  }

  if (selected) {
    return (
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="self-start font-body text-[12px] text-stone-500 hover:text-stone-800"
        >
          ← Toutes les campagnes
        </button>
        <h2 className="font-display text-lg font-bold text-stone-900">
          {selected.campaignName}
        </h2>
        {entries.length === 0 ? (
          <p className="font-body text-[13px] text-stone-400">
            Toutes les prises de contact de cette campagne ont été traitées.
          </p>
        ) : (
          <VivierValidationList
            campaignId={selected.campaignId}
            entries={entries}
            onDecided={onDecided}
          />
        )}
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <p className="font-body text-[14px] text-stone-500">
        Aucune prise de contact vivier en attente.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {campaigns.map((c) => (
        <li key={c.campaignId}>
          <button
            type="button"
            onClick={() => open(c)}
            className="flex w-full items-center justify-between rounded-lg border border-stone-200 bg-white px-4 py-3 text-left hover:border-emerald-300 hover:bg-emerald-50/30"
          >
            <span className="font-body text-[14px] font-semibold text-stone-800">
              {c.campaignName}
            </span>
            <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 font-body text-[12px] font-semibold text-white">
              {c.pendingCount} à valider
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
