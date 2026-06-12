/**
 * Repo Supabase — Vivier de candidats (Session V1, docs/specs/vivier.md).
 *
 * Trois tables : le dossier (`vivier_candidates`, identité stable), l'index
 * sémantique (`vivier_embeddings`) et les entités structurées
 * (`vivier_entities`). Les deux dernières sont en 1-1 `on delete cascade` :
 * supprimer le dossier purge l'index et les entités côté base (la suppression
 * du fichier Storage est orchestrée par `src/lib/vivier/candidates.ts`).
 *
 * Le vecteur pgvector n'est PAS relu côté application en V1 (la recherche
 * arrive en V2) : à l'écriture, on sérialise le tableau au format littéral
 * pgvector (`[v1,v2,…]`).
 */

import { requireServerSupabase } from '@/lib/db/supabase-server';
import { sanitizePostgrestSearch } from '@/lib/db/sanitize-search';
import type {
  VivierCandidateRow,
  VivierEmbeddingRow,
  VivierEntitiesRow,
} from '@/lib/db/types';
import {
  EMPTY_VIVIER_ENTITIES,
  type VivierCandidate,
  type VivierEntities,
  type VivierIndexingStatus,
  type VivierSource,
} from '@/types/vivier';

const TABLE = 'vivier_candidates';
const EMBEDDINGS_TABLE = 'vivier_embeddings';
const ENTITIES_TABLE = 'vivier_entities';

/** Colonnes de résumé (sans le volumineux `cv_text`). */
const SUMMARY_COLUMNS =
  'id, email, nom, prenom, telephone, cv_path, cv_file_name, title, title_variants, tags, source, indexing_status, indexing_error, entered_at, updated_at';

/** Mapping row → domaine (pur, exporté pour test). Tolère l'absence de cv_text (résumés). */
export function vivierRowToDomain(
  row: Partial<VivierCandidateRow> & Omit<VivierCandidateRow, 'cv_text'>,
): VivierCandidate {
  return {
    id: row.id,
    email: row.email,
    nom: row.nom,
    prenom: row.prenom,
    telephone: row.telephone,
    cvPath: row.cv_path,
    cvFileName: row.cv_file_name ?? null,
    cvText: row.cv_text ?? null,
    title: row.title ?? null,
    titleVariants: row.title_variants ?? [],
    tags: row.tags ?? [],
    source: row.source,
    indexingStatus: row.indexing_status,
    indexingError: row.indexing_error,
    enteredAt: row.entered_at,
    updatedAt: row.updated_at,
  };
}

/** Mapping row entités → domaine (pur, exporté pour test). */
export function vivierEntitiesRowToDomain(row: VivierEntitiesRow): VivierEntities {
  return {
    technologies: row.technologies ?? [],
    certifications: row.certifications ?? [],
    diplomes: row.diplomes ?? [],
    secteurs: row.secteurs ?? [],
    langues: row.langues ?? [],
    experienceYears: row.experience_years,
    localisation: row.localisation,
  };
}

/**
 * Sérialise un vecteur au format littéral pgvector (`[0.1,0.2,…]`). Exporté
 * pour test. PostgREST insère cette chaîne directement dans une colonne vector.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

export async function getVivierCandidate(
  id: string,
): Promise<VivierCandidate | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getVivierCandidate: ${error.message}`);
  return data ? vivierRowToDomain(data as VivierCandidateRow) : null;
}

/** Résout un dossier par email (déjà normalisé par l'appelant). Clé de dédup. */
export async function getVivierCandidateByEmail(
  email: string,
): Promise<VivierCandidate | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (error) throw new Error(`getVivierCandidateByEmail: ${error.message}`);
  return data ? vivierRowToDomain(data as VivierCandidateRow) : null;
}

export type ListVivierFilters = {
  search?: string;
  status?: VivierIndexingStatus;
  limit?: number;
  offset?: number;
};

export type ListVivierResult = {
  items: VivierCandidate[];
  total: number;
};

export async function listVivierCandidates(
  filters: ListVivierFilters = {},
): Promise<ListVivierResult> {
  const supabase = requireServerSupabase();
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  let q = supabase
    .from(TABLE)
    .select(SUMMARY_COLUMNS, { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.status) q = q.eq('indexing_status', filters.status);
  const search = filters.search ? sanitizePostgrestSearch(filters.search) : '';
  if (search) {
    q = q.or(`nom.ilike.*${search}*,email.ilike.*${search}*`);
  }

  const { data, error, count } = await q;
  if (error) throw new Error(`listVivierCandidates: ${error.message}`);
  return {
    items: (data ?? []).map((r) =>
      vivierRowToDomain(r as Omit<VivierCandidateRow, 'cv_text'>),
    ),
    total: count ?? 0,
  };
}

/** Dossier + entités jointes (vue détail). */
export async function getVivierEntities(
  candidateId: string,
): Promise<VivierEntities | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(ENTITIES_TABLE)
    .select('*')
    .eq('candidate_id', candidateId)
    .maybeSingle();
  if (error) throw new Error(`getVivierEntities: ${error.message}`);
  return data ? vivierEntitiesRowToDomain(data as VivierEntitiesRow) : null;
}

