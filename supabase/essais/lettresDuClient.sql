-- LES LETTRES DE MISSION DANS L'ESPACE CLIENT (ligne 47, LM6 ; la migration `lettres_du_client`, PRÉPARÉE le 12/11/2026,
-- supabase/preparees/20261112100000_lettres_du_client.sql, après LM1, B1 et LM4). Le récit : HISTORIQUE.md, « 12/11/2026 —
-- LM6 : LES LETTRES DE MISSION DANS L'ESPACE CLIENT (LIGNE 47) ».
-- SUR UNE RÉPLIQUE SEULEMENT : il désigne le dossier du cabinet de la réplique et suspend la garde des lettres le temps d'un
-- contrôle. À rejouer, par psql (`-f`, pas `-1` : le fichier ouvre et ANNULE sa propre transaction), après toute migration
-- qui touche `lettres_de_mission_du_client`, `lettres_de_mission`, `modeles_lettre_de_mission`, `empreinte_de_la_lettre`,
-- `client_du_dossier`, la case « Documents » ou la désignation du dossier du cabinet.
--
-- Ce qui se prouve ici : QUI lit — ni l'anonyme, ni un compte rattaché à rien, ni le client sans la case « Documents », ni
-- le chef, ni un membre de l'équipe assigné au dossier du client : « Accès refusé à ce dossier. » (42501) ; le client qui
-- porte la case lit (le contrôle positif), alors que les deux tables lui restent fermées ; un dossier inconnu se refuse de
-- même — ; CE QUI SORT — deux clés en tête, vingt-six par lettre et elles seules ; ses honoraires (le contrat est le sien),
-- jamais un auteur, le dossier du cabinet, le compte du signataire, le document signé ni son empreinte, et ce contrôle VOIT
-- un auteur là où il y en a un (sur la ligne de la table) ; les lettres PROPOSÉES de ce client seules, dans l'ordre de leur
-- proposition — jamais un brouillon (L2, et L6 retiré sans avoir été proposé), jamais la lettre d'un autre client (L4) — ;
-- l'histoire de chacune (acceptée sur papier et sa date de signature, refusée, la nouvelle version qui en remplace une) ;
-- `signataire_designe` vrai pour la seule lettre qui désigne ce compte ; `empreinte_verifiee` vraie, puis FAUSSE quand le
-- contenu ne répond plus à l'empreinte (la garde suspendue, le texte du modèle changé) ; un cabinet sans dossier désigné
-- le dit ; un dossier passé à un autre cabinet ne montre pas les lettres du premier ; l'acceptation en ligne reste fermée ;
-- — et le catalogue (security definer, chemin fixé, stable, jsonb, les connectés seuls).
--
-- Le jeu, inséré par le propriétaire : au cabinet de la réplique, le dossier du cabinet K, deux dossiers clients C et C2
-- et, à un second cabinet sans dossier désigné, le dossier O ; l'accès du client d'essai sur C (d'abord sans la case
-- « Documents »), puis sur O ; un document signé dans K. Les lettres de C : L1 proposée puis acceptée sur papier (un
-- forfait de 4321.98 € par trimestre, une tâche de 765.43 €), L5 sa nouvelle version, proposée, qui désigne le compte du
-- client pour signer, L3 proposée puis refusée, L2 un brouillon, L6 un brouillon retiré sans avoir été proposé ; L4,
-- proposée, est celle de C2. Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit. Une garde de
-- tête refuse de le jouer hors d'une réplique (ESSAI_HORS_REPLIQUE), avant toute écriture.
begin;
create temp table essai_lc (rang int, controle text, attendu text, observe text, ok boolean) on commit drop;

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
language sql as $f$ insert into essai_lc values (p_rang, p_controle, p_attendu, p_observe, p_observe like p_attendu || '%') $f$;

