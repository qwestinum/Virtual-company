/**
 * Types des rows Supabase (Session 5, round 1).
 *
 * Schéma hand-written plutôt qu'auto-généré : on garde le contrôle des
 * shapes JSONB (FDPInProgress, ScoringSheet, IsolatedCriteriaInProgress)
 * en référant directement aux types métier. Le mapping row↔domain vit
 * dans chaque repo (`src/lib/db/repos/*.ts`).
 */

import type { CampaignLifecycle } from '@/types/campaign-lifecycle';
import type { CampaignPrefill } from '@/types/campaign-prefill';
import type { CampaignStatus } from '@/types/campaign-status';
import type { CVApplication } from '@/types/cv-analysis';
import type { CVSource } from '@/types/cv-source';
import type { FDPInProgress } from '@/types/field-collection';
import type { HitlConfig } from '@/types/hitl';
import type { IsolatedCriteriaInProgress } from '@/types/isolated-criteria';
import type { PublicationChannel } from '@/types/publication-channel';
import type { CandidateStatus, ScoringSheet } from '@/types/scoring';
import type { VivierIndexingStatus, VivierSource } from '@/types/vivier';

export type CampaignRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  fdp: FDPInProgress;
  scoring_sheet: ScoringSheet | null;
  published_channels: PublicationChannel[];
  sources_confirmed: boolean;
  /**
   * Session 6 v3 — flux de réception des CV actifs sur cette campagne.
   * Persistant en text[] côté Postgres.
   */
  sources: CVSource[];
  /**
   * Seuil d'acceptation 0..100 utilisé par le CV Analyzer pour décider
   * `aboveThreshold`. Ajustable depuis le dashboard (Session 6).
   * Default 75 — aligné sur `DEFAULT_CV_THRESHOLD`.
   */
  threshold: number;
  /**
   * Reporting (préparation) — liens NULLABLE vers les dimensions
   * donneur d'ordre et site (cf. docs/specs/reporting.md §2). Vides pour
   * les campagnes historiques.
   */
  site_id: string | null;
  donneur_ordre_id: string | null;
  /**
   * Reporting — dates de cycle de vie (rapport de campagne). Nullable :
   * repli applicatif sur created_at / updated_at pour l'historique.
   */
  launched_at: string | null;
  closed_at: string | null;
  /**
   * Inc. 2b — machine d'états du cycle de vie PERSISTÉE (source de vérité
   * unique). Nullable : campagnes historiques sans colonne → re-dérivation
   * applicative des artefacts au chargement (`rowToCampaign`).
   */
  lifecycle: CampaignLifecycle | null;
  /**
   * Pré-remplissage à partir d'un document — résultat d'extraction capté tel
   * quel (traçabilité, évite la réextraction en V2). Nullable : null pour les
   * campagnes créées de zéro ou antérieures à la colonne.
   */
  prefill_extraction: CampaignPrefill | null;
  created_at: string;
  updated_at: string;
};

