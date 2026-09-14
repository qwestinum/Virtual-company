/**
 * Repo du module Sourcing — page d'atterrissage, admission, opposition, purge
 * (lot 4). Spec : docs/specs/sourcing.md §9-12.
 *
 * Chaque transition de `sourcing_approaches` est CONDITIONNELLE sur l'état
 * attendu : deux soumissions simultanées d'un même lien n'en réservent qu'une,
 * et la contrainte `sourcing_approaches_submission_chk` tient le reste.
 */

import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { Submission } from '@/lib/sourcing/landing';
import type { MessageFormat } from '@/lib/sourcing/message';
import type { ExaSnapshot, SourcingProfileState } from '@/types/sourcing';

export type ApproachStatus = 'active' | 'revoked' | 'admission_pending' | 'submitted';

export type LandingApproach = {
  id: string;
  campaignId: string;
  profileId: string | null;
  fingerprint: string;
  recruiterId: string;
  channel: 'linkedin' | 'email';
  messageFormat: MessageFormat;
  message: string | null;
  status: ApproachStatus;
  initiatedAt: string;
  firstOpenedAt: string | null;
  submittedAt: string | null;
  submission: StoredSubmission | null;
  admissionAttempts: number;
  updatedAt: string;
};

/** La saisie telle que conservée le temps de l'admission, avec le CV joint éventuel. */
export type StoredSubmission = Submission & {
  cv: { bucket: string; storagePath: string; fileName: string; mime: string } | null;
};

type Row = {
  id: string;
  campaign_id: string;
  profile_id: string | null;
  fingerprint: string;
  recruiter_id: string;
  channel: 'linkedin' | 'email';
  message_format: MessageFormat;
  message: string | null;
  status: ApproachStatus;
  initiated_at: string;
  first_opened_at: string | null;
  submitted_at: string | null;
  submission: StoredSubmission | null;
  admission_attempts: number;
  updated_at: string;
};

const COLUMNS =
  'id, campaign_id, profile_id, fingerprint, recruiter_id, channel, message_format, message, status, initiated_at, first_opened_at, submitted_at, submission, admission_attempts, updated_at';

const toLanding = (r: Row): LandingApproach => ({
  id: r.id,
  campaignId: r.campaign_id,
  profileId: r.profile_id,
  fingerprint: r.fingerprint,
  recruiterId: r.recruiter_id,
  channel: r.channel,
  messageFormat: r.message_format,
  message: r.message,
  status: r.status,
  initiatedAt: r.initiated_at,
  firstOpenedAt: r.first_opened_at,
  submittedAt: r.submitted_at,
  submission: r.submission,
  admissionAttempts: r.admission_attempts,
  updatedAt: r.updated_at,
});

export async function getApproachByTokenHash(tokenHash: string): Promise<LandingApproach | null> {
  const { data, error } = await requireServerSupabase()
    .from('sourcing_approaches')
    .select(COLUMNS)
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) throw new Error(`getApproachByTokenHash: ${error.message}`);
  return data ? toLanding(data as Row) : null;
}

export async function getLandingApproach(id: string): Promise<LandingApproach | null> {
  const { data, error } = await requireServerSupabase().from('sourcing_approaches').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`getLandingApproach: ${error.message}`);
  return data ? toLanding(data as Row) : null;
}

export async function getProfileSnapshot(profileId: string): Promise<{ snapshot: ExaSnapshot; state: SourcingProfileState } | null> {
  const { data, error } = await requireServerSupabase()
    .from('sourcing_profiles')
    .select('exa_snapshot, state')
    .eq('id', profileId)
    .maybeSingle();
  if (error) throw new Error(`getProfileSnapshot: ${error.message}`);
  if (!data) return null;
  const r = data as { exa_snapshot: ExaSnapshot; state: SourcingProfileState };
  return { snapshot: r.exa_snapshot, state: r.state };
}

