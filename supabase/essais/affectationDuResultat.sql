-- ESSAI DE L'AFFECTATION DU RÉSULTAT (lignes 33 et 45, AFF2 ; migration `affectation_du_resultat`, PRÉPARÉE) — SUR UNE
-- RÉPLIQUE SEULEMENT : il crée des dossiers, écrit des à-nouveaux, des écritures validées et des exercices validés, mute
-- des fonctions et un déclencheur, et ne laisse rien (ROLLBACK final). Se joue par psql, SANS -1 (le fichier porte sa
-- transaction) :
--   psql -v ON_ERROR_STOP=1 -f supabase/essais/affectationDuResultat.sql
-- Les profils : un membre du cabinet assigné aux dossiers, qui n'est PAS super-administrateur (le contrôle positif ; le chef
-- du semis l'est, et la porte de la restauration lui ouvrirait les écritures directes), le client d'un dossier du cabinet,
-- et le propriétaire (pour poser le jeu). Chaque refus est attendu avec sa RAISON (le code et les mots, ceux du module
-- src/lib/affectationDuResultat.ts, que src/lib/affectationDuResultatEnBase.test.ts confronte à ce fichier) ; chaque
-- mutation doit faire virer un cas au rouge. Le dernier tableau compte : « 0 en faute » et « toutes mordent ».
begin;

create temp table essai_affectation (cas text, attendu text, observe text, ok boolean);
create temp table essai_mutations (mutation text, observe text, mord boolean);

-- Un appel sous un profil, dans une sous-transaction : annulé, sauf `p_garder`. Rend « ACCEPTÉ [valeur] » ou
-- « SQLSTATE message ».
create function pg_temp.essayer(p_qui text, p_sql text, p_garder boolean default false) returns text
language plpgsql as $f$
declare
  r text;
begin
  begin
    if p_qui is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', p_qui, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
    end if;
    if p_sql ~* '^\s*select' and p_sql !~ ';' then
      execute p_sql into r;
    else
      execute p_sql;
    end if;
    r := 'ACCEPTÉ' || coalesce(' ' || nullif(r, ''), '');
    if not p_garder then
      raise exception 'ANNULATION_ESSAI';
    end if;
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then r := sqlstate || ' ' || sqlerrm; end if;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return r;
end
$f$;

-- Une mutation : son SQL joué par le propriétaire, puis l'appel sous un profil ; tout est annulé ensuite.
create function pg_temp.muter(p_mutation text, p_qui text, p_appel text) returns text
language plpgsql as $f$
declare
  r text;
begin
  if p_mutation is null then
    return 'FRAGMENT ABSENT';
  end if;
  begin
    execute p_mutation;
    r := pg_temp.essayer(p_qui, p_appel);
    raise exception 'ANNULATION_MUTATION';
  exception when others then
    if sqlerrm <> 'ANNULATION_MUTATION' then r := 'MUTATION ' || sqlstate || ' ' || sqlerrm; end if;
  end;
  return r;
end
$f$;

-- Le corps d'une fonction, un fragment remplacé ; nul si le fragment n'y est pas (la mutation ne mord alors pas).
create function pg_temp.remplacer(p_fonction text, p_fragment text, p_par text) returns text
language sql as $f$
  select case when strpos(pg_get_functiondef(p_fonction::regprocedure), p_fragment) > 0
              then replace(pg_get_functiondef(p_fonction::regprocedure), p_fragment, p_par) end
$f$;

do $essai$
declare
  membre text := '3e3b0000-0000-4000-8000-000000000001';
  client text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dossier_du_client text := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  d text := 'af200000-0000-4000-8000-000000000001';    -- SARL, capital 10 000, réserve légale 800, autres réserves 5 000
  d2 text := 'af200000-0000-4000-8000-000000000002';   -- SARL, pertes antérieures 5 000
  d3 text := 'af200000-0000-4000-8000-000000000003';   -- SARL, 5 000 de capital non appelé (109), réserve légale au dixième
  d_ei text := 'af200000-0000-4000-8000-000000000004'; -- en engagement, le dirigeant au 108 : une entreprise individuelle
  d_sf text := 'af200000-0000-4000-8000-000000000005'; -- sans forme juridique
  d_hc text := 'af200000-0000-4000-8000-000000000006'; -- une association (9220)
  d_sc text := 'af200000-0000-4000-8000-000000000007'; -- SARL sans capital
  d_ac text := 'af200000-0000-4000-8000-000000000008'; -- SARL, des acomptes sur dividendes au 1209
  d_br text := 'af200000-0000-4000-8000-000000000009'; -- SARL, capital 10 000 ; au brouillon de 2026, une écriture ordinaire (AFF4-Q1)
  empreinte text := repeat('a', 64);
  decision text := '{"organe":"assemblee","nombre_d_associes":"plusieurs","date_decision":"2026-05-15","comptes_approuves":true,"date_mise_en_paiement":"2026-06-30","reserves_statutaires_distribuables":true}';
  sans_paiement text := '{"organe":"assemblee","nombre_d_associes":"plusieurs","date_decision":"2026-05-15","comptes_approuves":true,"date_mise_en_paiement":null,"reserves_statutaires_distribuables":true}';
  bonnes text := '[{"origine":"benefice","destination":"reserve_legale","centimes":20000},{"origine":"benefice","destination":"autres_reserves","centimes":980000},{"origine":"benefice","destination":"dividendes","centimes":2000000}]';
  bonne_ecriture text := '{"journal":"OD","date":"2026-05-15","pieceRef":"Affectation du résultat 2025 — décision du 15/05/2026","pieceDate":"2026-05-15","libelle":"Affectation du résultat 2025","lignes":[{"compte":"120000","sens":"debit","centimes":3000000},{"compte":"106100","sens":"credit","centimes":20000},{"compte":"106800","sens":"credit","centimes":980000},{"compte":"457000","sens":"credit","centimes":2000000}]}';
  lignes_d2 text := '[{"origine":"benefice","destination":"reserve_legale","centimes":100000},{"origine":"benefice","destination":"report_debiteur","centimes":500000},{"origine":"benefice","destination":"report_crediteur","centimes":2400000}]';
  ecriture_d2 text := '{"journal":"OD","date":"2026-05-15","pieceRef":"Affectation du résultat 2025 — décision du 15/05/2026","pieceDate":"2026-05-15","libelle":"Affectation du résultat 2025","lignes":[{"compte":"120000","sens":"debit","centimes":3000000},{"compte":"106100","sens":"credit","centimes":100000},{"compte":"110000","sens":"credit","centimes":2400000},{"compte":"119000","sens":"credit","centimes":500000}]}';
  lignes_br text := '[{"origine":"benefice","destination":"reserve_legale","centimes":10000},{"origine":"benefice","destination":"report_crediteur","centimes":2990000}]';
  ecriture_br text := '{"journal":"OD","date":"2026-05-15","pieceRef":"Affectation du résultat 2025 — décision du 15/05/2026","pieceDate":"2026-05-15","libelle":"Affectation du résultat 2025","lignes":[{"compte":"120000","sens":"debit","centimes":3000000},{"compte":"106100","sens":"credit","centimes":10000},{"compte":"110000","sens":"credit","centimes":2990000}]}';
  sous_le_minimum_br text := '[{"origine":"benefice","destination":"reserve_legale","centimes":9999},{"origine":"benefice","destination":"report_crediteur","centimes":2990001}]';
  enr constant text := 'select enregistrer_affectation(%L, %s, %s, %L, %L, %L)';
  -- Les soldes que lit `affectation_soldes` à la date de la décision, la décision écartée en troisième paramètre (AFF4-Q1).
  soldes_a constant text := 'select (x.s ->> ''reserveLegale'') || '':'' || (x.s ->> ''reportCrediteur'') from public.affectation_soldes(%L, date ''2026-05-15'', %s) as x(s)';
  v1 text; v2 text; v3 text; v4 text; v5 text;
  o text;
  m text;
  cas_ text;
  attendu text;
  n bigint;
