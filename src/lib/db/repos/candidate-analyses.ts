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

import { sanitizePostgrestSearch } from '@/lib/db/sanitize-search';
import {
  requireServerSupabase,
  SupabaseNotConfiguredError,
} from '@/lib/db/supabase-server';
import type { CandidateAnalysisRow } from '@/lib/db/types';
import type { CVApplication } from '@/types/cv-analysis';
import {
  DEFAULT_HITL_CONFIG,
  type DecidedBy,
  type DecisionZone,
  type HitlConfig,
  type HumanDecider,
} from '@/types/hitl';
import type { CandidateStatus } from '@/types/scoring';
import type {
  CandidateAnalysisDetail,
  CandidateAnalysisFilters,
  CandidateAnalysisSummary,
} from '@/types/reporting';

const TABLE = 'candidate_analyses';

/** Colonnes du résumé (sans le jsonb `application`). */
const SUMMARY_COLUMNS =
  'id, uid, campaign_id, candidate_name, candidate_email, file_name, source, received_at, total_score, status, computed_at, hitl_config, decision_zone, decided_by, decided_by_user_id, decided_by_user_email, from_vivier, vivier_candidate_id, created_at';

/**
 * Repli déterministe statut→zone (binaire, sans `gray`) — utilisé UNIQUEMENT
 * quand `scoringResult.decisionZone` est absent (analyses legacy / chemin sans
 * poignées). La zone autoritaire (3 niveaux) vient de `scoreCandidat`. Pur.
 */
export function deriveDecisionZone(status: CandidateStatus): DecisionZone {
  return status === 'accepted' ? 'auto_accept' : 'auto_reject';
}

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
    // Rows historiques sans snapshot → DEFAULT (ON) : comportement préservé.
    hitlConfig: row.hitl_config ?? DEFAULT_HITL_CONFIG,
    // Champs « système vs humain » (lot 1). Null = ligne antérieure au modèle
    // 3 zones — frontière nette, jamais reconstruite.
    decisionZone: row.decision_zone ?? null,
    decidedBy: row.decided_by ?? null,
    decidedByUser: row.decided_by_user_id
      ? { userId: row.decided_by_user_id, email: row.decided_by_user_email ?? null }
      : null,
    // Origine vivier dénormalisée. Repli `false` pour les rows antérieures à la
    // colonne (migration douce, jamais NULL grâce au défaut SQL).
    fromVivier: row.from_vivier ?? false,
    vivierCandidateId: row.vivier_candidate_id ?? null,
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
  /**
   * Snapshot HITL conservé pour l'audit historique. Le HITL global ayant été
   * retiré (3c), il vaut désormais `DEFAULT_HITL_CONFIG` par défaut — le
   * pilotage des décisions passe par les zones de seuils, pas par ce toggle.
   */
  hitlConfig?: HitlConfig;
  /**
   * Acteur ayant tranché le statut. Défaut `'auto'` : les deux call-sites de
   * scoring (chat + IMAP) sont automatiques en lot 1 — call-sites inchangés.
   * Le `'user'` (+ identité) arrivera au lot 2 quand la décision humaine
   * propagera vers `candidate_analyses`.
   */
  decidedBy?: DecidedBy;
};

/**
 * Persiste une analyse CV. Best-effort côté appelant : si Supabase n'est
 * pas configuré, `requireServerSupabase` lève `SupabaseNotConfiguredError`
 * — l'appelant l'attrape silencieusement (démo locale).
 */
/** Échappe les métacaractères LIKE (`%` `_` `\`) d'une valeur exacte. */
function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

/**
 * Dernière candidature (la plus récente) PAR EMAIL — campagne visée + date.
 * Sert à afficher « dernier poste visé » des candidats vivier (dérivé, non
 * stocké). Correspondance INSENSIBLE À LA CASSE (l'email d'analyse garde la
 * casse du CV, l'email vivier est normalisé). Une requête (`ilike`), résultat
 * trié décroissant ⇒ on retient la 1ʳᵉ ligne (la plus récente) par email.
 * Clé du Map = email en minuscules.
 */
