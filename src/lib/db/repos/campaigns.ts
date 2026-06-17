/**
 * Repo Supabase pour les campagnes archivées (Session 5, round 1).
 *
 * Source de vérité serveur pour `campaigns-store`. Le mapping row↔domain
 * est local : la signature publique parle uniquement `ActiveCampaign`,
 * pas `CampaignRow`.
 */

import { parseLifecycle, reconcileLifecycle } from '@/lib/campaign/lifecycle';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { CampaignRow } from '@/lib/db/types';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import { OPTIONAL_PHASE_IDS } from '@/types/campaign-lifecycle';
import type { CampaignStatus } from '@/types/campaign-status';
import type { PublicationChannel } from '@/types/publication-channel';

const TABLE = 'campaigns';

function rowToCampaign(row: CampaignRow): ActiveCampaign {
  const scoringSheet = row.scoring_sheet ?? null;
  const publishedChannels = row.published_channels ?? [];
  const sourcesConfirmed = row.sources_confirmed;
  // Inc. 2b — cycle de vie PERSISTÉ : la machine stockée (si présente) est la
  // source de vérité, réconciliée avec les artefacts (les phases obligatoires
  // suivent toujours leur artefact ; les optionnelles + `in_progress` sont
  // préservés depuis le stockage). `null` si colonne absente/corrompue.
  const persisted = parseLifecycle(row.lifecycle);
  const lifecycle = reconcileLifecycle(persisted, {
    fdpValidated: row.fdp.isValidated,
    scoringValidated: scoringSheet?.isValidated === true,
    scoringStarted: scoringSheet != null,
    sourcesConfirmed,
    hasPublishedChannel: publishedChannels.length > 0,
  });
  // Repli LEGACY (lifecycle jamais persisté) : les phases OPTIONNELLES
  // « reportées » (postponed) ne laissent aucun artefact et retombent en
  // `pending`. Or une campagne STOCKÉE `active` n'a PU l'être que si elles
  // étaient réglées (cf. deriveActiveStatus). On reconstitue le `postponed`
  // perdu, sinon le premier recomputeStatus la rétrograderait en `in_progress`.
  // Dès que la campagne est re-sauvée, `persisted` porte le `postponed` et ce
  // repli ne s'applique plus.
  if (persisted == null && row.status === 'active') {
    for (const id of OPTIONAL_PHASE_IDS) {
      if (lifecycle.phases[id]!.status === 'pending') {
        lifecycle.phases[id] = { ...lifecycle.phases[id]!, status: 'postponed' };
      }
    }
  }
  return {
    id: row.id,
    name: row.name,
    fdp: row.fdp,
    scoringSheet,
    publishedChannels,
    sourcesConfirmed,
    // Pas de défaut « manuel » : une ligne sans sources = aucun flux (intake non
    // fait). Réintroduire ['manual'] ici rendrait une campagne sans flux
    // « activable » après rechargement.
    sources: row.sources ?? [],
    threshold: row.threshold ?? 75,
    siteId: row.site_id ?? null,
    donneurOrdreId: row.donneur_ordre_id ?? null,
    launchedAt: row.launched_at ?? null,
    closedAt: row.closed_at ?? null,
    status: row.status,
    lifecycle,
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
    site_id: campaign.siteId,
    donneur_ordre_id: campaign.donneurOrdreId,
    launched_at: campaign.launchedAt,
    closed_at: campaign.closedAt,
    // Inc. 2b — la machine d'états est désormais persistée (source de vérité).
    lifecycle: campaign.lifecycle,
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

/**
 * Campagnes au statut « clôturée » uniquement (rapport de campagne, cf.
 * docs/specs/reporting.md §3.1). Tri par défaut = clôture décroissante
 * (repli sur updated_at quand closed_at est absent — campagnes historiques).
 * Le tri fin (nom, durée) et les filtres restent à la charge de l'appelant.
 */
export async function listClosedCampaigns(): Promise<ActiveCampaign[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('status', 'closed')
    .order('closed_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`listClosedCampaigns: ${error.message}`);
  return (data ?? []).map(rowToCampaign);
}

/** Résout une campagne par id (tous statuts). */
export async function getCampaign(id: string): Promise<ActiveCampaign | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getCampaign: ${error.message}`);
  return data ? rowToCampaign(data as CampaignRow) : null;
}

export async function upsertCampaign(
  campaign: ActiveCampaign,
): Promise<ActiveCampaign> {
  const supabase = requireServerSupabase();
  const row = campaignToRow(campaign);
  // Les dates de cycle de vie (launched_at/closed_at) appartiennent à
  // patchCampaign (transitions de statut). On retire les clés nulles pour ne
  // PAS écraser une date déjà posée lors d'une édition générale de campagne.
  if (row.launched_at == null) delete (row as Partial<CampaignRow>).launched_at;
  if (row.closed_at == null) delete (row as Partial<CampaignRow>).closed_at;
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'id' })
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
  /** Reporting (préparation) — rattachement campagne → site / donneur d'ordre
   *  (nullable). `null` détache explicitement. */
  siteId?: string | null;
  donneurOrdreId?: string | null;
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
  if (patch.siteId !== undefined) row.site_id = patch.siteId;
  if (patch.donneurOrdreId !== undefined)
    row.donneur_ordre_id = patch.donneurOrdreId;

  // Reporting — horodatage du cycle de vie sur transition de statut.
  // closed_at : posé à CHAQUE clôture (ré-clôture écrase → « seul le dernier
  // état compte »). launched_at : posé au PREMIER passage 'active' seulement.
  if (patch.status === 'closed') {
    row.closed_at = new Date().toISOString();
  } else if (patch.status === 'active') {
    const { data: cur } = await supabase
      .from(TABLE)
      .select('launched_at')
      .eq('id', id)
      .maybeSingle();
    if (!(cur as { launched_at: string | null } | null)?.launched_at) {
      row.launched_at = new Date().toISOString();
    }
  }

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
