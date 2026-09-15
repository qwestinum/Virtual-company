/**
 * Repo Supabase — référentiel des recruteurs (multi-utilisateur).
 *
 * Tolérant à la table absente (migration pas encore appliquée sur
 * l'environnement) : les lecteurs retombent sur « aucun recruteur » — les
 * fallbacks applicatifs (agenda global, pas d'admin) restent cohérents.
 */

import {
  requireServerSupabase,
  SupabaseNotConfiguredError,
} from '@/lib/db/supabase-server';
import { decryptCredential, encryptCredential } from '@/lib/crypto/mailbox-credentials';
import type { Recruiter, RecruiterRole } from '@/types/recruiter';

const TABLE = 'recruiters';

export type RecruiterRow = {
  id: string;
  display_name: string;
  email: string;
  calcom_link: string | null;
  role: RecruiterRole;
  is_active: boolean;
  created_at: string;
  /** Identifiant Apec du recruteur, CHIFFRÉ (AES-256-GCM). */
  adep_numero_dossier: string | null;
  /** URL de l'agenda publié, CHIFFRÉE. Absente tant que la migration n'est pas appliquée. */
  busy_ics_url?: string | null;
};

function rowToDomain(row: RecruiterRow): Recruiter {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    calcomLink: row.calcom_link,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    // On n'expose JAMAIS le chiffré côté domaine : seulement sa PRÉSENCE.
    // L'écran a besoin de savoir si le recruteur peut publier, pas de la
    // valeur — qui est un identifiant de personne, et un secret d'accès.
    hasAdepNumeroDossier: Boolean(row.adep_numero_dossier),
  };
}

function isTableMissing(err: { code?: string; message?: string }): boolean {
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes('recruiters') && msg.includes('not') && msg.includes('found');
}

/** Tous les recruteurs (gestion admin) — actifs et désactivés. */
export async function listRecruiters(): Promise<Recruiter[]> {
  try {
    const supabase = requireServerSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: true });
    if (error) {
      if (isTableMissing(error)) return [];
      throw new Error(`listRecruiters: ${error.message}`);
    }
    return (data ?? []).map((r) => rowToDomain(r as RecruiterRow));
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return [];
    throw err;
  }
}

/** Recruteurs ACTIFS (sélecteur « référent », résolution d'agenda). */
export async function listActiveRecruiters(): Promise<Recruiter[]> {
  return (await listRecruiters()).filter((r) => r.isActive);
}

export async function getRecruiter(id: string): Promise<Recruiter | null> {
  try {
    const supabase = requireServerSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      if (isTableMissing(error)) return null;
      throw new Error(`getRecruiter: ${error.message}`);
    }
    return data ? rowToDomain(data as RecruiterRow) : null;
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return null;
    throw err;
  }
}

/**
 * Rôle d'un utilisateur — GARDE d'autorisation. Fail-closed : table absente,
 * ligne absente, recruteur DÉSACTIVÉ ou base injoignable ⇒ null (jamais un
 * rôle par défaut).
 */
export async function getRecruiterRole(
  userId: string,
): Promise<RecruiterRole | null> {
  try {
    const r = await getRecruiter(userId);
    return r && r.isActive ? r.role : null;
  } catch {
    return null;
  }
}

export type AvailableAccount = {
  /** auth.users.id. */
  id: string;
  email: string;
  createdAt: string;
};

/**
 * Comptes Supabase Auth PAS ENCORE référencés comme recruteurs — alimente le
 * sélecteur d'ajout (zéro resaisie d'UUID : le serveur détient déjà la liste
 * via la clé service_role). Un compte désactivé côté recruiters reste
 * « référencé » (on le RÉACTIVE, on ne le re-crée pas).
 */
export async function listAvailableAuthAccounts(): Promise<AvailableAccount[]> {
  const supabase = requireServerSupabase();
  // Espace de 2-10 recruteurs : une page large suffit (pas de pagination).
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) throw new Error(`listAvailableAuthAccounts: ${error.message}`);
  const referenced = new Set((await listRecruiters()).map((r) => r.id));
  return data.users
    .filter((u) => !referenced.has(u.id) && Boolean(u.email))
    .map((u) => ({ id: u.id, email: u.email!, createdAt: u.created_at }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export type CreateRecruiterInput = {
  /** auth.users.id du compte Supabase créé/invité au préalable. */
  id: string;
  displayName: string;
  email: string;
  calcomLink?: string | null;
  role?: RecruiterRole;
};

export async function insertRecruiter(
  input: CreateRecruiterInput,
): Promise<Recruiter> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      id: input.id,
      display_name: input.displayName,
      email: input.email,
      calcom_link: input.calcomLink ?? null,
      role: input.role ?? 'member',
    })
    .select('*')
    .single();
  if (error) throw new Error(`insertRecruiter: ${error.message}`);
  return rowToDomain(data as RecruiterRow);
}

