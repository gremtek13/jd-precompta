-- LA RÉGULARISATION DES COTISATIONS : L'ORGANISME, L'ANNÉE PAYÉE, LA NATURE D'UNE ÉCHÉANCE ET SA PART QUI RÉGULARISE L'ANNÉE
-- D'AVANT (ligne 27, TNS-Q2 et TNS-Q2-B ; la migration
-- `regularisation_des_cotisations`, en production depuis le 07/11/2026,
-- supabase/schema/20261107165415_regularisation_des_cotisations.sql). Le récit : HISTORIQUE.md, « 07/11/2026 —
-- LA RÉGULARISATION DES COTISATIONS (LIGNE 27, TNS-Q2) (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer par `execute_sql` après toute
-- migration qui touche `cotisations_declarees`, ses contraintes ou `garder_cotisation_valide`.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - le catalogue : quatre colonnes (texte, entier, texte, numeric), nulles, sans valeur par défaut ; leurs six contraintes,
--     au texte près ; une échéance écrite sans elles les lit nulles ;
--   - chacune des douze valeurs de l'organisme et des trois natures s'écrit ; une valeur hors de la liste, une casse
--     changée, le vide se refusent (23514), sous le nom de leur contrainte ;
--   - l'année payée : de cinq ans avant l'année de l'échéance à un an après, les deux bornes admises, les deux au-delà
--     refusées, et une date changée qui la met hors de ses bornes aussi ; une régularisation de l'année de l'échéance ou d'une
--     année passée s'écrit, celle d'une année à venir se refuse, et une provisionnelle de l'année suivante s'écrit ;
--   - un champ seul s'écrit (aucune contrainte n'exige les trois premiers ensemble) ;
--   - la part (TNS-Q2-B) : un prélèvement mixte de janvier (550 appelés dont 150 de régularisation), un trop-versé imputé
--     (250 appelés, −150), un acompte, une part égale à l'appel s'écrivent ; une part qui dépasse l'appel d'un centime, un
--     crédit plus fort que l'appel, zéro, et un montant changé qui la met hors de sa borne se refusent sous
--     `…_part_regularisation_bornee` ; sur une régularisation, sans nature, sans année payée, ou sous une nature changée,
--     sous `…_part_regularisation_nature` ;
--   - le gel : son corps, au texte près ; l'exercice 2025 validé, son échéance se décrit encore — l'organisme, l'année, la
--     nature, et les trois avec sa date et ses montants réécrits à l'identique (un nombre d'une autre écriture), comme les
--     écrit « Modifier » —, mais son montant, sa date, sa CSG-CRDS (même avec sa description) et son marqueur ne changent
--     plus, sous les mots de la base, et une échéance décrite ne s'y ajoute plus ; celle de 2026 change encore ; sa part se
--     pose, change et se retire, son montant reste refusé même avec elle, et sa contrainte mord sur l'échéance figée ;
--   - une échéance payée depuis le compte personnel (le réglage de la fonction posé comme elle le pose) : sa description
--     change, ses montants non, sous les mots de `garder_paiement_personnel` ;
--   - le client d'essai, qui n'a pas ce dossier, n'écrit rien (zéro ligne).
--
-- Un dossier jetable du cabinet du dossier `test` (préfixe `5e115000-0000-4000-8107`), sous le profil de son chef, au sein
-- d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) : rien ne reste. Chaque étape se joue dans sa
-- propre sous-transaction ; celle qui passe garde ce qu'elle écrit jusqu'à l'annulation finale (la suite en a besoin), celle
-- qui se refuse n'écrit rien. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.regularisation`), que la
-- requête finale lit : le fichier se joue d'un seul appel, ne crée ni table ni fonction et ne contient aucune instruction de
-- suppression ; toute mise à jour porte son `where`. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
-- Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  verdicts jsonb := '[]'::jsonb;
  e record;
  v_obs text;
  v_code text;
  v_msg text;
