'use client';

/**
 * Suggestion de variantes de mots-clés par IA (Phase 3b). Panneau INLINE sous
 * le KeywordsInput : bouton → appel API → chips sélectionnables → ajout à la
 * liste. La logique de sélection est PURE (`toggleVariant`).
 */

import { Loader2, Sparkles, X } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import { toggleVariant } from '@/lib/scoring/variant-selection';
import type { VerificationMethod } from '@/types/scoring';

export function KeywordVariantsSuggester({
  criterionLabel,
  existingKeywords,
  targetMethod,
  onAccept,
}: {
  criterionLabel: string;
  existingKeywords: string[];
  targetMethod: VerificationMethod;
  onAccept: (variants: string[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function fetchSuggestions() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/scoring/suggest-keyword-variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criterionLabel, existingKeywords, targetMethod }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error === 'config_missing'
            ? "Service IA non configuré."
            : (data.message ?? 'Échec de la suggestion.'),
        );
        return;
      }
      const data = await res.json();
      const variants = (data.suggestedVariants as string[]) ?? [];
      setSuggestions(variants);
      setSelected(variants); // tout sélectionné par défaut
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setLoading(false);
    }
  }

  function close() {
    setSuggestions(null);
    setSelected([]);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={fetchSuggestions}
        disabled={loading}
        className="inline-flex w-fit items-center gap-1 rounded border border-stone-300 px-1.5 py-0.5 font-body text-[10px] font-semibold text-stone-600 hover:bg-stone-50 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="h-3 w-3" aria-hidden />
        )}
        Suggérer des variantes par IA
      </button>

      {error ? (
        <p className="font-body text-[11px] text-rose-600">
          {error}{' '}
          <button type="button" onClick={fetchSuggestions} className="underline">
            Réessayer
          </button>
        </p>
      ) : null}

      {suggestions !== null ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50/60 p-2">
          {suggestions.length === 0 ? (
            <p className="font-body text-[11px] text-stone-500">
              Aucune variante complémentaire proposée.
            </p>
          ) : (
            <>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-body text-[10px] font-semibold uppercase tracking-wide text-stone-400">
                  Propositions ({selected.length}/{suggestions.length})
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelected(suggestions)}
                    className="font-body text-[10px] text-stone-500 hover:text-stone-800"
                  >
                    Tout sélectionner
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected([])}
                    className="font-body text-[10px] text-stone-500 hover:text-stone-800"
                  >
                    Tout désélectionner
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {suggestions.map((v) => {
                  const on = selected.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setSelected((s) => toggleVariant(s, v))}
                      className={cn(
                        'rounded-full px-2 py-0.5 font-body text-[11px] border',
                        on
                          ? 'border-amber-300 bg-amber-100 text-amber-800'
                          : 'border-stone-300 bg-white text-stone-500',
                      )}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="inline-flex items-center gap-1 rounded px-2 py-1 font-body text-[11px] font-semibold text-stone-500 hover:bg-stone-100"
            >
              <X className="h-3 w-3" aria-hidden />
              Annuler
            </button>
            <button
              type="button"
              disabled={selected.length === 0}
              onClick={() => {
                onAccept(selected);
                close();
              }}
              className="rounded bg-amber-500 px-2.5 py-1 font-body text-[11px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              Ajouter à la liste
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
