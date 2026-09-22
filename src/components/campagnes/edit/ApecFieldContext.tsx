'use client';

/**
 * Ce que chaque ligne du formulaire APEC doit savoir d'elle-même : est-elle
 * OBLIGATOIRE (astérisque), et en FAUTE à la dernière vérification (encadré
 * rouge + message) ?
 *
 * Un contexte plutôt que deux props de plus à faire descendre dans trois
 * formulaires : la ligne se désigne par son champ, et l'état vient d'un seul
 * endroit — le panneau.
 */
import { createContext, useContext, type ReactNode } from 'react';

import { isApecFieldRequired } from '@/lib/jobboards/adep/draft-check';
import type { AdepDraftOffer } from '@/lib/jobboards/adep/mapping';
import type { AdepOffer } from '@/types/adep';

type ApecFieldContextValue = {
  offer: AdepDraftOffer;
  errors: Map<string, string>;
};

const Ctx = createContext<ApecFieldContextValue | null>(null);

export function ApecFieldProvider({
  offer,
  errors,
  children,
}: ApecFieldContextValue & { children: ReactNode }) {
  return <Ctx.Provider value={{ offer, errors }}>{children}</Ctx.Provider>;
}

export function useApecFieldState(field: keyof AdepOffer | undefined): {
  required: boolean;
  error: string | null;
} {
  const ctx = useContext(Ctx);
  if (!ctx || !field) return { required: false, error: null };
  return {
    required: isApecFieldRequired(field, ctx.offer),
    error: ctx.errors.get(field) ?? null,
  };
}
