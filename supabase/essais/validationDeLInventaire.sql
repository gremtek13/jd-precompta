-- ESSAI DE LA VALIDATION QUI CONNAÎT L'INVENTAIRE (ligne 35, INV3 ; migration `validation_de_l_inventaire`, PRÉPARÉE le
-- 12/11/2026). SUR UNE RÉPLIQUE SEULEMENT : il crée des dossiers, des régularisations, des déclarations et des exercices
-- validés fictifs, en retire et en falsifie hors des fonctions. Joué ENTIER, en une transaction qui s'annule (`begin` …
-- `rollback`), par psql, sans `-1` :
--   psql -v ON_ERROR_STOP=1 -f supabase/essais/validationDeLInventaire.sql
-- Sans la migration (ni `inventaires_declares` ni `inventaire_a_jour`), une ligne dit que l'essai attend, et rien d'autre ;
-- sans celle des provisions (INV4), les contrôles qui les jugent attendent, chacun sur sa ligne.
-- Ce qu'il juge, par impersonation (le chef, qui est aussi super-administrateur dans le semis ; un membre de l'équipe assigné ;
-- le même membre sur un dossier qui ne lui est pas assigné ; un client qui a un accès au dossier ; l'anonyme) :
--   VI-D. la déclaration : qui déclare et qui retire, chaque refus sous son code et ses MOTS (ceux de
--         src/lib/inventaireDeLaValidation.ts), dans leur ordre ; la garde (aucune écriture directe, une ligne qui ne change
--         que pour se retirer, une fois, ni ne s'efface ; le super-administrateur réinsère) ; une seule en vigueur ;
--   VI-A. la numérotation des écritures d'inventaire : le journal OD, la pièce « Inventaire AAAA » du 31 décembre, une
--         écriture par régularisation et par date, sans autre ligne ;
--   VI-B. l'inventaire déclaré, en engagement seulement ;
--   VI-C. les régularisations de l'exercice à jour, aux deux dates (la TVA d'attente sous sa racine) ;
--   VI-E. l'extourne entière des régularisations de l'exercice précédent, figées avec lui ;
--   VI-P. les provisions : l'évaluation à jour, sans extourne ; la ventilation du solde repris au premier exercice ;
--   VI-G. le gel : la déclaration d'un exercice validé ne se retire ni ne s'écrit plus ; l'ordre des refus.
-- Puis des MUTATIONS de la migration, chacune dans une sous-transaction annulée, qui doivent faire virer un contrôle au rouge.
-- Se lit : toute ligne « en faute » est une faute de la migration ; toute mutation qui « NE MORD PAS » est un contrôle qui ne
-- prouve plus rien.

begin;

create temp table vi_verdict (rang serial, controle text, observe text, ok boolean);
create temp table vi_mutation (rang serial, mutation text, observe text, mord boolean);

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

-- Une écriture directe du propriétaire, déclencheurs compris, annulée : rend « ACCEPTÉ » ou « <sqlstate> <message> ».
create function pg_temp.direct(p_sql text) returns text language plpgsql as $$
declare
  v_issue text;
begin
  begin
    execute p_sql;
    v_issue := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then v_issue := sqlstate || ' ' || sqlerrm; end if;
  end;
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

create function pg_temp.regularisation(p_dossier uuid, p_operation jsonb, p_ecritures jsonb) returns text language sql as $$
  select format('select public.enregistrer_operation_inventaire(%L::uuid, %L::jsonb, %L::jsonb, null)::text', p_dossier, p_operation, p_ecritures)
$$;

-- LA NUMÉROTATION que l'application enverrait (la sorte `inventaire` de src/lib/fec.ts) : chaque ligne de l'exercice, au
-- journal OD, une écriture par régularisation et par date dans l'ordre des dates, sous la pièce « Inventaire AAAA » du 31
-- décembre de l'exercice de sa régularisation ; un libellé par compte. Les dossiers de l'essai ne portent pas d'autre ligne.
-- En PL/pgSQL : sa requête ne se lit qu'à son premier appel, et la table des régularisations peut manquer (l'essai attend).
create function pg_temp.numerotation(p_dossier uuid, p_annee integer) returns jsonb language plpgsql as $$
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'journal', 'OD', 'numero', x.numero,
           'piece_ref', 'Inventaire ' || x.exercice, 'piece_date', to_char(make_date(x.exercice, 12, 31), 'YYYY-MM-DD'),
           'compte_lib', 'Compte ' || x.compte, 'comp_aux_num', null, 'comp_aux_lib', null) order by x.numero, x.id), '[]'::jsonb)
    from (select e.id, e.compte, o.exercice, dense_rank() over (order by e.date, e.operation_inventaire_id) as numero
            from ecritures_brouillon e join operations_inventaire o on o.id = e.operation_inventaire_id
           where e.dossier_id = p_dossier and e.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)) x);
end
$$;

-- Les libellés des à-nouveaux de l'exercice (la reprise et les soldes reportés), un par compte.
create function pg_temp.a_nouveaux(p_dossier uuid, p_annee integer) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'compte_lib', 'Compte ' || a.compte, 'ecriture_lib', 'À-nouveaux ' || p_annee)), '[]'::jsonb)
    from (select n.id, n.compte from a_nouveaux n
           where n.dossier_id = p_dossier and n.date between make_date(p_annee, 1, 1) and make_date(p_annee, 12, 31)
          union all
          select s.id, s.compte from soldes_reportes s where s.dossier_id = p_dossier and s.date = make_date(p_annee, 1, 1)) a
$$;

-- L'appel de la validation, en texte : la numérotation donnée, ou celle de l'application.
create function pg_temp.valider(p_dossier uuid, p_annee integer, p_lignes jsonb, p_declaration jsonb) returns text language sql as $$
  select format('select (public.valider_exercice(%L::uuid, %s, %L::jsonb, %L::jsonb, %s) ->> ''lignes'')',
                p_dossier, p_annee, coalesce(p_lignes, pg_temp.numerotation(p_dossier, p_annee)), pg_temp.a_nouveaux(p_dossier, p_annee),
                coalesce(quote_literal(p_declaration::text) || '::jsonb', 'null'))
$$;

-- La première écriture d'une numérotation passée au journal des achats, ENTIÈRE (équilibrée, sous le numéro 1 de ce journal),
-- les suivantes renumérotées dans le leur : seule la règle de l'inventaire la refuse, aucune règle d'hier.
create function pg_temp.premiere_aux_achats(p jsonb) returns jsonb language sql as $$
  select jsonb_agg(case when (l ->> 'numero')::int = 1 then jsonb_set(l, '{journal}', '"AC"')
                        else jsonb_set(l, '{numero}', to_jsonb((l ->> 'numero')::int - 1)) end)
    from jsonb_array_elements(p) l
