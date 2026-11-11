-- LES ACHATS DU CLIENT (espace client, ligne 51.5, étape B4 ; la migration `achats_du_client`, PRÉPARÉE :
-- supabase/preparees/20261111237000_achats_du_client.sql). Le récit : HISTORIQUE.md, « 11/11/2026 — B4 : LES ACHATS DU
-- CLIENT, EN BASE (LIGNE 51.5) (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer après toute migration qui touche ses tables, ses
-- fonctions, `client_du_dossier`, `memberships` ou `pieces` (ses colonnes, ses gardes, ses policies). Ce qu'une SUPPRESSION
-- rencontre — une pièce que le cabinet supprime emporte ses déclarations et ses vues — ne se joue pas ici (l'outil
-- d'exécution de la production retient une suppression) : il s'est joué à la main sur une réplique, le 11/11/2026.
--
-- Ce qui se prouve ici, et ne se relit pas : l'échéance d'une facture d'achat se fixe par sa fonction seule, signée, à la
-- version lue, par le cabinet ou l'accès « Achats », jamais devinée à l'insertion, et celle lue sur la facture électronique
-- ne se corrige que par le cabinet ; l'accès « Achats » déclare un paiement, une proposition qui se retire une fois, par son
-- auteur ou le cabinet ; chaque refus sous ses mots, dans son ordre ; l'accès « Achats » lit les déclarations de son
-- dossier et ses propres vues, un accès sans la case n'en lit rien ; la première vue seule, une par compte ; personne
-- n'écrit ni ne réécrit les tables en direct, pas même le rôle des Edge Functions ; le catalogue. Et neuf MUTATIONS, qui
-- doivent mordre : chacune affaiblit un contrôle le temps d'une sous-transaction et rejoue l'étape qui le garde.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `b4000000-0000-4000-8000`) : DA, où l'accès du client d'essai
-- porte « Achats », et DS, où il ne la porte pas. Chaque étape se joue dans sa sous-transaction et s'y ANNULE
-- (`ANNULATION_ETAPE`) : ce que le chef pose d'abord (super-administrateur, sous sa session), ce que le client pose ensuite,
-- puis la requête du profil ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les
-- verdicts voyagent dans un réglage LOCAL à la transaction (`essai.achats_client`) : le fichier se joue d'un seul appel, ne
-- crée ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de
-- ses dossiers. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la migration, une ligne dit
-- qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  da constant text := 'b4000000-0000-4000-8000-0000000000d1';
  ds constant text := 'b4000000-0000-4000-8000-0000000000d2';
  acces_a constant text := 'b4000000-0000-4000-8000-0000000000a1';
  acces_s constant text := 'b4000000-0000-4000-8000-0000000000a2';
  inconnu constant text := 'b4000000-0000-4000-8000-0000000000f1';
  pa constant text := 'b4000000-0000-4000-8000-0000000000e1';
  pv constant text := 'b4000000-0000-4000-8000-0000000000e2';
  ps constant text := 'b4000000-0000-4000-8000-0000000000e3';
  pp constant text := 'b4000000-0000-4000-8000-0000000000e4';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  e record; k record; v_code text; v_msg text; v_req text; v_pose text; v_pose_client text; v_obs text; v_ok boolean; v_ddl text; v_avant text;
  -- Les gabarits d'une pose : une facture d'achat déposée de DA, une vente de DA, un achat de DS, une facture d'achat reçue
  -- par la plateforme avec son échéance (BT-9), une déclaration du client sur l'achat de DA.
  gabarits constant jsonb := jsonb_build_object(
    '{ACH}', $q$insert into pieces (id, dossier_id, uploaded_by, storage_path, nom_fichier, type_piece) values ('{PA}', '{DA}', '{CHEF}', '{DA}/essai-b4-achat.pdf', 'achat.pdf', 'achat')$q$,
    '{VEN}', $q$insert into pieces (id, dossier_id, uploaded_by, storage_path, nom_fichier, type_piece) values ('{PV}', '{DA}', '{CHEF}', '{DA}/essai-b4-vente.pdf', 'vente.pdf', 'vente')$q$,
    '{ACHS}', $q$insert into pieces (id, dossier_id, uploaded_by, storage_path, nom_fichier, type_piece) values ('{PS}', '{DS}', '{CHEF}', '{DS}/essai-b4-achat.pdf', 'achat.pdf', 'achat')$q$,
    '{PLAT}', $q$insert into pieces (id, dossier_id, uploaded_by, source, flux_hote, flux_id, storage_path, nom_fichier, type_piece, date_echeance) values ('{PP}', '{DA}', '{CHEF}', 'plateforme', 'plateforme.example.test', 'flux-essai-b4', '{DA}/essai-b4-recue.xml', 'recue.xml', 'achat', '2026-12-31')$q$,
    '{DECL}', $q$select 1 from declarer_paiement_piece('{PA}', '2026-11-01', 'virement', 120.50)$q$);
  valeurs constant jsonb := jsonb_build_object(
    '{DA}', da, '{DS}', ds, '{PA}', pa, '{PV}', pv, '{PS}', ps, '{PP}', pp, '{CHEF}', chef, '{CLIENT}', client, '{INCONNU}', inconnu);
  verdicts jsonb := '[]'::jsonb;
  mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.paiements_declares') is null then
    perform set_config('essai.achats_client', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration achats_du_client', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    -- Le jeu : deux dossiers jetables et un accès du client d'essai à chacun, inséré par le propriétaire comme
    -- `create-client-access` l'insère — « Achats » posée à l'insertion sur DA (une insertion du cabinet pose les cases).
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva) values
      (da::uuid, 'ESSAI ACHATS DA', cabinet, 'tresorerie', '455000', 'exonere'),
      (ds::uuid, 'ESSAI ACHATS DS', cabinet, 'tresorerie', '455000', 'exonere');
    insert into memberships (id, user_id, dossier_id, role, email, droit_achats) values
      (acces_a::uuid, client::uuid, da::uuid, 'client', 'essai-achats-a@example.test', true),
      (acces_s::uuid, client::uuid, ds::uuid, 'client', 'essai-achats-s@example.test', false);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord, ce que le CLIENT pose ensuite, le profil — `chef`
    -- (super-administrateur), `chef_simple` (le compte client rattaché au cabinet, le temps de l'étape), `client`, `inconnu`
    -- (un compte connecté sans aucun accès), `service` (le rôle des Edge Functions) ou `anon` —, sa requête, le code attendu
    -- (`OK` : acceptée) et ce qu'elle rend, ou les mots du refus}. Une mutation rejoue une étape après son instruction.
    for e in
      with etapes (rang, etape, pose, pose_client, profil, requete, code, attendu) as (values
        (1, '1. le client « Achats » fixe l''échéance d''un achat déposé : rendue, signée de lui', '{ACH}', $q$select fixer_echeance_piece('{PA}', '2026-12-15', null)$q$, 'client',
          $q$select p.date_echeance || ' ' || (p.echeance_fixee_par::text = '{CLIENT}') || ' ' || (p.echeance_fixee_le is not null) from pieces p where p.id = '{PA}'$q$, 'OK', '2026-12-15 true true'),
        (2, '2. le client sans la case ne fixe pas l''échéance d''un achat de DS (42501)', '{ACHS}', null, 'client',
          $q$select fixer_echeance_piece('{PS}', '2026-12-15', null)::text$q$, '42501', 'Accès refusé à cette pièce.'),
        (3, '3. un compte connecté sans accès : les mêmes mots', '{ACH}', null, 'inconnu',
          $q$select fixer_echeance_piece('{PA}', '2026-12-15', null)::text$q$, '42501', 'Accès refusé à cette pièce.'),
        (4, '4. une pièce inconnue : les mêmes mots', null, null, 'client',
          $q$select fixer_echeance_piece('{INCONNU}', '2026-12-15', null)::text$q$, '42501', 'Accès refusé à cette pièce.'),
        (5, '5. une vente n''a pas d''échéance d''achat (22023)', '{VEN}', null, 'client',
          $q$select fixer_echeance_piece('{PV}', '2026-12-15', null)::text$q$, '22023', 'Une échéance ne se fixe que sur une facture d''achat.'),
        (6, '6. une échéance hors des bornes (22023)', '{ACH}', null, 'client',
          $q$select fixer_echeance_piece('{PA}', '1999-12-31', null)::text$q$, '22023', 'Une échéance se date entre le 1er janvier 2000 et le 31 décembre 2100.'),
        (7, '7. l''échéance a changé depuis la lecture du client (22023)', '{ACH}', $q$select fixer_echeance_piece('{PA}', '2026-12-15', null)$q$, 'client',
          $q$select fixer_echeance_piece('{PA}', '2027-01-15', null)::text$q$, '22023', 'L''échéance de cette pièce a changé depuis sa lecture : la relire avant de la fixer.'),
        (8, '8. à la version lue, elle change', '{ACH}', $q$select fixer_echeance_piece('{PA}', '2026-12-15', null)$q$, 'client',
          $q$select fixer_echeance_piece('{PA}', '2027-01-15', '2026-12-15')::text$q$, 'OK', '2027-01-15'),
        (9, '9. elle s''efface, à nul, signée', '{ACH}', $q$select fixer_echeance_piece('{PA}', '2026-12-15', null); select fixer_echeance_piece('{PA}', null, '2026-12-15')$q$, 'client',
          $q$select coalesce(p.date_echeance::text, 'nulle') || ' ' || (p.echeance_fixee_par is not null) from pieces p where p.id = '{PA}'$q$, 'OK', 'nulle true'),
        (10, '10. lue sur la facture électronique, le client ne la corrige pas (22023)', '{PLAT}', null, 'client',
          $q$select fixer_echeance_piece('{PP}', '2027-01-31', '2026-12-31')::text$q$, '22023', 'Cette échéance est lue sur la facture électronique : seul le cabinet la corrige.'),
        (11, '11. le cabinet la corrige', '{PLAT}', null, 'chef_simple',
          $q$select fixer_echeance_piece('{PP}', '2027-01-31', '2026-12-31')::text$q$, 'OK', '2027-01-31'),
        (12, '12. le cabinet ne change pas l''échéance en direct (la garde)', '{ACH}', null, 'chef_simple',
          $q$update pieces set date_echeance = '2026-12-01' where id = '{PA}' returning 1$q$, '42501', 'L''échéance d''une pièce et son auteur ne s''écrivent que par fixer_echeance_piece.'),
        (13, '13. le rôle des Edge Functions non plus (la garde)', '{ACH}', null, 'service',
          $q$update pieces set echeance_fixee_par = '{CHEF}', echeance_fixee_le = now() where id = '{PA}' returning 1$q$, '42501', 'L''échéance d''une pièce et son auteur ne s''écrivent que par fixer_echeance_piece.'),
        (14, '14. le dépôt d''une pièce n''apporte pas d''échéance : jamais devinée (23514)', null, null, 'client',
          $q$insert into pieces (dossier_id, uploaded_by, storage_path, nom_fichier, date_echeance) values ('{DA}', '{CLIENT}', '{DA}/essai-b4-depot.pdf', 'depot.pdf', '2026-12-31') returning 1$q$, '23514', 'Une échéance se lit sur la facture électronique reçue, ou se fixe après le dépôt : jamais devinée.'),
        (15, '15. ni un auteur d''échéance (42501)', null, null, 'chef_simple',
          $q$insert into pieces (dossier_id, uploaded_by, storage_path, nom_fichier, echeance_fixee_par, echeance_fixee_le) values ('{DA}', '{CLIENT}', '{DA}/essai-b4-depot.pdf', 'depot.pdf', '{CLIENT}', now()) returning 1$q$, '42501', 'L''échéance d''une pièce et son auteur ne s''écrivent que par fixer_echeance_piece.'),
        (16, '16. la facture reçue par la plateforme apporte son échéance (BT-9), à l''import du cabinet', null, null, 'chef_simple',
          $q$insert into pieces (dossier_id, uploaded_by, source, flux_hote, flux_id, storage_path, nom_fichier, type_piece, date_echeance) values ('{DA}', '{CLIENT}', 'plateforme', 'plateforme.example.test', 'flux-essai-b4-bis', '{DA}/essai-b4-recue-bis.xml', 'recue.xml', 'achat', '2026-12-31') returning date_echeance::text$q$, 'OK', '2026-12-31'),
        (17, '17. la restauration réinsère une échéance fixée, avec son auteur', null, null, 'chef',
          $q$insert into pieces (dossier_id, uploaded_by, storage_path, nom_fichier, date_echeance, echeance_fixee_par, echeance_fixee_le) values ('{DA}', '{CLIENT}', '{DA}/essai-b4-restauree.pdf', 'restauree.pdf', '2026-12-31', '{CLIENT}', now()) returning date_echeance::text$q$, 'OK', '2026-12-31'),
        (20, '20. le client « Achats » déclare un paiement : une proposition, à lui', '{ACH}', null, 'client',
          $q$select p.moyen || ' ' || p.montant || ' ' || p.date_paiement || ' ' || (p.declare_par::text = '{CLIENT}') || ' ' || (p.retire_le is null) from declarer_paiement_piece('{PA}', '2026-11-01', 'virement', 120.50) p$q$, 'OK', 'virement 120.50 2026-11-01 true true'),
        (21, '21. sans la case, il ne déclare pas (42501)', '{ACHS}', null, 'client',
          $q$select 1 from declarer_paiement_piece('{PS}', '2026-11-01', 'virement', 120.50)$q$, '42501', 'Accès refusé à cette pièce.'),
        (22, '22. le cabinet ne déclare pas : il rapproche le relevé (42501)', '{ACH}', null, 'chef',
          $q$select 1 from declarer_paiement_piece('{PA}', '2026-11-01', 'virement', 120.50)$q$, '42501', 'Accès refusé à cette pièce.'),
        (23, '23. pas sur une vente (22023)', '{VEN}', null, 'client',
          $q$select 1 from declarer_paiement_piece('{PV}', '2026-11-01', 'virement', 120.50)$q$, '22023', 'Un paiement ne se déclare que sur une facture d''achat.'),
        (24, '24. une date à venir (22023)', '{ACH}', null, 'client',
          $q$select 1 from declarer_paiement_piece('{PA}', '2100-01-01', 'virement', 120.50)$q$, '22023', 'La date du paiement est requise, entre le 1er janvier 2000 et aujourd''hui.'),
        (25, '25. sans date (22023)', '{ACH}', null, 'client',
          $q$select 1 from declarer_paiement_piece('{PA}', null, 'virement', 120.50)$q$, '22023', 'La date du paiement est requise, entre le 1er janvier 2000 et aujourd''hui.'),
        (26, '26. un moyen hors de la liste (22023)', '{ACH}', null, 'client',
          $q$select 1 from declarer_paiement_piece('{PA}', '2026-11-01', 'bon d''achat', 120.50)$q$, '22023', 'Le moyen de paiement est virement, prélèvement, carte, chèque, espèces ou autre.'),
        (27, '27. un montant nul (22023)', '{ACH}', null, 'client',
          $q$select 1 from declarer_paiement_piece('{PA}', '2026-11-01', 'carte', 0)$q$, '22023', 'Le montant payé est un nombre positif, au centime près.'),
        (28, '28. un montant plus fin que le centime : refusé, jamais arrondi (22023)', '{ACH}', null, 'client',
          $q$select 1 from declarer_paiement_piece('{PA}', '2026-11-01', 'carte', 10.005)$q$, '22023', 'Le montant payé est un nombre positif, au centime près.'),
        (29, '29. le client « Achats » et le cabinet lisent la déclaration', '{ACH}', '{DECL}', 'chef_simple',
          $q$select count(*)::text from paiements_declares where dossier_id = '{DA}'$q$, 'OK', '1'),
        (30, '30. sans la case, une déclaration de DS lui reste cachée', '{ACHS}; insert into paiements_declares (dossier_id, piece_id, date_paiement, moyen, montant, declare_par) values (''{DS}'', ''{PS}'', ''2026-11-01'', ''carte'', 10, ''{INCONNU}'')', null, 'client',
          $q$select count(*)::text from paiements_declares where dossier_id = '{DS}'$q$, 'OK', '0'),
        (31, '31. son auteur la retire : la ligne reste, retirée par lui', '{ACH}', '{DECL}', 'client',
          $q$select (r.retire_par::text = '{CLIENT}') || ' ' || (r.retire_le is not null) || ' ' || (select count(*) from paiements_declares where dossier_id = '{DA}') from retirer_paiement_declare((select d.id from paiements_declares d where d.piece_id = '{PA}')) r$q$, 'OK', 'true true 1'),
        (32, '32. déjà retirée (22023)', '{ACH}', '{DECL}; select 1 from retirer_paiement_declare((select d.id from paiements_declares d where d.piece_id = ''{PA}''))', 'client',
          $q$select 1 from retirer_paiement_declare((select d.id from paiements_declares d where d.piece_id = '{PA}'))$q$, '22023', 'Cette déclaration est déjà retirée.'),
        (33, '33. le cabinet la retire', '{ACH}', '{DECL}', 'chef',
          $q$select (r.retire_par::text = '{CHEF}')::text from retirer_paiement_declare((select d.id from paiements_declares d where d.piece_id = '{PA}')) r$q$, 'OK', 'true'),
        (34, '34. un accès « Achats » ne retire pas la déclaration d''un autre compte (42501)', '{ACH}; insert into paiements_declares (dossier_id, piece_id, date_paiement, moyen, montant, declare_par) values (''{DA}'', ''{PA}'', ''2026-11-01'', ''carte'', 10, ''{INCONNU}'')', null, 'client',
          $q$select 1 from retirer_paiement_declare((select d.id from paiements_declares d where d.piece_id = '{PA}'))$q$, '42501', 'Accès refusé à cette déclaration.'),
        (35, '35. un compte sans accès : les mêmes mots', '{ACH}', '{DECL}', 'inconnu',
          $q$select 1 from retirer_paiement_declare((select d.id from paiements_declares d where d.piece_id = '{PA}'))$q$, '42501', 'Accès refusé à cette déclaration.'),
        (36, '36. le client n''écrit pas une déclaration en direct (la garde)', '{ACH}', null, 'client',
          $q$insert into paiements_declares (dossier_id, piece_id, date_paiement, moyen, montant, declare_par) values ('{DA}', '{PA}', '2026-11-01', 'carte', 10, '{CLIENT}') returning 1$q$, '42501', 'Un paiement déclaré ne s''écrit que par sa déclaration.'),
        (37, '37. le rôle des Edge Functions ne réécrit pas une déclaration (la garde)', '{ACH}', '{DECL}', 'service',
          $q$update paiements_declares set montant = 1 where piece_id = '{PA}' returning 1$q$, '23514', 'Un paiement déclaré ne se réécrit pas : il se retire, une fois.'),
        (38, '38. la restauration ne cite pas une vente (la garde)', '{VEN}', null, 'chef',
          $q$insert into paiements_declares (dossier_id, piece_id, date_paiement, moyen, montant, declare_par) values ('{DA}', '{PV}', '2026-11-01', 'carte', 10, '{CLIENT}') returning 1$q$, '23514', 'Un paiement déclaré cite une facture d''achat de son dossier.'),
        (40, '40. le client « Achats » marque une pièce vue, deux fois dans l''appel : une vue', '{ACH}', null, 'client',
          $q$select marquer_vues('{DA}', array['{PA}', '{PA}']::uuid[])::text$q$, 'OK', '1'),
        (41, '41. une pièce déjà vue ne se remarque pas : la première vue reste', '{ACH}', $q$select marquer_vues('{DA}', array['{PA}']::uuid[])$q$, 'client',
          $q$select marquer_vues('{DA}', array['{PA}']::uuid[]) || ' ' || (select count(*) from pieces_vues v where v.piece_id = '{PA}')$q$, 'OK', '0 1'),
        (42, '42. sans la case (42501)', '{ACHS}', null, 'client',
          $q$select marquer_vues('{DS}', array['{PS}']::uuid[])::text$q$, '42501', 'Accès refusé à ce dossier.'),
        (43, '43. une vente dans la liste (22023)', '{ACH}; {VEN}', null, 'client',
          $q$select marquer_vues('{DA}', array['{PA}', '{PV}']::uuid[])::text$q$, '22023', 'Une pièce de la liste n''est pas une facture d''achat de ce dossier.'),
        (44, '44. un achat d''un autre dossier (22023)', '{ACH}; {ACHS}', null, 'client',
          $q$select marquer_vues('{DA}', array['{PS}']::uuid[])::text$q$, '22023', 'Une pièce de la liste n''est pas une facture d''achat de ce dossier.'),
        (45, '45. le cabinet ne marque pas : la vue est celle d''un accès « Achats » (42501)', '{ACH}', null, 'chef',
          $q$select marquer_vues('{DA}', array['{PA}']::uuid[])::text$q$, '42501', 'Accès refusé à ce dossier.'),
        (46, '46. le client ne lit que ses vues : celle d''un autre compte, réinsérée par la restauration, lui reste cachée', '{ACH}; insert into pieces_vues (dossier_id, piece_id, utilisateur) values (''{DA}'', ''{PA}'', ''{INCONNU}'')', null, 'client',
          $q$select count(*)::text from pieces_vues v where v.piece_id = '{PA}'$q$, 'OK', '0'),
        (47, '47. le cabinet lit les vues du dossier', '{ACH}', $q$select marquer_vues('{DA}', array['{PA}']::uuid[])$q$, 'chef_simple',
          $q$select count(*)::text from pieces_vues v where v.dossier_id = '{DA}'$q$, 'OK', '1'),
        (48, '48. le client n''écrit pas une vue en direct (la garde)', '{ACH}', null, 'client',
          $q$insert into pieces_vues (dossier_id, piece_id, utilisateur) values ('{DA}', '{PA}', '{CLIENT}') returning 1$q$, '42501', 'Une pièce vue ne s''écrit que par marquer_vues.'),
        (49, '49. le rôle des Edge Functions ne réécrit pas une vue (la garde)', '{ACH}', $q$select marquer_vues('{DA}', array['{PA}']::uuid[])$q$, 'service',
          $q$update pieces_vues set vue_le = now() where piece_id = '{PA}' returning 1$q$, '23514', 'Une pièce vue ne se réécrit pas.'),
        (50, '50. au plus cinq cents pièces par appel (22023)', '{ACH}', null, 'client',
          $q$select marquer_vues('{DA}', array_fill('{PA}'::uuid, array[501]))::text$q$, '22023', 'Au plus cinq cents pièces se marquent vues en un appel.'),
        (51, '51. le super-administrateur ne réécrit rien : aucune policy de mise à jour, aucune ligne touchée', '{ACH}', '{DECL}', 'chef',
          $q$with t as (update paiements_declares set montant = 1 where dossier_id = '{DA}' returning 1) select (select count(*) from t)::text$q$, 'OK', '0'),
        (52, '52. l''anonyme ne lit rien et n''exécute aucune fonction', '{ACH}', '{DECL}', 'anon',
          $q$select (select count(*) from paiements_declares) + (select count(*) from pieces_vues) || ' ' || has_function_privilege('anon', 'public.declarer_paiement_piece(uuid, date, text, numeric)', 'execute') || ' ' || has_function_privilege('anon', 'public.fixer_echeance_piece(uuid, date, date)', 'execute') || ' ' || has_function_privilege('anon', 'public.marquer_vues(uuid, uuid[])', 'execute')$q$, 'OK', '0 false false false'),
        (53, '53. un compte connecté sans accès ne lit rien', '{ACH}', '{DECL}; select marquer_vues(''{DA}'', array[''{PA}'']::uuid[])', 'inconnu',
          $q$select ((select count(*) from paiements_declares) + (select count(*) from pieces_vues))::text$q$, 'OK', '0')
      ),
      mutations (m, libelle, ddl, rang) as (values
        ('M1', 'M1 — la lecture des déclarations passée à « membre »', $m$alter policy paiements_declares_lecture_achats on public.paiements_declares using (client_du_dossier(dossier_id, 'membre'))$m$, 30),
        ('M2', 'M2 — la déclaration sans la case « Achats »', $m$FONCTION:declarer_paiement_piece(uuid,date,text,numeric):not public.client_du_dossier(v_piece.dossier_id, 'achats'):not public.client_du_dossier(v_piece.dossier_id, 'membre')$m$, 21),
        ('M3', 'M3 — l''échéance lue sur la facture corrigée par le client', $m$FONCTION:fixer_echeance_piece(uuid,date,date):and v_piece.source in ('plateforme', 'superpdp') then:and false then$m$, 10),
        ('M4', 'M4 — la garde de l''échéance laisse tout écrire', $m$FONCTION:garder_echeance_piece():if coalesce(current_setting('jd.echeance_piece', true), '') <> old:if false and coalesce(current_setting('jd.echeance_piece', true), '') <> old$m$, 12),
        ('M5', 'M5 — une vente marquée vue', $m$FONCTION:marquer_vues(uuid,uuid[]): and p.type_piece = 'achat'):)$m$, 43),
        ('M6', 'M6 — la lecture des vues sans le compte', $m$alter policy pieces_vues_lecture_du_compte on public.pieces_vues using (client_du_dossier(dossier_id, 'achats'))$m$, 46),
        ('M7', 'M7 — le retrait sans l''auteur', $m$FONCTION:retirer_paiement_declare(uuid): and v_paiement.declare_par = auth.uid()):)$m$, 34),
        ('M8', 'M8 — l''échéance fixée sans la version lue', $m$FONCTION:fixer_echeance_piece(uuid,date,date):if v_piece.date_echeance is distinct from p_echeance_lue then:if false then$m$, 7),
        ('M9', 'M9 — l''échéance devinée au dépôt', $m$FONCTION:garder_echeance_piece():and new.source not in ('plateforme', 'superpdp') then:and false then$m$, 14)
      )
      select null::text as m, null::text as libelle, null::text as ddl, t.* from etapes t
      union all
      select mu.m, mu.libelle, mu.ddl, t.* from mutations mu join etapes t on t.rang = mu.rang
      order by 1 nulls first, rang
    loop
      v_code := 'OK'; v_msg := null; v_obs := null;
      begin
        -- Une mutation : l'instruction, ou le remplacement d'un fragment dans le corps d'une fonction (`FONCTION:signature:
        -- fragment:remplacement`) ; un fragment introuvable ne s'applique pas, et la mutation le dit au lieu de mordre.
        if e.ddl is not null then
          if left(e.ddl, 9) = 'FONCTION:' then
            v_avant := pg_get_functiondef(('public.' || split_part(e.ddl, ':', 2))::regprocedure);
            v_ddl := replace(v_avant, split_part(e.ddl, ':', 3), split_part(e.ddl, ':', 4));
            if v_ddl = v_avant then
              raise exception 'MUTATION_SANS_EFFET';
            end if;
            execute v_ddl;
          else
            execute e.ddl;
          end if;
        end if;
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        end if;
        -- Les gabarits d'abord (une pièce, une déclaration), puis les valeurs : aucun gabarit n'en porte un autre.
        v_pose := e.pose; v_pose_client := e.pose_client; v_req := e.requete;
        for k in select g.key, g.value from jsonb_each_text(gabarits) g loop
          v_pose := replace(v_pose, k.key, k.value); v_pose_client := replace(v_pose_client, k.key, k.value); v_req := replace(v_req, k.key, k.value);
        end loop;
        for k in select g.key, g.value from jsonb_each_text(valeurs) g loop
          v_pose := replace(v_pose, k.key, k.value); v_pose_client := replace(v_pose_client, k.key, k.value); v_req := replace(v_req, k.key, k.value);
        end loop;
        if v_pose is not null then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        if v_pose_client is not null then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
          execute v_pose_client;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
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
      v_ok := v_code = e.code and v_msg = e.attendu;
      if e.m is null then
        verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape, 'ok', v_ok, 'observe', v_code || ' ' || coalesce(v_msg, '-'));
      else
        mutations := mutations || jsonb_build_object('rang', 100 + substr(e.m, 2)::int, 'etape', e.libelle || ' (l''étape ' || e.rang || ')',
          'ok', not v_ok and v_code <> 'ESSAI', 'observe', case when v_ok then '*** NE MORD PAS *** ' else 'le contrôle mord : ' end || v_code || ' ' || coalesce(v_msg, '-'));
      end if;
    end loop;

    -- Le catalogue : la RLS des deux tables, trois policies chacune à authenticated (hors la restrictive `deux_facteurs`),
    -- de lecture ou de restauration ; les lectures du client sous « Achats » ; les fonctions et les gardes ; le déclencheur
    -- de l'échéance sur `pieces`.
    verdicts := verdicts || jsonb_build_object('rang', 90, 'etape', '90. le catalogue : la RLS des deux tables, six policies à authenticated, aucune de mise à jour ni de suppression',
      'ok', (select count(*) from pg_class c where c.oid in ('public.paiements_declares'::regclass, 'public.pieces_vues'::regclass) and c.relrowsecurity) = 2
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename in ('paiements_declares', 'pieces_vues')
               and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 6
        and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename in ('paiements_declares', 'pieces_vues')
               and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')
               and (p.roles <> array['authenticated']::name[] or p.cmd not in ('SELECT', 'INSERT')
                    or (p.cmd = 'INSERT' and p.with_check <> 'is_super_admin()'))) = 0,
      'observe', 'relu au catalogue');
    verdicts := verdicts || jsonb_build_object('rang', 91, 'etape', '91. les lectures du client, sous « Achats » : les déclarations du dossier, ses propres vues',
      'ok', (select count(*) from pg_policies p where p.schemaname = 'public' and (
               (p.policyname = 'paiements_declares_lecture_achats' and p.qual = 'client_du_dossier(dossier_id, ''achats''::text)')
            or (p.policyname = 'pieces_vues_lecture_du_compte' and p.qual = '((utilisateur = ( SELECT auth.uid() AS uid)) AND client_du_dossier(dossier_id, ''achats''::text))')
            or (p.policyname in ('paiements_declares_lecture', 'pieces_vues_lecture') and p.qual = 'admin_du_dossier(dossier_id)'))) = 4,
      'observe', 'relu au catalogue');
    verdicts := verdicts || jsonb_build_object('rang', 92, 'etape', '92. les quatre fonctions à authenticated, ni à l''anonyme ; les trois gardes à personne ; la garde de l''échéance sur pieces',
      'ok', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
               and p.proname in ('fixer_echeance_piece', 'declarer_paiement_piece', 'retirer_paiement_declare', 'marquer_vues')
               and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')) = 4
        and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('garder_echeance_piece', 'garder_paiement_declare', 'garder_piece_vue')
               and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')) = 3
        and exists (select 1 from pg_trigger t where t.tgrelid = 'public.pieces'::regclass and t.tgname = 'pieces_echeance_gardee'
                     and t.tgfoid = 'public.garder_echeance_piece()'::regprocedure and t.tgenabled = 'O'),
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leurs pièces, déclarations et vues, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (da::uuid, ds::uuid))
      and not exists (select 1 from memberships where id in (acces_a::uuid, acces_s::uuid))
      and not exists (select 1 from pieces where dossier_id in (da::uuid, ds::uuid))
      and not exists (select 1 from paiements_declares where dossier_id in (da::uuid, ds::uuid))
      and not exists (select 1 from pieces_vues where dossier_id in (da::uuid, ds::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.achats_client', (verdicts || mutations)::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.achats_client')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
