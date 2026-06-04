/**
 * Repo Supabase pour les campagnes archivées (Session 5, round 1).
 *
 * Source de vérité serveur pour `campaigns-store`. Le mapping row↔domain
 * est local : la signature publique parle uniquement `ActiveCampaign`,
 * pas `CampaignRow`.
 */

import { reconcileLifecycle } from '@/lib/campaign/lifecycle';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { CampaignRow } from '@/lib/db/types';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import type { CampaignStatus } from '@/types/campaign-status';
import type { PublicationChannel } from '@/types/publication-channel';

const TABLE = 'campaigns';

function rowToCampaign(row: CampaignRow): ActiveCampaign {
  const scoringSheet = row.scoring_sheet ?? null;
  const publishedChannels = row.published_channels ?? [];
  const sourcesConfirmed = row.sources_confirmed;
  return {
    id: row.id,
    name: row.name,
    fdp: row.fdp,
    scoringSheet,
    publishedChannels,
    sourcesConfirmed,
    sources: row.sources ?? ['manual'],
    threshold: row.threshold ?? 75,
    status: row.status,
    // Inc. 2a — lifecycle non persisté : re-dérivé des artefacts au
    // chargement (les `postponed` ne survivent pas encore au reload ;
    // persistance prévue à un incrément ultérieur).
    lifecycle: reconcileLifecycle(null, {
      fdpValidated: row.fdp.isValidated,
      scoringValidated: scoringSheet?.isValidated === true,
      scoringStarted: scoringSheet != null,
      sourcesConfirmed,
      hasPublishedChannel: publishedChannels.length > 0,
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function campaignToRow(campaign: ActiveCampaign): CampaignRow {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    fdp: campaign.fdp,
    scoring_sheet: campaign.scoringSheet,
    published_channels: campaign.publishedChannels,
    sources_confirmed: campaign.sourcesConfirmed,
    sources: campaign.sources,
    threshold: campaign.threshold,
    created_at: campaign.createdAt,
    updated_at: campaign.updatedAt,
  };
}

export async function listCampaigns(): Promise<ActiveCampaign[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listCampaigns: ${error.message}`);
  return (data ?? []).map(rowToCampaign);
}

export async function upsertCampaign(
  campaign: ActiveCampaign,
): Promise<ActiveCampaign> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(campaignToRow(campaign), { onConflict: 'id' })
    .select('*')
    .single();
  if (error) throw new Error(`upsertCampaign: ${error.message}`);
  return rowToCampaign(data as CampaignRow);
}

export type CampaignPatch = {
  status?: CampaignStatus;
  publishedChannels?: PublicationChannel[];
  sourcesConfirmed?: boolean;
  threshold?: number;
};

export async function patchCampaign(
  id: string,
  patch: CampaignPatch,
): Promise<ActiveCampaign | null> {
  const supabase = requireServerSupabase();
  const row: Partial<CampaignRow> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.publishedChannels !== undefined)
    row.published_channels = patch.publishedChannels;
  if (patch.sourcesConfirmed !== undefined)
    row.sources_confirmed = patch.sourcesConfirmed;
  if (patch.threshold !== undefined) row.threshold = patch.threshold;
  if (Object.keys(row).length === 0) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .update(row)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`patchCampaign: ${error.message}`);
  return data ? rowToCampaign(data as CampaignRow) : null;
}