export type InsertVivierCandidateInput = {
  email: string;
  nom: string;
  prenom: string | null;
  telephone: string | null;
  cvPath: string | null;
  cvFileName: string | null;
  cvText: string | null;
  source: VivierSource;
  tags?: string[];
};

/**
 * Insère un nouveau dossier. L'`id` (uuid) est généré PAR LA BASE
 * (`gen_random_uuid()`) — jamais fourni par l'application : aucune collision de
 * PK possible. À la création, `cv_path` est null (le chemin Storage dérive de
 * l'id, donc connu seulement APRÈS l'insert — cf. `setVivierCandidateCvPath`).
 */
export async function insertVivierCandidate(
  input: InsertVivierCandidateInput,
): Promise<VivierCandidate> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      email: input.email,
      nom: input.nom,
      prenom: input.prenom,
      telephone: input.telephone,
      cv_path: input.cvPath,
      cv_file_name: input.cvFileName,
      cv_text: input.cvText,
      source: input.source,
      tags: input.tags ?? [],
      indexing_status: 'pending',
      indexing_error: null,
    })
    .select('*')
    .single();
  if (error) throw new Error(`insertVivierCandidate: ${error.message}`);
  return vivierRowToDomain(data as VivierCandidateRow);
}

export type UpdateVivierCVInput = {
  nom: string;
  prenom: string | null;
  telephone: string | null;
  cvPath: string | null;
  cvFileName: string | null;
  cvText: string | null;
};

/**
 * Met à jour le dossier sur remplacement de CV (déduplication par email). Le
 * statut repasse à `pending` (réindexation requise) et l'erreur est purgée.
 */
export async function updateVivierCandidateCV(
  id: string,
  patch: UpdateVivierCVInput,
): Promise<VivierCandidate | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      nom: patch.nom,
      prenom: patch.prenom,
      telephone: patch.telephone,
      cv_path: patch.cvPath,
      cv_file_name: patch.cvFileName,
      cv_text: patch.cvText,
      indexing_status: 'pending',
      indexing_error: null,
    })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`updateVivierCandidateCV: ${error.message}`);
  return data ? vivierRowToDomain(data as VivierCandidateRow) : null;
}

/**
 * Renseigne le chemin Storage du CV d'un dossier fraîchement créé. Le chemin
 * dérive de l'id (uuid) généré par la base : il n'est connu qu'APRÈS l'insert.
 * Ne touche pas au statut (le dossier reste `pending`, prêt pour l'indexation).
 */
export async function setVivierCandidateCvPath(
  id: string,
  cvPath: string,
): Promise<VivierCandidate | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ cv_path: cvPath })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`setVivierCandidateCvPath: ${error.message}`);
  return data ? vivierRowToDomain(data as VivierCandidateRow) : null;
}

export async function setVivierIndexingStatus(
  id: string,
  status: VivierIndexingStatus,
  error: string | null = null,
): Promise<void> {
  const supabase = requireServerSupabase();
  const { error: dbError } = await supabase
    .from(TABLE)
    .update({ indexing_status: status, indexing_error: error })
    .eq('id', id);
  if (dbError) throw new Error(`setVivierIndexingStatus: ${dbError.message}`);
}

export async function updateVivierTags(
  id: string,
  tags: string[],
): Promise<VivierCandidate | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ tags })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`updateVivierTags: ${error.message}`);
  return data ? vivierRowToDomain(data as VivierCandidateRow) : null;
}

/**
 * Supprime le dossier en base. Le `on delete cascade` purge l'embedding et les
 * entités dans la même opération. (Le fichier Storage est supprimé en amont par
 * `deleteVivierCandidate` côté service.)
 */
export async function deleteVivierCandidateRow(id: string): Promise<void> {
  const supabase = requireServerSupabase();
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw new Error(`deleteVivierCandidateRow: ${error.message}`);
}

/**
 * Pose le TITRE et ses variantes sur le dossier (extraction d'indexation).
 * Présélection sur le titre. Variantes vides tolérées.
 */
export async function setVivierTitle(
  id: string,
  title: string | null,
  variants: string[],
): Promise<void> {
  const supabase = requireServerSupabase();
  const { error } = await supabase
    .from(TABLE)
    .update({ title, title_variants: variants })
    .eq('id', id);
  if (error) throw new Error(`setVivierTitle: ${error.message}`);
}

export type UpsertVivierEmbeddingInput = {
  vector: number[];
  provider: string;
  model: string;
};

