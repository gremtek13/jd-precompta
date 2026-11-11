-- L'OUVERTURE DE LA BANQUE ÉCLATÉE ENTRE LES COMPTES BANCAIRES (ligne 26.6, lot MCB5, sixième partie ; MCB-Q7), ÉPROUVÉE
-- EN BASE — l'essai de la migration `ouverture_eclatee_par_compte` (supabase/preparees/20261111235000_…, préparée le
-- 11/11/2026), qui suit `comptes_bancaires` (MCB1). RÉPLIQUE SEULEMENT. À rejouer après toute migration qui touche ses
-- trois fonctions, sa garde, `comptes_bancaires`, `controles_releves_bancaires`, `soldes_reportes` ou `a_nouveaux`. Sans la
-- migration : une seule ligne, EN ATTENTE. Les contrôles 40 à 49 éprouvent le filet de la validation, la migration
-- `ouverture_eclatee_a_la_validation` (20261111235500, MCB5G-Q2), qui suit celle-ci : sans lui, une ligne EN ATTENTE (40).
--
-- Ce qui se prouve ici, dans un dossier JETABLE du cabinet du dossier `test`, créé dans la sous-transaction de chaque étape
-- (un principal au 512000 et un second compte qui tient son 512200 depuis le 01/01/2026 ; l'exercice 2025 validé, ses
-- soldes reportés au 01/01/2026 portant au 512000 l'argent des deux comptes) :
--   - LA FORME : la colonne, sa contrainte, la sécurité et les droits des quatre fonctions ;
--   - L'ÉCLATEMENT ATTENDU : le solde du second compte au relevé du 31/12/2025 passe à son 512200, face au 512000 — lu sur le
--     relevé qui finit ce jour, sur celui qui couvre ce jour (corrigé de ses mouvements), sur celui de janvier ; zéro pour un
--     compte clos ; rien pour un compte ouvert après, un dossier à un seul compte, un premier exercice sans ouverture ; la
--     balance reprise au 01/01/2026 de même ;
--   - SES REFUS, à leurs mots : l'ouverture attendue, un relevé qui manque, deux relevés qui se contredisent, une somme qui
--     ne fait pas l'ouverture du 512 du rôle ; et ceux du clic : une composition fausse ou incomplète, un exercice validé, un
--     inconnu ;
--   - LA GARDE : une ligne de l'éclatement ne s'écrit, ne se retire ni ne se modifie hors de sa fonction ;
--   - LE FILET DE LA VALIDATION (40 à 51) : la ligne d'un exercice validé ne s'insère, sous le propriétaire ou par
--     `valider_exercice`, qu'avec l'éclatement de son 1er janvier à jour — manquant, à réécrire, à retirer ou retenu par un
--     relevé, refusée aux mots du préalable `ouverture-a-eclater` — doublé compris ; seul compte l'éclatement du 1er janvier de
--     l'exercice (2027 se valide après un 2026 éclaté) ; un dossier à un seul compte passe ; la restauration du
--     super-administrateur, sous le rôle de l'API, ne se rejuge pas ; et de bout en bout, `valider_exercice` refuse 2025 sans
--     l'éclatement de son 1er janvier et le valide avec lui, numéroté au journal OD ;
--   - et que RIEN ne reste en base.
-- Chaque étape s'annule dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), son verdict posé avant le `raise`. Les
-- verdicts voyagent dans un réglage LOCAL (`essai.ouverture_eclatee`) ; aucune table créée, aucune suppression, aucune mise à
-- jour sans `where`.
do $$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu constant text := 'cb5a0000-0000-4000-8000-0000000000ff';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  d constant text := 'cb5a0000-0000-4000-8000-0000000000d1';
  p constant text := 'cb5a0000-0000-4000-8000-0000000000a1';
  s constant text := 'cb5a0000-0000-4000-8000-0000000000a2';
  dossier text;
  comptes text;
  releve_p text;
  releve_s text;
  report text;
  valide text;
  bonne jsonb;
  etapes_filet jsonb := '[]'::jsonb;
  marque text;
  vingt_cinq text;
  numerotation text;
  libelles_an text;
  jeu_base text;
  etapes jsonb;
  e jsonb;
  obs text;
  accepte boolean;
  code_recu text;
  message text;
  ok boolean;
  observe text;
  avant text;
  apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.ecrire_ouverture_eclatee(uuid, integer, jsonb)') is null then
    perform set_config('essai.ouverture_eclatee', jsonb_build_array(jsonb_build_object('controle',
      '0. EN ATTENTE de la migration ouverture_eclatee_par_compte', 'ok', true,
      'observe', 'absente : l''essai se joue dès qu''elle est en base'))::text, true);
    return;
  end if;
  select concat_ws('/', (select count(*) from dossiers), (select count(*) from comptes_bancaires),
      (select count(*) from lignes_bancaires), (select count(*) from controles_releves_bancaires),
      (select count(*) from ecritures_brouillon), (select count(*) from soldes_reportes), (select count(*) from exercices_valides))
    into avant;

  -- ══ 1 à 3. La forme ══
  verdicts := verdicts || jsonb_build_object('controle', '1. la colonne et sa contrainte : une seule source, un 1er janvier',
    'observe', (select string_agg(conname, ',') from pg_constraint where conrelid = 'public.ecritures_brouillon'::regclass
                 and conname like 'ecritures_brouillon_ouverture%'),
    'ok', exists (select 1 from pg_constraint where conrelid = 'public.ecritures_brouillon'::regclass
                   and conname = 'ecritures_brouillon_ouverture_eclatee' and contype = 'c' and convalidated)
          and exists (select 1 from pg_constraint where conrelid = 'public.ecritures_brouillon'::regclass
                       and conname = 'ecritures_brouillon_ouverture_compte_bancaire' and contype = 'f'));
  verdicts := verdicts || jsonb_build_object('controle', '2. le clic et la garde en definer, search_path posé ; les deux lectures aux droits de l''appelant',
    'observe', (select string_agg(proname || ':' || case when prosecdef then 'definer' else 'invoker' end, ',' order by proname)
                  from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ecrire_ouverture_eclatee',
                    'garder_ecriture_ouverture_eclatee', 'ouverture_eclatee_attendue', 'soldes_des_comptes_au_trente_et_un')),
    'ok', (select bool_and(prosecdef = (proname in ('ecrire_ouverture_eclatee', 'garder_ecriture_ouverture_eclatee'))
                           and proconfig @> array['search_path=public'])
             from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ecrire_ouverture_eclatee',
               'garder_ecriture_ouverture_eclatee', 'ouverture_eclatee_attendue', 'soldes_des_comptes_au_trente_et_un')));
  verdicts := verdicts || jsonb_build_object('controle', '3. seul le clic s''exécute, par un compte connecté ; jamais par anon',
    'observe', concat_ws(',', has_function_privilege('authenticated', 'public.ecrire_ouverture_eclatee(uuid, integer, jsonb)', 'execute'),
      has_function_privilege('anon', 'public.ecrire_ouverture_eclatee(uuid, integer, jsonb)', 'execute'),
      has_function_privilege('authenticated', 'public.ouverture_eclatee_attendue(uuid, integer)', 'execute'),
      has_function_privilege('authenticated', 'public.soldes_des_comptes_au_trente_et_un(uuid, integer)', 'execute')),
    'ok', has_function_privilege('authenticated', 'public.ecrire_ouverture_eclatee(uuid, integer, jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.ecrire_ouverture_eclatee(uuid, integer, jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public.ouverture_eclatee_attendue(uuid, integer)', 'execute')
      and not has_function_privilege('authenticated', 'public.soldes_des_comptes_au_trente_et_un(uuid, integer)', 'execute'));

  -- ══ 10 à 49. Le jeu, et ses variantes ══
  dossier := format($q$insert into dossiers (id, nom, cabinet_id) values (%L, 'ESSAI MCB5G', %L);$q$, d, cabinet);
  comptes := format($q$insert into comptes_bancaires (id, dossier_id, libelle, principal) values (%2$L, %1$L, 'Compte principal', true);
    insert into comptes_bancaires (id, dossier_id, libelle, compte, compte_propre_depuis, ouvert_le, clos_le)
      values (%3$L, %1$L, 'ESSAI MCB5G SECOND', '512200', '2026-01-01', '{OUVERT}', {CLOS});$q$, d, p, s);
  releve_p := format($q$insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant, source_fichier)
      values (%1$L, %2$L, '2025-12-15', 'ESSAI', 100, 'essai_p_dec.csv');
    insert into controles_releves_bancaires (dossier_id, compte_bancaire_id, source_fichier, solde_initial, solde_final,
      somme_mouvements, ecart, coherent, periode_debut, periode_fin)
      values (%1$L, %2$L, 'essai_p_dec.csv', 900, 1000, 100, 0, true, '2025-12-01', '2025-12-31');$q$, d, p);
  releve_s := format($q$insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant, source_fichier)
      values (%1$L, %2$L, '2025-12-10', 'ESSAI', 50, 'essai_s_dec.csv');
    insert into controles_releves_bancaires (dossier_id, compte_bancaire_id, source_fichier, solde_initial, solde_final,
      somme_mouvements, ecart, coherent, periode_debut, periode_fin)
      values (%1$L, %2$L, 'essai_s_dec.csv', 200, 250, 50, 0, true, '2025-12-01', '2025-12-31');$q$, d, s);
  report := format($q$select set_config('jd.validation_exercice', %1$L, true);
    insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values
      (%1$L, '2026-01-01', '512000', 'Banque', 'debit', {OUVERTURE}, 'Exercice 2025 validé', repeat('a', 64)),
      (%1$L, '2026-01-01', '101000', 'Capital individuel', 'credit', {OUVERTURE}, 'Exercice 2025 validé', repeat('a', 64));
    select set_config('jd.validation_exercice', '', true);$q$, d);
  valide := format($q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes,
      nb_ecritures, total_debit, total_credit, empreinte, declaration)
      values (%L, {ANNEE}, now(), %L, 'tresorerie', 0, 0, 0, 0, repeat('b', 64), '{}'::jsonb);$q$, d, chef);
  jeu_base := dossier || comptes || releve_p || releve_s || replace(report, '{OUVERTURE}', '1250')
    || replace(valide, '{ANNEE}', '2025');
  bonne := jsonb_build_array(
    jsonb_build_object('compte_bancaire_id', s, 'compte', '512200', 'sens', 'debit', 'montant', 250, 'libelle', 'Ouverture du 512200 au relevé du 31/12/2025'),
    jsonb_build_object('compte_bancaire_id', s, 'compte', '512000', 'sens', 'credit', 'montant', 250, 'libelle', 'Ouverture du 512200 au relevé du 31/12/2025'));

  etapes := jsonb_build_array(
    jsonb_build_object('n', '10. l''éclatement attendu : le solde du second compte au 31/12/2025 passe au 512200, face au 512000',
      'jeu', jeu_base, 'sql', 'select 1', 'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || centimes || ':' || libelle, ' | ' order by compte desc)
                         from public.ouverture_eclatee_attendue(%L, 2026)$q$, d),
      'egal', '512200:debit:25000:Ouverture du 512200 au relevé du 31/12/2025 | 512000:credit:25000:Ouverture du 512200 au relevé du 31/12/2025'),
    jsonb_build_object('n', '11. le chef écrit l''éclatement composé : deux lignes au 01/01/2026, citant le second compte',
      'jeu', jeu_base, 'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d, bonne), 'attendu', 'fait',
      'verif', format($q$select string_agg(to_char(date, 'YYYY-MM-DD') || ':' || compte || ':' || sens || ':' || round(montant, 2) || ':' || statut
                                           || ':' || (ouverture_compte_bancaire_id = %L), ',' order by compte desc)
                         from ecritures_brouillon where dossier_id = %L$q$, s, d),
      'egal', '2026-01-01:512200:debit:250.00:proposee:true,2026-01-01:512000:credit:250.00:proposee:true'),
    jsonb_build_object('n', '12. le réécrire le remplace : toujours deux lignes',
      'jeu', jeu_base, 'sql', format('select ecrire_ouverture_eclatee(%1$L, 2026, %2$L); select ecrire_ouverture_eclatee(%1$L, 2026, %2$L)', d, bonne),
      'attendu', 'fait', 'verif', format('select count(*)::text from ecritures_brouillon where dossier_id = %L', d), 'egal', '2'),
    jsonb_build_object('n', '13. un centime de moins : refusé',
      'jeu', jeu_base, 'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d,
        jsonb_set(jsonb_set(bonne, '{0,montant}', '249.99'), '{1,montant}', '249.99')),
      'attendu', '22023|L''éclatement proposé n''est pas celui que les relevés du 31/12/2025 commandent : le recomposer.'),
    jsonb_build_object('n', '14. une ligne seule : refusé',
      'jeu', jeu_base, 'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d, jsonb_build_array(bonne -> 0)),
      'attendu', '22023|L''éclatement proposé n''est pas celui que les relevés du 31/12/2025 commandent : le recomposer.'),
    jsonb_build_object('n', '15. rien, quand l''ouverture s''éclate : refusé',
      'jeu', jeu_base, 'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d, '[]'::jsonb),
      'attendu', '22023|L''éclatement proposé n''est pas celui que les relevés du 31/12/2025 commandent : le recomposer.'),
    jsonb_build_object('n', '16. une ligne sans son libellé : incomplète',
      'jeu', jeu_base, 'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d, jsonb_build_array((bonne -> 0) - 'libelle', bonne -> 1)),
      'attendu', '22023|L''éclatement proposé est incomplet.'),
    jsonb_build_object('n', '17. le relevé du second compte manque : refusé, le compte nommé',
      'jeu', dossier || comptes || releve_p || replace(report, '{OUVERTURE}', '1250') || replace(valide, '{ANNEE}', '2025'),
      'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d, bonne),
      'attendu', '23514|Le solde au 31/12/2025 du compte bancaire « ESSAI MCB5G SECOND » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d''éclater l''ouverture de la banque.'),
    jsonb_build_object('n', '18. deux relevés du second compte au 31/12/2025 qui se contredisent : refusé',
      'jeu', jeu_base || format($q$insert into controles_releves_bancaires (dossier_id, compte_bancaire_id, source_fichier, solde_initial,
          solde_final, somme_mouvements, ecart, coherent, periode_debut, periode_fin)
          values (%L, %L, 'essai_s_annuel.csv', 0, 260, 260, 0, true, '2025-01-01', '2025-12-31');$q$, d, s),
      'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d, bonne),
      'attendu', '23514|Les relevés du compte bancaire « ESSAI MCB5G SECOND » disent des soldes différents au 31/12/2025 : l''un d''eux ne dit pas le bon, et l''ouverture de la banque ne s''éclate pas.'),
    jsonb_build_object('n', '19. les relevés ne font pas l''ouverture du 512000 : refusé, les deux montants dits',
      'jeu', dossier || comptes || releve_p || releve_s || replace(report, '{OUVERTURE}', '1300') || replace(valide, '{ANNEE}', '2025'),
      'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d, bonne),
      'attendu', '23514|Les soldes des relevés au 31/12/2025 (1250,00 €) ne font pas l''ouverture du compte 512000 (1300,00 €) : l''ouverture de la banque ne s''éclate pas entre ses comptes.'),
    jsonb_build_object('n', '20. le relevé du principal manque : refusé, le principal nommé',
      'jeu', dossier || comptes || releve_s || replace(report, '{OUVERTURE}', '1250') || replace(valide, '{ANNEE}', '2025'),
      'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d, bonne),
      'attendu', '23514|Le solde au 31/12/2025 du compte bancaire « Compte principal » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d''éclater l''ouverture de la banque.'),
    jsonb_build_object('n', '21. un relevé qui couvre le 31/12 : son solde initial et ses mouvements jusqu''à ce jour',
      'jeu', dossier || comptes || releve_p || format($q$insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant, source_fichier)
          values (%1$L, %2$L, '2025-12-20', 'ESSAI', 40, 'essai_s_cov.csv'), (%1$L, %2$L, '2026-01-05', 'ESSAI', 30, 'essai_s_cov.csv');
        insert into controles_releves_bancaires (dossier_id, compte_bancaire_id, source_fichier, solde_initial, solde_final,
          somme_mouvements, ecart, coherent, periode_debut, periode_fin)
          values (%1$L, %2$L, 'essai_s_cov.csv', 210, 280, 70, 0, true, '2025-12-15', '2026-01-15');$q$, d, s)
        || replace(report, '{OUVERTURE}', '1250') || replace(valide, '{ANNEE}', '2025'),
      'sql', 'select 1', 'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || centimes, ',' order by compte desc)
                         from public.ouverture_eclatee_attendue(%L, 2026)$q$, d),
      'egal', '512200:debit:25000,512000:credit:25000'),
    jsonb_build_object('n', '22. le relevé de janvier : son solde initial',
      'jeu', dossier || comptes || releve_p || format($q$insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant, source_fichier)
          values (%1$L, %2$L, '2026-01-10', 'ESSAI', 50, 'essai_s_jan.csv');
        insert into controles_releves_bancaires (dossier_id, compte_bancaire_id, source_fichier, solde_initial, solde_final,
          somme_mouvements, ecart, coherent, periode_debut, periode_fin)
          values (%1$L, %2$L, 'essai_s_jan.csv', 250, 300, 50, 0, true, '2026-01-01', '2026-01-31');$q$, d, s)
        || replace(report, '{OUVERTURE}', '1250') || replace(valide, '{ANNEE}', '2025'),
      'sql', 'select 1', 'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || centimes, ',' order by compte desc)
                         from public.ouverture_eclatee_attendue(%L, 2026)$q$, d),
      'egal', '512200:debit:25000,512000:credit:25000'),
    jsonb_build_object('n', '23. un second compte à découvert : son 512200 s''ouvre au crédit',
      'jeu', dossier || comptes || releve_p || format($q$insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant, source_fichier)
          values (%1$L, %2$L, '2025-12-10', 'ESSAI', -50, 'essai_s_dec.csv');
        insert into controles_releves_bancaires (dossier_id, compte_bancaire_id, source_fichier, solde_initial, solde_final,
          somme_mouvements, ecart, coherent, periode_debut, periode_fin)
          values (%1$L, %2$L, 'essai_s_dec.csv', 20, -30, -50, 0, true, '2025-12-01', '2025-12-31');$q$, d, s)
        || replace(report, '{OUVERTURE}', '970') || replace(valide, '{ANNEE}', '2025'),
      'sql', 'select 1', 'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || centimes, ',' order by compte desc)
                         from public.ouverture_eclatee_attendue(%L, 2026)$q$, d),
      'egal', '512200:credit:3000,512000:debit:3000'),
    jsonb_build_object('n', '24. le second compte clos en 2025 : zéro, rien à écrire, même sans relevé du principal',
      'jeu', dossier || replace(replace(comptes, '{CLOS}', '''2025-11-30'''), '{OUVERT}', '2024-06-01')
        || replace(report, '{OUVERTURE}', '1250') || replace(valide, '{ANNEE}', '2025'),
      'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d, '[]'::jsonb), 'attendu', 'fait',
      'verif', format('select count(*)::text from public.ouverture_eclatee_attendue(%L, 2026)', d), 'egal', '0'),
    jsonb_build_object('n', '25. le second compte ouvert en 2026 : il n''existait pas la veille, rien à éclater',
      'jeu', dossier || replace(replace(comptes, '{CLOS}', 'null'), '{OUVERT}', '2026-02-01') || releve_p
        || replace(report, '{OUVERTURE}', '1000') || replace(valide, '{ANNEE}', '2025'),
      'sql', 'select 1', 'attendu', 'fait',
      'verif', format('select count(*)::text from public.ouverture_eclatee_attendue(%L, 2026)', d), 'egal', '0'),
    jsonb_build_object('n', '26. un dossier à un seul compte : rien à éclater, et rien ne s''écrit',
      'jeu', dossier || format($q$insert into comptes_bancaires (id, dossier_id, libelle, principal) values (%L, %L, 'Compte principal', true);$q$, p, d)
        || releve_p || replace(report, '{OUVERTURE}', '1000') || replace(valide, '{ANNEE}', '2025'),
      'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d, '[]'::jsonb), 'attendu', 'fait',
      'verif', format('select (select count(*) from public.ouverture_eclatee_attendue(%1$L, 2026)) || '':'' || (select count(*) from ecritures_brouillon where dossier_id = %1$L)', d),
      'egal', '0:0'),
    jsonb_build_object('n', '27. la balance reprise au 01/01/2026 s''éclate de même',
      'jeu', dossier || comptes || releve_p || releve_s || format($q$insert into a_nouveaux (dossier_id, date, compte, compte_origine, libelle,
          sens, montant, source_nom, source_empreinte) values
          (%1$L, '2026-01-01', '512000', '512000', 'Banque', 'debit', 1250, 'balance.csv', repeat('c', 64)),
          (%1$L, '2026-01-01', '101000', '101000', 'Capital', 'credit', 1250, 'balance.csv', repeat('c', 64));$q$, d),
      'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d, bonne), 'attendu', 'fait',
      'verif', format('select count(*)::text from ecritures_brouillon where dossier_id = %L and ouverture_compte_bancaire_id is not null', d),
      'egal', '2'),
    jsonb_build_object('n', '28. 2025 a une activité et n''est pas validé : l''ouverture est attendue',
      'jeu', dossier || comptes || releve_p || releve_s,
      'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d, bonne),
      'attendu', '23514|L''exercice 2026 n''a pas encore d''ouverture : elle s''écrira à la validation de l''exercice 2025, et l''ouverture de la banque s''éclatera ensuite entre ses comptes.'),
    jsonb_build_object('n', '29. le premier exercice, sans reprise ni activité d''avant : rien à éclater',
      'jeu', dossier || comptes,
      'sql', 'select 1', 'attendu', 'fait',
      'verif', format('select count(*)::text from public.ouverture_eclatee_attendue(%L, 2026)', d), 'egal', '0'),
    jsonb_build_object('n', '30. une ligne de l''éclatement insérée hors de sa fonction : refusée',
      'jeu', jeu_base, 'sql', format($q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, ouverture_compte_bancaire_id)
          values (%L, '2026-01-01', '512200', 'ESSAI', 250, 'debit', %L)$q$, d, s),
      'attendu', '42501|L''écriture qui éclate l''ouverture de la banque ne s''écrit que par sa fonction.'),
    jsonb_build_object('n', '31. une ligne de l''éclatement retirée hors de sa fonction : refusée',
      'jeu', jeu_base || format('select ecrire_ouverture_eclatee(%L, 2026, %L);', d, bonne),
      'sql', format('delete from ecritures_brouillon where dossier_id = %L and compte = ''512200''', d),
      'attendu', '42501|L''écriture qui éclate l''ouverture de la banque ne se retire que par sa recomposition.'),
    jsonb_build_object('n', '32. une ligne de l''éclatement modifiée : refusée',
      'jeu', jeu_base || format('select ecrire_ouverture_eclatee(%L, 2026, %L);', d, bonne),
      'sql', format('update ecritures_brouillon set libelle = ''autre'' where dossier_id = %L and compte = ''512200''', d),
      'attendu', '42501|L''écriture qui éclate l''ouverture de la banque ne se modifie pas : elle se recompose.'),
    jsonb_build_object('n', '33. un compte qui n''est pas du cabinet : refusé avant toute lecture',
      'jeu', jeu_base, 'qui', inconnu, 'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d, bonne),
      'attendu', '42501|Accès refusé à ce dossier.'),
    jsonb_build_object('n', '34. l''exercice 2026 validé : son ouverture ne change plus',
      'jeu', jeu_base || format('select ecrire_ouverture_eclatee(%L, 2026, %L);', d, bonne) || replace(valide, '{ANNEE}', '2026'),
      'sql', format('select ecrire_ouverture_eclatee(%L, 2026, %L)', d, bonne),
      'attendu', '23514|L''exercice 2026 est validé : son ouverture ne change plus.')
  );


  -- ══ 40 à 51. Le filet de la validation (MCB5G-Q2) ══
  -- Une étape « role » postgres insère la ligne de l'exercice sous le propriétaire, comme `valider_exercice` en definer ; les
  -- autres sous le rôle de l'API. `marque` écrit des lignes de la source hors de sa fonction (le réglage de la garde) : un
  -- éclatement faux ou superflu, que seul un chemin hors de l'application laisserait au brouillon.
  if to_regprocedure('public.garder_ouverture_eclatee_a_la_validation()') is null then
    verdicts := verdicts || jsonb_build_object('controle', '40. EN ATTENTE de la migration ouverture_eclatee_a_la_validation',
      'ok', true, 'observe', 'absente : le filet se joue dès qu''elle est en base');
  else
    verdicts := verdicts || jsonb_build_object('controle', '40. le filet : avant l''insertion, par ligne, aux droits de l''appelant, search_path posé, sans droit d''exécution ; valider_exercice reste definer',
      'observe', (select string_agg(t.tgname || ':' || t.tgtype || ':' || t.tgenabled::text, ',') from pg_trigger t
                   where t.tgrelid = 'public.exercices_valides'::regclass and not t.tgisinternal)
        || ' ; ' || (select case when prosecdef then 'definer' else 'invoker' end from pg_proc
                      where oid = 'public.garder_ouverture_eclatee_a_la_validation()'::regprocedure),
      'ok', exists (select 1 from pg_trigger t where t.tgrelid = 'public.exercices_valides'::regclass
                     and t.tgname = 'exercices_valides_ouverture_eclatee' and t.tgtype = 7 and t.tgenabled = 'O'
                     and t.tgfoid = 'public.garder_ouverture_eclatee_a_la_validation()'::regprocedure)
        and exists (select 1 from pg_proc where oid = 'public.garder_ouverture_eclatee_a_la_validation()'::regprocedure
                     and not prosecdef and proconfig @> array['search_path=public'])
        and not has_function_privilege('authenticated', 'public.garder_ouverture_eclatee_a_la_validation()', 'execute')
        and not has_function_privilege('anon', 'public.garder_ouverture_eclatee_a_la_validation()', 'execute')
        and exists (select 1 from pg_proc where oid = 'public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure
                     and prosecdef));
    marque := format($q$select set_config('jd.ouverture_eclatee', %1$L, true);
      insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, ouverture_compte_bancaire_id) values
        (%1$L, '2026-01-01', '512200', 'Ouverture du 512200 au relevé du 31/12/2025', {MONTANT}, 'debit', 'proposee', %2$L),
        (%1$L, '2026-01-01', '512000', 'Ouverture du 512200 au relevé du 31/12/2025', {MONTANT}, 'credit', 'proposee', %2$L);
      select set_config('jd.ouverture_eclatee', '', true);$q$, d, s);
    -- Un an plus tôt, pour `valider_exercice` (un exercice clos) : le second compte tient son 512200 depuis le 01/01/2025,
    -- ses relevés au 31/12/2024, 2024 validé, ses soldes reportés au 01/01/2025 sous des identifiants fixes.
    vingt_cinq := dossier || format($q$insert into comptes_bancaires (id, dossier_id, libelle, principal) values (%2$L, %1$L, 'Compte principal', true);
      insert into comptes_bancaires (id, dossier_id, libelle, compte, compte_propre_depuis, ouvert_le)
        values (%3$L, %1$L, 'ESSAI MCB5G SECOND', '512200', '2025-01-01', '2024-06-01');
      insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant, source_fichier, statut) values
        (%1$L, %2$L, '2024-12-15', 'ESSAI', 100, 'essai_p_dec24.csv', 'ignoree'),
        (%1$L, %3$L, '2024-12-10', 'ESSAI', 50, 'essai_s_dec24.csv', 'ignoree');
      insert into controles_releves_bancaires (dossier_id, compte_bancaire_id, source_fichier, solde_initial, solde_final,
        somme_mouvements, ecart, coherent, periode_debut, periode_fin) values
        (%1$L, %2$L, 'essai_p_dec24.csv', 900, 1000, 100, 0, true, '2024-12-01', '2024-12-31'),
        (%1$L, %3$L, 'essai_s_dec24.csv', 200, 250, 50, 0, true, '2024-12-01', '2024-12-31');
      select set_config('jd.validation_exercice', %1$L, true);
      insert into soldes_reportes (id, dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values
        ('cb5a0000-0000-4000-8000-0000000000e1', %1$L, '2025-01-01', '512000', 'Banque', 'debit', 1250, 'Exercice 2024 validé', repeat('a', 64)),
        ('cb5a0000-0000-4000-8000-0000000000e2', %1$L, '2025-01-01', '101000', 'Capital individuel', 'credit', 1250, 'Exercice 2024 validé', repeat('a', 64));
      select set_config('jd.validation_exercice', '', true);$q$, d, p, s) || replace(valide, '{ANNEE}', '2024');
    libelles_an := '[{"id":"cb5a0000-0000-4000-8000-0000000000e1","compte_lib":"Banque","ecriture_lib":"À-nouveaux"},'
      || '{"id":"cb5a0000-0000-4000-8000-0000000000e2","compte_lib":"Capital individuel","ecriture_lib":"À-nouveaux"}]';
    numerotation := format($q$(select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'journal', 'OD', 'numero', 1,
        'piece_ref', 'Relevés au 31/12/2024', 'piece_date', '2024-12-31',
        'compte_lib', case e.compte when '512000' then 'Banque' else 'Banque ESSAI MCB5G' end)), '[]'::jsonb)
        from ecritures_brouillon e where e.dossier_id = %L)$q$, d);
    etapes_filet := jsonb_build_array(
      jsonb_build_object('n', '41. sans l''écriture qui éclate son ouverture, l''exercice 2026 ne se valide pas : « n’est pas écrite »',
        'jeu', jeu_base, 'role', 'postgres', 'sql', replace(valide, '{ANNEE}', '2026'),
        'attendu', '23514|L’ouverture du 01/01/2026 porte au compte de banque du rôle l’argent de tous les comptes bancaires : l’écriture qui passe le solde de chaque compte à son 512, d’après ses relevés du 31/12/2025, n’est pas écrite.'),
      jsonb_build_object('n', '42. l''éclatement écrit et à jour : l''exercice 2026 se valide',
        'jeu', jeu_base || format('select ecrire_ouverture_eclatee(%L, 2026, %L);', d, bonne), 'role', 'postgres',
        'sql', replace(valide, '{ANNEE}', '2026'), 'attendu', 'fait',
        'verif', format('select count(*)::text from exercices_valides where dossier_id = %L and annee = 2026', d), 'egal', '1'),
      jsonb_build_object('n', '43. l''éclatement du 01/01/2026, validé avec 2026, ne retient pas 2027 : seul compte le 1er janvier de l''exercice',
        'jeu', jeu_base || format('select ecrire_ouverture_eclatee(%L, 2026, %L);', d, bonne) || replace(valide, '{ANNEE}', '2026'),
        'role', 'postgres', 'sql', replace(valide, '{ANNEE}', '2027'), 'attendu', 'fait',
        'verif', format('select count(*)::text from exercices_valides where dossier_id = %L and annee = 2027', d), 'egal', '1'),
      jsonb_build_object('n', '44. un éclatement que les relevés ne commandent plus (200 au lieu de 250) : « la réécrire »',
        'jeu', jeu_base || replace(marque, '{MONTANT}', '200'), 'role', 'postgres', 'sql', replace(valide, '{ANNEE}', '2026'),
        'attendu', '23514|L’écriture qui éclate l’ouverture de la banque au 01/01/2026 n’est plus celle que les relevés du 31/12/2025 commandent : la réécrire.'),
      jsonb_build_object('n', '45. l''éclatement juste, écrit deux fois (quatre lignes) : « la réécrire »',
        'jeu', jeu_base || format('select ecrire_ouverture_eclatee(%L, 2026, %L);', d, bonne) || replace(marque, '{MONTANT}', '250'),
        'role', 'postgres', 'sql', replace(valide, '{ANNEE}', '2026'),
        'attendu', '23514|L’écriture qui éclate l’ouverture de la banque au 01/01/2026 n’est plus celle que les relevés du 31/12/2025 commandent : la réécrire.'),
      jsonb_build_object('n', '46. un éclatement alors que le second compte est clos en 2025 : « la retirer »',
        'jeu', dossier || replace(replace(comptes, '{CLOS}', '''2025-11-30'''), '{OUVERT}', '2024-06-01')
          || replace(report, '{OUVERTURE}', '1250') || replace(valide, '{ANNEE}', '2025') || replace(marque, '{MONTANT}', '250'),
        'role', 'postgres', 'sql', replace(valide, '{ANNEE}', '2026'),
        'attendu', '23514|Une écriture éclate l’ouverture de la banque au 01/01/2026, alors que plus rien n’est à éclater : la retirer.'),
      jsonb_build_object('n', '47. le relevé du second compte manque : la validation retenue, aux mots de la recomposition',
        'jeu', dossier || comptes || releve_p || replace(report, '{OUVERTURE}', '1250') || replace(valide, '{ANNEE}', '2025'),
        'role', 'postgres', 'sql', replace(valide, '{ANNEE}', '2026'),
        'attendu', '23514|Le solde au 31/12/2025 du compte bancaire « ESSAI MCB5G SECOND » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d''éclater l''ouverture de la banque.'),
      jsonb_build_object('n', '48. un dossier à un seul compte : rien à éclater, l''exercice 2026 se valide comme hier',
        'jeu', dossier || format($q$insert into comptes_bancaires (id, dossier_id, libelle, principal) values (%L, %L, 'Compte principal', true);$q$, p, d)
          || releve_p || replace(report, '{OUVERTURE}', '1000') || replace(valide, '{ANNEE}', '2025'),
        'role', 'postgres', 'sql', replace(valide, '{ANNEE}', '2026'), 'attendu', 'fait',
        'verif', format('select count(*)::text from exercices_valides where dossier_id = %L and annee = 2026', d), 'egal', '1'),
      jsonb_build_object('n', '49. la restauration (le super-administrateur, sous le rôle de l''API) ne se rejuge pas : 2026 réinséré sans l''éclatement',
        'jeu', jeu_base, 'sql', replace(valide, '{ANNEE}', '2026'), 'attendu', 'fait',
        'verif', format('select count(*)::text from exercices_valides where dossier_id = %L and annee = 2026', d), 'egal', '1'),
      jsonb_build_object('n', '50. de bout en bout : valider_exercice refuse 2025 sans l''éclatement de son 1er janvier',
        'jeu', vingt_cinq,
        'sql', format('select valider_exercice(%L, 2025, ''[]''::jsonb, %L::jsonb, ''{}''::jsonb)', d, libelles_an),
        'attendu', '23514|L’ouverture du 01/01/2025 porte au compte de banque du rôle l’argent de tous les comptes bancaires : l’écriture qui passe le solde de chaque compte à son 512, d’après ses relevés du 31/12/2024, n’est pas écrite.'),
      jsonb_build_object('n', '51. de bout en bout : l''éclatement écrit, valider_exercice valide 2025 et le numérote au journal OD',
        'jeu', vingt_cinq || format('select ecrire_ouverture_eclatee(%L, 2025, %L);', d,
          jsonb_set(jsonb_set(bonne, '{0,libelle}', '"Ouverture du 512200 au relevé du 31/12/2024"'), '{1,libelle}', '"Ouverture du 512200 au relevé du 31/12/2024"')),
        'sql', format('select valider_exercice(%L, 2025, %s, %L::jsonb, ''{}''::jsonb)', d, numerotation, libelles_an),
        'attendu', 'fait',
        'verif', format($q$select (select count(*) from exercices_valides where dossier_id = %1$L and annee = 2025) || ':'
                           || (select string_agg(compte || '/' || statut || '/' || journal_code || numero_ecriture, ',' order by compte desc)
                                 from ecritures_brouillon where dossier_id = %1$L)$q$, d),
        'egal', '1:512200/validee/OD1,512000/validee/OD1')
    );
  end if;

  for e in select * from jsonb_array_elements(etapes || etapes_filet) loop
    accepte := false; code_recu := null; message := null; obs := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      execute replace(replace(e->>'jeu', '{CLOS}', 'null'), '{OUVERT}', '2024-06-01');
      if coalesce(e->>'role', 'authenticated') = 'authenticated' then
        set local role authenticated;
      end if;
      perform set_config('request.jwt.claims', json_build_object('sub', coalesce(e->>'qui', chef), 'role', 'authenticated')::text, true);
      execute e->>'sql';
      accepte := true;
      reset role;
      if e ? 'verif' then execute e->>'verif' into obs; end if;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    if e->>'attendu' = 'fait' then
      ok := accepte and code_recu = 'P0001' and obs is not distinct from e->>'egal';
      observe := coalesce(obs, '?') || case when code_recu = 'P0001' then '' else ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message, '') end;
    else
      ok := not accepte and code_recu || '|' || message = e->>'attendu';
      observe := coalesce(code_recu, 'ACCEPTÉ') || ' ' || coalesce(message, '');
    end if;
    verdicts := verdicts || jsonb_build_object('controle', e->>'n', 'observe', observe, 'ok', coalesce(ok, false));
  end loop;

  -- ══ 99. Rien n'est resté ══
  select concat_ws('/', (select count(*) from dossiers), (select count(*) from comptes_bancaires),
      (select count(*) from lignes_bancaires), (select count(*) from controles_releves_bancaires),
      (select count(*) from ecritures_brouillon), (select count(*) from soldes_reportes), (select count(*) from exercices_valides))
    into apres;
  verdicts := verdicts || jsonb_build_object('controle', '99. rien n''est resté en base',
    'observe', 'écarts ' || (select string_agg(to_char(x.b::bigint - x.a::bigint, 'FMSG9999999990'), '/' order by x.r)
                             from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality x(a, b, r)),
    'ok', avant = apres);
  perform set_config('essai.ouverture_eclatee', verdicts::text, true);
end $$;

select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.ouverture_eclatee')::jsonb) as v(controle text, ok boolean, observe text)
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
