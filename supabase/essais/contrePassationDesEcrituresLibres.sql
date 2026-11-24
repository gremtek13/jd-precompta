-- ESSAI DE LA CONTRE-PASSATION DES ÉCRITURES LIBRES (EL7, conception 54 ; migration `contre_passation_des_ecritures_libres`,
-- PRÉPARÉE le 24/11/2026). SUR UNE RÉPLIQUE SEULEMENT : il crée des dossiers, des écritures libres, des à-nouveaux et des
-- exercices validés fictifs, suspend les déclencheurs d'une table le temps d'une sous-transaction, mute des fonctions, une garde
-- et une contrainte, et retire ce qu'il a écrit. Joué ENTIER, en une transaction qui s'annule (`begin` … `rollback`), par psql,
-- sans `-1` :
--   psql -v ON_ERROR_STOP=1 -f supabase/essais/contrePassationDesEcrituresLibres.sql
--
-- Ce qu'il juge, par impersonation (le chef, qui est aussi super-administrateur dans le semis ; un membre de l'équipe assigné ;
-- le même membre sur un dossier qui ne lui est pas assigné ; un client qui a un accès au dossier ; l'anonyme) :
--   CP-A. l'accès (EL-Q1) : le chef et le membre assigné contre-passent, l'auteur, le numéro et le lien posés par la base ; le
--         membre non assigné, le client, l'anonyme, une écriture inconnue : refusés sans rien apprendre ;
--   CP-B. chaque refus de `contre_passer_ecriture_libre`, sous son code et ses MOTS (ceux de
--         src/lib/contrePassationDesEcrituresLibres.ts), dans l'ordre : la version, l'écriture (figée, sans extourne, pas encore
--         contre-passée), la date, l'effet sur la 2035, le libellé, le motif, l'écriture d'origine relue, l'écriture proposée ;
--   CP-C. la composition : les lignes au sens inverse, au centime, à leur date, sous leur libellé, au brouillon ; les postes de
--         l'écriture d'origine, ou nuls hors de la 2035 ; en engagement, aucun poste ;
--   CP-D. le retrait d'une contre-passation non figée (l'écriture d'origine redevient à contre-passer), le gel d'une
--         contre-passation figée (elle ne se retire plus, elle se contre-passe à son tour) ;
--   CP-E. la garde de la colonne : une contre-passation ne se remplace pas ; elle ne s'écrit que par sa fonction ou la
--         réinsertion du super-administrateur, et cite une écriture de son dossier ; une seule par écriture ; jamais d'extourne ;
--         une écriture contre-passée ne change ni ne se retire plus ;
--   CP-F. le catalogue : la colonne et ses contraintes, l'ordre des déclencheurs (la porte, la garde de la table, celle de la
--         contre-passation), les droits d'exécution.
-- Puis des MUTATIONS de la migration, chacune dans une sous-transaction annulée, qui doivent faire virer un contrôle au rouge ;
-- une mutation dont le texte visé n'est pas dans la fonction l'arrête (`pg_temp.muter`), plutôt que de passer pour tuée.
-- Se lit : toute ligne « en faute » est une faute de la migration ; toute mutation qui « NE MORD PAS » est un contrôle qui ne
-- prouve plus rien. Sans la migration, une ligne dit qu'il attend (EN ATTENTE).

begin;

create temp table cp_verdict (rang serial, controle text, observe text, ok boolean);
create temp table cp_mutation (rang serial, mutation text, observe text, mord boolean);

-- Tente une requête SOUS une identité (nulle : l'anonyme), et l'annule : rend « OK <résultat> » ou « <sqlstate> <message> ».
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
    raise exception 'ANNULATION_TENTATIVE';
  exception when others then
    if sqlerrm <> 'ANNULATION_TENTATIVE' then
      v_issue := sqlstate || ' ' || sqlerrm;
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_issue;
end
$$;

-- La même, qui GARDE ce qu'elle a écrit.
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
end
$$;

-- Le propriétaire, hors de toute session, dans une sous-transaction annulée, le chemin d'`enregistrer_ecriture_libre` ouvert sur
-- un dossier (le réglage local que sa garde lit, annulé avec la sous-transaction) : « OK <résultat> » ou « <sqlstate> <message> ».
create function pg_temp.proprietaire(p_dossier uuid, p_sql text) returns text language plpgsql as $$
declare
  v_resultat text;
  v_issue text;
begin
  begin
    perform set_config('jd.ecriture_libre', p_dossier::text, true);
    execute p_sql into v_resultat;
    v_issue := 'OK ' || coalesce(v_resultat, '');
    raise exception 'ANNULATION_TENTATIVE';
  exception when others then
    if sqlerrm <> 'ANNULATION_TENTATIVE' then
      v_issue := sqlstate || ' ' || sqlerrm;
    end if;
  end;
  return v_issue;
end
$$;

-- Une mutation : le texte visé remplacé dans le corps de la fonction, qui doit y être UNE fois — sinon l'essai s'arrête.
create function pg_temp.muter(p_fonction regprocedure, p_avant text, p_apres text) returns void language plpgsql as $$
declare
  v_def text := pg_get_functiondef(p_fonction);
begin
  if (length(v_def) - length(replace(v_def, p_avant, ''))) / length(p_avant) <> 1 then
    raise exception 'MUTATION_INTROUVABLE % : %', p_fonction, p_avant;
  end if;
  execute replace(v_def, p_avant, p_apres);
end
$$;

-- L'écriture d'origine telle que `ecritureLibrePourLaBase` la donne : `lignes` = [[compte, sens, centimes, poste]…].
create function pg_temp.ecriture(p_date text, p_libelle text, p_lignes jsonb, p_extourne boolean) returns jsonb language sql as $$
  select jsonb_build_object('id', null, 'date', p_date, 'libelle', p_libelle, 'motif', 'Motif de l''essai.',
    'avec_extourne', p_extourne, 'piece_citee_id', null,
    'lignes', (select jsonb_agg(jsonb_build_object('compte', l ->> 0, 'sens', l ->> 1, 'centimes', (l -> 2),
                                                   'poste_2035', l -> 3, 'compte_lib', null) order by r)
                 from jsonb_array_elements(p_lignes) with ordinality x(l, r)))
$$;
-- Les écritures que `composerEcrituresLibres` en propose.
create function pg_temp.ecritures(p_date text, p_libelle text, p_lignes jsonb, p_extourne boolean) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('date', p_date, 'journal', 'OD', 'libelle', p_libelle,
      'lignes', (select jsonb_agg(jsonb_build_object('compte', l ->> 0, 'sens', l ->> 1, 'centimes', (l -> 2)) order by r)
                   from jsonb_array_elements(p_lignes) with ordinality x(l, r))))
  || case when p_extourne then jsonb_build_array(jsonb_build_object('date', (left(p_date, 4)::integer + 1) || '-01-01', 'journal', 'OD',
      'libelle', 'Extourne — ' || p_libelle,
      'lignes', (select jsonb_agg(jsonb_build_object('compte', l ->> 0, 'sens', case l ->> 1 when 'debit' then 'credit' else 'debit' end,
                                                     'centimes', (l -> 2)) order by r)
                   from jsonb_array_elements(p_lignes) with ordinality x(l, r)))) else '[]'::jsonb end
