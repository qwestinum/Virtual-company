/**
 * Repo Supabase — comptes rendus d'entretien (`interview_reports`).
 * Spec : docs/specs/compte-rendu-entretien.md §2.3, §5.7, §15.
 *
 * Un compte rendu par candidature et par tour (un seul tour aujourd'hui).
 * Brouillon → vérifié : la vérification pose son auteur et sa date (la base
 * le garantit, `interview_reports_verified_chk`). Un compte rendu vérifié ne
 * redevient pas brouillon : il se modifie en étant RE-validé, par celui qui
 * le modifie — un brouillon est invisible des lecteurs, et un compte rendu
 * déjà montré au dossier ne doit pas en disparaître en silence.
 */

import { chunk, fetchAllKeyset } from '@/lib/db/paginate';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { InterviewReportRow } from '@/lib/db/types';
import type { HumanDecider } from '@/types/hitl';
import {
  InterviewReportSectionsSchema,
  type InterviewReport,
  type InterviewReportSections,
  type InterviewReportSource,
} from '@/types/interview-report';

const TABLE = 'interview_reports';
/** Colonnes lues : jamais `search_text`, réservée au contrôle de purge. */
const COLUMNS =
  'id, analysis_id, uid, campaign_id, brief_id, round, source, status, sections, generated_model, omitted_count, created_by_user_id, created_by_email, verified_by_user_id, verified_by_email, verified_at, created_at, updated_at';
const ID_CHUNK = 200;

/** Mapping row → domaine (pur, exporté pour test). Rubriques illisibles ⇒ erreur. */
export function interviewReportRowToDomain(row: InterviewReportRow): InterviewReport {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    uid: row.uid,
    campaignId: row.campaign_id,
    round: row.round,
    source: row.source,
    status: row.status,
    sections: InterviewReportSectionsSchema.parse(row.sections),
    generatedModel: row.generated_model,
    omittedCount: row.omitted_count,
    createdByEmail: row.created_by_email,
    verifiedByEmail: row.verified_by_email,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getInterviewReport(
  analysisId: string,
  round = 1,
): Promise<InterviewReport | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .eq('analysis_id', analysisId)
    .eq('round', round)
    .maybeSingle();
  if (error) throw new Error(`getInterviewReport: ${error.message}`);
  return data ? interviewReportRowToDomain(data as InterviewReportRow) : null;
}

/** Comptes rendus des analyses données (tous statuts), exhaustif. */
export async function listInterviewReportsByAnalyses(
  analysisIds: string[],
): Promise<InterviewReport[]> {
  const ids = [...new Set(analysisIds)].filter((id) => id.length > 0);
  if (ids.length === 0) return [];
  const supabase = requireServerSupabase();
  const out: InterviewReport[] = [];
  for (const batch of chunk(ids, ID_CHUNK)) {
    const rows = await fetchAllKeyset<InterviewReportRow>({
      fetchPage: async (afterId, limit) => {
        let q = supabase
          .from(TABLE)
          .select(COLUMNS)
          .in('analysis_id', batch)
          .order('id', { ascending: true })
          .limit(limit);
        if (afterId !== null) q = q.gt('id', afterId);
        const { data, error } = await q;
        if (error) throw new Error(`listInterviewReportsByAnalyses: ${error.message}`);
        return (data ?? []) as InterviewReportRow[];
      },
      cursorOf: (row) => row.id,
    });
    out.push(...rows.map(interviewReportRowToDomain));
  }
  return out;
}

export type SaveReportOutcome =
  | { status: 'saved'; report: InterviewReport }
  /** Un compte rendu vérifié ne redevient pas brouillon. */
  | { status: 'already_verified' };

/**
 * Enregistre (crée ou met à jour) le compte rendu d'un tour.
 *
 * `source`/`generatedModel`/`omittedCount` ne sont posés qu'à la CRÉATION —
 * ou quand une proposition issue d'une transcription remplit un brouillon
 * VIDE (seul cas où l'import écrit sur une ligne existante). Une correction à
 * la main ne les touche jamais : un compte rendu proposé puis corrigé reste
 * « établi à partir d'une transcription » — c'est ce que dit sa mention.
 */
export async function saveInterviewReport(input: {
  analysisId: string;
  uid: string;
  campaignId: string | null;
  briefId?: string | null;
  round?: number;
  source: InterviewReportSource;
  sections: InterviewReportSections;
  action: 'draft' | 'verify';
  actor: HumanDecider | null;
  generatedModel?: string | null;
  omittedCount?: number | null;
}): Promise<SaveReportOutcome> {
  const supabase = requireServerSupabase();
  const round = input.round ?? 1;
  const existing = await getInterviewReport(input.analysisId, round);
  if (existing && existing.status === 'verified' && input.action === 'draft') {
    return { status: 'already_verified' };
  }

  const now = new Date().toISOString();
  const status = input.action === 'verify' ? 'verified' : 'draft';
  const verification =
    input.action === 'verify'
      ? {
          verified_by_user_id: input.actor?.userId ?? null,
          verified_by_email: input.actor?.email ?? null,
          verified_at: now,
        }
      : { verified_by_user_id: null, verified_by_email: null, verified_at: null };

  if (existing) {
    const { data, error } = await supabase
      .from(TABLE)
      .update({
        sections: input.sections,
        status,
        ...verification,
        ...(input.source === 'transcript'
          ? {
              source: 'transcript',
              generated_model: input.generatedModel ?? null,
              omitted_count: input.omittedCount ?? null,
            }
          : {}),
      })
      .eq('id', existing.id)
      .select(COLUMNS)
      .single();
    if (error) throw new Error(`saveInterviewReport (update): ${error.message}`);
    return { status: 'saved', report: interviewReportRowToDomain(data as InterviewReportRow) };
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      analysis_id: input.analysisId,
      uid: input.uid,
      campaign_id: input.campaignId,
      brief_id: input.briefId ?? null,
      round,
      source: input.source,
      sections: input.sections,
      status,
      generated_model: input.source === 'transcript' ? (input.generatedModel ?? null) : null,
      omitted_count: input.source === 'transcript' ? (input.omittedCount ?? null) : null,
      created_by_user_id: input.actor?.userId ?? null,
      created_by_email: input.actor?.email ?? null,
      ...verification,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(`saveInterviewReport (insert): ${error.message}`);
  return { status: 'saved', report: interviewReportRowToDomain(data as InterviewReportRow) };
}
