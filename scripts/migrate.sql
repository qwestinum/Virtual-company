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
