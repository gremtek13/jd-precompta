-- LE LOGO DES FACTURES ET SON SEAU, ÉPROUVÉS EN BASE (espace client, étape A5c1) — à rejouer par `execute_sql` après toute
-- migration qui touche la migration `logo_des_factures`, le seau `ventes` et ses policies, `enregistrer_parametres_facturation`,
-- `parametres_facturation`, `memberships`, `dossiers`, `gere_les_ventes`, `est_chef_du_cabinet` ou `admin_du_dossier`.
--
-- Ce qui se prouve ici, par impersonation — anonyme, compte rattaché à rien, le client de l'essai sans case, avec
-- « Banque » seul, avec « Ventes », avec les deux, sur SON dossier ou sur un autre, un membre du cabinet affecté ou non au
-- dossier, le chef du cabinet (super-administrateur), et le propriétaire de la base :
--   - LE CATALOGUE : le seau, PRIVÉ, ses bornes (500 Kio, PNG et JPEG) ; ses trois policies, `to authenticated`, et leurs
--     prédicats mot pour mot ; AUCUNE policy de mise à jour qui l'atteigne ; les deux colonnes du logo et leurs trois
--     contraintes ; la fonction réécrite, SECURITY DEFINER au chemin fixé, aux mêmes droits, l'accès d'abord, ses vingt-cinq
--     messages dans leur ordre ;
--   - QUI LIT les fichiers du seau : le cabinet du dossier et le client « Ventes », ceux de SON dossier seulement ; personne
--     d'autre — l'anonyme, un compte rattaché à rien, un accès sans case ou « Banque » seul, un membre non affecté — ; un
--     chemin qui ne commence pas par un dossier ne se lit pas et ne fait rien lever ;
--   - QUI DÉPOSE : les mêmes, sous `<dossier>/logos/`, nommé par une empreinte, en `.png` ou `.jpg` — et rien ailleurs, ni
--     sous une autre forme ; un dépôt qui écraserait un fichier déjà là est refusé ;
--   - PERSONNE NE MODIFIE un fichier : une mise à jour ne touche aucune ligne, pour le client comme pour le chef ;
--   - LA SUPPRESSION : la policy, lue au catalogue (le chef du cabinet seul). Une suppression SQL est refusée à tous par le
--     stockage lui-même (`storage.protect_delete`, 42501, comme un refus de policy) : ce qu'elle rencontre se joue sur une
--     réplique, par `logoDesFacturesSuppression.sql`, qui porte des suppressions et ne se joue jamais en production ;
--   - LES REFUS d'`enregistrer_parametres_facturation` sur le logo, chacun sous ses mots, et leur ORDRE (le huitième rang,
--     après le RIB ; en lui, l'ensemble, l'empreinte, le chemin, le dossier, le nom, puis le fichier : présent dans CE seau,
--     du type que dit son nom, sous la borne du seau) ; un logo inchangé qui ne se rejuge pas ; un logo retiré ; le client
--     « Ventes » qui pose un logo, l'accès « Banque » seul qui ne le peut pas ;
--   - LES CONTRAINTES de la table disent ce que la fonction dit, pour ce que la restauration réinsère sans elle ; la garde
--     refuse de changer le logo d'une version ; la confirmation d'un RIB ne le change pas ; le logo n'est pas un changement
--     du RIB (`dernier_changement_de_rib`) ;
--   - et que RIEN ne reste en base.
--
-- ADAPTÉ LE 29/10/2026 À A7-Q3 (migration `iban_hors_des_parametres`, PRÉPARÉE, pas encore en base) : elle ajoute à
-- `enregistrer_parametres_facturation` un neuvième rang, après le logo — un vingt-sixième message. Le contrôle 0g juge
-- les vingt-cinq premiers, inchangés, et 0g2 ce qui suit : rien sans elle, son seul refus avec elle.
--
-- SANS LA MIGRATION `logo_des_factures`, une seule ligne la dit, « EN ATTENTE », SANS être une faute : la migration est
-- présentée au cabinet avant d'être appliquée. Elle EN EST UNE si l'historique des migrations porte `logo_des_factures` sans
-- que le seau ou les colonnes existent — sauf si une ligne `retour_logo_des_factures`, plus récente, dit son retour arrière.
--
-- Tout se joue dans deux dossiers JETABLES du cabinet du chef (A, où le client de l'essai a un accès d'essai ; B, où il n'en
-- a pas), et sur des fichiers d'essai que le propriétaire range dans le seau — des LIGNES de `storage.objects`, sans
-- fichier derrière —, au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) : chaque contrôle
-- dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE avant ; les
-- étapes « fait » sont gardées jusqu'à l'annulation finale, et une étape peut rendre un identifiant que les suivantes citent
-- (`{CLE}`). Un refus se juge à son code ET à son message (`like`). Les comptes de fichiers ne portent que sur les noms du
-- jeu. Les empreintes sont fictives (un chiffre répété soixante-quatre fois). Les verdicts voyagent dans un réglage LOCAL à
-- la transaction (`essai.logo_des_factures`) : le fichier se joue d'un seul appel, ne crée aucune table et ne porte AUCUNE
-- instruction de suppression. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil, un droit ou une cible délibérément faux : chacune
-- doit MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait.
--
-- src/lib/logoDesFactures.test.ts lit les étapes ici : chaque refus du logo que src/lib/parametresFacturation.ts redit
-- avant le clic doit y être exigé de la base, sous les mêmes mots, et chaque appel de l'essai, rejoué dans le module sur les
-- fichiers du jeu, y reçoit le même premier refus, ou aucun.
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
  applique text; retour text;
  verdicts jsonb := '[]'::jsonb;
