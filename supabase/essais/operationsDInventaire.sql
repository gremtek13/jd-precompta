-- ESSAI DES OPÉRATIONS D'INVENTAIRE (ligne 35, INV2 ; migration `operations_d_inventaire`, PRÉPARÉE le 12/11/2026).
-- SUR UNE RÉPLIQUE SEULEMENT : il crée des dossiers, des pièces, des à-nouveaux et un exercice validé fictifs, et retire ce
-- qu'il a écrit. Joué ENTIER, en une transaction qui s'annule (`begin` … `rollback`), par psql, sans `-1` :
--   psql -v ON_ERROR_STOP=1 -f supabase/essais/operationsDInventaire.sql
-- Ce qu'il juge, par impersonation (le chef, qui est aussi super-administrateur dans le semis ; un membre de l'équipe assigné ;
-- le même membre sur un dossier qui ne lui est pas assigné ; un client qui a un accès au dossier ; l'anonyme) :
--   IV-A. l'accès : le chef et le membre assigné écrivent, le membre non assigné, le client et l'anonyme non ;
--   IV-B. chaque refus de `enregistrer_operation_inventaire`, sous son code et ses MOTS (ceux de src/lib/inventaire.ts), dans
--         l'ordre du module, puis ceux que la base seule dit ;
--   IV-C. la recomposition : la constatation et l'extourne écrites, au centime, à leurs dates et sous leur libellé ; une ligne de
--         trop, un centime de moins, un libellé recopié, une extourne absente refusés ; le remplacement contre la version lue ;
--   IV-D. le retrait, et le gel : un exercice validé ou figé par la validation suivante ne reçoit, ne change ni ne perd rien ;
--   IV-E. les gardes : aucune écriture directe, ni de la régularisation ni de ses lignes, sauf la réinsertion du
--         super-administrateur ; une ligne d'inventaire ne cite aucune autre source.
-- Puis des MUTATIONS de la migration, chacune dans une sous-transaction annulée, qui doivent faire virer un contrôle au rouge.
-- Se lit : toute ligne « en faute » est une faute de la migration ; toute mutation qui « NE MORD PAS » est un contrôle qui ne
-- prouve plus rien.

begin;

create temp table iv_verdict (rang serial, controle text, observe text, ok boolean);
create temp table iv_mutation (rang serial, mutation text, observe text, mord boolean);

