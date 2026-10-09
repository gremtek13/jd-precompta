-- L'ÉCHÉANCE DE COTISATION RAPPROCHÉE ET SON ÉCRITURE, ÉPROUVÉES EN BASE — à rejouer par `execute_sql`
-- après toute migration qui touche `rapprocher_cotisation`, `retirer_rapprochement_cotisation`,
-- `supprimer_echeance_cotisation`, la table `cotisations_declarees` ou les contraintes de
-- `lignes_bancaires` (ligne 26.6 de la feuille de route, étape b).
--
-- Les trois fonctions rapprochent un mouvement d'une échéance de cotisation ET écrivent (ou retirent) son
-- écriture en une transaction : la cotisation au 646000 face à la banque, sa CSG-CRDS au 108000 en
-- trésorerie, dans le sens du mouvement — un remboursement crédite les comptes qu'un prélèvement débite.
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI peut : un anonyme n'a pas le droit d'appeler, un compte rattaché à rien et un client se font
--     refuser — le client sur le dossier d'un autre comme sur le SIEN —, et le chef du cabinet écrit bien
--     (le contrôle POSITIF, sans lequel les refus seraient satisfaits par une fonction qui refuse tout le
--     monde) ;
--   - CE QUI s'écrit : une ligne par compte non nul, au montant, à la date et dans le sens du mouvement ;
--     la CSG-CRDS au 108000 en trésorerie et nulle part en engagement ; un second rapprochement REMPLACE le
--     premier et libère l'échéance qu'il occupait ; un retrait défait les deux ; une suppression d'échéance
--     remet le mouvement à traiter et retire son écriture avant de partir ;
--   - CE QUI est refusé, avec sa RAISON : un encaissement sur un appel, un prélèvement sur une échéance
--     négative, une échéance de zéro euro, d'un autre dossier ou déjà rapprochée, une CSG-CRDS qui dépasse
--     le mouvement ou n'est pas au centime, une écriture qui ne correspond pas (une ligne à zéro euro
--     comprise), un mouvement déjà rapproché, affecté, ventilé, réglé en groupe ou personnel, un mouvement
--     de zéro euro, une écriture validée ;
--   - CE QUE LES CONTRAINTES TIENNENT SANS LE CODE : les fonctions des autres classements et les mises à
--     jour directes de l'écran Banque, sur un mouvement rapproché d'une échéance, se heurtent à un refus
--     NOMMÉ — jamais à un silence qui laisserait l'écriture de la cotisation derrière un autre classement ;
--     une échéance ne se rapproche que d'un mouvement ; la suppression d'un DOSSIER passe ;
--   - ce que fait une suppression DIRECTE d'échéance, que la fonction existe pour éviter : le mouvement
--     reste « rapproché » sans plus rien qui le justifie, et son écriture au brouillon ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Le dossier `test` ne porte aucune cotisation : chaque contrôle crée les siennes DANS sa sous-transaction,
-- qui les emporte en s'annulant. Chaque écriture d'essai est annulée ainsi (`raise exception
-- 'ANNULATION_ESSAI'`, P0001), le verdict étant posé dans une VARIABLE avant le `raise` — le mécanisme de
-- rls.sql. Un refus se juge à son code ET à son message : un P0001 sans rapport ressemblerait sinon à un
-- refus.
--
-- ÉPROUVÉ LE 01/10/2026 : 51 contrôles sur 51, le texte transmis identique au fichier. Et l'essai sait
-- échouer : sans les `set local role anon`, les contrôles 1 à 3 virent au rouge (l'appel passe le droit
-- d'exécution, et c'est la fonction qui refuse, avec un autre message). Les autres restent verts sous cette
-- mutation, et c'est attendu : leurs refus viennent du contrôle d'accès de la fonction, qui lit la session
-- et non le rôle, ou des contraintes, qui valent pour tout le monde.
--
-- REJOUÉ LE 04/10/2026 après les migrations de la validation d'un exercice : l'écriture validée dont
-- l'essai a besoin se pose désormais comme `valider_exercice` la pose, sous le réglage
-- `jd.validation_exercice` du dossier et avec les champs que lit son FEC — une écriture ne passe plus à
-- `validee` autrement. 49 contrôles sur 49 en production, le texte transmis identique au fichier, ses
-- commentaires et les contrôles 49 et 50 retirés. Ces deux-là, qui suppriment (une échéance directement,
-- puis un dossier), n'y ont pas été rejoués : l'outil demande alors une confirmation qui ne parvient pas
-- au cabinet. La suppression d'un dossier à travers les nouveaux déclencheurs, écritures validées
-- comprises, a été éprouvée sur une réplique locale du schéma. La table des verdicts disparaît avec la
-- transaction (`on commit drop`) au lieu d'être supprimée en tête : l'essai ne porte plus d'instruction
-- de suppression hors de ses contrôles.
-- REJOUÉ LE 06/10/2026 après `compte_de_bilan_du_releve`, qui réécrit la contrainte d'un seul rapprochement :
-- 49 contrôles sur 49 en production, le texte transmis identique au fichier, ses commentaires et les
-- contrôles 49 et 50 retirés pour la même raison qu'au 04/10.
-- REJOUÉ LE 06/10/2026 après `liquidation_de_la_tva`, qui élargit de nouveau cette contrainte (un huitième lien,
-- la déclaration de TVA dont un mouvement est le paiement ou le remboursement) : 49 contrôles sur 49 en
-- production, le texte transmis identique au fichier, ses commentaires et les contrôles 49 et 50 retirés pour la
-- même raison qu'au 04/10.
-- REJOUÉ LE 09/10/2026 après `paiement_personnel_des_cotisations`, qui pose un déclencheur sur le rapprochement d'une
-- échéance (un mouvement ne paie pas une échéance payée depuis le compte personnel) et remplace
-- `garder_cotisation_valide` : 49 contrôles sur 49 en production, « écritures 3 -> 3, mouvements true, échéances
-- 43 -> 43, dossiers 4 -> 4 », le texte reçu par la base celui de la copie (38 915 caractères, empreinte 2fa13e5a…),
-- ses commentaires et les contrôles 49 et 50 retirés pour la même raison qu'au 04/10. Le refus nouveau, et les deux
-- sens de l'exclusion, s'éprouvent dans cotisationPersonnelle.sql.
create temp table essai_cotisation (controle text, observe text, ok boolean) on commit drop;

