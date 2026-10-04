-- LES RÈGLES D'AFFECTATION ET L'AFFECTATION EN LOT, ÉPROUVÉES EN BASE — à rejouer par `execute_sql`
-- après toute migration qui touche `regles_affectation_bancaire`, `affecter_mouvements_bancaires` ou
-- `affecter_mouvement_bancaire`, qu'elle appelle (ligne 26.6 de la feuille de route, étape a).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI voit et écrit une règle : un anonyme, un compte rattaché à rien et un client ne voient
--     AUCUNE règle — alors qu'il en existe une — et se font refuser l'écriture, le client sur son
--     propre dossier compris ; le chef écrit, relit, remplace et supprime (le contrôle POSITIF) ;
--   - ce que la table refuse SEULE : une catégorie d'un autre dossier, un motif qui n'est pas sous sa
--     forme normalisée, un motif de moins de cinq chiffres, un sens inconnu, un doublon, un taux de TVA
--     hors de la liste — et qu'une catégorie visée par une règle ne se supprime pas ;
--   - QUI peut affecter en lot, et que le lot est TOUT OU RIEN : un refus au milieu défait ce qui le
--     précède, avec le mouvement en cause et la raison d'origine ; un mouvement qui n'est plus à
--     traiter, ou présent deux fois, fait refuser l'appel entier ;
--   - que le lot TRANSMET le taux de TVA d'une recette d'un dossier assujetti, et qu'une telle recette
--     sans taux fait refuser l'appel ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Le mécanisme est celui d'affectation.sql : chaque écriture d'essai est annulée par sous-transaction
-- (`raise exception 'ANNULATION_ESSAI'`), le verdict posé dans une VARIABLE avant le `raise`, et un
-- refus se juge à son code ET à son message.
--
-- ÉPROUVÉ LE 01/10/2026 après `recettes_assujetties_du_releve` : 25 contrôles sur 25, le texte transmis
-- comparé au fichier dans le journal de session (identique).
--
-- REJOUÉ LE 04/10/2026 après les migrations de la validation d'un exercice, qui posent un déclencheur sur
-- les écritures que l'affectation en lot écrit : 23 contrôles sur 23 en production, le texte transmis
-- identique au fichier, ses commentaires et les contrôles 4 et 13 retirés. Ces deux-là, qui suppriment
-- (une règle, puis une catégorie), n'y ont pas été rejoués : l'outil demande alors une confirmation qui
-- ne parvient pas au cabinet. Aucune de ces migrations ne touche les règles ni la clé étrangère de leur
-- catégorie. La table des verdicts disparaît avec la transaction (`on commit drop`) au lieu d'être
-- supprimée en tête : l'essai ne porte plus d'instruction de suppression hors de ses contrôles.
create temp table essai_regles (controle text, observe text, ok boolean) on commit drop;

do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  debit record; credit record; avec_piece record;
  cat_frais record; cat_recettes record;
  accepte boolean; code_recu text; message text; obs text; ok boolean;
  n int; vus int; nb_regles_avant int; nb_regles_apres int; nb_ecritures_avant int; nb_ecritures_apres int;
  etat_avant text; etat_apres text;
  cat uuid; regle uuid; tva numeric;
  ecriture_debit jsonb; ecriture_credit jsonb;