-- Tente un appel SOUS une identité, et l'annule : rend « OK <résultat> » ou « <sqlstate> <message> ».
create function pg_temp.tente(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare
  v_resultat text;
  v_issue text;
begin
  begin
    if p_uid is null then
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    else
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    end if;
    execute p_sql into v_resultat;
    v_issue := 'OK ' || coalesce(v_resultat, '');
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then v_issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_issue;
end $$;

-- Le même, qui GARDE ce qu'il a écrit quand l'appel passe.
create function pg_temp.fait(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare
  v_resultat text;
  v_issue text;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    execute p_sql into v_resultat;
    v_issue := 'OK ' || coalesce(v_resultat, '');
  exception when others then
    v_issue := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_issue;
end $$;

-- Les deux écritures que compose le module (`composerRegularisation`) : `lignes` est la constatation, [compte, sens, centimes].
create function pg_temp.ecritures(p_exercice integer, p_libelle text, p_lignes jsonb) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('date', p_exercice || '-12-31', 'journal', 'OD', 'libelle', p_libelle,
      'lignes', (select jsonb_agg(jsonb_build_object('compte', l ->> 0, 'sens', l ->> 1, 'centimes', (l ->> 2)::bigint) order by r)
                   from jsonb_array_elements(p_lignes) with ordinality x(l, r))),
    jsonb_build_object('date', (p_exercice + 1) || '-01-01', 'journal', 'OD', 'libelle', 'Extourne — ' || p_libelle,
      'lignes', (select jsonb_agg(jsonb_build_object('compte', l ->> 0, 'sens', case l ->> 1 when 'debit' then 'credit' else 'debit' end,
                                                     'centimes', (l ->> 2)::bigint) order by r)
                   from jsonb_array_elements(p_lignes) with ordinality x(l, r))))
$$;

-- L'appel de la fonction, en texte, pour `tente` et `fait`.
create function pg_temp.appel(p_dossier uuid, p_operation jsonb, p_ecritures jsonb, p_version integer) returns text language sql as $$
  select format('select public.enregistrer_operation_inventaire(%L::uuid, %L::jsonb, %L::jsonb, %s)::text',
                p_dossier, p_operation, p_ecritures, coalesce(p_version::text, 'null'))
$$;

create function pg_temp.verdict(p_controle text, p_observe text, p_ok boolean) returns void language sql as $$
  insert into iv_verdict (controle, observe, ok) values (p_controle, p_observe, coalesce(p_ok, false))
$$;

do $essai$
declare
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre uuid := '3e3b0000-0000-4000-8000-000000000001';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  cabinet uuid := 'cab10000-0000-4000-8000-000000000001';
  da uuid := 'a1100000-0000-4000-8000-0000000000a1';   -- engagement, redevable, assigné au membre, ouvert au client
  dn uuid := 'a1100000-0000-4000-8000-0000000000a2';   -- engagement, en franchise, assigné
  dt uuid := 'a1100000-0000-4000-8000-0000000000a3';   -- trésorerie, assigné
  db uuid := 'a1100000-0000-4000-8000-0000000000a4';   -- engagement, NON assigné au membre
  dov uuid := 'a1100000-0000-4000-8000-0000000000a5';  -- engagement, ouvert le 1er janvier 2025 (ses à-nouveaux)
  dv uuid := 'a1100000-0000-4000-8000-0000000000a6';   -- engagement, 2024 validé ensuite
  pa uuid := 'a1100000-0000-4000-8000-0000000000b1';
  pb uuid := 'a1100000-0000-4000-8000-0000000000b2';
  -- Les mots du module (src/lib/inventaire.ts, MOTS_DES_REFUS), au caractère près.
  m_tresorerie text := 'L’inventaire ne s’écrit qu’en comptabilité d’engagement : un dossier en trésorerie (BNC, 2035) n’en reçoit aucun.';
  m_exercice text := 'L’exercice de la régularisation est illisible : une année entre 2000 et 2100.';
  m_fige text := 'Cet exercice est validé : ses écritures d’inventaire ne changent plus.';
  m_a_venir text := 'Cet exercice n’est pas encore commencé : son inventaire ne se passe pas avant lui.';
  m_ouverture text := 'Cet exercice précède l’ouverture du dossier dans l’application : son inventaire n’y a pas de place.';
  m_provision text := 'Une provision s’écrit par son évaluation au 31 décembre, pas comme une régularisation.';
  m_nature text := 'La nature de la régularisation est inconnue : une charge ou un produit constaté d’avance, une facture non parvenue ou à établir, une charge à payer ou un produit à recevoir.';
  m_charge text := 'Le compte de charge est un compte de la classe 6 du plan du dossier.';
  m_produit text := 'Le compte de produit est un compte de la classe 7 du plan du dossier.';
  m_cca text := 'Une charge constatée d’avance s’écrit au compte des charges constatées d’avance du plan du dossier.';
  m_fnp text := 'Une facture non parvenue s’écrit au compte des factures non parvenues du plan du dossier, ou sous le 4088 pour des intérêts courus.';
  m_cap text := 'Une charge à payer s’écrit sous le 4282, le 4286, le 4382, le 4386, le 44812, le 1688 ou le 518 ; jamais au 467 ni au 468, qui portent le compte du dirigeant.';
  m_par text := 'Un produit à recevoir s’écrit sous le 4482 ou le 439 ; jamais au 467 ni au 468, qui portent le compte du dirigeant.';
  m_montant text := 'Le montant est un nombre de centimes entier et positif.';
  m_tva text := 'La TVA est un nombre de centimes entier, positif ou nul.';
  m_tva_hors text := 'Seules une facture non parvenue et une facture à établir portent une TVA d’attente.';
  m_tva_non text := 'Un dossier qui ne collecte pas la TVA écrit la régularisation toutes taxes comprises, sans ligne de TVA.';
  m_objet text := 'L’objet de la régularisation tient en 1 à 200 caractères, sur une ligne : il part au FEC.';
  m_periode text := 'La période couverte se lit en deux dates civiles, son début au plus tard à sa fin.';
  m_piece text := 'La pièce citée n’est pas une pièce de ce dossier.';
  m_version text := 'Cette régularisation a changé depuis sa lecture : relire l’inventaire avant de l’écrire.';
  m_nouvelle text := 'Une régularisation nouvelle ne porte pas de version lue.';
  m_ecritures text := 'Les écritures proposées ne sont pas celles de la régularisation : les recomposer.';
  m_garde text := 'Une écriture d’inventaire ne change que par sa régularisation.';
  -- Une CCA de 2025 : l'assurance de 2026 payée d'avance.
  lib_cca text := 'CCA 31/12/2025 — Primes d''assurance — Assurance du local, 2026';
  op_cca jsonb := '{"exercice": 2025, "nature": "cca", "compte_resultat": "616000", "compte_regularisation": "486000", "montant_centimes": 120000, "tva_centimes": 0, "objet": "Assurance du local, 2026", "periode_debut": "2025-07-01", "periode_fin": "2026-06-30"}';
  ec_cca jsonb;
  -- Une FNP TTC d'un dossier redevable : la charge et la TVA d'attente au débit, le 408 au crédit.
  lib_fnp text := 'FNP 31/12/2025 — Honoraires de décembre';
  op_fnp jsonb := '{"exercice": 2025, "nature": "fnp", "compte_resultat": "622600", "compte_regularisation": "408100", "montant_centimes": 50000, "tva_centimes": 10000, "objet": "Honoraires de décembre"}';
  ec_fnp jsonb;
  issue text;
  id_cca uuid;
  id_fnp uuid;
  id_v uuid;
  n bigint;
  texte text;
begin
  ec_cca := pg_temp.ecritures(2025, lib_cca, '[["486000","debit",120000],["616000","credit",120000]]');
  ec_fnp := pg_temp.ecritures(2025, lib_fnp, '[["622600","debit",50000],["445860","debit",10000],["408100","credit",60000]]');

  -- ── Le jeu, écrit par le propriétaire ──
  insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva) values
    (da, 'INV2 essai A', cabinet, 'engagement', 'redevable'), (dn, 'INV2 essai N', cabinet, 'engagement', 'franchise'),
    (dt, 'INV2 essai T', cabinet, 'tresorerie', 'franchise'), (db, 'INV2 essai B', cabinet, 'engagement', 'redevable'),
    (dov, 'INV2 essai O', cabinet, 'engagement', 'redevable'), (dv, 'INV2 essai V', cabinet, 'engagement', 'redevable');
  insert into dossier_assignations (dossier_id, user_id) values (da, membre), (dn, membre), (dt, membre), (dov, membre), (dv, membre);
  insert into memberships (user_id, dossier_id, role)
    select client, da, m.role from memberships m where m.user_id = client limit 1;
  insert into pieces (id, dossier_id, storage_path, nom_fichier) values
    (pa, da, da || '/inv2.pdf', 'inv2.pdf'), (pb, db, db || '/inv2.pdf', 'inv2.pdf');
  insert into a_nouveaux (dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values
    (dov, '2025-01-01', '512000', 'debit', 100, 'essai', repeat('a', 64)),
    (dov, '2025-01-01', '101000', 'credit', 100, 'essai', repeat('a', 64));

  -- ══ IV-A. L'accès ══
  issue := pg_temp.fait(chef, pg_temp.appel(da, op_cca, ec_cca, null));
  id_cca := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('IV-A1. le chef enregistre une CCA (le contrôle positif)', issue, id_cca is not null);
  issue := pg_temp.fait(membre, pg_temp.appel(da, op_fnp, ec_fnp, null));
  id_fnp := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('IV-A2. le membre assigné enregistre une FNP toutes taxes comprises (le contrôle positif)', issue, id_fnp is not null);
  issue := pg_temp.tente(membre, pg_temp.appel(db, op_cca, ec_cca, null));
  perform pg_temp.verdict('IV-A3. le membre, sur un dossier qui ne lui est pas assigné', issue, issue = '42501 Accès refusé à ce dossier.');
  issue := pg_temp.tente(client, pg_temp.appel(da, op_cca, ec_cca, null));
  perform pg_temp.verdict('IV-A4. le client, qui a un accès au dossier', issue, issue = '42501 Accès refusé à ce dossier.');
  issue := pg_temp.tente(null, pg_temp.appel(da, op_cca, ec_cca, null));
  perform pg_temp.verdict('IV-A5. l''anonyme n''exécute pas la fonction', issue, issue like '42501 permission denied for function%');
  issue := pg_temp.tente(client, format('select count(*)::text from operations_inventaire where dossier_id = %L', da));
  perform pg_temp.verdict('IV-A6. le client ne lit aucune régularisation de son dossier ; le membre assigné les lit', issue
    || ' | membre : ' || pg_temp.tente(membre, format('select count(*)::text from operations_inventaire where dossier_id = %L', da)),
    issue = 'OK 0' and pg_temp.tente(membre, format('select count(*)::text from operations_inventaire where dossier_id = %L', da)) = 'OK 2');
  issue := pg_temp.tente(membre, format('select count(*)::text from operations_inventaire where dossier_id = %L', db));
  perform pg_temp.verdict('IV-A7. le membre ne lit rien d''un dossier qui ne lui est pas assigné', issue, issue = 'OK 0');

  -- ══ IV-C. Ce que la base a écrit ══
  select string_agg(to_char(e.date, 'YYYY-MM-DD') || ' ' || e.compte || ' ' || e.sens || ' ' || e.montant || ' ' || e.libelle, ' | '
                    order by e.date, e.sens desc, e.compte)
    into texte from ecritures_brouillon e where e.operation_inventaire_id = id_cca;
  perform pg_temp.verdict('IV-C1. la CCA : 486 au débit, la charge au crédit au 31/12/2025, l''inverse au 01/01/2026, sous leur libellé', texte,
    texte = '2025-12-31 486000 debit 1200.00 ' || lib_cca || ' | 2025-12-31 616000 credit 1200.00 ' || lib_cca
      || ' | 2026-01-01 616000 debit 1200.00 Extourne — ' || lib_cca || ' | 2026-01-01 486000 credit 1200.00 Extourne — ' || lib_cca);
  select string_agg(e.compte || ' ' || e.sens || ' ' || e.montant, ', ' order by e.compte) into texte
    from ecritures_brouillon e where e.operation_inventaire_id = id_fnp and e.date = '2025-12-31';
  perform pg_temp.verdict('IV-C2. la FNP : la charge HT et le 44586 au débit, le 408 TTC au crédit ; six lignes en tout', texte,
    texte = '408100 credit 600.00, 445860 debit 100.00, 622600 debit 500.00'
    and (select count(*) from ecritures_brouillon e where e.operation_inventaire_id = id_fnp) = 6);
  select o.objet || ' | v' || o.version || ' | ' || o.periode_debut || '..' || o.periode_fin || ' | par ' || o.cree_par
    into texte from operations_inventaire o where o.id = id_cca;
  perform pg_temp.verdict('IV-C3. la régularisation garde sa saisie, version 1, son auteur posé par la fonction', texte,
    texte = 'Assurance du local, 2026 | v1 | 2025-07-01..2026-06-30 | par ' || chef);

  -- ══ IV-B. Les refus, sous leur code et leurs mots ══
  issue := pg_temp.tente(membre, pg_temp.appel(dt, op_cca, ec_cca, null));
  perform pg_temp.verdict('IV-B1. un dossier en trésorerie', issue, issue = '22023 ' || m_tresorerie);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"exercice": 1999}', ec_cca, null));
  perform pg_temp.verdict('IV-B2. un exercice illisible (1999)', issue, issue = '22023 ' || m_exercice);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"exercice": "2025"}', ec_cca, null));
  perform pg_temp.verdict('IV-B3. un exercice en texte', issue, issue = '22023 ' || m_exercice);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || jsonb_build_object('exercice', extract(year from now() at time zone 'Europe/Paris')::int + 1), ec_cca, null));
  perform pg_temp.verdict('IV-B4. un exercice pas encore commencé', issue, issue = '22023 ' || m_a_venir);
  issue := pg_temp.tente(membre, pg_temp.appel(dov, op_cca || '{"exercice": 2024}', pg_temp.ecritures(2024, replace(lib_cca, '2025', '2024'), '[["486000","debit",120000],["616000","credit",120000]]'), null));
  perform pg_temp.verdict('IV-B5. un exercice avant l''ouverture du dossier (à-nouveaux du 01/01/2025)', issue, issue = '22023 ' || m_ouverture);
  issue := pg_temp.tente(membre, pg_temp.appel(dov, op_cca, ec_cca, null));
  perform pg_temp.verdict('IV-B6. le premier exercice du dossier repris est admis (la borne)', issue, issue like 'OK %');
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"nature": "provision"}', ec_cca, null));
  perform pg_temp.verdict('IV-B7. une provision n''est pas une régularisation', issue, issue = '22023 ' || m_provision);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"nature": "stock"}', ec_cca, null));
  perform pg_temp.verdict('IV-B8. une nature inconnue', issue, issue = '22023 ' || m_nature);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"compte_resultat": "706000"}', ec_cca, null));
  perform pg_temp.verdict('IV-B9. une CCA sur un compte de produit', issue, issue = '22023 ' || m_charge);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"nature": "pca", "compte_resultat": "616000", "compte_regularisation": "487000"}', ec_cca, null));
  perform pg_temp.verdict('IV-B10. une PCA sur un compte de charge', issue, issue = '22023 ' || m_produit);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"compte_regularisation": "486100"}', ec_cca, null));
  perform pg_temp.verdict('IV-B11. une CCA hors du compte du plan (486100 au lieu de 486000)', issue, issue = '22023 ' || m_cca);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"nature": "charge_a_payer", "compte_regularisation": "467000"}', ec_cca, null));
  perform pg_temp.verdict('IV-B12. une charge à payer au 467', issue, issue = '22023 ' || m_cap);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"nature": "charge_a_payer", "compte_regularisation": "468000"}', ec_cca, null));
  perform pg_temp.verdict('IV-B13. une charge à payer au 468', issue, issue = '22023 ' || m_cap);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"nature": "produit_a_recevoir", "compte_resultat": "706000", "compte_regularisation": "418100"}', ec_cca, null));
  perform pg_temp.verdict('IV-B14. un produit à recevoir au 418 (la FAE a sa nature)', issue, issue = '22023 ' || m_par);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_fnp || '{"compte_regularisation": "408500"}', ec_fnp, null));
  perform pg_temp.verdict('IV-B15. une FNP hors du 408 du plan et du 4088', issue, issue = '22023 ' || m_fnp);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"montant_centimes": 0}', ec_cca, null));
  perform pg_temp.verdict('IV-B16. un montant nul', issue, issue = '22023 ' || m_montant);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"montant_centimes": 1200.5}', ec_cca, null));
  perform pg_temp.verdict('IV-B17. un montant qui n''est pas un nombre entier de centimes', issue, issue = '22023 ' || m_montant);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"montant_centimes": 9007199254740992}', ec_cca, null));
  perform pg_temp.verdict('IV-B18. un montant au-delà de 2^53 - 1', issue, issue = '22023 ' || m_montant);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_fnp || '{"tva_centimes": -1}', ec_fnp, null));
  perform pg_temp.verdict('IV-B19. une TVA négative', issue, issue = '22023 ' || m_tva);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"tva_centimes": 100}', ec_cca, null));
  perform pg_temp.verdict('IV-B20. une TVA sur une CCA', issue, issue = '22023 ' || m_tva_hors);
  issue := pg_temp.tente(membre, pg_temp.appel(dn, op_fnp, ec_fnp, null));
  perform pg_temp.verdict('IV-B21. une TVA d''attente dans un dossier en franchise', issue, issue = '22023 ' || m_tva_non);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_fnp || '{"montant_centimes": 9007199254740000, "tva_centimes": 9000}', ec_fnp, null));
  perform pg_temp.verdict('IV-B22. un montant et une TVA dont la somme passe 2^53 - 1', issue, issue = '22023 ' || m_montant);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"objet": "   "}', ec_cca, null));
  perform pg_temp.verdict('IV-B23. un objet vide une fois rogné', issue, issue = '22023 ' || m_objet);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || jsonb_build_object('objet', repeat('é', 201)), ec_cca, null));
  perform pg_temp.verdict('IV-B24. un objet de 201 caractères', issue, issue = '22023 ' || m_objet);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || jsonb_build_object('objet', 'Assurance' || chr(10) || 'du local'), ec_cca, null));
  perform pg_temp.verdict('IV-B25. un objet sur deux lignes', issue, issue = '22023 ' || m_objet);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || jsonb_build_object('objet', chr(160) || ' Assurance du local, 2026' || chr(10)), ec_cca, null));
  perform pg_temp.verdict('IV-B26. un objet entouré de blancs se rogne comme le module le rogne (le contrôle positif)', issue, issue like 'OK %');
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"periode_debut": "2026-07-01"}', ec_cca, null));
  perform pg_temp.verdict('IV-B27. une période qui finit avant de commencer', issue, issue = '22023 ' || m_periode);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"periode_fin": "2026-02-30"}', ec_cca, null));
  perform pg_temp.verdict('IV-B28. une date de période qui n''existe pas', issue, issue = '22023 ' || m_periode);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca - 'periode_fin', ec_cca, null));
  perform pg_temp.verdict('IV-B29. une période sans sa fin', issue, issue = '22023 ' || m_periode);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || jsonb_build_object('piece_citee_id', pb), ec_cca, null));
  perform pg_temp.verdict('IV-B30. la pièce d''un autre dossier', issue, issue = '22023 ' || m_piece);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || jsonb_build_object('piece_citee_id', pa), ec_cca, null));
  perform pg_temp.verdict('IV-B31. une pièce du dossier (le contrôle positif)', issue, issue like 'OK %');
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca, ec_cca, 1));
  perform pg_temp.verdict('IV-B32. une régularisation nouvelle avec une version lue', issue, issue = '22023 ' || m_nouvelle);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || jsonb_build_object('id', id_cca), ec_cca, 7));
  perform pg_temp.verdict('IV-B33. un remplacement contre une version qui n''est plus la sienne', issue, issue = '40001 ' || m_version);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || jsonb_build_object('id', id_fnp || ''), ec_cca, 1) );
  perform pg_temp.verdict('IV-B34. une régularisation se remplace par une autre nature, contre sa version (la FNP par une CCA ; le contrôle positif)', issue, issue like 'OK %');
  issue := pg_temp.tente(membre, pg_temp.appel(db, op_cca || jsonb_build_object('id', id_cca), ec_cca, 1));
  perform pg_temp.verdict('IV-B35. le remplacement d''une régularisation depuis un dossier qui ne la porte pas', issue, issue = '42501 Accès refusé à ce dossier.');

  -- ══ IV-C. La recomposition, refusée quand elle diffère ══
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca, jsonb_set(ec_cca, '{0,lignes}', (ec_cca #> '{0,lignes}') || '[{"compte":"616000","sens":"credit","centimes":1}]'), null));
  perform pg_temp.verdict('IV-C4. une ligne de trop', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca, jsonb_set(ec_cca, '{0,lignes,0,centimes}', '119999'), null));
  perform pg_temp.verdict('IV-C5. un centime de moins', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca, jsonb_set(ec_cca, '{0,libelle}', '"CCA 31/12/2025 — Dupont Jean — Assurance du local, 2026 — en trop"'), null));
  perform pg_temp.verdict('IV-C6. un libellé qui ne finit pas par l''objet', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca, jsonb_set(ec_cca, '{0,libelle}', '"CCA 31/12/2025 — Assurance du local, 2026"'), null));
  perform pg_temp.verdict('IV-C7. un libellé sans le libellé du compte, l''extourne gardant l''ancien', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca, jsonb_build_array(ec_cca -> 0), null));
  perform pg_temp.verdict('IV-C8. la constatation sans son extourne', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca, jsonb_set(ec_cca, '{1,journal}', '"AC"'), null));
  perform pg_temp.verdict('IV-C9. l''extourne hors du journal OD', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca, pg_temp.ecritures(2025, 'CCA 31/12/2025 — Assurance du local, 2026', '[["486000","debit",120000],["616000","credit",120000]]'), null));
  perform pg_temp.verdict('IV-C10. le libellé sans libellé de compte (le contrôle positif)', issue, issue like 'OK %');
  -- Le remplacement : un autre montant, la version 2, quatre lignes à leur place.
  issue := pg_temp.fait(membre, pg_temp.appel(da, op_cca || jsonb_build_object('id', id_cca, 'montant_centimes', 60000), pg_temp.ecritures(2025, lib_cca, '[["486000","debit",60000],["616000","credit",60000]]'), 1));
  select count(*) into n from ecritures_brouillon e where e.operation_inventaire_id = id_cca and e.montant = 600;
  perform pg_temp.verdict('IV-C11. le remplacement contre la version lue : la version 2, la paire réécrite', issue || ' | ' || n || ' ligne(s) à 600 | v'
    || (select o.version from operations_inventaire o where o.id = id_cca) || ' | modifiée par ' || coalesce((select o.modifie_par::text from operations_inventaire o where o.id = id_cca), '?'),
    issue = 'OK ' || id_cca and n = 4 and (select count(*) from ecritures_brouillon e where e.operation_inventaire_id = id_cca) = 4
      and (select o.version = 2 and o.modifie_par = membre from operations_inventaire o where o.id = id_cca));

  -- ══ IV-E. Les gardes ══
  issue := pg_temp.tente(membre, format('insert into operations_inventaire (dossier_id, exercice, nature, compte_resultat, compte_regularisation, montant_centimes, objet, cree_par) values (%L, 2025, ''cca'', ''616000'', ''486000'', 100, ''direct'', %L) returning id::text', da, membre));
  perform pg_temp.verdict('IV-E1. le membre n''insère pas de régularisation en direct (la RLS)', issue, issue like '42501 %');
  issue := pg_temp.tente(chef, format('insert into operations_inventaire (dossier_id, exercice, nature, compte_resultat, compte_regularisation, montant_centimes, objet, cree_par) values (%L, 2025, ''cca'', ''616000'', ''486000'', 100, ''restauration'', %L) returning id::text', da, chef));
  perform pg_temp.verdict('IV-E2. le super-administrateur réinsère (la porte de la restauration, le contrôle positif)', issue, issue like 'OK %');
  issue := pg_temp.tente(membre, format('with t as (update operations_inventaire set objet = ''réécrit'' where id = %L returning 1) select count(*)::text from t', id_cca));
  perform pg_temp.verdict('IV-E3. le membre ne réécrit pas une régularisation en direct (aucune policy : rien ne change)', issue, issue = 'OK 0');
  begin
    update operations_inventaire set objet = 'réécrit par le propriétaire' where id = id_cca;
    issue := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.verdict('IV-E4. même sans la RLS (le propriétaire), la garde refuse une réécriture directe', issue,
    issue = '42501 Une régularisation d’inventaire ne s’écrit que par enregistrer_operation_inventaire et retirer_operation_inventaire.');
  issue := pg_temp.tente(membre, format('insert into ecritures_brouillon (dossier_id, operation_inventaire_id, date, compte, libelle, montant, sens, statut) values (%L, %L, ''2025-12-31'', ''486000'', ''direct'', 1, ''debit'', ''proposee'') returning id::text', da, id_cca));
  perform pg_temp.verdict('IV-E5. le membre n''ajoute pas de ligne à une régularisation (la RLS du brouillon l''y laisserait : la garde)', issue, issue = '42501 ' || m_garde);
  issue := pg_temp.tente(membre, format('with t as (update ecritures_brouillon set montant = montant + 1 where operation_inventaire_id = %L returning 1) select count(*)::text from t', id_cca));
  perform pg_temp.verdict('IV-E6. le membre ne change pas le montant d''une ligne d''inventaire', issue, issue = '42501 ' || m_garde);
  issue := pg_temp.tente(membre, format('with t as (delete from ecritures_brouillon where operation_inventaire_id = %L returning 1) select count(*)::text from t', id_cca));
  perform pg_temp.verdict('IV-E7. le membre ne retire pas une ligne d''inventaire', issue, issue = '42501 ' || m_garde);
  issue := pg_temp.tente(membre, format('with t as (update ecritures_brouillon set operation_inventaire_id = %L where dossier_id = %L and operation_inventaire_id is null returning 1) select count(*)::text from t', id_cca, da));
  perform pg_temp.verdict('IV-E8. une ligne étrangère ne se rattache pas à une régularisation (rien à rattacher, ou refusé)', issue, issue in ('OK 0', '42501 ' || m_garde));
  begin
    -- Les déclencheurs du brouillon le temps de l'insertion (le propriétaire de la table) : seule la contrainte juge.
    alter table public.ecritures_brouillon disable trigger user;
    insert into ecritures_brouillon (dossier_id, operation_inventaire_id, piece_id, date, compte, libelle, montant, sens, statut)
      values (da, id_cca, pa, '2025-12-31', '486000', 'avec une pièce', 1, 'debit', 'proposee');
    issue := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.verdict('IV-E9. une ligne d''inventaire ne cite aucune autre source (la contrainte)', issue,
    issue like '23514 %ecritures_brouillon_inventaire_sans_autre_source%');
  begin
    perform set_config('jd.inventaire', da::text, true);
    insert into ecritures_brouillon (dossier_id, operation_inventaire_id, date, compte, libelle, montant, sens, statut)
      values (da, id_cca, '2026-12-31', '486000', 'un an trop tard', 1, 'debit', 'proposee');
    issue := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform set_config('jd.inventaire', '', true);
  perform pg_temp.verdict('IV-E10. une ligne d''inventaire se date au 31 décembre de son exercice ou au lendemain (la garde)', issue,
    issue = '23514 Une écriture d’inventaire appartient à une régularisation de son dossier, en engagement, au 31 décembre de son exercice ou au 1er janvier suivant.');

  -- ══ IV-D. Le retrait, et le gel ══
  issue := pg_temp.tente(membre, format('select public.retirer_operation_inventaire(%L, 1)::text', id_cca));
  perform pg_temp.verdict('IV-D1. un retrait contre une version qui n''est plus la sienne', issue, issue = '40001 ' || m_version);
  issue := pg_temp.tente(client, format('select public.retirer_operation_inventaire(%L, 2)::text', id_cca));
  perform pg_temp.verdict('IV-D2. le client ne retire rien', issue, issue = '42501 Accès refusé à cette régularisation.');
  issue := pg_temp.fait(membre, format('select public.retirer_operation_inventaire(%L, 1)::text', id_fnp));
  perform pg_temp.verdict('IV-D3. le membre retire la FNP et ses six lignes', issue,
    issue = 'OK 6' and not exists (select 1 from operations_inventaire o where o.id = id_fnp)
      and not exists (select 1 from ecritures_brouillon e where e.operation_inventaire_id = id_fnp));
  -- Le gel : une régularisation de 2024 écrite, puis l'exercice 2024 du dossier validé (une ligne d'exercices_valides posée
  -- par le propriétaire, sans la validation : seul compte ici le gel).
  issue := pg_temp.fait(membre, pg_temp.appel(dv, op_cca || '{"exercice": 2024}', pg_temp.ecritures(2024, replace(lib_cca, '2025', '2024'), '[["486000","debit",120000],["616000","credit",120000]]'), null));
  id_v := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte)
    values (dv, 2024, now(), chef, 'engagement', 0, 0, 0, 0, repeat('0', 64));
  issue := pg_temp.tente(membre, pg_temp.appel(dv, op_cca || '{"exercice": 2024}', pg_temp.ecritures(2024, replace(lib_cca, '2025', '2024'), '[["486000","debit",120000],["616000","credit",120000]]'), null));
  perform pg_temp.verdict('IV-D4. un exercice validé ne reçoit plus de régularisation', issue, id_v is not null and issue = '23514 ' || m_fige);
  issue := pg_temp.tente(membre, pg_temp.appel(dv, op_cca || '{"exercice": 2023}', pg_temp.ecritures(2023, replace(lib_cca, '2025', '2023'), '[["486000","debit",120000],["616000","credit",120000]]'), null));
  perform pg_temp.verdict('IV-D5. ni l''exercice que la validation suivante fige', issue, issue = '23514 ' || m_fige);
  issue := pg_temp.tente(membre, pg_temp.appel(dv, op_cca || jsonb_build_object('id', id_v), ec_cca, 1));
  perform pg_temp.verdict('IV-D6. une régularisation d''un exercice validé ne se déplace pas dans le suivant', issue, issue = '23514 ' || m_fige);
  issue := pg_temp.tente(membre, format('select public.retirer_operation_inventaire(%L, 1)::text', id_v));
  perform pg_temp.verdict('IV-D7. ni ne se retire', issue, issue = '23514 ' || m_fige);
  issue := pg_temp.tente(membre, pg_temp.appel(dv, op_cca, ec_cca, null));
  perform pg_temp.verdict('IV-D8. l''exercice qui suit le dernier validé reçoit la sienne (le contrôle positif)', issue, issue like 'OK %');
  begin
    perform set_config('jd.inventaire', dv::text, true);
    update operations_inventaire set objet = 'réécrit par la porte' where id = id_v;
    issue := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform set_config('jd.inventaire', '', true);
  perform pg_temp.verdict('IV-D9. même par la porte des fonctions, la garde refuse de changer une régularisation figée', issue, issue = '23514 ' || m_fige);

  -- ══ Les mutations de la migration : chacune doit faire virer un contrôle au rouge ══
  -- M-IV1 : l'accès ôté de la fonction ; le membre écrit dans un dossier qui ne lui est pas assigné.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_operation_inventaire(uuid, jsonb, jsonb, integer)'::regprocedure),
      'not coalesce(public.admin_du_dossier(p_dossier_id), false)', 'false');
    issue := pg_temp.tente(membre, pg_temp.appel(db, op_cca, ec_cca, null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into iv_mutation (mutation, observe, mord) values ('M-IV1 — l''accès ôté de enregistrer_operation_inventaire', issue, issue like 'OK %');
  -- M-IV2 : le compte des lignes ôté de la comparaison ; une ligne de trop passe.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_operation_inventaire(uuid, jsonb, jsonb, integer)'::regprocedure),
      '(select count(*) from recues) = (select count(*) from attendues)', 'true');
    issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca, jsonb_set(ec_cca, '{0,lignes}', (ec_cca #> '{0,lignes}') || '[{"compte":"616000","sens":"credit","centimes":1}]'), null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into iv_mutation (mutation, observe, mord) values ('M-IV2 — la comparaison sans le compte des lignes : une ligne de trop', issue, issue like 'OK %');
  -- M-IV3 : le 467 admis parmi les charges à payer.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_operation_inventaire(uuid, jsonb, jsonb, integer)'::regprocedure),
      'array[''4282'', ''4286''', 'array[''467'', ''4282'', ''4286''');
    issue := pg_temp.tente(membre, pg_temp.appel(da, op_cca || '{"nature": "charge_a_payer", "compte_regularisation": "467000"}',
      pg_temp.ecritures(2025, 'Charge à payer 31/12/2025 — Assurance du local, 2026', '[["616000","debit",120000],["467000","credit",120000]]'), null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into iv_mutation (mutation, observe, mord) values ('M-IV3 — le 467 admis parmi les charges à payer', issue, issue like 'OK %');
  -- M-IV4 : le gel ôté du retrait et de la garde ; la régularisation d'un exercice validé part (ses lignes, encore
  -- proposées, ne sont pas gardées par la garde des écritures validées : seul le gel de l'inventaire les tient).
  begin
    execute replace(pg_get_functiondef('public.retirer_operation_inventaire(uuid, integer)'::regprocedure),
      '(v_frontiere is not null and v_operation.exercice <= extract(year from v_frontiere))', 'false');
    execute 'create or replace function public.garder_operations_inventaire() returns trigger language plpgsql as $g$ begin if tg_op = ''DELETE'' then return old; end if; return new; end $g$';
    issue := pg_temp.tente(membre, format('select public.retirer_operation_inventaire(%L, 1)::text', id_v));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into iv_mutation (mutation, observe, mord) values ('M-IV4 — le gel ôté du retrait et de la garde : la régularisation d''un exercice validé part', issue, issue like 'OK %');
  -- M-IV5 : la garde des lignes ouverte ; le membre ajoute une ligne en direct.
  begin
    execute 'create or replace function public.garder_ecriture_d_inventaire() returns trigger language plpgsql as $g$ begin if tg_op = ''DELETE'' then return old; end if; return new; end $g$';
    issue := pg_temp.tente(membre, format('insert into ecritures_brouillon (dossier_id, operation_inventaire_id, date, compte, libelle, montant, sens, statut) values (%L, %L, ''2025-12-31'', ''486000'', ''direct'', 1, ''debit'', ''proposee'') returning id::text', da, id_cca));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into iv_mutation (mutation, observe, mord) values ('M-IV5 — la garde des lignes d''inventaire ouverte', issue, issue like 'OK %');
  -- M-IV6 : la règle du dossier qui ne collecte pas la TVA ôtée.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_operation_inventaire(uuid, jsonb, jsonb, integer)'::regprocedure),
      'if v_tva > 0 and not v_assujetti then', 'if false then');
    issue := pg_temp.tente(membre, pg_temp.appel(dn, op_fnp, pg_temp.ecritures(2025, lib_fnp, '[["622600","debit",50000],["445860","debit",10000],["408100","credit",60000]]'), null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into iv_mutation (mutation, observe, mord) values ('M-IV6 — la TVA d''attente admise dans un dossier en franchise', issue, issue like 'OK %');
  -- M-IV7 : la contrainte des sources ôtée ; une ligne d'inventaire cite une pièce.
  begin
    alter table public.ecritures_brouillon drop constraint ecritures_brouillon_inventaire_sans_autre_source;
    alter table public.ecritures_brouillon disable trigger user;
    insert into ecritures_brouillon (dossier_id, operation_inventaire_id, piece_id, date, compte, libelle, montant, sens, statut)
      values (da, id_cca, pa, '2025-12-31', '486000', 'avec une pièce', 1, 'debit', 'proposee');
    issue := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform set_config('jd.inventaire', '', true);
  insert into iv_mutation (mutation, observe, mord) values ('M-IV7 — la contrainte des sources ôtée : une ligne d''inventaire cite une pièce', issue, issue = 'ACCEPTÉ');
  -- M-IV8 : une policy de lecture ouverte au client du dossier.
  begin
    execute 'create policy operations_inventaire_mutant on public.operations_inventaire for select to authenticated using (exists (select 1 from memberships m where m.dossier_id = operations_inventaire.dossier_id and m.user_id = auth.uid()))';
    issue := pg_temp.tente(client, format('select count(*)::text from operations_inventaire where dossier_id = %L', da));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into iv_mutation (mutation, observe, mord) values ('M-IV8 — la lecture ouverte au client du dossier', issue, issue not in ('OK 0') and issue like 'OK %');
end
$essai$;

select 'INVARIANTS' as tableau, controle as ligne, case when ok then 'juste' else '*** EN FAUTE ***' end as resultat, observe as detail
  from iv_verdict
union all
select 'MUTATIONS', mutation, case when mord then 'le contrôle mord' else '*** NE MORD PAS ***' end, observe
  from iv_mutation
union all
select 'BILAN', 'invariants et mutations',
  (select count(*) filter (where not ok) from iv_verdict) || ' en faute / ' || (select count(*) from iv_verdict) || ' ; '
  || (select count(*) filter (where mord) from iv_mutation) || ' mutations sur ' || (select count(*) from iv_mutation) || ' qui mordent', ''
order by 1 desc, 2;

rollback;
