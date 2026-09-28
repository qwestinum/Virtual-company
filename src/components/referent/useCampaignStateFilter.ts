'use client';

/**
 * L'ÉTAT de campagne filtré (Actives, Suspendues…) — UN état pour tout le
 * produit, mémorisé par recruteur, sur le modèle exact de `useReferentFilter`
 * (magasin de module + `useSyncExternalStore` : il survit au démontage d'un
 * écran). Choisir « Actives » sur Candidatures, c'est le retrouver sur
 * Campagnes et Entretiens.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
  DEFAULT_CAMPAIGN_STATE,
  type CampaignStateFilter,
} from '@/lib/referent/campaign-state';
import { ecrireEtatCampagne, lireEtatCampagne } from '@/lib/referent/preference';

let courant: CampaignStateFilter = DEFAULT_CAMPAIGN_STATE;
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

const instantane = () => courant;
const instantaneServeur = () => DEFAULT_CAMPAIGN_STATE;

function hydrater(userId: string | null) {
  if (charge === userId) return;
  charge = userId;
  const lu = lireEtatCampagne(userId);
  if (lu !== courant) {
    courant = lu;
    prevenir();
  }
}

export function useCampaignStateFilter(currentUserId: string | null): [
  CampaignStateFilter,
  (next: CampaignStateFilter) => void,
] {
  const etat = useSyncExternalStore(abonner, instantane, instantaneServeur);

  // Dans un effet, jamais au rendu (hydratation).
  useEffect(() => {
    hydrater(currentUserId);
  }, [currentUserId]);

  const poser = useCallback(
    (next: CampaignStateFilter) => {
      courant = next;
      ecrireEtatCampagne(currentUserId, next);
      prevenir();
    },
    [currentUserId],
  );

  return [etat, poser];
}

/** Remise à zéro — pour les tests seulement. */
export function __reinitialiserFiltreEtat() {
  courant = DEFAULT_CAMPAIGN_STATE;
  charge = undefined;
  prevenir();
}
