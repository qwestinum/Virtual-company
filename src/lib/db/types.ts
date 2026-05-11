/**
 * Types des rows Supabase (Session 5, round 1).
 *
 * Schéma hand-written plutôt qu'auto-généré : on garde le contrôle des
 * shapes JSONB (FDPInProgress, ScoringSheet, IsolatedCriteriaInProgress)
 * en référant directement aux types métier. Le mapping row↔domain vit
 * dans chaque repo (`src/lib/db/repos/*.ts`).
 */

import type { CampaignStatus } from '@/types/campaign-status';
import type { FDPInProgress } from '@/types/field-collection';
import type { IsolatedCriteriaInProgress } from '@/types/isolated-criteria';
import type { PublicationChannel } from '@/types/publication-channel';
import type { ScoringSheet } from '@/types/scoring';

export type CampaignRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  fdp: FDPInProgress;
  scoring_sheet: ScoringSheet | null;
  published_channels: PublicationChannel[];
  sources_confirmed: boolean;
  created_at: string;
  updated_at: string;
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