export type RecruiterPatch = {
  displayName?: string;
  calcomLink?: string | null;
  role?: RecruiterRole;
  isActive?: boolean;
  /**
   * Identifiant Apec, EN CLAIR — chiffré ici avant écriture. `null` efface.
   * L'appelant ne manipule jamais de ciphertext, et la valeur claire ne
   * ressort jamais de ce module autrement que par `getAdepNumeroDossier`.
   */
  adepNumeroDossier?: string | null;
  /**
   * URL de l'agenda publié, EN CLAIR — chiffrée ici avant écriture. `null`
   * efface. Ne ressort jamais de ce module que par `loadRecruiterCalendarUrl`.
   */
  busyIcsUrl?: string | null;
};

export async function patchRecruiter(
  id: string,
  patch: RecruiterPatch,
): Promise<Recruiter | null> {
  const supabase = requireServerSupabase();
  const row: Partial<RecruiterRow> = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.calcomLink !== undefined) row.calcom_link = patch.calcomLink;
  if (patch.role !== undefined) row.role = patch.role;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  if (patch.adepNumeroDossier !== undefined) {
    const value = patch.adepNumeroDossier?.trim();
    row.adep_numero_dossier = value ? encryptCredential(value) : null;
  }
  if (patch.busyIcsUrl !== undefined) {
    const value = patch.busyIcsUrl?.trim();
    row.busy_ics_url = value ? encryptCredential(value) : null;
  }
  if (Object.keys(row).length === 0) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .update(row)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`patchRecruiter: ${error.message}`);
  return data ? rowToDomain(data as RecruiterRow) : null;
}

/**
 * Identifiant Apec EN CLAIR d'un recruteur. Server-only, appelé juste avant
 * l'appel ADEP — jamais stocké en mémoire, jamais renvoyé au navigateur.
 *
 * Un déchiffrement qui échoue (clé maîtresse changée, ciphertext altéré) rend
 * `null` plutôt que de lever : l'écran dira « ce recruteur n'a pas
 * d'identifiant Apec », ce qui est vrai de son point de vue, au lieu de faire
 * échouer une page entière sur une erreur de chiffrement.
 */
export async function getAdepNumeroDossier(id: string): Promise<string | null> {
  try {
    const supabase = requireServerSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .select('adep_numero_dossier')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      if (isTableMissing(error)) return null;
      throw new Error(`getAdepNumeroDossier: ${error.message}`);
    }
    const blob = (data as { adep_numero_dossier: string | null } | null)
      ?.adep_numero_dossier;
    if (!blob) return null;
    try {
      return decryptCredential(blob);
    } catch {
      return null;
    }
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return null;
    throw err;
  }
}

export type RecruiterCalendarUrl =
  | { kind: 'none' }
  | { kind: 'url'; url: string }
  /** Une URL est enregistrée mais ne se déchiffre pas : ce n'est PAS « aucun agenda ». */
  | { kind: 'unreadable' };

/**
 * URL de l'agenda publié d'un recruteur, EN CLAIR. Server-only, appelée juste
 * avant la lecture — jamais gardée en mémoire, jamais renvoyée au navigateur.
 *
 * Distingue soigneusement « aucun agenda » (comportement historique) de
 * « agenda déclaré mais illisible » : confondre les deux ouvrirait des
 * créneaux sur un agenda qu'on a simplement échoué à consulter. Seules
 * l'absence de ligne, de valeur, ou de COLONNE (migration pas encore
 * appliquée — personne n'a donc pu en déclarer une) valent `none`.
 */
export async function loadRecruiterCalendarUrl(id: string): Promise<RecruiterCalendarUrl> {
  // Une ressource dont la clé n'est pas un identifiant de compte n'est pas un
  // recruteur : elle n'a pas d'agenda externe (et la requête échouerait sur le
  // type de la colonne, ce qui passerait à tort pour « illisible »).
  if (!UUID_PATTERN.test(id)) return { kind: 'none' };
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('busy_ics_url')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isTableMissing(error) || isColumnMissing(error)) return { kind: 'none' };
    return { kind: 'unreadable' };
  }
  const blob = (data as { busy_ics_url: string | null } | null)?.busy_ics_url;
  if (!blob) return { kind: 'none' };
  try {
    return { kind: 'url', url: decryptCredential(blob) };
  } catch {
    return { kind: 'unreadable' };
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isColumnMissing(err: { code?: string; message?: string }): boolean {
  if (err.code === '42703' || err.code === 'PGRST204') return true;
  return (err.message ?? '').includes('busy_ics_url');
}
