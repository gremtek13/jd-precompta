-- LA JAMBE DE BANQUE PAR COMPTE BANCAIRE (ligne 26.6, lot MCB5, première partie), ÉPROUVÉE EN BASE — l'essai de la
-- migration `jambe_de_banque_par_compte` (supabase/preparees/20261111200000_…, préparée le 11/11/2026), qui suit
-- `comptes_bancaires` (MCB1). À rejouer après toute migration qui touche l'une des dix fonctions qu'elle remplace,
-- `compte_de_banque_du_mouvement` ou `comptes_bancaires`. Sans la migration : une seule ligne, EN ATTENTE.
--
-- Ce qui se prouve ici :
--   - LA FORME, dans le catalogue : les sept fonctions qui classent un mouvement lisent sa banque par
--     `compte_de_banque_du_mouvement(v_ligne.id)` et ne nomment plus le rôle `banque` ; les deux qui recomposent une vente
--     facturée l'appellent pour le mouvement, deux fois chacune, sans le rôle ; `refus_compte_de_contrepartie` lit les
--     comptes bancaires du dossier ; la sécurité, la volatilité et les réglages des dix n'ont pas bougé ;
--   - LE MOUVEMENT, dans un dossier JETABLE du cabinet du dossier `test`, créé dans la sous-transaction de chaque étape :
--     un compte principal et un second compte qui tient son 512200 depuis le 01/01/2026 ; un mouvement du principal en
--     2026, un du second en 2025 (avant son 512) et un en 2026. Chaque fonction éprouvée (l'affectation, le compte de
--     bilan, le virement personnel, par le chef du cabinet en compte connecté) accepte l'écriture composée à la banque du
--     mouvement et l'écrit telle quelle, et refuse, sous ses mots d'hier, celle composée à l'autre 512 ; le refus d'une
--     contrepartie dit le 512200 un compte de banque, et pas un 512 qu'aucun compte ne tient ;
--   - QU'UN DOSSIER À UN SEUL COMPTE NE CHANGE PAS : pour chaque mouvement de la base, la banque du mouvement est celle du
--     rôle (l'écart seul se dit, jamais un compte de lignes : la règle des essais rejoués en production) ;
--   - et que RIEN ne reste en base.
-- Les recompositions d'une vente facturée ne s'éprouvent ici que par leur forme : leurs essais (ventesFacturees.sql,
-- ecrituresVentesFacturees.sql, recompositionDesVentes.sql, validationDesVentesFacturees.sql) les rejouent, à un compte,
-- identiques avant et après la migration.
--
-- Chaque étape s'annule dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), son verdict posé avant le `raise`. Les
-- verdicts voyagent dans un réglage LOCAL (`essai.jambe_de_banque`) ; aucune table créée, aucune suppression, aucune mise
-- à jour sans `where`.
do $$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  d constant text := 'cb550000-0000-4000-8000-0000000000d1';
  sec constant text := 'cb550000-0000-4000-8000-0000000000e1';
  m_p constant text := 'cb550000-0000-4000-8000-000000000101';
  m_s25 constant text := 'cb550000-0000-4000-8000-000000000102';
  m_s26 constant text := 'cb550000-0000-4000-8000-000000000103';
  sept constant text[] := array['affecter_mouvement_bancaire', 'classer_virement_personnel', 'ecrire_mouvement_compte_bilan',
    'rapprocher_cotisation', 'rapprocher_declaration_tva', 'rapprocher_echeance_emprunt', 'ventiler_mouvement_bancaire'];
  formes constant jsonb := '{"affecter_mouvement_bancaire": "invoker:v:plpgsql:search_path=public",
    "classer_virement_personnel": "invoker:v:plpgsql:search_path=public",
    "ecrire_mouvement_compte_bilan": "invoker:v:plpgsql:search_path=public",
    "rapprocher_cotisation": "invoker:v:plpgsql:search_path=public",
    "rapprocher_declaration_tva": "invoker:v:plpgsql:search_path=public",
    "rapprocher_echeance_emprunt": "invoker:v:plpgsql:search_path=public",
    "ventiler_mouvement_bancaire": "invoker:v:plpgsql:search_path=public",
    "ecriture_attendue_vente_facturee": "invoker:s:plpgsql:search_path=public",
    "ecritures_attendues_de_la_periode": "invoker:s:plpgsql:search_path=public,jit=off,enable_nestloop=off",
    "refus_compte_de_contrepartie": "invoker:s:plpgsql:search_path=public"}';
  cat constant text := 'cb550000-0000-4000-8000-0000000000c1';
  jeu text;
  etapes jsonb;
  e jsonb;
  f text;
  corps text;
  obs text;
  n int;
  accepte boolean;
  code_recu text;
  message text;
  ok boolean;
  observe text;
  avant text;
  apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations
                  where version = '20261111200000' and name = 'jambe_de_banque_par_compte') then
    perform set_config('essai.jambe_de_banque', jsonb_build_array(jsonb_build_object('controle',
      '0. EN ATTENTE de la migration jambe_de_banque_par_compte', 'ok', true,
      'observe', 'absente : l''essai se joue dès qu''elle est en base'))::text, true);
    return;
  end if;
  select concat_ws('/', (select count(*) from dossiers), (select count(*) from comptes_bancaires),
      (select count(*) from lignes_bancaires), (select count(*) from ecritures_brouillon)) into avant;

  -- ══ 1 à 4. La forme ══
  n := 0; obs := null;
  foreach f in array sept loop
    select p.prosrc into corps from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f;
    if (select count(*) from regexp_matches(corps, 'v_banque := public\.compte_de_banque_du_mouvement\(v_ligne\.id\);', 'g')) <> 1
       or corps ~ '''banque''' then
      n := n + 1; obs := concat_ws(' ; ', obs, f);
    end if;
  end loop;
  verdicts := verdicts || jsonb_build_object('controle', '1. les sept qui classent un mouvement lisent sa banque par compte_de_banque_du_mouvement, sans le rôle',
    'observe', coalesce(obs, 'conformes'), 'ok', n = 0);
  n := 0; obs := null;
  foreach f in array array['ecriture_attendue_vente_facturee', 'ecritures_attendues_de_la_periode'] loop
    select p.prosrc into corps from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f;
    if (select count(*) from regexp_matches(corps, 'public\.compte_de_banque_du_mouvement\((v_m\.id|m\.id|j\.id)\)', 'g')) <> 2
       or corps ~ '''banque''' or corps ~ '(v_banque|o\.banque)' then
      n := n + 1; obs := concat_ws(' ; ', obs, f);
    end if;
  end loop;
  verdicts := verdicts || jsonb_build_object('controle', '2. les deux recompositions d''une vente facturée prennent la banque du mouvement, deux fois',
    'observe', coalesce(obs, 'conformes'), 'ok', n = 0);
  select p.prosrc into corps from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'refus_compte_de_contrepartie';
  verdicts := verdicts || jsonb_build_object('controle', '3. le refus d''une contrepartie lit les comptes bancaires du dossier',
    'observe', case when corps ~ 'from public\.comptes_bancaires c where c\.dossier_id = p_dossier_id and c\.compte = p_compte' then 'oui' else 'NON' end,
    'ok', corps ~ 'from public\.comptes_bancaires c where c\.dossier_id = p_dossier_id and c\.compte = p_compte');
  select string_agg(q.key, ', ' order by q.key) into obs
    from jsonb_each_text(formes) q
    left join pg_proc p on p.pronamespace = 'public'::regnamespace and p.proname = q.key
    left join pg_language l on l.oid = p.prolang
   where (case when p.prosecdef then 'definer' else 'invoker' end || ':' || p.provolatile::text || ':' || l.lanname || ':'
          || coalesce(array_to_string(p.proconfig, ','), '')) is distinct from q.value;
  verdicts := verdicts || jsonb_build_object('controle', '4. la sécurité, la volatilité, le langage et les réglages des dix n''ont pas bougé',
    'observe', coalesce(obs, 'inchangés'), 'ok', obs is null);

  -- ══ 5. Un dossier à un seul compte : la banque du mouvement est celle du rôle ══
  select count(*) into n from lignes_bancaires l
   where public.compte_de_banque_du_mouvement(l.id) is distinct from public.compte_du_role(l.dossier_id, 'banque')
     and not exists (select 1 from comptes_bancaires c where c.dossier_id = l.dossier_id and c.compte is not null);
  verdicts := verdicts || jsonb_build_object('controle', '5. un mouvement d''un dossier dont aucun compte ne tient son 512 s''écrit à la banque du rôle',
    'observe', n || ' écart(s)', 'ok', n = 0);

  -- ══ 10 à 29. Le mouvement d'un second compte ══
  jeu := format($q$
    insert into dossiers (id, nom, cabinet_id) values (%1$L, 'ESSAI MCB5', %2$L);
    insert into categories (id, dossier_id, code, libelle, compte_comptable) values (%7$L, %1$L, 'essai_mcb5', 'ESSAI MCB5', '627000');
    insert into comptes_bancaires (dossier_id, libelle, principal) values (%1$L, 'Compte principal', true);
    insert into comptes_bancaires (id, dossier_id, libelle, compte, compte_propre_depuis) values (%3$L, %1$L, 'ESSAI MCB5 SECOND', '512200', '2026-01-01');
    insert into lignes_bancaires (id, dossier_id, compte_bancaire_id, date, libelle, montant) values
      (%4$L, %1$L, (select c.id from comptes_bancaires c where c.dossier_id = %1$L and c.principal), '2026-03-02', 'ESSAI MCB5', -40),
      (%5$L, %1$L, %3$L, '2025-11-04', 'ESSAI MCB5', -40),
      (%6$L, %1$L, %3$L, '2026-03-03', 'ESSAI MCB5', -40);$q$, d, cabinet, sec, m_p, m_s25, m_s26, cat);
  etapes := jsonb_build_array(
    jsonb_build_object('n', '10. la banque des trois mouvements : le principal et le second avant son 512 au rôle, le second ensuite au 512200',
      'sql', 'select 1', 'attendu', 'fait',
      'verif', format($q$select string_agg(public.compte_de_banque_du_mouvement(id::uuid), ',' order by k)
                         from unnest(array[%L, %L, %L]) with ordinality u(id, k)$q$, m_p, m_s25, m_s26),
      'egal', '512000,512000,512200'),
    jsonb_build_object('n', '11. affecter un mouvement du second compte en 2026 : face au 512200, écrite telle quelle',
      'sql', format('select affecter_mouvement_bancaire(%L, %L, %L)', m_s26, cat, jsonb_build_array(
        jsonb_build_object('compte', '627000', 'sens', 'debit', 'montant', 40, 'libelle', 'essai'),
        jsonb_build_object('compte', '512200', 'sens', 'credit', 'montant', 40, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, m_s26),
      'egal', '512200:credit:40.00,' || '627000' || ':debit:40.00'),
    jsonb_build_object('n', '12. affecter un mouvement du second compte en 2026 face au 512 du rôle : refusé',
      'sql', format('select affecter_mouvement_bancaire(%L, %L, %L)', m_s26, cat, jsonb_build_array(
        jsonb_build_object('compte', '627000', 'sens', 'debit', 'montant', 40, 'libelle', 'essai'),
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', 40, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à cette catégorie.'),
    jsonb_build_object('n', '13. affecter un mouvement du second compte en 2025, avant son 512 : face au 512 du rôle (MCB-Q7)',
      'sql', format('select affecter_mouvement_bancaire(%L, %L, %L)', m_s25, cat, jsonb_build_array(
        jsonb_build_object('compte', '627000', 'sens', 'debit', 'montant', 40, 'libelle', 'essai'),
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', 40, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, m_s25),
      'egal', '512000:credit:40.00,' || '627000' || ':debit:40.00'),
    jsonb_build_object('n', '14. affecter un mouvement du second compte en 2025 face au 512200 : refusé',
      'sql', format('select affecter_mouvement_bancaire(%L, %L, %L)', m_s25, cat, jsonb_build_array(
        jsonb_build_object('compte', '627000', 'sens', 'debit', 'montant', 40, 'libelle', 'essai'),
        jsonb_build_object('compte', '512200', 'sens', 'credit', 'montant', 40, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à cette catégorie.'),
    jsonb_build_object('n', '15. affecter un mouvement du principal : face au 512 du rôle, comme hier',
      'sql', format('select affecter_mouvement_bancaire(%L, %L, %L)', m_p, cat, jsonb_build_array(
        jsonb_build_object('compte', '627000', 'sens', 'debit', 'montant', 40, 'libelle', 'essai'),
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', 40, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, m_p),
      'egal', '512000:credit:40.00,' || '627000' || ':debit:40.00'),
    jsonb_build_object('n', '16. affecter un mouvement du principal face au 512200 : refusé',
      'sql', format('select affecter_mouvement_bancaire(%L, %L, %L)', m_p, cat, jsonb_build_array(
        jsonb_build_object('compte', '627000', 'sens', 'debit', 'montant', 40, 'libelle', 'essai'),
        jsonb_build_object('compte', '512200', 'sens', 'credit', 'montant', 40, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à cette catégorie.'),
    jsonb_build_object('n', '17. écrire au 580000 un mouvement du second compte en 2026 : face au 512200',
      'sql', format('select ecrire_mouvement_compte_bilan(%L, %L, %L)', m_s26, '580000', jsonb_build_array(
        jsonb_build_object('compte', '580000', 'sens', 'debit', 'montant', 40, 'libelle', 'essai'),
        jsonb_build_object('compte', '512200', 'sens', 'credit', 'montant', 40, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, m_s26),
      'egal', '512200:credit:40.00,580000:debit:40.00'),
    jsonb_build_object('n', '18. écrire au 580000 un mouvement du second compte en 2026 face au 512 du rôle : refusé',
      'sql', format('select ecrire_mouvement_compte_bilan(%L, %L, %L)', m_s26, '580000', jsonb_build_array(
        jsonb_build_object('compte', '580000', 'sens', 'debit', 'montant', 40, 'libelle', 'essai'),
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', 40, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et à ce compte.'),
    jsonb_build_object('n', '19. classer en virement personnel un mouvement du second compte en 2026 : face au 512200',
      'sql', format('select classer_virement_personnel(%L, %L)', m_s26, jsonb_build_array(
        jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', 40, 'libelle', 'essai'),
        jsonb_build_object('compte', '512200', 'sens', 'credit', 'montant', 40, 'libelle', 'essai'))),
      'attendu', 'fait',
      'verif', format($q$select string_agg(compte || ':' || sens || ':' || round(montant, 2), ',' order by compte collate "C")
                         from ecritures_brouillon where ligne_bancaire_id = %L and piece_id is null$q$, m_s26),
      'egal', '108000:debit:40.00,512200:credit:40.00'),
    jsonb_build_object('n', '20. classer en virement personnel un mouvement du second compte en 2026 face au 512 du rôle : refusé',
      'sql', format('select classer_virement_personnel(%L, %L)', m_s26, jsonb_build_array(
        jsonb_build_object('compte', '108000', 'sens', 'debit', 'montant', 40, 'libelle', 'essai'),
        jsonb_build_object('compte', '512000', 'sens', 'credit', 'montant', 40, 'libelle', 'essai'))),
      'attendu', '22023|L''écriture proposée ne correspond pas à ce mouvement et au compte du dirigeant (108000).'),
    jsonb_build_object('n', '21. le 512200 d''un compte bancaire du dossier n''est pas une contrepartie ; un 512 qu''aucun compte ne tient, si',
      'sql', 'select 1', 'attendu', 'fait',
      'verif', format($q$select concat_ws(' / ', coalesce(public.refus_compte_de_contrepartie(%1$L, '512200'), 'accepté'),
                                coalesce(public.refus_compte_de_contrepartie(%1$L, '512000'), 'accepté'),
                                coalesce(public.refus_compte_de_contrepartie(%1$L, '512300'), 'accepté'))$q$, d),
      'egal', 'Un encaissement par la banque, par chèque ou en espèces se dit par son moyen de paiement, qui choisit son compte. / '
        || 'Un encaissement par la banque, par chèque ou en espèces se dit par son moyen de paiement, qui choisit son compte. / accepté')
  );

  for e in select * from jsonb_array_elements(etapes) loop
    accepte := false; code_recu := null; message := null; obs := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      execute jeu;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
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
      (select count(*) from lignes_bancaires), (select count(*) from ecritures_brouillon)) into apres;
  verdicts := verdicts || jsonb_build_object('controle', '99. rien n''est resté en base',
    'observe', 'écarts ' || (select string_agg(to_char(x.b::bigint - x.a::bigint, 'FMSG9999999990'), '/' order by x.r)
                             from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality x(a, b, r)),
    'ok', avant = apres);
  perform set_config('essai.jambe_de_banque', verdicts::text, true);
end $$;

select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.jambe_de_banque')::jsonb) as v(controle text, ok boolean, observe text)
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
