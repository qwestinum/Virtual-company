/**
 * Repo Supabase — sites (pré-requis reporting).
 *
 * Mapping row↔domaine local (`Site` camelCase). Soft-archive via
 * `archived_at`. Le site « par défaut » (DEFAULT_SITE_ID) est seedé par
 * scripts/migrate.sql ; il apparaît dans la liste comme les autres.
 */

import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { SiteRow } from '@/lib/db/types';
import type { Site, SiteCreateInput, SitePatchInput } from '@/types/organisation';

const TABLE = 'sites';

/** Mapping row → domaine (pur, exporté pour test unitaire). */
export function siteRowToDomain(row: SiteRow): Site {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    city: row.city,
    postalCode: row.postal_code,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSites(opts?: {
  includeArchived?: boolean;
}): Promise<Site[]> {
  const supabase = requireServerSupabase();
  let query = supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: true });
  if (!opts?.includeArchived) query = query.is('archived_at', null);
  const { data, error } = await query;
  if (error) throw new Error(`listSites: ${error.message}`);
  return (data ?? []).map((r) => siteRowToDomain(r as SiteRow));
}

export async function insertSite(
  id: string,
  input: SiteCreateInput,
): Promise<Site> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      id,
      name: input.name,
      type: input.type ?? null,
      city: input.city ?? null,
      postal_code: input.postalCode ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(`insertSite: ${error.message}`);
  return siteRowToDomain(data as SiteRow);
}

export async function patchSite(
  id: string,
  patch: SitePatchInput,
): Promise<Site | null> {
  const supabase = requireServerSupabase();
  const row: Partial<SiteRow> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.type !== undefined) row.type = patch.type ?? null;
  if (patch.city !== undefined) row.city = patch.city ?? null;
  if (patch.postalCode !== undefined) row.postal_code = patch.postalCode ?? null;
  if (Object.keys(row).length === 0) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .update(row)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`patchSite: ${error.message}`);
  return data ? siteRowToDomain(data as SiteRow) : null;
}

/** Soft-archive (ou désarchive si `archived` = false). */
export async function archiveSite(
  id: string,
  archived: boolean,
): Promise<Site | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`archiveSite: ${error.message}`);
  return data ? siteRowToDomain(data as SiteRow) : null;
}
