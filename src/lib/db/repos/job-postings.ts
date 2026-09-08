/**
 * Repo `job_postings` — les publications sur un site d'emploi.
 *
 * ── LA RÉSERVATION EST LE VERROU ────────────────────────────────────────────
 *
 * `openPosition` n'est pas idempotent, et sur Vercel chaque requête est une
 * instance isolée : une garde en mémoire de processus ne sérialiserait rien.
 * **La base est la seule chose partagée.** D'où `reserveJobPosting`, qui INSÈRE
 * la ligne avant l'appel : l'unicité de `client_reference` fait qu'un seul
 * gagnant part, et le perdant sait qu'il a perdu. C'est le mécanisme des claims
 * d'outreach IMAP, appliqué à une ressource externe qui ne sait pas fusionner.
 *
 * ── LE STATUT EST UN CACHE, PAS UNE VÉRITÉ ──────────────────────────────────
 *
 * `remote_status` est ce que `getPositionStatus` a dit, avec l'heure de la
 * lecture. Un consultant Apec peut valider, un recruteur peut modifier sur
 * apec.fr : ORQA ne l'apprend qu'en demandant. Tout lecteur doit afficher
 * l'horodatage avec l'état — jamais l'état nu.
 *
 * Tolérant à la table absente : la migration s'applique à la main, et un écran
 * qui répondrait 500 avant qu'elle ne soit passée serait une mauvaise
 * surprise de déploiement.
 */

