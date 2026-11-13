-- ESSAI DE LA GARDE DES CATÉGORIES DU DOSSIER (PC7, ligne 43 ; migration en production depuis le
-- 12/11/2026, supabase/schema/20261112134532_categories_du_dossier.sql). À rejouer après toute migration qui touche `categories`,
-- ses policies, `regler_plan_du_dossier`, `compte_du_role`, `cle_validation`, `is_super_admin`, ou une table qui cite une
-- catégorie (pièces, relevé, ventilations, caisse, règles, `dossiers.categorie_recettes_client`).
--
-- Sans la migration, l'essai se dit EN ATTENTE et ne joue rien. Avec elle, chaque étape se joue dans un bloc annulé, sous
-- un profil : « chef » — le compte client du jeu rattaché chef du cabinet le temps de l'essai (la base n'a qu'un chef, qui
-- est aussi super-administrateur : la garde laisse passer l'insertion du super-administrateur, la porte de la
-- restauration) ; « super » — ce chef-là ; « postgres » — sans rôle (la cascade de la suppression d'un dossier). Rien ne
-- reste : deux dossiers jetables, leurs catégories, une pièce, l'accès de chef, tout part avec le bloc global.
--
-- Mutations qui doivent virer au rouge (jouées sur la réplique, le 12/11/2026) : retirer le refus (a), (b), (c) ou (d) ;
-- comparer le compte sans `rtrim` ; garder la porte du super-administrateur à la mise à jour aussi.
--
-- LA CLASSE DU COMPTE (PC7-Q2 ; la migration PRÉPARÉE supabase/preparees/20261112234000_classes_des_categories.sql) : le
-- refus (e) — une catégorie du dossier dont le compte, non nul, n'est pas de la classe 6 ou 7 suivie de deux chiffres, à
-- l'insertion ou quand il change, pour tout auteur, la restauration comprise — se joue aux étapes 40 à 49, quand la
-- dernière des deux lignes d'historique `classes_des_categories` et `retour_classes_des_categories` est la première ; sinon
-- une ligne dit qu'elles attendent (EN ATTENTE), et les étapes 1 à 30 se jouent comme hier. L'étape 46 pose une catégorie
-- au compte de bilan déclencheurs de `categories` coupés le temps de l'écrire (`disable trigger user`, le propriétaire),
-- comme une catégorie posée avant la garde. Mutations de la migration qui doivent virer au rouge (jouées sur la réplique,
-- le 12/11/2026) : retirer (e) ; le mettre après la porte de la restauration ; après (b) ; avant (a) ; juger toute mise à
-- jour ; juger les communes ; `^[67]` seul ; refuser un compte nul ; un autre code que 23514.
--
-- LA CLASSE DU COMPTE D'UNE COMMUNE (PC7Q2-Q1 ; la migration PRÉPARÉE
-- supabase/preparees/20261113110000_classes_des_categories_communes.sql, après celle de PC7-Q2) : le refus (f) — une
-- catégorie COMMUNE dont le compte, non nul, n'est pas de la classe 6 ou 7 suivie de deux chiffres, à l'insertion ou quand
-- il change, pour tout auteur, le super-administrateur compris — se joue aux étapes 50 à 59, quand la dernière des deux
-- lignes d'historique `classes_des_categories_communes` et `retour_classes_des_categories_communes` est la première ; et
-- l'étape 45, la commune au 401000 du super-administrateur, attend alors son refus. Sinon une ligne dit qu'elles attendent
-- (EN ATTENTE), et l'étape 45 passe comme hier. Une commune jetable (K3) se pose au 606400 par le propriétaire ; les étapes
-- 55 et 56 la posent au 401000 déclencheurs coupés, comme une commune posée avant la garde. Mutations de la migration qui
-- doivent virer au rouge (jouées sur la réplique, le 13/11/2026) : retirer (f) ; le mettre avant (a) ; après le retour des
-- communes ; juger toute mise à jour ; juger aussi les catégories du dossier ; `^[67]` seul ; refuser un compte nul ; un
-- autre code que 23514.

