-- LA TRACE DES DROITS D'UN ACCÈS CLIENT (espace client, étape P1-trace ; la migration `trace_des_droits`, en production
-- depuis le 07/11/2026, supabase/schema/20261107163158_trace_des_droits.sql). Le récit : HISTORIQUE.md, « 05/11/2026 — LA TRACE DES DROITS D'UN ACCÈS, EN BASE
-- (P1-TRACE) (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer par `execute_sql` après toute migration qui touche `memberships`, ses
-- gardes, `changer_droits_acces`, `trace_des_droits` ou ses fonctions. Le retrait d'un accès et la suppression d'un dossier
-- se jouent à part, sur une réplique : `traceDesDroitsSuppression.sql`.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - chaque case qui CHANGE écrit une ligne — par `changer_droits_acces` (le chef super-administrateur, un chef qui ne
--     l'est pas, le membre affecté), par le propriétaire sans session et par le rôle des Edge Functions (l'auteur nul) — ;
--     une case qui ne change pas, une autre colonne de l'accès, un refus (un membre d'ailleurs, le client lui-même, la garde
--     de la case « Caisse ») n'écrivent rien ; un accès qui arrive en portant des cases les écrit en « creation », un accès
--     emporté vers un autre dossier part de l'un en « retrait » et arrive dans l'autre en « creation » ;
--   - la restauration ne fabrique rien : l'accès réinséré par le super-administrateur n'écrit aucune ligne, et la trace
--     qu'il réinsère se relit à son instant ;
--   - personne n'écrit la trace en direct — ni le client, ni le membre, ni un chef qui n'est pas super-administrateur, ni
--     le rôle des Edge Functions, ni le propriétaire, ni l'anonyme : la garde, AVANT la RLS (qui ne juge la ligne qu'après
--     les déclencheurs d'avant), refuse sous ses mots — ; personne ne la réécrit (aucune policy ; la garde) ; le cabinet du dossier la lit, ni un membre d'ailleurs, ni le client, ni l'anonyme ;
--   - le catalogue : la table, ses contraintes, ses deux policies, ses deux fonctions et leurs déclencheurs, la trace
--     après les deux gardes de `memberships` ; toute case `droit_…` de `memberships` tracée — nommée par le déclencheur,
--     admise par la contrainte, lue par la fonction : une case de plus (la case « Comptes » de C4a), appliquée avant ou
--     après cette migration, y paraît en faute (la relecture de sécurité du 06/11/2026 ; la garde de tête refuse l'une, la
--     garde de C4a l'autre, ce contrôle voit l'état qu'elles protègent).
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `b1d70000-0000-4000-8024`), exonérés et basculés, chacun
-- avec un accès sans droit du client d'essai (inséré comme `create-client-access` l'insère) ; un accès d'essai donné au
-- compte du chef, le temps d'une étape. LE CHEF QUI N'EST PAS SUPER-ADMINISTRATEUR ET LES MEMBRES D'ESSAI sont le compte
-- client du jeu, rattaché au cabinet le temps d'une étape — le patron de `droitsAcces.sql`. Chaque étape se joue dans sa
-- sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : le verdict voyage dans des variables, l'état relu par le
-- propriétaire avant l'annulation ; le jeu lui-même s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est
-- resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.trace_des_droits`), que la requête
-- finale lit : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune instruction de
-- suppression, et ne rend rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil d'exécution, il se joue en UNE
-- transaction (`psql -1`). Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dt constant text := 'b1d70000-0000-4000-8024-0000000000d1';
  du constant text := 'b1d70000-0000-4000-8024-0000000000d2';
  acces_a constant text := 'b1d70000-0000-4000-8024-0000000000a1';
  acces_b constant text := 'b1d70000-0000-4000-8024-0000000000b1';
  acces_n constant text := 'b1d70000-0000-4000-8024-0000000000c1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  verdicts jsonb := '[]'::jsonb;
  e record;
  v_obs text;
  v_code text;
  v_msg text;
  v_apres text;
  v_req text;
  -- Ce que la trace des deux dossiers dit, relu par le propriétaire : le dossier, l'accès (« (chef) » quand c'est celui
  -- du compte du chef), le droit, la case, le geste, l'auteur, et le jour quand ce n'est pas l'instant de l'étape.
  resume constant text := $r$select coalesce(string_agg(
      case t.dossier_id::text when '{DT}' then 'DT' when '{DU}' then 'DU' else '?' end
      || ' ' || case t.acces_id::text when '{A}' then 'A' when '{B}' then 'B' when '{N}' then 'N' else '?' end
      || case t.client_id::text when '{CLIENT}' then '' when '{CHEF}' then '(chef)' else '(?)' end
      || ' ' || t.droit || ' ' || case when t.coche then 'cochée' else 'décochée' end || ' ' || t.geste || ' par '
      || case when t.auteur_id is null then 'sans session' when t.auteur_id::text = '{CHEF}' then 'le chef'
              when t.auteur_id::text = '{CLIENT}' then 'le compte d''essai' else 'un autre' end
      || case when t.fait_le = now() then '' else ' le ' || to_char(t.fait_le at time zone 'UTC', 'YYYY-MM-DD') end,
      ', ' order by t.dossier_id, t.acces_id, t.droit, t.geste, t.coche desc), 'rien')
    from trace_des_droits t where t.dossier_id in ('{DT}', '{DU}')$r$;
  -- L'accès du compte du chef, réinséré par le super-administrateur (la porte de la restauration : rien de tracé), « Banque »
  -- cochée — le jeu de l'étape 18.
  pose_n constant text := $p$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true);
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque)
    values ('{N}', '{CHEF}', '{DT}', 'client', 'essai-trace-n@example.test', true)$p$;
  -- Une case changée par le propriétaire, sans session : la ligne que les étapes 26 à 33 réécrivent ou lisent.
  une_ligne constant text := $p$update memberships set droit_banque = true where id = '{A}' and not droit_banque$p$;
  ecrire constant text := $q$insert into trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste)
    values ('{DT}', '{A}', '{CLIENT}', 'banque', true, 'changement') returning 'insérée'$q$;
  reecrire constant text := $q$with t as (update trace_des_droits set coche = false where dossier_id = '{DT}' returning 1)
    select count(*)::text from t$q$;
  lire constant text := $q$select count(*)::text from trace_des_droits where dossier_id = '{DT}'$q$;
  ligne_lue constant text := 'DT A banque cochée changement par sans session';
  refus_garde constant text := 'La trace des droits ne s''écrit que par l''écriture des droits d''un accès.';
  refus_reecriture constant text := 'La trace des droits ne se réécrit pas : une ligne ne part qu''avec son dossier.';
  -- L'état des cases : P1-trace seule, puis C4a (« Comptes »), puis B1 (« Achats », « Notes de frais », « Documents ») —
  -- chacune étend la fonction et le déclencheur de la trace (rangs 38 à 40).
  etat constant text := case
    when exists (select 1 from pg_attribute a where a.attrelid = 'public.memberships'::regclass and a.attname = 'droit_documents' and not a.attisdropped) then 'b1'
    when exists (select 1 from pg_attribute a where a.attrelid = 'public.memberships'::regclass and a.attname = 'droit_comptes' and not a.attisdropped) then 'c4a'
    else 'p1' end;
  tracer_attendu constant text := case etat when 'b1' then '2e86432a422c1d5d0371bb769e6053f1' when 'c4a' then '808b209e76b5ddaa079dc2cfac01e934'
    else '0ef7ead57a5829ec8fed54fd7e561371' end;
  colonnes_tracees constant text := case etat when 'b1' then 'droit_ventes, droit_banque, droit_caisse, droit_comptes, droit_achats, droit_frais, droit_documents'
    when 'c4a' then 'droit_ventes, droit_banque, droit_caisse, droit_comptes' else 'droit_ventes, droit_banque, droit_caisse' end;
  -- Les déclencheurs de memberships : les deux gardes, la trace, et, la migration `adresse_des_acces_retires` (P1T-E2) en
  -- base, le sien, rangé après celui de la trace.
  declencheurs_memberships constant text := 'memberships_droit_caisse, memberships_droit_ventes, memberships_trace_des_droits'
    || case when to_regclass('public.adresses_des_acces_retires') is null then '' else ', memberships_trace_des_droits_adresse' end;
  cases_lues constant text := case etat when 'b1' then 'droit_achats, droit_banque, droit_caisse, droit_comptes, droit_documents, droit_frais, droit_ventes'
    when 'c4a' then 'droit_banque, droit_caisse, droit_comptes, droit_ventes' else 'droit_banque, droit_caisse, droit_ventes' end;
begin
  if to_regclass('public.trace_des_droits') is null then
    perform set_config('essai.trace_des_droits', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration trace_des_droits', 'ok', true,
      'observe', 'la table trace_des_droits absente : rien ne s''écrit'))::text, true);
    return;
  end if;

  -- Ce que les profils supposent : le chef, super-administrateur et chef du cabinet ; le compte d'essai, ni l'un ni l'autre.
  verdicts := verdicts || jsonb_build_object('rang', 0, 'etape', '0. les profils : le chef super-administrateur et chef du cabinet, le compte d''essai ni membre ni super-administrateur',
    'ok', exists (select 1 from cabinet_admins where user_id::text = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
      and exists (select 1 from super_admins where user_id::text = chef)
      and not exists (select 1 from cabinet_admins where user_id::text = client)
      and not exists (select 1 from super_admins where user_id::text = client),
    'observe', 'lus');

  begin
    -- Le jeu : deux dossiers jetables, exonérés et basculés (les gardes des cases « Ventes » et « Caisse » les admettent) ;
    -- un accès sans droit du client d'essai à chacun, inséré par le propriétaire comme `create-client-access` l'insère.
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva, ventes_par_les_factures) values
      (dt::uuid, 'ESSAI TRACE DES DROITS DT', cabinet, 'tresorerie', '455000', 'exonere', true),
      (du::uuid, 'ESSAI TRACE DES DROITS DU', cabinet, 'tresorerie', '455000', 'exonere', true);
    insert into memberships (id, user_id, dossier_id, role, email) values
      (acces_a::uuid, client::uuid, dt::uuid, 'client', 'essai-trace-a@example.test'),
      (acces_b::uuid, client::uuid, du::uuid, 'client', 'essai-trace-b@example.test');

    -- Une étape : {rang, profil — `chef` (super-administrateur), `chef_simple` (un chef qui ne l'est pas), `membre` (affecté
    -- à DT), `membre_ailleurs` (affecté à DU seul), `client`, `service` (le rôle des Edge Functions), `anon`, ou
    -- `proprietaire` (sans session) —, étape, ce que le propriétaire pose d'abord, la requête du profil, ce que le
    -- propriétaire relit après (`R` : la trace des deux dossiers), le code attendu (`OK` : acceptée), ce qui est attendu :
    -- « la valeur rendue | ce qui est relu »}.
    for e in select * from (values
      (1, 'proprietaire', '1. le jeu posé : deux accès sans droit, comme create-client-access les insère — rien de tracé', null, $q$select 'posé'$q$, 'R', 'OK', 'posé | rien'),
      (2, 'chef', '2. le chef (super-administrateur) coche « Banque » par changer_droits_acces : une ligne, à lui, à cet instant', null,
        $q$select (changer_droits_acces('{A}', null, true, null)).droit_banque::text$q$, 'R', 'OK', 'true | DT A banque cochée changement par le chef'),
      (3, 'chef', '3. la même case cochée deux fois : une seule ligne — une case qui ne change pas n''écrit rien', null,
        $q$select (changer_droits_acces('{A}', null, true, null)).droit_banque::text || (changer_droits_acces('{A}', null, true, null)).droit_banque::text$q$,
        'R', 'OK', 'truetrue | DT A banque cochée changement par le chef'),
      (4, 'chef', '4. « Banque » cochée, puis « Ventes » cochée et « Banque » décochée d''un seul appel : une ligne par case qui change', null,
        $q$select (changer_droits_acces('{A}', null, true, null)).droit_banque::text || '/' || (changer_droits_acces('{A}', true, false, null)).droit_ventes::text$q$,
        'R', 'OK', 'true/true | DT A banque cochée changement par le chef, DT A banque décochée changement par le chef, DT A ventes cochée changement par le chef'),
      (5, 'membre', '5. le membre affecté au dossier coche « Caisse » : une ligne, à lui', null,
        $q$select (changer_droits_acces('{A}', null, null, true)).droit_caisse::text$q$, 'R', 'OK', 'true | DT A caisse cochée changement par le compte d''essai'),
      (6, 'chef_simple', '6. un chef du cabinet qui n''est pas super-administrateur coche « Banque » : une ligne, à lui', null,
        $q$select (changer_droits_acces('{A}', null, true, null)).droit_banque::text$q$, 'R', 'OK', 'true | DT A banque cochée changement par le compte d''essai'),
      (7, 'membre_ailleurs', '7. un membre affecté à un AUTRE dossier : refusé (42501), rien de tracé', null,
        $q$select (changer_droits_acces('{A}', null, true, null)).droit_banque::text$q$, 'R', '42501', 'Accès refusé à ce dossier. | rien'),
      (8, 'client', '8. le client de l''accès coche sa propre case : refusé (42501), rien de tracé', null,
        $q$select (changer_droits_acces('{A}', null, true, null)).droit_banque::text$q$, 'R', '42501', 'Accès refusé à ce dossier. | rien'),
      (9, 'client', '9. … ni par une mise à jour directe : aucune policy, aucune ligne touchée, rien de tracé', null,
        $q$with m as (update memberships set droit_banque = true where id = '{A}' returning 1) select count(*)::text from m$q$, 'R', 'OK', '0 | rien'),
      (10, 'proprietaire', '10. le propriétaire, sans session (l''éditeur SQL) : tracé, sans auteur', null,
        $q$with m as (update memberships set droit_banque = true where id = '{A}' returning 1) select count(*)::text from m$q$, 'R', 'OK',
        '1 | DT A banque cochée changement par sans session'),
      (11, 'service', '11. le rôle des Edge Functions, sous la clé secrète : tracé, sans auteur', null,
        $q$with m as (update memberships set droit_banque = true where id = '{A}' returning 1) select count(*)::text from m$q$, 'R', 'OK',
        '1 | DT A banque cochée changement par sans session'),
      (12, 'proprietaire', '12. une autre colonne de l''accès (son adresse) : rien de tracé', null,
        $q$with m as (update memberships set email = 'essai-trace-autre@example.test' where id = '{A}' returning 1) select count(*)::text from m$q$,
        'R', 'OK', '1 | rien'),
      (13, 'proprietaire', '13. une case que la garde de « Caisse » refuse (le dossier passé redevable) : refusée (23514), rien de tracé',
        $p$update dossiers set statut_tva = 'redevable' where id = '{DT}'$p$,
        $q$with m as (update memberships set droit_caisse = true where id = '{A}' returning 1) select count(*)::text from m$q$, 'R', '23514',
        'Le droit « Caisse » suppose un dossier exonéré de TVA ou en franchise en base, ce que le statut de ce dossier ne dit pas : sa caisse reste tenue par le cabinet. | rien'),
      (14, 'chef', '14. la restauration : le super-administrateur réinsère un accès qui porte les trois cases — rien de tracé', null,
        $q$with m as (insert into memberships (id, user_id, dossier_id, role, email, droit_ventes, droit_banque, droit_caisse)
  values ('{N}', '{CHEF}', '{DT}', 'client', 'essai-trace-n@example.test', true, true, true) returning 1) select count(*)::text from m$q$, 'R', 'OK', '1 | rien'),
      (15, 'chef', '15. … puis la trace elle-même, telle que la sauvegarde la porte : acceptée, relue à son instant', null,
        $q$with t as (insert into trace_des_droits (id, dossier_id, acces_id, client_id, droit, coche, geste, auteur_id, fait_le)
  values ('b1d70000-0000-4000-8024-0000000000e1', '{DT}', '{A}', '{CLIENT}', 'ventes', true, 'changement', '{CHEF}', '2026-10-01 10:00:00+00')
  returning 1) select count(*)::text from t$q$, 'R', 'OK', '1 | DT A ventes cochée changement par le chef le 2026-10-01'),
      (16, 'chef_simple', '16. un chef qui n''est pas super-administrateur insère un accès qui porte « Banque » : tracé en création, à lui', null,
        $q$with m as (insert into memberships (id, user_id, dossier_id, role, email, droit_banque)
  values ('{N}', '{CHEF}', '{DT}', 'client', 'essai-trace-n@example.test', true) returning 1) select count(*)::text from m$q$, 'R', 'OK',
        '1 | DT N(chef) banque cochée creation par le compte d''essai'),
      (17, 'proprietaire', '17. le propriétaire insère un accès qui porte « Caisse » : tracé en création, sans auteur', null,
        $q$with m as (insert into memberships (id, user_id, dossier_id, role, email, droit_caisse)
  values ('{N}', '{CHEF}', '{DT}', 'client', 'essai-trace-n@example.test', true) returning 1) select count(*)::text from m$q$, 'R', 'OK',
        '1 | DT N(chef) caisse cochée creation par sans session'),
      (18, 'service', '18. le rôle des Edge Functions insère un accès qui porte « Ventes » et « Banque » : deux lignes, sans auteur', null,
        $q$with m as (insert into memberships (id, user_id, dossier_id, role, email, droit_ventes, droit_banque)
  values ('{N}', '{CHEF}', '{DT}', 'client', 'essai-trace-n@example.test', true, true) returning 1) select count(*)::text from m$q$, 'R', 'OK',
        '1 | DT N(chef) banque cochée creation par sans session, DT N(chef) ventes cochée creation par sans session'),
      (19, 'proprietaire', '19. un accès qui porte « Banque » emporté vers un autre dossier : « retrait » de l''un, « creation » dans l''autre', 'POSE_N',
        $q$with m as (update memberships set dossier_id = '{DU}' where id = '{N}' returning 1) select count(*)::text from m$q$, 'R', 'OK',
        '1 | DT N(chef) banque décochée retrait par sans session, DU N(chef) banque cochée creation par sans session'),
      (20, 'chef', '20. le réglage que la garde de la trace lit est remis à vide après l''écriture', null,
        $q$select changer_droits_acces('{A}', null, true, null); select coalesce(nullif(current_setting('jd.trace_des_droits', true), ''), 'vide')$q$,
        'R', 'OK', 'vide | DT A banque cochée changement par le chef'),
      (21, 'client', '21. le client n''écrit pas la trace (la garde, avant la RLS)', null, 'ECRIRE', 'R', '42501', 'GARDE'),
      (22, 'membre', '22. le membre affecté non plus', null, 'ECRIRE', 'R', '42501', 'GARDE'),
      (23, 'chef_simple', '23. un chef qui n''est pas super-administrateur non plus', null, 'ECRIRE', 'R', '42501', 'GARDE'),
      (24, 'service', '24. le rôle des Edge Functions non plus', null, 'ECRIRE', 'R', '42501', 'GARDE'),
      (25, 'proprietaire', '25. le propriétaire non plus', null, 'ECRIRE', 'R', '42501', 'GARDE'),
      (26, 'anon', '26. l''anonyme non plus', null, 'ECRIRE', 'R', '42501', 'GARDE'),
      (27, 'chef', '27. personne ne réécrit la trace : le chef super-administrateur (aucune policy, aucune ligne touchée)', 'UNE_LIGNE', 'REECRIRE', 'R', 'OK', '0 | LIGNE'),
      (28, 'service', '28. … le rôle des Edge Functions (la garde, 23514)', 'UNE_LIGNE', 'REECRIRE', 'R', '23514', 'REECRITURE'),
      (29, 'proprietaire', '29. … le propriétaire (la garde, 23514)', 'UNE_LIGNE', 'REECRIRE', 'R', '23514', 'REECRITURE'),
      (30, 'chef', '30. le chef lit la trace de son dossier', 'UNE_LIGNE', 'LIRE', 'R', 'OK', '1 | LIGNE'),
      (31, 'membre', '31. le membre affecté au dossier la lit', 'UNE_LIGNE', 'LIRE', 'R', 'OK', '1 | LIGNE'),
      (32, 'membre_ailleurs', '32. un membre affecté à un autre dossier n''en lit rien', 'UNE_LIGNE', 'LIRE', 'R', 'OK', '0 | LIGNE'),
      (33, 'client', '33. le client n''en lit rien, pas même de son dossier — il lit son accès', 'UNE_LIGNE',
        $q$select (select count(*) from trace_des_droits where dossier_id = '{DT}')::text || ' ' || (select count(*) from memberships where id = '{A}')::text$q$,
        'R', 'OK', '0 1 | LIGNE'),
      (34, 'anon', '34. l''anonyme n''en lit rien', 'UNE_LIGNE', 'LIRE', 'R', 'OK', '0 | LIGNE'),
      (35, 'proprietaire', '35. le catalogue : la table, la RLS active et non forcée, ses colonnes', null,
        $q$select c.relrowsecurity || ' ' || c.relforcerowsecurity || ' | ' || (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
  || case when a.attnotnull then ' not null' else '' end || coalesce(' = ' || pg_get_expr(d.adbin, d.adrelid), ''), ', ' order by a.attnum)
  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) from pg_class c where c.oid = 'public.trace_des_droits'::regclass$q$, null, 'OK',
        'true false | id uuid not null = gen_random_uuid(), dossier_id uuid not null, acces_id uuid not null, client_id uuid not null, droit text not null, coche boolean not null, geste text not null, auteur_id uuid, fait_le timestamp with time zone not null = now() | -'),
      (36, 'proprietaire', '36. … ses contraintes : le dossier en cascade, aucune clé vers l''accès ni vers un compte', null,
        $q$select string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), ' ; ' order by c.conname) from pg_constraint c
  where c.conrelid = 'public.trace_des_droits'::regclass$q$, null, 'OK',
        'trace_des_droits_coche CHECK ((((geste <> ''creation''::text) OR coche) AND ((geste <> ''retrait''::text) OR (NOT coche)))) ; trace_des_droits_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers(id) ON DELETE CASCADE ; trace_des_droits_droit CHECK ((droit = ANY (ARRAY[''ventes''::text, ''banque''::text, ''caisse''::text, ''comptes''::text, ''achats''::text, ''frais''::text, ''documents''::text]))) ; trace_des_droits_geste CHECK ((geste = ANY (ARRAY[''changement''::text, ''creation''::text, ''retrait''::text]))) ; trace_des_droits_pkey PRIMARY KEY (id) | -'),
      (37, 'proprietaire', '37. … ses deux policies, à authenticated seul : la lecture du cabinet du dossier, l''insertion du super-administrateur', null,
        $q$select string_agg(p.policyname || ' ' || p.cmd || ' ' || array_to_string(p.roles, ',') || ' ' || coalesce(p.qual, '-') || ' '
  || coalesce(p.with_check, '-') || ' ' || p.permissive, ' ; ' order by p.policyname) from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'trace_des_droits'
    and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')$q$, null, 'OK',
        'trace_des_droits_lecture SELECT authenticated admin_du_dossier(dossier_id) - PERMISSIVE ; trace_des_droits_restauration INSERT authenticated - is_super_admin() PERMISSIVE | -'),
      (38, 'proprietaire', '38. … ses deux fonctions : la garde aux droits de l''appelant, le déclencheur aux droits du propriétaire, leur chemin fixé, aucun rôle de l''API, leurs corps à leur empreinte', null,
        $q$select string_agg(p.proname || ' ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), '-') || ' '
  || has_function_privilege('anon', p.oid, 'execute') || ' ' || has_function_privilege('authenticated', p.oid, 'execute') || ' '
  || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
  || ' ' || md5(replace(p.prosrc, chr(13), '')), ' ; ' order by p.proname) from pg_proc p
  where p.oid in (to_regprocedure('public.garder_trace_des_droits()'), to_regprocedure('public.tracer_les_droits()'))$q$, null, 'OK',
        'garder_trace_des_droits false search_path=public false false false a63a4b732282845e7cb30e3ce2dd763d ; tracer_les_droits true search_path=public false false false ' || tracer_attendu || ' | -'),
      (39, 'proprietaire', '39. … leurs déclencheurs, actifs ; celui de la trace après les deux gardes de memberships', null,
        $q$select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname) || ' | '
  || (select string_agg(m.tgname, ', ' order by m.tgname) from pg_trigger m where m.tgrelid = 'public.memberships'::regclass and not m.tgisinternal)
  from pg_trigger t where t.tgname in ('memberships_trace_des_droits', 'trace_des_droits_garde') and not t.tgisinternal$q$, null, 'OK',
        'CREATE TRIGGER memberships_trace_des_droits AFTER INSERT OR DELETE OR UPDATE OF ' || colonnes_tracees || ', dossier_id, user_id, id ON public.memberships FOR EACH ROW EXECUTE FUNCTION tracer_les_droits() O ; CREATE TRIGGER trace_des_droits_garde BEFORE INSERT OR DELETE OR UPDATE ON public.trace_des_droits FOR EACH ROW EXECUTE FUNCTION garder_trace_des_droits() O | ' || declencheurs_memberships || ' | -'),
      (40, 'proprietaire', '40. … toute case droit_… de memberships est tracée : nommée par le déclencheur, admise par la contrainte, lue par la fonction (sinon, en faute)', null,
        $q$select string_agg(a.attname, ', ' order by a.attname) || ' | non tracée : ' || coalesce(string_agg(a.attname, ', ' order by a.attname) filter (where not (
    a.attnum = any ((select t.tgattr from pg_trigger t where t.tgname = 'memberships_trace_des_droits' and not t.tgisinternal)::int2[])
    and strpos((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.trace_des_droits'::regclass and c.conname = 'trace_des_droits_droit'), '''' || substr(a.attname, 7) || '''') > 0
    and strpos((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.tracer_les_droits()')), 'new.' || a.attname) > 0)), 'aucune')
  from pg_attribute a where a.attrelid = 'public.memberships'::regclass and a.attnum > 0 and not a.attisdropped and left(a.attname, 6) = 'droit_'$q$, null, 'OK',
        cases_lues || ' | non tracée : aucune | -')
    ) as t(rang, profil, etape, avant, requete, apres, code, attendu) order by rang loop
      v_obs := null;
      v_code := 'OK';
      v_msg := '';
      v_apres := null;
      begin
        -- La place du profil dans le cabinet, posée par le propriétaire le temps de l'étape.
        perform set_config('request.jwt.claims', '', true);
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        elsif e.profil in ('membre', 'membre_ailleurs') then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable');
          insert into dossier_assignations (dossier_id, user_id)
            values (case when e.profil = 'membre' then dt else du end::uuid, client::uuid);
        end if;
        if e.avant is not null then
          v_req := case e.avant when 'POSE_N' then pose_n when 'UNE_LIGNE' then une_ligne else e.avant end;
          execute replace(replace(replace(replace(replace(replace(replace(v_req, '{DT}', dt), '{DU}', du), '{A}', acces_a), '{B}', acces_b),
            '{N}', acces_n), '{CHEF}', chef), '{CLIENT}', client);
          perform set_config('request.jwt.claims', '', true);
        end if;
        v_req := case e.requete when 'ECRIRE' then ecrire when 'REECRIRE' then reecrire when 'LIRE' then lire else e.requete end;
        v_req := replace(replace(replace(replace(replace(replace(replace(v_req, '{DT}', dt), '{DU}', du), '{A}', acces_a), '{B}', acces_b),
          '{N}', acces_n), '{CHEF}', chef), '{CLIENT}', client);
        begin
          if e.profil = 'anon' then
            execute 'set local role anon';
            perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          elsif e.profil = 'service' then
            execute 'set local role service_role';
            perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
          elsif e.profil <> 'proprietaire' then
            execute 'set local role authenticated';
            perform set_config('request.jwt.claims',
              json_build_object('sub', case e.profil when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
          end if;
          execute v_req into v_obs;
          set constraints all immediate;
          set constraints all deferred;
          reset role;
          v_msg := coalesce(v_obs, '');
        exception when others then
          reset role;
          v_code := sqlstate;
          v_msg := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        if e.apres = 'R' then
          execute replace(replace(replace(replace(replace(replace(replace(resume, '{DT}', dt), '{DU}', du), '{A}', acces_a), '{B}', acces_b),
            '{N}', acces_n), '{CHEF}', chef), '{CLIENT}', client) into v_apres;
        end if;
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        if sqlerrm <> 'ANNULATION_ETAPE' then
          v_code := 'ESSAI';
          v_msg := sqlstate || ' ' || sqlerrm;
        end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and v_msg || ' | ' || coalesce(v_apres, '-')
          = case e.attendu when 'GARDE' then refus_garde || ' | rien'
                           when 'REECRITURE' then refus_reecriture || ' | ' || ligne_lue
                           else replace(e.attendu, 'LIGNE', ligne_lue) end,
        'observe', v_code || ' ' || v_msg || ' | ' || coalesce(v_apres, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les deux dossiers, ni leurs accès, ni leur trace, ni le compte d'essai dans le cabinet.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs accès, ni leur trace, ni le compte d''essai dans le cabinet',
    'ok', not exists (select 1 from dossiers where id in (dt::uuid, du::uuid))
      and not exists (select 1 from memberships where id in (acces_a::uuid, acces_b::uuid, acces_n::uuid))
      and not exists (select 1 from trace_des_droits where dossier_id in (dt::uuid, du::uuid))
      and not exists (select 1 from cabinet_admins where user_id::text = client)
      and not exists (select 1 from dossier_assignations where user_id::text = client),
    'observe', 'relu');
  perform set_config('essai.trace_des_droits', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.trace_des_droits')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
