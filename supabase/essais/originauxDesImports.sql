-- LES ORIGINAUX DES FACTURES REPRISES DANS LE SEAU DES VENTES, ÉPROUVÉS EN BASE (A8d2a, ligne 51.5) — à rejouer par
-- `execute_sql` après toute migration qui touche la migration `originaux_des_imports`, le seau `ventes` et ses policies,
-- `enregistrer_parametres_facturation`, `memberships`, `dossiers`, `cabinet_admins`, `dossier_assignations`,
-- `gere_les_ventes` ou `admin_du_dossier`.
--
-- Ce qui se prouve ici, par impersonation — anonyme, compte rattaché à rien, le client de l'essai sans case, avec
-- « Banque » seul, avec « Ventes », avec les deux, un membre du cabinet affecté ou non au dossier, le chef d'un AUTRE
-- cabinet (avec ou sans « Ventes » sur le dossier), le chef du cabinet (super-administrateur), le propriétaire :
--   - LE CATALOGUE : le seau, PRIVÉ, 20 Mio, PNG, JPEG, PDF, texte brut et CSV (ni SVG ni type XML) ; ses quatre
--     policies ; la lecture et le dépôt d'un original mot pour mot ; le dépôt d'un logo et la suppression à leur
--     empreinte d'avant ; aucune policy de mise à jour ; `enregistrer_parametres_facturation`, la version d'avant à
--     l'octet près plus les trois lignes de la borne du logo ;
--   - QUI LIT un original (`<dossier>/imports/…`) : le cabinet du dossier seul — jamais le client, « Ventes » compris,
--     qui lit toujours les logos ; un chemin qui ne commence pas par un dossier ne se lit pas et ne fait rien lever ;
--   - QUI DÉPOSE un original : le cabinet du dossier seul, sous la forme EXACTE `<dossier>/imports/<lot>/<empreinte>.
--     <pdf|xml|csv>` — toute autre forme refusée, même pour lui, sans rien faire lever ;
--   - UN ORIGINAL NE S'ÉCRASE NI NE SE MODIFIE : un second dépôt sous le même nom bute sur l'unicité, un dépôt qui
--     écraserait exige une mise à jour, et aucune mise à jour ne touche une ligne ; le client « Ventes » dépose toujours
--     un logo, jamais un PDF sous les logos ;
--   - LE LOGO RESTE SOUS 500 KIO, le seau à 20 Mio : la fonction des paramètres refuse un octet de plus, et un PDF rangé
--     sous le nom d'un logo ;
--   - et que RIEN ne reste en base.
-- La SUPPRESSION ne se joue pas ici (`storage.protect_delete` refuse toute suppression SQL) : sa policy, inchangée, se
-- lit au catalogue (0d), et `logoDesFacturesSuppression.sql` la rejoue sur une réplique.
--
-- SANS LA MIGRATION `originaux_des_imports`, une seule ligne la dit, « EN ATTENTE », SANS être une faute : la migration est
-- présentée au cabinet avant d'être appliquée. Elle EN EST UNE si l'historique porte `originaux_des_imports` sans sa policy
-- de dépôt — sauf si une ligne `retour_originaux_des_imports`, plus récente, dit son retour arrière.
--
-- Le moteur est celui de logoDesFactures.sql (recopié) : deux dossiers JETABLES du cabinet du chef (A, basculé, où le
-- client de l'essai a un accès d'essai ; B, sans accès), un cabinet jetable, des fichiers d'essai rangés par le propriétaire
-- (des LIGNES de `storage.objects`, sans fichier derrière) ; chaque contrôle dans sa sous-transaction annulée, les étapes
-- « fait » gardées jusqu'à l'annulation finale ; un refus se juge à son code ET à son message (`like`) ; les empreintes
-- sont fictives (un chiffre répété soixante-quatre fois). Aucune instruction de suppression ; hors de l'outil
-- d'exécution, en UNE transaction (`psql -1`).
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil, un droit ou une cible délibérément faux : chacune
-- doit MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait.
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
  if not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname = 'ventes_depot_d_un_original') then
    select max(version) filter (where name = 'originaux_des_imports'), max(version) filter (where name = 'retour_originaux_des_imports')
      into applique, retour from supabase_migrations.schema_migrations;
    verdicts := verdicts || jsonb_build_object('controle', '0. EN ATTENTE : la migration originaux_des_imports (A8d2a) n''est pas en base',
      'genre', 'controle',
      'observe', 'historique : ' || coalesce('originaux_des_imports ' || applique, 'sans originaux_des_imports')
                 || coalesce(', retour_originaux_des_imports ' || retour, ''),
      'ok', applique is null or (retour is not null and retour > applique));
    perform set_config('essai.originaux_des_imports', verdicts::text, true);
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
    'DA', 'a8d20000-0000-4000-8000-0000000000a1', 'DB', 'a8d20000-0000-4000-8000-0000000000b1',
    'DBU', 'A8D20000-0000-4000-8000-0000000000B1', 'CAB2', 'a8d20000-0000-4000-8000-0000000000c2',
    'LOTA', 'a8d20000-0000-4000-8000-00000000017a', 'LOTB', 'a8d20000-0000-4000-8000-00000000017b',
    'ACCES', 'a8d20000-0000-4000-8000-0000000000ac',
    'H1', repeat('1', 64), 'H2', repeat('2', 64), 'H3', repeat('3', 64), 'H4', repeat('4', 64), 'H5', repeat('5', 64),
    'H6', repeat('6', 64), 'H7', repeat('7', 64), 'H8', repeat('8', 64), 'H9', repeat('9', 64), 'HA', repeat('a', 64),
    'HB', repeat('b', 64), 'HC', repeat('c', 64), 'HU', repeat('A', 64));

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from parametres_facturation)), ((select count(*) from cabinets)),
    ((select count(*) from storage.objects)), ((select count(*) from storage.buckets))
  ) as t(n);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre(s), code attendu ou OK, message ou valeur attendus, clé)
      -- genre : « jeu » (posé par le propriétaire, gardé), « controle » (annulé), « fait » (gardé), « valeur » (lecture
      -- par le propriétaire), « mutation » (un contrôle rejoué à faux, qui doit rendre l'inverse). Plusieurs ordres se
      -- séparent par « §§ ». qui : anon, inconnu, client, chef, proprietaire, membre (le compte du client rangé au
      -- cabinet, non affecté), membre_affecte (le même, affecté au dossier B), autre_chef (le même, chef d'un cabinet
      -- jetable). Ce que chacun lit : les originaux de A / les autres fichiers de A / les fichiers de B / le chemin sans
      -- dossier.

      -- ══ Le jeu ══════════
      ('j1', 'jeu', 'dossiers jetables A (basculé) et B, un cabinet jetable', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, ventes_par_les_factures) values
          ('{DA}', 'ESSAI ORIGINAUX A', '{CAB}', 'redevable', true, true), ('{DB}', 'ESSAI ORIGINAUX B', '{CAB}', 'redevable', true, false)
          §§ insert into cabinets (id, nom) values ('{CAB2}', 'ESSAI ORIGINAUX AUTRE CABINET')$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-originaux@exemple.invalid')$q$, 'OK', null, null),
      ('j3', 'jeu', 'les fichiers d''essai : trois originaux et quatre logos dans A, un original dans B, un chemin sans dossier', 'proprietaire', null,
        $q$insert into storage.objects (bucket_id, name, metadata) values
          ('ventes', '{DA}/imports/{LOTA}/{H1}.pdf', '{"size": 1000, "mimetype": "application/pdf"}'),
          ('ventes', '{DA}/imports/{LOTA}/{H2}.xml', '{"size": 1000, "mimetype": "text/plain"}'),
          ('ventes', '{DA}/imports/{LOTA}/{H3}.csv', '{"size": 1000, "mimetype": "text/csv"}'),
          ('ventes', '{DA}/logos/{H4}.png', '{"size": 1000, "mimetype": "image/png"}'),
          ('ventes', '{DA}/logos/{H5}.png', '{"size": 512001, "mimetype": "image/png"}'),
          ('ventes', '{DA}/logos/{H6}.png', '{"size": 512000, "mimetype": "image/png"}'),
          ('ventes', '{DA}/logos/{H7}.png', '{"size": 1000, "mimetype": "application/pdf"}'),
          ('ventes', '{DB}/imports/{LOTB}/{H8}.pdf', '{"size": 1000, "mimetype": "application/pdf"}'),
          ('ventes', 'essai-originaux-sans-dossier/imports/{LOTA}/{H9}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$, 'OK', null, null),

      -- ══ 0. Le catalogue ══════════
      ('0a', 'valeur', 'le seau : privé, 20 Mio, PNG, JPEG, PDF, texte brut (le XML) et CSV — ni SVG, ni type XML', 'proprietaire', null,
        $q$select b.id || ':' || b.public || ':' || b.file_size_limit || ':' || array_to_string(b.allowed_mime_types, ',') from storage.buckets b where b.id = 'ventes'$q$,
        'OK', 'ventes:false:20971520:image/png,image/jpeg,application/pdf,text/plain,text/csv', null),
      ('0b', 'valeur', 'les quatre policies du seau, aux connectés, permissives : deux dépôts, la lecture, la suppression', 'proprietaire', null,
        $q$select string_agg(p.polname || '/' || p.polcmd::text || '/' || p.polpermissive || '/' || array_to_string(p.polroles::regrole[]::text[], ','), ',' order by p.polname)
             from pg_policy p where p.polrelid = 'storage.objects'::regclass
              and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) like '%''ventes''%'$q$,
        'OK', 'ventes_depot_d_un_logo/a/true/authenticated,ventes_depot_d_un_original/a/true/authenticated,ventes_lecture/r/true/authenticated,ventes_suppression_par_le_chef/d/true/authenticated', null),
      ('0c', 'valeur', 'la lecture et le dépôt d''un original, mot pour mot : la forme du chemin d''abord, le cabinet du dossier pour un original', 'proprietaire', null,
        $q$select string_agg(p.polname || '=' || replace(regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), '\s+', ' ', 'g'),
               -- A8D2A-Q1 (`originaux_retenus_par_leur_import`, préparée) : la libération suit le cas `imports/`.
               'THEN (admin_du_dossier(((storage.foldername(name))[1])::uuid) OR original_libere(name)) WHEN', 'THEN admin_du_dossier(((storage.foldername(name))[1])::uuid) WHEN'), ' ; ' order by p.polname)
             from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname in ('ventes_lecture', 'ventes_depot_d_un_original')$q$,
        'OK', 'ventes_depot_d_un_original=|((bucket_id = ''ventes''::text) AND CASE WHEN (name ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}\\.(pdf|xml|csv)$''::text) THEN admin_du_dossier(((storage.foldername(name))[1])::uuid) ELSE false END) ; ventes_lecture=((bucket_id = ''ventes''::text) AND CASE WHEN (name ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/''::text) THEN admin_du_dossier(((storage.foldername(name))[1])::uuid) WHEN (name ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/''::text) THEN gere_les_ventes(((storage.foldername(name))[1])::uuid) ELSE false END)|', null),
      ('0d', 'valeur', 'le dépôt d''un logo et la suppression, inchangés : leurs prédicats à l''empreinte d''avant', 'proprietaire', null,
        $q$select string_agg(md5(regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
               -- A8D2A-Q1 (`originaux_retenus_par_leur_import`, préparée) : le cas `imports/` de la suppression, retiré.
               '\n\s+WHEN \(name ~ ''\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}/imports/''::text\) THEN \(\(\(EXISTS .*?OR original_libere\(name\)\)', '')
               || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')), ',' order by p.polname)
             from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname in ('ventes_depot_d_un_logo', 'ventes_suppression_par_le_chef')$q$,
        'OK', '9a5e3e9e053c8bb2b488263129f69de3,597459152cb7f38b77cf309d8b0e53aa', null),
      ('0e', 'valeur', 'aucune policy de mise à jour, ni « pour tout », n''atteint le seau : un original ne se modifie ni ne s''écrase', 'proprietaire', null,
        $q$select count(*)::text from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polcmd in ('w', '*')
              and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) !~ 'bucket_id = ''(pieces|packs|cabinet-logos)''::text'$q$,
        'OK', '0', null),
      ('0f', 'valeur', 'la fonction des paramètres : la version d''avant à l''octet près, plus les trois lignes de la borne du logo', 'proprietaire', null,
        $q$select md5(replace(pg_get_functiondef('public.enregistrer_parametres_facturation(uuid, uuid, jsonb)'::regprocedure),
             E'      -- A8d2a (migration originaux_des_imports) : le seau des ventes porte aussi les originaux des factures reprises,\n      -- jusqu''à 20 Mio ; un logo reste sous 500 Kio, la plus petite des deux bornes (celle du seau, si on l''abaisse).\n      v_borne := least(v_borne, 512000);\n', ''))
             || ' ' || (strpos(pg_get_functiondef('public.enregistrer_parametres_facturation(uuid, uuid, jsonb)'::regprocedure), 'v_borne := least(v_borne, 512000);') > 0)$q$,
        'OK', '5d18ba49cb0db04a237c904d1b65d4d5 true', null),

      -- ══ 1 à 11. Qui lit ══════════
      ('1', 'controle', 'lanonyme ne lit rien', 'anon', null,
        $q$select count(*) filter (where o.name like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DA}/%' and o.name not like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-originaux-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/0/0/0', null),
      ('2', 'controle', 'un compte rattaché à rien non plus', 'inconnu', null,
        $q$select count(*) filter (where o.name like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DA}/%' and o.name not like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-originaux-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/0/0/0', null),
      ('3', 'controle', 'le client sans case : rien', 'client', 'aucun',
        $q$select count(*) filter (where o.name like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DA}/%' and o.name not like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-originaux-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/0/0/0', null),
      ('4', 'controle', 'le client avec « Banque » seul : rien', 'client', 'banque',
        $q$select count(*) filter (where o.name like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DA}/%' and o.name not like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-originaux-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/0/0/0', null),
      ('5', 'controle', 'le client avec « Ventes » : les logos de son dossier, AUCUN original — et le chemin sans dossier ne fait rien lever', 'client', 'ventes',
        $q$select count(*) filter (where o.name like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DA}/%' and o.name not like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-originaux-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/4/0/0', null),
      ('6', 'controle', 'avec les deux cases : de même', 'client', 'deux',
        $q$select count(*) filter (where o.name like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DA}/%' and o.name not like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-originaux-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/4/0/0', null),
      ('7', 'controle', 'un membre du cabinet non affecté : rien', 'membre', 'aucun',
        $q$select count(*) filter (where o.name like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DA}/%' and o.name not like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-originaux-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/0/0/0', null),
      ('8', 'controle', 'un membre affecté au dossier B : loriginal de B seulement', 'membre_affecte', 'aucun',
        $q$select count(*) filter (where o.name like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DA}/%' and o.name not like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-originaux-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/0/1/0', null),
      ('9', 'controle', 'le chef dun autre cabinet : rien', 'autre_chef', 'aucun',
        $q$select count(*) filter (where o.name like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DA}/%' and o.name not like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-originaux-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/0/0/0', null),
      ('10', 'controle', 'le chef dun autre cabinet qui porte « Ventes » sur A : les logos, aucun original', 'autre_chef', 'ventes',
        $q$select count(*) filter (where o.name like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DA}/%' and o.name not like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-originaux-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/4/0/0', null),
      ('11', 'controle', 'le chef du cabinet : tout ce qui porte un dossier', 'chef', null,
        $q$select count(*) filter (where o.name like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DA}/%' and o.name not like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-originaux-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '3/4/1/0', null),
      ('M1', 'mutation', 'le contrôle 1 rejoué sous le chef : il lit', 'chef', null,
        $q$select count(*) filter (where o.name like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DA}/%' and o.name not like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-originaux-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '3/4/1/0', null),
      ('M2', 'mutation', 'le contrôle 5 rejoué sous le membre affecté à B : il lit aussi loriginal de B', 'membre_affecte', 'ventes',
        $q$select count(*) filter (where o.name like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DA}/%' and o.name not like '{DA}/imports/%') || '/' || count(*) filter (where o.name like '{DB}/%') || '/' || count(*) filter (where o.name like 'essai-originaux-sans-dossier/%') from storage.objects o where o.bucket_id = 'ventes'$q$,
        'OK', '0/4/1/0', null),

      -- ══ 20 à 29. Qui dépose un original ══════════
      ('20', 'controle', 'le client « Ventes » ne dépose pas doriginal dans son dossier', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/imports/{LOTA}/{HA}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('21', 'controle', 'ni avec les deux cases', 'client', 'deux',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/imports/{LOTA}/{HA}.xml', '{"size": 1000, "mimetype": "text/plain"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('22', 'controle', 'ni sans case', 'client', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/imports/{LOTA}/{HA}.csv', '{"size": 1000, "mimetype": "text/csv"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('23', 'controle', 'ni lanonyme', 'anon', null,
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/imports/{LOTA}/{HA}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('24', 'controle', 'ni un compte rattaché à rien', 'inconnu', null,
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/imports/{LOTA}/{HA}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('25', 'controle', 'ni le chef dun autre cabinet, même avec « Ventes » sur A', 'autre_chef', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/imports/{LOTA}/{HA}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('26', 'controle', 'ni un membre non affecté', 'membre', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{LOTB}/{HA}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('27', 'controle', 'ni le membre affecté à B, dans A', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/imports/{LOTA}/{HA}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('28', 'controle', 'le membre affecté à B dépose un original dans B, et le lit', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{LOTB}/{HA}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')
          §§ select count(*)::text from storage.objects o where o.bucket_id = 'ventes' and o.name like '{DB}/imports/%'$q$,
        'OK', '2', null),
      ('29', 'controle', 'le chef dépose un XML et un CSV dans A', 'chef', null,
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/imports/{LOTA}/{HA}.xml', '{"size": 1000, "mimetype": "text/plain"}'),
          ('ventes', '{DA}/imports/{LOTA}/{HA}.csv', '{"size": 1000, "mimetype": "text/csv"}')
          §§ select count(*)::text from storage.objects o where o.bucket_id = 'ventes' and o.name like '{DA}/imports/%'$q$,
        'OK', '5', null),
      ('M3', 'mutation', 'le contrôle 20 rejoué sous le chef : il dépose', 'chef', null,
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/imports/{LOTA}/{HA}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        'OK', null, null),
      ('M4', 'mutation', 'le contrôle 27 rejoué dans B : il dépose', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{LOTB}/{HA}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        'OK', null, null),

      -- ══ 30 à 43. La forme exacte du chemin, même pour le cabinet du dossier ══════════
      ('30', 'controle', 'un dossier en majuscules', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DBU}/imports/{LOTB}/{HB}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('31', 'controle', 'un lot qui nest pas un identifiant', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/lot-1/{HB}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('32', 'controle', 'un nom qui nest pas une empreinte (le nom du fichier dorigine)', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{LOTB}/facture-F2025-001.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('33', 'controle', 'une empreinte en majuscules', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{LOTB}/{HU}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('34', 'controle', 'un SVG', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{LOTB}/{HB}.svg', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('35', 'controle', 'une page HTML', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{LOTB}/{HB}.html', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('36', 'controle', 'une image', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{LOTB}/{HB}.png', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('37', 'controle', 'une extension en majuscules', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{LOTB}/{HB}.PDF', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('38', 'controle', 'un sous-dossier dans le lot', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{LOTB}/x/{HB}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('39', 'controle', 'un original sans lot', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{HB}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('40', 'controle', 'un retour au dossier parent', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{LOTB}/../{HB}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('41', 'controle', 'une fin de ligne après lextension', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', E'{DB}/imports/{LOTB}/{HB}.pdf\n', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('42', 'controle', 'un original rangé sous les logos', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/logos/{HB}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('43', 'controle', 'un chemin qui ne commence pas par un dossier, par le chef : refusé, et rien ne lève', 'chef', null,
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', 'essai-originaux-sans-dossier/imports/{LOTA}/{HB}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('M5', 'mutation', 'le contrôle 32 rejoué sous la forme exacte : il dépose', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{LOTB}/{HB}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        'OK', null, null),

      -- ══ 50 à 56. Un original ne s'écrase ni ne se modifie ; le logo, comme hier ══════════
      ('50', 'controle', 'un second dépôt sous le même nom, par le cabinet : refusé', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{LOTB}/{H8}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '23505', 'duplicate key value violates unique constraint%', null),
      ('51', 'controle', 'ni par un dépôt qui écraserait (upsert) : il faudrait une mise à jour', 'membre_affecte', 'aucun',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DB}/imports/{LOTB}/{H8}.pdf', '{"size": 7, "mimetype": "application/pdf"}')
             on conflict (bucket_id, name collate "C") where archived_at is null do update set metadata = excluded.metadata$q$,
        '42501', '%row-level security%', null),
      ('52', 'controle', 'le cabinet ne modifie pas un original : aucune ligne touchée', 'membre_affecte', 'aucun',
        $q$with u as (update storage.objects set metadata = '{"size": 7, "mimetype": "application/pdf"}' where bucket_id = 'ventes' and name like '{DB}/imports/%' returning 1) select count(*)::text from u$q$,
        'OK', '0', null),
      ('53', 'controle', 'le chef non plus', 'chef', null,
        $q$with u as (update storage.objects set metadata = '{"size": 7, "mimetype": "application/pdf"}' where bucket_id = 'ventes' and name like '{DA}/imports/%' returning 1) select count(*)::text from u$q$,
        'OK', '0', null),
      ('54', 'controle', 'le client « Ventes » ne renomme pas un logo en original', 'client', 'ventes',
        $q$with u as (update storage.objects set name = '{DA}/imports/{LOTA}/{HC}.pdf' where bucket_id = 'ventes' and name = '{DA}/logos/{H4}.png' returning 1) select count(*)::text from u$q$,
        'OK', '0', null),
      ('M6', 'mutation', 'le contrôle 53 rejoué par le propriétaire : les lignes sont bien là', 'proprietaire', null,
        $q$with u as (update storage.objects set metadata = '{"size": 7, "mimetype": "application/pdf"}' where bucket_id = 'ventes' and name like '{DA}/imports/%' returning 1) select count(*)::text from u$q$,
        'OK', '3', null),
      ('55', 'controle', 'le client « Ventes » dépose toujours un logo dans son dossier', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.png', '{"size": 1000, "mimetype": "image/png"}')$q$,
        'OK', null, null),
      ('56', 'controle', 'mais pas un PDF sous les logos', 'client', 'ventes',
        $q$insert into storage.objects (bucket_id, name, metadata) values ('ventes', '{DA}/logos/{HB}.pdf', '{"size": 1000, "mimetype": "application/pdf"}')$q$,
        '42501', 'new row violates row-level security policy%', null),

      -- ══ 60 à 64. Le logo reste sous 500 Kio, le seau à 20 Mio ══════════
      ('60', 'fait', 'le chef enregistre la première version de A, sans logo', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', null, '{"delai_paiement_jours": 30}'::jsonb) p$q$,
        'OK', null, 'V1'),
      ('61', 'controle', 'un logo d''un octet au-delà de 500 Kio : refusé, quoique le seau en admette 20 Mio', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H5}.png", "logo_sha256": "{H5}"}'::jsonb) p$q$,
        '22023', 'Le fichier du logo pèse plus que les 512000 octets que le seau des ventes admet.', null),
      ('62', 'controle', 'un logo à 500 Kio exactement : il passe', 'chef', null,
        $q$select p.logo_sha256 from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H6}.png", "logo_sha256": "{H6}"}'::jsonb) p$q$,
        'OK', '{H6}', null),
      ('63', 'controle', 'un PDF rangé sous le nom d''un logo, que le seau admet désormais : refusé comme logo', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H7}.png", "logo_sha256": "{H7}"}'::jsonb) p$q$,
        '22023', 'Le fichier du logo n''est pas une image PNG ou JPEG du type que dit son nom.', null),
      ('64', 'controle', 'le client « Ventes » non plus ne pose pas un logo trop lourd', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H5}.png", "logo_sha256": "{H5}"}'::jsonb) p$q$,
        '22023', 'Le fichier du logo pèse plus que les 512000 octets que le seau des ventes admet.', null),
      ('M7', 'mutation', 'le contrôle 61 rejoué sur le logo à la borne : il passe', 'chef', null,
        $q$select p.logo_sha256 from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"logo_chemin": "{DA}/logos/{H6}.png", "logo_sha256": "{H6}"}'::jsonb) p$q$,
        'OK', '{H6}', null)
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
        -- Le chef d'un AUTRE cabinet : le compte du client, chef d'un cabinet jetable le temps de son étape.
        if s.qui = 'autre_chef' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, (ids ->> 'CAB2')::uuid, 'comptable_en_chef');
        end if;
        if s.qui in ('membre', 'membre_affecte') then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
          if s.qui = 'membre_affecte' then
            insert into dossier_assignations (dossier_id, user_id) values ((ids ->> 'DB')::uuid, client);
          end if;
        end if;
        if s.qui = 'anon' then
          set local role anon;
          perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        elsif s.qui in ('inconnu', 'client', 'chef', 'membre', 'membre_affecte', 'autre_chef') then
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
    ((select count(*) from dossier_assignations)), ((select count(*) from parametres_facturation)), ((select count(*) from cabinets)),
    ((select count(*) from storage.objects)), ((select count(*) from storage.buckets))
  ) as t(n);
  -- L'écart seul, non plus les comptes de toute la base, qui diraient le volume d'un dossier réel (audit du 29/10/2026).
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)), 'ok', erreur is null and avant = apres);
  perform set_config('essai.originaux_des_imports', verdicts::text, true);
end
$essai$;

-- Les verdicts, et une ligne d'INFORMATION : le texte que la base a reçu, sa longueur et son empreinte — sans le
-- commentaire que l'outil d'exécution ajoute à la fin —, à confronter à la copie transmise (sous psql, qui envoie les
-- instructions une à une, elle ne voit que cette requête-ci).
select x.genre, x.controle, x.verdict, x.observe from (
  select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                   else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
  from jsonb_to_recordset(current_setting('essai.originaux_des_imports')::jsonb) as v(controle text, genre text, ok boolean, observe text)
  union all
  select 'information', '0. le texte reçu par la base', 'information', length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by x.genre desc, (regexp_match(x.controle, '^M?(\d+)'))[1]::int, x.controle;