begin
  -- ── Le jeu ──
  insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva, forme_juridique, capital, compte_notes_de_frais)
  select x.id::uuid, 'Essai de l''affectation ' || x.n, c.cabinet_id, 'engagement', 'franchise', x.forme, x.capital, x.dirigeant
    from (select cabinet_id from dossiers where id = dossier_du_client::uuid) c
    cross join (values (d, 1, '5499', 10000::numeric, '455000'), (d2, 2, '5499', 10000, '455000'), (d3, 3, '5499', 10000, '455000'),
                       (d_ei, 4, '5499', 10000, '108000'), (d_sf, 5, null, null, '455000'), (d_hc, 6, '9220', 1000, '455000'),
                       (d_sc, 7, '5499', null, '455000'), (d_ac, 8, '5499', 10000, '455000'),
                       (d_br, 9, '5499', 10000, '455000')) as x(id, n, forme, capital, dirigeant);
  insert into dossier_assignations (dossier_id, user_id)
  select x.id::uuid, membre::uuid from unnest(array[d, d2, d3, d_ei, d_sf, d_hc, d_sc, d_ac, d_br, dossier_du_client]) as x(id)
  on conflict do nothing;
  -- L'exercice 2025 de D, D2, D3 et D_BR : un bénéfice de 30 000,00, écrit et validé ; 2024 validé aussi pour D.
  -- (une ligne ne naît validée que par la validation de son exercice : la porte que la garde lui ouvre, posée ici à la main)
  foreach o in array array[d, d2, d3, d_br] loop
    perform set_config('jd.validation_exercice', o, true);
    insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture,
                                     piece_ref, piece_date, compte_lib)
    values (o::uuid, date '2025-06-30', '706000', 'Essai', 30000, 'credit', 'validee', now(), 'OD', 1, 'Essai', date '2025-06-30', 'Essai'),
           (o::uuid, date '2025-06-30', '512000', 'Essai', 30000, 'debit', 'validee', now(), 'OD', 1, 'Essai', date '2025-06-30', 'Essai');
  end loop;
  perform set_config('jd.validation_exercice', '', true);
  -- Leurs à-nouveaux au 1er janvier 2026 (le résultat 2025 au 120, en attente d'affectation).
  insert into a_nouveaux (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte)
  select x.id::uuid, date '2026-01-01', x.compte, 'Essai', x.sens, x.montant, 'essai', empreinte
    from (values (d, '101000', 'credit', 10000), (d, '106100', 'credit', 800), (d, '106800', 'credit', 5000),
                 (d, '120000', 'credit', 30000), (d, '512000', 'debit', 45800),
                 (d2, '101000', 'credit', 10000), (d2, '119000', 'debit', 5000), (d2, '120000', 'credit', 30000), (d2, '512000', 'debit', 35000),
                 (d3, '101000', 'credit', 10000), (d3, '109000', 'debit', 5000), (d3, '106100', 'credit', 1000),
                 (d3, '120000', 'credit', 30000), (d3, '512000', 'debit', 36000),
                 (d_ac, '120900', 'debit', 10), (d_ac, '512000', 'credit', 10),
                 (d_br, '101000', 'credit', 10000), (d_br, '106800', 'credit', 2900), (d_br, '120000', 'credit', 30000),
                 (d_br, '512000', 'debit', 42900)) as x(id, compte, sens, montant);

  insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit,
                                 total_credit, empreinte, declaration)
  select x.id::uuid, x.annee, now(), membre::uuid, 'engagement', 0, 0, 0, 0, repeat('0', 64), null
    from (values (d, 2024), (d, 2025), (d2, 2025), (d3, 2025), (d_br, 2025)) as x(id, annee) order by x.annee;
  -- AFF4-Q1 : au brouillon de 2026 de D_BR, avant toute décision, une écriture ORDINAIRE (sans `affectation_id`) vire
  -- 2 900,00 des autres réserves à la réserve légale (900,00) et au report à nouveau (2 000,00). La première décision la lit :
  -- réserve légale 900,00 (au dixième du capital, il reste 100,00), report 2 000,00, autres réserves 0.
  insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut)
  values (d_br::uuid, date '2026-02-02', '106800', 'Virement de réserves', 2900, 'debit', 'proposee'),
         (d_br::uuid, date '2026-02-02', '106100', 'Virement de réserves', 900, 'credit', 'proposee'),
         (d_br::uuid, date '2026-02-02', '110000', 'Virement de réserves', 2000, 'credit', 'proposee');
  -- ── Les cas : (libellé, attendu, observé) ──
  for cas_, attendu, o in select * from (values
    ('E0. le BNC en trésorerie, refusé avant tout jugement de la décision',
     '22023 Un dossier tenu en trésorerie ne connaît pas l’affectation du résultat : son résultat passe au compte de l’exploitant par le report des soldes.',
     pg_temp.essayer(membre, format(enr, dossier_du_client, 2025, 'null', decision, bonnes, bonne_ecriture))),
    ('E1. le client d''un dossier du cabinet', '42501 Accès refusé à ce dossier.',
     pg_temp.essayer(client, format(enr, d, 2025, 'null', decision, bonnes, bonne_ecriture))),
    ('E2. une saisie illisible (les lignes ne sont pas une liste)', '22023 La décision saisie est illisible : la relire.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', decision, '{}', bonne_ecriture))),
    ('E3. un montant qui n''est pas un nombre entier de centimes',
     '22023 Un montant n’est pas un nombre entier de centimes, ou une ligne d’affectation n’est pas positive : rien ne se juge.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', decision, '[{"origine":"benefice","destination":"reserve_legale","centimes":1.5}]', null))),
    ('E4. une entreprise individuelle (le dirigeant au 108)',
     '22023 Une entreprise individuelle n’affecte pas son résultat : il passe au compte de l’exploitant par le report des soldes.',
     pg_temp.essayer(membre, format(enr, d_ei, 2025, 'null', decision, bonnes, bonne_ecriture))),
    ('E5. la forme juridique absente',
     '22023 La forme juridique du dossier n’est pas posée (onglet Informations, identité du dossier) : on ne sait pas quelles règles l’affectation suit.',
     pg_temp.essayer(membre, format(enr, d_sf, 2025, 'null', decision, bonnes, bonne_ecriture))),
    ('E6. une forme hors du champ (une association)',
     '22023 La forme juridique du dossier (9220) n’est ni une SARL, ni une société par actions, ni une autre société commerciale, ni une société civile : l’application n’en affecte pas le résultat.',
     pg_temp.essayer(membre, format(enr, d_hc, 2025, 'null', decision, bonnes, bonne_ecriture))),
    ('E7. une SARL sans capital',
     '22023 Le capital social du dossier n’est pas posé (onglet Informations, identité du dossier) : ni le dixième de la réserve légale ni le plancher des capitaux propres ne se calculent.',
     pg_temp.essayer(membre, format(enr, d_sc, 2025, 'null', decision, bonnes, bonne_ecriture))),
    ('E8. des acomptes sur dividendes au 1209 (AFF-Q8 (B))',
     '22023 Le compte des acomptes sur dividendes porte un solde de 10,00 € : l’application ne les impute pas encore sur les dividendes décidés ; l’affectation se passe hors de l’application.',
     pg_temp.essayer(membre, format(enr, d_ac, 2025, 'null', decision, bonnes, bonne_ecriture))),
    ('E9. un exercice hors de 2000 à 2100', '22023 L’exercice affecté n’est pas une année entre 2000 et 2100.',
     pg_temp.essayer(membre, format(enr, d, 1999, 'null', decision, bonnes, bonne_ecriture))),
    ('E10. un exercice qui n''est pas validé (la base seule)',
     '22023 L’exercice 2026 n’est pas validé : son résultat n’est pas figé, il ne s’affecte pas encore.',
     pg_temp.essayer(membre, format(enr, d, 2026, 'null', decision, bonnes, bonne_ecriture))),
    ('E11. une date qui n''est pas une date du calendrier', '22023 Une date n’est pas une date du calendrier (JJ/MM/AAAA).',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', replace(decision, '2026-05-15', '2026-02-30'), bonnes, bonne_ecriture))),
    ('E12. une décision datée de la clôture',
     '22023 La décision est datée du 31/12/2025, au plus tard à la clôture de l’exercice 2025 : les comptes ne s’approuvent et le résultat ne s’affecte qu’après la clôture.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', replace(decision, '2026-05-15', '2025-12-31'), bonnes, bonne_ecriture))),
    ('E13. une décision datée dans le futur',
     '22023 La décision est datée du 15/01/2099, dans le futur : elle s’enregistre une fois prise.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', replace(replace(decision, '2026-05-15', '2099-01-15'), '2026-06-30', '2099-06-30'), bonnes, bonne_ecriture))),
    ('E14. une décision datée dans un exercice validé', '23514 L’exercice qui contient le 15/05/2025 est validé : une écriture n’y entre plus.',
     pg_temp.essayer(membre, format(enr, d, 2024, 'null', replace(replace(decision, '2026-05-15', '2025-05-15'), '2026-06-30', '2025-06-30'), '[]', null))),
    ('E15. l''associé unique et plusieurs associés', '22023 Une décision de l’associé unique suppose un seul associé.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', replace(decision, '"assemblee"', '"associe_unique"'), bonnes, bonne_ecriture))),
    ('E16. des comptes non approuvés qui affectent',
     '22023 Les comptes ne sont pas approuvés : le résultat ne s’affecte pas, et la décision ne porte aucune ligne d’affectation ni date de mise en paiement.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', replace(decision, 'true,"date', 'false,"date'), bonnes, null))),
    ('E16b. des comptes non approuvés, sans ligne ni écriture (le contrôle positif)', 'ACCEPTÉ',
     regexp_replace(pg_temp.essayer(membre, format(enr, d, 2025, 'null', replace(sans_paiement, 'true,"date', 'false,"date'), '[]', null)), ' .*$', '')),
    ('E17. un couple qui n''est pas admis', '22023 Le report à nouveau créditeur ne s’affecte pas à la réserve légale.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', sans_paiement, '[{"origine":"report_crediteur","destination":"reserve_legale","centimes":100}]', null))),
    ('E18. les réserves statutaires que les statuts rendent indisponibles',
     '22023 Les statuts ne permettent pas de distribuer les réserves statutaires (C. com., art. L232-11, al. 3) : elles ne s’affectent pas aux dividendes.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', replace(sans_paiement, '"reserves_statutaires_distribuables":true', '"reserves_statutaires_distribuables":false'),
       '[{"origine":"benefice","destination":"reserve_legale","centimes":20000},{"origine":"benefice","destination":"report_crediteur","centimes":2980000},{"origine":"reserves_statutaires","destination":"dividendes","centimes":100}]', null))),
    ('E19. une perte affectée sur un bénéfice', '22023 L’exercice 2025 se solde par un bénéfice : une ligne affecte une perte.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', sans_paiement, '[{"origine":"perte","destination":"report_debiteur","centimes":100}]', null))),
    ('E20. un bénéfice qui ne s''affecte pas en entier',
     '22023 Le bénéfice de 30 000,00 € s’affecte en entier : les lignes en affectent 29 999,99 €.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', sans_paiement, '[{"origine":"benefice","destination":"reserve_legale","centimes":20000},{"origine":"benefice","destination":"report_crediteur","centimes":2979999}]', null))),
    ('E21. un prélèvement au-delà du solde du report',
     '22023 La décision prélève 1,00 € sur le report à nouveau créditeur, dont le solde est de 0,00 € à la date de la décision.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', sans_paiement, '[{"origine":"benefice","destination":"reserve_legale","centimes":20000},{"origine":"benefice","destination":"report_crediteur","centimes":2980000},{"origine":"report_crediteur","destination":"dividendes","centimes":100}]', null))),
    ('E22. un apurement au-delà des pertes antérieures',
     '22023 La décision apure 1,00 € de pertes antérieures, qui ne sont que de 0,00 €.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', sans_paiement, '[{"origine":"benefice","destination":"reserve_legale","centimes":20000},{"origine":"benefice","destination":"report_debiteur","centimes":100},{"origine":"benefice","destination":"report_crediteur","centimes":2979900}]', null))),
    ('E23. la réserve légale sous son minimum, d''un centime (le dixième restant : 200,00)',
     '22023 La réserve légale doit recevoir au moins 200,00 € (un vingtième du bénéfice diminué des pertes antérieures, jusqu’au dixième du capital ; C. com., art. L232-10) : la décision lui affecte 199,99 €.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', sans_paiement, '[{"origine":"benefice","destination":"reserve_legale","centimes":19999},{"origine":"benefice","destination":"report_crediteur","centimes":2980001}]', null))),
    ('E24. des dividendes au-delà du bénéfice distribuable (pertes antérieures)',
     '22023 Les dividendes pris sur le bénéfice et le report à nouveau (29 000,00 €) dépassent le bénéfice distribuable (24 000,00 € ; C. com., art. L232-11, al. 1) : ce serait un dividende fictif.',
     pg_temp.essayer(membre, format(enr, d2, 2025, 'null', sans_paiement, '[{"origine":"benefice","destination":"reserve_legale","centimes":100000},{"origine":"benefice","destination":"dividendes","centimes":2900000}]', null))),
    ('E25. des réserves distribuées avant le bénéfice',
     '22023 Les dividendes se prélèvent par priorité sur le bénéfice distribuable de l’exercice (C. com., art. L232-11, al. 2) : la décision prend 1 000,00 € sur les réserves alors que 29 800,00 € du bénéfice distribuable ne sont pas distribués.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', sans_paiement, '[{"origine":"benefice","destination":"reserve_legale","centimes":20000},{"origine":"benefice","destination":"report_crediteur","centimes":2980000},{"origine":"autres_reserves","destination":"dividendes","centimes":100000}]', null))),
    ('E26. des capitaux propres sous le plancher (capital non appelé)',
     '22023 Après la distribution, les capitaux propres (6 000,00 €) seraient inférieurs au capital augmenté des réserves que la loi ou les statuts ne permettent pas de distribuer (11 000,00 € ; C. com., art. L232-11, al. 3).',
     pg_temp.essayer(membre, format(enr, d3, 2025, 'null', sans_paiement, '[{"origine":"benefice","destination":"dividendes","centimes":3000000}]', null))),
    ('E27. une mise en paiement sans dividende',
     '22023 La décision ne distribue aucun dividende : elle ne porte pas de date de mise en paiement.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', decision, '[{"origine":"benefice","destination":"reserve_legale","centimes":20000},{"origine":"benefice","destination":"report_crediteur","centimes":2980000}]', null))),
    ('E28. une mise en paiement avant la décision', '22023 La mise en paiement (01/05/2026) précède la décision (15/05/2026).',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', replace(decision, '2026-06-30', '2026-05-01'), bonnes, bonne_ecriture))),
    ('E29. une écriture proposée qui n''est pas celle de la décision', '22023 L’écriture proposée n’est pas celle de la décision : la recomposer.',
     pg_temp.essayer(membre, format(enr, d, 2025, 'null', decision, bonnes, replace(bonne_ecriture, '"centimes":2000000', '"centimes":1999999')))),
    ('E37. D_BR, la première décision : la réserve légale lue au brouillon (900,00 ; il reste 100,00 au dixième, AFF4-Q1)',
     '22023 La réserve légale doit recevoir au moins 100,00 € (un vingtième du bénéfice diminué des pertes antérieures, jusqu’au dixième du capital ; C. com., art. L232-10) : la décision lui affecte 99,99 €.',
     pg_temp.essayer(membre, format(enr, d_br, 2025, 'null', sans_paiement, sous_le_minimum_br, null))),
    ('E37c. D_BR, la première décision : le report à nouveau lu au brouillon (2 000,00, AFF4-Q1)',
     '22023 La décision prélève 2 000,01 € sur le report à nouveau créditeur, dont le solde est de 2 000,00 € à la date de la décision.',
     pg_temp.essayer(membre, format(enr, d_br, 2025, 'null', sans_paiement, '[{"origine":"benefice","destination":"reserve_legale","centimes":10000},{"origine":"benefice","destination":"report_crediteur","centimes":2990000},{"origine":"report_crediteur","destination":"dividendes","centimes":200001}]', null)))
  ) as c(cas, attendu, observe)
  loop
    insert into essai_affectation values (cas_, attendu, o, o = attendu);
  end loop;

  -- ── Le contrôle positif : l'exemple de la conception (§ 3.6), enregistré ──
  o := pg_temp.essayer(membre, format(enr, d, 2025, 'null', decision, bonnes, bonne_ecriture), true);
  v1 := substr(o, 9);
  insert into essai_affectation values ('E30. la décision de la conception s''enregistre', 'ACCEPTÉ <identifiant>', o, o ~ '^ACCEPTÉ [0-9a-f-]{36}$');
  select string_agg(e.compte || ':' || e.sens || ':' || e.montant || ':' || e.date || ':' || e.libelle || ':' || e.statut, ' | '
                    order by e.sens desc, e.compte) into o
    from ecritures_brouillon e where e.affectation_id = v1::uuid;
  attendu := '120000:debit:30000.00:2026-05-15:Affectation du résultat 2025:proposee | 106100:credit:200.00:2026-05-15:Affectation du résultat 2025:proposee | 106800:credit:9800.00:2026-05-15:Affectation du résultat 2025:proposee | 457000:credit:20000.00:2026-05-15:Affectation du résultat 2025:proposee';
  insert into essai_affectation values ('E30b. son écriture : quatre lignes au journal de la décision, à sa date', attendu, o, o = attendu);
  select a.version || ':' || a.etat || ':' || a.resultat_centimes || ':' || a.capital_centimes || ':' || a.forme_juridique || ':'
         || (a.soldes_lus ->> 'reserveLegale') || ':' || (a.soldes_lus ->> 'autresReserves') || ':' || (select count(*) from lignes_d_affectation l where l.affectation_id = a.id)
    into o from affectations_du_resultat a where a.id = v1::uuid;
  insert into essai_affectation values ('E30c. ce qu''elle a lu, figé : version, état, résultat, capital, forme, soldes, trois lignes',
    '1:en_vigueur:3000000:1000000:5499:80000:500000:3', o, o = '1:en_vigueur:3000000:1000000:5499:80000:500000:3');

  -- ── La version lue, le remplacement ──
  o := pg_temp.essayer(membre, format(enr, d, 2025, 'null', decision, bonnes, bonne_ecriture));
  insert into essai_affectation values ('E31. une saisie qui ne retient pas la version en vigueur',
    '40001 Cette décision a changé depuis sa lecture : relire l’affectation avant de l’enregistrer.', o,
    o = '40001 Cette décision a changé depuis sa lecture : relire l’affectation avant de l’enregistrer.');
  o := pg_temp.essayer(membre, format(enr, d, 2025, '1', decision, bonnes, bonne_ecriture), true);
  v2 := substr(o, 9);
  select (select etat from affectations_du_resultat where id = v1::uuid) || ':' || (select version || ':' || etat from affectations_du_resultat where id = v2::uuid)
         || ':' || (select count(*) from ecritures_brouillon where affectation_id = v1::uuid) || ':' || (select count(*) from ecritures_brouillon where affectation_id = v2::uuid)
    into o;
  insert into essai_affectation values ('E32. la version 2 remplace la 1 : remplacée, sans écriture ; la 2 en vigueur, quatre lignes',
    'remplacee:2:en_vigueur:0:4', o, o = 'remplacee:2:en_vigueur:0:4');

  -- ── Les écritures directes ──
  o := pg_temp.essayer(membre, format('insert into affectations_du_resultat (dossier_id, exercice_affecte, version, organe, nombre_d_associes_declare, date_decision, comptes_approuves, reserves_statutaires_distribuables, resultat_centimes, forme_juridique, capital_centimes, soldes_lus, cree_par) select dossier_id, exercice_affecte, 9, organe, nombre_d_associes_declare, date_decision, false, true, resultat_centimes, forme_juridique, capital_centimes, soldes_lus, cree_par from affectations_du_resultat where id = %L', v2));
  -- (la garde, déclencheur AVANT la ligne, refuse avant que la RLS ne juge la ligne écrite : son refus est celui qu'on lit)
  -- (la porte d'accès en base, acces_avant_les_gardes, ligne 43 : la RLS juge d'abord, et la policy n'ouvre l'insertion
  -- qu'au super-administrateur — le cabinet lit son refus, jamais celui de la garde)
  insert into essai_affectation
  select 'E33. le cabinet n''écrit pas une décision en direct (la garde, puis la RLS ; la RLS d''abord, la porte en base)', x.attendu, o, o = x.attendu
    from (select case when exists (select 1 from pg_trigger g where g.tgrelid = 'public.affectations_du_resultat'::regclass and g.tgname = '_acces_avant_les_gardes')
                      then '42501 new row violates row-level security policy for table "affectations_du_resultat"'
                      else '42501 Une décision d’affectation ne s’écrit que par enregistrer_affectation, retirer_affectation et joindre_document_affectation.' end as attendu) x;
  o := pg_temp.essayer(null, format('update affectations_du_resultat set organe = %L where id = %L', 'consultation_ecrite', v2));
  insert into essai_affectation values ('E33b. le propriétaire ne la modifie pas en direct (la garde)',
    '42501 Une décision d’affectation ne s’écrit que par enregistrer_affectation, retirer_affectation et joindre_document_affectation.', o,
    o = '42501 Une décision d’affectation ne s’écrit que par enregistrer_affectation, retirer_affectation et joindre_document_affectation.');
  o := pg_temp.essayer(null, format('insert into ecritures_brouillon (dossier_id, affectation_id, date, compte, libelle, montant, sens, statut) values (%L, %L, %L, %L, %L, 1, %L, %L)',
    d, v2, '2026-05-15', '106800', 'x', 'credit', 'proposee'));
  insert into essai_affectation values ('E33c. ni une ligne de son écriture (la garde du brouillon)',
    '42501 Une écriture d’affectation ne change que par sa décision.', o, o = '42501 Une écriture d’affectation ne change que par sa décision.');
  o := pg_temp.essayer(null, format('do $x$ begin perform set_config(%L, %L, true); insert into ecritures_brouillon (dossier_id, affectation_id, piece_id, date, compte, libelle, montant, sens, statut) values (%L, %L, (select p.id from pieces p order by p.id limit 1), %L, %L, %L, 1, %L, %L); end $x$',
    'jd.affectation', d, d, v2, '2026-05-15', '106800', 'x', 'credit', 'proposee'));
  insert into essai_affectation values ('E33d. une ligne d''affectation ne cite aucune autre source (la contrainte)',
    '23514 … ecritures_brouillon_affectation_sans_autre_source', o, o like '23514 %ecritures_brouillon_affectation_sans_autre_source%');

  -- ── Les mutations, qui doivent mordre (avant le gel de 2026) ──
  o := pg_temp.muter(pg_temp.remplacer('public.enregistrer_affectation(uuid,integer,integer,jsonb,jsonb,jsonb)', 'if v_legale_dotee < v_minimale then', 'if false then'),
    membre, format(enr, d, 2025, '2', sans_paiement, '[{"origine":"benefice","destination":"reserve_legale","centimes":19999},{"origine":"benefice","destination":"report_crediteur","centimes":2980001}]', null));
  insert into essai_mutations values ('M1 — le minimum de la réserve légale tu : E23 passe', o, o not like '22023 La réserve légale doit recevoir%');
  o := pg_temp.muter(pg_temp.remplacer('public.enregistrer_affectation(uuid,integer,integer,jsonb,jsonb,jsonb)', 'if v_div_br > v_distribuable then', 'if false then'),
    membre, format(enr, d2, 2025, 'null', sans_paiement, '[{"origine":"benefice","destination":"reserve_legale","centimes":100000},{"origine":"benefice","destination":"dividendes","centimes":2900000}]', null));
  insert into essai_mutations values ('M2 — le bénéfice distribuable tu : E24 change', o, o not like '22023 Les dividendes pris sur le bénéfice%');
  o := pg_temp.muter(pg_temp.remplacer('public.enregistrer_affectation(uuid,integer,integer,jsonb,jsonb,jsonb)', 'if v_div > 0 and v_avant - v_div < v_plancher then', 'if false then'),
    membre, format(enr, d3, 2025, 'null', sans_paiement, '[{"origine":"benefice","destination":"dividendes","centimes":3000000}]', null));
  insert into essai_mutations values ('M3 — le plancher des capitaux propres tu : E26 passe', o, o not like '22023 Après la distribution%');
  o := pg_temp.muter(pg_temp.remplacer('public.enregistrer_affectation(uuid,integer,integer,jsonb,jsonb,jsonb)',
      'if (v_ancienne.id is null) <> (p_version_lue is null) or', 'if'),
    membre, format(enr, d, 2025, 'null', decision, bonnes, bonne_ecriture));
  insert into essai_mutations values ('M4 — la version lue tue : E31 change', o, o not like '40001 %');
  o := pg_temp.muter(pg_temp.remplacer('public.enregistrer_affectation(uuid,integer,integer,jsonb,jsonb,jsonb)',
      'and not exists (select compte, sens, centimes from attendues except all select compte, sens, centimes from recues)', ''),
    membre, format(enr, d2, 2025, 'null', sans_paiement, lignes_d2, replace(ecriture_d2, '"centimes":500000', '"centimes":500001')));
  insert into essai_mutations values ('M5 — la comparaison en multiensemble tue : une écriture fausse passe', o, o not like '22023 L’écriture proposée%');
  o := pg_temp.muter(pg_temp.remplacer('public.enregistrer_affectation(uuid,integer,integer,jsonb,jsonb,jsonb)', 'if v_mode = ''tresorerie'' then', 'if false then'),
    membre, format(enr, dossier_du_client, 2025, 'null', decision, bonnes, bonne_ecriture));
  insert into essai_mutations values ('M6 — la trésorerie tue : E0 change', o, o not like '22023 Un dossier tenu en trésorerie%');
  o := pg_temp.muter('drop trigger ecritures_brouillon_affectation on public.ecritures_brouillon', null,
    format('insert into ecritures_brouillon (dossier_id, affectation_id, date, compte, libelle, montant, sens, statut) values (%L, %L, %L, %L, %L, 1, %L, %L)',
      d, v2, '2026-05-15', '106800', 'x', 'credit', 'proposee'));
  insert into essai_mutations values ('M7 — la garde du brouillon retirée : E33c passe', o, o = 'ACCEPTÉ');
  o := pg_temp.muter(pg_temp.remplacer('public.garder_affectations_du_resultat()', 'and not (tg_op = ''INSERT'' and public.is_super_admin()) then', 'and false then'),
    null, format('update affectations_du_resultat set organe = %L where id = %L', 'consultation_ecrite', v2));
  insert into essai_mutations values ('M8 — la porte de la garde ouverte à tous : E33b change', o, o not like '42501 Une décision d’affectation ne s’écrit%');

  -- ── Le contrôle positif de D2 : un bénéfice qui apure les pertes, sans dividende ──
  o := pg_temp.essayer(membre, format(enr, d2, 2025, 'null', sans_paiement, lignes_d2, ecriture_d2));
  insert into essai_affectation values ('E30d. D2 : la réserve légale au vingtième plafonné, l''apurement, le report (le contrôle positif)', 'ACCEPTÉ',
    regexp_replace(o, ' .*$', ''), o ~ '^ACCEPTÉ ');

  -- ── Le retrait, le procès-verbal ──
  o := pg_temp.essayer(membre, format('select retirer_affectation(%L, %L, 1)', d, v2));
  insert into essai_affectation values ('E34. un retrait contre une version périmée',
    '40001 Cette décision a changé depuis sa lecture : relire l’affectation avant de l’enregistrer.', o,
    o = '40001 Cette décision a changé depuis sa lecture : relire l’affectation avant de l’enregistrer.');
  o := pg_temp.essayer(membre, format('select retirer_affectation(%L, %L, 2)', d, v2), true);
  select o || ':' || (select etat from affectations_du_resultat where id = v2::uuid) || ':' || (select count(*) from ecritures_brouillon where affectation_id = v2::uuid) into o;
  insert into essai_affectation values ('E34b. le retrait : quatre lignes retirées, la décision retirée, lisible', 'ACCEPTÉ 4:retiree:0', o, o = 'ACCEPTÉ 4:retiree:0');
  o := pg_temp.essayer(membre, format('select joindre_document_affectation(%L, %L, %L)', v2, d || '/affectations/' || v2 || '.pdf', empreinte));
  insert into essai_affectation values ('E35. un procès-verbal joint à une décision retirée',
    '40001 Cette décision a changé depuis sa lecture : relire l’affectation avant de l’enregistrer.', o,
    o = '40001 Cette décision a changé depuis sa lecture : relire l’affectation avant de l’enregistrer.');
  o := pg_temp.essayer(membre, format(enr, d, 2025, 'null', decision, bonnes, bonne_ecriture), true);
  v3 := substr(o, 9);
  o := pg_temp.essayer(membre, format('select joindre_document_affectation(%L, %L, %L)', v3, d || '/affectations/autre.pdf', empreinte));
  insert into essai_affectation values ('E35b. un procès-verbal hors du chemin de sa décision',
    '22023 Le procès-verbal se dépose au chemin de sa décision, avec son empreinte SHA-256.', o,
    o = '22023 Le procès-verbal se dépose au chemin de sa décision, avec son empreinte SHA-256.');
  o := pg_temp.essayer(membre, format('select joindre_document_affectation(%L, %L, %L)', v3, d || '/affectations/' || v3 || '.pdf', empreinte), true);
  insert into essai_affectation values ('E35c. le procès-verbal joint (le contrôle positif), la version 3', 'ACCEPTÉ:3',
    o || ':' || (select version from affectations_du_resultat where id = v3::uuid), o || ':' || (select version from affectations_du_resultat where id = v3::uuid) = 'ACCEPTÉ:3');
  o := pg_temp.essayer(membre, format('select joindre_document_affectation(%L, %L, %L)', v3, d || '/affectations/' || v3 || '.pdf', empreinte));
  insert into essai_affectation values ('E35d. une seconde fois',
    '22023 Le procès-verbal de cette décision est déjà joint : une version nouvelle de la décision en produit un nouveau.', o,
    o = '22023 Le procès-verbal de cette décision est déjà joint : une version nouvelle de la décision en produit un nouveau.');

  -- ── AFF4-Q1 : les soldes lus du brouillon. La première décision d'un exercice (aucune décision remplacée) compte les
  --    lignes ordinaires ; un remplacement n'écarte que les lignes de la décision qu'il remplace. ──
  o := pg_temp.muter(pg_temp.remplacer('public.affectation_soldes(uuid,date,uuid)',
      '(p_exclue is null or e.affectation_id is distinct from p_exclue)', 'e.affectation_id is distinct from p_exclue'),
    membre, format(enr, d_br, 2025, 'null', sans_paiement, sous_le_minimum_br, null));
  insert into essai_mutations values ('M10 — la clause d''avant AFF4-Q1 (le brouillon écarté sans décision remplacée) : E37 change',
    o, o not like '22023 La réserve légale doit recevoir au moins 100,00%');
  o := pg_temp.essayer(membre, format(enr, d_br, 2025, 'null', sans_paiement, lignes_br, ecriture_br), true);
  v4 := case when o ~ '^ACCEPTÉ [0-9a-f-]{36}$' then substr(o, 9) end;
  insert into essai_affectation values ('E38. D_BR : la première décision, la réserve légale au minimum lu (100,00), s''enregistre',
    'ACCEPTÉ <identifiant>', o, v4 is not null);
  select (a.soldes_lus ->> 'reserveLegale') || ':' || (a.soldes_lus ->> 'reportCrediteur') || ':' || (a.soldes_lus ->> 'autresReserves')
         || ':' || (a.soldes_lus ->> 'capitalAuxComptes')
    into o from affectations_du_resultat a where a.id = v4::uuid;
  insert into essai_affectation values ('E38b. ce qu''elle a lu, figé : la réserve légale, le report et les autres réserves du brouillon, le capital',
    '90000:200000:0:1000000', o, coalesce(o = '90000:200000:0:1000000', false));
  o := pg_temp.essayer(membre, format(enr, d_br, 2025, '1', sans_paiement, lignes_br, ecriture_br), true);
  v5 := case when o ~ '^ACCEPTÉ [0-9a-f-]{36}$' then substr(o, 9) end;
  select (select r.etat from affectations_du_resultat r where r.id = v4::uuid) || ':' || a.version || ':' || a.etat || ':'
         || (a.soldes_lus ->> 'reserveLegale') || ':' || (a.soldes_lus ->> 'reportCrediteur') || ':' || (a.soldes_lus ->> 'autresReserves')
    into o from affectations_du_resultat a where a.id = v5::uuid;
  insert into essai_affectation values ('E39. son remplacement lit les mêmes soldes : les lignes de la version 1 écartées, l''écriture ordinaire gardée',
    'remplacee:2:en_vigueur:90000:200000:0', o, coalesce(o = 'remplacee:2:en_vigueur:90000:200000:0', false));
  o := pg_temp.essayer(null, format(soldes_a, d_br, quote_literal(v5)));
  insert into essai_affectation values ('E39c. affectation_soldes, la décision en vigueur écartée : ses lignes seules s''en vont',
    'ACCEPTÉ 90000:200000', o, coalesce(o = 'ACCEPTÉ 90000:200000', false));
  o := pg_temp.essayer(null, format(soldes_a, d_br, 'null'));
  insert into essai_affectation values ('E39d. affectation_soldes, aucune décision écartée : toutes les lignes, la décision en vigueur comprise',
    'ACCEPTÉ 100000:3190000', o, coalesce(o = 'ACCEPTÉ 100000:3190000', false));
  o := pg_temp.essayer(null, format(soldes_a, d_br, 'gen_random_uuid()'));
  insert into essai_affectation values ('E39e. affectation_soldes, une autre décision écartée : rien de la décision en vigueur ne s''en va',
    'ACCEPTÉ 100000:3190000', o, coalesce(o = 'ACCEPTÉ 100000:3190000', false));
  o := pg_temp.essayer(membre, format(enr, d_br, 2025, '2', sans_paiement, sous_le_minimum_br, null));
  insert into essai_affectation values ('E39f. D_BR, un remplacement sous le minimum : la version remplacée écartée, il reste 100,00 au dixième',
    '22023 La réserve légale doit recevoir au moins 100,00 € (un vingtième du bénéfice diminué des pertes antérieures, jusqu’au dixième du capital ; C. com., art. L232-10) : la décision lui affecte 99,99 €.', o,
    o = '22023 La réserve légale doit recevoir au moins 100,00 € (un vingtième du bénéfice diminué des pertes antérieures, jusqu’au dixième du capital ; C. com., art. L232-10) : la décision lui affecte 99,99 €.');
  o := pg_temp.muter(pg_temp.remplacer('public.affectation_soldes(uuid,date,uuid)',
      'and (p_exclue is null or e.affectation_id is distinct from p_exclue)', ''),
    null, format(soldes_a, d_br, quote_literal(v5)));
  insert into essai_mutations values ('M11 — la décision remplacée plus écartée : E39c change', o, o is distinct from 'ACCEPTÉ 90000:200000');
  o := pg_temp.muter(pg_temp.remplacer('public.affectation_soldes(uuid,date,uuid)',
      '(p_exclue is null or e.affectation_id is distinct from p_exclue)', '(e.affectation_id is null)'),
    null, format(soldes_a, d_br, 'gen_random_uuid()'));
  insert into essai_mutations values ('M12 — les lignes de toute décision écartées : E39e change', o, o is distinct from 'ACCEPTÉ 100000:3190000');
  o := pg_temp.muter(pg_temp.remplacer('public.enregistrer_affectation(uuid,integer,integer,jsonb,jsonb,jsonb)',
      'public.affectation_soldes(p_dossier_id, v_date, v_ancienne.id)', 'public.affectation_soldes(p_dossier_id, v_date, null)'),
    membre, format(enr, d_br, 2025, '2', sans_paiement, sous_le_minimum_br, null));
  insert into essai_mutations values ('M13 — le remplacement n''écarte plus sa version : E39f change', o,
    o is distinct from '22023 La réserve légale doit recevoir au moins 100,00 € (un vingtième du bénéfice diminué des pertes antérieures, jusqu’au dixième du capital ; C. com., art. L232-10) : la décision lui affecte 99,99 €.');

  -- ── Le gel : l'exercice 2026, qui contient la décision, validé ──
  insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit,
                                 total_credit, empreinte, declaration)
  values (d::uuid, 2026, now(), membre::uuid, 'engagement', 0, 0, 0, 0, repeat('0', 64), null);
  o := pg_temp.essayer(membre, format('select retirer_affectation(%L, %L, 3)', d, v3));
  insert into essai_affectation values ('E36. le retrait d''une décision que la validation a figée',
    '23514 L’exercice qui contient le 15/05/2026 est validé : une écriture n’y entre plus.', o,
    o = '23514 L’exercice qui contient le 15/05/2026 est validé : une écriture n’y entre plus.');
  o := pg_temp.essayer(membre, format(enr, d, 2025, '3', decision, bonnes, bonne_ecriture));
  insert into essai_affectation values ('E36b. son remplacement',
    '23514 L’exercice qui contient le 15/05/2026 est validé : une écriture n’y entre plus.', o,
    o = '23514 L’exercice qui contient le 15/05/2026 est validé : une écriture n’y entre plus.');
  o := pg_temp.muter(pg_temp.remplacer('public.retirer_affectation(uuid,uuid,integer)',
      'if (v_frontiere is not null and extract(year from v_decision.date_decision) <= extract(year from v_frontiere))', 'if (false)'),
    membre, format('select retirer_affectation(%L, %L, 3)', d, v3));
  insert into essai_mutations values ('M9 — le gel du retrait tu : E36 change', o, o <> '23514 L’exercice qui contient le 15/05/2026 est validé : une écriture n’y entre plus.');
end
$essai$;

-- Une mutation dont le fragment n'est plus dans sa fonction n'a rien muté : elle ne mord pas, quoi que dise son test (AFF4-Q1).
update essai_mutations set mord = false where observe = 'FRAGMENT ABSENT';

select 'CAS' as tableau, cas as ligne, case when ok then 'juste' else '*** EN FAUTE ***' end as verdict,
       'attendu ' || attendu || ' | observé ' || coalesce(observe, '?') as detail
  from essai_affectation
union all
select 'MUTATIONS', mutation, case when mord then 'mord' else '*** NE MORD PAS ***' end, observe from essai_mutations
union all
select 'BILAN', 'en faute / cas ; mutations qui mordent / mutations',
       (select count(*) filter (where not ok) || ' / ' || count(*) from essai_affectation) || ' ; '
         || (select count(*) filter (where mord) || ' / ' || count(*) from essai_mutations), ''
order by 1, 2;

rollback;
