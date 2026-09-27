/**
 * Les défauts d'un brouillon neuf, et le prédicat « ce champ porte-t-il une
 * valeur ? » — partagé par TOUTES les écritures de fiche.
 *
 * Deux définitions de « rempli » finiraient par diverger, et la divergence
 * serait muette : un champ compté rempli ici et vide là rendrait l'étape « Le
 * poste » bloquante sur un champ visiblement saisi.
 */

import { buildCriterion, type ScoringCriterion } from '@/types/scoring';

/** Un champ porte-t-il une valeur ? Partagé par toutes les écritures de fiche. */
export function rempli(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Grille de départ d'une campagne neuve — la même qu'à la création historique. */
export const MODELE: Omit<ScoringCriterion, 'id'>[] = [
  { label: 'Expérience pertinente sur le poste', level: 'critique', weight: 8 },
  { label: 'Compétences techniques clés', level: 'tres_important', weight: 6 },
  { label: 'Localisation / mobilité', level: 'important', weight: 4 },
];
