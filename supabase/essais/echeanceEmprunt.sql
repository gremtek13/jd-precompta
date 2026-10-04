-- L'ÉCHÉANCE D'EMPRUNT ET SON ÉCRITURE, ÉPROUVÉES EN BASE — à rejouer par `execute_sql` après toute
-- migration qui touche `rapprocher_echeance_emprunt`, `retirer_echeance_emprunt`, la table `emprunts` ou
-- les contraintes de `lignes_bancaires` (ligne 26.6 de la feuille de route, étape a).
--
-- Les deux fonctions rapprochent un mouvement d'un emprunt ET écrivent (ou retirent) son écriture en une
-- transaction : une sortie en est une ÉCHÉANCE (capital 164000, intérêts 661100, assurance 616800, face à
-- la banque), une entrée le DÉBLOCAGE (la banque au débit, 164000 au crédit). Ce qui se prouve ici, et ne
-- se relit pas :
--   - QUI peut : un anonyme n'a pas le droit d'appeler, un compte rattaché à rien et un client se font
--     refuser — le client sur le dossier d'un autre comme sur le SIEN —, et le chef du cabinet écrit bien
--     (le contrôle POSITIF, sans lequel les refus seraient satisfaits par une fonction qui refuse tout le
--     monde) ;
--   - CE QUI s'écrit : une ligne par compte non nul, au montant, à la date et dans le sens du mouvement, et
--     le découpage validé gardé sur le mouvement ; un second rapprochement REMPLACE le premier et libère
--     l'échéance qu'il occupait ; un retrait défait les deux ;
--   - CE QUI est refusé, avec sa RAISON : une échéance déjà rapprochée, hors de la durée ou absente, un
--     découpage qui dépasse le prélèvement ou n'est pas au centime, un déblocage avec intérêts, un emprunt
--     d'un autre dossier, une écriture qui ne correspond pas au découpage (une ligne à zéro euro comprise),
--     un mouvement déjà rapproché, affecté ou personnel, un mouvement de zéro euro, une écriture validée ;
--   - CE QUE LES CONTRAINTES TIENNENT SANS LE CODE : ni `affecter_mouvement_bancaire` ni
--     `classer_virement_personnel` ne connaissent l'emprunt, et les mises à jour directes de l'écran
--     Banque non plus — chacune se heurte à une contrainte nommée, jamais à un silence ; un emprunt dont
--     une échéance est rapprochée ne se supprime pas, et la suppression d'un DOSSIER passe quand même ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Le dossier `test` ne porte aucun emprunt : chaque contrôle crée le sien DANS sa sous-transaction, qui
-- l'emporte en s'annulant. Chaque écriture d'essai est annulée ainsi (`raise exception 'ANNULATION_ESSAI'`,
-- P0001), le verdict étant posé dans une VARIABLE avant le `raise` — le mécanisme de rls.sql. Un refus se
-- juge à son code ET à son message : un P0001 sans rapport ressemblerait sinon à un refus.
--
-- ÉPROUVÉ LE 29/09/2026 : 50 contrôles sur 50, le texte transmis comparé au fichier dans le journal de
-- session (identique). Et l'essai sait échouer : sans les `set local role`, les contrôles 1 et 2 virent au
-- rouge (l'appel passe le droit d'exécution, et c'est la fonction qui refuse, avec un autre message). Les
-- autres restent verts sous cette mutation, et c'est attendu : leurs refus viennent du contrôle d'accès de
-- la fonction, qui lit la session et non le rôle, ou des contraintes, qui valent pour tout le monde.
--
-- REJOUÉ LE 04/10/2026 après les migrations de la validation d'un exercice : l'écriture validée dont
-- l'essai a besoin se pose désormais comme `valider_exercice` la pose, sous le réglage
-- `jd.validation_exercice` du dossier et avec les champs que lit son FEC — une écriture ne passe plus à
-- `validee` autrement. 48 contrôles sur 48 en production, le texte transmis identique au fichier, ses
-- commentaires et les contrôles 48 et 49 retirés. Ces deux-là, qui suppriment (un emprunt, puis un
-- dossier), n'y ont pas été rejoués : l'outil demande alors une confirmation qui ne parvient pas au
-- cabinet. Le premier éprouve une clé étrangère que ces migrations ne touchent pas ; la suppression d'un
-- dossier à travers les nouveaux déclencheurs, écritures validées comprises, a été éprouvée sur une
-- réplique locale du schéma. La table des verdicts disparaît avec la transaction (`on commit drop`) au
-- lieu d'être supprimée en tête : l'essai ne porte plus d'instruction de suppression hors de ses
-- contrôles.
create temp table essai_emprunt (controle text, observe text, ok boolean) on commit drop;

do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  debit record; debit2 record; credit record; du_client record; avec_piece record; cat_frais record;
  emp uuid; emp_autre uuid; dossier_jetable uuid; ligne_jetable uuid;
  accepte boolean; code_recu text; message text; obs text; ok boolean;
  n int; nb_avant int; nb_apres int; etat_avant text; etat_apres text;
  emprunts_avant int; dossiers_avant int;

  -- Le découpage d'essai de `debit` : 20 % d'intérêts, 5 % d'assurance, le reste en capital.
  tot numeric; i numeric; a numeric; cap numeric;
  tot2 numeric; i2 numeric;
  ecriture jsonb;             -- échéance complète de `debit` (quatre lignes)
  ecriture_sans_assurance jsonb;
  ecriture2 jsonb;            -- échéance de `debit2`, sans assurance (trois lignes)
  deblocage jsonb;            -- déblocage de `credit` (deux lignes)
  lignes_essai jsonb;
begin
  -- Deux sorties d'au moins dix euros, pour qu'un découpage à 20 % et 5 % laisse du capital.
  select * into debit from lignes_bancaires
   where dossier_id = dossier_test and statut = 'non_rapprochee' and montant <= -10 order by date, id limit 1;
  select * into debit2 from lignes_bancaires
   where dossier_id = dossier_test and statut = 'non_rapprochee' and montant <= -10 order by date, id offset 1 limit 1;
  select * into credit from lignes_bancaires
   where dossier_id = dossier_test and statut = 'non_rapprochee' and montant >= 10 order by date, id limit 1;
  select l.* into du_client from lignes_bancaires l
    join memberships m on m.dossier_id = l.dossier_id
   where m.user_id = client order by l.date, l.id limit 1;
  select * into avec_piece from lignes_bancaires
   where dossier_id = dossier_test and piece_id is not null and statut = 'rapprochee' order by id limit 1;
  select * into cat_frais from categories where code = 'frais_bancaires' and dossier_id is null;
  if debit.id is null or debit2.id is null or credit.id is null or du_client.id is null or avec_piece.id is null
     or cat_frais.id is null or du_client.dossier_id = dossier_test then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;

  select count(*) into nb_avant from ecritures_brouillon;
  select count(*) into emprunts_avant from emprunts;
  select count(*) into dossiers_avant from dossiers;
  select string_agg(concat_ws(':', l.id, l.statut, l.piece_id, l.categorie_id, l.prelevement_personnel, l.montant,
                              l.emprunt_id, l.emprunt_echeance, l.emprunt_interets, l.emprunt_assurance), '|' order by l.id)
    into etat_avant from lignes_bancaires l where l.id in (debit.id, debit2.id, credit.id, avec_piece.id);

  tot := abs(debit.montant);
  i := round(tot * 0.2, 2);
  a := round(tot * 0.05, 2);
  cap := tot - i - a;
  ecriture := jsonb_build_array(
    jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot, 'libelle', 'essai'),
    jsonb_build_object('compte', '164000', 'sens', 'debit', 'montant', cap, 'libelle', 'essai'),
    jsonb_build_object('compte', '661100', 'sens', 'debit', 'montant', i, 'libelle', 'essai'),
    jsonb_build_object('compte', '616800', 'sens', 'debit', 'montant', a, 'libelle', 'essai'));
  ecriture_sans_assurance := jsonb_build_array(
    jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
    jsonb_build_object('compte', '164000', 'sens', 'debit', 'montant', tot - i),
    jsonb_build_object('compte', '661100', 'sens', 'debit', 'montant', i));
  tot2 := abs(debit2.montant);
  i2 := round(tot2 * 0.2, 2);
  ecriture2 := jsonb_build_array(
    jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot2),
    jsonb_build_object('compte', '164000', 'sens', 'debit', 'montant', tot2 - i2),
    jsonb_build_object('compte', '661100', 'sens', 'debit', 'montant', i2));
  deblocage := jsonb_build_array(
    jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', credit.montant),
    jsonb_build_object('compte', '164000', 'sens', 'credit', 'montant', credit.montant));

  -- ══ 1 et 2. Anonyme : pas d'EXECUTE, ni pour rapprocher ni pour retirer ═══════════════════════
  -- L'emprunt n'importe pas ici : le droit d'exécution, puis le contrôle d'accès, passent AVANT lui.
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform rapprocher_echeance_emprunt(debit.id, inconnu, 1, i, a, ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('1. anonyme, rapprocher', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message like 'permission denied%');

  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform retirer_echeance_emprunt(debit.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('2. anonyme, retirer', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message like 'permission denied%');

  -- ══ 3 à 6. Rattaché à rien, client sur le dossier d'un autre, client sur le sien ═══════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform rapprocher_echeance_emprunt(debit.id, inconnu, 1, i, a, ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('3. rattaché à rien', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform rapprocher_echeance_emprunt(debit.id, inconnu, 1, i, a, ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('4. client, dossier d''un autre', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform rapprocher_echeance_emprunt(du_client.id, inconnu, case when du_client.montant < 0 then 1 end, 0, 0,
      jsonb_build_array(
        jsonb_build_object('compte', '512000', 'sens', case when du_client.montant >= 0 then 'debit' else 'credit' end, 'montant', abs(du_client.montant)),
        jsonb_build_object('compte', '164000', 'sens', case when du_client.montant >= 0 then 'credit' else 'debit' end, 'montant', abs(du_client.montant))));
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('5. client, son propre dossier', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform retirer_echeance_emprunt(du_client.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('6. client, retirer sur son dossier', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  -- ══ 7. Le chef rapproche une échéance : quatre lignes, le découpage gardé sur le mouvement ═══════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
    values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := rapprocher_echeance_emprunt(debit.id, emp, 1, i, a, ecriture);
    select string_agg(e.compte || ':' || e.sens || ':' || e.montant::text || ':' || (e.date = debit.date)::text, ',' order by e.compte)
      into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 4 and l.statut = 'rapprochee' and l.emprunt_id = emp and l.emprunt_echeance = 1
           and l.emprunt_interets = i and l.emprunt_assurance = a
           and obs = '164000:debit:' || cap::text || ':true,512000:credit:' || tot::text || ':true,'
                  || '616800:debit:' || a::text || ':true,661100:debit:' || i::text || ':true'
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('7. le chef rapproche une échéance', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 8. Une échéance sans assurance : trois lignes, l'assurance gardée à zéro ═════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
    values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := rapprocher_echeance_emprunt(debit.id, emp, 3, i, 0, ecriture_sans_assurance);
    select string_agg(e.compte || ':' || e.sens, ',' order by e.compte) into obs
      from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 3 and obs = '164000:debit,512000:credit,661100:debit' and l.emprunt_assurance = 0 and l.emprunt_echeance = 3
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('8. une échéance sans assurance', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 9. Un déblocage : la banque au débit, 164000 au crédit, ni échéance ni intérêts ═════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
    values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := rapprocher_echeance_emprunt(credit.id, emp, null, 0, 0, deblocage);
    select string_agg(e.compte || ':' || e.sens || ':' || e.montant::text, ',' order by e.compte) into obs
      from ecritures_brouillon e where e.ligne_bancaire_id = credit.id and e.piece_id is null;
    select n = 2 and obs = '164000:credit:' || credit.montant::text || ',512000:debit:' || credit.montant::text
           and l.statut = 'rapprochee' and l.emprunt_id = emp and l.emprunt_echeance is null
           and l.emprunt_interets = 0 and l.emprunt_assurance = 0
      into ok from lignes_bancaires l where l.id = credit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('9. un déblocage', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 10. Un second rapprochement REMPLACE le premier et libère l'échéance qu'il occupait ═══════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
    values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform rapprocher_echeance_emprunt(debit.id, emp, 1, i, a, ecriture);
    n := rapprocher_echeance_emprunt(debit.id, emp, 2, i, 0, ecriture_sans_assurance);
    -- L'échéance 1, libérée, se rapproche d'un autre mouvement.
    perform rapprocher_echeance_emprunt(debit2.id, emp, 1, i2, 0, ecriture2);
    select count(*)::text into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 3 and obs = '3' and l.emprunt_echeance = 2 and l.emprunt_assurance = 0
      into ok from lignes_bancaires l where l.id = debit.id;
    ok := ok and (select l.emprunt_echeance = 1 from lignes_bancaires l where l.id = debit2.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('10. le second rapprochement remplace', 'lignes : ' || coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 11. Le retrait défait le rapprochement ET son écriture ════════════════════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
    values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform rapprocher_echeance_emprunt(debit.id, emp, 1, i, a, ecriture);
    n := retirer_echeance_emprunt(debit.id);
    select count(*)::text into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 4 and obs = '0' and l.statut = 'non_rapprochee' and l.emprunt_id is null and l.emprunt_echeance is null
           and l.emprunt_interets is null and l.emprunt_assurance is null
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('11. le retrait défait les deux', 'retirées : ' || coalesce(n::text, '?') || ', restantes : ' || coalesce(obs, '?'),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 12. Une échéance ne se rapproche que d'un mouvement ══════════════════════════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
    values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform rapprocher_echeance_emprunt(debit.id, emp, 1, i, a, ecriture);
    perform rapprocher_echeance_emprunt(debit2.id, emp, 1, i2, 0, ecriture2);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('12. échéance déjà rapprochée', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '23505'
    and message = 'L''échéance n° 1 de cet emprunt est déjà rapprochée du mouvement du ' || to_char(debit.date, 'DD/MM/YYYY') || '.');

  -- ══ 13. Un emprunt d'un autre dossier ════════════════════════════════════════════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
    values (du_client.dossier_id, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp_autre;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform rapprocher_echeance_emprunt(debit.id, emp_autre, 1, i, a, ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('13. emprunt d''un autre dossier', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = 'Cet emprunt n''existe pas pour ce dossier.');

  -- ══ 14 à 21. Le découpage que la base refuse, chacun pour SA raison ═══════════════════════════════
  for obs, message in
    select * from (values
      ('14. échéance zéro', 'L''échéance doit être comprise entre 1 et 60 pour cet emprunt.'),
      ('15. échéance au-delà de la durée', 'L''échéance doit être comprise entre 1 et 60 pour cet emprunt.'),
      ('16. échéance absente', 'L''échéance doit être comprise entre 1 et 60 pour cet emprunt.'),
      ('17. intérêts et assurance au-delà du prélèvement', 'Découpage impossible%'),
      ('18. intérêts pas au centime', 'Découpage impossible%'),
      ('19. intérêts négatifs', 'Découpage impossible%'),
      ('20. déblocage avec intérêts', 'Un encaissement rattaché à un emprunt en est le déblocage%'),
      ('21. déblocage avec une échéance', 'Un encaissement rattaché à un emprunt en est le déblocage%')
    ) as cas(nom, attendu)
  loop
    accepte := false; code_recu := null;
    declare attendu text := message; recu text;
    begin
      begin
        insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
        values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        case substring(obs from '^(\d+)')
          when '14' then perform rapprocher_echeance_emprunt(debit.id, emp, 0, i, a, ecriture);
          when '15' then perform rapprocher_echeance_emprunt(debit.id, emp, 61, i, a, ecriture);
          when '16' then perform rapprocher_echeance_emprunt(debit.id, emp, null, i, a, ecriture);
          when '17' then perform rapprocher_echeance_emprunt(debit.id, emp, 1, tot, 0.01, ecriture);
          when '18' then perform rapprocher_echeance_emprunt(debit.id, emp, 1, i + 0.001, a, ecriture);
          when '19' then perform rapprocher_echeance_emprunt(debit.id, emp, 1, -1, a, ecriture);
          when '20' then perform rapprocher_echeance_emprunt(credit.id, emp, null, 1, 0, deblocage);
          else perform rapprocher_echeance_emprunt(credit.id, emp, 1, 0, 0, deblocage);
        end case;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      insert into essai_emprunt values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = '22023' and recu like attendu);
    end;
  end loop;

  -- ══ 22 à 28. Les écritures que la base refuse, chacune pour SA raison ════════════════════════════
  for obs, lignes_essai, message in
    select * from (values
      ('22. pas un tableau', jsonb_build_object('compte', '512000'), 'L''écriture proposée est incomplète.'),
      ('23. une ligne de trop', ecriture || jsonb_build_array(
         jsonb_build_object('compte', '616800', 'sens', 'debit', 'montant', 0.01)),
       'L''écriture proposée ne correspond pas à ce mouvement et à ce découpage.'),
      ('24. une ligne à zéro euro', ecriture_sans_assurance || jsonb_build_array(
         jsonb_build_object('compte', '616800', 'sens', 'debit', 'montant', 0)),
       'L''écriture proposée ne correspond pas à ce mouvement et à ce découpage.'),
      ('25. capital au mauvais montant', jsonb_build_array(
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
         jsonb_build_object('compte', '164000', 'sens', 'debit', 'montant', cap + 0.01),
         jsonb_build_object('compte', '661100', 'sens', 'debit', 'montant', i - 0.01),
         jsonb_build_object('compte', '616800', 'sens', 'debit', 'montant', a)),
       'L''écriture proposée ne correspond pas à ce mouvement et à ce découpage.'),
      ('26. intérêts sur un autre compte', jsonb_build_array(
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
         jsonb_build_object('compte', '164000', 'sens', 'debit', 'montant', cap),
         jsonb_build_object('compte', '661000', 'sens', 'debit', 'montant', i),
         jsonb_build_object('compte', '616800', 'sens', 'debit', 'montant', a)),
       'L''écriture proposée ne correspond pas à ce mouvement et à ce découpage.'),
      ('27. banque dans le mauvais sens', jsonb_build_array(
         jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', tot),
         jsonb_build_object('compte', '164000', 'sens', 'credit', 'montant', cap),
         jsonb_build_object('compte', '661100', 'sens', 'credit', 'montant', i),
         jsonb_build_object('compte', '616800', 'sens', 'credit', 'montant', a)),
       'L''écriture proposée ne correspond pas à ce mouvement et à ce découpage.'),
      ('28. l''écriture d''un autre découpage', ecriture_sans_assurance,
       'L''écriture proposée ne correspond pas à ce mouvement et à ce découpage.')
    ) as cas(nom, lignes, attendu)
  loop
    accepte := false; code_recu := null;
    declare attendu text := message; recu text;
    begin
      begin
        insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
        values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        -- Le contrôle 24 déclare une échéance sans assurance, tous les autres le découpage complet.
        perform rapprocher_echeance_emprunt(debit.id, emp, 1, i, case when obs like '24.%' then 0 else a end, lignes_essai);
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      insert into essai_emprunt values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = '22023' and recu = attendu);
    end;
  end loop;

  -- ══ 29 à 32. Les mouvements que la base refuse ═══════════════════════════════════════════════════
  for obs in select unnest(array['29. mouvement rapproché d''une pièce', '30. mouvement affecté à une catégorie',
                                 '31. mouvement classé en virement personnel', '32. mouvement de zéro euro']) loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
      values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
      if obs like '32.%' then
        update lignes_bancaires set montant = 0 where id = debit.id;
      end if;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      if obs like '29.%' then
        perform rapprocher_echeance_emprunt(avec_piece.id, emp, case when avec_piece.montant < 0 then 1 end, 0, 0,
          jsonb_build_array(
            jsonb_build_object('compte', '512000', 'sens', case when avec_piece.montant >= 0 then 'debit' else 'credit' end, 'montant', abs(avec_piece.montant)),
            jsonb_build_object('compte', '164000', 'sens', case when avec_piece.montant >= 0 then 'credit' else 'debit' end, 'montant', abs(avec_piece.montant))));
      elsif obs like '30.%' then
        perform affecter_mouvement_bancaire(debit.id, cat_frais.id, jsonb_build_array(
          jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', tot),
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot)));
        perform rapprocher_echeance_emprunt(debit.id, emp, 1, i, a, ecriture);
      elsif obs like '31.%' then
        perform classer_virement_personnel(debit.id, jsonb_build_array(
          jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', tot),
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot)));
        perform rapprocher_echeance_emprunt(debit.id, emp, 1, i, a, ecriture);
      else
        perform rapprocher_echeance_emprunt(debit.id, emp, 1, 0, 0, jsonb_build_array());
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_emprunt values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '22023' and message = case when obs like '32.%'
        then 'Un mouvement de zéro euro n''a rien à écrire.'
        else 'Ce mouvement est rapproché d''une pièce ou d''une cotisation, affecté à une catégorie ou classé en virement personnel : annule d''abord ce classement.' end);
  end loop;

  -- ══ 33. Retirer ce qui n'est rapproché d'aucun emprunt ═══════════════════════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform retirer_echeance_emprunt(avec_piece.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('33. retirer un mouvement sans emprunt', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = 'Ce mouvement n''est rapproché d''aucun emprunt.');

  -- ══ 34 et 35. Une écriture VALIDÉE ne se remplace ni ne se retire ══════════════════════════════════
  for obs in select unnest(array['34. écriture validée : pas de nouveau rapprochement', '35. écriture validée : pas de retrait']) loop
    accepte := false; code_recu := null; message := null;
    begin
      insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
      values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform rapprocher_echeance_emprunt(debit.id, emp, 1, i, a, ecriture);
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
      if obs like '34.%' then
        perform rapprocher_echeance_emprunt(debit.id, emp, 2, i, a, ecriture);
      else
        perform retirer_echeance_emprunt(debit.id);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_emprunt values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '23514' and message = case when obs like '34.%'
        then 'L''écriture de ce mouvement est validée : elle ne se remplace plus.'
        else 'L''écriture de ce mouvement est validée : elle ne se retire plus.' end);
  end loop;

  -- ══ 36 à 40. Ce qui ne connaît pas l'emprunt se heurte à une contrainte NOMMÉE ═════════════════════
  -- `affecter_mouvement_bancaire`, `classer_virement_personnel` et les mises à jour directes de l'écran
  -- Banque (associer une pièce, remettre à traiter, ignorer) ne lisent pas `emprunt_id`. Sur un
  -- mouvement rapproché d'un emprunt, c'est la base qui refuse : jamais une écriture de catégorie ou de
  -- virement posée par-dessus celle de l'échéance, jamais un mouvement « à traiter » qui garde son
  -- emprunt. L'écran ne les propose pas sur un tel mouvement ; ces refus sont la ceinture d'une course.
  for obs, message in
    select * from (values
      ('36. affecter une catégorie', 'lignes_bancaires_un_seul_rapprochement'),
      ('37. classer en virement personnel', 'lignes_bancaires_emprunt_rapproche'),
      ('38. associer une pièce (écran Banque)', 'lignes_bancaires_un_seul_rapprochement'),
      ('39. remettre à traiter (écran Banque)', 'lignes_bancaires_emprunt_rapproche'),
      ('40. ignorer (écran Banque)', 'lignes_bancaires_emprunt_rapproche')
    ) as cas(nom, contrainte)
  loop
    accepte := false; code_recu := null;
    declare contrainte text := message; recu text;
    begin
      begin
        insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
        values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        perform rapprocher_echeance_emprunt(debit.id, emp, 1, i, a, ecriture);
        case substring(obs from '^(\d+)')
          when '36' then
            perform affecter_mouvement_bancaire(debit.id, cat_frais.id, jsonb_build_array(
              jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', tot),
              jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot)));
          when '37' then
            perform classer_virement_personnel(debit.id, jsonb_build_array(
              jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', tot),
              jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot)));
          when '38' then
            update lignes_bancaires set statut = 'rapprochee', piece_id = avec_piece.piece_id, cotisation_id = null
             where id = debit.id;
          when '39' then
            update lignes_bancaires set statut = 'non_rapprochee', piece_id = null, cotisation_id = null,
                   prelevement_personnel = false
             where id = debit.id;
          else
            update lignes_bancaires set statut = 'ignoree', piece_id = null where id = debit.id;
        end case;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      insert into essai_emprunt values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = '23514' and recu like '%"' || contrainte || '"%');
    end;
  end loop;

  -- ══ 41 à 47. Les contraintes tiennent SANS les fonctions (mises à jour directes) ════════════════════
  for obs, message in
    select * from (values
      ('41. assurance absente', 'lignes_bancaires_decoupage_emprunt'),
      ('42. échéance absente sur une sortie', 'lignes_bancaires_decoupage_emprunt'),
      ('43. intérêts et assurance au-delà du prélèvement', 'lignes_bancaires_decoupage_emprunt'),
      ('44. échéance sur un déblocage', 'lignes_bancaires_decoupage_emprunt'),
      ('45. emprunt sur un mouvement à traiter', 'lignes_bancaires_emprunt_rapproche'),
      ('46. emprunt ET pièce', 'lignes_bancaires_un_seul_rapprochement'),
      ('47. la même échéance sur deux mouvements', 'lignes_bancaires_echeance_emprunt_unique')
    ) as cas(nom, contrainte)
  loop
    accepte := false; code_recu := null;
    declare contrainte text := message; recu text;
    begin
      begin
        insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
        values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
        case substring(obs from '^(\d+)')
          when '41' then
            update lignes_bancaires set statut = 'rapprochee', emprunt_id = emp, emprunt_echeance = 1,
                   emprunt_interets = 0, emprunt_assurance = null where id = debit.id;
          when '42' then
            update lignes_bancaires set statut = 'rapprochee', emprunt_id = emp, emprunt_echeance = null,
                   emprunt_interets = 0, emprunt_assurance = 0 where id = debit.id;
          when '43' then
            update lignes_bancaires set statut = 'rapprochee', emprunt_id = emp, emprunt_echeance = 1,
                   emprunt_interets = tot, emprunt_assurance = 0.01 where id = debit.id;
          when '44' then
            update lignes_bancaires set statut = 'rapprochee', emprunt_id = emp, emprunt_echeance = 1,
                   emprunt_interets = 0, emprunt_assurance = 0 where id = credit.id;
          when '45' then
            update lignes_bancaires set statut = 'non_rapprochee', emprunt_id = emp, emprunt_echeance = 1,
                   emprunt_interets = 0, emprunt_assurance = 0 where id = debit.id;
          when '46' then
            update lignes_bancaires set emprunt_id = emp,
                   emprunt_echeance = case when montant < 0 then 1 end,
                   emprunt_interets = 0, emprunt_assurance = 0 where id = avec_piece.id;
          else
            update lignes_bancaires set statut = 'rapprochee', emprunt_id = emp, emprunt_echeance = 1,
                   emprunt_interets = 0, emprunt_assurance = 0 where id in (debit.id, debit2.id);
        end case;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      insert into essai_emprunt values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = case when obs like '47.%' then '23505' else '23514' end
        and recu like '%"' || contrainte || '"%');
    end;
  end loop;

  -- ══ 48. Un emprunt dont une échéance est rapprochée ne se supprime pas ════════════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
    values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform rapprocher_echeance_emprunt(debit.id, emp, 1, i, a, ecriture);
    delete from emprunts where id = emp;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('48. emprunt rapproché : pas de suppression', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '23503' and message like '%"lignes_bancaires_emprunt_id_fkey"%');

  -- ══ 49. Supprimer un DOSSIER emporte ses emprunts rapprochés : la clé sans action ne bloque pas ════
  -- Un dossier jetable, créé et supprimé DANS la sous-transaction : ses mouvements et ses emprunts partent
  -- par la même cascade, et une clé NO ACTION ne se vérifie qu'à la fin de l'instruction — donc après.
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into dossiers (nom, cabinet_id) values ('Dossier d''essai (emprunt)', (select cabinet_id from dossiers where id = dossier_test))
      returning id into dossier_jetable;
    insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
    values (dossier_jetable, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
    insert into lignes_bancaires (dossier_id, date, libelle, montant)
    values (dossier_jetable, '2025-02-05', 'ECHEANCE PRET ESSAI', -300) returning id into ligne_jetable;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform rapprocher_echeance_emprunt(ligne_jetable, emp, 1, 50, 10, jsonb_build_array(
      jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', 300),
      jsonb_build_object('compte', '164000', 'sens', 'debit', 'montant', 240),
      jsonb_build_object('compte', '661100', 'sens', 'debit', 'montant', 50),
      jsonb_build_object('compte', '616800', 'sens', 'debit', 'montant', 10)));
    reset role;
    delete from dossiers where id = dossier_jetable;
    select (select count(*) from emprunts where id = emp) = 0
       and (select count(*) from lignes_bancaires where id = ligne_jetable) = 0
       and (select count(*) from ecritures_brouillon where dossier_id = dossier_jetable) = 0
      into ok;
    obs := 'dossier supprimé, emprunt et mouvement partis : ' || ok::text;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_emprunt values ('49. supprimer le dossier emporte ses emprunts', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 50. Rien n'est resté ══════════════════════════════════════════════════════════════════════════
  select count(*) into nb_apres from ecritures_brouillon;
  select string_agg(concat_ws(':', l.id, l.statut, l.piece_id, l.categorie_id, l.prelevement_personnel, l.montant,
                              l.emprunt_id, l.emprunt_echeance, l.emprunt_interets, l.emprunt_assurance), '|' order by l.id)
    into etat_apres from lignes_bancaires l where l.id in (debit.id, debit2.id, credit.id, avec_piece.id);
  insert into essai_emprunt values ('50. rien n''est resté en base',
    'écritures ' || nb_avant || ' -> ' || nb_apres || ', mouvements ' || (etat_avant = etat_apres)::text
      || ', emprunts ' || emprunts_avant || ' -> ' || (select count(*) from emprunts)
      || ', dossiers ' || dossiers_avant || ' -> ' || (select count(*) from dossiers),
    nb_avant = nb_apres and etat_avant = etat_apres
      and emprunts_avant = (select count(*) from emprunts) and dossiers_avant = (select count(*) from dossiers));
end $$;

select controle, ok, observe from essai_emprunt order by
  (regexp_match(controle, '^(\d+)'))[1]::int, controle;
