'use client';

/**
 * Panneau de présélection vivier d'une campagne (Session V2 — affichage
 * préparatoire, docs/specs/vivier.md §4/§6). Objectif V2 : prouver que la
 * cascade produit des résultats pertinents. Trois fonctions :
 *   - affiche la short-list persistée (GET) ;
 *   - « Relancer la recherche vivier » (POST sans corps — endpoint idempotent) ;
 *   - recherche libre complémentaire (POST { freeText } — résultats éphémères).
 * La section Validation vivier complète (décisions accepter/rejeter) est en V3.
 * La recherche par MOT-CLÉ (plein-texte + repêchage) est une fonction à part,
 * STRICTEMENT distincte de la présélection sémantique (cf. VivierKeywordSearch).
 */

import { useCallback, useEffect, useState } from 'react';

import type { ShortlistEntry } from '@/types/vivier-preselection';

import { VivierKeywordSearch } from './VivierKeywordSearch';
import { VivierPreselectionRow } from './VivierPreselectionRow';

type Meta = {
  indexedCount: number;
  deterministicCount: number;
  semanticCount: number;
  belowThreshold: number;
};

export function VivierPreselectionPanel({ campaignId }: { campaignId: string }) {
  const [entries, setEntries] = useState<ShortlistEntry[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/campaigns/${campaignId}/vivier-preselection`;

  const loadPersisted = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (!res.ok) return;
      const data = (await res.json()) as { entries: ShortlistEntry[] };
      setEntries(data.entries);
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
    await post();
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
      </div>

      {error ? (
        <p className="font-body text-[12px] text-rose-600">{error}</p>
      ) : null}

      {/* Transparence du run : origine des matchs + écartés sous le seuil. */}
      {meta ? (
        <p className="font-body text-[11px] text-stone-400">
          {meta.deterministicCount} correspondance
          {meta.deterministicCount > 1 ? 's' : ''} de titre ·{' '}
          {meta.semanticCount} titre{meta.semanticCount > 1 ? 's' : ''} proche
          {meta.semanticCount > 1 ? 's' : ''}
          {meta.belowThreshold > 0
            ? ` · ${meta.belowThreshold} sous le seuil`
            : ''}{' '}
          (sur {meta.indexedCount} indexé{meta.indexedCount > 1 ? 's' : ''}).
        </p>
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
                  Origine
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

      <VivierKeywordSearch campaignId={campaignId} />
    </div>
  );
}