import { requireServerSupabase, SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import type { AdepPositionStatus } from '@/types/adep';

const TABLE = 'job_postings';

export type JobPostingAttemptState = 'reserved' | 'sent' | 'acknowledged' | 'failed';

export type JobPosting = {
  id: string;
  campaignId: string;
  channel: string;
  clientReference: string;
  apecPositionNumero: string | null;
  attemptState: JobPostingAttemptState;
  trackingId: string | null;
  requestSnapshot: unknown;
  requestXml: string | null;
  ackRaw: string | null;
  remoteStatus: AdepPositionStatus | string | null;
  remoteStatusAt: string | null;
  remoteIsEditable: boolean | null;
  remoteUrl: string | null;
  publishedAt: string | null;
  suspendedAt: string | null;
  closedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  campaign_id: string;
  channel: string;
  client_reference: string;
  apec_position_numero: string | null;
  attempt_state: JobPostingAttemptState;
  tracking_id: string | null;
  request_snapshot: unknown;
  request_xml: string | null;
  ack_raw: string | null;
  remote_status: string | null;
  remote_status_at: string | null;
  remote_is_editable: boolean | null;
  remote_url: string | null;
  published_at: string | null;
  suspended_at: string | null;
  closed_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
};

function toDomain(row: Row): JobPosting {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    channel: row.channel,
    clientReference: row.client_reference,
    apecPositionNumero: row.apec_position_numero,
    attemptState: row.attempt_state,
    trackingId: row.tracking_id,
    requestSnapshot: row.request_snapshot,
    requestXml: row.request_xml,
    ackRaw: row.ack_raw,
    remoteStatus: row.remote_status,
    remoteStatusAt: row.remote_status_at,
    remoteIsEditable: row.remote_is_editable,
    remoteUrl: row.remote_url,
    publishedAt: row.published_at,
    suspendedAt: row.suspended_at,
    closedAt: row.closed_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isJobPostingsTableMissing(err: {
  code?: string;
  message?: string;
}): boolean {
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes('job_postings') && msg.includes('not') && msg.includes('found');
}

/** Toutes les tentatives d'une campagne sur un canal, la plus récente d'abord. */
export async function listJobPostings(
  campaignId: string,
  channel: string,
): Promise<JobPosting[]> {
  try {
    const db = requireServerSupabase();
    const { data, error } = await db
      .from(TABLE)
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('channel', channel)
      .order('created_at', { ascending: false });
    if (error) {
      if (isJobPostingsTableMissing(error)) return [];
      throw new Error(`listJobPostings: ${error.message}`);
    }
    return (data ?? []).map((r) => toDomain(r as Row));
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return [];
    throw err;
  }
}

/** La tentative COURANTE : la plus récente. `null` si jamais publiée. */
export async function getCurrentJobPosting(
  campaignId: string,
  channel: string,
): Promise<JobPosting | null> {
  const all = await listJobPostings(campaignId, channel);
  return all[0] ?? null;
}

export type ReserveResult =
  | { kind: 'reserved'; posting: JobPosting }
  /**
   * Un autre appel a déjà réservé cette référence. On n'envoie RIEN — c'est
   * exactement le doublon qu'on veut empêcher, et il ne se répare pas côté Apec.
   */
  | { kind: 'taken'; existing: JobPosting | null }
  | { kind: 'unavailable'; reason: string };

/**
 * Pose la ligne AVANT l'appel. L'unicité de `client_reference` est le verrou.
 *
 * ⚠️ Ne jamais transformer ce conflit en « on continue quand même » : deux
 * instances concurrentes créeraient deux offres chez l'Apec, et rien ne
 * permettrait de les fusionner ensuite.
 */
export async function reserveJobPosting(input: {
  id: string;
  campaignId: string;
  channel: string;
  clientReference: string;
  trackingId: string;
  requestSnapshot: unknown;
  requestXml: string;
}): Promise<ReserveResult> {
  try {
    const db = requireServerSupabase();
    const { data, error } = await db
      .from(TABLE)
      .insert({
        id: input.id,
        campaign_id: input.campaignId,
        channel: input.channel,
        client_reference: input.clientReference,
        tracking_id: input.trackingId,
        request_snapshot: input.requestSnapshot,
        request_xml: input.requestXml,
        attempt_state: 'reserved',
      })
      .select('*')
      .single();

    if (error) {
      if (isJobPostingsTableMissing(error)) {
        return {
          kind: 'unavailable',
          reason:
            'La table job_postings est absente : appliquez scripts/migrate.sql, ' +
            'puis rechargez le cache de schéma PostgREST.',
        };
      }
      // 23505 = violation d'unicité sur `client_reference`.
      if (error.code === '23505') {
        const existing = await findByClientReference(input.clientReference);
        return { kind: 'taken', existing };
      }
      throw new Error(`reserveJobPosting: ${error.message}`);
    }
    return { kind: 'reserved', posting: toDomain(data as Row) };
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return { kind: 'unavailable', reason: 'Supabase n’est pas configuré.' };
    }
    throw err;
  }
}

export async function findByClientReference(
  clientReference: string,
): Promise<JobPosting | null> {
  try {
    const db = requireServerSupabase();
    const { data, error } = await db
      .from(TABLE)
      .select('*')
      .eq('client_reference', clientReference)
      .maybeSingle();
    if (error) {
      if (isJobPostingsTableMissing(error)) return null;
      throw new Error(`findByClientReference: ${error.message}`);
    }
    return data ? toDomain(data as Row) : null;
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return null;
    throw err;
  }
}

export type JobPostingPatch = {
  attemptState?: JobPostingAttemptState;
  apecPositionNumero?: string | null;
  ackRaw?: string | null;
  remoteStatus?: string | null;
  remoteStatusAt?: string | null;
  remoteIsEditable?: boolean | null;
  remoteUrl?: string | null;
  publishedAt?: string | null;
  suspendedAt?: string | null;
  closedAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
};

export async function patchJobPosting(
  id: string,
  patch: JobPostingPatch,
): Promise<JobPosting | null> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.attemptState !== undefined) row.attempt_state = patch.attemptState;
  if (patch.apecPositionNumero !== undefined)
    row.apec_position_numero = patch.apecPositionNumero;
  if (patch.ackRaw !== undefined) row.ack_raw = patch.ackRaw;
  if (patch.remoteStatus !== undefined) row.remote_status = patch.remoteStatus;
  if (patch.remoteStatusAt !== undefined) row.remote_status_at = patch.remoteStatusAt;
  if (patch.remoteIsEditable !== undefined)
    row.remote_is_editable = patch.remoteIsEditable;
  if (patch.remoteUrl !== undefined) row.remote_url = patch.remoteUrl;
  if (patch.publishedAt !== undefined) row.published_at = patch.publishedAt;
  if (patch.suspendedAt !== undefined) row.suspended_at = patch.suspendedAt;
  if (patch.closedAt !== undefined) row.closed_at = patch.closedAt;
  if (patch.lastErrorCode !== undefined) row.last_error_code = patch.lastErrorCode;
  if (patch.lastErrorMessage !== undefined)
    row.last_error_message = patch.lastErrorMessage;

  try {
    const db = requireServerSupabase();
    const { data, error } = await db
      .from(TABLE)
      .update(row)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) {
      if (isJobPostingsTableMissing(error)) return null;
      throw new Error(`patchJobPosting: ${error.message}`);
    }
    return data ? toDomain(data as Row) : null;
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return null;
    throw err;
  }
}

/**
 * Offres encore VIVANTES chez l'Apec — publiées ou suspendues.
 *
 * Sert aux deux signaux métier (§6.4). Le filtre est en SQL et s'appuie sur
 * l'index partiel `job_postings_live_idx` : on ne balaie pas la table pour
 * jeter ensuite, c'est la leçon du fil d'activité du 21/08.
 */
export async function listLiveJobPostings(): Promise<JobPosting[]> {
  try {
    const db = requireServerSupabase();
    const { data, error } = await db
      .from(TABLE)
      .select('*')
      .in('remote_status', ['PUBLIEE', 'SUSPENDUE'])
      .order('published_at', { ascending: true });
    if (error) {
      if (isJobPostingsTableMissing(error)) return [];
      throw new Error(`listLiveJobPostings: ${error.message}`);
    }
    return (data ?? []).map((r) => toDomain(r as Row));
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return [];
    throw err;
  }
}
