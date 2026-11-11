-- LES MISSIONS D'UN CLIENT, SANS SES HONORAIRES (ligne 47, LM5-Q2 ; la migration `missions_du_client`, PRÉPARÉE le
-- 11/11/2026, supabase/preparees/20261111236000_missions_du_client.sql, après LM1 et LM4). Le récit : HISTORIQUE.md,
-- « LM5-Q2 : LES MISSIONS D'UN CLIENT SANS SES HONORAIRES, EN BASE (LIGNE 47) (PRÉPARÉE, PAS APPLIQUÉE) ».
-- SUR UNE RÉPLIQUE SEULEMENT : il désigne le dossier du cabinet de la réplique. À rejouer, par psql (`-f`, pas `-1` : le
-- fichier ouvre et ANNULE sa propre transaction), après toute migration qui touche `missions_du_client`,
-- `lettres_de_mission`, `admin_du_dossier`, la désignation du dossier du cabinet ou `dossier_assignations`.
--
-- Ce qui se prouve ici : QUI lit — ni l'anonyme, ni un compte rattaché à rien, ni le client (son accès au dossier), ni un
-- membre de l'équipe que ce dossier n'a pas : « Accès refusé à ce dossier. » (42501) ; le membre assigné au SEUL dossier
-- du client lit (le contrôle positif), alors que la table des lettres lui reste fermée ; le chef lit la même valeur ; un
-- dossier inconnu se refuse aussi au super-administrateur — ; CE QUI SORT — deux clés en tête, douze par lettre et elles
-- seules ; aucun montant, aucune périodicité, aucun libellé, aucun taux, aucune répartition, identité, clause, empreinte ni
-- signataire, et ce contrôle VOIT un montant là où il y en a un (sur la ligne de la table) ; les lettres proposées de ce
-- client seules, dans l'ordre de leur proposition, ni son brouillon (LM5Q2-Q1) ni la lettre d'un autre client ; un
-- cabinet sans dossier désigné le dit ; — et le catalogue (security definer, chemin fixé, stable, jsonb, les connectés
-- seuls).
--
-- Le jeu, inséré par le propriétaire : au cabinet de la réplique, le dossier du cabinet K, deux dossiers clients C et C2
-- (une adresse chacun ; l'accès du client d'essai sur C) et, à un second cabinet sans dossier désigné, le dossier O ; un
-- document signé dans K. Les lettres de C : L1 proposée puis acceptée sur papier (un forfait de 4321.98 € par trimestre,
-- une tâche de 765.43 €), L3 proposée puis refusée, L2 un brouillon au temps passé (135.79 € de l'heure) ; L4, proposée,
-- est celle de C2. Le membre de l'équipe de la réplique n'est assigné à C qu'en cours d'essai, jamais à K. Sans la
-- migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit. Une garde de tête refuse de le jouer hors d'une
-- réplique (ESSAI_HORS_REPLIQUE), avant toute écriture.
begin;
create temp table essai_mv (rang int, controle text, attendu text, observe text, ok boolean) on commit drop;

-- Joue `requete` sous le profil `qui` (un `sub`, 'anon' ou null : le propriétaire sans session) ; rend 'OK:<valeur>' ou
-- '<sqlstate>:<message>'. Temporaire : rien ne reste.
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
language sql as $f$ insert into essai_mv values (p_rang, p_controle, p_attendu, p_observe, p_observe like p_attendu || '%') $f$;

-- Ce qu'une valeur rendue ne doit JAMAIS porter : un mot des honoraires ou du contenu réservé au dossier du cabinet, ou
-- l'un des montants du jeu (un point décimal : un identifiant n'en porte pas).
create function pg_temp.porte_un_montant(v jsonb) returns boolean language sql as $f$
  select v::text ~* '(montant|libell|periodicit|livrable|honorair|repartition|identite|empreinte|clause|signataire|modele|auteur|trimestre|4321\.98|765\.43|135\.79)'
$f$;

