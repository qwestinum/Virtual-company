'use client';

/** Extrait surligné et état d'un résultat de la recherche par mot-clé. */

import type { VivierKeywordMembership } from '@/types/vivier-keyword-search';

/** Découpe l'extrait sur les sentinelles [[HL]]…[[/HL]] : indices impairs = surlignés. */
const HL_SPLIT = /\[\[HL\]\]([\s\S]*?)\[\[\/HL\]\]/;

export function Snippet({ text }: { text: string }) {
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

export function MembershipBadge({ membership }: { membership: VivierKeywordMembership }) {
  const label =
    membership === 'contacted'
      ? 'Déjà contacté'
      : membership === 'rejected'
        ? 'Écarté pour cette campagne'
        : 'Dans les profils à examiner';
  return (
    <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 font-body text-[11px] font-semibold text-stone-500">
      {label}
    </span>
  );
}
