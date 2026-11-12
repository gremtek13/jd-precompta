-- LES EXERCICES DU DOSSIER (ligne 42, lot EXD2 ; la migration `exercices_du_dossier`, PRÉPARÉE le 12/11/2026,
-- supabase/preparees/20261112210000_exercices_du_dossier.sql). Le récit : HISTORIQUE.md, « 12/11/2026 — EXD2 : LES
-- EXERCICES DU DOSSIER, EN BASE (LIGNE 42) (PRÉPARÉE, PAS APPLIQUÉE) ».
-- SUR UNE RÉPLIQUE SEULEMENT : il prend le membre d'équipe fictif de la réplique, que la production n'a pas, pose une
-- validation et des exercices dans des dossiers jetables, et sa batterie appelle les lectures dix-huit mille fois. À rejouer
-- par psql (`-f`), sous le propriétaire, après toute migration qui touche `exercices`, ses gardes, ses fonctions,
-- `admin_du_dossier`, `dossiers.mode_comptable` ou la frontière de la validation.
--
-- Ce qui se prouve ici, chaque refus sous ses mots (le code et le message entiers) :
--   - le catalogue : la RLS et sa seule policy, les deux gardes (avant et après chaque ligne), les deux exclusions
--     différées, les droits d'exécution ;
--   - l'accès : le client d'essai et le membre d'équipe non assigné ne déclarent ni ne lisent rien, l'anonyme n'exécute rien ;
--   - un dossier en trésorerie ne déclare rien (les deux mots du module) ; chaque refus d'une ligne seule ; chaque refus de
--     la suite, dans l'ordre du module (le chevauchement avant le millésime, le trou avant le millésime) ;
--   - le chemin juste : un premier exercice décalé, un ordinaire, une transition d'un changement de clôture, une transition
--     d'un jour, les lectures qui les rendent ; la période figée par une validation (civile avant EXD3) et ce qu'elle refuse ;
--   - la restauration : plusieurs exercices d'un seul lot, dans le désordre, l'auteur gardé ; le trou d'un lot en deux ;
--   - la batterie civile : `bornes_de_l_exercice` et `exercice_de_la_date` rendent EXACTEMENT l'année civile, jour par jour,
--     pour chaque dossier en trésorerie de la réplique et pour un dossier en engagement qui n'a rien déclaré, sur dix années
--     dont quatre bissextiles (2000, 2024, 2028, 2400) et 2100, qui ne l'est pas.
-- Tout se joue dans des dossiers jetables, et tout s'annule à la fin. Sans la migration, une ligne le dit, et rien ne
-- s'écrit. Les mutations de la migration, qui doivent faire virer cet essai au rouge, se plantent chacune dans une
-- transaction annulée, devant ce fichier (leur liste et leurs résultats : l'entrée d'EXD2 dans HISTORIQUE.md).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  verdicts jsonb := '[]'::jsonb;
  e record;
  v_obs text;
  v_code text;
  v_msg text;
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.exercices') is null then
    perform set_config('essai.exercices', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration exercices_du_dossier', 'ok', true,
      'observe', 'la table absente : rien ne s''écrit'))::text, true);
    return;
  end if;

  begin
    -- Le jeu : quatre dossiers jetables en engagement du cabinet de `test` — DE (le chemin), DV (une validation 2025),
    -- DN (rien de déclaré : la batterie), DR (la restauration).
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('e0d20000-0000-4000-8000-0000000000e1', 'ESSAI EXERCICES DE', cabinet, 'engagement', '455000'),
      ('e0d20000-0000-4000-8000-0000000000e2', 'ESSAI EXERCICES DV', cabinet, 'engagement', '455000'),
      ('e0d20000-0000-4000-8000-0000000000e3', 'ESSAI EXERCICES DN', cabinet, 'engagement', '455000'),
      ('e0d20000-0000-4000-8000-0000000000e4', 'ESSAI EXERCICES DR', cabinet, 'engagement', '455000');
    insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures,
                                   total_debit, total_credit, empreinte, declaration)
      values ('e0d20000-0000-4000-8000-0000000000e2', 2025, now(), chef::uuid, 'engagement', 0, 0, 0, 0, repeat('0', 64), null);

    for e in select * from (values
      -- ── Le catalogue ──
      (1, 'proprietaire', '1. la RLS, une seule policy (le cabinet du dossier, à authenticated, des deux côtés), aucune branche client', $q$select
  (select relrowsecurity::text from pg_class where oid = 'public.exercices'::regclass) || '|' ||
  (select count(*) from pg_policies where tablename = 'exercices' and policyname = 'exercices_cabinet' and cmd = 'ALL'
     and roles = array['authenticated']::name[] and qual = 'admin_du_dossier(dossier_id)' and with_check = 'admin_du_dossier(dossier_id)') || '|' ||
  (select count(*) from pg_policies where tablename = 'exercices' and not (policyname = 'deux_facteurs' and permissive = 'RESTRICTIVE'))$q$, 'OK', 'true|1|1'),
      (2, 'proprietaire', '2. les deux gardes : avant chaque ligne (la ligne seule), après chaque ligne (la suite) ; le modèle du dossier', $q$select string_agg(tgname || ':' || (tgtype & 2 = 2)::text, ',' order by tgname)
  from pg_trigger where tgrelid in ('public.exercices'::regclass, 'public.dossiers'::regclass) and not tgisinternal
   and tgname in ('exercices_garde', 'exercices_suite', 'dossiers_exercices_retiennent_l_engagement')$q$,
        'OK', 'dossiers_exercices_retiennent_l_engagement:true,exercices_garde:true,exercices_suite:false'),
      (3, 'proprietaire', '3. les deux exclusions, différées ; les cinq fonctions à security definer et search_path', $q$select
  (select string_agg(conname || ':' || condeferrable::text || ':' || condeferred::text, ',' order by conname) from pg_constraint
    where conrelid = 'public.exercices'::regclass and contype = 'x') || '|' ||
  (select count(*) from pg_proc p where p.proname in ('garder_exercices', 'verifier_la_suite_des_exercices', 'declarer_exercice',
     'changer_date_de_cloture', 'bornes_de_l_exercice', 'exercice_de_la_date', 'garder_l_engagement_des_exercices')
     and p.prosecdef and p.proconfig = array['search_path=public'])$q$,
        'OK', 'exercices_sans_chevauchement:true:true,exercices_un_millesime:true:true|7'),
      (4, 'proprietaire', '4. les droits d''exécution : authenticated sur les quatre fonctions de l''API, personne sur les gardes, jamais anon', $q$select
  string_agg(p.proname || ':' || has_function_privilege('authenticated', p.oid, 'execute')::text || ':' || has_function_privilege('anon', p.oid, 'execute')::text, ',' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('garder_exercices',
   'verifier_la_suite_des_exercices', 'declarer_exercice', 'changer_date_de_cloture', 'bornes_de_l_exercice', 'exercice_de_la_date', 'garder_l_engagement_des_exercices')$q$,
        'OK', 'bornes_de_l_exercice:true:false,changer_date_de_cloture:true:false,declarer_exercice:true:false,exercice_de_la_date:true:false,garder_exercices:false:false,garder_l_engagement_des_exercices:false:false,verifier_la_suite_des_exercices:false:false'),
      -- ── L'accès ──
      (10, 'client', '10. le client d''essai, qui n''a pas ce dossier, ne déclare pas', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2026-01-01', '2026-12-31', 'premier', null, null)$q$,
        '42501', 'Les exercices d''un dossier ne se déclarent que par son cabinet.'),
      (11, 'membre', '11. le membre d''équipe non assigné non plus', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2026-01-01', '2026-12-31', 'premier', null, null)$q$,
        '42501', 'Les exercices d''un dossier ne se déclarent que par son cabinet.'),
      (12, 'membre', '12. … ni ne change une clôture', $q$select changer_date_de_cloture('e0d20000-0000-4000-8000-0000000000e1', '2026-12-31', '2027-06-30', 'AGE', '2026-11-01')$q$,
        '42501', 'Les exercices d''un dossier ne se déclarent que par son cabinet.'),
      (13, 'anon', '13. l''anonyme n''exécute pas la déclaration', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2026-01-01', '2026-12-31', 'premier', null, null)$q$,
        '42501', 'permission denied for function declarer_exercice'),
      (14, 'client', '14. le client n''écrit pas en direct (la RLS)', $q$insert into exercices (dossier_id, debut, fin, nature) values ('e0d20000-0000-4000-8000-0000000000e1', '2026-01-01', '2026-12-31', 'premier')$q$,
        '42501', 'new row violates row-level security policy%'),
      (15, 'chef', '15. une déclaration sans ses dates est mal formée', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', null, '2026-12-31', 'premier', null, null)$q$,
        '22023', 'La déclaration d''un exercice part mal formée : son début, sa fin et sa nature.'),
      -- ── Un dossier en trésorerie ne déclare rien (EXD-Q2 (A)) ──
      (20, 'chef', '20. une année civile dans un dossier en trésorerie : elle se calcule', $q$select declarer_exercice('001c7ed7-c23b-4590-901e-693489f8af24', '2026-01-01', '2026-12-31', 'ordinaire', null, null)$q$,
        '23514', 'Un dossier en trésorerie suit l''année civile par la loi (CGI art. 12 et 93) : l''exercice 2026 se calcule, il ne se déclare pas.'),
      (21, 'chef', '21. un exercice décalé dans un dossier en trésorerie', $q$select declarer_exercice('001c7ed7-c23b-4590-901e-693489f8af24', '2026-07-01', '2027-06-30', 'ordinaire', null, null)$q$,
        '23514', 'Un dossier en trésorerie (BNC, 2035) suit l''année civile, du 1er janvier au 31 décembre : un exercice du 01/07/2026 au 30/06/2027 ne s''y déclare pas.'),
      (22, 'chef', '22. … ni sa clôture changée', $q$select changer_date_de_cloture('001c7ed7-c23b-4590-901e-693489f8af24', '2026-12-31', '2027-06-30', 'AGE', '2026-11-01')$q$,
        '23514', 'Un dossier en trésorerie (BNC, 2035) suit l''année civile, du 1er janvier au 31 décembre : un exercice du 01/01/2026 au 30/06/2027 ne s''y déclare pas.'),
      -- ── La ligne seule ──
      (30, 'chef', '30. la fin avant le début', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2026-03-15', '2026-03-14', 'premier', null, null)$q$,
        '23514', 'L''exercice se clôt le 14/03/2026, avant son début, le 15/03/2026.'),
      (31, 'chef', '31. une nature inconnue', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2026-03-15', '2026-12-31', 'courant', null, null)$q$,
        '23514', 'Un exercice déclaré est un premier exercice, un exercice ordinaire ou un exercice de transition (« courant » ne l''est pas).'),
      (32, 'chef', '32. un premier exercice clos après le 31 décembre de l''année qui suit son début (EXD-Q3 (A))', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2026-03-15', '2028-01-31', 'premier', null, null)$q$,
        '23514', 'Le premier exercice (du 15/03/2026 au 31/01/2028) se clôt au plus tard le 31 décembre de l''année qui suit son début, soit le 31/12/2027.'),
      (33, 'chef', '33. un ordinaire qui ne dure pas douze mois', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2026-03-15', '2027-03-15', 'ordinaire', null, null)$q$,
        '23514', 'Un exercice ordinaire dure douze mois : commencé le 15/03/2026, il se clôt le 14/03/2027. Un exercice d''une autre durée est un premier exercice ou un exercice de transition.'),
      (34, 'chef', '34. une transition de plus de vingt-trois mois (EXD-Q4 (A))', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2026-03-15', '2028-02-15', 'transition', 'AGE', '2026-02-01')$q$,
        '23514', 'Un exercice de transition dure d''un jour à vingt-trois mois : commencé le 15/03/2026, il se clôt au plus tard le 14/02/2028.'),
      (35, 'chef', '35. une transition sans décision dite', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2026-03-15', '2026-12-31', 'transition', '   ', '2026-02-01')$q$,
        '23514', 'Un exercice de transition cite la décision qui change la date de clôture (l''assemblée qui modifie les statuts, ou celle de l''exploitant) et sa date.'),
      (36, 'chef', '36. une décision hors d''une transition', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2026-03-15', '2026-12-31', 'premier', 'AGE', null)$q$,
        '23514', 'Seul un exercice de transition cite une décision de changement de la date de clôture.'),
      (37, 'chef', '37. une date hors des années 1000 à 9999', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '0999-12-31', '2026-12-31', 'premier', null, null)$q$,
        '23514', 'La date de début « 0999-12-31 » n''existe pas au calendrier.'),
      -- ── Le chemin juste ──
      (40, 'chef', '40. un premier exercice du 15/03/2026 au 30/06/2027', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2026-03-15', '2027-06-30', 'premier', null, null) is not null$q$, 'OK', 'true'),
      (41, 'chef', '41. puis un ordinaire jusqu''au 30/06/2028', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2027-07-01', '2028-06-30', 'ordinaire', null, null) is not null$q$, 'OK', 'true'),
      (42, 'proprietaire', '42. la liste, et son auteur', $q$select string_agg(debut || ':' || fin || ':' || nature || ':' || (declare_par = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162')::text, ',' order by debut)
  from exercices where dossier_id = 'e0d20000-0000-4000-8000-0000000000e1'$q$, 'OK', '2026-03-15:2027-06-30:premier:true,2027-07-01:2028-06-30:ordinaire:true'),
      (43, 'chef', '43. les bornes d''un millésime, ou rien', $q$select coalesce((select string_agg(debut || '|' || fin, ',') from bornes_de_l_exercice('e0d20000-0000-4000-8000-0000000000e1', 2027)), 'rien')
  || ' ; ' || coalesce((select string_agg(debut || '|' || fin, ',') from bornes_de_l_exercice('e0d20000-0000-4000-8000-0000000000e1', 2026)), 'rien')
  || ' ; ' || coalesce((select string_agg(debut || '|' || fin, ',') from bornes_de_l_exercice('e0d20000-0000-4000-8000-0000000000e1', 2028)), 'rien')$q$,
        'OK', '2026-03-15|2027-06-30 ; rien ; 2027-07-01|2028-06-30'),
      (44, 'chef', '44. l''exercice d''une date, ou nul hors des exercices', $q$select string_agg(coalesce(exercice_de_la_date('e0d20000-0000-4000-8000-0000000000e1', j)::text, 'nul'), ',' order by j)
  from unnest(array['2026-03-14', '2026-03-15', '2027-06-30', '2027-07-01', '2028-06-30', '2028-07-01']::date[]) j$q$, 'OK', 'nul,2027,2027,2028,2028,nul'),
      -- ── La suite, dans l'ordre du module ──
      (50, 'chef', '50. un premier exercice qui n''est pas en tête', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2028-07-01', '2029-06-30', 'premier', null, null)$q$,
        '23514', 'L''exercice du 01/07/2028 au 30/06/2029 est déclaré premier exercice alors qu''un exercice le précède (du 01/07/2027 au 30/06/2028).'),
      (51, 'chef', '51. un chevauchement (dit avant la clôture de la même année)', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2028-01-01', '2028-12-31', 'ordinaire', null, null)$q$,
        '23514', 'Les exercices du 01/07/2027 au 30/06/2028 et du 01/01/2028 au 31/12/2028 se chevauchent : un jour n''appartient qu''à un exercice.'),
      (52, 'chef', '52. un trou', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2028-08-01', '2029-07-31', 'ordinaire', null, null)$q$,
        '23514', 'Entre l''exercice du 01/07/2027 au 30/06/2028 et l''exercice du 01/08/2028 au 31/07/2029, les jours du 01/07/2028 au 31/07/2028 n''appartiennent à aucun exercice.'),
      (53, 'chef', '53. deux clôtures la même année (EXD-Q1 (A))', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2028-07-01', '2028-12-31', 'transition', 'AGE', '2028-05-01')$q$,
        '23514', '2 exercices se clôturent en 2028 (du 01/07/2027 au 30/06/2028 ; du 01/07/2028 au 31/12/2028) : un exercice porte le nom de l''année de sa clôture, deux ne peuvent pas porter le même. Une transition qui avance la clôture dans l''année s''allonge jusqu''à la nouvelle date de l''année suivante.'),
      (54, 'chef', '54. un trou et la même année : le trou d''abord', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2028-08-01', '2028-12-31', 'transition', 'AGE', '2028-05-01')$q$,
        '23514', 'Entre l''exercice du 01/07/2027 au 30/06/2028 et l''exercice du 01/08/2028 au 31/12/2028, les jours du 01/07/2028 au 31/07/2028 n''appartiennent à aucun exercice.'),
      -- ── Changer la date de clôture (§ 3.6) ──
      (60, 'chef', '60. sur un exercice qui n''est pas le dernier', $q$select changer_date_de_cloture('e0d20000-0000-4000-8000-0000000000e1', '2027-06-30', '2027-12-31', 'AGE', '2027-05-01')$q$,
        '23514', 'La date de clôture se change sur le dernier exercice déclaré : un exercice est déjà déclaré après celui du 15/03/2026 au 30/06/2027.'),
      (61, 'chef', '61. une clôture lue qui n''est plus', $q$select changer_date_de_cloture('e0d20000-0000-4000-8000-0000000000e1', '2028-05-31', '2028-12-31', 'AGE', '2027-11-15')$q$,
        '40001', 'Les exercices du dossier ont changé depuis leur lecture : aucun ne se clôt plus le 31/05/2028. Relis-les.'),
      (62, 'chef', '62. la même date', $q$select changer_date_de_cloture('e0d20000-0000-4000-8000-0000000000e1', '2028-06-30', '2028-06-30', 'AGE', '2027-11-15')$q$,
        '22023', 'L''exercice se clôt déjà le 30/06/2028 : sa date de clôture ne change pas.'),
      (63, 'chef', '63. une transition courte qui se clôt l''année de la précédente', $q$select changer_date_de_cloture('e0d20000-0000-4000-8000-0000000000e1', '2028-06-30', '2027-12-31', 'AGE', '2027-11-15')$q$,
        '23514', '2 exercices se clôturent en 2027 (du 15/03/2026 au 30/06/2027 ; du 01/07/2027 au 31/12/2027) : un exercice porte le nom de l''année de sa clôture, deux ne peuvent pas porter le même. Une transition qui avance la clôture dans l''année s''allonge jusqu''à la nouvelle date de l''année suivante.'),
      (64, 'chef', '64. sans décision', $q$select changer_date_de_cloture('e0d20000-0000-4000-8000-0000000000e1', '2028-06-30', '2028-12-31', null, null)$q$,
        '23514', 'Un exercice de transition cite la décision qui change la date de clôture (l''assemblée qui modifie les statuts, ou celle de l''exploitant) et sa date.'),
      (65, 'chef', '65. trop longue', $q$select changer_date_de_cloture('e0d20000-0000-4000-8000-0000000000e1', '2028-06-30', '2029-06-30', 'AGE', '2027-11-15')$q$,
        '23514', 'Un exercice de transition dure d''un jour à vingt-trois mois : commencé le 01/07/2027, il se clôt au plus tard le 31/05/2029.'),
      (66, 'chef', '66. la transition de dix-huit mois passe', $q$select changer_date_de_cloture('e0d20000-0000-4000-8000-0000000000e1', '2028-06-30', '2028-12-31', 'AGE du 15/11/2027', '2027-11-15') is not null$q$, 'OK', 'true'),
      (67, 'chef', '67. … l''exercice 2028 a ses nouvelles bornes', $q$select string_agg(debut || '|' || fin, ',') from bornes_de_l_exercice('e0d20000-0000-4000-8000-0000000000e1', 2028)$q$,
        'OK', '2027-07-01|2028-12-31'),
      (68, 'chef', '68. puis un ordinaire civil, et une transition d''un jour', $q$select (declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2029-01-01', '2029-12-31', 'ordinaire', null, null) is not null)::text
  || '|' || (declarer_exercice('e0d20000-0000-4000-8000-0000000000e1', '2030-01-01', '2030-01-01', 'transition', 'AGE', '2029-12-01') is not null)::text$q$, 'OK', 'true|true'),
      -- ── Les écritures directes du cabinet passent la même garde ──
      (70, 'chef', '70. une mise à jour qui raccourcit un ordinaire', $q$update exercices set fin = '2029-11-30' where dossier_id = 'e0d20000-0000-4000-8000-0000000000e1' and debut = '2029-01-01'$q$,
        '23514', 'Un exercice ordinaire dure douze mois : commencé le 01/01/2029, il se clôt le 31/12/2029. Un exercice d''une autre durée est un premier exercice ou un exercice de transition.'),
      (71, 'chef', '71. la suppression d''un exercice du milieu laisse un trou', $q$delete from exercices where dossier_id = 'e0d20000-0000-4000-8000-0000000000e1' and debut = '2029-01-01'$q$,
        '23514', 'Entre l''exercice du 01/07/2027 au 31/12/2028 et l''exercice du 01/01/2030 au 01/01/2030, les jours du 01/01/2029 au 31/12/2029 n''appartiennent à aucun exercice.'),
      (72, 'chef', '72. un exercice ne change pas de dossier', $q$update exercices set dossier_id = 'e0d20000-0000-4000-8000-0000000000e3' where dossier_id = 'e0d20000-0000-4000-8000-0000000000e1' and debut = '2030-01-01'$q$,
        '23514', 'Un exercice déclaré garde son identifiant et son dossier.'),
      (73, 'chef', '73. le dernier se retire', $q$with s as (delete from exercices where dossier_id = 'e0d20000-0000-4000-8000-0000000000e1' and debut = '2030-01-01' returning 1) select count(*) from s$q$, 'OK', '1'),
      (74, 'chef', '74. le dossier ne repasse pas en trésorerie', $q$update dossiers set mode_comptable = 'tresorerie' where id = 'e0d20000-0000-4000-8000-0000000000e1'$q$,
        '23514', 'Le dossier a déclaré ses exercices : il reste en comptabilité d''engagement (en trésorerie, l''exercice est l''année civile, qui ne se déclare pas).'),
      -- ── La période figée par une validation (civile avant EXD3) ──
      (80, 'chef', '80. un exercice qui commence dans l''année validée', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e2', '2025-07-01', '2026-06-30', 'ordinaire', null, null)$q$,
        '23514', 'L''exercice 2025 est validé : un exercice déclaré commence après lui, le 01/01/2026 au plus tôt.'),
      (81, 'chef', '81. un premier exercice après une année validée', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e2', '2026-01-01', '2026-12-31', 'premier', null, null)$q$,
        '23514', 'L''exercice du 01/01/2026 au 31/12/2026 est déclaré premier exercice alors qu''un exercice le précède (du 01/01/2025 au 31/12/2025).'),
      (82, 'chef', '82. un trou après l''année validée', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e2', '2026-03-01', '2026-12-31', 'transition', 'AGE', '2026-01-15')$q$,
        '23514', 'Entre l''exercice du 01/01/2025 au 31/12/2025 et l''exercice du 01/03/2026 au 31/12/2026, les jours du 01/01/2026 au 28/02/2026 n''appartiennent à aucun exercice.'),
      (83, 'chef', '83. une transition qui suit l''année validée passe', $q$select declarer_exercice('e0d20000-0000-4000-8000-0000000000e2', '2026-01-01', '2026-06-30', 'transition', 'AGE', '2025-11-20') is not null$q$, 'OK', 'true'),
      (84, 'chef', '84. les lectures : l''année figée civile, la transition déclarée, rien au-delà', $q$select coalesce((select string_agg(debut || '|' || fin, ',') from bornes_de_l_exercice('e0d20000-0000-4000-8000-0000000000e2', 2024)), 'rien')
  || ' ; ' || coalesce((select string_agg(debut || '|' || fin, ',') from bornes_de_l_exercice('e0d20000-0000-4000-8000-0000000000e2', 2025)), 'rien')
  || ' ; ' || coalesce((select string_agg(debut || '|' || fin, ',') from bornes_de_l_exercice('e0d20000-0000-4000-8000-0000000000e2', 2026)), 'rien')
  || ' ; ' || coalesce((select string_agg(debut || '|' || fin, ',') from bornes_de_l_exercice('e0d20000-0000-4000-8000-0000000000e2', 2027)), 'rien')
  || ' ; ' || (select string_agg(coalesce(exercice_de_la_date('e0d20000-0000-4000-8000-0000000000e2', j)::text, 'nul'), ',' order by j)
               from unnest(array['2025-12-31', '2026-01-01', '2026-06-30', '2026-07-01']::date[]) j)$q$,
        'OK', '2024-01-01|2024-12-31 ; 2025-01-01|2025-12-31 ; 2026-01-01|2026-06-30 ; rien ; 2025,2026,2026,nul'),
      (85, 'proprietaire', '85. (la validation civile de 2026, posée comme avant EXD3)', $q$with i as (insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration)
  values ('e0d20000-0000-4000-8000-0000000000e2', 2026, now(), 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', 'engagement', 0, 0, 0, 0, repeat('0', 64), null) returning 1) select count(*) from i$q$, 'OK', '1'),
      (86, 'chef', '86. un exercice déclaré que la validation couvre ne change plus', $q$with u as (update exercices set decision = 'AGE modifiée' where dossier_id = 'e0d20000-0000-4000-8000-0000000000e2' returning 1) select count(*) from u$q$,
        '23514', 'L''exercice 2026 est validé : l''exercice déclaré du 01/01/2026 au 30/06/2026, qu''il fige, ne change plus.'),
      (87, 'chef', '87. … ni ne se retire', $q$with s as (delete from exercices where dossier_id = 'e0d20000-0000-4000-8000-0000000000e2' returning 1) select count(*) from s$q$,
        '23514', 'L''exercice 2026 est validé : l''exercice déclaré du 01/01/2026 au 30/06/2026, qu''il fige, ne change plus.'),
      -- ── Les lectures ne rendent rien d'un dossier que l'appelant ne suit pas ──
      (90, 'client', '90. le client d''essai ne lit ni la table, ni les bornes, ni l''exercice d''une date (EXD2-Q1)', $q$select (select count(*) from exercices)
  || '|' || (select count(*) from bornes_de_l_exercice('e0d20000-0000-4000-8000-0000000000e1', 2027))
  || '|' || (select count(*) from bornes_de_l_exercice('ac538d93-7da3-4403-bca6-2d7836810a6f', 2026))
  || '|' || coalesce(exercice_de_la_date('e0d20000-0000-4000-8000-0000000000e1', '2027-01-01')::text, 'nul')$q$, 'OK', '0|0|0|nul'),
      (91, 'membre', '91. le membre d''équipe non assigné non plus', $q$select (select count(*) from exercices)
  || '|' || (select count(*) from bornes_de_l_exercice('e0d20000-0000-4000-8000-0000000000e1', 2027))
  || '|' || coalesce(exercice_de_la_date('e0d20000-0000-4000-8000-0000000000e1', '2027-01-01')::text, 'nul')$q$, 'OK', '0|0|nul'),
      (92, 'anon', '92. l''anonyme n''exécute pas les lectures', $q$select count(*) from bornes_de_l_exercice('001c7ed7-c23b-4590-901e-693489f8af24', 2026)$q$,
        '42501', 'permission denied for function bornes_de_l_exercice'),
      -- ── La restauration : un lot, dans le désordre ──
      (95, 'chef', '95. trois exercices d''un seul lot, dans le désordre, leur auteur gardé', $q$with i as (insert into exercices (dossier_id, debut, fin, nature, declare_par, declare_le) values
    ('e0d20000-0000-4000-8000-0000000000e4', '2028-01-01', '2028-12-31', 'ordinaire', '3e3b0000-0000-4000-8000-000000000001', '2020-01-02'),
    ('e0d20000-0000-4000-8000-0000000000e4', '2026-01-01', '2026-12-31', 'premier', '3e3b0000-0000-4000-8000-000000000001', '2020-01-02'),
    ('e0d20000-0000-4000-8000-0000000000e4', '2027-01-01', '2027-12-31', 'ordinaire', '3e3b0000-0000-4000-8000-000000000001', '2020-01-02')
  returning declare_par, declare_le) select count(*) || '|' || count(*) filter (where declare_par = '3e3b0000-0000-4000-8000-000000000001' and declare_le = '2020-01-02') from i$q$,
        'OK', '3|3'),
      (96, 'chef', '96. … mais un lot en deux instructions qui laisse un trou se refuse', $q$insert into exercices (dossier_id, debut, fin, nature) values ('e0d20000-0000-4000-8000-0000000000e4', '2030-01-01', '2030-12-31', 'ordinaire')$q$,
        '23514', 'Entre l''exercice du 01/01/2028 au 31/12/2028 et l''exercice du 01/01/2030 au 31/12/2030, les jours du 01/01/2029 au 31/12/2029 n''appartiennent à aucun exercice.'),
      (97, 'proprietaire', '97. (le membre d''équipe assigné au dossier DR)', $q$with i as (insert into dossier_assignations (dossier_id, user_id)
  values ('e0d20000-0000-4000-8000-0000000000e4', '3e3b0000-0000-4000-8000-000000000001') returning 1) select count(*) from i$q$, 'OK', '1'),
      (98, 'membre', '98. assigné, il déclare en direct sous son nom, jamais sous celui qu''il écrit', $q$with i as (insert into exercices (dossier_id, debut, fin, nature, declare_par, declare_le)
  values ('e0d20000-0000-4000-8000-0000000000e4', '2029-01-01', '2029-12-31', 'ordinaire', '797fe440-df8d-4b8e-828b-d148927bfd60', '2020-01-02')
  returning declare_par, declare_le) select (declare_par = '3e3b0000-0000-4000-8000-000000000001')::text || '|' || (declare_le > '2020-01-02')::text from i$q$,
        'OK', 'true|true'),
      -- ── La batterie civile ──
      (99, 'chef', '99. la batterie civile : chaque jour de dix années, chaque dossier en trésorerie et DN (rien de déclaré)', $q$select count(distinct d.id) || ' dossiers, ' || count(*) || ' dates, '
  || count(*) filter (where exercice_de_la_date(d.id, j::date) is distinct from a) || ' écarts de date, '
  || (select count(*) from dossiers d2 cross join unnest(array[1999, 2000, 2023, 2024, 2025, 2026, 2027, 2028, 2100, 2400]) a2
       where (d2.mode_comptable = 'tresorerie' or d2.id = 'e0d20000-0000-4000-8000-0000000000e3')
         and (select array_agg(b.debut || '|' || b.fin) from bornes_de_l_exercice(d2.id, a2) b)
             is distinct from array[make_date(a2, 1, 1) || '|' || make_date(a2, 12, 31)]) || ' écarts de bornes, '
  || count(*) filter (where extract(month from j) = 2 and extract(day from j) = 29) || ' 29 février'
  from dossiers d cross join unnest(array[1999, 2000, 2023, 2024, 2025, 2026, 2027, 2028, 2100, 2400]) a
       cross join generate_series(make_date(a, 1, 1), make_date(a, 12, 31), interval '1 day') j
 where d.mode_comptable = 'tresorerie' or d.id = 'e0d20000-0000-4000-8000-0000000000e3'$q$,
        'OK', '5 dossiers, 18270 dates, 0 écarts de date, 0 écarts de bornes, 20 29 février'),
      (100, 'chef', '100. aux bords : 1000 et 9999 se lisent, 999 et 10000 non ; une date hors du calendrier lu est nulle', $q$select (select count(*) from bornes_de_l_exercice('001c7ed7-c23b-4590-901e-693489f8af24', 1000))
  || '|' || (select count(*) from bornes_de_l_exercice('001c7ed7-c23b-4590-901e-693489f8af24', 9999))
  || '|' || (select count(*) from bornes_de_l_exercice('001c7ed7-c23b-4590-901e-693489f8af24', 999))
  || '|' || (select count(*) from bornes_de_l_exercice('001c7ed7-c23b-4590-901e-693489f8af24', 10000))
  || '|' || coalesce(exercice_de_la_date('001c7ed7-c23b-4590-901e-693489f8af24', '0999-12-31')::text, 'nul')
  || '|' || coalesce(exercice_de_la_date('e0d20000-0000-4000-8000-0000000000e3', '9999-12-31')::text, 'nul')$q$, 'OK', '1|1|0|0|nul|9999')
    ) as t(rang, profil, etape, requete, code, attendu) order by rang loop
      v_obs := null;
      v_code := 'OK';
      v_msg := '';
      begin
        if e.profil = 'anon' then
          execute 'set local role anon';
          perform set_config('request.jwt.claims', '{"role":"anon"}', true);
        elsif e.profil <> 'proprietaire' then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub',
            case e.profil when 'chef' then chef when 'membre' then membre else client end, 'role', 'authenticated')::text, true);
        end if;
        execute e.requete into v_obs;
        -- Les deux exclusions sont différées : elles se jugent ici, à la fin de l'étape, comme à la validation d'une requête.
        set constraints all immediate;
        set constraints all deferred;
        reset role;
        v_msg := coalesce(v_obs, '');
      exception when others then
        reset role;
        v_code := sqlstate;
        v_msg := sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and (e.attendu = '' or v_msg like e.attendu), 'observe', v_code || ' ' || v_msg);
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;
  verdicts := verdicts || jsonb_build_object('rang', 200, 'etape', '200. rien n''est resté (les dossiers jetables, leurs exercices, la validation)',
    'ok', not exists (select 1 from dossiers where id::text like 'e0d20000-%') and not exists (select 1 from exercices_valides where dossier_id::text like 'e0d20000-%'),
    'observe', (select count(*) from dossiers where id::text like 'e0d20000-%')::text);
  perform set_config('essai.exercices', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.exercices')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