do $essai$
declare
  cabinet constant uuid := 'cab10000-0000-4000-8000-000000000001';
  autre_cabinet constant uuid := '1b500000-0000-4000-8000-0000000000cb';
  k constant uuid := '1b500000-0000-4000-8000-0000000000a1';
  c constant uuid := '1b500000-0000-4000-8000-0000000000c1';
  c2 constant uuid := '1b500000-0000-4000-8000-0000000000c2';
  o constant uuid := '1b500000-0000-4000-8000-0000000000b1';
  dk constant uuid := '1b500000-0000-4000-8000-0000000000d1';
  super constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  refus constant text := 'Accès refusé à ce dossier.';
  cles constant text[] := array['id', 'remplace_id', 'dossier_client_id', 'missions', 'date_effet', 'fin_initiale',
                                'reconduction_tacite', 'proposee_le', 'acceptee_le', 'refusee_le', 'retiree_le', 'fin_au'];
  missions_m constant jsonb := '{"tenue_comptable": "Tenir la comptabilité de trésorerie.", "declaration_2035": "Établir la 2035.", "facturation_au_nom_du_client": "Établir les factures au nom et pour le compte du client."}';
  contenu jsonb;
  m uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid;
  r text;
  v jsonb;
  v_chef jsonb;
  n int;
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai désigne le dossier du cabinet ; il ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regprocedure('public.missions_du_client(uuid)') is null then
    insert into essai_mv values (0, 'MV. les missions d''un client : EN ATTENTE de la migration missions_du_client', 'la migration', 'absente', true);
    return;
  end if;

  -- Le jeu.
  insert into cabinets (id, nom) values (autre_cabinet, 'ESSAI LM5Q2 AUTRE CABINET');
  insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, siret, adresse) values
    (k, 'ESSAI LM5Q2 CABINET', cabinet, 'tresorerie', '455000', '12345678200010', 'ESSAI LM5Q2 ADRESSE DU CABINET'),
    (c, 'ESSAI LM5Q2 CLIENT', cabinet, 'tresorerie', '455000', null, 'ESSAI LM5Q2 ADRESSE DU CLIENT'),
    (c2, 'ESSAI LM5Q2 AUTRE CLIENT', cabinet, 'tresorerie', '455000', null, 'ESSAI LM5Q2 ADRESSE DE L''AUTRE CLIENT'),
    (o, 'ESSAI LM5Q2 AILLEURS', autre_cabinet, 'tresorerie', '455000', null, 'ESSAI LM5Q2 AILLEURS');
  insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, storage_hash) values
    (dk, k, k || '/divers/signee.pdf', 'signee.pdf', 'autre', repeat('ab', 32));
  insert into memberships (user_id, dossier_id, role, email) values (client::uuid, c, 'client', 'essai-lm5q2@example.test');
  r := pg_temp.essayer(super, format($q$select designer_dossier_du_cabinet(%L, %L)$q$, cabinet, k));
  if r <> 'OK:' || k then raise exception 'le jeu : la désignation du dossier du cabinet a échoué (%)', r; end if;
  r := pg_temp.essayer(super, format($q$select (enregistrer_modele_de_lettre(%L, 'Modèle MV', 'Conditions générales MV', %L::jsonb, '{"sous_traitance": "Clause RGPD.", "mandat_de_facturation": "Mandat préalable."}', null)).id$q$, k, missions_m));
  m := substr(r, 4)::uuid;
  contenu := jsonb_build_object('modele_id', m, 'missions', jsonb_build_array('tenue_comptable', 'declaration_2035'),
    'repartition', '[{"tache": "Transmettre les pièces chaque mois", "par": "client"}]'::jsonb,
    'honoraires', '[{"forme": "forfait", "libelle": "Tenue trimestrielle", "montant_ht": 4321.98, "periodicite": "trimestre"}, {"forme": "tache", "libelle": "Déclaration 2035", "montant_ht": 765.43, "livrable": "declaration_2035"}]'::jsonb,
    'date_effet', '2026-01-01', 'premier_exercice', 2026, 'fin_initiale', '2026-12-31',
    'signataire_nom', 'Signataire Essai', 'signataire_qualite', 'Titulaire');
  -- L1, pour C : proposée, puis acceptée sur papier.
  r := pg_temp.essayer(super, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu || jsonb_build_object('dossier_client_id', c)));
  l1 := substr(r, 4)::uuid;
  r := pg_temp.essayer(super, format($q$select (proposer_lettre_de_mission(%L, %L, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l1, l1));
  r := pg_temp.essayer(super, format($q$select (enregistrer_reponse_a_la_lettre(%L, %L, 'acceptee_sur_papier', %L, (now() at time zone 'Europe/Paris')::date)).id$q$, k, l1, dk));
  if r <> 'OK:' || l1 then raise exception 'le jeu : L1 n''est pas acceptée (%)', r; end if;
  -- L3, pour C : proposée, puis refusée.
  r := pg_temp.essayer(super, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu || jsonb_build_object('dossier_client_id', c, 'missions', jsonb_build_array('facturation_au_nom_du_client'))));
  l3 := substr(r, 4)::uuid;
  r := pg_temp.essayer(super, format($q$select (proposer_lettre_de_mission(%L, %L, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l3, l3));
  r := pg_temp.essayer(super, format($q$select (enregistrer_reponse_a_la_lettre(%L, %L, 'refusee', null, null)).id$q$, k, l3));
  if r <> 'OK:' || l3 then raise exception 'le jeu : L3 n''est pas refusée (%)', r; end if;
  -- L2, pour C : un brouillon au temps passé, jamais proposé.
  r := pg_temp.essayer(super, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu || jsonb_build_object('dossier_client_id', c, 'honoraires', '[{"forme": "temps", "libelle": "Heure", "montant_ht": 135.79}]'::jsonb)));
  l2 := substr(r, 4)::uuid;
  -- L4, pour C2 : proposée.
  r := pg_temp.essayer(super, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu || jsonb_build_object('dossier_client_id', c2)));
  l4 := substr(r, 4)::uuid;
  r := pg_temp.essayer(super, format($q$select (proposer_lettre_de_mission(%L, %L, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l4, l4));
  if r <> 'OK:' || l4 or l2 is null then raise exception 'le jeu : L2 ou L4 manque (%)', r; end if;

  -- QUI lit : l'accès d'abord, sur le dossier du client.
  r := pg_temp.essayer('anon', format($q$select missions_du_client(%L)::text$q$, c));
  perform pg_temp.noter(1, 'l''anonyme n''exécute pas la fonction', '42501', r);
  r := pg_temp.essayer(gen_random_uuid()::text, format($q$select missions_du_client(%L)::text$q$, c));
  perform pg_temp.noter(2, 'un compte rattaché à rien est refusé', '42501:' || refus, r);
  r := pg_temp.essayer(client, format($q$select missions_du_client(%L)::text$q$, c));
  perform pg_temp.noter(3, 'le client, par son accès au dossier, est refusé', '42501:' || refus, r);
  r := pg_temp.essayer(membre, format($q$select missions_du_client(%L)::text$q$, c));
  perform pg_temp.noter(4, 'un membre de l''équipe que le dossier du client n''a pas est refusé', '42501:' || refus, r);
  insert into dossier_assignations (dossier_id, user_id) values (c, membre::uuid);
  r := pg_temp.essayer(membre, format($q$select missions_du_client(%L)::text$q$, c));
  perform pg_temp.noter(5, 'le membre assigné au seul dossier du client lit (contrôle positif)', 'OK:{', r);
  v := case when r like 'OK:{%' then substr(r, 4)::jsonb end;
  r := pg_temp.essayer(membre, format($q$select count(*)::text from lettres_de_mission where dossier_id = %L$q$, k));
  perform pg_temp.noter(6, 'la table des lettres lui reste fermée (la fonction est le seul chemin)', 'OK:0', r);

  -- CE QUI SORT.
  perform pg_temp.noter(7, 'deux clés en tête, le dossier du cabinet désigné', 'dossier_du_cabinet_designe,lettres true',
    coalesce((select string_agg(x, ',' order by x collate "C") from jsonb_object_keys(v) x), '∅') || ' ' || coalesce(v ->> 'dossier_du_cabinet_designe', '∅'));
  -- L'ordre attendu : la proposition, puis l'identifiant (dans une transaction, `now()` ne bouge pas : L1 et L3 sont
  -- proposées au même instant, et l'identifiant les départage).
  perform pg_temp.noter(8, 'les lettres proposées de ce client seules, dans l''ordre de leur proposition (ni le brouillon, ni l''autre client)',
    (select string_agg(l.id::text, ',' order by l.proposee_le, l.id) from lettres_de_mission l where l.id in (l1, l3)) || '|',
    coalesce((select string_agg(e ->> 'id', ',' order by i) from jsonb_array_elements(v -> 'lettres') with ordinality t(e, i)), '∅') || '|');
  select count(*) into n from jsonb_array_elements(v -> 'lettres') e
   where (select count(*) from jsonb_object_keys(e) x) <> 12 or exists (select 1 from jsonb_object_keys(e) x where x <> all (cles));
  perform pg_temp.noter(9, 'chaque lettre porte ses douze clés, et elles seules', '0 en faute', n || ' en faute');
  perform pg_temp.noter(10, 'aucun montant, aucune périodicité, aucun libellé, aucun taux, ni rien du contenu réservé', 'aucun',
    case when v is null then 'pas de valeur' when pg_temp.porte_un_montant(v) then 'TROUVÉ : ' || v::text else 'aucun' end);
  perform pg_temp.noter(11, 'le contrôle 10 voit un montant là où il y en a un (la ligne de la table)', 'trouvé',
    case when pg_temp.porte_un_montant((select to_jsonb(l) from lettres_de_mission l where l.id = l1)) then 'trouvé' else 'AVEUGLE' end);
  perform pg_temp.noter(12, 'L1 : ses missions et ses dates, acceptée', '["tenue_comptable", "declaration_2035"] 2026-01-01 2026-12-31 true acceptée',
    coalesce((select (e -> 'missions')::text || ' ' || (e ->> 'date_effet') || ' ' || (e ->> 'fin_initiale') || ' ' || (e ->> 'reconduction_tacite')
                     || case when e ->> 'acceptee_le' is not null and e ->> 'refusee_le' is null then ' acceptée' else ' ?' end
                from jsonb_array_elements(v -> 'lettres') e where e ->> 'id' = l1::text), '∅'));
  perform pg_temp.noter(13, 'L3 : refusée', 'refusée',
    coalesce((select case when e ->> 'refusee_le' is not null and e ->> 'acceptee_le' is null then 'refusée' else '?' end
                from jsonb_array_elements(v -> 'lettres') e where e ->> 'id' = l3::text), '∅'));
  r := pg_temp.essayer(super, format($q$select missions_du_client(%L)::text$q$, c));
  v_chef := case when r like 'OK:{%' then substr(r, 4)::jsonb end;
  perform pg_temp.noter(14, 'le chef lit la même valeur', 'égale', case when v_chef = v then 'égale' else 'DIFFÉRENTE : ' || r end);

  -- Les bords.
  r := pg_temp.essayer(super, format($q$select missions_du_client(%L)::text$q$, gen_random_uuid()));
  perform pg_temp.noter(15, 'un dossier inconnu est refusé, même au super-administrateur', '42501:' || refus, r);
  r := pg_temp.essayer(super, format($q$select missions_du_client(%L)::text$q$, o));
  perform pg_temp.noter(16, 'un cabinet sans dossier désigné le dit, sans lettre', 'OK:{"lettres": [], "dossier_du_cabinet_designe": false}', r);
  r := pg_temp.essayer(super, format($q$select jsonb_array_length(missions_du_client(%L) -> 'lettres')::text$q$, k));
  perform pg_temp.noter(17, 'le dossier du cabinet lui-même : aucune lettre ne le nomme', 'OK:0', r);
  r := pg_temp.essayer(super, format($q$select jsonb_array_length(missions_du_client(%L) -> 'lettres')::text$q$, c2));
  perform pg_temp.noter(18, 'l''autre client : sa seule lettre', 'OK:1', r);
  -- Le même dossier passé à un autre cabinet (le propriétaire) : les lettres de l'ancien ne le suivent pas — la fonction ne
  -- lit que le dossier que SON cabinet a désigné.
  update dossiers set cabinet_id = autre_cabinet where id = c2;
  r := pg_temp.essayer(super, format($q$select missions_du_client(%L)::text$q$, c2));
  perform pg_temp.noter(20, 'un dossier passé à un autre cabinet ne montre pas les lettres du premier', 'OK:{"lettres": [], "dossier_du_cabinet_designe": false}', r);

  -- Le catalogue.
  select count(*) into n from pg_proc p
   where p.oid = to_regprocedure('public.missions_du_client(uuid)') and p.prosecdef and p.provolatile = 's'
     and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=public' and pg_get_function_result(p.oid) = 'jsonb'
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false);
  perform pg_temp.noter(19, 'security definer, chemin fixé, stable, jsonb ; les connectés seuls, ni l''anonyme ni PUBLIC', '1', n::text);
end
$essai$;

select case when ok then 'OK  ' else 'FAUX' end || ' ' || lpad(rang::text, 2) || '. ' || controle
       || case when ok then '' else ' — attendu « ' || attendu || ' », observé « ' || observe || ' »' end as ligne
  from essai_mv order by rang, controle;
select count(*) filter (where not ok) || ' en faute / ' || count(*) || ' étapes' as bilan from essai_mv;
rollback;
