'use client';

/**
 * Une ligne de la liste du vivier : identité, statut d'indexation, tags
 * éditables, actions (réindexer si échec, supprimer).
 */

import { Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import type { VivierCandidate, VivierIndexingStatus } from '@/types/vivier';

const STATUS_META: Record<
  VivierIndexingStatus,
  { label: string; className: string }
> = {
  indexed: { label: 'Indexé', className: 'bg-emerald-50 text-emerald-700' },
  pending: { label: 'Indexation…', className: 'bg-amber-50 text-amber-700' },
  failed: { label: 'Échec', className: 'bg-rose-50 text-rose-700' },
};

export function VivierListRow({
  candidate,
  onChanged,
  onDelete,
}: {
  candidate: VivierCandidate;
  onChanged: () => void;
  onDelete: (c: VivierCandidate) => void;
}) {
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);
  const status = STATUS_META[candidate.indexingStatus];

  async function saveTags(tags: string[]) {
    setBusy(true);
    try {
      await fetch(`/api/vivier/${candidate.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t) return;
    if (candidate.tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setTagInput('');
      return;
    }
    setTagInput('');
    void saveTags([...candidate.tags, t]);
  }

  async function reindex() {
    setBusy(true);
    try {
      await fetch(`/api/vivier/${candidate.id}/reindex`, { method: 'POST' });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-body text-[14px] font-semibold text-stone-800">
            {candidate.nom}
          </p>
          <p className="truncate font-body text-[12px] text-stone-500">
            {candidate.email}
            {candidate.telephone ? ` · ${candidate.telephone}` : ''}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${status.className}`}
          >
            {status.label}
          </span>
          {candidate.indexingStatus === 'failed' ? (
            <button
              type="button"
              onClick={reindex}
              disabled={busy}
              title="Relancer l'indexation"
              className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onDelete(candidate)}
            title="Supprimer du vivier"
            className="rounded-md p-1.5 text-stone-500 hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {candidate.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 font-body text-[11px] text-stone-600"
          >
            {tag}
            <button
              type="button"
              onClick={() => void saveTags(candidate.tags.filter((t) => t !== tag))}
              className="text-stone-400 hover:text-stone-700"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
        <span className="inline-flex items-center">
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="ajouter un tag"
            className="w-28 rounded-full border border-stone-200 px-2 py-0.5 font-body text-[11px] text-stone-700 outline-none focus:border-blue-400"
          />
          <button
            type="button"
            onClick={addTag}
            disabled={busy}
            className="ml-1 rounded-full p-1 text-stone-400 hover:bg-stone-100 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-3 w-3" aria-hidden />
            )}
          </button>
        </span>
        <span className="ml-auto font-body text-[11px] text-stone-400">
          MAJ {new Date(candidate.updatedAt).toLocaleDateString('fr-FR')}
        </span>
      </div>
    </li>
  );
}