export async function getLatestApplicationsByEmails(
  emails: string[],
): Promise<Map<string, { campaignId: string | null; receivedAt: string }>> {
  const out = new Map<string, { campaignId: string | null; receivedAt: string }>();
  const clean = [...new Set(emails.map((e) => e.trim()).filter(Boolean))];
  if (clean.length === 0) return out;

  const supabase = requireServerSupabase();
  const orFilter = clean
    .map((e) => `candidate_email.ilike.${escapeLike(e)}`)
    .join(',');
  const { data, error } = await supabase
    .from(TABLE)
    .select('candidate_email, campaign_id, received_at')
    .or(orFilter)
    .order('received_at', { ascending: false });
  if (error) throw new Error(`getLatestApplicationsByEmails: ${error.message}`);

  for (const row of (data ?? []) as {
    candidate_email: string | null;
    campaign_id: string | null;
    received_at: string;
  }[]) {
    const key = row.candidate_email?.trim().toLowerCase();
    if (key && !out.has(key)) {
      out.set(key, { campaignId: row.campaign_id, receivedAt: row.received_at });
    }
  }
  return out;
}

/**
 * Dernière analyse COMPLÈTE (avec `application`) pour un email — chemin REPLI
 * du webhook Cal.com : quand aucun briefing n'est en file, on régénère la
 * trame à partir de cette candidature. Correspondance insensible à la casse
 * (l'email d'analyse garde la casse du CV). `null` si le candidat est inconnu.
 */