$$;

create function pg_temp.verdict(p_controle text, p_observe text, p_ok boolean) returns void language sql as $$
  insert into vi_verdict (controle, observe, ok) values (p_controle, p_observe, coalesce(p_ok, false))
$$;

do $essai$
declare
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre uuid := '3e3b0000-0000-4000-8000-000000000001';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  cabinet uuid := 'cab10000-0000-4000-8000-000000000001';
  de uuid := 'a1300000-0000-4000-8000-0000000000e1';   -- engagement, redevable, assigné au membre, ouvert au client
  dt uuid := 'a1300000-0000-4000-8000-0000000000e2';   -- trésorerie, assigné
  db uuid := 'a1300000-0000-4000-8000-0000000000e3';   -- engagement, NON assigné au membre
  dr uuid := 'a1300000-0000-4000-8000-0000000000e4';   -- engagement, repris au 1er janvier 2025 (un 151 et un 491)
  dp uuid := 'a1300000-0000-4000-8000-0000000000e5';   -- engagement, une provision évaluée en 2024
  -- Les mots du module (src/lib/inventaireDeLaValidation.ts), au caractère près.
  m_tresorerie text := 'L’inventaire ne s’écrit qu’en comptabilité d’engagement : un dossier en trésorerie (BNC, 2035) n’en reçoit aucun.';
  m_exercice text := 'L’exercice de l’inventaire est illisible : une année entre 2000 et 2100.';
  m_fige text := 'Cet exercice est validé : son inventaire ne change plus.';
  m_pas_clos text := 'Cet exercice n’est pas clos : son inventaire se déclare après son 31 décembre.';
  m_ouverture text := 'Cet exercice précède l’ouverture du dossier dans l’application : son inventaire n’y a pas de place.';
  m_deja text := 'L’inventaire de cet exercice est déjà déclaré : relire l’inventaire.';
  m_lue text := 'Cette déclaration a changé depuis sa lecture : relire l’inventaire.';
  m_garde text := 'Une déclaration d’inventaire ne s’écrit que par declarer_inventaire et retirer_declaration_inventaire.';
  m_change text := 'Une déclaration d’inventaire ne change pas : elle se retire, une fois.';
  m_efface text := 'Une déclaration d’inventaire ne s’efface pas : elle se retire, et sa trace reste.';
  m_numerotation text := 'Une écriture d''inventaire n''est pas numérotée sous sa pièce : au journal des opérations diverses, une écriture par régularisation et par date, sous la pièce « Inventaire AAAA » du 31 décembre de son exercice.';
  -- Une CCA et une FNP toutes taxes comprises de 2024 ; un PCA de 2025.
  lib_cca text := 'CCA 31/12/2024 — Assurance 2025';
  op_cca jsonb := '{"exercice": 2024, "nature": "cca", "compte_resultat": "616000", "compte_regularisation": "486000", "montant_centimes": 120000, "tva_centimes": 0, "objet": "Assurance 2025"}';
  lib_fnp text := 'FNP 31/12/2024 — Honoraires de décembre';
  op_fnp jsonb := '{"exercice": 2024, "nature": "fnp", "compte_resultat": "622600", "compte_regularisation": "408100", "montant_centimes": 50000, "tva_centimes": 10000, "objet": "Honoraires de décembre"}';
  lib_pca text := 'PCA 31/12/2025 — Abonnement 2026 facturé';
  op_pca jsonb := '{"exercice": 2025, "nature": "pca", "compte_resultat": "706000", "compte_regularisation": "487000", "montant_centimes": 30000, "tva_centimes": 0, "objet": "Abonnement 2026 facturé"}';
  provisions boolean := to_regclass('public.provisions') is not null;
  issue text;
  texte text;
  id_cca uuid;
  id_fnp uuid;
  id_pca uuid;
  decl_e uuid;
  decl_t uuid;
  lignes jsonb;
  ligne uuid;
  prov uuid;
  id_eval uuid;
