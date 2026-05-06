/**
 * Stub storage Session 3 — contrat figé pour la pré-recherche L1.
 *
 * Le Manager appelle `searchExistingJobDescriptions(query)` AVANT la
 * collecte (cf. spec §4.1 et CLAUDE.md). En Session 3 la fonction
 * retourne toujours [] (storage absent). En Session 5, l'implémentation
 * interrogera Supabase + Drive sans modifier la signature ni les
 * consommateurs.
 *
 * Toute évolution du retour doit rester rétrocompatible : un appelant
 * Session 3 doit continuer à fonctionner avec un retour Session 5
 * peuplé.
 */

import type { FDPInProgress } from '@/types/field-collection';

export type JobDescription = {
  id: string;
  title: string;
  archivedAt: string;
  fdp: FDPInProgress;
};

export async function searchExistingJobDescriptions(
  _query: string,
): Promise<JobDescription[]> {
  return [];
}
