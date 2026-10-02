'use client';

/**
 * Ouverture/fermeture des familles et sections de réglages — SANS MÉMOIRE.
 *
 * Chaque arrivée sur Paramètres repart TOUT REPLIÉ (demande du donneur
 * d'ordre, 02/10/2026) : la page est une liste de titres qu'on parcourt, ou
 * qu'on interroge par la recherche. Jusqu'ici, ce qu'on avait ouvert restait
 * ouvert le temps de la session (`sessionStorage`, 22/09/2026) — on revenait
 * sur une page déjà dépliée sans l'avoir demandé.
 *
 * Plusieurs sections peuvent être ouvertes en même temps (ce n'est PAS un
 * accordéon) : comparer deux réglages est un geste courant.
 */
import { useCallback, useState } from 'react';

export type SectionToggles = {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Ouvre ces éléments en gardant ouverts ceux qui l'étaient. */
  reveal: (ids: string[]) => void;
  openAll: () => void;
  closeAll: () => void;
  openCount: number;
};

export function useSectionToggles(allIds: string[]): SectionToggles {
  const [open, setOpen] = useState<string[]>([]);

  return {
    isOpen: useCallback((id: string) => open.includes(id), [open]),
    toggle: useCallback(
      (id: string) =>
        setOpen((cur) => (cur.includes(id) ? cur.filter((o) => o !== id) : [...cur, id])),
      [],
    ),
    reveal: useCallback(
      (ids: string[]) => setOpen((cur) => [...cur, ...ids.filter((id) => !cur.includes(id))]),
      [],
    ),
    openAll: useCallback(() => setOpen([...allIds]), [allIds]),
    closeAll: useCallback(() => setOpen([]), []),
    openCount: open.length,
  };
}
