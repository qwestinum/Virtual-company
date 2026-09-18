-- ══════════════════════════════════════════════════════════════════════
-- CONTRÔLE POSITIF — compte rendu d'entretien + commentaire du recruteur,
-- lot 1 (bloc « COMPTE RENDU D'ENTRETIEN » de scripts/migrate.sql).
-- À exécuter dans l'éditeur SQL Supabase APRÈS la double application de
-- migrate.sql.
-- ══════════════════════════════════════════════════════════════════════
-- Rend UN tableau (verdict, contrôle). Attendu : aucune ligne KO.
--
-- Deux familles de contrôles :
--   1. CATALOGUE — tables, colonnes, contraintes, index, déclencheurs et
--      actions de clé étrangère existent tels que le bloc les déclare ;
--   2. COMPORTEMENT — chaque contrainte REFUSE ce qu'elle doit refuser et
--      ACCEPTE le parcours nominal. Présence d'un nom ≠ contrainte qui mord.
--
-- AUCUN RÉSIDU : les écritures du §2 ont lieu dans un sous-bloc terminé par
-- une exception volontaire — PostgreSQL annule tout. Rejouable à volonté.
--
-- Rappel : après application, recharger le cache PostgREST (Dashboard →
-- Settings → API → Reload schema cache).

drop table if exists pg_temp.interview_report_check;
create temp table interview_report_check (n serial, verdict text, controle text);

create or replace function pg_temp.ir_rejects(label text, stmt text, expected text)
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

create or replace function pg_temp.ir_accepts(label text, stmt text)
returns text language plpgsql as $fn$
begin
  execute stmt;
  return 'OK|' || label;
exception when others then
  return 'KO|' || label || ' — refusé : ' || sqlstate || ' ' || sqlerrm;
end;
$fn$;

create or replace function pg_temp.ir(label text, ok boolean)
returns text language sql as $fn$
  select case when coalesce(ok, false) then 'OK|' else 'KO|' end || label;
$fn$;

do $$
declare
  res   text[] := '{}';
  an    text   := 'can_check_interview_report_lot1';
  an2   text   := 'can_check_interview_report_lot1_b';
  who   uuid   := gen_random_uuid();
  r_id  uuid;
  c_id  uuid;
  b_id  uuid;
  cnt   int;
  txt   text;
  body_ok text := 'Solide sur la recette et le pilotage, réserves sur la mobilité géographique.';
begin
  -- ── 1. CATALOGUE ────────────────────────────────────────────────────
  res := res || pg_temp.ir('table interview_reports', to_regclass('public.interview_reports') is not null);
  res := res || pg_temp.ir('table verdict_comments',  to_regclass('public.verdict_comments')  is not null);

  if to_regclass('public.interview_reports') is null or to_regclass('public.verdict_comments') is null then
    res := res || 'KO|tables manquantes : bloc non appliqué, contrôles suivants non exécutés'::text;
    insert into interview_report_check (verdict, controle)
    select split_part(x, '|', 1), substr(x, position('|' in x) + 1) from unnest(res) as x;
    return;
  end if;

  select count(*) into cnt from pg_class
   where oid in ('public.interview_reports'::regclass, 'public.verdict_comments'::regclass)
     and relrowsecurity;
  res := res || pg_temp.ir('RLS activée sur les 2 tables (' || cnt || '/2)', cnt = 2);

  select count(*) into cnt from pg_constraint
   where conname in (
     'interview_reports_source_chk', 'interview_reports_status_chk', 'interview_reports_verified_chk',
     'interview_reports_round_chk', 'interview_reports_sections_chk', 'interview_reports_generation_chk',
     'verdict_comments_verdict_chk', 'verdict_comments_body_chk')
     and contype = 'c';
  res := res || pg_temp.ir('8 contraintes CHECK présentes, une seule fois chacune (' || cnt || '/8)', cnt = 8);

  select count(*) into cnt from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'interview_reports_analysis_round_idx' and i.indisunique;
  res := res || pg_temp.ir('index unique (analyse, tour)', cnt = 1);

  select count(*) into cnt from pg_class
   where relkind = 'i' and relname in ('interview_reports_campaign_idx', 'verdict_comments_analysis_idx');
  res := res || pg_temp.ir('2 index de lecture (' || cnt || '/2)', cnt = 2);

  select count(*) into cnt from pg_trigger
   where not tgisinternal
     and tgname in ('interview_reports_touch_updated_at', 'verdict_comments_no_update');
  res := res || pg_temp.ir('2 déclencheurs, sans doublon (' || cnt || '/2)', cnt = 2);

  select attgenerated::text into txt from pg_attribute
   where attrelid = 'public.interview_reports'::regclass and attname = 'search_text';
  res := res || pg_temp.ir('interview_reports.search_text est une colonne générée stockée', txt = 's');

  select count(*) into cnt from pg_constraint
   where contype = 'f' and confdeltype = 'c'
     and confrelid = 'public.candidate_analyses'::regclass
     and conrelid in ('public.interview_reports'::regclass, 'public.verdict_comments'::regclass);
  res := res || pg_temp.ir('2 clés étrangères vers l''analyse ON DELETE CASCADE (' || cnt || '/2)', cnt = 2);

  select confdeltype::text into txt from pg_constraint
   where conrelid = 'public.interview_reports'::regclass and contype = 'f'
     and confrelid = 'public.interview_briefs'::regclass;
  res := res || pg_temp.ir('interview_reports.brief_id : ON DELETE SET NULL (le CR survit au briefing)', txt = 'n');

  -- Aucune colonne ne peut recevoir une transcription : la liste est FERMÉE.
  select count(*) into cnt from information_schema.columns
   where table_schema = 'public' and table_name = 'interview_reports'
     and column_name not in ('id', 'analysis_id', 'uid', 'campaign_id', 'brief_id', 'round', 'source',
       'status', 'sections', 'search_text', 'generated_model', 'omitted_count', 'created_by_user_id',
       'created_by_email', 'verified_by_user_id', 'verified_by_email', 'verified_at', 'created_at', 'updated_at');
  res := res || pg_temp.ir('interview_reports : aucune colonne hors liste déclarée (' || cnt || ' en trop)', cnt = 0);

  -- ── 2. COMPORTEMENT (tout est annulé en fin de sous-bloc) ───────────
  begin
    insert into public.candidate_analyses (id, uid, candidate_name, file_name, source, received_at,
      total_score, status, criteria_version, computed_at, application)
    values
      (an,  'uid-check-a', 'Témoin A', 'a.pdf', 'upload', now(), 80, 'accepted', 'v', now(), '{}'),
      (an2, 'uid-check-b', 'Témoin B', 'b.pdf', 'upload', now(), 80, 'accepted', 'v', now(), '{}');
    insert into public.interview_briefs (candidate_name, uid) values ('Témoin A', 'uid-check-a')
      returning id into b_id;

    -- Compte rendu
    insert into public.interview_reports (analysis_id, uid, brief_id, source, sections, created_by_user_id)
    values (an, 'uid-check-a', b_id, 'manual', '{"topics":"Parcours et motivations"}', who)
    returning id into r_id;
    res := res || pg_temp.ir('CR manuel nominal accepté (brouillon par défaut)',
      (select status = 'draft' from public.interview_reports where id = r_id));
    res := res || pg_temp.ir('search_text reflète les rubriques',
      (select search_text like '%Parcours et motivations%' from public.interview_reports where id = r_id));
    res := res || pg_temp.ir_rejects('CR : second CR pour le même tour',
      format($q$insert into public.interview_reports (analysis_id, uid, source) values (%L, 'uid-check-a', 'manual')$q$, an), '23505');
    res := res || pg_temp.ir_accepts('CR : tour 2 pour la même candidature',
      format($q$insert into public.interview_reports (analysis_id, uid, source, round) values (%L, 'uid-check-a', 'manual', 2)$q$, an));
    res := res || pg_temp.ir_rejects('CR : tour 0',
      format($q$insert into public.interview_reports (analysis_id, uid, source, round) values (%L, 'uid-check-a', 'manual', 0)$q$, an2), '23514');
    res := res || pg_temp.ir_rejects('CR : source inconnue',
      format($q$insert into public.interview_reports (analysis_id, uid, source) values (%L, 'uid-check-b', 'ai')$q$, an2), '23514');
    res := res || pg_temp.ir_rejects('CR : rubriques qui ne sont pas un objet',
      format($q$insert into public.interview_reports (analysis_id, uid, source, sections) values (%L, 'uid-check-b', 'manual', '[]')$q$, an2), '23514');
    res := res || pg_temp.ir_rejects('CR manuel portant un modèle de génération',
      format($q$insert into public.interview_reports (analysis_id, uid, source, generated_model) values (%L, 'uid-check-b', 'manual', 'gpt-4o')$q$, an2), '23514');
    res := res || pg_temp.ir_rejects('CR : nombre de passages écartés négatif',
      format($q$insert into public.interview_reports (analysis_id, uid, source, omitted_count) values (%L, 'uid-check-b', 'transcript', -1)$q$, an2), '23514');
    res := res || pg_temp.ir_rejects('CR : vérifié sans date ni auteur',
      format($q$update public.interview_reports set status = 'verified' where id = %L$q$, r_id), '23514');
    res := res || pg_temp.ir_rejects('CR : date de vérification sur un brouillon',
      format($q$update public.interview_reports set verified_at = now(), verified_by_user_id = %L where id = %L$q$, who, r_id), '23514');
    res := res || pg_temp.ir_rejects('CR : vérifié sans auteur',
      format($q$update public.interview_reports set status = 'verified', verified_at = now() where id = %L$q$, r_id), '23514');
    res := res || pg_temp.ir_accepts('CR : brouillon → vérifié (auteur + date)',
      format($q$update public.interview_reports set status = 'verified', verified_at = now(), verified_by_user_id = %L where id = %L$q$, who, r_id));
    res := res || pg_temp.ir_accepts('CR issu d''une transcription (modèle + passages écartés)',
      format($q$insert into public.interview_reports (analysis_id, uid, source, generated_model, omitted_count) values (%L, 'uid-check-b', 'transcript', 'gpt-4o', 2)$q$, an2));

    -- Commentaire
    insert into public.verdict_comments (analysis_id, uid, verdict, body, author_user_id)
    values (an, 'uid-check-a', 'validated', body_ok, who) returning id into c_id;
    res := res || pg_temp.ir('commentaire nominal accepté', c_id is not null);
    res := res || pg_temp.ir_rejects('commentaire : « ok pour moi » (sous le plancher)',
      format($q$insert into public.verdict_comments (analysis_id, uid, verdict, body) values (%L, 'uid-check-a', 'rejected', 'ok pour moi')$q$, an), '23514');
    res := res || pg_temp.ir_rejects('commentaire : 50 espaces',
      format($q$insert into public.verdict_comments (analysis_id, uid, verdict, body) values (%L, 'uid-check-a', 'rejected', repeat(' ', 50))$q$, an), '23514');
    res := res || pg_temp.ir_accepts('commentaire : 15 mots de 2 lettres (44 caractères) passe le plancher',
      format($q$insert into public.verdict_comments (analysis_id, uid, verdict, body) values (%L, 'uid-check-a', 'rejected', %L)$q$,
        an, 'aa ab ac ad ae af ag ah ai aj ak al am an ao'));
    res := res || pg_temp.ir_rejects('commentaire : verdict « réserves » (pas un verdict)',
      format($q$insert into public.verdict_comments (analysis_id, uid, verdict, body) values (%L, 'uid-check-a', 'reserves', %L)$q$, an, body_ok), '23514');
    res := res || pg_temp.ir_rejects('commentaire : modification refusée (ajout seul)',
      format($q$update public.verdict_comments set body = body || ' — corrigé' where id = %L$q$, c_id), '42501');
    res := res || pg_temp.ir_accepts('commentaire : suppression possible (geste de la purge)',
      format($q$delete from public.verdict_comments where id = %L$q$, c_id));

    -- Suppressions : le briefing part, le CR reste ; l'analyse part, tout part.
    delete from public.interview_briefs where id = b_id;
    res := res || pg_temp.ir('briefing supprimé ⇒ CR conservé, brief_id NULL',
      (select brief_id is null from public.interview_reports where id = r_id));
    insert into public.verdict_comments (analysis_id, uid, verdict, body) values (an, 'uid-check-a', 'validated', body_ok);
    delete from public.candidate_analyses where id = an;
    res := res || pg_temp.ir('analyse supprimée ⇒ comptes rendus et commentaires supprimés',
      not exists (select 1 from public.interview_reports where analysis_id = an)
      and not exists (select 1 from public.verdict_comments where analysis_id = an));

    raise exception using message = 'interview_report_check_rollback';
  exception when others then
    if sqlerrm <> 'interview_report_check_rollback' then
      res := res || ('KO|sonde interrompue avant la fin : ' || sqlstate || ' ' || sqlerrm);
    end if;
  end;

  insert into interview_report_check (verdict, controle)
  select split_part(x, '|', 1), substr(x, position('|' in x) + 1) from unnest(res) as x;
end $$;

select verdict, controle from interview_report_check order by (verdict = 'OK'), n;
