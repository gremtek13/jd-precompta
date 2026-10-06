-- UN MOUVEMENT ÉCRIT SUR UN COMPTE DE BILAN, ÉPROUVÉ EN BASE — à rejouer par `execute_sql` après toute
-- migration qui touche `ecrire_mouvement_compte_bilan`, `retirer_mouvement_compte_bilan`,
-- `refus_compte_de_bilan`, le modèle comptable d'un dossier ou les contraintes de `lignes_bancaires`
-- (ligne 26.7 de la feuille de route).
--
-- Les deux fonctions posent (ou retirent) le compte de bilan d'un mouvement ET son écriture en une
-- transaction. Ce qui se prouve ici, et ne se relit pas :
--   - QUI peut : un anonyme n'a pas le droit d'appeler, un compte rattaché à rien et un client se font
--     refuser — le client sur le dossier d'un autre comme sur le SIEN —, et le chef du cabinet écrit
--     bien (le contrôle POSITIF, sans lequel les refus seraient satisfaits par une fonction qui refuse
--     tout le monde) ;
--   - CE QUI s'écrit : le compte choisi face à la banque, au montant, à la date et dans le sens du
--     mouvement ; une seconde écriture REMPLACE la première ; un retrait défait les deux ; un mouvement
--     ignoré par une règle s'écrit ; un compte au choix de dix chiffres passe ;
--   - CE QUI est refusé, avec sa RAISON : chaque famille de comptes que `refus_compte_de_bilan` écarte,
--     dans les deux modèles comptables ; une écriture qui ne correspond pas au mouvement ou au compte
--     annoncé ; un mouvement déjà classé ou de zéro euro ; une écriture validée ; un mouvement d'un
--     exercice validé ;
--   - CE QUE les contraintes tiennent SEULES : un 512 posé à la main, un compte de bilan sur un
--     mouvement à traiter ou à côté d'une pièce, « Ignorer » et « Remettre à traiter » faits par une
--     simple mise à jour, et l'affectation ou le virement personnel d'un mouvement déjà écrit — les
--     fonctions d'avant ne connaissent pas ce compte, et c'est une contrainte NOMMÉE qui les arrête ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Chaque écriture d'essai est annulée par sous-transaction (`raise exception 'ANNULATION_ESSAI'`,
-- P0001), le verdict étant posé dans une VARIABLE avant le `raise` — le mécanisme de rls.sql. Un refus
-- se juge à son code ET à son message : un P0001 sans rapport ressemblerait sinon à un refus.
--
-- L'EXERCICE VALIDÉ EST POSÉ À LA MAIN, dans sa sous-transaction : une ligne `exercices_valides` dont
-- la frontière couvre le mouvement. Ce qu'on éprouve ici est que le déclencheur qui fige un mouvement
-- (`garder_mouvement_valide`, qui compare la ligne ENTIÈRE) arrête aussi les deux nouvelles fonctions ;
-- le chemin réel de la validation est celui de `validationExercice.sql`.
--
-- Le passage en engagement (contrôles 50 à 54) exige un brouillon vide dans le dossier test : le
-- déclencheur `dossiers_verrouiller_modele_comptable` refuserait sinon, et l'essai mentirait sur la
-- raison. Il le vérifie avant de commencer.
--
-- ÉPROUVÉ LE 06/10/2026 : 62 contrôles sur 62 en production, le texte transmis identique au fichier sans
-- ses commentaires (562 lignes). Et l'essai sait échouer : sans les `set local role anon`, les contrôles
-- 1 à 3 virent au rouge — l'appel passe alors le droit d'exécution, et c'est la fonction qui refuse, avec
-- un autre message (ou, pour `refus_compte_de_bilan`, qui répond).
create temp table essai_bilan (controle text, observe text, ok boolean) on commit drop;

