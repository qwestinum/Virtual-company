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
--
-- Note (fiche de scoring hybride, juin 2026) : les critères de fiche de
-- scoring vivent dans le jsonb campaigns.scoring_sheet et dans
-- scoring_sheets_archived. Les nouveaux champs verificationMethod et keywords
-- sont optionnels avec valeurs par défaut gérées au parse Zod côté
-- application, pas via DDL. Voir ScoringCriterionSchema dans
-- src/types/scoring.ts.

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
  kind             text not null check (kind in ('fdp','job_ad','cv','cv_report','scoring_sheet','campaign_report','other')),
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

-- Étend la liste des `kind` autorisés pour les tables PRÉEXISTANTES (la
-- contrainte inline ci-dessus ne s'applique qu'aux créations fraîches).
-- Ajoute 'cv' (CV binaire consultable en validation) + 'campaign_report'
-- (aligne la contrainte sur le type ArtifactKind). Idempotent.
alter table public.artifacts_meta
  drop constraint if exists artifacts_meta_kind_check;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'artifacts_meta_kind_chk'
  ) then
    alter table public.artifacts_meta add constraint artifacts_meta_kind_chk
      check (kind in ('fdp','job_ad','cv','cv_report','scoring_sheet','campaign_report','other'));
  end if;
end $$;

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
  folder              text,
  last_polled_at      timestamptz,
  last_uid_seen       text,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Dossier IMAP relevé. NULL / vide ⇒ INBOX (comportement historique).
--
-- Pourquoi : brancher une messagerie PERSONNELLE fait passer tout son courrier
-- devant le poller. Mesuré le 20/08/2026 sur une boîte de 25 688 messages :
-- 107 pièces jointes sans rapport (plans d'accès, procédures) stockées dans la
-- file de rejeu `imap_unmatched_cvs`, et autant d'analyses inutiles. Pointer un
-- dossier dédié — alimenté par une règle de messagerie qui y range les mails
-- portant la référence de campagne — ne présente au poller QUE ce qui le
-- concerne, sans rien demander au client d'archiver.
--
-- ⚠️ Ce n'est PAS un correctif de latence : le coût d'un SELECT s'est révélé
-- indépendant de la taille du dossier (~10 s sur ce compte, y compris sur un
-- dossier VIDE, contre 0,2 s sur un autre compte). Cette lenteur-là est
-- propre au COMPTE (limitation Gmail), et c'est le budget d'ouverture borné
-- côté poller qui la rend visible.
alter table public.mailboxes
  add column if not exists folder text;

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
-- HITL 3 zones (lot 2) — DEUX seuils par campagne remplacent `threshold`.
-- Zones : score < low → refus auto · [low, high) → zone grise (validation
-- humaine) · score ≥ high → acceptation auto. `threshold` (mono) est
-- DÉPRÉCIÉE (drop au lot 3), conservée le temps de la transition.
--
-- Backfill conditionné à l'état HITL GLOBAL actuel (app_settings.hitl_config) :
-- valeur PROD lue = {rejectionMail:true, acceptanceMail:true} (tout validé)
-- ⇒ branche « tout gris » : low=0, high=100 sur les campagnes EXISTANTES, ce
-- qui préserve la posture observable (toute décision passe en validation).
-- Les NOUVELLES campagnes prendront 10/90 par défaut (côté applicatif), PAS
-- ce 0/100 — ne pas confondre les deux. Bord assumé : un score EXACTEMENT
-- 100 retombe en acceptation auto (≥ high) ; négligeable, bornes non tordues.
-- ──────────────────────────────────────────────────────────────────────
alter table public.campaigns add column if not exists threshold_low  int;
alter table public.campaigns add column if not exists threshold_high int;

-- Lot 3 — `threshold` (seuil unique) supprimée : remplacée par threshold_low/high.
-- À appliquer APRÈS déploiement du code qui ne la lit/écrit plus.
alter table public.campaigns drop column if exists threshold;

-- Backfill « tout gris » des lignes existantes (idempotent : ne touche que les
-- non encore remplies). À adapter SI app_settings.hitl_config changeait avant
-- application (les deux OFF ⇒ low=high=threshold à la place).
update public.campaigns
  set threshold_low = 0, threshold_high = 100
  where threshold_low is null or threshold_high is null;

-- Invariant low ≤ high garanti en base (posé APRÈS backfill pour ne jamais
-- violer le CHECK à l'ajout). Idempotent via garde sur pg_constraint.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'campaigns_thresholds_chk'
  ) then
    alter table public.campaigns
      add constraint campaigns_thresholds_chk
      check (threshold_low is null or threshold_high is null
             or (threshold_low between 0 and 100
                 and threshold_high between 0 and 100
                 and threshold_low <= threshold_high));
  end if;
end $$;

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

-- Adresses de synthèse COCHÉES = destinataires réels des briefings (juin 2026).
-- Choix multiple : le briefing ne part qu'aux adresses actives, pas à toute la
-- liste. nullable → repli au mapping (l'ancienne adresse par défaut devient la
-- seule cochée tant que rien n'est explicitement sélectionné).
alter table public.app_settings
  add column if not exists synthesis_emails_active text[];

-- Clé API Resend pilotable depuis /settings. Write-only côté UI : la valeur
-- n'est JAMAIS renvoyée en clair par GET /api/settings (seul un booléen
-- « configurée » l'est). Le client email la lit côté serveur, avec repli sur
-- la variable d'env RESEND_API_KEY si la colonne est nulle.
alter table public.app_settings
  add column if not exists resend_api_key text;

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
                           check (status in ('pending', 'sending', 'sent', 'void')),
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

-- HITL 3 zones (lot 1) — capture « qui a confirmé » sur la file de validation.
-- Nullable, sans défaut : l'identité (id + email snapshot, sans FK vers
-- auth.users pour que la trace survive à la suppression du compte) est posée
-- côté serveur à la confirmation humaine. NULL = enqueue / ligne historique.
alter table public.pending_validations
  add column if not exists decided_by text;
alter table public.pending_validations
  add column if not exists decided_by_user_id uuid;
alter table public.pending_validations
  add column if not exists decided_by_user_email text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'pending_validations_decided_by_chk'
  ) then
    alter table public.pending_validations
      add constraint pending_validations_decided_by_chk
      check (decided_by is null or decided_by in ('auto', 'user'));
  end if;
end $$;

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

-- Reporting (rapport de campagne) — dates de cycle de vie. Posées sur
-- transition de statut (launched_at au 1er passage 'active' ; closed_at à
-- chaque passage 'closed' → ré-clôture écrase). Nullable : repli applicatif
-- created_at / updated_at pour les campagnes historiques.
alter table public.campaigns
  add column if not exists launched_at timestamptz;
alter table public.campaigns
  add column if not exists closed_at timestamptz;

-- Inc. 2b — cycle de vie PERSISTÉ (machine d'états, source de vérité unique).
-- Jusqu'ici re-dérivé des artefacts au chargement, ce qui PERDAIT tout état
-- sans artefact — notamment les phases optionnelles « à remettre à plus tard »
-- (`postponed`) et les `in_progress` de configuration. Nullable : les campagnes
-- historiques sans colonne retombent sur la re-dérivation (repli applicatif
-- dans rowToCampaign, qui reconstitue le `postponed` des actives sans canal).
alter table public.campaigns
  add column if not exists lifecycle jsonb;

-- Pré-remplissage à partir d'un document (appel d'offres / notes) — archive de
-- l'extraction LLM (extraits sources par champ + pondérations proposées). Captée
-- systématiquement pour éviter toute réextraction (traçabilité). Nullable : null
-- pour les campagnes créées « de zéro » ou antérieures à la colonne. N'a aucun
-- effet sur le scoring — c'est une archive de cadrage.
alter table public.campaigns
  add column if not exists prefill_extraction jsonb;

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

-- HITL 3 zones (lot 1) — capture « système vs humain » + zone de décision.
-- Nullable, sans défaut, jamais backfillées : NULL = ligne antérieure au modèle
-- 3 zones (frontière nette avant/après lot 1, information vraie pour le
-- reporting). decision_zone est figée au scoring (lot 1 : auto_reject/
-- auto_accept ; 'gray' réservé au lot 2, déjà accepté par le CHECK).
-- decided_by ∈ {auto,user} ; identité (id + email snapshot, sans FK vers
-- auth.users) renseignée seulement sur le chemin humain.
alter table public.candidate_analyses
  add column if not exists decision_zone text;
