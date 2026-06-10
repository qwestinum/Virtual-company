'use client';

/**
 * Liste déroulante GÉNÉRIQUE avec recherche intégrée + option « Tous » par
 * défaut. Brique mutualisée des filtres Reporting (donneur d'ordre, site…).
 * Présentationnel, contrôlé : l'état sélectionné vit chez le parent.
 */

import { Check, ChevronDown, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

export type SelectOption = { id: string; label: string };

export function SearchableSelect({
  label,
  options,
  value,
  onChange,
  allLabel = 'Tous',
  searchPlaceholder = 'Rechercher…',
}: {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (id: string) => void;
  allLabel?: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedLabel = useMemo(
    () => options.find((o) => o.id === value)?.label ?? allLabel,
    [options, value, allLabel],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  return (
    <div className="relative">
      <span className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-wide text-stone-500">
        {label}
      </span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-56 items-center justify-between gap-2 rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-amber-400"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-56 rounded-lg border border-stone-200 bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b border-stone-100 px-2.5 py-2">
              <Search className="h-3.5 w-3.5 text-stone-400" aria-hidden />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent font-body text-[13px] outline-none"
              />
            </div>
            <ul className="max-h-56 overflow-auto py-1">
              {[{ id: '', label: allLabel }, ...filtered].map((o) => (
                <li key={o.id || '__all'}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.id);
                      setOpen(false);
                      setQuery('');
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left font-body text-[13px] text-stone-700 hover:bg-amber-50/60"
                  >
                    <span className="truncate">{o.label}</span>
                    {o.id === value ? (
                      <Check className="h-3.5 w-3.5 text-amber-600" aria-hidden />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
