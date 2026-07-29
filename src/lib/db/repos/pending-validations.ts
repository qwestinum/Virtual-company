/**
 * Repo Supabase pour la file des validations suspendues (HITL).
 * Spec : docs/specs/hitl-validation-suspendue.md
 *
 * Source de vérité serveur. Mapping row↔domain local (la signature publique
 * parle `PendingValidation`, pas `PendingValidationRow`). Dégrade en mode
 * volatile si Supabase absent (table manquante → liste vide, pas de 500).
 */

import { CLAIM_TTL_MS } from '@/lib/db/claims-policy';
import {
  requireServerSupabase,
  SupabaseNotConfiguredError,
} from '@/lib/db/supabase-server';
import type {
  DecidedBy,
  HitlDecision,
  HumanDecider,
  PendingValidation,
  PendingValidationStatus,
} from '@/types/hitl';

const TABLE = 'pending_validations';

type PendingValidationRow = {
  id: string;
  campaign_id: string;
  candidate_name: string;
  candidate_email: string | null;
  score: number | null;
  decision: HitlDecision;
  cv_artifact_id: string | null;
  report_artifact_id: string | null;
  mail_draft_artifact_id: string | null;
  confirmed: boolean;
  status: PendingValidationStatus;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  decided_by: DecidedBy | null;
  decided_by_user_id: string | null;
  decided_by_user_email: string | null;
  /** Ancre TTL de l'état `sending` (audit C6). Absent des writes domainToRow. */
  sending_at?: string | null;
};

function rowToDomain(row: PendingValidationRow): PendingValidation {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    candidateName: row.candidate_name,
    candidateEmail: row.candidate_email,
    score: row.score,
    decision: row.decision,
    cvArtifactId: row.cv_artifact_id,
    reportArtifactId: row.report_artifact_id,
    mailDraftArtifactId: row.mail_draft_artifact_id,
    confirmed: row.confirmed,
    status: row.status,
    payload: row.payload ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
    // « Qui a confirmé » (lot 1). Null = enqueue / ligne historique.
    decidedBy: row.decided_by ?? null,
    decidedByUser: row.decided_by_user_id
      ? {
          userId: row.decided_by_user_id,
          email: row.decided_by_user_email ?? null,
        }
      : null,
  };
}

function domainToRow(v: PendingValidation): PendingValidationRow {
  return {
    id: v.id,
    campaign_id: v.campaignId,
    candidate_name: v.candidateName,
    candidate_email: v.candidateEmail,
    score: v.score,
    decision: v.decision,
    cv_artifact_id: v.cvArtifactId,
    report_artifact_id: v.reportArtifactId,
    mail_draft_artifact_id: v.mailDraftArtifactId,
    confirmed: v.confirmed,
    status: v.status,
    payload: v.payload,
    created_at: v.createdAt,
    updated_at: v.updatedAt,
    decided_at: v.decidedAt,
    decided_by: v.decidedBy,
    decided_by_user_id: v.decidedByUser?.userId ?? null,
    decided_by_user_email: v.decidedByUser?.email ?? null,
  };
}

/** Table absente (migration HITL pas encore passée) → mode dégradé. */
function isTableMissing(err: { code?: string; message?: string }): boolean {
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  const msg = (err.message ?? '').toLowerCase();
  return (
    msg.includes('relation') &&
    msg.includes('pending_validations') &&
    msg.includes('does not exist')
  );
}

/**
 * Validations en attente, les plus anciennes d'abord. Inclut `sending`
 * (réservation d'envoi en cours, état de quelques secondes — ou ≤ TTL 5 min
 * après un crash) : pour TOUS les lecteurs (compteurs zone grise, stage,
 * métriques, liste UI), un `sending` est « encore en attente », jamais un état
 * terminal — la carte reste visible jusqu'à la finalisation `sent`.
 */
export async function listPendingValidations(): Promise<PendingValidation[]> {
  try {
    const supabase = requireServerSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .in('status', ['pending', 'sending'])
      .order('created_at', { ascending: true });
    if (error) {
      if (isTableMissing(error)) return [];
      throw new Error(`listPendingValidations: ${error.message}`);
    }
    return (data ?? []).map((r) => rowToDomain(r as PendingValidationRow));
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return [];
    throw err;
  }
}

export type VoidValidationOutcome =
  | 'voided'
  | 'in_flight'
  | 'already_sent'
  | 'already_void'
  | 'not_found';

/**
 * Ferme une validation par classement sans suite : transition UNIQUEMENT
 * `pending → void` (conditionnelle, un seul gagnant). Un `sending` n'est
 * JAMAIS voidé (un mail part peut-être) → `in_flight`, l'appelant diffère.
 * Un `sent` est final → `already_sent` (la décision a été prise et envoyée).
 */