begin
  if to_regclass('public.inventaires_declares') is null or to_regprocedure('public.inventaire_a_jour(uuid)') is null then
    perform pg_temp.verdict('VI. EN ATTENTE de la migration validation_de_l_inventaire (INV3)', 'ni la table des déclarations ni les juges de la validation', true);
    return;
  end if;

  -- ── Le jeu, écrit par le propriétaire ──
  insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva, compte_notes_de_frais) values
    (de, 'INV3 essai E', cabinet, 'engagement', 'redevable', '455000'), (dt, 'INV3 essai T', cabinet, 'tresorerie', 'franchise', '455000'),
    (db, 'INV3 essai B', cabinet, 'engagement', 'redevable', '455000'), (dr, 'INV3 essai R', cabinet, 'engagement', 'redevable', '455000'),
    (dp, 'INV3 essai P', cabinet, 'engagement', 'redevable', '455000');
  insert into dossier_assignations (dossier_id, user_id) values (de, membre), (dt, membre), (dr, membre), (dp, membre);
  insert into memberships (user_id, dossier_id, role)
    select client, de, m.role from memberships m where m.user_id = client limit 1;
  insert into a_nouveaux (dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values
    (dr, '2025-01-01', '512000', 'debit', 1500, 'essai', repeat('b', 64)),
    (dr, '2025-01-01', '151100', 'credit', 1000, 'essai', repeat('b', 64)),
    (dr, '2025-01-01', '491000', 'credit', 500, 'essai', repeat('b', 64));
  issue := pg_temp.fait(membre, pg_temp.regularisation(de, op_cca, pg_temp.ecritures(2024, lib_cca, '[["486000","debit",120000],["616000","credit",120000]]')));
  id_cca := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  issue := pg_temp.fait(membre, pg_temp.regularisation(de, op_fnp, pg_temp.ecritures(2024, lib_fnp, '[["622600","debit",50000],["445860","debit",10000],["408100","credit",60000]]')));
  id_fnp := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  issue := pg_temp.fait(membre, pg_temp.regularisation(de, op_pca, pg_temp.ecritures(2025, lib_pca, '[["706000","debit",30000],["487000","credit",30000]]')));
  id_pca := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('VI-0. le jeu : trois régularisations écrites par leur fonction (deux de 2024, une de 2025)',
    coalesce(id_cca::text, '?') || ' | ' || coalesce(id_fnp::text, '?') || ' | ' || coalesce(id_pca::text, '?') || ' | ' || coalesce(issue, ''),
    id_cca is not null and id_fnp is not null and id_pca is not null);

  -- ══ VI-D. La déclaration ══
  issue := pg_temp.tente(membre, format('select public.declarer_inventaire(%L, 2024)::text', db));
  perform pg_temp.verdict('VI-D1. le membre, sur un dossier qui ne lui est pas assigné', issue, issue = '42501 Accès refusé à ce dossier.');
  issue := pg_temp.tente(client, format('select public.declarer_inventaire(%L, 2024)::text', de));
  perform pg_temp.verdict('VI-D2. le client, qui a un accès au dossier', issue, issue = '42501 Accès refusé à ce dossier.');
  issue := pg_temp.tente(null, format('select public.declarer_inventaire(%L, 2024)::text', de));
  perform pg_temp.verdict('VI-D3. l''anonyme n''exécute pas la fonction', issue, issue like '42501 permission denied for function%');
  issue := pg_temp.tente(membre, format('select public.declarer_inventaire(%L, 2024)::text', dt));
  perform pg_temp.verdict('VI-D4. un dossier en trésorerie', issue, issue = '22023 ' || m_tresorerie);
  issue := pg_temp.tente(membre, format('select public.declarer_inventaire(%L, 1999)::text', de));
  perform pg_temp.verdict('VI-D5. un exercice illisible (1999)', issue, issue = '22023 ' || m_exercice);
  issue := pg_temp.tente(membre, format('select public.declarer_inventaire(%L, %s)::text', de, extract(year from now() at time zone 'Europe/Paris')::int));
  perform pg_temp.verdict('VI-D6. l''exercice en cours, pas clos', issue, issue = '22023 ' || m_pas_clos);
  issue := pg_temp.tente(membre, format('select public.declarer_inventaire(%L, 2024)::text', dr));
  perform pg_temp.verdict('VI-D7. un exercice avant l''ouverture du dossier (à-nouveaux du 01/01/2025)', issue, issue = '22023 ' || m_ouverture);
  issue := pg_temp.fait(membre, format('select public.declarer_inventaire(%L, 2024)::text', de));
  decl_e := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('VI-D8. le membre assigné déclare l''inventaire de 2024 (le contrôle positif)', issue, decl_e is not null);
  issue := pg_temp.tente(chef, format('select public.declarer_inventaire(%L, 2024)::text', de));
  perform pg_temp.verdict('VI-D9. une seconde déclaration en vigueur du même exercice', issue, issue = '40001 ' || m_deja);
  select d.declare_par || ' | ' || (d.retire_le is null) into texte from inventaires_declares d where d.id = decl_e;
  perform pg_temp.verdict('VI-D10. la déclaration garde son auteur, posé par la fonction, en vigueur', texte, texte = membre || ' | true');
  issue := pg_temp.tente(client, format('select count(*)::text from inventaires_declares where dossier_id = %L', de));
  perform pg_temp.verdict('VI-D11. le client ne lit aucune déclaration de son dossier ; le membre assigné la lit', issue
    || ' | membre : ' || pg_temp.tente(membre, format('select count(*)::text from inventaires_declares where dossier_id = %L', de)),
    issue = 'OK 0' and pg_temp.tente(membre, format('select count(*)::text from inventaires_declares where dossier_id = %L', de)) = 'OK 1');
  issue := pg_temp.tente(client, format('select public.retirer_declaration_inventaire(%L)::text', decl_e));
  perform pg_temp.verdict('VI-D12. le client ne retire pas une déclaration', issue, issue = '42501 Accès refusé à cette déclaration.');
  issue := pg_temp.tente(membre, format('insert into inventaires_declares (dossier_id, exercice, declare_par) values (%L, 2023, %L) returning id::text', de, membre));
  perform pg_temp.verdict('VI-D13. le membre n''écrit pas de déclaration en direct (aucune policy d''écriture)', issue, issue like '42501 %');
  issue := pg_temp.direct(format('insert into inventaires_declares (dossier_id, exercice, declare_par) values (%L, 2023, %L)', de, membre));
  perform pg_temp.verdict('VI-D14. même sans la RLS (le propriétaire), la garde refuse une déclaration écrite en direct', issue, issue = '42501 ' || m_garde);
  issue := pg_temp.direct(format('update inventaires_declares set exercice = 2023 where id = %L', decl_e));
  perform pg_temp.verdict('VI-D15. ni une réécriture directe', issue, issue = '42501 ' || m_garde);
  issue := pg_temp.direct(format('delete from inventaires_declares where id = %L', decl_e));
  perform pg_temp.verdict('VI-D16. une déclaration ne s''efface pas', issue, issue = '42501 ' || m_efface);
  begin
    perform set_config('jd.inventaire_declare', de::text, true);
    update inventaires_declares set exercice = 2023 where id = decl_e;
    issue := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform set_config('jd.inventaire_declare', '', true);
  perform pg_temp.verdict('VI-D17. même par la porte des fonctions, une déclaration ne change que pour se retirer', issue, issue = '42501 ' || m_change);
  issue := pg_temp.tente(chef, format('insert into inventaires_declares (dossier_id, exercice, declare_par) values (%L, 2023, %L) returning id::text', de, chef));
  perform pg_temp.verdict('VI-D18. le super-administrateur réinsère une déclaration (la restauration, le contrôle positif)', issue, issue like 'OK %');
  issue := pg_temp.tente(chef, format('insert into inventaires_declares (dossier_id, exercice, declare_par) values (%L, 2024, %L) returning id::text', de, chef));
  perform pg_temp.verdict('VI-D19. jamais deux déclarations en vigueur du même exercice, même réinsérées', issue, issue like '23505 %inventaires_declares_une_en_vigueur%');
  -- Gardé : la déclaration retirée reste, sa trace avec elle, et la nouvelle est en vigueur.
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', membre, 'role', 'authenticated')::text, true);
    perform public.retirer_declaration_inventaire(decl_e);
    select count(*)::text into texte from inventaires_declares d where d.dossier_id = de and d.exercice = 2024 and d.retire_le is null;
    decl_e := public.declarer_inventaire(de, 2024);
    issue := 'OK ' || texte;
  exception when others then issue := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select issue || ' | ' || count(*) || ' lignes, ' || count(*) filter (where retire_le is not null and retire_par = membre) || ' retirée par le membre'
    into texte from inventaires_declares d where d.dossier_id = de and d.exercice = 2024;
  perform pg_temp.verdict('VI-D20. le membre retire la déclaration, puis la déclare de nouveau ; la retirée garde sa trace (le contrôle positif)', texte,
    texte = 'OK 0 | 2 lignes, 1 retirée par le membre');
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', membre, 'role', 'authenticated')::text, true);
    perform public.retirer_declaration_inventaire(decl_e);
    perform public.retirer_declaration_inventaire(decl_e);
    issue := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.verdict('VI-D21. une déclaration retirée ne se retire pas deux fois', issue, issue = '40001 ' || m_lue);

  -- ══ VI-A et VI-B. La validation de 2024 : la numérotation, puis l'inventaire déclaré ══
  lignes := pg_temp.numerotation(de, 2024);
  issue := pg_temp.tente(chef, pg_temp.valider(de, 2024, pg_temp.premiere_aux_achats(lignes), null));
  perform pg_temp.verdict('VI-A1. une ligne d''inventaire au journal des achats', issue, issue = '22023 ' || m_numerotation);
  issue := pg_temp.tente(chef, pg_temp.valider(de, 2024,
    (select jsonb_agg(case when l ->> 'numero' = '1' then jsonb_set(jsonb_set(l, '{piece_ref}', '"Inventaire 2023"'), '{piece_date}', '"2023-12-31"') else l end) from jsonb_array_elements(lignes) l), null));
  perform pg_temp.verdict('VI-A2. une écriture d''inventaire sous la pièce d''un autre exercice', issue, issue = '22023 ' || m_numerotation);
  issue := pg_temp.tente(chef, pg_temp.valider(de, 2024,
    (select jsonb_agg(jsonb_set(l, '{numero}', '1')) from jsonb_array_elements(lignes) l), null));
  perform pg_temp.verdict('VI-A3. deux régularisations dans une seule écriture (équilibrée, une pièce, une date)', issue, issue = '22023 ' || m_numerotation);
  -- Une ligne de trop, hors de tout inventaire, à la même date, dans l'écriture de la CCA (équilibrée).
  begin
    insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens, statut) values
      ('a1300000-0000-4000-8000-00000000f001', de, '2024-12-31', '471000', 'attente', 1, 'debit', 'proposee'),
      ('a1300000-0000-4000-8000-00000000f002', de, '2024-12-31', '471000', 'attente', 1, 'credit', 'proposee');
    issue := pg_temp.tente(chef, pg_temp.valider(de, 2024, lignes
      || jsonb_build_array(
           jsonb_build_object('id', 'a1300000-0000-4000-8000-00000000f001', 'journal', 'OD', 'numero', 1, 'piece_ref', 'Inventaire 2024', 'piece_date', '2024-12-31', 'compte_lib', 'Compte 471000', 'comp_aux_num', null, 'comp_aux_lib', null),
           jsonb_build_object('id', 'a1300000-0000-4000-8000-00000000f002', 'journal', 'OD', 'numero', 1, 'piece_ref', 'Inventaire 2024', 'piece_date', '2024-12-31', 'compte_lib', 'Compte 471000', 'comp_aux_num', null, 'comp_aux_lib', null)), null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.verdict('VI-A4. une ligne sans régularisation dans l''écriture d''une régularisation', issue, issue = '22023 ' || m_numerotation);
  -- Les lignes d'une régularisation à une date réparties entre deux écritures, chacune équilibrée : la CCA doublée hors de
  -- la fonction (les déclencheurs coupés le temps de l'insertion), chaque paire sous son numéro.
  begin
    alter table public.ecritures_brouillon disable trigger user;
    insert into ecritures_brouillon (id, dossier_id, operation_inventaire_id, date, compte, libelle, montant, sens, statut) values
      ('a1300000-0000-4000-8000-00000000f003', de, id_cca, '2024-12-31', '486000', lib_cca, 1200, 'debit', 'proposee'),
      ('a1300000-0000-4000-8000-00000000f004', de, id_cca, '2024-12-31', '616000', lib_cca, 1200, 'credit', 'proposee');
    alter table public.ecritures_brouillon enable trigger user;
    issue := pg_temp.tente(chef, pg_temp.valider(de, 2024, lignes
      || jsonb_build_array(
           jsonb_build_object('id', 'a1300000-0000-4000-8000-00000000f003', 'journal', 'OD', 'numero', 3, 'piece_ref', 'Inventaire 2024', 'piece_date', '2024-12-31', 'compte_lib', 'Compte 486000', 'comp_aux_num', null, 'comp_aux_lib', null),
           jsonb_build_object('id', 'a1300000-0000-4000-8000-00000000f004', 'journal', 'OD', 'numero', 3, 'piece_ref', 'Inventaire 2024', 'piece_date', '2024-12-31', 'compte_lib', 'Compte 616000', 'comp_aux_num', null, 'comp_aux_lib', null)), null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.verdict('VI-A5. les lignes d''une régularisation à une date réparties entre deux écritures', issue, issue = '22023 ' || m_numerotation);

  -- VI-B : sans déclaration en vigueur (celle de VI-D20 retirée le temps du contrôle), puis déclarée.
  begin
    perform set_config('jd.inventaire_declare', de::text, true);
    update inventaires_declares set retire_le = now(), retire_par = membre where dossier_id = de and exercice = 2024 and retire_le is null;
    perform set_config('jd.inventaire_declare', '', true);
    issue := pg_temp.tente(chef, pg_temp.valider(de, 2024, null, null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform set_config('jd.inventaire_declare', '', true);
  perform pg_temp.verdict('VI-B1. en engagement, l''inventaire de l''exercice n''est pas déclaré', issue,
    issue = '23514 L''inventaire de l''exercice 2024 n''est pas déclaré : le déclarer fait, même sans régularisation, avant la validation.');
  issue := pg_temp.tente(chef, pg_temp.valider(dt, 2025, '[]', '{}'));
  perform pg_temp.verdict('VI-B2. en trésorerie, rien ne se déclare : l''exercice se valide comme hier (le contrôle positif)', issue, issue = 'OK 0');
  issue := pg_temp.tente(chef, pg_temp.valider(db, 2025, '[]', null));
  perform pg_temp.verdict('VI-B3. un exercice d''engagement sans aucune régularisation, et sans déclaration', issue,
    issue = '23514 L''inventaire de l''exercice 2025 n''est pas déclaré : le déclarer fait, même sans régularisation, avant la validation.');

  -- ══ VI-C. Les régularisations de l'exercice à jour ══
  -- Le montant d'une ligne changé hors de la fonction (les déclencheurs coupés le temps du changement).
  begin
    alter table public.ecritures_brouillon disable trigger user;
    update ecritures_brouillon set montant = 1199.99 where operation_inventaire_id = id_cca and date = '2024-12-31' and compte = '616000';
    update ecritures_brouillon set montant = 1199.99 where operation_inventaire_id = id_cca and date = '2024-12-31' and compte = '486000';
    alter table public.ecritures_brouillon enable trigger user;
    issue := pg_temp.tente(chef, pg_temp.valider(de, 2024, null, null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.verdict('VI-C1. une constatation qui ne fait plus le montant de sa régularisation (équilibrée)', issue,
    issue = '23514 L''exercice 2024 porte une régularisation d''inventaire dont les écritures ne sont plus celles qu''elle commande : Assurance 2025 — l''enregistrer de nouveau avant la validation.');
  -- Son extourne retirée hors de la fonction : la constatation seule ne suffit pas.
  begin
    alter table public.ecritures_brouillon disable trigger user;
    delete from ecritures_brouillon where operation_inventaire_id = id_fnp and date = '2025-01-01';
    alter table public.ecritures_brouillon enable trigger user;
    issue := pg_temp.tente(chef, pg_temp.valider(de, 2024, null, null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.verdict('VI-C2. une régularisation de l''exercice dont l''extourne manque', issue,
    issue = '23514 L''exercice 2024 porte une régularisation d''inventaire dont les écritures ne sont plus celles qu''elle commande : Honoraires de décembre — l''enregistrer de nouveau avant la validation.');
  -- La TVA d'attente sur un autre compte de sa racine (le plan l'a déplacée) : à jour.
  begin
    alter table public.ecritures_brouillon disable trigger user;
    update ecritures_brouillon set compte = '445861' where operation_inventaire_id = id_fnp and compte = '445860';
    alter table public.ecritures_brouillon enable trigger user;
    select (select count(*) from operations_inventaire o where o.dossier_id = de and not public.inventaire_a_jour(o.id))::text
      || ' ' || public.inventaire_a_jour(id_fnp)::text into issue;
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.verdict('VI-C3. la TVA d''attente sous sa racine, sur un autre compte que celui du rôle : à jour (le contrôle positif)', issue, issue = '0 true');
  begin
    alter table public.ecritures_brouillon disable trigger user;
    update ecritures_brouillon set compte = '445660' where operation_inventaire_id = id_fnp and compte = '445860';
    alter table public.ecritures_brouillon enable trigger user;
    select public.inventaire_a_jour(id_fnp)::text into issue;
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.verdict('VI-C4. la TVA d''attente d''une facture non parvenue hors de sa racine (au 44566) : pas à jour', issue, issue = 'false');

  -- L'ordre : sans déclaration ET une régularisation qui n'est pas à jour, l'inventaire déclaré se dit d'abord.
  begin
    perform set_config('jd.inventaire_declare', de::text, true);
    update inventaires_declares set retire_le = now(), retire_par = membre where dossier_id = de and exercice = 2024 and retire_le is null;
    perform set_config('jd.inventaire_declare', '', true);
    alter table public.ecritures_brouillon disable trigger user;
    update ecritures_brouillon set montant = 1199.99 where operation_inventaire_id = id_cca and date = '2024-12-31';
    alter table public.ecritures_brouillon enable trigger user;
    issue := pg_temp.tente(chef, pg_temp.valider(de, 2024, pg_temp.premiere_aux_achats(lignes), null));
    texte := pg_temp.tente(chef, pg_temp.valider(de, 2024, null, null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform set_config('jd.inventaire_declare', '', true);
  perform pg_temp.verdict('VI-G1. l''ordre : la numérotation, puis l''inventaire déclaré, puis les régularisations à jour', issue || ' || ' || texte,
    issue = '22023 ' || m_numerotation and texte like '23514 L''inventaire de l''exercice 2024 n''est pas déclaré%');

  -- La validation de 2024 (le contrôle positif) : ses deux régularisations, à leur pièce, numérotées au journal OD.
  issue := pg_temp.fait(chef, pg_temp.valider(de, 2024, null, null));
  select string_agg(e.journal_code || e.numero_ecriture || ' ' || e.piece_ref || ' ' || to_char(e.piece_date, 'YYYY-MM-DD'), ', ' order by e.numero_ecriture)
    into texte from (select distinct journal_code, numero_ecriture, piece_ref, piece_date from ecritures_brouillon
                      where dossier_id = de and statut = 'validee') e;
  perform pg_temp.verdict('VI-B4. l''inventaire déclaré, l''exercice 2024 se valide : deux écritures au journal OD sous la pièce de l''état d''inventaire', issue || ' | ' || coalesce(texte, ''),
    issue = 'OK 5' and texte = 'OD1 Inventaire 2024 2024-12-31, OD2 Inventaire 2024 2024-12-31');

  -- ══ VI-G. Le gel : la déclaration de 2024 ne se retire plus, et rien ne se déclare dans un exercice figé ══
  select d.id into decl_e from inventaires_declares d where d.dossier_id = de and d.exercice = 2024 and d.retire_le is null;
  issue := pg_temp.tente(membre, format('select public.retirer_declaration_inventaire(%L)::text', decl_e));
  perform pg_temp.verdict('VI-G2. la déclaration d''un exercice validé ne se retire plus', issue, issue = '23514 ' || m_fige);
  issue := pg_temp.tente(membre, format('select public.declarer_inventaire(%L, 2023)::text', de));
  perform pg_temp.verdict('VI-G3. ni ne s''écrit dans l''exercice que la validation fige', issue, issue = '23514 ' || m_fige);
  issue := pg_temp.tente(chef, format('insert into inventaires_declares (dossier_id, exercice, declare_par) values (%L, 2023, %L) returning id::text', de, chef));
  perform pg_temp.verdict('VI-G4. même réinsérée par le super-administrateur, après la validation', issue, issue = '23514 ' || m_fige);

  -- ══ VI-E. L'extourne entière des régularisations de 2024, en 2025 ══
  issue := pg_temp.fait(membre, format('select public.declarer_inventaire(%L, 2025)::text', de));
  perform pg_temp.verdict('VI-E0. l''inventaire de 2025 déclaré', issue, issue like 'OK %');
  begin
    alter table public.ecritures_brouillon disable trigger user;
    update ecritures_brouillon set montant = 1100 where operation_inventaire_id = id_cca and date = '2025-01-01';
    alter table public.ecritures_brouillon enable trigger user;
    issue := pg_temp.tente(chef, pg_temp.valider(de, 2025, null, null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.verdict('VI-E1. l''extourne d''une régularisation de 2024 qui ne fait plus sa constatation', issue,
    issue = '23514 L''exercice 2025 ne porte pas l''extourne entière d''une régularisation d''inventaire de l''exercice 2024 : Assurance 2025 — figée avec son exercice, elle ne se réécrit plus, et l''exercice ne se valide pas sans elle.');
  begin
    alter table public.ecritures_brouillon disable trigger user;
    delete from ecritures_brouillon where operation_inventaire_id = id_fnp and date = '2025-01-01' and compte = '408100';
    alter table public.ecritures_brouillon enable trigger user;
    select public.inventaire_extourne_entiere(id_fnp)::text || ' ' || public.inventaire_extourne_entiere(id_cca)::text into issue;
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.verdict('VI-E2. une ligne d''extourne qui manque (le juge, pour la FNP ; la CCA entière)', issue, issue = 'false true');
  issue := pg_temp.fait(chef, pg_temp.valider(de, 2025, null, null));
  select count(*)::text into texte from ecritures_brouillon where dossier_id = de and statut = 'validee' and date = '2025-01-01';
  perform pg_temp.verdict('VI-E3. les extournes entières, le PCA de 2025 à jour, l''inventaire déclaré : 2025 se valide (le contrôle positif)',
    issue || ' | extournes validées : ' || texte, issue = 'OK 7' and texte = '5');

  -- ══ VI-P. Les provisions (INV4) ══
  if not provisions then
    perform pg_temp.verdict('VI-P. EN ATTENTE de la migration provisions (INV4)', 'la table des provisions est absente', true);
  else
    -- La ventilation du solde repris (INV-Q11 (A)), au premier exercice de R, déclaré.
    issue := pg_temp.fait(membre, format('select public.declarer_inventaire(%L, 2025)::text', dr));
    issue := pg_temp.tente(chef, pg_temp.valider(dr, 2025, null, null));
    perform pg_temp.verdict('VI-P1. un 151 et un 491 repris sans aucune provision : le premier compte, par son numéro', issue,
      issue = '23514 L''exercice 2025 ouvre le solde repris du compte 151100 sans le ventiler exactement en provisions : les provisions ventilées doivent faire exactement le solde repris du compte — les ventiler avant la validation.');
    issue := pg_temp.fait(membre, format('select public.enregistrer_provision(%L, %L::jsonb, null)::text', dr,
      '{"genre": "risque", "compte_provision": "151100", "objet": "Litige repris", "ouverte_en": 2025, "reprise_centimes": 60000}'));
    issue := pg_temp.fait(membre, format('select public.enregistrer_provision(%L, %L::jsonb, null)::text', dr,
      '{"genre": "depreciation_creance", "compte_provision": "491000", "objet": "Créance reprise", "ouverte_en": 2025, "reprise_centimes": 50000}'));
    issue := pg_temp.tente(chef, pg_temp.valider(dr, 2025, null, null));
    perform pg_temp.verdict('VI-P2. le 151 ventilé en partie (600 € sur 1 000 €) : toujours en écart', issue,
      issue like '23514 L''exercice 2025 ouvre le solde repris du compte 151100 sans le ventiler exactement%');
    issue := pg_temp.fait(membre, format('select public.enregistrer_provision(%L, %L::jsonb, null)::text', dr,
      '{"genre": "risque", "compte_provision": "151100", "objet": "Second litige repris", "ouverte_en": 2025, "reprise_centimes": 40000}'));
    issue := pg_temp.tente(chef, pg_temp.valider(dr, 2025, null, null));
    perform pg_temp.verdict('VI-P3. les deux comptes ventilés exactement : le premier exercice se valide (le contrôle positif)', issue, issue like 'OK %');
    -- L'évaluation d'une provision : à jour, sans extourne ; falsifiée, pas à jour ; une ligne au 1er janvier, pas entière.
    issue := pg_temp.fait(membre, format('select public.enregistrer_provision(%L, %L::jsonb, null)::text', dp,
      '{"genre": "risque", "compte_provision": "151100", "objet": "Litige prud''homal", "ouverte_en": 2024}'));
    prov := case when issue like 'OK %' then substr(issue, 4)::uuid end;
    issue := pg_temp.fait(membre, format('select public.enregistrer_evaluation_provision(%L, %L::jsonb, %L::jsonb, null)::text', dp,
      jsonb_build_object('provision_id', prov, 'exercice', 2024, 'cible_centimes', 80000),
      jsonb_build_array(jsonb_build_object('date', '2024-12-31', 'journal', 'OD', 'libelle', 'Dotation 31/12/2024 — Provision pour risques — Litige prud''homal',
        'lignes', jsonb_build_array(jsonb_build_object('compte', '681500', 'sens', 'debit', 'centimes', 80000),
                                    jsonb_build_object('compte', '151100', 'sens', 'credit', 'centimes', 80000))))));
    id_eval := case when issue like 'OK %' then substr(issue, 4)::uuid end;
    select public.inventaire_a_jour(id_eval)::text || ' ' || public.inventaire_extourne_entiere(id_eval)::text into texte;
    perform pg_temp.verdict('VI-P4. l''évaluation d''une provision (une dotation de 800 €) : à jour, et sans extourne à attendre (le contrôle positif)',
      coalesce(issue, '') || ' | ' || coalesce(texte, ''), id_eval is not null and texte = 'true true');
    begin
      alter table public.ecritures_brouillon disable trigger user;
      update ecritures_brouillon set montant = 700 where operation_inventaire_id = id_eval;
      alter table public.ecritures_brouillon enable trigger user;
      select public.inventaire_a_jour(id_eval)::text into issue;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
    end;
    perform pg_temp.verdict('VI-P5. une évaluation dont l''écriture ne fait plus l''écart : pas à jour', issue, issue = 'false');
    begin
      alter table public.ecritures_brouillon disable trigger user;
      insert into ecritures_brouillon (dossier_id, operation_inventaire_id, date, compte, libelle, montant, sens, statut) values
        (dp, id_eval, '2025-01-01', '151100', 'extourne indue', 800, 'debit', 'proposee'),
        (dp, id_eval, '2025-01-01', '681500', 'extourne indue', 800, 'credit', 'proposee');
      alter table public.ecritures_brouillon enable trigger user;
      select public.inventaire_a_jour(id_eval)::text || ' ' || public.inventaire_extourne_entiere(id_eval)::text into issue;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
    end;
    perform pg_temp.verdict('VI-P6. une provision ne s''extourne pas : une ligne au 1er janvier rend l''évaluation fausse aux deux juges', issue, issue = 'false false');
  end if;

  -- ══ Les mutations de la migration : chacune doit faire virer un contrôle au rouge ══
  -- Les mutations qui valident rejouent leur jeu dans un dossier neuf (M), le temps de leur sous-transaction : E a déjà
  -- validé 2024 et 2025.
  -- M-VI1 : la numérotation des écritures d'inventaire ôtée ; une ligne d'inventaire au journal des achats se valide.
  begin
    execute replace(pg_get_functiondef('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure),
      'if v_inventaire_mal_numerote then', 'if false then');
    insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva, compte_notes_de_frais) values
      ('a1300000-0000-4000-8000-0000000000e9', 'INV3 essai M', cabinet, 'engagement', 'redevable', '455000');
    insert into dossier_assignations (dossier_id, user_id) values ('a1300000-0000-4000-8000-0000000000e9', membre);
    perform pg_temp.fait(membre, pg_temp.regularisation('a1300000-0000-4000-8000-0000000000e9', op_cca, pg_temp.ecritures(2024, lib_cca, '[["486000","debit",120000],["616000","credit",120000]]')));
    perform pg_temp.fait(membre, format('select public.declarer_inventaire(%L, 2024)::text', 'a1300000-0000-4000-8000-0000000000e9'));
    issue := pg_temp.tente(chef, pg_temp.valider('a1300000-0000-4000-8000-0000000000e9', 2024,
      pg_temp.premiere_aux_achats(pg_temp.numerotation('a1300000-0000-4000-8000-0000000000e9', 2024)), null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into vi_mutation (mutation, observe, mord) values ('M-VI1 — la numérotation des écritures d''inventaire ôtée : une ligne d''inventaire au journal des achats', issue, issue like 'OK %');
  -- M-VI2 : l'inventaire déclaré ôté ; un exercice d'engagement sans déclaration se valide.
  begin
    execute replace(pg_get_functiondef('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure),
      'if v_mode = ''engagement'' and not exists (', 'if false and not exists (');
    issue := pg_temp.tente(chef, pg_temp.valider(db, 2025, '[]', null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into vi_mutation (mutation, observe, mord) values ('M-VI2 — l''inventaire déclaré ôté : un exercice d''engagement sans déclaration', issue, issue like 'OK %');
  -- M-VI3 : l'inventaire déclaré exigé en trésorerie aussi ; l'exercice d'un BNC se refuse.
  begin
    execute replace(pg_get_functiondef('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure),
      'if v_mode = ''engagement'' and not exists (', 'if true and not exists (');
    issue := pg_temp.tente(chef, pg_temp.valider(dt, 2025, '[]', '{}'));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into vi_mutation (mutation, observe, mord) values ('M-VI3 — l''inventaire déclaré exigé en trésorerie : un BNC ne valide plus', issue, issue like '23514 %');
  -- M-VI4 : les régularisations de l'exercice ne se jugent plus ; une constatation falsifiée se valide.
  begin
    execute replace(pg_get_functiondef('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure),
      'o.exercice = p_annee and not public.inventaire_a_jour(o.id)', 'o.exercice = p_annee and false');
    insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva, compte_notes_de_frais) values
      ('a1300000-0000-4000-8000-0000000000e9', 'INV3 essai M', cabinet, 'engagement', 'redevable', '455000');
    insert into dossier_assignations (dossier_id, user_id) values ('a1300000-0000-4000-8000-0000000000e9', membre);
    perform pg_temp.fait(membre, pg_temp.regularisation('a1300000-0000-4000-8000-0000000000e9', op_cca, pg_temp.ecritures(2024, lib_cca, '[["486000","debit",120000],["616000","credit",120000]]')));
    perform pg_temp.fait(membre, format('select public.declarer_inventaire(%L, 2024)::text', 'a1300000-0000-4000-8000-0000000000e9'));
    alter table public.ecritures_brouillon disable trigger user;
    update ecritures_brouillon set montant = 1199.99 where dossier_id = 'a1300000-0000-4000-8000-0000000000e9' and date = '2024-12-31';
    alter table public.ecritures_brouillon enable trigger user;
    issue := pg_temp.tente(chef, pg_temp.valider('a1300000-0000-4000-8000-0000000000e9', 2024, null, null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into vi_mutation (mutation, observe, mord) values ('M-VI4 — les régularisations de l''exercice plus jugées : une constatation falsifiée', issue, issue like 'OK %');
  -- M-VI5 : le juge ne lit plus l'extourne d'une régularisation de l'exercice (sa seconde date ôtée).
  begin
    execute replace(pg_get_functiondef('public.inventaire_a_jour(uuid)'::regprocedure),
      'where (a.v ->> 2)::bigint > 0 and o.nature <> ''provision''', 'where false');
    execute replace(pg_get_functiondef('public.inventaire_a_jour(uuid)'::regprocedure),
      'from public.ecritures_brouillon e where e.operation_inventaire_id = p_id', 'from public.ecritures_brouillon e where e.operation_inventaire_id = p_id and e.date = make_date(o.exercice, 12, 31)');
    insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva, compte_notes_de_frais) values
      ('a1300000-0000-4000-8000-0000000000e9', 'INV3 essai M', cabinet, 'engagement', 'redevable', '455000');
    insert into dossier_assignations (dossier_id, user_id) values ('a1300000-0000-4000-8000-0000000000e9', membre);
    perform pg_temp.fait(membre, pg_temp.regularisation('a1300000-0000-4000-8000-0000000000e9', op_cca, pg_temp.ecritures(2024, lib_cca, '[["486000","debit",120000],["616000","credit",120000]]')));
    perform pg_temp.fait(membre, format('select public.declarer_inventaire(%L, 2024)::text', 'a1300000-0000-4000-8000-0000000000e9'));
    alter table public.ecritures_brouillon disable trigger user;
    update ecritures_brouillon set montant = 1 where dossier_id = 'a1300000-0000-4000-8000-0000000000e9' and date = '2025-01-01';
    alter table public.ecritures_brouillon enable trigger user;
    issue := pg_temp.tente(chef, pg_temp.valider('a1300000-0000-4000-8000-0000000000e9', 2024, null, null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into vi_mutation (mutation, observe, mord) values ('M-VI5 — le juge sans l''extourne : une régularisation de l''exercice à l''extourne falsifiée', issue, issue like 'OK %');
  -- M-VI6 : l'extourne de l'exercice précédent ne se juge plus.
  begin
    execute replace(pg_get_functiondef('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure),
      'not public.inventaire_extourne_entiere(o.id)', 'false');
    -- Le dossier neuf valide 2024, puis voit son extourne falsifiée en 2025.
    insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva, compte_notes_de_frais) values
      ('a1300000-0000-4000-8000-0000000000e9', 'INV3 essai M', cabinet, 'engagement', 'redevable', '455000');
    insert into dossier_assignations (dossier_id, user_id) values ('a1300000-0000-4000-8000-0000000000e9', membre);
    perform pg_temp.fait(membre, pg_temp.regularisation('a1300000-0000-4000-8000-0000000000e9', op_cca, pg_temp.ecritures(2024, lib_cca, '[["486000","debit",120000],["616000","credit",120000]]')));
    perform pg_temp.fait(membre, format('select public.declarer_inventaire(%L, 2024)::text', 'a1300000-0000-4000-8000-0000000000e9'));
    perform pg_temp.fait(chef, pg_temp.valider('a1300000-0000-4000-8000-0000000000e9', 2024, null, null));
    perform pg_temp.fait(membre, format('select public.declarer_inventaire(%L, 2025)::text', 'a1300000-0000-4000-8000-0000000000e9'));
    alter table public.ecritures_brouillon disable trigger user;
    update ecritures_brouillon set montant = 1100 where dossier_id = 'a1300000-0000-4000-8000-0000000000e9' and date = '2025-01-01';
    alter table public.ecritures_brouillon enable trigger user;
    issue := pg_temp.tente(chef, pg_temp.valider('a1300000-0000-4000-8000-0000000000e9', 2025, null, null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into vi_mutation (mutation, observe, mord) values ('M-VI6 — l''extourne de l''exercice précédent plus jugée : une extourne falsifiée', issue, issue like 'OK %');
  -- M-VI7 : la ventilation des provisions reprises ôtée.
  if provisions then
    begin
      execute replace(pg_get_functiondef('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure),
        'and to_regclass(''public.provisions'') is not null then', 'and false then');
      insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva, compte_notes_de_frais) values
        ('a1300000-0000-4000-8000-0000000000e9', 'INV3 essai M', cabinet, 'engagement', 'redevable', '455000');
      insert into dossier_assignations (dossier_id, user_id) values ('a1300000-0000-4000-8000-0000000000e9', membre);
      insert into a_nouveaux (dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values
        ('a1300000-0000-4000-8000-0000000000e9', '2025-01-01', '512000', 'debit', 1000, 'essai', repeat('c', 64)),
        ('a1300000-0000-4000-8000-0000000000e9', '2025-01-01', '151100', 'credit', 1000, 'essai', repeat('c', 64));
      perform pg_temp.fait(membre, format('select public.declarer_inventaire(%L, 2025)::text', 'a1300000-0000-4000-8000-0000000000e9'));
      issue := pg_temp.tente(chef, pg_temp.valider('a1300000-0000-4000-8000-0000000000e9', 2025, null, null));
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
    end;
    insert into vi_mutation (mutation, observe, mord) values ('M-VI7 — la ventilation des provisions reprises ôtée : un 151 repris sans provision', issue, issue like 'OK %');
  end if;
  -- M-VI8 : l'accès ôté de la déclaration ; le membre déclare dans un dossier qui ne lui est pas assigné.
  begin
    execute replace(pg_get_functiondef('public.declarer_inventaire(uuid, integer)'::regprocedure),
      'not coalesce(public.admin_du_dossier(p_dossier_id), false)', 'false');
    issue := pg_temp.tente(membre, format('select public.declarer_inventaire(%L, 2024)::text', db));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into vi_mutation (mutation, observe, mord) values ('M-VI8 — l''accès ôté de la déclaration', issue, issue like 'OK %');
  -- M-VI9 : le gel ôté de la garde et du retrait ; la déclaration d'un exercice validé se retire.
  begin
    execute replace(pg_get_functiondef('public.retirer_declaration_inventaire(uuid)'::regprocedure),
      'if v_frontiere is not null and v_declaration.exercice <= extract(year from v_frontiere) then', 'if false then');
    execute replace(pg_get_functiondef('public.garder_inventaires_declares()'::regprocedure),
      'if new.exercice <= v_derniere then', 'if false then');
    issue := pg_temp.tente(membre, format('select public.retirer_declaration_inventaire(%L)::text', decl_e));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into vi_mutation (mutation, observe, mord) values ('M-VI9 — le gel ôté : la déclaration d''un exercice validé se retire', issue, issue like 'OK %');
  -- M-VI10 : la garde ouverte ; le propriétaire efface une déclaration.
  begin
    execute 'create or replace function public.garder_inventaires_declares() returns trigger language plpgsql as $g$ begin if tg_op = ''DELETE'' then return old; end if; return new; end $g$';
    issue := pg_temp.direct(format('delete from inventaires_declares where id = %L', decl_e));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into vi_mutation (mutation, observe, mord) values ('M-VI10 — la garde des déclarations ouverte : une déclaration s''efface', issue, issue = 'ACCEPTÉ');
  -- M-VI11 : la TVA d'attente jugée au compte exact du rôle ; la TVA déplacée sous sa racine n'est plus à jour (le contrôle
  -- positif VI-C3 vire au rouge).
  begin
    execute replace(pg_get_functiondef('public.inventaire_a_jour(uuid)'::regprocedure),
      'case when v_racine is not null and starts_with(e.compte, v_racine) then v_racine else e.compte end', 'e.compte');
    alter table public.ecritures_brouillon disable trigger user;
    update ecritures_brouillon set compte = '445861' where operation_inventaire_id = id_fnp and compte = '445860';
    alter table public.ecritures_brouillon enable trigger user;
    select public.inventaire_a_jour(id_fnp)::text into issue;
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into vi_mutation (mutation, observe, mord) values ('M-VI11 — la TVA d''attente jugée au compte exact : le plan qui la déplace la rend fausse', issue, issue = 'false');
  -- M-VI12 : une policy de lecture ouverte au client du dossier.
  begin
    execute 'create policy inventaires_declares_mutant on public.inventaires_declares for select to authenticated using (exists (select 1 from memberships m where m.dossier_id = inventaires_declares.dossier_id and m.user_id = auth.uid()))';
    issue := pg_temp.tente(client, format('select count(*)::text from inventaires_declares where dossier_id = %L', de));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into vi_mutation (mutation, observe, mord) values ('M-VI12 — la lecture des déclarations ouverte au client du dossier', issue, issue like 'OK %' and issue <> 'OK 0');
end
$essai$;

select 'INVARIANTS' as tableau, controle as ligne, case when ok then 'juste' else '*** EN FAUTE ***' end as resultat, observe as detail
  from vi_verdict
union all
select 'MUTATIONS', mutation, case when mord then 'le contrôle mord' else '*** NE MORD PAS ***' end, observe
  from vi_mutation
union all
select 'BILAN', 'invariants et mutations',
  (select count(*) filter (where not ok) from vi_verdict) || ' en faute / ' || (select count(*) from vi_verdict) || ' ; '
  || (select count(*) filter (where mord) from vi_mutation) || ' mutations sur ' || (select count(*) from vi_mutation) || ' qui mordent', ''
order by 1 desc, 2;

rollback;
