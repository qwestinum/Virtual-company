/**
 * Repo Supabase — commentaires de décision du recruteur (`verdict_comments`).
 * Spec : docs/specs/compte-rendu-entretien.md §2.3, §14.
 *
 * AJOUT SEUL : ce module n'expose ni mise à jour ni suppression — la base les
 * refuserait de toute façon (déclencheur `verdict_comments_no_update`) ; seule
 * la purge RGPD supprime, et elle a son propre chemin (`src/lib/gdpr`).
 */

import { chunk, fetchAllKeyset } from '@/lib/db/paginate';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { VerdictCommentRow } from '@/lib/db/types';
import type { FinalVerdict, VerdictComment } from '@/types/verdict-comment';

const TABLE = 'verdict_comments';
/** Taille des lots d'identifiants par requête (URL PostgREST bornée). */
const ID_CHUNK = 200;

/** Mapping row → domaine (pur, exporté pour test). */
export function verdictCommentRowToDomain(row: VerdictCommentRow): VerdictComment {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    uid: row.uid,
    campaignId: row.campaign_id,
    verdict: row.verdict,
    body: row.body,
    authorUserId: row.author_user_id,
    authorEmail: row.author_email,
    createdAt: row.created_at,
  };
}

export async function insertVerdictComment(input: {
  analysisId: string;
  uid: string;
  campaignId: string | null;
  verdict: FinalVerdict;
  /** Déjà NORMALISÉ par l'appelant (espaces de bord retirés). */
  body: string;
  authorUserId: string | null;
  authorEmail: string | null;
}): Promise<VerdictComment> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      analysis_id: input.analysisId,
      uid: input.uid,
      campaign_id: input.campaignId,
      verdict: input.verdict,
      body: input.body,
      author_user_id: input.authorUserId,
      author_email: input.authorEmail,
    })
    .select('*')
    .single();
  if (error) throw new Error(`insertVerdictComment: ${error.message}`);
  return verdictCommentRowToDomain(data as VerdictCommentRow);
}

/**
 * Tous les commentaires des analyses données, du plus ANCIEN au plus récent.
 * EXHAUSTIF : lots d'identifiants (URL bornée) paginés en keyset sur la PK —
 * jamais le plafond silencieux de 1000 lignes (audit C8), même pour le rapport
 * d'une campagne à plusieurs milliers de candidatures.
 */
export async function listVerdictCommentsByAnalyses(
  analysisIds: string[],
): Promise<VerdictComment[]> {
  const ids = [...new Set(analysisIds)].filter((id) => id.length > 0);
  if (ids.length === 0) return [];
  const supabase = requireServerSupabase();
  const out: VerdictComment[] = [];
  for (const batch of chunk(ids, ID_CHUNK)) {
    const rows = await fetchAllKeyset<VerdictCommentRow>({
      fetchPage: async (afterId, limit) => {
        let q = supabase
          .from(TABLE)
          .select('*')
          .in('analysis_id', batch)
          .order('id', { ascending: true })
          .limit(limit);
        if (afterId !== null) q = q.gt('id', afterId);
        const { data, error } = await q;
        if (error) throw new Error(`listVerdictCommentsByAnalyses: ${error.message}`);
        return (data ?? []) as VerdictCommentRow[];
      },
      cursorOf: (row) => row.id,
    });
    out.push(...rows.map(verdictCommentRowToDomain));
  }
  return out.sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
  );
}