alter table public.candidate_analyses
  add column if not exists decided_by text;
alter table public.candidate_analyses
  add column if not exists decided_by_user_id uuid;
alter table public.candidate_analyses
  add column if not exists decided_by_user_email text;

-- (Contrainte `candidate_analyses_decision_zone_chk` : bloc canonique DÉPLACÉ
--  en fin de fichier, avec la valeur `proposed_reject`. Ne pas la recréer ici
--  — deux blocs pour une même contrainte, c'est l'incident du 30/07/2026.)

-- Origine vivier DÉNORMALISÉE (menu Candidatures). La trace « issu du vivier »
-- existe déjà via vivier_preselections (jointure email), mais on la FIGE ici au
-- rapprochement (recordApplied) pour : (1) un filtre/badge en LISTE sans N
-- jointures, (2) une origine stable même si la présélection évolue ensuite.
-- Posée par matchVivierApplication quand un dossier vivier CONTACTÉ correspond
-- (email exact). NULL/false = candidature hors vivier ou antérieure au backfill.
-- Migration douce : nullable + défaut false, jamais bloquante. vivier_candidate_id
-- garde le lien vers le dossier source (sans FK : le vivier peut être purgé).
alter table public.candidate_analyses
  add column if not exists from_vivier boolean not null default false;
alter table public.candidate_analyses
  add column if not exists vivier_candidate_id uuid;

create index if not exists candidate_analyses_from_vivier_idx
  on public.candidate_analyses (from_vivier) where from_vivier;

-- ──────────────────────────────────────────────────────────────────────
-- Vivier de candidats (Session V1 — socle)
-- Spec : docs/specs/vivier.md
-- ──────────────────────────────────────────────────────────────────────
-- Stock interne de dossiers candidats persistants, indépendants des
-- campagnes, unique par organisation (MVP mono-org). Trois tables :
--   - vivier_candidates : le dossier (identité STABLE), clé de dédup = email
--   - vivier_embeddings : index sémantique (RÉGÉNÉRABLE), 1-1 cascade
--   - vivier_entities   : entités structurées (RÉGÉNÉRABLES), 1-1 cascade
-- La séparation identité / index permet de réécrire embeddings + entités à
-- chaque réindexation (delete+insert atomique) sans toucher au dossier, et le
-- `on delete cascade` garantit la suppression effective (RGPD §8.2).
--
-- PRÉ-REQUIS : l'extension pgvector doit être activée. Elle est livrée par
-- défaut sur tout projet Supabase mais désactivée ; on l'active ici (idempotent).
-- Si la service_role n'a pas le droit de créer l'extension, l'activer en un clic
-- via Dashboard → Database → Extensions → « vector » AVANT de jouer ce script.
create extension if not exists vector;

