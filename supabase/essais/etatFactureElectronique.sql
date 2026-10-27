-- L'ENCART « FACTURE ÉLECTRONIQUE », ÉPROUVÉ EN BASE (espace client, étape A6a) — à rejouer par `execute_sql` après toute
-- migration qui touche la migration `adresses_reception`, `declarer_adresse_reception`, `etat_facture_electronique`,
-- `garder_adresse_reception`, `connexions_plateformes`, `superpdp_credentials`, `memberships`, `client_du_dossier`,
-- `gere_les_ventes` ou `admin_du_dossier`.
--
-- Ce qui se prouve ici, par impersonation — anonyme, compte rattaché à rien, le client de l'essai sans droit, avec
-- « Banque » seul, avec « Ventes », avec les deux, sur SON dossier ou sur un autre, un membre du cabinet affecté ou non au
-- dossier, le chef du cabinet (super-administrateur), et le propriétaire de la base :
--   - LE CATALOGUE : la table sous RLS, ses trois policies (lecture du cabinet, lecture du droit « Ventes », insertion de
--     restauration) et leurs prédicats, aucune autre ; la chaîne des versions (une suite par version, une seule première
--     par dossier) ; la garde, avant toute insertion, mise à jour ou suppression ; les deux fonctions SECURITY DEFINER, au
--     chemin fixé, fermées à l'anonyme et à PUBLIC, qui vérifient l'accès AVANT toute autre chose ; les deux tables des
--     connexions, toujours sans policy ;
--   - L'ÉTAT : refusé (42501, sa RAISON) à l'anonyme, à un compte rattaché à rien, au client sans « Ventes » ou avec
--     « Banque » seul, au client d'un autre dossier, à un membre du cabinet non affecté, sur un dossier qui n'existe pas ;
--     rendu au client « Ventes », au cabinet ; sa FORME exacte (chaque clé, chaque type) et ses VALEURS ; et ce qu'il ne
--     rend JAMAIS : un identifiant, un secret, une adresse de connexion, une organisation et une portée PLANTÉS dans les
--     deux connexions d'essai — ni tels quels, ni leur md5, ni leur SHA-256 —, ni le point de reprise, ni qui a relié la
--     plateforme, ni la date d'une mise à jour, ni aucun nombre ;
--   - LA DÉCLARATION : qui déclare (le cabinet, le client « Ventes ») et qui ne déclare pas ; chaque refus de
--     `declarer_adresse_reception` sous ses mots, et leur ORDRE (sept rangs : l'accès, la forme, le SIREN du dossier, la
--     prise d'effet, la plateforme, la vérification, la version remplacée) ; ce que la fonction écrit et qui l'a écrit ;
--     la chaîne des versions, et la déclaration concurrente nommée ;
--   - CE QUE LE CLIENT LIT : avec « Ventes », toute l'histoire des adresses de son dossier ; sans le droit ou avec
--     « Banque » seul, rien, pas même de son dossier ; jamais celles d'un autre dossier ;
--   - AUCUNE ÉCRITURE DIRECTE : une insertion refusée par la RLS (42501) — sauf la porte de la restauration, au
--     super-administrateur —, une mise à jour qui ne touche aucune ligne, et la garde qui refuse au propriétaire de
--     modifier une ligne ou d'en remplacer une d'un autre dossier ;
--   - LES CONTRAINTES DE LA TABLE disent la même chose que la fonction, pour ce que la restauration réinsère ;
--   - et que RIEN ne reste en base.
--
-- SANS LA MIGRATION `adresses_reception`, une seule ligne la dit, « EN ATTENTE », SANS être une faute : la migration est
-- présentée au cabinet avant d'être appliquée. Elle EN EST UNE si l'historique des migrations porte `adresses_reception`
-- sans que la table existe — sauf si une ligne `retour_adresses_reception`, plus récente, dit son retour arrière.
--
-- Tout se joue dans quatre dossiers JETABLES du cabinet du chef — A (le client de l'essai y a un accès d'essai ; une
-- plateforme agréée et Super PDP y sont reliés, leurs identifiants plantés), B (sans accès du client ; Super PDP seul),
-- C (sans SIRET), D (un SIRET écrit avec des espaces insécables) —, au sein d'un bloc qui s'annule entièrement à la fin
-- (`ANNULATION_ESSAI_GLOBALE`) : chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001),
-- le verdict posé dans une VARIABLE avant ; les étapes « fait » sont gardées jusqu'à l'annulation finale, et une étape
-- peut rendre un identifiant que les suivantes citent (`{CLE}`) ; `{AUJOURDHUI}`, `{DEMAIN}` et `{JOUR_FR}` sont le jour
-- de l'essai à Paris, le lendemain, et ce jour écrit JJ/MM/AAAA. Un refus se juge à son code ET à son message (`like`).
-- Les droits de l'accès d'essai se posent avant chaque étape qui les nomme ; le membre du cabinet est le compte du
-- client, rangé au cabinet le temps de son étape (jamais une étape « fait »), ses cases à zéro. Les verdicts voyagent dans
-- un réglage LOCAL à la transaction (`essai.etat_facture_electronique`) : le fichier se joue d'un seul appel, ne crée
-- aucune table et ne porte AUCUNE instruction de suppression ni de mise à jour sans `where` — aucune policy n'ouvre la
-- suppression (contrôle 0a), et la garde la refuse au propriétaire ; ce qu'une suppression rencontre se joue sur une
-- réplique. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil, un droit ou une donnée délibérément faux :
-- chacune doit MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait.
--
-- src/lib/adressesReception.test.ts lit les étapes ici : chaque refus que src/lib/adressesReception.ts redit avant le clic
-- doit y être exigé de la base, sous les mêmes mots, et chaque déclaration de l'essai, rejouée dans le module, y reçoit le
-- même premier refus, ou aucun ; src/lib/etatFactureElectronique.test.ts y lit la forme que la fonction rend.
do $essai$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  cabinet uuid;
  ids jsonb;
  jour date := (now() at time zone 'Europe/Paris')::date;
  avant text; apres text;
  s record; k text; ordre text; partie text; attendu text; rendu text; accepte boolean; code_recu text; message text; ok boolean;
  erreur text;
  applique text; retour text;
  verdicts jsonb := '[]'::jsonb;
