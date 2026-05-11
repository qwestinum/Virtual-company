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
