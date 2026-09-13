-- ══════════════════════════════════════════════════════════════════════
-- CONTRÔLE POSITIF — module Sourcing, lot 1 (bloc « MODULE SOURCING » de
-- scripts/migrate.sql). À exécuter dans l'éditeur SQL Supabase APRÈS la double
-- application de migrate.sql.
-- ══════════════════════════════════════════════════════════════════════
-- Rend UN tableau (verdict, contrôle). Attendu : aucune ligne KO.
--
-- Deux familles de contrôles :
--   1. CATALOGUE — les tables, colonnes, contraintes, index, déclencheurs et
--      actions de clé étrangère existent tels que le bloc les déclare ;
--   2. COMPORTEMENT — chaque contrainte REFUSE ce qu'elle doit refuser et
--      ACCEPTE le parcours nominal. Un contrôle qui vérifierait seulement la
--      présence d'un nom de contrainte passerait sur une contrainte vide.
--
-- AUCUN RÉSIDU : toutes les écritures du §2 ont lieu dans un sous-bloc qui se
-- termine par une exception volontaire — PostgreSQL annule tout ce qu'il a
-- écrit. Rejouable à volonté, sur n'importe quel environnement.
--
-- Rappel : après application, recharger le cache PostgREST (Dashboard →
-- Settings → API → Reload schema cache), sinon l'application verra les tables
-- comme absentes alors que ce contrôle est vert.

drop table if exists pg_temp.sourcing_check;
create temp table sourcing_check (n serial, verdict text, controle text);

-- Exécute une instruction qui DOIT être refusée avec le code SQLSTATE attendu.
create or replace function pg_temp.sc_rejects(label text, stmt text, expected text)
returns text language plpgsql as $fn$
begin
  begin
    execute stmt;
    return 'KO|' || label || ' — accepté alors qu''il devait être refusé';
  exception when others then
    if sqlstate = expected then
      return 'OK|' || label || ' (refusé, ' || sqlstate || ')';
    end if;
    return 'KO|' || label || ' — refusé avec ' || sqlstate || ' au lieu de ' || expected || ' : ' || sqlerrm;
  end;
end;
$fn$;

-- Exécute une instruction qui DOIT réussir.
create or replace function pg_temp.sc_accepts(label text, stmt text)
returns text language plpgsql as $fn$
begin
  execute stmt;
  return 'OK|' || label;
exception when others then
  return 'KO|' || label || ' — refusé : ' || sqlstate || ' ' || sqlerrm;
end;
$fn$;

create or replace function pg_temp.sc(label text, ok boolean)
returns text language sql as $fn$
  select case when coalesce(ok, false) then 'OK|' else 'KO|' end || label;
$fn$;

do $$
declare
  res   text[] := '{}';
  camp  text   := 'CAMP-CHECK-SOURCING-LOT1';
  fp    text   := repeat('a', 64);
  fp2   text   := repeat('b', 64);
  th    text   := repeat('c', 64);
  s_id  uuid;
  p_id  uuid;
  a_id  uuid;
  cnt   int;
  txt   text;
