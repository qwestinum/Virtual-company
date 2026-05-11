/**
 * Pré-recherche L1 — recherche de FDPs archivées (Session 5, round 1).
 *
 * Le Manager appelle `searchExistingJobDescriptions(query)` AVANT la
 * collecte (cf. spec §4.1 et CLAUDE.md). En Session 3 cette fonction
 * était un stub retournant []. À partir de Session 5, elle interroge
 * Supabase via le repo `fdps-archived`.
 *
 * Mode dégradé : si Supabase n'est pas configuré (variables d'env
 * absentes), on retourne [] silencieusement — l'app reste démo-able
 * en local. Aucune erreur visible côté Manager : il continuera comme
 * en Session 3 (« on construit ensemble »).
 *
 * Cette fonction est invoquée côté **serveur** (depuis runManagerTurn
 * qui tourne dans /api/manager/chat). Elle appelle directement le repo
 * — pas de fetch HTTP intermédiaire. Si un jour on l'appelait depuis
 * un Server Component ou un Route Handler distinct, le même import
 * fonctionne sans modification.
 */

import { searchFdps } from '@/lib/db/repos/fdps-archived';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import type { FDPInProgress } from '@/types/field-collection';

export type JobDescription = {
  id: string;
  title: string;
  archivedAt: string;
  fdp: FDPInProgress;
};

export async function searchExistingJobDescriptions(
  query: string,
): Promise<JobDescription[]> {
  if (!query || query.trim().length < 2) return [];
  try {
    return await searchFdps(query);
  } catch (err) {
    // Pas de Supabase configuré → comportement Session 3 (silence).
    if (err instanceof SupabaseNotConfiguredError) return [];
    // Toute autre erreur DB : log + fallback vide. Le Manager doit
    // pouvoir continuer même si l'index est temporairement hors
    // service — ne jamais bloquer la conversation sur la pré-recherche.
    console.error('[searchExistingJobDescriptions] db error', err);
    return [];
  }
}