export type SiteRow = {
  id: string;
  name: string;
  type: string | null;
  city: string | null;
  postal_code: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DonneurOrdreRow = {
  id: string;
  first_name: string | null;
  last_name: string;
  email: string | null;
  role: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Reporting — une analyse CV persistée (cf. docs/specs/reporting.md §5.3,
 * table `candidate_analyses`). `application` porte le CVApplication intégral
 * (sérialisé en jsonb) ; les colonnes scalaires dénormalisées servent le
 * filtrage de la sélection audit.
 */
export type CandidateAnalysisRow = {
  id: string;
  /** Clé de corrélation avec les marqueurs de parcours du journal. Nullable (rows antérieures à la colonne). */
  uid: string | null;
  campaign_id: string | null;
  candidate_name: string;
  candidate_email: string | null;
  file_name: string;
  source: CVSource;
  received_at: string;
  total_score: number;
  status: CandidateStatus;
  criteria_version: string;
  computed_at: string;
  application: CVApplication;
  /** Snapshot des toggles HITL au moment de l'analyse. Null = rows historiques. */
  hitl_config: HitlConfig | null;
  created_at: string;
};

export type FdpArchivedRow = {
  campaign_id: string;
  job_title: string;
  seniority: string | null;
  contract_type: string | null;
  location: string | null;
  fdp: FDPInProgress;
  archived_at: string;
};

export type ScoringSheetArchivedRow = {
  id: number;
  campaign_id: string;
  sheet: ScoringSheet;
  archived_at: string;
};

export type TaskRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  criteria: IsolatedCriteriaInProgress;
  created_at: string;
  updated_at: string;
};

export type JournalRow = {
  id: number;
  campaign_id: string | null;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
};

/**
 * Métadonnées d'un artefact (Session 5 round 2). Le contenu est dans
 * Supabase Storage (bucket 'artifacts'), les métadonnées sont dans la
 * table `artifacts_meta`. En mode dégradé (échec d'upload Storage),
 * les champs storage_* sont null — l'artefact existe comme trace.
 */
export type ArtifactKind =
  | 'fdp'
  | 'job_ad'
  | 'cv_report'
  | 'scoring_sheet'
  | 'campaign_report'
  | 'other';

export type ArtifactMetaRow = {
  id: string;
  campaign_id: string | null;
  task_id: string | null;
  kind: ArtifactKind;
  name: string;
  mime: string;
  storage_bucket: string | null;
  storage_path: string | null;
  public_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

/**
 * Vivier de candidats (Session V1, cf. docs/specs/vivier.md). Le dossier
 * d'identité (stable) ; l'embedding et les entités vivent dans des tables
 * 1-1 séparées (régénérées à chaque réindexation). `email` est la clé de
 * déduplication (normalisée lowercase+trim côté application).
 */
export type VivierCandidateRow = {
  id: string;
  email: string;
  nom: string;
  prenom: string | null;
  telephone: string | null;
  cv_path: string | null;
  cv_file_name: string | null;
  cv_text: string | null;
  title: string | null;
  title_variants: string[];
  tags: string[];
  source: VivierSource;
  indexing_status: VivierIndexingStatus;
  indexing_error: string | null;
  entered_at: string;
  updated_at: string;
};

/**
 * Index sémantique d'un dossier (1-1, cascade). `provider`/`model` stockés
 * avec le vecteur : deux fournisseurs produisent des espaces NON comparables
 * → une bascule impose une réindexation complète (cf. spec §3.4). Le vecteur
 * pgvector n'est pas relu côté application en V1 (la recherche arrive en V2),
 * d'où l'absence de la colonne `embedding` dans ce type de lecture.
 */
export type VivierEmbeddingRow = {
  candidate_id: string;
  provider: string;
  model: string;
  generated_at: string;
};

/** Entités structurées d'un dossier (1-1, cascade, régénérables). */
export type VivierEntitiesRow = {
  candidate_id: string;
  technologies: string[];
  certifications: string[];
  diplomes: string[];
  secteurs: string[];
  langues: string[];
  experience_years: number | null;
  localisation: string | null;
  extracted_at: string;
};

/**
 * Short-list de présélection persistée (Session V2, cf. docs/specs/vivier.md §4).
 * PK composite (campaign_id, candidate_id). `state` porte le cycle factuel
 * (identified/contacted/rejected) ; `passed_filters` est un JSONB de
 * `HardFilterMatch[]` (cf. src/types/vivier-preselection.ts).
 */
export type VivierPreselectionRow = {
  campaign_id: string;
  candidate_id: string;
  state: 'identified' | 'contacted' | 'rejected';
  similarity: number;
  freshness_factor: number;
  relevance_score: number;
  passed_filters: unknown;
  rank: number;
  generated_at: string;
  /** Origine du match (refonte titre) : 'title_exact' | 'title_semantic'. */
  match_kind: string | null;
  /** Terme/variante matché (bloc 1 déterministe). */
  match_term: string | null;
  /** Faits datés du cycle (Session V3, §6) — nullable tant qu'ils ne sont pas posés. */
  contacted_at: string | null;
  rejected_at: string | null;
  decided_by: string | null;
  applied_at: string | null;
};
