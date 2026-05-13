/**
 * Repo Supabase pour les métriques du dashboard (Session 6).
 *
 * Très fin : on délègue à `listJournalEntries` du repo journal, puis on
 * applique les dérivations pures du module `derive-metrics`. Si
 * Supabase n'est pas configuré, on retourne `null` — l'API route le
 * détecte et renvoie un état vide cohérent au client (mode offline).
 */

import {
  listJournalEntries,
  type JournalEntry,
} from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

/**
 * Hard-cap sur le nombre d'entrées lues pour calculer les métriques.
 * En démo, on plafonne à 500 (la limite supabase du repo journal) ;
 * au-delà il faudra une vraie vue agrégée Postgres. Cf. backlog.
 */
const METRICS_WINDOW = 500;

export type MetricsRowsResult = {
  rows: JournalEntry[];
};

/**
 * Récupère la fenêtre d'évènements du journal utilisée pour calculer
 * KPIs, agents et candidats. Retourne `null` quand Supabase n'est pas
 * configuré — le call site décide quoi faire (servir un état vide,
 * répondre 503, etc.).
 */
export async function fetchMetricsRows(): Promise<MetricsRowsResult | null> {
  try {
    const rows = await listJournalEntries({ limit: METRICS_WINDOW });
    return { rows };
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return null;
    throw err;
  }
}

export async function fetchMetricsRowsForCampaign(
  campaignId: string,
): Promise<MetricsRowsResult | null> {
  try {
    const rows = await listJournalEntries({
      campaignId,
      limit: METRICS_WINDOW,
    });
    return { rows };
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return null;
    throw err;
  }
}
