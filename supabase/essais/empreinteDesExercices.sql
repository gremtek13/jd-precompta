-- L'EMPREINTE D'UN EXERCICE VALIDÉ EN FORME 2, ÉPROUVÉE EN BASE (ligne 44, INAL2 ; migration
-- `empreinte_des_exercices_forme_2`, PRÉPARÉE) — à rejouer après toute migration qui touche `valider_exercice`,
-- `verifier_exercice_valide`, `empreinte_exercice`, `empreinte_exercice_forme_2` ou la table `exercices_valides`. Joué par
-- le super-utilisateur (`session_replication_role`, comme validationExercice.sql), en UNE transaction (`psql -1`) : le
-- réglage qui porte les verdicts est local à la transaction. Avant la migration, une seule ligne dit qu'il attend.
--
-- Tout se joue dans des dossiers JETABLES du cabinet du chef (préfixe `e2f00000`), au sein d'un bloc qui s'annule
-- entièrement à la fin ; aucune suppression, aucune table créée (deux fonctions temporaires de la session, `pg_temp`).
-- Rien de ce qu'il rend ne dépend d'une ligne hors de ses dossiers. Le récit : HISTORIQUE.md, « 10/11/2026 — INAL1 ET
-- INAL2 ».
--
-- CE QUI SE PROUVE :
--   1 à 4. Le chef valide 2024 du dossier T (trésorerie : un achat qui cite la pièce PF, une dotation du bien IB que la pièce
--          PB justifie ; la pièce PL, libre, qu'une écriture proposée de 2025 cite) : la ligne porte la forme 2, son
--          empreinte se vérifie, elle n'est pas celle de la forme 1, elle est celle que RECALCULE ICI la formule écrite à
--          part (l'étiquette, l'en-tête, la forme 1, les pièces PF et PB nommées, la 2035), et la fonction la rend telle
--          qu'elle l'enregistre ; les soldes reportés de 2025 la portent ;
--   5 à 7. 2025 se valide en forme 2, chaînée à 2024 ; sous la session du chef du cabinet NON super-administrateur (la RLS
--          s'applique à la relecture des pièces), elle se vérifie ; sous celle du client du dossier, rien (nul) ;
--   8 à 19. Chaque élément falsifié hors déclencheur, puis rétabli, se voit puis se revoit juste (« false/true ») : le
--          SHA-256, le chemin, la version lisible de PF ; le SHA-256 de PB, par son bien ; la 2035 ; l'instant, l'auteur,
--          le mode, les comptes, les totaux ; la forme rabattue à 1 ; un libellé d'écriture (la forme 1, enveloppée). Le
--          SHA-256 de la pièce libre PL, lui, ne change rien (« true/true », le contrôle NÉGATIF) ;
--   20 et 21. Une ligne de forme 1 se vérifie par la formule d'hier, et le maillon tient d'une forme à l'autre ; un
--          maillon cassé se voit sur l'exercice suivant ;
--   22 à 24. La restauration : le super-administrateur réinsère une ligne sans la colonne — elle est de forme 1, le
--          défaut —, une ligne de forme 2 la garde, une forme 3 se refuse (la contrainte) ;
--   25 et 26. Le catalogue : la colonne, sa contrainte ; la fonction de forme 2 (stable, sans `security definer`, son
--          chemin de recherche ; exécutable par authenticated, pas par l'anonyme) ; les droits d'hier gardés.
-- MUTATIONS, chacune doit MORDRE (dans la sous-transaction de son étape, la fonction réelle altérée — sa définition lue au
-- catalogue, un fragment remplacé ; introuvable, le fragment fait tomber la mutation —, puis 2024 rescellée par elle
-- quand l'empreinte change) : M1 sans les pièces, M2 sans le bien, M3 sans la version lisible, M4 sans la 2035, M5 sans
-- l'instant de la validation, M6 la vérification qui lit tout en forme 1, M7 la validation qui écrit la forme 1, M8 les
-- pièces de tout le dossier.
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  cabinet uuid;
  dt uuid := 'e2f00000-0000-4000-8000-0000000000a1';
  dr uuid := 'e2f00000-0000-4000-8000-0000000000b1';
  d7 uuid := 'e2f00000-0000-4000-8000-0000000000c1';
  pf uuid := 'e2f00000-0000-4000-8000-000000000f01';
  pb uuid := 'e2f00000-0000-4000-8000-000000000f02';
  pl uuid := 'e2f00000-0000-4000-8000-000000000f03';
  ib uuid := 'e2f00000-0000-4000-8000-000000000b01';
  e1 uuid := 'e2f00000-0000-4000-8000-000000000e01';
  e2 uuid := 'e2f00000-0000-4000-8000-000000000e02';
  e3 uuid := 'e2f00000-0000-4000-8000-000000000e03';
  e4 uuid := 'e2f00000-0000-4000-8000-000000000e04';
  -- Lue après la garde : avant la migration, la fonction n'existe pas.
  forme_2 regprocedure;
  rescelle constant text := $r$update exercices_valides set empreinte = empreinte_exercice_forme_2(dossier_id, annee,
      empreinte_precedente, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit,
      declaration) where dossier_id = 'e2f00000-0000-4000-8000-0000000000a1' and annee = 2024$r$;
  lignes jsonb;
  rendu jsonb;
  obs text; obs2 text; n bigint;
  avant text; apres text;
  erreur text;
  v jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.exercices_valides'::regclass
                  and a.attname = 'forme_empreinte' and not a.attisdropped) then
    v := v || jsonb_build_object('genre', 'controle', 'controle', '0. EN ATTENTE : la migration empreinte_des_exercices_forme_2 n''est pas en base',
      'observe', 'forme_empreinte absente', 'ok', true);
    perform set_config('essai.empreinte_des_exercices', v::text, true);
    return;
  end if;
  forme_2 := to_regprocedure('public.empreinte_exercice_forme_2(uuid, integer, text, timestamp with time zone, uuid, text, integer, integer, numeric, numeric, jsonb)');
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or not exists (select 1 from super_admins where user_id = chef)
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou comptes rattachés autrement qu''attendu';
  end if;

  -- Falsifier hors déclencheur, vérifier, rétablir, revérifier : « faux/vrai » pour un élément que l'empreinte compte.
  create function pg_temp.falsifier(p_faux text, p_juste text, p_dossier uuid, p_annee integer) returns text
  language plpgsql as $f$
  declare
    apres_faux boolean;
    apres_juste boolean;
  begin
    perform set_config('session_replication_role', 'replica', true);
    execute p_faux;
    perform set_config('session_replication_role', 'origin', true);
    apres_faux := public.verifier_exercice_valide(p_dossier, p_annee);
    perform set_config('session_replication_role', 'replica', true);
    execute p_juste;
    perform set_config('session_replication_role', 'origin', true);
    apres_juste := public.verifier_exercice_valide(p_dossier, p_annee);
    return coalesce(apres_faux::text, 'nul') || '/' || coalesce(apres_juste::text, 'nul');
  end
  $f$;
  -- Une mutation altère une fonction réelle : sa définition lue au catalogue, un fragment remplacé ; introuvable, il lève.
  create function pg_temp.muter(p_fonction regprocedure, p_de text, p_vers text) returns text
  language plpgsql as $m$
  declare
    d text := pg_get_functiondef(p_fonction);
  begin
    if position(p_de in d) = 0 then
      raise exception 'MUTATION_SANS_PRISE : %', p_de;
    end if;
    execute replace(d, p_de, p_vers);
    return 'mutée';
  end
  $m$;

  select string_agg(x::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from pieces)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from immobilisations)), ((select count(*) from exercices_valides)), ((select count(*) from soldes_reportes)),
    ((select count(*) from cabinet_admins)), ((select count(*) from memberships))) as t(x);

  begin
    -- ══ Le jeu ══════════
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id, mode_comptable) values
      (dt, 'ESSAI INAL2 T', cabinet, 'tresorerie'), (dr, 'ESSAI INAL2 R', cabinet, 'tresorerie'),
      (d7, 'ESSAI INAL2 M7', cabinet, 'tresorerie');
    insert into memberships (user_id, dossier_id, role, email) values (client, dt, 'client', 'essai-inal2@exemple.invalid');
    insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash, lisible_path, statut, type_piece, date_piece, montant_ttc) values
      (pf, dt, dt || '/achat.pdf', 'achat.pdf', repeat('a', 64), dt || '/achat-lisible.pdf', 'validee', 'achat', '2024-03-10', 120),
      (pb, dt, dt || '/bien.pdf', 'bien.pdf', repeat('b', 64), null, 'validee', 'achat', '2024-01-15', 1500),
      (pl, dt, dt || '/libre.pdf', 'libre.pdf', repeat('c', 64), null, 'validee', 'achat', '2025-02-01', 10);
    insert into immobilisations (id, dossier_id, piece_id, libelle, valeur, date_acquisition, duree_annees)
      values (ib, dt, pb, 'ESSAI INAL2 bien', 1500, '2024-01-15', 3);
    insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens, statut, piece_id, immobilisation_id) values
      (e1, dt, '2024-03-10', '606100', 'ESSAI INAL2 achat', 120, 'debit', 'proposee', pf, null),
      (e2, dt, '2024-03-10', '512000', 'ESSAI INAL2 achat', 120, 'credit', 'proposee', pf, null),
      (e3, dt, '2024-12-31', '681100', 'ESSAI INAL2 dotation', 500, 'debit', 'proposee', null, ib),
      (e4, dt, '2024-12-31', '281830', 'ESSAI INAL2 dotation', 500, 'credit', 'proposee', null, ib);
    insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, piece_id) values
      (dt, '2025-02-01', '606100', 'ESSAI INAL2 libre', 10, 'debit', 'proposee', pl),
      (dt, '2025-02-01', '512000', 'ESSAI INAL2 libre', 10, 'credit', 'proposee', pl);
    lignes := jsonb_build_array(
      jsonb_build_object('id', e1, 'journal', 'AC', 'numero', 1, 'piece_ref', 'F-1', 'piece_date', '2024-03-10', 'compte_lib', 'Achats'),
      jsonb_build_object('id', e2, 'journal', 'AC', 'numero', 1, 'piece_ref', 'F-1', 'piece_date', '2024-03-10', 'compte_lib', 'Banque'),
      jsonb_build_object('id', e3, 'journal', 'OD', 'numero', 1, 'piece_ref', 'DOT-2024', 'piece_date', '2024-12-31', 'compte_lib', 'Dotations'),
      jsonb_build_object('id', e4, 'journal', 'OD', 'numero', 1, 'piece_ref', 'DOT-2024', 'piece_date', '2024-12-31', 'compte_lib', 'Amortissements'));

    -- ══ 1 à 4. 2024, validée par le chef ══════════
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    rendu := valider_exercice(dt, 2024, lignes, '[]'::jsonb, '{"essai": "T", "resultat": -620}'::jsonb);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select x.forme_empreinte || '/' || verifier_exercice_valide(dt, 2024) into obs from exercices_valides x where x.dossier_id = dt and x.annee = 2024;
    v := v || jsonb_build_object('genre', 'controle', 'controle', '1. 2024 validée porte la forme 2, et se vérifie', 'observe', obs, 'ok', obs = '2/true');
    select (x.empreinte <> empreinte_exercice(x.dossier_id, x.annee, x.empreinte_precedente))::text into obs
      from exercices_valides x where x.dossier_id = dt and x.annee = 2024;
    v := v || jsonb_build_object('genre', 'controle', 'controle', '2. ce n''est pas l''empreinte de la forme 1', 'observe', obs, 'ok', obs = 'true');
    -- La formule, écrite ici à part de la fonction : l'étiquette ; l'en-tête ; la forme 1 ; les pièces PF et PB, NOMMÉES ;
    -- la 2035.
    select (encode(sha256(convert_to(
        'jd-precompta/exercice-valide/forme-2' || chr(29)
        || x.dossier_id || chr(31) || x.annee || chr(31) || x.annee || '-01-01' || chr(31) || x.annee || '-12-31' || chr(31)
        || to_char(x.valide_le at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || chr(31) || x.valide_par || chr(31)
        || x.mode_comptable || chr(31) || x.nb_lignes || chr(31) || x.nb_ecritures || chr(31)
        || trim_scale(x.total_debit) || chr(31) || trim_scale(x.total_credit)
        || chr(29) || empreinte_exercice(x.dossier_id, x.annee, x.empreinte_precedente)
        || chr(29) || (select string_agg(p.id || chr(31) || p.storage_path || chr(31) || coalesce(p.storage_hash, '') || chr(31)
                                         || coalesce(p.lisible_path, ''), chr(30) order by p.id)
                         from pieces p where p.id in (pf, pb))
        || chr(29) || coalesce(x.declaration::text, ''),
        'UTF8')), 'hex') = x.empreinte)::text || '/' || (rendu ->> 'empreinte' = x.empreinte)::text
      into obs from exercices_valides x where x.dossier_id = dt and x.annee = 2024;
    v := v || jsonb_build_object('genre', 'controle', 'controle', '3. elle est celle que la formule écrite ici recalcule (les pièces PF et PB, nommées), et la validation la rend',
      'observe', obs, 'ok', obs = 'true/true');
    select count(*) filter (where s.source_empreinte = x.empreinte) || '/' || count(*) into obs
      from soldes_reportes s join exercices_valides x on x.dossier_id = s.dossier_id and x.annee = 2024
     where s.dossier_id = dt and s.date = '2025-01-01';
    v := v || jsonb_build_object('genre', 'controle', 'controle', '4. les soldes reportés de 2025 portent l''empreinte de forme 2', 'observe', obs,
      'ok', obs ~ '^([1-9][0-9]*)/\1$');

    -- ══ 5 à 7. 2025 ══════════
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    rendu := valider_exercice(dt, 2025,
      (select jsonb_agg(jsonb_build_object('id', e.id, 'journal', 'AC', 'numero', 1, 'piece_ref', 'F-2', 'piece_date', '2025-02-01',
                                           'compte_lib', case e.compte when '606100' then 'Achats' else 'Banque' end))
         from ecritures_brouillon e where e.dossier_id = dt and e.date = '2025-02-01'),
      (select jsonb_agg(jsonb_build_object('id', s.id, 'compte_lib', case s.compte when '512000' then 'Banque' else 'Compte ' || s.compte end,
                                           'ecriture_lib', 'Ouverture'))
         from soldes_reportes s where s.dossier_id = dt and s.date = '2025-01-01'),
      '{"essai": "T", "resultat": -10}'::jsonb);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select b.forme_empreinte || '/' || (b.empreinte_precedente = a.empreinte) || '/' || verifier_exercice_valide(dt, 2025)
      into obs from exercices_valides a join exercices_valides b on b.dossier_id = a.dossier_id and b.annee = 2025
     where a.dossier_id = dt and a.annee = 2024;
    v := v || jsonb_build_object('genre', 'controle', 'controle', '5. 2025 se valide en forme 2, chaînée à 2024, et se vérifie', 'observe', obs, 'ok', obs = '2/true/true');
    begin
      insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      obs := verifier_exercice_valide(dt, 2024) || '/' || verifier_exercice_valide(dt, 2025);
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    v := v || jsonb_build_object('genre', 'controle', 'controle', '6. le chef du cabinet non super-administrateur les vérifie, sous la RLS', 'observe', obs, 'ok', obs = 'true/true');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    obs := coalesce(verifier_exercice_valide(dt, 2024)::text, 'nul');
    reset role;
    perform set_config('request.jwt.claims', '', true);
    v := v || jsonb_build_object('genre', 'controle', 'controle', '7. le client du dossier n''en vérifie rien', 'observe', obs, 'ok', obs = 'nul');

    -- ══ 8 à 19. Falsifié hors déclencheur, puis rétabli ══════════
    obs := pg_temp.falsifier(format('update pieces set storage_hash = repeat(''9'', 64) where id = %L', pf),
                             format('update pieces set storage_hash = repeat(''a'', 64) where id = %L', pf), dt, 2024);
    v := v || jsonb_build_object('genre', 'controle', 'controle', '8. le SHA-256 du fichier de PF', 'observe', obs, 'ok', obs = 'false/true');
    obs := pg_temp.falsifier(format('update pieces set storage_path = %L where id = %L', dt || '/autre.pdf', pf),
                             format('update pieces set storage_path = %L where id = %L', dt || '/achat.pdf', pf), dt, 2024);
    v := v || jsonb_build_object('genre', 'controle', 'controle', '9. le chemin de son fichier', 'observe', obs, 'ok', obs = 'false/true');
    obs := pg_temp.falsifier(format('update pieces set lisible_path = %L where id = %L', dt || '/autre-lisible.pdf', pf),
                             format('update pieces set lisible_path = %L where id = %L', dt || '/achat-lisible.pdf', pf), dt, 2024);
    v := v || jsonb_build_object('genre', 'controle', 'controle', '10. le chemin de sa version lisible', 'observe', obs, 'ok', obs = 'false/true');
    obs := pg_temp.falsifier(format('update pieces set storage_hash = repeat(''9'', 64) where id = %L', pb),
                             format('update pieces set storage_hash = repeat(''b'', 64) where id = %L', pb), dt, 2024);
    v := v || jsonb_build_object('genre', 'controle', 'controle', '11. le SHA-256 du fichier de PB, que la dotation cite par son bien', 'observe', obs, 'ok', obs = 'false/true');
    obs := pg_temp.falsifier(format('update pieces set storage_hash = repeat(''9'', 64) where id = %L', pl),
                             format('update pieces set storage_hash = repeat(''c'', 64) where id = %L', pl), dt, 2024);
    v := v || jsonb_build_object('genre', 'controle', 'controle', '12. le SHA-256 de PL, qu''aucune écriture validée de 2024 ne cite, ne change rien (contrôle négatif)', 'observe', obs, 'ok', obs = 'true/true');
    obs := pg_temp.falsifier(format('update exercices_valides set declaration = %L where dossier_id = %L and annee = 2024', '{"essai": "T", "resultat": -621}', dt),
                             format('update exercices_valides set declaration = %L where dossier_id = %L and annee = 2024', '{"essai": "T", "resultat": -620}', dt), dt, 2024);
    v := v || jsonb_build_object('genre', 'controle', 'controle', '13. la 2035 validée', 'observe', obs, 'ok', obs = 'false/true');
    select x.valide_le::text into obs2 from exercices_valides x where x.dossier_id = dt and x.annee = 2024;
    obs := pg_temp.falsifier(format('update exercices_valides set valide_le = valide_le + interval ''1 microsecond'' where dossier_id = %L and annee = 2024', dt),
                             format('update exercices_valides set valide_le = %L where dossier_id = %L and annee = 2024', obs2, dt), dt, 2024);
    v := v || jsonb_build_object('genre', 'controle', 'controle', '14. l''instant de la validation, d''une microseconde', 'observe', obs, 'ok', obs = 'false/true');
    obs := pg_temp.falsifier(format('update exercices_valides set valide_par = %L where dossier_id = %L and annee = 2024', client, dt),
                             format('update exercices_valides set valide_par = %L where dossier_id = %L and annee = 2024', chef, dt), dt, 2024);
    v := v || jsonb_build_object('genre', 'controle', 'controle', '15. son auteur', 'observe', obs, 'ok', obs = 'false/true');
    obs := pg_temp.falsifier(format('update exercices_valides set mode_comptable = ''engagement'', declaration = null where dossier_id = %L and annee = 2024', dt),
                             format('update exercices_valides set mode_comptable = ''tresorerie'', declaration = %L where dossier_id = %L and annee = 2024', '{"essai": "T", "resultat": -620}', dt), dt, 2024);
    v := v || jsonb_build_object('genre', 'controle', 'controle', '16. le mode comptable (et la 2035 qu''il exige)', 'observe', obs, 'ok', obs = 'false/true');
    obs := pg_temp.falsifier(format('update exercices_valides set nb_lignes = nb_lignes + 1 where dossier_id = %L and annee = 2024', dt),
                             format('update exercices_valides set nb_lignes = nb_lignes - 1 where dossier_id = %L and annee = 2024', dt), dt, 2024);
    v := v || jsonb_build_object('genre', 'controle', 'controle', '17. le nombre de lignes', 'observe', obs, 'ok', obs = 'false/true');
    obs := pg_temp.falsifier(format('update exercices_valides set total_debit = total_debit + 1, total_credit = total_credit + 1 where dossier_id = %L and annee = 2024', dt),
                             format('update exercices_valides set total_debit = total_debit - 1, total_credit = total_credit - 1 where dossier_id = %L and annee = 2024', dt), dt, 2024);
    v := v || jsonb_build_object('genre', 'controle', 'controle', '18. les totaux', 'observe', obs, 'ok', obs = 'false/true');
    obs := pg_temp.falsifier(format('update exercices_valides set forme_empreinte = 1 where dossier_id = %L and annee = 2024', dt),
                             format('update exercices_valides set forme_empreinte = 2 where dossier_id = %L and annee = 2024', dt), dt, 2024);
    v := v || jsonb_build_object('genre', 'controle', 'controle', '19. la forme rabattue à 1 ; et un libellé d''écriture (la forme 1, enveloppée)', 'observe', obs || ' | '
      || pg_temp.falsifier(format('update ecritures_brouillon set libelle = ''ESSAI FAUX'' where id = %L', e1),
                           format('update ecritures_brouillon set libelle = ''ESSAI INAL2 achat'' where id = %L', e1), dt, 2024),
      'ok', obs || ' | ' || pg_temp.falsifier(format('update ecritures_brouillon set libelle = ''ESSAI FAUX'' where id = %L', e1),
                           format('update ecritures_brouillon set libelle = ''ESSAI INAL2 achat'' where id = %L', e1), dt, 2024) = 'false/true | false/true');

    -- ══ 20 et 21. La forme 1, et le maillon d'une forme à l'autre ══════════
    begin
      update exercices_valides set forme_empreinte = 1, empreinte = empreinte_exercice(dossier_id, annee, empreinte_precedente)
       where dossier_id = dt and annee = 2025;
      obs := verifier_exercice_valide(dt, 2025) || '/' || verifier_exercice_valide(dt, 2024);
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    v := v || jsonb_build_object('genre', 'controle', 'controle', '20. une ligne de forme 1 (2025) se vérifie par la formule d''hier, chaînée à une ligne de forme 2', 'observe', obs, 'ok', obs = 'true/true');
    begin
      update exercices_valides set forme_empreinte = 1, empreinte = empreinte_exercice(dossier_id, annee, empreinte_precedente)
       where dossier_id = dt and annee = 2024;
      obs := verifier_exercice_valide(dt, 2024) || '/' || verifier_exercice_valide(dt, 2025);
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    v := v || jsonb_build_object('genre', 'controle', 'controle', '21. 2024 réécrite en forme 1 se vérifie seule, et le maillon de 2025 casse', 'observe', obs, 'ok', obs = 'true/false');

    -- ══ 22 à 24. La restauration ══════════
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration)
        values (dr, 2024, '2025-02-01 10:00+00', chef, 'tresorerie', 0, 0, 0, 0, repeat('c', 64), '{}'::jsonb);
      insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte_precedente, empreinte, declaration, forme_empreinte)
        values (dr, 2025, '2026-02-01 10:00+00', chef, 'tresorerie', 0, 0, 0, 0, repeat('c', 64), repeat('d', 64), '{}'::jsonb, 2);
      reset role;
      select string_agg(x.annee || ':' || x.forme_empreinte, ',' order by x.annee) into obs from exercices_valides x where x.dossier_id = dr;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    v := v || jsonb_build_object('genre', 'controle', 'controle', '22 et 23. le super-administrateur réinsère une ligne sans la colonne : forme 1 ; une ligne de forme 2 la garde', 'observe', obs, 'ok', obs = '2024:1,2025:2');
    begin
      insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration, forme_empreinte)
        values (dr, 2024, now(), chef, 'tresorerie', 0, 0, 0, 0, repeat('c', 64), '{}'::jsonb, 3);
      obs := 'accepté';
    exception when others then obs := sqlstate || ' ' || sqlerrm;
    end;
    v := v || jsonb_build_object('genre', 'controle', 'controle', '24. une forme 3 se refuse', 'observe', obs, 'ok', obs like '23514 %exercices_valides_forme_empreinte%');

    -- ══ 25 et 26. Le catalogue ══════════
    select format_type(a.atttypid, a.atttypmod) || '/' || a.attnotnull || '/' || pg_get_expr(d.adbin, d.adrelid) || '/'
           || (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = a.attrelid and c.conname = 'exercices_valides_forme_empreinte')
      into obs from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = 'public.exercices_valides'::regclass and a.attname = 'forme_empreinte';
    v := v || jsonb_build_object('genre', 'controle', 'controle', '25. la colonne : smallint, non nulle, 1 par défaut, 1 ou 2', 'observe', obs,
      'ok', obs = 'smallint/true/1/CHECK ((forme_empreinte = ANY (ARRAY[1, 2])))');
    select p.prosecdef || '/' || p.provolatile::text || '/' || array_to_string(p.proconfig, ',')
           || '/' || has_function_privilege('anon', p.oid, 'execute') || '/' || has_function_privilege('authenticated', p.oid, 'execute')
           || '/' || (select string_agg(f || ':' || has_function_privilege('anon', ('public.' || f)::regprocedure, 'execute') || ':'
                                        || has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute'), ',' order by f)
                        from unnest(array['valider_exercice(uuid, integer, jsonb, jsonb, jsonb)', 'verifier_exercice_valide(uuid, integer)',
                                          'empreinte_exercice(uuid, integer, text)']) f)
      into obs from pg_proc p where p.oid = forme_2;
    v := v || jsonb_build_object('genre', 'controle', 'controle', '26. la fonction de forme 2 (sans security definer, stable, son chemin ; authenticated, pas l''anonyme), et les droits d''hier',
      'observe', obs,
      'ok', obs = 'false/s/search_path=public/false/true/empreinte_exercice(uuid, integer, text):false:true,valider_exercice(uuid, integer, jsonb, jsonb, jsonb):false:true,verifier_exercice_valide(uuid, integer):false:true');

    -- ══ Les mutations ══════════
    -- M1 à M5, M8 : la fonction de forme 2 altérée, 2024 rescellée par elle, puis l'élément falsifié et rétabli. Elle mord
    -- quand la falsification passe inaperçue (« true/true ») — pour M8, quand celle de la pièce libre se voit.
    declare
      m record;
    begin
      for m in select * from (values
          ('M1', 'sans les pièces : le contrôle 8 tombe', 'where p.id in (', 'where false and p.id in (',
             format('update pieces set storage_hash = repeat(''9'', 64) where id = %L', pf), format('update pieces set storage_hash = repeat(''a'', 64) where id = %L', pf), 'true/true'),
          ('M2', 'sans le bien : le contrôle 11 tombe', 'where e.dossier_id = p_dossier_id and e.statut = ''validee'' and i.piece_id is not null',
             'where false and e.dossier_id = p_dossier_id and e.statut = ''validee'' and i.piece_id is not null',
             format('update pieces set storage_hash = repeat(''9'', 64) where id = %L', pb), format('update pieces set storage_hash = repeat(''b'', 64) where id = %L', pb), 'true/true'),
          ('M3', 'sans la version lisible : le contrôle 10 tombe', 'coalesce(p.lisible_path, '''')', '''''',
             format('update pieces set lisible_path = %L where id = %L', dt || '/autre-lisible.pdf', pf), format('update pieces set lisible_path = %L where id = %L', dt || '/achat-lisible.pdf', pf), 'true/true'),
          ('M4', 'sans la 2035 : le contrôle 13 tombe', '|| chr(29) || coalesce(p_declaration::text, '''')', '|| chr(29)',
             format('update exercices_valides set declaration = %L where dossier_id = %L and annee = 2024', '{"essai": "T", "resultat": -621}', dt),
             format('update exercices_valides set declaration = %L where dossier_id = %L and annee = 2024', '{"essai": "T", "resultat": -620}', dt), 'true/true'),
          ('M5', 'sans l''instant de la validation : le contrôle 14 tombe', 'to_char(p_valide_le at time zone ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.US'')', '''''',
             format('update exercices_valides set valide_le = valide_le + interval ''1 microsecond'' where dossier_id = %L and annee = 2024', dt),
             format('update exercices_valides set valide_le = valide_le - interval ''1 microsecond'' where dossier_id = %L and annee = 2024', dt), 'true/true'),
          ('M8', 'les pièces de tout le dossier : le contrôle 12 tombe', 'where p.id in (', 'where p.dossier_id = p_dossier_id or p.id in (',
             format('update pieces set storage_hash = repeat(''9'', 64) where id = %L', pl), format('update pieces set storage_hash = repeat(''c'', 64) where id = %L', pl), 'false/true')
        ) x(num, quoi, de, vers, faux, juste, mord) loop
        obs := null;
        begin
          perform pg_temp.muter(forme_2, m.de, m.vers);
          execute rescelle;
          obs := pg_temp.falsifier(m.faux, m.juste, dt, 2024);
          raise exception 'ANNULATION_ESSAI';
        exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then obs := sqlstate || ' ' || sqlerrm; end if;
        end;
        v := v || jsonb_build_object('genre', 'mutation', 'controle', m.num || '. ' || m.quoi, 'observe', coalesce(obs, '?'), 'ok', obs = m.mord);
      end loop;
    end;
    -- M6 : la vérification qui lit tout en forme 1 — le contrôle 1 tombe.
    obs := null;
    begin
      perform pg_temp.muter('public.verifier_exercice_valide(uuid, integer)'::regprocedure, 'case v.forme_empreinte', 'case 1');
      obs := coalesce(verifier_exercice_valide(dt, 2024)::text, 'nul');
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    v := v || jsonb_build_object('genre', 'mutation', 'controle', 'M6. la vérification qui lit tout en forme 1 : le contrôle 1 tombe', 'observe', coalesce(obs, '?'), 'ok', obs = 'false');
    -- M7 : la validation qui écrit la forme 1 — sur le dossier M7, vide, validé dans la sous-transaction.
    obs := null;
    begin
      perform pg_temp.muter('public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure, 'p_declaration end, 2);', 'p_declaration end, 1);');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform valider_exercice(d7, 2024, '[]'::jsonb, '[]'::jsonb, '{"essai": "M7"}'::jsonb);
      reset role;
      select x.forme_empreinte || '/' || verifier_exercice_valide(d7, 2024) into obs from exercices_valides x where x.dossier_id = d7 and x.annee = 2024;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    v := v || jsonb_build_object('genre', 'mutation', 'controle', 'M7. la validation qui écrit la forme 1 : le contrôle 1 tombe', 'observe', coalesce(obs, '?'), 'ok', obs is distinct from '2/true');

    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('session_replication_role', 'origin', true);

  select string_agg(x::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from pieces)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from immobilisations)), ((select count(*) from exercices_valides)), ((select count(*) from soldes_reportes)),
    ((select count(*) from cabinet_admins)), ((select count(*) from memberships))) as t(x);
  -- L'écart seul, non les comptes de toute la base.
  v := v || jsonb_build_object('genre', 'controle', 'controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base',
    'observe', coalesce(erreur || ' — ', '') || 'écarts ' || (select string_agg(to_char(e.apres_::bigint - e.avant_::bigint, 'FMSG9999999990'), '/' order by e.rang_)
                                                from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as e(avant_, apres_, rang_)),
    'ok', erreur is null and avant = apres and not exists (select 1 from dossiers where id in (dt, dr, d7)));
  perform set_config('essai.empreinte_des_exercices', v::text, true);
end
$essai$;

select x.genre, x.controle, x.verdict, x.observe from (
  select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                   else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
  from jsonb_to_recordset(current_setting('essai.empreinte_des_exercices')::jsonb) as v(controle text, genre text, ok boolean, observe text)
) x
order by x.genre desc, (regexp_match(x.controle, '^M?(\d+)'))[1]::int, x.controle;
