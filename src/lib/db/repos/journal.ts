/**
 * Repo Supabase pour le journal d'audit (Session 5, round 1).
 *
 * Spec §6.3 — chaque action directe UI (pause campagne, modif seuil,
 * forçage statut candidat, etc.) laisse une trace. On garde une API
 * minimale `appendJournalEntry` ; pas de relecture en round 1 (la
 * console Supabase suffit pour debug).
 */

import { requireServerSupabase } from '@/lib/db/supabase-server';

export type JournalEntryInput = {
  action: string;
  campaignId?: string | null;
  actor?: string;
  payload?: Record<string, unknown>;
};

export async function appendJournalEntry(
  entry: JournalEntryInput,
): Promise<void> {
  const supabase = requireServerSupabase();
  const { error } = await supabase.from('journal').insert({
    action: entry.action,
    campaign_id: entry.campaignId ?? null,
    actor: entry.actor ?? 'user',
    payload: entry.payload ?? {},
  });
  if (error) throw new Error(`appendJournalEntry: ${error.message}`);
}

export type JournalEntry = {
  id: number;
  campaignId: string | null;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

/**
 * Liste les entrées récentes du journal. Filtres optionnels :
 *   - actionPrefix : préfixe (« imap_ » récupère imap_cv_received,
 *     imap_cv_analyzed, etc.)
 *   - campaignId : restreint à une campagne
 *   - limit : nombre max d'entrées (défaut 50, max 500)
 */
export async function listJournalEntries(args: {
  actionPrefix?: string;
  campaignId?: string;
  limit?: number;
}): Promise<JournalEntry[]> {
  const supabase = requireServerSupabase();
  const cappedLimit = Math.min(Math.max(args.limit ?? 50, 1), 500);
  let q = supabase
    .from('journal')
    .select('id, campaign_id, actor, action, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(cappedLimit);
  if (args.campaignId) q = q.eq('campaign_id', args.campaignId);
  if (args.actionPrefix) q = q.like('action', `${args.actionPrefix}%`);
  const { data, error } = await q;
  if (error) throw new Error(`listJournalEntries: ${error.message}`);
  return (data ?? []).map(mapJournalRow);
}

type JournalRow = {
  id: number;
  campaign_id: string | null;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
};

function mapJournalRow(r: unknown): JournalEntry {
  const row = r as JournalRow;
  return {
    id: row.id,
    campaignId: row.campaign_id,
    actor: row.actor,
    action: row.action,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

/**
 * Liste EXHAUSTIVE des entrées du journal pour un ENSEMBLE d'actions données,
 * paginée en interne (pages de 1000) — SANS le plafond 500 de
 * `listJournalEntries`. Réservée aux marqueurs BAS VOLUME (entretien /
 * validation) du calcul d'étape : le volume est borné par les candidats arrivés
 * en phase entretien, jamais par tout le journal. Les compteurs du menu
 * Candidatures EN DÉPENDENT pour ne pas mentir au-delà de 500 entrées.
 */
export async function listJournalEntriesByActions(
  actions: string[],
  args: { campaignId?: string } = {},
): Promise<JournalEntry[]> {
  if (actions.length === 0) return [];
  const supabase = requireServerSupabase();
  const PAGE = 1000;
  const out: JournalEntry[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase
      .from('journal')
      .select('id, campaign_id, actor, action, payload, created_at')
      .in('action', actions)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (args.campaignId) q = q.eq('campaign_id', args.campaignId);
    const { data, error } = await q;
    if (error) throw new Error(`listJournalEntriesByActions: ${error.message}`);
    const rows = (data ?? []).map(mapJournalRow);
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
