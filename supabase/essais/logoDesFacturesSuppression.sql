-- LA SUPPRESSION D'UN FICHIER DU SEAU DES VENTES, ÉPROUVÉE SUR UNE RÉPLIQUE (espace client, étape A5c1) — SUR UNE RÉPLIQUE
-- SEULEMENT, par psql, en UNE transaction (`psql -1`) : ce fichier porte des SUPPRESSIONS, que l'outil d'exécution de la
-- production soumet à une confirmation qui n'arrive pas (CLAUDE.md, `supabase/essais/`) ; il ne laisse rien, mais une
-- suppression ne se joue pas sur la base du cabinet. Le reste du seau — la lecture, le dépôt, aucune mise à jour, la
-- policy de suppression lue au catalogue — se rejoue par `logoDesFactures.sql`, en production aussi.
--
-- POURQUOI À PART. Le stockage refuse toute suppression SQL directe de `storage.objects` (`protect_objects_delete` →
-- `storage.protect_delete`, 42501, le code même d'un refus de policy) : un essai de suppression passerait au vert avec une
-- policy grande ouverte (RGPD.md §8.6). L'API du stockage, elle, supprime sous la session de l'appelant, le réglage
-- `storage.allow_delete_query` posé : la policy décide alors seule, et une ligne qu'elle refuse n'est simplement pas
-- supprimée (aucune erreur). C'est ce que cet essai rejoue : le réglage posé, chaque profil tente de supprimer un fichier
-- du seau, et le NOMBRE de lignes supprimées dit si la policy l'admet. Ce qu'il ne prouve pas : que l'API pose ce réglage
-- comme ici (essai manuel, RGPD.md §8.6) ; et rien sur le fichier lui-même, que seule l'API retire.
--
-- UNE SUPPRESSION DEMANDE AUSSI LA LECTURE. Une suppression qui nomme ses lignes (`where`) ou les rend (`returning`) — celle
-- de l'API en fait autant — ne voit que les lignes que les policies de LECTURE lui ouvrent (documentation de PostgreSQL,
-- « CREATE POLICY ») : le droit réel est la policy de suppression ET celle de lecture. D'où le contrôle 8 : le chef d'un
-- autre cabinet qui porte « Ventes » sur le dossier en LIT les fichiers ; c'est la policy de suppression seule qui l'arrête.
--
-- CE QUI SE PROUVE, par impersonation : seul le chef du cabinet du DOSSIER supprime un fichier du seau — celui qui seul
-- supprime un dossier (`dossiers_delete`) ; ni l'anonyme, ni un compte rattaché à rien, ni le client (sans case, « Banque »,
-- « Ventes », les deux), ni un membre du cabinet (affecté ou non), ni le chef d'un AUTRE cabinet ; un chemin qui ne commence
-- pas par un dossier ne se supprime pas et ne fait rien lever ; sans le réglage, le stockage refuse à tous ; la suppression
-- d'un dossier telle que l'application la fait — ses fichiers du seau d'abord, sa ligne ensuite — ne laisse ni fichier ni
-- version ; le seau lui-même ne se supprime pas tant qu'un fichier y reste. Mutations : chacune doit MORDRE.
--
-- Le moteur est celui de `logoDesFactures.sql` ; deux profils de plus : `chef_autre` (le compte du client rangé chef d'un
-- cabinet jetable C) et `chef_du_cabinet` (le même, rangé chef du cabinet des dossiers — non super-administrateur).
do $essai$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  cabinet uuid;
  ids jsonb;
  avant text; apres text;
  s record; k text; ordre text; partie text; attendu text; rendu text; accepte boolean; code_recu text; message text; ok boolean;
  erreur text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from storage.buckets where id = 'ventes') then
    verdicts := verdicts || jsonb_build_object('controle', '0. EN ATTENTE : le seau ventes (migration logo_des_factures) n''est pas en base',
      'genre', 'controle', 'observe', 'seau absent', 'ok', true);
    perform set_config('essai.logo_des_factures_suppression', verdicts::text, true);
    return;
  end if;
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from super_admins where user_id = client)
     or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from memberships where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou comptes rattachés autrement qu''attendu';
  end if;

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet,
    'DA', 'a5c00000-0000-4000-8000-0000000000a1', 'DB', 'a5c00000-0000-4000-8000-0000000000b1',
    'CC', 'a5c00000-0000-4000-8000-0000000000cc', 'ACCES', 'a5c00000-0000-4000-8000-0000000000ac',
    'H1', repeat('1', 64), 'H2', repeat('2', 64), 'H9', repeat('9', 64));

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from parametres_facturation)),
    ((select count(*) from storage.objects)), ((select count(*) from storage.buckets)), ((select count(*) from cabinets))
  ) as t(n);

  begin
    for s in select * from (values
      ('j1', 'jeu', 'dossiers jetables A et B, et un cabinet jetable C', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva) values
          ('{DA}', 'ESSAI LOGO A', '{CAB}', 'redevable', true), ('{DB}', 'ESSAI LOGO B', '{CAB}', 'redevable', true)
          §§ insert into cabinets (id, nom) values ('{CC}', 'ESSAI LOGO C')$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-logo@exemple.invalid')$q$, 'OK', null, null),
      ('j3', 'jeu', 'deux logos dans A, un dans B, un chemin sans dossier', 'proprietaire', null,
        $q$insert into storage.objects (bucket_id, name, metadata) values
          ('ventes', '{DA}/logos/{H1}.png', '{"size": 1000, "mimetype": "image/png"}'),
          ('ventes', '{DA}/logos/{H2}.jpg', '{"size": 1000, "mimetype": "image/jpeg"}'),
          ('ventes', '{DB}/logos/{H9}.png', '{"size": 1000, "mimetype": "image/png"}'),
          ('ventes', 'essai-logo-sans-dossier/logos/{H1}.png', '{"size": 1000, "mimetype": "image/png"}')$q$, 'OK', null, null),
      ('j4', 'jeu', 'une version des paramètres de A, qui porte le premier logo', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, auteur, logo_chemin, logo_sha256) values ('{DA}', '{CHEF}', '{DA}/logos/{H1}.png', '{H1}')$q$, 'OK', null, null),

      ('1', 'controle', 'l''anonyme ne supprime rien', 'anon', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{DA}/logos/{H1}.png' returning 1) select count(*)::text from d$q$,
        'OK', '0', null),
      ('2', 'controle', 'un compte rattaché à rien non plus', 'inconnu', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{DA}/logos/{H1}.png' returning 1) select count(*)::text from d$q$,
        'OK', '0', null),
      ('3', 'controle', 'le client sans case', 'client', 'aucun',
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{DA}/logos/{H1}.png' returning 1) select count(*)::text from d$q$,
        'OK', '0', null),
      ('4', 'controle', 'le client avec « Banque » seul', 'client', 'banque',
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{DA}/logos/{H1}.png' returning 1) select count(*)::text from d$q$,
        'OK', '0', null),
      ('5', 'controle', 'le client avec « Ventes » : il lit et dépose, il ne supprime pas', 'client', 'ventes',
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{DA}/logos/{H1}.png' returning 1) select count(*)::text from d$q$,
        'OK', '0', null),
      ('5b', 'controle', 'avec les deux cases non plus', 'client', 'deux',
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d$q$,
        'OK', '0', null),
      ('6', 'controle', 'un membre du cabinet non affecté', 'membre', 'aucun',
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d$q$,
        'OK', '0', null),
      ('7', 'controle', 'un membre affecté au dossier B, dans B : il n''est pas le chef', 'membre_affecte', 'aucun',
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DB}/%' returning 1) select count(*)::text from d$q$,
        'OK', '0', null),
      ('8', 'controle', 'le chef d''un autre cabinet, qui porte « Ventes » sur ce dossier : il en lit les fichiers, il ne les supprime pas', 'chef_autre', 'ventes',
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d$q$,
        'OK', '0', null),
      ('8b', 'controle', 'le même, sans case', 'chef_autre', 'aucun',
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d$q$,
        'OK', '0', null),
      ('M1', 'mutation', 'le contrôle 8 rejoué par le chef du cabinet des dossiers (non super-administrateur) : il supprime', 'chef_du_cabinet', 'aucun',
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d$q$,
        'OK', '2', null),
      ('M2', 'mutation', 'le contrôle 5 rejoué par le chef (super-administrateur) : il supprime', 'chef', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{DA}/logos/{H1}.png' returning 1) select count(*)::text from d$q$,
        'OK', '1', null),
      ('9', 'controle', 'le chef supprime les fichiers de B', 'chef', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DB}/%' returning 1) select count(*)::text from d$q$,
        'OK', '1', null),
      ('10', 'controle', 'un chemin qui ne commence pas par un dossier : personne, et rien ne lève', 'chef', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like 'essai-logo-sans-dossier/%' returning 1) select count(*)::text from d$q$,
        'OK', '0', null),
      ('11', 'controle', 'sans le réglage de l''API, le stockage refuse à tous, au chef aussi', 'chef', null,
        $q$with d as (delete from storage.objects where bucket_id = 'ventes' and name = '{DA}/logos/{H1}.png' returning 1) select count(*)::text from d$q$,
        '42501', 'Direct deletion from storage tables is not allowed. Use the Storage API instead.', null),
      ('12', 'controle', 'la suppression d''un dossier comme l''application la fait : ses fichiers du seau, puis sa ligne — ni fichier ni version ne restent', 'chef', null,
        $q$select set_config('storage.allow_delete_query', 'true', true)
          §§ with d as (delete from storage.objects where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from d
          §§ with d as (delete from dossiers where id = '{DA}' returning 1) select count(*)::text from d
          §§ select (select count(*) from storage.objects where bucket_id = 'ventes' and name like '{DA}/%') || '/' || (select count(*) from parametres_facturation where dossier_id = '{DA}')$q$,
        'OK', '0/0', null),
      ('13', 'controle', 'le seau ne se supprime pas tant qu''un fichier y reste', 'proprietaire', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.buckets where id = 'ventes' returning 1) select count(*)::text from d$q$,
        '23503', '%objects_bucketId_fkey%', null),
      ('M3', 'mutation', 'le contrôle 13 rejoué le seau vidé : il se supprime', 'proprietaire', null,
        $q$select set_config('storage.allow_delete_query', 'true', true) §§ with d as (delete from storage.objects where bucket_id = 'ventes' returning 1) select count(*)::text from d §§ with d as (delete from storage.buckets where id = 'ventes' returning 1) select count(*)::text from d$q$,
        'OK', '1', null)
    ) as x(num, genre, controle, qui, droits, ordre, code, attendu, cle)
    loop
      if s.droits is not null then
        update memberships set droit_ventes = s.droits in ('ventes', 'deux'), droit_banque = s.droits in ('banque', 'deux')
         where id = (ids ->> 'ACCES')::uuid;
      end if;
      ordre := s.ordre;
      attendu := s.attendu;
      for k in select jsonb_object_keys(ids) loop
        ordre := replace(ordre, '{' || k || '}', ids ->> k);
        attendu := replace(attendu, '{' || k || '}', ids ->> k);
      end loop;
      accepte := false; code_recu := null; message := null; rendu := null;
      begin
        -- Le compte du client, rangé au cabinet le temps de son étape : membre (affecté à B, ou non), chef du cabinet des
        -- dossiers, ou chef d'un cabinet jetable — une sous-transaction annulée l'emporte.
        if s.qui in ('membre', 'membre_affecte') then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
          if s.qui = 'membre_affecte' then
            insert into dossier_assignations (dossier_id, user_id) values ((ids ->> 'DB')::uuid, client);
          end if;
        elsif s.qui = 'chef_du_cabinet' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
        elsif s.qui = 'chef_autre' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, (ids ->> 'CC')::uuid, 'comptable_en_chef');
        end if;
        if s.qui = 'anon' then
          set local role anon;
          perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        elsif s.qui in ('inconnu', 'client', 'chef', 'membre', 'membre_affecte', 'chef_du_cabinet', 'chef_autre') then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub',
            case s.qui when 'inconnu' then inconnu when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
        else
          perform set_config('request.jwt.claims', '', true);
        end if;
        foreach partie in array string_to_array(ordre, '§§') loop
          partie := replace(partie, '{RENDU}', coalesce(rendu, ''));
          if partie ~* '^\s*(insert|update)' and partie !~* 'returning' then
            execute partie;
          else
            execute partie into rendu;
          end if;
        end loop;
        accepte := true;
        if s.genre in ('controle', 'mutation', 'valeur') then
          raise exception 'ANNULATION_ESSAI';
        end if;
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      perform set_config('storage.allow_delete_query', '', true);
      ok := case
        when s.code = 'OK' then accepte and (attendu is null or coalesce(rendu, '') like attendu)
        else not accepte and code_recu = s.code and message like attendu
      end;
      if s.genre = 'jeu' and not ok then
        raise exception 'ESSAI_IMPOSSIBLE : le jeu % n''a pas pu être posé (% %)', s.num, code_recu, message;
      end if;
      if s.genre <> 'jeu' then
        verdicts := verdicts || jsonb_build_object('controle', s.num || '. ' || s.controle, 'genre', s.genre,
          'observe', case when accepte then 'accepté : ' || coalesce(rendu, '—') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
          'ok', ok);
      end if;
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from parametres_facturation)),
    ((select count(*) from storage.objects)), ((select count(*) from storage.buckets)), ((select count(*) from cabinets))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || avant || ' -> ' || apres, 'ok', erreur is null and avant = apres);
  perform set_config('essai.logo_des_factures_suppression', verdicts::text, true);
end
$essai$;

select x.genre, x.controle, x.verdict, x.observe from (
  select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                   else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
  from jsonb_to_recordset(current_setting('essai.logo_des_factures_suppression')::jsonb) as v(controle text, genre text, ok boolean, observe text)
) x
order by x.genre desc, (regexp_match(x.controle, '^M?(\d+)'))[1]::int, x.controle;
