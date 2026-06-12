'use client';

/**
 * Liste de validation vivier d'UNE campagne (Session V3, §5). Composant
 * AUTONOME et portable : données par props (`entries` = propositions
 * `identified`), logique de décision encapsulée. Décisions unitaires (par ligne)
 * et en MASSE (sélection multiple + barre d'action). Appelle `onDecided` après
 * chaque décision pour laisser le parent rafraîchir la worklist.
 */

import { useState } from 'react';

import type { ShortlistEntry } from '@/types/vivier-preselection';

import { VivierValidationRow } from './VivierValidationRow';

export function VivierValidationList({
  campaignId,
  entries,
  onDecided,
}: {
  campaignId: string;
  entries: ShortlistEntry[];
  onDecided: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function decide(candidateIds: string[], decision: 'accept' | 'reject') {
    if (candidateIds.length === 0) return;
    try {
      await fetch(`/api/campaigns/${campaignId}/vivier-preselection/decisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateIds, decision }),
      });
      setSelected(new Set());
      onDecided();
    } catch {
      /* l'appel échoué laisse la proposition en attente — réessayable */
    }
  }

  async function decideUnit(id: string, decision: 'accept' | 'reject') {
    setBusyId(id);
    await decide([id], decision);
    setBusyId(null);
  }

  async function decideBulk(decision: 'accept' | 'reject') {
    setBulkBusy(true);
    await decide([...selected], decision);
    setBulkBusy(false);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = entries.length > 0 && selected.size === entries.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <label className="flex items-center gap-1.5 font-body text-[12px] text-stone-600">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() =>
              setSelected(
                allSelected ? new Set() : new Set(entries.map((e) => e.candidateId)),
              )
            }
            className="h-4 w-4 accent-emerald-600"
          />
          Tout sélectionner
        </label>
        {selected.size > 0 ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="font-body text-[12px] text-stone-500">
              {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={() => decideBulk('accept')}
              disabled={bulkBusy}
              className="rounded-md bg-emerald-600 px-3 py-1.5 font-body text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Accepter la prise de contact
            </button>
            <button
              type="button"
              onClick={() => decideBulk('reject')}
              disabled={bulkBusy}
              className="rounded-md border border-stone-200 px-3 py-1.5 font-body text-[12px] font-semibold text-stone-700 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
            >
              Rejeter
            </button>
          </div>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <VivierValidationRow
            key={entry.candidateId}
            entry={entry}
            campaignId={campaignId}
            selected={selected.has(entry.candidateId)}
            busy={busyId === entry.candidateId || bulkBusy}
            onToggleSelect={() => toggle(entry.candidateId)}
            onDecide={(decision) => decideUnit(entry.candidateId, decision)}
          />
        ))}
      </ul>
    </div>
  );
}
