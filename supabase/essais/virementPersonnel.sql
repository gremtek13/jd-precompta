-- LE VIREMENT PERSONNEL ET SON ÉCRITURE, ÉPROUVÉS EN BASE — à rejouer par `execute_sql` après toute
-- migration qui touche `classer_virement_personnel`, `retirer_virement_personnel`, le modèle comptable
-- d'un dossier ou les contraintes de `lignes_bancaires` (ligne 26.6 de la feuille de route, étape a).
--
-- Les deux fonctions classent un mouvement ET écrivent (ou retirent) son écriture en une transaction.
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI peut : un anonyme n'a pas le droit d'appeler, un compte rattaché à rien et un client se
--     font refuser — le client sur le dossier d'un autre comme sur le SIEN —, et le chef du cabinet
--     écrit bien (le contrôle POSITIF, sans lequel les refus seraient satisfaits par une fonction qui
--     refuse tout le monde) ;
--   - CE QUI s'écrit : le compte du dirigeant face à la banque, au montant, à la date et dans le sens
--     du mouvement — 108000 en trésorerie, le compte choisi pour le dirigeant en engagement ; un second
--     classement REMPLACE le premier ; un retrait défait les deux ; un virement classé AVANT cette
--     migration, donc sans écriture, s'écrit ;
--   - CE QUI est refusé, avec sa RAISON : une écriture qui ne correspond pas au mouvement ou au compte
--     du dossier, une écriture déséquilibrée, un mouvement rapproché ou affecté, un mouvement de zéro
--     euro, une écriture validée ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Chaque écriture d'essai est annulée par sous-transaction (`raise exception 'ANNULATION_ESSAI'`,
-- P0001), le verdict étant posé dans une VARIABLE avant le `raise` — le mécanisme de rls.sql. Un refus
-- se juge à son code ET à son message : un P0001 sans rapport ressemblerait sinon à un refus.
--
-- ÉPROUVÉ LE 29/09/2026 : 28 contrôles sur 28. Et l'essai sait échouer : sans les `set local role`,
-- les contrôles 1 et 2 virent au rouge (l'appel passe le droit d'exécution, et c'est la fonction qui
-- refuse, avec un autre message). Les contrôles 3 à 6 restent verts sous cette mutation, et c'est
-- attendu : leur refus vient du contrôle d'accès de la fonction, qui lit la session et non le rôle.
drop table if exists essai_virement;
create temp table essai_virement (controle text, observe text, ok boolean);

do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  debit record; credit record; du_client record; avec_piece record; ancien record; ignoree record;
  cat_frais record;
  accepte boolean; code_recu text; message text; obs text; ok boolean;
  n int; nb_avant int; nb_apres int; etat_avant text; etat_apres text;

  -- L'écriture qu'un classement du débit doit porter en trésorerie : 108000 au débit, la banque au
  -- crédit. Les refus composent la leur dans `lignes_essai` et laissent celle-ci intacte.
  ecriture jsonb;
  lignes_essai jsonb;
