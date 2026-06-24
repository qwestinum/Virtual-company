/**
 * Repo Supabase pour l'index des FDPs archivées (Session 5, round 1).
 *
 * Cette table est l'index recherchable utilisé par la pré-recherche L1
 * du Manager (`searchExistingJobDescriptions`). Une ligne est insérée
 * à chaque validation explicite de FDP — pas à chaque mise à jour de
 * campagne (la source de vérité du snapshot reste `campaigns.fdp`).
 *
 * Recherche : tokenisation FR + OR `ilike` sur les tokens significatifs
 * (≥ 3 caractères, stopwords filtrés). Tri par récence (archived_at
 * desc). Limite 5 résultats. Le matching fuzzy fin (typos, accents)
 * via pg_trgm RPC reste un upgrade post-MVP.
 *
 * Pourquoi tokeniser : la query qui arrive depuis le Manager est le
 * dernier message brut du user (ex. « je veux recruter un comptable
 * senior à Paris »). Un `ilike '%phrase entière%'` ne match jamais un
 * job_title court comme « Comptable ». On découpe en tokens, on filtre
 * les mots fonctionnels, et on OR les `ilike` sur chaque token utile.
 */

import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { FdpArchivedRow } from '@/lib/db/types';
import type { JobDescription } from '@/lib/storage/job-descriptions';
import { joinContracts } from '@/lib/fdp/contract-type';
import type { FDPInProgress } from '@/types/field-collection';

const TABLE = 'fdps_archived';
const SEARCH_LIMIT = 5;
const MIN_TOKEN_LENGTH = 3;
const MAX_TOKENS = 8;

/**
 * Stopwords FR usuels pour les messages de cadrage RH. On évite que
 * « je », « veux », « pour », « avec » ne génèrent des hits parasites.
 * Liste volontairement courte — on ne fait pas de NLP, juste un filtre
 * sur les tokens qui n'apporteraient aucun signal d'intitulé de poste.
 */
const FR_STOPWORDS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'au', 'aux',
  'et', 'ou', 'mais', 'donc', 'car', 'que', 'qui', 'quoi', 'dont',
  'ce', 'cet', 'cette', 'ces', 'ça', 'sa', 'son', 'ses',
  'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'notre', 'nos', 'votre', 'vos',
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
  'me', 'te', 'se', 'lui', 'leur', 'leurs',
  'pour', 'par', 'avec', 'sans', 'sous', 'sur', 'dans', 'chez', 'vers',
  'est', 'sont', 'sera', 'était', 'étaient', 'soit', 'être',
  'ai', 'as', 'avons', 'avez', 'ont', 'avoir',
  'pas', 'plus', 'moins', 'très', 'tres', 'bien', 'tout', 'tous', 'toute', 'toutes',
  'aussi', 'alors', 'comme', 'sans', 'puis', 'donc', 'mais', 'aussi',
  'veux', 'voudrais', 'souhaite', 'souhaiterais', 'cherche', 'cherchons',
  'recrute', 'recruter', 'recrutons', 'besoin', 'faut',
]);

function tokenize(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .replace(/[''`]/g, ' ')
    .split(/[\s,;./()\-?!:"]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !FR_STOPWORDS.has(t));
  // dédup en préservant l'ordre, cap à MAX_TOKENS pour éviter qu'un
  // message verbeux explose l'URL de la requête PostgREST.
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    result.push(t);
    if (result.length >= MAX_TOKENS) break;
  }
  return result;
}

function extractField(fdp: FDPInProgress, key: string): string | null {
  const field = fdp.fields[key as keyof typeof fdp.fields];
  const v = field?.value;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function rowToJobDescription(row: FdpArchivedRow): JobDescription {
  return {
    id: row.campaign_id,
    title: row.job_title,
    archivedAt: row.archived_at,
    fdp: row.fdp,
  };
}

export async function archiveFdp(
  campaignId: string,
  fdp: FDPInProgress,
): Promise<void> {
  const supabase = requireServerSupabase();
  const jobTitle = extractField(fdp, 'job_title') ?? 'Poste non précisé';
  const row: Omit<FdpArchivedRow, 'archived_at'> = {
    campaign_id: campaignId,
    job_title: jobTitle,
    seniority: extractField(fdp, 'seniority'),
    // Multi-valeur : on JOINT (« CDI, CDD ») pour la colonne string. Sans ça,
    // `extractField` renverrait null sur un tableau (perte silencieuse). '' → null.
    contract_type: joinContracts(fdp.fields.contract_type?.value) || null,
    location: extractField(fdp, 'location'),
    fdp,
  };
  const { error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'campaign_id' });
  if (error) throw new Error(`archiveFdp: ${error.message}`);
}

export async function searchFdps(query: string): Promise<JobDescription[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const supabase = requireServerSupabase();

  const tokens = tokenize(trimmed);
  // Si la tokenisation a tout supprimé (query 100% stopwords, ex.
  // « pour je veux »), on retombe sur l'ilike de la chaîne entière —
  // c'est le bon comportement pour une query courte type proper noun
  // (« CTO », « UX »).
  const filter =
    tokens.length === 0
      ? null
      : tokens.map((t) => `job_title.ilike.%${t}%`).join(',');

  let queryBuilder = supabase
    .from(TABLE)
    .select('*')
    .order('archived_at', { ascending: false })
    .limit(SEARCH_LIMIT);

  queryBuilder = filter
    ? queryBuilder.or(filter)
    : queryBuilder.ilike('job_title', `%${trimmed}%`);

  const { data, error } = await queryBuilder;
  if (error) throw new Error(`searchFdps: ${error.message}`);
  return (data ?? []).map(rowToJobDescription);
}
