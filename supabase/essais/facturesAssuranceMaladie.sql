-- LE FACTURÉ À L'ASSURANCE MALADIE (conception 59, BOR3 ; la migration `factures_assurance_maladie`, PRÉPARÉE le 19/11/2026,
-- supabase/schema/20261120110200_factures_assurance_maladie.sql). Le récit : HISTORIQUE.md, « 19/11/2026 — BOR3 : LE
-- FACTURÉ À L'ASSURANCE MALADIE, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer par `execute_sql` après toute migration qui
-- touche `memberships`, `client_du_dossier`, `admin_du_dossier`, les quatre tables ou leurs fonctions. Le retrait d'une ligne
-- en direct ne se joue pas ici (l'outil d'exécution de la production retient une suppression) : la garde le refuse, ce que
-- la réplique de l'étape a éprouvé.
--
-- Ce qui se prouve ici, et ne se relit pas : le cabinet (le chef, un membre qui n'est pas super-administrateur) et le client
-- « Banque » importent et retirent ; chaque refus sous ses mots, dans l'ordre de la migration ; le client sans la case, celui
-- d'un autre dossier, un compte sans accès et l'anonyme ne lisent rien et n'écrivent rien ; la case décochée, le client ne lit
-- ni n'importe plus ; un lot importé deux fois se refuse, nommé par son rang et le jour de son import, jamais par son numéro,
-- un 7 écrit 7.0 compris ; retiré, il se réimporte ; personne — ni le cabinet, ni le client, ni la restauration — ne lit le
-- registre ni la clé, et nul ne les écrit en direct ; l'empreinte gardée est le HMAC-SHA-256 sous la clé du dossier du
-- numéro, de la date de création et de la caisse, et deux dossiers ont deux clés ; aucune colonne ne porte le numéro ; un
-- import restauré (sans registre) retient les lots de sa période jusqu'à son retrait ; la part complémentaire sous un
-- organisme non dit ou nommé ; personne n'écrit ni ne réécrit en direct (ni le client, ni un chef qui n'est pas
-- super-administrateur, ni le rôle des Edge Functions) ; le catalogue.
--
-- Trois dossiers jetables du cabinet du dossier `test` (préfixe `e5900000-0000-4000-8000`) : DB, où l'accès du client d'essai
-- porte « Banque », DS, où il ne la porte pas, et DX, où il n'a aucun accès. Chaque étape se joue dans sa sous-transaction et
-- s'y ANNULE (`ANNULATION_ETAPE`) : ce que le chef pose d'abord (sous sa session), ce que le propriétaire pose ensuite, puis la
-- requête du profil ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts
-- voyagent dans un réglage LOCAL à la transaction (`essai.factures_assurance_maladie`), que la requête finale lit : le fichier
-- se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui
-- dépende d'une ligne hors de ses dossiers. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la
-- migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  db constant text := 'e5900000-0000-4000-8000-0000000000d1';
  ds constant text := 'e5900000-0000-4000-8000-0000000000d2';
  dx constant text := 'e5900000-0000-4000-8000-0000000000d3';
  acces_b constant text := 'e5900000-0000-4000-8000-0000000000a1';
  acces_s constant text := 'e5900000-0000-4000-8000-0000000000a2';
  -- Un compte connecté qu'aucun accès ni aucun cabinet ne nomme (le profil `inconnu`).
  inconnu constant text := 'e5900000-0000-4000-8000-0000000000f1';
  -- Un import posé en direct par le super-administrateur, comme la restauration le réinsère : sans aucun lot au registre.
  restaure constant text := 'e5900000-0000-4000-8000-0000000000b1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  jour constant date := (now() at time zone 'Europe/Paris')::date;
  -- L'envoi d'essai : trois lots de deux caisses sur deux jours, leurs totaux (la part obligatoire par caisse, la part
  -- complémentaire non dite) ; des numéros de lot fictifs, des centimes.
  base jsonb;
  envoi text; envoi_plus text; envoi_bis text; envoi_sept text; envoi_sept_bis text; envoi_hors text;
  importer constant text := $q$importer_factures_assurance_maladie('{DB}', '{E}'::jsonb)$q$;
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text; v_attendu text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.factures_assurance_maladie') is null then
    perform set_config('essai.factures_assurance_maladie', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration factures_assurance_maladie', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  base := jsonb_build_object('version', 1,
    'lots', jsonb_build_array(
      jsonb_build_object('numero', 900101, 'cree_le', to_char(jour - 5, 'YYYY-MM-DD'), 'caisse', 691, 'nombre_de_factures', 3),
      jsonb_build_object('numero', 900102, 'cree_le', to_char(jour - 5, 'YYYY-MM-DD'), 'caisse', 691, 'nombre_de_factures', 2),
      jsonb_build_object('numero', 900103, 'cree_le', to_char(jour - 4, 'YYYY-MM-DD'), 'caisse', 692, 'nombre_de_factures', 4)),
    'agregats', jsonb_build_array(
      jsonb_build_object('date_creation_lot', to_char(jour - 5, 'YYYY-MM-DD'), 'part', 'obligatoire', 'regime', 1, 'caisse', 691,
        'organisme_complementaire', null, 'montant_centimes', 12000, 'nombre_de_lots', 2, 'nombre_de_factures', 5),
      jsonb_build_object('date_creation_lot', to_char(jour - 5, 'YYYY-MM-DD'), 'part', 'complementaire', 'regime', null, 'caisse', null,
        'organisme_complementaire', null, 'montant_centimes', 3000, 'nombre_de_lots', 2, 'nombre_de_factures', 5),
      jsonb_build_object('date_creation_lot', to_char(jour - 4, 'YYYY-MM-DD'), 'part', 'obligatoire', 'regime', 1, 'caisse', 692,
        'organisme_complementaire', null, 'montant_centimes', 8000, 'nombre_de_lots', 1, 'nombre_de_factures', 4)));
  envoi := base::text;
  -- Un second envoi, d'un lot nouveau (la veille), son total : il s'importe après le premier.
  envoi_plus := jsonb_build_object('version', 1,
    'lots', jsonb_build_array(jsonb_build_object('numero', 900104, 'cree_le', to_char(jour - 1, 'YYYY-MM-DD'), 'caisse', 691, 'nombre_de_factures', 1)),
    'agregats', jsonb_build_array(jsonb_build_object('date_creation_lot', to_char(jour - 1, 'YYYY-MM-DD'), 'part', 'obligatoire',
      'regime', 1, 'caisse', 691, 'organisme_complementaire', null, 'montant_centimes', 500, 'nombre_de_lots', 1, 'nombre_de_factures', 1)))::text;
  -- Le lot nouveau, puis le deuxième lot du premier envoi, au rang 2.
  envoi_bis := jsonb_build_object('version', 1,
    'lots', (envoi_plus::jsonb -> 'lots') || jsonb_build_array(base -> 'lots' -> 1),
    'agregats', (envoi_plus::jsonb -> 'agregats') || jsonb_build_array(jsonb_build_object('date_creation_lot', to_char(jour - 5, 'YYYY-MM-DD'),
      'part', 'obligatoire', 'regime', 1, 'caisse', 691, 'organisme_complementaire', null, 'montant_centimes', 100, 'nombre_de_lots', 1,
      'nombre_de_factures', 2)))::text;
  -- Un lot numéroté 7, et le même écrit 7.0 : une même empreinte.
  envoi_sept := jsonb_build_object('version', 1,
    'lots', jsonb_build_array(jsonb_build_object('numero', 7, 'cree_le', to_char(jour - 2, 'YYYY-MM-DD'), 'caisse', 691, 'nombre_de_factures', 1)),
    'agregats', '[]'::jsonb)::text;
  envoi_sept_bis := replace(envoi_sept, '"numero": 7,', '"numero": 7.0,');
  -- Un lot créé hors de la période du premier envoi (le jour même), sans total.
  envoi_hors := jsonb_build_object('version', 1,
    'lots', jsonb_build_array(jsonb_build_object('numero', 900105, 'cree_le', to_char(jour, 'YYYY-MM-DD'), 'caisse', 691, 'nombre_de_factures', 1)),
    'agregats', '[]'::jsonb)::text;
  begin
    -- Le jeu : trois dossiers jetables, et un accès du client d'essai à DB (« Banque ») et à DS (sans elle), insérés par le
    -- propriétaire comme `create-client-access` les insère — la case posée à l'insertion.
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva) values
      (db::uuid, 'ESSAI FACTURE ASSURANCE MALADIE DB', cabinet, 'tresorerie', '455000', 'exonere'),
      (ds::uuid, 'ESSAI FACTURE ASSURANCE MALADIE DS', cabinet, 'tresorerie', '455000', 'exonere'),
      (dx::uuid, 'ESSAI FACTURE ASSURANCE MALADIE DX', cabinet, 'tresorerie', '455000', 'exonere');
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque) values
      (acces_b::uuid, client::uuid, db::uuid, 'client', 'essai-facture-assurance-maladie-b@example.test', true),
      (acces_s::uuid, client::uuid, ds::uuid, 'client', 'essai-facture-assurance-maladie-s@example.test', false);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord (super-administrateur, sous sa session), ce que le PROPRIÉTAIRE pose
    -- ensuite (sans session), le profil — `chef`, `chef_simple` (le compte client rattaché au cabinet, le temps de l'étape),
    -- `client`, `inconnu`, `service` (le rôle des Edge Functions), `anon` ou `proprietaire` (sans rôle ni session : il lit le
    -- registre et la clé, que nul rôle de l'API ne lit) —, sa requête, le code attendu (`OK` : acceptée) et ce qu'elle rend, ou
    -- les mots du refus}. `{J-n}` : le jour de Paris décalé, `{Jfr}` : le jour en JJ/MM/AAAA.
    for e in select * from (values
      -- La requête qui appelle une fonction d'écriture ne relit pas, dans la même instruction, ce qu'elle a écrit (l'image de
      -- l'instruction précède l'appel) : ce que l'import a écrit se lit à l'étape suivante, posé par le chef.
      (1, '1. le chef importe : la période des lots, leurs comptes, l''auteur', null, null, 'chef',
        $q$select i.premier_lot_le || ' ' || i.dernier_lot_le || ' ' || i.nombre_de_lots || ' ' || i.nombre_de_factures || ' ' || (i.importe_par::text = '{CHEF}') from {IMP} i$q$,
        'OK', '{J-5} {J-4} 3 9 true'),
      (2, '2. le client « Banque » importe : il en est l''auteur', null, null, 'client',
        $q$select (i.importe_par::text = '{CLIENT}')::text from {IMP} i$q$, 'OK', 'true'),
      (3, '3. le client « Banque » lit l''import et les totaux de son dossier, tels qu''ils ont été écrits', 'select 1 from {IMP}', null, 'client',
        $q$select count(*)::text || ' ' || (select count(*) from factures_assurance_maladie f where f.dossier_id = '{DB}') || ' ' || (select sum(f.montant_centimes) from factures_assurance_maladie f where f.dossier_id = '{DB}') || ' ' || (select sum(f.nombre_de_lots) from factures_assurance_maladie f where f.dossier_id = '{DB}') || ' ' || (select count(*) from factures_assurance_maladie f where f.dossier_id = '{DB}' and f.part = 'complementaire' and f.regime is null and f.caisse is null and f.organisme_complementaire is null) from imports_factures_assurance_maladie i where i.dossier_id = '{DB}'$q$,
        'OK', '1 3 23000 5 1'),
      (4, '4. le client sans la case n''importe pas dans DS (42501)', null, null, 'client',
        $q$select 1 from importer_factures_assurance_maladie('{DS}', '{E}'::jsonb)$q$, '42501', 'Accès refusé à ce dossier.'),
      (5, '5. le client sans la case ne lit rien de DS', $q$select 1 from importer_factures_assurance_maladie('{DS}', '{E}'::jsonb)$q$, null, 'client',
        $q$select (select count(*) from imports_factures_assurance_maladie i where i.dossier_id = '{DS}') || ' ' || (select count(*) from factures_assurance_maladie f where f.dossier_id = '{DS}')$q$,
        'OK', '0 0'),
      (6, '6. le client n''importe pas dans un dossier où il n''a aucun accès (DX, 42501)', null, null, 'client',
        $q$select 1 from importer_factures_assurance_maladie('{DX}', '{E}'::jsonb)$q$, '42501', 'Accès refusé à ce dossier.'),
      (7, '7. le client ne lit rien de DX', $q$select 1 from importer_factures_assurance_maladie('{DX}', '{E}'::jsonb)$q$, null, 'client',
        $q$select (select count(*) from imports_factures_assurance_maladie i where i.dossier_id = '{DX}') || ' ' || (select count(*) from factures_assurance_maladie f where f.dossier_id = '{DX}')$q$,
        'OK', '0 0'),
      (8, '8. un compte connecté sans accès n''importe pas (42501)', null, null, 'inconnu', $q$select 1 from {IMP}$q$, '42501', 'Accès refusé à ce dossier.'),
      (9, '9. un compte connecté sans accès ne lit rien', 'select 1 from {IMP}', null, 'inconnu',
        $q$select (select count(*) from imports_factures_assurance_maladie) || ' ' || (select count(*) from factures_assurance_maladie)$q$, 'OK', '0 0'),
      (10, '10. un membre du cabinet qui n''est pas super-administrateur importe', null, null, 'chef_simple',
        $q$select (i.importe_par::text = '{CLIENT}')::text from {IMP} i$q$, 'OK', 'true'),
      (11, '11. la case « Banque » décochée par le cabinet, le client ne lit plus rien', $q$select 1 from {IMP}; select 1 from changer_droits_acces('{AB}', null, false)$q$, null, 'client',
        $q$select (select count(*) from imports_factures_assurance_maladie i where i.dossier_id = '{DB}') || ' ' || (select count(*) from factures_assurance_maladie f where f.dossier_id = '{DB}')$q$,
        'OK', '0 0'),
      (12, '12. … et n''importe plus (42501)', $q$select 1 from changer_droits_acces('{AB}', null, false)$q$, null, 'client',
        $q$select 1 from {IMP}$q$, '42501', 'Accès refusé à ce dossier.'),
      (13, '13. le client « Banque » retire un import de son dossier', 'select 1 from {IMP}', null, 'client',
        $q$select (r.dossier_id::text = '{DB}')::text from retirer_import_factures_assurance_maladie((select i.id from imports_factures_assurance_maladie i where i.dossier_id = '{DB}')) r$q$,
        'OK', 'true'),
      (113, '13 bis. retiré, l''import, ses totaux et les empreintes de ses lots sont partis ensemble ; la clé du dossier reste',
        $q$select 1 from {IMP}; select 1 from retirer_import_factures_assurance_maladie((select i.id from imports_factures_assurance_maladie i where i.dossier_id = '{DB}'))$q$, null, 'proprietaire',
        $q$select (select count(*) from imports_factures_assurance_maladie i where i.dossier_id = '{DB}') || ' ' || (select count(*) from factures_assurance_maladie f where f.dossier_id = '{DB}') || ' ' || (select count(*) from lots_teletransmission_importes r where r.dossier_id = '{DB}') || ' ' || (select count(*) from cles_des_lots_teletransmission c where c.dossier_id = '{DB}')$q$,
        'OK', '0 0 0 1'),
      (213, '13 ter. retiré, le même envoi se réimporte', $q$select 1 from {IMP}; select 1 from retirer_import_factures_assurance_maladie((select i.id from imports_factures_assurance_maladie i where i.dossier_id = '{DB}'))$q$, null, 'client',
        $q$select i.nombre_de_lots::text from {IMP} i$q$, 'OK', '3'),
      (14, '14. le client sans la case ne retire pas un import de DS (42501)', $q$select set_config('essai.import', (select i.id::text from importer_factures_assurance_maladie('{DS}', '{E}'::jsonb) i), true)$q$, null, 'client',
        $q$select 1 from retirer_import_factures_assurance_maladie(current_setting('essai.import')::uuid)$q$, '42501', 'Accès refusé à ce dossier.'),
      (15, '15. un compte connecté sans accès ne retire pas (42501)', $q$select set_config('essai.import', (select i.id::text from {IMP} i), true)$q$, null, 'inconnu',
        $q$select 1 from retirer_import_factures_assurance_maladie(current_setting('essai.import')::uuid)$q$, '42501', 'Accès refusé à ce dossier.'),
      (16, '16. retirer un import inconnu (42501 : rien n''apprend qu''il existe)', null, null, 'chef_simple',
        $q$select 1 from retirer_import_factures_assurance_maladie(gen_random_uuid())$q$, '42501', 'Accès refusé à ce dossier.'),
      (17, '17. le même envoi réimporté : refusé, le premier bordereau nommé par son rang et le jour de son import (22023)', 'select 1 from {IMP}', null, 'client',
        $q$select 1 from {IMP}$q$, '22023', 'Le bordereau 1 de l''envoi a déjà été importé le {Jfr} : un lot ne s''importe pas deux fois.'),
      (18, '18. un envoi dont le deuxième bordereau est déjà importé : refusé sous son rang (22023)', 'select 1 from {IMP}', null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', '{E2}'::jsonb)$q$, '22023', 'Le bordereau 2 de l''envoi a déjà été importé le {Jfr} : un lot ne s''importe pas deux fois.'),
      (19, '19. un envoi d''un lot nouveau s''importe après le premier ; deux imports, l''un de trois totaux, l''autre d''un', 'select 1 from {IMP}', null, 'client',
        $q$select i.premier_lot_le || ' ' || i.nombre_de_lots from importer_factures_assurance_maladie('{DB}', '{E+}'::jsonb) i$q$, 'OK', '{J-1} 1'),
      (119, '19 bis. … et le registre porte quatre empreintes, une par lot, sous une seule clé', $q$select 1 from {IMP}; select 1 from importer_factures_assurance_maladie('{DB}', '{E+}'::jsonb)$q$, null, 'proprietaire',
        $q$select (select count(*) from lots_teletransmission_importes r where r.dossier_id = '{DB}') || ' ' || (select count(distinct r.empreinte) from lots_teletransmission_importes r where r.dossier_id = '{DB}') || ' ' || (select count(*) from cles_des_lots_teletransmission c where c.dossier_id = '{DB}') || ' ' || (select string_agg(n::text, ',' order by n) from (select count(*) as n from factures_assurance_maladie f where f.dossier_id = '{DB}' group by f.import_id) c)$q$,
        'OK', '4 4 1 1,3'),
      (20, '20. l''empreinte gardée est le HMAC-SHA-256, sous la clé du dossier, de « lot:numéro:date de création:caisse »', 'select 1 from {IMP}', null, 'proprietaire',
        $q$select (select count(*) from lots_teletransmission_importes r join cles_des_lots_teletransmission c on c.dossier_id = r.dossier_id where r.dossier_id = '{DB}' and r.empreinte in (extensions.hmac(convert_to('lot:900101:{J-5}:691', 'UTF8'), c.cle, 'sha256'), extensions.hmac(convert_to('lot:900102:{J-5}:691', 'UTF8'), c.cle, 'sha256'), extensions.hmac(convert_to('lot:900103:{J-4}:692', 'UTF8'), c.cle, 'sha256')))::text || ' ' || (select octet_length(c.cle) from cles_des_lots_teletransmission c where c.dossier_id = '{DB}')$q$,
        'OK', '3 32'),
      (21, '21. un même lot importé dans deux dossiers : accepté dans chacun, sous deux clés, deux empreintes différentes',
        $q$select 1 from {IMP}; select 1 from importer_factures_assurance_maladie('{DS}', '{E}'::jsonb)$q$, null, 'proprietaire',
        $q$select (select count(*) from lots_teletransmission_importes r where r.dossier_id in ('{DB}', '{DS}')) || ' ' || (select count(distinct r.empreinte) from lots_teletransmission_importes r where r.dossier_id in ('{DB}', '{DS}')) || ' ' || (select count(distinct c.cle) from cles_des_lots_teletransmission c where c.dossier_id in ('{DB}', '{DS}'))$q$,
        'OK', '6 6 2'),
      (22, '22. un lot numéroté 7 puis le même écrit 7.0 : une même empreinte, refusé (22023)', $q$select 1 from importer_factures_assurance_maladie('{DB}', '{E7}'::jsonb)$q$, null, 'client',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', '{E7b}'::jsonb)$q$, '22023', 'Le bordereau 1 de l''envoi a déjà été importé le {Jfr} : un lot ne s''importe pas deux fois.'),
      (122, '22 bis. deux lots de même numéro et de même date, de deux caisses : deux lots, deux empreintes (la caisse est de l''empreinte)',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_build_object('version', 1, 'agregats', '[]'::jsonb, 'lots', jsonb_build_array(jsonb_build_object('numero', 900201, 'cree_le', '{J-1}', 'caisse', 691, 'nombre_de_factures', 1), jsonb_build_object('numero', 900201, 'cree_le', '{J-1}', 'caisse', 692, 'nombre_de_factures', 1))))$q$,
        null, 'proprietaire',
        $q$select (select count(*) from lots_teletransmission_importes r where r.dossier_id = '{DB}') || ' ' || (select count(distinct r.empreinte) from lots_teletransmission_importes r where r.dossier_id = '{DB}')$q$,
        'OK', '2 2'),
      (23, '23. aucune colonne des quatre tables ne porte le numéro d''un lot importé', 'select 1 from {IMP}', null, 'proprietaire',
        $q$select count(*)::text from (select to_jsonb(i)::text as t from imports_factures_assurance_maladie i where i.dossier_id = '{DB}' union all select to_jsonb(f)::text from factures_assurance_maladie f where f.dossier_id = '{DB}' union all select to_jsonb(r)::text from lots_teletransmission_importes r where r.dossier_id = '{DB}' union all select to_jsonb(c)::text from cles_des_lots_teletransmission c where c.dossier_id = '{DB}') x where x.t like '%900101%' or x.t like '%900102%' or x.t like '%900103%'$q$,
        'OK', '0'),
      (24, '24. ni le chef (super-administrateur) ni le client « Banque » ne lisent le registre ni la clé', 'select 1 from {IMP}', null, 'chef',
        $q$select (select count(*) from lots_teletransmission_importes) || ' ' || (select count(*) from cles_des_lots_teletransmission)$q$, 'OK', '0 0'),
      (124, '24 bis. … ni le client « Banque »', 'select 1 from {IMP}', null, 'client',
        $q$select (select count(*) from lots_teletransmission_importes) || ' ' || (select count(*) from cles_des_lots_teletransmission)$q$, 'OK', '0 0'),
      (25, '25. le client « Banque » n''écrit pas en direct (la garde, avant la RLS)', null, null, 'client',
        $q$insert into imports_factures_assurance_maladie (dossier_id, premier_lot_le, dernier_lot_le, nombre_de_lots, nombre_de_factures, importe_par) values ('{DB}', '{J-1}', '{J-1}', 1, 1, '{CLIENT}') returning 1$q$,
        '42501', 'Le facturé à l''assurance maladie ne s''écrit que par son import.'),
      (26, '26. un chef qui n''est pas super-administrateur n''écrit pas un total en direct', 'select 1 from {IMP}', null, 'chef_simple',
        $q$insert into factures_assurance_maladie (dossier_id, import_id, date_creation_lot, part, regime, caisse, organisme_complementaire, montant_centimes, nombre_de_lots, nombre_de_factures) values ('{DB}', (select i.id from imports_factures_assurance_maladie i where i.dossier_id = '{DB}'), '{J-5}', 'obligatoire', 2, 691, null, 100, 1, 1) returning 1$q$,
        '42501', 'Le facturé à l''assurance maladie ne s''écrit que par son import.'),
      (27, '27. le super-administrateur insère un import en direct : la restauration', null, null, 'chef',
        $q$insert into imports_factures_assurance_maladie (dossier_id, premier_lot_le, dernier_lot_le, nombre_de_lots, nombre_de_factures, importe_par) values ('{DB}', '{J-1}', '{J-1}', 1, 1, '{CHEF}') returning 1$q$,
        'OK', '1'),
      (127, '27 bis. … mais jamais une empreinte : le registre ne se restaure pas (42501)', 'select 1 from {IMP}', null, 'chef',
        $q$insert into lots_teletransmission_importes (dossier_id, import_id, empreinte) values ('{DB}', (select i.id from imports_factures_assurance_maladie i where i.dossier_id = '{DB}'), decode(repeat('ab', 32), 'hex')) returning 1$q$,
        '42501', 'Le facturé à l''assurance maladie ne s''écrit que par son import.'),
      (227, '27 ter. … ni un total dans l''import d''un autre dossier (la garde, 23514)',
        $q$select set_config('essai.import', (select i.id::text from importer_factures_assurance_maladie('{DS}', '{E}'::jsonb) i), true)$q$, null, 'chef',
        $q$insert into factures_assurance_maladie (dossier_id, import_id, date_creation_lot, part, regime, caisse, organisme_complementaire, montant_centimes, nombre_de_lots, nombre_de_factures) values ('{DB}', current_setting('essai.import')::uuid, '{J-5}', 'obligatoire', 1, 691, null, 100, 1, 1) returning 1$q$,
        '23514', 'Le facturé à l''assurance maladie s''écrit dans le dossier de son import.'),
      (28, '28. le rôle des Edge Functions, qui passe la RLS, ne pose pas de clé en direct (la garde, 42501)', null, null, 'service',
        $q$insert into cles_des_lots_teletransmission (dossier_id, cle) values ('{DX}', decode(repeat('cd', 32), 'hex')) returning 1$q$,
        '42501', 'La clé des lots d''un dossier ne s''écrit que par l''import du facturé.'),
      (128, '28 bis. … ne remplace pas la clé d''un dossier (la garde, 23514)', 'select 1 from {IMP}', null, 'service',
        $q$update cles_des_lots_teletransmission set cle = cle where dossier_id = '{DB}' returning 1$q$, '23514',
        'Le facturé à l''assurance maladie ne se modifie pas : son import se retire et se refait.'),
      (228, '28 ter. … n''écrit pas une empreinte en direct (la garde, 42501)', 'select 1 from {IMP}', null, 'service',
        $q$insert into lots_teletransmission_importes (dossier_id, import_id, empreinte) values ('{DB}', (select i.id from imports_factures_assurance_maladie i where i.dossier_id = '{DB}'), decode(repeat('ef', 32), 'hex')) returning 1$q$,
        '42501', 'Le facturé à l''assurance maladie ne s''écrit que par son import.'),
      (328, '28 quater. … ne réécrit pas un total (la garde, 23514)', 'select 1 from {IMP}', null, 'service',
        $q$update factures_assurance_maladie set montant_centimes = montant_centimes where dossier_id = '{DB}' returning 1$q$, '23514',
        'Le facturé à l''assurance maladie ne se modifie pas : son import se retire et se refait.'),
      (29, '29. le super-administrateur ne réécrit rien : aucune policy de mise à jour, aucune ligne touchée', 'select 1 from {IMP}', null, 'chef',
        $q$with t as (update factures_assurance_maladie set nombre_de_lots = nombre_de_lots where dossier_id = '{DB}' returning 1) select count(*)::text from t$q$, 'OK', '0'),
      (30, '30. un import restauré, sans registre, retient un lot créé dans sa période (22023)',
        $q$insert into imports_factures_assurance_maladie (id, dossier_id, premier_lot_le, dernier_lot_le, nombre_de_lots, nombre_de_factures, importe_par) values ('{R}', '{DB}', '{J-6}', '{J-1}', 2, 2, '{CHEF}')$q$, null, 'client',
        $q$select 1 from {IMP}$q$, '22023', 'Un import restauré, dont la sauvegarde ne porte pas le registre des lots, couvre le {J-5fr} : le retirer d''abord, puis réimporter ses bordereaux.'),
      (130, '30 bis. … mais pas un lot créé hors de sa période',
        $q$insert into imports_factures_assurance_maladie (id, dossier_id, premier_lot_le, dernier_lot_le, nombre_de_lots, nombre_de_factures, importe_par) values ('{R}', '{DB}', '{J-6}', '{J-1}', 2, 2, '{CHEF}')$q$, null, 'client',
        $q$select i.nombre_de_lots::text from importer_factures_assurance_maladie('{DB}', '{EH}'::jsonb) i$q$, 'OK', '1'),
      (230, '30 ter. … et, retiré, il ne retient plus rien',
        $q$insert into imports_factures_assurance_maladie (id, dossier_id, premier_lot_le, dernier_lot_le, nombre_de_lots, nombre_de_factures, importe_par) values ('{R}', '{DB}', '{J-6}', '{J-1}', 2, 2, '{CHEF}'); select 1 from retirer_import_factures_assurance_maladie('{R}')$q$, null, 'client',
        $q$select i.nombre_de_lots::text from {IMP} i$q$, 'OK', '3'),
      (31, '31. la part complémentaire nommée par son organisme : acceptée, à côté de la non dite',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats}', jsonb_build_array('{E}'::jsonb -> 'agregats' -> 0, '{E}'::jsonb -> 'agregats' -> 2, jsonb_build_object('date_creation_lot', '{J-5}', 'part', 'complementaire', 'regime', null, 'caisse', null, 'organisme_complementaire', null, 'montant_centimes', 2000, 'nombre_de_lots', 1, 'nombre_de_factures', 3), jsonb_build_object('date_creation_lot', '{J-5}', 'part', 'complementaire', 'regime', null, 'caisse', null, 'organisme_complementaire', 9999999999, 'montant_centimes', 1000, 'nombre_de_lots', 1, 'nombre_de_factures', 2))))$q$,
        null, 'client',
        $q$select string_agg(coalesce(f.organisme_complementaire::text, 'non dit') || ':' || f.montant_centimes, ',' order by f.organisme_complementaire nulls first) from factures_assurance_maladie f where f.dossier_id = '{DB}' and f.part = 'complementaire'$q$,
        'OK', 'non dit:2000,9999999999:1000'),
      (32, '32. un total négatif (un lot d''avoirs) s''importe tel quel',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats,2,montant_centimes}', '-8000'))$q$, null, 'client',
        $q$select f.montant_centimes::text from factures_assurance_maladie f where f.dossier_id = '{DB}' and f.part = 'obligatoire' and f.caisse = 692$q$,
        'OK', '-8000'),
      (33, '33. une forme inconnue : la version 2 (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{version}', '2'))$q$, '22023', 'L''import du facturé n''est pas dans la forme que la base connaît (version 1).'),
      (34, '34. une forme inconnue : une clé de plus, un texte libre (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', '{E}'::jsonb || '{"note": "texte libre"}'::jsonb)$q$, '22023', 'L''import du facturé n''est pas dans la forme que la base connaît (version 1).'),
      (35, '35. aucun lot (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{lots}', '[]'))$q$, '22023', 'Un import du facturé porte de 1 à 2 000 lots et au plus 5 000 totaux.'),
      (36, '36. un lot qui porte un nom (une clé de plus, 22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{lots,0,nom}', '"DUPONT-ESSAI"'))$q$, '22023', 'Un lot de l''import est mal formé : un numéro de 1 à 999 999 999, une date de création, une caisse de trois chiffres au plus et un nombre de factures de 1 à 10 000.'),
      (37, '37. un numéro de lot écrit en texte (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{lots,0,numero}', '"900101"'))$q$, '22023', 'Un lot de l''import est mal formé : un numéro de 1 à 999 999 999, une date de création, une caisse de trois chiffres au plus et un nombre de factures de 1 à 10 000.'),
      (38, '38. un numéro de lot de dix chiffres (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{lots,0,numero}', '1000000000'))$q$, '22023', 'Un lot de l''import est mal formé : un numéro de 1 à 999 999 999, une date de création, une caisse de trois chiffres au plus et un nombre de factures de 1 à 10 000.'),
      (39, '39. une date de création qui n''existe pas (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{lots,0,cree_le}', '"2026-02-30"'))$q$, '22023', 'Un lot de l''import est mal formé : un numéro de 1 à 999 999 999, une date de création, une caisse de trois chiffres au plus et un nombre de factures de 1 à 10 000.'),
      (40, '40. un lot créé demain (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{lots,0,cree_le}', to_jsonb('{J+1}'::text)))$q$, '22023', 'Un lot de l''import porte une date de création à venir.'),
      (41, '41. un lot sans facture (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{lots,0,nombre_de_factures}', '0'))$q$, '22023', 'Un lot de l''import est mal formé : un numéro de 1 à 999 999 999, une date de création, une caisse de trois chiffres au plus et un nombre de factures de 1 à 10 000.'),
      (42, '42. deux lots de même empreinte dans l''envoi (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{lots,1,numero}', '900101'))$q$, '22023', 'L''import porte deux fois le même lot : un même numéro, une même date de création et une même caisse.'),
      (43, '43. un total dont la part est hors de la liste (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats,0,part}', '"forfait"'))$q$, '22023', 'Un total de l''import est mal formé : une date de création, une part de la liste, son organisme (le régime et la caisse pour la part obligatoire ; rien, ou l''organisme complémentaire en chiffres, pour la part complémentaire), un montant en centimes entiers, un nombre de lots et un nombre de factures.'),
      (44, '44. une part obligatoire sans son régime (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats,0,regime}', 'null'))$q$, '22023', 'Un total de l''import est mal formé : une date de création, une part de la liste, son organisme (le régime et la caisse pour la part obligatoire ; rien, ou l''organisme complémentaire en chiffres, pour la part complémentaire), un montant en centimes entiers, un nombre de lots et un nombre de factures.'),
      (45, '45. une part obligatoire sous un organisme complémentaire (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats,0,organisme_complementaire}', '12345678'))$q$, '22023', 'Un total de l''import est mal formé : une date de création, une part de la liste, son organisme (le régime et la caisse pour la part obligatoire ; rien, ou l''organisme complémentaire en chiffres, pour la part complémentaire), un montant en centimes entiers, un nombre de lots et un nombre de factures.'),
      (46, '46. une part complémentaire sous une caisse (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats,1,caisse}', '691'))$q$, '22023', 'Un total de l''import est mal formé : une date de création, une part de la liste, son organisme (le régime et la caisse pour la part obligatoire ; rien, ou l''organisme complémentaire en chiffres, pour la part complémentaire), un montant en centimes entiers, un nombre de lots et un nombre de factures.'),
      (47, '47. un organisme complémentaire de onze chiffres (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats,1,organisme_complementaire}', '10000000000'))$q$, '22023', 'Un total de l''import est mal formé : une date de création, une part de la liste, son organisme (le régime et la caisse pour la part obligatoire ; rien, ou l''organisme complémentaire en chiffres, pour la part complémentaire), un montant en centimes entiers, un nombre de lots et un nombre de factures.'),
      (48, '48. un organisme complémentaire écrit en texte (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats,1,organisme_complementaire}', '"MUTUELLE ESSAI"'))$q$, '22023', 'Un total de l''import est mal formé : une date de création, une part de la liste, son organisme (le régime et la caisse pour la part obligatoire ; rien, ou l''organisme complémentaire en chiffres, pour la part complémentaire), un montant en centimes entiers, un nombre de lots et un nombre de factures.'),
      (49, '49. une fraction de centime (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats,0,montant_centimes}', '12000.5'))$q$, '22023', 'Un total de l''import est mal formé : une date de création, une part de la liste, son organisme (le régime et la caisse pour la part obligatoire ; rien, ou l''organisme complémentaire en chiffres, pour la part complémentaire), un montant en centimes entiers, un nombre de lots et un nombre de factures.'),
      (50, '50. moins de factures que de lots (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats,0,nombre_de_factures}', '1'))$q$, '22023', 'Un total de l''import est mal formé : une date de création, une part de la liste, son organisme (le régime et la caisse pour la part obligatoire ; rien, ou l''organisme complémentaire en chiffres, pour la part complémentaire), un montant en centimes entiers, un nombre de lots et un nombre de factures.'),
      (51, '51. deux totaux de même clé (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats,2}', '{E}'::jsonb -> 'agregats' -> 0))$q$, '22023', 'L''import porte deux fois le même total : une même date de création, une même part et un même organisme.'),
      (52, '52. un total à une date qu''aucun lot ne porte (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats,2,date_creation_lot}', to_jsonb('{J-3}'::text)))$q$, '22023', 'Les totaux de l''import ne se tiennent pas avec ses lots : chacun porte la date de création d''un lot (et, pour la part obligatoire, la caisse de ce lot), et ne compte pas plus de lots ni de factures que ces lots n''en portent.'),
      (53, '53. une part obligatoire sous une caisse qu''aucun lot du jour ne porte (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats,2,caisse}', '693'))$q$, '22023', 'Les totaux de l''import ne se tiennent pas avec ses lots : chacun porte la date de création d''un lot (et, pour la part obligatoire, la caisse de ce lot), et ne compte pas plus de lots ni de factures que ces lots n''en portent.'),
      (54, '54. un total qui compte plus de lots que le jour n''en porte (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set(jsonb_set('{E}'::jsonb, '{agregats,1,nombre_de_lots}', '3'), '{agregats,1,nombre_de_factures}', '5'))$q$, '22023', 'Les totaux de l''import ne se tiennent pas avec ses lots : chacun porte la date de création d''un lot (et, pour la part obligatoire, la caisse de ce lot), et ne compte pas plus de lots ni de factures que ces lots n''en portent.'),
      (55, '55. un total qui compte plus de factures que ses lots (22023)', null, null, 'chef',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats,2,nombre_de_factures}', '5'))$q$, '22023', 'Les totaux de l''import ne se tiennent pas avec ses lots : chacun porte la date de création d''un lot (et, pour la part obligatoire, la caisse de ce lot), et ne compte pas plus de lots ni de factures que ces lots n''en portent.'),
      (56, '56. un nombre entier écrit avec une décimale nulle se lit comme l''entier',
        $q$select 1 from importer_factures_assurance_maladie('{DB}', jsonb_set('{E}'::jsonb, '{agregats,0,montant_centimes}', '12000.0'))$q$, null, 'chef',
        $q$select sum(f.montant_centimes)::text from factures_assurance_maladie f where f.dossier_id = '{DB}'$q$, 'OK', '23000'),
      (57, '57. l''anonyme ne lit rien et n''exécute ni l''import ni le retrait', 'select 1 from {IMP}', null, 'anon',
        $q$select (select count(*) from imports_factures_assurance_maladie) || ' ' || (select count(*) from factures_assurance_maladie) || ' ' || (select count(*) from lots_teletransmission_importes) || ' ' || (select count(*) from cles_des_lots_teletransmission) || ' ' || has_function_privilege('anon', 'public.importer_factures_assurance_maladie(uuid, jsonb)', 'execute') || ' ' || has_function_privilege('anon', 'public.retirer_import_factures_assurance_maladie(uuid)', 'execute')$q$,
        'OK', '0 0 0 0 false false'),
      (58, '58. aucun connecté n''exécute le refus ni la garde', null, null, 'client',
        $q$select has_function_privilege('authenticated', 'public.refus_de_l_import_des_factures_assurance_maladie(jsonb, date)', 'execute') || ' ' || has_function_privilege('authenticated', 'public.garder_factures_assurance_maladie()', 'execute')$q$,
        'OK', 'false false')
    ) as t(rang, etape, pose, pose_proprietaire, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      v_attendu := replace(replace(replace(replace(replace(replace(replace(e.attendu,
        '{Jfr}', to_char(jour, 'DD/MM/YYYY')), '{J-5fr}', to_char(jour - 5, 'DD/MM/YYYY')), '{J-5}', to_char(jour - 5, 'YYYY-MM-DD')),
        '{J-4}', to_char(jour - 4, 'YYYY-MM-DD')), '{J-1}', to_char(jour - 1, 'YYYY-MM-DD')), '{CHEF}', chef), '{CLIENT}', client);
      begin
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        end if;
        if e.pose is not null then
          v_pose := replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
            e.pose, '{IMP}', importer), '{E+}', envoi_plus), '{E7}', envoi_sept), '{E}', envoi), '{DB}', db), '{DS}', ds), '{DX}', dx),
            '{AB}', acces_b), '{R}', restaure), '{CHEF}', chef), '{J-6}', to_char(jour - 6, 'YYYY-MM-DD')), '{J-5}', to_char(jour - 5, 'YYYY-MM-DD')),
            '{J-1}', to_char(jour - 1, 'YYYY-MM-DD')), '{EH}', envoi_hors), '{E2}', envoi_bis);
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        if e.pose_proprietaire is not null then
          execute replace(replace(e.pose_proprietaire, '{DB}', db), '{CHEF}', chef);
        end if;
        v_req := replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
          replace(e.requete, '{IMP}', importer), '{E+}', envoi_plus), '{E2}', envoi_bis), '{E7b}', envoi_sept_bis), '{E7}', envoi_sept),
          '{EH}', envoi_hors), '{E}', envoi), '{DB}', db), '{DS}', ds), '{DX}', dx), '{CHEF}', chef), '{CLIENT}', client),
          '{J-5}', to_char(jour - 5, 'YYYY-MM-DD')), '{J-4}', to_char(jour - 4, 'YYYY-MM-DD')), '{J-3}', to_char(jour - 3, 'YYYY-MM-DD')),
          '{J-1}', to_char(jour - 1, 'YYYY-MM-DD')), '{J+1}', to_char(jour + 1, 'YYYY-MM-DD')), '{R}', restaure);
        begin
          if e.profil = 'anon' then
            execute 'set local role anon';
            perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          elsif e.profil = 'service' then
            execute 'set local role service_role';
            perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
          elsif e.profil <> 'proprietaire' then
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
        'ok', v_code = e.code and v_msg = v_attendu, 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;

    -- Le catalogue : la RLS active sur les quatre tables ; trois policies permissives sur les imports et sur les totaux,
    -- toutes à authenticated, aux expressions exactes, aucune sur le registre ni sur la clé ; la garde avant chaque écriture
    -- des quatre ; aucune colonne de texte hors de la part ; les fonctions de l'API aux droits du propriétaire, search_path
    -- fixé ; ni anon ni PUBLIC ne les exécutent.
    verdicts := verdicts || jsonb_build_object('rang', 59, 'etape', '59. le catalogue : RLS, trois policies sur les imports et les totaux, aucune sur le registre ni la clé, la garde, aucune colonne de texte libre, les fonctions',
      'ok', (select bool_and(c.relrowsecurity) from pg_class c
              where c.oid in ('public.imports_factures_assurance_maladie'::regclass, 'public.factures_assurance_maladie'::regclass,
                              'public.lots_teletransmission_importes'::regclass, 'public.cles_des_lots_teletransmission'::regclass))
        and (select count(*) from pg_policies p where p.schemaname = 'public'
               and p.tablename in ('imports_factures_assurance_maladie', 'factures_assurance_maladie', 'lots_teletransmission_importes',
                                   'cles_des_lots_teletransmission')
               and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 6
        and (select count(*) from pg_policies p where p.schemaname = 'public'
               and p.tablename in ('imports_factures_assurance_maladie', 'factures_assurance_maladie')
               and p.roles = array['authenticated']::name[] and p.permissive = 'PERMISSIVE'
               and ((p.policyname = p.tablename || '_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check is null)
                 or (p.policyname = p.tablename || '_lecture_banque' and p.cmd = 'SELECT'
                     and p.qual = 'client_du_dossier(dossier_id, ''banque''::text)' and p.with_check is null)
                 or (p.policyname = p.tablename || '_restauration' and p.cmd = 'INSERT' and p.qual is null and p.with_check = 'is_super_admin()'))) = 6
        and (select count(*) from pg_trigger t where not t.tgisinternal and t.tgtype = 31
               and t.tgfoid = 'public.garder_factures_assurance_maladie()'::regprocedure
               and t.tgrelid in ('public.imports_factures_assurance_maladie'::regclass, 'public.factures_assurance_maladie'::regclass,
                                 'public.lots_teletransmission_importes'::regclass, 'public.cles_des_lots_teletransmission'::regclass)) = 4
        and not exists (select 1 from pg_attribute a
               where a.attrelid in ('public.imports_factures_assurance_maladie'::regclass, 'public.factures_assurance_maladie'::regclass,
                                    'public.lots_teletransmission_importes'::regclass, 'public.cles_des_lots_teletransmission'::regclass)
                 and a.attnum > 0 and not a.attisdropped
                 and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype, 'json'::regtype, 'jsonb'::regtype)
                 and not (a.attrelid = 'public.factures_assurance_maladie'::regclass and a.attname = 'part'))
        and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.oid in ('public.importer_factures_assurance_maladie(uuid, jsonb)'::regprocedure,
                             'public.retirer_import_factures_assurance_maladie(uuid)'::regprocedure)
               and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
               and not has_function_privilege('anon', p.oid, 'execute')
               and has_function_privilege('authenticated', p.oid, 'execute')
               and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) = 2,
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les dossiers jetables, ni leurs accès, ni leurs imports, totaux, empreintes et clés, ni le compte
  -- d'essai dans le cabinet.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leurs imports, totaux, empreintes et clés, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from memberships where id in (acces_b::uuid, acces_s::uuid))
      and not exists (select 1 from imports_factures_assurance_maladie where dossier_id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from factures_assurance_maladie where dossier_id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from lots_teletransmission_importes where dossier_id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from cles_des_lots_teletransmission where dossier_id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.factures_assurance_maladie', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.factures_assurance_maladie')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
