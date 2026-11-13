-- ESSAI DES PROVISIONS (ligne 35, INV4 ; migration `provisions`, PRÉPARÉE le 12/11/2026, après `operations_d_inventaire`).
-- SUR UNE RÉPLIQUE SEULEMENT : il crée des dossiers, des pièces, des à-nouveaux et un exercice validé fictifs, et supprime un
-- dossier. Joué ENTIER, en une transaction qui s'annule (`begin` … `rollback`), par psql, sans `-1` :
--   psql -v ON_ERROR_STOP=1 -f supabase/essais/provisions.sql
-- Ce qu'il juge, par impersonation (le chef, aussi super-administrateur dans le semis ; un membre assigné ; le même membre sur
-- un dossier qui ne lui est pas assigné ; un client qui a un accès au dossier ; l'anonyme) :
--   PV-A. l'accès : le chef et le membre assigné écrivent, le membre non assigné, le client et l'anonyme non ;
--   PV-B. chaque refus de `enregistrer_provision`, sous son code et ses MOTS (ceux de src/lib/inventaire.ts), dans l'ordre du
--         module, puis ceux que la base seule dit ;
--   PV-C. l'évaluation PAR DIFFÉRENCE (INV-Q4 (A)) : une dotation, une reprise, un écart nul sans écriture, la provision
--         soldée ; chaque refus de `enregistrer_evaluation_provision` sous ses mots ; une écriture qui n'est pas la
--         recomposition refusée ; seule la dernière évaluation change ;
--   PV-D. la ventilation d'un compte repris (INV-Q11 (A)) : la somme des parts au plus le solde repris, exactement à la première
--         évaluation, la provision précédente lue dans la part reprise ;
--   PV-E. le gel et les gardes : un exercice validé, une provision évaluée, aucune écriture directe hors de la réinsertion du
--         super-administrateur, le départ du dossier.
-- Puis des MUTATIONS de la migration, chacune dans une sous-transaction annulée, qui doivent faire virer un contrôle au rouge.

begin;

create temp table pv_verdict (rang serial, controle text, observe text, ok boolean);
create temp table pv_mutation (rang serial, mutation text, observe text, mord boolean);

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

create function pg_temp.prov(p_dossier uuid, p_provision jsonb, p_version integer) returns text language sql as $$
  select format('select public.enregistrer_provision(%L::uuid, %L::jsonb, %s)::text', p_dossier, p_provision, coalesce(p_version::text, 'null'))
$$;
create function pg_temp.eval(p_dossier uuid, p_evaluation jsonb, p_ecritures jsonb, p_version integer) returns text language sql as $$
  select format('select public.enregistrer_evaluation_provision(%L::uuid, %L::jsonb, %L::jsonb, %s)::text',
                p_dossier, p_evaluation, p_ecritures, coalesce(p_version::text, 'null'))
$$;
-- L'écriture que compose le module (`composerEvaluation`, par différence) : `lignes` est [[compte, sens, centimes], …].
create function pg_temp.ecriture(p_exercice integer, p_libelle text, p_lignes jsonb) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('date', p_exercice || '-12-31', 'journal', 'OD', 'libelle', p_libelle,
    'lignes', (select jsonb_agg(jsonb_build_object('compte', l ->> 0, 'sens', l ->> 1, 'centimes', (l ->> 2)::bigint) order by r)
                 from jsonb_array_elements(p_lignes) with ordinality x(l, r))))
$$;
create function pg_temp.verdict(p_controle text, p_observe text, p_ok boolean) returns void language sql as $$
  insert into pv_verdict (controle, observe, ok) values (p_controle, p_observe, coalesce(p_ok, false))
$$;
create function pg_temp.lignes(p_operation uuid) returns text language sql as $$
  select coalesce(string_agg(to_char(e.date, 'YYYY-MM-DD') || ' ' || e.compte || ' ' || e.sens || ' ' || e.montant || ' ' || e.libelle, ' | '
                    order by e.sens desc, e.compte), '∅')
    from ecritures_brouillon e where e.operation_inventaire_id = p_operation
$$;

