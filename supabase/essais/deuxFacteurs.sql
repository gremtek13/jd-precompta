-- Essai de la double authentification EXIGÉE (C7, second temps ; migration `deux_facteurs_exiges`, PRÉPARÉE). À REJOUER
-- ENTIER, par psql, sur une RÉPLIQUE seulement (jamais en production) : il pose des facteurs dans auth.mfa_factors, des
-- sessions dans auth.sessions, et `retirer_second_facteur` en SUPPRIME — tout se défait par sous-transaction, mais une
-- suppression jouée en production y est retenue par l'outil (CLAUDE.md, supabase/essais/). Le catalogue seul, lui, se
-- rejoue partout : le bloc DF de rls.sql.
--
-- Les profils sont ceux du semis de la réplique : S, le chef du cabinet ET super-administrateur ; M, un comptable de
-- l'équipe assigné à `test` ; C, le client d'essai du dossier du client ; et, posé ici, K, un second chef du même cabinet,
-- qui n'est pas super-administrateur. Chaque profil se joue avec un jeton `aal1` et un jeton `aal2` : `request.jwt.claims`
-- porte le compte, le rôle, le niveau et la date d'émission (`iat`, en secondes ; par défaut, la seconde où la transaction
-- a commencé), comme PostgREST les pose depuis le jeton de GoTrue.
--   DF1. Un compte exigé, à aal1, ne lit AUCUNE ligne d'aucune table de public (boucle sur pg_class) ; à aal2, il lit ce
--        que ses policies lui ouvrent (contrôle positif : ses accès, ses pièces). Un compte non exigé, à aal1, lit comme hier.
--   DF2. Il n'écrit rien à aal1 (une mise à jour ne touche aucune ligne, une insertion se refuse en 42501) ; à aal2, si —
--        la restauration du super-administrateur exigé passe donc à aal2, et pas à aal1.
--   DF3. storage.objects : rien à aal1, ses fichiers à aal2.
--   DF4. La pré-requête de PostgREST : un compte exigé à aal1 refusé en 403 (sqlstate PGRST) sur une table comme sur une
--        fonction, laissé passer sur les deux lectures de la porte ; à aal2, l'anonyme, le service, un compte non exigé :
--        rien.
--   DF5. Ce que la RLS ne voit pas : une fonction `security definer` (admin_du_dossier) répond à aal1 — la pré-requête est
--        sa garde, et DF4 le vérifie.
--   DF6. Les fonctions du cabinet : poser sur un compte qui a un facteur vérifié seulement, une fois ; lever ; retirer
--        (facteurs et sessions partis, trace gardée, exigence restée) ; ni le client, ni le membre, ni l'anonyme, ni un
--        chef sur un chef ; un compte rattaché à un autre cabinet ne s'affaiblit que par le super-administrateur.
--   DF7. `deux_facteurs_des_comptes` : l'équipe au chef, les accès d'un dossier à qui l'administre, rien au client.
--   DF8. `ma_double_authentification` : l'exigence, la satisfaction, l'espace.
--   DF9. L'appareil perdu : après `retirer_second_facteur`, un jeton émis avant le retrait (son `iat`) ne lit plus rien,
--        `aal2` compris, exigé ou non, ni dans la seconde du retrait, ni sans `iat` numérique (sans lever) ; un jeton émis
--        après (la reconnexion) lit ses accès, et un compte sans retrait lit comme hier.
-- Onze mutations, qui doivent mordre (M-DF1 à M-DF11), chacune annulée avec sa sous-transaction : M-DF8 à M-DF11 ôtent la
-- clause du retrait, la réservent au compte exigé, la laissent passer sans `iat`, ou la font refuser pour toujours.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create temp table df_verdict (controle text, cible text, observe text, ok boolean);
create temp table df_mutation (mutation text, attendu text, observe text, mord boolean);
grant all on df_verdict, df_mutation to public;

