/**
 * Repo Supabase — analyses CV persistées (Audit candidat).
 *
 * Source de vérité durable des candidatures traitées par ORQA (cf.
 * docs/specs/reporting.md §5.3). Une ligne = UNE analyse (traitement
 * distinct, jamais dédupliqué par email). Le `CVApplication` intégral vit
 * en jsonb (`application`) ; les colonnes scalaires dénormalisées servent
 * le filtrage de la sélection audit.
 *
 * `listCandidateAnalyses` renvoie des RÉSUMÉS (sans `application`, plus
 * léger) ; `getCandidateAnalysis` renvoie le DÉTAIL complet pour la vue
 * critère-par-critère.
 */

import {
  requireServerSupabase,
  SupabaseNotConfiguredError,
} from '@/lib/db/supabase-server';
import type { CandidateAnalysisRow } from '@/lib/db/types';
import type { CVApplication } from '@/types/cv-analysis';
import type {
  CandidateAnalysisDetail,
  CandidateAnalysisFilters,
  CandidateAnalysisSummary,
} from '@/types/reporting';

const TABLE = 'candidate_analyses';

/** Colonnes du résumé (sans le jsonb `application`). */
const SUMMARY_COLUMNS =
  'id, uid, campaign_id, candidate_name, candidate_email, file_name, source, received_at, total_score, status, computed_at, created_at';

type SummaryRow = Omit<CandidateAnalysisRow, 'application' | 'criteria_version'>;

/** Mapping row résumé → domaine (pur, exporté pour test unitaire). */
export function rowToSummary(row: SummaryRow): CandidateAnalysisSummary {
  return {
    id: row.id,
    // Fallback id : rows chat (uid = id) ou antérieures à la colonne uid.
    uid: row.uid ?? row.id,
    campaignId: row.campaign_id,
    candidateName: row.candidate_name,
    candidateEmail: row.candidate_email,
    fileName: row.file_name,
    source: row.source,
    receivedAt: row.received_at,
    totalScore: row.total_score,
    status: row.status,
    computedAt: row.computed_at,
    createdAt: row.created_at,
  };
}

/** Mapping row complet → détail (pur, exporté pour test unitaire). */
export function rowToDetail(row: CandidateAnalysisRow): CandidateAnalysisDetail {
  return {
    ...rowToSummary(row),
    application: row.application,
  };
}

export type CandidateAnalysisInsert = {
  /** Identifiant unique de l'analyse (uid du CV ou id généré). */
  id: string;
  /**
   * Clé de corrélation avec les marqueurs de parcours du journal. Chat :
   * uid = taskId (= id). IMAP : uid brut du mail. Défaut = id si omis.
   */
  uid?: string;
  campaignId: string | null;
  application: CVApplication;
};

/**
 * Persiste une analyse CV. Best-effort côté appelant : si Supabase n'est
 * pas configuré, `requireServerSupabase` lève `SupabaseNotConfiguredError`
 * — l'appelant l'attrape silencieusement (démo locale).
 */
export async function insertCandidateAnalysis(
  input: CandidateAnalysisInsert,
): Promise<void> {
  const supabase = requireServerSupabase();
  const { candidate, scoringResult } = input.application;
  const { error } = await supabase.from(TABLE).insert({
    id: input.id,
    uid: input.uid ?? input.id,
    campaign_id: input.campaignId,
    candidate_name: candidate.fullName,
    candidate_email: candidate.email,
    file_name: candidate.fileName,
    source: candidate.source,
    received_at: candidate.receivedAt,
    total_score: scoringResult.totalScore,
    status: scoringResult.status,
    criteria_version: scoringResult.criteriaVersion,
    computed_at: scoringResult.computedAt,
    application: input.application,
  });
  if (error) throw new Error(`insertCandidateAnalysis: ${error.message}`);
}

/**
 * Variante BEST-EFFORT pour le pipeline d'analyse (route chat + poller
 * IMAP). Avale `SupabaseNotConfiguredError` (démo locale sans base) ;
 * toute autre erreur est loggée serveur sans casser l'analyse en cours.
 * Symétrique de la journalisation best-effort déjà en place.
 */
export async function persistCandidateAnalysis(
  input: CandidateAnalysisInsert,
): Promise<void> {
  try {
    await insertCandidateAnalysis(input);
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[candidate-analyses] persist failed', err);
    }
  }
}

/**
 * Neutralise les caractères qui casseraient la syntaxe d'un filtre
 * PostgREST `.or(...)` (virgules, parenthèses, joker `%`/`*`). On garde
 * une recherche « contient » insensible à la casse, suffisante pour la
 * sélection audit.
 */
function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%*]/g, ' ').trim();
}

export async function listCandidateAnalyses(
  filters: CandidateAnalysisFilters = {},
): Promise<CandidateAnalysisSummary[]> {
  const supabase = requireServerSupabase();
  const cappedLimit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  let q = supabase
    .from(TABLE)
    .select(SUMMARY_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(cappedLimit);

  if (filters.campaignId) q = q.eq('campaign_id', filters.campaignId);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.from) q = q.gte('received_at', filters.from);
  if (filters.to) q = q.lte('received_at', filters.to);

  const search = filters.search ? sanitizeSearch(filters.search) : '';
  if (search) {
    q = q.or(
      `candidate_name.ilike.%${search}%,candidate_email.ilike.%${search}%,id.ilike.%${search}%`,
    );
  }

  const { data, error } = await q;
  if (error) throw new Error(`listCandidateAnalyses: ${error.message}`);
  return (data ?? []).map((r) => rowToSummary(r as SummaryRow));
}

export async function getCandidateAnalysis(
  id: string,
): Promise<CandidateAnalysisDetail | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getCandidateAnalysis: ${error.message}`);
  return data ? rowToDetail(data as CandidateAnalysisRow) : null;
}
