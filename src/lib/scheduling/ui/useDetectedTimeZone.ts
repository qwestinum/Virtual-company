'use client';

/**
 * Fuseau du navigateur, lu SANS effet.
 *
 * Le piège : `Intl.DateTimeFormat().resolvedOptions().timeZone` répond aussi
 * côté serveur, où il donne le fuseau de la machine — pas celui du lecteur. Le
 * lire pendant le rendu produirait donc un premier affichage à la mauvaise
 * heure, corrigé ensuite sous les yeux : exactement l'information qu'on ne peut
 * pas se permettre d'afficher de travers, même une fraction de seconde.
 *
 * `useSyncExternalStore` traite le cas proprement : `null` au rendu serveur,
 * la vraie valeur dès l'hydratation. Pas d'effet, donc pas de rendu en cascade.
 */
import { useSyncExternalStore } from 'react';

/** Le fuseau ne change pas en cours de session : rien à quoi s'abonner. */
const subscribe = () => () => {};
const readClient = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const readServer = (): string | null => null;

export function useDetectedTimeZone(): string | null {
  return useSyncExternalStore(subscribe, readClient, readServer);
}