begin
  -- ── 1. CATALOGUE ────────────────────────────────────────────────────
  res := res || pg_temp.sc('table sourcing_searches',   to_regclass('public.sourcing_searches')   is not null);
  res := res || pg_temp.sc('table sourcing_profiles',   to_regclass('public.sourcing_profiles')   is not null);
  res := res || pg_temp.sc('table sourcing_exclusions', to_regclass('public.sourcing_exclusions') is not null);
  res := res || pg_temp.sc('table sourcing_approaches', to_regclass('public.sourcing_approaches') is not null);

  -- Sans les tables, la suite échouerait sur une erreur au lieu de rendre un
  -- verdict : on s'arrête là, en le disant.
  if to_regclass('public.sourcing_searches') is null or to_regclass('public.sourcing_profiles') is null
     or to_regclass('public.sourcing_exclusions') is null or to_regclass('public.sourcing_approaches') is null then
    res := res || 'KO|tables manquantes : bloc non appliqué, contrôles suivants non exécutés'::text;
    insert into sourcing_check (verdict, controle)
    select split_part(x, '|', 1), substr(x, position('|' in x) + 1) from unnest(res) as x;
    return;
  end if;

  select count(*) into cnt from pg_class
   where oid in ('public.sourcing_searches'::regclass, 'public.sourcing_profiles'::regclass,
                 'public.sourcing_exclusions'::regclass, 'public.sourcing_approaches'::regclass)
     and relrowsecurity;
  res := res || pg_temp.sc('RLS activée sur les 4 tables (' || cnt || '/4)', cnt = 4);

  select count(*) into cnt from pg_constraint
   where conname in (
     'sourcing_searches_query_method_chk', 'sourcing_searches_language_chk', 'sourcing_searches_counts_chk',
     'sourcing_profiles_state_chk', 'sourcing_profiles_decision_chk', 'sourcing_profiles_rank_chk',
     'sourcing_profiles_fingerprint_chk', 'sourcing_profiles_snapshot_chk',
     'sourcing_exclusions_reason_chk', 'sourcing_exclusions_scope_chk', 'sourcing_exclusions_fingerprint_chk',
     'sourcing_approaches_channel_chk', 'sourcing_approaches_note_length_chk', 'sourcing_approaches_token_hash_chk',
     'sourcing_approaches_fingerprint_chk', 'sourcing_approaches_status_chk', 'sourcing_approaches_submission_chk',
     'sourcing_approaches_purged_chk',
     'recruiters_sourcing_message_format_chk', 'app_settings_sourcing_config_chk')
     and contype = 'c';
  res := res || pg_temp.sc('20 contraintes CHECK présentes, une seule fois chacune (' || cnt || '/20)', cnt = 20);

  select count(*) into cnt from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname in ('sourcing_profiles_campaign_fp_idx', 'sourcing_exclusions_fp_scope_idx',
                       'sourcing_approaches_token_hash_idx')
     and i.indisunique;
  res := res || pg_temp.sc('3 index uniques (' || cnt || '/3)', cnt = 3);

  select count(*) into cnt from pg_class
   where relkind = 'i' and relname in (
     'sourcing_searches_campaign_idx', 'sourcing_profiles_search_rank_idx', 'sourcing_profiles_fingerprint_idx',
     'sourcing_approaches_campaign_idx', 'sourcing_approaches_recruiter_idx', 'sourcing_approaches_fingerprint_idx',
     'sourcing_approaches_profile_idx', 'sourcing_approaches_pending_idx');
  res := res || pg_temp.sc('8 index de lecture (' || cnt || '/8)', cnt = 8);

  select count(*) into cnt from pg_trigger
   where not tgisinternal
     and tgname in ('sourcing_profiles_touch_updated_at', 'sourcing_approaches_touch_updated_at');
  res := res || pg_temp.sc('2 déclencheurs updated_at, sans doublon (' || cnt || '/2)', cnt = 2);

  select attgenerated::text into txt from pg_attribute
   where attrelid = 'public.sourcing_exclusions'::regclass and attname = 'scope';
  res := res || pg_temp.sc('sourcing_exclusions.scope est une colonne générée stockée', txt = 's');

  select confdeltype::text into txt from pg_constraint
   where conrelid = 'public.sourcing_approaches'::regclass and contype = 'f'
     and conkey = array[(select attnum from pg_attribute where attrelid = 'public.sourcing_approaches'::regclass and attname = 'profile_id')];
  res := res || pg_temp.sc('approches.profile_id : ON DELETE SET NULL (l''approche survit au profil)', txt = 'n');

  select count(*) into cnt from pg_constraint
   where contype = 'f' and confdeltype = 'c'
     and conrelid in ('public.sourcing_searches'::regclass, 'public.sourcing_profiles'::regclass,
                      'public.sourcing_exclusions'::regclass, 'public.sourcing_approaches'::regclass);
  res := res || pg_temp.sc('5 clés étrangères ON DELETE CASCADE (' || cnt || '/5)', cnt = 5);

  res := res || pg_temp.sc('recruiters.sourcing_message_format',
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'recruiters' and column_name = 'sourcing_message_format'));
  res := res || pg_temp.sc('recruiters.sourcing_available_first NOT NULL DEFAULT true',
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'recruiters' and column_name = 'sourcing_available_first'
               and is_nullable = 'NO' and column_default = 'true'));
  res := res || pg_temp.sc('app_settings.sourcing_config (jsonb)',
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'app_settings' and column_name = 'sourcing_config'
               and data_type = 'jsonb'));

  -- ── 2. COMPORTEMENT (tout est annulé en fin de sous-bloc) ───────────
  begin
    insert into public.campaigns (id, name, status, fdp)
    values (camp, 'Contrôle sourcing (annulé)', 'active', '{}'::jsonb);

    -- Recherches
    insert into public.sourcing_searches (campaign_id, query, query_generated, query_method, language, requested, returned, new_after_dedup)
    values (camp, 'q', 'q', 'llm', 'fr', 100, 100, 90) returning id into s_id;
    res := res || pg_temp.sc('recherche nominale acceptée', s_id is not null);
    res := res || pg_temp.sc_rejects('recherche : plus de 100 résultats demandés',
      format($q$insert into public.sourcing_searches (campaign_id, query, query_generated, query_method, language, requested, returned, new_after_dedup)
                values (%L, 'q', 'q', 'llm', 'fr', 101, 0, 0)$q$, camp), '23514');
    res := res || pg_temp.sc_rejects('recherche : plus de nouveaux que de reçus',
      format($q$insert into public.sourcing_searches (campaign_id, query, query_generated, query_method, language, requested, returned, new_after_dedup)
                values (%L, 'q', 'q', 'llm', 'fr', 100, 10, 11)$q$, camp), '23514');
    res := res || pg_temp.sc_rejects('recherche : méthode inconnue',
      format($q$insert into public.sourcing_searches (campaign_id, query, query_generated, query_method, language, requested, returned, new_after_dedup)
                values (%L, 'q', 'q', 'manual', 'fr', 100, 10, 1)$q$, camp), '23514');

    -- Profils
    insert into public.sourcing_profiles (campaign_id, search_id, fingerprint, exa_rank, exa_snapshot)
    values (camp, s_id, fp, 1, '{"name":"Témoin"}'::jsonb) returning id into p_id;
    res := res || pg_temp.sc('profil nominal accepté (état par défaut : reserve)',
      (select state = 'reserve' from public.sourcing_profiles where id = p_id));
    res := res || pg_temp.sc_rejects('profil : « declined » n''est pas un état (la ligne se supprime)',
      format($q$insert into public.sourcing_profiles (campaign_id, search_id, fingerprint, exa_rank, exa_snapshot, state)
                values (%L, %L, %L, 2, '{}', 'declined')$q$, camp, s_id, fp2), '23514');
    res := res || pg_temp.sc_rejects('profil : même empreinte deux fois sur la campagne',
      format($q$insert into public.sourcing_profiles (campaign_id, search_id, fingerprint, exa_rank, exa_snapshot)
                values (%L, %L, %L, 3, '{}')$q$, camp, s_id, fp), '23505');
    res := res || pg_temp.sc_rejects('profil : empreinte qui n''est pas un SHA-256 hexadécimal',
      format($q$insert into public.sourcing_profiles (campaign_id, search_id, fingerprint, exa_rank, exa_snapshot)
                values (%L, %L, 'https://www.linkedin.com/in/x', 4, '{}')$q$, camp, s_id), '23514');
    res := res || pg_temp.sc_rejects('profil : instantané qui n''est pas un objet',
      format($q$insert into public.sourcing_profiles (campaign_id, search_id, fingerprint, exa_rank, exa_snapshot)
                values (%L, %L, %L, 5, '[]')$q$, camp, s_id, fp2), '23514');
    res := res || pg_temp.sc_rejects('profil : rang hors 1..100',
      format($q$insert into public.sourcing_profiles (campaign_id, search_id, fingerprint, exa_rank, exa_snapshot)
                values (%L, %L, %L, 0, '{}')$q$, camp, s_id, fp2), '23514');
    res := res || pg_temp.sc_rejects('profil : contacté sans auteur ni date',
      format($q$update public.sourcing_profiles set state = 'contacted' where id = %L$q$, p_id), '23514');
    res := res || pg_temp.sc_accepts('profil : contacté avec auteur et date',
      format($q$update public.sourcing_profiles set state = 'contacted', decided_at = now(), decided_by_user_id = gen_random_uuid() where id = %L$q$, p_id));

    -- Exclusions
    res := res || pg_temp.sc_accepts('exclusion de campagne (declined)',
      format($q$insert into public.sourcing_exclusions (fingerprint, campaign_id, reason) values (%L, %L, 'declined')$q$, fp2, camp));
    res := res || pg_temp.sc_accepts('opposition globale (campaign_id NULL)',
      format($q$insert into public.sourcing_exclusions (fingerprint, campaign_id, reason) values (%L, null, 'opposed')$q$, fp2));
    res := res || pg_temp.sc('opposition : portée « * »',
      (select scope = '*' from public.sourcing_exclusions where fingerprint = fp2 and campaign_id is null));
    res := res || pg_temp.sc_rejects('opposition en double pour la même empreinte',
      format($q$insert into public.sourcing_exclusions (fingerprint, campaign_id, reason) values (%L, null, 'opposed')$q$, fp2), '23505');
    res := res || pg_temp.sc_rejects('opposition rattachée à une campagne',
      format($q$insert into public.sourcing_exclusions (fingerprint, campaign_id, reason) values (%L, %L, 'opposed')$q$, fp, camp), '23514');
    res := res || pg_temp.sc_rejects('exclusion non globale sans campagne',
      format($q$insert into public.sourcing_exclusions (fingerprint, campaign_id, reason) values (%L, null, 'declined')$q$, fp), '23514');
    res := res || pg_temp.sc_accepts('contacté → manifesté par upsert sur (fingerprint, scope)',
      format($q$insert into public.sourcing_exclusions (fingerprint, campaign_id, reason) values (%L, %L, 'contacted')
                on conflict (fingerprint, scope) do update set reason = 'manifested'$q$, fp2, camp));
    res := res || pg_temp.sc('upsert : une seule ligne de campagne, raison mise à jour',
      (select count(*) = 1 and bool_and(reason = 'manifested') from public.sourcing_exclusions where fingerprint = fp2 and campaign_id = camp));

    -- Approches
    insert into public.sourcing_approaches (campaign_id, profile_id, fingerprint, recruiter_id, channel, message_format, message, token_hash)
    values (camp, p_id, fp, gen_random_uuid(), 'linkedin', 'connection_note', 'Bonjour', th) returning id into a_id;
    res := res || pg_temp.sc('approche nominale acceptée (statut par défaut : active)',
      (select status = 'active' from public.sourcing_approaches where id = a_id));
    res := res || pg_temp.sc_rejects('approche : canal téléphone (hors périmètre)',
      format($q$insert into public.sourcing_approaches (campaign_id, fingerprint, recruiter_id, channel, message_format, token_hash)
                values (%L, %L, gen_random_uuid(), 'phone', 'connection_note', %L)$q$, camp, fp, repeat('d', 64)), '23514');
    res := res || pg_temp.sc_rejects('approche : canal email avec un format LinkedIn',
      format($q$insert into public.sourcing_approaches (campaign_id, fingerprint, recruiter_id, channel, message_format, token_hash)
                values (%L, %L, gen_random_uuid(), 'email', 'inmail', %L)$q$, camp, fp, repeat('d', 64)), '23514');
    res := res || pg_temp.sc_rejects('approche : note de connexion de 301 caractères',
      format($q$insert into public.sourcing_approaches (campaign_id, fingerprint, recruiter_id, channel, message_format, message, token_hash)
                values (%L, %L, gen_random_uuid(), 'linkedin', 'connection_note', repeat('x', 301), %L)$q$, camp, fp, repeat('d', 64)), '23514');
    res := res || pg_temp.sc_rejects('approche : même jeton deux fois',
      format($q$insert into public.sourcing_approaches (campaign_id, fingerprint, recruiter_id, channel, message_format, token_hash)
                values (%L, %L, gen_random_uuid(), 'email', 'email', %L)$q$, camp, fp, th), '23505');
    res := res || pg_temp.sc_rejects('approche : jeton stocké en clair (pas un SHA-256)',
      format($q$insert into public.sourcing_approaches (campaign_id, fingerprint, recruiter_id, channel, message_format, token_hash)
                values (%L, %L, gen_random_uuid(), 'email', 'email', 'Zm9vYmFyYmF6')$q$, camp, fp), '23514');
    res := res || pg_temp.sc_rejects('approche : admission sans la saisie de la personne',
      format($q$update public.sourcing_approaches set status = 'admission_pending', submitted_at = now() where id = %L$q$, a_id), '23514');
    res := res || pg_temp.sc_accepts('approche : active → admission_pending (saisie + date)',
      format($q$update public.sourcing_approaches set status = 'admission_pending', submitted_at = now(), submission = '{"email":"t@exemple.fr"}' where id = %L$q$, a_id));
    res := res || pg_temp.sc_rejects('approche : soumise en gardant la saisie',
      format($q$update public.sourcing_approaches set status = 'submitted', analysis_id = 'can_src_' || id::text where id = %L$q$, a_id), '23514');
    res := res || pg_temp.sc_rejects('approche : soumise avec l''analyse d''une autre approche',
      format($q$update public.sourcing_approaches set status = 'submitted', submission = null, analysis_id = 'can_src_' || gen_random_uuid()::text where id = %L$q$, a_id), '23514');
    res := res || pg_temp.sc_accepts('approche : admission_pending → submitted (saisie effacée, analyse can_src_<id>)',
      format($q$update public.sourcing_approaches set status = 'submitted', submission = null, analysis_id = 'can_src_' || id::text where id = %L$q$, a_id));
    res := res || pg_temp.sc_rejects('approche : purgée en gardant le message',
      format($q$update public.sourcing_approaches set purged_at = now() where id = %L$q$, a_id), '23514');
    res := res || pg_temp.sc_accepts('approche : purgée, message vidé',
      format($q$update public.sourcing_approaches set purged_at = now(), message = null where id = %L$q$, a_id));

    -- Suppressions : le profil part, l'approche reste ; la campagne part, tout part sauf l'opposition.
    delete from public.sourcing_profiles where id = p_id;
    res := res || pg_temp.sc('profil supprimé ⇒ approche conservée, profile_id NULL',
      (select profile_id is null from public.sourcing_approaches where id = a_id));

    -- Une mise à jour qui ne touche aucune ligne ne prouverait rien : sans
    -- recruteur ni réglage en base, le contrôle le DIT au lieu de passer.
    if exists (select 1 from public.recruiters) then
      res := res || pg_temp.sc_rejects('préférence recruteur : format inconnu',
        $q$update public.recruiters set sourcing_message_format = 'sms' where id = (select id from public.recruiters limit 1)$q$, '23514');
    else
      res := res || 'KO|préférence recruteur : aucun recruteur en base, contrainte non sondée'::text;
    end if;
    if exists (select 1 from public.app_settings where id = 1) then
      res := res || pg_temp.sc_rejects('réglage cabinet : sourcing_config qui n''est pas un objet',
        $q$update public.app_settings set sourcing_config = '[]'::jsonb where id = 1$q$, '23514');
    else
      res := res || 'KO|réglage cabinet : aucune ligne app_settings, contrainte non sondée'::text;
    end if;

    delete from public.campaigns where id = camp;
    res := res || pg_temp.sc('campagne supprimée ⇒ recherches, profils, approches et exclusions de campagne supprimés',
      not exists (select 1 from public.sourcing_searches where campaign_id = camp)
      and not exists (select 1 from public.sourcing_approaches where campaign_id = camp)
      and not exists (select 1 from public.sourcing_exclusions where campaign_id = camp));
    res := res || pg_temp.sc('campagne supprimée ⇒ opposition globale conservée',
      exists (select 1 from public.sourcing_exclusions where fingerprint = fp2 and campaign_id is null));

    raise exception using message = 'sourcing_check_rollback';
  exception when others then
    if sqlerrm <> 'sourcing_check_rollback' then
      res := res || ('KO|sonde interrompue avant la fin : ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  insert into sourcing_check (verdict, controle)
  select split_part(x, '|', 1), substr(x, position('|' in x) + 1) from unnest(res) as x;
end $$;

select verdict, controle from sourcing_check order by (verdict = 'OK'), n;