-- Le profil d'une requête : le rôle de PostgREST et le jeton qu'il pose (le compte nul : l'anonyme).
create function pg_temp.comme(p_compte uuid, p_aal text, p_chemin text default 'dossiers', p_iat bigint default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when p_compte is null then '{"role":"anon"}'
    else json_build_object('sub', p_compte, 'role', 'authenticated', 'aal', p_aal,
                           'iat', coalesce(p_iat, floor(extract(epoch from now()))::bigint))::text end, true);
  perform set_config('request.path', '/' || p_chemin, true);
  perform set_config('role', case when p_compte is null then 'anon' else 'authenticated' end, true);
end $$;

-- DF1 : la somme des lignes lues dans toutes les tables de public, et la liste de celles qui en rendent.
create function pg_temp.lu_partout() returns text language plpgsql as $$
declare t record; n bigint; lues text := '';
begin
  for t in select c.oid::regclass as rel, c.relname from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by c.relname collate "C" loop
    begin
      execute format('select count(*) from %s', t.rel) into n;
    exception when insufficient_privilege then n := 0;
    end;
    if n > 0 then lues := lues || t.relname || '=' || n || ' '; end if;
  end loop;
  return trim(lues);
end $$;

-- Un appel qui doit se refuser : la raison rendue (le sqlstate, puis le message), jamais un « pas accepté ».
create function pg_temp.raison(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'accepté';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
grant execute on function pg_temp.comme(uuid, text, text, bigint), pg_temp.lu_partout(), pg_temp.raison(text) to public;

do $essai$
declare
  s constant uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';   -- chef et super-administrateur
  m constant uuid := '3e3b0000-0000-4000-8000-000000000001';   -- comptable de l'équipe, assigné à test
  c constant uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';   -- client du dossier du client
  k constant uuid := 'c4ef0000-0000-4000-8000-0000000000c2';   -- second chef, posé ici
  cab constant uuid := 'cab10000-0000-4000-8000-000000000001';
  cab2 constant uuid := 'cab20000-0000-4000-8000-0000000000c2';
  d_test constant uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  d_client constant uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  d_quatre constant uuid := 'd0551e20-0000-4000-8000-000000000004';
  obs text; obs2 text; n bigint; j jsonb; mutation text; t0 bigint; b boolean; b2 boolean; b3 boolean;
  v jsonb := '[]'::jsonb;
begin
  -- Le décor, défait à la fin : K et son rattachement, un facteur vérifié pour S, M et C, deux sessions pour C.
  insert into auth.users (id, email) values (k, 'second-chef@essai.invalid');
  insert into public.cabinet_admins (user_id, cabinet_id, role, email) values (k, cab, 'comptable_en_chef', 'second-chef@essai.invalid');
  insert into auth.mfa_factors (user_id, friendly_name, status) values (s, 'téléphone S', 'verified'), (m, 'téléphone M', 'verified');
  insert into auth.sessions (user_id) values (c), (c);

  -- ── DF8, puis DF1 à DF5 : C exigé ; S exigé ; M jamais ─────────────────────────────────────────────────────────────
  insert into public.exigences_deux_facteurs (user_id, posee_par) values (c, s), (s, s);
  perform pg_temp.comme(c, 'aal1');
  j := public.ma_double_authentification();
  reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF8. la porte lit l''exigence, sa satisfaction et l''espace', 'C exigé, aal1', j::text,
    j = '{"exigee": true, "espace": "client", "satisfaite": false}'::jsonb));
  perform pg_temp.comme(m, 'aal1');
  j := public.ma_double_authentification();
  reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF8. la porte lit l''exigence, sa satisfaction et l''espace', 'M non exigé, aal1', j::text,
    j = '{"exigee": false, "espace": "cabinet", "satisfaite": true}'::jsonb));

  perform pg_temp.comme(c, 'aal1'); obs := pg_temp.lu_partout(); reset role;
  perform pg_temp.comme(c, 'aal2'); obs2 := pg_temp.lu_partout(); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF1. un compte exigé ne lit rien à aal1', 'C', coalesce(nullif(obs, ''), 'rien'), obs = ''));
  v := v || jsonb_build_array(jsonb_build_array('DF1. contrôle positif : à aal2, il lit ses accès et ses pièces', 'C', obs2,
    obs2 like '%memberships=1%' and obs2 like '%pieces=2%'));
  perform pg_temp.comme(s, 'aal1'); obs := pg_temp.lu_partout(); reset role;
  perform pg_temp.comme(s, 'aal2'); obs2 := pg_temp.lu_partout(); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF1. un compte exigé ne lit rien à aal1', 'S (super-administrateur)', coalesce(nullif(obs, ''), 'rien'), obs = ''));
  v := v || jsonb_build_array(jsonb_build_array('DF1. contrôle positif : à aal2, il lit ses accès et ses pièces', 'S', left(obs2, 120),
    obs2 like '%dossiers=4%'));
  perform pg_temp.comme(m, 'aal1'); obs := pg_temp.lu_partout(); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF1. un compte non exigé lit à aal1 comme hier', 'M', left(coalesce(nullif(obs, ''), 'rien'), 120),
    obs like '%dossiers=1%'));

  -- DF2 : écrire, à aal1 puis à aal2 (le geste de la restauration : une ligne insérée par le super-administrateur).
  perform pg_temp.comme(s, 'aal1');
  update public.dossiers set nom = nom where id = d_test;
  get diagnostics n = row_count;
  obs := pg_temp.raison(format('insert into public.dossier_assignations (dossier_id, user_id) values (%L, %L)', d_client, m));
  reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF2. un compte exigé n''écrit rien à aal1', 'S : mise à jour, insertion', n || ' ligne ; ' || obs,
    n = 0 and obs like '42501%'));
  perform pg_temp.comme(s, 'aal2');
  update public.dossiers set nom = nom where id = d_test;
  get diagnostics n = row_count;
  obs := pg_temp.raison(format('insert into public.dossier_assignations (dossier_id, user_id) values (%L, %L)', d_client, m));
  reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF2. contrôle positif : à aal2, il écrit (la restauration passe)', 'S', n || ' ligne ; ' || obs,
    n = 1 and obs = 'accepté'));

  -- DF3 : le stockage.
  perform pg_temp.comme(c, 'aal1'); select count(*) into n from storage.objects; reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF3. storage.objects : rien à aal1', 'C', n::text, n = 0));
  perform pg_temp.comme(c, 'aal2'); select count(*) into n from storage.objects; reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF3. contrôle positif : à aal2, ses pièces (et le logo de son cabinet, public)', 'C', n::text, n >= 2));

  -- DF4 : la pré-requête, profil par profil et chemin par chemin.
  perform pg_temp.comme(s, 'aal1', 'dossiers');
  obs := pg_temp.raison('select public.deux_facteurs_avant_requete()'); reset role;
  perform pg_temp.comme(s, 'aal1', 'rpc/enregistrer_facture');
  obs2 := pg_temp.raison('select public.deux_facteurs_avant_requete()'); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF4. la pré-requête refuse en 403 un compte exigé à aal1, table ou fonction', 'S', obs || ' | ' || obs2,
    obs like 'PGRST %"DF403"%' and obs2 like 'PGRST %"DF403"%'));
  for obs2 in select unnest(array['rpc/deux_facteurs_satisfaits', 'rpc/ma_double_authentification']) loop
    perform pg_temp.comme(s, 'aal1', obs2);
    obs := pg_temp.raison('select public.deux_facteurs_avant_requete()'); reset role;
    v := v || jsonb_build_array(jsonb_build_array('DF4. la pré-requête laisse passer les deux lectures de la porte', obs2, obs, obs = 'accepté'));
  end loop;
  perform pg_temp.comme(s, 'aal2'); obs := pg_temp.raison('select public.deux_facteurs_avant_requete()'); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF4. la pré-requête laisse passer aal2, l''anonyme, un compte non exigé', 'S aal2', obs, obs = 'accepté'));
  perform pg_temp.comme(null, null); obs := pg_temp.raison('select public.deux_facteurs_avant_requete()'); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF4. la pré-requête laisse passer aal2, l''anonyme, un compte non exigé', 'anonyme', obs, obs = 'accepté'));
  perform pg_temp.comme(m, 'aal1'); obs := pg_temp.raison('select public.deux_facteurs_avant_requete()'); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF4. la pré-requête laisse passer aal2, l''anonyme, un compte non exigé', 'M aal1', obs, obs = 'accepté'));
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  obs := pg_temp.raison('select public.deux_facteurs_avant_requete()'); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF4. la pré-requête laisse passer aal2, l''anonyme, un compte non exigé', 'service_role', obs, obs = 'accepté'));

  -- DF5 : la fonction security definer, que la RLS ne voit pas.
  perform pg_temp.comme(s, 'aal1'); obs := public.admin_du_dossier(d_test)::text; reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF5. une fonction security definer répond à aal1 : la pré-requête est sa garde (DF4)', 'admin_du_dossier', obs, obs = 'true'));
  delete from public.exigences_deux_facteurs;

  -- ── DF6 : les fonctions du cabinet (S à aal2, non exigé ici) ────────────────────────────────────────────────────────
  perform pg_temp.comme(s, 'aal2');
  obs := pg_temp.raison(format('select public.exiger_deux_facteurs(%L)', m));
  obs2 := pg_temp.raison(format('select public.exiger_deux_facteurs(%L)', m));
  reset role;
  select count(*) into n from public.exigences_deux_facteurs where user_id = m and posee_par = s and levee_le is null;
  v := v || jsonb_build_array(jsonb_build_array('DF6. poser l''exigence sur un compte qui a un facteur vérifié, une fois', 'S sur M', obs || ' ; puis ' || obs2 || ' ; ' || n,
    obs = 'accepté' and obs2 like '%déjà exigée%' and n = 1));
  perform pg_temp.comme(s, 'aal2'); obs := pg_temp.raison(format('select public.exiger_deux_facteurs(%L)', c)); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF6. jamais sur un compte sans facteur vérifié', 'S sur C', obs, obs like '%aucun second facteur vérifié%'));
  insert into auth.mfa_factors (user_id, friendly_name, status) values (c, 'téléphone C', 'verified');
  perform pg_temp.comme(c, 'aal2'); obs := pg_temp.raison(format('select public.exiger_deux_facteurs(%L)', m)); reset role;
  perform pg_temp.comme(m, 'aal2'); obs2 := pg_temp.raison(format('select public.exiger_deux_facteurs(%L)', c)); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF6. ni le client ni le membre de l''équipe', 'C sur M ; M sur C', obs || ' ; ' || obs2,
    obs like '42501%' and obs2 like '42501%'));
  perform pg_temp.comme(null, null); obs := pg_temp.raison(format('select public.exiger_deux_facteurs(%L)', c)); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF6. ni l''anonyme', 'anonyme', obs, obs like '42501%'));
  perform pg_temp.comme(k, 'aal2');
  obs := pg_temp.raison(format('select public.exiger_deux_facteurs(%L)', s));
  obs2 := pg_temp.raison(format('select public.exiger_deux_facteurs(%L)', c));
  reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF6. un chef ne touche pas à un chef ; il pose sur le client de son cabinet', 'K sur S ; K sur C', obs || ' ; ' || obs2,
    obs like '42501%' and obs2 = 'accepté'));
  perform pg_temp.comme(s, 'aal2');
  obs := pg_temp.raison(format('select public.lever_deux_facteurs(%L)', m));
  obs2 := pg_temp.raison(format('select public.lever_deux_facteurs(%L)', m));
  reset role;
  select count(*) into n from public.exigences_deux_facteurs where user_id = m and levee_par = s and levee_le is not null;
  v := v || jsonb_build_array(jsonb_build_array('DF6. lever l''exigence, la trace en place', 'S sur M', obs || ' ; puis ' || obs2 || ' ; ' || n,
    obs = 'accepté' and obs2 like '%n''est pas exigée%' and n = 1));
  -- Le compte rattaché à un autre cabinet : C reçoit un accès au dossier QUATRE, passé à un second cabinet.
  insert into public.cabinets (id, nom) values (cab2, 'Cabinet d''essai deux');
  update public.dossiers set cabinet_id = cab2 where id = d_quatre;
  insert into public.memberships (user_id, dossier_id, role, email) values (c, d_quatre, 'client', 'client@essai.invalid');
  perform pg_temp.comme(k, 'aal2');
  obs := pg_temp.raison(format('select public.lever_deux_facteurs(%L)', c));
  obs2 := pg_temp.raison(format('select public.retirer_second_facteur(%L)', c));
  reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF6. un compte rattaché à un autre cabinet ne s''affaiblit que par le super-administrateur', 'K sur C',
    obs || ' ; ' || obs2, obs like '42501%' and obs2 like '42501%'));
  perform pg_temp.comme(s, 'aal2');
  obs := pg_temp.raison(format('select public.retirer_second_facteur(%L)', c));
  reset role;
  j := (select to_jsonb(r) from (select count(*) filter (where f.user_id = c) as facteurs from auth.mfa_factors f) r);
  select count(*) into n from auth.sessions where user_id = c;
  v := v || jsonb_build_array(jsonb_build_array('DF6. retirer le facteur perdu : facteurs et sessions partis, la trace gardée, l''exigence restée', 'S sur C',
    obs || ' ; facteurs ' || (j ->> 'facteurs') || ', sessions ' || n || ', trace ' ||
      (select count(*) from public.retraits_deux_facteurs r where r.user_id = c and r.facteurs = 1 and r.sessions = 2 and r.retire_par = s)
      || ', exigence ' || (select count(*) from public.exigences_deux_facteurs e where e.user_id = c and e.levee_le is null),
    obs = 'accepté' and j ->> 'facteurs' = '0' and n = 0
      and exists (select 1 from public.retraits_deux_facteurs r where r.user_id = c and r.facteurs = 1 and r.sessions = 2 and r.retire_par = s)
      and exists (select 1 from public.exigences_deux_facteurs e where e.user_id = c and e.levee_le is null)));
  perform pg_temp.comme(s, 'aal2'); obs := pg_temp.raison(format('select public.retirer_second_facteur(%L)', s)); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF6. son propre appareil ne se retire pas d''ici', 'S sur S', obs, obs like '%Sécurité du compte%'));

  -- ── DF7 : la lecture du cabinet ─────────────────────────────────────────────────────────────────────────────────
  perform pg_temp.comme(s, 'aal2');
  select string_agg(r.genre || ':' || r.a_un_facteur || ':' || (r.exigee_depuis is not null) || ':' || r.peut_retirer, ' '
                    order by r.genre, r.a_un_facteur desc)
    into obs from public.deux_facteurs_des_comptes(cab, null) r;
  select string_agg(r.genre || ':' || r.a_un_facteur || ':' || (r.exigee_depuis is not null) || ':' || (r.dernier_retrait is not null), ' ')
    into obs2 from public.deux_facteurs_des_comptes(null, d_client) r;
  reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF7. l''équipe au chef, les accès d''un dossier à qui l''administre', 'S', obs || ' | ' || obs2,
    obs = 'chef:true:false:false chef:false:false:true membre:true:false:true' and obs2 = 'client:false:true:true'));
  perform pg_temp.comme(c, 'aal2'); obs := pg_temp.raison(format('select * from public.deux_facteurs_des_comptes(null, %L)', d_client)); reset role;
  perform pg_temp.comme(m, 'aal2'); obs2 := pg_temp.raison(format('select * from public.deux_facteurs_des_comptes(%L, null)', cab)); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF7. rien au client, rien de l''équipe au membre', 'C ; M', obs || ' ; ' || obs2,
    obs like '42501%' and obs2 like '42501%'));

  -- ── DF9 : l'appareil perdu, le jeton émis avant le retrait ────────────────────────────────────────────────────────
  -- C a perdu son facteur en DF6 (la trace datée de now()) et reste exigé ; M, que plus rien n'exige, reçoit ici une trace
  -- au même instant. Le jeton se date par son iat, en secondes : une minute avant, la seconde du retrait, une minute après.
  insert into public.retraits_deux_facteurs (user_id, facteurs, sessions, retire_par) values (m, 1, 0, s);
  t0 := floor(extract(epoch from now()))::bigint;
  perform pg_temp.comme(c, 'aal2', 'dossiers', t0 - 60);
  obs := pg_temp.lu_partout(); obs2 := pg_temp.raison('select public.deux_facteurs_avant_requete()'); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF9. un jeton aal2 émis avant le retrait ne lit rien, et la pré-requête le refuse', 'C, une minute avant',
    coalesce(nullif(obs, ''), 'rien') || ' | ' || obs2, obs = '' and obs2 like 'PGRST %"DF403"%'));
  perform pg_temp.comme(m, 'aal1', 'dossiers', t0 - 60); obs := pg_temp.lu_partout(); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF9. sans exigence aussi : un jeton émis avant le retrait ne lit rien', 'M, une minute avant',
    left(coalesce(nullif(obs, ''), 'rien'), 120), obs = ''));
  perform pg_temp.comme(c, 'aal2', 'dossiers', t0); b := public.deux_facteurs_satisfaits(); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF9. un jeton de la seconde du retrait est refusé (iat tronqué : le côté fermé)', 'C', b::text, not b));
  perform pg_temp.comme(c, 'aal2', 'dossiers', t0 + 60); obs := pg_temp.lu_partout(); reset role;
  perform pg_temp.comme(m, 'aal1', 'dossiers', t0 + 60); obs2 := pg_temp.lu_partout(); reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF9. contrôle positif : un jeton émis après le retrait (la reconnexion) lit ses accès', 'C aal2 ; M aal1, une minute après',
    left(obs, 60) || ' | ' || left(obs2, 60), obs like '%memberships=%' and obs2 like '%dossiers=%'));
  -- Sans iat numérique : refusé au compte qui a un retrait, sans lever ; comme hier au compte qui n'en a pas.
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('role', 'authenticated', true);
  b := public.deux_facteurs_satisfaits();
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated', 'aal', 'aal2', 'iat', 'hier')::text, true);
  b2 := public.deux_facteurs_satisfaits();
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  b3 := public.deux_facteurs_satisfaits();
  reset role;
  v := v || jsonb_build_array(jsonb_build_array('DF9. un jeton sans iat numérique : refusé au compte qui a un retrait, comme hier sans retrait',
    'C sans iat ; C iat « hier » ; S sans iat', b::text || ' ; ' || b2::text || ' ; ' || b3::text, not b and not b2 and b3));

  raise exception 'ANNULATION_ESSAI';
