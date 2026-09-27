'use client';

/**
 * Ouverture/fermeture des sections de réglages, MÉMORISÉE LE TEMPS DE LA
 * SESSION.
 *
 * Tout replié à l'ouverture de l'application : la page devient une liste
 * qu'on parcourt des yeux. Ce qu'on ouvre reste ouvert d'une page à l'autre
 * de la même session (`sessionStorage`) — revenir trois fois sur les boîtes de
 * réception ne demande pas de les rouvrir trois fois — mais une NOUVELLE
 * ouverture de l'application repart fermée (demande du donneur d'ordre,
 * 22/09/2026 ; c'était `localStorage` avant, et la page rouvrait ce qu'on
 * avait laissé ouvert la veille).
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

/**
 * @param allIds les identifiants qui existent — une préférence portant sur un
 *   identifiant disparu est ignorée.
 * @param cle la clé de stockage. Les FAMILLES ont la leur : mélangées aux
 *   sections, elles fausseraient le « n sur N » de la barre d'outils et
 *   « Tout ouvrir » replierait les familles en croyant ouvrir des sections.
 * @param ouvertesParDefaut l'état de départ. Les sections partent REPLIÉES
 *   (la page devient une liste qu'on parcourt) ; les familles partent
 *   DÉPLIÉES — les replier toutes d'emblée cacherait la page entière derrière
 *   quatre titres.
 */
export function useSectionToggles(
  allIds: string[],
  cle: string = STORAGE_KEY,
  ouvertesParDefaut = false,
): SectionToggles {
  const [open, setOpen] = useState<string[]>(ouvertesParDefaut ? allIds : []);

  // Lecture au montage seulement : `sessionStorage` n'existe pas au rendu
  // serveur, et lire pendant le rendu produirait une hydratation divergente.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(cle);
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
      // ⚠️ On applique la préférence MÊME VIDE quand le défaut est « tout
      // ouvert » : sinon, quelqu'un qui a tout replié retrouverait tout
      // déplié au rechargement — sa préférence serait prise pour une absence
      // de préférence.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (known.length > 0 || ouvertesParDefaut) setOpen(known);
    } catch {
      // Préférence illisible : on repart de « tout replié », sans bruit.
    }
    // Volontairement au montage : `allIds` est une liste littérale stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback((next: string[]) => {
    setOpen(next);
    try {
      window.sessionStorage.setItem(cle, JSON.stringify(next));
    } catch {
      // Stockage refusé (navigation privée) : l'écran marche quand même,
      // la préférence ne survit simplement pas au rechargement.
    }
  }, [cle]);

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
