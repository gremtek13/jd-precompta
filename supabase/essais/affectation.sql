-- L'AFFECTATION D'UN MOUVEMENT BANCAIRE, ÉPROUVÉE EN BASE — à rejouer par `execute_sql` après toute
-- migration qui touche `affecter_mouvement_bancaire`, `retirer_affectation_mouvement_bancaire` ou
-- les contraintes de `lignes_bancaires` (ligne 26.6 de la feuille de route, étape a).
--
-- Les deux fonctions écrivent un mouvement ET son écriture en une transaction. Ce qui se prouve ici,
-- et ne se relit pas :
--   - QUI peut : un anonyme n'a pas le droit d'appeler, un compte rattaché à rien et un client se
--     font refuser — le client sur le dossier d'un autre comme sur le SIEN, un client ne tient pas la
--     comptabilité —, et le chef du cabinet écrit bien (le contrôle POSITIF, sans lequel trois refus
--     seraient satisfaits par une fonction qui refuse tout le monde) ;
--   - CE QUI s'écrit : deux lignes, le compte de la catégorie et la banque, au montant et à la date du
--     mouvement, dans le bon sens ; une seconde affectation REMPLACE la première ; un retrait défait
--     les deux ;
--   - CE QUI est refusé, avec sa RAISON et non un simple échec : une écriture qui ne correspond pas au
--     mouvement, une écriture déséquilibrée, une catégorie sans compte de résultat ou d'un autre
--     dossier, une recette sur un dossier assujetti, un mouvement déjà rapproché, une écriture validée ;
--   - ce que les CONTRAINTES tiennent seules, sans passer par les fonctions ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Chaque écriture d'essai est annulée par sous-transaction (`raise exception 'ANNULATION_ESSAI'`,
-- P0001), le verdict étant posé dans une VARIABLE avant le `raise` : c'est le mécanisme de rls.sql,
-- qui a appris à ses dépens qu'un verdict rangé dans le gestionnaire d'exception ment. Et un refus se
-- juge à son code ET à son message : un P0001 sans rapport ressemblerait sinon à un refus.
drop table if exists essai_affectation;
create temp table essai_affectation (controle text, observe text, ok boolean);

do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  debit record; credit record; du_client record; avec_piece record;
  cat_frais record; cat_recettes record; cat_autre record;
  -- `code_recu` et non `code` : ce nom-là est aussi une colonne de `categories`, et plpgsql refuse
  -- l'ambiguïté (42702) dans chaque requête qui la lit.
  accepte boolean; code_recu text; message text; obs text; ok boolean;
  n int; nb_avant int; nb_apres int; etat_avant text; etat_apres text;

  -- L'écriture qu'une affectation du débit doit porter : le compte de la catégorie face à la banque,
  -- dans le sens du mouvement. Les refus 9 à 13 composent la leur dans `lignes_essai`, et laissent
  -- celle-ci intacte pour les contrôles qui suivent.
  ecriture jsonb;
  lignes_essai jsonb;