begin
  if (select count(*) from pg_attribute a
       where a.attrelid = 'public.cotisations_declarees'::regclass and not a.attisdropped
         and a.attname in ('organisme', 'annee_payee', 'nature', 'part_regularisation')) = 0 then
    perform set_config('essai.regularisation', jsonb_build_array(jsonb_build_object('rang', 1,
      'etape', '0. EN ATTENTE de la migration regularisation_des_cotisations', 'ok', true,
      'observe', 'les quatre colonnes absentes : rien ne s''écrit'))::text, true);
    return;
  end if;

  begin
    -- Un dossier jetable, en trésorerie, et trois échéances écrites comme hier, sans les trois champs : E1 en 2025 (que la
    -- validation figera), E2 et E3 en 2026 (E3, que la suite déclare payée depuis le compte personnel).
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      ('5e115000-0000-4000-8107-000000000001', 'ESSAI REGULARISATION', cabinet, 'tresorerie', '455000');
    insert into cotisations_declarees (id, dossier_id, echeance, montant_appele) values
      ('5e115000-0000-4000-8107-000000000021', '5e115000-0000-4000-8107-000000000001', '2025-03-05', 800),
      ('5e115000-0000-4000-8107-000000000022', '5e115000-0000-4000-8107-000000000001', '2026-03-05', 700),
      ('5e115000-0000-4000-8107-000000000023', '5e115000-0000-4000-8107-000000000001', '2026-04-10', 500);

    for e in select * from (values
      (1, 'proprietaire', '1. le catalogue : quatre colonnes, texte, entier, texte, numeric, nulles, sans valeur par défaut', $q$select string_agg(a.attname || ':'
  || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ',' order by a.attnum)
  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = 'public.cotisations_declarees'::regclass and a.attname in ('organisme', 'annee_payee', 'nature', 'part_regularisation') and not a.attisdropped$q$,
        'OK', 'organisme:text:false:-,annee_payee:integer:false:-,nature:text:false:-,part_regularisation:numeric:false:-'),
      (2, 'proprietaire', '1b. … leurs six contraintes, au texte près', $q$select md5(string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), ' ; ' order by c.conname))
  from pg_constraint c where c.conrelid = 'public.cotisations_declarees'::regclass and c.contype = 'c'$q$, 'OK', '572695a4a0d1b23a06046e04776d9751'),
      (3, 'proprietaire', '1c. … et le gel, les quatre champs hors de sa comparaison : son corps, au texte près', $q$select md5(replace(p.prosrc, chr(13), ''))
  from pg_proc p where p.oid = 'public.garder_cotisation_valide()'::regprocedure$q$, 'OK', '1b004781ac05f71798e2ebc43b5e71c3'),
      (4, 'chef', '2. une échéance écrite sans eux, comme hier, les lit nuls', $q$select coalesce(organisme, '-') || '|' || coalesce(annee_payee::text, '-') || '|' || coalesce(nature, '-')
  || '|' || coalesce(part_regularisation::text, '-') from cotisations_declarees where id = '5e115000-0000-4000-8107-000000000021'$q$, 'OK', '-|-|-|-'),
      (5, 'chef', '3. l''Urssaf, 2026, provisionnelle : s''écrit', $q$update cotisations_declarees set organisme = 'urssaf', annee_payee = 2026, nature = 'provisionnelle'
  where id = '5e115000-0000-4000-8107-000000000022' returning organisme || '|' || annee_payee || '|' || nature$q$, 'OK', 'urssaf|2026|provisionnelle'),
      (6, 'chef', '4. chacun des douze organismes s''écrit', $q$with i as (insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme)
  select '5e115000-0000-4000-8107-000000000001', '2026-04-05', 1, o from unnest(array['urssaf', 'carmf', 'carcdsf', 'carpimko', 'cavp', 'carpv',
  'cavec', 'cavom', 'cavamac', 'cipav', 'cprn', 'cnbf']) o returning 1) select count(*) from i$q$, 'OK', '12'),
      (7, 'chef', '4b. … une casse changée se refuse', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme)
  values ('5e115000-0000-4000-8107-000000000001', '2026-04-05', 1, 'URSSAF')$q$, '23514', '%cotisations_declarees_organisme_liste%'),
      (8, 'chef', '4c. … un organisme hors de la liste aussi', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme)
  values ('5e115000-0000-4000-8107-000000000001', '2026-04-05', 1, 'mutuelle')$q$, '23514', '%cotisations_declarees_organisme_liste%'),
      (9, 'chef', '4d. … et le vide', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme)
  values ('5e115000-0000-4000-8107-000000000001', '2026-04-05', 1, '')$q$, '23514', '%cotisations_declarees_organisme_liste%'),
      (10, 'chef', '5. chacune des trois natures s''écrit', $q$with i as (insert into cotisations_declarees (dossier_id, echeance, montant_appele, nature)
  select '5e115000-0000-4000-8107-000000000001', '2026-04-05', 1, n from unnest(array['provisionnelle', 'regularisation', 'acompte']) n
  returning 1) select count(*) from i$q$, 'OK', '3'),
      (11, 'chef', '5b. … une nature hors de la liste se refuse (« definitive »)', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, nature)
  values ('5e115000-0000-4000-8107-000000000001', '2026-04-05', 1, 'definitive')$q$, '23514', '%cotisations_declarees_nature_liste%'),
      (12, 'chef', '5c. … une casse changée aussi', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, nature)
  values ('5e115000-0000-4000-8107-000000000001', '2026-04-05', 1, 'Provisionnelle')$q$, '23514', '%cotisations_declarees_nature_liste%'),
      (13, 'chef', '6. l''année payée à ses deux bornes, 2021 et 2027, pour une échéance de 2026', $q$with i as (insert into cotisations_declarees (dossier_id, echeance, montant_appele, annee_payee)
  values ('5e115000-0000-4000-8107-000000000001', '2026-01-05', 1, 2021), ('5e115000-0000-4000-8107-000000000001', '2026-12-20', 1, 2027)
  returning 1) select count(*) from i$q$, 'OK', '2'),
      (14, 'chef', '6b. … six ans avant se refuse', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, annee_payee)
  values ('5e115000-0000-4000-8107-000000000001', '2026-01-05', 1, 2020)$q$, '23514', '%cotisations_declarees_annee_payee_bornes%'),
      (15, 'chef', '6c. … deux ans après aussi', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, annee_payee)
  values ('5e115000-0000-4000-8107-000000000001', '2026-12-20', 1, 2028)$q$, '23514', '%cotisations_declarees_annee_payee_bornes%'),
      (16, 'chef', '6d. … et une date changée qui la met hors de ses bornes', $q$update cotisations_declarees set echeance = '2032-03-05'
  where id = '5e115000-0000-4000-8107-000000000022'$q$, '23514', '%cotisations_declarees_annee_payee_bornes%'),
      (17, 'chef', '7. une régularisation de 2025, et une de 2026 (une cessation), appelées en 2026, s''écrivent', $q$with i as (insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme, annee_payee, nature)
  values ('5e115000-0000-4000-8107-000000000001', '2026-10-05', 162, 'urssaf', 2025, 'regularisation'),
  ('5e115000-0000-4000-8107-000000000001', '2026-06-05', 90, 'urssaf', 2026, 'regularisation') returning 1) select count(*) from i$q$, 'OK', '2'),
      (18, 'chef', '7b. … une régularisation d''une année à venir se refuse', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme, annee_payee, nature)
  values ('5e115000-0000-4000-8107-000000000001', '2026-12-20', 1, 'urssaf', 2027, 'regularisation')$q$, '23514', '%cotisations_declarees_regularisation_apres_son_annee%'),
      (19, 'chef', '7c. … une provisionnelle de l''année suivante s''écrit : la règle ne vise que la régularisation', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme, annee_payee, nature)
  values ('5e115000-0000-4000-8107-000000000001', '2026-12-20', 1, 'carmf', 2027, 'provisionnelle') returning nature$q$, 'OK', 'provisionnelle'),
      (20, 'chef', '8. un organisme seul s''écrit : rien n''exige les trois ensemble', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme)
  values ('5e115000-0000-4000-8107-000000000001', '2026-05-05', 300, 'carpimko') returning coalesce(annee_payee::text, '-') || '|' || coalesce(nature, '-')$q$, 'OK', '-|-'),
      (21, 'chef', '9. l''exercice 2025 se valide', $q$select valider_exercice('5e115000-0000-4000-8107-000000000001', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb) is not null$q$, 'OK', ''),
      (22, 'chef', '9b. son échéance se décrit encore : l''organisme', $q$update cotisations_declarees set organisme = 'urssaf'
  where id = '5e115000-0000-4000-8107-000000000021' returning organisme$q$, 'OK', 'urssaf'),
      (23, 'chef', '9c. … l''année payée', $q$update cotisations_declarees set annee_payee = 2025
  where id = '5e115000-0000-4000-8107-000000000021' returning annee_payee::text$q$, 'OK', '2025'),
      (24, 'chef', '9d. … la nature', $q$update cotisations_declarees set nature = 'provisionnelle'
  where id = '5e115000-0000-4000-8107-000000000021' returning nature$q$, 'OK', 'provisionnelle'),
      (25, 'chef', '9e. … et les trois avec sa date et ses montants réécrits à l''identique, comme « Modifier » les écrit (800.00 pour 800)', $q$update cotisations_declarees set echeance = '2025-03-05', montant_appele = 800.00, montant_verse = null,
  montant_csg_crds = null, previsionnel = false, organisme = 'urssaf', annee_payee = 2025, nature = 'acompte'
  where id = '5e115000-0000-4000-8107-000000000021' returning nature$q$, 'OK', 'acompte'),
      (26, 'chef', '9f. son montant ne change plus', $q$update cotisations_declarees set montant_appele = 801
  where id = '5e115000-0000-4000-8107-000000000021'$q$, '23514', 'L''exercice 2025 est validé : cette échéance ne change plus.'),
      (27, 'chef', '9g. … ni sa date, même dans son exercice', $q$update cotisations_declarees set echeance = '2025-03-06'
  where id = '5e115000-0000-4000-8107-000000000021'$q$, '23514', 'L''exercice 2025 est validé : cette échéance ne change plus.'),
      (28, 'chef', '9h. … ni sa CSG-CRDS, même avec sa description', $q$update cotisations_declarees set montant_csg_crds = 100, organisme = 'carmf'
  where id = '5e115000-0000-4000-8107-000000000021'$q$, '23514', 'L''exercice 2025 est validé : cette échéance ne change plus.'),
      (29, 'chef', '9i. … ni son marqueur', $q$update cotisations_declarees set previsionnel = true
  where id = '5e115000-0000-4000-8107-000000000021'$q$, '23514', 'L''exercice 2025 est validé : cette échéance ne change plus.'),
      (30, 'chef', '9j. … et une échéance décrite ne s''y ajoute plus', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme, annee_payee, nature)
  values ('5e115000-0000-4000-8107-000000000001', '2025-11-05', 1, 'urssaf', 2025, 'provisionnelle')$q$, '23514', 'L''exercice 2025 est validé : une échéance ne s''y ajoute plus.'),
      (31, 'chef', '9k. l''échéance de 2026 change encore', $q$update cotisations_declarees set nature = 'acompte'
  where id = '5e115000-0000-4000-8107-000000000022' returning nature$q$, 'OK', 'acompte'),
      (32, 'proprietaire', '9l. celle de 2025 a gardé sa description, ses montants et sa date', $q$select organisme || '|' || annee_payee || '|' || nature || '|' || montant_appele || '|' || echeance
  from cotisations_declarees where id = '5e115000-0000-4000-8107-000000000021'$q$, 'OK', 'urssaf|2025|acompte|800.00|2025-03-05'),
      (33, 'chef', '9m. sa part se pose encore : 200 de son acompte de 2025 régularisent 2024', $q$update cotisations_declarees set part_regularisation = 200
  where id = '5e115000-0000-4000-8107-000000000021' returning part_regularisation::text$q$, 'OK', '200'),
      (34, 'chef', '9n. … se change en un trop-versé imputé', $q$update cotisations_declarees set part_regularisation = -120.5
  where id = '5e115000-0000-4000-8107-000000000021' returning part_regularisation::text$q$, 'OK', '-120.5'),
      (35, 'chef', '9o. … son montant reste refusé, même avec sa part', $q$update cotisations_declarees set montant_appele = 900, part_regularisation = 100
  where id = '5e115000-0000-4000-8107-000000000021'$q$, '23514', 'L''exercice 2025 est validé : cette échéance ne change plus.'),
      (36, 'chef', '9p. … et sa contrainte mord sur l''échéance figée : une part plus forte que l''appel', $q$update cotisations_declarees set part_regularisation = 800.01
  where id = '5e115000-0000-4000-8107-000000000021'$q$, '23514', '%cotisations_declarees_part_regularisation_bornee%'),
      (37, 'chef', '9q. … et se retire', $q$update cotisations_declarees set part_regularisation = null
  where id = '5e115000-0000-4000-8107-000000000021' returning coalesce(part_regularisation::text, '-') || '|' || montant_appele$q$, 'OK', '-|800.00'),
      (40, 'chef', '12. un prélèvement mixte de janvier : 550 appelés, provisionnelle 2026, dont 150 de régularisation de 2025', $q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele, organisme, annee_payee, nature, part_regularisation)
  values ('5e115000-0000-4000-8107-000000000024', '5e115000-0000-4000-8107-000000000001', '2026-01-05', 550, 'urssaf', 2026, 'provisionnelle', 150)
  returning part_regularisation::text$q$, 'OK', '150'),
      (41, 'chef', '12b. un trop-versé de 2025 imputé : 250 appelés, provisionnelle 2026, part négative', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme, annee_payee, nature, part_regularisation)
  values ('5e115000-0000-4000-8107-000000000001', '2026-10-05', 250, 'urssaf', 2026, 'provisionnelle', -150) returning part_regularisation::text$q$, 'OK', '-150'),
      (42, 'chef', '12c. un acompte, et une part égale à l''appel (au plus), s''écrivent', $q$with i as (insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme, annee_payee, nature, part_regularisation)
  values ('5e115000-0000-4000-8107-000000000001', '2026-06-15', 500, 'urssaf', 2026, 'acompte', 50),
  ('5e115000-0000-4000-8107-000000000001', '2026-11-05', 300, 'urssaf', 2026, 'provisionnelle', 300) returning 1) select count(*) from i$q$, 'OK', '2'),
      (43, 'chef', '12d. une part qui dépasse l''appel d''un centime se refuse', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme, annee_payee, nature, part_regularisation)
  values ('5e115000-0000-4000-8107-000000000001', '2026-01-05', 550, 'urssaf', 2026, 'provisionnelle', 550.01)$q$, '23514', '%cotisations_declarees_part_regularisation_bornee%'),
      (44, 'chef', '12e. … un crédit plus fort que l''appel aussi (il se dit par le versé)', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme, annee_payee, nature, part_regularisation)
  values ('5e115000-0000-4000-8107-000000000001', '2026-10-05', 250, 'urssaf', 2026, 'provisionnelle', -300)$q$, '23514', '%cotisations_declarees_part_regularisation_bornee%'),
      (45, 'chef', '12f. … et zéro, qui ne se dit pas', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme, annee_payee, nature, part_regularisation)
  values ('5e115000-0000-4000-8107-000000000001', '2026-10-05', 250, 'urssaf', 2026, 'provisionnelle', 0)$q$, '23514', '%cotisations_declarees_part_regularisation_bornee%'),
      (46, 'chef', '12g. … un montant changé qui la met hors de sa borne se refuse', $q$update cotisations_declarees set montant_appele = 100
  where id = '5e115000-0000-4000-8107-000000000024'$q$, '23514', '%cotisations_declarees_part_regularisation_bornee%'),
      (47, 'chef', '12h. sur une régularisation, la part se refuse', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme, annee_payee, nature, part_regularisation)
  values ('5e115000-0000-4000-8107-000000000001', '2026-10-05', 250, 'urssaf', 2025, 'regularisation', 10)$q$, '23514', '%cotisations_declarees_part_regularisation_nature%'),
      (48, 'chef', '12i. … sans nature aussi', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme, annee_payee, part_regularisation)
  values ('5e115000-0000-4000-8107-000000000001', '2026-10-05', 250, 'urssaf', 2026, 10)$q$, '23514', '%cotisations_declarees_part_regularisation_nature%'),
      (49, 'chef', '12j. … et sans année payée', $q$insert into cotisations_declarees (dossier_id, echeance, montant_appele, organisme, nature, part_regularisation)
  values ('5e115000-0000-4000-8107-000000000001', '2026-10-05', 250, 'urssaf', 'provisionnelle', 10)$q$, '23514', '%cotisations_declarees_part_regularisation_nature%'),
      (50, 'chef', '12k. … et une nature changée en régularisation sous une part posée', $q$update cotisations_declarees set nature = 'regularisation', annee_payee = 2025
  where id = '5e115000-0000-4000-8107-000000000024'$q$, '23514', '%cotisations_declarees_part_regularisation_nature%'),
      (51, 'proprietaire', '12l. le prélèvement mixte est resté tel qu''écrit', $q$select montant_appele || '|' || nature || '|' || annee_payee || '|' || part_regularisation
  from cotisations_declarees where id = '5e115000-0000-4000-8107-000000000024'$q$, 'OK', '550|provisionnelle|2026|150'),
      (63, 'proprietaire', '10. E3 payée depuis le compte personnel : le réglage de la fonction, posé comme elle le pose', $q$select set_config('jd.paiement_personnel', '5e115000-0000-4000-8107-000000000023', true)$q$, 'OK', '5e115000-0000-4000-8107-000000000023'),
      (64, 'proprietaire', '10b. … et la date de ce paiement', $q$update cotisations_declarees set paiement_personnel_le = '2026-04-10'
  where id = '5e115000-0000-4000-8107-000000000023' returning paiement_personnel_le::text$q$, 'OK', '2026-04-10'),
      (65, 'proprietaire', '10c. … le réglage retiré', $q$select set_config('jd.paiement_personnel', '', true)$q$, 'OK', ''),
      (66, 'chef', '10d. sa description change', $q$update cotisations_declarees set organisme = 'urssaf', annee_payee = 2026, nature = 'provisionnelle'
  where id = '5e115000-0000-4000-8107-000000000023' returning organisme || '|' || annee_payee || '|' || nature$q$, 'OK', 'urssaf|2026|provisionnelle'),
      (67, 'chef', '10e. … ses montants non', $q$update cotisations_declarees set montant_appele = 501, nature = 'acompte'
  where id = '5e115000-0000-4000-8107-000000000023'$q$, '23514', 'Cette échéance est payée depuis le compte personnel, le 10/04/2026 : ni ses montants ni son dossier ne changent tant que ce paiement n''est pas retiré.'),
      (68, 'client', '11. le client d''essai, qui n''a pas ce dossier, n''écrit rien', $q$with u as (update cotisations_declarees set organisme = 'cipav'
  where id = '5e115000-0000-4000-8107-000000000022' returning 1) select count(*) from u$q$, 'OK', '0'),
      (69, 'chef', '11b. … et l''échéance est restée telle que le chef l''a laissée', $q$select organisme || '|' || annee_payee || '|' || nature
  from cotisations_declarees where id = '5e115000-0000-4000-8107-000000000022'$q$, 'OK', 'urssaf|2026|acompte')
    ) as t(rang, profil, etape, requete, code, attendu) order by rang loop
      v_obs := null;
      v_code := 'OK';
      v_msg := '';
      begin
        if e.profil <> 'proprietaire' then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims',
            json_build_object('sub', case e.profil when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
        end if;
        execute e.requete into v_obs;
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
  perform set_config('essai.regularisation', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.regularisation')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
