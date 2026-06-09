/**
 * Repo Supabase — donneurs d'ordre (pré-requis reporting).
 *
 * Le mapping row↔domaine est local : la signature publique parle
 * `DonneurOrdre` (camelCase), pas `DonneurOrdreRow`. Soft-archive via
 * `archived_at` (les archivés restent résolvables pour l'historique/audit
 * mais sont masqués des listes par défaut).
 */

import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { DonneurOrdreRow } from '@/lib/db/types';
import type {
  DonneurOrdre,
  DonneurOrdreCreateInput,
  DonneurOrdrePatchInput,
} from '@/types/organisation';

const TABLE = 'donneurs_ordre';

/** Mapping row → domaine (pur, exporté pour test unitaire). */
export function donneurOrdreRowToDomain(row: DonneurOrdreRow): DonneurOrdre {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    role: row.role,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDonneursOrdre(opts?: {
  includeArchived?: boolean;
}): Promise<DonneurOrdre[]> {
  const supabase = requireServerSupabase();
  let query = supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: true });
  if (!opts?.includeArchived) query = query.is('archived_at', null);
  const { data, error } = await query;
  if (error) throw new Error(`listDonneursOrdre: ${error.message}`);
  return (data ?? []).map((r) => donneurOrdreRowToDomain(r as DonneurOrdreRow));
}

export async function insertDonneurOrdre(
  id: string,
  input: DonneurOrdreCreateInput,
): Promise<DonneurOrdre> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      id,
      first_name: input.firstName ?? null,
      last_name: input.lastName,
      email: input.email ?? null,
      role: input.role ?? null,
    })
    .select('*')
    .single();
  if (error) throw new Error(`insertDonneurOrdre: ${error.message}`);
  return donneurOrdreRowToDomain(data as DonneurOrdreRow);
}

export async function patchDonneurOrdre(
  id: string,
  patch: DonneurOrdrePatchInput,
): Promise<DonneurOrdre | null> {
  const supabase = requireServerSupabase();
  const row: Partial<DonneurOrdreRow> = {};
  if (patch.firstName !== undefined) row.first_name = patch.firstName ?? null;
  if (patch.lastName !== undefined) row.last_name = patch.lastName;
  if (patch.email !== undefined) row.email = patch.email ?? null;
  if (patch.role !== undefined) row.role = patch.role ?? null;
  if (Object.keys(row).length === 0) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .update(row)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`patchDonneurOrdre: ${error.message}`);
  return data ? donneurOrdreRowToDomain(data as DonneurOrdreRow) : null;
}

/** Soft-archive (ou désarchive si `archived` = false). */
export async function archiveDonneurOrdre(
  id: string,
  archived: boolean,
): Promise<DonneurOrdre | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`archiveDonneurOrdre: ${error.message}`);
  return data ? donneurOrdreRowToDomain(data as DonneurOrdreRow) : null;
}
