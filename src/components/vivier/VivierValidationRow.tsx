'use client';

/**
 * Un profil PROPOSÉ par la présélection (Session V3, §5.2/5.3 ; 28/09/2026).
 * Ligne compacte (identité, dernier poste visé, correspondance, fraîcheur, les
 * trois gestes) ; DÉPLIÉE au clic sur le nom : pourquoi il est là, synthèse,
 * historique, CV (`VivierProfileDetail`). Case de sélection pour écarter en
 * masse.
 */

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { freshnessLabel } from '@/lib/vivier/freshness-label';
import type { ShortlistEntry } from '@/types/vivier-preselection';

import { VivierActions } from './VivierActions';
import { VivierProfileDetail } from './VivierProfileDetail';
import { targetFromEntry } from './vivier-targets';

export function VivierValidationRow({
  entry,
  campaignId,
  selected,
  busy,
  locked,
  onToggleSelect,
  onPreview,
  onInvite,
  onReject,
}: {
  entry: ShortlistEntry;
  campaignId: string;
  selected: boolean;
  busy: boolean;
  /** Une invitation est en cours sur la liste : un geste à la fois. */
  locked: boolean;
  onToggleSelect: () => void;
  onPreview: () => void;
  onInvite: () => void;
  onReject: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-lg border border-stone-200 bg-white">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 shrink-0 accent-emerald-600"
          aria-label={`Sélectionner ${entry.nom}`}
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-role="vivier-expand"
          title={open ? 'Replier' : 'Synthèse et historique'}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="block truncate font-body text-[13px] font-semibold text-stone-800">{entry.nom}</span>
            <span className="block truncate font-body text-[11px] text-stone-400">{entry.email}</span>
          </span>
        </button>
        {entry.lastJobTitle ? (
          <span
            title={`Dernier poste visé : ${entry.lastJobTitle}`}
            className="hidden max-w-[180px] shrink-0 truncate font-body text-[12px] text-stone-600 md:inline"
          >
            {entry.lastJobTitle}
          </span>
        ) : null}
        {entry.matchKind === 'title_exact' ? (
          <span
            title={entry.matchTerm ? `Correspondance de titre : ${entry.matchTerm}` : 'Correspondance de titre'}
            className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 font-body text-[11px] font-semibold text-white"
          >
            titre
          </span>
        ) : (
          <span
            title="Titre proche (similarité)"
            className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 font-body text-[12px] font-semibold text-emerald-700"
          >
            {Math.round(entry.similarity * 100)}%
          </span>
        )}
        <span className="hidden shrink-0 font-body text-[11px] text-stone-500 sm:inline">
          {freshnessLabel(entry.updatedAt)}
        </span>
        <VivierActions busy={busy} locked={locked} onPreview={onPreview} onReject={onReject} onInvite={onInvite} />
      </div>

      {open ? (
        <VivierProfileDetail
          candidateId={entry.candidateId}
          campaignId={campaignId}
          why={targetFromEntry(entry).lines}
          onPreview={onPreview}
        />
      ) : null}
    </li>
  );
}