export async function voidPendingValidation(
  id: string,
): Promise<VoidValidationOutcome> {
  try {
    const supabase = requireServerSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .update({ status: 'void', decided_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (error) {
      if (isTableMissing(error)) return 'not_found';
      throw new Error(`voidPendingValidation: ${error.message}`);
    }
    if ((data ?? []).length > 0) return 'voided';
    const { data: row, error: readError } = await supabase
      .from(TABLE)
      .select('status')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new Error(`voidPendingValidation: ${readError.message}`);
    if (!row) return 'not_found';
    const status = (row as { status: string }).status;
    if (status === 'sent') return 'already_sent';
    if (status === 'void') return 'already_void';
    return 'in_flight';
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return 'not_found';
    throw err;
  }
}

/**
 * Réouverture (annulation d'un classement par erreur) : `void → pending`,
 * conditionnel. La validation redevient visible dans la file HITL.
 */
export async function unvoidPendingValidation(
  id: string,
): Promise<'restored' | 'not_void'> {
  try {
    const supabase = requireServerSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .update({ status: 'pending', decided_at: null })
      .eq('id', id)
      .eq('status', 'void')
      .select('id');
    if (error) {
      if (isTableMissing(error)) return 'not_void';
      throw new Error(`unvoidPendingValidation: ${error.message}`);
    }
    return (data ?? []).length > 0 ? 'restored' : 'not_void';
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return 'not_void';
    throw err;
  }
}

/** Validations fermées par classement sans suite (status = 'void') — sert la
 * réouverture (restaurer `void → pending`). */
export async function listVoidValidations(): Promise<PendingValidation[]> {
  try {
    const supabase = requireServerSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('status', 'void')
      .order('updated_at', { ascending: false });
    if (error) {
      if (isTableMissing(error)) return [];
      throw new Error(`listVoidValidations: ${error.message}`);
    }
    return (data ?? []).map((r) => rowToDomain(r as PendingValidationRow));
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return [];
    throw err;
  }
}

/** Validations DÉJÀ traitées (status = 'sent') — historique consultable (lot 2d). */
export async function listSentValidations(
  limit = 50,
): Promise<PendingValidation[]> {
  try {
    const supabase = requireServerSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('status', 'sent')
      .order('updated_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 200));
    if (error) {
      if (isTableMissing(error)) return [];
      throw new Error(`listSentValidations: ${error.message}`);
    }
    return (data ?? []).map((r) => rowToDomain(r as PendingValidationRow));
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return [];
    throw err;
  }
}

/**
 * Signal métier « validations en retard » : nombre de validations ENCORE
 * `pending` (strict : un `sending` a déjà été déclenché par l'humain) mises en
 * file avant `cutoffIso`. `created_at` = date de PREMIÈRE mise en file
 * (préservée par l'enqueue non destructif). Table absente / Supabase non
 * configuré → 0 (pas de bruit en démo volatile).
 */
export async function countOverduePendingValidations(
  cutoffIso: string,
): Promise<number> {
  try {
    const supabase = requireServerSupabase();
    const { count, error } = await supabase
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lt('created_at', cutoffIso);
    if (error) {
      if (isTableMissing(error)) return 0;
      throw new Error(`countOverduePendingValidations: ${error.message}`);
    }
    return count ?? 0;
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return 0;
    throw err;
  }
}

/** Date de mise en file de la validation `pending` la plus ancienne (ou null). */
export async function oldestPendingValidationCreatedAt(): Promise<string | null> {
  try {
    const supabase = requireServerSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .select('created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (isTableMissing(error)) return null;
      throw new Error(`oldestPendingValidationCreatedAt: ${error.message}`);
    }
    return (data as { created_at: string } | null)?.created_at ?? null;
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) return null;
    throw err;
  }
}

export async function getPendingValidation(
  id: string,
): Promise<PendingValidation | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getPendingValidation: ${error.message}`);
  return data ? rowToDomain(data as PendingValidationRow) : null;
}

export async function upsertPendingValidation(
  v: PendingValidation,
): Promise<PendingValidation> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(domainToRow(v), { onConflict: 'id' })
    .select('*')
    .single();
  if (error) throw new Error(`upsertPendingValidation: ${error.message}`);
  return rowToDomain(data as PendingValidationRow);
}

export type ReserveSendOutcome =
  | 'reserved'
  | 'already_sent'
  | 'in_flight'
  | 'not_found';

/**
 * RÉSERVE l'envoi d'une validation (audit C6) — LE verrou atomique posé AVANT
 * tout envoi. Machine d'états `pending → sending → sent` :
 *   1. `pending → sending` conditionnel : un seul gagnant (double-clic /
 *      second onglet → `in_flight`).
 *   2. Reprise d'un `sending` PÉRIMÉ (crash en plein envoi, `sending_at` plus
 *      vieux que le TTL partagé de 5 min) : `sending` n'est JAMAIS un piège
 *      définitif — et le claim d'envoi (mail-composer) garantit qu'une reprise
 *      ne renverra pas un mail déjà parti.
 * Dès la réservation, la DÉCISION est immuable (le PATCH decision exige
 * `status='pending'`) : « invitation + refus » impossible par construction.
 */
export async function reserveValidationSend(
  id: string,
): Promise<ReserveSendOutcome> {
  const supabase = requireServerSupabase();
  const nowIso = new Date().toISOString();

  // 1. Cas nominal : la validation est `pending` — un seul gagnant.
  const { data: won, error: reserveError } = await supabase
    .from(TABLE)
    .update({ status: 'sending', sending_at: nowIso })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (reserveError) {
    throw new Error(`reserveValidationSend: ${reserveError.message}`);
  }
  if ((won?.length ?? 0) > 0) return 'reserved';

  // 2. Reprise d'un `sending` périmé (TTL partagé claims-policy).
  const cutoff = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
  const { data: retaken, error: retakeError } = await supabase
    .from(TABLE)
    .update({ status: 'sending', sending_at: nowIso })
    .eq('id', id)
    .eq('status', 'sending')
    .lt('sending_at', cutoff)
    .select('id');
  if (retakeError) {
    throw new Error(`reserveValidationSend: ${retakeError.message}`);
  }
  if ((retaken?.length ?? 0) > 0) return 'reserved';

  // 3. Perdu : rapporte l'état réel pour un message UX précis.
  const { data: current, error: readError } = await supabase
    .from(TABLE)
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (readError) {
    throw new Error(`reserveValidationSend: ${readError.message}`);
  }
  if (!current) return 'not_found';
  return (current as { status: string }).status === 'sent'
    ? 'already_sent'
    : 'in_flight';
}

/**
 * PATCH de la DÉCISION, conditionné à `status='pending'` (audit C6) : une fois
 * l'envoi réservé/engagé, la décision est verrouillée POUR DE BON — un retry
 * renvoie le même mail au besoin (claims), il ne re-tranche jamais.
 * `'locked'` = la validation n'est plus `pending`.
 */
export async function patchPendingValidationDecision(
  id: string,
  patch: PendingValidationPatch,
): Promise<PendingValidation | 'locked' | null> {
  const supabase = requireServerSupabase();
  const row = patchToRow(patch);
  if (Object.keys(row).length === 0) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .update(row)
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (error) {
    throw new Error(`patchPendingValidationDecision: ${error.message}`);
  }
  if (data) return rowToDomain(data as PendingValidationRow);
  // Aucune ligne touchée : inexistante, ou verrouillée (sending/sent).
  const existing = await getPendingValidation(id);
  return existing ? 'locked' : null;
}

export type PendingValidationPatch = {
  decision?: HitlDecision;
  confirmed?: boolean;
  status?: PendingValidationStatus;
  mailDraftArtifactId?: string | null;
  payload?: Record<string, unknown>;
  decidedAt?: string | null;
  /** « Qui a confirmé » — posé côté serveur à la confirmation humaine. */
  decidedBy?: DecidedBy;
  /** Identité du valideur — injectée depuis la session serveur (jamais le client). */
  decidedByUser?: HumanDecider | null;
};

function patchToRow(
  patch: PendingValidationPatch,
): Partial<PendingValidationRow> {
  const row: Partial<PendingValidationRow> = {};
  if (patch.decision !== undefined) row.decision = patch.decision;
  if (patch.confirmed !== undefined) row.confirmed = patch.confirmed;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.mailDraftArtifactId !== undefined)
    row.mail_draft_artifact_id = patch.mailDraftArtifactId;
  if (patch.payload !== undefined) row.payload = patch.payload;
  if (patch.decidedAt !== undefined) row.decided_at = patch.decidedAt;
  if (patch.decidedBy !== undefined) row.decided_by = patch.decidedBy;
  if (patch.decidedByUser !== undefined) {
    row.decided_by_user_id = patch.decidedByUser?.userId ?? null;
    row.decided_by_user_email = patch.decidedByUser?.email ?? null;
  }
  return row;
}

export async function patchPendingValidation(
  id: string,
  patch: PendingValidationPatch,
): Promise<PendingValidation | null> {
  const supabase = requireServerSupabase();
  const row = patchToRow(patch);
  if (Object.keys(row).length === 0) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .update(row)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`patchPendingValidation: ${error.message}`);
  return data ? rowToDomain(data as PendingValidationRow) : null;
}