exception when others then
  reset role;
  -- Les verdicts survivent à l'annulation : ils vivaient dans `v`, que la sous-transaction ne défait pas.
  insert into df_verdict select x ->> 0, x ->> 1, x ->> 2, (x ->> 3)::boolean from jsonb_array_elements(v) x;
  if sqlerrm <> 'ANNULATION_ESSAI' then
    insert into df_verdict values ('DF. l''essai a levé avant sa fin', sqlstate, sqlerrm, false);
  end if;
end
$essai$;

-- ── LES MUTATIONS ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Chacune dans sa sous-transaction : le défaut planté, le contrôle rejoué, le verdict noté AVANT l'annulation.
do $mutations$
declare
  s constant uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  m constant uuid := '3e3b0000-0000-4000-8000-000000000001';
  c constant uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  obs text; n bigint; mut text; att text; mord boolean;
  t0 constant bigint := floor(extract(epoch from now()))::bigint;
begin
  for mut in select unnest(array['M-DF1', 'M-DF2', 'M-DF3', 'M-DF4', 'M-DF5', 'M-DF6', 'M-DF7', 'M-DF8', 'M-DF9', 'M-DF10', 'M-DF11']) loop
    obs := null; mord := false;
    begin
      insert into auth.mfa_factors (user_id, friendly_name, status) values (s, 'S', 'verified'), (m, 'M', 'verified');
      insert into auth.sessions (user_id) values (c);
      insert into public.exigences_deux_facteurs (user_id, posee_par) values (c, s);
      if mut = 'M-DF1' then
        att := 'DF1 en faute (memberships lue à aal1)';
        alter policy deux_facteurs on public.memberships using (true) with check (true);
        perform pg_temp.comme(c, 'aal1'); obs := pg_temp.lu_partout(); reset role;
        mord := obs like '%memberships=1%';
      elsif mut = 'M-DF2' then
        att := 'DF1 en faute (tout lu à aal1)';
        create or replace function public.deux_facteurs_satisfaits() returns boolean language sql stable security definer
          set search_path = '' as $f$ select true $f$;
        perform pg_temp.comme(c, 'aal1'); obs := pg_temp.lu_partout(); reset role;
        mord := obs like '%pieces=2%';
      elsif mut = 'M-DF3' then
        att := 'DF4 en faute (la pré-requête laisse passer)';
        create or replace function public.deux_facteurs_avant_requete() returns void language plpgsql stable security definer
          set search_path = '' as $f$ begin return; end $f$;
        perform pg_temp.comme(c, 'aal1'); obs := pg_temp.raison('select public.deux_facteurs_avant_requete()'); reset role;
        mord := obs = 'accepté';
      elsif mut = 'M-DF4' then
        att := 'DF6 en faute (posée sans facteur)';
        delete from auth.mfa_factors where user_id = m;
        update public.exigences_deux_facteurs set levee_par = s, levee_le = now() where user_id = c;
        create or replace function public.exiger_deux_facteurs(p_compte uuid) returns void language plpgsql security definer
          set search_path = '' as $f$ begin
            if not public.deux_facteurs_autorite(p_compte, false) then raise exception 'Accès refusé.' using errcode = '42501'; end if;
            insert into public.exigences_deux_facteurs (user_id, posee_par) values (p_compte, auth.uid()); end $f$;
        perform pg_temp.comme(s, 'aal2'); obs := pg_temp.raison(format('select public.exiger_deux_facteurs(%L)', m)); reset role;
        mord := obs = 'accepté';
      elsif mut = 'M-DF5' then
        att := 'DF6 en faute (le client pose)';
        create or replace function public.deux_facteurs_autorite(p_compte uuid, p_entiere boolean) returns boolean language sql
          stable security definer set search_path = '' as $f$ select auth.uid() is not null $f$;
        perform pg_temp.comme(c, 'aal2'); obs := pg_temp.raison(format('select public.exiger_deux_facteurs(%L)', m)); reset role;
        mord := obs = 'accepté';
      elsif mut = 'M-DF6' then
        att := 'DF6 en faute (les sessions restent)';
        insert into auth.mfa_factors (user_id, friendly_name, status) values (c, 'C', 'verified');
        create or replace function public.retirer_second_facteur(p_compte uuid) returns jsonb language plpgsql security definer
          set search_path = '' as $f$ declare n integer; begin
            with r as (delete from auth.mfa_factors f where f.user_id = p_compte returning 1) select count(*) into n from r;
            insert into public.retraits_deux_facteurs (user_id, facteurs, sessions, retire_par) values (p_compte, n, 0, auth.uid());
            return jsonb_build_object('facteurs', n, 'sessions', 0); end $f$;
        perform pg_temp.comme(s, 'aal2'); obs := pg_temp.raison(format('select public.retirer_second_facteur(%L)', c)); reset role;
        select count(*) into n from auth.sessions where user_id = c;
        obs := obs || ', sessions restées ' || n;
        mord := n > 0;
      elsif mut = 'M-DF7' then
        att := 'DF1 en faute (storage.objects lu à aal1)';
        alter policy deux_facteurs on storage.objects using (true) with check (true);
        perform pg_temp.comme(c, 'aal1'); select count(*) into n from storage.objects; reset role;
        obs := n::text || ' fichiers';
        mord := n > 0;
      elsif mut = 'M-DF8' then
        att := 'DF9 en faute (un jeton aal2 d''avant le retrait lit encore : la clause du retrait ôtée)';
        create or replace function public.deux_facteurs_satisfaits() returns boolean language sql stable security definer
          set search_path = '' as $f$ select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
            or not exists (select 1 from public.exigences_deux_facteurs e where e.user_id = auth.uid() and e.levee_le is null) $f$;
        insert into public.retraits_deux_facteurs (user_id, facteurs, sessions, retire_par) values (c, 1, 1, s);
        perform pg_temp.comme(c, 'aal2', 'dossiers', t0 - 60); obs := pg_temp.lu_partout(); reset role;
        mord := obs like '%memberships=1%';
      elsif mut = 'M-DF9' then
        att := 'DF9 en faute (sans exigence, un jeton d''avant le retrait lit encore : la clause réservée au compte exigé)';
        create or replace function public.deux_facteurs_satisfaits() returns boolean language sql stable security definer
          set search_path = '' as $f$ select (coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
              and not exists (select 1 from public.retraits_deux_facteurs r where r.user_id = auth.uid()
                               and r.retire_le >= to_timestamp((auth.jwt() ->> 'iat')::double precision)))
            or not exists (select 1 from public.exigences_deux_facteurs e where e.user_id = auth.uid() and e.levee_le is null) $f$;
        insert into public.retraits_deux_facteurs (user_id, facteurs, sessions, retire_par) values (m, 1, 0, s);
        perform pg_temp.comme(m, 'aal1', 'dossiers', t0 - 60); obs := pg_temp.lu_partout(); reset role;
        mord := obs like '%dossiers=1%';
      elsif mut = 'M-DF10' then
        att := 'DF9 en faute (un jeton sans iat passe : la comparaison nulle laisse passer)';
        create or replace function public.deux_facteurs_satisfaits() returns boolean language sql stable security definer
          set search_path = '' as $f$ select (coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
              or not exists (select 1 from public.exigences_deux_facteurs e where e.user_id = auth.uid() and e.levee_le is null))
            and not exists (select 1 from public.retraits_deux_facteurs r where r.user_id = auth.uid()
                             and r.retire_le >= to_timestamp((auth.jwt() ->> 'iat')::double precision)) $f$;
        insert into public.retraits_deux_facteurs (user_id, facteurs, sessions, retire_par) values (c, 1, 1, s);
        perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated', 'aal', 'aal2')::text, true);
        perform set_config('role', 'authenticated', true);
        obs := public.deux_facteurs_satisfaits()::text; reset role;
        mord := obs = 'true';
      elsif mut = 'M-DF11' then
        att := 'DF9 en faute (la reconnexion refusée : tout jeton d''un compte qui a un retrait, pour toujours)';
        create or replace function public.deux_facteurs_satisfaits() returns boolean language sql stable security definer
          set search_path = '' as $f$ select (coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
              or not exists (select 1 from public.exigences_deux_facteurs e where e.user_id = auth.uid() and e.levee_le is null))
            and not exists (select 1 from public.retraits_deux_facteurs r where r.user_id = auth.uid()) $f$;
        insert into public.retraits_deux_facteurs (user_id, facteurs, sessions, retire_par) values (c, 1, 1, s);
        perform pg_temp.comme(c, 'aal2', 'dossiers', t0 + 60); obs := coalesce(nullif(pg_temp.lu_partout(), ''), 'rien lu'); reset role;
        mord := obs = 'rien lu';
      end if;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlerrm <> 'ANNULATION_ESSAI' then reset role; obs := coalesce(obs, '') || ' [' || sqlstate || ' ' || sqlerrm || ']'; mord := false; end if;
    end;
    insert into df_mutation values (mut, att, coalesce(nullif(obs, ''), 'rien vu'), mord);
  end loop;
end
$mutations$;

select 'INVARIANTS' as tableau, controle as ligne,
       count(*) filter (where not ok)::text || ' en faute / ' || count(*) || ' vérifications' as resultat,
       coalesce(string_agg(cible || ' (' || observe || ')', ', ') filter (where not ok), 'aucune') as detail
  from df_verdict group by controle
union all
select 'MUTATIONS', mutation, case when mord then 'le contrôle mord' else '*** NE MORD PAS ***' end,
       'attendu ' || attendu || ', observé ' || left(observe, 160)
  from df_mutation
 order by 1 desc, 2;