begin
  -- La migration d'abord : sans elle, une ligne le dit, en faute seulement si l'historique la porte sans retour arrière.
  if not exists (select 1 from storage.buckets where id = 'ventes')
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.parametres_facturation') and attname = 'logo_chemin'
                      and not attisdropped) then
    select max(version) filter (where name = 'logo_des_factures'), max(version) filter (where name = 'retour_logo_des_factures')
      into applique, retour from supabase_migrations.schema_migrations;
    verdicts := verdicts || jsonb_build_object('controle', '0. EN ATTENTE : la migration logo_des_factures (étape A5c1) n''est pas en base',
      'genre', 'controle',
      'observe', 'historique : ' || coalesce('logo_des_factures ' || applique, 'sans logo_des_factures')
                 || coalesce(', retour_logo_des_factures ' || retour, ''),
      'ok', applique is null or (retour is not null and retour > applique));
    perform set_config('essai.logo_des_factures', verdicts::text, true);
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
    'DAU', 'A5C00000-0000-4000-8000-0000000000A1',
    'ACCES', 'a5c00000-0000-4000-8000-0000000000ac', 'INCONNUE', gen_random_uuid(),
    'H1', repeat('1', 64), 'H2', repeat('2', 64), 'H3', repeat('3', 64), 'H4', repeat('4', 64), 'H5', repeat('5', 64),
    'H6', repeat('6', 64), 'H7', repeat('7', 64), 'H8', repeat('8', 64), 'H9', repeat('9', 64), 'HA', repeat('a', 64),
    'HB', repeat('b', 64), 'HC', repeat('c', 64), 'HD', repeat('d', 64), 'HE', repeat('e', 64), 'HF', repeat('f', 64),
    'HU', repeat('A', 64));

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from parametres_facturation)),
    ((select count(*) from storage.objects)), ((select count(*) from storage.buckets))
  ) as t(n);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre(s), code attendu ou OK, message ou valeur attendus, clé)
      -- genre : « jeu » (posé par le propriétaire, gardé), « controle » (annulé), « fait » (gardé), « valeur » (lecture
      -- par le propriétaire), « mutation » (un contrôle rejoué à faux, qui doit rendre l'inverse). Plusieurs ordres se
      -- séparent par « §§ » ; {RENDU} y vaut ce que le précédent a rendu ; la clé garde ce que l'étape a rendu.
      -- qui : anon, inconnu, client, chef, proprietaire, membre (le compte du client rangé au cabinet, non affecté),
      -- membre_affecte (le même, affecté au dossier B). Les étapes du membre posent un accès sans case.
      -- Les fichiers que chacun voit : ceux de A / ceux de B / celui dont le chemin ne commence pas par un dossier.

      -- ══ Le jeu : deux dossiers jetables, un accès d'essai sans droit, des fichiers d'essai dans le seau ══════════
      -- A naît basculé : « Ventes » ne se porte que sur un accès d'un dossier dont les factures sont la source de leurs
      -- ventes (garder_droit_ventes, étape VF8f) ; le seau et ses logos n'en dépendent pas.
      ('j1', 'jeu', 'dossiers jetables A et B', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, ventes_par_les_factures) values
          ('{DA}', 'ESSAI LOGO A', '{CAB}', 'redevable', true, true), ('{DB}', 'ESSAI LOGO B', '{CAB}', 'redevable', true, false)$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-logo@exemple.invalid')$q$, 'OK', null, null),
      ('j3', 'jeu', 'les fichiers d''essai : huit logos et un autre fichier dans A, un logo dans B, un chemin sans dossier, un logo rangé dans le seau des pièces et un pack dans celui des packs', 'proprietaire', null,
        $q$insert into storage.objects (bucket_id, name, metadata) values
          ('ventes', '{DA}/logos/{H1}.png', '{"size": 1000, "mimetype": "image/png"}'),
          ('ventes', '{DA}/logos/{H2}.jpg', '{"size": 512000, "mimetype": "image/jpeg"}'),
          ('ventes', '{DA}/logos/{H3}.png', '{"size": 512001, "mimetype": "image/png"}'),
          ('ventes', '{DA}/logos/{H4}.png', '{"size": 1000, "mimetype": "image/jpeg"}'),
          ('ventes', '{DA}/logos/{H5}.png', '{"size": 1000, "mimetype": "image/webp"}'),
          ('ventes', '{DA}/logos/{H6}.png', null),
          ('ventes', '{DA}/logos/{H7}.png', '{"size": 1000, "mimetype": "IMAGE/PNG; charset=binary"}'),
          ('ventes', '{DA}/logos/{HF}.png', '{"size": 600000, "mimetype": "image/gif"}'),
          ('ventes', '{DA}/autre/{H8}.pdf', '{"size": 10, "mimetype": "application/pdf"}'),
          ('ventes', '{DB}/logos/{H9}.png', '{"size": 1000, "mimetype": "image/png"}'),
          ('ventes', 'essai-logo-sans-dossier/logos/{H1}.png', '{"size": 1000, "mimetype": "image/png"}'),
          ('pieces', '{DA}/logos/{HA}.png', '{"size": 1000, "mimetype": "image/png"}'),
          ('packs', '{DA}/essai-logo/pack.zip', '{"size": 10, "mimetype": "application/zip"}')$q$, 'OK', null, null),

      -- ══ 0. Le catalogue ══════════
      ('0a', 'valeur', 'le seau : privé, 500 Kio, PNG et JPEG', 'proprietaire', null,
        $q$select b.id || ':' || b.public || ':' || b.file_size_limit || ':' || array_to_string(b.allowed_mime_types, ',') from storage.buckets b where b.id = 'ventes'$q$,
        'OK', 'ventes:false:512000:image/png,image/jpeg', null),
      ('0b', 'valeur', 'les trois policies du seau, aux connectés : lecture, dépôt, suppression ; permissives', 'proprietaire', null,
        $q$select string_agg(p.polname || '/' || p.polcmd::text || '/' || p.polpermissive || '/' || array_to_string(p.polroles::regrole[]::text[], ','), ',' order by p.polname)
             from pg_policy p where p.polrelid = 'storage.objects'::regclass
              and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) like '%''ventes''%'$q$,
        'OK', 'ventes_depot_d_un_logo/a/true/authenticated,ventes_lecture/r/true/authenticated,ventes_suppression_par_le_chef/d/true/authenticated', null),
      ('0c', 'valeur', 'leurs prédicats, mot pour mot : la forme du chemin d''abord, puis les ventes du dossier — le chef pour supprimer', 'proprietaire', null,
        $q$select string_agg(p.polname || '=' || regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), '\s+', ' ', 'g'), ' ; ' order by p.polname)
             from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname like 'ventes\_%'$q$,
        'OK', 'ventes_depot_d_un_logo=|((bucket_id = ''ventes''::text) AND CASE WHEN (name ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logos/[0-9a-f]{64}\\.(png|jpg)$''::text) THEN gere_les_ventes(((storage.foldername(name))[1])::uuid) ELSE false END) ; ventes_lecture=((bucket_id = ''ventes''::text) AND CASE WHEN (name ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/''::text) THEN gere_les_ventes(((storage.foldername(name))[1])::uuid) ELSE false END)| ; ventes_suppression_par_le_chef=((bucket_id = ''ventes''::text) AND CASE WHEN (name ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/''::text) THEN (EXISTS ( SELECT 1 FROM dossiers d WHERE ((d.id = ((storage.foldername(objects.name))[1])::uuid) AND est_chef_du_cabinet(d.cabinet_id)))) ELSE false END)|', null),
      ('0d', 'valeur', 'aucune policy de mise à jour, ni « pour tout », n''atteint le seau : un fichier ne s''y modifie jamais', 'proprietaire', null,
        $q$select count(*)::text from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polcmd in ('w', '*')
              and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) !~ 'bucket_id = ''(pieces|packs|cabinet-logos)''::text'$q$,
        'OK', '0', null),
      ('0e', 'valeur', 'les deux colonnes du logo, facultatives, et leurs trois contraintes', 'proprietaire', null,
        $q$select (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
                     from pg_attribute a where a.attrelid = 'public.parametres_facturation'::regclass and a.attname like 'logo%' and not a.attisdropped)
               || ' ; ' || (select string_agg(co.conname || '=' || pg_get_constraintdef(co.oid), ' ; ' order by co.conname)
                     from pg_constraint co where co.conrelid = 'public.parametres_facturation'::regclass and co.conname like '%logo%')$q$,
        'OK', 'logo_chemin:text,logo_sha256:text ; parametres_facturation_logo_chemin_forme=CHECK (((logo_chemin = ((((dossier_id)::text || ''/logos/''::text) || logo_sha256) || ''.png''::text)) OR (logo_chemin = ((((dossier_id)::text || ''/logos/''::text) || logo_sha256) || ''.jpg''::text)))) ; parametres_facturation_logo_entier=CHECK (((logo_chemin IS NULL) = (logo_sha256 IS NULL))) ; parametres_facturation_logo_sha256_forme=CHECK ((logo_sha256 ~ ''^[0-9a-f]{64}$''::text))', null),
      ('0f', 'valeur', 'la fonction : security definer, chemin fixé, ni anon ni PUBLIC ne l''exécutent ; l''accès d''abord', 'proprietaire', null,
        $q$select p.prosecdef || ' ' || array_to_string(p.proconfig, ',') || ' anon ' || has_function_privilege('anon', p.oid, 'execute')
               || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
               || ' public ' || exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
               || ' |' || regexp_replace(split_part(split_part(replace(p.prosrc, E'\r\n', E'\n'), E'\nbegin\n', 2), ';', 1), '\s+', ' ', 'g')
             from pg_proc p where p.oid = 'public.enregistrer_parametres_facturation(uuid, uuid, jsonb)'::regprocedure$q$,
        'OK', 'true search_path=public anon false authenticated true public false | if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then raise exception ''Accès refusé à ce dossier.'' using errcode = ''42501''', null),
      ('0g', 'valeur', 'ses vingt-cinq premiers messages : les dix-sept d''A5a, à l''identique et dans leur ordre, puis les huit du logo (empreinte des messages)', 'proprietaire', null,
        $q$select count(*) || ' ' || md5(string_agg(m[1], '|' order by n))
             from pg_proc p, regexp_matches(p.prosrc, 'raise exception ''((?:[^'']|'''')*)''', 'g') with ordinality as r(m, n)
            where p.oid = 'public.enregistrer_parametres_facturation(uuid, uuid, jsonb)'::regprocedure and r.n <= 25$q$,
        'OK', '25 dfc28d5f1bb8f8965fd0c64da2687623', null),
      ('0g2', 'valeur', 'puis rien, ou, la migration iban_hors_des_parametres appliquée (A7-Q3), le seul refus de son neuvième rang', 'proprietaire', null,
        $q$select (case when strpos(min(p.prosrc), 'porte_un_iban(') > 0
                     then count(*) = 26 and max(m[1]) filter (where r.n = 26) = 'Un IBAN figure dans % : sur une facture, un IBAN ne s''''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.'
                     else count(*) = 25 end)::text
             from pg_proc p, regexp_matches(p.prosrc, 'raise exception ''((?:[^'']|'''')*)''', 'g') with ordinality as r(m, n)
            where p.oid = 'public.enregistrer_parametres_facturation(uuid, uuid, jsonb)'::regprocedure$q$,
        'OK', 'true', null),
      ('0h', 'valeur', 'la liste des champs d''une version : ceux d''A5a, puis le chemin et l''empreinte du logo', 'proprietaire', null,
        $q$select regexp_replace((regexp_match(p.prosrc, 'where k not in \(([^)]*)\)'))[1], '\s+', ' ', 'g')
             from pg_proc p where p.oid = 'public.enregistrer_parametres_facturation(uuid, uuid, jsonb)'::regprocedure$q$,
        'OK', '''delai_paiement_jours'', ''moyen_prefere'', ''escompte'', ''penalites'', ''mentions_complementaires'', ''pied_de_page'', ''iban'', ''bic'', ''titulaire_compte'', ''logo_chemin'', ''logo_sha256''', null),

      -- ══ 1 à 10. Qui lit les fichiers du seau ══════════
      ('1', 'controle', 'l''anonyme ne lit aucun fichier du seau', 'anon', null,
        $q$select count(*) filter (where o.name like '{DA}/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-logo-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/0/0', null),
      ('M1', 'mutation', 'le contrôle 1 rejoué sous le chef : il lit', 'chef', null,
        $q$select count(*) filter (where o.name like '{DA}/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-logo-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '9/1/0', null),
      ('2', 'controle', 'un compte rattaché à rien non plus', 'inconnu', null,
        $q$select count(*) filter (where o.name like '{DA}/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-logo-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/0/0', null),
      ('3', 'controle', 'le client sans case : rien, pas même de son dossier', 'client', 'aucun',
        $q$select count(*) filter (where o.name like '{DA}/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-logo-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/0/0', null),
      ('M2', 'mutation', 'le contrôle 3 rejoué avec « Ventes » : il lit son dossier', 'client', 'ventes',
        $q$select count(*) filter (where o.name like '{DA}/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-logo-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '9/0/0', null),
      ('4', 'controle', 'le client avec « Banque » seul : rien', 'client', 'banque',
        $q$select count(*) filter (where o.name like '{DA}/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-logo-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/0/0', null),
      ('5', 'controle', 'le client avec « Ventes » : tous les fichiers de son dossier, logos et autres, aucun d''un autre — et le chemin sans dossier ne fait rien lever', 'client', 'ventes',
        $q$select count(*) filter (where o.name like '{DA}/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-logo-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '9/0/0', null),
      ('5b', 'controle', 'avec les deux cases : de même', 'client', 'deux',
        $q$select count(*) filter (where o.name like '{DA}/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-logo-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '9/0/0', null),
      ('6', 'controle', 'un membre du cabinet non affecté : rien', 'membre', 'aucun',
        $q$select count(*) filter (where o.name like '{DA}/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-logo-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/0/0', null),
      ('7', 'controle', 'un membre affecté au dossier B : les fichiers de B seulement', 'membre_affecte', 'aucun',
        $q$select count(*) filter (where o.name like '{DA}/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-logo-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/1/0', null),
      ('8', 'controle', 'le chef : tous les fichiers de ses dossiers ; le chemin sans dossier, personne', 'chef', null,
        $q$select count(*) filter (where o.name like '{DA}/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-logo-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '9/1/0', null),
      ('9', 'valeur', 'le jeu est bien là : le propriétaire voit tout', 'proprietaire', null,
        $q$select count(*) filter (where o.name like '{DA}/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-logo-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '9/1/1', null),
      ('10', 'controle', 'le client « Ventes » ne lit pas, par ce seau, le logo rangé dans le seau des pièces', 'client', 'ventes',
        $q$select count(*)::text from storage.objects o where o.bucket_id = 'ventes' and o.name = '{DA}/logos/{HA}.png'$q$,
        'OK', '0', null),
      ('10b', 'controle', 'ni, par ces policies, un fichier d''un autre seau : le pack de son dossier reste au cabinet', 'client', 'ventes',
        $q$select count(*)::text from storage.objects o where o.bucket_id = 'packs' and o.name like '{DA}/%'$q$,
        'OK', '0', null),
      ('M11', 'mutation', 'le contrôle 10b rejoué par le chef : il lit le pack', 'chef', null,
        $q$select count(*)::text from storage.objects o where o.bucket_id = 'packs' and o.name like '{DA}/%'$q$,
        'OK', '1', null),

      -- ══ 11 à 25. Qui dépose ══════════
      ('11', 'controle', 'l''anonyme ne dépose pas', 'anon', null,
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('12', 'controle', 'un compte rattaché à rien non plus', 'inconnu', null,
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('13', 'controle', 'le client sans case, dans son dossier', 'client', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('14', 'controle', 'le client avec « Banque » seul', 'client', 'banque',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('M3', 'mutation', 'le contrôle 14 rejoué avec « Ventes » : il dépose', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        'OK', null, null),
      ('15', 'controle', 'le client avec « Ventes » dépose un logo dans son dossier, en PNG', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        'OK', null, null),
      ('15b', 'controle', 'en JPEG', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.jpg', '{"size": 10, "mimetype": "image/jpeg"}')$q$,
        'OK', null, null),
      ('16', 'controle', 'le client avec « Ventes », dans un dossier où il n''a pas d''accès', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/logos/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('M4', 'mutation', 'le contrôle 16 rejoué dans son dossier : il dépose', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        'OK', null, null),
      ('17', 'controle', 'hors de logos/, dans son dossier', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/autre/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('17b', 'controle', 'sous logos/, dans un sous-dossier', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/x/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('17c', 'controle', 'à la racine de son dossier', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('18', 'controle', 'un nom qui n''est pas une empreinte : soixante-trois chiffres', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/' || repeat('b', 63) || '.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('18b', 'controle', 'une empreinte en majuscules', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HU}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('18c', 'controle', 'un dossier en majuscules', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DAU}/logos/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('19', 'controle', 'un SVG', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.svg', '{"size": 10, "mimetype": "image/svg+xml"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('19b', 'controle', 'un WebP', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.webp', '{"size": 10, "mimetype": "image/webp"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('19c', 'controle', 'l''extension « .jpeg »', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.jpeg', '{"size": 10, "mimetype": "image/jpeg"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('19d', 'controle', 'un chemin sans dossier', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', 'logos/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('20', 'controle', 'un membre non affecté, dans A', 'membre', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('21', 'controle', 'un membre affecté au dossier B, dans B', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/logos/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        'OK', null, null),
      ('22', 'controle', 'le chef, dans A', 'chef', null,
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.png', '{"size": 10, "mimetype": "image/png"}')$q$,
        'OK', null, null),
      ('23', 'controle', 'un dépôt qui écraserait un logo déjà là, par le client « Ventes » : refusé', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{H1}.png', '{"size": 20, "mimetype": "image/png"}')$q$,
        '23505', 'duplicate key value violates unique constraint%', null),
      ('23b', 'controle', 'par le chef non plus', 'chef', null,
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{H1}.png', '{"size": 20, "mimetype": "image/png"}')$q$,
        '23505', 'duplicate key value violates unique constraint%', null),
      ('M5', 'mutation', 'le contrôle 23 rejoué sous un autre nom : il dépose', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HC}.png', '{"size": 20, "mimetype": "image/png"}')$q$,
        'OK', null, null),

      -- ══ 24 à 27. Personne ne modifie un fichier ══════════
      ('24', 'controle', 'le client « Ventes » ne change pas un fichier de son dossier : aucune ligne touchée', 'client', 'ventes',
        $q$with u as (update storage.objects set metadata = '{"size": 20, "mimetype": "image/png"}' where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from u$q$,
        'OK', '0', null),
      ('25', 'controle', 'ni ne le renomme', 'client', 'ventes',
        $q$with u as (update storage.objects set name = '{DA}/logos/{HD}.png' where bucket_id = 'ventes' and name = '{DA}/logos/{H1}.png' returning 1) select count(*)::text from u$q$,
        'OK', '0', null),
      ('26', 'controle', 'le chef non plus', 'chef', null,
        $q$with u as (update storage.objects set metadata = '{"size": 20, "mimetype": "image/png"}' where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from u$q$,
        'OK', '0', null),
      ('M6', 'mutation', 'le contrôle 26 rejoué par le propriétaire : les lignes sont bien là', 'proprietaire', null,
        $q$with u as (update storage.objects set metadata = '{"size": 20, "mimetype": "image/png"}' where bucket_id = 'ventes' and name like '{DA}/%' returning 1) select count(*)::text from u$q$,
        'OK', '9', null),

      -- ══ 30 à 59. Ce que la fonction juge du logo ══════════
      ('30', 'fait', 'le chef enregistre la première version de A, sans logo', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', null, '{"delai_paiement_jours": 30}'::jsonb) p$q$,
        'OK', null, 'V1'),
      ('30b', 'valeur', 'elle ne porte aucun logo', 'proprietaire', null,
        $q$select coalesce(logo_chemin, 'nul') || '|' || coalesce(logo_sha256, 'nul') from parametres_facturation where id = '{V1}'$q$,
        'OK', 'nul|nul', null),
      ('31', 'controle', 'le chemin sans l''empreinte', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H1}.png"}'::jsonb) p$q$,
        '22023', 'Le logo se donne par son chemin et son empreinte, ensemble.', null),
      ('31b', 'controle', 'l''empreinte sans le chemin', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_sha256": "{H1}"}'::jsonb) p$q$,
        '22023', 'Le logo se donne par son chemin et son empreinte, ensemble.', null),
      ('31c', 'controle', 'un chemin nul et une empreinte', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": null, "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '22023', 'Le logo se donne par son chemin et son empreinte, ensemble.', null),
      ('31d', 'controle', 'les deux nuls : aucun logo, la version passe', 'chef', null,
        $q$select coalesce(p.logo_chemin, 'nul') from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": null, "logo_sha256": null}'::jsonb) p$q$,
        'OK', 'nul', null),
      ('32', 'controle', 'une empreinte en majuscules', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{HU}.png", "logo_sha256": "{HU}"}'::jsonb) p$q$,
        '22023', 'L''empreinte du logo est son SHA-256 : soixante-quatre chiffres hexadécimaux, en minuscules.', null),
      ('32b', 'controle', 'une empreinte de soixante-trois chiffres', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', jsonb_build_object('logo_chemin', '{DA}/logos/{H1}.png', 'logo_sha256', repeat('1', 63))) p$q$,
        '22023', 'L''empreinte du logo est son SHA-256 : soixante-quatre chiffres hexadécimaux, en minuscules.', null),
      ('32c', 'controle', 'une empreinte qui est un nombre', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": 1}'::jsonb) p$q$,
        '22023', 'L''empreinte du logo est son SHA-256 : soixante-quatre chiffres hexadécimaux, en minuscules.', null),
      ('33', 'controle', 'un chemin hors de logos/', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '22023', 'Le chemin du logo s''écrit « dossier/logos/empreinte.png » ou « .jpg » : l''identifiant du dossier, puis l''empreinte du fichier, en minuscules.', null),
      ('33b', 'controle', 'un chemin en « .jpeg »', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H1}.jpeg", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '22023', 'Le chemin du logo s''écrit « dossier/logos/empreinte.png » ou « .jpg » : l''identifiant du dossier, puis l''empreinte du fichier, en minuscules.', null),
      ('33c', 'controle', 'un SVG', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H1}.svg", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '22023', 'Le chemin du logo s''écrit « dossier/logos/empreinte.png » ou « .jpg » : l''identifiant du dossier, puis l''empreinte du fichier, en minuscules.', null),
      ('33d', 'controle', 'le dossier en majuscules', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DAU}/logos/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '22023', 'Le chemin du logo s''écrit « dossier/logos/empreinte.png » ou « .jpg » : l''identifiant du dossier, puis l''empreinte du fichier, en minuscules.', null),
      ('33e', 'controle', 'un chemin qui commence par « / »', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "/{DA}/logos/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '22023', 'Le chemin du logo s''écrit « dossier/logos/empreinte.png » ou « .jpg » : l''identifiant du dossier, puis l''empreinte du fichier, en minuscules.', null),
      ('33f', 'controle', 'un chemin qui est un nombre', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": 1, "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '22023', 'Le chemin du logo s''écrit « dossier/logos/empreinte.png » ou « .jpg » : l''identifiant du dossier, puis l''empreinte du fichier, en minuscules.', null),
      ('34', 'controle', 'le logo d''un autre dossier', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DB}/logos/{H9}.png", "logo_sha256": "{H9}"}'::jsonb) p$q$,
        '22023', 'Le logo est un fichier d''un autre dossier.', null),
      ('M7', 'mutation', 'le contrôle 34 rejoué avec le logo de B, dans B : il passe', 'chef', null,
        $q$select p.logo_sha256 from public.enregistrer_parametres_facturation('{DB}', null, '{"logo_chemin": "{DB}/logos/{H9}.png", "logo_sha256": "{H9}"}'::jsonb) p$q$,
        'OK', '{H9}', null),
      ('35', 'controle', 'un nom de fichier qui n''est pas l''empreinte', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": "{H2}"}'::jsonb) p$q$,
        '22023', 'Le nom du fichier du logo n''est pas son empreinte.', null),
      ('36', 'controle', 'un logo absent du seau', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{HB}.png", "logo_sha256": "{HB}"}'::jsonb) p$q$,
        '22023', 'Le logo n''est pas dans le seau des ventes du dossier : le déposer d''abord.', null),
      ('M8', 'mutation', 'le contrôle 36 rejoué avec un logo déposé : il passe', 'chef', null,
        $q$select p.logo_sha256 from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        'OK', '{H1}', null),
      ('36b', 'controle', 'un logo rangé dans le seau des pièces, et non dans celui des ventes : absent', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{HA}.png", "logo_sha256": "{HA}"}'::jsonb) p$q$,
        '22023', 'Le logo n''est pas dans le seau des ventes du dossier : le déposer d''abord.', null),
      ('36c', 'controle', 'un logo déposé en PNG, désigné en « .jpg » : absent — le nom est le chemin', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H1}.jpg", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '22023', 'Le logo n''est pas dans le seau des ventes du dossier : le déposer d''abord.', null),
      ('37', 'controle', 'un fichier rangé en JPEG sous un nom en « .png »', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H4}.png", "logo_sha256": "{H4}"}'::jsonb) p$q$,
        '22023', 'Le fichier du logo n''est pas une image PNG ou JPEG du type que dit son nom.', null),
      ('37b', 'controle', 'un fichier rangé en WebP', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H5}.png", "logo_sha256": "{H5}"}'::jsonb) p$q$,
        '22023', 'Le fichier du logo n''est pas une image PNG ou JPEG du type que dit son nom.', null),
      ('37c', 'controle', 'un fichier sans métadonnées : pas de type', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H6}.png", "logo_sha256": "{H6}"}'::jsonb) p$q$,
        '22023', 'Le fichier du logo n''est pas une image PNG ou JPEG du type que dit son nom.', null),
      ('37d', 'controle', 'un type rangé en majuscules, avec un paramètre : il se lit sans eux, et passe', 'chef', null,
        $q$select p.logo_sha256 from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H7}.png", "logo_sha256": "{H7}"}'::jsonb) p$q$,
        'OK', '{H7}', null),
      ('37e', 'fait', 'le seau n''admet plus que le PNG (le propriétaire le règle ainsi)', 'proprietaire', null,
        $q$update storage.buckets set allowed_mime_types = array['image/png'] where id = 'ventes'$q$,
        'OK', null, null),
      ('37f', 'controle', 'un JPEG que le seau n''admet plus : le type que le catalogue dit, pas recopié', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H2}.jpg", "logo_sha256": "{H2}"}'::jsonb) p$q$,
        '22023', 'Le fichier du logo n''est pas une image PNG ou JPEG du type que dit son nom.', null),
      ('37g', 'fait', 'le propriétaire rend au seau ses deux types', 'proprietaire', null,
        $q$update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg'] where id = 'ventes'$q$,
        'OK', null, null),
      ('38', 'controle', 'un fichier d''un octet au-delà de la borne du seau', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H3}.png", "logo_sha256": "{H3}"}'::jsonb) p$q$,
        '22023', 'Le fichier du logo pèse plus que les 512000 octets que le seau des ventes admet.', null),
      ('38b', 'controle', 'un JPEG à la borne exacte : il passe', 'chef', null,
        $q$select p.logo_chemin from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H2}.jpg", "logo_sha256": "{H2}"}'::jsonb) p$q$,
        'OK', '{DA}/logos/{H2}.jpg', null),
      ('38c', 'fait', 'la borne du seau abaissée à 999 octets (le propriétaire la règle ainsi)', 'proprietaire', null,
        $q$update storage.buckets set file_size_limit = 999 where id = 'ventes'$q$,
        'OK', null, null),
      ('38d', 'controle', 'un logo de 1 000 octets : la borne que le catalogue dit, pas recopiée', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '22023', 'Le fichier du logo pèse plus que les 999 octets que le seau des ventes admet.', null),
      ('38e', 'fait', 'le propriétaire rend au seau sa borne', 'proprietaire', null,
        $q$update storage.buckets set file_size_limit = 512000 where id = 'ventes'$q$,
        'OK', null, null),
      ('39', 'controle', 'l''ordre : le délai (rang 5) avant le logo', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"delai_paiement_jours": 99, "logo_chemin": "{DA}/logos/{H1}.png"}'::jsonb) p$q$,
        '22023', 'Le délai de paiement est un nombre entier de jours, de 0 à 60.', null),
      ('39b', 'controle', 'l''ordre : la clé de l''IBAN (rang 7) avant le logo', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"iban": "FR9499999000010000000000100", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '22023', 'L''IBAN ne passe pas sa clé de contrôle : une erreur de saisie, sans doute.', null),
      ('39c', 'controle', 'l''ordre : un champ inconnu (rang 3) avant le logo', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo": "{DA}/logos/{H1}.png", "logo_sha256": 1}'::jsonb) p$q$,
        '22023', 'Le champ « logo » n''est pas un paramètre de facturation.', null),
      ('39d', 'controle', 'l''ordre, dans le logo : l''empreinte avant le chemin', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "x", "logo_sha256": "y"}'::jsonb) p$q$,
        '22023', 'L''empreinte du logo est son SHA-256 : soixante-quatre chiffres hexadécimaux, en minuscules.', null),
      ('39e', 'controle', 'l''ordre, dans le logo : l''autre dossier avant le nom', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DB}/logos/{H9}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '22023', 'Le logo est un fichier d''un autre dossier.', null),
      ('39f', 'controle', 'l''ordre, dans le logo : le nom avant le fichier', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{HB}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '22023', 'Le nom du fichier du logo n''est pas son empreinte.', null),
      ('39g', 'controle', 'l''ordre, dans le logo : le type avant le poids', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{HF}.png", "logo_sha256": "{HF}"}'::jsonb) p$q$,
        '22023', 'Le fichier du logo n''est pas une image PNG ou JPEG du type que dit son nom.', null),
      ('40', 'controle', 'l''accès d''abord : le client avec « Banque » seul, un logo déposé', 'client', 'banque',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('M9', 'mutation', 'le contrôle 40 rejoué avec « Ventes » : il pose le logo', 'client', 'ventes',
        $q$select p.logo_sha256 from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        'OK', '{H1}', null),
      ('40b', 'controle', 'le client sans case', 'client', 'aucun',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('40c', 'controle', 'un membre non affecté', 'membre', 'aucun',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('40d', 'controle', 'un compte rattaché à rien', 'inconnu', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('40e', 'controle', 'l''anonyme : le droit d''exécution', 'anon', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '42501', 'permission denied for function enregistrer_parametres_facturation', null),
      ('41', 'controle', 'un membre affecté au dossier B y pose le logo de B', 'membre_affecte', 'aucun',
        $q$select p.logo_sha256 from public.enregistrer_parametres_facturation('{DB}', null, '{"logo_chemin": "{DB}/logos/{H9}.png", "logo_sha256": "{H9}"}'::jsonb) p$q$,
        'OK', '{H9}', null),

      -- ══ 50 à 59. Le logo posé, inchangé, changé, retiré ══════════
      ('50', 'fait', 'le chef pose le logo de A', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"delai_paiement_jours": 30, "logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        'OK', null, 'V2'),
      ('50b', 'valeur', 'la version porte le chemin et l''empreinte, et son auteur', 'proprietaire', null,
        $q$select logo_chemin || '|' || logo_sha256 || '|' || (auteur = '{CHEF}') || '|' || (remplace_id = '{V1}') from parametres_facturation where id = '{V2}'$q$,
        'OK', '{DA}/logos/{H1}.png|{H1}|true|true', null),
      ('50c', 'controle', 'un logo n''est pas un changement du RIB', 'chef', null,
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$,
        'OK', '{"changement": null}', null),
      ('51', 'fait', 'le fichier du logo posé pèse désormais plus que la borne (le propriétaire le range ainsi)', 'proprietaire', null,
        $q$update storage.objects set metadata = '{"size": 600000, "mimetype": "image/png"}' where bucket_id = 'ventes' and name = '{DA}/logos/{H1}.png'$q$,
        'OK', null, null),
      ('52', 'controle', 'un logo INCHANGÉ ne se rejuge pas : le délai changé, la version passe', 'chef', null,
        $q$select p.logo_sha256 || '|' || p.delai_paiement_jours from public.enregistrer_parametres_facturation('{DA}', '{V2}', '{"delai_paiement_jours": 45, "logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        'OK', '{H1}|45', null),
      ('M10', 'mutation', 'le même fichier, désigné par une version qui ne le portait pas : il se juge, et pèse trop', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V2}', '{"delai_paiement_jours": 45}'::jsonb) p §§ select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{RENDU}', '{"delai_paiement_jours": 45, "logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        '22023', 'Le fichier du logo pèse plus que les 512000 octets que le seau des ventes admet.', null),
      ('53', 'fait', 'le propriétaire rend au fichier son poids', 'proprietaire', null,
        $q$update storage.objects set metadata = '{"size": 1000, "mimetype": "image/png"}' where bucket_id = 'ventes' and name = '{DA}/logos/{H1}.png'$q$,
        'OK', null, null),
      ('53b', 'fait', 'le fichier du logo posé quitte le seau (le propriétaire le renomme)', 'proprietaire', null,
        $q$update storage.objects set name = '{DA}/logos/{HD}.png' where bucket_id = 'ventes' and name = '{DA}/logos/{H1}.png'$q$,
        'OK', null, null),
      ('54', 'controle', 'un logo inchangé dont le fichier n''est plus dans le seau : la version passe aussi', 'chef', null,
        $q$select p.logo_sha256 from public.enregistrer_parametres_facturation('{DA}', '{V2}', '{"delai_paiement_jours": 50, "logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": "{H1}"}'::jsonb) p$q$,
        'OK', '{H1}', null),
      ('54b', 'fait', 'le propriétaire rend au fichier son nom', 'proprietaire', null,
        $q$update storage.objects set name = '{DA}/logos/{H1}.png' where bucket_id = 'ventes' and name = '{DA}/logos/{HD}.png'$q$,
        'OK', null, null),
      ('55', 'fait', 'le client « Ventes » change le logo : un autre fichier, en JPEG', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V2}', '{"delai_paiement_jours": 30, "logo_chemin": "{DA}/logos/{H2}.jpg", "logo_sha256": "{H2}"}'::jsonb) p$q$,
        'OK', null, 'V3'),
      ('55b', 'valeur', 'la version porte le logo nouveau, et son auteur est le client ; la version d''avant garde le sien', 'proprietaire', null,
        $q$select v3.logo_chemin || '|' || (v3.auteur = '{CLIENT}') || '|' || v2.logo_sha256 from parametres_facturation v2, parametres_facturation v3 where v2.id = '{V2}' and v3.id = '{V3}'$q$,
        'OK', '{DA}/logos/{H2}.jpg|true|{H1}', null),
      ('56', 'fait', 'le client « Ventes » retire le logo : une version qui ne le porte plus', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V3}', '{"delai_paiement_jours": 30}'::jsonb) p$q$,
        'OK', null, 'V4'),
      ('56b', 'valeur', 'la version retirée n''a plus de logo ; les fichiers restent dans le seau', 'proprietaire', null,
        $q$select coalesce(v4.logo_chemin, 'nul') || '|' || (select count(*) from storage.objects o where o.bucket_id = 'ventes' and o.name in ('{DA}/logos/{H1}.png', '{DA}/logos/{H2}.jpg'))
             from parametres_facturation v4 where v4.id = '{V4}'$q$,
        'OK', 'nul|2', null),
      ('57', 'fait', 'le client « Ventes » repose le premier logo et propose un RIB', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V4}', '{"logo_chemin": "{DA}/logos/{H1}.png", "logo_sha256": "{H1}", "iban": "FR9399999000010000000000100"}'::jsonb) p$q$,
        'OK', null, 'V5'),
      ('57b', 'controle', 'le chef confirme le RIB : le logo ne bouge pas', 'chef', null,
        $q$select p.rib_etat || '|' || p.logo_chemin || '|' || p.logo_sha256 from public.confirmer_rib('{DA}', '{V5}') p$q$,
        'OK', 'confirme|{DA}/logos/{H1}.png|{H1}', null),
      ('58', 'controle', 'la garde : même le propriétaire ne change pas le logo d''une version', 'proprietaire', null,
        $q$update parametres_facturation set logo_chemin = '{DA}/logos/{H2}.jpg', logo_sha256 = '{H2}' where id = '{V5}'$q$,
        '23514', 'Une version des paramètres de facturation ne se modifie pas%', null),
      ('58b', 'controle', 'ni sur la version courante, en confirmant le RIB d''un même geste', 'proprietaire', null,
        $q$update parametres_facturation set rib_etat = 'confirme', rib_confirme_par = '{CHEF}', rib_confirme_le = now(), logo_chemin = null, logo_sha256 = null where id = '{V5}'$q$,
        '23514', 'Une version des paramètres de facturation ne se modifie pas%', null),

      -- ══ 60 à 66. Les contraintes, pour ce que la restauration réinsère sans la fonction ══════════
      ('60', 'controle', 'un chemin sans empreinte', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, auteur, logo_chemin) values ('{DB}', '{CHEF}', '{DB}/logos/{H9}.png')$q$,
        '23514', '%parametres_facturation_logo_entier%', null),
      ('60b', 'controle', 'une empreinte sans chemin', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, auteur, logo_sha256) values ('{DB}', '{CHEF}', '{H9}')$q$,
        '23514', '%parametres_facturation_logo_entier%', null),
      ('61', 'controle', 'une empreinte en majuscules', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, auteur, logo_chemin, logo_sha256) values ('{DB}', '{CHEF}', '{DB}/logos/{HU}.png', '{HU}')$q$,
        '23514', '%parametres_facturation_logo_sha256_forme%', null),
      ('62', 'controle', 'le chemin d''un autre dossier', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, auteur, logo_chemin, logo_sha256) values ('{DB}', '{CHEF}', '{DA}/logos/{H1}.png', '{H1}')$q$,
        '23514', '%parametres_facturation_logo_chemin_forme%', null),
      ('62b', 'controle', 'un chemin en « .jpeg »', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, auteur, logo_chemin, logo_sha256) values ('{DB}', '{CHEF}', '{DB}/logos/{H9}.jpeg', '{H9}')$q$,
        '23514', '%parametres_facturation_logo_chemin_forme%', null),
      ('62c', 'controle', 'un nom qui n''est pas l''empreinte', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, auteur, logo_chemin, logo_sha256) values ('{DB}', '{CHEF}', '{DB}/logos/{H9}.png', '{H8}')$q$,
        '23514', '%parametres_facturation_logo_chemin_forme%', null),
      ('63', 'controle', 'une version restaurée telle quelle passe, son fichier absent ou non : les contraintes ne lisent pas le stockage', 'proprietaire', null,
        $q$with i as (insert into parametres_facturation (dossier_id, auteur, logo_chemin, logo_sha256) values ('{DB}', '{CHEF}', '{DB}/logos/{HE}.jpg', '{HE}') returning 1) select count(*)::text from i$q$,
        'OK', '1', null)
    ) as x(num, genre, controle, qui, droits, ordre, code, attendu, cle)
    loop
      -- Les droits de l'accès d'essai, posés par le propriétaire avant l'étape qui les nomme.
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
        -- Le membre du cabinet : le compte du client, rangé au cabinet le temps de son étape (une sous-transaction
        -- annulée l'emporte) — affecté au dossier B, ou à aucun. Ses étapes sont toutes des contrôles.
        if s.qui in ('membre', 'membre_affecte') then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
          if s.qui = 'membre_affecte' then
            insert into dossier_assignations (dossier_id, user_id) values ((ids ->> 'DB')::uuid, client);
          end if;
        end if;
        if s.qui = 'anon' then
          set local role anon;
          perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        elsif s.qui in ('inconnu', 'client', 'chef', 'membre', 'membre_affecte') then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub',
            case s.qui when 'inconnu' then inconnu when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
        else
          -- Le propriétaire : sans session, `auth.uid()` est nul — il n'hérite pas du compte de l'étape précédente.
          perform set_config('request.jwt.claims', '', true);
        end if;
        -- Plusieurs ordres : chacun dans sa propre instruction, pour voir ce que le précédent a écrit.
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
      if s.cle is not null and accepte and rendu is not null then
        ids := ids || jsonb_build_object(s.cle, rendu);
      end if;
      ok := case
        when s.code = 'OK' then accepte and (attendu is null or coalesce(rendu, '') like attendu)
                                and (s.cle is null or rendu is not null)
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
    ((select count(*) from storage.objects)), ((select count(*) from storage.buckets))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || avant || ' -> ' || apres, 'ok', erreur is null and avant = apres);
  perform set_config('essai.logo_des_factures', verdicts::text, true);
end
$essai$;

-- Les verdicts, et une ligne d'INFORMATION : le texte que la base a reçu, sa longueur et son empreinte — sans le
-- commentaire que l'outil d'exécution ajoute à la fin —, à confronter à la copie transmise (sous psql, qui envoie les
-- instructions une à une, elle ne voit que cette requête-ci).
select x.genre, x.controle, x.verdict, x.observe from (
  select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                   else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
  from jsonb_to_recordset(current_setting('essai.logo_des_factures')::jsonb) as v(controle text, genre text, ok boolean, observe text)
  union all
  select 'information', '0. le texte reçu par la base', 'information', length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by x.genre desc, (regexp_match(x.controle, '^M?(\d+)'))[1]::int, x.controle;