/**
 * Upsert de l'embedding du TITRE (présélection bloc 2). Ne TOUCHE PAS la colonne
 * `embedding` (full-CV legacy, préservée) : on ne fournit que les colonnes titre
 * + provider/model (qui décrivent désormais l'embedding titre, pour le garde-fou
 * d'espace). `provider`/`model` sont ceux du TITRE.
 */
export async function upsertVivierTitleEmbedding(
  candidateId: string,
  input: UpsertVivierEmbeddingInput,
): Promise<void> {
  const supabase = requireServerSupabase();
  const { error } = await supabase.from(EMBEDDINGS_TABLE).upsert(
    {
      candidate_id: candidateId,
      title_embedding: toVectorLiteral(input.vector),
      provider: input.provider,
      model: input.model,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'candidate_id' },
  );
  if (error) throw new Error(`upsertVivierTitleEmbedding: ${error.message}`);
}

export async function upsertVivierEmbedding(
  candidateId: string,
  input: UpsertVivierEmbeddingInput,
): Promise<void> {
  const supabase = requireServerSupabase();
  const { error } = await supabase.from(EMBEDDINGS_TABLE).upsert(
    {
      candidate_id: candidateId,
      embedding: toVectorLiteral(input.vector),
      provider: input.provider,
      model: input.model,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'candidate_id' },
  );
  if (error) throw new Error(`upsertVivierEmbedding: ${error.message}`);
}

export async function upsertVivierEntities(
  candidateId: string,
  entities: VivierEntities,
): Promise<void> {
  const supabase = requireServerSupabase();
  const { error } = await supabase.from(ENTITIES_TABLE).upsert(
    {
      candidate_id: candidateId,
      technologies: entities.technologies,
      certifications: entities.certifications,
      diplomes: entities.diplomes,
      secteurs: entities.secteurs,
      langues: entities.langues,
      experience_years: entities.experienceYears,
      localisation: entities.localisation,
      extracted_at: new Date().toISOString(),
    },
    { onConflict: 'candidate_id' },
  );
  if (error) throw new Error(`upsertVivierEntities: ${error.message}`);
}

/**
 * Couples (provider|model) DISTINCTS présents dans les embeddings indexés.
 * Sert à détecter une incohérence d'espace vectoriel : si le modèle de la
 * requête ne correspond pas à celui des dossiers, le cosinus est dénué de sens
 * (résultats au hasard). Renvoie p.ex. `["openai|text-embedding-3-small"]`.
 */
export async function listDistinctEmbeddingModels(): Promise<string[]> {
  const supabase = requireServerSupabase();
  // Refonte titre : l'espace vérifié est celui des embeddings de TITRE (le seul
  // utilisé par la présélection). On ignore les lignes full-CV legacy.
  const { data, error } = await supabase
    .from(EMBEDDINGS_TABLE)
    .select('provider, model')
    .not('title_embedding', 'is', null);
  if (error) throw new Error(`listDistinctEmbeddingModels: ${error.message}`);
  const set = new Set<string>();
  for (const r of (data ?? []) as { provider: string; model: string }[]) {
    set.add(`${r.provider}|${r.model}`);
  }
  return [...set];
}

/** Un dossier INDEXÉ avec son TITRE + variantes + fraîcheur (présélection titre). */
export type IndexedVivierTitle = {
  id: string;
  nom: string;
  email: string;
  updatedAt: string;
  title: string | null;
  titleVariants: string[];
};

/**
 * Liste les dossiers INDEXÉS avec titre/variantes/fraîcheur — base de la
 * présélection titre (bloc 1 déterministe ; le bloc 2 passe les survivants à
 * `matchVivierTitles`). pending/failed exclus.
 */
export async function listIndexedVivierTitles(): Promise<IndexedVivierTitle[]> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, nom, email, updated_at, title, title_variants')
    .eq('indexing_status', 'indexed');
  if (error) throw new Error(`listIndexedVivierTitles: ${error.message}`);
  return ((data ?? []) as {
    id: string;
    nom: string;
    email: string;
    updated_at: string;
    title: string | null;
    title_variants: string[] | null;
  }[]).map((r) => ({
    id: r.id,
    nom: r.nom,
    email: r.email,
    updatedAt: r.updated_at,
    title: r.title ?? null,
    titleVariants: r.title_variants ?? [],
  }));
}

/**
 * Tri titre-à-titre (bloc 2) : similarité cosinus entre l'embedding de
 * l'intitulé du poste et les embeddings de TITRE des candidats `candidateIds`.
 * RPC `match_vivier_titles`. Map candidateId → similarité.
 */
