'use client';

/**
 * LE filtre « Référent » d'un écran : un seul état pour tout le produit.
 *
 * ⚠️ Pourquoi un magasin de module et non un `useState` par page. Chaque écran
 * gardait le sien : cocher « Mes campagnes » sur Candidatures puis passer sur
 * Campagnes rendait la liste complète, sans que rien ne dise pourquoi. Ici
 * l'état vit une seule fois, les écrans s'y abonnent, et une bascule sur l'un
 * est visible sur l'autre au retour — sans rechargement.
 *
 * `useSyncExternalStore` plutôt qu'un contexte : la valeur doit survivre au
 * démontage d'un écran (la navigation client démonte la page précédente), et
 * un contexte monté dans une page ne le ferait pas.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { ALL_REFERENTS, type ReferentSelection } from '@/lib/referent/filter';
import { ecrirePreference, lirePreference } from '@/lib/referent/preference';

let courant: ReferentSelection = ALL_REFERENTS;
/** Recruteur pour lequel `courant` a été chargé — `undefined` = jamais. */
let charge: string | null | undefined;
const abonnes = new Set<() => void>();

function prevenir() {
  for (const fn of abonnes) fn();
}

function abonner(fn: () => void) {
  abonnes.add(fn);
  return () => {
    abonnes.delete(fn);
  };
}

/** ⚠️ Référence STABLE tant que rien ne change — sinon rendu en boucle. */
const instantane = () => courant;
/** Le serveur ne connaît aucune préférence : « Tous » ne masque rien. */
const instantaneServeur = () => ALL_REFERENTS;

/**
 * Charge la préférence du recruteur une fois. Changer d'identité (connexion
 * d'un autre recruteur sans rechargement) recharge la sienne : « Mes
 * campagnes » ne désigne pas les mêmes campagnes pour deux personnes.
 */
function hydrater(userId: string | null) {
  if (charge === userId) return;
  charge = userId;
  const lu = lirePreference(userId);
  if (lu.kind !== courant.kind || serial(lu) !== serial(courant)) {
    courant = lu;
    prevenir();
  }
}

const serial = (s: ReferentSelection) =>
  s.kind === 'recruiter' ? `recruiter:${s.id}` : s.kind;

export function useReferentFilter(currentUserId: string | null): [
  ReferentSelection,
  (next: ReferentSelection) => void,
] {
  const selection = useSyncExternalStore(abonner, instantane, instantaneServeur);

  // ⚠️ Dans un effet, jamais au rendu : lire `localStorage` pendant le rendu
  // casserait l'hydratation (le serveur n'a pas la même valeur).
  useEffect(() => {
    hydrater(currentUserId);
  }, [currentUserId]);

  const poser = useCallback(
    (next: ReferentSelection) => {
      courant = next;
      ecrirePreference(currentUserId, next);
      prevenir();
    },
    [currentUserId],
  );

  return [selection, poser];
}

/** Remise à zéro — pour les tests seulement. */
export function __reinitialiserFiltreReferent() {
  courant = ALL_REFERENTS;
  charge = undefined;
  prevenir();
}
