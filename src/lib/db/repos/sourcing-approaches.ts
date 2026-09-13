/**
 * Repo du module Sourcing — arbitrage et approches (lot 3).
 * Schéma : bloc « MODULE SOURCING » de scripts/migrate.sql · Spec : docs/specs/sourcing.md §7-8.
 *
 * Toutes les écritures passent par ici, et les invariants de la base
 * (contacté ⇔ auteur + date, jeton en SHA-256, note ≤ 300 caractères) sont le
 * dernier mot : une contrainte violée remonte en erreur, jamais en silence.
 */

import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { MessageFormat } from '@/lib/sourcing/message';
import type { ExaSnapshot, SourcingProfileState } from '@/types/sourcing';

export type SourcingProfileRecord = {
  id: string;
  campaignId: string;
  fingerprint: string;
  state: SourcingProfileState;
  snapshot: ExaSnapshot;
};

export async function getSourcingProfile(id: string): Promise<SourcingProfileRecord | null> {
  const { data, error } = await requireServerSupabase()
    .from('sourcing_profiles')
    .select('id, campaign_id, fingerprint, state, exa_snapshot')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getSourcingProfile: ${error.message}`);
  if (!data) return null;
  const r = data as { id: string; campaign_id: string; fingerprint: string; state: SourcingProfileState; exa_snapshot: ExaSnapshot };
  return { id: r.id, campaignId: r.campaign_id, fingerprint: r.fingerprint, state: r.state, snapshot: r.exa_snapshot };
}

/**
 * Pose une exclusion de campagne. Une exclusion existante (même empreinte, même
 * campagne) n'est jamais rétrogradée : « manifesté » ne redevient pas « contacté ».
 */
async function excludeForCampaign(fingerprint: string, campaignId: string, reason: 'declined' | 'contacted'): Promise<void> {
  const { error } = await requireServerSupabase()
    .from('sourcing_exclusions')
    .upsert({ fingerprint, campaign_id: campaignId, reason }, { onConflict: 'fingerprint,scope', ignoreDuplicates: true });
  if (error) throw new Error(`excludeForCampaign: ${error.message}`);
}

/**
 * Décliner : l'exclusion D'ABORD, la suppression ensuite. Dans l'ordre inverse,
 * un échec entre les deux laisserait un profil supprimé sans rien pour
 * l'empêcher de revenir à la prochaine recherche.
 */
export async function declineSourcingProfile(profile: SourcingProfileRecord): Promise<void> {
  await excludeForCampaign(profile.fingerprint, profile.campaignId, 'declined');
  const { error } = await requireServerSupabase().from('sourcing_profiles').delete().eq('id', profile.id);
  if (error) throw new Error(`declineSourcingProfile: ${error.message}`);
}

export type SourcingApproachRecord = {
  id: string;
  campaignId: string;
  profileId: string | null;
  fingerprint: string;
  recruiterId: string;
  channel: 'linkedin' | 'email';
  messageFormat: MessageFormat;
  message: string | null;
  status: 'active' | 'revoked' | 'admission_pending' | 'submitted';
  firstOpenedAt: string | null;
};

type ApproachRow = {
  id: string;
  campaign_id: string;
  profile_id: string | null;
  fingerprint: string;
  recruiter_id: string;
  channel: 'linkedin' | 'email';
  message_format: MessageFormat;
  message: string | null;
  status: SourcingApproachRecord['status'];
  first_opened_at: string | null;
};

const toApproach = (r: ApproachRow): SourcingApproachRecord => ({
  id: r.id,
  campaignId: r.campaign_id,
  profileId: r.profile_id,
  fingerprint: r.fingerprint,
  recruiterId: r.recruiter_id,
  channel: r.channel,
  messageFormat: r.message_format,
  message: r.message,
  status: r.status,
  firstOpenedAt: r.first_opened_at,
});

/** Le message est stocké AVEC l'emplacement `[lien]`, jamais avec l'URL (qui porte le jeton). */
export async function insertSourcingApproach(input: {
  profile: SourcingProfileRecord;
  recruiterId: string;
  channel: 'linkedin' | 'email';
  messageFormat: MessageFormat;
  message: string;
  tokenHash: string;
}): Promise<string> {
  const { data, error } = await requireServerSupabase()
    .from('sourcing_approaches')
    .insert({
      campaign_id: input.profile.campaignId,
      profile_id: input.profile.id,
      fingerprint: input.profile.fingerprint,
      recruiter_id: input.recruiterId,
      channel: input.channel,
      message_format: input.messageFormat,
      message: input.message,
      token_hash: input.tokenHash,
    })
    .select('id')
    .single();
  if (error) throw new Error(`insertSourcingApproach: ${error.message}`);
  return (data as { id: string }).id;
}

export async function getSourcingApproach(id: string): Promise<SourcingApproachRecord | null> {
  const { data, error } = await requireServerSupabase()
    .from('sourcing_approaches')
    .select('id, campaign_id, profile_id, fingerprint, recruiter_id, channel, message_format, message, status, first_opened_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getSourcingApproach: ${error.message}`);
  return data ? toApproach(data as ApproachRow) : null;
}