begin
  -- La migration d'abord : sans elle, une ligne le dit, en faute seulement si l'historique la porte sans retour arrière.
  if to_regclass('public.adresses_reception') is null then
    select max(version) filter (where name = 'adresses_reception'), max(version) filter (where name = 'retour_adresses_reception')
      into applique, retour from supabase_migrations.schema_migrations;
    verdicts := verdicts || jsonb_build_object('controle', '0. EN ATTENTE : la migration adresses_reception (étape A6a) n''est pas en base',
      'genre', 'controle',
      'observe', 'historique : ' || coalesce('adresses_reception ' || applique, 'sans adresses_reception')
                 || coalesce(', retour_adresses_reception ' || retour, ''),
      'ok', applique is null or (retour is not null and retour > applique));
    perform set_config('essai.etat_facture_electronique', verdicts::text, true);
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
    'DA', 'a6a60000-0000-4000-8000-0000000000a1', 'DB', 'a6a60000-0000-4000-8000-0000000000b1',
    'DC', 'a6a60000-0000-4000-8000-0000000000c1', 'DD', 'a6a60000-0000-4000-8000-0000000000d1',
    'ACCES', 'a6a60000-0000-4000-8000-0000000000e1', 'CREATEUR', 'a6a60000-0000-4000-8000-00000000a6a6',
    'INCONNUE', gen_random_uuid(),
    'AUJOURDHUI', jour::text, 'DEMAIN', (jour + 1)::text, 'JOUR_FR', to_char(jour, 'DD/MM/YYYY'));

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from adresses_reception)),
    ((select count(*) from connexions_plateformes)), ((select count(*) from superpdp_credentials))
  ) as t(n);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre(s), code attendu ou OK, message ou valeur attendus, clé)
      -- genre : « jeu » (posé par le propriétaire, gardé), « controle » (annulé), « fait » (gardé), « valeur » (lecture,
      -- annulée), « mutation » (un contrôle rejoué à faux, qui doit rendre l'inverse). Plusieurs ordres se séparent par
      -- « §§ » ; {RENDU} y vaut ce que le précédent a rendu ; la clé garde ce que l'étape a rendu.
      -- qui : anon, inconnu, client, chef, proprietaire, membre (le compte du client rangé au cabinet, non affecté),
      -- membre_affecte (le même, affecté au dossier B).

      -- ══ Le jeu : quatre dossiers jetables, un accès d'essai sans droit, les connexions plantées ══════════
      -- A naît basculé : « Ventes » ne se porte que sur un accès d'un dossier dont les factures sont la source de leurs
      -- ventes (garder_droit_ventes, étape VF8f) ; son adresse de réception n'en dépend pas.
      ('j1', 'jeu', 'dossiers jetables A, B, C (sans SIRET) et D (SIRET aux espaces insécables)', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, siret, ventes_par_les_factures) values
          ('{DA}', 'ESSAI ADRESSES A', '{CAB}', 'redevable', true, '12345678200010', true),
          ('{DB}', 'ESSAI ADRESSES B', '{CAB}', 'redevable', true, '987654321', false),
          ('{DC}', 'ESSAI ADRESSES C', '{CAB}', 'redevable', true, null, false),
          ('{DD}', 'ESSAI ADRESSES D', '{CAB}', 'redevable', true, E'123\u00a0456 782\u202f00010', false)$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-adresses@exemple.invalid')$q$, 'OK', null, null),
      ('j3', 'jeu', 'A : une plateforme agréée et Super PDP reliés, chaque identifiant, secret, adresse, organisation et portée PLANTÉS ; B : Super PDP seul', 'proprietaire', null,
        $q$insert into connexions_plateformes (dossier_id, nom, url_flux, url_jeton, client_id, client_secret, organisation_id, portee,
             recherche_depuis, derniere_recuperation, created_by, created_at, updated_at, cycle_vie_depuis, cycle_vie_lu_le)
           values ('{DA}', 'PLATEFORME ESSAI', 'https://zqx-flux.exemple.invalid/zqx-flux', 'https://zqx-jeton.exemple.invalid/zqx-jeton',
             'ZQX-IDENTIFIANT-0001', 'ZQX-SECRET-0002', 'ZQX-ORGANISATION-0003', 'zqx-portee-1 zqx-portee-2',
             '2026-09-02 06:00:00+00', '2026-10-01 07:30:00+00', '{CREATEUR}', '2026-09-01 08:00:00+00', '2026-09-15 09:00:00+00',
             '2026-09-03 10:00:00+00', '2026-10-02 11:15:00+00')
           §§ insert into superpdp_credentials (dossier_id, client_id, client_secret, created_at, updated_at)
           values ('{DA}', 'ZQX-SPDP-IDENTIFIANT-0004', 'ZQX-SPDP-SECRET-0005', '2026-09-05 12:00:00+00', '2026-09-20 13:00:00+00'),
                  ('{DB}', 'ZQX-SPDP-IDENTIFIANT-0006', 'ZQX-SPDP-SECRET-0007', '2026-09-06 12:00:00+00', '2026-09-21 13:00:00+00')$q$,
        'OK', null, null),

      -- ══ 0. Le catalogue ══════════
      ('0a', 'valeur', 'la table sous RLS, ses trois policies : lecture du cabinet, lecture du droit « Ventes », insertion de restauration ; aucune autre', 'proprietaire', null,
        $q$select c.relname || ':' || c.relrowsecurity || ':' || coalesce((select string_agg(p.polname || '/' || p.polcmd::text || '/' || p.polpermissive || '/'
                 || array_to_string(p.polroles::regrole[]::text[], ','), ',' order by p.polname) from pg_policy p where p.polrelid = c.oid), 'aucune')
             from pg_class c where c.oid = 'public.adresses_reception'::regclass$q$,
        'OK', 'adresses_reception:true:adresses_reception_lecture/r/true/authenticated,adresses_reception_lecture_ventes/r/true/authenticated,adresses_reception_restauration/a/true/authenticated', null),
      ('0b', 'valeur', 'leurs prédicats : le cabinet du dossier, l''accès qui porte « Ventes », le super-administrateur', 'proprietaire', null,
        $q$select string_agg(p.polname || '=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), ' ; ' order by p.polname)
             from pg_policy p where p.polrelid = 'public.adresses_reception'::regclass$q$,
        'OK', 'adresses_reception_lecture=admin_du_dossier(dossier_id)| ; adresses_reception_lecture_ventes=client_du_dossier(dossier_id, ''ventes''::text)| ; adresses_reception_restauration=|is_super_admin()', null),
      ('0c', 'valeur', 'les deux fonctions : security definer, search_path fixé, l''état stable ; ni anon ni PUBLIC ne les exécutent', 'proprietaire', null,
        $q$select string_agg(p.proname || ' ' || p.prosecdef || ' ' || p.provolatile::text || ' ' || array_to_string(p.proconfig, ',') || ' anon ' || has_function_privilege('anon', p.oid, 'execute')
               || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
               || ' public ' || exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'), ' | ' order by p.proname)
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('declarer_adresse_reception', 'etat_facture_electronique')$q$,
        'OK', 'declarer_adresse_reception true v search_path=public anon false authenticated true public false | etat_facture_electronique true s search_path=public anon false authenticated true public false', null),
      ('0d', 'valeur', 'chacune vérifie l''accès au dossier annoncé — le cabinet ou « Ventes », et qu''il existe — AVANT toute autre chose', 'proprietaire', null,
        $q$select string_agg(p.proname || '=' || (regexp_replace(split_part(split_part(replace(p.prosrc, E'\r\n', E'\n'), E'\nbegin\n', 2), ';', 1), '\s+', ' ', 'g')
               = ' if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then raise exception ''Accès refusé à ce dossier.'' using errcode = ''42501''')::text, ',' order by p.proname)
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('declarer_adresse_reception', 'etat_facture_electronique')$q$,
        'OK', 'declarer_adresse_reception=true,etat_facture_electronique=true', null),
      ('0e', 'valeur', 'la chaîne : une suite par version (contrainte TOTALE), une seule première par dossier (index partiel) ; l''index du dossier', 'proprietaire', null,
        $q$select (select pg_get_constraintdef(co.oid) from pg_constraint co where co.conrelid = 'public.adresses_reception'::regclass and co.conname = 'adresses_reception_une_suite')
               || ' ; ' || (select string_agg(c.relname || ':' || i.indisunique || ':' || coalesce(pg_get_expr(i.indpred, i.indrelid), 'totale') || ':'
                                              || pg_get_indexdef(i.indexrelid, 1, true), ' ; ' order by c.relname collate "C")
                              from pg_index i join pg_class c on c.oid = i.indexrelid
                             where i.indrelid = 'public.adresses_reception'::regclass and (i.indpred is not null or not i.indisunique))$q$,
        'OK', 'UNIQUE (remplace_id) ; adresses_reception_dossier:false:totale:dossier_id ; adresses_reception_une_premiere:true:(remplace_id IS NULL):dossier_id', null),
      ('0f', 'valeur', 'la garde, avant toute insertion, mise à jour ou suppression, ligne à ligne ; aux droits de l''appelant, au chemin fixé, exécutée par aucun rôle', 'proprietaire', null,
        $q$select (select string_agg(t.tgname || ':' || case when t.tgtype & 2 = 2 then 'avant' else 'apres' end
                     || case when t.tgtype & 1 = 1 then ',ligne' else ',instruction' end
                     || case when t.tgtype & 4 = 4 then ',insert' else '' end || case when t.tgtype & 16 = 16 then ',update' else '' end
                     || case when t.tgtype & 8 = 8 then ',delete' else '' end || '>' || g.proname, ' ; ')
                     from pg_trigger t join pg_proc g on g.oid = t.tgfoid
                    where t.tgrelid = 'public.adresses_reception'::regclass and not t.tgisinternal)
               || ' | ' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',')
               || ' ' || has_function_privilege('anon', p.oid, 'execute') || ' ' || has_function_privilege('authenticated', p.oid, 'execute')
             from pg_proc p where p.oid = 'public.garder_adresse_reception()'::regprocedure$q$,
        'OK', 'adresses_reception_gardes:avant,ligne,insert,update,delete>garder_adresse_reception | false search_path=public false false', null),
      ('0g', 'valeur', 'les deux tables des connexions : RLS activée, AUCUNE policy — l''état les lit pour le client sans les lui ouvrir', 'proprietaire', null,
        $q$select string_agg(c.relname || ':' || c.relrowsecurity || ':' || (select count(*) from pg_policy p where p.polrelid = c.oid), ',' order by c.relname)
             from pg_class c where c.oid in ('public.connexions_plateformes'::regclass, 'public.superpdp_credentials'::regclass)$q$,
        'OK', 'connexions_plateformes:true:0,superpdp_credentials:true:0', null),
      ('0h', 'valeur', 'les colonnes que le client « Ventes » lit, dans leur ordre (« ! » : non nulle)', 'proprietaire', null,
        $q$select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
             from pg_attribute a where a.attrelid = 'public.adresses_reception'::regclass and a.attnum > 0 and not a.attisdropped$q$,
        'OK', 'id:uuid!,dossier_id:uuid!,forme:text!,identifiant:text!,plateforme:text!,prise_effet:date!,verification:text!,verifiee_le:date,remplace_id:uuid,auteur:uuid!,cree_le:timestamp with time zone!', null),

      -- ══ 10 à 21. Qui lit l'état ══════════
      ('10', 'controle', 'l''anonyme n''exécute pas l''état : le droit d''exécution', 'anon', null,
        $q$select public.etat_facture_electronique('{DA}')::text$q$, '42501', 'permission denied for function etat_facture_electronique', null),
      ('11', 'controle', 'un compte rattaché à rien : la raison d''accès', 'inconnu', null,
        $q$select public.etat_facture_electronique('{DA}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('12', 'controle', 'le client sans droit, sur son dossier', 'client', 'aucun',
        $q$select public.etat_facture_electronique('{DA}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('13', 'controle', 'le client avec « Banque » seul, sur son dossier', 'client', 'banque',
        $q$select public.etat_facture_electronique('{DA}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('14', 'controle', 'le client avec « Ventes », sur un dossier où il n''a pas d''accès', 'client', 'ventes',
        $q$select public.etat_facture_electronique('{DB}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('15', 'controle', 'un membre du cabinet non affecté au dossier', 'membre', 'aucun',
        $q$select public.etat_facture_electronique('{DA}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('16', 'controle', 'un membre du cabinet affecté au dossier B, sur le dossier A', 'membre_affecte', 'aucun',
        $q$select public.etat_facture_electronique('{DA}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('17', 'controle', 'le super-administrateur, sur un dossier qui n''existe pas : refusé, et non un état vide', 'chef', null,
        $q$select public.etat_facture_electronique('{INCONNUE}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('18', 'controle', 'le client qui porte « Ventes » lit l''état de son dossier (contrôle POSITIF)', 'client', 'ventes',
        $q$select (public.etat_facture_electronique('{DA}') -> 'plateforme' ->> 'reliee')$q$, 'OK', 'true', null),
      ('19', 'controle', 'le client qui porte les deux cases aussi', 'client', 'deux',
        $q$select (public.etat_facture_electronique('{DA}') -> 'superpdp' ->> 'relie')$q$, 'OK', 'true', null),
      ('20', 'controle', 'le chef du cabinet lit l''état du dossier A', 'chef', null,
        $q$select (public.etat_facture_electronique('{DA}') -> 'plateforme' ->> 'nom')$q$, 'OK', 'PLATEFORME ESSAI', null),
      ('21', 'controle', 'un membre du cabinet affecté au dossier B y lit l''état : Super PDP seul', 'membre_affecte', 'aucun',
        $q$select (e -> 'plateforme' ->> 'reliee') || '/' || (e -> 'superpdp' ->> 'relie') || '/' || ((e -> 'superpdp' ->> 'depuis')::timestamptz = '2026-09-06 12:00:00+00')
             from (select public.etat_facture_electronique('{DB}') as e) x$q$, 'OK', 'false/true/true', null),

      -- ══ 22 à 27. Ce que l'état rend, et ce qu'il ne rend jamais ══════════
      ('22', 'valeur', 'sa FORME : trois clés, chacune de son type ; l''adresse nulle avant toute déclaration', 'client', 'ventes',
        $q$select (select string_agg(k || '=' || jsonb_typeof(e -> k), ',' order by k collate "C") from jsonb_object_keys(e) k)
               || ' | ' || (select string_agg(k || '=' || jsonb_typeof(e -> 'plateforme' -> k), ',' order by k collate "C") from jsonb_object_keys(e -> 'plateforme') k)
               || ' | ' || (select string_agg(k || '=' || jsonb_typeof(e -> 'superpdp' -> k), ',' order by k collate "C") from jsonb_object_keys(e -> 'superpdp') k)
               || ' | ' || case when jsonb_typeof(e -> 'adresse') = 'object'
                             then (select string_agg(k || '=' || jsonb_typeof(e -> 'adresse' -> k), ',' order by k collate "C") from jsonb_object_keys(e -> 'adresse') k)
                             else jsonb_typeof(e -> 'adresse') end
             from (select public.etat_facture_electronique('{DA}') as e) x$q$,
        'OK', 'adresse=null,plateforme=object,superpdp=object | creee_le=string,derniere_recuperation=string,nom=string,reliee=boolean,statuts_lus_le=string | depuis=string,relie=boolean | null', null),
      ('23', 'valeur', 'ses VALEURS : le nom et les dates de la plateforme, la date de Super PDP', 'client', 'ventes',
        $q$select (e -> 'plateforme' ->> 'reliee') || '/' || (e -> 'plateforme' ->> 'nom')
               || '/' || ((e -> 'plateforme' ->> 'creee_le')::timestamptz = '2026-09-01 08:00:00+00')
               || '/' || ((e -> 'plateforme' ->> 'derniere_recuperation')::timestamptz = '2026-10-01 07:30:00+00')
               || '/' || ((e -> 'plateforme' ->> 'statuts_lus_le')::timestamptz = '2026-10-02 11:15:00+00')
               || '/' || (e -> 'superpdp' ->> 'relie') || '/' || ((e -> 'superpdp' ->> 'depuis')::timestamptz = '2026-09-05 12:00:00+00')
             from (select public.etat_facture_electronique('{DA}') as e) x$q$,
        'OK', 'true/PLATEFORME ESSAI/true/true/true/true/true', null),
      ('24', 'valeur', 'ce qu''il ne rend JAMAIS, cherché dans le texte rendu au client « Ventes » : aucun identifiant, secret, adresse, organisation ni portée plantés — ni md5, ni SHA-256 —, ni le point de reprise, ni qui a relié, ni une mise à jour, ni un nombre', 'client', 'ventes',
        $q$with e as (select public.etat_facture_electronique('{DA}') as j),
                t as (select j, j::text as x from e),
                plantees(v) as (values ('ZQX-IDENTIFIANT-0001'), ('ZQX-SECRET-0002'), ('ZQX-ORGANISATION-0003'), ('zqx-portee-1 zqx-portee-2'),
                  ('https://zqx-flux.exemple.invalid/zqx-flux'), ('https://zqx-jeton.exemple.invalid/zqx-jeton'),
                  ('ZQX-SPDP-IDENTIFIANT-0004'), ('ZQX-SPDP-SECRET-0005'))
           select coalesce(string_agg(trouve, ', ' order by trouve), 'aucun') from (
             select 'la valeur ' || v as trouve from plantees, t where position(lower(v) in lower(t.x)) > 0
             union all select 'le md5 de ' || v from plantees, t where position(md5(v) in t.x) > 0
             union all select 'le sha256 de ' || v from plantees, t where position(encode(sha256(convert_to(v, 'UTF8')), 'hex') in t.x) > 0
             union all select 'le motif ' || m from (values ('zqx'), ('https'), ('exemple.invalid'), ('{CREATEUR}'), ('2026-09-02'),
                 ('2026-09-03'), ('2026-09-15'), ('2026-09-20')) as w(m), t where position(m in lower(t.x)) > 0
             union all select 'un nombre' from t where jsonb_path_exists(t.j, '$.** ? (@.type() == "number")')) z$q$,
        'OK', 'aucun', null),
      ('25', 'valeur', 'la même recherche, dans le texte rendu au cabinet', 'chef', null,
        $q$with e as (select public.etat_facture_electronique('{DA}') as j),
                t as (select j, j::text as x from e),
                plantees(v) as (values ('ZQX-IDENTIFIANT-0001'), ('ZQX-SECRET-0002'), ('ZQX-ORGANISATION-0003'), ('zqx-portee-1 zqx-portee-2'),
                  ('https://zqx-flux.exemple.invalid/zqx-flux'), ('https://zqx-jeton.exemple.invalid/zqx-jeton'),
                  ('ZQX-SPDP-IDENTIFIANT-0004'), ('ZQX-SPDP-SECRET-0005'))
           select coalesce(string_agg(trouve, ', ' order by trouve), 'aucun') from (
             select 'la valeur ' || v as trouve from plantees, t where position(lower(v) in lower(t.x)) > 0
             union all select 'le md5 de ' || v from plantees, t where position(md5(v) in t.x) > 0
             union all select 'le sha256 de ' || v from plantees, t where position(encode(sha256(convert_to(v, 'UTF8')), 'hex') in t.x) > 0
             union all select 'le motif ' || m from (values ('zqx'), ('https'), ('exemple.invalid'), ('{CREATEUR}'), ('2026-09-02'),
                 ('2026-09-03'), ('2026-09-15'), ('2026-09-20')) as w(m), t where position(m in lower(t.x)) > 0
             union all select 'un nombre' from t where jsonb_path_exists(t.j, '$.** ? (@.type() == "number")')) z$q$,
        'OK', 'aucun', null),
      ('26', 'valeur', 'un dossier où rien n''est relié ni déclaré : chaque clé là, à faux ou nulle — jamais absente', 'chef', null,
        $q$select (public.etat_facture_electronique('{DD}') = '{"plateforme": {"reliee": false, "nom": null, "creee_le": null, "derniere_recuperation": null, "statuts_lus_le": null}, "superpdp": {"relie": false, "depuis": null}, "adresse": null}'::jsonb)::text$q$,
        'OK', 'true', null),
      ('27', 'valeur', 'B : Super PDP relié, la plateforme agréée non', 'chef', null,
        $q$select (public.etat_facture_electronique('{DB}') -> 'plateforme')::text$q$,
        'OK', '{"nom": null, "reliee": false, "creee_le": null, "statuts_lus_le": null, "derniere_recuperation": null}', null),

      -- ══ 30 à 37. Qui déclare ══════════
      ('30', 'controle', 'l''anonyme n''exécute pas la déclaration : le droit d''exécution', 'anon', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '42501', 'permission denied for function declarer_adresse_reception', null),
      ('31', 'controle', 'un compte rattaché à rien : la raison d''accès', 'inconnu', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('32', 'controle', 'le client sans droit, sur son dossier', 'client', 'aucun',
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('33', 'controle', 'le client avec « Banque » seul, sur son dossier', 'client', 'banque',
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('34', 'controle', 'le client avec « Ventes », sur un dossier où il n''a pas d''accès', 'client', 'ventes',
        $q$select a.id::text from public.declarer_adresse_reception('{DB}', 'siren', '987654321', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('35', 'controle', 'un membre du cabinet non affecté au dossier', 'membre', 'aucun',
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('36', 'controle', 'le super-administrateur, sur un dossier qui n''existe pas', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{INCONNUE}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('37', 'controle', 'l''accès passe avant la forme : le client sans droit, une maille inconnue', 'client', 'aucun',
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siret', 'n''importe quoi', '', null, null, null, null) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),

      -- ══ 40 à 53. Le rang 2 : la forme ══════════
      ('40', 'controle', 'une maille qui n''est pas de l''annuaire', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siret', '123456782_12345678200010', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'La maille de l''adresse est l''une des quatre de l''annuaire : SIREN, SIREN_SIRET, SIREN_SIRET_routage ou SIREN_suffixe.', null),
      ('41', 'controle', 'aucune maille', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', null, '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'La maille de l''adresse est l''une des quatre de l''annuaire : SIREN, SIREN_SIRET, SIREN_SIRET_routage ou SIREN_suffixe.', null),
      ('42', 'controle', 'maille SIREN : huit chiffres', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '12345678', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Une adresse à la maille SIREN est le SIREN, neuf chiffres.', null),
      ('43', 'controle', 'maille SIREN : aucun identifiant', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', null, 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Une adresse à la maille SIREN est le SIREN, neuf chiffres.', null),
      ('44', 'controle', 'maille SIREN : un SIREN suivi d''un SIRET — une autre maille', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782_12345678200010', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Une adresse à la maille SIREN est le SIREN, neuf chiffres.', null),
      ('45', 'controle', 'maille SIREN_SIRET : un SIRET de treize chiffres', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren_siret', '123456782_1234567820001', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Une adresse à la maille SIREN_SIRET s''écrit : les neuf chiffres du SIREN, « _ », les quatorze du SIRET.', null),
      ('46', 'controle', 'maille SIREN_SIRET_routage : une lettre accentuée dans le code', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren_siret_routage', '123456782_12345678200010_SERVICE-É', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Une adresse à la maille SIREN_SIRET_routage s''écrit : les neuf chiffres du SIREN, « _ », les quatorze du SIRET, « _ », puis un code de routage d''un à cent caractères — lettres sans accent, chiffres, « - », « _ », « / » ou « @ ».', null),
      ('47', 'controle', 'maille SIREN_SIRET_routage : un code de cent un caractères', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren_siret_routage', '123456782_12345678200010_' || repeat('r', 101), 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Une adresse à la maille SIREN_SIRET_routage s''écrit : les neuf chiffres du SIREN, « _ », les quatorze du SIRET, « _ », puis un code de routage d''un à cent caractères — lettres sans accent, chiffres, « - », « _ », « / » ou « @ ».', null),
      ('48', 'controle', 'maille SIREN_SIRET_routage : un point dans le code (admis dans un suffixe, pas dans un routage)', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren_siret_routage', '123456782_12345678200010_SERVICE.COMPTA', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Une adresse à la maille SIREN_SIRET_routage s''écrit : les neuf chiffres du SIREN, « _ », les quatorze du SIRET, « _ », puis un code de routage d''un à cent caractères — lettres sans accent, chiffres, « - », « _ », « / » ou « @ ».', null),
      ('49', 'controle', 'maille SIREN_suffixe : une barre oblique (admise dans un routage, pas dans un suffixe)', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren_suffixe', '123456782_FACTURES/ACHATS', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Une adresse à la maille SIREN_suffixe s''écrit : les neuf chiffres du SIREN, « _ », puis un suffixe d''un à cent caractères — lettres sans accent, chiffres, « - », « _ », « . » ou « @ ».', null),
      ('50', 'controle', 'maille SIREN_suffixe : un suffixe de cent un caractères', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren_suffixe', '123456782_' || repeat('s', 101), 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Une adresse à la maille SIREN_suffixe s''écrit : les neuf chiffres du SIREN, « _ », puis un suffixe d''un à cent caractères — lettres sans accent, chiffres, « - », « _ », « . » ou « @ ».', null),
      ('51', 'controle', 'maille SIREN_SIRET : un SIRET qui ne commence pas par le SIREN (G1.80)', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren_siret', '123456782_98765432100015', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Dans l''adresse, le SIRET ne commence pas par le SIREN : l''établissement doit être de cette entreprise.', null),
      ('52', 'controle', 'maille SIREN_SIRET_routage : de même (G1.80)', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren_siret_routage', '123456782_98765432100015_SERVICE', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Dans l''adresse, le SIRET ne commence pas par le SIREN : l''établissement doit être de cette entreprise.', null),
      ('53', 'controle', 'l''ordre : la forme (rang 2) passe avant le SIREN du dossier (rang 3) — un identifiant mal formé ET d''une autre entreprise', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren_siret', '987654321_1234567820001', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Une adresse à la maille SIREN_SIRET s''écrit : les neuf chiffres du SIREN, « _ », les quatorze du SIRET.', null),

      -- ══ 55 à 59. Le rang 3 : le SIREN du dossier ══════════
      ('55', 'controle', 'un dossier sans SIRET n''a pas de SIREN', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DC}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Le dossier n''a pas de SIREN : renseigner son SIRET avant de déclarer son adresse de réception.', null),
      ('56', 'controle', 'l''ordre : sans SIREN, un identifiant mal formé se dit d''abord', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DC}', 'siren', '12345', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Une adresse à la maille SIREN est le SIREN, neuf chiffres.', null),
      ('57', 'controle', 'une adresse d''une autre entreprise : le SIREN du dossier nommé', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '987654321', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'L''adresse doit commencer par le SIREN du dossier, 123456782.', null),
      ('58', 'controle', 'un SIRET de neuf chiffres est le SIREN lui-même (dossier B) ; une adresse du SIREN de A y est refusée', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DB}', 'siren_suffixe', '123456782_ACHATS', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'L''adresse doit commencer par le SIREN du dossier, 987654321.', null),
      ('59', 'controle', 'l''ordre : le SIREN (rang 3) passe avant la prise d''effet (rang 4)', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '987654321', 'PLATEFORME ESSAI', null, 'declaration', null, null) a$q$,
        '22023', 'L''adresse doit commencer par le SIREN du dossier, 123456782.', null),

      -- ══ 60 à 63. Le rang 4 : la prise d'effet ══════════
      ('60', 'controle', 'aucune date de prise d''effet', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', null, 'declaration', null, null) a$q$,
        '22023', 'La date de prise d''effet de l''adresse est à renseigner.', null),
      ('61', 'controle', 'une prise d''effet au 31/12/1999 (G1.36)', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '1999-12-31', 'declaration', null, null) a$q$,
        '22023', 'La date de prise d''effet de l''adresse est comprise entre 2000 et 2099.', null),
      ('62', 'controle', 'une prise d''effet au 01/01/2100 (G1.36)', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2100-01-01', 'declaration', null, null) a$q$,
        '22023', 'La date de prise d''effet de l''adresse est comprise entre 2000 et 2099.', null),
      ('63', 'controle', 'l''ordre : la prise d''effet (rang 4) passe avant la plateforme (rang 5)', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', '   ', date '1999-12-31', 'declaration', null, null) a$q$,
        '22023', 'La date de prise d''effet de l''adresse est comprise entre 2000 et 2099.', null),

      -- ══ 64 à 68. Le rang 5 : la plateforme ══════════
      ('64', 'controle', 'aucune plateforme', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', null, date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Le nom de la plateforme de réception est à renseigner.', null),
      ('65', 'controle', 'une plateforme faite de blancs', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', E' \t\n ', date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Le nom de la plateforme de réception est à renseigner.', null),
      ('66', 'controle', 'une plateforme de cent caractères (DT-6-6 et DT-6-7 : 99)', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', repeat('p', 100), date '2026-09-01', 'declaration', null, null) a$q$,
        '22023', 'Le nom de la plateforme de réception tient en 99 caractères au plus.', null),
      ('67', 'controle', 'l''ordre : la plateforme (rang 5) passe avant la vérification (rang 6)', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', null, date '2026-09-01', 'annuaire', null, null) a$q$,
        '22023', 'Le nom de la plateforme de réception est à renseigner.', null),

      -- ══ 70 à 76. Le rang 6 : la vérification ══════════
      ('70', 'controle', 'une source de vérification inconnue', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'annuaire', date '2026-09-01', null) a$q$,
        '22023', 'La vérification se fait sur le portail de l''annuaire ou sur la plateforme, ou l''adresse est déclarée sans vérification.', null),
      ('71', 'controle', 'aucune source de vérification', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', null, null, null) a$q$,
        '22023', 'La vérification se fait sur le portail de l''annuaire ou sur la plateforme, ou l''adresse est déclarée sans vérification.', null),
      ('72', 'controle', 'déclarée sans vérification, mais datée', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', date '2026-09-01', null) a$q$,
        '22023', 'Une adresse déclarée sans vérification n''a pas de jour de vérification.', null),
      ('73', 'controle', 'vérifiée sur le portail, sans jour', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'portail_annuaire', null, null) a$q$,
        '22023', 'Le jour de la vérification est à renseigner.', null),
      ('74', 'controle', 'vérifiée sur la plateforme au 31/12/1999', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'plateforme', date '1999-12-31', null) a$q$,
        '22023', 'Le jour de la vérification est compris entre le 01/01/2000 et aujourd''hui.', null),
      ('75', 'controle', 'vérifiée demain : une vérification ne se date pas dans l''avenir, à Paris', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'portail_annuaire', date '{DEMAIN}', null) a$q$,
        '22023', 'Le jour de la vérification est compris entre le 01/01/2000 et aujourd''hui.', null),
      ('76', 'controle', 'l''ordre : la vérification (rang 6) passe avant la version remplacée (rang 7)', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'plateforme', null, '{INCONNUE}') a$q$,
        '22023', 'Le jour de la vérification est à renseigner.', null),

      -- ══ 77 à 79. Le rang 7 : la version remplacée ══════════
      ('77', 'controle', 'une adresse à remplacer qui n''existe pas', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, '{INCONNUE}') a$q$,
        '22023', 'L''adresse à remplacer n''est pas une adresse de réception de ce dossier.', null),
      ('78', 'fait', 'le chef déclare l''adresse du dossier B', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DB}', 'siren', '987654321', 'PLATEFORME B', date '2026-09-01', 'declaration', null, null) a$q$,
        'OK', null, 'ADRB'),
      ('79', 'controle', 'une adresse à remplacer qui est celle d''un autre dossier', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, '{ADRB}') a$q$,
        '22023', 'L''adresse à remplacer n''est pas une adresse de réception de ce dossier.', null),

      -- ══ 80 à 89. Les déclarations, et la chaîne des versions ══════════
      ('80', 'fait', 'le client qui porte « Ventes » déclare la première adresse de A, vérifiée sur le portail aujourd''hui', 'client', 'ventes',
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren_siret', '123456782_12345678200010', 'PLATEFORME ESSAI', date '2026-09-01', 'portail_annuaire', date '{AUJOURDHUI}', null) a$q$,
        'OK', null, 'ADR1'),
      ('81', 'valeur', 'ce que la fonction a écrit, champ par champ, signé du client', 'proprietaire', null,
        $q$select dossier_id || '|' || forme || '|' || identifiant || '|' || plateforme || '|' || prise_effet || '|' || verification || '|' || verifiee_le
               || '|' || coalesce(remplace_id::text, 'premiere') || '|' || (auteur = '{CLIENT}') || '|' || (cree_le = now())
             from adresses_reception where id = '{ADR1}'$q$,
        'OK', '{DA}|siren_siret|123456782_12345678200010|PLATEFORME ESSAI|2026-09-01|portail_annuaire|{AUJOURDHUI}|premiere|true|true', null),
      ('82', 'controle', 'une seconde PREMIÈRE déclaration : la courante est nommée', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME DEUX', date '2026-11-01', 'declaration', null, null) a$q$,
        '22023', 'Une autre adresse a été déclarée entre-temps (« 123456782_12345678200010 », le {JOUR_FR}) : relire avant de déclarer.', null),
      ('83', 'fait', 'le chef remplace la courante : une adresse au SIREN, déclarée sans vérification, qui prend effet plus tard', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME DEUX', date '2026-11-01', 'declaration', null, '{ADR1}') a$q$,
        'OK', null, 'ADR2'),
      ('84', 'controle', 'remplacer une version qui ne l''est plus : la courante est nommée', 'client', 'ventes',
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME TROIS', date '2026-10-01', 'declaration', null, '{ADR1}') a$q$,
        '22023', 'Une autre adresse a été déclarée entre-temps (« 123456782 », le {JOUR_FR}) : relire avant de déclarer.', null),
      ('85', 'fait', 'le client qui porte « Ventes » remplace la courante : une adresse à suffixe, vérifiée sur la plateforme', 'client', 'ventes',
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren_suffixe', '123456782_FACTURES.achats-1@siege', 'PLATEFORME TROIS', date '2026-10-01', 'plateforme', date '{AUJOURDHUI}', '{ADR2}') a$q$,
        'OK', null, 'ADR3'),
      ('86', 'controle', 'une adresse au code de routage, « / » et « @ » compris, remplace la courante', 'chef', null,
        $q$select a.identifiant from public.declarer_adresse_reception('{DA}', 'siren_siret_routage', '123456782_12345678200010_SERVICE/compta@2', 'PLATEFORME ESSAI', date '2026-09-01', 'plateforme', date '2000-01-01', '{ADR3}') a$q$,
        'OK', '123456782_12345678200010_SERVICE/compta@2', null),
      ('87', 'controle', 'un membre du cabinet affecté au dossier B y remplace l''adresse', 'membre_affecte', 'aucun',
        $q$select (a.auteur = '{CLIENT}')::text from public.declarer_adresse_reception('{DB}', 'siren_suffixe', '987654321_VENTES', 'PLATEFORME B', date '2026-10-01', 'declaration', null, '{ADRB}') a$q$,
        'OK', 'true', null),
      ('88', 'fait', 'le SIREN d''un SIRET écrit avec des espaces insécables (dossier D) : celui que l''application lit', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DD}', 'siren', '123456782', 'PLATEFORME D', date '2026-09-01', 'declaration', null, null) a$q$,
        'OK', null, 'ADRD'),
      ('89', 'valeur', 'la chaîne de A : trois versions, une seule courante, chacune signée', 'proprietaire', null,
        $q$select (select count(*) from adresses_reception where dossier_id = '{DA}') || '/'
               || (select string_agg(id::text, ',') from adresses_reception a where dossier_id = '{DA}'
                     and not exists (select 1 from adresses_reception s where s.remplace_id = a.id)) || '/'
               || (select string_agg(coalesce(remplace_id::text, 'premiere') || '>' || (auteur = '{CHEF}'), ',' order by cree_le, id::text)
                     from adresses_reception where dossier_id = '{DA}' and id = '{ADR2}')$q$,
        'OK', '3/{ADR3}/{ADR1}>true', null),

      -- ══ 90 à 94. Ce que l'état rend de l'adresse, et ce que chacun lit de la table ══════════
      ('90', 'valeur', 'l''état rend l''adresse COURANTE, champ par champ', 'client', 'ventes',
        $q$select (e -> 'adresse' ->> 'id') || '|' || (e -> 'adresse' ->> 'forme') || '|' || (e -> 'adresse' ->> 'identifiant') || '|' || (e -> 'adresse' ->> 'plateforme')
               || '|' || (e -> 'adresse' ->> 'prise_effet') || '|' || (e -> 'adresse' ->> 'verification') || '|' || (e -> 'adresse' ->> 'verifiee_le')
               || '|' || ((e -> 'adresse' ->> 'auteur') = '{CLIENT}') || '|' || ((e -> 'adresse' ->> 'cree_le')::timestamptz = now())
             from (select public.etat_facture_electronique('{DA}') as e) x$q$,
        'OK', '{ADR3}|siren_suffixe|123456782_FACTURES.achats-1@siege|PLATEFORME TROIS|2026-10-01|plateforme|{AUJOURDHUI}|true|true', null),
      ('91', 'valeur', 'sa FORME, l''adresse déclarée : chaque clé, chaque type', 'chef', null,
        $q$select (select string_agg(k || '=' || jsonb_typeof(e -> 'adresse' -> k), ',' order by k collate "C") from jsonb_object_keys(e -> 'adresse') k)
             from (select public.etat_facture_electronique('{DA}') as e) x$q$,
        'OK', 'auteur=string,cree_le=string,forme=string,id=string,identifiant=string,plateforme=string,prise_effet=string,verification=string,verifiee_le=string', null),
      ('92', 'valeur', 'déclarée sans vérification : son jour de vérification est nul, la clé là', 'chef', null,
        $q$select ((e -> 'adresse') ? 'verifiee_le')::text || '/' || jsonb_typeof(e -> 'adresse' -> 'verifiee_le') || '/' || (e -> 'adresse' ->> 'verification')
             from (select public.etat_facture_electronique('{DD}') as e) x$q$,
        'OK', 'true/null/declaration', null),
      ('93', 'valeur', 'le client qui porte « Ventes » lit toute l''histoire de son dossier, rien d''un autre', 'client', 'ventes',
        $q$select (select count(*) from adresses_reception where dossier_id = '{DA}') || '/' || (select count(*) from adresses_reception where dossier_id <> '{DA}')$q$,
        'OK', '3/0', null),
      ('93b', 'valeur', 'le client sans droit n''en lit rien, pas même de son dossier', 'client', 'aucun',
        $q$select count(*)::text from adresses_reception$q$, 'OK', '0', null),
      ('93c', 'valeur', 'le client avec « Banque » seul non plus', 'client', 'banque',
        $q$select count(*)::text from adresses_reception$q$, 'OK', '0', null),
      ('93d', 'valeur', 'un compte rattaché à rien n''en lit rien', 'inconnu', null,
        $q$select count(*)::text from adresses_reception$q$, 'OK', '0', null),
      ('93e', 'valeur', 'l''anonyme n''en lit rien', 'anon', null,
        $q$select count(*)::text from adresses_reception$q$, 'OK', '0', null),
      ('94', 'valeur', 'un membre du cabinet affecté au dossier B lit celle de B, et elle seule', 'membre_affecte', 'aucun',
        $q$select (select count(*) from adresses_reception where dossier_id = '{DB}') || '/' || (select count(*) from adresses_reception where dossier_id <> '{DB}')$q$,
        'OK', '1/0', null),
      ('94b', 'valeur', 'un membre du cabinet non affecté n''en lit rien', 'membre', 'aucun',
        $q$select count(*)::text from adresses_reception$q$, 'OK', '0', null),
      ('94c', 'valeur', 'le chef du cabinet lit celles des dossiers jetables', 'chef', null,
        $q$select count(*)::text from adresses_reception where dossier_id in ('{DA}', '{DB}', '{DC}', '{DD}')$q$, 'OK', '5', null),

      -- ══ 95 à 113. Aucune écriture directe ; la garde ; les contraintes de la table ══════════
      ('95', 'controle', 'le client qui porte « Ventes » n''insère pas directement : refus de la RLS', 'client', 'ventes',
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, remplace_id, auteur)
           values ('{DA}', 'siren', '123456782', 'DIRECT', '2026-09-01', 'declaration', '{ADR3}', '{CLIENT}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('96', 'controle', 'un membre du cabinet affecté non plus', 'membre_affecte', 'aucun',
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, remplace_id, auteur)
           values ('{DB}', 'siren', '987654321', 'DIRECT', '2026-09-01', 'declaration', '{ADRB}', '{CLIENT}')$q$,
        '42501', 'new row violates row-level security policy%', null),
      ('97', 'controle', 'une mise à jour du client « Ventes » ne touche aucune ligne', 'client', 'ventes',
        $q$with u as (update adresses_reception set plateforme = plateforme where dossier_id = '{DA}' returning 1) select count(*)::text from u$q$,
        'OK', '0', null),
      ('98', 'controle', 'une mise à jour du cabinet non plus : aucune policy ne l''ouvre', 'chef', null,
        $q$with u as (update adresses_reception set plateforme = plateforme where dossier_id = '{DA}' returning 1) select count(*)::text from u$q$,
        'OK', '0', null),
      ('99', 'controle', 'le propriétaire ne modifie pas une adresse déclarée : la garde', 'proprietaire', null,
        $q$with u as (update adresses_reception set plateforme = 'MODIFIEE' where id = '{ADR3}' returning 1) select count(*)::text from u$q$,
        '23514', 'Une adresse de réception déclarée ne se modifie pas : une nouvelle déclaration la remplace.', null),
      ('100', 'controle', 'une version qui en remplace une d''un autre dossier : la garde', 'proprietaire', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, remplace_id, auteur)
           values ('{DA}', 'siren', '123456782', 'DIRECT', '2026-09-01', 'declaration', '{ADRB}', '{CHEF}')$q$,
        '23514', 'Une adresse de réception en remplace une de son dossier.', null),
      ('101', 'controle', 'une seconde première version du dossier : l''index de la première', 'proprietaire', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, auteur)
           values ('{DA}', 'siren', '123456782', 'DIRECT', '2026-09-01', 'declaration', '{CHEF}')$q$,
        '23505', '%adresses_reception_une_premiere%', null),
      ('102', 'controle', 'une version déjà remplacée ne se remplace plus : la contrainte de la suite', 'proprietaire', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, remplace_id, auteur)
           values ('{DA}', 'siren', '123456782', 'DIRECT', '2026-09-01', 'declaration', '{ADR1}', '{CHEF}')$q$,
        '23505', '%adresses_reception_une_suite%', null),
      ('103', 'controle', 'une maille inconnue', 'proprietaire', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, remplace_id, auteur)
           values ('{DA}', 'siret', '123456782', 'DIRECT', '2026-09-01', 'declaration', '{ADR3}', '{CHEF}')$q$,
        '23514', '%"adresses_reception_forme"%', null),
      ('104', 'controle', 'un identifiant qui n''a pas la forme de sa maille', 'proprietaire', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, remplace_id, auteur)
           values ('{DA}', 'siren_siret', '123456782', 'DIRECT', '2026-09-01', 'declaration', '{ADR3}', '{CHEF}')$q$,
        '23514', '%"adresses_reception_identifiant"%', null),
      ('105', 'controle', 'un SIRET d''une autre entreprise (G1.80)', 'proprietaire', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, remplace_id, auteur)
           values ('{DA}', 'siren_siret_routage', '123456782_98765432100015_SERVICE', 'DIRECT', '2026-09-01', 'declaration', '{ADR3}', '{CHEF}')$q$,
        '23514', '%"adresses_reception_identifiant"%', null),
      ('106', 'controle', 'une plateforme de cent caractères', 'proprietaire', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, remplace_id, auteur)
           values ('{DA}', 'siren', '123456782', repeat('p', 100), '2026-09-01', 'declaration', '{ADR3}', '{CHEF}')$q$,
        '23514', '%"adresses_reception_plateforme"%', null),
      ('107', 'controle', 'une plateforme faite de blancs', 'proprietaire', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, remplace_id, auteur)
           values ('{DA}', 'siren', '123456782', E' \t', '2026-09-01', 'declaration', '{ADR3}', '{CHEF}')$q$,
        '23514', '%"adresses_reception_plateforme"%', null),
      ('108', 'controle', 'une prise d''effet au 31/12/1999', 'proprietaire', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, remplace_id, auteur)
           values ('{DA}', 'siren', '123456782', 'DIRECT', '1999-12-31', 'declaration', '{ADR3}', '{CHEF}')$q$,
        '23514', '%"adresses_reception_prise_effet"%', null),
      ('109', 'controle', 'une source de vérification inconnue', 'proprietaire', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, verifiee_le, remplace_id, auteur)
           values ('{DA}', 'siren', '123456782', 'DIRECT', '2026-09-01', 'annuaire', '2026-09-01', '{ADR3}', '{CHEF}')$q$,
        '23514', '%"adresses_reception_verification"%', null),
      ('110', 'controle', 'déclarée sans vérification, mais datée', 'proprietaire', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, verifiee_le, remplace_id, auteur)
           values ('{DA}', 'siren', '123456782', 'DIRECT', '2026-09-01', 'declaration', '2026-09-01', '{ADR3}', '{CHEF}')$q$,
        '23514', '%"adresses_reception_verification_datee"%', null),
      ('111', 'controle', 'vérifiée sur le portail au 31/12/1999', 'proprietaire', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, verifiee_le, remplace_id, auteur)
           values ('{DA}', 'siren', '123456782', 'DIRECT', '2026-09-01', 'portail_annuaire', '1999-12-31', '{ADR3}', '{CHEF}')$q$,
        '23514', '%"adresses_reception_verifiee_le"%', null),
      ('112', 'controle', 'sans auteur', 'proprietaire', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, remplace_id)
           values ('{DA}', 'siren', '123456782', 'DIRECT', '2026-09-01', 'declaration', '{ADR3}')$q$,
        '23502', '%"auteur"%', null),
      ('113', 'controle', 'une ligne de sauvegarde complète — identifiant, auteur, instant — se réinsère telle quelle à la suite de la courante', 'proprietaire', null,
        $q$insert into adresses_reception (id, dossier_id, forme, identifiant, plateforme, prise_effet, verification, verifiee_le, remplace_id, auteur, cree_le)
           values ('a6a60000-0000-4000-8000-0000000000f1', '{DA}', 'siren_siret', '123456782_12345678200010', 'RESTAUREE', '2026-09-01', 'portail_annuaire', '2026-09-30',
                   '{ADR3}', '{CLIENT}', '2026-09-30 10:00:00+00')
           returning (id = 'a6a60000-0000-4000-8000-0000000000f1') || '/' || (cree_le = '2026-09-30 10:00:00+00') || '/' || (auteur = '{CLIENT}')$q$,
        'OK', 'true/true/true', null),
      ('114', 'controle', 'le super-administrateur insère par la porte de la restauration (contrôle positif de la policy)', 'chef', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, remplace_id, auteur)
           values ('{DA}', 'siren', '123456782', 'RESTAUREE', '2026-09-01', 'declaration', '{ADR3}', '{CLIENT}') returning forme$q$,
        'OK', 'siren', null),

      -- ══ Les mutations ══════════
      ('M1', 'mutation', 'le contrôle 12 rejoué avec « Ventes » : il lit l''état', 'client', 'ventes',
        $q$select public.etat_facture_electronique('{DA}') ->> 'superpdp'$q$, 'OK', null, null),
      ('M2', 'mutation', 'le contrôle 14 rejoué sur le dossier du client : il lit l''état', 'client', 'ventes',
        $q$select public.etat_facture_electronique('{DA}') ->> 'plateforme'$q$, 'OK', null, null),
      ('M3', 'mutation', 'le contrôle 16 rejoué sur le dossier du membre : il lit l''état', 'membre_affecte', 'aucun',
        $q$select public.etat_facture_electronique('{DB}') ->> 'superpdp'$q$, 'OK', null, null),
      ('M4', 'mutation', 'le contrôle 31 rejoué par le chef : il déclare', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, '{ADR3}') a$q$,
        'OK', null, null),
      ('M5', 'mutation', 'le contrôle 57 rejoué avec le SIREN du dossier : il déclare', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, '{ADR3}') a$q$,
        'OK', null, null),
      ('M6', 'mutation', 'le contrôle 75 rejoué vérifié aujourd''hui : il déclare', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'portail_annuaire', date '{AUJOURDHUI}', '{ADR3}') a$q$,
        'OK', null, null),
      ('M7', 'mutation', 'le contrôle 61 rejoué au 01/01/2000 : il déclare', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2000-01-01', 'declaration', null, '{ADR3}') a$q$,
        'OK', null, null),
      ('M8', 'mutation', 'le contrôle 66 rejoué à quatre-vingt-dix-neuf caractères : il déclare', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', repeat('p', 99), date '2026-09-01', 'declaration', null, '{ADR3}') a$q$,
        'OK', null, null),
      ('M9', 'mutation', 'le contrôle 84 rejoué sur la courante : il déclare', 'client', 'ventes',
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren', '123456782', 'PLATEFORME TROIS', date '2026-10-01', 'declaration', null, '{ADR3}') a$q$,
        'OK', null, null),
      ('M10', 'mutation', 'la recherche du contrôle 24, appliquée à un état qui laisserait passer le secret de la plateforme : elle le trouve', 'proprietaire', null,
        $q$with t as (select j, j::text as x from (select jsonb_build_object('plateforme', jsonb_build_object('reliee', true, 'nom', c.nom, 'fuite', c.client_secret)) as j
                                                      from connexions_plateformes c where c.dossier_id = '{DA}') e),
                plantees(v) as (values ('ZQX-IDENTIFIANT-0001'), ('ZQX-SECRET-0002'), ('ZQX-ORGANISATION-0003'), ('zqx-portee-1 zqx-portee-2'),
                  ('https://zqx-flux.exemple.invalid/zqx-flux'), ('https://zqx-jeton.exemple.invalid/zqx-jeton'),
                  ('ZQX-SPDP-IDENTIFIANT-0004'), ('ZQX-SPDP-SECRET-0005'))
           select coalesce(string_agg(trouve, ', ' order by trouve), 'aucun') from (
             select 'la valeur ' || v as trouve from plantees, t where position(lower(v) in lower(t.x)) > 0
             union all select 'le md5 de ' || v from plantees, t where position(md5(v) in t.x) > 0
             union all select 'le sha256 de ' || v from plantees, t where position(encode(sha256(convert_to(v, 'UTF8')), 'hex') in t.x) > 0
             union all select 'le motif ' || m from (values ('zqx'), ('https'), ('exemple.invalid'), ('{CREATEUR}'), ('2026-09-02'),
                 ('2026-09-03'), ('2026-09-15'), ('2026-09-20')) as w(m), t where position(m in lower(t.x)) > 0
             union all select 'un nombre' from t where jsonb_path_exists(t.j, '$.** ? (@.type() == "number")')) z$q$,
        'OK', '%la valeur ZQX-SECRET-0002%', null),
      ('M11', 'mutation', 'la recherche du contrôle 24, appliquée à un état qui rendrait la LONGUEUR du secret : elle la trouve', 'proprietaire', null,
        $q$select case when jsonb_path_exists(j, '$.** ? (@.type() == "number")') then 'un nombre' else 'aucun' end
             from (select jsonb_build_object('plateforme', jsonb_build_object('reliee', true, 'longueur', length(c.client_secret))) as j
                     from connexions_plateformes c where c.dossier_id = '{DA}') e$q$,
        'OK', 'un nombre', null),
      ('M12', 'mutation', 'la forme du contrôle 22, appliquée à un état qui porterait une clé de plus : elle la voit', 'proprietaire', null,
        $q$select (select string_agg(k || '=' || jsonb_typeof(e -> 'plateforme' -> k), ',' order by k collate "C") from jsonb_object_keys(e -> 'plateforme') k)
             from (select jsonb_build_object('plateforme', jsonb_build_object('reliee', true, 'nom', 'X', 'creee_le', 'x', 'derniere_recuperation', 'x',
                                                                             'statuts_lus_le', 'x', 'portee', 'x')) as e) x$q$,
        'OK', 'creee_le=string,derniere_recuperation=string,nom=string,portee=string,reliee=boolean,statuts_lus_le=string', null),
      ('M13', 'mutation', 'le contrôle 93b rejoué avec « Ventes » : il lit l''histoire de son dossier', 'client', 'ventes',
        $q$select count(*)::text from adresses_reception$q$, 'OK', '3', null),
      ('M14', 'mutation', 'le contrôle 95 rejoué par le chef : la porte de la restauration le laisse passer', 'chef', null,
        $q$insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, remplace_id, auteur)
           values ('{DA}', 'siren', '123456782', 'DIRECT', '2026-09-01', 'declaration', '{ADR3}', '{CLIENT}')$q$,
        'OK', null, null),
      ('M15', 'mutation', 'le contrôle 55 rejoué sur le dossier D : son SIRET donne un SIREN', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DD}', 'siren', '123456782', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, '{ADRD}') a$q$,
        'OK', null, null),
      ('M16', 'mutation', 'le contrôle 51 rejoué avec un SIRET de l''entreprise : il déclare', 'chef', null,
        $q$select a.id::text from public.declarer_adresse_reception('{DA}', 'siren_siret', '123456782_12345678200010', 'PLATEFORME ESSAI', date '2026-09-01', 'declaration', null, '{ADR3}') a$q$,
        'OK', null, null)
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
        -- annulée l'emporte) — affecté au dossier B, ou à aucun.
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
          if partie ~* '^\s*insert' and partie !~* 'returning' then
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
    ((select count(*) from dossier_assignations)), ((select count(*) from adresses_reception)),
    ((select count(*) from connexions_plateformes)), ((select count(*) from superpdp_credentials))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '999. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || avant || ' -> ' || apres, 'ok', erreur is null and avant = apres);
  perform set_config('essai.etat_facture_electronique', verdicts::text, true);
end
$essai$;

-- Les verdicts, et une ligne d'INFORMATION : le texte que la base a reçu, sa longueur et son empreinte — sans le
-- commentaire que l'outil d'exécution ajoute à la fin —, à confronter à la copie transmise (sous psql, qui envoie les
-- instructions une à une, elle ne voit que cette requête-ci).
select x.genre, x.controle, x.verdict, x.observe from (
  select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                   else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
  from jsonb_to_recordset(current_setting('essai.etat_facture_electronique')::jsonb) as v(controle text, genre text, ok boolean, observe text)
  union all
  select 'information', '0. le texte reçu par la base', 'information', length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by x.genre desc, (regexp_match(x.controle, '^M?(\d+)'))[1]::int, x.controle;
