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

import type {
  VivierKeywordMembership,
  VivierKeywordResult,
} from '@/types/vivier-keyword-search';

/** Découpe l'extrait sur les sentinelles [[HL]]…[[/HL]] : indices impairs = surlignés. */
const HL_SPLIT = /\[\[HL\]\]([\s\S]*?)\[\[\/HL\]\]/;

function Snippet({ text }: { text: string }) {
  const parts = text.split(HL_SPLIT);
  return (
    <p className="font-body text-[12px] leading-relaxed text-stone-600">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-amber-200 px-0.5 text-stone-900">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

function MembershipBadge({ membership }: { membership: VivierKeywordMembership }) {
  const label = membership === 'contacted' ? 'Déjà contacté' : 'Déjà dans la liste';
  return (
    <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 font-body text-[11px] font-semibold text-stone-500">
      {label}
    </span>
  );
}

export function VivierKeywordSearch({ campaignId }: { campaignId: string }) {
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [results, setResults] = useState<VivierKeywordResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

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
        message?: string;
      };
      if (!res.ok) {
        setError(data.message ?? 'La recherche a échoué.');
        return;
      }
      setResults(data.results ?? []);
      setLastQuery(q);
    } catch {
      setError('La recherche a échoué (réseau).');
    } finally {
      setBusy(false);
    }
  }

  async function repecher(candidateId: string) {
    setAddingId(candidateId);
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/vivier-preselection/repechage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidateId, matchTerm: lastQuery }),
        },
      );
      const data = (await res.json()) as { membership?: VivierKeywordMembership };
      if (res.ok && data.membership) {
        const next = data.membership;
        setResults((prev) =>
          prev?.map((r) =>
            r.candidateId === candidateId ? { ...r, membership: next } : r,
          ) ?? null,
        );
      }
    } catch {
      /* réessayable : l'état du bouton n'a pas bougé */
    } finally {
      setAddingId(null);
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
        <ul className="flex flex-col gap-2">
          {results.map((r) => (
            <li
              key={r.candidateId}
              className="flex flex-col gap-1.5 rounded-md border border-stone-200 bg-white p-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-body text-[13px] font-semibold text-stone-800">
                    {[r.prenom, r.nom].filter(Boolean).join(' ') || r.nom}
                  </p>
                  <p className="truncate font-body text-[11px] text-stone-500">
                    {r.title ?? 'Poste non précisé'}
                  </p>
                </div>
                {r.membership === 'none' || r.membership === 'rejected' ? (
                  <button
                    type="button"
                    onClick={() => repecher(r.candidateId)}
                    disabled={addingId === r.candidateId}
                    className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 font-body text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    title={
                      r.membership === 'rejected'
                        ? 'Réactive ce candidat précédemment rejeté'
                        : undefined
                    }
                  >
                    {r.membership === 'rejected'
                      ? 'Repêcher'
                      : 'Ajouter à la liste de validation'}
                  </button>
                ) : (
                  <MembershipBadge membership={r.membership} />
                )}
              </div>
              <Snippet text={r.snippet} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