/**
 * Le recruteur a ouvert le profil et copié le message (ou ouvert sa
 * messagerie) : l'approche est ENGAGÉE. Profil ⇒ contacté (auteur + date),
 * exclusion de campagne ⇒ il ne reviendra pas dans une autre recherche.
 */
export async function confirmSourcingApproach(
  approach: SourcingApproachRecord,
  userId: string,
  message: string,
): Promise<void> {
  const db = requireServerSupabase();
  const upd = await db
    .from('sourcing_approaches')
    .update({ message })
    .eq('id', approach.id)
    .eq('status', 'active');
  if (upd.error) throw new Error(`confirmSourcingApproach/message: ${upd.error.message}`);
  await excludeForCampaign(approach.fingerprint, approach.campaignId, 'contacted');
  if (approach.profileId) {
    const prof = await db
      .from('sourcing_profiles')
      .update({ state: 'contacted', decided_at: new Date().toISOString(), decided_by_user_id: userId })
      .eq('id', approach.profileId)
      .neq('state', 'contacted');
    if (prof.error) throw new Error(`confirmSourcingApproach/profile: ${prof.error.message}`);
  }
}

/** Révocation : seulement un lien jamais ouvert (un lien ouvert a pu engager la personne). */
export async function revokeSourcingApproach(id: string): Promise<boolean> {
  const { data, error } = await requireServerSupabase()
    .from('sourcing_approaches')
    .update({ status: 'revoked' })
    .eq('id', id)
    .eq('status', 'active')
    .is('first_opened_at', null)
    .select('id');
  if (error) throw new Error(`revokeSourcingApproach: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function countRecruiterApproachesForCampaign(recruiterId: string, campaignId: string): Promise<number> {
  const { count, error } = await requireServerSupabase()
    .from('sourcing_approaches')
    .select('id', { count: 'exact', head: true })
    .eq('recruiter_id', recruiterId)
    .eq('campaign_id', campaignId)
    .neq('status', 'revoked');
  if (error) throw new Error(`countRecruiterApproachesForCampaign: ${error.message}`);
  return count ?? 0;
}

// ─── Préférences du recruteur ──────────────────────────────────────────────

export type SourcingPreferences = { messageFormat: 'connection_note' | 'inmail'; availableFirst: boolean };

export const DEFAULT_SOURCING_PREFERENCES: SourcingPreferences = { messageFormat: 'connection_note', availableFirst: true };

export async function getSourcingPreferences(recruiterId: string): Promise<SourcingPreferences> {
  const { data, error } = await requireServerSupabase()
    .from('recruiters')
    .select('sourcing_message_format, sourcing_available_first')
    .eq('id', recruiterId)
    .maybeSingle();
  if (error || !data) return DEFAULT_SOURCING_PREFERENCES;
  const r = data as { sourcing_message_format: string | null; sourcing_available_first: boolean | null };
  return {
    messageFormat: r.sourcing_message_format === 'inmail' ? 'inmail' : 'connection_note',
    availableFirst: r.sourcing_available_first ?? true,
  };
}

/** `false` si l'utilisateur n'a pas de fiche recruteur : la préférence vit alors le temps de la page. */
export async function patchSourcingPreferences(recruiterId: string, patch: Partial<SourcingPreferences>): Promise<boolean> {
  const row: Record<string, unknown> = {};
  if (patch.messageFormat !== undefined) row.sourcing_message_format = patch.messageFormat;
  if (patch.availableFirst !== undefined) row.sourcing_available_first = patch.availableFirst;
  if (Object.keys(row).length === 0) return true;
  const { data, error } = await requireServerSupabase().from('recruiters').update(row).eq('id', recruiterId).select('id');
  if (error) throw new Error(`patchSourcingPreferences: ${error.message}`);
  return (data ?? []).length > 0;
}