do $essai$
declare
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre uuid := '3e3b0000-0000-4000-8000-000000000001';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  cabinet uuid := 'cab10000-0000-4000-8000-000000000001';
  dp uuid := 'a1400000-0000-4000-8000-0000000000a1';   -- engagement, assigné au membre, ouvert au client
  dt uuid := 'a1400000-0000-4000-8000-0000000000a3';   -- trésorerie, assigné
  db uuid := 'a1400000-0000-4000-8000-0000000000a4';   -- engagement, NON assigné au membre
  dr uuid := 'a1400000-0000-4000-8000-0000000000a5';   -- engagement, repris au 1er janvier 2025 (151100 et 491000 au crédit)
  dv uuid := 'a1400000-0000-4000-8000-0000000000a6';   -- engagement, 2024 validé ensuite
  dd uuid := 'a1400000-0000-4000-8000-0000000000a7';   -- engagement, supprimé à la fin (le départ du dossier)
  pv uuid := 'a1400000-0000-4000-8000-0000000000b1';   -- une pièce de vente de dp
  pac uuid := 'a1400000-0000-4000-8000-0000000000b2';  -- une pièce d'achat de dp
  pb uuid := 'a1400000-0000-4000-8000-0000000000b3';   -- une pièce de vente de db
  -- Les mots du module (src/lib/inventaire.ts, MOTS_DES_REFUS), au caractère près.
  m_tresorerie text := 'L’inventaire ne s’écrit qu’en comptabilité d’engagement : un dossier en trésorerie (BNC, 2035) n’en reçoit aucun.';
  m_exercice text := 'L’exercice de la régularisation est illisible : une année entre 2000 et 2100.';
  m_fige text := 'Cet exercice est validé : ses écritures d’inventaire ne changent plus.';
  m_a_venir text := 'Cet exercice n’est pas encore commencé : son inventaire ne se passe pas avant lui.';
  m_ouverture text := 'Cet exercice précède l’ouverture du dossier dans l’application : son inventaire n’y a pas de place.';
  m_genre text := 'Le genre de la provision est inconnu : une provision pour risques ou la dépréciation d’une créance.';
  m_151 text := 'Une provision pour risques s’écrit sous le 151.';
  m_491 text := 'La dépréciation d’une créance s’écrit sous le 491.';
  m_objet text := 'L’objet de la régularisation tient en 1 à 200 caractères, sur une ligne : il part au FEC.';
  m_cible text := 'L’évaluation d’une provision est un nombre de centimes entier, positif ou nul.';
  m_reprise text := 'La provision au 31 décembre précédent est un nombre de centimes entier, positif ou nul.';
  m_ventilation text := 'Les provisions ventilées doivent faire exactement le solde repris du compte.';
  -- Les mots que la base dit seule.
  m_facture_genre text := 'Seule la dépréciation d’une créance cite une facture.';
  m_facture text := 'La facture citée n’est pas une facture validée de ce dossier.';
  m_piece text := 'La pièce citée n’est pas une pièce de ce dossier.';
  m_piece_vente text := 'La pièce citée n’est pas une pièce de vente de ce dossier.';
  m_reprise_premier text := 'Une part reprise s’ouvre au premier exercice du dossier, celui de sa balance reprise.';
  m_version_p text := 'Cette provision a changé depuis sa lecture : relire l’inventaire avant de l’écrire.';
  m_nouvelle text := 'Une provision nouvelle ne porte pas de version lue.';
  m_evaluee text := 'Cette provision est déjà évaluée : elle ne change plus ; retirer d’abord ses évaluations.';
  m_prov_dossier text := 'La provision évaluée n’est pas une provision de ce dossier.';
  m_ouverture_p text := 'Cette provision s’ouvre sur un exercice plus récent : elle ne s’évalue pas avant.';
  m_chaine text := 'Cette provision est évaluée sur un exercice plus récent : seule sa dernière évaluation change.';
  m_soldee text := 'Cette provision est soldée : elle ne s’évalue plus ; un risque nouveau est une provision nouvelle.';
  m_version_e text := 'Cette évaluation a changé depuis sa lecture : relire l’inventaire avant de l’écrire.';
  m_ecritures text := 'Les écritures proposées ne sont pas celles de l’évaluation : les recomposer.';
  m_garde text := 'Une provision ne s’écrit que par enregistrer_provision et retirer_provision.';
  m_garde_eval text := 'Une évaluation appartient à une provision de son dossier, ouverte au plus tard sur son exercice, à son compte.';
  -- Une provision pour risques de 2025 : un litige prud'homal.
  risque jsonb := '{"genre": "risque", "compte_provision": "151100", "objet": "Litige prud’homal", "ouverte_en": 2025}';
  lib25 text := 'Dotation 31/12/2025 — Provision pour risques — Litige prud’homal';
  lib26 text := 'Reprise 31/12/2026 — Provision pour risques — Litige prud’homal';
  ec25 jsonb;
  ec26 jsonb;
  issue text;
  p1 uuid; p2 uuid; r1 uuid; r2 uuid; pvx uuid; pdd uuid;
  e25 uuid; e26 uuid; e_r1 uuid;
  n bigint;
  texte text;
