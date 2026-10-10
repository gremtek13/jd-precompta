-- LA VENTILATION D'UN MOUVEMENT ET SON ÉCRITURE, ÉPROUVÉES EN BASE — à rejouer par `execute_sql` après
-- toute migration qui touche `ventiler_mouvement_bancaire`, `retirer_ventilation_mouvement_bancaire`, la
-- table `ventilations_bancaires` ou les contraintes de `lignes_bancaires` (ligne 26.6 de la feuille de
-- route, étape a).
--
-- Les deux fonctions ventilent un mouvement sans justificatif sur plusieurs comptes — des catégories de
-- résultat, et la part personnelle sur le compte du dirigeant — ET écrivent (ou retirent) ses parts et son
-- écriture en une transaction. Ce qui se prouve ici, et ne se relit pas :
--   - QUI peut : un anonyme n'a pas le droit d'appeler, un compte rattaché à rien et un client se font
--     refuser — le client sur le dossier d'un autre comme sur le SIEN —, et le chef du cabinet écrit bien
--     (le contrôle POSITIF, sans lequel les refus seraient satisfaits par une fonction qui refuse tout le
--     monde) ; et sur la table des parts, le client à la case « Banque » (espace client, P7) lit celles de SES
--     dossiers et n'en écrit aucune ;
--   - CE QUI s'écrit : la banque au montant et dans le sens du mouvement, une ligne par part dans le sens de
--     son signe — une part de sens contraire comprise, la commission retenue sur une remise —, le compte du
--     dirigeant lu dans le modèle du dossier ; une seconde ventilation REMPLACE la première ; un retrait
--     défait les trois ; et sur un dossier ASSUJETTI, une part de recette taxée s'écrit au hors taxe, sa
--     TVA collectée sur une ligne à côté, son taux gardé sur la part, une part exonérée au taux zéro ;
--   - CE QUI est refusé, avec sa RAISON : des parts mal formées (moins de deux, deux cibles, aucune, zéro,
--     pas au centime, une cible deux fois, une somme qui n'est pas le mouvement), une catégorie d'un autre
--     dossier ou sans compte de résultat, une part de recette d'un dossier assujetti sans son taux, un
--     taux sur une part de dépense, sur la part personnelle, sur un dossier exonéré ou hors de la liste,
--     une TVA mal répartie, une écriture qui ne
--     correspond pas, un mouvement déjà rapproché, affecté, personnel ou d'emprunt, un mouvement de zéro
--     euro, une écriture validée ;
--   - CE QUE LES CONTRAINTES TIENNENT SANS LE CODE : les fonctions d'avant et les mises à jour directes de
--     l'écran Banque ne connaissent pas la ventilation, et chacune se heurte à une contrainte nommée ; une
--     part mal formée écrite directement aussi — un taux sur la part personnelle ou hors de la liste
--     compris ; une catégorie ventilée ne se supprime pas, et la
--     suppression d'un DOSSIER passe quand même ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Chaque écriture d'essai est annulée par sa sous-transaction (`raise exception 'ANNULATION_ESSAI'`,
-- P0001), le verdict étant posé dans une VARIABLE avant le `raise` — le mécanisme de rls.sql. Un refus se
-- juge à son code ET à son message : un P0001 sans rapport ressemblerait sinon à un refus.
--
-- ÉPROUVÉ LE 29/09/2026 : 59 contrôles sur 59, le texte transmis comparé au fichier dans le journal de
-- session (identique). Et l'essai sait échouer : sans les `set local role`, les contrôles 1 et 2 virent au
-- rouge (l'appel passe le droit d'exécution, et c'est la fonction qui refuse, avec un autre message).
-- REJOUÉ LE 30/09/2026 après `ventilations_bancaires_lecture_client_une_evaluation`, qui réécrit la policy
-- de lecture du client : 59 sur 59, le corps transmis identique au fichier (seule la requête finale, un
-- résumé, différait).
-- REJOUÉ LE 01/10/2026 après `recettes_assujetties_du_releve`, qui ajoute le taux de TVA d'une part : 68
-- contrôles sur 68 (les neuf nouveaux, 24 et 59 à 67, compris), le texte transmis identique au fichier.
-- Les contrôles 59 et 65 forment une paire : même remise, même taux, et 65 ne déplace qu'un centime de la
-- TVA vers la recette — le premier passe, le second est refusé.
--
-- REJOUÉ LE 04/10/2026 après les migrations de la validation d'un exercice : l'écriture validée dont
-- l'essai a besoin se pose désormais comme `valider_exercice` la pose, sous le réglage
-- `jd.validation_exercice` du dossier et avec les champs que lit son FEC — une écriture ne passe plus à
-- `validee` autrement. 66 contrôles sur 66 en production, le texte transmis identique au fichier, ses
-- commentaires et les contrôles 57 et 58 retirés. Ces deux-là, qui suppriment (une catégorie, puis un
-- dossier), n'y ont pas été rejoués : l'outil demande alors une confirmation qui ne parvient pas au
-- cabinet. Le premier éprouve une clé étrangère que ces migrations ne touchent pas ; la suppression d'un
-- dossier à travers les nouveaux déclencheurs, écritures validées comprises, a été éprouvée sur une
-- réplique locale du schéma. La table des verdicts disparaît avec la transaction (`on commit drop`) au
-- lieu d'être supprimée en tête : l'essai ne porte plus d'instruction de suppression hors de ses
-- contrôles.
-- REJOUÉ LE 06/10/2026 après `compte_de_bilan_du_releve`, qui réécrit la contrainte d'un seul rapprochement :
-- 66 contrôles sur 66 en production, le texte transmis identique au fichier, ses commentaires et les
-- contrôles 57 et 58 retirés pour la même raison qu'au 04/10.
-- REJOUÉ LE 06/10/2026 après `liquidation_de_la_tva`, qui élargit de nouveau cette contrainte (un huitième lien,
-- la déclaration de TVA dont un mouvement est le paiement ou le remboursement) : 66 contrôles sur 66 en
-- production, le texte transmis identique au fichier, ses commentaires et les contrôles 57 et 58 retirés pour la
-- même raison qu'au 04/10.
create temp table essai_ventilation (controle text, observe text, ok boolean) on commit drop;

do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  debit record; credit record; du_client record; avec_piece record;
  cat_achats record; cat_frais record; cat_recettes record;
  cat_autre uuid; emp uuid; dossier_jetable uuid; ligne_jetable uuid;
  accepte boolean; code_recu text; message text; obs text; ok boolean;
  n int; nb_avant int; nb_apres int; parts_avant int; etat_avant text; etat_apres text;
  dossiers_avant int; categories_avant int; emprunts_avant int;

  -- Les parts d'essai de `debit` (une sortie) : 70 % en achats, le reste en frais bancaires, ou en part
  -- personnelle ; et celles de `credit` (une entrée) : la recette brute et la commission retenue.
  tot numeric; p1 numeric; p2 numeric; brut numeric; tva_brut numeric;
  parts_categories jsonb; ecriture_categories jsonb;
  parts_personnelle jsonb; ecriture_personnelle jsonb;
  parts_remise jsonb; ecriture_remise jsonb;
  parts_essai jsonb; lignes_essai jsonb;
begin
  select * into debit from lignes_bancaires
   where dossier_id = dossier_test and statut = 'non_rapprochee' and montant <= -10 order by date, id limit 1;
  select * into credit from lignes_bancaires
   where dossier_id = dossier_test and statut = 'non_rapprochee' and montant >= 10 order by date, id limit 1;
  select l.* into du_client from lignes_bancaires l
    join memberships m on m.dossier_id = l.dossier_id
   where m.user_id = client and l.statut = 'non_rapprochee' and l.montant <= -10 order by l.date, l.id limit 1;
  select * into avec_piece from lignes_bancaires
   where dossier_id = dossier_test and piece_id is not null and statut = 'rapprochee' order by id limit 1;
  select * into cat_achats from categories where code = 'achats_fournisseurs' and dossier_id is null;
  select * into cat_frais from categories where code = 'frais_bancaires' and dossier_id is null;
  select * into cat_recettes from categories where code = 'ventes_prestations' and dossier_id is null;
  if debit.id is null or credit.id is null or du_client.id is null or avec_piece.id is null
     or cat_achats.id is null or cat_frais.id is null or cat_recettes.id is null
     or du_client.dossier_id = dossier_test then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;

  select count(*) into nb_avant from ecritures_brouillon;
  select count(*) into parts_avant from ventilations_bancaires;
  select count(*) into dossiers_avant from dossiers;
  select count(*) into categories_avant from categories;
  select count(*) into emprunts_avant from emprunts;
  select string_agg(concat_ws(':', l.id, l.statut, l.piece_id, l.categorie_id, l.prelevement_personnel, l.montant,
                              l.emprunt_id, l.ventilee), '|' order by l.id)
    into etat_avant from lignes_bancaires l where l.id in (debit.id, credit.id, du_client.id, avec_piece.id);

  tot := abs(debit.montant);
  p1 := round(tot * 0.7, 2);
  p2 := tot - p1;
  parts_categories := jsonb_build_array(
    jsonb_build_object('categorie_id', cat_achats.id, 'montant', -p1),
    jsonb_build_object('categorie_id', cat_frais.id, 'montant', -p2));
  ecriture_categories := jsonb_build_array(
    jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot, 'libelle', 'essai'),
    jsonb_build_object('compte', cat_achats.compte_comptable, 'sens', 'debit', 'montant', p1, 'libelle', 'essai'),
    jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', p2, 'libelle', 'essai'));
  parts_personnelle := jsonb_build_array(
    jsonb_build_object('categorie_id', cat_achats.id, 'montant', -p1),
    jsonb_build_object('part_personnelle', true, 'montant', -p2));
  ecriture_personnelle := jsonb_build_array(
    jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
    jsonb_build_object('compte', cat_achats.compte_comptable, 'sens', 'debit', 'montant', p1),
    jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', p2));
  -- La remise : l'encaissement est NET d'une commission de 5 €, la recette brute est donc de 5 € de plus.
  brut := credit.montant + 5;
  parts_remise := jsonb_build_array(
    jsonb_build_object('categorie_id', cat_recettes.id, 'montant', brut),
    jsonb_build_object('categorie_id', cat_frais.id, 'montant', -5));
  ecriture_remise := jsonb_build_array(
    jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', credit.montant),
    jsonb_build_object('compte', cat_recettes.compte_comptable, 'sens', 'credit', 'montant', brut),
    jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', 5));

  -- ══ 1 et 2. Anonyme : pas d'EXECUTE, ni pour ventiler ni pour retirer ═════════════════════════
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform ventiler_mouvement_bancaire(debit.id, parts_categories, ecriture_categories);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_ventilation values ('1. anonyme, ventiler', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message like 'permission denied%');

  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform retirer_ventilation_mouvement_bancaire(debit.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_ventilation values ('2. anonyme, retirer', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message like 'permission denied%');

  -- ══ 3 à 6. Rattaché à rien, client sur le dossier d'un autre, client sur le sien ═══════════════
  for obs in select unnest(array['3. rattaché à rien', '4. client, dossier d''un autre',
                                 '5. client, son propre dossier', '6. client, retirer sur son dossier']) loop
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', case when obs like '3.%' then inconnu else client end, 'role','authenticated')::text, true);
    accepte := false; code_recu := null; message := null;
    begin
      if obs like '3.%' or obs like '4.%' then
        perform ventiler_mouvement_bancaire(debit.id, parts_categories, ecriture_categories);
      elsif obs like '5.%' then
        perform ventiler_mouvement_bancaire(du_client.id,
          jsonb_build_array(
            jsonb_build_object('categorie_id', cat_achats.id, 'montant', du_client.montant + 1),
            jsonb_build_object('categorie_id', cat_frais.id, 'montant', -1)),
          jsonb_build_array(
            jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(du_client.montant)),
            jsonb_build_object('compte', cat_achats.compte_comptable, 'sens', 'debit', 'montant', abs(du_client.montant) - 1),
            jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', 1)));
      else
        perform retirer_ventilation_mouvement_bancaire(du_client.id);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_ventilation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');
  end loop;

  -- ══ 7. Le chef ventile une sortie sur deux catégories ══════════════════════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := ventiler_mouvement_bancaire(debit.id, parts_categories, ecriture_categories);
    select string_agg(e.compte || ':' || e.sens || ':' || e.montant::text || ':' || (e.date = debit.date)::text, ',' order by e.compte)
      into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 3 and l.statut = 'rapprochee' and l.ventilee and l.categorie_id is null
           and obs = '512000:credit:' || tot::text || ':true,'
                  || cat_achats.compte_comptable || ':debit:' || p1::text || ':true,'
                  || cat_frais.compte_comptable || ':debit:' || p2::text || ':true'
           and (select string_agg(v.categorie_id::text || ':' || v.montant::text || ':' || v.part_personnelle::text
                                  || ':' || (v.dossier_id = dossier_test)::text, ',' order by v.montant)
                  from ventilations_bancaires v where v.ligne_bancaire_id = debit.id)
               = (select string_agg(x, ',' order by m) from (values
                   (cat_achats.id::text || ':' || (-p1)::text || ':false:true', -p1),
                   (cat_frais.id::text || ':' || (-p2)::text || ':false:true', -p2)) as t(x, m))
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_ventilation values ('7. le chef ventile sur deux catégories', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 8. Une part personnelle : le compte de l'exploitant en trésorerie ═══════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := ventiler_mouvement_bancaire(debit.id, parts_personnelle, ecriture_personnelle);
    select string_agg(e.compte || ':' || e.sens || ':' || e.montant::text, ',' order by e.compte)
      into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 3 and obs = '108000:debit:' || p2::text || ',512000:credit:' || tot::text || ','
                           || cat_achats.compte_comptable || ':debit:' || p1::text
           and exists (select 1 from ventilations_bancaires v where v.ligne_bancaire_id = debit.id
                         and v.part_personnelle and v.categorie_id is null and v.montant = -p2)
      into ok;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_ventilation values ('8. une part personnelle, en trésorerie', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 9. Une remise nette de sa commission : la recette brute et la commission EN SENS INVERSE ═════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := ventiler_mouvement_bancaire(credit.id, parts_remise, ecriture_remise);
    select string_agg(e.compte || ':' || e.sens || ':' || e.montant::text, ',' order by e.compte)
      into obs from ecritures_brouillon e where e.ligne_bancaire_id = credit.id and e.piece_id is null;
    select n = 3 and obs = '512000:debit:' || credit.montant::text || ','
                           || cat_frais.compte_comptable || ':debit:5,'
                           || cat_recettes.compte_comptable || ':credit:' || brut::text
      into ok;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_ventilation values ('9. une remise nette de sa commission', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 10. En engagement, la part personnelle va au compte choisi pour le dirigeant ══════════════════
  -- Le dossier `test` ne porte aucune écriture : son modèle se change, dans la sous-transaction.
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    update dossiers set mode_comptable = 'engagement', compte_notes_de_frais = '455000' where id = dossier_test;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := ventiler_mouvement_bancaire(debit.id, parts_personnelle, jsonb_build_array(
      jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
      jsonb_build_object('compte', cat_achats.compte_comptable, 'sens', 'debit', 'montant', p1),
      jsonb_build_object('compte', '455000', 'sens', 'debit', 'montant', p2)));
    select string_agg(e.compte || ':' || e.sens, ',' order by e.compte)
      into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    ok := n = 3 and obs = '455000:debit,512000:credit,' || cat_achats.compte_comptable || ':debit';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_ventilation values ('10. en engagement, le compte du dirigeant', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 11. Une seconde ventilation REMPLACE la première : parts et écriture ══════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ventiler_mouvement_bancaire(debit.id, parts_categories, ecriture_categories);
    n := ventiler_mouvement_bancaire(debit.id, parts_personnelle, ecriture_personnelle);
    select count(*)::text into obs from ventilations_bancaires v where v.ligne_bancaire_id = debit.id;
    ok := n = 3 and obs = '2'
      and (select count(*) from ventilations_bancaires v where v.ligne_bancaire_id = debit.id and v.part_personnelle) = 1
      and (select count(*) from ventilations_bancaires v where v.ligne_bancaire_id = debit.id and v.categorie_id = cat_frais.id) = 0
      and (select string_agg(e.compte, ',' order by e.compte) from ecritures_brouillon e
            where e.ligne_bancaire_id = debit.id and e.piece_id is null)
          = '108000,512000,' || cat_achats.compte_comptable;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_ventilation values ('11. la seconde ventilation remplace', 'parts : ' || coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 12. Le retrait défait la ventilation, ses parts ET son écriture ═══════════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ventiler_mouvement_bancaire(debit.id, parts_categories, ecriture_categories);
    n := retirer_ventilation_mouvement_bancaire(debit.id);
    select count(*)::text into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 3 and obs = '0' and l.statut = 'non_rapprochee' and not l.ventilee
           and (select count(*) from ventilations_bancaires v where v.ligne_bancaire_id = debit.id) = 0
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_ventilation values ('12. le retrait défait les trois', 'retirées : ' || coalesce(n::text, '?') || ', restantes : ' || coalesce(obs, '?'),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 13 à 24. Les parts que la base refuse, chacune pour SA raison ═════════════════════════════════
  for obs, parts_essai, message in
    select * from (values
      ('13. pas un tableau', jsonb_build_object('categorie_id', cat_achats.id), 'Une ventilation porte au moins deux parts.'),
      ('14. une seule part', jsonb_build_array(jsonb_build_object('categorie_id', cat_achats.id, 'montant', debit.montant)),
       'Une ventilation porte au moins deux parts.'),
      ('15. une part à deux cibles', jsonb_build_array(
         jsonb_build_object('categorie_id', cat_achats.id, 'part_personnelle', true, 'montant', -p1),
         jsonb_build_object('categorie_id', cat_frais.id, 'montant', -p2)),
       'Chaque part va à une catégorie ou au compte du dirigeant, jamais aux deux ni à aucun.'),
      ('16. une part sans cible', jsonb_build_array(
         jsonb_build_object('montant', -p1),
         jsonb_build_object('categorie_id', cat_frais.id, 'montant', -p2)),
       'Chaque part va à une catégorie ou au compte du dirigeant, jamais aux deux ni à aucun.'),
      ('17. une part à zéro euro', jsonb_build_array(
         jsonb_build_object('categorie_id', cat_achats.id, 'montant', debit.montant),
         jsonb_build_object('categorie_id', cat_frais.id, 'montant', 0)),
       'Chaque part porte un montant non nul, au centime.'),
      ('18. une part pas au centime', jsonb_build_array(
         jsonb_build_object('categorie_id', cat_achats.id, 'montant', -p1 - 0.004),
         jsonb_build_object('categorie_id', cat_frais.id, 'montant', -p2 + 0.004)),
       'Chaque part porte un montant non nul, au centime.'),
      ('19. deux parts à la même catégorie', jsonb_build_array(
         jsonb_build_object('categorie_id', cat_achats.id, 'montant', -p1),
         jsonb_build_object('categorie_id', cat_achats.id, 'montant', -p2)),
       'Deux parts vont à la même catégorie, ou au compte du dirigeant : réunis-les en une.'),
      ('20. deux parts personnelles', jsonb_build_array(
         jsonb_build_object('part_personnelle', true, 'montant', -p1),
         jsonb_build_object('part_personnelle', true, 'montant', -p2)),
       'Deux parts vont à la même catégorie, ou au compte du dirigeant : réunis-les en une.'),
      ('21. des parts qui ne font pas le mouvement', jsonb_build_array(
         jsonb_build_object('categorie_id', cat_achats.id, 'montant', -p1),
         jsonb_build_object('categorie_id', cat_frais.id, 'montant', -p2 - 0.01)),
       'Les parts font %€ au lieu des %€ du mouvement.')
    ) as cas(nom, parts, attendu)
  loop
    accepte := false; code_recu := null;
    declare attendu text := message; recu text;
    begin
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        perform ventiler_mouvement_bancaire(debit.id, parts_essai, ecriture_categories);
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      insert into essai_ventilation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = '22023' and recu like attendu);
    end;
  end loop;

  -- 22. Une catégorie d'un autre dossier ; 23. une catégorie sans compte de résultat ; 24. une part de
  -- recette sans son taux, sur un dossier assujetti. Chacune se crée ou se règle DANS la sous-transaction.
  for obs in select unnest(array['22. une catégorie d''un autre dossier', '23. une catégorie sans compte de résultat',
                                 '24. une part de recette sans taux, dossier assujetti']) loop
    accepte := false; code_recu := null; message := null;
    begin
      if obs like '22.%' then
        insert into categories (code, libelle, dossier_id, compte_comptable, poste_2035)
        values ('essai_ventilation', 'Essai (autre dossier)', du_client.dossier_id, '606400', 'Achats') returning id into cat_autre;
      elsif obs like '23.%' then
        insert into categories (code, libelle, dossier_id, compte_comptable, poste_2035)
        values ('essai_ventilation', 'Essai sans résultat', dossier_test, '471000', null) returning id into cat_autre;
      else
        update dossiers set assujetti_tva = true where id = dossier_test;
      end if;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      if obs like '24.%' then
        perform ventiler_mouvement_bancaire(credit.id, parts_remise, ecriture_remise);
      else
        perform ventiler_mouvement_bancaire(debit.id, jsonb_build_array(
          jsonb_build_object('categorie_id', cat_autre, 'montant', -p1),
          jsonb_build_object('categorie_id', cat_frais.id, 'montant', -p2)), ecriture_categories);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_ventilation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '22023' and message = case
        when obs like '22.%' then 'Cette catégorie n''existe pas pour ce dossier.'
        when obs like '23.%' then 'La catégorie « Essai sans résultat » n''a pas de compte de charge ou de produit (classe 6 ou 7).'
        else 'Sur un dossier assujetti à la TVA, la part « ' || cat_recettes.libelle || ' » est une recette : choisis son taux, ou « exonérée ».' end);
  end loop;

  -- ══ 25 à 31. Les écritures que la base refuse, chacune pour SA raison ════════════════════════════
  for obs, lignes_essai, message in
    select * from (values
      ('25. pas un tableau', jsonb_build_object('compte', '512000'), 'L''écriture proposée est incomplète.'),
      ('26. une ligne de trop', ecriture_categories || jsonb_build_array(
         jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', 0.01)),
       'L''écriture proposée ne correspond pas à ce mouvement et à cette ventilation.'),
      ('27. une ligne de moins', jsonb_build_array(
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
         jsonb_build_object('compte', cat_achats.compte_comptable, 'sens', 'debit', 'montant', tot)),
       'L''écriture proposée ne correspond pas à ce mouvement et à cette ventilation.'),
      ('28. deux parts aux montants échangés', jsonb_build_array(
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
         jsonb_build_object('compte', cat_achats.compte_comptable, 'sens', 'debit', 'montant', p1 + 0.01),
         jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', p2 - 0.01)),
       'L''écriture proposée ne correspond pas à ce mouvement et à cette ventilation.'),
      ('29. une part sur un autre compte', jsonb_build_array(
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
         jsonb_build_object('compte', '606400', 'sens', 'debit', 'montant', p1),
         jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', p2)),
       'L''écriture proposée ne correspond pas à ce mouvement et à cette ventilation.'),
      ('30. la banque dans le mauvais sens', jsonb_build_array(
         jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', tot),
         jsonb_build_object('compte', cat_achats.compte_comptable, 'sens', 'credit', 'montant', p1),
         jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'credit', 'montant', p2)),
       'L''écriture proposée ne correspond pas à ce mouvement et à cette ventilation.'),
      ('31. la part personnelle sur un autre compte que celui du dossier', jsonb_build_array(
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
         jsonb_build_object('compte', cat_achats.compte_comptable, 'sens', 'debit', 'montant', p1),
         jsonb_build_object('compte', '455000', 'sens', 'debit', 'montant', p2)),
       'L''écriture proposée ne correspond pas à ce mouvement et à cette ventilation.')
    ) as cas(nom, lignes, attendu)
  loop
    accepte := false; code_recu := null;
    declare attendu text := message; recu text;
    begin
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        perform ventiler_mouvement_bancaire(debit.id,
          case when obs like '31.%' then parts_personnelle else parts_categories end, lignes_essai);
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      insert into essai_ventilation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = '22023' and recu = attendu);
    end;
  end loop;

  -- ══ 32 à 36. Les mouvements que la base refuse ═══════════════════════════════════════════════════
  for obs in select unnest(array['32. mouvement rapproché d''une pièce', '33. mouvement affecté à une catégorie',
                                 '34. mouvement classé en virement personnel', '35. mouvement rapproché d''un emprunt',
                                 '36. mouvement de zéro euro']) loop
    accepte := false; code_recu := null; message := null;
    begin
      if obs like '36.%' then
        update lignes_bancaires set montant = 0 where id = debit.id;
      end if;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      if obs like '32.%' then
        perform ventiler_mouvement_bancaire(avec_piece.id, parts_categories, ecriture_categories);
      elsif obs like '33.%' then
        perform affecter_mouvement_bancaire(debit.id, cat_frais.id, jsonb_build_array(
          jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', tot),
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot)));
        perform ventiler_mouvement_bancaire(debit.id, parts_categories, ecriture_categories);
      elsif obs like '34.%' then
        perform classer_virement_personnel(debit.id, jsonb_build_array(
          jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', tot),
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot)));
        perform ventiler_mouvement_bancaire(debit.id, parts_categories, ecriture_categories);
      elsif obs like '35.%' then
        insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
        values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
        perform rapprocher_echeance_emprunt(debit.id, emp, 1, 0, 0, jsonb_build_array(
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
          jsonb_build_object('compte', '164000', 'sens', 'debit', 'montant', tot)));
        perform ventiler_mouvement_bancaire(debit.id, parts_categories, ecriture_categories);
      else
        perform ventiler_mouvement_bancaire(debit.id, parts_categories, ecriture_categories);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_ventilation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '22023' and message = case when obs like '36.%'
        then 'Un mouvement de zéro euro n''a rien à écrire.'
        else 'Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt, affecté à une catégorie ou classé en virement personnel : annule d''abord ce classement.' end);
  end loop;

  -- ══ 37. Retirer ce qui n'est pas ventilé ═════════════════════════════════════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform retirer_ventilation_mouvement_bancaire(debit.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_ventilation values ('37. retirer un mouvement non ventilé', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = 'Ce mouvement n''est pas ventilé.');

  -- ══ 38 et 39. Une écriture VALIDÉE ne se remplace ni ne se retire ══════════════════════════════════
  for obs in select unnest(array['38. écriture validée : pas de nouvelle ventilation', '39. écriture validée : pas de retrait']) loop
    accepte := false; code_recu := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform ventiler_mouvement_bancaire(debit.id, parts_categories, ecriture_categories);
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
      if obs like '38.%' then
        perform ventiler_mouvement_bancaire(debit.id, parts_personnelle, ecriture_personnelle);
      else
        perform retirer_ventilation_mouvement_bancaire(debit.id);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_ventilation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '23514' and message = case when obs like '38.%'
        then 'L''écriture de ce mouvement est validée : elle ne se remplace plus.'
        else 'L''écriture de ce mouvement est validée : elle ne se retire plus.' end);
  end loop;

  -- ══ 40 à 45. Ce qui ne connaît pas la ventilation se heurte à une contrainte NOMMÉE ═══════════════
  -- `affecter_mouvement_bancaire`, `classer_virement_personnel`, `rapprocher_echeance_emprunt` et les mises
  -- à jour directes de l'écran Banque (associer une pièce, remettre à traiter, ignorer) ne lisent pas
  -- `ventilee`. Sur un mouvement ventilé, c'est la base qui refuse : jamais une écriture posée par-dessus
  -- celle de la ventilation, jamais un mouvement « à traiter » qui garde ses parts.
  for obs, message in
    select * from (values
      ('40. affecter une catégorie', 'lignes_bancaires_un_seul_rapprochement'),
      ('41. classer en virement personnel', 'lignes_bancaires_ventilation_rapprochee'),
      ('42. rapprocher d''un emprunt', 'lignes_bancaires_un_seul_rapprochement'),
      ('43. associer une pièce (écran Banque)', 'lignes_bancaires_un_seul_rapprochement'),
      ('44. remettre à traiter (écran Banque)', 'lignes_bancaires_ventilation_rapprochee'),
      ('45. ignorer (écran Banque)', 'lignes_bancaires_ventilation_rapprochee')
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
        perform ventiler_mouvement_bancaire(debit.id, parts_categories, ecriture_categories);
        case substring(obs from '^(\d+)')
          when '40' then
            perform affecter_mouvement_bancaire(debit.id, cat_frais.id, jsonb_build_array(
              jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', tot),
              jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot)));
          when '41' then
            perform classer_virement_personnel(debit.id, jsonb_build_array(
              jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', tot),
              jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot)));
          when '42' then
            perform rapprocher_echeance_emprunt(debit.id, emp, 1, 0, 0, jsonb_build_array(
              jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
              jsonb_build_object('compte', '164000', 'sens', 'debit', 'montant', tot)));
          when '43' then
            update lignes_bancaires set statut = 'rapprochee', piece_id = avec_piece.piece_id, cotisation_id = null
             where id = debit.id;
          when '44' then
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
      insert into essai_ventilation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = '23514' and recu like '%"' || contrainte || '"%');
    end;
  end loop;

  -- ══ 46 à 51. Les contraintes tiennent SANS les fonctions (écritures directes) ══════════════════════
  for obs, message in
    select * from (values
      ('46. une part à deux cibles', 'ventilations_bancaires_cible'),
      ('47. une part sans cible', 'ventilations_bancaires_cible'),
      ('48. une part à zéro euro', 'ventilations_bancaires_montant'),
      ('49. deux parts à la même catégorie', 'ventilations_bancaires_une_part_par_cible'),
      ('50. deux parts personnelles', 'ventilations_bancaires_une_part_par_cible'),
      ('51. un mouvement ventilé laissé à traiter', 'lignes_bancaires_ventilation_rapprochee')
    ) as cas(nom, contrainte)
  loop
    accepte := false; code_recu := null;
    declare contrainte text := message; recu text;
    begin
      begin
        case substring(obs from '^(\d+)')
          when '46' then
            insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, part_personnelle, montant)
            values (dossier_test, debit.id, cat_achats.id, true, -p1);
          when '47' then
            insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, part_personnelle, montant)
            values (dossier_test, debit.id, null, false, -p1);
          when '48' then
            insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, part_personnelle, montant)
            values (dossier_test, debit.id, cat_achats.id, false, 0);
          when '49' then
            insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, part_personnelle, montant)
            values (dossier_test, debit.id, cat_achats.id, false, -p1), (dossier_test, debit.id, cat_achats.id, false, -p2);
          when '50' then
            insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, part_personnelle, montant)
            values (dossier_test, debit.id, null, true, -p1), (dossier_test, debit.id, null, true, -p2);
          else
            update lignes_bancaires set ventilee = true where id = debit.id;
        end case;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      insert into essai_ventilation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = case when obs like '49.%' or obs like '50.%' then '23505' else '23514' end
        and recu like '%"' || contrainte || '"%');
    end;
  end loop;

  -- ══ 52 à 56. La table des parts, par impersonation ═════════════════════════════════════════════
  -- 52 : le client LIT les parts de son dossier (le contrôle POSITIF, sans lequel « il ne lit rien
  -- ailleurs » serait satisfait par une table illisible à tous). 53 : il ne lit pas celles d'un autre.
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ventiler_mouvement_bancaire(du_client.id,
      jsonb_build_array(
        jsonb_build_object('categorie_id', cat_achats.id, 'montant', du_client.montant + 1),
        jsonb_build_object('categorie_id', cat_frais.id, 'montant', -1)),
      jsonb_build_array(
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(du_client.montant)),
        jsonb_build_object('compte', cat_achats.compte_comptable, 'sens', 'debit', 'montant', abs(du_client.montant) - 1),
        jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', 1)));
    perform ventiler_mouvement_bancaire(debit.id, parts_categories, ecriture_categories);
    -- Espace client, étape P7 : seul un accès qui porte la case « Banque » lit les parts. Elle est posée le temps de la
    -- sous-transaction, et le contrôle vaut avant comme après le resserrement (`lectures_bancaires_au_droit_banque`) ;
    -- ce qu'un accès SANS la case ne voit plus est éprouvé par banqueClient.sql et rls.sql (3bis).
    reset role;
    update memberships set droit_banque = true where user_id = client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
    select count(*) filter (where ligne_bancaire_id = du_client.id)::text || ' des siennes, '
           || count(*) filter (where ligne_bancaire_id = debit.id)::text || ' d''un autre dossier'
      into obs from ventilations_bancaires;
    select count(*) filter (where ligne_bancaire_id = du_client.id) = 2
       and count(*) filter (where ligne_bancaire_id = debit.id) = 0
      into ok from ventilations_bancaires;
    perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
    ok := ok and (select count(*) from ventilations_bancaires) = 0;
    -- Et l'anonyme, parts présentes : un refus franc vaut zéro ligne, comme dans rls.sql.
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
    begin
      select count(*) into n from ventilations_bancaires;
    exception when others then n := 0;
    end;
    ok := ok and n = 0;
    obs := obs || ', ' || n::text || ' pour l''anonyme';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_ventilation values ('52. le client à la case « Banque » lit ses parts, pas celles d''un autre ; l''inconnu et l''anonyme aucune',
    coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')), accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- 53 : le client n'ÉCRIT aucune part, même sur son dossier.
  accepte := false; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
    insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, montant)
    values (du_client.dossier_id, du_client.id, cat_achats.id, du_client.montant);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_ventilation values ('53. le client n''écrit aucune part', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message like 'new row violates row-level security policy%');

  -- 54 et 55 : le chef, en écrivant directement, ne peut pas rattacher une part au mouvement d'un autre
  -- dossier que celui qu'elle annonce, ni à la catégorie d'un autre dossier.
  for obs in select unnest(array['54. une part rattachée au mouvement d''un autre dossier',
                                 '55. une part vers la catégorie d''un autre dossier']) loop
    accepte := false; code_recu := null; message := null;
    begin
      if obs like '55.%' then
        insert into categories (code, libelle, dossier_id, compte_comptable, poste_2035)
        values ('essai_ventilation', 'Essai (autre dossier)', du_client.dossier_id, '606400', 'Achats') returning id into cat_autre;
      end if;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      if obs like '54.%' then
        insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, montant)
        values (dossier_test, du_client.id, cat_achats.id, du_client.montant);
      else
        insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, montant)
        values (dossier_test, debit.id, cat_autre, debit.montant);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_ventilation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '42501' and message like 'new row violates row-level security policy%');
  end loop;

  -- 56 : et la même écriture directe, sur SON mouvement et une catégorie partagée, passe — sans quoi 54
  -- et 55 seraient satisfaits par une policy qui refuse tout.
  accepte := false; code_recu := null; message := null; obs := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, montant)
    values (dossier_test, debit.id, cat_achats.id, debit.montant);
    obs := 'écrite';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_ventilation values ('56. le chef écrit une part de son dossier', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001');

  -- ══ 57. Une catégorie ventilée ne se supprime pas ═══════════════════════════════════════════════
  accepte := false; code_recu := null; message := null;
  begin
    insert into categories (code, libelle, dossier_id, compte_comptable, poste_2035)
    values ('essai_ventilation', 'Essai (ventilée)', dossier_test, '606400', 'Achats') returning id into cat_autre;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ventiler_mouvement_bancaire(debit.id, jsonb_build_array(
      jsonb_build_object('categorie_id', cat_autre, 'montant', -p1),
      jsonb_build_object('categorie_id', cat_frais.id, 'montant', -p2)), jsonb_build_array(
      jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
      jsonb_build_object('compte', '606400', 'sens', 'debit', 'montant', p1),
      jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', p2)));
    reset role;
    delete from categories where id = cat_autre;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_ventilation values ('57. catégorie ventilée : pas de suppression', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '23503' and message like '%"ventilations_bancaires_categorie_id_fkey"%');

  -- ══ 58. Supprimer un DOSSIER emporte ses mouvements ventilés et leurs parts ═══════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into dossiers (nom, cabinet_id) values ('Dossier d''essai (ventilation)', (select cabinet_id from dossiers where id = dossier_test))
      returning id into dossier_jetable;
    insert into lignes_bancaires (dossier_id, date, libelle, montant)
    values (dossier_jetable, '2025-02-05', 'CB ESSAI VENTILATION', -100) returning id into ligne_jetable;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ventiler_mouvement_bancaire(ligne_jetable, jsonb_build_array(
      jsonb_build_object('categorie_id', cat_achats.id, 'montant', -70),
      jsonb_build_object('part_personnelle', true, 'montant', -30)), jsonb_build_array(
      jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', 100),
      jsonb_build_object('compte', cat_achats.compte_comptable, 'sens', 'debit', 'montant', 70),
      jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', 30)));
    reset role;
    delete from dossiers where id = dossier_jetable;
    select (select count(*) from lignes_bancaires where id = ligne_jetable) = 0
       and (select count(*) from ventilations_bancaires where ligne_bancaire_id = ligne_jetable) = 0
       and (select count(*) from ecritures_brouillon where dossier_id = dossier_jetable) = 0
      into ok;
    obs := 'dossier supprimé, mouvement et parts partis : ' || ok::text;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_ventilation values ('58. supprimer le dossier emporte ses parts', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 59 et 60. Une part de recette d'un dossier ASSUJETTI porte son taux ══════════════════════════
  -- La remise : 5 € de commission retenus sur une recette brute taxée à 20 %, ou exonérée. Le dossier
  -- devient assujetti DANS la sous-transaction ; la TVA attendue est recalculée ici, par `round`, et non
  -- par la fonction qu'on éprouve.
  tva_brut := round(brut * 20 / 120, 2);
  for obs in select unnest(array['59. une remise taxée à 20 % : la recette au hors taxe, la TVA à côté',
                                 '60. une remise exonérée : trois lignes, le taux zéro gardé']) loop
    accepte := false; code_recu := null; ok := false;
    declare ecr text; vu text; recu text;
    begin
      begin
        update dossiers set assujetti_tva = true where id = dossier_test;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        if obs like '59.%' then
          n := ventiler_mouvement_bancaire(credit.id, jsonb_build_array(
            jsonb_build_object('categorie_id', cat_recettes.id, 'montant', brut, 'taux_tva', 20),
            jsonb_build_object('categorie_id', cat_frais.id, 'montant', -5)), jsonb_build_array(
            jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', credit.montant),
            jsonb_build_object('compte', cat_recettes.compte_comptable, 'sens', 'credit', 'montant', brut - tva_brut),
            jsonb_build_object('compte', '445710', 'sens', 'credit', 'montant', tva_brut),
            jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', 5)));
        else
          n := ventiler_mouvement_bancaire(credit.id, jsonb_build_array(
            jsonb_build_object('categorie_id', cat_recettes.id, 'montant', brut, 'taux_tva', 0),
            jsonb_build_object('categorie_id', cat_frais.id, 'montant', -5)), ecriture_remise);
        end if;
        select string_agg(e.compte || ':' || e.sens || ':' || e.montant::text, ',' order by e.compte) into ecr
          from ecritures_brouillon e where e.ligne_bancaire_id = credit.id and e.piece_id is null;
        select case when obs like '59.%'
                 then n = 4 and ecr = '445710:credit:' || tva_brut::text || ',512000:debit:' || credit.montant::text || ','
                                      || cat_frais.compte_comptable || ':debit:5,'
                                      || cat_recettes.compte_comptable || ':credit:' || (brut - tva_brut)::text
                 else n = 3 end
               and (select taux_tva from ventilations_bancaires where ligne_bancaire_id = credit.id and categorie_id = cat_recettes.id)
                   = case when obs like '59.%' then 20 else 0 end
               and (select taux_tva is null from ventilations_bancaires where ligne_bancaire_id = credit.id and categorie_id = cat_frais.id),
               coalesce(ecr, 'aucune écriture')
          into ok, vu;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      insert into essai_ventilation values (obs, coalesce(vu, coalesce(code_recu, '?') || ' ' || coalesce(recu, '')),
        accepte and code_recu = 'P0001' and coalesce(ok, false));
    end;
  end loop;

  -- ══ 61 à 65. Les taux que la base refuse, chacun pour SA raison ══════════════════════════════════
  for obs, message in
    select * from (values
      ('61. un taux sur une part de dépense', 'Un taux de TVA ne s''applique qu''à une part de recette d''un dossier assujetti.'),
      ('62. un taux sur la part personnelle', 'Un taux de TVA ne s''applique qu''à une part de recette d''un dossier assujetti.'),
      ('63. un taux sur une part de recette, dossier exonéré', 'Un taux de TVA ne s''applique qu''à une part de recette d''un dossier assujetti.'),
      ('64. un taux qui n''est pas pris en charge', 'Ce taux de TVA n''est pas pris en charge.'),
      ('65. la TVA mal répartie', 'L''écriture proposée ne correspond pas à ce mouvement et à cette ventilation.')
    ) as cas(nom, attendu)
  loop
    accepte := false; code_recu := null;
    declare attendu text := message; recu text;
    begin
      begin
        if obs not like '63.%' then
          update dossiers set assujetti_tva = true where id = dossier_test;
        end if;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        if obs like '61.%' then
          perform ventiler_mouvement_bancaire(debit.id, jsonb_build_array(
            jsonb_build_object('categorie_id', cat_achats.id, 'montant', -p1, 'taux_tva', 20),
            jsonb_build_object('categorie_id', cat_frais.id, 'montant', -p2)), ecriture_categories);
        elsif obs like '62.%' then
          perform ventiler_mouvement_bancaire(debit.id, jsonb_build_array(
            jsonb_build_object('categorie_id', cat_achats.id, 'montant', -p1),
            jsonb_build_object('part_personnelle', true, 'montant', -p2, 'taux_tva', 20)), ecriture_personnelle);
        elsif obs like '65.%' then
          perform ventiler_mouvement_bancaire(credit.id, jsonb_build_array(
            jsonb_build_object('categorie_id', cat_recettes.id, 'montant', brut, 'taux_tva', 20),
            jsonb_build_object('categorie_id', cat_frais.id, 'montant', -5)), jsonb_build_array(
            jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', credit.montant),
            jsonb_build_object('compte', cat_recettes.compte_comptable, 'sens', 'credit', 'montant', brut - tva_brut + 0.01),
            jsonb_build_object('compte', '445710', 'sens', 'credit', 'montant', tva_brut - 0.01),
            jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', 5)));
        else
          perform ventiler_mouvement_bancaire(credit.id, jsonb_build_array(
            jsonb_build_object('categorie_id', cat_recettes.id, 'montant', brut, 'taux_tva', case when obs like '64.%' then 7 else 20 end),
            jsonb_build_object('categorie_id', cat_frais.id, 'montant', -5)), ecriture_remise);
        end if;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      insert into essai_ventilation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = '22023' and recu = attendu);
    end;
  end loop;

  -- ══ 66 et 67. Le taux d'une part, tenu par la contrainte SEULE ════════════════════════════════════
  for obs in select unnest(array['66. un taux sur la part personnelle, écrit directement',
                                 '67. un taux hors de la liste, écrit directement']) loop
    accepte := false; code_recu := null;
    declare recu text;
    begin
      begin
        if obs like '66.%' then
          insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, part_personnelle, montant, taux_tva)
          values (dossier_test, debit.id, null, true, -p1, 20);
        else
          insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, part_personnelle, montant, taux_tva)
          values (dossier_test, debit.id, cat_achats.id, false, -p1, 7);
        end if;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      insert into essai_ventilation values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = '23514' and recu like '%"ventilations_bancaires_taux_tva"%');
    end;
  end loop;

  -- ══ 68. Rien n'est resté ══════════════════════════════════════════════════════════════════════════
  select count(*) into nb_apres from ecritures_brouillon;
  select string_agg(concat_ws(':', l.id, l.statut, l.piece_id, l.categorie_id, l.prelevement_personnel, l.montant,
                              l.emprunt_id, l.ventilee), '|' order by l.id)
    into etat_apres from lignes_bancaires l where l.id in (debit.id, credit.id, du_client.id, avec_piece.id);
  insert into essai_ventilation values ('68. rien n''est resté en base',
    'écritures ' || nb_avant || ' -> ' || nb_apres || ', parts ' || parts_avant || ' -> ' || (select count(*) from ventilations_bancaires)
      || ', mouvements ' || (etat_avant = etat_apres)::text
      || ', dossiers ' || dossiers_avant || ' -> ' || (select count(*) from dossiers)
      || ', catégories ' || categories_avant || ' -> ' || (select count(*) from categories)
      || ', emprunts ' || emprunts_avant || ' -> ' || (select count(*) from emprunts),
    nb_avant = nb_apres and etat_avant = etat_apres
      and parts_avant = (select count(*) from ventilations_bancaires)
      and dossiers_avant = (select count(*) from dossiers) and categories_avant = (select count(*) from categories)
      and emprunts_avant = (select count(*) from emprunts)
      and (select mode_comptable = 'tresorerie' and not assujetti_tva from dossiers where id = dossier_test));
end $$;

select controle, ok, observe from essai_ventilation order by
  (regexp_match(controle, '^(\d+)'))[1]::int, controle;
