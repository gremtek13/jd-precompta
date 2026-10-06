-- LE RÈGLEMENT GROUPÉ DE PLUSIEURS PIÈCES, ÉPROUVÉ EN BASE — à rejouer par `execute_sql` après toute
-- migration qui touche `regler_pieces_par_mouvement`, `retirer_reglement_groupe`, la table
-- `reglements_groupes` ou les contraintes de `lignes_bancaires` (ligne 26 de la feuille de route).
--
-- Les deux fonctions règlent plusieurs pièces par un mouvement — une part par pièce, dont la somme est le
-- mouvement — ou défont ce règlement. Elles n'écrivent pas les écritures (l'application le fait, par le
-- chemin d'un rapprochement simple), mais elles RETIRENT celles du mouvement quand il est réglé de nouveau
-- ou quand on annule. Ce qui se prouve ici, et ne se relit pas :
--   - QUI peut : un anonyme n'a pas le droit d'appeler, un compte rattaché à rien et un client se font
--     refuser — le client sur le dossier d'un autre comme sur le SIEN —, et le chef du cabinet règle bien
--     (le contrôle POSITIF, sans lequel les refus seraient satisfaits par une fonction qui refuse tout le
--     monde) ; et sur la table des parts, le client lit celles de SES dossiers et n'en écrit aucune ;
--   - CE QUI s'écrit : le mouvement rapproché et marqué, `piece_id` nul, une part par pièce au montant
--     donné ; un avoir déduit d'un paiement (une part en sens inverse) ; un second règlement REMPLACE le
--     premier ; les écritures du mouvement partent quand il est réglé de nouveau, et avec le retrait ;
--   - CE QUI est refusé, avec sa RAISON : des parts mal formées (moins de deux, sans pièce, zéro, pas au
--     centime, une pièce deux fois, une pièce d'un autre dossier ou inconnue, une pièce sans montant, une
--     part dans le mauvais sens, une somme qui n'est pas le mouvement), un mouvement déjà rapproché,
--     affecté, ventilé, personnel ou d'emprunt, un mouvement de zéro euro, une écriture validée ;
--   - CE QUE LES CONTRAINTES TIENNENT SANS LE CODE : les fonctions d'avant et les mises à jour directes de
--     l'écran Banque ne connaissent pas le règlement groupé, et chacune se heurte à une contrainte
--     nommée ; une part mal formée écrite directement aussi ; une pièce supprimée laisse sa part SANS
--     pièce, au même montant, et deux pièces du même règlement supprimées ne se heurtent pas ; la
--     suppression d'un DOSSIER emporte tout ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Chaque écriture d'essai est annulée par sa sous-transaction (`raise exception 'ANNULATION_ESSAI'`,
-- P0001), le verdict étant posé dans une VARIABLE avant le `raise` — le mécanisme de rls.sql. Un refus se
-- juge à son code ET à son message : un P0001 sans rapport ressemblerait sinon à un refus.
--
-- ÉPROUVÉ LE 30/09/2026 : 51 contrôles sur 51, le corps transmis comparé au fichier dans le journal de
-- session (identique, 705 lignes ; seule la requête finale, un résumé, différait). Le premier passage en
-- rendait 50 : le contrôle 9 attendait « 10 » d'une colonne numeric(12,2), qui rend « 10.00 » — l'essai
-- avait tort, pas la fonction. Et l'essai sait échouer : sans le `set local role anon`, le contrôle 1 vire
-- au rouge (l'appel passe le droit d'exécution, et c'est la fonction qui refuse, avec un autre message).
--
-- REJOUÉ LE 04/10/2026 après les migrations de la validation d'un exercice : l'écriture validée dont
-- l'essai a besoin se pose désormais comme `valider_exercice` la pose, sous le réglage
-- `jd.validation_exercice` du dossier et avec les champs que lit son FEC — une écriture ne passe plus à
-- `validee` autrement. 48 contrôles sur 48 en production, le texte transmis identique au fichier, ses
-- commentaires et les contrôles 48 à 50 retirés. Ceux-là, qui suppriment (une pièce, puis un dossier),
-- n'y ont pas été rejoués : l'outil demande alors une confirmation qui ne parvient pas au cabinet. La
-- suppression d'un dossier à travers les nouveaux déclencheurs, écritures validées comprises, a été
-- éprouvée sur une réplique locale du schéma. La table des verdicts disparaît avec la transaction (`on
-- commit drop`) au lieu d'être supprimée en tête : l'essai ne porte plus d'instruction de suppression
-- hors de ses contrôles.
-- REJOUÉ LE 06/10/2026 après `compte_de_bilan_du_releve`, qui réécrit la contrainte d'un seul rapprochement :
-- 48 contrôles sur 48 en production, le texte transmis identique au fichier, ses commentaires et les
-- contrôles 48 à 50 retirés pour la même raison qu'au 04/10 — à la requête finale près, qui ne rendait le
-- message observé que d'un contrôle en échec : ceux des contrôles 20 et 22 citent le fournisseur d'une
-- pièce du dossier.
create temp table essai_reglement_groupe (controle text, observe text, ok boolean) on commit drop;

do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  debit record; credit record; du_client record; avec_piece record;
  piece_a record; piece_b record; piece_c record; vente_a record; vente_b record; piece_client record;
  cat_frais record; emp uuid; dossier_jetable uuid; ligne_jetable uuid; piece_j1 uuid; piece_j2 uuid;
  accepte boolean; code_recu text; message text; obs text; ok boolean;
  n int; nb_avant int; nb_apres int; parts_avant int; etat_avant text; etat_apres text;
  pieces_avant text; pieces_apres text; dossiers_avant int; emprunts_avant int;

  tot numeric; p1 numeric; p2 numeric;
  parts_ab jsonb; parts_ac jsonb; parts_client jsonb; parts_essai jsonb;
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
  select * into piece_a from pieces
   where dossier_id = dossier_test and type_piece = 'achat' and montant_ttc > 0 order by id limit 1;
  select * into piece_b from pieces
   where dossier_id = dossier_test and type_piece = 'achat' and montant_ttc > 0 and id <> piece_a.id order by id limit 1;
  select * into piece_c from pieces
   where dossier_id = dossier_test and type_piece = 'achat' and montant_ttc > 0 and id not in (piece_a.id, piece_b.id)
   order by id limit 1;
  select * into vente_a from pieces
   where dossier_id = dossier_test and type_piece = 'vente' and montant_ttc > 0 order by id limit 1;
  select * into vente_b from pieces
   where dossier_id = dossier_test and type_piece = 'vente' and montant_ttc > 0 and id <> vente_a.id order by id limit 1;
  select * into piece_client from pieces
   where dossier_id = du_client.dossier_id and type_piece = 'achat' and montant_ttc > 0 order by id limit 1;
  select * into cat_frais from categories where code = 'frais_bancaires' and dossier_id is null;
  if debit.id is null or credit.id is null or du_client.id is null or avec_piece.id is null
     or piece_a.id is null or piece_b.id is null or piece_c.id is null or vente_a.id is null or vente_b.id is null
     or piece_client.id is null or cat_frais.id is null or du_client.dossier_id = dossier_test then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;

  select count(*) into nb_avant from ecritures_brouillon;
  select count(*) into parts_avant from reglements_groupes;
  select count(*) into dossiers_avant from dossiers;
  select count(*) into emprunts_avant from emprunts;
  select string_agg(concat_ws(':', l.id, l.statut, l.piece_id, l.categorie_id, l.prelevement_personnel, l.montant,
                              l.emprunt_id, l.ventilee, l.reglement_groupe), '|' order by l.id)
    into etat_avant from lignes_bancaires l where l.id in (debit.id, credit.id, du_client.id, avec_piece.id);
  select string_agg(concat_ws(':', p.id, p.type_piece, p.montant_ttc), '|' order by p.id)
    into pieces_avant from pieces p where p.id in (piece_a.id, piece_b.id, piece_c.id, vente_a.id, vente_b.id, piece_client.id);

  tot := abs(debit.montant);
  p1 := round(tot * 0.6, 2);
  p2 := tot - p1;
  parts_ab := jsonb_build_array(
    jsonb_build_object('piece_id', piece_a.id, 'montant', -p1),
    jsonb_build_object('piece_id', piece_b.id, 'montant', -p2));
  parts_ac := jsonb_build_array(
    jsonb_build_object('piece_id', piece_a.id, 'montant', -p1),
    jsonb_build_object('piece_id', piece_c.id, 'montant', -p2));
  parts_client := jsonb_build_array(
    jsonb_build_object('piece_id', piece_client.id, 'montant', du_client.montant + 1),
    jsonb_build_object('piece_id', piece_client.id, 'montant', -1));

  -- ══ 1 et 2. Anonyme : pas d'EXECUTE, ni pour régler ni pour retirer ═══════════════════════════
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform regler_pieces_par_mouvement(debit.id, parts_ab);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_reglement_groupe values ('1. anonyme, régler', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message like 'permission denied%');

  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform retirer_reglement_groupe(debit.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_reglement_groupe values ('2. anonyme, retirer', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
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
        perform regler_pieces_par_mouvement(debit.id, parts_ab);
      elsif obs like '5.%' then
        perform regler_pieces_par_mouvement(du_client.id, parts_client);
      else
        perform retirer_reglement_groupe(du_client.id);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_reglement_groupe values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');
  end loop;

  -- ══ 7. Le chef règle deux factures d'achat par une sortie ══════════════════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := regler_pieces_par_mouvement(debit.id, parts_ab);
    select string_agg(r.piece_id::text || ':' || r.montant::text || ':' || (r.dossier_id = dossier_test)::text, ',' order by r.montant)
      into obs from reglements_groupes r where r.ligne_bancaire_id = debit.id;
    select n = 2 and l.statut = 'rapprochee' and l.reglement_groupe and l.piece_id is null and l.categorie_id is null
           and not l.ventilee
           and obs = (select string_agg(x, ',' order by m) from (values
                   (piece_a.id::text || ':' || (-p1)::text || ':true', -p1),
                   (piece_b.id::text || ':' || (-p2)::text || ':true', -p2)) as t(x, m))
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_reglement_groupe values ('7. le chef règle deux factures par une sortie', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 8. Une entrée qui règle deux factures de vente ═════════════════════════════════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := regler_pieces_par_mouvement(credit.id, jsonb_build_array(
      jsonb_build_object('piece_id', vente_a.id, 'montant', credit.montant - 1),
      jsonb_build_object('piece_id', vente_b.id, 'montant', 1)));
    select count(*)::text into obs from reglements_groupes r where r.ligne_bancaire_id = credit.id;
    select n = 2 and obs = '2' and l.reglement_groupe and l.statut = 'rapprochee' into ok
      from lignes_bancaires l where l.id = credit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_reglement_groupe values ('8. une entrée règle deux factures de vente', 'parts : ' || coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 9. Un avoir déduit d'un paiement : une part en SENS INVERSE du mouvement ════════════════════
  -- La facture est réglée de 10 € de plus que la sortie, l'avoir de 10 € en entrée.
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    update pieces set montant_ttc = -10 where id = piece_c.id;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    n := regler_pieces_par_mouvement(debit.id, jsonb_build_array(
      jsonb_build_object('piece_id', piece_a.id, 'montant', debit.montant - 10),
      jsonb_build_object('piece_id', piece_c.id, 'montant', 10)));
    select string_agg(r.montant::text, ',' order by r.montant) into obs from reglements_groupes r where r.ligne_bancaire_id = debit.id;
    -- La colonne est un numeric(12,2) : elle rend « 10.00 », pas « 10 ».
    ok := n = 2 and obs = (debit.montant - 10)::text || ',10.00';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_reglement_groupe values ('9. un avoir déduit d''un paiement', 'parts : ' || coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 10. Un second règlement REMPLACE le premier, et retire les écritures du mouvement ═══════════
  -- L'écriture posée entre les deux est celle que l'application aurait écrite pour la première part.
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform regler_pieces_par_mouvement(debit.id, parts_ab);
    insert into ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
    values (dossier_test, piece_a.id, debit.id, debit.date, '512000', 'essai', p1, 'credit', 'proposee');
    n := regler_pieces_par_mouvement(debit.id, parts_ac);
    select string_agg(r.piece_id::text, ',' order by r.piece_id::text) into obs from reglements_groupes r where r.ligne_bancaire_id = debit.id;
    ok := n = 2
      and obs = (select string_agg(x, ',' order by x) from unnest(array[piece_a.id::text, piece_c.id::text]) as x)
      and (select count(*) from ecritures_brouillon e where e.ligne_bancaire_id = debit.id) = 0;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_reglement_groupe values ('10. le second règlement remplace, sans écriture restante', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 11. Le retrait défait le règlement, ses parts ET les écritures du mouvement ═══════════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform regler_pieces_par_mouvement(debit.id, parts_ab);
    insert into ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
    values (dossier_test, piece_a.id, debit.id, debit.date, '512000', 'essai', p1, 'credit', 'proposee'),
           (dossier_test, piece_b.id, debit.id, debit.date, '512000', 'essai', p2, 'credit', 'proposee');
    n := retirer_reglement_groupe(debit.id);
    select count(*)::text into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id;
    select n = 2 and obs = '0' and l.statut = 'non_rapprochee' and not l.reglement_groupe and l.piece_id is null
           and (select count(*) from reglements_groupes r where r.ligne_bancaire_id = debit.id) = 0
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_reglement_groupe values ('11. le retrait défait les trois', 'retirées : ' || coalesce(n::text, '?') || ', restantes : ' || coalesce(obs, '?'),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 12 à 21. Les parts que la base refuse, chacune pour SA raison ═════════════════════════════════
  for obs, parts_essai, message in
    select * from (values
      ('12. pas un tableau', jsonb_build_object('piece_id', piece_a.id), 'Un règlement groupé porte au moins deux pièces.'),
      ('13. une seule part', jsonb_build_array(jsonb_build_object('piece_id', piece_a.id, 'montant', debit.montant)),
       'Un règlement groupé porte au moins deux pièces.'),
      ('14. une part sans pièce', jsonb_build_array(
         jsonb_build_object('montant', -p1),
         jsonb_build_object('piece_id', piece_b.id, 'montant', -p2)),
       'Chaque part désigne une pièce.'),
      ('15. une part à zéro euro', jsonb_build_array(
         jsonb_build_object('piece_id', piece_a.id, 'montant', debit.montant),
         jsonb_build_object('piece_id', piece_b.id, 'montant', 0)),
       'Chaque part porte un montant non nul, au centime.'),
      ('16. une part pas au centime', jsonb_build_array(
         jsonb_build_object('piece_id', piece_a.id, 'montant', -p1 - 0.004),
         jsonb_build_object('piece_id', piece_b.id, 'montant', -p2 + 0.004)),
       'Chaque part porte un montant non nul, au centime.'),
      ('17. la même pièce deux fois', jsonb_build_array(
         jsonb_build_object('piece_id', piece_a.id, 'montant', -p1),
         jsonb_build_object('piece_id', piece_a.id, 'montant', -p2)),
       'La même pièce figure deux fois : réunis ses parts en une.'),
      ('18. une pièce d''un autre dossier', jsonb_build_array(
         jsonb_build_object('piece_id', piece_a.id, 'montant', -p1),
         jsonb_build_object('piece_id', piece_client.id, 'montant', -p2)),
       'Cette pièce n''existe pas pour ce dossier.'),
      ('19. une pièce inconnue', jsonb_build_array(
         jsonb_build_object('piece_id', piece_a.id, 'montant', -p1),
         jsonb_build_object('piece_id', inconnu, 'montant', -p2)),
       'Cette pièce n''existe pas pour ce dossier.'),
      ('20. une part dans le mauvais sens, la somme juste', jsonb_build_array(
         jsonb_build_object('piece_id', piece_a.id, 'montant', debit.montant - 10),
         jsonb_build_object('piece_id', piece_b.id, 'montant', 10)),
       'La part de la pièce « % » va dans le mauvais sens : une dépense se règle par une sortie, une recette par une entrée, un avoir à l''inverse.'),
      ('21. des parts qui ne font pas le mouvement', jsonb_build_array(
         jsonb_build_object('piece_id', piece_a.id, 'montant', -p1),
         jsonb_build_object('piece_id', piece_b.id, 'montant', -p2 - 0.01)),
       'Les parts font % € au lieu des % € du mouvement.')
    ) as cas(nom, parts, attendu)
  loop
    accepte := false; code_recu := null;
    declare attendu text := message; recu text;
    begin
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        perform regler_pieces_par_mouvement(debit.id, parts_essai);
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      reset role;
      insert into essai_reglement_groupe values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = '22023' and recu like attendu);
    end;
  end loop;

  -- 22. Une pièce SANS MONTANT lu ne se règle pas avec d'autres. Son montant est effacé DANS la
  -- sous-transaction, et le nom qu'elle porte dans le message est celui que la base lit.
  accepte := false; code_recu := null; message := null;
  begin
    update pieces set montant_ttc = null where id = piece_b.id;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform regler_pieces_par_mouvement(debit.id, parts_ab);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_reglement_groupe values ('22. une pièce sans montant lu', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023'
    and message = 'La pièce « ' || coalesce(nullif(regexp_replace(trim(piece_b.tiers), '\s+', ' ', 'g'), ''), piece_b.nom_fichier)
                  || ' » n''a pas de montant lu : saisis-le avant de la régler avec d''autres.');

  -- ══ 23 à 28. Les mouvements que la base refuse ═══════════════════════════════════════════════════
  for obs in select unnest(array['23. mouvement rapproché d''une pièce', '24. mouvement affecté à une catégorie',
                                 '25. mouvement ventilé', '26. mouvement classé en virement personnel',
                                 '27. mouvement rapproché d''un emprunt', '28. mouvement de zéro euro']) loop
    accepte := false; code_recu := null; message := null;
    begin
      if obs like '28.%' then
        update lignes_bancaires set montant = 0 where id = debit.id;
      end if;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      if obs like '23.%' then
        perform regler_pieces_par_mouvement(avec_piece.id, parts_ab);
      elsif obs like '24.%' then
        perform affecter_mouvement_bancaire(debit.id, cat_frais.id, jsonb_build_array(
          jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', tot),
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot)));
        perform regler_pieces_par_mouvement(debit.id, parts_ab);
      elsif obs like '25.%' then
        perform ventiler_mouvement_bancaire(debit.id, jsonb_build_array(
          jsonb_build_object('categorie_id', cat_frais.id, 'montant', -p1),
          jsonb_build_object('part_personnelle', true, 'montant', -p2)), jsonb_build_array(
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
          jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', p1),
          jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', p2)));
        perform regler_pieces_par_mouvement(debit.id, parts_ab);
      elsif obs like '26.%' then
        perform classer_virement_personnel(debit.id, jsonb_build_array(
          jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', tot),
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot)));
        perform regler_pieces_par_mouvement(debit.id, parts_ab);
      elsif obs like '27.%' then
        insert into emprunts (dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois)
        values (dossier_test, 'Emprunt d''essai', 20000, 3.5, '2025-01-01', 60) returning id into emp;
        perform rapprocher_echeance_emprunt(debit.id, emp, 1, 0, 0, jsonb_build_array(
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
          jsonb_build_object('compte', '164000', 'sens', 'debit', 'montant', tot)));
        perform regler_pieces_par_mouvement(debit.id, parts_ab);
      else
        perform regler_pieces_par_mouvement(debit.id, parts_ab);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_reglement_groupe values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '22023' and message = case when obs like '28.%'
        then 'Un mouvement de zéro euro ne règle rien.'
        else 'Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt, affecté à une catégorie, ventilé ou classé en virement personnel : annule d''abord ce classement.' end);
  end loop;

  -- ══ 29. Retirer ce qui n'est pas réglé en groupe ═════════════════════════════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform retirer_reglement_groupe(debit.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_reglement_groupe values ('29. retirer un mouvement qui ne règle pas plusieurs pièces', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = 'Ce mouvement ne règle pas plusieurs pièces.');

  -- ══ 30 et 31. Une écriture VALIDÉE du mouvement : son règlement ne se remplace ni ne se retire ═════
  for obs in select unnest(array['30. écriture validée : pas de nouveau règlement', '31. écriture validée : pas de retrait']) loop
    accepte := false; code_recu := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform regler_pieces_par_mouvement(debit.id, parts_ab);
      reset role;
      -- Une écriture se valide comme `valider_exercice` la valide : sous le réglage de son dossier, avec les
      -- champs que son FEC lit (contrainte `ecritures_brouillon_validation_complete`).
      perform set_config('jd.validation_exercice', dossier_test::text, true);
      insert into ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut,
                                       valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib)
      values (dossier_test, piece_a.id, debit.id, debit.date, '512000', 'essai', p1, 'credit', 'validee',
              now(), 'BQ', 1, 'essai', debit.date, 'essai');
      perform set_config('jd.validation_exercice', '', true);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      if obs like '30.%' then
        perform regler_pieces_par_mouvement(debit.id, parts_ac);
      else
        perform retirer_reglement_groupe(debit.id);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_reglement_groupe values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '23514' and message = case when obs like '30.%'
        then 'Une écriture de ce mouvement est validée : son règlement ne se remplace plus.'
        else 'Une écriture de ce mouvement est validée : son règlement ne se retire plus.' end);
  end loop;

  -- ══ 32 à 38. Ce qui ne connaît pas le règlement groupé se heurte à une contrainte NOMMÉE ═══════════
  -- `affecter_mouvement_bancaire`, `ventiler_mouvement_bancaire`, `classer_virement_personnel`,
  -- `rapprocher_echeance_emprunt` et les mises à jour directes de l'écran Banque (associer une pièce,
  -- remettre à traiter, ignorer) ne lisent pas `reglement_groupe`. Sur un mouvement réglé en groupe, c'est
  -- la base qui refuse : jamais un second lien posé par-dessus, jamais un mouvement « à traiter » qui garde
  -- ses parts.
  for obs, message in
    select * from (values
      ('32. affecter une catégorie', 'lignes_bancaires_un_seul_rapprochement'),
      ('33. ventiler', 'lignes_bancaires_un_seul_rapprochement'),
      ('34. classer en virement personnel', 'lignes_bancaires_reglement_groupe_rapproche'),
      ('35. rapprocher d''un emprunt', 'lignes_bancaires_un_seul_rapprochement'),
      ('36. associer une pièce (écran Banque)', 'lignes_bancaires_un_seul_rapprochement'),
      ('37. remettre à traiter (écran Banque)', 'lignes_bancaires_reglement_groupe_rapproche'),
      ('38. ignorer (écran Banque)', 'lignes_bancaires_reglement_groupe_rapproche')
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
        perform regler_pieces_par_mouvement(debit.id, parts_ab);
        case substring(obs from '^(\d+)')
          when '32' then
            perform affecter_mouvement_bancaire(debit.id, cat_frais.id, jsonb_build_array(
              jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', tot),
              jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot)));
          when '33' then
            perform ventiler_mouvement_bancaire(debit.id, jsonb_build_array(
              jsonb_build_object('categorie_id', cat_frais.id, 'montant', -p1),
              jsonb_build_object('part_personnelle', true, 'montant', -p2)), jsonb_build_array(
              jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
              jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', p1),
              jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', p2)));
          when '34' then
            perform classer_virement_personnel(debit.id, jsonb_build_array(
              jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', tot),
              jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot)));
          when '35' then
            perform rapprocher_echeance_emprunt(debit.id, emp, 1, 0, 0, jsonb_build_array(
              jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', tot),
              jsonb_build_object('compte', '164000', 'sens', 'debit', 'montant', tot)));
          when '36' then
            update lignes_bancaires set statut = 'rapprochee', piece_id = avec_piece.piece_id, cotisation_id = null
             where id = debit.id;
          when '37' then
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
      insert into essai_reglement_groupe values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = '23514' and recu like '%"' || contrainte || '"%');
    end;
  end loop;

  -- ══ 39 à 42. Les contraintes tiennent SANS les fonctions (écritures directes) ══════════════════════
  for obs, message in
    select * from (values
      ('39. une part à zéro euro', 'reglements_groupes_montant'),
      ('40. deux parts sur la même pièce', 'reglements_groupes_une_part_par_piece'),
      ('41. un mouvement réglé laissé à traiter', 'lignes_bancaires_reglement_groupe_rapproche'),
      ('42. un mouvement réglé en groupe ET rapproché d''une pièce', 'lignes_bancaires_un_seul_rapprochement')
    ) as cas(nom, contrainte)
  loop
    accepte := false; code_recu := null;
    declare contrainte text := message; recu text;
    begin
      begin
        case substring(obs from '^(\d+)')
          when '39' then
            insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant)
            values (dossier_test, debit.id, piece_a.id, 0);
          when '40' then
            insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant)
            values (dossier_test, debit.id, piece_a.id, -p1), (dossier_test, debit.id, piece_a.id, -p2);
          when '41' then
            update lignes_bancaires set reglement_groupe = true where id = debit.id;
          else
            update lignes_bancaires set reglement_groupe = true where id = avec_piece.id;
        end case;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; recu := sqlerrm;
      end;
      insert into essai_reglement_groupe values (obs, coalesce(code_recu, '?') || ' ' || coalesce(recu, ''),
        not accepte and code_recu = case when obs like '40.%' then '23505' else '23514' end
        and recu like '%"' || contrainte || '"%');
    end;
  end loop;

  -- ══ 43 à 47. La table des parts, par impersonation ═════════════════════════════════════════════
  -- 43 : le client LIT les parts de son dossier (le contrôle POSITIF, sans lequel « il ne lit rien
  -- ailleurs » serait satisfait par une table illisible à tous), pas celles d'un autre ; l'inconnu et
  -- l'anonyme aucune. Les parts de son dossier s'écrivent directement, sous le chef : la fonction exige
  -- deux pièces distinctes, et un seul achat de son dossier suffit à l'essai.
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant)
    values (du_client.dossier_id, du_client.id, piece_client.id, du_client.montant);
    perform regler_pieces_par_mouvement(debit.id, parts_ab);
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
    select count(*) filter (where ligne_bancaire_id = du_client.id)::text || ' des siennes, '
           || count(*) filter (where ligne_bancaire_id = debit.id)::text || ' d''un autre dossier'
      into obs from reglements_groupes;
    select count(*) filter (where ligne_bancaire_id = du_client.id) = 1
       and count(*) filter (where ligne_bancaire_id = debit.id) = 0
      into ok from reglements_groupes;
    perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
    ok := ok and (select count(*) from reglements_groupes) = 0;
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
    begin
      select count(*) into n from reglements_groupes;
    exception when others then n := 0;
    end;
    ok := ok and n = 0;
    obs := obs || ', ' || n::text || ' pour l''anonyme';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_reglement_groupe values ('43. le client lit ses parts, pas celles d''un autre ; l''inconnu et l''anonyme aucune',
    coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')), accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- 44 : le client n'ÉCRIT aucune part, même sur son dossier.
  accepte := false; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
    insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant)
    values (du_client.dossier_id, du_client.id, piece_client.id, du_client.montant);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_reglement_groupe values ('44. le client n''écrit aucune part', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message like 'new row violates row-level security policy%');

  -- 45 et 46 : le chef, en écrivant directement, ne peut pas rattacher une part au mouvement d'un autre
  -- dossier que celui qu'elle annonce, ni à la pièce d'un autre dossier.
  for obs in select unnest(array['45. une part rattachée au mouvement d''un autre dossier',
                                 '46. une part vers la pièce d''un autre dossier']) loop
    accepte := false; code_recu := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      if obs like '45.%' then
        insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant)
        values (dossier_test, du_client.id, piece_a.id, du_client.montant);
      else
        insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant)
        values (dossier_test, debit.id, piece_client.id, debit.montant);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_reglement_groupe values (obs, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '42501' and message like 'new row violates row-level security policy%');
  end loop;

  -- 47 : et la même écriture directe, sur SON mouvement et SA pièce, passe — sans quoi 45 et 46 seraient
  -- satisfaits par une policy qui refuse tout.
  accepte := false; code_recu := null; message := null; obs := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant)
    values (dossier_test, debit.id, piece_a.id, debit.montant);
    obs := 'écrite';
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_reglement_groupe values ('47. le chef écrit une part de son dossier', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001');

  -- ══ 48 et 49. Une pièce supprimée laisse sa part, sans pièce, au même montant ═════════════════════
  -- 48 : la suppression passe (pas de blocage), la part reste avec son montant et le mouvement reste réglé.
  -- 49 : deux pièces du même règlement supprimées ne se heurtent pas (contrainte unique NULLS DISTINCT).
  for obs in select unnest(array['48. une pièce réglée supprimée laisse sa part', '49. deux pièces du même règlement supprimées']) loop
    accepte := false; code_recu := null; message := null; ok := false;
    declare detail text;
    begin
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        perform regler_pieces_par_mouvement(debit.id, parts_ab);
        reset role;
        delete from pieces where id = piece_b.id;
        if obs like '49.%' then
          delete from pieces where id = piece_a.id;
        end if;
        select string_agg(coalesce(r.piece_id::text, 'sans pièce') || ':' || r.montant::text, ',' order by r.montant)
          into detail from reglements_groupes r where r.ligne_bancaire_id = debit.id;
        select case when obs like '48.%'
                 then detail = (select string_agg(x, ',' order by m) from (values
                        (piece_a.id::text || ':' || (-p1)::text, -p1), ('sans pièce:' || (-p2)::text, -p2)) as t(x, m))
                 else detail = (select string_agg(x, ',' order by m) from (values
                        ('sans pièce:' || (-p1)::text, -p1), ('sans pièce:' || (-p2)::text, -p2)) as t(x, m))
               end
               and l.reglement_groupe and l.statut = 'rapprochee'
          into ok from lignes_bancaires l where l.id = debit.id;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      reset role;
      insert into essai_reglement_groupe values (obs, coalesce(detail, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
        accepte and code_recu = 'P0001' and coalesce(ok, false));
    end;
  end loop;

  -- ══ 50. Supprimer un DOSSIER emporte ses mouvements réglés en groupe et leurs parts ═══════════════
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    insert into dossiers (nom, cabinet_id) values ('Dossier d''essai (règlement groupé)', (select cabinet_id from dossiers where id = dossier_test))
      returning id into dossier_jetable;
    insert into lignes_bancaires (dossier_id, date, libelle, montant)
    values (dossier_jetable, '2025-02-05', 'VIR FOURNISSEUR ESSAI', -100) returning id into ligne_jetable;
    insert into pieces (dossier_id, storage_path, nom_fichier, type_piece, montant_ttc)
    values (dossier_jetable, dossier_jetable || '/essai-1.pdf', 'essai-1.pdf', 'achat', 70) returning id into piece_j1;
    insert into pieces (dossier_id, storage_path, nom_fichier, type_piece, montant_ttc)
    values (dossier_jetable, dossier_jetable || '/essai-2.pdf', 'essai-2.pdf', 'achat', 30) returning id into piece_j2;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform regler_pieces_par_mouvement(ligne_jetable, jsonb_build_array(
      jsonb_build_object('piece_id', piece_j1, 'montant', -70),
      jsonb_build_object('piece_id', piece_j2, 'montant', -30)));
    reset role;
    delete from dossiers where id = dossier_jetable;
    select (select count(*) from lignes_bancaires where id = ligne_jetable) = 0
       and (select count(*) from reglements_groupes where ligne_bancaire_id = ligne_jetable) = 0
       and (select count(*) from pieces where dossier_id = dossier_jetable) = 0
      into ok;
    obs := 'dossier supprimé, mouvement, pièces et parts partis : ' || ok::text;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_reglement_groupe values ('50. supprimer le dossier emporte ses parts', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 51. Rien n'est resté ══════════════════════════════════════════════════════════════════════════
  select count(*) into nb_apres from ecritures_brouillon;
  select string_agg(concat_ws(':', l.id, l.statut, l.piece_id, l.categorie_id, l.prelevement_personnel, l.montant,
                              l.emprunt_id, l.ventilee, l.reglement_groupe), '|' order by l.id)
    into etat_apres from lignes_bancaires l where l.id in (debit.id, credit.id, du_client.id, avec_piece.id);
  select string_agg(concat_ws(':', p.id, p.type_piece, p.montant_ttc), '|' order by p.id)
    into pieces_apres from pieces p where p.id in (piece_a.id, piece_b.id, piece_c.id, vente_a.id, vente_b.id, piece_client.id);
  insert into essai_reglement_groupe values ('51. rien n''est resté en base',
    'écritures ' || nb_avant || ' -> ' || nb_apres || ', parts ' || parts_avant || ' -> ' || (select count(*) from reglements_groupes)
      || ', mouvements ' || (etat_avant = etat_apres)::text || ', pièces ' || (pieces_avant = pieces_apres)::text
      || ', dossiers ' || dossiers_avant || ' -> ' || (select count(*) from dossiers)
      || ', emprunts ' || emprunts_avant || ' -> ' || (select count(*) from emprunts),
    nb_avant = nb_apres and etat_avant = etat_apres and pieces_avant = pieces_apres
      and parts_avant = (select count(*) from reglements_groupes)
      and dossiers_avant = (select count(*) from dossiers)
      and emprunts_avant = (select count(*) from emprunts));
end $$;

select controle, ok, observe from essai_reglement_groupe order by
  (regexp_match(controle, '^(\d+)'))[1]::int, controle;
