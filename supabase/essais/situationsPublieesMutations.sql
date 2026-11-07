-- LES MUTATIONS DE `situationsPubliees.sql` (espace client, étape C4a ; la migration `situations_publiees`, PRÉPARÉE le
-- 06/11/2026, supabase/preparees/). Le récit : HISTORIQUE.md, « 06/11/2026 — LES SITUATIONS PUBLIÉES, EN BASE (C4A)
-- (PRÉPARÉE, PAS APPLIQUÉE) ». Un essai qui ne vire au rouge sur aucun défaut planté ne prouve rien : chaque mutation
-- plante un défaut dans la migration, rejoue l'essai ENTIER dans la même transaction, relit ses verdicts, puis s'annule.
-- Une mutation qui ne mord pas — aucun verdict en faute — accuse d'abord la mutation, puis l'essai.
--
-- SUR UNE RÉPLIQUE SEULEMENT, munie de la migration, par psql (des méta-commandes ; `\ir` lit l'essai à côté de ce
-- fichier), par le super-utilisateur : une garde de tête refuse de le jouer hors d'une réplique (ESSAI_HORS_REPLIQUE : le
-- rôle `proprietaire` manque à la production) ou sans la migration. Il remplace des fonctions et une policy le temps
-- d'une transaction annulée ; il ne laisse rien. La première passe, sans défaut, doit rendre 0 en faute : une suite rouge
-- AVANT la mutation ferait passer toute mutation pour tuée. Le tableau final : une ligne par passe.
\set ON_ERROR_STOP on
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : ces mutations remplacent des fonctions et ne se jouent que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.situations_publiees') is null then
    raise exception 'ESSAI_IMPOSSIBLE : la migration situations_publiees manque à cette réplique.';
  end if;
end $$;

create temp table mutations_situations (rang int, passe text, attendu text, en_faute int, rangs text);

-- Un défaut planté dans une fonction : son texte, une sous-chaîne remplacée ; une mutation sans effet s'arrête.
create function pg_temp.planter(p_fonction regprocedure, p_avant text, p_apres text) returns void
  language plpgsql as $f$
declare d text; n text;
begin
  d := pg_get_functiondef(p_fonction);
  n := replace(d, p_avant, p_apres);
  if n = d then
    raise exception 'MUTATION_SANS_EFFET : % ne contient pas le texte à remplacer.', p_fonction;
  end if;
  execute n;
end $f$;

-- ── 0. Sans défaut : 0 en faute ──
begin;
\o /dev/null
\ir situationsPubliees.sql
\o
select count(*) filter (where not v.ok) as en_faute, coalesce(string_agg(v.rang::text, ',' order by v.rang) filter (where not v.ok), '-') as rangs
  from jsonb_to_recordset(current_setting('essai.situations_publiees')::jsonb) as v(rang int, ok boolean) \gset m_
rollback;
insert into mutations_situations values (0, '0. sans défaut', 'aucun verdict en faute', :m_en_faute, :'m_rangs');

-- ── M1. La garde laisse passer une mise à jour ──
begin;
select pg_temp.planter('public.garder_situation_publiee()', $x$if tg_op = 'UPDATE' then$x$, $x$if tg_op = 'UPDATE' and false then$x$);
\o /dev/null
\ir situationsPubliees.sql
\o
select count(*) filter (where not v.ok) as en_faute, coalesce(string_agg(v.rang::text, ',' order by v.rang) filter (where not v.ok), '-') as rangs
  from jsonb_to_recordset(current_setting('essai.situations_publiees')::jsonb) as v(rang int, ok boolean) \gset m_
rollback;
insert into mutations_situations values (1, 'M1. la garde laisse passer une mise à jour', 'le rang 12 (le rôle des Edge Functions réécrit)', :m_en_faute, :'m_rangs');

-- ── M2. Le statut n'est plus lu d'exercices_valides : la base croit le contenu ──
begin;
select pg_temp.planter('public.publier_situation(uuid, date, jsonb, uuid)',
  $x$v_statut := case when exists (select 1 from public.exercices_valides e where e.dossier_id = p_dossier_id and e.annee = v_annee)
                   then 'validee' else 'provisoire' end;$x$,
  $x$v_statut := coalesce(p_contenu ->> 'statut', 'provisoire');$x$);
\o /dev/null
\ir situationsPubliees.sql
\o
select count(*) filter (where not v.ok) as en_faute, coalesce(string_agg(v.rang::text, ',' order by v.rang) filter (where not v.ok), '-') as rangs
  from jsonb_to_recordset(current_setting('essai.situations_publiees')::jsonb) as v(rang int, ok boolean) \gset m_
rollback;
insert into mutations_situations values (2, 'M2. le statut n''est plus lu d''exercices_valides', 'le rang 15 (« validee » sur un exercice ouvert, accepté)', :m_en_faute, :'m_rangs');

-- ── M3. La lecture « Comptes » rend plus que la situation en cours ──
begin;
alter policy situations_publiees_lecture_comptes on public.situations_publiees
  using (client_du_dossier(dossier_id, 'comptes') and geste = 'publication');
\o /dev/null
\ir situationsPubliees.sql
\o
select count(*) filter (where not v.ok) as en_faute, coalesce(string_agg(v.rang::text, ',' order by v.rang) filter (where not v.ok), '-') as rangs
  from jsonb_to_recordset(current_setting('essai.situations_publiees')::jsonb) as v(rang int, ok boolean) \gset m_
