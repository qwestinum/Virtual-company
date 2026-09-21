'use client';

/**
 * Panneau de présélection vivier d'une campagne (Session V2 — affichage
 * préparatoire, docs/specs/vivier.md §4/§6). Objectif V2 : prouver que la
 * cascade produit des résultats pertinents. Trois fonctions :
 *   - affiche la short-list persistée (GET) ;
 *   - « Relancer la recherche vivier » (POST sans corps — endpoint idempotent) ;
 *   - recherche libre complémentaire (POST { freeText } — résultats éphémères).
 * ⚠️ LA DÉCISION SE PREND ICI (refonte, lot 4). Elle vivait dans une file
 * différée — « Validations vivier » — qu'il fallait aller chercher ailleurs :
 * sur 12 propositions générées en production, 8 n'y avaient jamais été
 * tranchées, dont deux depuis deux mois. Une file qu'on ne visite pas n'est
 * pas une file d'attente, c'est un oubli organisé.
 *
 * Aucun état intermédiaire : on voit le profil, on décide, le candidat entre
 * dans le pipeline. Le CHEMIN ne change pas — c'est `VivierValidationList`,
 * déplacée telle quelle (elle était déjà autonome et pilotée par props), et le
 * même endpoint de décision par campagne. Seul l'endroit change.
 *
 * La recherche par MOT-CLÉ (plein-texte + repêchage) est une fonction à part,
 * STRICTEMENT distincte de la présélection sémantique (cf. VivierKeywordSearch).
 */

import { useCallback, useEffect, useState } from 'react';

import type { ShortlistEntry } from '@/types/vivier-preselection';

import { VivierKeywordSearch } from './VivierKeywordSearch';
import { VivierValidationList } from './VivierValidationList';
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

  // Une proposition `identified` attend une décision ; les autres l'ont déjà
  // reçue. Les mélanger obligerait à lire l'état de chaque ligne pour savoir
  // laquelle appelle un geste.
  const aDecider = entries.filter((e) => e.state === 'identified');
  const tranches = entries.filter((e) => e.state !== 'identified');

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

      {/* ① CE QUI ATTEND UNE DÉCISION, en premier et décidable sur place. */}
      {aDecider.length > 0 ? (
        <section className="flex flex-col gap-2">
          <p className="font-body text-[12px] font-semibold text-stone-700">
            {aDecider.length} profil{aDecider.length > 1 ? 's' : ''} à examiner
            {' '}— accepter envoie une invitation à candidater.
          </p>
          <VivierValidationList
            campaignId={campaignId}
            entries={aDecider}
            onDecided={() => void loadPersisted()}
          />
        </section>
      ) : null}

      {/* ② Le reste de la short-list : déjà tranché, donc en lecture. */}
      {entries.length === 0 ? (
        <p className="font-body text-[12px] text-stone-400">
          {busy
            ? 'Présélection en cours…'
            : 'Aucune proposition pour le moment. Relancez la recherche après avoir enrichi le vivier.'}
        </p>
      ) : tranches.length === 0 ? null : (
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
              {tranches.map((e) => (
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