-- Le dossier candidat. `email` normalisé (lowercase+trim) côté application
-- AVANT insert : la contrainte unique réalise la déduplication (cf. spec §2.3).
-- `indexing_status` pilote l'exclusion des recherches (pending/failed exclus —
-- garantie consommée par la présélection V2).
--
-- CLÉ PRIMAIRE = UUID GÉNÉRÉ PAR LA BASE (`gen_random_uuid()`). L'identité du
-- dossier n'est jamais fabriquée côté application : pas de plafond, pas de
-- collision de PK possible (cf. revue V1). L'id est opaque (non affiché) — il
-- ne sert que de clé technique et de préfixe de chemin Storage.
-- NB : `create table if not exists` n'altère pas une table préexistante. Si une
-- ébauche de cette table (id text) a été appliquée pendant cette même branche,
-- la recréer (drop) — aucune donnée de production, V1 non clôturée.
create table if not exists public.vivier_candidates (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique,                   -- clé de dédup (normalisée)
  nom              text not null,
  prenom           text,
  telephone        text,
  cv_path          text,                                   -- chemin Storage du CV
  cv_file_name     text,                                   -- nom de fichier d'origine (contexte d'extraction d'entités)
  cv_text          text,                                   -- texte extrait
  tags             text[] not null default '{}',
  source           text not null
                     check (source in ('manual_upload','campaign_application')),
  indexing_status  text not null default 'pending'
                     check (indexing_status in ('pending','indexed','failed')),
  indexing_error   text,                                   -- motif du dernier échec
  entered_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists vivier_candidates_status_idx
  on public.vivier_candidates (indexing_status);
create index if not exists vivier_candidates_updated_at_idx
  on public.vivier_candidates (updated_at desc);
create index if not exists vivier_candidates_tags_idx
  on public.vivier_candidates using gin (tags);
-- Recherche texte simple (nom / email) — fuzzy via trigram (pg_trgm déjà activé).
create index if not exists vivier_candidates_nom_trgm_idx
  on public.vivier_candidates using gin (nom gin_trgm_ops);
create index if not exists vivier_candidates_email_trgm_idx
  on public.vivier_candidates using gin (email gin_trgm_ops);

drop trigger if exists vivier_candidates_touch_updated_at on public.vivier_candidates;
create trigger vivier_candidates_touch_updated_at
  before update on public.vivier_candidates
  for each row execute function public.touch_updated_at();

-- Embedding sémantique (1-1, régénérable). Dimension 1536 = text-embedding-3-small
-- (OpenAI). `provider`/`model` stockés AVEC le vecteur pour détecter les
-- incohérences : deux fournisseurs produisent des espaces vectoriels NON
-- comparables → toute bascule impose une réindexation complète (cf. spec §3.4).
create table if not exists public.vivier_embeddings (
  candidate_id  uuid primary key
                  references public.vivier_candidates(id) on delete cascade,
  embedding     vector(1536) not null,
  provider      text not null,
  model         text not null,
  generated_at  timestamptz not null default now()
);

-- Index de similarité : HNSW (et non ivfflat). Choix documenté — HNSW ne
-- nécessite aucune phase d'entraînement ni recalibrage du paramètre `lists`
-- quand le vivier grossit en continu, et offre un meilleur rappel. Coût :
-- build/insert plus lents, acceptable au volume prototype. Opérateur cosinus
-- (vector_cosine_ops) car la présélection V2 classe par similarité cosinus.
-- pgvector ≥ 0.5 requis pour HNSW (Supabase est sur 0.8+). 1536 < limite 2000.
create index if not exists vivier_embeddings_hnsw_idx
  on public.vivier_embeddings using hnsw (embedding vector_cosine_ops);

-- Entités structurées (1-1, régénérables). text[] + GIN pour les FILTRES DURS
-- déterministes de la présélection V2 (opérateur d'overlap `&&` / `@>`), sans
-- appel LLM à la recherche. `experience_years` / `localisation` nullable.
create table if not exists public.vivier_entities (
  candidate_id      uuid primary key
                      references public.vivier_candidates(id) on delete cascade,
  technologies      text[] not null default '{}',
  certifications    text[] not null default '{}',
  diplomes          text[] not null default '{}',
  secteurs          text[] not null default '{}',
  langues           text[] not null default '{}',
  experience_years  integer,
  localisation      text,
  extracted_at      timestamptz not null default now()
);

create index if not exists vivier_entities_technologies_idx
  on public.vivier_entities using gin (technologies);
create index if not exists vivier_entities_certifications_idx
  on public.vivier_entities using gin (certifications);
create index if not exists vivier_entities_diplomes_idx
  on public.vivier_entities using gin (diplomes);
create index if not exists vivier_entities_langues_idx
  on public.vivier_entities using gin (langues);

-- ──────────────────────────────────────────────────────────────────────
-- Présélection vivier (Session V2 — source Vivier + traitement à l'activation)
-- Spec : docs/specs/vivier.md §4
-- ──────────────────────────────────────────────────────────────────────
-- RPC de tri sémantique : similarité cosinus (pgvector `<=>`) entre un embedding
-- de requête et les dossiers INDEXÉS d'un sous-ensemble (survivants des filtres
-- durs). supabase-js ne peut pas exprimer `<=>` en direct → on passe par cette
-- fonction. `similarity = 1 - distance_cosinus` (1 = identique). Seuls les
-- dossiers `indexed` participent (pending/failed exclus — garantie §3.2/4.2).
create or replace function public.match_vivier_candidates(
  query_embedding vector(1536),
  candidate_ids   uuid[]
)
returns table (candidate_id uuid, similarity double precision)
language sql
stable
as $$
  select ve.candidate_id,
         1 - (ve.embedding <=> query_embedding) as similarity
  from public.vivier_embeddings ve
  join public.vivier_candidates vc on vc.id = ve.candidate_id
  where vc.indexing_status = 'indexed'
    and ve.candidate_id = any(candidate_ids)
  order by similarity desc
$$;

-- Short-list persistée d'une campagne (substrat du cycle factuel V3). PK
-- composite (campaign_id, candidate_id) ⇒ idempotence : une relance réconcilie
-- au lieu de dupliquer. `state` porte le cycle factuel ; en V2 seul `identified`
-- est produit, mais le schéma accueille `contacted`/`rejected` que toute relance
-- PRÉSERVE (cf. replacePreselection). `on delete cascade` sur le dossier :
-- supprimer un candidat du vivier purge ses présélections (cohérence RGPD §8.2).
create table if not exists public.vivier_preselections (
  campaign_id      text not null,
  candidate_id     uuid not null
                     references public.vivier_candidates(id) on delete cascade,
  state            text not null default 'identified'
                     check (state in ('identified','contacted','rejected')),
  similarity       double precision not null,
  freshness_factor double precision not null,
  relevance_score  double precision not null,
  passed_filters   jsonb not null default '[]'::jsonb,
  rank             integer not null,
  generated_at     timestamptz not null default now(),
  primary key (campaign_id, candidate_id)
);

create index if not exists vivier_preselections_campaign_rank_idx
  on public.vivier_preselections (campaign_id, rank);

-- ──────────────────────────────────────────────────────────────────────
-- Cycle factuel des propositions vivier (Session V3 — boucle de contact)
-- Spec : docs/specs/vivier.md §6
-- ──────────────────────────────────────────────────────────────────────
-- La table vivier_preselections EST la table de liaison campagne↔candidat :
-- le cycle factuel est l'évolution de l'`state` d'une ligne (identified →
-- contacted | rejected), pas une autre réalité. On ajoute les FAITS datés.
-- Aucun statut spéculatif (a postulé sans réponse, a décliné…) n'est géré.
alter table public.vivier_preselections
  add column if not exists contacted_at timestamptz,   -- invitation envoyée (§6.2)
  add column if not exists rejected_at  timestamptz,   -- prise de contact refusée
  add column if not exists decided_by   text,          -- auteur de la décision
  add column if not exists applied_at   timestamptz;   -- rapprochement : a postulé (§6.3)

-- Cohérence ATOMIQUE état ↔ dates : jamais un état sans sa date, ni l'inverse.
-- identified : aucune date de décision. contacted : contacted_at requis.
-- rejected : rejected_at + decided_by requis. (idempotent : drop puis add.)
alter table public.vivier_preselections
  drop constraint if exists vivier_preselections_state_dates_chk;
alter table public.vivier_preselections
  add constraint vivier_preselections_state_dates_chk check (
    (state = 'identified' and contacted_at is null and rejected_at is null)
    or (state = 'contacted' and contacted_at is not null)
    or (state = 'rejected' and rejected_at is not null and decided_by is not null)
  );

-- Cooldown : retrouver vite les contactés récents (fenêtre glissante, §7).
create index if not exists vivier_preselections_contacted_at_idx
  on public.vivier_preselections (contacted_at)
  where state = 'contacted';

-- Worklist de validation vivier (Session V3, §5) : compte les propositions
-- `identified` (en attente de décision) groupées par campagne. Lecture
-- potentiellement fréquente (badge + page) ⇒ agrégation en base (un aller-retour)
-- plutôt qu'un fetch de toutes les lignes côté app.
create or replace function public.vivier_pending_by_campaign()
returns table (campaign_id text, pending_count bigint)
language sql
stable
as $$
  select campaign_id, count(*) as pending_count
  from public.vivier_preselections
  where state = 'identified'
  group by campaign_id
$$;

-- Réglages vivier (Session V3, §9) : mode de contact, template d'invitation,
-- cooldown (jours), plafond de short-list. jsonb single-row (cf. app_settings).
-- Défaut applicatif (DEFAULT_VIVIER_CONFIG) appliqué au mapping si null.
alter table public.app_settings
  add column if not exists vivier_config jsonb;

-- Réglages des messages candidat d'entretien : templates acceptation+invitation
-- et refus (rendus déterministes, plus de génération LLM), lien d'agenda
-- org-level (Calendly/Cal.com), nom d'organisation et de recruteur. jsonb
-- single-row. Défaut applicatif (DEFAULT_INTERVIEW_CONFIG) appliqué au mapping
-- si null.
alter table public.app_settings
  add column if not exists interview_config jsonb;

-- ──────────────────────────────────────────────────────────────────────
-- Refonte de la présélection sur le TITRE (cf. docs/specs/vivier.md §4)
-- ──────────────────────────────────────────────────────────────────────
-- Le dossier porte le TITRE du candidat (déclaré en tête de CV, repli sur le
-- poste le plus récent) + ses VARIANTES générées par LLM. Servent au bloc 1
-- (matching déterministe titre↔intitulé du poste).
alter table public.vivier_candidates
  add column if not exists title          text,
  add column if not exists title_variants text[] not null default '{}';

-- Ancres de titre (Bloc 1 multi-ancres, Phase 1) : titre déclaré + 2 derniers
-- postes, chacun avec ses blocs + variantes iso-rôle et son depth (0/1/2). JSONB
-- (régénéré au reindex). Vide ⇒ repli sur title/title_variants (pas de régression).
alter table public.vivier_candidates
  add column if not exists title_anchors jsonb not null default '[]'::jsonb;

-- L'embedding full-CV (`embedding`) n'est PLUS régénéré : la présélection se
-- fonde désormais sur l'embedding du TITRE seul. Les vecteurs full-CV déjà
-- stockés sont CONSERVÉS (jamais supprimés, usages futurs) ⇒ la colonne devient
-- NULLABLE (nouveaux dossiers sans full-CV). `provider`/`model` décrivent
-- désormais l'embedding TITRE (l'espace vérifié par le garde-fou).
alter table public.vivier_embeddings
  alter column embedding drop not null,
  alter column provider  drop not null,
  alter column model     drop not null,
  add column if not exists title_embedding vector(1536);

-- Index HNSW cosinus sur l'embedding TITRE (tri du bloc 2). Les lignes à
-- title_embedding null ne sont pas indexées (candidats sans titre exploitable).
create index if not exists vivier_embeddings_title_hnsw_idx
  on public.vivier_embeddings using hnsw (title_embedding vector_cosine_ops);

-- RPC de tri TITRE-À-TITRE (bloc 2 de la présélection refondue) : similarité
-- cosinus entre l'embedding de l'intitulé du poste et les embeddings de TITRE
-- des candidats (sous-ensemble `candidate_ids` non retenus au bloc 1). Seuls les
-- dossiers `indexed` AVEC un title_embedding participent.
create or replace function public.match_vivier_titles(
  query_embedding vector(1536),
  candidate_ids   uuid[]
)
returns table (candidate_id uuid, similarity double precision)
language sql
stable
as $$
  select ve.candidate_id,
         1 - (ve.title_embedding <=> query_embedding) as similarity
  from public.vivier_embeddings ve
  join public.vivier_candidates vc on vc.id = ve.candidate_id
  where vc.indexing_status = 'indexed'
    and ve.title_embedding is not null
    and ve.candidate_id = any(candidate_ids)
  order by similarity desc
$$;

-- Origine + justification d'une proposition (présélection refondue) : bloc 1
-- (déterministe, terme matché) ou bloc 2 (similarité titre). Affichage §7.
alter table public.vivier_preselections
  add column if not exists match_kind text,   -- 'title_exact' | 'title_semantic'
  add column if not exists match_term text;   -- variante matchée (bloc 1)