do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  debit record; debit2 record; credit record; du_client record; avec_piece record; cat_frais record;
  cot uuid; cot2 uuid; cot_client uuid; dossier_jetable uuid; ligne_jetable uuid; ligne_zero uuid;
  accepte boolean; code_recu text; message text; obs text; ok boolean; attendu text;
  n int; nb_avant int; nb_apres int; etat_avant text; etat_apres text;
  cotisations_avant int; dossiers_avant int;

  tot numeric; csg numeric; tot2 numeric; totc numeric; csgc numeric;
  sans_csg jsonb;    -- prélèvement `debit`, échéance sans CSG-CRDS : deux lignes
  avec_csg jsonb;    -- même prélèvement, CSG-CRDS saisie : trois lignes
  tout_csg jsonb;    -- même prélèvement, CSG-CRDS égale au mouvement : deux lignes, sans 646000
  sans_csg2 jsonb;   -- prélèvement `debit2`, deux lignes
  rembt jsonb;       -- encaissement `credit` sur une échéance négative avec CSG-CRDS : trois lignes
begin
  -- Deux sorties d'au moins dix euros, et une entrée, à traiter.
  select * into debit from lignes_bancaires
   where dossier_id = dossier_test and statut = 'non_rapprochee' and montant <= -10 order by date, id limit 1;
  select * into debit2 from lignes_bancaires
   where dossier_id = dossier_test and statut = 'non_rapprochee' and montant <= -10 order by date, id offset 1 limit 1;
  select * into credit from lignes_bancaires
   where dossier_id = dossier_test and statut = 'non_rapprochee' and montant >= 10 order by date, id limit 1;
  select l.* into du_client from lignes_bancaires l
    join memberships m on m.dossier_id = l.dossier_id
   where m.user_id = client and l.montant < 0 order by l.date, l.id limit 1;
  select * into avec_piece from lignes_bancaires
   where dossier_id = dossier_test and piece_id is not null and statut = 'rapprochee' order by id limit 1;
  select * into cat_frais from categories where code = 'frais_bancaires' and dossier_id is null;
  if debit.id is null or debit2.id is null or credit.id is null or du_client.id is null or avec_piece.id is null
     or cat_frais.id is null or du_client.dossier_id = dossier_test then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;

  select count(*) into nb_avant from ecritures_brouillon;
  select count(*) into cotisations_avant from cotisations_declarees;
  select count(*) into dossiers_avant from dossiers;
  select string_agg(concat_ws(':', l.id, l.statut, l.piece_id, l.cotisation_id, l.categorie_id, l.prelevement_personnel,
                              l.montant, l.ventilee, l.reglement_groupe), '|' order by l.id)
    into etat_avant from lignes_bancaires l where l.id in (debit.id, debit2.id, credit.id, avec_piece.id, du_client.id);

  tot := abs(debit.montant);
  csg := round(tot * 0.3, 2);
  sans_csg := jsonb_build_array(
    jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot, 'libelle', 'essai'),
    jsonb_build_object('compte', '646000', 'sens', 'debit', 'montant', tot, 'libelle', 'essai'));
  avec_csg := jsonb_build_array(
    jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
    jsonb_build_object('compte', '646000', 'sens', 'debit', 'montant', tot - csg),
    jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', csg));
  tout_csg := jsonb_build_array(
    jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
    jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', tot));
  tot2 := abs(debit2.montant);
  sans_csg2 := jsonb_build_array(
    jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot2),
    jsonb_build_object('compte', '646000', 'sens', 'debit', 'montant', tot2));
  totc := credit.montant;
  csgc := round(totc * 0.3, 2);
  rembt := jsonb_build_array(
    jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', totc),
    jsonb_build_object('compte', '646000', 'sens', 'credit', 'montant', totc - csgc),
    jsonb_build_object('compte', '108000', 'sens', 'credit', 'montant', csgc));

  -- ══ 1 à 3. Anonyme : pas d'EXECUTE, sur aucune des trois fonctions ══════════════════════════════
  -- L'échéance n'importe pas ici : le droit d'exécution passe AVANT elle.
  for obs in select unnest(array['1. anonyme, rapprocher', '2. anonyme, retirer', '3. anonyme, supprimer']) loop
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
    accepte := false; code_recu := null; message := null;
    begin
      case substring(obs from '^(\d+)')
        when '1' then perform rapprocher_cotisation(debit.id, inconnu, sans_csg);
        when '2' then perform retirer_rapprochement_cotisation(debit.id);
        else perform supprimer_echeance_cotisation(inconnu);
      end case;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_cotisation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '42501' and message like 'permission denied%');
  end loop;

  -- ══ 4 et 5. Rattaché à rien : refusé par la fonction, sur le mouvement comme sur l'échéance ═══════
  accepte := false; code_recu := null; message := null;
  begin
    insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, tot)
      returning id into cot;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
    perform rapprocher_cotisation(debit.id, cot, sans_csg);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('4. rattaché à rien, rapprocher', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  accepte := false; code_recu := null; message := null;
  begin
    insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, tot)
      returning id into cot;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
    perform supprimer_echeance_cotisation(cot);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('5. rattaché à rien, supprimer', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à cette échéance.');

  -- ══ 6 à 9. Le client : sur le dossier d'un autre comme sur le SIEN ═══════════════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, tot)
      returning id into cot;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
    perform rapprocher_cotisation(debit.id, cot, sans_csg);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('6. client, dossier d''un autre', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  accepte := false; code_recu := null; message := null;
  begin
    insert into cotisations_declarees (dossier_id, echeance, montant_appele)
    values (du_client.dossier_id, du_client.date, abs(du_client.montant)) returning id into cot_client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
    perform rapprocher_cotisation(du_client.id, cot_client, jsonb_build_array(
      jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(du_client.montant)),
      jsonb_build_object('compte', '646000', 'sens', 'debit', 'montant', abs(du_client.montant))));
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('7. client, son propre dossier', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  accepte := false; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
    perform retirer_rapprochement_cotisation(du_client.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('8. client, retirer sur son dossier', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  accepte := false; code_recu := null; message := null;
  begin
    insert into cotisations_declarees (dossier_id, echeance, montant_appele)
    values (du_client.dossier_id, du_client.date, abs(du_client.montant)) returning id into cot_client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
    perform supprimer_echeance_cotisation(cot_client);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('9. client, supprimer sur son dossier', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à cette échéance.');

  -- ══ 10. Le chef rapproche un prélèvement d'un appel sans CSG-CRDS : deux lignes ═══════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, tot)
      returning id into cot;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := rapprocher_cotisation(debit.id, cot, sans_csg);
    select string_agg(e.compte || ':' || e.sens || ':' || e.montant::text || ':' || (e.date = debit.date)::text, ',' order by e.compte)
      into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 2 and l.statut = 'rapprochee' and l.cotisation_id = cot
           and obs = '512000:credit:' || tot::text || ':true,646000:debit:' || tot::text || ':true'
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('10. le chef rapproche un appel', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 11. La CSG-CRDS saisie passe au 108000, en trésorerie : trois lignes ══════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into cotisations_declarees (dossier_id, echeance, montant_appele, montant_csg_crds)
    values (dossier_test, debit.date, tot, csg) returning id into cot;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := rapprocher_cotisation(debit.id, cot, avec_csg);
    select string_agg(e.compte || ':' || e.sens || ':' || e.montant::text, ',' order by e.compte)
      into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    ok := n = 3 and obs = '108000:debit:' || csg::text || ',512000:credit:' || tot::text
                       || ',646000:debit:' || (tot - csg)::text;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('11. la CSG-CRDS au 108000', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 12. Une échéance faite toute de CSG-CRDS : pas de ligne à zéro au 646000 ══════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into cotisations_declarees (dossier_id, echeance, montant_appele, montant_csg_crds)
    values (dossier_test, debit.date, tot, tot) returning id into cot;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := rapprocher_cotisation(debit.id, cot, tout_csg);
    select string_agg(e.compte || ':' || e.sens, ',' order by e.compte)
      into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    ok := n = 2 and obs = '108000:debit,512000:credit';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('12. toute de CSG-CRDS', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 13. Un remboursement : un encaissement sur une échéance NÉGATIVE crédite le 646000 et le 108000 ═
  -- La CSG-CRDS saisie négative : sa valeur absolue, dans le sens du mouvement.
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into cotisations_declarees (dossier_id, echeance, montant_appele, montant_csg_crds)
    values (dossier_test, credit.date, -totc, -csgc) returning id into cot;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := rapprocher_cotisation(credit.id, cot, rembt);
    select string_agg(e.compte || ':' || e.sens || ':' || e.montant::text, ',' order by e.compte)
      into obs from ecritures_brouillon e where e.ligne_bancaire_id = credit.id and e.piece_id is null;
    select n = 3 and l.cotisation_id = cot
           and obs = '108000:credit:' || csgc::text || ',512000:debit:' || totc::text
                  || ',646000:credit:' || (totc - csgc)::text
      into ok from lignes_bancaires l where l.id = credit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('13. un remboursement', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 14 et 15. En ENGAGEMENT, tout au 646000 : l'écriture avec un 108000 est refusée ═══════════════
  -- Un dossier jetable, en engagement, créé DANS la sous-transaction : le dossier `test` porte peut-être
  -- un jour des écritures, et son modèle ne se change alors plus (`dossiers_verrouiller_modele_comptable`).
  for obs in select unnest(array['14. engagement : tout au 646000', '15. engagement : pas de 108000']) loop
    accepte := false; code_recu := null; message := null; ok := false;
    begin
      insert into dossiers (nom, cabinet_id, mode_comptable)
      values ('Dossier d''essai (cotisation)', (select cabinet_id from dossiers where id = dossier_test), 'engagement')
        returning id into dossier_jetable;
      insert into lignes_bancaires (dossier_id, date, libelle, montant)
      values (dossier_jetable, '2025-02-05', 'PRLV URSSAF ESSAI', -300) returning id into ligne_jetable;
      insert into cotisations_declarees (dossier_id, echeance, montant_appele, montant_csg_crds)
      values (dossier_jetable, '2025-02-05', 300, 90) returning id into cot;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      if obs like '14.%' then
        n := rapprocher_cotisation(ligne_jetable, cot, jsonb_build_array(
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', 300),
          jsonb_build_object('compte', '646000', 'sens', 'debit', 'montant', 300)));
        ok := n = 2;
      else
        perform rapprocher_cotisation(ligne_jetable, cot, jsonb_build_array(
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', 300),
          jsonb_build_object('compte', '646000', 'sens', 'debit', 'montant', 210),
          jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', 90)));
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    if obs like '14.%' then
      insert into essai_cotisation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
        accepte and code_recu = 'P0001' and coalesce(ok, false));
    else
      insert into essai_cotisation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
        not accepte and code_recu = '22023'
        and message = 'L''écriture proposée ne correspond pas à ce mouvement et à cette échéance.');
    end if;
  end loop;

  -- ══ 16. Un second rapprochement REMPLACE le premier et libère l'échéance qu'il occupait ═════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, tot)
      returning id into cot;
    insert into cotisations_declarees (dossier_id, echeance, montant_appele, montant_csg_crds)
    values (dossier_test, debit.date, tot, csg) returning id into cot2;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform rapprocher_cotisation(debit.id, cot, sans_csg);
    n := rapprocher_cotisation(debit.id, cot2, avec_csg);
    -- L'échéance libérée se rapproche d'un autre mouvement.
    perform rapprocher_cotisation(debit2.id, cot, sans_csg2);
    select count(*)::text into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 3 and obs = '3' and l.cotisation_id = cot2 into ok from lignes_bancaires l where l.id = debit.id;
    ok := ok and (select l.cotisation_id = cot from lignes_bancaires l where l.id = debit2.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('16. le second rapprochement remplace', 'lignes : ' || coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 17. Le retrait défait le rapprochement ET son écriture ═════════════════════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into cotisations_declarees (dossier_id, echeance, montant_appele, montant_csg_crds)
    values (dossier_test, debit.date, tot, csg) returning id into cot;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform rapprocher_cotisation(debit.id, cot, avec_csg);
    n := retirer_rapprochement_cotisation(debit.id);
    select count(*)::text into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 3 and obs = '0' and l.statut = 'non_rapprochee' and l.cotisation_id is null
      into ok from lignes_bancaires l where l.id = debit.id;
    ok := ok and exists (select 1 from cotisations_declarees where id = cot);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('17. le retrait défait les deux', 'retirées : ' || coalesce(n::text, '?') || ', restantes : ' || coalesce(obs, '?'),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 18. Supprimer une échéance rapprochée : le mouvement redevient à traiter, sans écriture ═════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into cotisations_declarees (dossier_id, echeance, montant_appele, montant_csg_crds)
    values (dossier_test, debit.date, tot, csg) returning id into cot;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform rapprocher_cotisation(debit.id, cot, avec_csg);
    n := supprimer_echeance_cotisation(cot);
    select count(*)::text into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 1 and obs = '0' and l.statut = 'non_rapprochee' and l.cotisation_id is null
      into ok from lignes_bancaires l where l.id = debit.id;
    ok := ok and not exists (select 1 from cotisations_declarees where id = cot);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('18. supprimer une échéance rapprochée', 'écritures restantes : ' || coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 19. Supprimer une échéance que rien ne paie : elle part, rien d'autre ne bouge ═════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, tot)
      returning id into cot;
    select count(*)::text into obs from ecritures_brouillon;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := supprimer_echeance_cotisation(cot);
    ok := n = 1 and not exists (select 1 from cotisations_declarees where id = cot)
      and obs = (select count(*)::text from ecritures_brouillon);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('19. supprimer une échéance non rapprochée', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 20 à 30. Les refus de rapprocher, chacun à sa RAISON ══════════════════════════════════════════
  for obs, attendu in
    select * from (values
      ('20. encaissement sur un appel', 'Ce mouvement est un encaissement : il ne paie pas un appel de cotisation. Un remboursement se rapproche d''une échéance négative.'),
      ('21. prélèvement sur une échéance négative', 'Cette échéance est négative — un remboursement : un prélèvement ne la paie pas.'),
      ('22. échéance de zéro euro', 'Une échéance de zéro euro ne se rapproche pas.'),
      ('23. échéance d''un autre dossier', 'Cette échéance n''existe pas pour ce dossier.'),
      ('24. échéance déjà rapprochée', 'Cette échéance est déjà rapprochée du mouvement du ' || to_char(debit2.date, 'DD/MM/YYYY') || '.'),
      ('25. CSG-CRDS au-delà du mouvement', 'La CSG-CRDS de cette échéance (' || replace(to_char(tot + 1, 'FM999999999990.00'), '.', ',')
                                             || ' €) dépasse le mouvement (' || replace(to_char(tot, 'FM999999999990.00'), '.', ',') || ' €).'),
      ('26. CSG-CRDS pas au centime', 'La CSG-CRDS de cette échéance n''est pas au centime.'),
      ('27. écriture qui ne correspond pas', 'L''écriture proposée ne correspond pas à ce mouvement et à cette échéance.'),
      ('28. une ligne à zéro euro', 'L''écriture proposée ne correspond pas à ce mouvement et à cette échéance.'),
      ('29. écriture qui n''est pas un tableau', 'L''écriture proposée est incomplète.'),
      ('30. mouvement de zéro euro', 'Un mouvement de zéro euro n''a rien à écrire.')
    ) as cas(nom, texte)
  loop
    accepte := false; code_recu := null; message := null;
    begin
      case substring(obs from '^(\d+)')
        when '20' then
          insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, credit.date, totc)
            returning id into cot;
        when '21' then
          insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, -tot)
            returning id into cot;
        when '22' then
          insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, 0)
            returning id into cot;
        when '23' then
          insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (du_client.dossier_id, debit.date, tot)
            returning id into cot;
        when '24' then
          insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, tot)
            returning id into cot;
          -- Posé directement, sans la fonction : le refus vient de la vérification, pas d'une écriture.
          update lignes_bancaires set statut = 'rapprochee', cotisation_id = cot where id = debit2.id;
        when '25' then
          insert into cotisations_declarees (dossier_id, echeance, montant_appele, montant_csg_crds)
          values (dossier_test, debit.date, tot, tot + 1) returning id into cot;
        when '26' then
          insert into cotisations_declarees (dossier_id, echeance, montant_appele, montant_csg_crds)
          values (dossier_test, debit.date, tot, 1.005) returning id into cot;
        when '30' then
          insert into lignes_bancaires (dossier_id, date, libelle, montant)
          values (dossier_test, debit.date, 'MOUVEMENT ESSAI', 0) returning id into ligne_zero;
          insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, tot)
            returning id into cot;
        else
          insert into cotisations_declarees (dossier_id, echeance, montant_appele, montant_csg_crds)
          values (dossier_test, debit.date, tot, case when obs like '28.%' then tot end) returning id into cot;
      end case;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      case substring(obs from '^(\d+)')
        when '20' then perform rapprocher_cotisation(credit.id, cot, jsonb_build_array(
          jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', totc),
          jsonb_build_object('compte', '646000', 'sens', 'credit', 'montant', totc)));
        when '27' then perform rapprocher_cotisation(debit.id, cot, jsonb_build_array(
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
          jsonb_build_object('compte', '646000', 'sens', 'debit', 'montant', tot - 0.01),
          jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', 0.01)));
        when '28' then perform rapprocher_cotisation(debit.id, cot, tout_csg || jsonb_build_array(
          jsonb_build_object('compte', '646000', 'sens', 'debit', 'montant', 0)));
        when '29' then perform rapprocher_cotisation(debit.id, cot, jsonb_build_object('compte', '512000'));
        when '30' then perform rapprocher_cotisation(ligne_zero, cot, '[]'::jsonb);
        else perform rapprocher_cotisation(debit.id, cot, sans_csg);
      end case;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_cotisation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = case when obs like '24.%' then '23505' else '22023' end and message = attendu);
  end loop;

  -- ══ 31 à 35. Un mouvement déjà classé autrement : on annule d'abord ce classement ═════════════════
  for obs, attendu in
    select * from (values
      ('31. mouvement rapproché d''une pièce', 'Ce mouvement est rapproché d''une pièce ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.'),
      ('32. mouvement affecté', 'Ce mouvement est rapproché d''une pièce ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.'),
      ('33. mouvement personnel', 'Ce mouvement est rapproché d''une pièce ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.'),
      ('34. mouvement ventilé', 'Ce mouvement est rapproché d''une pièce ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.'),
      ('35. mouvement réglé en groupe', 'Ce mouvement règle plusieurs pièces : annule d''abord ce règlement groupé.')
    ) as cas(nom, texte)
  loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, tot)
        returning id into cot;
      case substring(obs from '^(\d+)')
        when '31' then null;
        when '32' then update lignes_bancaires set statut = 'rapprochee', categorie_id = cat_frais.id where id = debit.id;
        when '33' then update lignes_bancaires set statut = 'ignoree', prelevement_personnel = true where id = debit.id;
        when '34' then update lignes_bancaires set statut = 'rapprochee', ventilee = true where id = debit.id;
        else update lignes_bancaires set statut = 'rapprochee', reglement_groupe = true where id = debit.id;
      end case;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      if obs like '31.%' then
        perform rapprocher_cotisation(avec_piece.id, cot, jsonb_build_array(
          jsonb_build_object('compte', '512000', 'sens', case when avec_piece.montant > 0 then 'debit' else 'credit' end, 'montant', abs(avec_piece.montant)),
          jsonb_build_object('compte', '646000', 'sens', case when avec_piece.montant > 0 then 'credit' else 'debit' end, 'montant', abs(avec_piece.montant))));
      else
        perform rapprocher_cotisation(debit.id, cot, sans_csg);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_cotisation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '22023' and message = attendu);
  end loop;

  -- ══ 36. Retirer un mouvement qu'aucune échéance ne rapproche ════════════════════════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform retirer_rapprochement_cotisation(debit.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('36. retirer un mouvement sans échéance', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = 'Ce mouvement n''est rapproché d''aucune échéance de cotisation.');

  -- ══ 37 à 39. Une écriture VALIDÉE ne se remplace, ne se retire, ni ne laisse supprimer son échéance ══
  for obs, attendu in
    select * from (values
      ('37. écriture validée : pas de nouveau rapprochement', 'L''écriture de ce mouvement est validée : elle ne se remplace plus.'),
      ('38. écriture validée : pas de retrait', 'L''écriture de ce mouvement est validée : elle ne se retire plus.'),
      ('39. écriture validée : pas de suppression de l''échéance', 'L''écriture du mouvement qui paie cette échéance est validée : l''échéance ne se supprime plus.')
    ) as cas(nom, texte)
  loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, tot)
        returning id into cot;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform rapprocher_cotisation(debit.id, cot, sans_csg);
      reset role;
      -- Une écriture se valide comme `valider_exercice` la valide : sous le réglage de son dossier, avec les
      -- champs que son FEC lit (contrainte `ecritures_brouillon_validation_complete`).
      perform set_config('jd.validation_exercice', dossier_test::text, true);
      update ecritures_brouillon
         set statut = 'validee', valide_le = now(), journal_code = 'BQ', numero_ecriture = 1,
             piece_ref = 'essai', piece_date = date, compte_lib = 'essai'
       where ligne_bancaire_id = debit.id and piece_id is null;
      perform set_config('jd.validation_exercice', '', true);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      case substring(obs from '^(\d+)')
        when '37' then perform rapprocher_cotisation(debit.id, cot, sans_csg);
        when '38' then perform retirer_rapprochement_cotisation(debit.id);
        else perform supprimer_echeance_cotisation(cot);
      end case;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_cotisation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '23514' and message = attendu);
  end loop;

  -- ══ 40 à 45. Ce qui ne connaît pas la cotisation se heurte à un refus NOMMÉ ════════════════════════
  -- Les fonctions des autres classements refusent elles-mêmes un mouvement qui porte une échéance ; les
  -- mises à jour directes de l'écran Banque (associer une pièce, remettre à traiter, ignorer), qui ne
  -- touchent plus `cotisation_id`, se heurtent à une contrainte. Jamais une écriture de catégorie, de
  -- virement ou d'emprunt posée par-dessus celle de la cotisation, jamais un mouvement « à traiter » ou
  -- « ignoré » qui garde son échéance — ni, pour l'écran Banque, un lien effacé en silence qui laisserait
  -- l'écriture de la cotisation au brouillon. L'écran ne les propose pas sur un tel mouvement ; ces refus
  -- sont la ceinture d'une course.
  for obs, attendu in
    select * from (values
      ('40. affecter une catégorie', 'Ce mouvement est rapproché d''une pièce ou d''une échéance, ou classé en virement personnel : annule d''abord ce classement.'),
      ('41. classer en virement personnel', 'Ce mouvement est rapproché d''une pièce ou d''une échéance, ou affecté à une catégorie : annule d''abord ce classement.'),
      ('42. rapprocher d''un emprunt', 'Ce mouvement est rapproché d''une pièce ou d''une cotisation, affecté à une catégorie ou classé en virement personnel : annule d''abord ce classement.'),
      ('43. associer une pièce (écran Banque)', 'lignes_bancaires_un_seul_rapprochement'),
      ('44. remettre à traiter (écran Banque)', 'lignes_bancaires_cotisation_rapprochee'),
      ('45. ignorer (écran Banque)', 'lignes_bancaires_cotisation_rapprochee')
    ) as cas(nom, texte)
  loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, tot)
        returning id into cot;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform rapprocher_cotisation(debit.id, cot, sans_csg);
      case substring(obs from '^(\d+)')
        when '40' then
          perform affecter_mouvement_bancaire(debit.id, cat_frais.id, jsonb_build_array(
            jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', tot),
            jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot)), null);
        when '41' then
          perform classer_virement_personnel(debit.id, jsonb_build_array(
            jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', tot),
            jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot)));
        when '42' then
          perform rapprocher_echeance_emprunt(debit.id, inconnu, 1, 0, 0, sans_csg);
        when '43' then
          update lignes_bancaires set statut = 'rapprochee', piece_id = avec_piece.piece_id where id = debit.id;
        when '44' then
          update lignes_bancaires set statut = 'non_rapprochee', piece_id = null, prelevement_personnel = false
           where id = debit.id;
        else
          update lignes_bancaires set statut = 'ignoree', piece_id = null where id = debit.id;
      end case;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_cotisation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and case when obs ~ '^4[0-2]\.'
        then code_recu = '22023' and message = attendu
        else code_recu = '23514' and message like '%"' || attendu || '"%' end);
  end loop;

  -- ══ 46 à 48. Les contraintes tiennent SANS les fonctions (mises à jour directes) ═════════════════════
  for obs, attendu in
    select * from (values
      ('46. échéance sur un mouvement à traiter', 'lignes_bancaires_cotisation_rapprochee'),
      ('47. échéance sur un mouvement personnel', 'lignes_bancaires_cotisation_rapprochee'),
      ('48. la même échéance sur deux mouvements', 'lignes_bancaires_cotisation_unique')
    ) as cas(nom, texte)
  loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, tot)
        returning id into cot;
      case substring(obs from '^(\d+)')
        when '46' then update lignes_bancaires set cotisation_id = cot where id = debit.id;
        when '47' then update lignes_bancaires set statut = 'rapprochee', prelevement_personnel = true, cotisation_id = cot
                        where id = debit.id;
        else update lignes_bancaires set statut = 'rapprochee', cotisation_id = cot where id in (debit.id, debit2.id);
      end case;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    insert into essai_cotisation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = case when obs like '48.%' then '23505' else '23514' end
      and message like '%"' || attendu || '"%');
  end loop;

  -- ══ 49. Une suppression DIRECTE d'échéance, sans la fonction : ce que la fonction existe pour éviter ═
  -- La clé est en ON DELETE SET NULL : le mouvement reste « rapproché » sans plus rien qui le justifie,
  -- et son écriture reste au brouillon. C'est un CONSTAT, pas un refus — `mouvementsRapprochesSansObjet`
  -- le signale, et « Remettre à traiter » le répare.
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into cotisations_declarees (dossier_id, echeance, montant_appele) values (dossier_test, debit.date, tot)
      returning id into cot;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform rapprocher_cotisation(debit.id, cot, sans_csg);
    delete from cotisations_declarees where id = cot;
    select count(*)::text into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select obs = '2' and l.statut = 'rapprochee' and l.cotisation_id is null
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('49. suppression directe : le mouvement reste sans objet', 'écritures restantes : ' || coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 50. Supprimer un DOSSIER emporte ses échéances rapprochées et leurs écritures ═══════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into dossiers (nom, cabinet_id) values ('Dossier d''essai (cotisation)', (select cabinet_id from dossiers where id = dossier_test))
      returning id into dossier_jetable;
    insert into lignes_bancaires (dossier_id, date, libelle, montant)
    values (dossier_jetable, '2025-02-05', 'PRLV URSSAF ESSAI', -300) returning id into ligne_jetable;
    insert into cotisations_declarees (dossier_id, echeance, montant_appele, montant_csg_crds)
    values (dossier_jetable, '2025-02-05', 300, 90) returning id into cot;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform rapprocher_cotisation(ligne_jetable, cot, jsonb_build_array(
      jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', 300),
      jsonb_build_object('compte', '646000', 'sens', 'debit', 'montant', 210),
      jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', 90)));
    reset role;
    delete from dossiers where id = dossier_jetable;
    select (select count(*) from cotisations_declarees where id = cot) = 0
       and (select count(*) from lignes_bancaires where id = ligne_jetable) = 0
       and (select count(*) from ecritures_brouillon where dossier_id = dossier_jetable) = 0
      into ok;
    obs := 'dossier supprimé, échéance, mouvement et écriture partis : ' || ok::text;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_cotisation values ('50. supprimer le dossier emporte ses échéances', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 51. Rien n'est resté ══════════════════════════════════════════════════════════════════════════
  select count(*) into nb_apres from ecritures_brouillon;
  select string_agg(concat_ws(':', l.id, l.statut, l.piece_id, l.cotisation_id, l.categorie_id, l.prelevement_personnel,
                              l.montant, l.ventilee, l.reglement_groupe), '|' order by l.id)
    into etat_apres from lignes_bancaires l where l.id in (debit.id, debit2.id, credit.id, avec_piece.id, du_client.id);
  insert into essai_cotisation values ('51. rien n''est resté en base',
    'écritures ' || nb_avant || ' -> ' || nb_apres || ', mouvements ' || (etat_avant = etat_apres)::text
      || ', échéances ' || cotisations_avant || ' -> ' || (select count(*) from cotisations_declarees)
      || ', dossiers ' || dossiers_avant || ' -> ' || (select count(*) from dossiers)
      || ', mouvements à zéro ' || (select count(*) from lignes_bancaires where libelle = 'MOUVEMENT ESSAI'),
    nb_avant = nb_apres and etat_avant = etat_apres
      and cotisations_avant = (select count(*) from cotisations_declarees)
      and dossiers_avant = (select count(*) from dossiers)
      and not exists (select 1 from lignes_bancaires where libelle = 'MOUVEMENT ESSAI'));
end $$;

select controle, ok, observe from essai_cotisation order by
  (regexp_match(controle, '^(\d+)'))[1]::int, controle;