$$;
-- L'enregistrement d'une écriture d'origine, en texte, pour `fait`.
create function pg_temp.saisie(p_dossier uuid, p_id uuid, p_date text, p_libelle text, p_lignes jsonb, p_extourne boolean,
  p_version integer) returns text language sql as $$
  select format('select public.enregistrer_ecriture_libre(%L::uuid, %L::jsonb, %L::jsonb, %s)::text', p_dossier,
                jsonb_set(pg_temp.ecriture(p_date, p_libelle, p_lignes, p_extourne), '{id}', coalesce(to_jsonb(p_id), 'null'::jsonb)),
                pg_temp.ecritures(p_date, p_libelle, p_lignes, p_extourne), coalesce(p_version::text, 'null'))
$$;

-- La contre-passation telle que `contrePassationPourLaBase` la donne, et l'écriture que `composerLaContrePassation` propose :
-- les lignes de l'écriture d'origine, au sens inverse.
create function pg_temp.saisie_cp(p_date text, p_libelle text, p_motif text, p_hors jsonb) returns jsonb language sql as $$
  select jsonb_build_object('date', p_date, 'libelle', p_libelle, 'motif', p_motif, 'hors_de_la_2035', p_hors)
$$;
create function pg_temp.proposee(p_date text, p_libelle text, p_lignes jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('date', p_date, 'journal', 'OD', 'libelle', p_libelle,
    'lignes', (select jsonb_agg(jsonb_build_object('compte', l ->> 0, 'sens', case l ->> 1 when 'debit' then 'credit' else 'debit' end,
                                                   'centimes', (l -> 2)) order by r)
                 from jsonb_array_elements(p_lignes) with ordinality x(l, r))))
$$;
create function pg_temp.cp(p_id uuid, p_version integer, p_saisie jsonb, p_proposee jsonb) returns text language sql as $$
  select format('select public.contre_passer_ecriture_libre(%L::uuid, %s, %L::jsonb, %L::jsonb)::text',
                p_id, coalesce(p_version::text, 'null'), p_saisie, p_proposee)
$$;
-- L'appel complet : la saisie et l'écriture proposée tirée des lignes de l'écriture d'origine.
create function pg_temp.contre_passer(p_id uuid, p_version integer, p_date text, p_libelle text, p_lignes jsonb, p_hors boolean)
returns text language sql as $$
  select pg_temp.cp(p_id, p_version, pg_temp.saisie_cp(p_date, p_libelle, 'Contre-passée : l''écriture était fausse.', to_jsonb(p_hors)),
                    pg_temp.proposee(p_date, p_libelle, p_lignes))
$$;

create function pg_temp.verdict(p_controle text, p_observe text, p_ok boolean) returns void language sql as $$
  insert into cp_verdict (controle, observe, ok) values (p_controle, p_observe, coalesce(p_ok, false))
$$;

