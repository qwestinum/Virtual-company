'use client';

/**
 * Saisie des mots-clés d'un critère (fiche hybride, Phase 2). Saisie par ligne
 * ou virgule → chips supprimables ; refus des blancs et doublons (helpers purs
 * `addKeywords` / `removeKeywordAt`). Le bouton « Suggérer par IA » est visible
 * mais DÉSACTIVÉ (implémentation Phase 3).
 */

import { X } from 'lucide-react';
import { useState } from 'react';

import { KeywordVariantsSuggester } from '@/components/scoring/KeywordVariantsSuggester';
import { cn } from '@/lib/utils';
import { addKeywords, removeKeywordAt } from '@/lib/scoring/keywords-input';
import type { VerificationMethod } from '@/types/scoring';

export function KeywordsInput({
  keywords,
  onChange,
  disabled = false,
  label = 'Mots-clés',
  showSuggest = false,
  criterionLabel,
  targetMethod,
}: {
  keywords: string[];
  onChange: (keywords: string[]) => void;
  disabled?: boolean;
  label?: string;
  /** Active la suggestion de variantes par IA (Phase 3b). */
  showSuggest?: boolean;
  /** Contexte requis par le suggester IA. */
  criterionLabel?: string;
  targetMethod?: VerificationMethod;
}) {
  const [draft, setDraft] = useState('');

  function commit() {
    const next = addKeywords(keywords, draft);
    if (next.length !== keywords.length) onChange(next);
    setDraft('');
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="font-body text-[10px] font-semibold uppercase tracking-wide text-stone-400">
        {label}
      </span>

      {keywords.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {keywords.map((kw, i) => (
            <span
              key={`${kw}-${i}`}
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-body text-[11px] text-amber-800"
            >
              {kw}
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => onChange(removeKeywordAt(keywords, i))}
                  aria-label={`Retirer ${kw}`}
                  className="text-amber-500 hover:text-amber-800"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {!disabled ? (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
          placeholder="Un par ligne ou séparés par des virgules…"
          className={cn(
            'font-body text-[12px] px-2 py-1 rounded border',
            'border-stone-200 bg-white outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-300',
          )}
        />
      ) : null}

      {!disabled && showSuggest && criterionLabel && targetMethod ? (
        <KeywordVariantsSuggester
          criterionLabel={criterionLabel}
          existingKeywords={keywords}
          targetMethod={targetMethod}
          onAccept={(variants) =>
            onChange(addKeywords(keywords, variants.join('\n')))
          }
        />
      ) : null}
    </div>
  );
}
