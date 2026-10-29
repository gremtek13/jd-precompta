-- LES ARTICLES, ÉPROUVÉS EN BASE (espace client, étape A1) — à rejouer par `execute_sql` après toute migration qui touche
-- la migration `articles`, `enregistrer_article`, `retirer_article`, `reprendre_article`, `memberships`,
-- `client_du_dossier`, `gere_les_ventes` ou `admin_du_dossier`.
--
-- Ce qui se prouve ici, par impersonation — anonyme, compte rattaché à rien, le client de l'essai sans droit, avec
-- « Banque » seul, avec « Ventes », avec les deux, sur SON dossier ou sur un autre, un membre du cabinet affecté ou non au
-- dossier, le chef du cabinet (super-administrateur), et le propriétaire de la base :
--   - LE CATALOGUE : la table sous RLS, ses trois policies (lecture du cabinet, lecture du droit « Ventes », insertion de
--     restauration) et leurs prédicats, aucune autre ; ses colonnes ; l'unicité TOTALE de la référence, aucun index
--     partiel, aucun déclencheur ; les trois fonctions SECURITY DEFINER, au chemin fixé, fermées à l'anonyme et à PUBLIC,
--     et qui vérifient l'accès AVANT toute autre chose ;
--   - QUI ÉCRIT : le cabinet (le chef, un membre affecté au dossier) et le client qui porte « Ventes », par les mêmes
--     fonctions, chaque article signé de son auteur ; sans le droit, avec « Banque » seul, sur un autre dossier, membre du
--     cabinet non affecté, ou sur un dossier qui n'existe pas, la RAISON d'accès (« Accès refusé à ce dossier. », 42501) —
--     qui passe avant « introuvable » ;
--   - LES REFUS D'`enregistrer_article`, chacun sous ses mots, et leur ORDRE (neuf rangs : l'accès, l'article du dossier,
--     un article retiré, la désignation et sa description, la référence — sa forme puis son unicité, l'article qui la
--     porte nommé, dit retiré s'il l'est —, l'unité, le prix, le taux, la nature) ; ce que la fonction écrit, l'unité
--     générique quand elle manque ;
--   - LE RETRAIT ET LA REPRISE : leurs refus dans l'ordre, qui les a faits ; un article retiré ne se modifie pas, garde sa
--     référence et se reprend ;
--   - CE QUE LE CLIENT LIT : avec « Ventes », tous les articles de son dossier, retirés et auteurs compris ; sans le droit
--     ou avec « Banque » seul, aucun, pas même de son dossier ; jamais ceux d'un autre dossier ;
--   - AUCUNE ÉCRITURE DIRECTE : une insertion refusée par la RLS (42501) — sauf la porte de la restauration, au
--     super-administrateur —, une mise à jour qui ne touche aucune ligne, pour le client comme pour le cabinet ;
--   - LES CONTRAINTES DE LA TABLE disent la même chose que la fonction, pour ce que la restauration réinsère ;
--   - et que RIEN ne reste en base.
--
-- SANS LA MIGRATION `articles`, une seule ligne la dit, « EN ATTENTE », SANS être une faute : la migration est présentée au
-- cabinet avant d'être appliquée, et une base qui ne la porte pas se rejoue aussi. Elle EN EST UNE si l'historique des
-- migrations porte `articles` sans que la table existe — sauf si une ligne `retour_articles`, plus récente, dit son
-- retour arrière. AVANT LES MIGRATIONS DE L'ÉTAPE P2, l'essai se dit impossible : la migration `articles` les exige.
--
-- Tout se joue dans deux dossiers JETABLES du cabinet du chef (A, où le client de l'essai a un accès d'essai, et B, où il
-- n'en a pas), au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) : chaque contrôle dans sa
-- sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE avant ; les étapes
-- « fait » sont gardées jusqu'à l'annulation finale, et une étape peut rendre un identifiant que les suivantes citent
-- (`{CLE}`). Un refus se juge à son code ET à son message (`like` : « \% » pour un signe pour cent). Les droits de l'accès
-- d'essai se posent avant chaque étape qui les nomme ; le membre du cabinet est le compte du client, rangé au cabinet le
-- temps de son contrôle. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.articles`) : le fichier se
-- joue d'un seul appel, ne crée aucune table et ne porte AUCUNE instruction de suppression — aucune policy n'en ouvre
-- (contrôle 0a), et un article ne se supprime pas. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil, un droit ou une cible délibérément faux : chacune
-- doit MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait.
--
-- src/lib/articles.test.ts lit les étapes ici : chaque refus que src/lib/articles.ts redit avant le clic doit y être exigé
-- de la base, sous les mêmes mots, et chaque écriture de l'essai, rejouée dans le module, y reçoit le même premier refus,
-- ou aucun.
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
  if to_regclass('public.articles') is null then
    select max(version) filter (where name = 'articles'), max(version) filter (where name = 'retour_articles')
      into applique, retour from supabase_migrations.schema_migrations;
    verdicts := verdicts || jsonb_build_object('controle', '0. EN ATTENTE : la migration articles (étape A1) n''est pas en base',
      'genre', 'controle',
      'observe', 'historique : ' || coalesce('articles ' || applique, 'sans articles') || coalesce(', retour_articles ' || retour, ''),
      'ok', applique is null or (retour is not null and retour > applique));
    perform set_config('essai.articles', verdicts::text, true);
    return;
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.factures_emises'::regclass and attname = 'valide_par'
                  and not attisdropped)
     or to_regprocedure('public.supprimer_brouillon_facture(uuid, uuid)') is null then
    raise exception 'ESSAI_IMPOSSIBLE : les migrations de l''étape P2 (ventes_du_client, ventes_du_client_facturation) ne sont pas en base';
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
    'DA', 'a1a10000-0000-4000-8000-0000000000a1', 'DB', 'a1a10000-0000-4000-8000-0000000000b1',
    'ACCES', 'a1a10000-0000-4000-8000-0000000000c1', 'INCONNUE', gen_random_uuid());

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from articles))
  ) as t(n);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre(s), code attendu ou OK, message ou valeur attendus, clé)
      -- genre : « jeu » (posé par le propriétaire, gardé), « controle » (annulé), « fait » (gardé), « valeur » (lecture
      -- par le propriétaire), « mutation » (un contrôle rejoué à faux, qui doit rendre l'inverse). Plusieurs ordres se
      -- séparent par « §§ » ; {RENDU} y vaut ce que le précédent a rendu ; la clé garde ce que l'étape a rendu.
      -- qui : anon, inconnu, client, chef, proprietaire, membre (le compte du client rangé au cabinet, non affecté),
      -- membre_affecte (le même, affecté au dossier B).

      -- ══ Le jeu : deux dossiers jetables, un accès d'essai sans droit ══════════
      -- A naît basculé : « Ventes » ne se porte que sur un accès d'un dossier dont les factures sont la source de leurs
      -- ventes (garder_droit_ventes, étape VF8f) ; ses articles n'en dépendent pas.
      ('j1', 'jeu', 'dossiers jetables A et B', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, ventes_par_les_factures) values
          ('{DA}', 'ESSAI ARTICLES A', '{CAB}', 'redevable', true, true), ('{DB}', 'ESSAI ARTICLES B', '{CAB}', 'redevable', true, false)$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-articles@exemple.invalid')$q$, 'OK', null, null),

      -- ══ 0. Le catalogue ══════════
      ('0a', 'valeur', 'la table sous RLS, ses trois policies : lecture du cabinet, lecture du droit « Ventes », insertion de restauration ; aucune autre', 'proprietaire', null,
        $q$select c.relname || ':' || c.relrowsecurity || ':' || coalesce((select string_agg(p.polname || '/' || p.polcmd::text || '/' || p.polpermissive || '/'
                 || array_to_string(p.polroles::regrole[]::text[], ','), ',' order by p.polname) from pg_policy p where p.polrelid = c.oid), 'aucune')
             from pg_class c where c.oid = 'public.articles'::regclass$q$,
        'OK', 'articles:true:articles_lecture/r/true/authenticated,articles_lecture_ventes/r/true/authenticated,articles_restauration/a/true/authenticated', null),
      ('0b', 'valeur', 'leurs prédicats : le cabinet du dossier, l''accès qui porte « Ventes », le super-administrateur', 'proprietaire', null,
        $q$select string_agg(p.polname || '=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), ' ; ' order by p.polname)
             from pg_policy p where p.polrelid = 'public.articles'::regclass$q$,
        'OK', 'articles_lecture=admin_du_dossier(dossier_id)| ; articles_lecture_ventes=client_du_dossier(dossier_id, ''ventes''::text)| ; articles_restauration=|is_super_admin()', null),
      ('0c', 'valeur', 'les trois fonctions : security definer, search_path fixé ; ni anon ni PUBLIC ne les exécutent', 'proprietaire', null,
        $q$select string_agg(p.proname || ' ' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',') || ' anon ' || has_function_privilege('anon', p.oid, 'execute')
               || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
               || ' public ' || exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'), ' | ' order by p.proname)
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('enregistrer_article', 'retirer_article', 'reprendre_article')$q$,
        'OK', 'enregistrer_article true search_path=public anon false authenticated true public false | reprendre_article true search_path=public anon false authenticated true public false | retirer_article true search_path=public anon false authenticated true public false', null),
      ('0d', 'valeur', 'chacune vérifie l''accès au dossier annoncé — et qu''il existe — AVANT toute autre chose', 'proprietaire', null,
        $q$select string_agg(p.proname || '=' || (regexp_replace(split_part(split_part(replace(p.prosrc, E'\r\n', E'\n'), E'\nbegin\n', 2), ';', 1), '\s+', ' ', 'g')
               = ' if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then raise exception ''Accès refusé à ce dossier.'' using errcode = ''42501''')::text, ',' order by p.proname)
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('enregistrer_article', 'retirer_article', 'reprendre_article')$q$,
        'OK', 'enregistrer_article=true,reprendre_article=true,retirer_article=true', null),
      ('0e', 'valeur', 'la référence unique par une contrainte TOTALE ; aucun index partiel ; aucun déclencheur', 'proprietaire', null,
        $q$select pg_get_constraintdef(co.oid) || ' ; index partiels ' || (select count(*) from pg_index i where i.indrelid = 'public.articles'::regclass and i.indpred is not null)
               || ' ; déclencheurs ' || (select count(*) from pg_trigger t where t.tgrelid = 'public.articles'::regclass and not t.tgisinternal)
             from pg_constraint co where co.conrelid = 'public.articles'::regclass and co.conname = 'articles_reference_unique'$q$,
        'OK', 'UNIQUE (dossier_id, reference) ; index partiels 0 ; déclencheurs 0', null),
      ('0f', 'valeur', 'les colonnes que le client « Ventes » lit, dans leur ordre (« ! » : non nulle)', 'proprietaire', null,
        $q$select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
             from pg_attribute a where a.attrelid = 'public.articles'::regclass and a.attnum > 0 and not a.attisdropped$q$,
        'OK', 'id:uuid!,dossier_id:uuid!,reference:text,designation:text!,description:text,unite:text!,prix_unitaire_ht:numeric!,taux_tva:numeric!,nature:text!,retire_le:timestamp with time zone,retire_par:uuid,cree_par:uuid,cree_le:timestamp with time zone!,modifie_par:uuid,modifie_le:timestamp with time zone', null),

      -- ══ 1 à 13. Qui enregistre un article ══════════
      ('1', 'controle', 'l''anonyme n''exécute pas enregistrer_article : le droit d''exécution', 'anon', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '42501', 'permission denied for function enregistrer_article', null),
      ('2', 'controle', 'un compte rattaché à rien : la raison d''accès', 'inconnu', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('3', 'controle', 'le client sans droit, sur son dossier', 'client', 'aucun',
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('4', 'controle', 'le client avec « Banque » seul, sur son dossier', 'client', 'banque',
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('5', 'controle', 'le client avec « Ventes », sur un dossier où il n''a pas d''accès', 'client', 'ventes',
        $q$select a.id::text from public.enregistrer_article('{DB}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('6', 'controle', 'un membre du cabinet non affecté au dossier B', 'membre', null,
        $q$select a.id::text from public.enregistrer_article('{DB}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('6b', 'controle', 'le super-administrateur, sur un dossier qui n''existe pas', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{INCONNUE}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('7', 'fait', 'le chef crée un article dans A', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":"R1","designation":"Consultation","description":"Une heure de conseil","unite":"HUR","prix_unitaire_ht":60,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', null, 'ART1'),
      ('7b', 'fait', 'le client qui porte « Ventes » crée un article dans A', 'client', 'ventes',
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Fournitures","unite":"H87","prix_unitaire_ht":12.5,"taux_tva":5.5,"nature":"biens"}'::jsonb) a$q$,
        'OK', null, 'ART2'),
      ('7c', 'fait', 'un article sans référence, sans description ni unité, à prix et taux nuls', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Frais de dossier","prix_unitaire_ht":0,"taux_tva":0,"nature":"services"}'::jsonb) a$q$,
        'OK', null, 'ART3'),
      ('7d', 'fait', 'un article qui sera retiré', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":"R4","designation":"Abonnement","unite":"MON","prix_unitaire_ht":30,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', null, 'ART4'),
      ('7e', 'fait', 'un article à la désignation de quatre-vingt-cinq caractères', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, jsonb_build_object('reference', 'R5', 'designation', repeat('é', 85), 'prix_unitaire_ht', 1, 'taux_tva', 20, 'nature', 'biens')) a$q$,
        'OK', null, 'ART5'),
      ('7f', 'fait', 'un article du dossier B', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DB}', null, '{"reference":"RB","designation":"Article du dossier B","prix_unitaire_ht":5,"taux_tva":20,"nature":"biens"}'::jsonb) a$q$,
        'OK', null, 'ARTB'),
      ('8', 'valeur', 'ce que la fonction a écrit, champ par champ', 'proprietaire', null,
        $q$select reference || '|' || designation || '|' || description || '|' || unite || '|' || prix_unitaire_ht || '|' || taux_tva || '|' || nature
             from articles where id = '{ART1}'$q$,
        'OK', 'R1|Consultation|Une heure de conseil|HUR|60|20|services', null),
      ('8b', 'valeur', 'sans référence ni description, l''unité générique', 'proprietaire', null,
        $q$select coalesce(reference, 'nulle') || '|' || coalesce(description, 'nulle') || '|' || unite || '|' || prix_unitaire_ht || '|' || taux_tva
             from articles where id = '{ART3}'$q$,
        'OK', 'nulle|nulle|C62|0|0', null),
      ('8c', 'valeur', 'chaque article signé de son auteur, ni modifié ni retiré', 'proprietaire', null,
        $q$select (a1.cree_par = '{CHEF}')::text || '/' || (a2.cree_par = '{CLIENT}')::text || '/'
               || (a1.modifie_le is null and a1.modifie_par is null and a1.retire_le is null and a2.modifie_le is null
                   and a2.retire_le is null and a1.cree_le is not null)::text
             from articles a1, articles a2 where a1.id = '{ART1}' and a2.id = '{ART2}'$q$,
        'OK', 'true/true/true', null),
      ('9', 'controle', 'un membre du cabinet affecté au dossier B y crée un article', 'membre_affecte', null,
        $q$select a.id::text from public.enregistrer_article('{DB}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', null, null),
      ('10', 'fait', 'le client qui porte « Ventes » modifie l''article du chef', 'client', 'ventes',
        $q$select a.id::text from public.enregistrer_article('{DA}', '{ART1}', '{"reference":"R1","designation":"Consultation","description":"Une heure de conseil","unite":"HUR","prix_unitaire_ht":65,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', null, null),
      ('10b', 'valeur', 'la modification signée du client ; l''auteur de la création inchangé', 'proprietaire', null,
        $q$select prix_unitaire_ht || '/' || (cree_par = '{CHEF}') || '/' || (modifie_par = '{CLIENT}') || '/' || (modifie_le is not null)
             from articles where id = '{ART1}'$q$,
        'OK', '65/true/true/true', null),
      ('11', 'controle', 'un article de A, désigné sur le dossier B : introuvable', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DB}', '{ART1}', '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'P0002', 'Article introuvable dans ce dossier.', null),
      ('12', 'controle', 'sans droit, un article qui n''existe pas : l''accès d''abord', 'client', 'aucun',
        $q$select a.id::text from public.enregistrer_article('{DA}', '{INCONNUE}', '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      -- Le membre du cabinet est le compte du client : son accès d'essai au dossier A se pose sans droit pour qu'il ne
      -- l'atteigne que par le cabinet.
      ('13', 'controle', 'le membre affecté au seul dossier B, sur le dossier A', 'membre_affecte', 'aucun',
        $q$select a.id::text from public.enregistrer_article('{DA}', '{ART1}', '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),

      -- ══ 20 à 29. Les refus d'enregistrer_article, sous leurs mots et dans leur ordre ══════════
      ('20', 'controle', 'un article qui n''existe pas', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', '{INCONNUE}', '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'P0002', 'Article introuvable dans ce dossier.', null),
      ('21', 'fait', 'le chef retire un article', 'chef', null,
        $q$select a.id::text from public.retirer_article('{DA}', '{ART4}') a$q$, 'OK', null, null),
      ('21b', 'controle', 'un article retiré ne se modifie pas', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', '{ART4}', '{"reference":"R4","designation":"Abonnement","unite":"MON","prix_unitaire_ht":35,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'Cet article est retiré : le reprendre avant de le modifier.', null),
      ('22', 'controle', 'la désignation absente', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La désignation de l''article est à renseigner.', null),
      ('22b', 'controle', 'la désignation faite d''espaces', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"   ","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La désignation de l''article est à renseigner.', null),
      ('22c', 'controle', 'la désignation faite de tabulations et de sauts de ligne', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"\t\n\r ","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La désignation de l''article est à renseigner.', null),
      ('22d', 'controle', 'la désignation qui n''est pas un texte', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":5,"prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La désignation de l''article est à renseigner.', null),
      ('22e', 'controle', 'la désignation nulle', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":null,"prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La désignation de l''article est à renseigner.', null),
      ('22f', 'controle', 'la désignation de mille et un caractères', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, jsonb_build_object('designation', repeat('a', 1001), 'prix_unitaire_ht', 10, 'taux_tva', 20, 'nature', 'services')) a$q$,
        '22023', 'La désignation de l''article tient en mille caractères au plus.', null),
      ('22g', 'controle', 'la désignation de mille caractères passe', 'chef', null,
        $q$select char_length(a.designation)::text from public.enregistrer_article('{DA}', null, jsonb_build_object('designation', repeat('a', 1000), 'prix_unitaire_ht', 10, 'taux_tva', 20, 'nature', 'services')) a$q$,
        'OK', '1000', null),
      ('22h', 'controle', 'la description de quatre mille et un caractères', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, jsonb_build_object('designation', 'Essai', 'description', repeat('d', 4001), 'prix_unitaire_ht', 10, 'taux_tva', 20, 'nature', 'services')) a$q$,
        '22023', 'La description de l''article est un texte de quatre mille caractères au plus.', null),
      ('22i', 'controle', 'la description de quatre mille caractères passe', 'chef', null,
        $q$select char_length(a.description)::text from public.enregistrer_article('{DA}', null, jsonb_build_object('designation', 'Essai', 'description', repeat('d', 4000), 'prix_unitaire_ht', 10, 'taux_tva', 20, 'nature', 'services')) a$q$,
        'OK', '4000', null),
      ('22j', 'controle', 'la description qui n''est pas un texte', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","description":5,"prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La description de l''article est un texte de quatre mille caractères au plus.', null),
      ('22k', 'controle', 'la description nulle : aucune', 'chef', null,
        $q$select coalesce(a.description, 'aucune') from public.enregistrer_article('{DA}', null, '{"designation":"Essai","description":null,"prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', 'aucune', null),
      ('22l', 'controle', 'une saisie qui n''est pas un objet', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '["Essai", 10, 20, "services"]'::jsonb) a$q$,
        '22023', 'La désignation de l''article est à renseigner.', null),
      ('22m', 'controle', 'une saisie nulle', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, null) a$q$,
        '22023', 'La désignation de l''article est à renseigner.', null),
      ('23', 'controle', 'la référence vide', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":"","designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La référence de l''article tient en un à cent caractères, sans blanc au début ni à la fin.', null),
      ('23b', 'controle', 'la référence qui commence par une espace', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":" R7","designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La référence de l''article tient en un à cent caractères, sans blanc au début ni à la fin.', null),
      ('23c', 'controle', 'la référence qui finit par une espace', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":"R7 ","designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La référence de l''article tient en un à cent caractères, sans blanc au début ni à la fin.', null),
      ('23d', 'controle', 'la référence qui finit par une tabulation', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":"R7\t","designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La référence de l''article tient en un à cent caractères, sans blanc au début ni à la fin.', null),
      ('23e', 'controle', 'la référence qui commence par un saut de ligne', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":"\nR7","designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La référence de l''article tient en un à cent caractères, sans blanc au début ni à la fin.', null),
      ('23f', 'controle', 'la référence de cent un caractères', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, jsonb_build_object('reference', repeat('r', 101), 'designation', 'Essai', 'prix_unitaire_ht', 10, 'taux_tva', 20, 'nature', 'services')) a$q$,
        '22023', 'La référence de l''article tient en un à cent caractères, sans blanc au début ni à la fin.', null),
      ('23g', 'controle', 'la référence de cent caractères passe', 'chef', null,
        $q$select char_length(a.reference)::text from public.enregistrer_article('{DA}', null, jsonb_build_object('reference', repeat('r', 100), 'designation', 'Essai', 'prix_unitaire_ht', 10, 'taux_tva', 20, 'nature', 'services')) a$q$,
        'OK', '100', null),
      ('23h', 'controle', 'la référence qui n''est pas un texte', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":7,"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La référence de l''article tient en un à cent caractères, sans blanc au début ni à la fin.', null),
      ('23i', 'controle', 'une espace à l''intérieur de la référence passe', 'chef', null,
        $q$select a.reference from public.enregistrer_article('{DA}', null, '{"reference":"R 7","designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', 'R 7', null),
      ('24', 'controle', 'la référence d''un autre article du dossier : il est nommé', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":"R1","designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '23505', 'La référence « R1 » est déjà celle de l''article « Consultation » : une référence ne sert qu''une fois par dossier.', null),
      ('24b', 'controle', 'la référence d''un article retiré : il est nommé, et dit retiré', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":"R4","designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '23505', 'La référence « R4 » est déjà celle de l''article « Abonnement » (retiré) : une référence ne sert qu''une fois par dossier.', null),
      ('24c', 'controle', 'une désignation longue se nomme par ses soixante-dix-neuf premiers caractères', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":"R5","designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '23505', 'La référence « R5 » est déjà celle de l''article « ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé… » : une référence ne sert qu''une fois par dossier.', null),
      ('24d', 'controle', 'la même référence dans un autre dossier passe', 'chef', null,
        $q$select a.reference from public.enregistrer_article('{DB}', null, '{"reference":"R1","designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', 'R1', null),
      ('24e', 'controle', 'un article garde sa propre référence en se modifiant', 'chef', null,
        $q$select a.reference from public.enregistrer_article('{DA}', '{ART1}', '{"reference":"R1","designation":"Consultation longue","prix_unitaire_ht":90,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', 'R1', null),
      ('24f', 'controle', 'un article ne prend pas la référence d''un autre en se modifiant', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', '{ART2}', '{"reference":"R1","designation":"Fournitures","prix_unitaire_ht":12.5,"taux_tva":5.5,"nature":"biens"}'::jsonb) a$q$,
        '23505', 'La référence « R1 » est déjà celle de l''article « Consultation » : une référence ne sert qu''une fois par dossier.', null),
      ('24g', 'controle', 'deux références qui ne diffèrent que par la casse sont deux références', 'chef', null,
        $q$select a.reference from public.enregistrer_article('{DA}', null, '{"reference":"r1","designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', 'r1', null),
      ('24h', 'controle', 'un second article sans référence passe : deux nuls ne se heurtent pas', 'chef', null,
        $q$select coalesce(a.reference, 'aucune') from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', 'aucune', null),
      ('25', 'controle', 'une unité hors de la liste', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","unite":"XYZ","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'L''unité de l''article n''est pas de la liste des unités admises.', null),
      ('25b', 'controle', 'une unité de la liste écrite en minuscules', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","unite":"c62","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'L''unité de l''article n''est pas de la liste des unités admises.', null),
      ('25c', 'controle', 'une unité qui n''est pas un texte', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","unite":62,"prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'L''unité de l''article n''est pas de la liste des unités admises.', null),
      ('25d', 'controle', 'l''unité nulle : l''unité générique', 'chef', null,
        $q$select a.unite from public.enregistrer_article('{DA}', null, '{"designation":"Essai","unite":null,"prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', 'C62', null),
      ('25e', 'controle', 'le forfait', 'chef', null,
        $q$select a.unite from public.enregistrer_article('{DA}', null, '{"designation":"Essai","unite":"LS","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', 'LS', null),
      ('26', 'controle', 'le prix absent', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'Le prix unitaire hors taxes de l''article est à renseigner.', null),
      ('26b', 'controle', 'le prix écrit en texte', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":"10","taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'Le prix unitaire hors taxes de l''article est à renseigner.', null),
      ('26c', 'controle', 'le prix nul (au sens de JSON)', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":null,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'Le prix unitaire hors taxes de l''article est à renseigner.', null),
      ('26d', 'controle', 'un prix négatif', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":-1,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'Le prix unitaire hors taxes de l''article est positif ou nul, à six décimales au plus, sous dix milliards d''euros.', null),
      ('26e', 'controle', 'un prix à sept décimales', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":1.1234567,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'Le prix unitaire hors taxes de l''article est positif ou nul, à six décimales au plus, sous dix milliards d''euros.', null),
      ('26f', 'controle', 'un prix de dix milliards', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10000000000,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'Le prix unitaire hors taxes de l''article est positif ou nul, à six décimales au plus, sous dix milliards d''euros.', null),
      ('26g', 'controle', 'un prix juste sous la borne passe', 'chef', null,
        $q$select a.prix_unitaire_ht::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":9999999999.999999,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', '9999999999.999999', null),
      ('26h', 'controle', 'un prix au millionième passe', 'chef', null,
        $q$select a.prix_unitaire_ht::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":0.000001,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', '0.000001', null),
      ('26i', 'controle', 'un prix écrit en exposant, sous le millionième', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":1e-7,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'Le prix unitaire hors taxes de l''article est positif ou nul, à six décimales au plus, sous dix milliards d''euros.', null),
      ('27', 'controle', 'le taux absent', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"nature":"services"}'::jsonb) a$q$,
        '22023', 'Le taux de TVA de l''article est à renseigner.', null),
      ('27b', 'controle', 'le taux écrit en texte', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":"20","nature":"services"}'::jsonb) a$q$,
        '22023', 'Le taux de TVA de l''article est à renseigner.', null),
      ('27c', 'controle', 'un taux que la DGFiP n''admet pas', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":19,"nature":"services"}'::jsonb) a$q$,
        '22023', 'Le taux de 19 \% n''est pas un taux de TVA admis.', null),
      ('27d', 'controle', 'un demi pour cent non plus', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":0.5,"nature":"services"}'::jsonb) a$q$,
        '22023', 'Le taux de 0,5 \% n''est pas un taux de TVA admis.', null),
      ('27e', 'controle', 'un taux admis, écrit avec un zéro final, passe', 'chef', null,
        $q$select trim_scale(a.taux_tva)::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":5.50,"nature":"services"}'::jsonb) a$q$,
        'OK', '5.5', null),
      ('27f', 'controle', 'le taux de Corse passe', 'chef', null,
        $q$select a.taux_tva::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":0.9,"nature":"services"}'::jsonb) a$q$,
        'OK', '0.9', null),
      ('28', 'controle', 'la nature absente', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20}'::jsonb) a$q$,
        '22023', 'La nature de l''article est « biens » ou « services ».', null),
      ('28b', 'controle', 'une nature « mixte »', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"mixte"}'::jsonb) a$q$,
        '22023', 'La nature de l''article est « biens » ou « services ».', null),
      ('28c', 'controle', 'une nature écrite avec une majuscule', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"Biens"}'::jsonb) a$q$,
        '22023', 'La nature de l''article est « biens » ou « services ».', null),
      ('28d', 'controle', 'une nature qui n''est pas un texte', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":1}'::jsonb) a$q$,
        '22023', 'La nature de l''article est « biens » ou « services ».', null),
      ('29a', 'controle', 'L''ORDRE : introuvable avant la désignation', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', '{INCONNUE}', '{"designation":" ","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'P0002', 'Article introuvable dans ce dossier.', null),
      ('29b', 'controle', 'L''ORDRE : retiré avant la désignation', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', '{ART4}', '{"designation":" ","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'Cet article est retiré : le reprendre avant de le modifier.', null),
      ('29c', 'controle', 'L''ORDRE : la désignation avant la référence', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":" R7","designation":" ","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La désignation de l''article est à renseigner.', null),
      ('29d', 'controle', 'L''ORDRE : la longueur de la désignation avant la description', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, jsonb_build_object('designation', repeat('a', 1001), 'description', repeat('d', 4001), 'prix_unitaire_ht', 10, 'taux_tva', 20, 'nature', 'services')) a$q$,
        '22023', 'La désignation de l''article tient en mille caractères au plus.', null),
      ('29e', 'controle', 'L''ORDRE : la description avant la référence', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":"","designation":"Essai","description":5,"prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La description de l''article est un texte de quatre mille caractères au plus.', null),
      ('29f', 'controle', 'L''ORDRE : la forme de la référence avant l''unité', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":" R7","designation":"Essai","unite":"XYZ","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'La référence de l''article tient en un à cent caractères, sans blanc au début ni à la fin.', null),
      ('29g', 'controle', 'L''ORDRE : l''unicité de la référence avant l''unité', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":"R1","designation":"Essai","unite":"XYZ","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '23505', 'La référence « R1 » est déjà celle de l''article « Consultation » : une référence ne sert qu''une fois par dossier.', null),
      ('29g2', 'controle', 'L''ORDRE : l''unicité avant l''unité, quand l''article qui porte la référence est retiré', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"reference":"R4","designation":"Essai","unite":"XYZ","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '23505', 'La référence « R4 » est déjà celle de l''article « Abonnement » (retiré) : une référence ne sert qu''une fois par dossier.', null),
      ('29h', 'controle', 'L''ORDRE : l''unité avant le prix', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","unite":"XYZ","taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '22023', 'L''unité de l''article n''est pas de la liste des unités admises.', null),
      ('29i', 'controle', 'L''ORDRE : le prix avant le taux', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":-1,"taux_tva":19,"nature":"services"}'::jsonb) a$q$,
        '22023', 'Le prix unitaire hors taxes de l''article est positif ou nul, à six décimales au plus, sous dix milliards d''euros.', null),
      ('29j', 'controle', 'L''ORDRE : le prix absent avant le taux absent', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","nature":"services"}'::jsonb) a$q$,
        '22023', 'Le prix unitaire hors taxes de l''article est à renseigner.', null),
      ('29k', 'controle', 'L''ORDRE : le taux avant la nature', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":19,"nature":"mixte"}'::jsonb) a$q$,
        '22023', 'Le taux de 19 \% n''est pas un taux de TVA admis.', null),
      ('29l', 'controle', 'L''ORDRE : l''accès avant le retrait', 'client', 'aucun',
        $q$select a.id::text from public.enregistrer_article('{DA}', '{ART4}', '{"designation":" ","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        '42501', 'Accès refusé à ce dossier.', null),

      -- ══ 30 à 39. Retirer un article, le reprendre ══════════
      ('30', 'controle', 'l''anonyme n''exécute pas retirer_article', 'anon', null,
        $q$select a.id::text from public.retirer_article('{DA}', '{ART1}') a$q$, '42501', 'permission denied for function retirer_article', null),
      ('30b', 'controle', 'ni reprendre_article', 'anon', null,
        $q$select a.id::text from public.reprendre_article('{DA}', '{ART4}') a$q$, '42501', 'permission denied for function reprendre_article', null),
      ('31', 'controle', 'retirer : un compte rattaché à rien', 'inconnu', null,
        $q$select a.id::text from public.retirer_article('{DA}', '{ART1}') a$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('31b', 'controle', 'retirer : le client sans droit', 'client', 'aucun',
        $q$select a.id::text from public.retirer_article('{DA}', '{ART1}') a$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('31c', 'controle', 'retirer : le client avec « Banque » seul', 'client', 'banque',
        $q$select a.id::text from public.retirer_article('{DA}', '{ART1}') a$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('31d', 'controle', 'retirer : le client avec « Ventes », sur un dossier où il n''a pas d''accès', 'client', 'ventes',
        $q$select a.id::text from public.retirer_article('{DB}', '{ARTB}') a$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('31e', 'controle', 'reprendre : le client sans droit, avant « introuvable »', 'client', 'aucun',
        $q$select a.id::text from public.reprendre_article('{DA}', '{INCONNUE}') a$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('32', 'controle', 'retirer : un article qui n''existe pas', 'chef', null,
        $q$select a.id::text from public.retirer_article('{DA}', '{INCONNUE}') a$q$, 'P0002', 'Article introuvable dans ce dossier.', null),
      ('32b', 'controle', 'retirer : un article de A désigné sur B', 'chef', null,
        $q$select a.id::text from public.retirer_article('{DB}', '{ART1}') a$q$, 'P0002', 'Article introuvable dans ce dossier.', null),
      ('32c', 'controle', 'reprendre : un article de A désigné sur B', 'chef', null,
        $q$select a.id::text from public.reprendre_article('{DB}', '{ART4}') a$q$, 'P0002', 'Article introuvable dans ce dossier.', null),
      ('33', 'fait', 'le client qui porte « Ventes » retire un article', 'client', 'ventes',
        $q$select a.id::text from public.retirer_article('{DA}', '{ART2}') a$q$, 'OK', null, null),
      ('33b', 'valeur', 'le retrait signé du client', 'proprietaire', null,
        $q$select (retire_par = '{CLIENT}')::text || '/' || (retire_le is not null)::text from articles where id = '{ART2}'$q$,
        'OK', 'true/true', null),
      ('34', 'controle', 'un article déjà retiré ne se retire pas', 'chef', null,
        $q$select a.id::text from public.retirer_article('{DA}', '{ART2}') a$q$, '22023', 'Cet article est déjà retiré.', null),
      ('35', 'controle', 'un article qui n''est pas retiré ne se reprend pas', 'chef', null,
        $q$select a.id::text from public.reprendre_article('{DA}', '{ART1}') a$q$, '22023', 'Cet article n''est pas retiré.', null),
      ('36', 'fait', 'le chef reprend l''article retiré par le client', 'chef', null,
        $q$select a.id::text from public.reprendre_article('{DA}', '{ART2}') a$q$, 'OK', null, null),
      ('36b', 'valeur', 'repris : plus de retrait, la reprise est sa dernière modification, l''auteur de la création inchangé', 'proprietaire', null,
        $q$select (retire_le is null and retire_par is null)::text || '/' || (modifie_par = '{CHEF}')::text || '/' || (modifie_le is not null)::text || '/' || (cree_par = '{CLIENT}')::text
             from articles where id = '{ART2}'$q$,
        'OK', 'true/true/true/true', null),
      ('37', 'controle', 'le client qui porte « Ventes » reprend un article', 'client', 'ventes',
        $q$select coalesce(a.retire_le::text, 'repris') from public.reprendre_article('{DA}', '{ART4}') a$q$, 'OK', 'repris', null),
      ('37b', 'controle', 'repris, l''article se modifie de nouveau', 'chef', null,
        $q$select a.prix_unitaire_ht::text from public.enregistrer_article('{DA}', '{ART2}', '{"designation":"Fournitures","unite":"H87","prix_unitaire_ht":13,"taux_tva":5.5,"nature":"biens"}'::jsonb) a$q$,
        'OK', '13', null),

      -- ══ 40 à 49. Ce que le client lit ══════════
      ('40', 'controle', 'sans droit, aucun article, pas même de son dossier', 'client', 'aucun',
        $q$select (select count(*) from articles where dossier_id = '{DA}') || '/' || (select count(*) from articles where dossier_id = '{DB}')$q$, 'OK', '0/0', null),
      ('41', 'controle', 'avec « Banque » seul, aucun', 'client', 'banque',
        $q$select (select count(*) from articles where dossier_id = '{DA}') || '/' || (select count(*) from articles where dossier_id = '{DB}')$q$, 'OK', '0/0', null),
      ('42', 'controle', 'avec « Ventes », tous ceux de son dossier, rien du dossier B', 'client', 'ventes',
        $q$select (select count(*) from articles where dossier_id = '{DA}') || '/' || (select count(*) from articles where dossier_id = '{DB}')$q$, 'OK', '5/0', null),
      ('42b', 'controle', 'avec les deux cases, de même', 'client', 'deux',
        $q$select (select count(*) from articles where dossier_id = '{DA}') || '/' || (select count(*) from articles where dossier_id = '{DB}')$q$, 'OK', '5/0', null),
      ('43', 'controle', 'avec « Ventes », les retirés et les auteurs aussi', 'client', 'ventes',
        $q$select count(*) filter (where retire_le is not null) || '/' || count(*) filter (where cree_par is not null) || '/' || max(reference)
             from articles where dossier_id = '{DA}'$q$, 'OK', '1/5/R5', null),
      ('44', 'controle', 'un membre non affecté ne lit pas les articles du dossier B', 'membre', null,
        $q$select count(*)::text from articles where dossier_id = '{DB}'$q$, 'OK', '0', null),
      ('45', 'controle', 'l''anonyme ne lit rien', 'anon', null,
        $q$select count(*)::text from articles where dossier_id in ('{DA}', '{DB}')$q$, 'OK', '0', null),
      ('46', 'controle', 'un compte rattaché à rien ne lit rien', 'inconnu', null,
        $q$select count(*)::text from articles where dossier_id in ('{DA}', '{DB}')$q$, 'OK', '0', null),
      ('47', 'controle', 'le membre affecté au seul dossier B ne lit pas ceux de A (son accès d''essai sans droit)', 'membre_affecte', 'aucun',
        $q$select count(*)::text from articles where dossier_id = '{DA}'$q$, 'OK', '0', null),

      -- ══ 50 à 59. Aucune écriture directe ══════════
      ('50', 'controle', 'le client qui porte « Ventes » ne pose pas un article directement : la RLS', 'client', 'ventes',
        $q$insert into articles (dossier_id, designation, prix_unitaire_ht, taux_tva, nature) values ('{DA}', 'ESSAI DIRECT', 1, 20, 'services')$q$,
        '42501', 'new row violates row-level security policy%articles%', null),
      ('50b', 'controle', 'un membre affecté, qui n''est pas super-administrateur, non plus', 'membre_affecte', null,
        $q$insert into articles (dossier_id, designation, prix_unitaire_ht, taux_tva, nature) values ('{DB}', 'ESSAI DIRECT', 1, 20, 'services')$q$,
        '42501', 'new row violates row-level security policy%articles%', null),
      ('50c', 'controle', 'un compte rattaché à rien non plus', 'inconnu', null,
        $q$insert into articles (dossier_id, designation, prix_unitaire_ht, taux_tva, nature) values ('{DA}', 'ESSAI DIRECT', 1, 20, 'services')$q$,
        '42501', 'new row violates row-level security policy%articles%', null),
      ('51', 'controle', 'le client qui porte « Ventes » ne modifie pas un article directement : aucune ligne touchée', 'client', 'ventes',
        $q$with u as (update articles set designation = 'changé' where dossier_id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('51b', 'controle', 'ni ne le retire directement', 'client', 'ventes',
        $q$with u as (update articles set retire_le = now(), retire_par = '{CLIENT}' where id = '{ART1}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('52', 'controle', 'le chef non plus : aucune policy de mise à jour', 'chef', null,
        $q$with u as (update articles set designation = 'changé' where dossier_id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('52b', 'controle', 'ni un membre affecté', 'membre_affecte', null,
        $q$with u as (update articles set designation = 'changé' where dossier_id = '{DB}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),

      -- ══ 60 à 69. Les contraintes de la table : ce que la restauration réinsère passe par elles ══════════
      ('60', 'controle', 'une unité hors de la liste', 'proprietaire', null,
        $q$insert into articles (dossier_id, designation, unite, prix_unitaire_ht, taux_tva, nature) values ('{DA}', 'Essai', 'XYZ', 1, 20, 'services')$q$,
        '23514', '%articles_unite_check%', null),
      ('61', 'controle', 'un prix négatif', 'proprietaire', null,
        $q$insert into articles (dossier_id, designation, prix_unitaire_ht, taux_tva, nature) values ('{DA}', 'Essai', -1, 20, 'services')$q$,
        '23514', '%articles_prix_check%', null),
      ('61b', 'controle', 'un prix à sept décimales', 'proprietaire', null,
        $q$insert into articles (dossier_id, designation, prix_unitaire_ht, taux_tva, nature) values ('{DA}', 'Essai', 1.1234567, 20, 'services')$q$,
        '23514', '%articles_prix_check%', null),
      ('61c', 'controle', 'un prix de dix milliards', 'proprietaire', null,
        $q$insert into articles (dossier_id, designation, prix_unitaire_ht, taux_tva, nature) values ('{DA}', 'Essai', 10000000000, 20, 'services')$q$,
        '23514', '%articles_prix_check%', null),
      ('62', 'controle', 'un taux non admis', 'proprietaire', null,
        $q$insert into articles (dossier_id, designation, prix_unitaire_ht, taux_tva, nature) values ('{DA}', 'Essai', 1, 19, 'services')$q$,
        '23514', '%articles_taux_check%', null),
      ('63', 'controle', 'une nature « mixte »', 'proprietaire', null,
        $q$insert into articles (dossier_id, designation, prix_unitaire_ht, taux_tva, nature) values ('{DA}', 'Essai', 1, 20, 'mixte')$q$,
        '23514', '%articles_nature_check%', null),
      ('64', 'controle', 'un retrait sans son auteur', 'proprietaire', null,
        $q$insert into articles (dossier_id, designation, prix_unitaire_ht, taux_tva, nature, retire_le) values ('{DA}', 'Essai', 1, 20, 'services', now())$q$,
        '23514', '%articles_retrait_entier%', null),
      ('64b', 'controle', 'une modification sans son instant', 'proprietaire', null,
        $q$insert into articles (dossier_id, designation, prix_unitaire_ht, taux_tva, nature, modifie_par) values ('{DA}', 'Essai', 1, 20, 'services', '{CHEF}')$q$,
        '23514', '%articles_modification_entiere%', null),
      ('65', 'controle', 'une désignation de blancs', 'proprietaire', null,
        $q$insert into articles (dossier_id, designation, prix_unitaire_ht, taux_tva, nature) values ('{DA}', E' \t\n', 1, 20, 'services')$q$,
        '23514', '%articles_designation_forme%', null),
      ('65b', 'controle', 'une désignation de mille et un caractères', 'proprietaire', null,
        $q$insert into articles (dossier_id, designation, prix_unitaire_ht, taux_tva, nature) values ('{DA}', repeat('a', 1001), 1, 20, 'services')$q$,
        '23514', '%articles_designation_forme%', null),
      ('66', 'controle', 'une référence qui commence par une espace', 'proprietaire', null,
        $q$insert into articles (dossier_id, reference, designation, prix_unitaire_ht, taux_tva, nature) values ('{DA}', ' R8', 'Essai', 1, 20, 'services')$q$,
        '23514', '%articles_reference_forme%', null),
      ('66b', 'controle', 'une référence vide', 'proprietaire', null,
        $q$insert into articles (dossier_id, reference, designation, prix_unitaire_ht, taux_tva, nature) values ('{DA}', '', 'Essai', 1, 20, 'services')$q$,
        '23514', '%articles_reference_forme%', null),
      ('66c', 'controle', 'une référence de cent un caractères', 'proprietaire', null,
        $q$insert into articles (dossier_id, reference, designation, prix_unitaire_ht, taux_tva, nature) values ('{DA}', repeat('r', 101), 'Essai', 1, 20, 'services')$q$,
        '23514', '%articles_reference_forme%', null),
      ('66d', 'controle', 'une description de quatre mille et un caractères', 'proprietaire', null,
        $q$insert into articles (dossier_id, designation, description, prix_unitaire_ht, taux_tva, nature) values ('{DA}', 'Essai', repeat('d', 4001), 1, 20, 'services')$q$,
        '23514', '%articles_description_forme%', null),
      ('67', 'controle', 'la référence d''un autre article du dossier', 'proprietaire', null,
        $q$insert into articles (dossier_id, reference, designation, prix_unitaire_ht, taux_tva, nature) values ('{DA}', 'R1', 'Essai', 1, 20, 'services')$q$,
        '23505', '%articles_reference_unique%', null),
      ('68', 'controle', 'une ligne de sauvegarde complète — retirée, modifiée, signée — se réinsère telle quelle', 'proprietaire', null,
        $q$insert into articles (dossier_id, reference, designation, description, unite, prix_unitaire_ht, taux_tva, nature, retire_le, retire_par, cree_par, cree_le, modifie_par, modifie_le)
           values ('{DA}', 'R8', 'Essai restauré', 'Une description', 'DAY', 120.5, 10, 'services', now(), '{CLIENT}', '{CHEF}', now() - interval '2 days', '{CLIENT}', now() - interval '1 day')
           returning unite || '/' || (retire_par = '{CLIENT}')$q$,
        'OK', 'DAY/true', null),

      -- ══ Les mutations ══════════
      ('M1', 'mutation', 'le contrôle 3 rejoué avec « Ventes » : il crée', 'client', 'ventes',
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', null, null),
      ('M2', 'mutation', 'le contrôle 40 rejoué avec « Ventes » : il lit', 'client', 'ventes',
        $q$select (select count(*) from articles where dossier_id = '{DA}') || '/' || (select count(*) from articles where dossier_id = '{DB}')$q$, 'OK', '5/0', null),
      ('M3', 'mutation', 'le contrôle 6 rejoué avec le membre affecté : il crée', 'membre_affecte', null,
        $q$select a.id::text from public.enregistrer_article('{DB}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', null, null),
      ('M4', 'mutation', 'le contrôle 50 rejoué par le super-administrateur : la policy de la restauration le laisse passer', 'chef', null,
        $q$insert into articles (dossier_id, designation, prix_unitaire_ht, taux_tva, nature) values ('{DA}', 'ESSAI DIRECT', 1, 20, 'services')$q$,
        'OK', null, null),
      ('M5', 'mutation', 'le contrôle 24 rejoué avec une référence libre : il crée', 'chef', null,
        $q$select a.reference from public.enregistrer_article('{DA}', null, '{"reference":"R9","designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', 'R9', null),
      ('M6', 'mutation', 'le contrôle 34 rejoué sur un article qui n''est pas retiré : il retire', 'chef', null,
        $q$select a.id::text from public.retirer_article('{DA}', '{ART3}') a$q$, 'OK', null, null),
      ('M7', 'mutation', 'le contrôle 2 rejoué par le chef : il crée', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', null, '{"designation":"Essai","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
        'OK', null, null),
      ('M8', 'mutation', 'le contrôle 44 rejoué avec le membre affecté : il lit', 'membre_affecte', null,
        $q$select count(*)::text from articles where dossier_id = '{DB}'$q$, 'OK', '1', null),
      ('M9', 'mutation', 'le contrôle 35 rejoué sur un article retiré : il reprend', 'chef', null,
        $q$select a.id::text from public.reprendre_article('{DA}', '{ART4}') a$q$, 'OK', null, null),
      ('M10', 'mutation', 'le contrôle 21b rejoué sur un article qui n''est pas retiré : il modifie', 'chef', null,
        $q$select a.id::text from public.enregistrer_article('{DA}', '{ART5}', '{"reference":"R5","designation":"Essai","prix_unitaire_ht":35,"taux_tva":20,"nature":"services"}'::jsonb) a$q$,
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
    ((select count(*) from dossier_assignations)), ((select count(*) from articles))
  ) as t(n);
  -- L'écart seul, non plus les comptes de toute la base, qui diraient le volume d'un dossier réel (audit du 29/10/2026).
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)), 'ok', erreur is null and avant = apres);
  perform set_config('essai.articles', verdicts::text, true);
end
$essai$;

-- Les verdicts, et une ligne d'INFORMATION : le texte que la base a reçu, sa longueur et son empreinte — sans le
-- commentaire que l'outil d'exécution ajoute à la fin —, à confronter à la copie transmise (sous psql, qui envoie les
-- instructions une à une, elle ne voit que cette requête-ci).
select x.genre, x.controle, x.verdict, x.observe from (
  select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                   else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
  from jsonb_to_recordset(current_setting('essai.articles')::jsonb) as v(controle text, genre text, ok boolean, observe text)
  union all
  select 'information', '0. le texte reçu par la base', 'information', length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by x.genre desc, (regexp_match(x.controle, '^M?(\d+)'))[1]::int, x.controle;
