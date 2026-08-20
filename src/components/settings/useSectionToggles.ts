'use client';

/**
 * Ouverture/fermeture des sections de réglages, MÉMORISÉE.
 *
 * Toutes repliées au premier passage : la page devient une liste qu'on
 * parcourt des yeux. Ensuite, ce qu'on a ouvert le reste d'une visite à
 * l'autre — quelqu'un qui revient trois fois dans la même journée sur les
 * boîtes de réception ne doit pas les rouvrir trois fois.
 *
 * Plusieurs sections peuvent être ouvertes en même temps (ce n'est PAS un
 * accordéon) : comparer deux réglages est un geste courant, et fermer l'un
 * pour ouvrir l'autre le rendrait impossible.
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'orqa.settings.openSections';

export type SectionToggles = {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  openAll: () => void;
  closeAll: () => void;
  openCount: number;
};

export function useSectionToggles(allIds: string[]): SectionToggles {
  const [open, setOpen] = useState<string[]>([]);

  // Lecture au montage seulement : `localStorage` n'existe pas au rendu
  // serveur, et lire pendant le rendu produirait une hydratation divergente.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      // On filtre sur les sections EXISTANTES : une section supprimée depuis
      // ne doit pas traîner dans la préférence de quelqu'un.
      const known = parsed.filter(
        (id): id is string => typeof id === 'string' && allIds.includes(id),
      );
      // Lecture d'un système EXTERNE (le stockage du navigateur), pas un
      // état dérivé du rendu : c'est le cas que la règle ne sait pas
      // distinguer. Un initialiseur paresseux ne convient pas — il
      // s'exécuterait aussi au rendu serveur, où `window` n'existe pas, et
      // produirait une hydratation divergente.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (known.length > 0) setOpen(known);
    } catch {
      // Préférence illisible : on repart de « tout replié », sans bruit.
    }
    // Volontairement au montage : `allIds` est une liste littérale stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback((next: string[]) => {
    setOpen(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Stockage refusé (navigation privée) : l'écran marche quand même,
      // la préférence ne survit simplement pas au rechargement.
    }
  }, []);

  return {
    isOpen: useCallback((id: string) => open.includes(id), [open]),
    toggle: useCallback(
      (id: string) =>
        persist(open.includes(id) ? open.filter((o) => o !== id) : [...open, id]),
      [open, persist],
    ),
    openAll: useCallback(() => persist([...allIds]), [allIds, persist]),
    closeAll: useCallback(() => persist([]), [persist]),
    openCount: open.length,
  };
}
