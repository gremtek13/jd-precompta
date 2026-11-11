-- L'ORIGINAL D'UNE FACTURE REPRISE NE SE SUPPRIME PLUS TANT QUE SON IMPORT EXISTE, ET LA SUPPRESSION D'UN DOSSIER RESTE
-- D'UN SEUL GESTE (ligne 51.5, A8D2A-Q1 ; migration `originaux_retenus_par_leur_import`, PRÉPARÉE) — SUR UNE RÉPLIQUE
-- SEULEMENT, par psql, en UNE transaction (`psql -1`) : ce fichier porte des SUPPRESSIONS de lignes de `storage.objects` et
-- de dossiers, et des mutations du schéma, qu'on ne joue pas sur la base du cabinet ; il ne laisse rien. La lecture du
-- catalogue et le jugement des prédicats sans suppression se rejouent par le bloc OR de `rls.sql`, en production aussi. Le
-- récit : HISTORIQUE.md, « 11/11/2026 — A8D2A-Q1 ».
--
-- LE RÉGLAGE DE L'API, comme `pieceFigeeDansLeStockage.sql` (INAL1) : le stockage refuse toute suppression SQL directe de
-- `storage.objects` (`storage.protect_delete`, 42501) ; l'API supprime sous la session de l'appelant, le réglage
-- `storage.allow_delete_query` posé, en nommant ses lignes et en les rendant — les policies de LECTURE et de SUPPRESSION
-- décident seules, et une ligne qu'elles écartent n'est simplement pas supprimée. Le NOMBRE de lignes supprimées dit si la
-- policy l'admet. Ce qu'il ne prouve pas : que l'API pose ce réglage comme ici, ni rien du fichier lui-même.
--
-- LE JEU, dans un dossier jetable A du cabinet du chef (basculé, en trésorerie) : la date de reprise, puis un import par
-- `importer_factures` (le chef) — le lot porte son fichier (L), une de ses deux factures le sien (F) ; dans le seau `ventes`,
-- L et F, un fichier sous le lot qu'aucune ligne ne désigne (X), un fichier sous un lot qui n'existe pas (Y), le logo (G).
-- CE QUI SE PROUVE, par impersonation :
--   1 à 5. Le super-administrateur ne supprime ni L ni F ; il supprime X, Y et le logo (contrôles POSITIFS) ;
--   6 à 10. Le chef du cabinet non super-administrateur : ni L, mais X ; un membre affecté, le client « Ventes », le chef
--          d'un autre cabinet, un compte rattaché à rien, l'anonyme : rien, comme hier ;
--   11. Un lot sur tout le préfixe de A, comme le premier passage de l'application : X, Y et le logo partent, L et F restent ;
--   12, 13. « Retirer l'import » (`retirer_import`, les lignes), puis L et F se suppriment : par le super-administrateur,
--          par le chef non super-administrateur — l'ordre de l'écran tient ;
--   14, 15. La suppression de A comme l'application la fait (src/lib/suppressionDossier.ts) : premier passage, ligne,
--          second passage, restés — par le super-administrateur, PUIS PAR LE CHEF QUI NE L'EST PAS : rien ne reste, d'un
--          seul geste ;
--   16 à 19. A supprimé, ses originaux libérés : ni le chef d'un autre cabinet, ni le client, ni un membre du cabinet, ni
--          un compte rattaché à rien ne les voient ni ne les suppriment ;
--   20. La libération range L et F sous le cabinet de A, et rien d'autre ;
--   21, 22. Une suppression du dossier que la RLS refuse (le client, un membre non chef) ne libère rien ;
--   23. La restauration : A recréé sous son identifiant et la ligne de son lot réinsérée par le super-administrateur — L
--       est de nouveau retenu (la libération s'éteint), F, que plus rien ne désigne, se supprime ;
--   24. Sans le réglage de l'API, le stockage refuse à tous ;
--   25. Le dépôt d'un original reste ouvert au cabinet ;
--   26 à 28. `original_d_un_import` : vrai pour L et F au chef, faux pour X ; NUL à qui n'administre pas le dossier, et pour
--          un chemin qui ne commence pas par un dossier ;
--   29 à 31. `original_libere` : vrai au chef, A supprimé ; faux au chef d'un autre cabinet ; faux tant que A existe ;
--   32. Le ménage : à la suppression de dossier suivante, la libération dont le fichier a quitté le seau s'efface, l'autre
--       reste.
-- MUTATIONS, chacune doit MORDRE : M1, la policy de suppression d'A8d2a ; M2 et M3, la fonction sans le chemin du lot, sans
-- celui d'une facture ; M4, la fonction qui répond à tous ; M5, le déclencheur éteint ; M6, la libération sans « le dossier
-- n'existe plus » ; M7, la libération à tout chef ; M8, la lecture sans la libération ; M9, le ménage retiré ; M10, la
-- suppression sans la libération. Chacune altère l'objet réel (sa définition lue au catalogue, un fragment remplacé ; un
-- fragment introuvable fait tomber la mutation), dans la sous-transaction de son étape.
--
-- Le moteur est celui de `pieceFigeeDansLeStockage.sql`, le prélude découpé en parties (`§§`) comme l'ordre. Profils :
-- `chef` (le super-administrateur, chef du cabinet de A) ; `chef_du_cabinet`, `membre`, `membre_affecte`, `chef_autre` (le
-- compte du client, rangé ainsi le temps de son étape) ; `client` (son accès « Ventes » à A) ; `inconnu` ; `anon` ;
-- `proprietaire` (sans session).
--
-- La garde de tête : une réplique seulement (le rôle `proprietaire`, absent de la production), avant toute écriture.
do $essai$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  cabinet uuid;
  reprise constant date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  ids jsonb;
  avant text; apres text;
  s record; k text; ordre text; prelude text; partie text; attendu text; rendu text; accepte boolean; code_recu text;
  message text; ok boolean;
  erreur text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai supprime des lignes et ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regprocedure('public.original_d_un_import(text)') is null then
    verdicts := verdicts || jsonb_build_object('controle', '0. EN ATTENTE : la migration originaux_retenus_par_leur_import n''est pas en base',
      'genre', 'controle', 'observe', 'original_d_un_import absente', 'ok', true);
    perform set_config('essai.original_d_un_import', verdicts::text, true);
    return;
  end if;
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from super_admins where user_id = client)
     or not exists (select 1 from super_admins where user_id = chef) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou comptes rattachés autrement qu''attendu';
  end if;

  -- Une mutation altère la fonction réelle : sa définition lue au catalogue, un fragment remplacé. Introuvable, le
  -- fragment fait lever : la mutation tombe, au lieu de passer pour un contrôle qui mord.
  create function pg_temp.muter(p_fonction text, p_de text, p_vers text) returns text language plpgsql as $m$
  declare
    d text := pg_get_functiondef(p_fonction::regprocedure);
  begin
    if position(p_de in d) = 0 then
      raise exception 'MUTATION_SANS_PRISE : %', p_de;
    end if;
    execute replace(d, p_de, p_vers);
    return 'mutée';
  end
  $m$;
  -- Une policy du seau des ventes, son prédicat lu au catalogue (sous un chemin vide), un fragment remplacé.
  create function pg_temp.muter_policy(p_policy text, p_de text, p_vers text) returns text language plpgsql as $m$
  declare
    chemin constant text := current_setting('search_path');
    q text;
  begin
    perform set_config('search_path', '', true);
    select pg_get_expr(p.polqual, p.polrelid) into q from pg_policy p
     where p.polrelid = 'storage.objects'::regclass and p.polname = p_policy;
    perform set_config('search_path', chemin, true);
    if q is null or position(p_de in q) = 0 then
      raise exception 'MUTATION_SANS_PRISE : %', p_de;
    end if;
    execute format('alter policy %I on storage.objects using (%s)', p_policy, replace(q, p_de, p_vers));
    return 'mutée';
  end
  $m$;

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet, 'R', reprise,
    'DA', 'a8d20000-0000-4000-8000-0000000000a1', 'DB', 'a8d20000-0000-4000-8000-0000000000b1',
    'CC', 'a8d20000-0000-4000-8000-0000000000cc', 'ACCES', 'a8d20000-0000-4000-8000-0000000000ac',
    'LOT', 'a8d20000-0000-4000-8000-00000000001a', 'LOT2', 'a8d20000-0000-4000-8000-00000000002a',
    'SL', repeat('1', 64), 'SF', repeat('2', 64), 'SX', repeat('3', 64), 'SY', repeat('4', 64), 'SG', repeat('5', 64));
  -- Les chemins, composés une fois (ils citent d'autres clés).
  ids := ids || jsonb_build_object(
    'L', (ids ->> 'DA') || '/imports/' || (ids ->> 'LOT') || '/' || (ids ->> 'SL') || '.pdf',
    'F', (ids ->> 'DA') || '/imports/' || (ids ->> 'LOT') || '/' || (ids ->> 'SF') || '.xml',
    'X', (ids ->> 'DA') || '/imports/' || (ids ->> 'LOT') || '/' || (ids ->> 'SX') || '.pdf',
    'Y', (ids ->> 'DA') || '/imports/' || (ids ->> 'LOT2') || '/' || (ids ->> 'SY') || '.csv',
    'G', (ids ->> 'DA') || '/logos/' || (ids ->> 'SG') || '.png',
    'N', (ids ->> 'DA') || '/imports/' || (ids ->> 'LOT') || '/' || repeat('6', 64) || '.pdf');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from factures_emises)), ((select count(*) from imports_factures)),
    ((select count(*) from factures_importees)), ((select count(*) from originaux_liberes)),
    ((select count(*) from storage.objects)), ((select count(*) from cabinets))
  ) as t(n);

  begin
    for s in select * from (values
      ('j1', 'jeu', 'le dossier jetable A, basculé, en trésorerie ; un cabinet jetable C', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, statut_tva, siret, adresse, forme_juridique, denomination_imprimee)
            values ('{DA}', 'ESSAI A8D2AQ1 A', '{CAB}', 'tresorerie', '455000', true, 'franchise', '12345678200010', 'ESSAI A8D2AQ1 ADRESSE', '5710', 'ESSAI A8D2AQ1 SOCIÉTÉ')
          §§ insert into cabinets (id, nom) values ('{CC}', 'ESSAI A8D2AQ1 C')$q$, 'OK', null),
      ('j2', 'jeu', 'l''accès « Ventes » du client au dossier A', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email, droit_ventes) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-a8d2aq1@exemple.invalid', true)$q$, 'OK', null),
      ('j3', 'jeu', 'la date de reprise, puis l''import : le lot porte son fichier L, une facture le sien F', 'chef', null,
        $q$select fixer_reprise_des_factures('{DA}', '{R}')::text
          §§ select importer_factures('{DA}', '{"id": "{LOT}", "format": "facturx", "fichier_sha256": "{SL}", "fichier_taille": 1000, "fichier_chemin": "{L}"}'::jsonb,
               '[{"numero": "ANC-2025-001", "type": "facture", "date_emission": "2025-10-15", "tiers_nom": "Client A", "type_client": "non_assujetti",
                  "nature_operation": "services", "option_debits": false, "montant_ht": 100, "montant_tva": 0, "montant_ttc": 100,
                  "lignes": [{"designation": "Séance", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 0}], "transmise_par": "pdf",
                  "fichier_sha256": "{SF}", "fichier_chemin": "{F}"},
                 {"numero": "ANC-2025-002", "type": "facture", "date_emission": "2025-10-20", "tiers_nom": "Client B", "type_client": "non_assujetti",
                  "nature_operation": "services", "option_debits": false, "montant_ht": 50, "montant_tva": 0, "montant_ttc": 50,
                  "lignes": [{"designation": "Séance", "quantite": 1, "prix_unitaire_ht": 50, "taux_tva": 0}], "transmise_par": "papier"}]'::jsonb)::text$q$,
        'OK', '{LOT}'),
      ('j4', 'jeu', 'les cinq fichiers de A dans le seau des ventes : L, F, X, Y et le logo', 'proprietaire', null,
        $q$insert into storage.objects (bucket_id, name, metadata) select 'ventes', f, '{"size": 1000, "mimetype": "application/pdf"}'
            from unnest(array['{L}', '{F}', '{X}', '{Y}', '{G}']) f$q$, 'OK', null),

      ('1', 'controle', 'le super-administrateur ne supprime pas l''original du lot', 'chef', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{L}' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('2', 'controle', 'ni celui d''une facture du lot', 'chef', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{F}' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('3', 'controle', 'il supprime un fichier du lot qu''aucune ligne ne désigne (contrôle positif)', 'chef', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{X}' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('4', 'controle', 'et un fichier sous un lot qui n''existe pas', 'chef', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{Y}' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('5', 'controle', 'et le logo, hors des imports, comme hier', 'chef', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{G}' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('6', 'controle', 'le chef du cabinet non super-administrateur : ni l''original, mais le fichier libre', 'chef_du_cabinet', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{L}' returning 1) select count(*)::text from d
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{X}' returning 1) select '{RENDU}/' || count(*) from d$q$, 'OK', '0/1'),
      ('7', 'controle', 'un membre affecté au dossier : rien du seau des ventes, comme hier', 'membre_affecte', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('8', 'controle', 'le client « Ventes » du dossier : rien', 'client', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('9', 'controle', 'le chef d''un autre cabinet : rien', 'chef_autre', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('10', 'controle', 'un compte rattaché à rien : rien', 'inconnu', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('10b', 'controle', 'l''anonyme : rien', 'anon', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d$q$, 'OK', '0'),
      ('11', 'controle', 'un lot sur tout le préfixe de A, comme le premier passage : X, Y et le logo partent, L et F restent', 'chef', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning name) select string_agg(name, ',' order by name collate "C") from d$q$,
        'OK', '{X},{Y},{G}'),
      ('12', 'controle', '« Retirer l''import » par le super-administrateur : les lignes (deux factures), puis L et F se suppriment', 'chef', null,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ select retirer_import('{DA}', '{LOT}')::text
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name in ('{L}', '{F}') returning 1) select '{RENDU}/' || count(*) from d$q$, 'OK', '2/2'),
      ('13', 'controle', 'la même par le chef du cabinet non super-administrateur', 'chef_du_cabinet', null,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ select retirer_import('{DA}', '{LOT}')::text
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name in ('{L}', '{F}') returning 1) select '{RENDU}/' || count(*) from d$q$, 'OK', '2/2'),
      ('14', 'controle', 'la suppression de A comme l''application la fait, par le super-administrateur : premier passage / ligne / second passage / restés', 'chef', null,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d
          §§ with d as (delete from dossiers where id = '{DA}' returning 1) select '{RENDU}/' || count(*) from d
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select '{RENDU}/' || count(*) from d
          §§ reset role
          §§ select '{RENDU}/' || count(*) from storage.objects where bucket_id = 'ventes' and name like '{DA}/%'$q$,
        'OK', '3/1/2/0'),
      ('15', 'controle', 'la même par le chef du cabinet non super-administrateur : rien ne reste, d''un seul geste', 'chef_du_cabinet', null,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d
          §§ with d as (delete from dossiers where id = '{DA}' returning 1) select '{RENDU}/' || count(*) from d
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select '{RENDU}/' || count(*) from d
          §§ reset role
          §§ select '{RENDU}/' || count(*) from storage.objects where bucket_id = 'ventes' and name like '{DA}/%'$q$,
        'OK', '3/1/2/0'),
      ('16', 'controle', 'A supprimé, ses originaux libérés : le chef d''un autre cabinet ne les voit ni ne les supprime', 'chef_autre',
        $p$with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d$p$,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ select count(*)::text from storage.objects where bucket_id = 'ventes' and name in ('{L}', '{F}')
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name in ('{L}', '{F}') returning 1) select '{RENDU}/' || count(*) from d$q$, 'OK', '0/0'),
      ('17', 'controle', 'ni le client du dossier supprimé', 'client',
        $p$with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d$p$,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ select count(*)::text from storage.objects where bucket_id = 'ventes' and name in ('{L}', '{F}')
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name in ('{L}', '{F}') returning 1) select '{RENDU}/' || count(*) from d$q$, 'OK', '0/0'),
      ('18', 'controle', 'ni un membre du cabinet qui n''en est pas chef', 'membre',
        $p$with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d$p$,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ select count(*)::text from storage.objects where bucket_id = 'ventes' and name in ('{L}', '{F}')
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name in ('{L}', '{F}') returning 1) select '{RENDU}/' || count(*) from d$q$, 'OK', '0/0'),
      ('19', 'controle', 'ni un compte rattaché à rien', 'inconnu',
        $p$with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d$p$,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ select count(*)::text from storage.objects where bucket_id = 'ventes' and name in ('{L}', '{F}')
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name in ('{L}', '{F}') returning 1) select '{RENDU}/' || count(*) from d$q$, 'OK', '0/0'),
      ('20', 'controle', 'la libération range L et F sous le cabinet de A, et rien d''autre', 'proprietaire', null,
        $q$with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d
          §§ select '{RENDU}/' || string_agg(o.chemin || ':' || (o.cabinet_id = '{CAB}'), ',' order by o.chemin collate "C") from originaux_liberes o where o.chemin like '{DA}/%'$q$,
        'OK', '1/{L}:true,{F}:true'),
      ('21', 'controle', 'une suppression de A que la RLS refuse (le client) ne libère rien', 'client', null,
        $q$with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d
          §§ reset role
          §§ select '{RENDU}/' || count(*) from originaux_liberes o where o.chemin like '{DA}/%'$q$, 'OK', '0/0'),
      ('22', 'controle', 'ni celle d''un membre du cabinet qui n''en est pas chef', 'membre', null,
        $q$with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d
          §§ reset role
          §§ select '{RENDU}/' || count(*) from originaux_liberes o where o.chemin like '{DA}/%'$q$, 'OK', '0/0'),
      ('23', 'controle', 'la restauration : A recréé, la ligne de son lot réinsérée par le super-administrateur — L retenu de nouveau, F libre', 'chef',
        $p$with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d
          §§ insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures) values ('{DA}', 'ESSAI A8D2AQ1 A', '{CAB}', 'tresorerie', '455000', true)$p$,
        $q$insert into imports_factures (id, dossier_id, format, fichier_sha256, fichier_taille, fichier_chemin, nombre_factures) values ('{LOT}', '{DA}', 'facturx', '{SL}', 1000, '{L}', 2) returning format
          §§ select set_config('storage.allow_delete_query', 'true', true)
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{L}' returning 1) select '{RENDU}/' || count(*) from d
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{F}' returning 1) select '{RENDU}/' || count(*) from d$q$,
        'OK', 'true/0/1'),
      ('24', 'controle', 'sans le réglage de l''API, le stockage refuse à tous, au super-administrateur aussi', 'chef', null,
        $q$with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{X}' returning 1) select count(*)::text from d$q$,
        '42501', 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'),
      ('25', 'controle', 'le dépôt d''un original reste ouvert : le chef du cabinet dépose sous la forme exacte', 'chef_du_cabinet', null,
        $q$insert into storage.objects (bucket_id, name, owner_id) values ('ventes', '{N}', '{CLIENT}') returning name$q$, 'OK', '{N}'),
      ('26', 'controle', 'original_d_un_import, au chef : vrai pour L et F, faux pour X', 'chef', null,
        $q$select original_d_un_import('{L}')::text || '/' || original_d_un_import('{F}')::text || '/' || original_d_un_import('{X}')::text$q$, 'OK', 'true/true/false'),
      ('27', 'controle', 'original_d_un_import, à qui n''administre pas le dossier (un compte rattaché à rien) : nul', 'inconnu', null,
        $q$select coalesce(original_d_un_import('{L}')::text, 'nul')$q$, 'OK', 'nul'),
      ('28', 'controle', 'original_d_un_import, un chemin qui ne commence pas par un dossier : nul, sans rien lever', 'chef', null,
        $q$select coalesce(original_d_un_import('essai-sans-dossier/imports/x.pdf')::text, 'nul') || '/' || coalesce(original_d_un_import(null)::text, 'nul')$q$, 'OK', 'nul/nul'),
      ('29', 'controle', 'original_libere, A supprimé : vrai au chef du cabinet de A', 'chef_du_cabinet',
        $p$with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d$p$,
        $q$select original_libere('{L}')::text || '/' || original_libere('{F}')::text || '/' || original_libere('{X}')::text$q$, 'OK', 'true/true/false'),
      ('30', 'controle', 'original_libere, A supprimé : faux au chef d''un autre cabinet', 'chef_autre',
        $p$with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d$p$,
        $q$select original_libere('{L}')::text$q$, 'OK', 'false'),
      ('31', 'controle', 'original_libere, tant que A existe : faux, au super-administrateur aussi', 'chef', null,
        $q$select original_libere('{L}')::text || '/' || coalesce(original_libere(null)::text, 'nul')$q$, 'OK', 'false/false'),
      ('32', 'controle', 'le ménage : L retiré du seau, la suppression d''un dossier suivant efface sa libération, et garde celle de F', 'proprietaire', null,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{L}' returning 1) select '{RENDU}/' || count(*) from d
          §§ insert into dossiers (id, nom, cabinet_id) values ('{DB}', 'ESSAI A8D2AQ1 B', '{CAB}')
          §§ with d as (delete from dossiers where id = '{DB}' returning 1) select '{RENDU}/' || count(*) from d
          §§ select '{RENDU}/' || coalesce(string_agg(o.chemin, ',' order by o.chemin collate "C"), '') from originaux_liberes o where o.chemin like '{DA}/%'$q$,
        'OK', '1/1/1/{F}'),

      ('M1', 'mutation', 'la policy de suppression d''A8d2a : le super-administrateur supprime l''original du lot', 'chef',
        $p$select pg_temp.muter_policy('ventes_suppression_par_le_chef', '(NOT public.original_d_un_import(name))', 'true')$p$,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{L}' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('M2', 'mutation', 'la fonction sans le chemin du lot : le contrôle 1 tombe', 'chef',
        $p$select pg_temp.muter('public.original_d_un_import(text)', 'else exists (select 1 from public.imports_factures l where l.fichier_chemin = p_chemin)', 'else false')$p$,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{L}' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('M3', 'mutation', 'la fonction sans le chemin d''une facture : le contrôle 2 tombe', 'chef',
        $p$select pg_temp.muter('public.original_d_un_import(text)', 'or exists (select 1 from public.factures_importees f where f.fichier_chemin = p_chemin)', '')$p$,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{F}' returning 1) select count(*)::text from d$q$, 'OK', '1'),
      ('M4', 'mutation', 'la fonction qui répond à tous : le contrôle 27 tombe', 'inconnu',
        $p$select pg_temp.muter('public.original_d_un_import(text)', 'when not public.admin_du_dossier(split_part(p_chemin, ''/'', 1)::uuid) then null', '')$p$,
        $q$select coalesce(original_d_un_import('{L}')::text, 'nul')$q$, 'OK', 'true'),
      ('M5', 'mutation', 'le déclencheur éteint : le contrôle 15 tombe, les originaux restent au chef qui n''est pas super-administrateur', 'chef_du_cabinet',
        $p$alter table dossiers disable trigger dossiers_liberer_les_originaux$p$,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d
          §§ with d as (delete from dossiers where id = '{DA}' returning 1) select '{RENDU}/' || count(*) from d
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select '{RENDU}/' || count(*) from d
          §§ reset role
          §§ select '{RENDU}/' || count(*) from storage.objects where bucket_id = 'ventes' and name like '{DA}/%'$q$,
        'OK', '3/1/0/2'),
      ('M6', 'mutation', 'la libération sans « le dossier n''existe plus » : le contrôle 23 tombe, L se supprime malgré la ligne restaurée', 'chef',
        $p$select pg_temp.muter('public.original_libere(text)', 'and not exists (select 1 from public.dossiers d where d.id = split_part(p_chemin, ''/'', 1)::uuid)', '')
          §§ with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d
          §§ insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures) values ('{DA}', 'ESSAI A8D2AQ1 A', '{CAB}', 'tresorerie', '455000', true)$p$,
        $q$insert into imports_factures (id, dossier_id, format, fichier_sha256, fichier_taille, fichier_chemin, nombre_factures) values ('{LOT}', '{DA}', 'facturx', '{SL}', 1000, '{L}', 2) returning format
          §§ select set_config('storage.allow_delete_query', 'true', true)
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{L}' returning 1) select count(*)::text from d$q$,
        'OK', '1'),
      ('M7', 'mutation', 'la libération à tout chef : le contrôle 16 tombe, le chef d''un autre cabinet supprime', 'chef_autre',
        $p$select pg_temp.muter('public.original_libere(text)', 'and public.est_chef_du_cabinet(o.cabinet_id)', '')
          §§ with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d$p$,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name in ('{L}', '{F}') returning 1) select count(*)::text from d$q$, 'OK', '2'),
      ('M8', 'mutation', 'la lecture sans la libération : le contrôle 15 tombe, le second passage ne voit rien', 'chef_du_cabinet',
        $p$select pg_temp.muter_policy('ventes_lecture', ' OR public.original_libere(name)', '')$p$,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d
          §§ with d as (delete from dossiers where id = '{DA}' returning 1) select '{RENDU}/' || count(*) from d
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select '{RENDU}/' || count(*) from d
          §§ reset role
          §§ select '{RENDU}/' || count(*) from storage.objects where bucket_id = 'ventes' and name like '{DA}/%'$q$,
        'OK', '3/1/0/2'),
      ('M9', 'mutation', 'le ménage retiré du déclencheur : le contrôle 32 tombe, la libération de L reste', 'proprietaire',
        $p$select pg_temp.muter('public.liberer_les_originaux_du_dossier()', 'where not exists (select 1 from storage.objects s', 'where false and not exists (select 1 from storage.objects s')$p$,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{L}' returning 1) select '{RENDU}/' || count(*) from d
          §§ insert into dossiers (id, nom, cabinet_id) values ('{DB}', 'ESSAI A8D2AQ1 B', '{CAB}')
          §§ with d as (delete from dossiers where id = '{DB}' returning 1) select '{RENDU}/' || count(*) from d
          §§ select '{RENDU}/' || coalesce(string_agg(o.chemin, ',' order by o.chemin collate "C"), '') from originaux_liberes o where o.chemin like '{DA}/%'$q$,
        'OK', '1/1/1/{L},{F}'),
      ('M10', 'mutation', 'la suppression sans la libération : le contrôle 15 tombe, la ligne partie, le chef ne retire plus rien', 'chef_du_cabinet',
        $p$select pg_temp.muter_policy('ventes_suppression_par_le_chef', ' OR public.original_libere(name)', '')$p$,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d
          §§ with d as (delete from dossiers where id = '{DA}' returning 1) select '{RENDU}/' || count(*) from d
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select '{RENDU}/' || count(*) from d
          §§ reset role
          §§ select '{RENDU}/' || count(*) from storage.objects where bucket_id = 'ventes' and name like '{DA}/%'$q$,
        'OK', '3/1/0/2')
    ) as x(num, genre, controle, qui, prelude, ordre, code, attendu)
    loop
      ordre := s.ordre;
      prelude := s.prelude;
      attendu := s.attendu;
      for k in select jsonb_object_keys(ids) order by 1 desc loop
        ordre := replace(ordre, '{' || k || '}', ids ->> k);
        prelude := replace(prelude, '{' || k || '}', ids ->> k);
        attendu := replace(attendu, '{' || k || '}', ids ->> k);
      end loop;
      accepte := false; code_recu := null; message := null; rendu := null;
      begin
        -- Le prélude, en propriétaire, par parties : une mutation, une suppression du dossier, dans la sous-transaction de
        -- l'étape.
        if prelude is not null then
          foreach partie in array string_to_array(prelude, '§§') loop
            if partie ~* '^\s*(select|with)' then
              execute partie into rendu;
            else
              execute partie;
            end if;
          end loop;
        end if;
        -- Le compte du client, rangé au cabinet le temps de son étape — une sous-transaction annulée l'emporte.
        if s.qui in ('membre', 'membre_affecte') then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
          if s.qui = 'membre_affecte' then
            insert into dossier_assignations (dossier_id, user_id) values ((ids ->> 'DA')::uuid, client);
          end if;
        elsif s.qui = 'chef_du_cabinet' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
        elsif s.qui = 'chef_autre' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, (ids ->> 'CC')::uuid, 'comptable_en_chef');
        end if;
        if s.qui = 'anon' then
          set local role anon;
          perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        elsif s.qui in ('inconnu', 'client', 'chef', 'membre', 'membre_affecte', 'chef_du_cabinet', 'chef_autre') then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub',
            case s.qui when 'inconnu' then inconnu when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
        else
          perform set_config('request.jwt.claims', '', true);
        end if;
        rendu := null;
        foreach partie in array string_to_array(ordre, '§§') loop
          partie := replace(partie, '{RENDU}', coalesce(rendu, ''));
          if partie ~* '^\s*reset\s+role\s*$' then
            reset role;
            perform set_config('request.jwt.claims', '', true);
          elsif partie ~* '^\s*(insert|update)' and partie !~* 'returning' then
            execute partie;
          else
            execute partie into rendu;
          end if;
        end loop;
        accepte := true;
        if s.genre in ('controle', 'mutation') then
          raise exception 'ANNULATION_ESSAI';
        end if;
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      perform set_config('storage.allow_delete_query', '', true);
      ok := case
        when s.code = 'OK' then accepte and (attendu is null or coalesce(rendu, '') = attendu)
        else not accepte and code_recu = s.code and message like attendu
      end;
      if s.genre = 'jeu' and not ok then
        raise exception 'ESSAI_IMPOSSIBLE : le jeu % n''a pas pu être posé (% % ; rendu %)', s.num, code_recu, message, rendu;
      end if;
      if s.genre <> 'jeu' then
        verdicts := verdicts || jsonb_build_object('controle', s.num || '. ' || s.controle, 'genre', s.genre,
          'observe', case when accepte then 'accepté : ' || coalesce(rendu, '—') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
          'ok', ok);
      end if;
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from factures_emises)), ((select count(*) from imports_factures)),
    ((select count(*) from factures_importees)), ((select count(*) from originaux_liberes)),
    ((select count(*) from storage.objects)), ((select count(*) from cabinets))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || avant || ' -> ' || apres, 'ok', erreur is null and avant = apres);
  perform set_config('essai.original_d_un_import', verdicts::text, true);
end
$essai$;

select x.genre, x.controle, x.verdict, x.observe from (
  select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                   else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
  from jsonb_to_recordset(current_setting('essai.original_d_un_import')::jsonb) as v(controle text, genre text, ok boolean, observe text)
) x
order by x.genre desc, (regexp_match(x.controle, '^M?(\d+)'))[1]::int, x.controle;
