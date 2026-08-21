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
  listJournalEntriesByActions,
  listRecentJournalEntriesByActions,
  type JournalEntry,
} from '@/lib/db/repos/journal';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';

/**
 * Fenêtre « activité RÉCENTE » : le feed et les métriques agents (durée/
 * tokens/coût récents) sont par nature une fenêtre, pas un total — limite
 * LÉGITIME (cf. la timeline candidat). Ne PAS l'utiliser pour un compteur
 * présenté comme total (audit C10, surface b : ceux-ci passent par
 * `fetchCandidateTotalRows`, exhaustif sur les actions candidat/coût).
 */
const METRICS_WINDOW = 500;

/**
 * Actions candidat + coûtées dont dérivent les TOTAUX du Bureau (KPIs,
 * liste, coût, métrique par campagne). Set BORNÉ (événements liés aux
 * candidats + rendu d'annonce) ⇒ `listJournalEntriesByActions` reste efficace
 * tout en étant EXHAUSTIF (pas de cap 500). C'est l'union de ce que
 * consomment `journalToGlobalKPIs`, `journalToCandidatesList`,
 * `journalToCampaignMetric` et `COST_PER_ACTION`.
 */
const CANDIDATE_TOTAL_ACTIONS = [
  'imap_cv_received',
  'imap_cv_analyzed',
  'imap_outreach_mail',
  'imap_outreach_brief',
  'hitl_validation_sent',
  'candidate_interview_marked',
  'candidate_validation_marked',
  'job_writer_rendered',
];

/**
 * Rangées EXHAUSTIVES pour les totaux du Bureau (audit C10 surface b) :
 * les compteurs présentés comme totaux ne doivent JAMAIS mentir au-delà de
 * 500. Même dérivation pure qu'avant, mais input complet (via
 * `listJournalEntriesByActions`, paginé sans cap). `null` si Supabase absent.
 */
export async function fetchCandidateTotalRows(
  campaignId?: string,
): Promise<MetricsRowsResult | null> {
  try {
    const rows = await listJournalEntriesByActions(CANDIDATE_TOTAL_ACTIONS, {
      campaignId,
    });
    return { rows };
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return null;
    throw err;
  }
}

export type MetricsRowsResult = {
  rows: JournalEntry[];
};

/**
 * Les N dernières entrées PARMI un ensemble d'actions — pour les surfaces dont
 * la limite doit porter sur ce qu'elles savent utiliser, pas sur le journal
 * brut (fil d'activité, métriques par agent).
 *
 * Charger large puis jeter est un piège coûteux : le 21/08/2026, une action
 * technique écrite à chaque relève occupait 95 % de la fenêtre de 500 lignes et
 * évinçait les évènements métier hors de portée du fil. La liste d'actions
 * passée ici DOIT être dérivée de la structure qui les rend (cf.
 * `ACTIVITY_FEED_ACTIONS`), jamais recopiée à la main.
 */
export async function fetchRecentRowsForActions(
  actions: string[],
  limit: number,
): Promise<MetricsRowsResult | null> {
  try {
    return { rows: await listRecentJournalEntriesByActions(actions, limit) };
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return null;
    throw err;
  }
}

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