do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  debit record; credit record; du_client record; avec_piece record; ignoree record; cat_frais record;
  accepte boolean; code_recu text; message text; obs text; ok boolean;
  nom text; compte_essai text; attendu text; lignes_essai jsonb;
  n int; nb_avant int; nb_apres int; etat_avant text; etat_apres text;

  -- L'écriture qu'un paiement écrit au 580000 doit porter : 580000 au débit, la banque au crédit. Les
  -- refus composent la leur dans `lignes_essai` et laissent celle-ci intacte.
  ecriture jsonb;
  tresorerie_charges text := 'En comptabilité de trésorerie, un salaire, une cotisation ou un impôt payés sont des charges : range le paiement dans une catégorie. L''impôt sur le revenu de l''exploitant est un virement personnel.';
  engagement_charges text := 'L''application ne passe pas l''écriture qui solderait ce compte (paie, impôts et taxes) : range le paiement dans une catégorie de charge.';
  deja_classe text := 'Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.';
  ne_correspond_pas text := 'L''écriture proposée ne correspond pas à ce mouvement et à ce compte.';
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
  -- Un mouvement ignoré par une règle « toujours ignorer », donc pas personnel.
  select * into ignoree from lignes_bancaires
   where dossier_id = dossier_test and statut = 'ignoree' and not prelevement_personnel and montant <> 0
   order by id limit 1;
  select * into cat_frais from categories where code = 'frais_bancaires' and dossier_id is null;
  if debit.id is null or credit.id is null or du_client.id is null or avec_piece.id is null
     or ignoree.id is null or cat_frais.id is null then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;
  if exists (select 1 from ecritures_brouillon where dossier_id = dossier_test) then
    raise exception 'ESSAI_IMPOSSIBLE : le dossier test porte des écritures';
  end if;
  if exists (select 1 from exercices_valides where dossier_id = dossier_test) then
    raise exception 'ESSAI_IMPOSSIBLE : le dossier test porte un exercice validé';
  end if;
  if (select mode_comptable <> 'tresorerie' or compte_notes_de_frais <> '455000' from dossiers where id = dossier_test) then
    raise exception 'ESSAI_IMPOSSIBLE : le dossier test n''est plus en trésorerie, compte du dirigeant 455000 en engagement';
  end if;
  select count(*) into nb_avant from ecritures_brouillon;
  select string_agg(concat_ws(':', l.id, l.statut, l.prelevement_personnel, l.montant, l.compte_bilan, l.ventilee, l.reglement_groupe), '|' order by l.id)
    into etat_avant from lignes_bancaires l where l.id in (debit.id, credit.id, ignoree.id, avec_piece.id, du_client.id);

  ecriture := jsonb_build_array(
    jsonb_build_object('compte', '580000', 'sens', 'debit', 'montant', abs(debit.montant), 'libelle', 'essai'),
    jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant), 'libelle', 'essai'));

  -- ══ 1 à 3. Anonyme : pas d'EXECUTE, ni pour écrire, ni pour retirer, ni pour demander un refus ══
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('1. anonyme, écrire', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message like 'permission denied%');

  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform retirer_mouvement_compte_bilan(debit.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('2. anonyme, retirer', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message like 'permission denied%');

  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform refus_compte_de_bilan('580000', 'tresorerie', '108000');
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('3. anonyme, demander un refus', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message like 'permission denied%');

  -- ══ 4 à 7. Rattaché à rien, client sur le dossier d'un autre, client sur le sien ═══════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('4. rattaché à rien', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('5. client, dossier d''un autre', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform ecrire_mouvement_compte_bilan(du_client.id, '580000', jsonb_build_array(
      jsonb_build_object('compte', '580000', 'sens', case when du_client.montant >= 0 then 'credit' else 'debit' end, 'montant', abs(du_client.montant)),
      jsonb_build_object('compte', '512000', 'sens', case when du_client.montant >= 0 then 'debit' else 'credit' end, 'montant', abs(du_client.montant))));
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('6. client, son propre dossier', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform retirer_mouvement_compte_bilan(du_client.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('7. client, retirer sur son dossier', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '42501' and message = 'Accès refusé à ce mouvement.');

  -- ══ 8. Le chef écrit un paiement au 580000 : le compte au débit, la banque au crédit ══════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    n := ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
    select string_agg(e.compte || ':' || e.sens || ':' || e.montant::text || ':' || (e.date = debit.date)::text || ':' || e.statut, ',' order by e.compte)
      into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 2 and l.statut = 'rapprochee' and l.compte_bilan = '580000' and not l.prelevement_personnel
           and obs = '512000:credit:' || abs(debit.montant)::text || ':true:proposee,580000:debit:' || abs(debit.montant)::text || ':true:proposee'
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('8. le chef écrit un paiement au 580000', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 9. Un encaissement au 275000 (un dépôt de garantie rendu) : la banque au débit ═══════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    perform ecrire_mouvement_compte_bilan(credit.id, '275000', jsonb_build_array(
      jsonb_build_object('compte', '275000', 'sens', 'credit', 'montant', credit.montant),
      jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', credit.montant)));
    select string_agg(e.compte || ':' || e.sens, ',' order by e.compte) into obs
      from ecritures_brouillon e where e.ligne_bancaire_id = credit.id and e.piece_id is null;
    select obs = '275000:credit,512000:debit' and l.compte_bilan = '275000' and l.statut = 'rapprochee'
      into ok from lignes_bancaires l where l.id = credit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('9. un dépôt de garantie rendu au 275000', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 10. Une seconde écriture REMPLACE la première ═══════════════════════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    perform ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
    n := ecrire_mouvement_compte_bilan(debit.id, '275000', jsonb_build_array(
      jsonb_build_object('compte', '275000', 'sens', 'debit', 'montant', abs(debit.montant)),
      jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))));
    select string_agg(e.compte, ',' order by e.compte) into obs
      from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 2 and obs = '275000,512000' and l.compte_bilan = '275000'
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('10. la seconde écriture remplace', 'comptes : ' || coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 11. Le retrait défait le compte ET son écriture ═════════════════════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; obs := null; ok := false;
  begin
    perform ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
    n := retirer_mouvement_compte_bilan(debit.id);
    select count(*)::text into obs from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
    select n = 2 and obs = '0' and l.statut = 'non_rapprochee' and l.compte_bilan is null
      into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('11. le retrait défait les deux', 'retirées : ' || coalesce(n::text, '?') || ', restantes : ' || coalesce(obs, '?'),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 12. Un mouvement ignoré par une règle s'écrit, et passe rapproché ══════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; ok := false;
  begin
    n := ecrire_mouvement_compte_bilan(ignoree.id, '580000', jsonb_build_array(
      jsonb_build_object('compte', '580000', 'sens', case when ignoree.montant >= 0 then 'credit' else 'debit' end, 'montant', abs(ignoree.montant)),
      jsonb_build_object('compte', '512000', 'sens', case when ignoree.montant >= 0 then 'debit' else 'credit' end, 'montant', abs(ignoree.montant))));
    select n = 2 and l.statut = 'rapprochee' and l.compte_bilan = '580000' into ok from lignes_bancaires l where l.id = ignoree.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('12. un mouvement ignoré s''écrit', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 13. Un compte au choix de dix chiffres ═════════════════════════════════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null; ok := false;
  begin
    perform ecrire_mouvement_compte_bilan(debit.id, '4670000001', jsonb_build_array(
      jsonb_build_object('compte', '4670000001', 'sens', 'debit', 'montant', abs(debit.montant)),
      jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))));
    select l.compte_bilan = '4670000001' into ok from lignes_bancaires l where l.id = debit.id;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('13. un compte au choix de dix chiffres', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    accepte and code_recu = 'P0001' and coalesce(ok, false));

  -- ══ 14. Retirer un mouvement écrit sur aucun compte de bilan ═══════════════════════════════════
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform retirer_mouvement_compte_bilan(debit.id);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('14. retirer un mouvement écrit nulle part', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = 'Ce mouvement n''est écrit sur aucun compte de bilan.');

  -- ══ 15 à 33. Les comptes refusés en trésorerie, chacun pour SA raison ═════════════════════════
  for nom, compte_essai, attendu in
    select * from (values
      ('15. cinq chiffres', '12345', 'Ce numéro de compte n''a pas la forme d''un compte de l''application : six à dix chiffres.'),
      ('16. une charge (classe 6)', '606100', 'Un compte de charge ou de produit (classe 6 ou 7) s''affecte par une catégorie.'),
      ('17. la classe 8', '801000', 'Un compte de bilan est de classe 1 à 5.'),
      ('18. le 512 d''un autre compte', '512100', 'Le 512 est le compte du relevé lui-même. Un virement vers un autre compte du professionnel (épargne, second compte bancaire) s''écrit au 580000, virements internes.'),
      ('19. la caisse (530)', '530000', 'Un virement vers un autre compte de trésorerie du professionnel (autre banque, caisse, chèques postaux, régie d''avances) s''écrit au 580000, virements internes.'),
      ('20. le compte de l''exploitant (108)', '108000', 'Les apports et les prélèvements du dirigeant passent par « Virement personnel », qui les écrit sur son compte (108000).'),
      ('21. l''emprunt (164)', '164000', 'Une échéance ou un déblocage d''emprunt se rapproche de son emprunt, qui sépare le capital, les intérêts et l''assurance : « Rapprocher d''un emprunt ».'),
      ('22. un fournisseur (401)', '401000', 'Un compte de fournisseur ou de client se solde en rapprochant la facture du mouvement.'),
      ('23. la TVA à décaisser (445)', '445510', 'Un compte de TVA ne se choisit pas ici : la TVA se solde par sa déclaration, à laquelle son paiement et le remboursement d''un crédit se rattachent — ce chemin n''existe pas encore.'),
      ('24. une immobilisation (218)', '218300', 'Un bien s''inscrit au registre des immobilisations depuis sa facture : son acquisition s''écrit sur le compte de sa nature, et il s''amortit.'),
      ('25. un amortissement (28)', '281830', 'Un compte d''amortissement ou de dépréciation ne reçoit pas un mouvement de banque.'),
      ('26. un stock (37)', '370000', 'Un compte de stock ne reçoit pas un mouvement de banque : le stock se constate à l''inventaire.'),
      ('27. une réserve (106)', '106100', 'Les réserves, les écarts de réévaluation ou d''équivalence, le report à nouveau et le résultat ne reçoivent pas un mouvement de banque : ils naissent de l''affectation du résultat ou d''une écriture d''inventaire.'),
      ('28. le report à nouveau (110)', '110000', 'Les réserves, les écarts de réévaluation ou d''équivalence, le report à nouveau et le résultat ne reçoivent pas un mouvement de banque : ils naissent de l''affectation du résultat ou d''une écriture d''inventaire.'),
      ('29. une provision (151)', '151000', 'Une provision ne reçoit pas un mouvement de banque : elle se constate à l''inventaire.'),
      ('30. un compte d''attente (471)', '471000', 'Un compte transitoire ou d''attente ne garde pas un mouvement : un mouvement qu''on ne sait pas encore classer reste à traiter, et l''exercice ne se valide qu''une fois tout classé.'),
      ('31. une charge à payer (468)', '468600', 'Un compte de régularisation (charges à payer, produits à recevoir, charges ou produits constatés d''avance) ne reçoit pas un mouvement de banque : il se passe à l''inventaire.'),
      ('32. une charge constatée d''avance (486)', '486000', 'Un compte de régularisation (charges à payer, produits à recevoir, charges ou produits constatés d''avance) ne reçoit pas un mouvement de banque : il se passe à l''inventaire.'),
      ('33. un salaire en trésorerie (421)', '421000', tresorerie_charges)
    ) as cas(c1, c2, c3)
  loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    accepte := false; code_recu := null; message := null;
    begin
      perform ecrire_mouvement_compte_bilan(debit.id, compte_essai, jsonb_build_array(
        jsonb_build_object('compte', compte_essai, 'sens', 'debit', 'montant', abs(debit.montant)),
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))));
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_bilan values (nom, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '22023' and message = attendu);
  end loop;

  -- ══ 34 à 39. Les écritures que la base refuse, chacune pour SA raison ═════════════════════════
  for nom, lignes_essai, attendu in
    select * from (values
      ('34. pas une liste de lignes', jsonb_build_object('compte', '580000', 'sens', 'debit', 'montant', abs(debit.montant)),
       'L''écriture proposée est incomplète.'),
      ('35. une seule ligne', jsonb_build_array(
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))),
       ne_correspond_pas),
      ('36. le mauvais montant', jsonb_build_array(
         jsonb_build_object('compte', '580000', 'sens', 'debit', 'montant', abs(debit.montant) + 1),
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant) + 1)),
       ne_correspond_pas),
      ('37. le mauvais sens', jsonb_build_array(
         jsonb_build_object('compte', '580000', 'sens', 'credit', 'montant', abs(debit.montant)),
         jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', abs(debit.montant))),
       ne_correspond_pas),
      ('38. un autre compte que celui annoncé', jsonb_build_array(
         jsonb_build_object('compte', '275000', 'sens', 'debit', 'montant', abs(debit.montant)),
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))),
       ne_correspond_pas),
      ('39. une ligne de trop', jsonb_build_array(
         jsonb_build_object('compte', '580000', 'sens', 'debit', 'montant', abs(debit.montant)),
         jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant)),
         jsonb_build_object('compte', '580000', 'sens', 'debit', 'montant', 0)),
       ne_correspond_pas)
    ) as cas(c1, c2, c3)
  loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    accepte := false; code_recu := null; message := null;
    begin
      perform ecrire_mouvement_compte_bilan(debit.id, '580000', lignes_essai);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_bilan values (nom, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '22023' and message = attendu);
  end loop;

  -- ══ 40 à 45. Les mouvements que la base refuse ═════════════════════════════════════════════════
  -- 40. Un mouvement rapproché d'une pièce
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; code_recu := null; message := null;
  begin
    perform ecrire_mouvement_compte_bilan(avec_piece.id, '580000', jsonb_build_array(
      jsonb_build_object('compte', '580000', 'sens', case when avec_piece.montant >= 0 then 'credit' else 'debit' end, 'montant', abs(avec_piece.montant)),
      jsonb_build_object('compte', '512000', 'sens', case when avec_piece.montant >= 0 then 'debit' else 'credit' end, 'montant', abs(avec_piece.montant))));
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('40. mouvement rapproché d''une pièce', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = deja_classe);

  -- 41. Un mouvement affecté à une catégorie (par sa fonction, dans la sous-transaction)
  accepte := false; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform affecter_mouvement_bancaire(debit.id, cat_frais.id, jsonb_build_array(
      jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', abs(debit.montant)),
      jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))), null);
    perform ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('41. mouvement affecté à une catégorie', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = deja_classe);

  -- 42. Un mouvement classé en virement personnel (par sa fonction)
  accepte := false; code_recu := null; message := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform classer_virement_personnel(debit.id, jsonb_build_array(
      jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', abs(debit.montant)),
      jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))));
    perform ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('42. mouvement classé en virement personnel', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = deja_classe);

  -- 43. Un mouvement ventilé (le drapeau posé à la main, dans la sous-transaction)
  accepte := false; code_recu := null; message := null;
  begin
    update lignes_bancaires set ventilee = true, statut = 'rapprochee' where id = debit.id;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('43. mouvement ventilé', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = deja_classe);

  -- 44. Un mouvement qui règle plusieurs pièces (le drapeau posé à la main)
  accepte := false; code_recu := null; message := null;
  begin
    update lignes_bancaires set reglement_groupe = true, statut = 'rapprochee' where id = debit.id;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('44. mouvement qui règle plusieurs pièces', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = 'Ce mouvement règle plusieurs pièces : annule d''abord ce règlement groupé.');

  -- 45. Un mouvement de zéro euro (montant ramené à zéro DANS la sous-transaction)
  accepte := false; code_recu := null; message := null;
  begin
    update lignes_bancaires set montant = 0 where id = debit.id;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform ecrire_mouvement_compte_bilan(debit.id, '580000', jsonb_build_array(
      jsonb_build_object('compte', '580000', 'sens', 'debit', 'montant', 0),
      jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', 0)));
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  insert into essai_bilan values ('45. mouvement de zéro euro', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    not accepte and code_recu = '22023' and message = 'Un mouvement de zéro euro n''a rien à écrire.');

  -- ══ 46 et 47. Une écriture VALIDÉE ne se remplace ni ne se retire ══════════════════════════════
  for nom in select unnest(array['46. écriture validée : pas de remplacement', '47. écriture validée : pas de retrait']) loop
    accepte := false; code_recu := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
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
      if nom like '46.%' then
        perform ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
      else
        perform retirer_mouvement_compte_bilan(debit.id);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_bilan values (nom, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '23514'
      and message = case when nom like '46.%' then 'L''écriture de ce mouvement est validée : elle ne se remplace plus.'
                         else 'L''écriture de ce mouvement est validée : elle ne se retire plus.' end);
  end loop;

  -- ══ 48 et 49. Un mouvement d'un exercice validé ne s'écrit ni ne se retire ═════════════════════
  -- L'exercice validé est posé à la main (voir l'en-tête) : sa frontière, le 31 décembre de l'année du
  -- mouvement, le couvre.
  for nom in select unnest(array['48. exercice validé : pas d''écriture', '49. exercice validé : pas de retrait']) loop
    accepte := false; code_recu := null; message := null;
    begin
      if nom like '49.%' then
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        perform ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
        reset role;
      end if;
      insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures,
                                     total_debit, total_credit, empreinte, declaration)
      values (dossier_test, extract(year from debit.date)::int, now(), chef, 'tresorerie', 0, 0, 0, 0, repeat('0', 64), '{}'::jsonb);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      if nom like '48.%' then
        perform ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
      else
        perform retirer_mouvement_compte_bilan(debit.id);
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_bilan values (nom, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '23514' and message like '%: ce mouvement ne change plus.');
  end loop;

  -- ══ 50 à 54. En engagement : l'impôt sur les bénéfices passe, le dirigeant est le 455000 ════════
  -- Le dossier passe en engagement DANS la sous-transaction, donc en ressort tel qu'il était.
  for nom, compte_essai, attendu in
    select * from (values
      ('50. engagement : l''impôt sur les bénéfices (444)', '444000', null),
      ('51. engagement : une taxe (431)', '431000', engagement_charges),
      ('52. engagement : le compte du dirigeant (455)', '455000', 'Les apports et les prélèvements du dirigeant passent par « Virement personnel », qui les écrit sur son compte (455000).'),
      ('53. engagement : le 108', '108000', 'Les apports et les prélèvements du dirigeant passent par « Virement personnel », qui les écrit sur son compte (455000).'),
      ('54. engagement : un salaire (421)', '421000', engagement_charges)
    ) as cas(c1, c2, c3)
  loop
    accepte := false; code_recu := null; message := null; obs := null;
    begin
      update dossiers set mode_comptable = 'engagement' where id = dossier_test;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform ecrire_mouvement_compte_bilan(debit.id, compte_essai, jsonb_build_array(
        jsonb_build_object('compte', compte_essai, 'sens', 'debit', 'montant', abs(debit.montant)),
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))));
      select string_agg(e.compte || ':' || e.sens, ',' order by e.compte) into obs
        from ecritures_brouillon e where e.ligne_bancaire_id = debit.id and e.piece_id is null;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    if attendu is null then
      insert into essai_bilan values (nom, coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
        accepte and code_recu = 'P0001' and obs = '444000:debit,512000:credit');
    else
      insert into essai_bilan values (nom, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
        not accepte and code_recu = '22023' and message = attendu);
    end if;
  end loop;

  -- ══ 55 à 57. Les contraintes tiennent seules, sans les fonctions ═══════════════════════════════
  for nom in select unnest(array['55. un 512 posé à la main', '56. un compte de bilan sur un mouvement à traiter',
                                 '57. un compte de bilan à côté d''une pièce']) loop
    accepte := false; code_recu := null; message := null;
    begin
      if nom like '55.%' then
        update lignes_bancaires set compte_bilan = '512000', statut = 'rapprochee' where id = debit.id;
      elsif nom like '56.%' then
        update lignes_bancaires set compte_bilan = '580000' where id = debit.id;
      else
        update lignes_bancaires set compte_bilan = '580000' where id = avec_piece.id;
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    insert into essai_bilan values (nom, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '23514'
      and message like '%' || case when nom like '55.%' then 'lignes_bancaires_compte_bilan_format'
                                   when nom like '56.%' then 'lignes_bancaires_compte_bilan_rapproche'
                                   else 'lignes_bancaires_un_seul_rapprochement' end || '%');
  end loop;

  -- ══ 58 à 61. Les gestes d'avant, sur un mouvement écrit : une contrainte NOMMÉE les arrête ══════
  for nom in select unnest(array['58. « Ignorer » par une mise à jour', '59. « Remettre à traiter » par une mise à jour',
                                 '60. l''affecter à une catégorie', '61. le classer en virement personnel']) loop
    accepte := false; code_recu := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      perform ecrire_mouvement_compte_bilan(debit.id, '580000', ecriture);
      if nom like '58.%' then
        update lignes_bancaires set statut = 'ignoree' where id = debit.id;
      elsif nom like '59.%' then
        update lignes_bancaires set statut = 'non_rapprochee' where id = debit.id;
      elsif nom like '60.%' then
        perform affecter_mouvement_bancaire(debit.id, cat_frais.id, jsonb_build_array(
          jsonb_build_object('compte', cat_frais.compte_comptable, 'sens', 'debit', 'montant', abs(debit.montant)),
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))), null);
      else
        perform classer_virement_personnel(debit.id, jsonb_build_array(
          jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', abs(debit.montant)),
          jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', abs(debit.montant))));
      end if;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    insert into essai_bilan values (nom, coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      not accepte and code_recu = '23514'
      and message like '%' || case when nom like '60.%' then 'lignes_bancaires_un_seul_rapprochement'
                                   else 'lignes_bancaires_compte_bilan_rapproche' end || '%');
  end loop;

  -- ══ 62. Rien n'est resté ══════════════════════════════════════════════════════════════════════
  select count(*) into nb_apres from ecritures_brouillon;
  select string_agg(concat_ws(':', l.id, l.statut, l.prelevement_personnel, l.montant, l.compte_bilan, l.ventilee, l.reglement_groupe), '|' order by l.id)
    into etat_apres from lignes_bancaires l where l.id in (debit.id, credit.id, ignoree.id, avec_piece.id, du_client.id);
  insert into essai_bilan values ('62. rien n''est resté en base',
    'écritures ' || nb_avant || ' -> ' || nb_apres || ', mouvements ' || (etat_avant = etat_apres)::text
      || ', dossier ' || (select mode_comptable || ':' || compte_notes_de_frais from dossiers where id = dossier_test)
      || ', exercices validés ' || (select count(*) from exercices_valides where dossier_id = dossier_test),
    nb_avant = nb_apres and etat_avant = etat_apres
      and (select mode_comptable = 'tresorerie' from dossiers where id = dossier_test)
      and not exists (select 1 from exercices_valides where dossier_id = dossier_test));
end $$;

select controle, ok, observe from essai_bilan order by
  (regexp_match(controle, '^(\d+)'))[1]::int, controle;
