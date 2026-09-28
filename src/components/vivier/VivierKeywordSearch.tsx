'use client';

/**
 * Recherche par MOT-CLÉ exacte sur le vivier (plein-texte) + repêchage manuel
 * vers la liste de validation. STRICTEMENT distincte de la présélection
 * sémantique : on RETROUVE une chaîne exacte (présente ou non), on ne juge pas
 * une pertinence. Chaque résultat montre nom, titre, et l'extrait du CV où le
 * mot apparaît (surligné), plus une action selon sa présence dans la liste.
 * Spec : docs/specs/vivier.md.
 */

import { useState } from 'react';

import type { VivierKeywordResult } from '@/types/vivier-keyword-search';

import type { VivierTarget } from './useVivierInvite';
import { VivierKeywordResultRow } from './VivierKeywordResultRow';
import { targetFromKeyword } from './vivier-targets';

/**
 * Les résultats portent les MÊMES gestes que les profils proposés : « CV » et
 * « Inviter », sur place. Plus de détour par « ajouter à la liste », qui
 * obligeait à fermer puis rouvrir l'écran pour retrouver le profil.
 */
export function VivierKeywordSearch({
  campaignId,
  invitingId,
  decided,
  onPreview,
  onReject,
  onInvite,
}: {
  campaignId: string;
  invitingId: string | null;
  /** Décidés depuis l'écran (aperçu compris) : l'état affiché les suit. */
  decided: ReadonlyMap<string, 'contacted' | 'rejected'>;
  onPreview: (target: VivierTarget) => void;
  onReject: (target: VivierTarget) => void;
  onInvite: (target: VivierTarget) => void;
}) {
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [results, setResults] = useState<VivierKeywordResult[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/vivier-keyword-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = (await res.json()) as {
        results?: VivierKeywordResult[];
        total?: number;
        message?: string;
      };
      if (!res.ok) {
        setError(data.message ?? 'La recherche a échoué.');
        return;
      }
      const next = data.results ?? [];
      setResults(next);
      setTotal(data.total ?? next.length);
      setLastQuery(q);
    } catch {
      setError('La recherche a échoué (réseau).');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-stone-50/40 p-3">
      <div>
        <h4 className="font-body text-[12px] font-semibold text-stone-700">
          Recherche par mot-clé
        </h4>
        <p className="font-body text-[11px] text-stone-400">
          Plein-texte exact sur le CV (mot entier). Aucun classement de
          pertinence — distinct de la présélection sémantique.
        </p>
      </div>

      <div className="flex items-center gap-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
          placeholder="Mot-clé exact (ex. SAP)"
          className="w-64 rounded-md border border-stone-200 px-2 py-1.5 font-body text-[12px] text-stone-700 outline-none focus:border-emerald-400"
        />
        <button
          type="button"
          onClick={search}
          disabled={busy || query.trim().length === 0}
          className="rounded-md border border-stone-200 bg-white px-3 py-1.5 font-body text-[12px] font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
        >
          Rechercher
        </button>
      </div>

      {error ? (
        <p className="font-body text-[12px] text-rose-600">{error}</p>
      ) : null}

      {results === null ? null : results.length === 0 ? (
        <p className="font-body text-[12px] text-stone-400">
          {busy
            ? 'Recherche en cours…'
            : `Aucun CV ne contient « ${lastQuery} ».`}
        </p>
      ) : (
        <>
          {total > results.length ? (
            <p className="font-body text-[12px] font-semibold text-amber-700">
              {`Les ${results.length} dossiers les plus récents affichés sur ${total} contenant « ${lastQuery} » — affinez le mot-clé pour tout voir.`}
            </p>
          ) : null}
        <ul className="flex flex-col gap-2">
          {results.map((found) => {
            const now = decided.get(found.candidateId);
            const r = now ? { ...found, membership: now } : found;
            const target = targetFromKeyword(r, lastQuery);
            return (
              <VivierKeywordResultRow
                key={r.candidateId}
                result={r}
                campaignId={campaignId}
                why={target.lines}
                busy={invitingId === r.candidateId}
                locked={invitingId !== null}
                onPreview={() => onPreview(target)}
                onReject={() => onReject(target)}
                onInvite={() => onInvite(target)}
              />
            );
          })}
        </ul>
        </>
      )}
    </section>
  );
}