begin
  ec25 := pg_temp.ecriture(2025, lib25, '[["681500","debit",500000],["151100","credit",500000]]');
  ec26 := pg_temp.ecriture(2026, lib26, '[["151100","debit",200000],["781500","credit",200000]]');

  -- ── Le jeu, écrit par le propriétaire ──
  insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva) values
    (dp, 'INV4 essai P', cabinet, 'engagement', 'redevable'), (dt, 'INV4 essai T', cabinet, 'tresorerie', 'franchise'),
    (db, 'INV4 essai B', cabinet, 'engagement', 'redevable'), (dr, 'INV4 essai R', cabinet, 'engagement', 'redevable'),
    (dv, 'INV4 essai V', cabinet, 'engagement', 'redevable'), (dd, 'INV4 essai D', cabinet, 'engagement', 'redevable');
  insert into dossier_assignations (dossier_id, user_id) values (dp, membre), (dt, membre), (dr, membre), (dv, membre), (dd, membre);
  insert into memberships (user_id, dossier_id, role)
    select client, dp, m.role from memberships m where m.user_id = client limit 1;
  insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece) values
    (pv, dp, dp || '/inv4v.pdf', 'inv4v.pdf', 'vente'), (pac, dp, dp || '/inv4a.pdf', 'inv4a.pdf', 'achat'),
    (pb, db, db || '/inv4b.pdf', 'inv4b.pdf', 'vente');
  insert into a_nouveaux (dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values
    (dr, '2025-01-01', '512000', 'debit', 1800, 'essai', repeat('a', 64)),
    (dr, '2025-01-01', '151100', 'credit', 1500, 'essai', repeat('a', 64)),
    (dr, '2025-01-01', '491000', 'credit', 300, 'essai', repeat('a', 64));

  -- ══ PV-A. L'accès ══
  issue := pg_temp.fait(chef, pg_temp.prov(dp, risque, null));
  p1 := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('PV-A1. le chef enregistre une provision pour risques (le contrôle positif)', issue, p1 is not null);
  issue := pg_temp.fait(membre, pg_temp.prov(dp, '{"genre": "depreciation_creance", "compte_provision": "491000", "objet": "Client en redressement", "ouverte_en": 2024, "piece_citee_id": "a1400000-0000-4000-8000-0000000000b1"}', null));
  p2 := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('PV-A2. le membre assigné enregistre la dépréciation d''une créance, sa pièce de vente citée (le contrôle positif)', issue, p2 is not null);
  issue := pg_temp.tente(membre, pg_temp.prov(db, risque, null));
  perform pg_temp.verdict('PV-A3. le membre, sur un dossier qui ne lui est pas assigné', issue, issue = '42501 Accès refusé à ce dossier.');
  issue := pg_temp.tente(client, pg_temp.prov(dp, risque, null));
  perform pg_temp.verdict('PV-A4. le client, qui a un accès au dossier', issue, issue = '42501 Accès refusé à ce dossier.');
  issue := pg_temp.tente(null, pg_temp.prov(dp, risque, null));
  perform pg_temp.verdict('PV-A5. l''anonyme n''exécute pas la fonction', issue, issue like '42501 permission denied for function%');
  issue := pg_temp.tente(client, format('select count(*)::text from provisions where dossier_id = %L', dp))
    || ' | membre : ' || pg_temp.tente(membre, format('select count(*)::text from provisions where dossier_id = %L', dp));
  perform pg_temp.verdict('PV-A6. le client ne lit aucune provision de son dossier ; le membre assigné les lit', issue, issue = 'OK 0 | membre : OK 2');
  issue := pg_temp.tente(membre, format('select count(*)::text from provisions where dossier_id = %L', db));
  perform pg_temp.verdict('PV-A7. le membre ne lit rien d''un dossier qui ne lui est pas assigné', issue, issue = 'OK 0');
  issue := pg_temp.tente(client, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 2025, 'cible_centimes', 500000), ec25, null));
  perform pg_temp.verdict('PV-A8. le client n''évalue pas', issue, issue = '42501 Accès refusé à ce dossier.');

  -- ══ PV-B. Les refus de enregistrer_provision, dans l'ordre du module, puis ceux de la base ══
  issue := pg_temp.tente(membre, pg_temp.prov(dt, risque, null));
  perform pg_temp.verdict('PV-B1. un dossier en trésorerie', issue, issue = '22023 ' || m_tresorerie);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || '{"ouverte_en": 1999}', null));
  perform pg_temp.verdict('PV-B2. un exercice d''ouverture illisible (1999)', issue, issue = '22023 ' || m_exercice);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || '{"ouverte_en": "2025"}', null));
  perform pg_temp.verdict('PV-B3. un exercice en texte', issue, issue = '22023 ' || m_exercice);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || jsonb_build_object('ouverte_en', extract(year from now() at time zone 'Europe/Paris')::int + 1), null));
  perform pg_temp.verdict('PV-B4. un exercice pas encore commencé', issue, issue = '22023 ' || m_a_venir);
  issue := pg_temp.tente(membre, pg_temp.prov(dr, risque || '{"ouverte_en": 2024}', null));
  perform pg_temp.verdict('PV-B5. un exercice avant l''ouverture du dossier repris', issue, issue = '22023 ' || m_ouverture);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || '{"genre": "stock"}', null));
  perform pg_temp.verdict('PV-B6. un genre inconnu', issue, issue = '22023 ' || m_genre);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || '{"compte_provision": "491000"}', null));
  perform pg_temp.verdict('PV-B7. un risque hors du 151', issue, issue = '22023 ' || m_151);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || '{"genre": "depreciation_creance"}', null));
  perform pg_temp.verdict('PV-B8. une dépréciation hors du 491', issue, issue = '22023 ' || m_491);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || '{"objet": "  "}', null));
  perform pg_temp.verdict('PV-B9. un objet vide une fois rogné', issue, issue = '22023 ' || m_objet);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || jsonb_build_object('objet', 'deux' || chr(10) || 'lignes'), null));
  perform pg_temp.verdict('PV-B10. un objet sur deux lignes', issue, issue = '22023 ' || m_objet);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || jsonb_build_object('facture_id', gen_random_uuid()), null));
  perform pg_temp.verdict('PV-B11. une provision pour risques ne cite pas de facture', issue, issue = '22023 ' || m_facture_genre);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || jsonb_build_object('genre', 'depreciation_creance', 'compte_provision', '491000', 'facture_id', gen_random_uuid()), null));
  perform pg_temp.verdict('PV-B12. une facture qui n''est pas une facture validée du dossier', issue, issue = '22023 ' || m_facture);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || jsonb_build_object('piece_citee_id', pb), null));
  perform pg_temp.verdict('PV-B13. une pièce d''un autre dossier', issue, issue = '22023 ' || m_piece);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || jsonb_build_object('genre', 'depreciation_creance', 'compte_provision', '491000', 'piece_citee_id', pac), null));
  perform pg_temp.verdict('PV-B14. une créance dépréciée citée par une pièce d''achat', issue, issue = '22023 ' || m_piece_vente);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || jsonb_build_object('piece_citee_id', pac), null));
  perform pg_temp.verdict('PV-B15. un risque cite toute pièce du dossier (le contrôle positif)', issue, issue like 'OK %');
  issue := pg_temp.tente(membre, pg_temp.prov(dr, risque || '{"reprise_centimes": -1}', null));
  perform pg_temp.verdict('PV-B16. une part reprise négative', issue, issue = '22023 ' || m_reprise);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || '{"reprise_centimes": 100}', null));
  perform pg_temp.verdict('PV-B17. une part reprise dans un dossier sans balance reprise', issue, issue = '22023 ' || m_reprise_premier);
  issue := pg_temp.tente(membre, pg_temp.prov(dr, risque || '{"ouverte_en": 2026, "reprise_centimes": 100}', null));
  perform pg_temp.verdict('PV-B18. une part reprise hors du premier exercice du dossier', issue, issue = '22023 ' || m_reprise_premier);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque, 1));
  perform pg_temp.verdict('PV-B19. une provision nouvelle avec une version lue', issue, issue = '22023 ' || m_nouvelle);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || jsonb_build_object('id', p1), 2));
  perform pg_temp.verdict('PV-B20. une version lue dépassée', issue, issue = '40001 ' || m_version_p);
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || jsonb_build_object('id', p1, 'objet', 'Litige prud’homal (appel)'), 1));
  perform pg_temp.verdict('PV-B21. une provision pas encore évaluée se remplace contre sa version (le contrôle positif)', issue, issue = 'OK ' || p1);

  -- ══ PV-C. L'évaluation par différence ══
  issue := pg_temp.fait(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 2025, 'cible_centimes', 500000), ec25, null));
  e25 := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('PV-C1. la première évaluation : une dotation de toute la cible, 681500 au débit, 151100 au crédit', issue || ' | ' || pg_temp.lignes(e25),
    e25 is not null and pg_temp.lignes(e25) = '2025-12-31 681500 debit 5000.00 ' || lib25 || ' | 2025-12-31 151100 credit 5000.00 ' || lib25);
  select o.nature || ' ' || o.compte_resultat || ' ' || o.compte_regularisation || ' ' || o.montant_centimes || ' v' || o.version || ' ' || o.objet
    into texte from operations_inventaire o where o.id = e25;
  perform pg_temp.verdict('PV-C2. l''évaluation : nature provision, sa cible, la dotation et le compte de la provision, son objet', texte,
    texte = 'provision 681500 151100 500000 v1 Litige prud’homal');
  issue := pg_temp.fait(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 2026, 'cible_centimes', 300000), ec26, null));
  e26 := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('PV-C3. la cible baisse : une reprise de l''écart, 151100 au débit, 781500 au crédit', issue || ' | ' || pg_temp.lignes(e26),
    e26 is not null and pg_temp.lignes(e26) = '2026-12-31 151100 debit 2000.00 ' || lib26 || ' | 2026-12-31 781500 credit 2000.00 ' || lib26);
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 2025, 'cible_centimes', 600000),
    pg_temp.ecriture(2025, lib25, '[["681500","debit",600000],["151100","credit",600000]]'), 1));
  perform pg_temp.verdict('PV-C4. une évaluation suivie d''une autre ne change plus', issue, issue = '23514 ' || m_chaine);
  issue := pg_temp.tente(membre, format('select public.retirer_operation_inventaire(%L, 1)::text', e25));
  perform pg_temp.verdict('PV-C5. ni ne se retire par retirer_operation_inventaire (la garde)', issue, issue = '23514 ' || m_chaine);
  issue := pg_temp.fait(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 2026, 'cible_centimes', 500000), '[]', 1));
  perform pg_temp.verdict('PV-C6. un écart nul : l''évaluation remplacée, aucune écriture', issue || ' | ' || pg_temp.lignes(e26)
    || ' | v' || (select o.version from operations_inventaire o where o.id = e26),
    issue = 'OK ' || e26 and pg_temp.lignes(e26) = '∅' and (select o.version from operations_inventaire o where o.id = e26) = 2);
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 2026, 'cible_centimes', 500000), ec26, 2));
  perform pg_temp.verdict('PV-C7. un écart nul ne reçoit aucune écriture', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 2026, 'cible_centimes', 0),
    pg_temp.ecriture(2026, replace(lib26, '2026', '2026'), '[["151100","debit",500000],["781500","credit",500000]]'), 2));
  perform pg_temp.verdict('PV-C8. soldée : la reprise de toute la provision (le contrôle positif)', issue, issue = 'OK ' || e26);
  -- La provision soldée : la dépréciation p2, évaluée à zéro en 2024 (aucune écriture), ne s'évalue plus en 2025.
  issue := pg_temp.fait(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p2, 'exercice', 2024, 'cible_centimes', 0), '[]', null));
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p2, 'exercice', 2025, 'cible_centimes', 100),
    pg_temp.ecriture(2025, 'Dotation 31/12/2025 — Dépréciation de créance — Client en redressement', '[["681700","debit",100],["491000","credit",100]]'), null));
  perform pg_temp.verdict('PV-C9. une provision soldée ne s''évalue plus', issue, issue = '22023 ' || m_soldee);
  -- Les refus de l'évaluation, dans l'ordre.
  issue := pg_temp.tente(membre, pg_temp.eval(dt, jsonb_build_object('provision_id', p1, 'exercice', 2025, 'cible_centimes', 1), '[]', null));
  perform pg_temp.verdict('PV-C10. un dossier en trésorerie', issue, issue = '22023 ' || m_tresorerie);
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 'x', 'cible_centimes', 1), '[]', null));
  perform pg_temp.verdict('PV-C11. un exercice illisible', issue, issue = '22023 ' || m_exercice);
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 2099, 'cible_centimes', 1), '[]', null));
  perform pg_temp.verdict('PV-C12. un exercice pas encore commencé', issue, issue = '22023 ' || m_a_venir);
  issue := pg_temp.tente(membre, pg_temp.eval(dr, jsonb_build_object('provision_id', p1, 'exercice', 2024, 'cible_centimes', 1), '[]', null));
  perform pg_temp.verdict('PV-C13. un exercice avant l''ouverture du dossier repris', issue, issue = '22023 ' || m_ouverture);
  issue := pg_temp.tente(membre, pg_temp.eval(dr, jsonb_build_object('provision_id', p1, 'exercice', 2025, 'cible_centimes', 1), '[]', null));
  perform pg_temp.verdict('PV-C14. la provision d''un autre dossier', issue, issue = '22023 ' || m_prov_dossier);
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 2025, 'cible_centimes', -1), '[]', 1));
  perform pg_temp.verdict('PV-C15. une cible négative', issue, issue = '22023 ' || m_cible);
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 2025, 'cible_centimes', '5000'), '[]', 1));
  perform pg_temp.verdict('PV-C16. une cible en texte', issue, issue = '22023 ' || m_cible);
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 2024, 'cible_centimes', 1), '[]', null));
  perform pg_temp.verdict('PV-C17. un exercice avant l''ouverture de la provision', issue, issue = '22023 ' || m_ouverture_p);
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 2026, 'cible_centimes', 0), '[]', 1));
  perform pg_temp.verdict('PV-C18. une version lue dépassée', issue, issue = '40001 ' || m_version_e);
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 2026, 'cible_centimes', 0), '[]', null));
  perform pg_temp.verdict('PV-C19. une évaluation existante sans version lue', issue, issue = '40001 ' || m_version_e);
  -- Une provision nouvelle de 2025, pour juger les écritures proposées.
  issue := pg_temp.fait(membre, pg_temp.prov(dp, risque || '{"objet": "Garantie"}', null));
  pvx := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', pvx, 'exercice', 2025, 'cible_centimes', 1000),
    pg_temp.ecriture(2025, 'Dotation 31/12/2025 — Provision pour risques — Garantie', '[["681500","debit",1000],["151100","credit",999]]'), null));
  perform pg_temp.verdict('PV-C20. un centime de moins', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', pvx, 'exercice', 2025, 'cible_centimes', 1000),
    pg_temp.ecriture(2025, 'Dotation 31/12/2025 — Provision pour risques — Garantie', '[["681500","debit",1000],["151100","credit",1000],["151100","credit",0]]'), null));
  perform pg_temp.verdict('PV-C21. une ligne de trop', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', pvx, 'exercice', 2025, 'cible_centimes', 1000),
    pg_temp.ecriture(2025, 'Dotation 31/12/2025 — Garantie', '[["681500","debit",1000],["151100","credit",1000]]'), null));
  perform pg_temp.verdict('PV-C22. un libellé qui n''est pas le libellé composé', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', pvx, 'exercice', 2025, 'cible_centimes', 1000),
    pg_temp.ecriture(2025, 'Dotation 31/12/2025 — Provision pour risques — Garantie', '[["781500","credit",1000],["151100","debit",1000]]'), null));
  perform pg_temp.verdict('PV-C23. une reprise proposée là où l''écart est une dotation', issue, issue = '22023 ' || m_ecritures);
  issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', pvx, 'exercice', 2025, 'cible_centimes', 1000), '[]', null));
  perform pg_temp.verdict('PV-C24. aucune écriture là où l''écart n''est pas nul', issue, issue = '22023 ' || m_ecritures);

  -- ══ PV-D. La ventilation d'un compte repris (151100 : 1 500,00 au crédit des à-nouveaux) ══
  issue := pg_temp.fait(membre, pg_temp.prov(dr, risque || '{"reprise_centimes": 100000}', null));
  r1 := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('PV-D1. une part reprise de 1 000,00 sur le premier exercice du dossier (le contrôle positif)', issue, r1 is not null);
  issue := pg_temp.tente(membre, pg_temp.eval(dr, jsonb_build_object('provision_id', r1, 'exercice', 2025, 'cible_centimes', 120000),
    pg_temp.ecriture(2025, lib25, '[["681500","debit",20000],["151100","credit",20000]]'), null));
  perform pg_temp.verdict('PV-D2. la ventilation incomplète retient la première évaluation', issue, issue = '22023 ' || m_ventilation);
  issue := pg_temp.tente(membre, pg_temp.prov(dr, risque || '{"objet": "Autre litige", "reprise_centimes": 60000}', null));
  perform pg_temp.verdict('PV-D3. une part qui ferait dépasser le solde repris', issue, issue = '22023 ' || m_ventilation);
  issue := pg_temp.fait(membre, pg_temp.prov(dr, risque || '{"objet": "Autre litige", "reprise_centimes": 50000}', null));
  r2 := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  issue := pg_temp.fait(membre, pg_temp.eval(dr, jsonb_build_object('provision_id', r1, 'exercice', 2025, 'cible_centimes', 120000),
    pg_temp.ecriture(2025, lib25, '[["681500","debit",20000],["151100","credit",20000]]'), null));
  e_r1 := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  perform pg_temp.verdict('PV-D4. la ventilation exacte : l''écart se compte depuis la part reprise (1 200,00 − 1 000,00)', issue || ' | ' || pg_temp.lignes(e_r1),
    r2 is not null and e_r1 is not null and pg_temp.lignes(e_r1) = '2025-12-31 681500 debit 200.00 ' || lib25 || ' | 2025-12-31 151100 credit 200.00 ' || lib25);
  issue := pg_temp.tente(membre, pg_temp.prov(dr, risque || '{"genre": "depreciation_creance", "compte_provision": "491000", "objet": "Créance reprise", "reprise_centimes": 30001}', null));
  perform pg_temp.verdict('PV-D5. le solde d''un compte se juge compte par compte (491000 : 300,00)', issue, issue = '22023 ' || m_ventilation);

  -- ══ PV-E. Le gel et les gardes ══
  issue := pg_temp.tente(membre, pg_temp.prov(dp, risque || jsonb_build_object('id', p1), 1));
  perform pg_temp.verdict('PV-E1. une provision évaluée ne change plus', issue, issue = '23514 ' || m_evaluee);
  issue := pg_temp.tente(membre, format('select public.retirer_provision(%L, %L, 2)::text', dp, p1));
  perform pg_temp.verdict('PV-E2. ni ne se retire', issue, issue = '23514 ' || m_evaluee);
  issue := pg_temp.tente(membre, format('select public.retirer_provision(%L, %L, 2)::text', dp, pvx));
  perform pg_temp.verdict('PV-E3. une version lue dépassée au retrait', issue, issue = '40001 ' || m_version_p);
  issue := pg_temp.tente(membre, format('select public.retirer_provision(%L, %L, 1)::text', dp, pvx));
  perform pg_temp.verdict('PV-E4. une provision pas évaluée se retire (le contrôle positif)', issue, issue = 'OK ');
  issue := pg_temp.tente(membre, format('insert into provisions (dossier_id, genre, compte_provision, objet, ouverte_en, cree_par) values (%L, ''risque'', ''151100'', ''direct'', 2025, %L) returning id::text', dp, membre));
  perform pg_temp.verdict('PV-E5. le membre n''insère pas de provision en direct (la garde)', issue, issue = '42501 ' || m_garde);
  issue := pg_temp.tente(client, format('insert into provisions (dossier_id, genre, compte_provision, objet, ouverte_en, cree_par) values (%L, ''risque'', ''151100'', ''direct'', 2025, %L) returning id::text', dp, client));
  -- La porte d'accès en base (acces_avant_les_gardes, ligne 43) : la RLS refuse le client avant la garde.
  perform pg_temp.verdict('PV-E6. le client non plus (la garde, avant la RLS ; la RLS d''abord, la porte en base)', issue,
    issue = case when exists (select 1 from pg_trigger g where g.tgrelid = 'public.provisions'::regclass and g.tgname = '_acces_avant_les_gardes')
                 then '42501 new row violates row-level security policy for table "provisions"' else '42501 ' || m_garde end);
  issue := pg_temp.tente(membre, format('with t as (update provisions set objet = ''réécrit'' where id = %L returning 1) select count(*)::text from t', p2));
  perform pg_temp.verdict('PV-E7. ni ne réécrit une provision en direct', issue, issue = '42501 ' || m_garde);
  issue := pg_temp.tente(chef, format('insert into provisions (dossier_id, genre, compte_provision, objet, ouverte_en, cree_par) values (%L, ''risque'', ''151100'', ''réinsérée'', 2025, %L) returning ''réinsérée''', dp, chef));
  perform pg_temp.verdict('PV-E8. le super-administrateur réinsère (la restauration, le contrôle positif)', issue, issue = 'OK réinsérée');
  issue := pg_temp.tente(chef, format('insert into operations_inventaire (dossier_id, exercice, nature, compte_resultat, compte_regularisation, montant_centimes, objet, provision_id, cree_par) values (%L, 2025, ''provision'', ''681500'', ''151800'', 1, ''x'', %L, %L) returning ''réinsérée''', dp, p1, chef));
  perform pg_temp.verdict('PV-E9. une évaluation réinsérée hors du compte de sa provision', issue, issue = '23514 ' || m_garde_eval);
  issue := pg_temp.tente(chef, format('insert into operations_inventaire (dossier_id, exercice, nature, compte_resultat, compte_regularisation, montant_centimes, objet, cree_par) values (%L, 2025, ''provision'', ''681500'', ''151100'', 1, ''x'', %L) returning ''réinsérée''', dp, chef));
  perform pg_temp.verdict('PV-E10. une opération « provision » sans provision (la contrainte)', issue, issue like '23514 %operations_inventaire_evaluation%');
  -- Le gel : une provision de 2024 écrite, puis l'exercice 2024 du dossier validé (une ligne d'exercices_valides posée par le
  -- propriétaire, sans la validation : seul compte ici le gel).
  issue := pg_temp.fait(membre, pg_temp.prov(dv, risque || '{"ouverte_en": 2024}', null));
  pdd := case when issue like 'OK %' then substr(issue, 4)::uuid end;
  insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte)
    values (dv, 2024, now(), chef, 'engagement', 0, 0, 0, 0, repeat('0', 64));
  issue := pg_temp.tente(membre, pg_temp.prov(dv, risque || '{"ouverte_en": 2024}', null));
  perform pg_temp.verdict('PV-E11. un exercice validé n''ouvre plus de provision', issue, pdd is not null and issue = '23514 ' || m_fige);
  issue := pg_temp.tente(membre, pg_temp.prov(dv, risque || jsonb_build_object('id', pdd, 'ouverte_en', 2025), 1));
  perform pg_temp.verdict('PV-E12. une provision d''un exercice validé ne se déplace pas dans le suivant', issue, issue = '23514 ' || m_fige);
  issue := pg_temp.tente(membre, format('select public.retirer_provision(%L, %L, 1)::text', dv, pdd));
  perform pg_temp.verdict('PV-E13. ni ne se retire', issue, issue = '23514 ' || m_fige);
  issue := pg_temp.tente(membre, pg_temp.eval(dv, jsonb_build_object('provision_id', pdd, 'exercice', 2024, 'cible_centimes', 1), '[]', null));
  perform pg_temp.verdict('PV-E14. un exercice validé ne s''évalue plus', issue, issue = '23514 ' || m_fige);
  issue := pg_temp.tente(membre, pg_temp.eval(dv, jsonb_build_object('provision_id', pdd, 'exercice', 2025, 'cible_centimes', 700),
    pg_temp.ecriture(2025, lib25, '[["681500","debit",700],["151100","credit",700]]'), null));
  perform pg_temp.verdict('PV-E15. elle s''évalue sur l''exercice suivant (le contrôle positif)', issue, issue like 'OK %');
  -- Le départ du dossier : une provision évaluée part avec lui.
  issue := pg_temp.fait(membre, pg_temp.prov(dd, risque, null));
  issue := pg_temp.fait(membre, pg_temp.eval(dd, jsonb_build_object('provision_id', substr(issue, 4)::uuid, 'exercice', 2025, 'cible_centimes', 500000), ec25, null));
  begin
    delete from dossiers where id = dd;
    issue := 'supprimé ; restent ' || (select count(*) from provisions where dossier_id = dd) || ' provision(s), '
      || (select count(*) from operations_inventaire where dossier_id = dd) || ' évaluation(s)';
  exception when others then issue := sqlstate || ' ' || sqlerrm;
  end;
  perform pg_temp.verdict('PV-E16. le départ du dossier emporte ses provisions évaluées', issue, issue = 'supprimé ; restent 0 provision(s), 0 évaluation(s)');

  -- ══ Les mutations ══
  -- M-PV1 : l'accès ôté de enregistrer_provision ; le client écrit.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_provision(uuid, jsonb, integer)'::regprocedure),
      'or not coalesce(public.admin_du_dossier(p_dossier_id), false)', '');
    issue := pg_temp.tente(client, pg_temp.prov(dp, risque, null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into pv_mutation (mutation, observe, mord) values ('M-PV1 — l''accès ôté de enregistrer_provision', issue, issue like 'OK %');
  -- M-PV2 : le compte des lignes ôté de la comparaison ; une ligne de trop passe.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_evaluation_provision(uuid, jsonb, jsonb, integer)'::regprocedure),
      '(select count(*) from recues) = (select count(*) from attendues)', 'true');
    issue := pg_temp.tente(membre, pg_temp.eval(dr, jsonb_build_object('provision_id', r2, 'exercice', 2025, 'cible_centimes', 60000),
      pg_temp.ecriture(2025, 'Dotation 31/12/2025 — Provision pour risques — Autre litige', '[["681500","debit",10000],["151100","credit",10000],["151100","credit",1]]'), null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into pv_mutation (mutation, observe, mord) values ('M-PV2 — la comparaison sans le compte des lignes : une ligne de trop', issue, issue like 'OK %');
  -- M-PV3 : la provision précédente ignorée (toujours zéro) ; l'écriture que compose le module, par différence, est refusée.
  begin
    execute 'create or replace function public.provision_cible_precedente(p_provision_id uuid, p_exercice integer) returns bigint language sql stable as $f$ select 0::bigint $f$';
    issue := pg_temp.tente(membre, pg_temp.eval(dr, jsonb_build_object('provision_id', r2, 'exercice', 2025, 'cible_centimes', 60000),
      pg_temp.ecriture(2025, 'Dotation 31/12/2025 — Provision pour risques — Autre litige', '[["681500","debit",10000],["151100","credit",10000]]'), null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into pv_mutation (mutation, observe, mord) values ('M-PV3 — la provision précédente ignorée : l''écart du module refusé', issue, issue = '22023 ' || m_ecritures);
  -- M-PV4 : la chaîne ôtée de la fonction et de la garde ; l'évaluation de 2025, suivie de celle de 2026, change.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_evaluation_provision(uuid, jsonb, jsonb, integer)'::regprocedure),
      'o.provision_id = v_provision.id and o.exercice > v_exercice', 'false');
    execute 'create or replace function public.garder_evaluations_de_provision() returns trigger language plpgsql as $g$ begin if tg_op = ''DELETE'' then return old; end if; return new; end $g$';
    issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p1, 'exercice', 2025, 'cible_centimes', 600000),
      pg_temp.ecriture(2025, lib25, '[["681500","debit",600000],["151100","credit",600000]]'), 1));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into pv_mutation (mutation, observe, mord) values ('M-PV4 — la chaîne ôtée : une évaluation suivie d''une autre change', issue, issue like 'OK %');
  -- M-PV5 : la garde des provisions ouverte ; le membre insère en direct.
  begin
    execute 'create or replace function public.garder_provisions() returns trigger language plpgsql as $g$ begin if tg_op = ''DELETE'' then return old; end if; return new; end $g$';
    issue := pg_temp.tente(membre, format('insert into provisions (dossier_id, genre, compte_provision, objet, ouverte_en, cree_par) values (%L, ''risque'', ''151100'', ''direct'', 2025, %L) returning id::text', dp, membre));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into pv_mutation (mutation, observe, mord) values ('M-PV5 — la garde des provisions ouverte', issue, issue like 'OK %');
  -- M-PV6 : la ventilation ôtée de enregistrer_provision ; une part qui dépasse le solde repris passe.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_provision(uuid, jsonb, integer)'::regprocedure),
      'if v_ventile + v_reprise > v_solde then', 'if false then');
    issue := pg_temp.tente(membre, pg_temp.prov(dr, risque || '{"objet": "Troisième litige", "reprise_centimes": 1}', null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into pv_mutation (mutation, observe, mord) values ('M-PV6 — la ventilation ôtée : une part au-delà du solde repris', issue, issue like 'OK %');
  -- M-PV7 : la policy élargie au client du dossier ; il lit les provisions.
  begin
    execute 'alter policy provisions_cabinet on public.provisions using (public.admin_du_dossier(dossier_id) or exists (select 1 from memberships m where m.dossier_id = provisions.dossier_id and m.user_id = auth.uid()))';
    issue := pg_temp.tente(client, format('select count(*)::text from provisions where dossier_id = %L', dp));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into pv_mutation (mutation, observe, mord) values ('M-PV7 — la lecture élargie au client du dossier', issue, issue like 'OK %' and issue <> 'OK 0');
  -- M-PV8 : la provision soldée admise ; elle s'évalue de nouveau.
  begin
    execute replace(pg_get_functiondef('public.enregistrer_evaluation_provision(uuid, jsonb, jsonb, integer)'::regprocedure),
      'order by o.exercice desc limit 1) = 0 then', 'order by o.exercice desc limit 1) = -1 then');
    issue := pg_temp.tente(membre, pg_temp.eval(dp, jsonb_build_object('provision_id', p2, 'exercice', 2025, 'cible_centimes', 100),
      pg_temp.ecriture(2025, 'Dotation 31/12/2025 — Dépréciation de créance — Client en redressement', '[["681700","debit",100],["491000","credit",100]]'), null));
    raise exception 'ANNULATION_ESSAI';
  exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then issue := sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into pv_mutation (mutation, observe, mord) values ('M-PV8 — la provision soldée admise', issue, issue like 'OK %');
end
$essai$;

select 'INVARIANTS' as tableau, controle as ligne, case when ok then 'juste' else '*** EN FAUTE ***' end as resultat, observe as detail
  from pv_verdict
union all
select 'MUTATIONS', mutation, case when mord then 'le contrôle mord' else '*** NE MORD PAS ***' end, observe
  from pv_mutation
union all
select 'BILAN', 'invariants et mutations',
  (select count(*) filter (where not ok) from pv_verdict) || ' en faute / ' || (select count(*) from pv_verdict) || ' ; '
  || (select count(*) filter (where mord) from pv_mutation) || ' mutations sur ' || (select count(*) from pv_mutation) || ' qui mordent', ''
order by 1 desc, 2;

rollback;