begin
  select * into debit from lignes_bancaires
   where dossier_id = dossier_test and statut = 'non_rapprochee' and montant < 0 order by date, id limit 1;
  select * into credit from lignes_bancaires
   where dossier_id = dossier_test and statut = 'non_rapprochee' and montant > 0 order by date, id limit 1;
  select l.* into du_client from lignes_bancaires l
    join memberships m on m.dossier_id = l.dossier_id
   where m.user_id = client order by l.date, l.id limit 1;
  select * into avec_piece from lignes_bancaires
   where dossier_id = dossier_test and piece_id is not null and statut = 'rapprochee' order by id limit 1;
  -- Un virement classé avant la migration : ignoré, personnel, sans aucune écriture.
  select l.* into ancien from lignes_bancaires l
   where l.dossier_id = dossier_test and l.prelevement_personnel and l.statut = 'ignoree'
     and not exists (select 1 from ecritures_brouillon e where e.ligne_bancaire_id = l.id)
   order by l.id limit 1;
  -- Un mouvement ignoré par une règle « toujours ignorer », donc pas personnel.
  select * into ignoree from lignes_bancaires
   where dossier_id = dossier_test and statut = 'ignoree' and not prelevement_personnel and montant <> 0
   order by id limit 1;
  select * into cat_frais from categories where code = 'frais_bancaires' and dossier_id is null;
  if debit.id is null or credit.id is null or du_client.id is null or avec_piece.id is null
     or ancien.id is null or ignoree.id is null or cat_frais.id is null then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;
  if exists (select 1 from ecritures_brouillon where dossier_id = dossier_test) then
    -- Le passage en engagement (contrôles 19 et 20) exige un brouillon vide : le déclencheur
    -- `dossiers_verrouiller_modele_comptable` refuserait sinon, et l'essai mentirait sur la raison.
    raise exception 'ESSAI_IMPOSSIBLE : le dossier test porte des écritures';
  end if;
  select count(*) into nb_avant from ecritures_brouillon;
  select string_agg(concat_ws(':', l.id, l.statut, l.prelevement_personnel, l.montant), '|' order by l.id)
    into etat_avant from lignes_bancaires l where l.id in (debit.id, credit.id, ancien.id, ignoree.id, avec_piece.id);

  ecriture := jsonb_build_array(
    jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', abs(debit.montant), 'libelle', 'essai'),
    jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant), 'libelle', 'essai'));

  -- ══ 1 et 2. Anonyme : pas d'EXECUTE, ni pour classer ni pour retirer ══════════════════════════
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform classer_virement_personnel(debit.id, ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('1. anonyme, classer', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message like 'permission denied%');

  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform retirer_virement_personnel(ancien.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('2. anonyme, retirer', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message like 'permission denied%');

  -- ══ 3 à 6. Rattaché à rien, client sur le dossier d'un autre, client sur le sien ═══════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform classer_virement_personnel(debit.id, ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('3. rattaché à rien', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform classer_virement_personnel(debit.id, ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('4. client, dossier d''un autre', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform classer_virement_personnel(du_client.id, jsonb_build_array(
      jsonb_build_object('compte', '108000', 'sens', case when du_client.montant >= 0 then 'credit' else 'debit' end, 'montant', abs(du_client.montant)),
      jsonb_build_object('compte', '512000', 'sens', case when du_client.montant >= 0 then 'debit' else 'credit' end, 'montant', abs(du_client.montant))));
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('5. client, son propre dossier', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform retirer_virement_personnel(du_client.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('6. client, retirer sur son dossier', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  -- ══ 7. Le chef classe un prélèvement : 108000 au débit, la banque au crédit ═══════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    n := classer_virement_personnel(debit.id, ecriture);
    select string_agg(e.compte || ':' || e.sens || ':' || e.montant::text || ':' || (e.date = debit.date)::text, ',' order by e.compte)
      into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 2 and l.statut = 'ignoree' and l.prelevement_personnel
           and obs = '108000:debit:' || abs(debit.montant)::text || ':true,512000:credit:' || abs(debit.montant)::text || ':true'
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('7. le chef classe un prélèvement', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 8. Un apport : la banque au débit, 108000 au crédit ═══════════════════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    perform classer_virement_personnel(credit.id, jsonb_build_array(
      jsonb_build_object('compte', '108000', 'sens', 'credit', 'montant', credit.montant),
      jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', credit.montant)));
    select string_agg(e.compte || ':' || e.sens, ',' order by e.compte) into obs
      from ecritures_brouillon e where e.ligne_bancaire_id = credit.id and e.piece_id is null;
    ok := obs = '108000:credit,512000:debit';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('8. un apport de l''exploitant', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 9. Un second classement REMPLACE le premier ═══════════════════════════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    perform classer_virement_personnel(debit.id, ecriture);
    n := classer_virement_personnel(debit.id, ecriture);
    select count(*)::text into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    ok := n = 2 and obs = '2';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('9. le reclassement remplace', 'lignes : ' || coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 10. Le retrait défait le classement ET son écriture ═══════════════════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    perform classer_virement_personnel(debit.id, ecriture);
    n := retirer_virement_personnel(debit.id);
    select count(*)::text into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 2 and obs = '0' and l.statut = 'non_rapprochee' and not l.prelevement_personnel
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('10. le retrait défait les deux', 'retirées : ' || coalesce(n::text, '?') || ', restantes : ' || coalesce(obs, '?'),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 11. Un virement classé avant la migration, sans écriture, s'écrit ═════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    n := classer_virement_personnel(ancien.id, jsonb_build_array(
      jsonb_build_object('compte', '108000', 'sens', case when ancien.montant >= 0 then 'credit' else 'debit' end, 'montant', abs(ancien.montant)),
      jsonb_build_object('compte', '512000', 'sens', case when ancien.montant >= 0 then 'debit' else 'credit' end, 'montant', abs(ancien.montant))));
    select count(*)::text into obs from ecritures_brouillon e where e.ligne_bancaire_id = ancien.id and e.piece_id is null;
    select n = 2 and obs = '2' and l.statut = 'ignoree' and l.prelevement_personnel
      into ok from lignes_bancaires l where l.id = ancien.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('11. un virement déjà classé s''écrit', 'lignes : ' || coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 12. Un mouvement ignoré par une règle devient un virement personnel écrit ══════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    n := classer_virement_personnel(ignoree.id, jsonb_build_array(
      jsonb_build_object('compte', '108000', 'sens', case when ignoree.montant >= 0 then 'credit' else 'debit' end, 'montant', abs(ignoree.montant)),
      jsonb_build_object('compte', '512000', 'sens', case when ignoree.montant >= 0 then 'debit' else 'credit' end, 'montant', abs(ignoree.montant))));
    select l.prelevement_personnel and l.statut = 'ignoree' and n = 2 into ok from lignes_bancaires l where l.id = ignoree.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('12. un mouvement ignoré devient personnel', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 13 à 18. Les écritures que la base refuse, chacune pour SA raison ═════════════════════════
  for obs, lignes_essai, message in
    select * from (values
      ('13. une seule ligne', jsonb_build_array(
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))),
       'L''écriture proposée est incomplète.'),
      ('14. banque au mauvais montant', jsonb_build_array(
         jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', abs(debit.montant) + 1),
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant) + 1)),
       'L''écriture proposée ne correspond pas à ce mouvement et au compte du dirigeant (108000).'),
      ('15. banque dans le mauvais sens', jsonb_build_array(
         jsonb_build_object('compte', '108000', 'sens', 'credit', 'montant', abs(debit.montant)),
         jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', abs(debit.montant))),
       'L''écriture proposée ne correspond pas à ce mouvement et au compte du dirigeant (108000).'),
      ('16. un autre compte que celui du dossier', jsonb_build_array(
         jsonb_build_object('compte', '455000', 'sens', 'debit', 'montant', abs(debit.montant)),
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))),
       'L''écriture proposée ne correspond pas à ce mouvement et au compte du dirigeant (108000).'),
      ('17. sans ligne de banque', jsonb_build_array(
         jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', abs(debit.montant)),
         jsonb_build_object('compte', '108000', 'sens', 'credit', 'montant', abs(debit.montant))),
       'L''écriture proposée ne correspond pas à ce mouvement et au compte du dirigeant (108000).'),
      ('18. déséquilibrée d''un centime', jsonb_build_array(
         jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', abs(debit.montant) - 0.01),
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))),
       'Écriture déséquilibrée%')
    ) as cas(nom, lignes, attendu)
  loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    accepte := false; code_recu := null;
    declare attendu text := message; recu text;
    begin
      begin
        perform classer_virement_personnel(debit.id, lignes_essai);
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      insert into essai_virement values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu in ('22023', '23514') and recu like attendu);
    end;
  end loop;

  -- ══ 19 et 20. En engagement, le compte est celui choisi pour le dirigeant ═════════════════════
  -- Le dossier passe en engagement DANS la sous-transaction, donc en ressort tel qu'il était.
  for obs in select unnest(array['19. engagement : le compte du dirigeant (455000)', '20. engagement : 108000 refusé']) loop
    accepte := false; code_recu := null; message := null; ok := false;
    declare recu text; lignes text;
    begin
      begin
        update dossiers set mode_comptable = 'engagement', compte_notes_de_frais = '455000' where id = dossier_test;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        perform classer_virement_personnel(debit.id, jsonb_build_array(
          jsonb_build_object('compte', case when obs like '19.%' then '455000' else '108000' end, 'sens', 'debit', 'montant', abs(debit.montant)),
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))));
        select string_agg(e.compte || ':' || e.sens, ',' order by e.compte) into lignes
          from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
        ok := lignes = '455000:debit,512000:credit';
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      if obs like '19.%' then
        insert into essai_virement values (obs, coalesce(lignes, coalesce(code_recu, '?') || ' ' || coalesce(recu, '')),
          accepte and code_recu = 'P0001' and coalesce(ok, false));
      else
        insert into essai_virement values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
          not accepte and code_recu = '22023'
          and recu = 'L''écriture proposée ne correspond pas à ce mouvement et au compte du dirigeant (455000).');
      end if;
    end;
  end loop;

  -- ══ 21 à 23. Les mouvements que la base refuse ════════════════════════════════════════════════
  -- 21. Un mouvement rapproché d'une pièce
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform classer_virement_personnel(avec_piece.id, jsonb_build_array(
      jsonb_build_object('compte', '108000', 'sens', case when avec_piece.montant >= 0 then 'credit' else 'debit' end, 'montant', abs(avec_piece.montant)),
      jsonb_build_object('compte', '512000', 'sens', case when avec_piece.montant >= 0 then 'debit' else 'credit' end, 'montant', abs(avec_piece.montant))));
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('21. mouvement rapproché d''une pièce', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023'
    and message = 'Ce mouvement est rapproché d''une pièce ou d''une échéance, ou affecté à une catégorie : annule d''abord ce classement.');

  -- 22. Un mouvement affecté à une catégorie
  accepte := false; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform affecter_mouvement_bancaire(debit.id, cat_frais.id, jsonb_build_array(
      jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', abs(debit.montant)),
      jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))));
    perform classer_virement_personnel(debit.id, ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('22. mouvement affecté à une catégorie', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023'
    and message = 'Ce mouvement est rapproché d''une pièce ou d''une échéance, ou affecté à une catégorie : annule d''abord ce classement.');

  -- 23. Un mouvement de zéro euro (montant ramené à zéro DANS la sous-transaction)
  accepte := false; code_recu := null; message := null;
  begin
    update lignes_bancaires set montant = 0 where id = debit.id;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform classer_virement_personnel(debit.id, ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('23. mouvement de zéro euro', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = 'Un mouvement de zéro euro n''a rien à écrire.');

  -- 24. Retirer ce qui n'est pas un virement personnel
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform retirer_virement_personnel(ignoree.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('24. retirer un mouvement non personnel', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = 'Ce mouvement n''est pas classé en virement personnel.');

  -- ══ 25 et 26. Une écriture VALIDÉE ne se remplace ni ne se retire ══════════════════════════════
  for obs in select unnest(array['25. écriture validée : pas de reclassement', '26. écriture validée : pas de retrait']) loop
    accepte := false; code_recu := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform classer_virement_personnel(debit.id, ecriture);
      reset role;
      update ecritures_brouillon set statut = 'validee' where ligne_bancaire_id = debit.id and piece_id is null;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      if obs like '25.%' then
        perform classer_virement_personnel(debit.id, ecriture);
      else
        perform retirer_virement_personnel(debit.id);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_virement values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '23514' and message like 'L''écriture de ce mouvement est validée%');
  end loop;

  -- ══ 27. Un virement personnel écrit ne s'affecte pas à une catégorie ══════════════════════════
  -- L'affectation le refuse d'elle-même : sans quoi l'affecter laisserait l'écriture du virement
  -- remplacée en silence par celle de la catégorie, sur un mouvement encore marqué personnel.
  accepte := false; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform classer_virement_personnel(debit.id, ecriture);
    perform affecter_mouvement_bancaire(debit.id, cat_frais.id, jsonb_build_array(
      jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', abs(debit.montant)),
      jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))));
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_virement values ('27. un virement écrit ne s''affecte pas', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message like '%ou classé en virement personnel : annule d''abord ce classement.');

  -- ══ 28. Rien n'est resté ══════════════════════════════════════════════════════════════════════
  select count(*) into nb_apres from ecritures_brouillon;
  select string_agg(concat_ws(':', l.id, l.statut, l.prelevement_personnel, l.montant), '|' order by l.id)
    into etat_apres from lignes_bancaires l where l.id in (debit.id, credit.id, ancien.id, ignoree.id, avec_piece.id);
  insert into essai_virement values ('28. rien n''est resté en base',
    'écritures ' || nb_avant || ' -> ' || nb_apres || ', mouvements ' || (etat_avant = etat_apres)::text
      || ', dossier ' || (select mode_comptable || ':' || compte_notes_de_frais from dossiers where id = dossier_test),
    nb_avant = nb_apres and etat_avant = etat_apres
      and (select mode_comptable = 'tresorerie' from dossiers where id = dossier_test));
end $$;

select controle, ok, observe from essai_virement order by
  (regexp_match(controle, '^(\d+)'))[1]::int, controle;
