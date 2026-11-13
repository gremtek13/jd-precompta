-- LE MODÈLE DE PLAN DU CABINET (ligne 43, étape PC5 ; la migration `modele_de_plan_du_cabinet`, en production depuis le
-- 12/11/2026, supabase/schema/20261112134459_modele_de_plan_du_cabinet.sql). Le récit : HISTORIQUE.md, « 12/11/2026 — PC5 :
-- LE MODÈLE DE PLAN DU CABINET (PRÉPARÉ, PAS APPLIQUÉ) ». À rejouer par `execute_sql` après toute migration qui touche `plan_comptable_cabinet`, ses fonctions
-- (`regler_modele_du_cabinet`, `modele_du_cabinet`, `appliquer_modele_du_cabinet`) ou ses déclencheurs, et après toute
-- migration qui touche ce que `appliquer_modele_du_cabinet` appelle : `regler_plan_du_dossier`, la garde du plan,
-- `plan_comptable_dossier`, `roles_comptables`, `admin_du_cabinet`, `est_chef_du_cabinet`, `admin_du_dossier`.
--
-- Ce qui se prouve ici, et ne se relit pas : qui lit le modèle (l'équipe du cabinet, chef ou non ; ni le client, ni un
-- compte d'un autre cabinet, ni un compte rattaché à rien, ni l'anonyme) et qui le règle (le chef seul, 43-Q3) ; aucune
-- écriture directe, d'une session ou du propriétaire, et ce qu'une ligne EST ; chaque refus de `regler_modele_du_cabinet`
-- sous ses mots, et leur ordre ; ce qu'elle écrit (le modèle ENTIER, une ligne inchangée gardant son auteur, la porte
-- refermée) ; l'application à un dossier vide (le plan copié, son origine « modele_du_cabinet », le dirigeant qui suit
-- son rôle), par `regler_plan_du_dossier` : son accès, son verrou d'un dossier déjà écrit, ses refus au dossier ; le modèle
-- d'un autre cabinet jamais copié ; le catalogue (la sécurité, les droits, les déclencheurs et leur ordre, la policy).
--
-- Le jeu : deux dossiers jetables du cabinet du dossier `test` (préfixe `f5c00000-0000-4000-8000`) — DT en trésorerie,
-- dirigeant au 455000, avec un accès du client d'essai ; DE en engagement, dirigeant au 108000 — et, pour les étapes qui le
-- demandent, un cabinet jetable (AUTRE). Ni une catégorie du dossier (`classes_des_categories`, PC7-Q2) ni une commune
-- (`classes_des_categories_communes`, PC7Q2-Q1) ne se posent plus hors des classes 6 et 7 : les étapes 37, 39 et 72, qui
-- la veulent au compte de l'exploitant, la posent déclencheurs de `categories` coupés le temps de l'écrire, comme une
-- catégorie posée avant la garde. Le client d'essai sert aussi de membre de l'équipe (rattaché comme comptable, le
-- temps d'une étape), de chef du cabinet qui n'est pas super-administrateur, et de chef de l'autre cabinet. Chaque étape se
-- joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le propriétaire pose d'abord, sous la session
-- du super-administrateur, puis la requête du profil ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien
-- n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.modele_du_cabinet`), que la
-- requête finale lit : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune instruction de
-- retrait ni de mise à jour sans `where`, et ne rend rien qui dépende d'une ligne hors de ses dossiers et de son cabinet.
-- Ce que le retrait d'un cabinet emporte, et le retrait direct d'une ligne : modeleDuCabinetSuppression.sql, sur une
-- réplique seulement. Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  -- Un compte connecté qu'aucun accès ni aucun cabinet ne nomme (le profil `inconnu`).
  inconnu constant text := 'f5c00000-0000-4000-8000-0000000000f1';
  dt constant text := 'f5c00000-0000-4000-8000-0000000000d1';
  de constant text := 'f5c00000-0000-4000-8000-0000000000d2';
  dx constant text := 'f5c00000-0000-4000-8000-0000000000d9';
  acces constant text := 'f5c00000-0000-4000-8000-0000000000a1';
  autre constant text := 'f5c00000-0000-4000-8000-0000000000ca';
  cx constant text := 'f5c00000-0000-4000-8000-0000000000cf';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  -- Le modèle fictif décalé (`PLAN_DECALE` et `PREFIXES_DECALES`, src/lib/planComptable.ts) : les 32 rôles du catalogue de
  -- PC1 et VF2, chacun sur un autre compte que son défaut, les trois tiers sous un autre préfixe. Le catalogue en porte plus
  -- depuis `ecarts_de_reglement` (les deux du change, 12/11/2026), et en portera d'autres : les nombres attendus se LISENT —
  -- `nr`, les rôles du catalogue (le modèle se stocke entier), `nd`, ceux que le modèle décalé règle —, jamais en dur.
  decale constant text := '[{"role": "banque", "compte": "512100"}, {"role": "tva_deductible", "compte": "445661"},
    {"role": "tva_immobilisations", "compte": "445621"}, {"role": "tva_collectee", "compte": "445711"},
    {"role": "tva_a_decaisser", "compte": "445511"}, {"role": "credit_tva_a_reporter", "compte": "445671"},
    {"role": "remboursement_tva_demande", "compte": "445831"}, {"role": "arrondi_charge", "compte": "658100"},
    {"role": "arrondi_produit", "compte": "758100"}, {"role": "fournisseurs", "compte": "401100", "prefixe_auxiliaire": "FO"},
    {"role": "fournisseurs_immobilisations", "compte": "404100", "prefixe_auxiliaire": "IM"},
    {"role": "clients", "compte": "411100", "prefixe_auxiliaire": "CL"}, {"role": "exploitant", "compte": "108100"},
    {"role": "associe", "compte": "455100"}, {"role": "autres_debiteurs_crediteurs", "compte": "467100"},
    {"role": "emprunt", "compte": "164100"}, {"role": "interets_emprunt", "compte": "661110"},
    {"role": "assurance_emprunt", "compte": "616810"}, {"role": "cotisations_exploitant", "compte": "646100"},
    {"role": "dotations_amortissements", "compte": "681110"}, {"role": "indemnites_kilometriques", "compte": "625111"},
    {"role": "virements_internes", "compte": "580100"}, {"role": "depots_cautionnements_verses", "compte": "275100"},
    {"role": "capital_individuel", "compte": "101100"}, {"role": "resultat_benefice", "compte": "120100"},
    {"role": "resultat_perte", "compte": "129100"}, {"role": "prestations_de_services", "compte": "706100"},
    {"role": "ventes_de_biens", "compte": "707100"}, {"role": "tva_collectee_en_attente", "compte": "445801"},
    {"role": "valeurs_a_l_encaissement", "compte": "511100"}, {"role": "caisse", "compte": "531000"},
    {"role": "services_bancaires", "compte": "627100"}]';
  nr constant text := (select count(*)::text from roles_comptables);
  nd constant text := jsonb_array_length(decale::jsonb)::text;
  -- Les phrases des refus, telles que les fonctions et les déclencheurs les disent.
  pas_chef constant text := 'Le modèle de plan de ce cabinet ne se règle que par son chef.';
  pas_lu constant text := 'Accès refusé à ce cabinet.';
  pas_dossier constant text := 'Accès refusé à ce dossier.';
  directe constant text := 'Le modèle de plan d''un cabinet ne s''écrit pas directement : il se règle par regler_modele_du_cabinet, par le chef du cabinet.';
  liste constant text := 'Le modèle se règle par la liste des rôles que le cabinet règle : [{"role": …, "compte": …, "libelle": …, "prefixe_auxiliaire": …}].';
  six constant text := 'Le compte du rôle « %s » s''écrit en six chiffres : « %s » n''en est pas un.';
  racine constant text := 'Le compte du rôle « %s » commence par sa racine du plan comptable (%s) : « %s » n''en est pas un.';
  libelle constant text := 'Le libellé du rôle « %s » tient sur une ligne, d''un à deux cents caractères ; nul, c''est celui du catalogue.';
  verrou constant text := 'Le plan comptable de ce dossier ne se change plus : il porte déjà %s, qui resteraient sur les anciens comptes.';
  -- Les requêtes qui reviennent.
  regler constant text := $q$select regler_modele_du_cabinet('{CAB}', '{L}'::jsonb)::text$q$;
  lire constant text := $q$select count(*)::text from modele_du_cabinet('{CAB}')$q$;
  lignes constant text := $q$select count(*)::text from plan_comptable_cabinet where cabinet_id = '{CAB}'$q$;
  appliquer constant text := $q$select appliquer_modele_du_cabinet('{DT}')::text$q$;
  pose_decale constant text := $q$select regler_modele_du_cabinet('{CAB}', '{PD}'::jsonb)$q$;
  porte constant text := $q$select set_config('jd.regler_modele_du_cabinet', '{CAB}', true)$q$;
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text;
  substitutions text[];
  modeles_avant bigint; plans_avant bigint;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.regler_modele_du_cabinet(uuid, jsonb)') is null then
    perform set_config('essai.modele_du_cabinet', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration modele_de_plan_du_cabinet', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  if cabinet is null or not exists (select 1 from super_admins where user_id = chef::uuid)
     or exists (select 1 from dossiers where id in (dt::uuid, de::uuid, dx::uuid))
     or exists (select 1 from cabinets where id in (autre::uuid, cx::uuid))
     or exists (select 1 from cabinet_admins where user_id = client::uuid) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable (le cabinet du dossier test, un super-administrateur), identifiant d''essai déjà pris, ou compte client déjà rattaché à un cabinet';
  end if;
  select count(*) into modeles_avant from plan_comptable_cabinet;
  select count(*) into plans_avant from plan_comptable_dossier;
  substitutions := array['{PD}', decale, '{CAB}', cabinet::text, '{AUTRE}', autre, '{CX}', cx, '{DT}', dt, '{DE}', de,
                         '{DX}', dx, '{CHEF}', chef, '{CLIENT}', client];
  begin
    -- Le jeu, par le propriétaire sous la session du super-administrateur.
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (dt::uuid, 'ESSAI PC5 DT', cabinet, 'tresorerie', '455000'),
      (de::uuid, 'ESSAI PC5 DE', cabinet, 'engagement', '108000');
    insert into memberships (id, user_id, dossier_id, role, email) values
      (acces::uuid, client::uuid, dt::uuid, 'client', 'essai-pc5@example.test');
    perform set_config('request.jwt.claims', '', true);

    -- Une étape : {rang, étape, ce que le PROPRIÉTAIRE pose d'abord sous la session du super-administrateur, le profil —
    -- `chef` (super-administrateur), `chef_simple` (le compte client rattaché au cabinet comme chef, le temps de l'étape),
    -- `chef_autre` (le compte client chef d'un AUTRE cabinet), `membre` (rattaché comme comptable, aucun dossier affecté),
    -- `membre_affecte` (DT affecté), `client`, `inconnu`, `anon`, `proprio` (le propriétaire, sans session),
    -- `proprio_chef` (le propriétaire, sous la session du super-administrateur) —, sa requête, le code attendu (`OK` :
    -- acceptée) et ce qu'elle rend, ou les mots du refus}. `{L}` vaut `[]` quand l'étape ne le remplace pas.
    for e in select * from (values
      -- ══ Qui règle le modèle (43-Q3 : le chef seul) ══
      (1, '1. l''anonyme n''exécute pas la fonction (42501)', null, 'anon', regler, '42501', 'permission denied for function regler_modele_du_cabinet'),
      (2, '2. un compte rattaché à rien : refusé (42501)', null, 'inconnu', regler, '42501', pas_chef),
      (3, '3. le client d''un dossier du cabinet : refusé (42501)', null, 'client', regler, '42501', pas_chef),
      (4, '4. un membre de l''équipe qui n''est pas chef : refusé (42501)', null, 'membre', regler, '42501', pas_chef),
      (5, '5. le chef d''un autre cabinet : refusé (42501)', null, 'chef_autre', regler, '42501', pas_chef),
      (6, '6. un cabinet qui n''existe pas, même au super-administrateur : refusé (42501)', null, 'chef', replace(regler, '{CAB}', '{CX}'), '42501', pas_chef),
      (7, '7. un chef du cabinet qui n''est pas super-administrateur le règle', null, 'chef_simple', regler, 'OK', ''),
      (8, '8. le chef (super-administrateur) le règle', null, 'chef', regler, 'OK', ''),
      -- ══ Qui lit le modèle (§ 3.10 : toute l'équipe du cabinet) ══
      (10, '10. l''anonyme n''exécute pas la lecture (42501)', null, 'anon', lire, '42501', 'permission denied for function modele_du_cabinet'),
      (11, '11. un compte rattaché à rien ne lit pas le modèle (42501)', null, 'inconnu', lire, '42501', pas_lu),
      (12, '12. le client ne lit pas le modèle (42501)', null, 'client', lire, '42501', pas_lu),
      (13, '13. le chef d''un autre cabinet ne lit pas le modèle (42501)', null, 'chef_autre', lire, '42501', pas_lu),
      (14, '14. un membre de l''équipe qui n''est pas chef lit le modèle effectif : tous les rôles du catalogue (le contrôle positif)', null, 'membre', lire, 'OK', nr),
      (15, '15. … et ses lignes, une fois le modèle réglé', pose_decale, 'membre', lignes, 'OK', nr),
      (16, '16. le client n''en lit aucune ligne', pose_decale, 'client', lignes, 'OK', '0'),
      (17, '17. le chef d''un autre cabinet n''en lit aucune ligne', pose_decale, 'chef_autre', lignes, 'OK', '0'),
      (18, '18. un compte rattaché à rien n''en lit aucune ligne', pose_decale, 'inconnu', lignes, 'OK', '0'),
      (19, '19. l''anonyme n''en lit aucune ligne', pose_decale, 'anon', lignes, 'OK', '0'),
      -- ══ Aucune écriture directe, et ce qu'une ligne EST ══
      (20, '20. le chef n''insère pas une ligne directement : la garde (42501)', null, 'chef',
        $q$insert into plan_comptable_cabinet (cabinet_id, role, compte) values ('{CAB}', 'banque', '512100') returning role$q$, '42501', directe),
      (21, '21. le propriétaire non plus (42501)', null, 'proprio',
        $q$insert into plan_comptable_cabinet (cabinet_id, role, compte) values ('{CAB}', 'banque', '512100') returning role$q$, '42501', directe),
      (22, '22. le chef ne met à jour aucune ligne : aucune policy de mise à jour', pose_decale, 'chef',
        $q$with t as (update plan_comptable_cabinet set libelle = 'ESSAI' where cabinet_id = '{CAB}' returning 1) select count(*)::text from t$q$, 'OK', '0'),
      (23, '23. le propriétaire ne met pas une ligne à jour hors de la fonction : la garde (42501)', pose_decale, 'proprio',
        $q$update plan_comptable_cabinet set libelle = 'ESSAI' where cabinet_id = '{CAB}' and role = 'banque' returning role$q$, '42501', directe),
      (24, '24. une ligne ne change ni de cabinet ni de rôle, même sous la porte (42501)', pose_decale || '; ' || porte, 'proprio',
        $q$update plan_comptable_cabinet set role = 'caisse' where cabinet_id = '{CAB}' and role = 'banque' returning role$q$, '42501',
        'Une ligne du modèle de plan d''un cabinet ne change ni de cabinet ni de rôle.'),
      (25, '25. sous la porte, la garde exige six chiffres (23514)', porte, 'proprio',
        $q$insert into plan_comptable_cabinet (cabinet_id, role, compte) values ('{CAB}', 'banque', '51210') returning role$q$, '23514',
        format(six, 'banque', '51210')),
      (26, '26. … la racine du rôle (23514)', porte, 'proprio',
        $q$insert into plan_comptable_cabinet (cabinet_id, role, compte) values ('{CAB}', 'banque', '531000') returning role$q$, '23514',
        format(racine, 'banque', '512', '531000')),
      (27, '27. … un préfixe sur les seuls tiers (23514)', porte, 'proprio',
        $q$insert into plan_comptable_cabinet (cabinet_id, role, compte, prefixe_auxiliaire) values ('{CAB}', 'banque', '512100', 'BQ') returning role$q$, '23514',
        'Seuls les comptes de tiers (fournisseurs, fournisseurs d''immobilisations, clients) portent un préfixe de comptes auxiliaires : pas le rôle « banque ».'),
      (28, '28. … un préfixe de sa forme (23514)', porte, 'proprio',
        $q$insert into plan_comptable_cabinet (cabinet_id, role, compte, prefixe_auxiliaire) values ('{CAB}', 'fournisseurs', '401100', 'f') returning role$q$, '23514',
        'Le préfixe des comptes auxiliaires du rôle « fournisseurs » s''écrit d''une à cinq lettres majuscules ou chiffres : « f » n''en est pas un.'),
      (29, '29. … un libellé d''une ligne non vide : la contrainte (23514)', porte, 'proprio',
        $q$insert into plan_comptable_cabinet (cabinet_id, role, compte, libelle) values ('{CAB}', 'banque', '512100', '   ') returning role$q$, '23514',
        'new row for relation "plan_comptable_cabinet" violates check constraint "plan_comptable_cabinet_libelle"'),
      -- ══ Les refus de regler_modele_du_cabinet, sous leurs mots et dans leur ordre ══
      (30, '30. la demande n''est pas une liste (22023)', null, 'chef', replace(regler, '{L}', '{}'), '22023', liste),
      (31, '31. un rôle illisible (22023)', null, 'chef', replace(regler, '{L}', '[{"role": "banque"}]'), '22023',
        'Le rôle n° 1 du modèle ne se lit pas : un objet qui porte « role » et « compte » en texte, et au plus « libelle » et « prefixe_auxiliaire », en texte ou nuls.'),
      (32, '32. un rôle inconnu (22023)', null, 'chef', replace(regler, '{L}', '[{"role": "inexistant", "compte": "512100"}]'), '22023',
        'Rôle comptable inconnu : « inexistant ».'),
      (33, '33. un rôle deux fois (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "banque", "compte": "512100"}, {"role": "banque", "compte": "512200"}]'), '22023',
        'Le rôle « banque » paraît deux fois dans le modèle : un rôle, un compte.'),
      (34, '34. un compte qui n''est pas de six chiffres (22023)', null, 'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "5121"}]'), '22023',
        format(six, 'banque', '5121')),
      (35, '35. un compte hors des racines du rôle (22023)', null, 'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "531000"}]'), '22023',
        format(racine, 'banque', '512', '531000')),
      (36, '36. deux rôles du modèle effectif sur le même compte, à des zéros près (22023)',
        $q$insert into roles_comptables (role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre) values ('essai_chevauche', '{5121}', '512100', 'Essai', null, 9999)$q$,
        'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "512100"}]'), '22023',
        'Les rôles « banque » et « essai_chevauche » se tiendraient sur le même compte (« 512100 »), à des zéros près : un compte ne tient qu''un rôle.'),
      (37, '37. un rôle du bilan sur le compte d''une catégorie COMMUNE, à des zéros près (22023)',
        $q$alter table categories disable trigger user; insert into categories (dossier_id, code, libelle, compte_comptable) values (null, 'essai_pc5_commune', 'Essai PC5 commune', '1081'); alter table categories enable trigger user$q$,
        'chef', replace(regler, '{L}', '[{"role": "exploitant", "compte": "108100"}]'), '22023',
        'Le compte « 108100 » du rôle « exploitant » est celui d''une catégorie commune à tous les dossiers (« 1081 »), à des zéros près : un compte de bilan que l''application écrit ne se partage pas avec une catégorie.'),
      (38, '38. les indemnités kilométriques sur le compte d''une catégorie commune (22023)',
        $q$insert into categories (dossier_id, code, libelle, compte_comptable) values (null, 'essai_pc5_carburant', 'Essai PC5 carburant', '625120')$q$,
        'chef', replace(regler, '{L}', '[{"role": "indemnites_kilometriques", "compte": "625120"}]'), '22023',
        'Le compte des indemnités kilométriques (« 625120 ») est celui d''une catégorie commune à tous les dossiers (« 625120 »), à des zéros près : le barème et les frais réels restent séparés.'),
      (39, '39. la catégorie d''UN dossier ne retient pas le modèle : ce dossier la lui opposera',
        $q$alter table categories disable trigger user; insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DT}', 'essai_pc5_dossier', 'Essai PC5 dossier', '108100'); alter table categories enable trigger user$q$,
        'chef', replace(regler, '{L}', '[{"role": "exploitant", "compte": "108100"}]'), 'OK', ''),
      (40, '40. un libellé blanc (22023)', null, 'chef', replace(regler, '{L}', '[{"role": "banque", "compte": "512100", "libelle": "  "}]'), '22023',
        format(libelle, 'banque')),
      (41, '41. un libellé qui porte un caractère de contrôle (22023)', null, 'chef',
        $q$select regler_modele_du_cabinet('{CAB}', jsonb_build_array(jsonb_build_object('role', 'banque', 'compte', '512100', 'libelle', 'Banque' || chr(9) || 'principale')))::text$q$,
        '22023', format(libelle, 'banque')),
      (42, '42. un libellé de plus de deux cents caractères (22023)', null, 'chef',
        $q$select regler_modele_du_cabinet('{CAB}', jsonb_build_array(jsonb_build_object('role', 'banque', 'compte', '512100', 'libelle', repeat('x', 201))))::text$q$,
        '22023', format(libelle, 'banque')),
      (43, '43. un préfixe hors des tiers (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "banque", "compte": "512000", "prefixe_auxiliaire": "BQ"}]'), '22023',
        'Seuls les comptes de tiers (fournisseurs, fournisseurs d''immobilisations, clients) portent un préfixe de comptes auxiliaires : pas le rôle « banque ».'),
      (44, '44. un préfixe hors de sa forme (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "fournisseurs", "compte": "401000", "prefixe_auxiliaire": "f"}]'), '22023',
        'Le préfixe des comptes auxiliaires du rôle « fournisseurs » s''écrit d''une à cinq lettres majuscules ou chiffres : « f » n''en est pas un.'),
      (45, '45. deux tiers du modèle effectif au même préfixe (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "fournisseurs", "compte": "401000", "prefixe_auxiliaire": "C"}]'), '22023',
        'Les rôles « fournisseurs » et « clients » partageraient le préfixe de comptes auxiliaires « C » : deux natures de tiers ne partagent pas un compte auxiliaire.'),
      (46, '46. l''ordre : six chiffres avant la racine, même sur une ligne plus loin (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "banque", "compte": "531000"}, {"role": "caisse", "compte": "5300"}]'), '22023',
        format(six, 'caisse', '5300')),
      (47, '47. dans un refus, la première ligne fautive l''emporte (22023)', null, 'chef',
        replace(regler, '{L}', '[{"role": "banque", "compte": "5121"}, {"role": "caisse", "compte": "5300"}]'), '22023',
        format(six, 'banque', '5121')),
      -- ══ Ce qu'elle écrit ══
      (50, '50. le modèle décalé s''écrit tout entier : une ligne par rôle du catalogue, réglées par le chef', pose_decale, 'proprio',
        $q$select count(*) || ' ' || bool_and(regle_par = '{CHEF}') from plan_comptable_cabinet where cabinet_id = '{CAB}'$q$, 'OK', nr || ' true'),
      (51, '51. … et se lit : les rôles décalés du modèle parmi tous ceux du catalogue, la banque au 512100, les fournisseurs sous FO', pose_decale, 'proprio_chef',
        $q$select count(*) filter (where origine = 'modele_du_cabinet') || ' ' || count(*) || ' ' || max(compte) filter (where role = 'banque') || ' ' || max(prefixe_auxiliaire) filter (where role = 'fournisseurs') from modele_du_cabinet('{CAB}')$q$,
        'OK', nd || ' ' || nr || ' 512100 FO'),
      (52, '52. une liste vide rend le modèle au catalogue : ses lignes restent, une par rôle, aux valeurs du catalogue', pose_decale || $q$; select regler_modele_du_cabinet('{CAB}', '[]'::jsonb)$q$, 'proprio_chef',
        $q$select count(*) || ' ' || bool_and(origine = 'application') || ' ' || (select count(*) from plan_comptable_cabinet where cabinet_id = '{CAB}') || ' ' || bool_and(compte = (select r.compte_defaut from roles_comptables r where r.role = m.role)) from modele_du_cabinet('{CAB}') m$q$,
        'OK', nr || ' true ' || nr || ' true'),
      (53, '53. un rôle réglé seul : un rôle du modèle, son libellé', $q$select regler_modele_du_cabinet('{CAB}', '[{"role": "banque", "compte": "512100", "libelle": "Banque principale"}]'::jsonb)$q$, 'proprio_chef',
        $q$select count(*) filter (where origine = 'modele_du_cabinet') || ' ' || max(compte || ' ' || libelle) filter (where origine = 'modele_du_cabinet') from modele_du_cabinet('{CAB}')$q$,
        'OK', '1 512100 Banque principale'),
      (54, '54. la porte de la garde est refermée après le réglage', pose_decale, 'proprio',
        $q$select '[' || coalesce(current_setting('jd.regler_modele_du_cabinet', true), '') || ']'$q$, 'OK', '[]'),
      (55, '55. une ligne inchangée garde son auteur : le chef, puis un autre chef qui ne change que la banque', pose_decale
        || $q$; insert into cabinet_admins (user_id, cabinet_id, role) values ('{CLIENT}', '{CAB}', 'comptable_en_chef'); select set_config('request.jwt.claims', json_build_object('sub', '{CLIENT}', 'role', 'authenticated')::text, true); select regler_modele_du_cabinet('{CAB}', replace('{PD}', '"512100"', '"512200"')::jsonb)$q$,
        'proprio', $q$select count(*) filter (where regle_par = '{CHEF}') || ' ' || count(*) filter (where regle_par = '{CLIENT}') || ' ' || max(compte) filter (where role = 'banque') from plan_comptable_cabinet where cabinet_id = '{CAB}'$q$,
        'OK', (nr::int - 1) || ' 1 512200'),
      -- ══ Appliquer le modèle à un dossier ══
      (60, '60. le chef applique le modèle décalé à un dossier vide : ses rôles réglés copiés', pose_decale, 'chef', appliquer, 'OK', nd),
      (61, '61. … d''origine « modele_du_cabinet », réglés par lui', pose_decale || $q$; select appliquer_modele_du_cabinet('{DT}')$q$, 'proprio',
        $q$select count(*) || ' ' || bool_and(origine = 'modele_du_cabinet') || ' ' || bool_and(regle_par = '{CHEF}') from plan_comptable_dossier where dossier_id = '{DT}'$q$,
        'OK', nd || ' true true'),
      (62, '62. … le dirigeant suit son rôle (PC3-Q1) : 455000 → 455100', pose_decale || $q$; select appliquer_modele_du_cabinet('{DT}')$q$, 'proprio',
        $q$select compte_notes_de_frais from dossiers where id = '{DT}'$q$, 'OK', '455100'),
      (63, '63. … et le plan du dossier le dit : la banque au 512100, du modèle du cabinet', pose_decale || $q$; select appliquer_modele_du_cabinet('{DT}')$q$, 'proprio_chef',
        $q$select p.compte || ' ' || p.origine from plan_du_dossier('{DT}') p where p.role = 'banque'$q$, 'OK', '512100 modele_du_cabinet'),
      (64, '64. en engagement, le dirigeant au 108 suit le sien : 108000 → 108100', pose_decale || $q$; select appliquer_modele_du_cabinet('{DE}')$q$, 'proprio',
        $q$select compte_notes_de_frais from dossiers where id = '{DE}'$q$, 'OK', '108100'),
      (65, '65. un modèle jamais réglé ne copie rien', null, 'chef', appliquer, 'OK', '0'),
      (66, '66. un modèle rendu au catalogue ne copie rien, et le plan du dossier reste vide', pose_decale || $q$; select regler_modele_du_cabinet('{CAB}', '[]'::jsonb); select appliquer_modele_du_cabinet('{DT}')$q$, 'proprio',
        $q$select (select count(*) from plan_comptable_dossier where dossier_id = '{DT}') || ' ' || (select count(*) from plan_comptable_cabinet where cabinet_id = '{CAB}')$q$,
        'OK', '0 ' || nr),
      (67, '67. un seul rôle réglé : un seul rôle copié', $q$select regler_modele_du_cabinet('{CAB}', '[{"role": "banque", "compte": "512100", "libelle": "Banque principale"}]'::jsonb)$q$, 'chef', appliquer, 'OK', '1'),
      (68, '68. les deux portes sont refermées après l''application', pose_decale || $q$; select appliquer_modele_du_cabinet('{DT}')$q$, 'proprio',
        $q$select '[' || coalesce(current_setting('jd.appliquer_modele_du_cabinet', true), '') || '|' || coalesce(current_setting('jd.regler_plan_du_dossier', true), '') || ']'$q$, 'OK', '[|]'),
      (69, '69. regler_plan_du_dossier, ensuite, écrit comme hier : l''origine « dossier »', pose_decale
        || $q$; select appliquer_modele_du_cabinet('{DT}'); select regler_plan_du_dossier('{DT}', '[{"role": "banque", "compte": "512300"}]'::jsonb)$q$, 'proprio',
        $q$select string_agg(role || ':' || compte || ':' || origine, ',') from plan_comptable_dossier where dossier_id = '{DT}'$q$, 'OK', 'banque:512300:dossier'),
      (70, '70. un dossier qui porte une écriture : le verrou de regler_plan_du_dossier (23514)', pose_decale
        || $q$; insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values ('{DT}', '2026-03-01', '606100', 'ESSAI PC5', 1, 'debit')$q$,
        'chef', appliquer, '23514', format(verrou, '1 écriture(s) au brouillon')),
      (71, '71. un dossier qui porte un à-nouveau : le même verrou (23514)', pose_decale
        || $q$; insert into a_nouveaux (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values ('{DT}', '2026-01-01', '512000', 'Banque', 'debit', 1, 'essai pc5', repeat('0', 64))$q$,
        'chef', appliquer, '23514', format(verrou, '1 à-nouveau(x)')),
      (72, '72. une catégorie du dossier sur un compte du modèle : le refus de regler_plan_du_dossier, au dossier (22023)',
        $q$alter table categories disable trigger user; insert into categories (dossier_id, code, libelle, compte_comptable) values ('{DT}', 'essai_pc5_dossier', 'Essai PC5 dossier', '108100'); alter table categories enable trigger user; select regler_modele_du_cabinet('{CAB}', '[{"role": "exploitant", "compte": "108100"}]'::jsonb)$q$,
        'chef', appliquer, '22023',
        'Le compte « 108100 » du rôle « exploitant » est celui d''une catégorie que ce dossier emploie (« 108100 »), à des zéros près : un compte de bilan que l''application écrit ne se partage pas avec une catégorie.'),
      (73, '73. le client du dossier n''applique pas le modèle (42501)', pose_decale, 'client', appliquer, '42501', pas_dossier),
      (74, '74. un membre de l''équipe à qui le dossier n''est pas ouvert non plus (42501)', pose_decale, 'membre', appliquer, '42501', pas_dossier),
      (75, '75. le membre à qui le dossier est ouvert l''applique (43-Q3, comme le modèle comptable)', pose_decale, 'membre_affecte', appliquer, 'OK', nd),
      (76, '76. un compte rattaché à rien : refusé (42501)', pose_decale, 'inconnu', appliquer, '42501', pas_dossier),
      (77, '77. l''anonyme n''exécute pas la fonction (42501)', pose_decale, 'anon', appliquer, '42501', 'permission denied for function appliquer_modele_du_cabinet'),
      (78, '78. un dossier qui n''existe pas : refusé (42501)', pose_decale, 'chef', replace(appliquer, '{DT}', '{DX}'), '42501', pas_dossier),
      (79, '79. le chef d''un autre cabinet : refusé (42501)', pose_decale, 'chef_autre', appliquer, '42501', pas_dossier),
      (80, '80. le modèle d''un AUTRE cabinet ne se copie jamais dans un dossier de celui-ci',
        $q$insert into cabinets (id, nom) values ('{AUTRE}', 'ESSAI PC5 AUTRE'); select regler_modele_du_cabinet('{AUTRE}', '{PD}'::jsonb)$q$,
        'chef', appliquer, 'OK', '0')
    ) as t(rang, etape, pose, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      begin
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        elsif e.profil in ('membre', 'membre_affecte') then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable');
          if e.profil = 'membre_affecte' then
            insert into dossier_assignations (dossier_id, user_id) values (dt::uuid, client::uuid);
          end if;
        elsif e.profil = 'chef_autre' then
          insert into cabinets (id, nom) values (autre::uuid, 'ESSAI PC5 AUTRE');
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, autre::uuid, 'comptable_en_chef');
        end if;
        if e.pose is not null then
          v_pose := e.pose;
          for i in 1 .. array_length(substitutions, 1) / 2 loop
            v_pose := replace(v_pose, substitutions[2 * i - 1], substitutions[2 * i]);
          end loop;
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          perform set_config('request.jwt.claims', '', true);
        end if;
        v_req := replace(e.requete, '{L}', '[]');
        for i in 1 .. array_length(substitutions, 1) / 2 loop
          v_req := replace(v_req, substitutions[2 * i - 1], substitutions[2 * i]);
        end loop;
        begin
          if e.profil = 'anon' then
            execute 'set local role anon';
            perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          elsif e.profil = 'proprio' then
            perform set_config('request.jwt.claims', '', true);
          elsif e.profil = 'proprio_chef' then
            perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          else
            execute 'set local role authenticated';
            perform set_config('request.jwt.claims',
              json_build_object('sub', case e.profil when 'chef' then chef when 'inconnu' then inconnu else client end, 'role', 'authenticated')::text, true);
          end if;
          execute v_req into v_obs;
          reset role;
          v_msg := coalesce(v_obs, '');
        exception when others then
          reset role;
          v_code := sqlstate;
          v_msg := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        if sqlerrm <> 'ANNULATION_ETAPE' then
          v_code := 'ESSAI';
          v_msg := sqlstate || ' ' || sqlerrm;
        end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and v_msg = e.attendu, 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;

    -- ══ 90 à 94. Le catalogue ══
    select string_agg(p.proname || ':' || case when p.prosecdef then 'definer' else 'invoker' end || ':' || p.provolatile::text || ':'
             || array_to_string(coalesce(p.proconfig, '{}'), ',') || ':anon=' || has_function_privilege('anon', p.oid, 'execute')
             || ':connecte=' || has_function_privilege('authenticated', p.oid, 'execute'), ' ; ' order by p.proname collate "C") into v_obs
      from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('appliquer_modele_du_cabinet', 'garder_plan_comptable_cabinet', 'modele_du_cabinet', 'origine_du_modele_applique',
                         'regler_modele_du_cabinet');
    verdicts := verdicts || jsonb_build_object('rang', 90, 'etape', '90. les fonctions : leurs droits, leur search_path ; les trois de l''application aux connectés seuls, les deux de déclencheur à personne',
      'ok', v_obs = 'appliquer_modele_du_cabinet:definer:v:search_path=public:anon=false:connecte=true ; '
                 || 'garder_plan_comptable_cabinet:definer:v:search_path=public:anon=false:connecte=false ; '
                 || 'modele_du_cabinet:invoker:s:search_path=public:anon=false:connecte=true ; '
                 || 'origine_du_modele_applique:invoker:v:search_path=public:anon=false:connecte=false ; '
                 || 'regler_modele_du_cabinet:definer:v:search_path=public:anon=false:connecte=true',
      'observe', v_obs);
    select string_agg(pg_get_triggerdef(t.oid), ' ; ' order by t.tgname collate "C") into v_obs from pg_trigger t
     where not t.tgisinternal and t.tgname in ('plan_comptable_cabinet_gardes', 'plan_comptable_dossier_origine');
    verdicts := verdicts || jsonb_build_object('rang', 91, 'etape', '91. les deux déclencheurs : leurs tables, leurs moments, leurs évènements',
      'ok', v_obs = 'CREATE TRIGGER plan_comptable_cabinet_gardes BEFORE INSERT OR DELETE OR UPDATE ON public.plan_comptable_cabinet FOR EACH ROW EXECUTE FUNCTION garder_plan_comptable_cabinet() ; '
                 || 'CREATE TRIGGER plan_comptable_dossier_origine BEFORE INSERT ON public.plan_comptable_dossier FOR EACH ROW EXECUTE FUNCTION origine_du_modele_applique()',
      'observe', v_obs);
    select string_agg(t.tgname, ',' order by t.tgname collate "C") into v_obs from pg_trigger t
     where not t.tgisinternal and (t.tgtype & 2) = 2 and t.tgrelid = 'public.plan_comptable_dossier'::regclass;
    verdicts := verdicts || jsonb_build_object('rang', 92, 'etape', '92. l''ordre des déclencheurs BEFORE du plan d''un dossier : la garde, puis l''origine',
      -- Après MCB1 (comptes_bancaires), sa garde d'un compte bancaire se range entre les deux : elle ne lit que le compte,
      -- que l'origine ne touche pas.
      'ok', v_obs in ('plan_comptable_dossier_gardes,plan_comptable_dossier_origine',
                      'plan_comptable_dossier_gardes,plan_comptable_dossier_hors_des_comptes_bancaires,plan_comptable_dossier_origine'),
      'observe', v_obs);
    select string_agg(p.policyname || ':' || p.permissive || ':' || array_to_string(p.roles, ',') || ':' || p.cmd || ':' || coalesce(p.qual, '')
             || ':' || coalesce(p.with_check, ''), ' ; ' order by p.policyname collate "C") into v_obs
      from pg_policies p where p.schemaname = 'public' and p.tablename = 'plan_comptable_cabinet'
       and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE');
    verdicts := verdicts || jsonb_build_object('rang', 93, 'etape', '93. une seule policy : la lecture par l''équipe du cabinet, aucune écriture',
      'ok', v_obs = 'plan_comptable_cabinet_lecture:PERMISSIVE:authenticated:SELECT:admin_du_cabinet(cabinet_id):', 'observe', v_obs);
    select c.relrowsecurity::text || ' ' || (select string_agg(conname || '=' || contype::text, ',' order by conname collate "C") from pg_constraint
                                             where conrelid = 'public.plan_comptable_cabinet'::regclass) into v_obs
      from pg_class c where c.oid = 'public.plan_comptable_cabinet'::regclass;
    verdicts := verdicts || jsonb_build_object('rang', 94, 'etape', '94. la RLS active ; la clé (cabinet, rôle), les deux clés étrangères, les deux contrôles',
      'ok', v_obs = 'true plan_comptable_cabinet_cabinet_id_fkey=f,plan_comptable_cabinet_compte=c,plan_comptable_cabinet_libelle=c,plan_comptable_cabinet_pkey=p,plan_comptable_cabinet_role_fkey=f',
      'observe', v_obs);
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les dossiers jetables, ni l'accès, ni l'autre cabinet, ni le compte d'essai dans un cabinet, ni une
  -- ligne d'un modèle ou d'un plan (l'écart seul), ni une catégorie ni un rôle plantés.
  verdicts := verdicts || jsonb_build_object('rang', 199, 'etape', '199. rien n''est resté : ni les dossiers jetables, ni l''accès, ni l''autre cabinet, ni le compte d''essai dans un cabinet, ni une ligne d''un modèle ou d''un plan, ni une catégorie ni un rôle plantés',
    'ok', not exists (select 1 from dossiers where id in (dt::uuid, de::uuid, dx::uuid))
      and not exists (select 1 from memberships where id = acces::uuid)
      and not exists (select 1 from cabinets where id in (autre::uuid, cx::uuid))
      and not exists (select 1 from cabinet_admins where user_id = client::uuid)
      and not exists (select 1 from categories where code like 'essai\_pc5%')
      and not exists (select 1 from roles_comptables where role = 'essai_chevauche')
      and (select count(*) from plan_comptable_cabinet) = modeles_avant
      and (select count(*) from plan_comptable_dossier) = plans_avant,
    'observe', 'relu');
  perform set_config('essai.modele_du_cabinet', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.modele_du_cabinet')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
