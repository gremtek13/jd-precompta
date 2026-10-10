-- LE PLAN COMPTABLE DES DOSSIERS, ÉPROUVÉ EN BASE (ligne 43, étape PC1) — à rejouer par `execute_sql` après toute
-- migration qui touche `roles_comptables`, `plan_comptable_dossier`, leur garde, leurs policies, `compte_du_role`,
-- `compte_du_dirigeant`, `plan_du_dossier`, `admin_du_dossier`, `dossiers`, ou l'une des cinq fonctions qui recopient
-- le compte du dirigeant.
--
-- Ce qui se prouve ici :
--   - le catalogue est celui des constantes d'aujourd'hui (son empreinte, que src/lib/planComptable.test.ts recalcule
--     depuis `ROLES_COMPTABLES`), et le plan de chaque dossier est VIDE : aucun dossier ne règle rien ;
--   - LA NEUTRALITÉ : pour chaque dossier, `compte_du_role` rend le défaut de chaque rôle, et `compte_du_dirigeant` rend
--     ce que rend le `case` des cinq fonctions qui le recopient — LU DANS LEUR TEXTE en base et évalué tel quel, sur
--     chaque dossier et dans les six configurations du modèle comptable ;
--   - LA LECTURE, par les six profils de la conception (§5.3) — anonyme, compte rattaché à rien, client du dossier,
--     membre du cabinet non affecté, membre affecté, chef — : le catalogue pour tout compte connecté, le plan pour le
--     cabinet à qui le dossier est ouvert, RIEN pour le client, pas même `plan_du_dossier` de son propre dossier ;
--   - LE REFUS DE TOUTE ÉCRITURE DIRECTE par ces six profils (42501 : aucune policy d'écriture, pas même pour le chef
--     super-administrateur), et, pour ce qui passe la RLS, la garde : qui écrit (la restauration par le
--     super-administrateur seulement), où (un dossier sans écriture, à-nouveau ni solde reporté), quoi (six chiffres —
--     hypothèse Q5 —, la racine du rôle, le préfixe des seuls tiers) ; un rôle inconnu bute sur la clé étrangère
--     (point NON VÉRIFIÉ 7 de la conception) ;
--   - le plan fictif décalé (`PLAN_DECALE`, src/lib/planComptable.ts) s'écrit, et les trois fonctions le relisent ;
--   - et que RIEN ne reste en base.
-- Le reste de la §5.3 (les refus de `regler_plan_du_dossier`, le verrou, le dirigeant synchronisé, les contraintes
-- remplacées, la garde des lignes de pièce, le modèle du cabinet) appartient aux étapes PC2 et PC4.
--
-- LE MEMBRE D'ESSAI ET LE CHEF NON SUPER-ADMINISTRATEUR sont le compte client du jeu, rattaché au cabinet le temps d'un
-- bloc qui s'annule — la base n'a qu'un chef, qui est aussi super-administrateur, et aucun membre affecté. Une ligne du
-- plan n'existe que dans un bloc qui s'annule, posée par la seule porte ouverte : le propriétaire de la base, sous la
-- session du super-administrateur (la restauration). Chaque contrôle s'annule dans sa sous-transaction
-- (`ANNULATION_ESSAI`, P0001), son verdict posé dans une VARIABLE avant le `raise` — le mécanisme de rls.sql. Les
-- verdicts voyagent dans un réglage LOCAL à la transaction (`essai.plan_comptable`), que la requête finale lit : le
-- fichier se joue d'un seul appel et ne crée aucune table. Il ne porte AUCUNE instruction de suppression, ni de mise à
-- jour sans `where` — l'outil d'exécution retient l'une et l'autre pour une confirmation qui n'arrive pas : ce qu'une
-- suppression rencontre (la garde, la cascade d'un dossier) se joue sur une réplique.
--
-- LES MUTATIONS (contrôles 40 à 46) rejouent un contrôle avec un profil, une cible ou un texte délibérément faux :
-- chacune doit MORDRE, sans quoi le contrôle qu'elle vise ne regarde rien.
--
-- JOUÉ EN PRODUCTION LE 10/10/2026, juste après la migration `plan_comptable_des_dossiers` : 58 contrôles sur 58, dont
-- les sept mutations, et 0/26/1/0/3/0/0 lignes avant comme après (plan, rôles, chefs et membres, affectations,
-- écritures, à-nouveaux, soldes reportés), les modèles comptables des quatre dossiers inchangés. Le texte reçu par la
-- base est ce fichier sans ses lignes de commentaire ni son saut de ligne final (46 442 caractères, empreinte
-- e318223e…). Sur une réplique dont la signature (signature.sql) est celle de la production : les mêmes 58 ; quatre
-- contrôles qui suppriment (une ligne du plan, par le propriétaire puis par le chef ; le dossier, dont la cascade
-- emporte le plan ; un rôle cité, que la clé étrangère retient) et une course de deux sessions (la restauration attend
-- l'écriture en vol, puis la refuse) — essais locaux de la session, hors du dépôt ; les quarante-trois mutations de la
-- migration mordent toutes, et deux du contrôle 19 (ses deux `where` atteignent leurs lignes).
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  -- L'empreinte du catalogue : une ligne par rôle, « rôle|racines|compte|libellé|préfixe|ordre », dans l'ordre du
  -- catalogue. src/lib/planComptable.test.ts la recalcule depuis `ROLES_COMPTABLES` et la lit ici.
  empreinte_catalogue constant text := '5b9073a0b9331a823cfb6526927183ca';
  -- Le `case` que cinq fonctions recopient : le compte du dirigeant, 108000 en trésorerie.
  forme_du_case constant text :=
    '(case when (?:\w+\.)?mode_comptable = ''engagement'' then (?:\w+\.)?compte_notes_de_frais else ''108000'' end)';

  dossier_client uuid; dossier_libre uuid; cabinet uuid;
  plans_avant int; roles_avant int; admins_avant int; assignations_avant int; ecritures_avant int; anouveaux_avant int;
  soldes_avant int; config_avant text;
  f record; d record; n int; m int; k int; ecarts int; total int; obs text; expr text; valeur text; attendu text;
  code_recu text; message text; texte text; verdicts jsonb := '[]'::jsonb;
begin
  select mb.dossier_id into dossier_client from memberships mb where mb.user_id = client order by mb.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_client;
  select d2.id into dossier_libre from dossiers d2
   where d2.cabinet_id = cabinet
     and not exists (select 1 from ecritures_brouillon e where e.dossier_id = d2.id)
     and not exists (select 1 from a_nouveaux a where a.dossier_id = d2.id)
     and not exists (select 1 from soldes_reportes s where s.dossier_id = d2.id)
     and not exists (select 1 from memberships mb where mb.dossier_id = d2.id and mb.user_id = client)
   order by d2.id limit 1;
  if dossier_client is null or cabinet is null or dossier_libre is null
     or exists (select 1 from ecritures_brouillon e where e.dossier_id = dossier_client)
     or exists (select 1 from a_nouveaux a where a.dossier_id = dossier_client)
     or exists (select 1 from soldes_reportes s where s.dossier_id = dossier_client)
     or not exists (select 1 from super_admins where user_id = chef)
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou compte client déjà rattaché au cabinet';
  end if;
  select count(*) into plans_avant from plan_comptable_dossier;
  select count(*) into roles_avant from roles_comptables;
  select count(*) into admins_avant from cabinet_admins;
  select count(*) into assignations_avant from dossier_assignations;
  select count(*) into ecritures_avant from ecritures_brouillon;
  select count(*) into anouveaux_avant from a_nouveaux;
  select count(*) into soldes_avant from soldes_reportes;
  select string_agg(id || ':' || mode_comptable || ':' || compte_notes_de_frais, ',' order by id) into config_avant from dossiers;

  -- ══ 1 à 5. Le catalogue, le plan vide, les policies, les droits ══
  select count(*), md5(string_agg(role || '|' || array_to_string(racines, ',') || '|' || compte_defaut || '|'
           || coalesce(libelle_defaut, '') || '|' || coalesce(prefixe_auxiliaire_defaut, '') || '|' || ordre, E'\n' order by ordre))
    into n, texte from roles_comptables;
  verdicts := verdicts || jsonb_build_object('controle', '1. le catalogue porte les 26 rôles des constantes d''aujourd''hui (son empreinte)',
    'observe', n || ' rôle(s), empreinte ' || coalesce(texte, '?'), 'ok', coalesce(n = 26 and texte = empreinte_catalogue, false));

  select count(*) filter (where compte_defaut !~ '^[0-9]{6}$'
                            or not exists (select 1 from unnest(racines) x(r) where left(compte_defaut, length(x.r)) = x.r)),
         count(*) filter (where libelle_defaut is null),
         string_agg(role, ',' order by ordre) filter (where libelle_defaut is null),
         string_agg(role || '=' || prefixe_auxiliaire_defaut, ',' order by ordre) filter (where prefixe_auxiliaire_defaut is not null)
    into n, m, texte, obs from roles_comptables;
  verdicts := verdicts || jsonb_build_object('controle', '2. chaque défaut tient sous sa racine en six chiffres ; seuls le capital et le résultat n''ont pas de libellé ; seuls les tiers ont un préfixe',
    'observe', n || ' hors racine, ' || m || ' sans libellé (' || coalesce(texte, '') || '), préfixes ' || coalesce(obs, 'aucun'),
    'ok', coalesce(n = 0 and texte = 'capital_individuel,resultat_benefice,resultat_perte'
                   and obs = 'fournisseurs=F,fournisseurs_immobilisations=FI,clients=C', false));

  verdicts := verdicts || jsonb_build_object('controle', '3. aucun dossier ne règle rien : le plan est vide',
    'observe', plans_avant || ' ligne(s)', 'ok', plans_avant = 0);

  select count(*) filter (where po.polrelid = 'public.roles_comptables'::regclass and po.polcmd = 'r'
                            and po.polroles = array['authenticated'::regrole]::oid[] and pg_get_expr(po.polqual, po.polrelid) = 'true'),
         count(*) filter (where po.polrelid = 'public.plan_comptable_dossier'::regclass and po.polcmd = 'r'
                            and po.polroles = array['authenticated'::regrole]::oid[]
                            and pg_get_expr(po.polqual, po.polrelid) = 'admin_du_dossier(dossier_id)'),
         count(*)
    into n, m, k from pg_policy po where po.polrelid in ('public.roles_comptables'::regclass, 'public.plan_comptable_dossier'::regclass);
  select count(*) into total from pg_class c where c.oid in ('public.roles_comptables'::regclass, 'public.plan_comptable_dossier'::regclass)
   and c.relrowsecurity;
  verdicts := verdicts || jsonb_build_object('controle', '4. une policy de lecture par table, aux connectés : le catalogue pour tous, le plan sur admin_du_dossier ; aucune d''écriture ; RLS active',
    'observe', k || ' policy(s), ' || n || ' + ' || m || ' conforme(s), RLS sur ' || total || ' table(s)',
    'ok', coalesce(n = 1 and m = 1 and k = 2 and total = 2, false));

  select string_agg(p.proname || ':' || case when p.prosecdef then 'definer' else 'invoker' end || ':' || p.provolatile::text
           || ':anon=' || has_function_privilege('anon', p.oid, 'execute')
           || ':connecte=' || has_function_privilege('authenticated', p.oid, 'execute'), ', ' order by p.proname)
    into obs from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('compte_du_role', 'compte_du_dirigeant', 'plan_du_dossier', 'garder_plan_comptable_dossier');
  verdicts := verdicts || jsonb_build_object('controle', '5. les trois fonctions aux droits de l''appelant, stables, exécutables par les connectés et non par l''anonyme ; la garde DEFINER, par personne',
    'observe', coalesce(obs, 'aucune'),
    'ok', coalesce(obs = 'compte_du_dirigeant:invoker:s:anon=false:connecte=true, compte_du_role:invoker:s:anon=false:connecte=true, '
                      || 'garder_plan_comptable_dossier:definer:v:anon=false:connecte=false, plan_du_dossier:invoker:s:anon=false:connecte=true', false));

  -- ══ 6 à 11. La neutralité ══
  select count(*), count(*) filter (where public.compte_du_role(d2.id, r.role) is distinct from r.compte_defaut)
    into total, ecarts from dossiers d2 cross join roles_comptables r;
  verdicts := verdicts || jsonb_build_object('controle', '6. pour chaque dossier et chaque rôle, compte_du_role rend le défaut d''aujourd''hui',
    'observe', ecarts || ' écart(s) sur ' || total, 'ok', coalesce(ecarts = 0 and total >= 2 * 26, false));

  code_recu := null; message := null;
  begin
    perform public.compte_du_role(dossier_libre, 'role_qui_n_existe_pas');
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '7. un rôle inconnu fait lever compte_du_role (22023), jamais un compte nul',
    'observe', coalesce(code_recu, 'ACCEPTÉ') || ' ' || coalesce(message, ''),
    'ok', coalesce(code_recu = '22023' and message = 'Rôle comptable inconnu : « role_qui_n_existe_pas ».', false));

  select string_agg(p.proname, ',' order by p.proname),
         count(*) filter (where (regexp_match(p.prosrc, forme_du_case))[1] is null),
         count(*) filter (where (select count(*) from regexp_matches(p.prosrc, 'else ''108000'' end', 'g')) <> 1)
    into obs, n, m
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'else ''108000'' end';
  verdicts := verdicts || jsonb_build_object('controle', '8. cinq fonctions recopient le case du dirigeant, une fois chacune et sous la même forme',
    'observe', coalesce(obs, 'aucune') || ' ; ' || coalesce(n, 0) || ' hors forme, ' || coalesce(m, 0) || ' à plusieurs case',
    'ok', coalesce(obs = 'classer_virement_personnel,ecrire_forfait_kilometrique,ecrire_mouvement_compte_bilan,'
                      || 'enregistrer_paiement_personnel_cotisation,ventiler_mouvement_bancaire' and n = 0 and m = 0, false));

  -- Le `case` de chaque fonction, lu dans son texte et évalué tel quel sur chaque dossier, puis sur le dossier libre dans
  -- les six configurations (trésorerie ou engagement, et chacun des trois comptes du dirigeant).
  ecarts := 0; total := 0; code_recu := null;
  begin
    for k in 0..6 loop
      if k > 0 then
        update dossiers set mode_comptable = case when k <= 3 then 'tresorerie' else 'engagement' end,
                            compte_notes_de_frais = (array['455000', '108000', '467000'])[1 + (k - 1) % 3]
         where id = dossier_libre;
      end if;
      for f in select p.proname, (regexp_match(p.prosrc, forme_du_case))[1] as cas from pg_proc p
                where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'else ''108000'' end' loop
        for d in select d2.id from dossiers d2 where k = 0 or d2.id = dossier_libre loop
          execute format('select %s from public.dossiers d where d.id = $1', f.cas) into attendu using d.id;
          total := total + 1;
          if public.compte_du_dirigeant(d.id) is distinct from attendu then ecarts := ecarts + 1; end if;
        end loop;
      end loop;
    end loop;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '9. compte_du_dirigeant rend ce que rend le case de chacune des cinq fonctions, sur chaque dossier et dans les six configurations',
    'observe', ecarts || ' écart(s) sur ' || total || ', ' || coalesce(code_recu, '?') || case when code_recu = 'P0001' then '' else ' ' || coalesce(message, '') end,
    'ok', coalesce(ecarts = 0 and total >= 5 * 2 + 5 * 6 and code_recu = 'P0001', false));

  verdicts := verdicts || jsonb_build_object('controle', '10. compte_du_dirigeant d''un dossier inconnu est nul, comme le select … into des cinq fonctions',
    'observe', coalesce(public.compte_du_dirigeant(gen_random_uuid()), 'nul'),
    'ok', public.compte_du_dirigeant(gen_random_uuid()) is null);

  n := null; obs := null; code_recu := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*),
           string_agg(x.role || '=' || x.compte || '=' || coalesce(x.libelle, '') || '=' || coalesce(x.prefixe_auxiliaire, '') || '=' || x.origine,
                      E'\n' order by x.rang)
      into n, obs from public.plan_du_dossier(dossier_libre) with ordinality x(role, compte, libelle, prefixe_auxiliaire, origine, rang);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  select string_agg(r.role || '=' || r.compte_defaut || '=' || coalesce(r.libelle_defaut, '') || '=' || coalesce(r.prefixe_auxiliaire_defaut, '')
           || '=application', E'\n' order by r.ordre)
    into texte from roles_comptables r;
  verdicts := verdicts || jsonb_build_object('controle', '11. plan_du_dossier rend le catalogue, dans son ordre, aux défauts, d''origine « application »',
    'observe', coalesce(n::text, '?') || ' ligne(s), ' || case when obs = texte then 'égales au catalogue' else 'DIFFÉRENTES' end || ', ' || coalesce(code_recu, '?'),
    'ok', coalesce(n = 26 and obs = texte and code_recu = 'P0001', false));

  -- ══ 12 à 17. La lecture, profil par profil, une ligne réglée dans le dossier libre et une dans celui du client ══
  -- 12. L'anonyme.
  n := null; m := null; obs := null; code_recu := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_libre, 'banque', '512100'), (dossier_client, 'banque', '512200');
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    select count(*) into n from roles_comptables;
    select count(*) into m from plan_comptable_dossier;
    begin
      perform public.plan_du_dossier(dossier_libre);
      obs := 'plan_du_dossier ACCEPTÉ';
    exception when others then obs := 'plan_du_dossier ' || sqlstate || ' ' || sqlerrm;
    end;
    begin
      perform public.compte_du_role(dossier_libre, 'banque');
      obs := obs || ', compte_du_role ACCEPTÉ';
    exception when others then obs := obs || ', compte_du_role ' || sqlstate || ' ' || sqlerrm;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '12. l''anonyme ne lit ni le catalogue ni le plan, et n''appelle aucune des fonctions',
    'observe', coalesce(n::text, '?') || ' rôle(s), ' || coalesce(m::text, '?') || ' ligne(s), ' || coalesce(obs, '?') || ', ' || coalesce(code_recu, '?'),
    'ok', coalesce(n = 0 and m = 0 and obs = 'plan_du_dossier 42501 permission denied for function plan_du_dossier, compte_du_role 42501 permission denied for function compte_du_role'
                   and code_recu = 'P0001', false));

  -- 13. Le compte rattaché à rien.
  n := null; m := null; obs := null; code_recu := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_libre, 'banque', '512100'), (dossier_client, 'banque', '512200');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    select count(*) into n from roles_comptables;
    select count(*) into m from plan_comptable_dossier;
    begin
      perform public.plan_du_dossier(dossier_libre);
      obs := 'ACCEPTÉ';
    exception when others then obs := sqlstate || ' ' || sqlerrm;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '13. un compte rattaché à rien lit le catalogue, aucune ligne du plan, et plan_du_dossier le refuse',
    'observe', coalesce(n::text, '?') || ' rôle(s), ' || coalesce(m::text, '?') || ' ligne(s), ' || coalesce(obs, '?') || ', ' || coalesce(code_recu, '?'),
    'ok', coalesce(n = 26 and m = 0 and obs = '42501 Accès refusé à ce dossier.' and code_recu = 'P0001', false));

  -- 14. Le client, sur SON dossier, où un compte est réglé.
  n := null; m := null; obs := null; valeur := null; code_recu := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_libre, 'banque', '512100'), (dossier_client, 'banque', '512200');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from roles_comptables;
    select count(*) into m from plan_comptable_dossier;
    valeur := public.compte_du_role(dossier_client, 'banque');
    begin
      perform public.plan_du_dossier(dossier_client);
      obs := 'ACCEPTÉ';
    exception when others then obs := sqlstate || ' ' || sqlerrm;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '14. le client lit le catalogue, aucune ligne du plan — pas même celle de son dossier —, plan_du_dossier le refuse, et compte_du_role ne lui rend que le défaut',
    'observe', coalesce(n::text, '?') || ' rôle(s), ' || coalesce(m::text, '?') || ' ligne(s), ' || coalesce(obs, '?') || ', banque '
      || coalesce(valeur, '?') || ', ' || coalesce(code_recu, '?'),
    'ok', coalesce(n = 26 and m = 0 and obs = '42501 Accès refusé à ce dossier.' and valeur = '512000' and code_recu = 'P0001', false));

  -- 15. Le membre du cabinet affecté à aucun dossier.
  n := null; obs := null; code_recu := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_libre, 'banque', '512100'), (dossier_client, 'banque', '512200');
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from plan_comptable_dossier;
    begin
      perform public.plan_du_dossier(dossier_libre);
      obs := 'ACCEPTÉ';
    exception when others then obs := sqlstate || ' ' || sqlerrm;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '15. un membre du cabinet à qui le dossier n''est pas ouvert ne lit aucune ligne du plan, et plan_du_dossier le refuse',
    'observe', coalesce(n::text, '?') || ' ligne(s), ' || coalesce(obs, '?') || ', ' || coalesce(code_recu, '?'),
    'ok', coalesce(n = 0 and obs = '42501 Accès refusé à ce dossier.' and code_recu = 'P0001', false));

  -- 16. Le membre affecté au dossier libre.
  n := null; obs := null; valeur := null; code_recu := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_libre, 'banque', '512100'), (dossier_client, 'banque', '512200');
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
    insert into dossier_assignations (dossier_id, user_id) values (dossier_libre, client);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select string_agg(dossier_id::text || '/' || role || '/' || compte, ',') into obs from plan_comptable_dossier;
    select count(*), max(x.compte) filter (where x.role = 'banque' and x.origine = 'dossier') into n, valeur
      from public.plan_du_dossier(dossier_libre) x;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '16. le membre affecté au dossier en lit la ligne réglée, et celle-là seule ; plan_du_dossier la lui rend',
    'observe', coalesce(obs, 'aucune ligne') || ', ' || coalesce(n::text, '?') || ' rôle(s), banque ' || coalesce(valeur, '?') || ', ' || coalesce(code_recu, '?'),
    'ok', coalesce(obs = dossier_libre::text || '/banque/512100' and n = 26 and valeur = '512100' and code_recu = 'P0001', false));

  -- 17. Le chef.
  m := null; n := null; valeur := null; code_recu := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_libre, 'banque', '512100'), (dossier_client, 'banque', '512200');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into m from plan_comptable_dossier;
    select count(*), max(x.compte) filter (where x.role = 'banque') into n, valeur from public.plan_du_dossier(dossier_client) x;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '17. le chef lit les lignes réglées de ses dossiers, et plan_du_dossier les lui rend',
    'observe', coalesce(m::text, '?') || ' ligne(s), ' || coalesce(n::text, '?') || ' rôle(s), banque du dossier du client ' || coalesce(valeur, '?') || ', ' || coalesce(code_recu, '?'),
    'ok', coalesce(m = 2 and n = 26 and valeur = '512200' and code_recu = 'P0001', false));

  -- ══ 18 et 19. Aucune écriture directe par les six profils ══
  -- Le plan : sur un dossier sans écriture, une ligne que la garde accepterait (la restauration du super-administrateur
  -- passe par elle) — le refus du chef doit être celui de la RLS, faute de policy d'écriture.
  obs := '';
  for f in select * from (values ('anonyme', null::uuid, false, false, false), ('rattaché à rien', gen_random_uuid(), false, false, false),
                                 ('client', client, false, false, false), ('membre non affecté', client, true, false, false),
                                 ('membre affecté', client, true, true, false), ('chef', chef, false, false, true))
                    as p(profil, sub, membre, affecte, est_chef) loop
    begin
      if f.membre then insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable'); end if;
      if f.affecte then insert into dossier_assignations (dossier_id, user_id) values (dossier_libre, client); end if;
      if f.sub is null then
        set local role anon;
        perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      else
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', f.sub, 'role', 'authenticated')::text, true);
      end if;
      code_recu := null; message := null;
      begin
        insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_libre, 'banque', '512100');
        code_recu := 'ACCEPTÉ';
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      obs := obs || f.profil || ' : plan ' || code_recu || case when f.est_chef then ' (' || coalesce(message, '') || ')' else '' end;
      code_recu := null;
      begin
        insert into roles_comptables (role, racines, compte_defaut, libelle_defaut, ordre) values ('role_essai', '{512}', '512900', 'Essai', 999);
        code_recu := 'ACCEPTÉ';
      exception when others then code_recu := sqlstate;
      end;
      obs := obs || ', catalogue ' || code_recu || ' ; ';
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null;
    end;
    reset role;
  end loop;
  verdicts := verdicts || jsonb_build_object('controle', '18. aucun des six profils n''insère une ligne du plan ni un rôle (42501) — pour le chef super-administrateur, le refus de la RLS',
    'observe', obs,
    'ok', obs = 'anonyme : plan 42501, catalogue 42501 ; rattaché à rien : plan 42501, catalogue 42501 ; client : plan 42501, catalogue 42501 ; '
             || 'membre non affecté : plan 42501, catalogue 42501 ; membre affecté : plan 42501, catalogue 42501 ; '
             || 'chef : plan 42501 (new row violates row-level security policy for table "plan_comptable_dossier"), catalogue 42501 ; ');

  obs := '';
  for f in select * from (values ('rattaché à rien', gen_random_uuid(), false, false), ('client', client, false, false),
                                 ('membre non affecté', client, true, false), ('membre affecté', client, true, true), ('chef', chef, false, false))
                    as p(profil, sub, membre, affecte) loop
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_libre, 'banque', '512100'), (dossier_client, 'banque', '512200');
      if f.membre then insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable'); end if;
      if f.affecte then insert into dossier_assignations (dossier_id, user_id) values (dossier_libre, client); end if;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', f.sub, 'role', 'authenticated')::text, true);
      -- Les deux mises à jour visent ce que l'essai a posé (le plan est vide hors de ce bloc, contrôle 3) et un rôle :
      -- l'outil d'exécution retient une mise à jour SANS `where` pour une confirmation qui n'arrive pas (10/10/2026).
      update plan_comptable_dossier set compte = '512300' where dossier_id in (dossier_libre, dossier_client);
      get diagnostics n = row_count;
      update roles_comptables set libelle_defaut = 'Réécrit' where role = 'banque';
      get diagnostics m = row_count;
      obs := obs || f.profil || ' ' || n || '/' || m || ' ; ';
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null;
              when others then obs := obs || f.profil || ' ' || sqlstate || ' ; ';
    end;
    reset role;
  end loop;
  verdicts := verdicts || jsonb_build_object('controle', '19. aucun profil connecté ne modifie les lignes du plan ni un rôle : aucune ligne touchée',
    'observe', obs,
    'ok', obs = 'rattaché à rien 0/0 ; client 0/0 ; membre non affecté 0/0 ; membre affecté 0/0 ; chef 0/0 ; ');

  -- ══ 20 à 31. La garde, pour ce qui passe la RLS (le propriétaire de la base) ══
  for f in select * from (values
      ('20. sans session', null::uuid, '42501', null::text),
      ('21. sous la session du client', client, '42501', null),
      ('22. sous la session d''un chef qui n''est pas super-administrateur', client, '42501', 'chef'),
      ('23. sous la session du super-administrateur, dans un dossier sans écriture : la restauration', chef, 'ACCEPTÉ', null),
      ('24. dans un dossier qui porte une écriture', chef, '23514', 'ecriture'),
      ('24b. dans un dossier qui porte un à-nouveau', chef, '23514', 'a_nouveau'),
      ('24c. dans un dossier qui porte un solde reporté', chef, '23514', 'solde_reporte')) as p(controle, sub, attendu, cas) loop
    code_recu := null; message := null;
    begin
      if f.cas = 'chef' then insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef'); end if;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      if f.cas = 'ecriture' then
        insert into ecritures_brouillon (dossier_id, compte, libelle, sens, montant, date) values (dossier_libre, '606100', 'essai plan', 'debit', 1, current_date);
      elsif f.cas = 'a_nouveau' then
        insert into a_nouveaux (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte)
        values (dossier_libre, make_date(extract(year from current_date)::int, 1, 1), '512000', 'Banque', 'debit', 1, 'essai plan', repeat('0', 64));
      elsif f.cas = 'solde_reporte' then
        insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte)
        values (dossier_libre, make_date(extract(year from current_date)::int, 1, 1), '512000', 'Banque', 'debit', 1, 'essai plan', repeat('0', 64));
      end if;
      perform set_config('request.jwt.claims', case when f.sub is null then '' else json_build_object('sub', f.sub, 'role', 'authenticated')::text end, true);
      begin
        insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_libre, 'banque', '512100');
        code_recu := 'ACCEPTÉ';
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null;
              when others then code_recu := 'PRÉPARATION ' || sqlstate; message := sqlerrm;
    end;
    verdicts := verdicts || jsonb_build_object('controle', f.controle || ' : ' || f.attendu,
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', coalesce(code_recu = f.attendu and (f.attendu <> '42501' or message like 'Le plan comptable d''un dossier ne s''écrit pas directement%')
                     and (f.attendu <> '23514' or message like 'Ce dossier porte déjà des écritures%'), false));
  end loop;

  -- Ce qu'une ligne EST : la forme (hypothèse Q5), la racine, le préfixe, le rôle connu, l'unicité, le libellé, l'origine.
  for f in select * from (values
      ('25. un compte de cinq chiffres', 'banque', '51210', null::text, null::text, '23514', 'Le compte du rôle « banque » s''écrit en six chiffres : « 51210 » n''en est pas un.'),
      ('25b. un compte de sept chiffres (hypothèse Q5)', 'banque', '5121000', null, null, '23514', 'Le compte du rôle « banque » s''écrit en six chiffres : « 5121000 » n''en est pas un.'),
      ('25c. un compte qui n''est pas fait de chiffres', 'banque', '512ABC', null, null, '23514', 'Le compte du rôle « banque » s''écrit en six chiffres : « 512ABC » n''en est pas un.'),
      ('26. la banque hors de sa racine', 'banque', '411000', null, null, '23514', 'Le compte du rôle « banque » commence par sa racine du plan comptable (512) : « 411000 » n''en est pas un.'),
      ('26b. le dirigeant non associé au 468 (Q7 non tranchée)', 'autres_debiteurs_crediteurs', '468000', null, null, '23514',
        'Le compte du rôle « autres_debiteurs_crediteurs » commence par sa racine du plan comptable (467) : « 468000 » n''en est pas un.'),
      ('27. un préfixe d''auxiliaires sur la banque', 'banque', '512100', 'BQ', null, '23514',
        'Seuls les comptes de tiers (fournisseurs, fournisseurs d''immobilisations, clients) portent un préfixe de comptes auxiliaires : pas le rôle « banque ».'),
      ('27b. un préfixe en minuscules', 'fournisseurs', '401100', 'fo', null, '23514',
        'Le préfixe des comptes auxiliaires du rôle « fournisseurs » s''écrit d''une à cinq lettres majuscules ou chiffres : « fo » n''en est pas un.'),
      ('27c. un préfixe de six caractères', 'fournisseurs', '401100', 'FOURNI', null, '23514',
        'Le préfixe des comptes auxiliaires du rôle « fournisseurs » s''écrit d''une à cinq lettres majuscules ou chiffres : « FOURNI » n''en est pas un.'),
      ('27d. le préfixe d''un tiers', 'fournisseurs', '401100', 'FO', null, 'ACCEPTÉ', null),
      ('28. un rôle inconnu de la base : la clé étrangère (point NON VÉRIFIÉ 7)', 'role_d_une_base_plus_recente', '512100', null, null, '23503',
        'insert or update on table "plan_comptable_dossier" violates foreign key constraint "plan_comptable_dossier_role_fkey"'),
      ('29. deux lignes pour le même rôle', 'banque', '512100', null, 'deux', '23505',
        'duplicate key value violates unique constraint "plan_comptable_dossier_pkey"'),
      ('30. un libellé blanc', 'banque', '512100', null, 'libelle', '23514',
        'new row for relation "plan_comptable_dossier" violates check constraint "plan_comptable_dossier_libelle"'),
      ('30b. une origine inconnue', 'banque', '512100', null, 'origine', '23514',
        'new row for relation "plan_comptable_dossier" violates check constraint "plan_comptable_dossier_origine"'),
      ('30c. un compte qui n''est pas fait de chiffres, sous un rôle que la garde ne connaît pas : la contrainte de la colonne',
        'role_d_une_base_plus_recente', '9ABC', null, null, '23514',
        'new row for relation "plan_comptable_dossier" violates check constraint "plan_comptable_dossier_compte"'))
    as p(controle, role, compte, prefixe, cas, attendu, raison) loop
    code_recu := null; message := null;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      if f.cas = 'deux' then
        insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_libre, f.role, f.compte);
      end if;
      begin
        insert into plan_comptable_dossier (dossier_id, role, compte, prefixe_auxiliaire, libelle, origine)
        values (dossier_libre, f.role, f.compte, f.prefixe, case when f.cas = 'libelle' then E' \t' end,
                case when f.cas = 'origine' then 'saisie' else 'dossier' end);
        code_recu := 'ACCEPTÉ';
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null;
              when others then code_recu := 'PRÉPARATION ' || sqlstate; message := sqlerrm;
    end;
    verdicts := verdicts || jsonb_build_object('controle', f.controle || ' : ' || f.attendu,
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', coalesce(code_recu = f.attendu and message is not distinct from f.raison, false));
  end loop;

  -- 31. Une ligne ne se modifie pas, même par le super-administrateur qui passe la RLS.
  code_recu := null; message := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_libre, 'banque', '512100');
    begin
      update plan_comptable_dossier set compte = '512200' where dossier_id = dossier_libre and role = 'banque';
      code_recu := 'ACCEPTÉ';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '31. une ligne du plan ne se modifie pas directement, même sous la session du super-administrateur (42501)',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(code_recu = '42501' and message = 'Une ligne du plan comptable d''un dossier ne se modifie pas directement.', false));

  -- ══ 32. Le plan décalé (`PLAN_DECALE`, src/lib/planComptable.ts) s'écrit, et les trois fonctions le relisent ══
  n := null; m := null; k := null; obs := null; valeur := null; attendu := null; texte := null; code_recu := null; message := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into plan_comptable_dossier (dossier_id, role, compte, prefixe_auxiliaire)
    select dossier_libre, v.role, v.compte, v.prefixe from (values
      ('banque', '512100', null), ('tva_deductible', '445661', null), ('tva_immobilisations', '445621', null),
      ('tva_collectee', '445711', null), ('tva_a_decaisser', '445511', null), ('credit_tva_a_reporter', '445671', null),
      ('remboursement_tva_demande', '445831', null), ('arrondi_charge', '658100', null), ('arrondi_produit', '758100', null),
      ('fournisseurs', '401100', 'FO'), ('fournisseurs_immobilisations', '404100', 'IM'), ('clients', '411100', 'CL'),
      ('exploitant', '108100', null), ('associe', '455100', null), ('autres_debiteurs_crediteurs', '467100', null),
      ('emprunt', '164100', null), ('interets_emprunt', '661110', null), ('assurance_emprunt', '616810', null),
      ('cotisations_exploitant', '646100', null), ('dotations_amortissements', '681110', null),
      ('indemnites_kilometriques', '625111', null), ('virements_internes', '580100', null),
      ('depots_cautionnements_verses', '275100', null), ('capital_individuel', '101100', null),
      ('resultat_benefice', '120100', null), ('resultat_perte', '129100', null)) as v(role, compte, prefixe);
    get diagnostics n = row_count;
    select count(*) filter (where public.compte_du_role(dossier_libre, p.role) is distinct from p.compte),
           count(*) filter (where public.compte_du_role(dossier_client, p.role) is distinct from r.compte_defaut)
      into m, k from plan_comptable_dossier p join roles_comptables r on r.role = p.role where p.dossier_id = dossier_libre;
    valeur := public.compte_du_dirigeant(dossier_libre);
    update dossiers set mode_comptable = 'engagement', compte_notes_de_frais = '455000' where id = dossier_libre;
    attendu := public.compte_du_dirigeant(dossier_libre);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select string_agg(x.role || '=' || x.compte || '=' || coalesce(x.prefixe_auxiliaire, '') || '=' || x.origine, ',' order by x.rang)
      into texte from public.plan_du_dossier(dossier_libre) with ordinality x(role, compte, libelle, prefixe_auxiliaire, origine, rang);
    select string_agg(p.role || '=' || p.compte || '=' || coalesce(p.prefixe_auxiliaire, r.prefixe_auxiliaire_defaut, '') || '=dossier', ',' order by r.ordre)
      into obs from plan_comptable_dossier p join roles_comptables r on r.role = p.role where p.dossier_id = dossier_libre;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null;
            when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '32. le plan décalé s''écrit tout entier ; compte_du_role le rend pour son dossier et les défauts ailleurs, compte_du_dirigeant le 108100 en trésorerie et le compte choisi en engagement, plan_du_dossier ses comptes et ses préfixes',
    'observe', coalesce(n::text, '?') || ' ligne(s), ' || coalesce(m::text, '?') || ' écart(s) ici, ' || coalesce(k::text, '?') || ' ailleurs, dirigeant '
      || coalesce(valeur, '?') || ' puis ' || coalesce(attendu, '?') || ', plan_du_dossier ' || case when texte = obs then 'égal' else 'DIFFÉRENT' end
      || coalesce(' ' || code_recu || ' ' || message, ''),
    'ok', coalesce(n = 26 and m = 0 and k = 0 and valeur = '108100' and attendu = '455000' and texte = obs
                   and texte like '%fournisseurs=401100=FO=dossier%' and code_recu is null, false));

  -- ══ 33. Le catalogue refuse un rôle mal formé (ce qu'une migration future y insérerait) ══
  for f in select * from (values
      ('33. un défaut hors de sa racine', 'role_essai', '{512}', '411000', 'Essai', null::text, 999, 'roles_comptables_defaut_sous_sa_racine'),
      ('33b. un défaut de cinq chiffres', 'role_essai', '{512}', '51200', 'Essai', null, 999, 'roles_comptables_compte_defaut'),
      ('33c. une racine d''un chiffre à côté d''une bonne', 'role_essai', '{5,512}', '512900', 'Essai', null, 999, 'roles_comptables_racines'),
      ('33d. un ordre déjà pris', 'role_essai', '{512}', '512900', 'Essai', null, 10, 'roles_comptables_ordre_unique'),
      ('33e. une clé qui n''est pas en minuscules', 'Role essai', '{512}', '512900', 'Essai', null, 999, 'roles_comptables_role'),
      ('33f. un préfixe en minuscules', 'role_essai', '{512}', '512900', 'Essai', 'f', 999, 'roles_comptables_prefixe_auxiliaire_defaut'),
      ('33g. un libellé blanc', 'role_essai', '{512}', '512900', E' \t', null, 999, 'roles_comptables_libelle_defaut'))
    as p(controle, role, racines, compte, libelle, prefixe, ordre, contrainte) loop
    code_recu := null; message := null;
    begin
      begin
        insert into roles_comptables (role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre)
        values (f.role, f.racines::text[], f.compte, f.libelle, f.prefixe, f.ordre);
        code_recu := 'ACCEPTÉ';
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null;
    end;
    verdicts := verdicts || jsonb_build_object('controle', f.controle || ' : refusé par ' || f.contrainte,
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', coalesce(code_recu in ('23514', '23505') and message like '%"' || f.contrainte || '"%', false));
  end loop;
  code_recu := null; message := null;
  begin
    begin
      insert into roles_comptables (role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre)
      values ('role_essai', '{512,53}', '512900', 'Essai', 'ES', 999);
      code_recu := 'ACCEPTÉ';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '33h. un rôle bien formé entre au catalogue (le contrôle positif de 33)',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''), 'ok', coalesce(code_recu = 'ACCEPTÉ', false));

  -- ══ 40 à 46. Les mutations : chacune doit MORDRE ══
  -- 40. Le contrôle 12 sans le changement de rôle (le propriétaire passe la RLS) : il lit tout le catalogue.
  n := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    select count(*) into n from roles_comptables;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '40. MUTATION — le contrôle 12 sans le changement de rôle : il doit lire les 26 rôles',
    'observe', coalesce(n::text, '?') || ' rôle(s)', 'ok', coalesce(n = 26, false));

  -- 41. Le contrôle 14 joué sous le chef : il voit la ligne du dossier du client.
  m := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_client, 'banque', '512200');
    set local role authenticated;
    select count(*) into m from plan_comptable_dossier where dossier_id = dossier_client;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '41. MUTATION — le contrôle 14 joué sous le chef : il doit voir la ligne',
    'observe', coalesce(m::text, '?') || ' ligne(s)', 'ok', coalesce(m = 1, false));

  -- 42. Le contrôle 18 du chef rejoué par le propriétaire, sous la même session : la RLS passée, la garde accepte — le
  -- refus de 18 était bien celui de la RLS.
  code_recu := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    begin
      insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_libre, 'banque', '512100');
      code_recu := 'ACCEPTÉ';
    exception when others then code_recu := sqlstate;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '42. MUTATION — le contrôle 18 du chef sans la RLS : la ligne doit passer',
    'observe', coalesce(code_recu, '?'), 'ok', coalesce(code_recu = 'ACCEPTÉ', false));

  -- 43. Le contrôle 24 sur un dossier sans écriture : la ligne passe.
  code_recu := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into ecritures_brouillon (dossier_id, compte, libelle, sens, montant, date) values (dossier_client, '606100', 'essai plan', 'debit', 1, current_date);
    begin
      insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_libre, 'banque', '512100');
      code_recu := 'ACCEPTÉ';
    exception when others then code_recu := sqlstate;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null;
  end;
  verdicts := verdicts || jsonb_build_object('controle', '43. MUTATION — le contrôle 24, l''écriture posée dans un AUTRE dossier : la ligne doit passer',
    'observe', coalesce(code_recu, '?'), 'ok', coalesce(code_recu = 'ACCEPTÉ', false));

  -- 44. Le contrôle 9 avec un case faux (le 108100 au lieu du 108000) : il doit trouver des écarts.
  ecarts := 0;
  for f in select (regexp_match(p.prosrc, forme_du_case))[1] as cas from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'else ''108000'' end' loop
    for d in select d2.id from dossiers d2 loop
      execute format('select %s from public.dossiers d where d.id = $1', replace(f.cas, '''108000''', '''108100''')) into attendu using d.id;
      if public.compte_du_dirigeant(d.id) is distinct from attendu then ecarts := ecarts + 1; end if;
    end loop;
  end loop;
  verdicts := verdicts || jsonb_build_object('controle', '44. MUTATION — le contrôle 9 avec un case faux : il doit trouver des écarts',
    'observe', ecarts || ' écart(s)', 'ok', ecarts > 0);

  -- 45. Le contrôle 15 avec l'affectation au dossier libre : le membre voit la ligne.
  n := null;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into plan_comptable_dossier (dossier_id, role, compte) values (dossier_libre, 'banque', '512100');
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
    insert into dossier_assignations (dossier_id, user_id) values (dossier_libre, client);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from plan_comptable_dossier;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '45. MUTATION — le contrôle 15 affecté au dossier : il doit voir la ligne',
    'observe', coalesce(n::text, '?') || ' ligne(s)', 'ok', coalesce(n = 1, false));

  -- 46. Le contrôle 13 joué sous le chef : plan_du_dossier lui rend les 26 rôles — le refus de 13 n'est pas celui de tous.
  n := null; obs := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into n from public.plan_du_dossier(dossier_libre);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; obs := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '46. MUTATION — le contrôle 13 joué sous le chef : plan_du_dossier doit rendre les 26 rôles',
    'observe', coalesce(n::text, '?') || ' rôle(s), ' || coalesce(obs, ''), 'ok', coalesce(n = 26, false));

  -- ══ 99. Rien n'est resté ══
  select string_agg(id || ':' || mode_comptable || ':' || compte_notes_de_frais, ',' order by id) into texte from dossiers;
  verdicts := verdicts || jsonb_build_object('controle', '99. rien n''est resté en base',
    'observe', 'plan ' || plans_avant || ' -> ' || (select count(*) from plan_comptable_dossier)
      || ', rôles ' || roles_avant || ' -> ' || (select count(*) from roles_comptables)
      || ', chefs et membres ' || admins_avant || ' -> ' || (select count(*) from cabinet_admins)
      || ', affectations ' || assignations_avant || ' -> ' || (select count(*) from dossier_assignations)
      || ', écritures ' || ecritures_avant || ' -> ' || (select count(*) from ecritures_brouillon)
      || ', à-nouveaux ' || anouveaux_avant || ' -> ' || (select count(*) from a_nouveaux)
      || ', soldes reportés ' || soldes_avant || ' -> ' || (select count(*) from soldes_reportes)
      || ', modèles comptables ' || case when texte = config_avant then 'inchangés' else 'CHANGÉS' end,
    'ok', coalesce(plans_avant = (select count(*) from plan_comptable_dossier)
      and roles_avant = (select count(*) from roles_comptables)
      and admins_avant = (select count(*) from cabinet_admins)
      and assignations_avant = (select count(*) from dossier_assignations)
      and ecritures_avant = (select count(*) from ecritures_brouillon)
      and anouveaux_avant = (select count(*) from a_nouveaux)
      and soldes_avant = (select count(*) from soldes_reportes)
      and texte = config_avant
      and not exists (select 1 from cabinet_admins where user_id = client), false));

  perform set_config('essai.plan_comptable', verdicts::text, true);
end $$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier sans ses lignes de commentaire
-- (`grep -v '^\s*--'`) par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.plan_comptable')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