do $essai$
declare
  super constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  da constant text := 'c7000000-0000-4000-8000-0000000000d1';
  db constant text := 'c7000000-0000-4000-8000-0000000000d2';
  k1 constant text := 'c7000000-0000-4000-8000-0000000000c1';
  k2 constant text := 'c7000000-0000-4000-8000-0000000000c2';
  k3 constant text := 'c7000000-0000-4000-8000-0000000000c3';
  p1 constant text := 'c7000000-0000-4000-8000-0000000000e1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  -- La migration de la classe (PC7-Q2) en base : la dernière de ses deux lignes d'historique est la sienne, pas son retour.
  classes constant boolean := coalesce((select m.name = 'classes_des_categories' from supabase_migrations.schema_migrations m
    where m.name in ('classes_des_categories', 'retour_classes_des_categories') order by m.version desc limit 1), false);
  -- Celle de la classe d'une commune (PC7Q2-Q1), de même.
  communes constant boolean := coalesce((select m.name = 'classes_des_categories_communes' from supabase_migrations.schema_migrations m
    where m.name in ('classes_des_categories_communes', 'retour_classes_des_categories_communes') order by m.version desc limit 1), false);
  -- Une catégorie posée comme avant la garde de la classe : déclencheurs de `categories` coupés le temps de l'écrire.
  avant_la_classe constant text := $p$alter table categories disable trigger user; insert into categories (id, dossier_id, code, libelle, compte_comptable) values ('{K1}', '{DA}', 'essai_pc7_k1', 'Essai PC7 posée avant', '108000'); alter table categories enable trigger user$p$;
  -- Une commune jetable, K3 : au 606400, ou au 401000 comme avant la garde de la classe des communes.
  commune constant text := $p$insert into categories (id, dossier_id, code, libelle, compte_comptable) values ('{K3}', null, 'essai_pc7_k3', 'Essai PC7 commune', '606400')$p$;
  commune_avant constant text := $p$alter table categories disable trigger user; insert into categories (id, dossier_id, code, libelle, compte_comptable) values ('{K3}', null, 'essai_pc7_k3', 'Essai PC7 commune posée avant', '401000'); alter table categories enable trigger user$p$;
  -- Deux catégories du dossier DA : K1 au 606400, libre ; K2 au 706000, citée selon l'étape.
  jeu constant text := $j$insert into categories (id, dossier_id, code, libelle, compte_comptable, poste_2035) values
      ('{K1}', '{DA}', 'essai_pc7_k1', 'Essai PC7 fournitures', '606400', 'Fournitures de bureau'),
      ('{K2}', '{DA}', 'essai_pc7_k2', 'Essai PC7 recettes', '706000', 'Recettes')$j$;
  e record; v_code text; v_obs text; v_requete text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.garder_categorie_du_dossier()') is null then
    perform set_config('essai.categories_du_dossier', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration categories_du_dossier', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  if exists (select 1 from super_admins where user_id = client::uuid) or exists (select 1 from cabinet_admins where user_id = client::uuid) then
    raise exception 'Le compte client du jeu est chef ou super-administrateur : l''essai ne prouverait rien.';
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id) values (da::uuid, 'ESSAI PC7 DA', cabinet), (db::uuid, 'ESSAI PC7 DB', cabinet);
    insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');

    -- {rang, étape, profil, préparation (sous postgres, ou nulle), requête, code attendu, ce qu'elle rend (« ~ » : le
    -- message le contient)}.
    for e in select * from (values
      (1, '1. le chef crée une catégorie de son dossier', 'chef', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable, poste_2035) values ('{DA}', 'essai_pc7_a', 'Essai PC7 A', '606100', 'Achats') returning code$q$,
        'OK', 'essai_pc7_a'),
      (2, '2. (c) le compte du barème du plan par défaut (625110) se refuse', 'chef', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'essai_pc7_b', 'Essai PC7 B', '625110') returning code$q$,
        '23514', '~celui des indemnités kilométriques du plan de ce dossier (« 625110 »)'),
      (3, '3. (c) le même compte à des zéros près (62511) aussi', 'chef', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'essai_pc7_b', 'Essai PC7 B', '62511') returning code$q$,
        '23514', '~à des zéros près : le barème et les frais réels restent séparés'),
      (4, '4. le 625100 des frais réels passe (ce n''est pas le barème)', 'chef', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'essai_pc7_b', 'Essai PC7 B', '625100') returning compte_comptable$q$,
        'OK', '625100'),
      (5, '5. (b) le code d''une catégorie commune se refuse', 'chef', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'loyer', 'Loyer du cabinet', '613200') returning code$q$,
        '23514', '~Le code « loyer » est celui d''une catégorie commune'),
      (6, '6. (b) ni par une mise à jour du code', 'chef', '{JEU}',
        $q$update categories set code = 'loyer' where id = '{K1}' returning code$q$,
        '23514', '~celui d''une catégorie commune'),
      (7, '7. (c) une mise à jour vers le compte du barème se refuse', 'chef', '{JEU}',
        $q$update categories set compte_comptable = '625110' where id = '{K1}' returning compte_comptable$q$,
        '23514', '~celui des indemnités kilométriques'),
      (8, '8. le libellé et le poste changent, le compte restant', 'chef', '{JEU}',
        $q$update categories set libelle = 'Essai PC7 papeterie', poste_2035 = 'Achats' where id = '{K1}' returning libelle || ' / ' || poste_2035$q$,
        'OK', 'Essai PC7 papeterie / Achats'),
      (9, '9. un compte posé avant la garde (au barème) ne se juge pas tant qu''il ne change pas', 'chef',
        'select set_config(''request.jwt.claims'', ''{"sub": "{SUPER}", "role": "authenticated"}'', true); insert into categories (id, dossier_id, code, libelle, compte_comptable) values (''{K1}'', ''{DA}'', ''essai_pc7_k1'', ''Essai PC7 posée avant'', ''625110'')',
        $q$update categories set libelle = 'Essai PC7 renommée' where id = '{K1}' returning libelle$q$,
        'OK', 'Essai PC7 renommée'),
      (10, '10. (a) le chef ne déplace pas une catégorie vers son autre dossier', 'chef', '{JEU}',
        $q$update categories set dossier_id = '{DB}' where id = '{K1}' returning dossier_id::text$q$,
        '23514', '~Une catégorie ne change pas de dossier'),
      (11, '11. (a) le super-administrateur ne la rend pas commune', 'super', '{JEU}',
        $q$update categories set dossier_id = null where id = '{K1}' returning code$q$,
        '23514', '~ni ne devient commune'),
      (12, '12. (a) ni ne rend propre une catégorie commune', 'super', null,
        $q$update categories set dossier_id = '{DA}' where code = 'loyer' and dossier_id is null returning code$q$,
        '23514', '~ni ne devient commune ou propre à un dossier'),
      (13, '13. la restauration : le super-administrateur insère au barème et sous un code commun', 'super', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'loyer', 'Restaurée', '625110') returning code || ' ' || compte_comptable$q$,
        'OK', 'loyer 625110'),
      (14, '14. mais sa mise à jour reste gardée', 'super', '{JEU}',
        $q$update categories set compte_comptable = '625110' where id = '{K1}' returning compte_comptable$q$,
        '23514', '~celui des indemnités kilométriques'),
      (15, '15. le plan réglé (barème au 625120) : le 625110 passe', 'chef',
        null,
        $q$select regler_plan_du_dossier('{DA}', '[{"role": "indemnites_kilometriques", "compte": "625120"}]'::jsonb); insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'essai_pc7_c', 'Essai PC7 C', '625110') returning compte_comptable$q$,
        'OK', '625110'),
      (16, '16. le plan réglé : le 625120 se refuse', 'chef',
        null,
        $q$select regler_plan_du_dossier('{DA}', '[{"role": "indemnites_kilometriques", "compte": "625120"}]'::jsonb); insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'essai_pc7_c', 'Essai PC7 C', '625120') returning compte_comptable$q$,
        '23514', '~(« 625120 »)'),
      (17, '17. (d) une catégorie qui n''est employée par rien se supprime', 'chef', '{JEU}',
        $q$delete from categories where id = '{K1}' returning libelle$q$,
        'OK', 'Essai PC7 fournitures'),
      (18, '18. une catégorie qu''une pièce cite ne se supprime pas : sa clé, comme hier', 'chef',
        '{JEU}; insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, montant_ttc, categorie_id) values (''{P1}'', ''{DA}'', ''{DA}/essai-pc7.pdf'', ''essai-pc7.pdf'', ''achat'', ''a_valider'', 12, ''{K1}'')',
        $q$delete from categories where id = '{K1}' returning libelle$q$,
        '23503', '~violates foreign key constraint "pieces_categorie_id_fkey"'),
      (19, '19. (d) ni celle de la nature des recettes en espèces du client, que rien d''autre ne garde', 'chef',
        '{JEU}; update dossiers set categorie_recettes_client = ''{K2}'' where id = ''{DA}''',
        $q$delete from categories where id = '{K2}' returning libelle$q$,
        '23503', '~est la nature des recettes en espèces du client : elle ne se supprime pas'),
      (20, '20. (d) la suppression du dossier emporte ses catégories citées (la cascade passe)', 'postgres',
        '{JEU}; insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, montant_ttc, categorie_id) values (''{P1}'', ''{DA}'', ''{DA}/essai-pc7.pdf'', ''essai-pc7.pdf'', ''achat'', ''a_valider'', 12, ''{K1}''); update dossiers set categorie_recettes_client = ''{K2}'' where id = ''{DA}''',
        $q$with d as (delete from dossiers where id = '{DA}' returning id) select count(*)::text from d$q$,
        'OK', '1'),
      (21, '21. les catégories communes : le super-administrateur règle encore leur compte', 'super', null,
        $q$update categories set compte_comptable = '606110' where code = 'achats_fournisseurs' and dossier_id is null returning compte_comptable$q$,
        'OK', '606110'),
      (22, '22. le chef ne modifie toujours aucune catégorie commune (la policy, sans erreur)', 'chef', null,
        $q$update categories set compte_comptable = '606110' where code = 'achats_fournisseurs' and dossier_id is null returning compte_comptable$q$,
        'OK', ''),
      -- ══ 40 à 49. (e) La classe du compte (PC7-Q2), quand sa migration est en base ══
      (40, '40. (e) le chef ne crée pas une catégorie de son dossier sur un compte de tiers (401000)', 'chef', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'essai_pc7_e', 'Essai PC7 E', '401000') returning code$q$,
        '23514', '~Le compte « 401000 » n''est pas un compte de charge ou de produit (classe 6 ou 7, trois chiffres en tête) : une catégorie du dossier ne range qu''une charge ou un produit.'),
      (41, '41. (e) ni ne porte son compte sur la banque (512000)', 'chef', '{JEU}',
        $q$update categories set compte_comptable = '512000' where id = '{K1}' returning compte_comptable$q$,
        '23514', '~Le compte « 512000 » n''est pas un compte de charge ou de produit'),
      (42, '42. (e) ni sur un compte qui ne commence pas par trois chiffres (6A1000)', 'chef', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'essai_pc7_e', 'Essai PC7 E', '6A1000') returning code$q$,
        '23514', '~Le compte « 6A1000 » n''est pas un compte de charge ou de produit'),
      (43, '43. sans compte, la catégorie attend le sien : rien ne se juge', 'chef', null,
        $q$insert into categories (dossier_id, code, libelle) values ('{DA}', 'essai_pc7_e', 'Essai PC7 E') returning code$q$,
        'OK', 'essai_pc7_e'),
      (44, '44. (e) la restauration non plus : le super-administrateur n''insère pas une catégorie du dossier au 401000', 'super', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'essai_pc7_e', 'Restaurée', '401000') returning code$q$,
        '23514', '~Le compte « 401000 » n''est pas un compte de charge ou de produit'),
      -- La frontière de PC7Q2-Q1 : sans sa migration, la commune passe ; avec elle, (f) la refuse.
      (45, case when communes then '45. (f) une catégorie COMMUNE au 401000, par le super-administrateur : la classe la juge aussi (PC7Q2-Q1)'
                else '45. une catégorie COMMUNE au 401000, par le super-administrateur : la classe ne la juge pas (PC7Q2-Q1)' end, 'super', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values (null, 'essai_pc7_commune', 'Essai PC7 commune', '401000') returning compte_comptable$q$,
        case when communes then '23514' else 'OK' end,
        case when communes then '~Le compte « 401000 » n''est pas un compte de charge ou de produit (classe 6 ou 7, trois chiffres en tête) : une catégorie commune à tous les cabinets ne range qu''une charge ou un produit.'
             else '401000' end),
      (46, '46. une catégorie posée avant la garde au 108000 : son libellé change, son compte ne se rejuge pas', 'chef', avant_la_classe,
        $q$update categories set libelle = 'Essai PC7 renommée' where id = '{K1}' returning libelle || ' / ' || compte_comptable$q$,
        'OK', 'Essai PC7 renommée / 108000'),
      (47, '47. … et son compte rendu à une charge passe', 'chef', avant_la_classe,
        $q$update categories set compte_comptable = '606400' where id = '{K1}' returning compte_comptable$q$,
        'OK', '606400'),
      (48, '48. l''ordre : le code d''une commune et un compte hors classe, la classe d''abord (e avant b)', 'chef', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DA}', 'loyer', 'Loyer du cabinet', '401000') returning code$q$,
        '23514', '~Le compte « 401000 » n''est pas un compte de charge ou de produit'),
      (49, '49. l''ordre : un dossier changé et un compte hors classe, le dossier d''abord (a avant e)', 'chef', '{JEU}',
        $q$update categories set dossier_id = '{DB}', compte_comptable = '401000' where id = '{K1}' returning code$q$,
        '23514', '~Une catégorie ne change pas de dossier'),
      -- ══ 50 à 59. (f) La classe du compte d'une catégorie COMMUNE (PC7Q2-Q1), quand sa migration est en base ══
      (50, '50. (f) le super-administrateur ne porte pas le compte d''une commune sur la banque (512000)', 'super', commune,
        $q$update categories set compte_comptable = '512000' where id = '{K3}' returning compte_comptable$q$,
        '23514', '~Le compte « 512000 » n''est pas un compte de charge ou de produit (classe 6 ou 7, trois chiffres en tête) : une catégorie commune à tous les cabinets ne range qu''une charge ou un produit.'),
      (51, '51. (f) ni sur un compte qui ne commence pas par trois chiffres (6A1000)', 'super', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values (null, 'essai_pc7_commune', 'Essai PC7 commune', '6A1000') returning code$q$,
        '23514', '~Le compte « 6A1000 » n''est pas un compte de charge ou de produit (classe 6 ou 7, trois chiffres en tête) : une catégorie commune'),
      (52, '52. (f) pour tout auteur : le propriétaire, sans session, ne pose pas une commune au 445660', 'postgres', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values (null, 'essai_pc7_commune', 'Essai PC7 commune', '445660') returning code$q$,
        '23514', '~Le compte « 445660 » n''est pas un compte de charge ou de produit (classe 6 ou 7, trois chiffres en tête) : une catégorie commune'),
      (53, '53. une commune sans compte attend le sien : rien ne se juge', 'super', null,
        $q$insert into categories (dossier_id, code, libelle) values (null, 'essai_pc7_commune', 'Essai PC7 commune') returning code$q$,
        'OK', 'essai_pc7_commune'),
      (54, '54. le compte d''une commune passe d''une charge (606400) à un produit (706000)', 'super', commune,
        $q$update categories set compte_comptable = '706000' where id = '{K3}' returning compte_comptable$q$,
        'OK', '706000'),
      (55, '55. une commune posée avant la garde au 401000 : son libellé change, son compte ne se rejuge pas', 'super', commune_avant,
        $q$update categories set libelle = 'Essai PC7 commune renommée' where id = '{K3}' returning libelle || ' / ' || compte_comptable$q$,
        'OK', 'Essai PC7 commune renommée / 401000'),
      (56, '56. … et son compte rendu à une charge passe', 'super', commune_avant,
        $q$update categories set compte_comptable = '606400' where id = '{K3}' returning compte_comptable$q$,
        'OK', '606400'),
      (57, '57. l''ordre : une catégorie du dossier rendue commune sur un compte hors classe, le dossier d''abord (a avant f)', 'super', '{JEU}',
        $q$update categories set dossier_id = null, compte_comptable = '401000' where id = '{K1}' returning code$q$,
        '23514', '~Une catégorie ne change pas de dossier'),
      (58, '58. le chef qui n''est pas super-administrateur ne crée toujours pas de commune : sur une charge, la policy (42501)', 'chef', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values (null, 'essai_pc7_commune', 'Essai PC7 commune', '606400') returning code$q$,
        '42501', '~row-level security policy for table "categories"'),
      (59, '59. … hors classe, (f) le refuse avant la policy, sans rien écrire', 'chef', null,
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values (null, 'essai_pc7_commune', 'Essai PC7 commune', '401000') returning code$q$,
        '23514', '~: une catégorie commune à tous les cabinets ne range qu''une charge ou un produit.')
    ) as t(rang, etape, profil, preparation, requete, attendu, rend)
    loop
      if e.rang between 40 and 49 and not classes then
        continue;
      end if;
      if e.rang between 50 and 59 and not communes then
        continue;
      end if;
      v_code := 'OK'; v_obs := null;
      begin
        if e.preparation is not null then
          v_requete := replace(e.preparation, '{JEU}', jeu);
          execute replace(replace(replace(replace(replace(replace(replace(v_requete, '{DA}', da), '{DB}', db), '{K1}', k1), '{K2}', k2), '{K3}', k3), '{P1}', p1), '{SUPER}', super);
        end if;
        if e.profil <> 'postgres' then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', case when e.profil = 'super' then super else client end,
            'role', 'authenticated')::text, true);
        end if;
        begin
          execute replace(replace(replace(replace(replace(replace(e.requete, '{DA}', da), '{DB}', db), '{K1}', k1), '{K2}', k2), '{K3}', k3), '{P1}', p1) into v_obs;
        exception when others then
          v_code := sqlstate; v_obs := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        reset role;
        perform set_config('request.jwt.claims', '', true);
        if sqlerrm <> 'ANNULATION_ETAPE' then
          v_code := 'PREPARATION ' || sqlstate; v_obs := sqlerrm;
        end if;
      end;
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.attendu and case when left(e.rend, 1) = '~' then position(substr(e.rend, 2) in coalesce(v_obs, '')) > 0
                                          else coalesce(v_obs, '') = e.rend end,
        'observe', v_code || ' ' || coalesce(v_obs, ''));
    end loop;
    if not classes then
      verdicts := verdicts || jsonb_build_object('rang', 40,
        'etape', '40. EN ATTENTE de la migration classes_des_categories (PC7-Q2) : les étapes 40 à 49 se jouent dès qu''elle y est',
        'ok', true, 'observe', 'absente, ou rendue par son retour');
    end if;
    if not communes then
      verdicts := verdicts || jsonb_build_object('rang', 50,
        'etape', '50. EN ATTENTE de la migration classes_des_categories_communes (PC7Q2-Q1) : les étapes 50 à 59 se jouent dès qu''elle y est, et l''étape 45 attend alors son refus',
        'ok', true, 'observe', 'absente, ou rendue par son retour');
    end if;

    verdicts := verdicts || jsonb_build_object('rang', 30, 'etape', '30. le catalogue : security definer, chemin vide, exécutable par aucun rôle ; un déclencheur BEFORE INSERT OR UPDATE OR DELETE FOR EACH ROW',
      'ok', (select p.prosecdef and p.proconfig = array['search_path=""']
                    and not has_function_privilege('authenticated', p.oid, 'execute')
                    and not has_function_privilege('anon', p.oid, 'execute')
               from pg_proc p where p.oid = 'public.garder_categorie_du_dossier()'::regprocedure)
        and (select t.tgtype = (1 | 2 | 4 | 8 | 16)::smallint and t.tgenabled = 'O'
               from pg_trigger t where t.tgrelid = 'public.categories'::regclass and t.tgname = 'categories_du_dossier'),
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs catégories, ni la pièce, ni l''accès de chef ; les communes intactes',
    'ok', not exists (select 1 from dossiers where id in (da::uuid, db::uuid))
      and not exists (select 1 from categories where code like 'essai_pc7%' or id in (k1::uuid, k2::uuid, k3::uuid))
      and not exists (select 1 from pieces where id = p1::uuid)
      and not exists (select 1 from cabinet_admins where user_id = client::uuid)
      and (select count(*) from categories where dossier_id is null and code = 'loyer') = 1,
    'observe', 'relu');
  perform set_config('essai.categories_du_dossier', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.categories_du_dossier')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
