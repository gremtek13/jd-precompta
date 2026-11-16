-- LE MEMBRE D'ÉQUIPE D'ESSAI : LES LECTURES DE LA SESSION (ESSAIS-Q1), avant et après le collage de creer.sql. Trois requêtes
-- en LECTURE SIMPLE (le garde-fou de MVP-D9 les laisse partir seules), chacune jouée à part par `execute_sql` ; aucune ne
-- rend une valeur d'un compte : des noms de colonnes, des booléens et des nombres.

-- ── 1. AVANT : les colonnes de auth.users, pour confronter la liste de creer.sql au service tel qu'il est ce jour-là ────────
-- Chaque colonne que creer.sql nomme doit y être ; chaque colonne NOT NULL sans défaut ni génération doit y être nommée ;
-- aucun déclencheur propre au projet sur la table. Un écart : reprendre creer.sql avant de le présenter.
select c.ordinal_position, c.column_name, c.data_type, c.is_nullable, c.is_generated, c.column_default is not null as a_un_defaut,
       (select count(*) from pg_catalog.pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal) as declencheurs
  from information_schema.columns c
 where c.table_schema = 'auth' and c.table_name = 'users'
 order by c.ordinal_position;

-- ── 2. APRÈS : le membre est ce que creer.sql dit, et rien de plus ─────────────────────────────────────────────────────────
-- Attendu : 1, vrai, vrai, vrai, 0, 0, 0, comptable, 1, 1, 0, 0.
select
  (select count(*) from auth.users where id = '3e3b0000-0000-4000-8000-000000000001') as compte,
  (select coalesce(encrypted_password, '') = '' from auth.users where id = '3e3b0000-0000-4000-8000-000000000001') as sans_mot_de_passe,
  (select email_confirmed_at is null from auth.users where id = '3e3b0000-0000-4000-8000-000000000001') as adresse_non_confirmee,
  (select banned_until > now() + interval '900 years' from auth.users where id = '3e3b0000-0000-4000-8000-000000000001') as banni,
  (select count(*) from auth.identities where user_id = '3e3b0000-0000-4000-8000-000000000001') as identites,
  (select count(*) from auth.sessions where user_id = '3e3b0000-0000-4000-8000-000000000001') as sessions,
  (select count(*) from auth.mfa_factors where user_id = '3e3b0000-0000-4000-8000-000000000001') as facteurs,
  (select string_agg(role, ',') from public.cabinet_admins where user_id = '3e3b0000-0000-4000-8000-000000000001') as role_dans_l_equipe,
  (select count(*) from public.dossier_assignations where user_id = '3e3b0000-0000-4000-8000-000000000001') as assignations,
  (select count(*) from public.dossier_assignations where user_id = '3e3b0000-0000-4000-8000-000000000001'
      and dossier_id = '001c7ed7-c23b-4590-901e-693489f8af24') as assigne_a_test,
  (select count(*) from public.memberships where user_id = '3e3b0000-0000-4000-8000-000000000001') as acces_client,
  (select count(*) from public.super_admins where user_id = '3e3b0000-0000-4000-8000-000000000001') as super_admin;

-- ── 3. APRÈS : aucune colonne de texte nulle chez le membre là où le service en écrit une chez le chef ──────────────────────
-- Le service lit ces colonnes comme du texte : une seule nulle rendrait la liste des comptes illisible. Attendu : aucune
-- ligne. Une ligne : la poser au texte vide (un `update` de cette seule colonne du seul membre, à coller par le cabinet).
select c.column_name
  from information_schema.columns c
 where c.table_schema = 'auth' and c.table_name = 'users' and c.data_type in ('character varying', 'text')
   and (select to_jsonb(u) -> c.column_name from auth.users u where u.id = '3e3b0000-0000-4000-8000-000000000001') = 'null'::jsonb
   and (select to_jsonb(u) -> c.column_name from auth.users u where u.id = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162') <> 'null'::jsonb
 order by c.ordinal_position;
