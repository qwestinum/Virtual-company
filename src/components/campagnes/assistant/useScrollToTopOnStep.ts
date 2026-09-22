'use client';

/**
 * Changer d'étape, c'est commencer un NOUVEAU formulaire : on repart du haut
 * de la carte. Sans ça, « Suivant » cliqué en bas de page déposait le
 * recruteur au milieu de l'étape suivante, sous des champs qu'il ne voyait
 * pas. Pas au premier rendu : ouvrir l'assistant ne doit rien faire défiler.
 */

import { useEffect, useRef, type RefObject } from 'react';

export function useScrollToTopOnStep<T extends HTMLElement>(step: string): RefObject<T | null> {
  const carte = useRef<T>(null);
  const etapeAffichee = useRef(step);
  useEffect(() => {
    if (etapeAffichee.current === step) return;
    etapeAffichee.current = step;
    carte.current?.scrollIntoView({ block: 'start' });
  }, [step]);
  return carte;
}