-- ──────────────────────────────────────────────────────────────────────
-- COMPÉTENCES set-to-set (présélection — Chantier 3)
-- Un embedding PAR compétence (jamais un vecteur moyenné : le barycentre dilue
-- et l'asymétrie N vs M pénalise les spécialistes). Le matching set-to-set se
-- fait en JS pur (cosinus par paire) ; cette table fournit les vecteurs.
-- Spec : docs/specs/vivier.md (Chantier 3).
-- ──────────────────────────────────────────────────────────────────────

-- Liste atomique lisible des compétences du candidat (affichage + accès sans
-- vecteurs). Régénérée à l'indexation, comme title_variants.
alter table public.vivier_candidates
  add column if not exists skills text[] not null default '{}';

create table if not exists public.vivier_skill_embeddings (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null
                  references public.vivier_candidates(id) on delete cascade,
  skill         text not null,              -- compétence atomique (normalisée)
  embedding     vector(1536) not null,
  provider      text not null,              -- garde-fou d'espace (= modèle indexé)
  model         text not null,
  generated_at  timestamptz not null default now(),
  unique (candidate_id, skill)
);

create index if not exists vivier_skill_emb_candidate_idx
  on public.vivier_skill_embeddings (candidate_id);
-- Index HNSW cosinus (au cas où un tri SQL serait ajouté en V2 ; le matching V1
-- est en JS, mais l'index ne coûte rien à poser dès maintenant).
create index if not exists vivier_skill_emb_hnsw_idx
  on public.vivier_skill_embeddings using hnsw (embedding vector_cosine_ops);

-- ──────────────────────────────────────────────────────────────────────
-- Bloc 2 sémantique MULTI-ANCRES (présélection — Phase 2)
-- Un embedding par ANCRE (titre déclaré + 2 derniers postes). Le Bloc 2 compare
-- l'intitulé du poste à TOUTES les ancres (max cosinus décoté), pour repêcher un
-- titre déclaré bruité via un poste propre. Cosinus en SQL ; décote/seuil en JS.
-- ──────────────────────────────────────────────────────────────────────

create table if not exists public.vivier_anchor_embeddings (
  candidate_id  uuid not null
                  references public.vivier_candidates(id) on delete cascade,
  depth         smallint not null,           -- 0 déclaré · 1 dernier poste · 2 précédent
  anchor_text   text not null,
  embedding     vector(1536) not null,
  provider      text not null,               -- garde-fou d'espace (= modèle indexé)
  model         text not null,
  generated_at  timestamptz not null default now(),
  primary key (candidate_id, depth)
);

create index if not exists vivier_anchor_emb_hnsw_idx
  on public.vivier_anchor_embeddings using hnsw (embedding vector_cosine_ops);

-- Cosinus par ancre (candidats indexés). La DÉCOTE d'ancienneté est appliquée en
-- JS (`pickBestAnchor`) car le poids vit dans la config, pas en SQL.
create or replace function public.match_vivier_anchors(
  query_embedding vector(1536),
  candidate_ids   uuid[]
)
returns table (candidate_id uuid, depth smallint, similarity double precision)
language sql
stable
as $$
  select ae.candidate_id, ae.depth, 1 - (ae.embedding <=> query_embedding) as similarity
  from public.vivier_anchor_embeddings ae
  join public.vivier_candidates vc on vc.id = ae.candidate_id
  where vc.indexing_status = 'indexed'
    and ae.candidate_id = any(candidate_ids)
$$;

-- ──────────────────────────────────────────────────────────────────────
-- Recherche plein-texte EXACTE sur le vivier (repêchage manuel)
-- STRICTEMENT distincte de la présélection sémantique : pas d'embedding, pas de
-- seuil, pas de variante — « le mot est présent ou pas ». Spec : docs/specs/vivier.md.
-- ──────────────────────────────────────────────────────────────────────
-- Colonne tsvector GÉNÉRÉE depuis cv_text : Postgres backfille tous les dossiers
-- existants à l'ADD COLUMN (réécriture de table, lock bref — OK au volume
-- prototype) et la maintient à chaque upsert de cv_text. AUCUNE réindexation ni
-- pipeline LLM nécessaire. Config 'french' (stemming + frontière de MOT : « SAP »
-- ne matche jamais « sapin », contrairement à un ILIKE '%sap%'). Forme à deux
-- arguments = IMMUTABLE, requise par une colonne générée.
alter table public.vivier_candidates
  add column if not exists cv_tsv tsvector
  generated always as (to_tsvector('french', coalesce(cv_text, ''))) stored;

create index if not exists vivier_candidates_cv_tsv_idx
  on public.vivier_candidates using gin (cv_tsv);

-- RPC de recherche plein-texte : dossiers dont le CV INTÉGRAL contient le(s)
-- mot(s) cherché(s), avec un extrait surligné (ts_headline). Surlignage via des
-- SENTINELLES non-HTML ([[HL]]…[[/HL]]) que le client transforme en <mark> après
-- échappement (pas de dangerouslySetInnerHTML → pas d'injection). `title` avec
-- repli sur le dernier poste (ancre depth 1). Tri : fraîcheur décroissante.
-- websearch_to_tsquery : ne lève jamais sur une saisie utilisateur libre, et
-- accepte les "phrases entre guillemets" pour une recherche de séquence exacte.
create or replace function public.search_vivier_fulltext(
  p_query text
)
returns table (
  candidate_id uuid,
  email        text,
  nom          text,
  prenom       text,
  title        text,
  snippet      text
)
language sql
stable
as $$
  select vc.id,
         vc.email,
         vc.nom,
         vc.prenom,
         coalesce(
           nullif(vc.title, ''),
           (select a->>'text'
              from jsonb_array_elements(vc.title_anchors) a
             where (a->>'depth') = '1'
             limit 1)
         ) as title,
         ts_headline(
           'french', vc.cv_text,
           websearch_to_tsquery('french', p_query),
           'StartSel=[[HL]], StopSel=[[/HL]], MaxFragments=1, MinWords=8, MaxWords=30'
         ) as snippet
  from public.vivier_candidates vc
  where vc.cv_tsv @@ websearch_to_tsquery('french', p_query)
  order by vc.updated_at desc
$$;

-- ──────────────────────────────────────────────────────────────────────
-- Briefings d'entretien — file d'attente + état des candidatures retenues
-- (juin 2026 — réservation Cal.com pilote la délivrance du briefing)
-- ──────────────────────────────────────────────────────────────────────
-- Un candidat ACCEPTÉ + invité génère ici une trame d'entretien MISE EN
-- ATTENTE (status 'awaiting_booking'). Le briefing n'est délivré (mail au
-- DRH + CV en PJ) qu'à la réception du webhook Cal.com BOOKING_CREATED, qui
-- bascule la ligne en 'scheduled'. Cette table est aussi la source de
-- vérité du dashboard : qui est invité-en-attente vs qui a réservé.
create table if not exists public.interview_briefs (
  id                   uuid primary key default gen_random_uuid(),
  campaign_id          text,
  task_id              text,
  candidate_email      text,          -- normalisé (lower+trim), clé de matching webhook
  candidate_name       text not null,
  job_title            text,
  status               text not null default 'awaiting_booking'
                         check (status in ('awaiting_booking', 'scheduled', 'cancelled')),
  questions            jsonb not null default '[]'::jsonb,   -- trame générée
  candidate_snapshot   jsonb not null default '{}'::jsonb,   -- MailCandidate (corps mail + repli)
  booking_uid          text,          -- uid Cal.com, posé à la livraison
  interview_start_at   timestamptz,
  interview_end_at     timestamptz,
  interview_location   text,
  delivered_message_id text,          -- message-id Resend du brief livré
  created_at           timestamptz not null default now(),  -- = invité / mis en file le
  booked_at            timestamptz,
  updated_at           timestamptz not null default now()
);

-- uid de l'ANALYSE candidat à l'origine du brief (rattachement FIABLE par
-- candidature, ≠ email). Permet à « RDV pris » de ne s'afficher que pour LA
-- candidature réellement réservée (l'email seul collisionne entre analyses /
-- ré-tests). Nullable : briefs historiques + repli webhook sans uid.
alter table public.interview_briefs
  add column if not exists uid text;

create index if not exists interview_briefs_uid_scheduled_idx
  on public.interview_briefs (uid)
  where status = 'scheduled' and uid is not null;

-- Lookup au webhook : la plus récente candidature EN ATTENTE pour un email.
create index if not exists interview_briefs_pending_email_idx
  on public.interview_briefs (lower(candidate_email), created_at desc)
  where status = 'awaiting_booking';

-- Dashboard : état par campagne (invités en attente vs entretiens programmés).
create index if not exists interview_briefs_campaign_idx
  on public.interview_briefs (campaign_id, status);

-- Un booking Cal.com ne se rattache qu'à une seule ligne (idempotence livraison).
create unique index if not exists interview_briefs_booking_uid_idx
  on public.interview_briefs (booking_uid)
  where booking_uid is not null;

drop trigger if exists interview_briefs_touch_updated_at on public.interview_briefs;
create trigger interview_briefs_touch_updated_at
  before update on public.interview_briefs
  for each row execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────
-- Idempotence webhook Cal.com — un booking traité une seule fois
-- ──────────────────────────────────────────────────────────────────────
-- Clé = uid du booking Cal.com. Le webhook CLAIM cette clé AVANT de livrer ;
-- si la livraison échoue de façon transitoire, le claim est RELÂCHÉ (Cal.com
-- pourra rejouer). Un rejeu APRÈS succès trouve la clé présente et ne renvoie
-- rien — garantit qu'un même booking ne déclenche qu'un seul envoi.
create table if not exists public.calcom_webhook_events (
  booking_uid   text primary key,
  trigger_event text not null,
  processed_at  timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────────────
-- Idempotence outreach IMAP — un mail candidat (invitation/refus) envoyé
-- une seule fois, même sous invocations cron CONCURRENTES
-- ──────────────────────────────────────────────────────────────────────
-- Sur Vercel, chaque hit du cron `/api/cron/imap-poll` est une INSTANCE
-- isolée : la garde anti-réentrance du poller (`__imapPollInFlight__`, en
-- mémoire de process) ne sérialise PAS deux invocations concurrentes. Elles
-- lisent le même `last_uid_seen`, retraitent le même message et envoyaient le
-- mail candidat DEUX fois. La seule chose partagée entre deux instances = la
-- base. Le sender CLAIM (mailbox, uid, mode) juste avant `sendEmail` ; si
-- l'envoi n'aboutit pas, le claim est RELÂCHÉ (un re-poll pourra renvoyer,
-- jamais de candidat muet). Présence de la clé = déjà envoyé ⇒ la passe
-- concurrente n'envoie rien. Même pattern que `calcom_webhook_events`.
create table if not exists public.imap_outreach_claims (
  mailbox_id text        not null,
  uid        text        not null,
  mode       text        not null,
  created_at timestamptz not null default now(),
  primary key (mailbox_id, uid, mode)
);

-- ──────────────────────────────────────────────────────────────────────
-- Réessais d'analyse CV du poller IMAP — correctif audit C2/C3 (juil. 2026)
-- ──────────────────────────────────────────────────────────────────────
-- Un échec RE-TENTABLE d'analyse (panne LLM/rate limit/timeout, hoquet DB,
-- verdicts inexploitables) ne consomme plus le CV : le curseur last_uid_seen
-- est gelé et le message re-tenté avec backoff (1, 15, 60, 360 min). Cette
-- table porte le compteur DURABLE par (mailbox, uid) — la mémoire de process
-- ne survit pas au serverless. Au plafond (5 tentatives réelles, ~7 h de
-- couverture) : abandon SIGNALÉ (journal `imap_cv_analysis_abandoned` +
-- binaire du CV sauvegardé en artefact, JAMAIS de refus auto) et la ligne est
-- purgée — la boîte n'est plus bloquée par un CV « poison ». Fail-safe si la
-- table manque : réessai sans plafond (on ne perd jamais un CV faute de
-- migration). Penser à recharger le cache de schéma PostgREST après création.
create table if not exists public.imap_cv_retries (
  mailbox_id    text        not null,
  uid           text        not null,
  attempts      integer     not null default 0,
  next_retry_at timestamptz,
  last_error    text,
  updated_at    timestamptz not null default now(),
  primary key (mailbox_id, uid)
);

-- ──────────────────────────────────────────────────────────────────────
-- CV reçus sans campagne reconnue — correctif audit C11 (juil. 2026)
-- ──────────────────────────────────────────────────────────────────────
-- Un mail sans identifiant CAMP-XXXX reconnu mais portant un CV en PJ ne
-- disparaît plus : binaire stocké dans le bucket sous `unmatched/…` (PAS dans
-- artifacts_meta — le CHECK XOR y exige un owner campagne/tâche qu'un mail
-- non rattaché n'a pas) + une ligne ici + journal `imap_no_campaign_match`.
-- REJOUABLE via POST /api/imap/unmatched/[id]/replay {campaignId} : la
-- réservation pending→replayed est conditionnelle (un seul gagnant), le rejeu
-- réutilise processEmailAttachment tel quel (mêmes gardes, mêmes claims
-- d'idempotence). Une ligne PAR pièce jointe : unique (mailbox, uid, fichier).
-- Penser à recharger le cache de schéma PostgREST après création.
create table if not exists public.imap_unmatched_cvs (
  id                   uuid        primary key default gen_random_uuid(),
  mailbox_id           text        not null,
  uid                  text        not null,
  from_addr            text,
  subject              text,
  file_name            text        not null,
  mime                 text        not null,
  storage_bucket       text,
  storage_path         text,
  status               text        not null default 'pending'
                                   check (status in ('pending','replayed','dismissed')),
  replayed_campaign_id text,
  replayed_at          timestamptz,
  received_at          timestamptz not null default now(),
  unique (mailbox_id, uid, file_name)
);

create index if not exists imap_unmatched_cvs_status_idx
  on public.imap_unmatched_cvs (status, received_at desc);

-- ──────────────────────────────────────────────────────────────────────
-- Idempotence des envois HITL + claims deux-phases — audit C5/C6/I7 (juil. 2026)
-- ──────────────────────────────────────────────────────────────────────
-- C6 : machine d'états pending → sending → sent sur pending_validations.
-- La réservation `sending` (posée AVANT tout envoi, conditionnelle sur
-- status='pending' — un seul gagnant) rend impossible le double envoi et le
-- « invitation + refus » par onglets concurrents. `sending_at` = ancre du TTL :
-- un 'sending' plus vieux que 5 min (crash en plein envoi) redevient
-- re-réservable — jamais un piège définitif. La décision est IMMUABLE dès la
-- réservation (PATCH decision gardé par status='pending').
alter table public.pending_validations
  add column if not exists sending_at timestamptz;

-- CHECK status — ÉTAT FINAL (C6 `sending` + chantier sans-suite `void`).
-- RÈGLE DU FICHIER : une contrainte = UN bloc canonique, mis à jour en place
-- quand un chantier la fait évoluer (jamais deux blocs empilés — l'ancien
-- bloc 3 valeurs rejoué sur une base portant des rows 'void' violait le
-- CHECK au rejeu, incident 30/07/2026). Converge depuis N'IMPORTE quel état :
-- drop en boucle de toute version antérieure (inline du create table, chk 3
-- valeurs, chk2), puis pose de la contrainte finale ; no-op si déjà finale.
do $$
declare c text;
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'pending_validations_status_chk2'
       and pg_get_constraintdef(oid) like '%void%'
  ) then
    return; -- déjà à l'état final
  end if;
  for c in
    select conname from pg_constraint
     where conrelid = 'public.pending_validations'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.pending_validations drop constraint %I', c);
  end loop;
  alter table public.pending_validations
    add constraint pending_validations_status_chk2
    check (status in ('pending', 'sending', 'sent', 'void'));
end $$;

-- C5/I7 : claims DEUX PHASES. `confirmed_at` distingue « réservé ET envoyé »
-- (prouvé — ne jamais renvoyer) de « réservé mais jamais parti » (orphelin
-- après crash — repris après le TTL de 5 min, le candidat/brief n'est jamais
-- muet). Fenêtre résiduelle assumée : crash entre l'envoi réussi et la pose de
-- confirmed_at ⇒ rare doublon possible à la reprise — trade-off projet
-- « mieux un rare doublon qu'un candidat muet ». Les claims historiques (non
-- confirmés) ne sont repris QUE sur un nouveau conflit — sans effet sinon ;
-- pour calcom_webhook_events, Cal.com ne rejoue pas les bookings anciens.
alter table public.imap_outreach_claims
  add column if not exists confirmed_at timestamptz;
alter table public.calcom_webhook_events
  add column if not exists confirmed_at timestamptz;

-- ──────────────────────────────────────────────────────────────────────
-- C4 : CV reçu SANS fiche de scoring validée — stocké + rejouable (juil. 2026)
-- ──────────────────────────────────────────────────────────────────────
-- Avant : `processEmailAttachment` journalisait `pendingScoringSheet:true`
-- puis retournait AVANT tout stockage du binaire, UID avancé — toute la
-- première vague d'une campagne dont la fiche est validée en retard était
-- perdue (seul recours : renvoi par le candidat). Désormais la file
-- `imap_unmatched_cvs` (infrastructure C11) porte AUSSI ces CV « en attente
-- de fiche » : `reason` distingue les deux origines, `campaign_id` est connu
-- pour un `pending_sheet` (contrairement au trou `none`). Le drain est
-- automatique à la validation de la fiche (hook PUT/PATCH campagnes).
alter table public.imap_unmatched_cvs
  add column if not exists campaign_id text,
  add column if not exists reason text not null default 'none';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'imap_unmatched_cvs_reason_chk'
  ) then
    alter table public.imap_unmatched_cvs
      add constraint imap_unmatched_cvs_reason_chk
      check (reason in ('none', 'pending_sheet'));
  end if;
