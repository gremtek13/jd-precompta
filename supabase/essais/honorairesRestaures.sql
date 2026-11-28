-- LES HONORAIRES DU DOSSIER DU CABINET SE RESTAURENT AVANT SA DÉSIGNATION (ligne 47, HR-Q1 ; la migration préparée
-- `honoraires_restaures_avant_la_designation`, supabase/preparees/20261128100000_…, après LM7 et LM8). Le récit :
-- HISTORIQUE.md, « 28/11/2026 — LA RELECTURE ADVERSE DES HONORAIRES DU CABINET ».
-- SUR UNE RÉPLIQUE SEULEMENT : il insère un dossier, une lettre, une facture validée, un lien et un dépôt, puis désigne le
-- dossier du cabinet de la réplique. À rejouer, par psql (`-f`, pas `-1` : le fichier ouvre et ANNULE sa propre
-- transaction), après toute migration qui touche `garder_honoraires_factures`, `garder_honoraires_deposes`, la désignation
-- du dossier du cabinet ou les portes de la restauration.
--
-- Ce qui se prouve ici : un dossier du cabinet restauré — présent, pas encore désigné, comme la restauration le laisse —
-- reçoit du super-administrateur, par la porte de la restauration, ses liens d'honoraires et ses dépôts tels qu'écrits ; nul
-- autre auteur (un membre de l'équipe affecté au dossier, le propriétaire sans session) n'y insère rien ; le reste de chaque
-- garde tient pour le super-administrateur (une lettre d'un autre dossier, un autre client) ; une fois le dossier désigné,
-- le dépôt restauré se relit et la période restaurée reste facturée. SANS LA MIGRATION, les mêmes étapes constatent le
-- défaut (le lien et le dépôt refusés en 23514) : chaque attendu dit lequel des deux états il juge.
--
-- Le jeu, inséré par le propriétaire : au cabinet de la réplique (aucun dossier désigné), R, le dossier du cabinet tel que la
-- restauration le réécrit (SIRET, adresse, redevable de la TVA), deux clients C et C2 ; une lettre ACCEPTÉE sur papier de R
-- pour C (un forfait mensuel de 150 €) ; une facture validée de janvier 2026, insérée par le super-administrateur comme la
-- restauration la réinsère. Le membre d'essai de la réplique est affecté à R. Une garde de tête refuse de le jouer hors d'une
-- réplique (ESSAI_HORS_REPLIQUE), avant toute écriture.
begin;
create temp table essai_hr (rang int, controle text, attendu text, observe text, ok boolean) on commit drop;

create function pg_temp.essayer(qui text, requete text) returns text language plpgsql as $f$
declare
  v text;
begin
  begin
    if qui = 'anon' then
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      execute 'set local role anon';
    elsif qui is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', qui, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
    end if;
    execute requete into v;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    return 'OK:' || coalesce(v, '∅');
  exception when others then
    return sqlstate || ':' || sqlerrm;
  end;
end
$f$;

create function pg_temp.noter(p_rang int, p_controle text, p_attendu text, p_observe text) returns void
language sql as $f$ insert into essai_hr values (p_rang, p_controle, p_attendu, p_observe, p_observe like p_attendu || '%') $f$;

do $essai$
declare
  cabinet constant uuid := 'cab10000-0000-4000-8000-000000000001';
  k constant uuid := '1b900000-0000-4000-8000-0000000000a1';
  c constant uuid := '1b900000-0000-4000-8000-0000000000c1';
  c2 constant uuid := '1b900000-0000-4000-8000-0000000000c2';
  dk constant uuid := '1b900000-0000-4000-8000-0000000000d1';
  l1 constant uuid := '1b900000-0000-4000-8000-0000000000e1';
  lc constant uuid := '1b900000-0000-4000-8000-0000000000e2';
  f1 constant uuid := '1b900000-0000-4000-8000-0000000000f1';
  super constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  hash_dk constant text := repeat('ab', 32);
  e1 constant text := repeat('1', 64);
  migree boolean;
  lien text;
  depot text;
  r text;
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai insère un dossier, une facture, un lien et un dépôt, puis désigne le dossier du cabinet ; il ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.honoraires_deposes') is null or to_regclass('public.honoraires_factures') is null then
    insert into essai_hr values (0, 'HR. EN ATTENTE des migrations honoraires_factures et depot_des_honoraires', 'les migrations', 'absentes', true);
    return;
  end if;
  migree := (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = 'public.garder_honoraires_factures()'::regprocedure)
              = '4163f6b990755e54af3d917b52739be9'
        and (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = 'public.garder_honoraires_deposes()'::regprocedure)
              = '1159501c7f11ba9dd1e27421b6bb1a9a';
  insert into essai_hr values (0, case when migree then 'HR. la migration honoraires_restaures_avant_la_designation est en base : les attendus d''après'
    else 'HR. SANS la migration honoraires_restaures_avant_la_designation : les attendus constatent le défaut' end, '', '', true);
  if (select dossier_du_cabinet from cabinets where id = cabinet) is not null then
    insert into essai_hr values (1, 'le cabinet de la réplique ne désigne aucun dossier', 'aucun', 'un dossier désigné', false);
    return;
  end if;

  insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, siret, adresse, statut_tva) values
    (k, 'ESSAI HR CABINET RESTAURÉ', cabinet, 'tresorerie', '455000', '12345678200010', 'ESSAI HR ADRESSE DU CABINET', 'redevable'),
    (c, 'ESSAI HR CLIENT', cabinet, 'tresorerie', '455000', '98765432100017', 'ESSAI HR ADRESSE DU CLIENT', null),
    (c2, 'ESSAI HR SECOND CLIENT', cabinet, 'tresorerie', '455000', '11122233300015', 'ESSAI HR AILLEURS', null);
  insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, storage_hash) values
    (dk, k, k || '/divers/signee.pdf', 'signee.pdf', 'autre', hash_dk), (gen_random_uuid(), c, c || '/divers/signee.pdf', 'signee.pdf', 'autre', hash_dk);
  insert into lettres_de_mission (id, dossier_id, dossier_client_id, missions, honoraires, date_effet, premier_exercice,
      fin_initiale, reconduction_tacite, signataire_nom, identite_client, identite_cabinet, clauses, empreinte, proposee_le,
      proposee_par, acceptee_le, acceptee_par, mode_acceptation, empreinte_acceptee, document_signe_id, empreinte_papier,
      signee_le, auteur)
  values (l1, k, c, '{tenue_comptable}', '[{"forme": "forfait", "libelle": "Tenue mensuelle", "montant_ht": 150, "periodicite": "mois"}]',
          '2026-01-01', 2026, '2026-12-31', true, 'Signataire', '{}', '{}', '{sous_traitance}', repeat('7', 64), '2025-12-01',
          super::uuid, '2025-12-05', super::uuid, 'papier', repeat('7', 64), dk, hash_dk, '2025-12-04', super::uuid),
         -- Une lettre d'un AUTRE dossier (C, pour C2) : la garde la refuse à un lien de R, même au super-administrateur.
         (lc, c, c2, '{tenue_comptable}', '[{"forme": "forfait", "libelle": "Tenue mensuelle", "montant_ht": 150, "periodicite": "mois"}]',
          '2026-01-01', 2026, '2026-12-31', true, 'Signataire', '{}', '{}', '{sous_traitance}', repeat('8', 64), '2025-12-01',
          super::uuid, '2025-12-05', super::uuid, 'papier', repeat('8', 64),
          (select id from documents_divers where dossier_id = c limit 1), hash_dk, '2025-12-04', super::uuid);
  insert into dossier_assignations (dossier_id, user_id) values (k, membre::uuid);

  perform pg_temp.noter(1, 'le dossier restauré n''est pas désigné', 'f', (public.est_dossier_du_cabinet(k))::text);
  r := pg_temp.essayer(super, format($q$insert into factures_emises (id, dossier_id, numero, statut, date_emission, tiers_nom, montant_ht,
         montant_tva, montant_ttc, type, mentions_figees, validated_at) values (%L, %L, 'F2026-0001', 'validee', '2026-01-31', 'ESSAI HR CLIENT',
         150, 30, 180, 'facture', false, '2026-01-31') returning 1$q$, f1, k));
  perform pg_temp.noter(2, 'la restauration réinsère la facture validée du dossier pas encore désigné', 'OK:1', r);

  -- Le lien : nul autre que le super-administrateur ; lui, sous la migration.
  r := pg_temp.essayer(membre, format($q$insert into honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut,
         periode_fin, auteur) values (%L, %L, %L, 1, '2026-01-01', '2026-01-31', %L) returning 1$q$, k, f1, l1, membre));
  perform pg_temp.noter(3, 'le membre affecté au dossier n''insère pas de lien (la désignation, puis la policy)',
    '23514:Une facture d''honoraires se lie, dans le dossier du cabinet, à une lettre de mission de ce dossier.', r);
  r := pg_temp.essayer(null, format($q$insert into honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut,
         periode_fin, auteur) values (%L, %L, %L, 1, '2026-01-01', '2026-01-31', %L) returning 1$q$, k, f1, l1, super));
  perform pg_temp.noter(4, 'le propriétaire sans session non plus',
    '23514:Une facture d''honoraires se lie, dans le dossier du cabinet, à une lettre de mission de ce dossier.', r);
  r := pg_temp.essayer(super, format($q$insert into honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut,
         periode_fin, auteur) values (%L, %L, %L, 1, '2026-01-01', '2026-01-31', %L) returning 1$q$, k, f1, lc, super));
  perform pg_temp.noter(5, 'la restauration : pas la lettre d''un autre dossier',
    '23514:Une facture d''honoraires se lie, dans le dossier du cabinet, à une lettre de mission de ce dossier.', r);
  lien := pg_temp.essayer(super, format($q$insert into honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut,
         periode_fin, auteur) values (%L, %L, %L, 1, '2026-01-01', '2026-01-31', %L) returning 1$q$, k, f1, l1, super));
  perform pg_temp.noter(6, case when migree then 'la restauration réinsère le lien d''honoraires du dossier pas encore désigné'
    else 'LE DÉFAUT : la restauration ne réinsère pas le lien d''honoraires du dossier pas encore désigné' end,
    case when migree then 'OK:1' else '23514:Une facture d''honoraires se lie, dans le dossier du cabinet' end, lien);

  -- Le dépôt.
  r := pg_temp.essayer(membre, format('insert into honoraires_deposes (dossier_id, facture_id, depot, dossier_client_id, piece_id, empreinte, auteur) values (%L, %L, 1, %L, gen_random_uuid(), %L, %L) returning 1', k, f1, c, e1, membre));
  perform pg_temp.noter(7, 'le membre n''insère pas de dépôt', '23514:Une facture d''honoraires se dépose depuis le dossier du cabinet.', r);
  r := pg_temp.essayer(super, format('insert into honoraires_deposes (dossier_id, facture_id, depot, dossier_client_id, piece_id, empreinte, auteur) values (%L, %L, 1, %L, gen_random_uuid(), %L, %L) returning 1', k, f1, c2, e1, super));
  perform pg_temp.noter(8, 'la restauration : pas chez un autre client que celui des honoraires',
    case when migree then '23514:Une facture d''honoraires se dépose chez le client que ses honoraires désignent.'
    else '23514:Une facture d''honoraires se dépose depuis le dossier du cabinet.' end, r);
  depot := pg_temp.essayer(super, format('insert into honoraires_deposes (dossier_id, facture_id, depot, dossier_client_id, piece_id, empreinte, auteur) values (%L, %L, 1, %L, gen_random_uuid(), %L, %L) returning 1', k, f1, c, e1, super));
  perform pg_temp.noter(9, case when migree then 'la restauration réinsère le dépôt du dossier pas encore désigné'
    else 'LE DÉFAUT : la restauration ne réinsère pas le dépôt du dossier pas encore désigné' end,
    case when migree then 'OK:1' else '23514:Une facture d''honoraires se dépose depuis le dossier du cabinet.' end, depot);

  -- Puis le chef désigne le dossier restauré : le dépôt se relit, la période reste facturée.
  r := pg_temp.essayer(super, format($q$select designer_dossier_du_cabinet(%L, %L)$q$, cabinet, k));
  perform pg_temp.noter(10, 'le dossier restauré se désigne ensuite', 'OK:' || k, r);
  r := pg_temp.essayer(super, format($q$select count(*)::text || ' ' || coalesce(bool_or(presente)::text, 'aucun') from depots_des_honoraires(%L)$q$, k));
  perform pg_temp.noter(11, 'le dépôt restauré se relit (sa pièce, d''un autre dossier, absente ici)',
    case when migree then 'OK:1 false' else 'OK:0 aucun' end, r);
  r := pg_temp.essayer(super, format($q$select facturer_honoraires(%L, '[{"lettre_id": "%s", "ligne": 1, "periode_debut": "2026-01-01", "periode_fin": "2026-01-31"}]'::jsonb, 20, null)::text$q$, k, l1));
  perform pg_temp.noter(12, case when migree then 'la période restaurée reste facturée'
    else 'LE DÉFAUT : sans son lien, la période restaurée se facture une seconde fois' end,
    case when migree then '23514:Cette période est déjà facturée' else 'OK:' end, r);
  perform pg_temp.noter(13, 'les gardes ne s''exécutent par aucun rôle de session', 'false false false false',
    has_function_privilege('anon', 'public.garder_honoraires_factures()', 'execute')::text || ' '
    || has_function_privilege('authenticated', 'public.garder_honoraires_factures()', 'execute')::text || ' '
    || has_function_privilege('anon', 'public.garder_honoraires_deposes()', 'execute')::text || ' '
    || has_function_privilege('authenticated', 'public.garder_honoraires_deposes()', 'execute')::text);
end
$essai$;

select case when ok then 'OK  ' else 'FAUX' end || ' ' || lpad(rang::text, 2) || '. ' || controle
       || case when ok then '' else ' — attendu « ' || attendu || ' », observé « ' || observe || ' »' end as ligne
  from essai_hr order by rang, controle;
select count(*) filter (where not ok) || ' en faute / ' || count(*) || ' étapes' as bilan from essai_hr;
rollback;