/** `true` à la PREMIÈRE ouverture seulement : c'est elle qu'on journalise. */
export async function markApproachOpened(id: string): Promise<boolean> {
  const { data, error } = await requireServerSupabase()
    .from('sourcing_approaches')
    .update({ first_opened_at: new Date().toISOString() })
    .eq('id', id)
    .is('first_opened_at', null)
    .select('id');
  if (error) throw new Error(`markApproachOpened: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Réservation : un seul gagnant, et seulement depuis un lien actif. */
export async function reserveSubmission(id: string, submission: StoredSubmission): Promise<boolean> {
  const { data, error } = await requireServerSupabase()
    .from('sourcing_approaches')
    .update({ status: 'admission_pending', submitted_at: new Date().toISOString(), submission, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'active')
    .is('submitted_at', null)
    .select('id');
  if (error) throw new Error(`reserveSubmission: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Relâche une réservation (offre fermée entre-temps) : la saisie ne survit pas. */
export async function releaseSubmission(id: string): Promise<void> {
  const { error } = await requireServerSupabase()
    .from('sourcing_approaches')
    .update({ status: 'active', submitted_at: null, submission: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'admission_pending');
  if (error) throw new Error(`releaseSubmission: ${error.message}`);
}

export async function recordAdmissionFailure(approach: LandingApproach, cause: string): Promise<void> {
  const { error } = await requireServerSupabase()
    .from('sourcing_approaches')
    .update({ admission_attempts: approach.admissionAttempts + 1, admission_last_error: cause.slice(0, 500), updated_at: new Date().toISOString() })
    .eq('id', approach.id)
    .eq('status', 'admission_pending');
  if (error) throw new Error(`recordAdmissionFailure: ${error.message}`);
}

/**
 * La candidature existe : la saisie disparaît, l'identifiant d'analyse reste.
 * `false` si un autre passage l'a déjà terminée — l'appelant ne journalise
 * alors RIEN (le journal de dev portait deux « manifestée » pour une approche).
 */
export async function completeAdmission(id: string, analysisId: string): Promise<boolean> {
  const { data, error } = await requireServerSupabase()
    .from('sourcing_approaches')
    .update({ status: 'submitted', analysis_id: analysisId, submission: null, admission_last_error: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'admission_pending')
    .select('id');
  if (error) throw new Error(`completeAdmission: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Le rail RÉSERVE une tentative avant de la lancer : `updated_at` repoussé à
 * maintenant, à condition qu'il n'ait pas bougé depuis la lecture. Deux
 * passages concurrents (cron sur instances isolées) : un seul gagne, l'autre
 * voit une admission « pas encore due ».
 */
export async function claimAdmissionAttempt(approach: LandingApproach): Promise<boolean> {
  const { data, error } = await requireServerSupabase()
    .from('sourcing_approaches')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', approach.id)
    .eq('status', 'admission_pending')
    .eq('updated_at', approach.updatedAt)
    .select('id');
  if (error) throw new Error(`claimAdmissionAttempt: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function listPendingAdmissions(limit: number): Promise<LandingApproach[]> {
  const { data, error } = await requireServerSupabase()
    .from('sourcing_approaches')
    .select(COLUMNS)
    .eq('status', 'admission_pending')
    .order('submitted_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`listPendingAdmissions: ${error.message}`);
  return ((data ?? []) as Row[]).map(toLanding);
}

/**
 * Manifestation : le profil disparaît, l'exclusion de campagne passe à
 * `manifested` (au-dessus de `contacted`, jamais l'inverse).
 */
export async function settleManifestedProfile(approach: LandingApproach): Promise<void> {
  const db = requireServerSupabase();
  const ex = await db
    .from('sourcing_exclusions')
    .upsert({ fingerprint: approach.fingerprint, campaign_id: approach.campaignId, reason: 'manifested' }, { onConflict: 'fingerprint,scope' });
  if (ex.error) throw new Error(`settleManifestedProfile/exclusion: ${ex.error.message}`);
  const del = await db.from('sourcing_profiles').delete().eq('campaign_id', approach.campaignId).eq('fingerprint', approach.fingerprint);
  if (del.error) throw new Error(`settleManifestedProfile/profile: ${del.error.message}`);
}

/**
 * Opposition : exclusion GLOBALE d'abord (sinon un échec laisserait revenir le
 * profil), puis profils supprimés sur toutes les campagnes, puis les liens
 * encore ouverts révoqués et vidés. Une candidature déjà créée ailleurs n'est
 * pas touchée : s'opposer au démarchage n'est pas retirer une candidature.
 */
export async function recordOpposition(fingerprint: string): Promise<{ profilesDeleted: number; approachesRevoked: number }> {
  const db = requireServerSupabase();
  const ex = await db
    .from('sourcing_exclusions')
    .upsert({ fingerprint, campaign_id: null, reason: 'opposed' }, { onConflict: 'fingerprint,scope', ignoreDuplicates: true });
  if (ex.error) throw new Error(`recordOpposition/exclusion: ${ex.error.message}`);
  const del = await db.from('sourcing_profiles').delete({ count: 'exact' }).eq('fingerprint', fingerprint);
  if (del.error) throw new Error(`recordOpposition/profiles: ${del.error.message}`);
  const now = new Date().toISOString();
  const rev = await db
    .from('sourcing_approaches')
    .update({ status: 'revoked', message: null, profile_id: null, purged_at: now, updated_at: now }, { count: 'exact' })
    .eq('fingerprint', fingerprint)
    .in('status', ['active', 'revoked']);
  if (rev.error) throw new Error(`recordOpposition/approaches: ${rev.error.message}`);
  return { profilesDeleted: del.count ?? 0, approachesRevoked: rev.count ?? 0 };
}

export type PurgeCount = { count: number; byState: Record<SourcingProfileState, number> };

/**
 * Clôture : les profils de la campagne sont supprimés, les exclusions restent.
 * Compté par état AVANT (des comptes, pas des lignes rapatriées : aucun
 * plafond de lecture ne peut fausser le chiffre journalisé).
 */
export async function purgeCampaignProfiles(campaignId: string): Promise<PurgeCount> {
  const db = requireServerSupabase();
  const states: SourcingProfileState[] = ['reserve', 'to_review', 'contacted'];
  const byState = { reserve: 0, to_review: 0, contacted: 0 } as Record<SourcingProfileState, number>;
  for (const state of states) {
    const { count, error } = await db
      .from('sourcing_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('state', state);
    if (error) throw new Error(`purgeCampaignProfiles/count: ${error.message}`);
    byState[state] = count ?? 0;
  }
  const del = await db.from('sourcing_profiles').delete().eq('campaign_id', campaignId);
  if (del.error) throw new Error(`purgeCampaignProfiles/delete: ${del.error.message}`);
  return { count: byState.reserve + byState.to_review + byState.contacted, byState };
}

/** Une campagne ni active ni suspendue qui porte encore des profils (filet du rail). */
export async function findCampaignWithLeftoverProfiles(): Promise<string | null> {
  const { data, error } = await requireServerSupabase()
    .from('sourcing_profiles')
    .select('campaign_id, campaigns!inner(status)')
    .not('campaigns.status', 'in', '(active,paused)')
    .limit(1);
  if (error) throw new Error(`findCampaignWithLeftoverProfiles: ${error.message}`);
  const row = (data ?? [])[0] as { campaign_id: string } | undefined;
  return row?.campaign_id ?? null;
}
