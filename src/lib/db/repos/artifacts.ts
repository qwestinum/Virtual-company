/**
 * Repo Supabase pour les métadonnées d'artefacts (Session 5 round 2).
 *
 * Le contenu vit dans Supabase Storage (bucket 'artifacts'). Cette
 * table porte la trace côté Postgres pour :
 *   - relister les artefacts d'une campagne au refresh,
 *   - garder une trace même si l'upload Storage échoue (storage_*
 *     restent null mais l'entrée existe).
 */

import { chunk, fetchAllKeyset } from '@/lib/db/paginate';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { ArtifactKind, ArtifactMetaRow } from '@/lib/db/types';

const TABLE = 'artifacts_meta';

export type ArtifactMeta = {
  id: string;
  campaignId: string | null;
  taskId: string | null;
  kind: ArtifactKind;
  name: string;
  mime: string;
  storageBucket: string | null;
  storagePath: string | null;
  publicUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

function rowToMeta(row: ArtifactMetaRow): ArtifactMeta {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    taskId: row.task_id,
    kind: row.kind,
    name: row.name,
    mime: row.mime,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    publicUrl: row.public_url,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

/**
 * Métadonnée d'UN artefact par id. Sert à la génération du lien signé : on
 * résout `storage_path` côté serveur à partir de l'id (jamais un chemin fourni
 * par le client → impossible de signer un objet arbitraire). `null` si inconnu.
 */
export async function getArtifactMeta(id: string): Promise<ArtifactMeta | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getArtifactMeta: ${error.message}`);
  return data ? rowToMeta(data as ArtifactMetaRow) : null;
}

export type ArtifactMetaInsert = {
  id: string;
  campaignId: string | null;
  taskId: string | null;
  kind: ArtifactKind;
  name: string;
  mime?: string;
  storageBucket?: string | null;
  storagePath?: string | null;
  publicUrl?: string | null;
  metadata?: Record<string, unknown>;
};

function assertSingleOwner(input: ArtifactMetaInsert, fn: string): void {
  if (input.campaignId && input.taskId) {
    throw new Error(`${fn}: provide either campaignId OR taskId, not both`);
  }
  if (!input.campaignId && !input.taskId) {
    throw new Error(`${fn}: at least one of campaignId or taskId is required`);
  }
}

function metaInsertToRow(input: ArtifactMetaInsert) {
  return {
    id: input.id,
    campaign_id: input.campaignId,
    task_id: input.taskId,
    kind: input.kind,
    name: input.name,
    mime: input.mime ?? 'text/markdown',
    storage_bucket: input.storageBucket ?? null,
    storage_path: input.storagePath ?? null,
    public_url: input.publicUrl ?? null,
    metadata: input.metadata ?? {},
  };
}

export async function insertArtifactMeta(
  input: ArtifactMetaInsert,
): Promise<ArtifactMeta> {
  assertSingleOwner(input, 'insertArtifactMeta');
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .insert(metaInsertToRow(input))
    .select('*')
    .single();
  if (error) throw new Error(`insertArtifactMeta: ${error.message}`);
  return rowToMeta(data as ArtifactMetaRow);
}

/**
 * Variante UPSERT (par id) pour les artefacts à id DÉTERMINISTE re-persistés
 * à chaque passe (CV binaire du poller IMAP : `art_imap_cvfile_<mailbox>_<uid>`).
 * L'INSERT brut échouait en doublon de PK à toute re-passe (retry des rails,
 * re-analyse) → le catch best-effort laissait `cvArtifactId` null et la
 * validation perdait son lien CV (incident 07/2026). Le binaire Storage est
 * déjà upserté (`upsert: true`) — la métadonnée doit l'être aussi.
 */
export async function upsertArtifactMeta(
  input: ArtifactMetaInsert,
): Promise<ArtifactMeta> {
  assertSingleOwner(input, 'upsertArtifactMeta');
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(metaInsertToRow(input), { onConflict: 'id' })
    .select('*')
    .single();
  if (error) throw new Error(`upsertArtifactMeta: ${error.message}`);
  return rowToMeta(data as ArtifactMetaRow);
}

export async function listArtifactsByCampaign(
  campaignId: string,
): Promise<ArtifactMeta[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listArtifactsByCampaign: ${error.message}`);
  return (data ?? []).map((r) => rowToMeta(r as ArtifactMetaRow));
}

/**
 * Métadonnées d'artefacts de PLUSIEURS campagnes et tâches en une lecture —
 * même contenu que les appels unitaires `listArtifactsByCampaign` /
 * `listArtifactsByTask` cumulés. Pagination KEYSET sur la clé primaire : un
 * lot de propriétaires peut dépasser le plafond PostgREST de 1000 lignes, et
 * rien n'est tronqué. Les listes d'identifiants sont découpées pour garder
 * des URL raisonnables.
 */
export async function listArtifactsByOwners(owners: {
  campaignIds: readonly string[];
  taskIds: readonly string[];
}): Promise<ArtifactMeta[]> {
  const supabase = requireServerSupabase();
  const byColumn = (column: 'campaign_id' | 'task_id', ids: readonly string[]) =>
    chunk([...new Set(ids)], 100).map((part) =>
      fetchAllKeyset<ArtifactMetaRow>({
        cursorOf: (row) => row.id,
        fetchPage: async (afterId, limit) => {
          let query = supabase.from(TABLE).select('*').in(column, part);
          if (afterId !== null) query = query.gt('id', afterId);
          const { data, error } = await query
            .order('id', { ascending: true })
            .limit(limit);
          if (error) throw new Error(`listArtifactsByOwners: ${error.message}`);
          return (data ?? []) as ArtifactMetaRow[];
        },
      }),
    );
  const pages = await Promise.all([
    ...byColumn('campaign_id', owners.campaignIds),
    ...byColumn('task_id', owners.taskIds),
  ]);
  const byId = new Map<string, ArtifactMetaRow>();
  for (const row of pages.flat()) byId.set(row.id, row);
  return [...byId.values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => rowToMeta(r));
}

export async function listArtifactsByTask(
  taskId: string,
): Promise<ArtifactMeta[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listArtifactsByTask: ${error.message}`);
  return (data ?? []).map((r) => rowToMeta(r as ArtifactMetaRow));
}
