-- LE CODE OPAQUE D'UNE FICHE CLIENT, POSÉ PAR LA BASE (EXP58-Q2 ; la migration préparée `codes_des_clients`,
-- supabase/preparees/20261124170000_codes_des_clients.sql). Le récit : HISTORIQUE.md, « 24/11/2026 — EXP58-Q2 : UN CODE OPAQUE
-- PAR FICHE CLIENT (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer après toute migration qui touche `contacts`, ses déclencheurs ou ses
-- contraintes, `poser_code_client`, `contacts_numerotation`, `enregistrer_contact`, `importer_contacts`, `effacer_contact`,
-- `retirer_contact`, `reprendre_contact`, `acces_avant_les_gardes` ou `is_super_admin`. La validation qui admet le code (la
-- garde du secret de `valider_exercice`) se joue dans supabase/essais/validationExercice.sql (étapes 167). SANS LA MIGRATION
-- (la colonne absente du catalogue), il se dit EN ATTENTE.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE CATALOGUE : la colonne, un texte NOT NULL sans défaut ; sa forme (C et cinq chiffres, jamais C00000) et son unicité
--      TOTALE dans le dossier ; le compteur sous RLS, sans policy permissive ; la garde aux droits du propriétaire, à son
--      chemin, qu'aucun rôle de session n'exécute ; son déclencheur avant l'insertion et la mise à jour, entre la porte et la
--      garde des fiches liées ;
--   2. LA POSE : une fiche créée par `enregistrer_contact` — par le chef, ou par le client « Ventes » —, ou par l'import, ou par
--      une insertion du propriétaire, reçoit le code suivant du compteur de SON dossier, dans l'ordre de création ; un autre
--      dossier a son propre compteur ; au-delà de C99999, un refus, et rien n'est rangé ;
--   3. LA GARDE : le code ne change plus — ni par une écriture directe du propriétaire, hors de la RLS, ni par la
--      modification de la fiche, son retrait, sa reprise ou son effacement (la fiche effacée garde son code) ; une écriture
--      qui ne touche pas le code passe ;
--   4. LA RESTAURATION : le super-administrateur réinsère une fiche AVEC son code (gardé, le compteur repris au plus haut, sans
--      jamais reculer) ou sans code (une sauvegarde d'avant la migration : le suivant) ; un code mal formé ou déjà pris dans le
--      dossier se refuse, le même code dans un autre dossier passe ; le client « Ventes » n'insère rien directement (la RLS) ;
--   5. CE QUE LES COMPTES LISENT : le client « Ventes » lit le code de chacune de ses fiches ; sans « Ventes », aucune ; le
--      compteur, aucun rôle de l'API ne le lit ni ne l'écrit, le super-administrateur compris.
-- Les MUTATIONS rejouent un contrôle à faux et doivent mordre : la garde désactivée, le code change ; un autre dossier
-- accepte le code pris ; le compteur sous la borne donne C99999.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `c0de0000-0000-4000-8000`) : DA, basculé (« Ventes » ne se porte
-- que là), où le client d'essai a un accès « Ventes » ; DB, l'autre dossier. Chaque étape se joue dans sa sous-transaction et
-- s'y ANNULE (`ANNULATION_ETAPE`) : ce que le propriétaire pose d'abord, puis le geste (du chef — super-administrateur et chef
-- du cabinet —, du client sous la RLS, ou du propriétaire hors d'elle), puis ce qu'on relit ; le jeu s'annule à la fin
-- (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.codes_des_clients`) : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune
-- instruction qui retire des lignes, et ne rend rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil
-- d'exécution, il se joue en UNE transaction (`psql -1`). Données FICTIVES.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  da constant text := 'c0de0000-0000-4000-8000-0000000000d1';
  db constant text := 'c0de0000-0000-4000-8000-0000000000d2';
  acces_ventes constant text := 'c0de0000-0000-4000-8000-0000000000ac';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  appliquee constant boolean := exists (select 1 from information_schema.columns c
                                          where c.table_schema = 'public' and c.table_name = 'contacts' and c.column_name = 'code_client');
  change constant text := 'Le code d''une fiche client est posé par la base à sa création et ne change plus : il désigne ce client dans le FEC.';
  borne constant text := 'Ce dossier a reçu ses 99 999 codes de fiche client (C00001 à C99999) : une fiche de plus n''a plus de code.';
  -- Une fiche rangée par le propriétaire, hors de la RLS : son code vient du compteur, comme toute fiche créée sans code.
  fiche constant text := $q$insert into contacts (dossier_id, genre, type_client, nom, adresse) values ('{D}', 'client', 'assujetti', '{NOM}', 'Adresse fictive');$q$;
  -- Une fiche créée par la fonction, au nom de qui fait le geste.
  creer constant text := $q$select public.enregistrer_contact('{D}', null, jsonb_build_object('nom', '{NOM}', 'type_client', 'assujetti', 'adresse', 'Adresse fictive'));$q$;
  -- Les fiches d'un dossier, chacune sous son code, dans l'ordre des codes.
  codes constant text := $q$(select coalesce(string_agg(nom || '=' || code_client, ',' order by code_client collate "C"), '∅') from contacts where dossier_id = '{D}')$q$;
  compteur constant text := $q$(select coalesce((select dernier_numero::text from contacts_numerotation where dossier_id = '{D}'), '∅'))$q$;
  restaurer constant text := $q$insert into contacts (dossier_id, genre, type_client, nom, adresse, code_client) values ('{D}', 'client', 'assujetti', '{NOM}', 'Adresse fictive', '{CODE}');$q$;
  e record; v_code text; v_msg text; v_obs text; v_textes text[];
  verdicts jsonb := '[]'::jsonb;
begin
  if not appliquee then
    perform set_config('essai.codes_des_clients', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration codes_des_clients (EXP58-Q2)', 'ok', true,
      'observe', 'absente : une fiche client n''a pas encore de code ; l''essai se joue dès qu''elle y est'))::text, true);
    return;
  end if;
  if cabinet is null or not exists (select 1 from super_admins where user_id = chef::uuid)
     or exists (select 1 from cabinet_admins where user_id = client::uuid) then
    raise exception 'ESSAI_IMPOSSIBLE : le jeu de départ (le dossier test, le chef super-administrateur, le client d''essai) est introuvable';
  end if;
  begin
    -- DA naît basculé : « Ventes » ne se porte que sur un dossier dont les factures sont la source de leurs ventes.
    insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, ventes_par_les_factures) values
      (da::uuid, 'ESSAI CODES DA', cabinet, 'redevable', true, true),
      (db::uuid, 'ESSAI CODES DB', cabinet, 'redevable', true, false);
    insert into memberships (id, user_id, dossier_id, role, email) values
      (acces_ventes::uuid, client::uuid, da::uuid, 'client', 'essai-codes@exemple.invalid');
    update memberships set droit_ventes = true, droit_banque = false where id = acces_ventes::uuid;

    -- Une étape : {rang, étape, ce que le PROPRIÉTAIRE pose d'abord, qui fait le geste (`chef`, `client` sous la RLS, `proprio`
    -- hors d'elle), le geste, ce qu'on relit (par le propriétaire), le code attendu (`OK` : accepté) et ce qu'on relit, ou les
    -- mots du refus (un `%` s'y lit comme dans LIKE)}. Dans un texte, `{A:nom}` est une fiche de DA rangée par le propriétaire,
    -- `{CA:nom}` une fiche de DA créée par la fonction, `{CB:nom}` une de DB ; `{RA:nom:code}` une fiche de DA réinsérée avec
    -- son code ; `{CODES_A}`, `{CODES_B}`, `{COMPTEUR_A}` ce qu'on relit.
    for e in select * from (values
      (1, '1. le catalogue : la colonne NOT NULL sans défaut, sa forme et son unicité totale ; le compteur sous RLS, sans aucune policy (la restrictive de la double authentification à part), sa clé ; la garde aux droits du propriétaire, à son chemin, qu''aucun rôle n''exécute ; son déclencheur avant l''insertion et la mise à jour, entre la porte et la garde des fiches liées',
        null, 'proprio', null,
        $q$(select format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || a.atthasdef::text from pg_attribute a
             where a.attrelid = 'public.contacts'::regclass and a.attname = 'code_client')
           || ' | ' || (select string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), ' ; ' order by c.conname collate "C") from pg_constraint c
                         where c.conrelid = 'public.contacts'::regclass and c.conname like 'contacts_code_client%')
           || ' | ' || (select c.relrowsecurity::text || ' ' || (select count(*) from pg_policy p where p.polrelid = c.oid
                                                                        and not (p.polname = 'deux_facteurs' and not p.polpermissive))::text
                               || ' ' || (select pg_get_constraintdef(k.oid) from pg_constraint k where k.conrelid = c.oid and k.contype = 'p')
                          from pg_class c where c.oid = 'public.contacts_numerotation'::regclass)
           || ' | ' || (select p.prosecdef::text || ' ' || array_to_string(p.proconfig, ',') || ' '
                               || has_function_privilege('authenticated', p.oid, 'execute')::text || ' '
                               || has_function_privilege('anon', p.oid, 'execute')::text
                          from pg_proc p where p.oid = 'public.poser_code_client()'::regprocedure)
           || ' | ' || (select string_agg(t.tgname || ' ' || t.tgtype::text || ' ' || t.tgenabled::text, ', ' order by t.tgname collate "C")
                          from pg_trigger t where t.tgrelid = 'public.contacts'::regclass and not t.tgisinternal)$q$,
        'OK', 'text true false | contacts_code_client_forme CHECK (((code_client ~ ''^C[0-9]{5}$''::text) AND (code_client <> ''C00000''::text))) ; contacts_code_client_unique UNIQUE (dossier_id, code_client) | true 0 PRIMARY KEY (dossier_id) | true search_path=public false false | _acces_avant_les_gardes 23 O, contacts_code_client 23 O, contacts_fiche_liee 23 O'),
      (2, '2. le chef crée une fiche dans DA : elle reçoit C00001, posé par la base',
        null, 'chef', '{CA:Essai un}', '{CODES_A} || '' | '' || {COMPTEUR_A}', 'OK', 'Essai un=C00001 | 1'),
      (3, '2b. deux fiches de plus, rangées par le propriétaire puis créées par le chef : les codes se suivent, dans l''ordre de création',
        '{A:Essai un}', 'chef', '{CA:Essai deux}{CA:Essai trois}', '{CODES_A}', 'OK', 'Essai un=C00001,Essai deux=C00002,Essai trois=C00003'),
      (4, '2c. un autre dossier a son propre compteur : la première fiche de DB est C00001',
        '{A:Essai un}{A:Essai deux}', 'chef', '{CB:Essai B}', '{CODES_A} || '' | '' || {CODES_B}', 'OK', 'Essai un=C00001,Essai deux=C00002 | Essai B=C00001'),
      (5, '2d. le client « Ventes » crée une fiche : son code suit le compteur du dossier',
        '{A:Essai un}', 'client', '{CA:Essai du client}', '{CODES_A}', 'OK', 'Essai un=C00001,Essai du client=C00002'),
      (6, '2e. l''import, ligne par ligne : deux fiches, deux codes qui se suivent, dans l''ordre du fichier',
        '{A:Essai un}', 'chef', $q$select public.importer_contacts('{DA}', '[{"nom":"Essai importé un","type_client":"assujetti","adresse":"Adresse fictive"},{"nom":"Essai importé deux","type_client":"assujetti","adresse":"Adresse fictive"}]'::jsonb);$q$,
        '{CODES_A}', 'OK', 'Essai un=C00001,Essai importé un=C00002,Essai importé deux=C00003'),
      (7, '2f. au-delà de C99999 : refusé, et rien n''est rangé',
        $q$insert into contacts_numerotation (dossier_id, dernier_numero) values ('{DA}', 99999);$q$, 'chef', '{CA:Essai de trop}', null,
        '23514', borne),
      (8, '2g. MUTATION de 2f : sous la borne, la fiche reçoit C99999',
        $q$insert into contacts_numerotation (dossier_id, dernier_numero) values ('{DA}', 99998);$q$, 'chef', '{CA:Essai dernier}',
        '{CODES_A} || '' | '' || {COMPTEUR_A}', 'OK', 'Essai dernier=C99999 | 99999'),
      (9, '3. la garde : le propriétaire, hors de la RLS, ne change pas le code par une écriture directe',
        '{A:Essai un}', 'proprio', $q$update contacts set code_client = 'C00009' where dossier_id = '{DA}';$q$, null, '23514', change),
      (10, '3b. … ni ne le vide',
        '{A:Essai un}', 'proprio', $q$update contacts set code_client = null where dossier_id = '{DA}';$q$, null, '23514', change),
      (11, '3c. MUTATION de 3 : la garde désactivée, le même changement passe — elle, et elle seule, l''interdisait',
        $q${A:Essai un}alter table contacts disable trigger contacts_code_client;$q$, 'proprio',
        $q$update contacts set code_client = 'C00009' where dossier_id = '{DA}';$q$, '{CODES_A}', 'OK', 'Essai un=C00009'),
      (12, '3d. une écriture qui ne touche pas le code passe, et le code reste',
        '{A:Essai un}', 'proprio', $q$update contacts set observations = 'Essai relu' where dossier_id = '{DA}';$q$,
        $q$(select observations || ' ' || code_client from contacts where dossier_id = '{DA}')$q$, 'OK', 'Essai relu C00001'),
      (13, '3e. la modification de la fiche par le chef garde son code',
        '{A:Essai un}', 'chef', $q$select public.enregistrer_contact('{DA}', (select id from contacts where dossier_id = '{DA}'), jsonb_build_object('nom', 'Essai renommé', 'type_client', 'assujetti', 'adresse', 'Autre adresse fictive'));$q$,
        '{CODES_A}', 'OK', 'Essai renommé=C00001'),
      (14, '3f. … son retrait puis sa reprise aussi',
        '{A:Essai un}', 'chef', $q$select public.retirer_contact('{DA}', (select id from contacts where dossier_id = '{DA}'));
          select public.reprendre_contact('{DA}', (select id from contacts where dossier_id = '{DA}'));$q$,
        $q$(select coalesce(retire_le::text, 'en cours') || ' ' || code_client from contacts where dossier_id = '{DA}')$q$, 'OK', 'en cours C00001'),
      (15, '3g. … et son effacement : la fiche effacée garde son code, que ses factures désignent',
        '{A:Essai un}', 'chef', $q$select public.effacer_contact('{DA}', (select id from contacts where dossier_id = '{DA}'));$q$,
        $q$(select (nom like 'Contact effacé le %')::text || ' ' || (efface_le is not null)::text || ' ' || code_client from contacts where dossier_id = '{DA}')$q$,
        'OK', 'true true C00001'),
      (16, '4. la restauration : le super-administrateur réinsère une fiche avec son code — gardé, le compteur repris au plus haut',
        null, 'chef', '{RA:Essai restauré:C00042}', '{CODES_A} || '' | '' || {COMPTEUR_A}', 'OK', 'Essai restauré=C00042 | 42'),
      (17, '4b. … une fiche créée ensuite reçoit le code qui suit le plus haut',
        null, 'chef', '{RA:Essai restauré:C00042}{CA:Essai après}', '{CODES_A}', 'OK', 'Essai restauré=C00042,Essai après=C00043'),
      (18, '4c. … un code restauré plus bas ne fait pas reculer le compteur',
        null, 'chef', '{RA:Essai cinq:C00005}{RA:Essai trois:C00003}{CA:Essai après}', '{CODES_A} || '' | '' || {COMPTEUR_A}', 'OK',
        'Essai trois=C00003,Essai cinq=C00005,Essai après=C00006 | 6'),
      (19, '4c2. … et un code restauré plus haut que le compteur d''un dossier qui a déjà ses fiches le reprend au plus haut',
        '{A:Essai un}', 'chef', '{RA:Essai restauré:C00042}{CA:Essai après}', '{CODES_A} || '' | '' || {COMPTEUR_A}', 'OK',
        'Essai un=C00001,Essai restauré=C00042,Essai après=C00043 | 43'),
      (20, '4d. une fiche réinsérée sans code — une sauvegarde d''avant la migration — reçoit le suivant',
        '{A:Essai un}', 'chef', $q$insert into contacts (dossier_id, genre, type_client, nom, adresse) values ('{DA}', 'client', 'assujetti', 'Essai sans code', 'Adresse fictive');$q$,
        '{CODES_A}', 'OK', 'Essai un=C00001,Essai sans code=C00002'),
      (21, '4e. un code mal formé se refuse : la forme de la table',
        null, 'chef', '{RA:Essai mal formé:X12345}', null, '23514', 'new row for relation "contacts" violates check constraint "contacts_code_client_forme"%'),
      (22, '4f. … C00000 aussi',
        null, 'chef', '{RA:Essai zéro:C00000}', null, '23514', 'new row for relation "contacts" violates check constraint "contacts_code_client_forme"%'),
      (23, '4g. un code déjà pris dans le dossier se refuse',
        '{A:Essai un}', 'chef', '{RA:Essai double:C00001}', null, '23505', 'duplicate key value violates unique constraint "contacts_code_client_unique"%'),
      (24, '4h. MUTATION de 4g : le même code dans l''autre dossier passe',
        '{A:Essai un}', 'chef', $q$insert into contacts (dossier_id, genre, type_client, nom, adresse, code_client) values ('{DB}', 'client', 'assujetti', 'Essai double', 'Adresse fictive', 'C00001');$q$,
        '{CODES_A} || '' | '' || {CODES_B}', 'OK', 'Essai un=C00001 | Essai double=C00001'),
      (25, '4i. le client « Ventes » n''insère aucune fiche directement, même sans code : la RLS, avant toute garde',
        null, 'client', $q$insert into contacts (dossier_id, genre, type_client, nom, adresse) values ('{DA}', 'client', 'assujetti', 'Essai direct', 'Adresse fictive');$q$,
        null, '42501', 'new row violates row-level security policy for table "contacts"'),
      (26, '5. le client « Ventes » lit le code de chacune de ses fiches',
        '{A:Essai un}{A:Essai deux}', 'client', $q$select set_config('essai.codes_lus', (select string_agg(code_client, ',' order by code_client collate "C") from contacts where dossier_id = '{DA}'), true);$q$,
        $q$current_setting('essai.codes_lus')$q$, 'OK', 'C00001,C00002'),
      (27, '5b. MUTATION de 5 : sans « Ventes », il n''en lit aucun',
        $q${A:Essai un}update memberships set droit_ventes = false where dossier_id = '{DA}';$q$, 'client',
        $q$select set_config('essai.codes_lus', coalesce((select string_agg(code_client, ',') from contacts where dossier_id = '{DA}'), '∅'), true);$q$,
        $q$current_setting('essai.codes_lus')$q$, 'OK', '∅'),
      (28, '5c. le compteur : aucun rôle de l''API ne le lit, le super-administrateur compris',
        '{A:Essai un}', 'chef', $q$select set_config('essai.compteurs_lus', (select count(*)::text from contacts_numerotation where dossier_id = '{DA}'), true);$q$,
        $q$current_setting('essai.compteurs_lus') || ' / ' || {COMPTEUR_A}$q$, 'OK', '0 / 1'),
      (29, '5d. … ni ne l''écrit',
        null, 'chef', $q$insert into contacts_numerotation (dossier_id, dernier_numero) values ('{DA}', 5);$q$,
        null, '42501', 'new row violates row-level security policy for table "contacts_numerotation"')
    ) as v(rang, etape, pose, qui, geste, relu, code, attendu) order by rang
    loop
      v_code := 'OK';
      v_msg := null;
      v_obs := null;
      begin
        v_textes := array[e.pose, e.geste, e.relu, e.attendu];
        for i in 1 .. 4 loop
          if v_textes[i] is null then continue; end if;
          -- Les fiches : rangée par le propriétaire, créée par la fonction, réinsérée avec son code.
          while v_textes[i] ~ '\{A:[^}]*\}' loop
            v_textes[i] := regexp_replace(v_textes[i], '\{A:([^}]*)\}',
              replace(replace(fiche, '{D}', da), '{NOM}', (regexp_match(v_textes[i], '\{A:([^}]*)\}'))[1]));
          end loop;
          while v_textes[i] ~ '\{C[AB]:[^}]*\}' loop
            v_textes[i] := regexp_replace(v_textes[i], '\{C([AB]):([^}]*)\}',
              replace(replace(creer, '{D}', case (regexp_match(v_textes[i], '\{C([AB]):'))[1] when 'A' then da else db end),
                      '{NOM}', (regexp_match(v_textes[i], '\{C[AB]:([^}]*)\}'))[1]));
          end loop;
          while v_textes[i] ~ '\{RA:[^}]*\}' loop
            v_textes[i] := regexp_replace(v_textes[i], '\{RA:([^:}]*):([^}]*)\}',
              replace(replace(replace(restaurer, '{D}', da), '{NOM}', (regexp_match(v_textes[i], '\{RA:([^:}]*):'))[1]),
                      '{CODE}', (regexp_match(v_textes[i], '\{RA:[^:}]*:([^}]*)\}'))[1]));
          end loop;
          v_textes[i] := replace(replace(v_textes[i], '{CODES_A}', replace(codes, '{D}', da)), '{CODES_B}', replace(codes, '{D}', db));
          v_textes[i] := replace(v_textes[i], '{COMPTEUR_A}', replace(compteur, '{D}', da));
          v_textes[i] := replace(replace(v_textes[i], '{DA}', da), '{DB}', db);
        end loop;
        if v_textes[1] is not null then
          execute v_textes[1];
        end if;
        begin
          if v_textes[2] is not null then
            if e.qui in ('chef', 'client') then
              execute 'set local role authenticated';
              perform set_config('request.jwt.claims', json_build_object('sub',
                case e.qui when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
            end if;
            execute v_textes[2];
            reset role;
            perform set_config('request.jwt.claims', '', true);
          end if;
          if v_textes[3] is not null then
            execute 'select (' || v_textes[3] || ')::text' into v_obs;
          end if;
          v_msg := coalesce(v_obs, '');
        exception when others then
          v_code := sqlstate;
          v_msg := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
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
        'ok', v_code = e.code and v_msg like v_textes[4], 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs fiches, ni leurs compteurs, ni l''accès d''essai',
    'ok', not exists (select 1 from dossiers where id in (da::uuid, db::uuid))
      and not exists (select 1 from contacts where dossier_id in (da::uuid, db::uuid))
      and not exists (select 1 from contacts_numerotation where dossier_id in (da::uuid, db::uuid))
      and not exists (select 1 from memberships where id = acces_ventes::uuid),
    'observe', 'relu');
  perform set_config('essai.codes_des_clients', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.codes_des_clients')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
