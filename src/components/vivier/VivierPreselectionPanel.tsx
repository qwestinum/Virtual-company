'use client';

/**
 * Panneau de présélection vivier d'une campagne (Session V2 — affichage
 * préparatoire, docs/specs/vivier.md §4/§6). Objectif V2 : prouver que la
 * cascade produit des résultats pertinents. Trois fonctions :
 *   - affiche la short-list persistée (GET) ;
 *   - « Relancer la recherche vivier » (POST sans corps — endpoint idempotent) ;
 *   - recherche libre complémentaire (POST { freeText } — résultats éphémères).
 * La section Validation vivier complète (décisions accepter/rejeter) est en V3.
 */

import { useCallback, useEffect, useState } from 'react';

import type { ShortlistEntry } from '@/types/vivier-preselection';

import { VivierPreselectionRow } from './VivierPreselectionRow';

type Mode = 'fiche' | 'libre';
type Meta = {
  indexedCount: number;
  survivors: number;
  eliminatedByHardFilters: number;
  fallbackSemantic: boolean;
};

export function VivierPreselectionPanel({ campaignId }: { campaignId: string }) {
  const [entries, setEntries] = useState<ShortlistEntry[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [mode, setMode] = useState<Mode>('fiche');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freeText, setFreeText] = useState('');

  const base = `/api/campaigns/${campaignId}/vivier-preselection`;

  const loadPersisted = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (!res.ok) return;
      const data = (await res.json()) as { entries: ShortlistEntry[] };
      setEntries(data.entries);
      setMode('fiche');
    } catch {
      /* silencieux : l'affichage reste vide */
    }
  }, [base]);

  useEffect(() => {
    void loadPersisted();
  }, [loadPersisted]);

  async function post(body?: object): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: 'POST',
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
      const data = (await res.json()) as {
        entries?: ShortlistEntry[];
        meta?: Meta;
        message?: string;
      };
      if (!res.ok) {
        setError(data.message ?? 'La présélection a échoué.');
        return;
      }
      setEntries(data.entries ?? []);
      setMeta(data.meta ?? null);
    } catch {
      setError('La présélection a échoué (réseau).');
    } finally {
      setBusy(false);
    }
  }

  async function relaunch() {
    setMode('fiche');
    await post();
  }

  async function search() {
    const q = freeText.trim();
    if (!q) return;
    setMode('libre');
    await post({ freeText: q });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={relaunch}
          disabled={busy}
          className="rounded-md bg-emerald-600 px-3 py-1.5 font-body text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Relancer la recherche vivier
        </button>
        <div className="ml-auto flex items-center gap-1">
          <input
            value={freeText}
            onChange={(e) => setFreeText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void search();
              }
            }}
            placeholder="Recherche libre (ex. devops senior bancaire)"
            className="w-64 rounded-md border border-stone-200 px-2 py-1.5 font-body text-[12px] text-stone-700 outline-none focus:border-emerald-400"
          />
          <button
            type="button"
            onClick={search}
            disabled={busy || freeText.trim().length === 0}
            className="rounded-md border border-stone-200 px-3 py-1.5 font-body text-[12px] font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            Rechercher
          </button>
        </div>
      </div>

      {mode === 'libre' ? (
        <p className="font-body text-[11px] text-amber-700">
          Résultats de recherche libre — éphémères, non enregistrés.
        </p>
      ) : null}
      {error ? (
        <p className="font-body text-[12px] text-rose-600">{error}</p>
      ) : null}

      {/* Transparence du run : combien écartés par les filtres durs + repli. */}
      {meta && mode === 'fiche' ? (
        meta.fallbackSemantic ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 font-body text-[12px] text-amber-800">
            Aucun candidat ne passe <strong>tous</strong> les critères durs
            ({meta.eliminatedByHardFilters} dossier
            {meta.eliminatedByHardFilters > 1 ? 's' : ''} écarté
            {meta.eliminatedByHardFilters > 1 ? 's' : ''} sur {meta.indexedCount}).
            Voici les profils les <strong>plus proches sémantiquement</strong> —
            assouplissez un critère rédhibitoire/obligatoire pour un vrai filtrage.
          </p>
        ) : meta.eliminatedByHardFilters > 0 ? (
          <p className="font-body text-[11px] text-stone-400">
            {meta.eliminatedByHardFilters} dossier
            {meta.eliminatedByHardFilters > 1 ? 's' : ''} écarté
            {meta.eliminatedByHardFilters > 1 ? 's' : ''} par les filtres durs ·{' '}
            {meta.survivors} retenu{meta.survivors > 1 ? 's' : ''} sur{' '}
            {meta.indexedCount} indexé{meta.indexedCount > 1 ? 's' : ''}.
          </p>
        ) : null
      ) : null}

      {entries.length === 0 ? (
        <p className="font-body text-[12px] text-stone-400">
          {busy
            ? 'Présélection en cours…'
            : 'Aucune proposition pour le moment. Relancez la recherche après avoir enrichi le vivier.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-stone-50 text-left">
                <th className="px-2 py-2 text-center font-body text-[11px] font-semibold text-stone-500">
                  #
                </th>
                <th className="px-2 py-2 font-body text-[11px] font-semibold text-stone-500">
                  Candidat
                </th>
                <th className="px-2 py-2 font-body text-[11px] font-semibold text-stone-500">
                  Pertinence
                </th>
                <th className="px-2 py-2 font-body text-[11px] font-semibold text-stone-500">
                  Filtres durs passés
                </th>
                <th className="px-2 py-2 font-body text-[11px] font-semibold text-stone-500">
                  Fraîcheur
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <VivierPreselectionRow key={e.candidateId} entry={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
