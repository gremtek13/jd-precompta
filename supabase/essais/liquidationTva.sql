-- LA LIQUIDATION DE LA TVA, SON PAIEMENT ET SON REMBOURSEMENT, ÉPROUVÉS EN BASE — à rejouer par `execute_sql` après
-- toute migration qui touche `enregistrer_declaration_tva`, `ecrire_liquidation_tva`, `liquidation_attendue`,
-- `retirer_declaration_tva`, `rapprocher_declaration_tva`, `retirer_rapprochement_declaration_tva`, les déclencheurs
-- de `declarations_tva`, ses contraintes ou celles de `lignes_bancaires` et d'`ecritures_brouillon` (ligne 26.8 de la
-- feuille de route).
--
-- Une déclaration s'enregistre avec sa liquidation, dans une transaction : la TVA de la période quitte les comptes
-- 445710, 445660 et 445620 pour le 445510 (à payer) ou le 445670 (crédit), le remboursement demandé va au 445830, et
-- l'arrondi à l'euro de la CA3 au 658000 ou au 758000. Le paiement et le remboursement se rapprochent de leur
-- déclaration et s'écrivent face à la banque. Ce qui se prouve ici, et ne se relit pas :
--   - QUI peut : un anonyme n'a le droit d'appeler aucune des fonctions, un compte rattaché à rien et un client se
--     font refuser — le client sur le dossier d'un autre comme sur le SIEN —, et le chef du cabinet enregistre,
--     rapproche et retire (les contrôles POSITIFS, sans lesquels les refus seraient satisfaits par une fonction qui
--     refuse tout le monde) ;
--   - CE QUI s'écrit : la liquidation d'une période à payer (445710, 445660, 445510, 758000) et celle d'une période
--     en crédit dont une part est remboursée (445710, 445660, 445670, 445830, 758000), au dernier jour de la période ;
--     une réécriture qui remplace sans doubler ; le paiement au 445510 et le remboursement au 445830, face à la
--     banque, à la date du mouvement ; et le retrait d'une déclaration, qui remet ses mouvements à traiter ;
--   - CE QUI est refusé, avec sa RAISON : un dossier non assujetti, une période mal formée, à cheval sur deux années,
--     pas terminée ou qui en chevauche une autre ; une CA3 illisible, qui ne se tient pas, un remboursement au-delà du
--     crédit, une écriture qui ne correspond pas, un arrondi qui n'en est pas un ; une déclaration saisie à la main
--     après l'ouverture, ou calculée avant elle ; un paiement qui précède la fin de la période, d'une déclaration sans
--     TVA à payer, un remboursement qui n'a pas été demandé, un mouvement déjà classé ou de zéro euro, la
--     déclaration d'un autre dossier ;
--   - CE QUE les contraintes et les déclencheurs tiennent SEULS : un lien posé sur un mouvement à traiter ou à côté
--     d'un autre classement, une liquidation qui porte une autre source, deux déclarations qui se chevauchent, une
--     période mal formée, une CA3 sans ses montants, un remboursement négatif ; une déclaration d'un exercice validé
--     qui ne s'enregistre, ne se retire ni ne change plus ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer sans une instruction de suppression : les deux clés sont
--     sans action à la suppression, et les droits d'exécution ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Tout se joue dans un dossier JETABLE, ASSUJETTI, créé dans le cabinet du dossier `test` (qui ne l'est pas), avec
-- ses mouvements, au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`). Chaque contrôle
-- s'y joue dans sa sous-transaction : un refus l'annule de lui-même, une acceptation l'est par `ANNULATION_ESSAI`
-- (P0001), sauf les étapes « fait » dont la suite a besoin, gardées jusqu'à l'annulation finale. Le verdict est posé
-- dans une VARIABLE avant toute annulation — le mécanisme de rls.sql —, et un refus se juge à son code ET à son
-- message. Le fichier ne contient aucune instruction de suppression.
create temp table essai_tva (controle text, observe text, ok boolean) on commit drop;

do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  dossier_client uuid;
  cabinet uuid;
  d uuid := 'e8a10000-0000-4000-8000-000000000001';
  m_paie uuid := 'e8a10000-0000-4000-8000-0000000000a1';
  m_remb uuid := 'e8a10000-0000-4000-8000-0000000000a2';
  m_avant uuid := 'e8a10000-0000-4000-8000-0000000000a3';
  m_bilan uuid := 'e8a10000-0000-4000-8000-0000000000a4';
  m_zero uuid := 'e8a10000-0000-4000-8000-0000000000a5';
  m_autre uuid := 'e8a10000-0000-4000-8000-0000000000a6';
  m_test uuid := 'e8a10000-0000-4000-8000-0000000000a7';
  m_perso uuid := 'e8a10000-0000-4000-8000-0000000000a8';
  m_groupe uuid := 'e8a10000-0000-4000-8000-0000000000a9';
  aujourdhui date := (now() at time zone 'Europe/Paris')::date;
  q1 text;
  q2 text;
  q4_2025 text;
  -- Le 1er trimestre 2026, à payer : 100,40 € collectés et 20,60 € déductibles au centime, soit 100 € et 21 € à
  -- l'euro — 79 € à payer, et 0,80 € d'arrondi au 758000.
  cases_q1 jsonb := jsonb_build_object('l16', 100, 'l19', 0, 'l20', 21, 'l21', 0, 'l22', 0, 'l23', 21, 'l25', 0,
    'l26', 0, 'l27', 0, 'l28', 79, 'l32', 79);
  ecriture_q1 jsonb := jsonb_build_array(
    jsonb_build_object('compte', '445710', 'sens', 'debit', 'montant', 100.40, 'libelle', 'essai'),
    jsonb_build_object('compte', '445660', 'sens', 'credit', 'montant', 20.60, 'libelle', 'essai'),
    jsonb_build_object('compte', '445510', 'sens', 'credit', 'montant', 79, 'libelle', 'essai'),
    jsonb_build_object('compte', '758000', 'sens', 'credit', 'montant', 0.80, 'libelle', 'essai'));
  -- Le 2e trimestre, en crédit : 50,20 € collectés, 399,70 € déductibles ; crédit de 350 €, dont 300 € dont le
  -- remboursement est demandé et 50 € reportés ; 0,50 € d'arrondi au 758000.
  cases_q2 jsonb := jsonb_build_object('l16', 50, 'l19', 0, 'l20', 400, 'l21', 0, 'l22', 0, 'l23', 400, 'l25', 350,
    'l26', 300, 'l27', 50, 'l28', 0, 'l32', 0);
  ecriture_q2 jsonb := jsonb_build_array(
    jsonb_build_object('compte', '445710', 'sens', 'debit', 'montant', 50.20, 'libelle', 'essai'),
    jsonb_build_object('compte', '445660', 'sens', 'credit', 'montant', 399.70, 'libelle', 'essai'),
    jsonb_build_object('compte', '445670', 'sens', 'debit', 'montant', 50, 'libelle', 'essai'),
    jsonb_build_object('compte', '445830', 'sens', 'debit', 'montant', 300, 'libelle', 'essai'),
    jsonb_build_object('compte', '758000', 'sens', 'credit', 'montant', 0.50, 'libelle', 'essai'));
  paiement jsonb := jsonb_build_array(
    jsonb_build_object('compte', '445510', 'sens', 'debit', 'montant', 79, 'libelle', 'essai'),
    jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', 79, 'libelle', 'essai'));
  remboursement jsonb := jsonb_build_array(
    jsonb_build_object('compte', '512000', 'sens', 'debit', 'montant', 300, 'libelle', 'essai'),
    jsonb_build_object('compte', '445830', 'sens', 'credit', 'montant', 300, 'libelle', 'essai'));
  appel_q1 text;
  etapes jsonb;
  e jsonb;
  accepte boolean; code_recu text; message text; verifie boolean;
  verdicts jsonb := '[]'::jsonb;
  avant text; apres text;
begin
  select m.dossier_id into dossier_client from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if dossier_client is null or cabinet is null or dossier_client = dossier_test then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;
  if (select assujetti_tva from dossiers where id = dossier_test) then
    raise exception 'ESSAI_IMPOSSIBLE : le dossier test est devenu assujetti, le refus d''un dossier non assujetti ne se jouerait plus';
  end if;
  if exists (select 1 from dossiers where id = d) then
    raise exception 'ESSAI_IMPOSSIBLE : le dossier jetable existe déjà';
  end if;
  avant := concat_ws('/', (select count(*) from declarations_tva), (select count(*) from ecritures_brouillon),
    (select count(*) from lignes_bancaires), (select count(*) from dossiers), (select count(*) from exercices_valides),
    (select count(*) from a_nouveaux));

  q1 := format('(select id from declarations_tva where dossier_id = %L and periode_debut = %L)', d, '2026-01-01');
  q2 := format('(select id from declarations_tva where dossier_id = %L and periode_debut = %L)', d, '2026-04-01');
  q4_2025 := format('(select id from declarations_tva where dossier_id = %L and periode_debut = %L)', d, '2025-10-01');
  appel_q1 := format($f$select enregistrer_declaration_tva(%L, '2026-01-01', '2026-03-31', 79, 0, 0, '2026-04-15', %L, 100.40, 20.60, 0, %L)$f$,
    d, cases_q1, ecriture_q1);

  begin
    insert into dossiers (id, nom, cabinet_id, assujetti_tva, code_email)
    values (d, 'essai liquidation de la TVA', cabinet, true, 'essaitva' || substr(md5(gen_random_uuid()::text), 1, 10));
    insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, compte_bilan) values
      (m_paie, d, '2026-04-20', 'PRLV DGFIP TVA T1', -79, 'non_rapprochee', null),
      (m_remb, d, '2026-08-10', 'VIR DGFIP REMBOURSEMENT TVA', 300, 'non_rapprochee', null),
      (m_avant, d, '2026-03-15', 'PRLV DGFIP', -40, 'non_rapprochee', null),
      (m_bilan, d, '2026-05-02', 'VIR LIVRET', -500, 'rapprochee', '580000'),
      (m_zero, d, '2026-05-03', 'FRAIS', 0, 'non_rapprochee', null),
      (m_autre, d, '2026-07-20', 'PRLV DGFIP TVA', -79, 'non_rapprochee', null),
      (m_test, dossier_test, '2026-04-21', 'PRLV DGFIP', -79, 'non_rapprochee', null);
    insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, prelevement_personnel, reglement_groupe) values
      (m_perso, d, '2026-05-05', 'VIR PERSONNEL', -79, 'ignoree', true, false),
      (m_groupe, d, '2026-05-06', 'VIR FOURNISSEURS', -79, 'rapprochee', false, true);

    etapes := jsonb_build_array(
      -- ══ 1 à 6. Anonyme : aucun droit d'exécution ══════════════════════════════════════════════════════
      jsonb_build_object('n', '1. anonyme, enregistrer', 'qui', 'anon', 'sql', appel_q1, 'attendu', '42501|permission denied%'),
      jsonb_build_object('n', '2. anonyme, réécrire une liquidation', 'qui', 'anon',
        'sql', format('select ecrire_liquidation_tva(%L, %L)', gen_random_uuid(), ecriture_q1), 'attendu', '42501|permission denied%'),
      jsonb_build_object('n', '3. anonyme, retirer une déclaration', 'qui', 'anon',
        'sql', format('select retirer_declaration_tva(%L)', gen_random_uuid()), 'attendu', '42501|permission denied%'),
      jsonb_build_object('n', '4. anonyme, rapprocher un paiement', 'qui', 'anon',
        'sql', format('select rapprocher_declaration_tva(%L, %L, %L)', m_paie, gen_random_uuid(), paiement), 'attendu', '42501|permission denied%'),
      jsonb_build_object('n', '5. anonyme, retirer un rapprochement', 'qui', 'anon',
        'sql', format('select retirer_rapprochement_declaration_tva(%L)', m_paie), 'attendu', '42501|permission denied%'),
      jsonb_build_object('n', '6. anonyme, lire la liquidation attendue', 'qui', 'anon',
        'sql', format('select * from liquidation_attendue(%L)', gen_random_uuid()), 'attendu', '42501|permission denied%'),
      -- ══ 7 à 9. Qui peut enregistrer ═══════════════════════════════════════════════════════════════════
      jsonb_build_object('n', '7. rattaché à rien, enregistrer', 'qui', 'inconnu', 'sql', appel_q1, 'attendu', '42501|Accès refusé à ce dossier.'),
      jsonb_build_object('n', '8. client, enregistrer sur le dossier d''un autre', 'qui', 'client', 'sql', appel_q1, 'attendu', '42501|Accès refusé à ce dossier.'),
      jsonb_build_object('n', '9. client, enregistrer sur le sien', 'qui', 'client',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-01-01', '2026-03-31', 79, 0, 0, null, %L, 100.40, 20.60, 0, %L)$f$, dossier_client, cases_q1, ecriture_q1),
        'attendu', '42501|Accès refusé à ce dossier.'),
      -- ══ 10. Le chef enregistre le 1er trimestre, et sa liquidation s'écrit ════════════════════════════
      jsonb_build_object('n', '10. le chef enregistre une période à payer', 'qui', 'chef', 'sql', appel_q1, 'attendu', 'fait',
        'verif', format($f$select
            (select count(*) from ecritures_brouillon e where e.declaration_tva_id = %1$s) = 4
            and not exists (select compte, sens, montant from (values ('445710', 'debit', 100.40), ('445660', 'credit', 20.60),
                  ('445510', 'credit', 79.00), ('758000', 'credit', 0.80)) as v(compte, sens, montant)
                except all select compte, sens, montant from ecritures_brouillon where declaration_tva_id = %1$s)
            and not exists (select 1 from ecritures_brouillon where declaration_tva_id = %1$s
                and (date <> '2026-03-31' or statut <> 'proposee' or piece_id is not null or ligne_bancaire_id is not null))
            and (select tva_declaree = 79 and credit_anterieur = 0 and remboursement_demande = 0 and tva_collectee = 100.40
                 and tva_deductible = 20.60 and tva_deductible_immobilisations = 0 and (cases->>'l28')::numeric = 79
                 and date_declaration = '2026-04-15' from declarations_tva where id = %1$s)$f$, q1)),
      -- ══ 11 à 22. Ce que l'enregistrement refuse, avec sa raison ═══════════════════════════════════════
      jsonb_build_object('n', '11. la même période une seconde fois', 'qui', 'chef', 'sql', appel_q1,
        'attendu', '23505|Une déclaration de TVA est déjà enregistrée pour une période qui chevauche celle-ci%'),
      jsonb_build_object('n', '12. un mois du trimestre déjà déclaré', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-03-01', '2026-03-31', 0, 0, 0, null, %L, 0, 0, 0, '[]')$f$, d,
          jsonb_build_object('l16', 0, 'l19', 0, 'l20', 0, 'l21', 0, 'l22', 0, 'l23', 0, 'l25', 0, 'l26', 0, 'l27', 0, 'l28', 0, 'l32', 0)),
        'attendu', '23505|Une déclaration de TVA est déjà enregistrée pour une période qui chevauche celle-ci%'),
      jsonb_build_object('n', '13. un dossier qui n''est pas assujetti', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-01-01', '2026-03-31', 79, 0, 0, null, %L, 100.40, 20.60, 0, %L)$f$, dossier_test, cases_q1, ecriture_q1),
        'attendu', '22023|Ce dossier n''est pas assujetti à la TVA%'),
      jsonb_build_object('n', '14. une période qui ne commence pas le premier du mois', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-07-15', '2026-09-30', 79, 0, 0, null, %L, 100.40, 20.60, 0, %L)$f$, d, cases_q1, ecriture_q1),
        'attendu', '22023|Une période de TVA va du premier jour d''un mois au dernier jour d''un mois%'),
      jsonb_build_object('n', '15. une période à cheval sur deux années', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2025-12-01', '2026-01-31', 79, 0, 0, null, %L, 100.40, 20.60, 0, %L)$f$, d, cases_q1, ecriture_q1),
        'attendu', '22023|Une période de TVA va du premier jour d''un mois au dernier jour d''un mois%'),
      jsonb_build_object('n', '16. une période qui n''est pas terminée', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, %L, %L, 79, 0, 0, null, %L, 100.40, 20.60, 0, %L)$f$, d,
          date_trunc('month', aujourdhui)::date, (date_trunc('month', aujourdhui) + interval '1 month - 1 day')::date, cases_q1, ecriture_q1),
        'attendu', '22023|La période n''est pas terminée%'),
      jsonb_build_object('n', '17. une CA3 qui ne se tient pas', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-04-01', '2026-06-30', -350, 0, 300, null, %L, 50.20, 399.70, 0, %L)$f$, d,
          cases_q2 || jsonb_build_object('l28', 10, 'l32', 10), ecriture_q2),
        'attendu', '22023|La déclaration proposée ne se tient pas%'),
      jsonb_build_object('n', '17b. un crédit reçu qui n''est pas celui de la ligne 22', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-04-01', '2026-06-30', -350, 10, 300, null, %L, 50.20, 399.70, 0, %L)$f$, d,
          cases_q2, ecriture_q2),
        'attendu', '22023|La déclaration proposée ne se tient pas%'),
      jsonb_build_object('n', '17c. une TVA nette qui n''est pas celle des lignes', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-04-01', '2026-06-30', -349, 0, 300, null, %L, 50.20, 399.70, 0, %L)$f$, d,
          cases_q2, ecriture_q2),
        'attendu', '22023|La déclaration proposée ne se tient pas%'),
      jsonb_build_object('n', '18. une CA3 illisible', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-04-01', '2026-06-30', -350, 0, 300, null, %L, 50.20, 399.70, 0, %L)$f$, d,
          cases_q2 || jsonb_build_object('l16', 50.5), ecriture_q2),
        'attendu', '22023|La déclaration proposée est illisible%'),
      jsonb_build_object('n', '19. un remboursement au-delà du crédit', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-04-01', '2026-06-30', -350, 0, 400, null, %L, 50.20, 399.70, 0, %L)$f$, d,
          cases_q2 || jsonb_build_object('l26', 400, 'l27', -50), ecriture_q2),
        'attendu', '22023|Le remboursement demandé (ligne 26) dépasse le crédit de TVA de la période%'),
      jsonb_build_object('n', '20. une liquidation sans son arrondi', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-04-01', '2026-06-30', -350, 0, 300, null, %L, 50.20, 399.70, 0, %L)$f$, d,
          cases_q2, ecriture_q2 - 4),
        'attendu', '22023|L''écriture proposée ne correspond pas à cette déclaration.'),
      jsonb_build_object('n', '21. un écart qui n''est pas un arrondi', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-04-01', '2026-06-30', -350, 0, 300, null, %L, 70.20, 399.70, 0, %L)$f$, d,
          cases_q2, jsonb_set(jsonb_set(ecriture_q2, '{0,montant}', '70.20'), '{4,montant}', '20.50')),
        'attendu', '22023|La liquidation ne s''équilibre pas%n''est pas un arrondi.'),
      jsonb_build_object('n', '22. une déclaration saisie à la main, sans ouverture', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2025-10-01', '2025-12-31', 120, 0, 0, null, null, null, null, null, '[]')$f$, d),
        'attendu', '22023|Une déclaration s''enregistre telle que l''application l''a préparée%'),
      -- ══ 23 à 27. Avant l'ouverture d'un dossier repris, la déclaration se saisit à la main ═════════════
      jsonb_build_object('n', '23. le dossier est repris au 1er janvier 2026', 'qui', 'postgres',
        'sql', format($f$insert into a_nouveaux (dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values
            (%1$L, '2026-01-01', '512000', 'debit', 120, 'balance.csv', %2$L), (%1$L, '2026-01-01', '445510', 'credit', 120, 'balance.csv', %2$L)$f$,
          d, repeat('ab', 32)),
        'attendu', 'fait'),
      jsonb_build_object('n', '24. une déclaration d''avant l''ouverture, saisie à la main', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2025-10-01', '2025-12-31', 120, 0, 0, '2026-01-20', null, null, null, null, '[]')$f$, d),
        'attendu', 'fait',
        'verif', format($f$select (select cases is null and tva_collectee is null and tva_declaree = 120 from declarations_tva where id = %1$s)
            and not exists (select 1 from ecritures_brouillon where declaration_tva_id = %1$s)$f$, q4_2025)),
      jsonb_build_object('n', '25. une déclaration calculée avant l''ouverture', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2025-07-01', '2025-09-30', 79, 0, 0, null, %L, 100.40, 20.60, 0, %L)$f$, d, cases_q1, ecriture_q1),
        'attendu', '22023|Cette période précède l''ouverture du dossier%'),
      jsonb_build_object('n', '26. une déclaration saisie à la main après l''ouverture', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-04-01', '2026-06-30', -350, 0, 0, null, null, null, null, null, '[]')$f$, d),
        'attendu', '22023|Une déclaration s''enregistre telle que l''application l''a préparée%'),
      jsonb_build_object('n', '27. une déclaration saisie à la main qui écrirait une liquidation', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2025-07-01', '2025-09-30', 79, 0, 0, null, null, null, null, null, %L)$f$, d, ecriture_q1),
        'attendu', '22023|Une déclaration saisie à la main n''écrit pas de liquidation%'),
      -- ══ 28. Une période en crédit, dont une part est remboursée ══════════════════════════════════════
      jsonb_build_object('n', '28. le chef enregistre une période en crédit avec un remboursement', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-04-01', '2026-06-30', -350, 0, 300, null, %L, 50.20, 399.70, 0, %L)$f$, d, cases_q2, ecriture_q2),
        'attendu', 'fait',
        'verif', format($f$select (select count(*) from ecritures_brouillon where declaration_tva_id = %1$s) = 5
            and not exists (select compte, sens, montant from (values ('445710', 'debit', 50.20), ('445660', 'credit', 399.70),
                  ('445670', 'debit', 50.00), ('445830', 'debit', 300.00), ('758000', 'credit', 0.50)) as v(compte, sens, montant)
                except all select compte, sens, montant from ecritures_brouillon where declaration_tva_id = %1$s)
            and not exists (select 1 from ecritures_brouillon where declaration_tva_id = %1$s and date <> '2026-06-30')$f$, q2)),
      -- Le 3e trimestre reçoit le crédit reporté du 2e (50 €) : 100,40 € collectés, 20,60 € déductibles, 29 € à payer,
      -- et le crédit reçu sort du 445670.
      jsonb_build_object('n', '28b. une période qui reçoit un crédit le retire du 445670', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-07-01', '2026-09-30', 79, 50, 0, null, %L, 100.40, 20.60, 0, %L)$f$, d,
          jsonb_build_object('l16', 100, 'l19', 0, 'l20', 21, 'l21', 0, 'l22', 50, 'l23', 71, 'l25', 0, 'l26', 0, 'l27', 0, 'l28', 29, 'l32', 29),
          jsonb_build_array(
            jsonb_build_object('compte', '445710', 'sens', 'debit', 'montant', 100.40, 'libelle', 'essai'),
            jsonb_build_object('compte', '445660', 'sens', 'credit', 'montant', 20.60, 'libelle', 'essai'),
            jsonb_build_object('compte', '445670', 'sens', 'credit', 'montant', 50, 'libelle', 'essai'),
            jsonb_build_object('compte', '445510', 'sens', 'credit', 'montant', 29, 'libelle', 'essai'),
            jsonb_build_object('compte', '758000', 'sens', 'credit', 'montant', 0.80, 'libelle', 'essai'))),
        'attendu', 'accepte',
        'verif', format($f$select (select count(*) from ecritures_brouillon e join declarations_tva t on t.id = e.declaration_tva_id
             where t.dossier_id = %L and t.periode_debut = '2026-07-01' and e.date = '2026-09-30') = 5$f$, d)),
      -- ══ 29 à 32. Réécrire une liquidation ═════════════════════════════════════════════════════════════
      jsonb_build_object('n', '29. réécrire la liquidation d''une déclaration saisie à la main', 'qui', 'chef',
        'sql', format('select ecrire_liquidation_tva(%s, %L)', q4_2025, ecriture_q1),
        'attendu', '22023|Cette déclaration a été saisie à la main%'),
      jsonb_build_object('n', '30. réécrire une liquidation la remplace sans la doubler', 'qui', 'chef',
        'sql', format('select ecrire_liquidation_tva(%s, %L)', q1, ecriture_q1), 'attendu', 'accepte',
        'verif', format('select (select count(*) from ecritures_brouillon where declaration_tva_id = %s) = 4', q1)),
      jsonb_build_object('n', '31. réécrire une liquidation fausse', 'qui', 'chef',
        'sql', format('select ecrire_liquidation_tva(%s, %L)', q1, jsonb_set(ecriture_q1, '{2,montant}', '80')),
        'attendu', '22023|L''écriture proposée ne correspond pas à cette déclaration.'),
      jsonb_build_object('n', '32. client, réécrire une liquidation', 'qui', 'client',
        'sql', format('select ecrire_liquidation_tva(%s, %L)', q1, ecriture_q1), 'attendu', '42501|Accès refusé à cette déclaration.'),
      -- ══ 33 à 45. Le paiement et le remboursement ═════════════════════════════════════════════════════
      jsonb_build_object('n', '33. rattaché à rien, rapprocher', 'qui', 'inconnu',
        'sql', format('select rapprocher_declaration_tva(%L, %s, %L)', m_paie, q1, paiement), 'attendu', '42501|Accès refusé à ce mouvement.'),
      jsonb_build_object('n', '34. client, rapprocher', 'qui', 'client',
        'sql', format('select rapprocher_declaration_tva(%L, %s, %L)', m_paie, q1, paiement), 'attendu', '42501|Accès refusé à ce mouvement.'),
      jsonb_build_object('n', '35. le chef rapproche le paiement de sa déclaration', 'qui', 'chef',
        'sql', format('select rapprocher_declaration_tva(%L, %s, %L)', m_paie, q1, paiement), 'attendu', 'fait',
        'verif', format($f$select (select statut = 'rapprochee' and declaration_tva_id = %2$s from lignes_bancaires where id = %1$L)
            and (select count(*) from ecritures_brouillon where ligne_bancaire_id = %1$L) = 2
            and not exists (select compte, sens, montant from (values ('445510', 'debit', 79.00), ('512000', 'credit', 79.00)) as v(compte, sens, montant)
                except all select compte, sens, montant from ecritures_brouillon where ligne_bancaire_id = %1$L)
            and not exists (select 1 from ecritures_brouillon where ligne_bancaire_id = %1$L and (date <> '2026-04-20' or declaration_tva_id is not null))$f$,
          m_paie, q1)),
      jsonb_build_object('n', '36. le chef rapproche le remboursement de sa déclaration', 'qui', 'chef',
        'sql', format('select rapprocher_declaration_tva(%L, %s, %L)', m_remb, q2, remboursement), 'attendu', 'fait',
        'verif', format($f$select (select statut = 'rapprochee' and declaration_tva_id = %2$s from lignes_bancaires where id = %1$L)
            and not exists (select compte, sens, montant from (values ('512000', 'debit', 300.00), ('445830', 'credit', 300.00)) as v(compte, sens, montant)
                except all select compte, sens, montant from ecritures_brouillon where ligne_bancaire_id = %1$L)
            and (select count(*) from ecritures_brouillon where ligne_bancaire_id = %1$L) = 2$f$, m_remb, q2)),
      jsonb_build_object('n', '36b. rapprocher de nouveau un paiement remplace son écriture sans la doubler', 'qui', 'chef',
        'sql', format('select rapprocher_declaration_tva(%L, %s, %L)', m_paie, q1, paiement), 'attendu', 'accepte',
        'verif', format($f$select (select count(*) from ecritures_brouillon where ligne_bancaire_id = %L) = 2$f$, m_paie)),
      jsonb_build_object('n', '37. un paiement qui précède la fin de la période', 'qui', 'chef',
        'sql', format('select rapprocher_declaration_tva(%L, %s, %L)', m_avant, q1,
          jsonb_set(jsonb_set(paiement, '{0,montant}', '40'), '{1,montant}', '40')),
        'attendu', '22023|Un paiement de TVA suit la période qu''il règle%'),
      jsonb_build_object('n', '38. un paiement d''une déclaration sans TVA à payer', 'qui', 'chef',
        'sql', format('select rapprocher_declaration_tva(%L, %s, %L)', m_autre, q2, paiement),
        'attendu', '22023|Cette déclaration n''a pas de TVA à payer.'),
      jsonb_build_object('n', '39. un remboursement qui n''a pas été demandé', 'qui', 'chef',
        'sql', format('select rapprocher_declaration_tva(%L, %s, %L)', m_remb, q1, remboursement),
        'attendu', '22023|Aucun remboursement de crédit n''a été demandé sur cette déclaration%'),
      jsonb_build_object('n', '40. un mouvement écrit sur un compte de bilan', 'qui', 'chef',
        'sql', format('select rapprocher_declaration_tva(%L, %s, %L)', m_bilan, q1, paiement),
        'attendu', '22023|Ce mouvement est écrit sur le compte 580000%'),
      jsonb_build_object('n', '40b. un mouvement classé en virement personnel', 'qui', 'chef',
        'sql', format('select rapprocher_declaration_tva(%L, %s, %L)', m_perso, q1, paiement),
        'attendu', '22023|Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt%annule d''abord ce classement.'),
      jsonb_build_object('n', '40c. un mouvement qui règle plusieurs pièces', 'qui', 'chef',
        'sql', format('select rapprocher_declaration_tva(%L, %s, %L)', m_groupe, q1, paiement),
        'attendu', '22023|Ce mouvement règle plusieurs pièces : annule d''abord ce règlement groupé.'),
      jsonb_build_object('n', '41. un mouvement de zéro euro', 'qui', 'chef',
        'sql', format('select rapprocher_declaration_tva(%L, %s, %L)', m_zero, q1, paiement),
        'attendu', '22023|Un mouvement de zéro euro n''a rien à écrire.'),
      jsonb_build_object('n', '42. la déclaration d''un autre dossier', 'qui', 'chef',
        'sql', format('select rapprocher_declaration_tva(%L, %s, %L)', m_test, q1, paiement),
        'attendu', '22023|Cette déclaration de TVA n''est pas celle de ce dossier.'),
      jsonb_build_object('n', '43. une écriture de paiement fausse', 'qui', 'chef',
        'sql', format('select rapprocher_declaration_tva(%L, %s, %L)', m_autre, q1, jsonb_set(paiement, '{0,compte}', '"445660"')),
        'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à cette déclaration.'),
      jsonb_build_object('n', '44. le chef retire un rapprochement', 'qui', 'chef',
        'sql', format('select retirer_rapprochement_declaration_tva(%L)', m_remb), 'attendu', 'accepte',
        'verif', format($f$select (select statut = 'non_rapprochee' and declaration_tva_id is null from lignes_bancaires where id = %1$L)
            and not exists (select 1 from ecritures_brouillon where ligne_bancaire_id = %1$L)$f$, m_remb)),
      jsonb_build_object('n', '45. retirer le rapprochement d''un mouvement qui ne paie rien', 'qui', 'chef',
        'sql', format('select retirer_rapprochement_declaration_tva(%L)', m_avant),
        'attendu', '22023|Ce mouvement ne paie aucune déclaration de TVA.'),
      -- ══ 46 à 52. Ce que les contraintes et les déclencheurs tiennent seuls ═══════════════════════════
      jsonb_build_object('n', '46. un lien posé sur un mouvement à traiter', 'qui', 'postgres',
        'sql', format('update lignes_bancaires set declaration_tva_id = %s where id = %L', q1, m_avant),
        'attendu', '23514|%lignes_bancaires_declaration_tva_rapprochee%'),
      jsonb_build_object('n', '47. un lien posé à côté d''un autre classement', 'qui', 'postgres',
        'sql', format('update lignes_bancaires set declaration_tva_id = %s where id = %L', q1, m_bilan),
        'attendu', '23514|%lignes_bancaires_un_seul_rapprochement%'),
      jsonb_build_object('n', '48. une liquidation qui porte un mouvement', 'qui', 'postgres',
        'sql', format($f$insert into ecritures_brouillon (dossier_id, ligne_bancaire_id, declaration_tva_id, date, compte, libelle, montant, sens, statut)
            values (%L, %L, %s, '2026-03-31', '445510', 'essai', 1, 'credit', 'proposee')$f$, d, m_avant, q1),
        'attendu', '23514|%ecritures_brouillon_liquidation_sans_autre_source%'),
      jsonb_build_object('n', '49. deux déclarations qui se chevauchent, posées à la main', 'qui', 'postgres',
        'sql', format($f$insert into declarations_tva (dossier_id, periode_debut, periode_fin, tva_declaree) values (%L, '2026-02-01', '2026-02-28', 0)$f$, d),
        'attendu', '23505|Une déclaration de TVA est déjà enregistrée pour une période qui chevauche celle-ci%'),
      jsonb_build_object('n', '50. une période mal formée, posée à la main', 'qui', 'postgres',
        'sql', format($f$insert into declarations_tva (dossier_id, periode_debut, periode_fin, tva_declaree) values (%L, '2026-07-15', '2026-09-30', 0)$f$, d),
        'attendu', '23514|%declarations_tva_periode%'),
      jsonb_build_object('n', '51. une CA3 sans ses montants', 'qui', 'postgres',
        'sql', format($f$insert into declarations_tva (dossier_id, periode_debut, periode_fin, tva_declaree, cases) values (%L, '2026-07-01', '2026-09-30', 0, '{}')$f$, d),
        'attendu', '23514|%declarations_tva_liquidation_complete%'),
      jsonb_build_object('n', '52. un remboursement négatif', 'qui', 'postgres',
        'sql', format($f$insert into declarations_tva (dossier_id, periode_debut, periode_fin, tva_declaree, remboursement_demande) values (%L, '2026-07-01', '2026-09-30', 0, -1)$f$, d),
        'attendu', '23514|%declarations_tva_remboursement_check%'),
      -- ══ 53 à 59. Retirer une déclaration, et ce qu'une écriture validée interdit ═════════════════════
      jsonb_build_object('n', '53. client, retirer une déclaration', 'qui', 'client',
        'sql', format('select retirer_declaration_tva(%s)', q1), 'attendu', '42501|Accès refusé à cette déclaration.'),
      -- Une écriture se valide comme `valider_exercice` la valide : sous le réglage de son dossier, avec les champs que
      -- son FEC lit (contrainte `ecritures_brouillon_validation_complete`) ; puis le chef appelle la fonction.
      jsonb_build_object('n', '54. une liquidation validée ne se réécrit plus', 'qui', 'postgres',
        'sql', format($f$do $d$ begin
            perform set_config('jd.validation_exercice', %1$L, true);
            update ecritures_brouillon set statut = 'validee', valide_le = now(), journal_code = 'OD', numero_ecriture = 1,
                   piece_ref = 'essai', piece_date = date, compte_lib = 'essai'
             where declaration_tva_id = %2$s;
            perform set_config('jd.validation_exercice', '', true);
            set local role authenticated;
            perform set_config('request.jwt.claims', %3$L, true);
            perform ecrire_liquidation_tva(%2$s, %4$L);
          end $d$$f$, d, q1, json_build_object('sub', chef, 'role', 'authenticated')::text, ecriture_q1),
        'attendu', '23514|La liquidation de cette déclaration est validée : elle ne se réécrit plus.'),
      jsonb_build_object('n', '55. l''écriture validée d''un paiement ne se remplace plus', 'qui', 'postgres',
        'sql', format($f$do $d$ begin
            perform set_config('jd.validation_exercice', %1$L, true);
            update ecritures_brouillon set statut = 'validee', valide_le = now(), journal_code = 'BQ', numero_ecriture = 1,
                   piece_ref = 'essai', piece_date = date, compte_lib = 'essai'
             where ligne_bancaire_id = %2$L;
            perform set_config('jd.validation_exercice', '', true);
            set local role authenticated;
            perform set_config('request.jwt.claims', %3$L, true);
            perform rapprocher_declaration_tva(%2$L, %4$s, %5$L);
          end $d$$f$, d, m_paie, json_build_object('sub', chef, 'role', 'authenticated')::text, q1, paiement),
        'attendu', '23514|L''écriture de ce mouvement est validée : elle ne se remplace plus.'),
      jsonb_build_object('n', '56. l''écriture validée d''un paiement ne se retire plus', 'qui', 'postgres',
        'sql', format($f$do $d$ begin
            perform set_config('jd.validation_exercice', %1$L, true);
            update ecritures_brouillon set statut = 'validee', valide_le = now(), journal_code = 'BQ', numero_ecriture = 1,
                   piece_ref = 'essai', piece_date = date, compte_lib = 'essai'
             where ligne_bancaire_id = %2$L;
            perform set_config('jd.validation_exercice', '', true);
            set local role authenticated;
            perform set_config('request.jwt.claims', %3$L, true);
            perform retirer_rapprochement_declaration_tva(%2$L);
          end $d$$f$, d, m_paie, json_build_object('sub', chef, 'role', 'authenticated')::text),
        'attendu', '23514|L''écriture de ce mouvement est validée : elle ne se retire plus.'),
      jsonb_build_object('n', '57. une déclaration dont la liquidation est validée ne se retire plus', 'qui', 'postgres',
        'sql', format($f$do $d$ begin
            perform set_config('jd.validation_exercice', %1$L, true);
            update ecritures_brouillon set statut = 'validee', valide_le = now(), journal_code = 'OD', numero_ecriture = 1,
                   piece_ref = 'essai', piece_date = date, compte_lib = 'essai'
             where declaration_tva_id = %2$s;
            perform set_config('jd.validation_exercice', '', true);
            set local role authenticated;
            perform set_config('request.jwt.claims', %3$L, true);
            perform retirer_declaration_tva(%2$s);
          end $d$$f$, d, q1, json_build_object('sub', chef, 'role', 'authenticated')::text),
        'attendu', '23514|Une écriture de cette déclaration — sa liquidation ou un paiement — est validée : elle ne se retire plus.'),
      jsonb_build_object('n', '58. une déclaration dont un paiement est validé ne se retire plus', 'qui', 'postgres',
        'sql', format($f$do $d$ begin
            perform set_config('jd.validation_exercice', %1$L, true);
            update ecritures_brouillon set statut = 'validee', valide_le = now(), journal_code = 'BQ', numero_ecriture = 1,
                   piece_ref = 'essai', piece_date = date, compte_lib = 'essai'
             where ligne_bancaire_id = %2$L;
            perform set_config('jd.validation_exercice', '', true);
            set local role authenticated;
            perform set_config('request.jwt.claims', %3$L, true);
            perform retirer_declaration_tva(%4$s);
          end $d$$f$, d, m_paie, json_build_object('sub', chef, 'role', 'authenticated')::text, q1),
        'attendu', '23514|Une écriture de cette déclaration — sa liquidation ou un paiement — est validée : elle ne se retire plus.'),
      -- Le remboursement du 2e trimestre reste rapproché (contrôle 36) : seules ses deux lignes et la liquidation du 2e
      -- trimestre restent au brouillon.
      jsonb_build_object('n', '59. le chef retire une déclaration payée : son paiement retourne à traiter', 'qui', 'chef',
        'sql', format('select retirer_declaration_tva(%s)', q1), 'attendu', 'accepte',
        'verif', format($f$select not exists (select 1 from declarations_tva where dossier_id = %1$L and periode_debut = '2026-01-01')
            and (select statut = 'non_rapprochee' and declaration_tva_id is null from lignes_bancaires where id = %2$L)
            and not exists (select 1 from ecritures_brouillon where ligne_bancaire_id = %2$L)
            and not exists (select 1 from ecritures_brouillon where dossier_id = %1$L and date = '2026-03-31')
            and (select count(*) from ecritures_brouillon where dossier_id = %1$L) = 7
            and not exists (select 1 from ecritures_brouillon where dossier_id = %1$L
                and declaration_tva_id is distinct from %3$s and ligne_bancaire_id is distinct from %4$L)$f$, d, m_paie, q2, m_remb)),
      -- ══ 60 à 65. Une déclaration d'un exercice validé est figée ══════════════════════════════════════
      -- L'exercice validé est posé à la main : sa frontière, le 31 décembre 2026, fige aussi le 4e trimestre 2025, que
      -- la reprise porte dans ses à-nouveaux.
      jsonb_build_object('n', '60. l''exercice 2026 est posé validé', 'qui', 'postgres',
        'sql', format($f$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures,
            total_debit, total_credit, empreinte, declaration) values (%L, 2026, now(), %L, 'tresorerie', 0, 0, 0, 0, %L, '{}')$f$,
          d, chef, repeat('0', 64)),
        'attendu', 'fait'),
      jsonb_build_object('n', '61. une déclaration ne s''enregistre plus dans un exercice validé', 'qui', 'chef',
        'sql', format($f$select enregistrer_declaration_tva(%L, '2026-07-01', '2026-09-30', 0, 0, 0, null, %L, 0, 0, 0, '[]')$f$, d,
          jsonb_build_object('l16', 0, 'l19', 0, 'l20', 0, 'l21', 0, 'l22', 0, 'l23', 0, 'l25', 0, 'l26', 0, 'l27', 0, 'l28', 0, 'l32', 0)),
        'attendu', '23514|L''exercice 2026 est validé : une déclaration de TVA ne s''y enregistre plus.'),
      jsonb_build_object('n', '61b. le dernier trimestre de l''exercice validé, à la frontière même', 'qui', 'postgres',
        'sql', format($f$insert into declarations_tva (dossier_id, periode_debut, periode_fin, tva_declaree) values (%L, '2026-10-01', '2026-12-31', 0)$f$, d),
        'attendu', '23514|L''exercice 2026 est validé : une déclaration de TVA ne s''y enregistre plus.'),
      jsonb_build_object('n', '62. une déclaration figée par la validation ne se retire plus', 'qui', 'chef',
        'sql', format('select retirer_declaration_tva(%s)', q4_2025),
        'attendu', '23514|L''exercice 2025 est figé par la validation de l''exercice 2026 : cette déclaration de TVA ne se retire plus.'),
      jsonb_build_object('n', '63. une déclaration remboursée d''un exercice validé ne se retire pas : son mouvement est figé', 'qui', 'chef',
        'sql', format('select retirer_declaration_tva(%s)', q2),
        'attendu', '23514|L''exercice 2026 est validé : ce mouvement ne change plus.'),
      jsonb_build_object('n', '64. une déclaration d''un exercice validé ne change plus', 'qui', 'postgres',
        'sql', format($f$update declarations_tva set notes = 'essai' where id = %s$f$, q2),
        'attendu', '23514|L''exercice 2026 est validé : cette déclaration de TVA ne change plus.'),
      jsonb_build_object('n', '65. après la frontière, une déclaration s''insère encore', 'qui', 'postgres',
        'sql', format($f$insert into declarations_tva (dossier_id, periode_debut, periode_fin, tva_declaree) values (%L, '2027-01-01', '2027-03-31', 0)$f$, d),
        'attendu', 'accepte')
    );

    for e in select value from jsonb_array_elements(etapes) loop
      accepte := false; code_recu := null; message := null; verifie := null;
      begin
        if e->>'qui' = 'anon' then
          set local role anon;
          perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        elsif e->>'qui' <> 'postgres' then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub',
            case e->>'qui' when 'chef' then chef when 'client' then client else inconnu end, 'role', 'authenticated')::text, true);
        end if;
        execute e->>'sql';
        accepte := true;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        if e->>'verif' is not null then
          execute e->>'verif' into verifie;
        end if;
        if e->>'attendu' <> 'fait' then
          raise exception 'ANNULATION_ESSAI';
        end if;
      exception when others then
        if sqlerrm <> 'ANNULATION_ESSAI' then
          code_recu := sqlstate; message := sqlerrm;
        end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object(
        'controle', e->>'n',
        'observe', case when accepte and code_recu is null
                     then 'accepté' || case when verifie is null then '' else ', vérifié ' || verifie::text end
                     else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
        'ok', case when e->>'attendu' in ('fait', 'accepte') then accepte and code_recu is null and coalesce(verifie, true)
                   else not accepte and code_recu = split_part(e->>'attendu', '|', 1)
                        and message like split_part(e->>'attendu', '|', 2) end);
    end loop;

    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- ══ 66 et 67. Ce que le catalogue dit ════════════════════════════════════════════════════════════════
  verdicts := verdicts || jsonb_build_object('controle', '66. les deux clés sont sans action à la suppression',
    'observe', (select string_agg(conname || ':' || confdeltype::text, ', ' order by conname) from pg_constraint
                 where conname in ('ecritures_brouillon_declaration_tva_id_fkey', 'lignes_bancaires_declaration_tva_id_fkey')),
    'ok', (select count(*) = 2 and bool_and(confdeltype = 'a') from pg_constraint
           where conname in ('ecritures_brouillon_declaration_tva_id_fkey', 'lignes_bancaires_declaration_tva_id_fkey')));
  verdicts := verdicts || jsonb_build_object('controle', '67. les droits d''exécution',
    'observe', (select string_agg(p.proname || ':' || has_function_privilege('authenticated', p.oid, 'execute')::text
                 || '/' || has_function_privilege('anon', p.oid, 'execute')::text, ', ' order by p.proname)
                from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('enregistrer_declaration_tva',
                  'ecrire_liquidation_tva', 'liquidation_attendue', 'retirer_declaration_tva', 'rapprocher_declaration_tva',
                  'retirer_rapprochement_declaration_tva', 'garder_declaration_valide', 'garder_declarations_sans_chevauchement')),
    'ok', (select count(*) = 8
             and bool_and(has_function_privilege('authenticated', p.oid, 'execute') = (p.proname not like 'garder%'))
             and not bool_or(has_function_privilege('anon', p.oid, 'execute'))
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('enregistrer_declaration_tva',
             'ecrire_liquidation_tva', 'liquidation_attendue', 'retirer_declaration_tva', 'rapprocher_declaration_tva',
             'retirer_rapprochement_declaration_tva', 'garder_declaration_valide', 'garder_declarations_sans_chevauchement')));

  -- ══ 68. Rien n'est resté ══════════════════════════════════════════════════════════════════════════════
  apres := concat_ws('/', (select count(*) from declarations_tva), (select count(*) from ecritures_brouillon),
    (select count(*) from lignes_bancaires), (select count(*) from dossiers), (select count(*) from exercices_valides),
    (select count(*) from a_nouveaux));
  verdicts := verdicts || jsonb_build_object('controle', '68. rien n''est resté en base',
    'observe', 'déclarations/écritures/mouvements/dossiers/exercices validés/à-nouveaux ' || avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where id = d));

  insert into essai_tva select x.controle, x.observe, x.ok
    from jsonb_to_recordset(verdicts) as x(controle text, observe text, ok boolean);
end $essai$;

select controle, ok, observe from essai_tva order by (regexp_match(controle, '^(\d+)'))[1]::int, controle;
