-- Virtual Enterprise — schéma Supabase (Session 5, round 1)
--
-- Ce fichier est idempotent : il peut être ré-exécuté sans casse. À
-- coller dans le SQL editor d'un projet Supabase fraîchement créé.
--
-- Périmètre round 1 : campaigns + fdps_archived + scoring_sheets_archived
-- + tasks_archived + journal. Pas de RLS (mono-utilisateur MVP) — la
-- service_role_key reste côté serveur, le client passe par les API
-- routes Next.

-- pg_trgm sert pour la recherche fuzzy sur job_title (pré-recherche L1).
create extension if not exists pg_trgm;

-- ──────────────────────────────────────────────────────────────────────
-- Campagnes (CAMP-XXXX)
-- ──────────────────────────────────────────────────────────────────────

create table if not exists public.campaigns (
  id                  text primary key,
  name                text not null,
  status              text not null check (status in ('draft','in_progress','active','paused','closed')),
  fdp                 jsonb not null,
  scoring_sheet       jsonb,
  published_channels  text[] not null default '{}',
  sources_confirmed   boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists campaigns_updated_at_idx
  on public.campaigns (updated_at desc);

create index if not exists campaigns_status_idx
  on public.campaigns (status);

-- ──────────────────────────────────────────────────────────────────────
-- FDPs archivées — index recherchable pour la pré-recherche L1
-- ──────────────────────────────────────────────────────────────────────
-- Une ligne par FDP validée. La source de vérité reste campaigns.fdp ;
-- cette table sert uniquement à l'index trigram sur job_title.

create table if not exists public.fdps_archived (
  campaign_id    text primary key references public.campaigns(id) on delete cascade,
  job_title      text not null,
  seniority      text,
  contract_type  text,
  location       text,
  fdp            jsonb not null,
  archived_at    timestamptz not null default now()
);

create index if not exists fdps_archived_job_title_trgm_idx
  on public.fdps_archived using gin (job_title gin_trgm_ops);

create index if not exists fdps_archived_archived_at_idx
  on public.fdps_archived (archived_at desc);

-- ──────────────────────────────────────────────────────────────────────
-- Fiches de scoring archivées (historique au moment de la validation)
-- ──────────────────────────────────────────────────────────────────────
-- Le snapshot principal vit dans campaigns.scoring_sheet. Cette table
-- garde l'historique des validations successives — utile pour audit.

create table if not exists public.scoring_sheets_archived (
  id           bigserial primary key,
  campaign_id  text not null references public.campaigns(id) on delete cascade,
  sheet        jsonb not null,
  archived_at  timestamptz not null default now()
);

create index if not exists scoring_sheets_archived_campaign_idx
  on public.scoring_sheets_archived (campaign_id, archived_at desc);

-- ──────────────────────────────────────────────────────────────────────
-- Tâches isolées (TASK-XXXX)
-- ──────────────────────────────────────────────────────────────────────

create table if not exists public.tasks_archived (
  id          text primary key,
  name        text not null,
  status      text not null check (status in ('draft','in_progress','active','paused','closed')),
  criteria    jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tasks_archived_updated_at_idx
  on public.tasks_archived (updated_at desc);

-- ──────────────────────────────────────────────────────────────────────
-- Journal — audit des actions directes UI (spec §6.3)
-- ──────────────────────────────────────────────────────────────────────

create table if not exists public.journal (
  id           bigserial primary key,
  campaign_id  text,
  actor        text not null default 'user',
  action       text not null,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists journal_created_at_idx
  on public.journal (created_at desc);

create index if not exists journal_campaign_idx
  on public.journal (campaign_id, created_at desc);

-- ──────────────────────────────────────────────────────────────────────
-- Trigger updated_at pour campaigns + tasks_archived
-- ──────────────────────────────────────────────────────────────────────

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists campaigns_touch_updated_at on public.campaigns;
create trigger campaigns_touch_updated_at
  before update on public.campaigns
  for each row execute function public.touch_updated_at();

drop trigger if exists tasks_archived_touch_updated_at on public.tasks_archived;
create trigger tasks_archived_touch_updated_at
  before update on public.tasks_archived
  for each row execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- Session 5 round 2 — Artefacts (Supabase Storage)
-- ──────────────────────────────────────────────────────────────────────
-- On utilise Supabase Storage plutôt que Google Drive : les service
-- accounts Google n'ont pas de quota de stockage et nécessitent un
-- Shared Drive (Workspace). Le bucket 'artifacts' est public en lecture
-- (URL cliquable côté client), les writes passent par les API routes
-- server avec la service_role_key.
--
-- Si tu reviens d'un migrate qui avait des colonnes drive_*, les ALTER
-- ci-dessous nettoient. Tout est idempotent.

-- Cleanup des colonnes drive_* obsolètes (round 2 v1).
alter table public.campaigns      drop column if exists drive_folder_id;
alter table public.tasks_archived drop column if exists drive_folder_id;

-- Bucket de stockage. Public pour la démo (URLs cliquables). Pour le
-- multi-utilisateur, on basculera plus tard sur des signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artifacts',
  'artifacts',
  true,
  10485760, -- 10 MB
  array[
    'text/markdown',
    'text/plain',
    'application/pdf',
    'application/json',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Métadonnées des artefacts. Un artefact appartient soit à une
-- campagne, soit à une tâche (XOR). storage_* nullable = mode dégradé
-- si l'upload Storage échoue (la trace métadonnée reste).
create table if not exists public.artifacts_meta (
  id               text primary key,
  campaign_id      text references public.campaigns(id) on delete cascade,
  task_id          text references public.tasks_archived(id) on delete cascade,
  kind             text not null check (kind in ('fdp','job_ad','cv_report','scoring_sheet','other')),
  name             text not null,
  mime             text not null default 'text/markdown',
  storage_bucket   text,
  storage_path     text,
  public_url       text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  constraint artifacts_meta_owner_xor check (
    (campaign_id is not null and task_id is null) or
    (campaign_id is null and task_id is not null)
  )
);

-- Si la table existait déjà avec les anciennes colonnes drive_*, on
-- les renomme proprement (idempotent grâce au DO block).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'artifacts_meta' and column_name = 'drive_file_id'
  ) then
    alter table public.artifacts_meta rename column drive_file_id to storage_path;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'artifacts_meta' and column_name = 'drive_url'
  ) then
    alter table public.artifacts_meta rename column drive_url to public_url;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'artifacts_meta' and column_name = 'drive_folder_id'
  ) then
    alter table public.artifacts_meta drop column drive_folder_id;
  end if;
end$$;

-- S'assure que storage_bucket existe (idempotent).
alter table public.artifacts_meta
  add column if not exists storage_bucket text;

create index if not exists artifacts_meta_campaign_idx
  on public.artifacts_meta (campaign_id, created_at desc);

create index if not exists artifacts_meta_task_idx
  on public.artifacts_meta (task_id, created_at desc);

create index if not exists artifacts_meta_kind_idx
  on public.artifacts_meta (kind, created_at desc);

-- ──────────────────────────────────────────────────────────────────────
-- Session 5 round 5 — Flux email IMAP (réception auto de CV)
-- ──────────────────────────────────────────────────────────────────────
-- Boîtes mail surveillées par un poller IMAP côté serveur (intervalle
-- 30s). Les credentials sont chiffrés application-level via AES-256-GCM
-- avec MAILBOX_ENCRYPTION_KEY côté env. Le ciphertext est stocké en
-- base64 dans encrypted_password : sans la master key, impossible de
-- déchiffrer même avec accès Supabase.

create table if not exists public.mailboxes (
  id                  text primary key,
  label               text not null,
  imap_host           text not null,
  imap_port           int  not null,
  imap_ssl            boolean not null default true,
  user_email          text not null,
  encrypted_password  text not null,
  is_enabled          boolean not null default true,
  last_polled_at      timestamptz,
  last_uid_seen       text,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists mailboxes_is_enabled_idx
  on public.mailboxes (is_enabled);

drop trigger if exists mailboxes_touch_updated_at on public.mailboxes;
create trigger mailboxes_touch_updated_at
  before update on public.mailboxes
  for each row execute function public.touch_updated_at();

-- Many-to-many : une boîte peut servir plusieurs campagnes (tri par
-- objet du mail = campaignId), et une campagne peut écouter plusieurs
-- boîtes.
create table if not exists public.campaign_mailboxes (
  campaign_id    text references public.campaigns(id) on delete cascade,
  mailbox_id     text references public.mailboxes(id) on delete cascade,
  associated_at  timestamptz not null default now(),
  primary key (campaign_id, mailbox_id)
);

create index if not exists campaign_mailboxes_mailbox_idx
  on public.campaign_mailboxes (mailbox_id);

-- ──────────────────────────────────────────────────────────────────────
-- Session 6 — Seuil d'acceptation par campagne (édition dashboard)
-- ──────────────────────────────────────────────────────────────────────
-- Slider 0..100 ajustable depuis le dashboard. Le CV Analyzer relit
-- cette valeur (ou retombe sur DEFAULT_CV_THRESHOLD=75) pour décider
-- aboveThreshold sur les prochaines candidatures. Pas de recompute
-- rétroactif en Session 6 — c'est explicite côté DRH dans la prise
-- d'acte du Manager.
alter table public.campaigns
  add column if not exists threshold int not null default 75
  check (threshold between 0 and 100);

-- ──────────────────────────────────────────────────────────────────────
-- Session 6 v3 — Flux de réception des CV par campagne
-- ──────────────────────────────────────────────────────────────────────
-- Distinct de published_channels (où l'annonce est diffusée). Un flux
-- = un canal d'arrivée des CV (manual, email, scrape LinkedIn…). Le
-- bloc Flux du sheet d'édition campagne pousse cette liste.
alter table public.campaigns
  add column if not exists sources text[] not null default array['manual']::text[];

-- ──────────────────────────────────────────────────────────────────────
-- Session 6 v4 — Settings applicatifs (single-row)
-- ──────────────────────────────────────────────────────────────────────
-- Table single-row pour les réglages globaux configurables depuis
-- /settings : adresses email (synthèse, expéditeur), credentials des
-- intégrations flux et canaux. Le check id=1 garantit qu'il n'y a
-- qu'une seule ligne. Les credentials sont volontairement en clair
-- (jsonb) pour le MVP démo — un cycle ultérieur basculera sur le
-- chiffrement application-level (cf. mailbox-credentials.ts).

create table if not exists public.app_settings (
  id                int primary key default 1 check (id = 1),
  synthesis_email   text,
  sender_email      text,
  intake_email      text,
  flux_config       jsonb not null default '{}'::jsonb,
  channels_config   jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now()
);

-- Seed de la ligne unique si absente.
insert into public.app_settings (id) values (1)
  on conflict (id) do nothing;

drop trigger if exists app_settings_touch_updated_at on public.app_settings;
create trigger app_settings_touch_updated_at
  before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- Multi-adresses synthèse et expéditeur (Session 6 v5).
-- Le DRH peut enregistrer plusieurs adresses et choisir laquelle est
-- l'adresse par défaut (synthesis_email / sender_email).
alter table public.app_settings
  add column if not exists synthesis_emails text[] not null default '{}'::text[],
  add column if not exists sender_emails text[] not null default '{}'::text[];

-- Migration de données (v6) — rapatrie les adresses singulières
-- préexistantes dans les listes pour qu'elles soient visibles dans
-- l'UI. Idempotent — re-exécutable sans casse.
update public.app_settings
set sender_emails = array[sender_email]
where sender_email is not null
  and (sender_emails is null or coalesce(array_length(sender_emails, 1), 0) = 0);

update public.app_settings
set synthesis_emails = array[synthesis_email]
where synthesis_email is not null
  and (synthesis_emails is null or coalesce(array_length(synthesis_emails, 1), 0) = 0);

-- ──────────────────────────────────────────────────────────────────────
-- HITL — Validation suspendue (refus / acceptation candidats)
-- Spec : docs/specs/hitl-validation-suspendue.md
-- ──────────────────────────────────────────────────────────────────────

-- Config HITL par section (un toggle par décision gateable). Défaut ON
-- (un DRH ne laisse pas l'IA mailer ses candidats sans contrôle au départ).
-- Inerte tant que le gating (P3) ne lit pas cette colonne.
alter table public.app_settings
  add column if not exists hitl_config jsonb not null
    default '{"rejectionMail": true, "acceptanceMail": true}'::jsonb;

-- File des validations en attente. Persistée pour survivre au refresh /
-- changement de session (on traite les validations en différé).
create table if not exists public.pending_validations (
  id                     text primary key,
  campaign_id            text not null,
  candidate_name         text not null,
  candidate_email        text,
  score                  int,
  decision               text not null check (decision in ('accept', 'reject')),
  cv_artifact_id         text,
  report_artifact_id     text,
  mail_draft_artifact_id text,
  confirmed              boolean not null default false,
  status                 text not null default 'pending'
                           check (status in ('pending', 'sent')),
  payload                jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  decided_at             timestamptz
);

create index if not exists pending_validations_status_idx
  on public.pending_validations (status);
create index if not exists pending_validations_campaign_idx
  on public.pending_validations (campaign_id);

drop trigger if exists pending_validations_touch_updated_at on public.pending_validations;
create trigger pending_validations_touch_updated_at
  before update on public.pending_validations
  for each row execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- Reporting (préparation) — donneur d'ordre & site
-- ──────────────────────────────────────────────────────────────────────
-- Deux dimensions consommées par le module Reporting (cf.
-- docs/specs/reporting.md §2). Liens NULLABLE sur campaigns : capture au
-- brief (Temps 1) ou via /settings ; vides pour les campagnes historiques.
-- Tables créées AVANT l'alter des FK (ordre top-to-bottom du fichier).
-- Soft-archive via archived_at. RLS non posée (cohérent avec les autres
-- tables — accès serveur via service role, MVP mono-utilisateur).

create table if not exists public.sites (
  id           text primary key,
  name         text not null,
  type         text,
  city         text,
  postal_code  text,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists sites_archived_at_idx
  on public.sites (archived_at);

drop trigger if exists sites_touch_updated_at on public.sites;
create trigger sites_touch_updated_at
  before update on public.sites
  for each row execute function public.touch_updated_at();

create table if not exists public.donneurs_ordre (
  id           text primary key,
  first_name   text,
  last_name    text not null,
  email        text,
  role         text,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists donneurs_ordre_archived_at_idx
  on public.donneurs_ordre (archived_at);

drop trigger if exists donneurs_ordre_touch_updated_at on public.donneurs_ordre;
create trigger donneurs_ordre_touch_updated_at
  before update on public.donneurs_ordre
  for each row execute function public.touch_updated_at();

-- Liens nullable sur campaigns. ON DELETE SET NULL : supprimer un site /
-- donneur d'ordre détache la campagne (jamais de cascade sur les campagnes).
alter table public.campaigns
  add column if not exists site_id text references public.sites(id) on delete set null;
alter table public.campaigns
  add column if not exists donneur_ordre_id text references public.donneurs_ordre(id) on delete set null;

-- Site « par défaut » pour les organisations mono-site (rattachement sans
-- friction). Idempotent.
insert into public.sites (id, name, type)
  values ('SITE-DEFAULT', 'Site par défaut', 'Par défaut')
  on conflict (id) do nothing;

-- ──────────────────────────────────────────────────────────────────────
-- Reporting — Audit candidat : persistance des analyses CV
-- ──────────────────────────────────────────────────────────────────────
-- Source de vérité durable des candidatures analysées (cf.
-- docs/specs/reporting.md §5.3). Avant cette table, seul un RÉSUMÉ vivait
-- dans le journal (nom, email, score) ; le détail critère-par-critère du
-- ScoreResult disparaissait. L'audit candidat — qui matérialise la
-- « traçabilité native d'ORQA » — a besoin de la candidature COMPLÈTE.
--
-- Une ligne = UNE analyse (un traitement distinct). Pas de déduplication
-- par email : chaque analyse est un traitement à part entière (clé = id).
-- `application` (jsonb) porte le CVApplication intégral (candidate +
-- scoringResult.breakdown + narration) pour la vue détaillée ; les colonnes
-- scalaires dénormalisées servent le filtrage (recherche, campagne, statut,
-- période). `campaign_id` est un simple text (pas de FK, comme journal) :
-- lenient si la campagne n'est pas persistée (store partiellement volatile).

create table if not exists public.candidate_analyses (
  id              text primary key,
  -- Clé de corrélation avec les marqueurs de parcours du journal
  -- (candidate_interview_marked / candidate_validation_marked, keyés par
  -- payload.uid). Chat : uid = taskId (= id). IMAP : uid = uid brut du mail
  -- (≠ id préfixé). Permet à l'audit de dériver le parcours sans le piloter.
  uid             text,
  campaign_id     text,
  candidate_name  text not null,
  candidate_email text,
  file_name       text not null,
  source          text not null,
  received_at     timestamptz not null,
  total_score     int not null,
  status          text not null check (status in ('accepted','rejected')),
  criteria_version text not null,
  computed_at     timestamptz not null,
  application     jsonb not null,
  -- HITL figé au moment de l'analyse (toggles validation humaine). L'audit
  -- doit refléter l'état au moment de la décision, pas le réglage courant.
  hitl_config     jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists candidate_analyses_created_at_idx
  on public.candidate_analyses (created_at desc);

create index if not exists candidate_analyses_campaign_idx
  on public.candidate_analyses (campaign_id, created_at desc);

create index if not exists candidate_analyses_status_idx
  on public.candidate_analyses (status, created_at desc);

-- Idempotence : si la table préexistait sans la colonne uid (1ʳᵉ version).
alter table public.candidate_analyses
  add column if not exists uid text;

-- Idempotence : HITL figé ajouté après coup. Rows historiques = null →
-- l'audit retombe sur DEFAULT_HITL_CONFIG (ON) côté applicatif.
alter table public.candidate_analyses
  add column if not exists hitl_config jsonb;

-- Recherche fuzzy sur le nom du candidat (sélection audit).
create index if not exists candidate_analyses_name_trgm_idx
  on public.candidate_analyses using gin (candidate_name gin_trgm_ops);

create index if not exists candidate_analyses_uid_idx
  on public.candidate_analyses (uid);