rollback;
insert into mutations_situations values (3, 'M3. la lecture « Comptes » rend les situations remplacées et retirées', 'les rangs 4 et 5, et le catalogue (31)', :m_en_faute, :'m_rangs');

-- ── M4. La publication ne vérifie plus le cabinet : un accès « Comptes » publie ──
begin;
select pg_temp.planter('public.publier_situation(uuid, date, jsonb, uuid)',
  $x$if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then$x$,
  $x$if p_dossier_id is null or not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'comptes')) then$x$);
\o /dev/null
\ir situationsPubliees.sql
\o
select count(*) filter (where not v.ok) as en_faute, coalesce(string_agg(v.rang::text, ',' order by v.rang) filter (where not v.ok), '-') as rangs
  from jsonb_to_recordset(current_setting('essai.situations_publiees')::jsonb) as v(rang int, ok boolean) \gset m_
rollback;
insert into mutations_situations values (4, 'M4. un accès « Comptes » publie', 'le rang 7', :m_en_faute, :'m_rangs');

-- ── M5. Les totaux ne sont plus confrontés aux postes ──
begin;
select pg_temp.planter('public.refus_des_chiffres_de_la_situation(jsonb, date, date)',
  $x$if (p_chiffres ->> 'recettes')::numeric <> v_recettes$x$, $x$if false and (p_chiffres ->> 'recettes')::numeric <> v_recettes$x$);
\o /dev/null
\ir situationsPubliees.sql
\o
select count(*) filter (where not v.ok) as en_faute, coalesce(string_agg(v.rang::text, ',' order by v.rang) filter (where not v.ok), '-') as rangs
  from jsonb_to_recordset(current_setting('essai.situations_publiees')::jsonb) as v(rang int, ok boolean) \gset m_
rollback;
insert into mutations_situations values (5, 'M5. les totaux ne sont plus la somme des postes', 'le rang 17', :m_en_faute, :'m_rangs');

-- ── M6. La forme à trois décoche « Comptes » au lieu de la laisser ──
-- (le cinquième argument de son appel, `p_comptes`, sous C4a comme sous B1, où l'appel en porte trois de plus)
begin;
select pg_temp.planter('public.changer_droits_acces(uuid, boolean, boolean)',
  $x$p_banque, null::boolean, null::boolean$x$, $x$p_banque, null::boolean, false$x$);
\o /dev/null
\ir situationsPubliees.sql
\o
select count(*) filter (where not v.ok) as en_faute, coalesce(string_agg(v.rang::text, ',' order by v.rang) filter (where not v.ok), '-') as rangs
  from jsonb_to_recordset(current_setting('essai.situations_publiees')::jsonb) as v(rang int, ok boolean) \gset m_
rollback;
insert into mutations_situations values (6, 'M6. la forme à trois décoche « Comptes »', 'le rang 27', :m_en_faute, :'m_rangs');

-- ── M7. La situation en cours se dit à tout compte connecté (le défaut que la relecture de sécurité du 06/11/2026 a relevé) ──
begin;
select pg_temp.planter('public.situation_publiee_en_cours(uuid)',
  $x$and (public.admin_du_dossier(s.dossier_id) or public.client_du_dossier(s.dossier_id, 'comptes'))$x$, $x$and true$x$);
\o /dev/null
\ir situationsPubliees.sql
\o
select count(*) filter (where not v.ok) as en_faute, coalesce(string_agg(v.rang::text, ',' order by v.rang) filter (where not v.ok), '-') as rangs
  from jsonb_to_recordset(current_setting('essai.situations_publiees')::jsonb) as v(rang int, ok boolean) \gset m_
rollback;
insert into mutations_situations values (7, 'M7. la situation en cours se dit à tout compte connecté', 'les rangs 35 et 36 (un accès sans la case, un compte sans accès)', :m_en_faute, :'m_rangs');

-- ── M8. La situation en cours se dit à tout accès au dossier, la case « Comptes » oubliée ──
begin;
select pg_temp.planter('public.situation_publiee_en_cours(uuid)',
  $x$public.client_du_dossier(s.dossier_id, 'comptes')$x$, $x$public.client_du_dossier(s.dossier_id, 'membre')$x$);
\o /dev/null
\ir situationsPubliees.sql
\o
select count(*) filter (where not v.ok) as en_faute, coalesce(string_agg(v.rang::text, ',' order by v.rang) filter (where not v.ok), '-') as rangs
  from jsonb_to_recordset(current_setting('essai.situations_publiees')::jsonb) as v(rang int, ok boolean) \gset m_
rollback;
insert into mutations_situations values (8, 'M8. la situation en cours se dit à tout accès au dossier', 'le rang 35 (un accès sans la case)', :m_en_faute, :'m_rangs');

select passe, attendu, en_faute || ' en faute (' || rangs || ')' as observe,
       case when rang = 0 then case when en_faute = 0 then 'la base est saine' else '*** L''ESSAI EST ROUGE SANS DÉFAUT ***' end
            when en_faute > 0 then 'la mutation mord' else '*** NE MORD PAS ***' end as verdict
from mutations_situations order by rang;