do $essai$
declare
  cabinet constant uuid := 'cab10000-0000-4000-8000-000000000001';
  autre_cabinet constant uuid := '1c600000-0000-4000-8000-0000000000cb';
  k constant uuid := '1c600000-0000-4000-8000-0000000000a1';
  c constant uuid := '1c600000-0000-4000-8000-0000000000c1';
  c2 constant uuid := '1c600000-0000-4000-8000-0000000000c2';
  o constant uuid := '1c600000-0000-4000-8000-0000000000b1';
  dk constant uuid := '1c600000-0000-4000-8000-0000000000d1';
  super constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  membre constant text := '3e3b0000-0000-4000-8000-000000000001';
  refus constant text := 'Accès refusé à ce dossier.';
  cles constant text[] := array['id', 'remplace_id', 'missions', 'repartition', 'honoraires', 'date_effet', 'premier_exercice',
    'fin_initiale', 'reconduction_tacite', 'preavis_mois', 'signataire_nom', 'signataire_qualite', 'signataire_designe',
    'identite_client', 'identite_cabinet', 'clauses', 'modele', 'proposee_le', 'empreinte', 'empreinte_verifiee',
    'acceptee_le', 'mode_acceptation', 'signee_le', 'refusee_le', 'retiree_le', 'fin_au'];
  missions_m constant jsonb := '{"tenue_comptable": "Tenir la comptabilité de trésorerie.", "declaration_2035": "Établir la 2035.", "facturation_au_nom_du_client": "Établir les factures au nom et pour le compte du client."}';
  contenu jsonb;
  m uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; l6 uuid;
  r text;
  v jsonb;
  interdits text;
  n int;
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai désigne le dossier du cabinet ; il ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regprocedure('public.lettres_de_mission_du_client(uuid)') is null then
    insert into essai_lc values (0, 'LC. les lettres de mission du client : EN ATTENTE de la migration lettres_du_client', 'la migration', 'absente', true);
    return;
  end if;

  -- Le jeu.
  insert into cabinets (id, nom) values (autre_cabinet, 'ESSAI LM6 AUTRE CABINET');
  insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, siret, adresse) values
    (k, 'ESSAI LM6 CABINET', cabinet, 'tresorerie', '455000', '12345678200010', 'ESSAI LM6 ADRESSE DU CABINET'),
    (c, 'ESSAI LM6 CLIENT', cabinet, 'tresorerie', '455000', null, 'ESSAI LM6 ADRESSE DU CLIENT'),
    (c2, 'ESSAI LM6 AUTRE CLIENT', cabinet, 'tresorerie', '455000', null, 'ESSAI LM6 ADRESSE DE L''AUTRE CLIENT'),
    (o, 'ESSAI LM6 AILLEURS', autre_cabinet, 'tresorerie', '455000', null, 'ESSAI LM6 AILLEURS');
  insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, storage_hash) values
    (dk, k, k || '/divers/signee.pdf', 'signee.pdf', 'autre', repeat('ab', 32));
  insert into memberships (user_id, dossier_id, role, email) values (client::uuid, c, 'client', 'essai-lm6@example.test');
  r := pg_temp.essayer(super, format($q$select designer_dossier_du_cabinet(%L, %L)$q$, cabinet, k));
  if r <> 'OK:' || k then raise exception 'le jeu : la désignation du dossier du cabinet a échoué (%)', r; end if;
  r := pg_temp.essayer(super, format($q$select (enregistrer_modele_de_lettre(%L, 'Modèle LM6', 'Conditions générales LM6', %L::jsonb, '{"sous_traitance": "Clause RGPD.", "mandat_de_facturation": "Mandat préalable."}', null)).id$q$, k, missions_m));
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
  -- L5, pour C : la nouvelle version de L1, qui désigne le compte du client pour signer, proposée.
  r := pg_temp.essayer(super, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k,
    contenu || jsonb_build_object('dossier_client_id', c, 'remplace_id', l1, 'date_effet', '2027-01-01', 'premier_exercice', 2027,
                                  'fin_initiale', '2027-12-31', 'signataire_compte', client)));
  l5 := substr(r, 4)::uuid;
  r := pg_temp.essayer(super, format($q$select (proposer_lettre_de_mission(%L, %L, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l5, l5));
  if r <> 'OK:' || l5 then raise exception 'le jeu : L5 n''est pas proposée (%)', r; end if;
  -- L3, pour C : proposée, puis refusée.
  r := pg_temp.essayer(super, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu || jsonb_build_object('dossier_client_id', c, 'missions', jsonb_build_array('facturation_au_nom_du_client'))));
  l3 := substr(r, 4)::uuid;
  r := pg_temp.essayer(super, format($q$select (proposer_lettre_de_mission(%L, %L, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l3, l3));
  r := pg_temp.essayer(super, format($q$select (enregistrer_reponse_a_la_lettre(%L, %L, 'refusee', null, null)).id$q$, k, l3));
  if r <> 'OK:' || l3 then raise exception 'le jeu : L3 n''est pas refusée (%)', r; end if;
  -- L2, pour C : un brouillon, jamais proposé ; L6, un brouillon retiré sans avoir été proposé.
  r := pg_temp.essayer(super, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu || jsonb_build_object('dossier_client_id', c)));
  l2 := substr(r, 4)::uuid;
  r := pg_temp.essayer(super, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu || jsonb_build_object('dossier_client_id', c, 'missions', jsonb_build_array('facturation_au_nom_du_client'))));
  l6 := substr(r, 4)::uuid;
  r := pg_temp.essayer(super, format($q$select (retirer_lettre_de_mission(%L, %L, null)).id$q$, k, l6));
  if r <> 'OK:' || l6 then raise exception 'le jeu : L6 n''est pas retirée (%)', r; end if;
  -- L4, pour C2 : proposée.
  r := pg_temp.essayer(super, format($q$select (enregistrer_brouillon_de_lettre(%L, null, %L::jsonb, null)).id$q$, k, contenu || jsonb_build_object('dossier_client_id', c2)));
  l4 := substr(r, 4)::uuid;
  r := pg_temp.essayer(super, format($q$select (proposer_lettre_de_mission(%L, %L, (select modifiee_le from lettres_de_mission where id = %L))).id$q$, k, l4, l4));
  if r <> 'OK:' || l4 or l2 is null then raise exception 'le jeu : L2 ou L4 manque (%)', r; end if;

  -- QUI lit : l'accès d'abord, sur le dossier du client.
  r := pg_temp.essayer('anon', format($q$select lettres_de_mission_du_client(%L)::text$q$, c));
  perform pg_temp.noter(1, 'l''anonyme n''exécute pas la fonction', '42501', r);
  r := pg_temp.essayer(gen_random_uuid()::text, format($q$select lettres_de_mission_du_client(%L)::text$q$, c));
  perform pg_temp.noter(2, 'un compte rattaché à rien est refusé', '42501:' || refus, r);
  r := pg_temp.essayer(client, format($q$select lettres_de_mission_du_client(%L)::text$q$, c));
  perform pg_temp.noter(3, 'le client, sans la case « Documents », est refusé', '42501:' || refus, r);
  r := pg_temp.essayer(super, format($q$select lettres_de_mission_du_client(%L)::text$q$, c));
  perform pg_temp.noter(4, 'le chef (super-administrateur de la réplique) est refusé : il lit ses lettres dans son dossier', '42501:' || refus, r);
  insert into dossier_assignations (dossier_id, user_id) values (c, membre::uuid);
  r := pg_temp.essayer(membre, format($q$select lettres_de_mission_du_client(%L)::text$q$, c));
  perform pg_temp.noter(5, 'un membre de l''équipe assigné au dossier du client est refusé', '42501:' || refus, r);
  update memberships set droit_documents = true where dossier_id = c and user_id = client::uuid;
  r := pg_temp.essayer(client, format($q$select lettres_de_mission_du_client(%L)::text$q$, c));
  perform pg_temp.noter(6, 'le client qui porte la case « Documents » lit (contrôle positif)', 'OK:{', r);
  v := case when r like 'OK:{%' then substr(r, 4)::jsonb end;
  -- Comptées dans le seul dossier du cabinet de l'essai (k), où vivent sa lettre et son modèle : rien hors de ses dossiers.
  r := pg_temp.essayer(client, format($q$select (select count(*) from lettres_de_mission where dossier_id = %L)::text || '/' || (select count(*) from modeles_lettre_de_mission where dossier_id = %L)::text$q$, k, k));
  perform pg_temp.noter(7, 'les deux tables lui restent fermées (la fonction est le seul chemin)', 'OK:0/0', r);
  r := pg_temp.essayer(client, format($q$select lettres_de_mission_du_client(%L)::text$q$, gen_random_uuid()));
  perform pg_temp.noter(8, 'un dossier inconnu est refusé de même', '42501:' || refus, r);

  -- CE QUI SORT.
  perform pg_temp.noter(9, 'deux clés en tête, le dossier du cabinet désigné', 'dossier_du_cabinet_designe,lettres true',
    coalesce((select string_agg(x, ',' order by x collate "C") from jsonb_object_keys(v) x), '∅') || ' ' || coalesce(v ->> 'dossier_du_cabinet_designe', '∅'));
  perform pg_temp.noter(10, 'les lettres PROPOSÉES de ce client seules, par leur proposition puis leur identifiant (ni brouillon, ni l''autre client)',
    (select string_agg(l.id::text, ',' order by l.proposee_le, l.id) from lettres_de_mission l where l.id in (l1, l5, l3)) || '|',
    coalesce((select string_agg(e ->> 'id', ',' order by i) from jsonb_array_elements(v -> 'lettres') with ordinality t(e, i)), '∅') || '|');
  select count(*) into n from jsonb_array_elements(v -> 'lettres') e
   where (select count(*) from jsonb_object_keys(e) x) <> 26 or exists (select 1 from jsonb_object_keys(e) x where x <> all (cles));
  perform pg_temp.noter(11, 'chaque lettre porte ses vingt-six clés, et elles seules', '0 en faute', n || ' en faute');
  -- Ce qui ne sort JAMAIS : le dossier du cabinet, les auteurs (le super-administrateur a tout écrit), le compte du
  -- signataire hors du booléen, le document signé et son empreinte.
  interdits := k::text || '|' || super || '|' || dk::text || '|' || repeat('ab', 32) || '|' || client
               || '|"dossier_id"|"auteur"|"proposee_par"|"acceptee_par"|"refusee_par"|"retiree_par"|"signataire_compte"|"document_signe_id"|"empreinte_papier"';
  perform pg_temp.noter(12, 'ni le dossier du cabinet, ni un auteur, ni le compte du signataire, ni le papier signé', 'aucun',
    case when v is null then 'pas de valeur' when v::text ~ interdits then 'TROUVÉ : ' || substring(v::text from interdits) else 'aucun' end);
  perform pg_temp.noter(13, 'le contrôle 12 voit un auteur là où il y en a un (la ligne de la table)', 'trouvé',
    case when (select to_jsonb(l) from lettres_de_mission l where l.id = l1)::text ~ interdits then 'trouvé' else 'AVEUGLE' end);
  perform pg_temp.noter(14, 'L1 : ses honoraires (le contrat est le sien), acceptée sur papier, signée le jour de Paris, empreinte vérifiée, sans désigner ce compte',
    'forfait 4321.98 trimestre tache 765.43 papier ' || (now() at time zone 'Europe/Paris')::date || ' true false',
    coalesce((select (e -> 'honoraires' -> 0 ->> 'forme') || ' ' || (e -> 'honoraires' -> 0 ->> 'montant_ht') || ' ' || (e -> 'honoraires' -> 0 ->> 'periodicite')
                     || ' ' || (e -> 'honoraires' -> 1 ->> 'forme') || ' ' || (e -> 'honoraires' -> 1 ->> 'montant_ht')
                     || ' ' || (e ->> 'mode_acceptation') || ' ' || (e ->> 'signee_le') || ' ' || (e ->> 'empreinte_verifiee') || ' ' || (e ->> 'signataire_designe')
                from jsonb_array_elements(v -> 'lettres') e where e ->> 'id' = l1::text), '∅'));
  perform pg_temp.noter(15, 'L1 : le texte du modèle, les copies d''identité et les clauses (la sous-traitance seule : ses missions n''exigent pas le mandat), tels que figés',
    'Conditions générales LM6 ESSAI LM6 CLIENT ["sous_traitance"]',
    coalesce((select (e -> 'modele' ->> 'conditions_generales') || ' ' || coalesce(e -> 'identite_client' ->> 'denomination', e -> 'identite_client' ->> 'nom', '∅') || ' ' || (e -> 'clauses')::text
                from jsonb_array_elements(v -> 'lettres') e where e ->> 'id' = l1::text), '∅'));
  perform pg_temp.noter(16, 'L5 : la nouvelle version de L1, proposée, sans réponse, qui désigne ce compte pour signer',
    l1::text || ' proposée true',
    coalesce((select (e ->> 'remplace_id') || case when e ->> 'acceptee_le' is null and e ->> 'refusee_le' is null and e ->> 'retiree_le' is null then ' proposée' else ' ?' end
                     || ' ' || (e ->> 'signataire_designe')
                from jsonb_array_elements(v -> 'lettres') e where e ->> 'id' = l5::text), '∅'));
  perform pg_temp.noter(17, 'L3 : refusée', 'refusée',
    coalesce((select case when e ->> 'refusee_le' is not null and e ->> 'acceptee_le' is null then 'refusée' else '?' end
                from jsonb_array_elements(v -> 'lettres') e where e ->> 'id' = l3::text), '∅'));
  perform pg_temp.noter(18, 'l''empreinte rendue est celle que la base a figée à la proposition', 'égale',
    coalesce((select case when e ->> 'empreinte' = (select empreinte from lettres_de_mission where id = l1) then 'égale' else 'DIFFÉRENTE' end
                from jsonb_array_elements(v -> 'lettres') e where e ->> 'id' = l1::text), '∅'));

  -- L'empreinte qui ne répond plus : la garde suspendue (le propriétaire, sur une réplique), le texte du modèle changé.
  alter table modeles_lettre_de_mission disable trigger user;
  update modeles_lettre_de_mission set conditions_generales = conditions_generales || ' (changé)' where id = m;
  alter table modeles_lettre_de_mission enable trigger user;
  r := pg_temp.essayer(client, format($q$select (select string_agg(e ->> 'empreinte_verifiee', ',') from jsonb_array_elements(lettres_de_mission_du_client(%L) -> 'lettres') e)$q$, c));
  perform pg_temp.noter(19, 'le contenu qui ne répond plus à son empreinte se dit : empreinte_verifiee fausse, pour chaque lettre du modèle', 'OK:false,false,false', r);

  -- Les bords.
  insert into memberships (user_id, dossier_id, role, email, droit_documents) values (client::uuid, o, 'client', 'essai-lm6@example.test', true);
  r := pg_temp.essayer(client, format($q$select lettres_de_mission_du_client(%L)::text$q$, o));
  perform pg_temp.noter(20, 'un cabinet sans dossier désigné le dit, sans lettre', 'OK:{"lettres": [], "dossier_du_cabinet_designe": false}', r);
  update dossiers set cabinet_id = autre_cabinet where id = c;
  r := pg_temp.essayer(client, format($q$select lettres_de_mission_du_client(%L)::text$q$, c));
  perform pg_temp.noter(21, 'un dossier passé à un autre cabinet ne montre pas les lettres du premier', 'OK:{"lettres": [], "dossier_du_cabinet_designe": false}', r);
  perform pg_temp.noter(22, 'l''acceptation en ligne reste fermée (LM-Q10)', 'false', public.acceptation_en_ligne_ouverte()::text);

  -- Le catalogue.
  select count(*) into n from pg_proc p
   where p.oid = to_regprocedure('public.lettres_de_mission_du_client(uuid)') and p.prosecdef and p.provolatile = 's'
     and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=public' and pg_get_function_result(p.oid) = 'jsonb'
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false);
  perform pg_temp.noter(23, 'security definer, chemin fixé, stable, jsonb ; les connectés seuls, ni l''anonyme ni PUBLIC', '1', n::text);
end
$essai$;

select case when ok then 'OK  ' else 'FAUX' end || ' ' || lpad(rang::text, 2) || '. ' || controle
       || case when ok then '' else ' — attendu « ' || attendu || ' », observé « ' || observe || ' »' end as ligne
  from essai_lc order by rang, controle;
select count(*) filter (where not ok) || ' en faute / ' || count(*) || ' étapes' as bilan from essai_lc;
rollback;