do $essai$
declare
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre uuid := '3e3b0000-0000-4000-8000-000000000001';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  cabinet uuid := 'cab10000-0000-4000-8000-000000000001';
  dv uuid := 'e1570000-0000-4000-8000-0000000000a1';   -- trésorerie, assigné au membre, ouvert au client ; 2024 validé
  dn uuid := 'e1570000-0000-4000-8000-0000000000a2';   -- trésorerie, NON assigné au membre ; 2024 validé
  de uuid := 'e1570000-0000-4000-8000-0000000000a3';   -- engagement, assigné ; 2024 validé
  dov uuid := 'e1570000-0000-4000-8000-0000000000a4';  -- trésorerie, assigné ; 2024 validé, ses à-nouveaux au 1er mars 2025
  dr uuid := 'e1570000-0000-4000-8000-0000000000a5';   -- trésorerie, assigné ; rien de validé (la restauration)
  inconnue uuid := 'e1570000-0000-4000-8000-0000000000ff';
  -- Les mots du module (src/lib/contrePassationDesEcrituresLibres.ts, MOTS_DE_LA_CONTRE_PASSATION), au caractère près.
  m_acces text := 'Accès refusé à cette écriture libre.';
  m_version text := 'Cette écriture libre a changé depuis sa lecture : relire les écritures avant de l’écrire.';
  m_non_figee text := 'Seule une écriture libre d’un exercice validé se contre-passe : avant la validation, elle se modifie ou se retire.';
  m_extournee text := 'Une écriture extournée au 1er janvier suivant ne se contre-passe pas : son extourne la défait déjà.';
  m_deja text := 'Cette écriture libre a déjà sa contre-passation : une écriture ne se contre-passe qu’une fois.';
  m_date text := 'La date de l’écriture se lit en une date civile, entre 2000 et 2100.';
  m_fige text := 'Cette date est dans un exercice validé : une écriture libre ne s’y passe plus.';
  m_ouverture text := 'Cette date précède l’ouverture du dossier dans l’application : l’écriture n’y a pas de place.';
  m_a_venir text := 'Une écriture libre se date au plus tard du 31 décembre de l’année en cours.';
  m_effet text := 'L’effet sur la 2035 se choisit : hors de la 2035, ou les postes de l’écriture d’origine, au sens inverse.';
  m_libelle text := 'Le libellé de l’écriture tient en 1 à 200 caractères, sur une ligne : il part au FEC.';
  m_motif text := 'Le motif de l’écriture tient en 1 à 2 000 caractères : il dit pourquoi l’écriture est passée.';
  m_illisible text := 'L’écriture d’origine ne se relit pas comme la base l’écrit : elle ne se contre-passe pas.';
  m_ecritures text := 'Les écritures proposées ne sont pas celles de l’écriture libre : les recomposer.';
  m_chemin text := 'Une contre-passation ne s’écrit que par contre_passer_ecriture_libre.';
  m_dossier text := 'Une contre-passation cite une écriture libre de son dossier.';
  m_remplacement text := 'Une contre-passation ne se remplace pas : la retirer, puis contre-passer de nouveau.';
  m_contre_passee text := 'Cette écriture libre est contre-passée : elle ne change ni ne se retire plus tant que sa contre-passation la cite.';
  -- Les écritures d'origine.
  reclassement jsonb := '[["606400","debit",12000,"Fournitures de bureau"],["606300","credit",12000,"Petit outillage"]]';
  part_privee jsonb := '[["108000","debit",5000,null],["606400","credit",5000,"Fournitures de bureau"]]';
  rattachee jsonb := '[["622600","debit",50000,null],["408100","credit",50000,null]]';
  bilan jsonb := '[["606400","debit",700,null],["401000","credit",700,null]]';
  a_venir text := (extract(year from (now() at time zone 'Europe/Paris'))::integer + 1) || '-01-15';
  enr regprocedure := 'public.enregistrer_ecriture_libre(uuid, jsonb, jsonb, integer)'::regprocedure;
  fn regprocedure;
  garde regprocedure;
  issue text;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid; en uuid; ee uuid; eov uuid; er uuid; cr uuid;
  c1 uuid; c2 uuid; c2b uuid; ce uuid; c1b uuid;
  n bigint;
  texte text;
