'use client';

/**
 * Badge visuel de la méthode de vérification d'un critère (fiche hybride,
 * Phase 2). Couleurs : LLM neutre, MOTS-CLÉS accent ORQA (ambre), HYBRIDE
 * intermédiaire (indigo). Lecture seule.
 */

import { cn } from '@/lib/utils';
import {
  VERIFICATION_METHOD_BADGES,
  type VerificationMethod,
} from '@/types/scoring';

const TONE: Record<VerificationMethod, string> = {
  llm_with_quote: 'bg-stone-100 text-stone-600',
  keywords_exact: 'bg-amber-100 text-amber-800',
  keywords_with_variants: 'bg-amber-100 text-amber-800',
  hybrid_keywords_llm: 'bg-indigo-100 text-indigo-700',
};

export function MethodBadge({
  method = 'llm_with_quote',
  className,
}: {
  /** Coalescé au défaut llm_with_quote si absent (grilles antérieures). */
  method?: VerificationMethod;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'font-display text-[9px] uppercase tracking-[0.1em] font-semibold px-1.5 py-0.5 rounded shrink-0',
        TONE[method],
        className,
      )}
      title={`Méthode de vérification : ${VERIFICATION_METHOD_BADGES[method]}`}
    >
      {VERIFICATION_METHOD_BADGES[method]}
    </span>
  );
}
