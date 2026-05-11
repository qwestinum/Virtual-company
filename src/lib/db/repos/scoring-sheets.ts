/**
 * Repo Supabase pour les snapshots historiques de fiches de scoring
 * (Session 5, round 1).
 *
 * Distinct de `campaigns.scoring_sheet` qui détient le snapshot courant.
 * Ici on garde l'historique des validations successives — utile pour
 * audit et reconstruction post-mortem. On ne l'expose pas encore au
 * front en round 1, mais le repo est en place pour les écritures.
 */

import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { ScoringSheet } from '@/types/scoring';

const TABLE = 'scoring_sheets_archived';

export async function archiveScoringSheet(sheet: ScoringSheet): Promise<void> {
  const supabase = requireServerSupabase();
  const { error } = await supabase.from(TABLE).insert({
    campaign_id: sheet.campaignId,
    sheet,
  });
  if (error) throw new Error(`archiveScoringSheet: ${error.message}`);
}
