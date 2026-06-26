/**
 * Repo Supabase pour la file des validations suspendues (HITL).
 * Spec : docs/specs/hitl-validation-suspendue.md
 *
 * Source de vérité serveur. Mapping row↔domain local (la signature publique
 * parle `PendingValidation`, pas `PendingValidationRow`). Dégrade en mode
 * volatile si Supabase absent (table manquante → liste vide, pas de 500).
 */

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

/** Validations en attente (status = 'pending'), les plus anciennes d'abord. */
export async function listPendingValidations(): Promise<PendingValidation[]> {
  try {
    const supabase = requireServerSupabase();
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('status', 'pending')
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

export async function patchPendingValidation(
  id: string,
  patch: PendingValidationPatch,
): Promise<PendingValidation | null> {
  const supabase = requireServerSupabase();
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