begin
  if not exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.ecritures_libres')
                   and a.attname = 'contre_passe_id' and not a.attisdropped) then
    perform pg_temp.verdict('0. EN ATTENTE de la migration contre_passation_des_ecritures_libres',
      'absente : l''essai se joue dès que la migration y est', true);
    return;
  end if;
  fn := 'public.contre_passer_ecriture_libre(uuid, integer, jsonb, jsonb)'::regprocedure;
  garde := 'public.garder_contre_passation_des_ecritures_libres()'::regprocedure;

  -- ── Le jeu, écrit par le propriétaire, puis les écritures d'origine par leurs fonctions, puis la validation de 2024 ──
  insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva) values
    (dv, 'EL7 essai V', cabinet, 'tresorerie', 'franchise'), (dn, 'EL7 essai N', cabinet, 'tresorerie', 'franchise'),
    (de, 'EL7 essai E', cabinet, 'engagement', 'redevable'), (dov, 'EL7 essai O', cabinet, 'tresorerie', 'franchise'),
    (dr, 'EL7 essai R', cabinet, 'tresorerie', 'franchise');
  insert into dossier_assignations (dossier_id, user_id) values (dv, membre), (de, membre), (dov, membre), (dr, membre);
  insert into memberships (user_id, dossier_id, role, email) values (client, dv, 'client', 'essai-el7@example.test');
  e1 := substr(pg_temp.fait(chef, pg_temp.saisie(dv, null, '2024-06-30', 'Reclassement des fournitures', reclassement, false, null)), 4)::uuid;
  e2 := substr(pg_temp.fait(chef, pg_temp.saisie(dv, null, '2024-09-30', 'Part privée des fournitures', part_privee, false, null)), 4)::uuid;
  e3 := substr(pg_temp.fait(chef, pg_temp.saisie(dv, null, '2024-12-31', 'Charge à payer — honoraires', rattachee, true, null)), 4)::uuid;
  e5 := substr(pg_temp.fait(chef, pg_temp.saisie(dv, null, '2024-03-31', 'Reclassement de mars', reclassement, false, null)), 4)::uuid;
  en := substr(pg_temp.fait(chef, pg_temp.saisie(dn, null, '2024-06-30', 'Reclassement N', reclassement, false, null)), 4)::uuid;
  ee := substr(pg_temp.fait(chef, pg_temp.saisie(de, null, '2024-06-30', 'Facture rattachée', bilan, false, null)), 4)::uuid;
  eov := substr(pg_temp.fait(chef, pg_temp.saisie(dov, null, '2024-06-30', 'Reclassement O', reclassement, false, null)), 4)::uuid;
  insert into a_nouveaux (dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values
    (dov, '2025-03-01', '512000', 'debit', 100, 'essai', repeat('a', 64)),
    (dov, '2025-03-01', '101000', 'credit', 100, 'essai', repeat('a', 64));
  -- (Une ligne d'exercices_valides posée par le propriétaire, sans la validation : seul compte ici le gel ; « engagement », qui
  -- n'exige pas de déclaration 2035 — le patron de ecrituresLibres.sql.)
  insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte)
    select d, 2024, now(), chef, 'engagement', 0, 0, 0, 0, repeat('0', 64) from unnest(array[dv, dn, de, dov]) d;
  e4 := substr(pg_temp.fait(chef, pg_temp.saisie(dv, null, '2025-03-31', 'Reclassement de 2025', reclassement, false, null)), 4)::uuid;
  e6 := substr(pg_temp.fait(chef, pg_temp.saisie(dr, null, '2026-02-28', 'Reclassement ouvert', reclassement, false, null)), 4)::uuid;
  perform pg_temp.verdict('CP-0. le jeu : neuf écritures d''origine enregistrées par leur fonction, 2024 validé dans quatre dossiers',
    concat_ws(' ', e1, e2, e3, e4, e5, e6, en, ee, eov),
    num_nonnulls(e1, e2, e3, e4, e5, e6, en, ee, eov) = 9 and public.frontiere_validation(dv) = '2024-12-31');

  -- ══ CP-A. L'accès (EL-Q1) ══
  issue := pg_temp.fait(chef, pg_temp.cp(e1, 1, pg_temp.saisie_cp('2025-01-01', '  Contre-passation de EL2024-0001 — Reclassement des fournitures ',
    '  L''écriture de juin portait le mauvais compte.  ', 'false'),
    pg_temp.proposee('2025-01-01', 'Contre-passation de EL2024-0001 — Reclassement des fournitures', reclassement)));
  c1 := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('CP-A1. le chef contre-passe une écriture figée, au premier jour de l''exercice ouvert (le contrôle positif)', issue, c1 is not null);
  issue := pg_temp.fait(membre, pg_temp.contre_passer(e2, 1, '2025-02-15', 'Contre-passation de la part privée', part_privee, true));
  c2 := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('CP-A2. un membre assigné contre-passe, hors de la 2035 (EL-Q1, le contrôle positif)', issue, c2 is not null);
  select count(*) into n from ecritures_libres
   where (id = c1 and cree_par = chef and exercice = 2025 and numero = 2 and contre_passe_id = e1 and version = 1 and not avec_extourne
          and piece_citee_id is null and modifie_par is null and libelle = 'Contre-passation de EL2024-0001 — Reclassement des fournitures'
          and motif = 'L''écriture de juin portait le mauvais compte.' and dossier_id = dv)
      or (id = c2 and cree_par = membre and exercice = 2025 and numero = 3 and contre_passe_id = e2);
  perform pg_temp.verdict('CP-A3. l''auteur, le numéro de l''année, le lien, la version 1, le libellé et le motif rognés : posés par la base', n::text, n = 2);
  issue := pg_temp.tente(membre, pg_temp.contre_passer(en, 1, '2025-01-01', 'X', reclassement, true));
  perform pg_temp.verdict('CP-A4. le membre sur un dossier qui ne lui est pas assigné (42501)', issue, issue = '42501 ' || m_acces);
  issue := pg_temp.tente(client, pg_temp.contre_passer(e5, 1, '2025-01-01', 'X', reclassement, true));
  perform pg_temp.verdict('CP-A5. le client du dossier (42501)', issue, issue = '42501 ' || m_acces);
  issue := pg_temp.tente(null, pg_temp.contre_passer(e5, 1, '2025-01-01', 'X', reclassement, true));
  perform pg_temp.verdict('CP-A6. l''anonyme (42501, l''exécution retirée)', issue, issue like '42501 %');
  issue := pg_temp.tente(membre, pg_temp.contre_passer(inconnue, 1, '2025-01-01', 'X', reclassement, true));
  perform pg_temp.verdict('CP-A7. une écriture inconnue (42501 : rien n''apprend qu''elle existe)', issue, issue = '42501 ' || m_acces);

  -- ══ CP-B. Les refus, sous leurs mots et leurs codes, dans l'ordre ══
  issue := pg_temp.tente(membre, pg_temp.contre_passer(e3, 9, '2025-01-01', 'X', rattachee, true));
  perform pg_temp.verdict('CP-B1. une version dépassée, avant l''état de l''écriture (40001)', issue, issue = '40001 ' || m_version);
  issue := pg_temp.tente(membre, pg_temp.contre_passer(e4, 1, '2025-06-30', 'X', reclassement, true));
  perform pg_temp.verdict('CP-B2. une écriture d''un exercice ouvert : elle se modifie ou se retire (23514)', issue, issue = '23514 ' || m_non_figee);
  issue := pg_temp.tente(membre, pg_temp.contre_passer(e3, 1, '2025-06-30', 'X', rattachee, true));
  perform pg_temp.verdict('CP-B3. une écriture extournée au 1er janvier suivant (23514)', issue, issue = '23514 ' || m_extournee);
  issue := pg_temp.tente(membre, pg_temp.contre_passer(e1, 1, '2025-06-30', 'X', reclassement, true));
  perform pg_temp.verdict('CP-B4. une écriture déjà contre-passée (23514)', issue, issue = '23514 ' || m_deja);
  issue := pg_temp.tente(membre, pg_temp.contre_passer(e5, 1, '2025-02-30', 'X', reclassement, true));
  perform pg_temp.verdict('CP-B5. une date qui n''existe pas (22023)', issue, issue = '22023 ' || m_date);
  issue := pg_temp.tente(membre, pg_temp.contre_passer(e5, 1, '2024-12-31', 'X', reclassement, true));
  perform pg_temp.verdict('CP-B6. une date de l''exercice validé (23514)', issue, issue = '23514 ' || m_fige);
  issue := pg_temp.tente(membre, pg_temp.contre_passer(eov, 1, '2025-01-15', 'X', reclassement, true));
  perform pg_temp.verdict('CP-B7. une date avant l''ouverture du dossier (22023)', issue, issue = '22023 ' || m_ouverture);
  issue := pg_temp.tente(membre, pg_temp.contre_passer(e5, 1, a_venir, 'X', reclassement, true));
  perform pg_temp.verdict('CP-B8. une date après le 31 décembre de l''année en cours (22023)', issue, issue = '22023 ' || m_a_venir);
  issue := pg_temp.tente(membre, pg_temp.cp(e5, 1, pg_temp.saisie_cp('2025-06-30', 'X', 'Motif.', '"oui"'), pg_temp.proposee('2025-06-30', 'X', reclassement)));
  perform pg_temp.verdict('CP-B9. un effet sur la 2035 illisible (22023)', issue, issue = '22023 ' || m_effet);
  issue := pg_temp.tente(membre, pg_temp.cp(e5, 1, pg_temp.saisie_cp('2025-06-30', 'X', 'Motif.', null), pg_temp.proposee('2025-06-30', 'X', reclassement)));
  perform pg_temp.verdict('CP-B10. un effet sur la 2035 absent : aucun défaut (22023)', issue, issue = '22023 ' || m_effet);
  issue := pg_temp.tente(membre, pg_temp.contre_passer(e5, 1, '2025-06-30', '   ', reclassement, true));
  perform pg_temp.verdict('CP-B11. un libellé vide (22023)', issue, issue = '22023 ' || m_libelle);
  issue := pg_temp.tente(membre, pg_temp.contre_passer(e5, 1, '2025-06-30', 'Deux' || chr(10) || 'lignes', reclassement, true));
  perform pg_temp.verdict('CP-B12. un libellé sur deux lignes (22023)', issue, issue = '22023 ' || m_libelle);
  issue := pg_temp.tente(membre, pg_temp.cp(e5, 1, pg_temp.saisie_cp('2025-06-30', 'X', ' ', 'true'), pg_temp.proposee('2025-06-30', 'X', reclassement)));
  perform pg_temp.verdict('CP-B13. un motif vide : il est obligatoire (22023)', issue, issue = '22023 ' || m_motif);
  issue := pg_temp.tente(membre, pg_temp.cp(e5, 1, pg_temp.saisie_cp('2025-06-30', 'X', 'Motif.', 'true'),
    pg_temp.proposee('2025-06-30', 'X', '[["606400","debit",11999],["606300","credit",12000]]')));
  perform pg_temp.verdict('CP-B14. un centime de moins dans ce que l''application propose (22023)', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.cp(e5, 1, pg_temp.saisie_cp('2025-06-30', 'X', 'Motif.', 'true'),
    jsonb_set(pg_temp.proposee('2025-06-30', 'X', reclassement), '{0,lignes}', pg_temp.ecritures('2025-06-30', 'X', reclassement, false) -> 0 -> 'lignes')));
  perform pg_temp.verdict('CP-B15. l''écriture d''origine recopiée sans son sens inverse (22023)', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.cp(e5, 1, pg_temp.saisie_cp('2025-06-30', 'X', 'Motif.', 'true'), pg_temp.proposee('2025-06-30', 'Y', reclassement)));
  perform pg_temp.verdict('CP-B16. un autre libellé (22023)', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.cp(e5, 1, pg_temp.saisie_cp('2025-06-30', 'X', 'Motif.', 'true'), pg_temp.proposee('2025-06-29', 'X', reclassement)));
  perform pg_temp.verdict('CP-B17. une autre date (22023)', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.cp(e5, 1, pg_temp.saisie_cp('2025-06-30', 'X', 'Motif.', 'true'),
    jsonb_set(pg_temp.proposee('2025-06-30', 'X', reclassement), '{0,journal}', '"AC"')));
  perform pg_temp.verdict('CP-B18. un autre journal (22023)', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.cp(e5, 1, pg_temp.saisie_cp('2025-06-30', 'X', 'Motif.', 'true'),
    pg_temp.proposee('2025-06-30', 'X', reclassement) || pg_temp.proposee('2025-06-30', 'X', reclassement)));
  perform pg_temp.verdict('CP-B19. deux écritures proposées (22023)', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.cp(e5, 1, pg_temp.saisie_cp('2025-06-30', 'X', 'Motif.', 'true'), '{"lignes":[]}'));
  perform pg_temp.verdict('CP-B20. une proposition qui n''est pas un tableau (22023)', issue, issue = '22023 ' || m_ecritures);
  begin
    alter table public.ecritures_libres disable trigger user;
    update public.ecritures_libres set lignes = '[{"compte":"606400","sens":"debut","centimes":12000},{"compte":"606300","sens":"credit","centimes":12000}]'
     where id = e5;
    alter table public.ecritures_libres enable trigger user;
    issue := pg_temp.tente(membre, pg_temp.contre_passer(e5, 1, '2025-06-30', 'X', reclassement, true));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  perform pg_temp.verdict('CP-B21. une écriture d''origine que la base n''écrit pas ainsi (une restauration abîmée) : rien ne se devine (23514)',
    issue, issue = '23514 ' || m_illisible);

  -- ══ CP-C. La composition ══
  select string_agg(date || ' ' || compte || ' ' || sens || ' ' || montant || ' ' || statut || ' ' || libelle, ' / ' order by compte) into texte
    from ecritures_brouillon where ecriture_libre_id = c1;
  perform pg_temp.verdict('CP-C1. au brouillon : les deux lignes au sens inverse, au centime, à sa date, sous son libellé, proposées', texte,
    texte = '2025-01-01 606300 debit 120.00 proposee Contre-passation de EL2024-0001 — Reclassement des fournitures / '
         || '2025-01-01 606400 credit 120.00 proposee Contre-passation de EL2024-0001 — Reclassement des fournitures');
  select lignes::text into texte from ecritures_libres where id = c1;
  perform pg_temp.verdict('CP-C2. ses lignes saisies : l''ordre de l''écriture d''origine, le sens inverse, les postes de la 2035 gardés', texte,
    texte = '[{"sens": "credit", "compte": "606400", "centimes": 12000, "compte_lib": null, "poste_2035": "Fournitures de bureau"}, '
         || '{"sens": "debit", "compte": "606300", "centimes": 12000, "compte_lib": null, "poste_2035": "Petit outillage"}]');
  select lignes::text into texte from ecritures_libres where id = c2;
  perform pg_temp.verdict('CP-C3. hors de la 2035 : chaque poste nul, même celui que portait l''écriture d''origine', texte,
    texte = '[{"sens": "credit", "compte": "108000", "centimes": 5000, "compte_lib": null, "poste_2035": null}, '
         || '{"sens": "debit", "compte": "606400", "centimes": 5000, "compte_lib": null, "poste_2035": null}]');
  issue := pg_temp.fait(membre, pg_temp.contre_passer(ee, 1, '2025-01-01', 'Contre-passation de la facture rattachée', bilan, false));
  ce := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  select coalesce(string_agg(l ->> 'compte' || ' ' || (l ->> 'sens') || ' ' || coalesce(l ->> 'poste_2035', 'nul'), ' / ' order by r), '') into texte
    from ecritures_libres e cross join lateral jsonb_array_elements(e.lignes) with ordinality x(l, r) where e.id = ce;
  perform pg_temp.verdict('CP-C4. en engagement : la contre-passation passe, aucun poste, le sens inverse', issue || ' ' || coalesce(texte, ''),
    ce is not null and texte = '606400 credit nul / 401000 debit nul');

  -- ══ CP-E. La garde de la colonne (avant le gel de 2025) ══
  issue := pg_temp.tente(membre, pg_temp.saisie(dv, c1, '2025-01-01', 'Contre-passation corrigée', reclassement, false, 1));
  perform pg_temp.verdict('CP-E1. une contre-passation ne se remplace pas : enregistrer_ecriture_libre la refuse (23514)', issue, issue = '23514 ' || m_remplacement);
  issue := pg_temp.tente(membre, format($q$insert into ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, cree_par, contre_passe_id)
    values (%L, 2025, 90, '2025-04-30', 'Direct', 'Direct', '[{},{}]', %L, %L) returning 1$q$, dv, membre, e5));
  perform pg_temp.verdict('CP-E2. le membre n''insère pas une contre-passation en direct (42501)', issue, issue like '42501 %');
  issue := pg_temp.tente(chef, format($q$insert into ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, cree_par, contre_passe_id)
    values (%L, 2025, 90, '2025-04-30', 'Restaurée', 'Restaurée', '[{},{}]', %L, %L) returning 1$q$, dv, chef, en));
  perform pg_temp.verdict('CP-E3. la réinsertion du super-administrateur cite une écriture de son dossier (23514)', issue, issue = '23514 ' || m_dossier);
  issue := pg_temp.tente(chef, format($q$insert into ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, cree_par, contre_passe_id)
    values (%L, 2025, 90, '2025-04-30', 'Restaurée', 'Restaurée', '[{},{}]', %L, %L) returning 1$q$, dv, chef, e1));
  perform pg_temp.verdict('CP-E4. une seule contre-passation par écriture, la restauration comprise (23505)', issue,
    issue like '23505 %ecritures_libres_une_contre_passation%');
  issue := pg_temp.tente(chef, format($q$insert into ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, cree_par, contre_passe_id, avec_extourne)
    values (%L, 2025, 90, '2025-12-31', 'Restaurée', 'Restaurée', '[{},{}]', %L, %L, true) returning 1$q$, dv, chef, e5));
  perform pg_temp.verdict('CP-E5. une contre-passation n''a jamais d''extourne (23514)', issue,
    issue like '23514 %ecritures_libres_contre_passation_sans_extourne%');
  issue := pg_temp.tente(chef, format($q$insert into ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, cree_par, contre_passe_id)
    values (%L, 2025, 90, '2025-04-30', 'Restaurée', 'Restaurée', '[{},{}]', %L, %L) returning 1$q$, dv, chef, e5));
  perform pg_temp.verdict('CP-E6. la réinsertion du super-administrateur, dans son dossier (la restauration, le contrôle positif)', issue, issue = 'OK 1');
  issue := pg_temp.proprietaire(dv, format($q$insert into ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, cree_par, contre_passe_id)
    values (%L, 2025, 90, '2025-04-30', 'Par le chemin d''enregistrer', 'Direct', '[{},{}]', %L, %L) returning 1$q$, dv, chef, e5));
  perform pg_temp.verdict('CP-E7. le chemin d''enregistrer_ecriture_libre ne pose pas une contre-passation (42501)', issue, issue = '42501 ' || m_chemin);
  -- L'écriture contre-passée ne change ni ne se retire plus : une paire réinsérée par la restauration dans un dossier sans
  -- exercice validé (l'écriture d'origine n'y est pas figée — le jour du dégel, EL9, ce sera le cas).
  issue := pg_temp.fait(chef, format($q$insert into ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, cree_par)
    values (%L, 2025, 1, '2025-05-31', 'Origine restaurée', 'Restaurée', %L, %L) returning id$q$, dr,
    pg_temp.ecriture('2025-05-31', 'Origine restaurée', reclassement, false) -> 'lignes', chef));
  er := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  issue := pg_temp.fait(chef, format($q$insert into ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, cree_par, contre_passe_id)
    values (%L, 2025, 2, '2025-06-30', 'Contre-passation restaurée', 'Restaurée', '[{},{}]', %L, %L) returning id$q$, dr, chef, er));
  cr := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  issue := pg_temp.tente(membre, pg_temp.saisie(dr, er, '2025-05-31', 'Origine changée', reclassement, false, 1));
  perform pg_temp.verdict('CP-E8. une écriture contre-passée ne se remplace plus (23514)', issue, er is not null and cr is not null and issue = '23514 ' || m_contre_passee);
  issue := pg_temp.tente(membre, format('select public.retirer_ecriture_libre(%L::uuid, 1)::text', er));
  perform pg_temp.verdict('CP-E9. ni ne se retire (23514)', issue, issue = '23514 ' || m_contre_passee);
  issue := pg_temp.proprietaire(dr, format('update ecritures_libres set contre_passe_id = null where id = %L returning 1', cr));
  perform pg_temp.verdict('CP-E10. le lien d''une contre-passation ne se défait pas en place, même par le propriétaire (23514)', issue, issue = '23514 ' || m_remplacement);

  -- ══ CP-D. Le retrait, puis le gel ══
  issue := pg_temp.fait(membre, format('select public.retirer_ecriture_libre(%L::uuid, 1)::text', c2));
  select count(*) into n from ecritures_brouillon where ecriture_libre_id = c2;
  perform pg_temp.verdict('CP-D1. le membre retire une contre-passation non figée : ses deux lignes, par retirer_ecriture_libre', issue || ' ' || n,
    issue = 'OK 2' and n = 0 and not exists (select 1 from ecritures_libres where id = c2));
  issue := pg_temp.fait(membre, pg_temp.contre_passer(e2, 1, '2025-02-28', 'Contre-passation reprise', part_privee, true));
  c2b := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('CP-D2. l''écriture d''origine redevient à contre-passer, sous le numéro suivant de son année (le plus haut, plus un, comme enregistrer_ecriture_libre)', issue,
    c2b is not null and (select numero from ecritures_libres where id = c2b) = 3);
  insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte)
    values (dv, 2025, now(), chef, 'engagement', 0, 0, 0, 0, repeat('0', 64));
  issue := pg_temp.tente(membre, format('select public.retirer_ecriture_libre(%L::uuid, 1)::text', c1));
  perform pg_temp.verdict('CP-D3. figée par la validation de 2025, une contre-passation ne se retire plus (23514)', issue, issue = '23514 ' || m_fige);
  issue := pg_temp.fait(chef, pg_temp.cp(c1, 1, pg_temp.saisie_cp('2026-01-01', 'Contre-passation de EL2025-0002', 'Le reclassement était juste.', 'false'),
    jsonb_build_array(jsonb_build_object('date', '2026-01-01', 'journal', 'OD', 'libelle', 'Contre-passation de EL2025-0002',
      'lignes', '[{"compte":"606400","sens":"debit","centimes":12000},{"compte":"606300","sens":"credit","centimes":12000}]'::jsonb))));
  c1b := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  select string_agg(l ->> 'compte' || ' ' || (l ->> 'sens') || ' ' || coalesce(l ->> 'poste_2035', 'nul'), ' / ' order by r) into texte
    from ecritures_libres e cross join lateral jsonb_array_elements(e.lignes) with ordinality x(l, r) where e.id = c1b;
  perform pg_temp.verdict('CP-D4. figée, elle se contre-passe à son tour : les lignes de l''écriture d''origine reviennent, sous leurs postes', issue || ' ' || coalesce(texte, ''),
    c1b is not null and texte = '606400 debit Fournitures de bureau / 606300 credit Petit outillage');

  -- ══ CP-F. Le catalogue ══
  select format_type(a.atttypid, a.atttypmod) || ' ' || (not a.attnotnull)::text into texte
    from pg_attribute a where a.attrelid = 'public.ecritures_libres'::regclass and a.attname = 'contre_passe_id';
  select texte || ' | ' || string_agg(c.conname || ':' || c.contype::text || ':' || pg_get_constraintdef(c.oid), ' ; ' order by c.conname collate "C") into texte
    from pg_constraint c
   where c.conrelid = 'public.ecritures_libres'::regclass
     and c.conname in ('ecritures_libres_contre_passe_id_fkey', 'ecritures_libres_une_contre_passation', 'ecritures_libres_contre_passation_sans_extourne');
  perform pg_temp.verdict('CP-F1. la colonne, facultative ; la clé vers une écriture libre sans action, l''unicité totale, la contre-passation sans extourne', texte,
    texte = 'uuid true | ecritures_libres_contre_passation_sans_extourne:c:CHECK (((contre_passe_id IS NULL) OR (NOT avec_extourne))) ; '
         || 'ecritures_libres_contre_passe_id_fkey:f:FOREIGN KEY (contre_passe_id) REFERENCES ecritures_libres(id) ; '
         || 'ecritures_libres_une_contre_passation:u:UNIQUE (contre_passe_id)');
  select string_agg(tgname::text, ',' order by tgname collate "C") into texte
    from pg_trigger where tgrelid = 'public.ecritures_libres'::regclass and not tgisinternal;
  perform pg_temp.verdict('CP-F2. les déclencheurs : la porte, la garde de la table, puis celle de la contre-passation', texte,
    texte = '_acces_avant_les_gardes,ecritures_libres_garde,ecritures_libres_garde_de_la_contre_passation');
  select has_function_privilege('anon', fn, 'execute')::text || has_function_privilege('authenticated', fn, 'execute')::text
    || exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) x where p.oid = fn and x.grantee = 0)::text
    || has_function_privilege('authenticated', garde, 'execute')::text || has_function_privilege('anon', garde, 'execute')::text
    || (select p.prosecdef::text || (p.proconfig = array['search_path=public'])::text from pg_proc p where p.oid = fn)
    || (select p.prosecdef::text from pg_proc p where p.oid = garde)
    into texte;
  perform pg_temp.verdict('CP-F3. l''exécution : le compte connecté seul pour la fonction ; la garde à personne ; les deux aux droits du propriétaire', texte,
    texte = 'falsetruefalsefalsefalsetruetruetrue');

  -- ══ Les mutations ══
  -- M-CP1 : l'accès ouvert à tout compte connecté.
  begin
    perform pg_temp.muter(fn, 'or not coalesce(public.admin_du_dossier(v_dossier_id), false)', '');
    issue := pg_temp.tente(membre, pg_temp.contre_passer(en, 1, '2025-01-01', 'X', reclassement, true));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP1 — l''accès sans admin_du_dossier (CP-A4)', issue, issue like 'OK %');
  -- M-CP2 : le gel oublié.
  begin
    perform pg_temp.muter(fn, 'if not ((v_frontiere is not null and v_origine.date <= v_frontiere)', 'if false and not ((v_frontiere is not null and v_origine.date <= v_frontiere)');
    issue := pg_temp.tente(membre, pg_temp.contre_passer(e6, 1, '2026-03-31', 'X', reclassement, true));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP2 — une écriture d''un exercice ouvert contre-passée (CP-B2)', issue, issue like 'OK %');
  -- M-CP3 : l'extourne oubliée.
  begin
    perform pg_temp.muter(fn, 'if v_origine.avec_extourne then', 'if false then');
    issue := pg_temp.tente(membre, pg_temp.contre_passer(e3, 1, '2026-01-15', 'X', rattachee, true));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP3 — une écriture extournée contre-passée (CP-B3)', issue, issue like 'OK %');
  -- M-CP4 : « déjà contre-passée » oublié par la fonction : l'unicité refuse encore, mais plus sous ses mots ; M-CP5 : et
  -- l'unicité retirée, la seconde contre-passation passe.
  begin
    perform pg_temp.muter(fn, 'if exists (select 1 from public.ecritures_libres c where c.contre_passe_id = p_id) then', 'if false then');
    issue := pg_temp.tente(membre, pg_temp.contre_passer(e1, 1, '2026-01-15', 'X', reclassement, true));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP4 — « déjà contre-passée » oublié : le refus n''a plus ses mots (CP-B4)', issue,
    issue is distinct from '23514 ' || m_deja);
  begin
    perform pg_temp.muter(fn, 'if exists (select 1 from public.ecritures_libres c where c.contre_passe_id = p_id) then', 'if false then');
    alter table public.ecritures_libres drop constraint ecritures_libres_une_contre_passation;
    issue := pg_temp.tente(membre, pg_temp.contre_passer(e1, 1, '2026-01-15', 'X', reclassement, true));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP5 — et l''unicité retirée : deux contre-passations d''une écriture (CP-B4)', issue, issue like 'OK %');
  -- M-CP6 : la comparaison à l'écriture proposée écartée.
  begin
    perform pg_temp.muter(fn, 'if not coalesce(v_conforme, false) then', 'if false then');
    issue := pg_temp.tente(membre, pg_temp.cp(e5, 1, pg_temp.saisie_cp('2026-01-15', 'X', 'Motif.', 'true'),
      pg_temp.proposee('2026-01-15', 'X', '[["606400","debit",11999],["606300","credit",12000]]')));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP6 — la comparaison à l''écriture proposée écartée (CP-B14)', issue, issue like 'OK %');
  -- M-CP7 : le sens inverse oublié, et l'application qui propose l'écriture d'origine recopiée.
  begin
    perform pg_temp.muter(fn, '''sens'', case v_sens when ''debit'' then ''credit'' else ''debit'' end', '''sens'', v_sens');
    issue := pg_temp.tente(membre, pg_temp.cp(e5, 1, pg_temp.saisie_cp('2026-01-15', 'X', 'Motif.', 'true'),
      jsonb_set(pg_temp.proposee('2026-01-15', 'X', reclassement), '{0,lignes}', pg_temp.ecritures('2026-01-15', 'X', reclassement, false) -> 0 -> 'lignes')));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP7 — le sens inverse oublié : l''écriture d''origine recopiée passe (CP-C1)', issue, issue like 'OK %');
  -- M-CP8 : « hors de la 2035 » ignoré : les postes restent.
  begin
    perform pg_temp.muter(fn, '''poste_2035'', case when v_hors then null else v_poste end', '''poste_2035'', v_poste');
    issue := pg_temp.fait(membre, pg_temp.contre_passer(e5, 1, '2026-01-15', 'X', reclassement, true));
    select coalesce(string_agg(coalesce(l ->> 'poste_2035', 'nul'), ' / ' order by r), '?') into texte from ecritures_libres e
      cross join lateral jsonb_array_elements(e.lignes) with ordinality x(l, r) where e.id = case when issue like 'OK %' then substr(issue, 4)::uuid end;
    issue := issue || ' ' || texte;
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP8 — « hors de la 2035 » ignoré : les postes de l''origine restent (CP-C3)', issue,
    issue like 'OK % Fournitures de bureau / Petit outillage');
  -- M-CP9 : la garde laisse remplacer une contre-passation.
  begin
    perform pg_temp.muter(garde, 'if tg_op = ''UPDATE'' and (old.contre_passe_id is not null or new.contre_passe_id is not null) then', 'if false then');
    issue := pg_temp.tente(membre, pg_temp.saisie(dr, cr, '2025-06-30', 'Contre-passation changée', reclassement, false, 1));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP9 — la garde laisse remplacer une contre-passation (CP-E1)', issue, issue like 'OK %');
  -- M-CP10 : la garde oublie le dossier de l'écriture citée.
  begin
    perform pg_temp.muter(garde, 'where e.id = new.contre_passe_id and e.dossier_id = new.dossier_id', 'where e.id = new.contre_passe_id');
    issue := pg_temp.tente(chef, format($q$insert into ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, cree_par, contre_passe_id)
      values (%L, 2026, 90, '2026-04-30', 'Restaurée', 'Restaurée', '[{},{}]', %L, %L) returning 1$q$, dv, chef, en));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP10 — la garde oublie le dossier de l''écriture citée (CP-E3)', issue, issue like 'OK %');
  -- M-CP11 : la garde laisse changer une écriture contre-passée.
  begin
    perform pg_temp.muter(garde, 'if tg_op <> ''INSERT'' and exists (select 1 from public.ecritures_libres c where c.contre_passe_id = old.id) then', 'if false then');
    issue := pg_temp.tente(membre, pg_temp.saisie(dr, er, '2025-05-31', 'Origine changée', reclassement, false, 1));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP11 — la garde laisse changer une écriture contre-passée (CP-E8)', issue, issue like 'OK %');
  -- M-CP12 : la garde ne juge plus le chemin.
  begin
    perform pg_temp.muter(garde, 'current_setting(''jd.contre_passation'', true), '''') is distinct from new.dossier_id::text',
      'current_setting(''jd.contre_passation'', true), '''') is distinct from new.dossier_id::text and false');
    issue := pg_temp.proprietaire(dv, format($q$insert into ecritures_libres (dossier_id, exercice, numero, date, libelle, motif, lignes, cree_par, contre_passe_id)
      values (%L, 2026, 90, '2026-04-30', 'Par le chemin d''enregistrer', 'Direct', '[{},{}]', %L, %L) returning 1$q$, dv, chef, e5));
    raise exception 'ANNULATION_MUTATION';
  exception when others then if sqlerrm <> 'ANNULATION_MUTATION' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into cp_mutation (mutation, observe, mord) values ('M-CP12 — la garde ne juge plus le chemin (CP-E7)', issue, issue like 'OK %');
end
$essai$;

select 'INVARIANTS' as tableau, controle as ligne, case when ok then 'juste' else '*** EN FAUTE ***' end as resultat, observe as detail
  from cp_verdict
union all
select 'MUTATIONS', mutation, case when mord then 'le contrôle mord' else '*** NE MORD PAS ***' end, observe
  from cp_mutation
union all
select 'BILAN', 'invariants et mutations',
  (select count(*) filter (where not ok) from cp_verdict) || ' en faute / ' || (select count(*) from cp_verdict) || ' ; '
  || (select count(*) filter (where mord) from cp_mutation) || ' mutations sur ' || (select count(*) from cp_mutation) || ' qui mordent', ''
order by 1 desc, 2;

rollback;