end $$;
create index if not exists imap_unmatched_cvs_campaign_idx
  on public.imap_unmatched_cvs (campaign_id, status)
  where campaign_id is not null;

-- ──────────────────────────────────────────────────────────────────────
-- « Classée sans suite » — fin de vie propre des candidatures (juil. 2026)
-- ──────────────────────────────────────────────────────────────────────
-- Un NOUVEAU terminal DISTINCT du refus : le verdict de screening (status)
-- et la zone restent INTACTS — le classement est une dimension orthogonale
-- (colonnes dismissed_*), jamais un 3e statut (un 3e statut contaminerait
-- deriveDecisionZone, l'audit et le PDF en « Écarté »). Raison TYPÉE
-- obligatoire, trace auto/humain + identité snapshot (pattern decided_by).
alter table public.candidate_analyses
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissal_reason text,
  add column if not exists dismissed_by text,
  add column if not exists dismissed_by_user_id uuid,
  add column if not exists dismissed_by_user_email text;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'candidate_analyses_dismissal_reason_chk'
  ) then
    alter table public.candidate_analyses
      add constraint candidate_analyses_dismissal_reason_chk
      check (dismissal_reason is null or dismissal_reason in
        ('campagne_cloturee','poste_pourvu','candidat_retire','sans_reponse','doublon','invalide'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'candidate_analyses_dismissed_by_chk'
  ) then
    alter table public.candidate_analyses
      add constraint candidate_analyses_dismissed_by_chk
      check (dismissed_by is null or dismissed_by in ('auto', 'user'));
  end if;
  -- Cohérence : classée ⇔ raison présente (jamais l'un sans l'autre).
  if not exists (
    select 1 from pg_constraint where conname = 'candidate_analyses_dismissal_coherence_chk'
  ) then
    alter table public.candidate_analyses
      add constraint candidate_analyses_dismissal_coherence_chk
      check ((dismissed_at is null) = (dismissal_reason is null));
  end if;
end $$;
-- Compteurs Bureau/menu : exclusion des classées à volume (filtre partiel).
create index if not exists candidate_analyses_dismissed_idx
  on public.candidate_analyses (campaign_id, dismissed_at)
  where dismissed_at is not null;

-- pending_validations : nouvel état TERMINAL `void` (validation fermée par
-- classement sans suite — jamais tranchée, jamais envoyée). Transition
-- UNIQUEMENT depuis `pending` (un `sending` n'est jamais voidé). Le CHECK
-- vit dans son bloc CANONIQUE unique, section C6 ci-dessus (règle « état
-- final » : jamais deux versions d'une même contrainte dans ce fichier).

-- interview_briefs : nouvel état `cancelled` (brief annulé par classement
-- sans suite). Bloque le « booking posthume » : un candidat classé qui
-- réserve via un lien Cal.com encore ouvert ne déclenche plus la livraison
-- d'un brief (getPendingBriefByEmail / listScheduledInterviewUids ne lisent
-- que awaiting_booking / scheduled).
do $$
declare c text;
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'interview_briefs_status_chk2'
       and pg_get_constraintdef(oid) like '%cancelled%'
  ) then
    return; -- déjà à l'état final
  end if;
  for c in
    select conname from pg_constraint
     where conrelid = 'public.interview_briefs'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.interview_briefs drop constraint %I', c);
  end loop;
  alter table public.interview_briefs
    add constraint interview_briefs_status_chk2
    check (status in ('awaiting_booking', 'scheduled', 'cancelled'));
end $$;

-- ──────────────────────────────────────────────────────────────────────
-- Multi-utilisateur — référentiel des recruteurs + référent de campagne
-- (juil. 2026). Tout l'espace métier reste COMMUN (aucun cloisonnement,
-- choix assumé) ; ce qui devient individuel : l'agenda Cal.com, l'identité
-- dans les actions (pattern decided_by existant), l'accès admin.
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.recruiters (
  -- = auth.users.id (sans FK dure — pattern snapshot : un recruteur parti
  -- reste référencé par ses actions passées, jamais de suppression).
  id uuid primary key,
  display_name text not null,
  email text not null,
  -- Lien de réservation Cal.com PERSONNEL (nullable → fallback global).
  calcom_link text,
  role text not null default 'member' check (role in ('admin', 'member')),
  -- Désactivation DOUCE (un inactif sort des sélecteurs et de la
  -- résolution d'agenda, ses actions passées restent attribuées).
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
-- Consigne audit : RLS activée dès la migration (aucune policy — le
-- service_role applicatif bypasse ; l'anon key ne lit RIEN).
alter table public.recruiters enable row level security;

-- ── SEED ADMIN : ÉTAPE MANUELLE PAR ENVIRONNEMENT (dev et prod ont des
-- auth.users DIFFÉRENTS — jamais d'UUID ni d'email en dur rejoué partout ;
-- l'ancien seed cléé sur un email no-opait EN SILENCE si le compte de
-- l'environnement différait, incident 30/07/2026). Décommenter, remplacer
-- <UUID_ADMIN>/<EMAIL_ADMIN> par le compte de CET environnement
-- (Dashboard → Auth → Users), exécuter, RE-COMMENTER. Idempotent.
-- ⚠️ ORDRE IMPÉRATIF EN PROD : migration → CE seed → déploiement du code du
-- gate (sinon l'admin est verrouillé hors de /admin) — runbook
-- docs/ops/multi-utilisateur.md §1.
--
-- insert into public.recruiters (id, display_name, email, role)
-- values ('<UUID_ADMIN>', 'QWESTINUM', '<EMAIL_ADMIN>', 'admin')
-- on conflict (id) do nothing;

-- Référent de campagne (nullable, migration douce).
alter table public.campaigns
  add column if not exists owner_user_id uuid;
-- Backfill des campagnes historiques sur l'admin. No-op TANT QUE le seed
-- ci-dessus n'a pas été exécuté — relancer ce fichier (ou cette requête)
-- APRÈS le seed pour attribuer l'historique. Idempotent.
update public.campaigns
   set owner_user_id = (
     select id from public.recruiters where role = 'admin'
     order by created_at asc limit 1
   )
 where owner_user_id is null;

-- ══════════════════════════════════════════════════════════════════════
-- MODULE DE RÉSERVATION NATIF (`sched_*`) — lot 1, août 2026
-- Spec de référence : docs/specs/scheduling-module.md
-- ══════════════════════════════════════════════════════════════════════
-- Module AUTONOME : il ne connaît NI candidat, NI campagne, NI brief, NI
-- recruteur — seulement des ressources réservables, des cibles re-pointables,
-- des liens nominatifs, des réservations et des événements. Les clés de
-- l'hôte (`external_ref`) et les charges utiles (`context`, `display`) sont
-- OPAQUES : stockées et restituées telles quelles, jamais interprétées ici.
--
-- Invariants portés par le SCHÉMA (jamais seulement par le code) :
--   - atomicité de la réservation → index unique partiel
--     (resource_id, start_at) where status='confirmed' : l'INSERT EST le
--     claim, deux candidats sur le même créneau ⇒ un seul gagnant ;
--   - idempotence des liens       → unique (target_id, idempotency_key) :
--     ré-émettre avec la même clé rend le MÊME token (preview HITL) ;
--   - un lien = un usage          → status active|used|revoked|expired ;
--   - horaires                    → tout en timestamptz UTC ; les règles
--     hebdo en MINUTES LOCALES de la ressource (seule forme qui survit au
--     changement d'heure : « lun 9h-12h » reste 9h-12h été comme hiver).
--
-- RLS activée sur chaque table (aucune policy : le service_role applicatif
-- bypasse, l'anon key ne lit RIEN) — la page publique candidat passe par une
-- route serveur authentifiée par token, jamais par PostgREST direct.

-- ── Ressources réservables ────────────────────────────────────────────
-- Une personne (ou un poste) qui tient des rendez-vous. `timezone` (IANA) est
-- LA référence des règles locales. `notify_email` : notification organisateur
-- optionnelle — le module reste utilisable hors de tout hôte.
create table if not exists public.sched_resources (
  id                    uuid primary key default gen_random_uuid(),
  external_ref          text not null unique,   -- clé opaque de l'hôte
  display_name          text not null,
  timezone              text not null default 'Europe/Paris',
  slot_duration_minutes int  not null default 45,
  buffer_minutes        int  not null default 15,   -- pause entre deux RDV
  min_notice_minutes    int  not null default 1440, -- préavis minimum
  horizon_days          int  not null default 21,   -- réservable jusqu'à
  meeting_location      jsonb,                  -- { type, payload } OPAQUE
  notify_email          text,
  -- Désactivation DOUCE : une ressource inactive sort de la résolution (les
  -- cibles qui la visent tombent en page dégradée), ses RDV pris subsistent.
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint sched_resources_duration_chk
    check (slot_duration_minutes between 5 and 480),
  constraint sched_resources_buffer_chk
    check (buffer_minutes between 0 and 240),
  constraint sched_resources_notice_chk
    check (min_notice_minutes between 0 and 43200),
  constraint sched_resources_horizon_chk
    check (horizon_days between 1 and 365)
);
alter table public.sched_resources enable row level security;

drop trigger if exists sched_resources_touch_updated_at on public.sched_resources;
create trigger sched_resources_touch_updated_at
  before update on public.sched_resources
  for each row execute function public.touch_updated_at();

-- ── Règles de disponibilité hebdomadaires ─────────────────────────────
-- Plusieurs plages par jour (lun 9h-12h + 14h-17h = DEUX lignes). Minutes
-- LOCALES depuis minuit dans le fuseau de la ressource.
-- `weekday` : ISO-8601, 1 = lundi … 7 = dimanche (aligné sur Luxon —
-- zéro conversion, donc zéro bug de décalage de jour).
create table if not exists public.sched_availability_rules (
  id           uuid primary key default gen_random_uuid(),
  resource_id  uuid not null references public.sched_resources(id) on delete cascade,
  weekday      smallint not null,
  start_minute int not null,
  end_minute   int not null,
  created_at   timestamptz not null default now(),
  constraint sched_rules_weekday_chk check (weekday between 1 and 7),
  constraint sched_rules_bounds_chk
    check (start_minute >= 0 and end_minute <= 1440 and start_minute < end_minute)
);
alter table public.sched_availability_rules enable row level security;

create index if not exists sched_rules_resource_idx
  on public.sched_availability_rules (resource_id, weekday);

-- ── Exceptions datées (congés, blocages ponctuels) ────────────────────
-- (start_minute, end_minute) NULL/NULL = journée entière. Sinon plage
-- partielle retranchée des règles du jour.
create table if not exists public.sched_availability_exceptions (
  id           uuid primary key default gen_random_uuid(),
  resource_id  uuid not null references public.sched_resources(id) on delete cascade,
  day          date not null,           -- date LOCALE de la ressource
  start_minute int,
  end_minute   int,
  label        text,
  created_at   timestamptz not null default now(),
  constraint sched_exceptions_bounds_chk check (
    (start_minute is null and end_minute is null)
    or (start_minute is not null and end_minute is not null
        and start_minute >= 0 and end_minute <= 1440 and start_minute < end_minute)
  )
);
alter table public.sched_availability_exceptions enable row level security;

create index if not exists sched_exceptions_resource_day_idx
  on public.sched_availability_exceptions (resource_id, day);

-- ── Cibles : l'alias RE-POINTABLE entre un lien et une ressource ──────
-- Un lien ne pointe JAMAIS une ressource directement. L'hôte crée une cible
-- par « poste de rendez-vous » et la re-pointe librement : tous les liens
-- déjà émis suivent le nouveau titulaire SANS réémission, et les RDV déjà
-- pris ne bougent pas (ils figent leur ressource).
-- `version` : incrémentée à CHAQUE re-pointage → contrôle optimiste dans la
-- séquence de confirmation (un re-pointage pendant qu'un candidat confirme
-- est détecté et compensé, verdict `target_changed`).
create table if not exists public.sched_targets (
  id                        uuid primary key default gen_random_uuid(),
  external_ref              text not null unique,  -- clé opaque de l'hôte
  -- NULL (ou ressource inactive) ⇒ page publique DÉGRADÉE, jamais une erreur.
  resource_id               uuid references public.sched_resources(id) on delete set null,
  meeting_location_override jsonb,                 -- surcharge de lieu, OPAQUE
  version                   int not null default 1,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
alter table public.sched_targets enable row level security;

create index if not exists sched_targets_resource_idx
  on public.sched_targets (resource_id);

drop trigger if exists sched_targets_touch_updated_at on public.sched_targets;
create trigger sched_targets_touch_updated_at
  before update on public.sched_targets
  for each row execute function public.touch_updated_at();

-- ── Liens de réservation nominatifs ───────────────────────────────────
-- Token 128 bits (base64url), à USAGE UNIQUE, expirable et RÉVOCABLE — un
-- classement sans suite peut tuer un lien, ce que Cal.com ne permettait pas.
-- `context` : charge utile de l'hôte, restituée telle quelle dans les
-- événements. `display` : ce que la page publique a le DROIT d'afficher
-- (fourni par l'hôte, jamais déduit du contexte — le contexte ne fuit pas).
create table if not exists public.sched_booking_links (
  token           text primary key,
  target_id       uuid not null references public.sched_targets(id) on delete cascade,
  -- IDEMPOTENCE : ré-émettre avec la même clé rend le MÊME token (le
  -- re-preview HITL ne crée jamais un 2e lien ⇒ le relecteur voit le VRAI).
  idempotency_key text not null,
  status          text not null default 'active',
  expires_at      timestamptz,
  context         jsonb not null default '{}'::jsonb,
  display         jsonb not null default '{}'::jsonb,
  revoked_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sched_links_status_chk
    check (status in ('active', 'used', 'revoked', 'expired'))
);
alter table public.sched_booking_links enable row level security;

create unique index if not exists sched_links_target_key_idx
  on public.sched_booking_links (target_id, idempotency_key);

create index if not exists sched_links_target_active_idx
  on public.sched_booking_links (target_id)
  where status = 'active';

drop trigger if exists sched_booking_links_touch_updated_at on public.sched_booking_links;
create trigger sched_booking_links_touch_updated_at
  before update on public.sched_booking_links
  for each row execute function public.touch_updated_at();

-- ── Réservations ──────────────────────────────────────────────────────
-- `resource_id` et `meeting_location` sont FIGÉS à la confirmation : un RDV
-- est un engagement, il ne suit ni un re-pointage de cible ni un changement
-- de lieu ultérieur. Le déplacer est une replanification EXPLICITE.
create table if not exists public.sched_bookings (
  id                uuid primary key default gen_random_uuid(),
  link_token        text references public.sched_booking_links(token) on delete set null,
  target_id         uuid not null references public.sched_targets(id) on delete cascade,
  resource_id       uuid not null references public.sched_resources(id) on delete restrict,
  start_at          timestamptz not null,
  end_at            timestamptz not null,
  status            text not null default 'confirmed',
  cancelled_by      text,
  cancelled_reason  text,
  cancelled_at      timestamptz,
  rescheduled_from  uuid references public.sched_bookings(id) on delete set null,
  attendee_name     text not null,
  attendee_email    text not null,
  attendee_phone    text,
  attendee_timezone text not null,
  context           jsonb not null default '{}'::jsonb,  -- copie du lien
  meeting_location  jsonb,                               -- SNAPSHOT résolu
  manage_token      text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint sched_bookings_status_chk
    check (status in ('confirmed', 'cancelled')),
  constraint sched_bookings_cancelled_by_chk
    check (cancelled_by is null or cancelled_by in ('attendee', 'organizer')),
  constraint sched_bookings_window_chk check (end_at > start_at),
  -- Cohérence état ↔ dates garantie EN BASE (pas seulement dans la couche
  -- d'accès) — même exigence que vivier_preselections.
  constraint sched_bookings_cancel_coherence_chk check (
    (status = 'cancelled' and cancelled_at is not null)
    or (status = 'confirmed' and cancelled_at is null and cancelled_by is null)
  )
);
alter table public.sched_bookings enable row level security;

-- ATOMICITÉ DE LA RÉSERVATION. Deux candidats qui confirment le même créneau
-- ⇒ UN SEUL gagnant : l'INSERT est le claim (pas de SELECT-puis-INSERT, pas
-- de verrou applicatif), le perdant reçoit 23505 → verdict `slot_taken`.
create unique index if not exists sched_bookings_slot_claim_idx
  on public.sched_bookings (resource_id, start_at)
  where status = 'confirmed';

-- Le lien de gestion candidat est unique PARMI LES CONFIRMÉES : une
-- replanification REPORTE le token sur la nouvelle ligne (tout mail déjà reçu
-- par le candidat reste fonctionnel), l'ancienne ligne annulée le conserve
-- comme trace. La résolution privilégie la ligne confirmée.
create unique index if not exists sched_bookings_manage_token_confirmed_idx
  on public.sched_bookings (manage_token)
  where status = 'confirmed';

create index if not exists sched_bookings_manage_lookup_idx
  on public.sched_bookings (manage_token, created_at desc);

create index if not exists sched_bookings_target_idx
  on public.sched_bookings (target_id, start_at desc);

create index if not exists sched_bookings_link_idx
  on public.sched_bookings (link_token);

drop trigger if exists sched_bookings_touch_updated_at on public.sched_bookings;
create trigger sched_bookings_touch_updated_at
  before update on public.sched_bookings
  for each row execute function public.touch_updated_at();

-- ── Outbox d'événements ───────────────────────────────────────────────
-- Écrite DANS la séquence de l'effet, dispatchée APRÈS (best-effort), drainée
-- par le rail cron si le dispatch immédiat échoue. Livraison AT-LEAST-ONCE
-- assumée : l'idempotence est la responsabilité du CONSOMMATEUR (clé = id
-- d'événement) — même contrat que l'ancien webhook Cal.com.
-- `booking.updated` est déjà admis par le CHECK : réservé à la V2 (lien visio
-- unique généré après coup) pour qu'elle n'ait aucune contrainte à migrer.
create table if not exists public.sched_events (
  id            uuid primary key default gen_random_uuid(),
  type          text not null,
  booking_id    uuid not null references public.sched_bookings(id) on delete cascade,
  payload       jsonb not null,
  created_at    timestamptz not null default now(),
  dispatched_at timestamptz,
  attempts      int not null default 0,
  last_error    text,
  constraint sched_events_type_chk check (
    type in ('booking.created', 'booking.cancelled', 'booking.rescheduled', 'booking.updated')
  )
);
alter table public.sched_events enable row level security;

create index if not exists sched_events_pending_idx
  on public.sched_events (created_at)
  where dispatched_at is null;

-- Sert la RÉPARATION du drain : « réservation confirmée sans booking.created »
-- ⇒ émission de rattrapage (crash entre le claim et l'écriture de l'outbox).
create index if not exists sched_events_booking_type_idx
  on public.sched_events (booking_id, type);

-- ── Limitation de débit des surfaces publiques (lot 2) ────────────────
-- Les pages de réservation sont ANONYMES : leur seule authentification est le
-- jeton d'URL. Un compteur EN MÉMOIRE DE PROCESS n'y protégerait rien — c'est
-- la leçon du double mail (chaque invocation serverless est une instance
-- isolée, la SEULE chose partagée entre elles est la base). Le compteur vit
-- donc ici.
--
-- Fenêtre FIXE : la clé porte le début de fenêtre, donc changer la durée d'une
-- fenêtre ne corrompt rien (les anciennes lignes expirent d'elles-mêmes).
-- Purge rattachée au drain d'événements existant — pas de mécanisme dédié.
create table if not exists public.sched_rate_limits (
  bucket_key   text        not null,   -- « action:portée:valeur », opaque
  window_start timestamptz not null,
  hits         int         not null default 0,
  primary key (bucket_key, window_start)
);
alter table public.sched_rate_limits enable row level security;

create index if not exists sched_rate_limits_window_idx
  on public.sched_rate_limits (window_start);

-- Incrément ATOMIQUE + verdict, en un seul aller-retour. Un
-- SELECT-puis-UPDATE laisserait passer les rafales concurrentes : c'est
-- précisément ce qu'on cherche à arrêter. `true` = requête autorisée.
create or replace function public.sched_rate_limit_hit(
  p_key          text,
  p_window_start timestamptz,
  p_limit        int
) returns boolean
language plpgsql
as $$
declare
  v_hits int;
begin
  insert into public.sched_rate_limits (bucket_key, window_start, hits)
  values (p_key, p_window_start, 1)
  on conflict (bucket_key, window_start)
    do update set hits = public.sched_rate_limits.hits + 1
  returning hits into v_hits;

  return v_hits <= p_limit;
end
$$;

-- ══════════════════════════════════════════════════════════════════════
-- INTÉGRATION ORQA DU MODULE DE RÉSERVATION — lot 3, août 2026
-- Spec de référence : docs/specs/scheduling-module.md §8
-- ══════════════════════════════════════════════════════════════════════
-- Deux colonnes, rien de plus : le module apporte ses propres tables
-- (`sched_*`), l'hôte n'a besoin que de savoir QUELLE campagne réserve en
-- natif et de QUELLE identité visuelle habiller les pages candidat.

-- Flag de coexistence PAR CAMPAGNE. Défaut `false` ⇒ toutes les campagnes
-- existantes repartent sur la chaîne Cal.com à l'identique : la migration est
-- douce par construction, aucun backfill.
-- ⚠️ Écrit UNIQUEMENT par PATCH /api/campaigns/[id] — délibérément absent de
-- `campaignToRow` (le PUT snapshot ne doit jamais le dégrader depuis un
-- client dont le store est antérieur à l'activation).
alter table public.campaigns
  add column if not exists scheduling_native boolean not null default false;

-- Identité du cabinet (logo + couleur d'accent) injectée dans le branding des
-- pages candidat et des mails du module. Le NOM d'organisation n'est PAS ici :
-- il vit déjà dans `interview_config.organisationName` (source canonique) —
-- en créer un troisième exemplaire serait une source de vérité de plus.
alter table public.app_settings
  add column if not exists branding_config jsonb not null default '{}'::jsonb;

-- Idempotence de la consommation des ÉVÉNEMENTS de réservation natifs.
-- L'outbox du module livre at-least-once (un dispatch qui réussit son effet
-- puis échoue à marquer sa ligne sera rejoué par le drain) : le consommateur
-- se protège par un claim DEUX PHASES sur `event.id`, mêmes règles que
-- `claims-policy` — posé avant l'effet, `confirmed_at` après.
-- Table DISTINCTE de `calcom_webhook_events` : celle-là disparaît à la
-- décommission (lot 5), celle-ci reste.
create table if not exists public.interview_booking_events (
  event_id     text primary key,
  event_type   text not null,
  processed_at timestamptz not null default now(),
  confirmed_at timestamptz
);
alter table public.interview_booking_events enable row level security;

-- ──────────────────────────────────────────────────────────────────────
-- Conformité RGPD — plus AUCUN refus envoyé sans validation humaine
-- ──────────────────────────────────────────────────────────────────────
-- La zone sous le seuil bas n'envoie plus : elle met en file. Elle porte donc
-- une zone à elle, `proposed_reject`, distincte de `auto_reject` — cette
-- dernière devient LEGACY (les refus réellement partis tout seuls, avant la
-- bascule). Les confondre réécrirait l'histoire : chaque refus automatique
-- passé basculerait rétroactivement en « en attente » dans les rapports.
--
-- ⚠️ BLOC CANONIQUE de la contrainte (règle « état final ») : on met à jour LA
-- définition existante — drop + add, jamais un second bloc empilé.
alter table public.candidate_analyses
  drop constraint if exists candidate_analyses_decision_zone_chk;
alter table public.candidate_analyses
  add constraint candidate_analyses_decision_zone_chk
  check (decision_zone is null
         or decision_zone in ('auto_reject', 'proposed_reject', 'gray', 'auto_accept'));

-- Le « seuil de proposition de refus » EST le seuil bas (`threshold_low`) :
-- sous cette barre, la candidature est proposée au refus. Une colonne dédiée a
-- existé quelques heures — elle bornait une sous-file À L'INTÉRIEUR de la zone
-- grise, ce qui ne supprimait aucun envoi automatique. Contresens, supprimée.
alter table public.campaigns
  drop constraint if exists campaigns_rejection_proposal_chk;
alter table public.campaigns
  drop column if exists rejection_proposal_threshold;