begin
  select * into debit from lignes_bancaires
   where dossier_id = dossier_test and statut = 'non_rapprochee' and montant < 0 order by date, id limit 1;
  select * into credit from lignes_bancaires
   where dossier_id = dossier_test and statut = 'non_rapprochee' and montant > 0 order by date, id limit 1;
  select * into avec_piece from lignes_bancaires
   where dossier_id = dossier_test and piece_id is not null and statut = 'rapprochee' order by id limit 1;
  select * into cat_frais from categories where code = 'frais_bancaires' and dossier_id is null;
  select * into cat_recettes from categories where code = 'ventes_prestations' and dossier_id is null;
  if debit.id is null or credit.id is null or avec_piece.id is null or cat_frais.id is null or cat_recettes.id is null then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;
  select count(*) into nb_regles_avant from regles_affectation_bancaire;
  select count(*) into nb_ecritures_avant from ecritures_brouillon;
  etat_avant := concat_ws('|', debit.statut, debit.categorie_id, debit.taux_tva, credit.statut, credit.categorie_id, credit.taux_tva);
  ecriture_debit := jsonb_build_array(
    jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', abs(debit.montant), 'libelle', 'essai'),
    jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant), 'libelle', 'essai'));
  ecriture_credit := jsonb_build_array(
    jsonb_build_object('compte', cat_recettes.compte_comptable, 'sens', 'credit', 'montant', credit.montant, 'libelle', 'essai'),
    jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', credit.montant, 'libelle', 'essai'));

  -- ══ 1 à 3. Une règle EXISTE, et personne d'autre que le cabinet ne la voit ni n'en écrit ═══════
  for obs in select unnest(array['1. anonyme', '2. rattaché à rien', '3. client, son propre dossier']) loop
    accepte := false; code_recu := null; message := null; vus := null;
    begin
      insert into regles_affectation_bancaire (dossier_id, motif, sens, categorie_id)
        values (dossier_du_client, 'essai visible', 'decaissement', cat_frais.id);
      if obs like '1.%' then
        set local role anon;
        perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
      else
        set local role authenticated;
        perform set_config('request.jwt.claims',
          json_build_object('sub', case when obs like '2.%' then inconnu else client end, 'role','authenticated')::text, true);
      end if;
      select count(*) into vus from regles_affectation_bancaire;
      insert into regles_affectation_bancaire (dossier_id, motif, sens, categorie_id)
        values (dossier_du_client, 'essai ecrit', 'decaissement', cat_frais.id);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_regles values (obs || ' : ne voit rien, n''écrit rien',
      'vues : ' || coalesce(vus::text, '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and vus = 0 and code_recu = '42501'
      and (message like 'permission denied%' or message like 'new row violates row-level security policy%'));
  end loop;

  -- ══ 4. Le chef écrit, relit, remplace (upsert) et supprime ══════════════════════════════════════
  accepte := false; code_recu := null; message := null; ok := false; obs := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    insert into regles_affectation_bancaire (dossier_id, motif, sens, categorie_id)
      values (dossier_test, 'essai cpam', 'encaissement', cat_frais.id) returning id into regle;
    insert into regles_affectation_bancaire (dossier_id, motif, sens, categorie_id)
      values (dossier_test, 'essai cpam', 'encaissement', cat_recettes.id)
      on conflict (dossier_id, motif, sens) do update set categorie_id = excluded.categorie_id;
    select count(*) filter (where categorie_id = cat_recettes.id)::text || '/' || count(*)::text into obs
      from regles_affectation_bancaire where dossier_id = dossier_test and motif = 'essai cpam';
    delete from regles_affectation_bancaire where id = regle;
    get diagnostics n = row_count;
    ok := obs = '1/1' and n = 1;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_regles values ('4. le chef écrit, remplace et supprime', 'remplacée : ' || coalesce(obs, '?') || ', supprimées : ' || coalesce(n::text, '?'),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 5. La catégorie d'un autre dossier est refusée, même au chef des deux ══════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    insert into categories (dossier_id, code, libelle, ordre, compte_comptable, poste_2035)
      values (dossier_du_client, 'essai_autre_dossier', 'Essai autre dossier', 999, '627000', 'Frais financiers') returning id into cat;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    insert into regles_affectation_bancaire (dossier_id, motif, sens, categorie_id)
      values (dossier_test, 'essai autre', 'decaissement', cat);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_regles values ('5. catégorie d''un autre dossier', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message like 'new row violates row-level security policy%');

  -- ══ 6 à 10. Ce que la table refuse seule ══════════════════════════════════════════════════════
  for obs, message in
    select * from (values
      ('6. motif non normalisé (majuscules)', 'CPAM'),
      ('7. motif non normalisé (ponctuation)', 'c.p.a.m'),
      ('8. motif de deux lettres', 'cb'),
      ('9. motif de quatre chiffres', '2025'),
      ('10. sens inconnu', 'cpam')
    ) as cas(nom, motif_essai)
  loop
    accepte := false; code_recu := null;
    declare motif_essai text := message; recu text;
    begin
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        insert into regles_affectation_bancaire (dossier_id, motif, sens, categorie_id)
          values (dossier_test, motif_essai, case when obs like '10.%' then 'remboursement' else 'encaissement' end, cat_recettes.id);
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      insert into essai_regles values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = '23514'
        and recu like case when obs like '10.%' then '%regles_affectation_bancaire_sens%' else '%regles_affectation_bancaire_motif_normalise%' end);
    end;
  end loop;

  -- ══ 11. Un motif de cinq chiffres passe : la frontière est bien à cinq ════════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    insert into regles_affectation_bancaire (dossier_id, motif, sens, categorie_id)
      values (dossier_test, '12345', 'encaissement', cat_recettes.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_regles values ('11. motif de cinq chiffres accepté', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    accepte and code_recu = 'P0001');

  -- ══ 12. Un doublon (dossier, motif, sens) sans upsert est refusé ══════════════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    insert into regles_affectation_bancaire (dossier_id, motif, sens, categorie_id)
      values (dossier_test, 'essai doublon', 'decaissement', cat_frais.id);
    insert into regles_affectation_bancaire (dossier_id, motif, sens, categorie_id)
      values (dossier_test, 'essai doublon', 'decaissement', cat_frais.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_regles values ('12. doublon refusé', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '23505' and message like '%regles_affectation_bancaire_unique%');

  -- ══ 13. Une catégorie visée par une règle ne se supprime pas ══════════════════════════════════
  -- Une catégorie NEUVE, que rien d'autre ne désigne : sinon une pièce bloquerait la suppression
  -- toute seule, et le contrôle passerait sans la clé étrangère.
  accepte := false; code_recu := null; message := null;
  begin
    insert into categories (dossier_id, code, libelle, ordre, compte_comptable, poste_2035)
      values (dossier_test, 'essai_regle', 'Essai règle', 999, '627000', 'Frais financiers') returning id into cat;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    insert into regles_affectation_bancaire (dossier_id, motif, sens, categorie_id)
      values (dossier_test, 'essai suppression', 'decaissement', cat);
    reset role;
    delete from categories where id = cat;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_regles values ('13. catégorie visée par une règle', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '23503' and message like '%regles_affectation_bancaire_categorie_id_fkey%');

  -- ══ 14 à 16. Le lot : anonyme, rattaché à rien, client sur son propre dossier ═════════════════
  for obs in select unnest(array['14. lot : anonyme', '15. lot : rattaché à rien', '16. lot : client']) loop
    accepte := false; code_recu := null; message := null;
    begin
      if obs like '14.%' then
        set local role anon;
        perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
      else
        set local role authenticated;
        perform set_config('request.jwt.claims',
          json_build_object('sub', case when obs like '15.%' then inconnu else client end, 'role','authenticated')::text, true);
      end if;
      perform affecter_mouvements_bancaires(jsonb_build_array(
        jsonb_build_object('ligne_bancaire_id', debit.id, 'categorie_id', cat_frais.id, 'ecritures', ecriture_debit)));
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_regles values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '42501'
      and case when obs like '14.%' then message like 'permission denied%' else message = 'Accès refusé à ce mouvement.' end);
  end loop;

  -- ══ 17. Le chef affecte deux mouvements en un appel ═══════════════════════════════════════════
  accepte := false; code_recu := null; message := null; ok := false; obs := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := affecter_mouvements_bancaires(jsonb_build_array(
      jsonb_build_object('ligne_bancaire_id', debit.id, 'categorie_id', cat_frais.id, 'ecritures', ecriture_debit),
      jsonb_build_object('ligne_bancaire_id', credit.id, 'categorie_id', cat_recettes.id, 'ecritures', ecriture_credit)));
    select string_agg(l.statut || ':' || (l.categorie_id = case when l.id = debit.id then cat_frais.id else cat_recettes.id end)::text
                      || ':' || (select count(*) from ecritures_brouillon e where e.ligne_bancaire_id = l.id and e.piece_id is null)::text,
                      ',' order by l.montant)
      into obs from lignes_bancaires l where l.id in (debit.id, credit.id);
    ok := n = 2 and obs = 'rapprochee:true:2,rapprochee:true:2';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_regles values ('17. le chef affecte deux mouvements', 'affectés : ' || coalesce(n::text, '?') || ' — ' || coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 18. Tout ou rien : un refus au second mouvement défait le premier ═════════════════════════
  -- Le verdict se lit APRÈS l'appel refusé, dans la même sous-transaction : un lot qui avalerait le
  -- refus et continuerait laisserait le premier affecté, et ne lèverait rien.
  accepte := false; code_recu := null; message := null; obs := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    begin
      perform affecter_mouvements_bancaires(jsonb_build_array(
        jsonb_build_object('ligne_bancaire_id', debit.id, 'categorie_id', cat_frais.id, 'ecritures', ecriture_debit),
        jsonb_build_object('ligne_bancaire_id', credit.id, 'categorie_id', cat_recettes.id, 'ecritures', jsonb_build_array(
          jsonb_build_object('compte', cat_recettes.compte_comptable, 'sens', 'credit', 'montant', credit.montant + 1),
          jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', credit.montant + 1)))));
      accepte := true;
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    select statut || ':' || coalesce(categorie_id::text, 'aucune') into obs from lignes_bancaires where id = debit.id;
    raise exception 'ANNULATION_ESSAI';
  exception when others then null;
  end;
  reset role;
  insert into essai_regles values ('18. tout ou rien', coalesce(code_recu, '?') || ' ' || coalesce(message, '') || ' — premier : ' || coalesce(obs, '?'),
    not accepte and code_recu = '22023'
    and message like 'Mouvement du %L''écriture proposée ne correspond pas à ce mouvement et à cette catégorie.'
    and obs = 'non_rapprochee:aucune');

  -- ══ 19. Un mouvement qui n'est plus à traiter fait refuser le lot ══════════════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform affecter_mouvements_bancaires(jsonb_build_array(
      jsonb_build_object('ligne_bancaire_id', avec_piece.id, 'categorie_id', cat_frais.id, 'ecritures', jsonb_build_array(
        jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', case when avec_piece.montant >= 0 then 'credit' else 'debit' end, 'montant', abs(avec_piece.montant)),
        jsonb_build_object('compte', '512000', 'sens', case when avec_piece.montant >= 0 then 'debit' else 'credit' end, 'montant', abs(avec_piece.montant))))));
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_regles values ('19. mouvement plus à traiter', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message like 'Le mouvement du % n''est plus à traiter%');

  -- ══ 20. Le même mouvement deux fois : le second n'est plus à traiter ═══════════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform affecter_mouvements_bancaires(jsonb_build_array(
      jsonb_build_object('ligne_bancaire_id', debit.id, 'categorie_id', cat_frais.id, 'ecritures', ecriture_debit),
      jsonb_build_object('ligne_bancaire_id', debit.id, 'categorie_id', cat_frais.id, 'ecritures', ecriture_debit)));
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_regles values ('20. le même mouvement deux fois', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message like 'Le mouvement du % n''est plus à traiter%');

  -- ══ 21. Un lot vide est refusé ══════════════════════════════════════════════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform affecter_mouvements_bancaires('[]'::jsonb);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_regles values ('21. lot vide', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = 'Aucune affectation à enregistrer.');

  -- ══ 22. La table refuse un taux de TVA hors de la liste ═════════════════════════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    insert into regles_affectation_bancaire (dossier_id, motif, sens, categorie_id, taux_tva)
      values (dossier_test, 'essai taux', 'encaissement', cat_recettes.id, 7);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_regles values ('22. taux hors de la liste refusé', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '23514' and message like '%regles_affectation_bancaire_taux_tva%');

  -- ══ 23 et 24. Le lot transmet le taux : une recette d'un dossier assujetti l'exige ═══════════════
  -- Le dossier devient assujetti DANS la sous-transaction. La TVA attendue est recalculée ici, par
  -- `round`, et non par la fonction qu'on éprouve.
  tva := round(credit.montant * 20 / 120, 2);
  for obs in select unnest(array['23. le lot écrit la TVA au taux transmis',
                                 '24. le lot sans taux, recette d''un dossier assujetti']) loop
    accepte := false; code_recu := null; ok := false;
    declare vu text; recu text;
    begin
      begin
        update dossiers set assujetti_tva = true where id = dossier_test;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        if obs like '23.%' then
          n := affecter_mouvements_bancaires(jsonb_build_array(jsonb_build_object(
            'ligne_bancaire_id', credit.id, 'categorie_id', cat_recettes.id, 'taux_tva', 20, 'ecritures', jsonb_build_array(
              jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', credit.montant),
              jsonb_build_object('compte', cat_recettes.compte_comptable, 'sens', 'credit', 'montant', credit.montant - tva),
              jsonb_build_object('compte', '445710', 'sens', 'credit', 'montant', tva)))));
          select n = 1 and l.taux_tva = 20 and l.statut = 'rapprochee'
                 and (select count(*) from ecritures_brouillon e where e.ligne_bancaire_id = credit.id and e.piece_id is null) = 3,
                 'affectés : ' || n || ', taux ' || coalesce(l.taux_tva::text, 'nul')
                   || ', lignes d''écriture : ' || (select count(*) from ecritures_brouillon e where e.ligne_bancaire_id = credit.id and e.piece_id is null)
            into ok, vu from lignes_bancaires l where l.id = credit.id;
        else
          perform affecter_mouvements_bancaires(jsonb_build_array(
            jsonb_build_object('ligne_bancaire_id', credit.id, 'categorie_id', cat_recettes.id, 'ecritures', ecriture_credit)));
        end if;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      insert into essai_regles values (obs, coalesce(vu, coalesce(code_recu, '?') || ' ' || coalesce(recu, '')),
        case when obs like '23.%' then accepte and code_recu = 'P0001' and coalesce(ok, false)
             else not accepte and code_recu = '22023'
                  and recu like 'Mouvement du % : Sur un dossier assujetti à la TVA, une recette porte son taux%' end);
    end;
  end loop;

  -- ══ 25. Rien n'est resté ══════════════════════════════════════════════════════════════════════
  select count(*) into nb_regles_apres from regles_affectation_bancaire;
  select count(*) into nb_ecritures_apres from ecritures_brouillon;
  select concat_ws('|', a.statut, a.categorie_id, a.taux_tva, b.statut, b.categorie_id, b.taux_tva) into etat_apres
    from lignes_bancaires a, lignes_bancaires b where a.id = debit.id and b.id = credit.id;
  insert into essai_regles values ('25. rien n''est resté en base',
    'règles ' || nb_regles_avant || ' -> ' || nb_regles_apres || ', écritures ' || nb_ecritures_avant || ' -> ' || nb_ecritures_apres
      || ', mouvements ' || (etat_avant = etat_apres)::text
      || ', dossier exonéré ' || (select (not assujetti_tva)::text from dossiers where id = dossier_test),
    nb_regles_avant = nb_regles_apres and nb_ecritures_avant = nb_ecritures_apres and etat_avant = etat_apres
      and (select not assujetti_tva from dossiers where id = dossier_test));
end $$;

select controle, ok, observe from essai_regles order by
  (regexp_match(controle, '^(\d+)'))[1]::int, controle;
