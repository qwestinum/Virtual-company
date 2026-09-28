'use client';

/**
 * Liste de décision vivier d'UNE campagne (Session V3, §5 ; point 1 du
 * 28/09/2026). Données par props (`entries` = propositions `identified`).
 *
 * Trois gestes par profil : « CV » (aperçu), « Inviter » (le profil devient
 * une candidature et reçoit l'invitation) et « Écarter » (exclusion pour cette
 * campagne, rien n'est envoyé — à l'unité ou en masse, route
 * `/vivier-preselection/decisions`). L'aperçu et l'invitation vivent dans le
 * PANNEAU : la recherche par mot-clé porte les mêmes gestes.
 */

import { useState } from 'react';

import type { ShortlistEntry } from '@/types/vivier-preselection';

import type { VivierNotice } from './useVivierInvite';
import { VivierValidationRow } from './VivierValidationRow';

/** Le message après « Inviter » — rouge réservé à l'échec. */
export function VivierNoticeLine({ notice }: { notice: VivierNotice }) {
  const color = notice.tone === 'ok' ? 'text-emerald-700' : notice.tone === 'warn' ? 'text-amber-700' : 'text-rose-600';
  return (
    <p role="status" data-role="vivier-invite-notice" className={`font-body text-[12px] ${color}`}>
      {notice.text}
    </p>
  );
}

/** Écarter une ou plusieurs propositions (rien n'est envoyé). */
export async function rejectProposals(campaignId: string, candidateIds: string[], matchTerm?: string): Promise<boolean> {
  if (candidateIds.length === 0) return false;
  const res = await fetch(`/api/campaigns/${campaignId}/vivier-preselection/decisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidateIds, decision: 'reject', matchTerm }),
  });
  return res.ok;
}

export function VivierValidationList({
  campaignId,
  entries,
  onDecided,
  onPreview,
  onInvite,
  invitingId,
}: {
  campaignId: string;
  entries: ShortlistEntry[];
  onDecided: () => void;
  onPreview: (entry: ShortlistEntry) => void;
  onInvite: (entry: ShortlistEntry) => void;
  /** Invitation en cours (un geste à la fois, sur tout l'écran). */
  invitingId: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function reject(candidateIds: string[]) {
    try {
      await rejectProposals(campaignId, candidateIds);
      setSelected(new Set());
      onDecided();
    } catch {
      /* l'appel échoué laisse la proposition en attente — réessayable */
    }
  }

  async function rejectUnit(id: string) {
    setBusyId(id);
    await reject([id]);
    setBusyId(null);
  }

  async function rejectBulk() {
    setBulkBusy(true);
    await reject([...selected]);
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
            onChange={() => setSelected(allSelected ? new Set() : new Set(entries.map((e) => e.candidateId)))}
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
              onClick={rejectBulk}
              disabled={bulkBusy}
              className="rounded-md border border-stone-200 px-3 py-1.5 font-body text-[12px] font-semibold text-stone-700 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
            >
              Écarter la sélection
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
            busy={busyId === entry.candidateId || invitingId === entry.candidateId || bulkBusy}
            locked={invitingId !== null}
            onToggleSelect={() => toggle(entry.candidateId)}
            onPreview={() => onPreview(entry)}
            onInvite={() => onInvite(entry)}
            onReject={() => void rejectUnit(entry.candidateId)}
          />
        ))}
      </ul>
    </div>
  );
}
