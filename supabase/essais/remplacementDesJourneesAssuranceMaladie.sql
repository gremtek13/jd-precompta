-- LE REMPLACEMENT D'UNE JOURNÉE COMPTABLE NON ASSOCIÉE PAR UN NOUVEL EXPORT DES PAIEMENTS DE L'ASSURANCE MALADIE (conception 53,
-- § 14.2 ; NOE4R-Q2 (B) ; la migration `remplacement_des_journees_assurance_maladie`, préparée le 27/11/2026, PAS APPLIQUÉE, après
-- `periode_des_imports_assurance_maladie` : supabase/preparees/20261127215500_remplacement_des_journees_assurance_maladie.sql).
-- Le récit : HISTORIQUE.md, « 27/11/2026 — NOE4R-Q1 ET NOE4R-Q2 ». À rejouer par `execute_sql` après toute migration qui touche
-- la fonction du remplacement, sa trace, la fonction d'import, l'association ou les tables des paiements. Le retrait d'une trace
-- en direct ne se joue pas ici (l'outil d'exécution de la production retient une suppression) :
-- remplacementDesJourneesAssuranceMaladieSuppression.sql, sur une réplique.
--
-- Ce qui se prouve ici, et ne se relit pas : le cabinet (le chef, un membre qui n'est pas super-administrateur) et le client
-- « Banque » remplacent une journée ; la journée telle que l'export la porte — le paiement qui diffère remplacé et rangé dans le
-- nouvel import, le neuf entré, celui que le fichier ne porte pas resté dans l'import d'avant ; la période du nouvel import sur
-- ses seuls paiements insérés, ses rejets ceux du fichier ; la trace, ses chiffres d'avant et d'après, ses deux imports et son
-- auteur, lue par le client « Banque » et pas sans la case ; chaque refus sous ses mots, dans l'ordre de la migration — l'appelant,
-- la forme de l'import, celle des paiements lus, un exercice validé, rien à remplacer, la version changée (un paiement de moins,
-- un d'une autre journée), une journée associée nommée, et pas une association d'une autre journée ; l'import seul refuse
-- toujours le conflit ; personne n'écrit ni ne réécrit la trace en direct, hors de la restauration ; le retrait du nouvel import
-- ne rend pas le paiement remplacé et laisse la trace, celui de l'ancien aussi ; l'anonyme ; le catalogue.
--
-- Trois dossiers jetables du cabinet du dossier `test` (préfixe `e5320000-0000-4000-8000`) : DB, où l'accès du client d'essai
-- porte « Banque », DS, où il ne la porte pas, et DX, où il n'a aucun accès. Chaque étape se joue dans sa sous-transaction et
-- s'y ANNULE (`ANNULATION_ETAPE`) : ce que le chef pose d'abord (sous sa session), ce que le propriétaire pose ensuite, puis la
-- requête du profil ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts
-- voyagent dans un réglage LOCAL à la transaction (`essai.remplacement_des_journees`), que la requête finale lit : le fichier se
-- joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende
-- d'une ligne hors de ses dossiers. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la migration,
-- une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  db constant text := 'e5320000-0000-4000-8000-0000000000d1';
  ds constant text := 'e5320000-0000-4000-8000-0000000000d2';
  dx constant text := 'e5320000-0000-4000-8000-0000000000d3';
  acces_b constant text := 'e5320000-0000-4000-8000-0000000000a1';
  acces_s constant text := 'e5320000-0000-4000-8000-0000000000a2';
  inconnu constant text := 'e5320000-0000-4000-8000-0000000000f1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  jour constant date := (now() at time zone 'Europe/Paris')::date;
  -- Le premier export (A) : la part obligatoire et la complémentaire de J-3, un forfait de J-2, la part obligatoire de J-1, deux
  -- rejets. Le second (B) : la part obligatoire de J-3 avec d'autres chiffres, un paiement neuf de J-3 (une autre caisse), J-1
  -- aux mêmes chiffres ; ni la complémentaire de J-3 ni le forfait ; un rejet.
  imp_a text; imp_b text;
  -- Les paiements en base de J-3, tels qu'un écran les lit (sous la session du profil).
  lus3 constant text := $l$(select array_agg(p.id) from paiements_assurance_maladie p where p.dossier_id = '{D}' and p.date_journee_comptable = '{J-3}')$l$;
  importer_a constant text := $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{A}'::jsonb)$q$;
  remplacer_b constant text := $q$select 1 from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, {LUS3})$q$;
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text; v_attendu text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.remplacements_assurance_maladie') is null
     or to_regprocedure('public.remplacer_journees_assurance_maladie(uuid,jsonb,uuid[])') is null then
    perform set_config('essai.remplacement_des_journees', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration remplacement_des_journees_assurance_maladie (NOE4R-Q2)', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  imp_a := jsonb_build_object('version', 1, 'rejets', jsonb_build_object('nombre', 2, 'montant_centimes', 4500),
    'paiements', jsonb_build_array(
      jsonb_build_object('date_journee_comptable', to_char(jour - 3, 'YYYY-MM-DD'), 'regime', 1, 'caisse', 691, 'organisme_complementaire', null,
        'part', 'obligatoire', 'montant_centimes', 12345, 'regularisations_centimes', 0, 'nombre_de_factures', 7),
      jsonb_build_object('date_journee_comptable', to_char(jour - 3, 'YYYY-MM-DD'), 'regime', 1, 'caisse', 691, 'organisme_complementaire', null,
        'part', 'complementaire', 'montant_centimes', 2345, 'regularisations_centimes', 0, 'nombre_de_factures', 3),
      jsonb_build_object('date_journee_comptable', to_char(jour - 2, 'YYYY-MM-DD'), 'regime', null, 'caisse', null, 'organisme_complementaire', null,
        'part', 'forfait', 'montant_centimes', 50000, 'regularisations_centimes', 0, 'nombre_de_factures', 0),
      jsonb_build_object('date_journee_comptable', to_char(jour - 1, 'YYYY-MM-DD'), 'regime', 1, 'caisse', 691, 'organisme_complementaire', null,
        'part', 'obligatoire', 'montant_centimes', 900, 'regularisations_centimes', -100, 'nombre_de_factures', 1)))::text;
  imp_b := jsonb_build_object('version', 1, 'rejets', jsonb_build_object('nombre', 1, 'montant_centimes', 300),
    'paiements', jsonb_build_array(
      jsonb_build_object('date_journee_comptable', to_char(jour - 3, 'YYYY-MM-DD'), 'regime', 1, 'caisse', 691, 'organisme_complementaire', null,
        'part', 'obligatoire', 'montant_centimes', 13000, 'regularisations_centimes', 0, 'nombre_de_factures', 8),
      jsonb_build_object('date_journee_comptable', to_char(jour - 3, 'YYYY-MM-DD'), 'regime', 1, 'caisse', 692, 'organisme_complementaire', null,
        'part', 'obligatoire', 'montant_centimes', 1500, 'regularisations_centimes', 0, 'nombre_de_factures', 1),
      jsonb_build_object('date_journee_comptable', to_char(jour - 1, 'YYYY-MM-DD'), 'regime', 1, 'caisse', 691, 'organisme_complementaire', null,
        'part', 'obligatoire', 'montant_centimes', 900, 'regularisations_centimes', -100, 'nombre_de_factures', 1)))::text;
  begin
    -- Le jeu : trois dossiers jetables, et un accès du client d'essai à DB (« Banque ») et à DS (sans elle), insérés par le
    -- propriétaire comme `create-client-access` les insère — la case posée à l'insertion.
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva) values
      (db::uuid, 'ESSAI REMPLACEMENT DES JOURNEES DB', cabinet, 'tresorerie', '455000', 'exonere'),
      (ds::uuid, 'ESSAI REMPLACEMENT DES JOURNEES DS', cabinet, 'tresorerie', '455000', 'exonere'),
      (dx::uuid, 'ESSAI REMPLACEMENT DES JOURNEES DX', cabinet, 'tresorerie', '455000', 'exonere');
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque) values
      (acces_b::uuid, client::uuid, db::uuid, 'client', 'essai-remplacement-b@example.test', true),
      (acces_s::uuid, client::uuid, ds::uuid, 'client', 'essai-remplacement-s@example.test', false);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord (super-administrateur, sous sa session), ce que le PROPRIÉTAIRE pose
    -- ensuite (sans session : un exercice validé), le profil — `chef`, `chef_simple` (le compte client rattaché au cabinet, le
    -- temps de l'étape), `client`, `inconnu`, `service` (le rôle des Edge Functions) ou `anon` —, sa requête, le code attendu
    -- (`OK` : acceptée) et ce qu'elle rend, ou les mots du refus}. `{IMPA}` importe A dans DB, `{REMPB}` y remplace par B,
    -- `{LUS3}` : les paiements de J-3 de DB tels que le profil les lit. La requête qui appelle une fonction d'écriture lit ce
    -- qu'elle rend, jamais ce qu'elle a écrit ailleurs : ce que le remplacement a écrit se lit à l'étape suivante, posé par le chef.
    for e in select * from (values
      (1, '1. le chef remplace la journée : le nouvel import porte la période de ses seuls paiements insérés et les rejets du fichier', '{IMPA}', null, 'chef',
        $q$select i.periode_du || ' ' || i.periode_au || ' ' || i.nombre_de_rejets || ' ' || i.montant_rejete_centimes from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, {LUS3}) i$q$,
        'OK', '{J-3} {J-3} 1 300'),
      (2, '2. … la journée telle que l''export la porte : le paiement qui diffère remplacé, le neuf entré, tous deux au nouvel import ; la complémentaire que le fichier ne porte pas restée à l''ancien',
        '{IMPA}; {REMPB}', null, 'chef',
        $q$select string_agg(p.part || '/' || p.caisse || '/' || p.montant_centimes || '/' || p.nombre_de_factures || '/' || (i.periode_au = '{J-3}')::text, ',' order by p.part, p.caisse) from paiements_assurance_maladie p join imports_assurance_maladie i on i.id = p.import_id where p.dossier_id = '{DB}' and p.date_journee_comptable = '{J-3}'$q$,
        'OK', 'complementaire/691/2345/3/false,obligatoire/691/13000/8/true,obligatoire/692/1500/1/true'),
      (3, '3. … l''ancien import garde ses autres paiements et sa période ; le forfait de J-2 et J-1 n''ont pas bougé',
        '{IMPA}; {REMPB}', null, 'chef',
        $q$select string_agg(c.n || ':' || c.du || '..' || c.au, ',' order by c.n desc) from (select count(p.id) as n, i.periode_du as du, i.periode_au as au from imports_assurance_maladie i left join paiements_assurance_maladie p on p.import_id = i.id where i.dossier_id = '{DB}' group by i.id, i.periode_du, i.periode_au) c$q$,
        'OK', '3:{J-3}..{J-1},2:{J-3}..{J-3}'),
      (4, '4. … la trace : le paiement remplacé, ses chiffres d''avant et d''après, l''import qui l''avait apporté et celui qui le remplace, son auteur',
        '{IMPA}; {REMPB}', null, 'chef',
        $q$select string_agg(t.part || ' ' || t.caisse || ' ' || t.ancien_montant_centimes || '/' || t.ancien_regularisations_centimes || '/' || t.ancien_nombre_de_factures || ' ' || t.nouveau_montant_centimes || '/' || t.nouveau_regularisations_centimes || '/' || t.nouveau_nombre_de_factures || ' ' || (t.ancien_import_id = (select i.id from imports_assurance_maladie i where i.dossier_id = '{DB}' and i.periode_au = '{J-1}'))::text || ' ' || (t.import_id = (select i.id from imports_assurance_maladie i where i.dossier_id = '{DB}' and i.periode_au = '{J-3}'))::text || ' ' || (t.remplace_par::text = '{CHEF}')::text || ' ' || t.date_journee_comptable, ',') from remplacements_assurance_maladie t where t.dossier_id = '{DB}'$q$,
        'OK', 'obligatoire 691 12345/0/7 13000/0/8 true true true {J-3}'),
      (5, '5. le client « Banque » remplace : il en est l''auteur', '{IMPA}', null, 'client',
        $q$select (i.importe_par::text = '{CLIENT}')::text from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, {LUS3}) i$q$, 'OK', 'true'),
      (6, '6. le client « Banque » lit la trace de son dossier', '{IMPA}; {REMPB}', null, 'client',
        $q$select count(*)::text from remplacements_assurance_maladie t where t.dossier_id = '{DB}'$q$, 'OK', '1'),
      (7, '7. un membre du cabinet qui n''est pas super-administrateur remplace', '{IMPA}', null, 'chef_simple',
        $q$select (i.importe_par::text = '{CLIENT}')::text from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, {LUS3}) i$q$, 'OK', 'true'),
      (8, '8. le client sans la case ne remplace pas dans DS (42501)',
        $q$select 1 from importer_paiements_assurance_maladie('{DS}', '{A}'::jsonb)$q$, null, 'client',
        $q$select 1 from remplacer_journees_assurance_maladie('{DS}', '{B}'::jsonb, array[gen_random_uuid()])$q$, '42501', 'Accès refusé à ce dossier.'),
      (9, '9. … ni ne lit la trace de DS',
        $q$select 1 from importer_paiements_assurance_maladie('{DS}', '{A}'::jsonb); select 1 from remplacer_journees_assurance_maladie('{DS}', '{B}'::jsonb, (select array_agg(p.id) from paiements_assurance_maladie p where p.dossier_id = '{DS}' and p.date_journee_comptable = '{J-3}'))$q$, null, 'client',
        $q$select count(*)::text from remplacements_assurance_maladie t where t.dossier_id = '{DS}'$q$, 'OK', '0'),
      (10, '10. le client ne remplace pas dans un dossier où il n''a aucun accès (DX, 42501)', null, null, 'client',
        $q$select 1 from remplacer_journees_assurance_maladie('{DX}', '{B}'::jsonb, array[gen_random_uuid()])$q$, '42501', 'Accès refusé à ce dossier.'),
      (11, '11. un compte connecté sans accès ne remplace pas (42501)', '{IMPA}', null, 'inconnu',
        $q$select 1 from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, array[gen_random_uuid()])$q$, '42501', 'Accès refusé à ce dossier.'),
      (12, '12. un import d''une forme inconnue : la version 2 (22023, les mots de la forme)', '{IMPA}', null, 'chef',
        $q$select 1 from remplacer_journees_assurance_maladie('{DB}', jsonb_set('{B}'::jsonb, '{version}', '2'), {LUS3})$q$, '22023',
        'L''import n''est pas dans la forme que la base connaît (version 1).'),
      (13, '13. des paiements lus absents (22023)', '{IMPA}', null, 'chef',
        $q$select 1 from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, null)$q$, '22023',
        'Le remplacement est mal formé : les paiements en base des journées à remplacer, chacun une fois, de 1 à 5 000.'),
      (14, '14. une liste de paiements lus vide (22023)', '{IMPA}', null, 'chef',
        $q$select 1 from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, array[]::uuid[])$q$, '22023',
        'Le remplacement est mal formé : les paiements en base des journées à remplacer, chacun une fois, de 1 à 5 000.'),
      (15, '15. un paiement lu deux fois (22023)', '{IMPA}', null, 'chef',
        $q$select 1 from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, {LUS3} || {LUS3})$q$, '22023',
        'Le remplacement est mal formé : les paiements en base des journées à remplacer, chacun une fois, de 1 à 5 000.'),
      (16, '16. un paiement de l''import dans un exercice validé (22023, les mots de l''import)', '{IMPA}',
        $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte) values ('{DB}', extract(year from date '{J-3}')::integer, now(), '{CHEF}', 'engagement', 0, 0, 0, 0, repeat('0', 64))$q$,
        'chef', $q$select 1 from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, {LUS3})$q$, '22023',
        'Un paiement de l''import tombe dans un exercice que le cabinet a validé : il ne s''importe plus.'),
      (17, '17. un fichier qui ne diffère de la base sur aucune journée : rien à remplacer (22023)', '{IMPA}', null, 'chef',
        $q$select 1 from remplacer_journees_assurance_maladie('{DB}', '{A}'::jsonb, {LUS3})$q$, '22023',
        'Aucune journée de l''import ne porte d''autres chiffres que la base : rien à remplacer.'),
      (18, '18. la version : un paiement de la journée en moins (22023)', '{IMPA}', null, 'client',
        $q$select 1 from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, (select array_agg(p.id) from paiements_assurance_maladie p where p.dossier_id = '{DB}' and p.date_journee_comptable = '{J-3}' and p.part = 'obligatoire'))$q$, '22023',
        'Les journées à remplacer ont changé depuis leur lecture : rien n''est remplacé.'),
      (19, '19. … un paiement d''une autre journée en plus (22023)', '{IMPA}', null, 'chef',
        $q$select 1 from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, {LUS3} || (select array_agg(p.id) from paiements_assurance_maladie p where p.dossier_id = '{DB}' and p.date_journee_comptable = '{J-1}'))$q$, '22023',
        'Les journées à remplacer ont changé depuis leur lecture : rien n''est remplacé.'),
      (20, '20. une journée dont un paiement est associé à un crédit du relevé ne se remplace pas, nommée (22023)',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{A}'::jsonb); insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{DB}', '{J-2}', 'essai remplacement', 23.45); select 1 from associer_paiements_assurance_maladie('{DB}', (select array_agg(p.id) from paiements_assurance_maladie p where p.dossier_id = '{DB}' and p.part = 'complementaire'), (select array_agg(l.id) from lignes_bancaires l where l.dossier_id = '{DB}' and l.montant = 23.45))$q$,
        null, 'client', $q$select 1 from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, {LUS3})$q$, '22023',
        'La journée comptable du {J-3fr} porte un paiement associé à un crédit du relevé : elle ne se remplace pas tant que cette association n''est pas défaite.'),
      (21, '21. … une association sur une AUTRE journée ne retient pas le remplacement',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{A}'::jsonb); insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{DB}', '{J}', 'essai remplacement', 9.00); select 1 from associer_paiements_assurance_maladie('{DB}', (select array_agg(p.id) from paiements_assurance_maladie p where p.dossier_id = '{DB}' and p.date_journee_comptable = '{J-1}'), (select array_agg(l.id) from lignes_bancaires l where l.dossier_id = '{DB}' and l.montant = 9.00))$q$,
        null, 'chef', $q$select i.periode_du || ' ' || i.periode_au from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, {LUS3}) i$q$, 'OK', '{J-3} {J-3}'),
      (22, '22. l''import seul refuse toujours le conflit : le remplacement est un autre geste (22023)', '{IMPA}', null, 'chef',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{B}'::jsonb)$q$, '22023',
        'Un paiement de l''import est déjà en base avec d''autres chiffres (la journée comptable du {J-3fr}) : retirer d''abord l''import qui le porte.'),
      (23, '23. le client « Banque » n''écrit pas une trace en direct (42501, la garde)', '{IMPA}', null, 'client',
        $q$insert into remplacements_assurance_maladie (dossier_id, import_id, ancien_import_id, date_journee_comptable, regime, caisse, part, ancien_montant_centimes, ancien_regularisations_centimes, ancien_nombre_de_factures, nouveau_montant_centimes, nouveau_regularisations_centimes, nouveau_nombre_de_factures, remplace_par) values ('{DB}', gen_random_uuid(), gen_random_uuid(), '{J-3}', 1, 691, 'obligatoire', 100, 0, 1, 200, 0, 2, '{CLIENT}') returning 1$q$,
        '42501', 'Les remplacements des paiements de l''assurance maladie ne s''écrivent que par leur fonction.'),
      (24, '24. un chef qui n''est pas super-administrateur non plus', null, null, 'chef_simple',
        $q$insert into remplacements_assurance_maladie (dossier_id, import_id, ancien_import_id, date_journee_comptable, regime, caisse, part, ancien_montant_centimes, ancien_regularisations_centimes, ancien_nombre_de_factures, nouveau_montant_centimes, nouveau_regularisations_centimes, nouveau_nombre_de_factures, remplace_par) values ('{DB}', gen_random_uuid(), gen_random_uuid(), '{J-3}', 1, 691, 'obligatoire', 100, 0, 1, 200, 0, 2, '{CLIENT}') returning 1$q$,
        '42501', 'Les remplacements des paiements de l''assurance maladie ne s''écrivent que par leur fonction.'),
      (25, '25. le rôle des Edge Functions, qui passe la RLS, non plus (la garde)', null, null, 'service',
        $q$insert into remplacements_assurance_maladie (dossier_id, import_id, ancien_import_id, date_journee_comptable, regime, caisse, part, ancien_montant_centimes, ancien_regularisations_centimes, ancien_nombre_de_factures, nouveau_montant_centimes, nouveau_regularisations_centimes, nouveau_nombre_de_factures, remplace_par) values ('{DB}', gen_random_uuid(), gen_random_uuid(), '{J-3}', 1, 691, 'obligatoire', 100, 0, 1, 200, 0, 2, '{CHEF}') returning 1$q$,
        '42501', 'Les remplacements des paiements de l''assurance maladie ne s''écrivent que par leur fonction.'),
      (26, '26. le super-administrateur insère en direct : la restauration', null, null, 'chef',
        $q$insert into remplacements_assurance_maladie (dossier_id, import_id, ancien_import_id, date_journee_comptable, regime, caisse, part, ancien_montant_centimes, ancien_regularisations_centimes, ancien_nombre_de_factures, nouveau_montant_centimes, nouveau_regularisations_centimes, nouveau_nombre_de_factures, remplace_par) values ('{DB}', gen_random_uuid(), gen_random_uuid(), '{J-3}', 1, 691, 'obligatoire', 100, 0, 1, 200, 0, 2, '{CHEF}') returning 1$q$,
        'OK', '1'),
      (27, '27. une trace aux mêmes chiffres d''avant et d''après ne s''écrit pas, même en restauration (23514)', null, null, 'chef',
        $q$insert into remplacements_assurance_maladie (dossier_id, import_id, ancien_import_id, date_journee_comptable, regime, caisse, part, ancien_montant_centimes, ancien_regularisations_centimes, ancien_nombre_de_factures, nouveau_montant_centimes, nouveau_regularisations_centimes, nouveau_nombre_de_factures, remplace_par) values ('{DB}', gen_random_uuid(), gen_random_uuid(), '{J-3}', 1, 691, 'obligatoire', 100, 0, 1, 100, 0, 1, '{CHEF}') returning 1$q$,
        '23514', 'new row for relation "remplacements_assurance_maladie" violates check constraint "remplacements_assurance_maladie_autres_chiffres"'),
      (28, '28. le rôle des Edge Functions ne réécrit pas une trace (23514, la garde)', '{IMPA}; {REMPB}', null, 'service',
        $q$update remplacements_assurance_maladie set remplace_le = remplace_le where dossier_id = '{DB}' returning 1$q$, '23514',
        'La trace d''un paiement de l''assurance maladie remplacé ne se modifie pas.'),
      (29, '29. le super-administrateur ne réécrit rien : aucune policy de mise à jour, aucune ligne touchée', '{IMPA}; {REMPB}', null, 'chef',
        $q$with t as (update remplacements_assurance_maladie set remplace_le = remplace_le where dossier_id = '{DB}' returning 1) select count(*)::text from t$q$, 'OK', '0'),
      (30, '30. le retrait du nouvel import ne rend pas le paiement remplacé, et la trace reste',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{A}'::jsonb); select 1 from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, (select array_agg(p.id) from paiements_assurance_maladie p where p.dossier_id = '{DB}' and p.date_journee_comptable = '{J-3}')); select 1 from retirer_import_assurance_maladie((select i.id from imports_assurance_maladie i where i.dossier_id = '{DB}' and i.periode_au = '{J-3}'))$q$,
        null, 'chef',
        $q$select (select count(*) from remplacements_assurance_maladie t where t.dossier_id = '{DB}') || ' ' || (select string_agg(p.part, ',') from paiements_assurance_maladie p where p.dossier_id = '{DB}' and p.date_journee_comptable = '{J-3}')$q$,
        'OK', '1 complementaire'),
      (31, '31. le retrait de l''ancien import laisse la trace et les paiements du nouveau',
        $q$select 1 from importer_paiements_assurance_maladie('{DB}', '{A}'::jsonb); select 1 from remplacer_journees_assurance_maladie('{DB}', '{B}'::jsonb, (select array_agg(p.id) from paiements_assurance_maladie p where p.dossier_id = '{DB}' and p.date_journee_comptable = '{J-3}')); select 1 from retirer_import_assurance_maladie((select i.id from imports_assurance_maladie i where i.dossier_id = '{DB}' and i.periode_au = '{J-1}'))$q$,
        null, 'client',
        $q$select (select count(*) from remplacements_assurance_maladie t where t.dossier_id = '{DB}') || ' ' || (select count(*) from paiements_assurance_maladie p where p.dossier_id = '{DB}')$q$,
        'OK', '1 2'),
      (32, '32. l''anonyme ne lit pas la trace et n''exécute pas le remplacement', '{IMPA}; {REMPB}', null, 'anon',
        $q$select (select count(*) from remplacements_assurance_maladie) || ' ' || has_function_privilege('anon', 'public.remplacer_journees_assurance_maladie(uuid, jsonb, uuid[])', 'execute')$q$,
        'OK', '0 false'),
      (33, '33. aucun connecté n''exécute la garde de la trace', null, null, 'client',
        $q$select has_function_privilege('authenticated', 'public.garder_remplacements_assurance_maladie()', 'execute')::text$q$, 'OK', 'false')
    ) as t(rang, etape, pose, pose_proprietaire, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      v_attendu := replace(replace(replace(replace(replace(replace(e.attendu,
        '{J-3fr}', to_char(jour - 3, 'DD/MM/YYYY')), '{J-3}', to_char(jour - 3, 'YYYY-MM-DD')), '{J-1}', to_char(jour - 1, 'YYYY-MM-DD')),
        '{J}', to_char(jour, 'YYYY-MM-DD')), '{CHEF}', chef), '{CLIENT}', client);
      begin
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        end if;
        if e.pose is not null then
          v_pose := replace(replace(e.pose, '{IMPA}', importer_a), '{REMPB}', remplacer_b);
          v_pose := replace(replace(replace(replace(replace(replace(replace(replace(v_pose, '{LUS3}', replace(lus3, '{D}', '{DB}')),
            '{A}', imp_a), '{B}', imp_b), '{DB}', db), '{DS}', ds), '{J-3}', to_char(jour - 3, 'YYYY-MM-DD')),
            '{J-2}', to_char(jour - 2, 'YYYY-MM-DD')), '{J-1}', to_char(jour - 1, 'YYYY-MM-DD'));
          v_pose := replace(v_pose, '{J}', to_char(jour, 'YYYY-MM-DD'));
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        if e.pose_proprietaire is not null then
          execute replace(replace(replace(e.pose_proprietaire, '{DB}', db), '{CHEF}', chef), '{J-3}', to_char(jour - 3, 'YYYY-MM-DD'));
        end if;
        v_req := replace(replace(replace(replace(replace(replace(replace(replace(replace(e.requete,
          '{LUS3}', replace(lus3, '{D}', '{DB}')), '{A}', imp_a), '{B}', imp_b), '{DB}', db), '{DS}', ds), '{DX}', dx),
          '{CHEF}', chef), '{CLIENT}', client), '{J-3}', to_char(jour - 3, 'YYYY-MM-DD'));
        v_req := replace(v_req, '{J-1}', to_char(jour - 1, 'YYYY-MM-DD'));
        begin
          if e.profil = 'anon' then
            execute 'set local role anon';
            perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          elsif e.profil = 'service' then
            execute 'set local role service_role';
            perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
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
        'ok', v_code = e.code and v_msg = v_attendu, 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;

    -- Le catalogue : la RLS active ; trois policies permissives, toutes à authenticated, aux expressions exactes ; la garde
    -- avant chaque écriture ; aucune colonne de texte hors de la part ; aucune clé étrangère hors du dossier ; la fonction aux
    -- droits du propriétaire, son chemin fixé ; ni anon ni PUBLIC ne l'exécutent.
    verdicts := verdicts || jsonb_build_object('rang', 34, 'etape', '34. le catalogue : RLS, trois policies à authenticated, la garde, aucune colonne de texte libre, la seule clé du dossier, la fonction',
      'ok', (select c.relrowsecurity from pg_class c where c.oid = 'public.remplacements_assurance_maladie'::regclass)
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'remplacements_assurance_maladie'
               and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 3
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'remplacements_assurance_maladie'
               and p.roles = array['authenticated']::name[] and p.permissive = 'PERMISSIVE'
               and ((p.policyname = 'remplacements_assurance_maladie_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check is null)
                 or (p.policyname = 'remplacements_assurance_maladie_lecture_banque' and p.cmd = 'SELECT'
                     and p.qual = 'client_du_dossier(dossier_id, ''banque''::text)' and p.with_check is null)
                 or (p.policyname = 'remplacements_assurance_maladie_restauration' and p.cmd = 'INSERT' and p.qual is null and p.with_check = 'is_super_admin()'))) = 3
        and (select count(*) from pg_trigger t where not t.tgisinternal and t.tgtype = 31
               and t.tgfoid = 'public.garder_remplacements_assurance_maladie()'::regprocedure
               and t.tgrelid = 'public.remplacements_assurance_maladie'::regclass) = 1
        and not exists (select 1 from pg_attribute a
               where a.attrelid = 'public.remplacements_assurance_maladie'::regclass and a.attnum > 0 and not a.attisdropped
                 and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype, 'json'::regtype, 'jsonb'::regtype)
                 and a.attname <> 'part')
        and (select string_agg(c.confrelid::regclass::text, ',') from pg_constraint c
              where c.conrelid = 'public.remplacements_assurance_maladie'::regclass and c.contype = 'f') = 'dossiers'
        and (select count(*) from pg_proc p
              where p.oid = 'public.remplacer_journees_assurance_maladie(uuid, jsonb, uuid[])'::regprocedure
                and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
                and not has_function_privilege('anon', p.oid, 'execute')
                and has_function_privilege('authenticated', p.oid, 'execute')
                and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) = 1,
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les dossiers jetables, ni leurs accès, ni leurs imports, paiements, mouvements et traces, ni le compte
  -- d'essai dans le cabinet.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leurs imports, paiements, mouvements et traces, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from memberships where id in (acces_b::uuid, acces_s::uuid))
      and not exists (select 1 from imports_assurance_maladie where dossier_id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from paiements_assurance_maladie where dossier_id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from lignes_bancaires where dossier_id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from remplacements_assurance_maladie where dossier_id in (db::uuid, ds::uuid, dx::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.remplacement_des_journees', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.remplacement_des_journees')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