export async function matchVivierTitles(
  queryEmbedding: number[],
  candidateIds: string[],
): Promise<Map<string, number>> {
  if (candidateIds.length === 0) return new Map();
  const supabase = requireServerSupabase();
  const { data, error } = await supabase.rpc('match_vivier_titles', {
    query_embedding: toVectorLiteral(queryEmbedding),
    candidate_ids: candidateIds,
  });
  if (error) throw new Error(`matchVivierTitles: ${error.message}`);
  const map = new Map<string, number>();
  for (const row of (data ?? []) as {
    candidate_id: string;
    similarity: number;
  }[]) {
    map.set(row.candidate_id, row.similarity);
  }
  return map;
}

/** Métadonnées (provider/model) de l'embedding — détection d'incohérence au reindex. */
export async function getVivierEmbeddingMeta(
  candidateId: string,
): Promise<VivierEmbeddingRow | null> {
  const supabase = requireServerSupabase();
  const { data, error } = await supabase
    .from(EMBEDDINGS_TABLE)
    .select('candidate_id, provider, model, generated_at')
    .eq('candidate_id', candidateId)
    .maybeSingle();
  if (error) throw new Error(`getVivierEmbeddingMeta: ${error.message}`);
  return data ? (data as VivierEmbeddingRow) : null;
}

/**
 * Un dossier INDEXÉ avec ses entités + sa fraîcheur — entrée de la présélection
 * V2 (filtres durs sur entités + modulation par `updatedAt`).
 */
export type IndexedVivierCandidate = {
  id: string;
  nom: string;
  email: string;
  updatedAt: string;
  entities: VivierEntities;
};

/**
 * Liste les dossiers INDEXÉS (pending/failed exclus — §3.2/4.2) avec leurs
 * entités structurées et leur date de mise à jour. Base des étapes 1 (filtres
 * durs) et 3 (fraîcheur) de la présélection. Deux requêtes + jointure en
 * mémoire (échelle prototype). Tout dossier indexé a une ligne d'entités
 * (l'indexation upsert toujours, même vides) ; repli `EMPTY_VIVIER_ENTITIES`.
 */
export async function listIndexedVivierEntities(): Promise<
  IndexedVivierCandidate[]
> {
  const supabase = requireServerSupabase();
  const { data: cands, error } = await supabase
    .from(TABLE)
    .select('id, nom, email, updated_at')
    .eq('indexing_status', 'indexed');
  if (error) throw new Error(`listIndexedVivierEntities: ${error.message}`);
  const rows = (cands ?? []) as {
    id: string;
    nom: string;
    email: string;
    updated_at: string;
  }[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const { data: ents, error: entErr } = await supabase
    .from(ENTITIES_TABLE)
    .select('*')
    .in('candidate_id', ids);
  if (entErr)
    throw new Error(`listIndexedVivierEntities(entités): ${entErr.message}`);
  const byId = new Map<string, VivierEntities>();
  for (const e of (ents ?? []) as VivierEntitiesRow[]) {
    byId.set(e.candidate_id, vivierEntitiesRowToDomain(e));
  }

  return rows.map((r) => ({
    id: r.id,
    nom: r.nom,
    email: r.email,
    updatedAt: r.updated_at,
    entities: byId.get(r.id) ?? { ...EMPTY_VIVIER_ENTITIES },
  }));
}

/**
 * Tri sémantique (étape 2) : similarité cosinus entre l'embedding de requête et
 * les dossiers indexés du sous-ensemble `candidateIds` (survivants des filtres
 * durs). Délègue à la RPC pgvector `match_vivier_candidates`. Renvoie une map
 * candidateId → similarité (0..1). Vide si aucun survivant.
 */
export async function matchVivierCandidates(
  queryEmbedding: number[],
  candidateIds: string[],
): Promise<Map<string, number>> {
  if (candidateIds.length === 0) return new Map();
  const supabase = requireServerSupabase();
  const { data, error } = await supabase.rpc('match_vivier_candidates', {
    // Littéral pgvector : PostgREST coerce text → vector(1536).
    query_embedding: toVectorLiteral(queryEmbedding),
    candidate_ids: candidateIds,
  });
  if (error) throw new Error(`matchVivierCandidates: ${error.message}`);
  const map = new Map<string, number>();
  for (const row of (data ?? []) as {
    candidate_id: string;
    similarity: number;
  }[]) {
    map.set(row.candidate_id, row.similarity);
  }
  return map;
}

/** Liste tous les ids du vivier (script de réindexation). Optionnel : statut. */
export async function listVivierCandidateIds(filters?: {
  status?: VivierIndexingStatus;
}): Promise<string[]> {
  const supabase = requireServerSupabase();
  let q = supabase.from(TABLE).select('id').order('entered_at', {
    ascending: true,
  });
  if (filters?.status) q = q.eq('indexing_status', filters.status);
  const { data, error } = await q;
  if (error) throw new Error(`listVivierCandidateIds: ${error.message}`);
  return (data ?? []).map((r) => (r as { id: string }).id);
}