export async function getLatestAnalysisByEmail(
  email: string,
): Promise<CandidateAnalysisDetail | null> {
  const clean = email.trim();
  if (!clean) return null;
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .ilike('candidate_email', escapeLike(clean))
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestAnalysisByEmail: ${error.message}`);
  return data ? rowToDetail(data as CandidateAnalysisRow) : null;
}

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
    hitl_config: input.hitlConfig ?? DEFAULT_HITL_CONFIG,
    // Zone figée au scoring : la VRAIE zone 3 niveaux calculée par scoreCandidat
    // (auto_reject/gray/auto_accept). Repli déterministe statut→zone seulement
    // si absente (legacy / chemin sans poignées). decided_by défaut 'auto'.
    decision_zone:
      scoringResult.decisionZone ?? deriveDecisionZone(scoringResult.status),
    decided_by: input.decidedBy ?? 'auto',
    decided_by_user_id: null,
    decided_by_user_email: null,
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
 * Propage la décision HUMAINE d'un candidat de zone grise (lot 2). UNIQUE
 * écriture UPDATE de cette table (insert-only partout ailleurs) : un humain a
 * tranché un gris → on fige le statut FINAL + qui a décidé + son identité.
 * `decision_zone` reste `'gray'` (immuable : ça A ÉTÉ gris — la trace d'audit
 * « repêché par l'humain » repose dessus). Corrélation par `uid` (+ campagne).
 * Best-effort : avale Supabase non configuré, logue le reste, ne casse jamais
 * le flux d'envoi appelant. Idempotent (re-send = même UPDATE).
 */
export async function updateCandidateAnalysisDecision(params: {
  uid: string;
  campaignId: string | null;
  status: CandidateStatus;
  decidedByUser: HumanDecider | null;
}): Promise<void> {
  try {
    const supabase = requireServerSupabase();
    let q = supabase
      .from(TABLE)
      .update({
        status: params.status,
        decided_by: 'user',
        decided_by_user_id: params.decidedByUser?.userId ?? null,
        decided_by_user_email: params.decidedByUser?.email ?? null,
      })
      .eq('uid', params.uid);
    q = params.campaignId
      ? q.eq('campaign_id', params.campaignId)
      : q.is('campaign_id', null);
    const { error } = await q;
    if (error) {
      console.error('[candidate-analyses] decision update failed', error.message);
    }
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[candidate-analyses] decision update failed', err);
    }
  }
}

/**
 * Construit la clause `.or(...)` de recherche libre (nom, email, id) ou null si
 * la saisie est vide après assainissement. Mutualise listes + comptage.
 */
function searchOrClause(search?: string): string | null {
  const clean = search ? sanitizePostgrestSearch(search) : '';
  if (!clean) return null;
  // Joker PostgREST dans `.or(...)` = `*` (pas `%`, non interprété).
  // `sanitizePostgrestSearch` a retiré tout `*`/`%` → joker maîtrisé.
  return `candidate_name.ilike.*${clean}*,candidate_email.ilike.*${clean}*,id.ilike.*${clean}*`;
}

/**
 * Liste paginée des analyses (sélection audit + menu Candidatures). `limit`
 * (défaut 200, plafond 1000) + `offset` (défaut 0) → vraie pagination serveur
 * (`.range`), jamais un chargement de tout le jeu. Les plus récentes d'abord.
 */
export async function listCandidateAnalyses(
  filters: CandidateAnalysisFilters = {},
): Promise<CandidateAnalysisSummary[]> {
  const supabase = requireServerSupabase();
  const cappedLimit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  const offset = Math.max(filters.offset ?? 0, 0);
  let q = supabase
    .from(TABLE)
    .select(SUMMARY_COLUMNS)
    .order('created_at', { ascending: false })
    .range(offset, offset + cappedLimit - 1);
  if (filters.campaignIds && filters.campaignIds.length > 0)
    q = q.in('campaign_id', filters.campaignIds);
  else if (filters.campaignId) q = q.eq('campaign_id', filters.campaignId);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.from) q = q.gte('received_at', filters.from);
  if (filters.to) q = q.lte('received_at', filters.to);
  if (filters.fromVivier) q = q.eq('from_vivier', true);
  const orClause = searchOrClause(filters.search);
  if (orClause) q = q.or(orClause);

  const { data, error } = await q;
  if (error) throw new Error(`listCandidateAnalyses: ${error.message}`);
  return (data ?? []).map((r) => rowToSummary(r as SummaryRow));
}

/** Compte EXACT des analyses du périmètre (total pagination + scope ruban). */
export async function countCandidateAnalyses(
  filters: CandidateAnalysisFilters = {},
): Promise<number> {
  const supabase = requireServerSupabase();
  let q = supabase.from(TABLE).select('id', { count: 'exact', head: true });
  if (filters.campaignIds && filters.campaignIds.length > 0)
    q = q.in('campaign_id', filters.campaignIds);
  else if (filters.campaignId) q = q.eq('campaign_id', filters.campaignId);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.from) q = q.gte('received_at', filters.from);
  if (filters.to) q = q.lte('received_at', filters.to);
  if (filters.fromVivier) q = q.eq('from_vivier', true);
  const orClause = searchOrClause(filters.search);
  if (orClause) q = q.or(orClause);

  const { count, error } = await q;
  if (error) throw new Error(`countCandidateAnalyses: ${error.message}`);
  return count ?? 0;
}

/**
 * Charge TOUT le périmètre filtré en paginant en interne (pages de 1000). Sert
 * le calcul EXHAUSTIF des compteurs du ruban : on dérive l'étape de chaque
 * candidat, jamais un sous-ensemble tronqué. Volume borné par le périmètre
 * (campagne + période) — la recherche texte ne doit PAS être passée ici.
 */
export async function listAllCandidateAnalyses(
  filters: CandidateAnalysisFilters = {},
): Promise<CandidateAnalysisSummary[]> {
  const PAGE = 1000;
  const out: CandidateAnalysisSummary[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await listCandidateAnalyses({ ...filters, limit: PAGE, offset });
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/**
 * Fige l'origine vivier sur une analyse (rapprochement email exact réussi).
 * Best-effort, idempotent. Appelée par `matchVivierApplication` au call-site
 * qui détient l'id de l'analyse (poller / cv-analyzer).
 */
export async function markAnalysisFromVivier(
  analysisId: string,
  vivierCandidateId: string,
): Promise<void> {
  try {
    const supabase = requireServerSupabase();
    const { error } = await supabase
      .from(TABLE)
      .update({ from_vivier: true, vivier_candidate_id: vivierCandidateId })
      .eq('id', analysisId);
    if (error) {
      console.error('[candidate-analyses] markAnalysisFromVivier failed', error.message);
    }
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[candidate-analyses] markAnalysisFromVivier failed', err);
    }
  }
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