begin
  select * into debit from lignes_bancaires
   where dossier_id = dossier_test and statut = 'non_rapprochee' and montant < 0 order by date, id limit 1;
  select * into credit from lignes_bancaires
   where dossier_id = dossier_test and statut = 'non_rapprochee' and montant > 0 order by date, id limit 1;
  -- Un mouvement d'un dossier dont le client est MEMBRE — n'importe lequel : le premier de ses
  -- dossiers n'en porte aucun.
  select l.* into du_client from lignes_bancaires l
    join memberships m on m.dossier_id = l.dossier_id
   where m.user_id = client order by l.date, l.id limit 1;
  select * into avec_piece from lignes_bancaires
   where dossier_id = dossier_test and piece_id is not null and statut = 'rapprochee' order by id limit 1;
  select * into cat_frais from categories where code = 'frais_bancaires' and dossier_id is null;
  select * into cat_recettes from categories where code = 'ventes_prestations' and dossier_id is null;
  select * into cat_autre from categories where code = 'autre' and dossier_id is null;
  if debit.id is null or credit.id is null or du_client.id is null or avec_piece.id is null
     or cat_frais.id is null or cat_recettes.id is null or cat_autre.id is null then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;
  select count(*) into nb_avant from ecritures_brouillon;
  etat_avant := concat_ws('|', debit.statut, debit.categorie_id, credit.statut, credit.categorie_id);

  -- ══ 1. Anonyme : pas d'EXECUTE ════════════════════════════════════════════════════════════════
  ecriture := jsonb_build_array(
    jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', abs(debit.montant), 'libelle', 'essai'),
    jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant), 'libelle', 'essai'));
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform affecter_mouvement_bancaire(debit.id, cat_frais.id, ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_affectation values ('1. anonyme', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message like 'permission denied%');

  -- ══ 2 à 4. Rattaché à rien, client sur le dossier d'un autre, client sur le sien ═══════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform affecter_mouvement_bancaire(debit.id, cat_frais.id, ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_affectation values ('2. rattaché à rien', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform affecter_mouvement_bancaire(debit.id, cat_frais.id, ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_affectation values ('3. client, dossier d''un autre', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform affecter_mouvement_bancaire(du_client.id, cat_frais.id, jsonb_build_array(
      jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', case when du_client.montant >= 0 then 'credit' else 'debit' end, 'montant', abs(du_client.montant)),
      jsonb_build_object('compte', '512000', 'sens', case when du_client.montant >= 0 then 'debit' else 'credit' end, 'montant', abs(du_client.montant))));
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_affectation values ('4. client, son propre dossier', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  -- ══ 5. Le chef affecte : deux lignes, au montant, à la date et dans le sens du mouvement ═══════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    n := affecter_mouvement_bancaire(debit.id, cat_frais.id, ecriture);
    select string_agg(e.compte || ':' || e.sens || ':' || e.montant::text || ':' || (e.date = debit.date)::text, ',' order by e.compte)
      into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 2 and l.statut = 'rapprochee' and l.categorie_id = cat_frais.id
           and obs = '512000:credit:' || abs(debit.montant)::text || ':true,' || cat_frais.compte_comptable || ':debit:' || abs(debit.montant)::text || ':true'
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_affectation values ('5. le chef affecte un débit', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 6. Une seconde affectation REMPLACE la première ═══════════════════════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    perform affecter_mouvement_bancaire(debit.id, cat_frais.id, ecriture);
    n := affecter_mouvement_bancaire(debit.id, cat_autre.id, jsonb_build_array(
      jsonb_build_object('compte', cat_autre.compte_comptable, 'sens', 'debit', 'montant', abs(debit.montant)),
      jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))));
    select string_agg(e.compte, ',' order by e.compte) into obs
      from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 2 and l.categorie_id = cat_autre.id and obs = '512000,' || cat_autre.compte_comptable
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_affectation values ('6. la réaffectation remplace', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 7. Le retrait défait le mouvement ET son écriture ═════════════════════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    perform affecter_mouvement_bancaire(debit.id, cat_frais.id, ecriture);
    n := retirer_affectation_mouvement_bancaire(debit.id);
    select count(*)::text into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 2 and obs = '0' and l.statut = 'non_rapprochee' and l.categorie_id is null
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_affectation values ('7. le retrait défait les deux', 'retirées : ' || coalesce(n::text, '?') || ', restantes : ' || coalesce(obs, '?'),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 8. Une recette encaissée, dossier exonéré : 706 au crédit, banque au débit ════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    perform affecter_mouvement_bancaire(credit.id, cat_recettes.id, jsonb_build_array(
      jsonb_build_object('compte', cat_recettes.compte_comptable, 'sens', 'credit', 'montant', credit.montant),
      jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', credit.montant)));
    select string_agg(e.compte || ':' || e.sens, ',' order by e.compte) into obs
      from ecritures_brouillon e where e.ligne_bancaire_id = credit.id and e.piece_id is null;
    ok := obs = '512000:debit,' || cat_recettes.compte_comptable || ':credit';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_affectation values ('8. une recette, dossier exonéré', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 9 à 13. Les écritures que la base refuse, chacune pour SA raison ═══════════════════════════
  for obs, lignes_essai, message in
    select * from (values
      ('9. banque au mauvais montant', jsonb_build_array(
         jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', abs(debit.montant) + 1),
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant) + 1)),
       'L''écriture proposée ne correspond pas à ce mouvement et à cette catégorie.'),
      ('10. banque dans le mauvais sens', jsonb_build_array(
         jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'credit', 'montant', abs(debit.montant)),
         jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', abs(debit.montant))),
       'L''écriture proposée ne correspond pas à ce mouvement et à cette catégorie.'),
      ('11. une ligne sur un autre compte', jsonb_build_array(
         jsonb_build_object('compte', '606100', 'sens', 'debit', 'montant', abs(debit.montant)),
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))),
       'L''écriture proposée ne correspond pas à ce mouvement et à cette catégorie.'),
      ('12. sans ligne de banque', jsonb_build_array(
         jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', abs(debit.montant)),
         jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'credit', 'montant', abs(debit.montant))),
       'L''écriture proposée ne correspond pas à ce mouvement et à cette catégorie.'),
      ('13. déséquilibrée d''un centime', jsonb_build_array(
         jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', abs(debit.montant) - 0.01),
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
        perform affecter_mouvement_bancaire(debit.id, cat_frais.id, lignes_essai);
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      insert into essai_affectation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu in ('22023', '23514') and recu like attendu);
    end;
  end loop;

  -- ══ 14 à 17. Les catégories et les mouvements que la base refuse ═══════════════════════════════
  -- Catégorie sans compte, catégorie de bilan, catégorie d'un autre dossier : créées DANS la
  -- sous-transaction, donc défaites avec elle.
  for obs, message in
    select * from (values
      ('14. catégorie sans compte', 'La catégorie « %» n''a pas de compte de charge ou de produit (classe 6 ou 7).'),
      ('15. catégorie de bilan (108)', 'La catégorie « %» n''a pas de compte de charge ou de produit (classe 6 ou 7).'),
      ('16. catégorie d''un autre dossier', 'Cette catégorie n''existe pas pour ce dossier.'),
      ('17. recette, dossier assujetti', 'Sur un dossier assujetti à la TVA, une recette sans facture%')
    ) as cas(nom, attendu)
  loop
    accepte := false; code_recu := null;
    declare attendu text := message; recu text; cat uuid;
    begin
      begin
        if obs like '14.%' then
          insert into categories (dossier_id, code, libelle, ordre, compte_comptable, poste_2035)
            values (dossier_test, 'essai_sans_compte', 'Essai sans compte', 999, null, 'Divers') returning id into cat;
        elsif obs like '15.%' then
          insert into categories (dossier_id, code, libelle, ordre, compte_comptable, poste_2035)
            values (dossier_test, 'essai_bilan', 'Essai bilan', 999, '108000', null) returning id into cat;
        elsif obs like '16.%' then
          insert into categories (dossier_id, code, libelle, ordre, compte_comptable, poste_2035)
            values (dossier_du_client, 'essai_autre_dossier', 'Essai autre dossier', 999, '627000', 'Frais financiers') returning id into cat;
        else
          update dossiers set assujetti_tva = true where id = dossier_test;
          cat := cat_recettes.id;
        end if;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        if obs like '17.%' then
          perform affecter_mouvement_bancaire(credit.id, cat, jsonb_build_array(
            jsonb_build_object('compte', cat_recettes.compte_comptable, 'sens', 'credit', 'montant', credit.montant),
            jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', credit.montant)));
        else
          perform affecter_mouvement_bancaire(debit.id, cat, jsonb_build_array(
            jsonb_build_object('compte', '627000', 'sens', 'debit', 'montant', abs(debit.montant)),
            jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))));
        end if;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      insert into essai_affectation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = '22023' and recu like attendu);
    end;
  end loop;

  -- 18. Un mouvement déjà rapproché d'une pièce
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform affecter_mouvement_bancaire(avec_piece.id, cat_frais.id, jsonb_build_array(
      jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', case when avec_piece.montant >= 0 then 'credit' else 'debit' end, 'montant', abs(avec_piece.montant)),
      jsonb_build_object('compte', '512000', 'sens', case when avec_piece.montant >= 0 then 'debit' else 'credit' end, 'montant', abs(avec_piece.montant))));
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_affectation values ('18. mouvement rapproché d''une pièce', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message like 'Ce mouvement est rapproché d''une pièce%');

  -- 19. Retirer ce qui n'est pas affecté
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform retirer_affectation_mouvement_bancaire(debit.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_affectation values ('19. retirer un mouvement non affecté', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = 'Ce mouvement n''est affecté à aucune catégorie.');

  -- ══ 20 et 21. Une écriture VALIDÉE ne se remplace ni ne se retire ══════════════════════════════
  for obs in select unnest(array['20. écriture validée : pas de réaffectation', '21. écriture validée : pas de retrait']) loop
    accepte := false; code_recu := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform affecter_mouvement_bancaire(debit.id, cat_frais.id, ecriture);
      reset role;
      update ecritures_brouillon set statut = 'validee' where ligne_bancaire_id = debit.id and piece_id is null;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      if obs like '20.%' then
        perform affecter_mouvement_bancaire(debit.id, cat_frais.id, ecriture);
      else
        perform retirer_affectation_mouvement_bancaire(debit.id);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_affectation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '23514' and message like 'L''écriture de ce mouvement est validée%');
  end loop;

  -- ══ 22 à 24. Ce que les contraintes tiennent SEULES, sans passer par les fonctions ═════════════
  accepte := false; code_recu := null; message := null;
  begin
    update lignes_bancaires set categorie_id = cat_frais.id where id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  insert into essai_affectation values ('22. affecté sans être rapproché', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '23514' and message like '%lignes_bancaires_affectation_rapprochee%');

  accepte := false; code_recu := null; message := null;
  begin
    update lignes_bancaires set categorie_id = cat_frais.id where id = avec_piece.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  insert into essai_affectation values ('23. une pièce ET une catégorie', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '23514' and message like '%lignes_bancaires_un_seul_rapprochement%');

  -- Une catégorie NEUVE, que rien d'autre ne désigne : « Frais bancaires » est déjà portée par des
  -- pièces, qui bloqueraient sa suppression toutes seules — le contrôle passerait sans la contrainte.
  accepte := false; code_recu := null; message := null;
  declare cat uuid;
  begin
    begin
      insert into categories (dossier_id, code, libelle, ordre, compte_comptable, poste_2035)
        values (dossier_test, 'essai_en_usage', 'Essai en usage', 999, '627000', 'Frais financiers') returning id into cat;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform affecter_mouvement_bancaire(debit.id, cat, ecriture);
      reset role;
      delete from categories where id = cat;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
  end;
  reset role;
  insert into essai_affectation values ('24. une catégorie en usage ne se supprime pas', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '23503' and message like '%lignes_bancaires_categorie_id_fkey%');

  -- ══ 25. Rien n'est resté ══════════════════════════════════════════════════════════════════════
  select count(*) into nb_apres from ecritures_brouillon;
  select concat_ws('|', a.statut, a.categorie_id, b.statut, b.categorie_id) into etat_apres
    from lignes_bancaires a, lignes_bancaires b where a.id = debit.id and b.id = credit.id;
  insert into essai_affectation values ('25. rien n''est resté en base',
    'écritures ' || nb_avant || ' -> ' || nb_apres || ', mouvements ' || (etat_avant = etat_apres)::text,
    nb_avant = nb_apres and etat_avant = etat_apres);
end $$;

select controle, ok, observe from essai_affectation order by
  (regexp_match(controle, '^(\d+)'))[1]::int, controle;
