'use client';

/**
 * Tête de /settings : la recherche, ce qui manque, et l'ouverture en masse.
 *
 * Les réglages qui cassent le pipeline le font en SILENCE (aucune adresse de
 * synthèse cochée, pas de clé d'envoi). Les annoncer ici évite de découvrir le
 * problème par un candidat qui n'a jamais reçu son mail — et depuis le
 * 02/10/2026 l'annonce dit LEQUEL et OÙ (famille › section), avec un lien qui
 * y mène : « 2 réglages à compléter » obligeait à tout déplier pour trouver
 * le badge.
 */

import { Search, X } from 'lucide-react';

import type { MissingSetting } from '@/lib/settings/section-summary';

export function SettingsToolbar({
  query,
  onQueryChange,
  resultCount,
  missing,
  onGoTo,
  openCount,
  total,
  onOpenAll,
  onCloseAll,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  /** `null` = pas de recherche en cours. */
  resultCount: number | null;
  missing: MissingSetting[];
  onGoTo: (sectionId: string) => void;
  openCount: number;
  total: number;
  onOpenAll: () => void;
  onCloseAll: () => void;
}) {
  const allOpen = openCount >= total;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[240px] flex-1">
          <span className="sr-only">Rechercher un réglage</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onQueryChange('');
            }}
            placeholder="Rechercher un réglage : agenda, refus, Resend, cooldown, APEC…"
            data-settings-search
            className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-9 pr-9 font-body text-[14px] text-stone-800 outline-none focus:border-emerald-500"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label="Effacer la recherche"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-stone-400 hover:text-stone-700"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          ) : null}
        </label>
        <button
          type="button"
          onClick={allOpen ? onCloseAll : onOpenAll}
          className="rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-50"
        >
          {allOpen ? 'Tout replier' : 'Tout déplier'}
        </button>
      </div>

      {resultCount !== null ? (
        <p className="font-body text-[13px] text-stone-600" aria-live="polite">
          {resultCount === 0
            ? `Aucun réglage ne correspond à « ${query.trim()} ».`
            : `${resultCount} réglage${resultCount > 1 ? 's' : ''} correspond${resultCount > 1 ? 'ent' : ''} à « ${query.trim()} ».`}
        </p>
      ) : missing.length > 0 ? (
        <div
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
          data-settings-missing
        >
          <p className="font-body text-[13px] font-semibold text-amber-900">
            {missing.length} réglage{missing.length > 1 ? 's' : ''} essentiel
            {missing.length > 1 ? 's' : ''} à compléter
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {missing.map((m) => (
              <li
                key={m.sectionId}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-body text-[13px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-stone-800">{m.message}</span>
                  <span className="block text-[12px] text-stone-600">
                    {m.familyLabel} › {m.sectionTitle}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onGoTo(m.sectionId)}
                  data-settings-goto={m.sectionId}
                  className="shrink-0 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-[12px] font-semibold text-amber-900 hover:bg-amber-100"
                >
                  Y aller
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="font-body text-[13px] text-stone-500">
          Tout est configuré · {total} réglage{total > 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}
