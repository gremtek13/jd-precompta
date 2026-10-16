-- LE DERNIER CHANGEMENT DU RIB DES FACTURES D'UN DOSSIER, ÉPROUVÉ EN BASE (espace client, étape A5b3a) — à rejouer par
-- `execute_sql` après toute migration qui touche `dernier_changement_de_rib`, la table `parametres_facturation`, ses deux
-- fonctions (`enregistrer_parametres_facturation`, `confirmer_rib`) ou sa garde, `memberships`, `client_du_dossier` ou
-- `admin_du_dossier`.
--
-- Ce qui se prouve ici, par impersonation — anonyme, compte rattaché à rien, le client de l'essai sans aucune case, avec
-- « Ventes », avec « Banque » seul, avec les deux, sur SON dossier ou sur un autre, un membre du cabinet hors de ses
-- dossiers ou affecté au dossier, le chef du cabinet (super-administrateur), et le propriétaire de la base :
--   - LE CATALOGUE : la fonction `SECURITY DEFINER`, `stable`, au chemin fixé, qui rend une valeur `jsonb` ; fermée à
--     l'anonyme et à PUBLIC ; qui vérifie l'accès — le cabinet, « Ventes » ou « Banque », et que le dossier existe — AVANT
--     toute autre chose ; qui n'écrit rien ; et la table des paramètres, qui garde ses trois policies : la fonction est la
--     seule porte de l'accès « Banque » ;
--   - QUI LA LIT : le cabinet du dossier (le chef, un membre affecté au dossier) et l'accès client qui porte « Ventes »,
--     « Banque » ou les deux — la même valeur pour chacun ; sans aucune case, sur un autre dossier, membre du cabinet hors
--     de ses dossiers, sur un dossier qui n'existe pas ou nul, la RAISON d'accès (« Accès refusé à ce dossier. », 42501) ;
--     l'anonyme, le droit d'exécution ;
--   - CE QU'EST UN CHANGEMENT, geste par geste, et ce qu'elle en rend — le jour à Paris, le geste, l'auteur, l'état, ce qu'il
--     a fait au RIB en vigueur : un RIB posé, changé (l'IBAN, le BIC seul, le titulaire seul) ou retiré par une version, par
--     le cabinet (confirmé d'emblée) ou par un accès client (proposé) ; la confirmation d'un RIB proposé ; ce qui N'EN EST
--     PAS — une première version sans RIB, une version qui ne touche pas au RIB, le cabinet qui réenregistre sans
--     confirmer le RIB proposé ; le RIB en vigueur aucun, inchangé, posé, changé ou retiré ;
--   - L'AUTEUR, tiré de ce que la base a écrit, jamais deviné : un retrait, dont la version n'écrit rien, « inconnu » ;
--     une confirmation datée d'avant sa version, qu'aucune fonction n'écrit, « inconnu » ; et, sur des versions restaurées
--     aux instants choisis, le jour À PARIS (été comme hiver), celui de la CONFIRMATION quand elle suit la version, et
--     l'ordre de la CHAÎNE, pas celui des instants ;
--   - CE QU'ELLE NE REND JAMAIS : des IBAN, BIC et titulaires FICTIFS (le code banque 99999) sont PLANTÉS dans les versions,
--     et cherchés dans CHAQUE réponse, pour chaque profil qui lit — la valeur, l'IBAN par groupes de quatre ; ni un
--     identifiant de compte ou de version : toute réponse qui en porte un est une faute ; deux contrôles y cherchent aussi
--     leur md5 et leur SHA-256, les identifiants des deux comptes, un nombre, une clé de trop ;
--   - et que RIEN ne reste en base.
--
-- SANS LA MIGRATION `dernier_changement_de_rib`, une seule ligne la dit, « EN ATTENTE », SANS être une faute : la migration
-- est présentée au cabinet avant d'être appliquée, et une base qui ne la porte pas se rejoue aussi. Elle EN EST UNE si
-- l'historique des migrations porte `dernier_changement_de_rib` sans que la fonction existe — sauf si une ligne
-- `retour_dernier_changement_de_rib`, plus récente, dit son retour arrière. SANS LA MIGRATION DE L'ÉTAPE A5a
-- (`parametres_facturation`), l'essai se dit impossible : la fonction la lit.
--
-- Tout se joue dans trois dossiers JETABLES du cabinet du chef (A, où le client de l'essai a un accès d'essai ; B, où il
-- n'en a pas ; C, rempli de versions RESTAURÉES par le propriétaire, à des instants choisis), au sein d'un bloc qui s'annule
-- entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) : chaque contrôle dans sa sous-transaction, annulée elle aussi
-- (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE avant ; les étapes « fait » sont gardées jusqu'à
-- l'annulation finale. Un refus se juge à son code ET à son message (`like`) ; une valeur, au texte exact que la base rend
-- ({AUJ} : le jour à Paris de la transaction, l'instant de tout ce qu'elle écrit). Les droits de l'accès d'essai se posent
-- avant chaque étape qui les nomme ; le membre du cabinet est le compte du client, rangé au cabinet le temps de son
-- contrôle (toujours annulé). Les IBAN sont FICTIFS, à clé juste (le code banque 99999), les BIC et les titulaires aussi.
-- Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.dernier_changement_de_rib`) : le fichier se joue d'un
-- seul appel, ne crée aucune table et ne porte AUCUNE instruction qui retire une ligne. Hors de l'outil d'exécution, il se
-- joue en UNE transaction (`psql -1`).
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil, un droit ou une cible délibérément faux : chacune
-- doit MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait.
--
-- src/lib/changementDeRib.test.ts lit les étapes ici : chaque valeur que la base rend doit se LIRE dans le module, et le
-- module, rejouant les versions de l'essai dans leur ordre, doit y trouver le même dernier changement.
do $essai$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  cabinet uuid;
  ids jsonb;
  avant text; apres text;
  s record; k text; ordre text; partie text; attendu text; rendu text; accepte boolean; code_recu text; message text; ok boolean;
  fuite text;
  erreur text;
  applique text; retour text;
  -- Ce qui ne doit JAMAIS paraître dans une réponse : les IBAN plantés, et par groupes de quatre, les BIC, les titulaires,
  -- et les morceaux qui les trahiraient — cherchés tels quels (la fonction ne rend que des mots en minuscules).
  ibans text[] := array['FR5199999002480000RIBUN0100', 'FR7199999002480000RIBDEUX00', 'FR8299999002480000RIBTROI00',
                        'FR8099999002480000RIBQUAT00', 'FR5899999002480000RIBCINQ00'];
  plantes text[];
  verdicts jsonb := '[]'::jsonb;
begin
  -- La migration d'abord : sans elle, une ligne le dit, en faute seulement si l'historique la porte sans retour arrière.
  if to_regclass('public.parametres_facturation') is null then
    raise exception 'ESSAI_IMPOSSIBLE : la migration de l''étape A5a (parametres_facturation) n''est pas en base';
  end if;
  if to_regprocedure('public.dernier_changement_de_rib(uuid)') is null then
    select max(version) filter (where name = 'dernier_changement_de_rib'), max(version) filter (where name = 'retour_dernier_changement_de_rib')
      into applique, retour from supabase_migrations.schema_migrations;
    verdicts := verdicts || jsonb_build_object('controle', '0. EN ATTENTE : la migration dernier_changement_de_rib (étape A5b3a) n''est pas en base',
      'genre', 'controle',
      'observe', 'historique : ' || coalesce('dernier_changement_de_rib ' || applique, 'sans dernier_changement_de_rib')
                 || coalesce(', retour_dernier_changement_de_rib ' || retour, ''),
      'ok', applique is null or (retour is not null and retour > applique));
    perform set_config('essai.dernier_changement_de_rib', verdicts::text, true);
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
  plantes := ibans || (select array_agg(rtrim(regexp_replace(i, '(.{4})', '\1 ', 'g'))) from unnest(ibans) i)
    || array['ESSBFR22', 'ESSCFR33XXX', 'ESSDFR44', 'TITULAIRE ESSAI UN', 'TITULAIRE ESSAI DEUX', 'TITULAIRE ESSAI TROIS',
             '99999', 'RIBUN', 'TITULAIRE', 'ESS'];

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet,
    'DA', 'a5b30000-0000-4000-8000-00000000000a', 'DB', 'a5b30000-0000-4000-8000-00000000000b',
    'DC', 'a5b30000-0000-4000-8000-00000000000c', 'ACCES', 'a5b30000-0000-4000-8000-0000000000ac',
    'VC1', 'a5b30000-0000-4000-8000-0000000000c1', 'VC2', 'a5b30000-0000-4000-8000-0000000000c2',
    'VC3', 'a5b30000-0000-4000-8000-0000000000c3', 'VC4', 'a5b30000-0000-4000-8000-0000000000c4',
    'VC5', 'a5b30000-0000-4000-8000-0000000000c5', 'VC6', 'a5b30000-0000-4000-8000-0000000000c6',
    'VC7', 'a5b30000-0000-4000-8000-0000000000c7', 'VC8', 'a5b30000-0000-4000-8000-0000000000c8',
    'VC9', 'a5b30000-0000-4000-8000-0000000000c9',
    'INCONNUE', gen_random_uuid(), 'AUJ', ((now() at time zone 'Europe/Paris')::date)::text);

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from parametres_facturation))
  ) as t(n);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre(s), code attendu ou OK, message ou valeur attendus)
      -- genre : « jeu » (posé par le propriétaire, gardé), « controle » (annulé), « fait » (gardé), « valeur » (une
      -- lecture), « mutation » (un contrôle rejoué à faux, qui doit rendre l'inverse). Plusieurs ordres se séparent par
      -- « §§ » ; le dernier rend la valeur jugée.
      -- qui : anon, inconnu, client, chef, proprietaire, membre (le compte du client rangé au cabinet, affecté à aucun
      -- dossier), membre_affecte (le même, affecté au dossier B).
      -- La version courante d'un dossier : celle qu'aucune ne remplace (« courante » ci-dessous, écrite en entier).

      -- ══ Le jeu : trois dossiers jetables, un accès d'essai sans droit ══════════
      ('j1', 'jeu', 'dossiers jetables A, B et C', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva) values
          ('{DA}', 'ESSAI DERNIER RIB A', '{CAB}', 'redevable', true), ('{DB}', 'ESSAI DERNIER RIB B', '{CAB}', 'redevable', true),
          ('{DC}', 'ESSAI DERNIER RIB C', '{CAB}', 'redevable', true)$q$, 'OK', null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-dernier-rib@exemple.invalid')$q$, 'OK', null),

      -- ══ 0. Le catalogue ══════════
      ('0a', 'valeur', 'la fonction : security definer, stable, search_path fixé, une valeur jsonb, un seul argument', 'proprietaire', null,
        $q$select p.prosecdef || '|' || p.provolatile::text || '|' || array_to_string(p.proconfig, ',') || '|' || pg_get_function_result(p.oid)
               || '|' || l.lanname || '|' || pg_get_function_identity_arguments(p.oid)
             from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = 'public.dernier_changement_de_rib(uuid)'::regprocedure$q$,
        'OK', 'true|s|search_path=public|jsonb|plpgsql|p_dossier_id uuid'),
      ('0b', 'valeur', 'ni l''anonyme ni PUBLIC ne l''exécutent ; les connectés, oui', 'proprietaire', null,
        $q$select 'anon ' || has_function_privilege('anon', p.oid, 'execute') || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
               || ' public ' || exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
             from pg_proc p where p.oid = 'public.dernier_changement_de_rib(uuid)'::regprocedure$q$,
        'OK', 'anon false authenticated true public false'),
      ('0c', 'valeur', 'elle vérifie l''accès — le cabinet, « Ventes » ou « Banque », et que le dossier existe — AVANT toute autre chose', 'proprietaire', null,
        $q$select regexp_replace(split_part(split_part(replace(p.prosrc, E'\r\n', E'\n'), E'\nbegin\n', 2), ';', 1), '\s+', ' ', 'g')
             from pg_proc p where p.oid = 'public.dernier_changement_de_rib(uuid)'::regprocedure$q$,
        'OK', ' if not (public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, ''ventes'') or public.client_du_dossier(p_dossier_id, ''banque'')) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then raise exception ''Accès refusé à ce dossier.'' using errcode = ''42501'''),
      ('0d', 'valeur', 'elle n''écrit rien : aucune insertion ni mise à jour dans son texte', 'proprietaire', null,
        $q$select (replace(p.prosrc, E'\r\n', E'\n') ~* '\m(insert|update)\M')::text from pg_proc p where p.oid = 'public.dernier_changement_de_rib(uuid)'::regprocedure$q$,
        'OK', 'false'),
      ('0e', 'valeur', 'la table des paramètres garde ses trois policies, aucune autre : l''accès « Banque » ne la lit pas, la fonction est sa seule porte', 'proprietaire', null,
        $q$select c.relname || ':' || c.relrowsecurity || ':' || coalesce((select string_agg(p.polname || '/' || p.polcmd::text || '/' || p.polpermissive || '/'
                 || array_to_string(p.polroles::regrole[]::text[], ','), ',' order by p.polname) from pg_policy p where p.polrelid = c.oid), 'aucune')
             from pg_class c where c.oid = 'public.parametres_facturation'::regclass$q$,
        'OK', 'parametres_facturation:true:parametres_facturation_lecture/r/true/authenticated,parametres_facturation_lecture_ventes/r/true/authenticated,parametres_facturation_restauration/a/true/authenticated'),

      -- ══ 1 à 6. Qui la lit : les refus ══════════
      ('1', 'controle', 'l''anonyme ne l''exécute pas : le droit d''exécution', 'anon', null,
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, '42501', 'permission denied for function dernier_changement_de_rib'),
      ('2', 'controle', 'un compte rattaché à rien : la raison d''accès', 'inconnu', null,
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, '42501', 'Accès refusé à ce dossier.'),
      ('3', 'controle', 'le client sans aucune case, sur son dossier', 'client', 'aucun',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, '42501', 'Accès refusé à ce dossier.'),
      ('M1', 'mutation', 'le contrôle 3 rejoué avec « Banque » : il lit', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": null}'),
      ('4', 'controle', 'le client « Ventes », sur un dossier où il n''a pas d''accès', 'client', 'ventes',
        $q$select public.dernier_changement_de_rib('{DB}')::text$q$, '42501', 'Accès refusé à ce dossier.'),
      ('4b', 'controle', 'le client « Banque », sur un dossier où il n''a pas d''accès', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DB}')::text$q$, '42501', 'Accès refusé à ce dossier.'),
      ('M2', 'mutation', 'le contrôle 4b rejoué sur son dossier : il lit', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": null}'),
      ('4c', 'controle', 'le client aux deux cases, sur un dossier où il n''a pas d''accès', 'client', 'deux',
        $q$select public.dernier_changement_de_rib('{DB}')::text$q$, '42501', 'Accès refusé à ce dossier.'),
      ('5', 'controle', 'un membre du cabinet affecté à aucun dossier (son accès client sans case)', 'membre', 'aucun',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, '42501', 'Accès refusé à ce dossier.'),
      ('5b', 'controle', 'ni sur le dossier B, où il n''a rien', 'membre', null,
        $q$select public.dernier_changement_de_rib('{DB}')::text$q$, '42501', 'Accès refusé à ce dossier.'),
      ('M3', 'mutation', 'le contrôle 5b rejoué par le membre affecté au dossier B : il lit', 'membre_affecte', null,
        $q$select public.dernier_changement_de_rib('{DB}')::text$q$, 'OK', '{"changement": null}'),
      ('6', 'controle', 'le chef, sur un dossier qui n''existe pas : refusé, sans dire qu''il n''existe pas', 'chef', null,
        $q$select public.dernier_changement_de_rib('{INCONNUE}')::text$q$, '42501', 'Accès refusé à ce dossier.'),
      ('M4', 'mutation', 'le contrôle 6 rejoué sur le dossier A : il lit', 'chef', null,
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": null}'),
      ('6b', 'controle', 'ni sur un dossier nul', 'chef', null,
        $q$select public.dernier_changement_de_rib(null)::text$q$, '42501', 'Accès refusé à ce dossier.'),

      -- ══ 7. Qui la lit : un dossier sans paramètres, la même valeur pour chacun ══════════
      ('7', 'controle', 'le client « Ventes », sur son dossier qui n''a aucun paramètre : aucun changement, AFFIRMÉ', 'client', 'ventes',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": null}'),
      ('7b', 'controle', 'le client « Banque » seul', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": null}'),
      ('7c', 'controle', 'le client aux deux cases', 'client', 'deux',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": null}'),
      ('7d', 'controle', 'le chef', 'chef', null,
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": null}'),
      ('7e', 'controle', 'le membre affecté au dossier B, sur B', 'membre_affecte', null,
        $q$select public.dernier_changement_de_rib('{DB}')::text$q$, 'OK', '{"changement": null}'),

      -- ══ 8 à 26. Les changements, un à un, sur A ══════════
      ('8', 'fait', 'le chef enregistre une première version, sans RIB', 'chef', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}', null, '{"delai_paiement_jours": 30}'::jsonb) p$q$,
        'OK', 'nul'),
      ('8b', 'controle', 'une première version sans RIB n''est pas un changement — lu par le client « Banque » seul', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": null}'),
      ('9', 'fait', 'le chef pose un RIB : confirmé d''emblée', 'chef', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"delai_paiement_jours": 30, "iban": "FR5199999002480000RIBUN0100", "bic": "ESSBFR22", "titulaire_compte": "TITULAIRE ESSAI UN"}'::jsonb) p$q$,
        'OK', 'confirme'),
      ('9b', 'controle', 'posé par le cabinet, confirmé, le RIB en vigueur posé — lu par le client « Banque » seul', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "pose", "auteur": "cabinet", "rib_en_vigueur": "pose"}}'),
      ('9c', 'controle', 'le même, lu par le client « Ventes »', 'client', 'ventes',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "pose", "auteur": "cabinet", "rib_en_vigueur": "pose"}}'),
      ('9d', 'controle', 'le même, lu par le chef', 'chef', null,
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "pose", "auteur": "cabinet", "rib_en_vigueur": "pose"}}'),
      ('9e', 'controle', 'le client « Banque » seul ne lit toujours pas la table : aucune version', 'client', 'banque',
        $q$select count(*)::text from parametres_facturation where dossier_id = '{DA}'$q$, 'OK', '0'),
      ('M5', 'mutation', 'le contrôle 9e rejoué avec « Ventes » : il lit les deux versions', 'client', 'ventes',
        $q$select count(*)::text from parametres_facturation where dossier_id = '{DA}'$q$, 'OK', '2'),
      ('10', 'fait', 'le chef enregistre une version qui ne touche pas au RIB : le délai seul change', 'chef', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"delai_paiement_jours": 45, "iban": "FR5199999002480000RIBUN0100", "bic": "ESSBFR22", "titulaire_compte": "TITULAIRE ESSAI UN"}'::jsonb) p$q$,
        'OK', 'confirme'),
      ('10b', 'controle', 'ce n''est pas un changement : le dernier reste la pose du RIB', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "pose", "auteur": "cabinet", "rib_en_vigueur": "pose"}}'),
      ('11', 'fait', 'le client « Ventes » change le RIB : seulement proposé', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"delai_paiement_jours": 45, "iban": "FR7199999002480000RIBDEUX00", "bic": "ESSCFR33XXX", "titulaire_compte": "TITULAIRE ESSAI DEUX"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('11b', 'controle', 'changé par un accès client, proposé, le RIB en vigueur inchangé — lu par « Banque »', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}}'),
      ('12', 'fait', 'le chef réenregistre sans toucher au RIB proposé : il ne le confirme pas (A5-Q4)', 'chef', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"delai_paiement_jours": 30, "iban": "FR7199999002480000RIBDEUX00", "bic": "ESSCFR33XXX", "titulaire_compte": "TITULAIRE ESSAI DEUX"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('12b', 'controle', 'ce n''est pas un changement : le dernier reste la proposition du client', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}}'),
      ('13', 'fait', 'le chef confirme le RIB proposé', 'chef', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.confirmer_rib('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id))) p$q$,
        'OK', 'confirme'),
      ('13b', 'controle', 'la confirmation, par le cabinet, et le RIB en vigueur changé — lu par « Banque »', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "confirme", "auteur": "cabinet", "rib_en_vigueur": "change"}}'),
      ('13c', 'valeur', 'ce qu''elle ne rend JAMAIS, cherché dans le texte rendu au client « Banque » seul, un RIB en vigueur : aucun IBAN, BIC ni titulaire planté — ni par groupes de quatre, ni leur md5 ou SHA-256 —, ni un identifiant, ni un nombre, ni une clé de plus', 'client', 'banque',
        $q$with e as (select public.dernier_changement_de_rib('{DA}') as j),
                t as (select j, j::text as x from e),
                plantees(v) as (values ('FR5199999002480000RIBUN0100'), ('FR7199999002480000RIBDEUX00'), ('FR8299999002480000RIBTROI00'),
                  ('FR8099999002480000RIBQUAT00'), ('FR5899999002480000RIBCINQ00'), ('ESSBFR22'), ('ESSCFR33XXX'), ('ESSDFR44'),
                  ('TITULAIRE ESSAI UN'), ('TITULAIRE ESSAI DEUX'), ('TITULAIRE ESSAI TROIS'))
           select coalesce(string_agg(trouve, ', ' order by trouve), 'aucun') from (
             select 'la valeur ' || v as trouve from plantees, t where position(lower(v) in lower(t.x)) > 0
             union all select 'par groupes de quatre ' || v from plantees, t
               where v like 'FR%' and position(lower(rtrim(regexp_replace(v, '(.{4})', '\1 ', 'g'))) in lower(t.x)) > 0
             union all select 'le md5 de ' || v from plantees, t where position(md5(v) in t.x) > 0
             union all select 'le sha256 de ' || v from plantees, t where position(encode(sha256(convert_to(v, 'UTF8')), 'hex') in t.x) > 0
             union all select 'le motif ' || m from (values ('99999'), ('ribdeux'), ('titulaire'), ('essai'), ('{CLIENT}'), ('{CHEF}')) as w(m), t
               where position(m in lower(t.x)) > 0
             union all select 'un identifiant' from t where t.x ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-'
             union all select 'un nombre' from t where jsonb_path_exists(t.j, '$.** ? (@.type() == "number")')
             union all select 'une clé de plus ou de moins' from t
               where (select count(*) from jsonb_object_keys(t.j)) <> 1 or (select count(*) from jsonb_object_keys(t.j -> 'changement')) <> 5) z$q$,
        'OK', 'aucun'),
      ('13d', 'valeur', 'la même recherche, dans le texte rendu au cabinet', 'chef', null,
        $q$with e as (select public.dernier_changement_de_rib('{DA}') as j),
                t as (select j, j::text as x from e),
                plantees(v) as (values ('FR5199999002480000RIBUN0100'), ('FR7199999002480000RIBDEUX00'), ('FR8299999002480000RIBTROI00'),
                  ('FR8099999002480000RIBQUAT00'), ('FR5899999002480000RIBCINQ00'), ('ESSBFR22'), ('ESSCFR33XXX'), ('ESSDFR44'),
                  ('TITULAIRE ESSAI UN'), ('TITULAIRE ESSAI DEUX'), ('TITULAIRE ESSAI TROIS'))
           select coalesce(string_agg(trouve, ', ' order by trouve), 'aucun') from (
             select 'la valeur ' || v as trouve from plantees, t where position(lower(v) in lower(t.x)) > 0
             union all select 'par groupes de quatre ' || v from plantees, t
               where v like 'FR%' and position(lower(rtrim(regexp_replace(v, '(.{4})', '\1 ', 'g'))) in lower(t.x)) > 0
             union all select 'le md5 de ' || v from plantees, t where position(md5(v) in t.x) > 0
             union all select 'le sha256 de ' || v from plantees, t where position(encode(sha256(convert_to(v, 'UTF8')), 'hex') in t.x) > 0
             union all select 'le motif ' || m from (values ('99999'), ('ribdeux'), ('titulaire'), ('essai'), ('{CLIENT}'), ('{CHEF}')) as w(m), t
               where position(m in lower(t.x)) > 0
             union all select 'un identifiant' from t where t.x ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-'
             union all select 'un nombre' from t where jsonb_path_exists(t.j, '$.** ? (@.type() == "number")')
             union all select 'une clé de plus ou de moins' from t
               where (select count(*) from jsonb_object_keys(t.j)) <> 1 or (select count(*) from jsonb_object_keys(t.j -> 'changement')) <> 5) z$q$,
        'OK', 'aucun'),
      ('14', 'fait', 'le client change le seul titulaire du compte', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"delai_paiement_jours": 30, "iban": "FR7199999002480000RIBDEUX00", "bic": "ESSCFR33XXX", "titulaire_compte": "TITULAIRE ESSAI TROIS"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('14b', 'controle', 'un titulaire changé est un RIB changé : proposé, le RIB en vigueur inchangé', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}}'),
      ('15', 'fait', 'le client retire le RIB, avec effet immédiat (A5-Q5)', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"delai_paiement_jours": 30}'::jsonb) p$q$,
        'OK', 'nul'),
      ('15b', 'controle', 'retiré, l''auteur inconnu (la version ne l''écrit pas), le RIB en vigueur retiré', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "retire", "jour": "{AUJ}", "geste": "retire", "auteur": "inconnu", "rib_en_vigueur": "retire"}}'),
      ('16', 'fait', 'le client propose un RIB', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR8299999002480000RIBTROI00"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('16b', 'controle', 'posé par un accès client, proposé, et aucun RIB en vigueur', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "{AUJ}", "geste": "pose", "auteur": "client", "rib_en_vigueur": "aucun"}}'),
      ('16c', 'fait', 'le client propose un autre RIB, aucun n''étant toujours en vigueur', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR8099999002480000RIBQUAT00"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('16d', 'controle', 'changé par un accès client, proposé, et toujours aucun RIB en vigueur', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "aucun"}}'),
      ('17', 'fait', 'le client le retire', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{}'::jsonb) p$q$,
        'OK', 'nul'),
      ('17b', 'controle', 'retiré, et aucun RIB en vigueur, avant comme après', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "retire", "jour": "{AUJ}", "geste": "retire", "auteur": "inconnu", "rib_en_vigueur": "aucun"}}'),
      ('18', 'fait', 'le client propose un RIB', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR8099999002480000RIBQUAT00"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('19', 'fait', 'le chef pose le sien par-dessus : confirmé d''emblée', 'chef', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR5199999002480000RIBUN0100", "bic": "ESSBFR22", "titulaire_compte": "TITULAIRE ESSAI UN"}'::jsonb) p$q$,
        'OK', 'confirme'),
      ('19b', 'controle', 'changé par le cabinet, et le RIB en vigueur POSÉ : rien n''était confirmé', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "change", "auteur": "cabinet", "rib_en_vigueur": "pose"}}'),
      ('20', 'fait', 'le client propose un autre RIB', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR5899999002480000RIBCINQ00"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('20b', 'controle', 'proposé, le RIB en vigueur inchangé', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}}'),
      ('21', 'fait', 'le chef repose, tel quel, le RIB déjà en vigueur par-dessus la proposition', 'chef', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR5199999002480000RIBUN0100", "bic": "ESSBFR22", "titulaire_compte": "TITULAIRE ESSAI UN"}'::jsonb) p$q$,
        'OK', 'confirme'),
      ('21b', 'controle', 'changé par le cabinet, mais le RIB en vigueur INCHANGÉ', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "change", "auteur": "cabinet", "rib_en_vigueur": "inchange"}}'),
      ('22', 'fait', 'le chef ne change que le BIC', 'chef', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR5199999002480000RIBUN0100", "bic": "ESSDFR44", "titulaire_compte": "TITULAIRE ESSAI UN"}'::jsonb) p$q$,
        'OK', 'confirme'),
      ('22b', 'controle', 'un BIC changé est un RIB changé, en vigueur aussi', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "change", "auteur": "cabinet", "rib_en_vigueur": "change"}}'),
      ('23', 'fait', 'le client propose un autre RIB', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR7199999002480000RIBDEUX00", "bic": "ESSCFR33XXX", "titulaire_compte": "TITULAIRE ESSAI DEUX"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('24', 'fait', 'puis propose, à la place, celui qui est en vigueur', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR5199999002480000RIBUN0100", "bic": "ESSDFR44", "titulaire_compte": "TITULAIRE ESSAI UN"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('24b', 'controle', 'changé — par rapport à la proposition qu''il remplace —, proposé, le RIB en vigueur inchangé', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "{AUJ}", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}}'),
      ('25', 'fait', 'le chef le confirme', 'chef', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.confirmer_rib('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id))) p$q$,
        'OK', 'confirme'),
      ('25b', 'controle', 'la confirmation d''un RIB qui était déjà en vigueur : le RIB en vigueur inchangé', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "confirme", "auteur": "cabinet", "rib_en_vigueur": "inchange"}}'),
      ('26', 'fait', 'le chef retire le RIB', 'chef', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{}'::jsonb) p$q$,
        'OK', 'nul'),
      ('26b', 'controle', 'retiré par le cabinet : l''auteur reste inconnu, la version ne l''écrit pas', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "retire", "jour": "{AUJ}", "geste": "retire", "auteur": "inconnu", "rib_en_vigueur": "retire"}}'),
      ('26c', 'controle', 'la même valeur, lue par le client « Ventes »', 'client', 'ventes',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "retire", "jour": "{AUJ}", "geste": "retire", "auteur": "inconnu", "rib_en_vigueur": "retire"}}'),
      ('26d', 'controle', 'par le client aux deux cases', 'client', 'deux',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "retire", "jour": "{AUJ}", "geste": "retire", "auteur": "inconnu", "rib_en_vigueur": "retire"}}'),
      ('26e', 'controle', 'par le chef', 'chef', null,
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "retire", "jour": "{AUJ}", "geste": "retire", "auteur": "inconnu", "rib_en_vigueur": "retire"}}'),
      ('26f', 'fait', 'le client propose un RIB, aucun n''étant en vigueur', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR8299999002480000RIBTROI00", "bic": "ESSCFR33XXX"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('26g', 'fait', 'le chef le confirme', 'chef', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.confirmer_rib('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id))) p$q$,
        'OK', 'confirme'),
      ('26h', 'controle', 'la confirmation d''un RIB quand aucun n''était en vigueur : le RIB en vigueur posé', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "confirme", "auteur": "cabinet", "rib_en_vigueur": "pose"}}'),
      ('26i', 'fait', 'le client propose le même IBAN et le même BIC, sous un autre titulaire', 'client', 'ventes',
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)),
             '{"iban": "FR8299999002480000RIBTROI00", "bic": "ESSCFR33XXX", "titulaire_compte": "TITULAIRE ESSAI TROIS"}'::jsonb) p$q$,
        'OK', 'propose'),
      ('26j', 'fait', 'le chef le confirme', 'chef', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.confirmer_rib('{DA}',
             (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id))) p$q$,
        'OK', 'confirme'),
      ('26k', 'controle', 'confirmé, le même IBAN sous un autre titulaire : le RIB en vigueur CHANGÉ', 'client', 'banque',
        $q$select public.dernier_changement_de_rib('{DA}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "confirme", "auteur": "cabinet", "rib_en_vigueur": "change"}}'),

      -- ══ 27. Le membre affecté au dossier B : le cabinet, lui aussi ══════════
      ('27', 'controle', 'le membre affecté au dossier B pose un RIB : le cabinet, confirmé d''emblée', 'membre_affecte', null,
        $q$select coalesce(p.rib_etat, 'nul') from public.enregistrer_parametres_facturation('{DB}', null,
             '{"iban": "FR8299999002480000RIBTROI00", "bic": "ESSBFR22", "titulaire_compte": "TITULAIRE ESSAI UN"}'::jsonb) p§§select public.dernier_changement_de_rib('{DB}')::text$q$,
        'OK', '{"changement": {"etat": "confirme", "jour": "{AUJ}", "geste": "pose", "auteur": "cabinet", "rib_en_vigueur": "pose"}}'),

      -- ══ 28 à 33. Des versions RESTAURÉES sur C, à des instants choisis ══════════
      -- Le propriétaire insère comme la restauration d'une sauvegarde : les instants, les auteurs, les confirmations tels
      -- qu'écrits. Une confirmation qui suit sa version se dit au jour de LA CONFIRMATION ; le jour est celui de Paris ;
      -- la chaîne fait l'ordre.
      ('28', 'fait', 'C : le RIB posé et confirmé d''emblée par le chef, le 01/08/2026', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, iban, bic, titulaire_compte, rib_etat, rib_confirme_par, rib_confirme_le, auteur, cree_le)
           values ('{VC1}', '{DC}', 'FR5199999002480000RIBUN0100', 'ESSBFR22', 'TITULAIRE ESSAI UN', 'confirme', '{CHEF}', '2026-08-01 10:00:00+00', '{CHEF}', '2026-08-01 10:00:00+00')$q$,
        'OK', null),
      ('28b', 'controle', 'posé par le cabinet le 01/08/2026', 'chef', null,
        $q$select public.dernier_changement_de_rib('{DC}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "2026-08-01", "geste": "pose", "auteur": "cabinet", "rib_en_vigueur": "pose"}}'),
      ('29', 'fait', 'C : proposé par le client le 10/09/2026 à 22 h 30 UTC, confirmé par le chef le 12/09/2026 à 23 h 15 UTC', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, iban, bic, titulaire_compte, rib_etat, rib_confirme_par, rib_confirme_le, remplace_id, auteur, cree_le)
           values ('{VC2}', '{DC}', 'FR7199999002480000RIBDEUX00', 'ESSCFR33XXX', 'TITULAIRE ESSAI DEUX', 'confirme', '{CHEF}', '2026-09-12 23:15:00+00', '{VC1}', '{CLIENT}', '2026-09-10 22:30:00+00')$q$,
        'OK', null),
      ('29b', 'controle', 'la confirmation, au jour DE PARIS de la confirmation : le 13/09 (ni le 12, ni le 11)', 'chef', null,
        $q$select public.dernier_changement_de_rib('{DC}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "2026-09-13", "geste": "confirme", "auteur": "cabinet", "rib_en_vigueur": "change"}}'),
      ('30', 'fait', 'C : posé par le client le 20/09/2026, confirmé par le MÊME compte le lendemain (passé au cabinet entre-temps)', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, iban, rib_etat, rib_confirme_par, rib_confirme_le, remplace_id, auteur, cree_le)
           values ('{VC3}', '{DC}', 'FR8299999002480000RIBTROI00', 'confirme', '{CLIENT}', '2026-09-21 10:00:00+00', '{VC2}', '{CLIENT}', '2026-09-20 10:00:00+00')$q$,
        'OK', null),
      ('30b', 'controle', 'une confirmation qui SUIT la version n''est pas « d''emblée », même du même compte : la confirmation, le 21/09', 'chef', null,
        $q$select public.dernier_changement_de_rib('{DC}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "2026-09-21", "geste": "confirme", "auteur": "cabinet", "rib_en_vigueur": "change"}}'),
      ('31', 'fait', 'C : une ligne qu''aucune fonction n''écrit — confirmée le 24/09, AVANT sa version du 25/09', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, iban, bic, titulaire_compte, rib_etat, rib_confirme_par, rib_confirme_le, remplace_id, auteur, cree_le)
           values ('{VC4}', '{DC}', 'FR8099999002480000RIBQUAT00', 'ESSCFR33XXX', 'TITULAIRE ESSAI DEUX', 'confirme', '{CHEF}', '2026-09-24 10:00:00+00', '{VC3}', '{CHEF}', '2026-09-25 10:00:00+00')$q$,
        'OK', null),
      ('31b', 'controle', 'l''auteur ne se devine pas : inconnu, au jour de la confirmation', 'chef', null,
        $q$select public.dernier_changement_de_rib('{DC}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "2026-09-24", "geste": "confirme", "auteur": "inconnu", "rib_en_vigueur": "change"}}'),
      ('32', 'fait', 'C : une version datée d''AVANT toutes les autres (01/07/2026), dernière de la chaîne, qui change le BIC, confirmée d''emblée', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, iban, bic, titulaire_compte, rib_etat, rib_confirme_par, rib_confirme_le, remplace_id, auteur, cree_le)
           values ('{VC5}', '{DC}', 'FR8099999002480000RIBQUAT00', 'ESSDFR44', 'TITULAIRE ESSAI DEUX', 'confirme', '{CHEF}', '2026-07-01 10:00:00+00', '{VC4}', '{CHEF}', '2026-07-01 10:00:00+00')$q$,
        'OK', null),
      ('32b', 'controle', 'la chaîne fait l''ordre, pas les instants : le dernier changement est celui de la dernière version, le 01/07/2026', 'chef', null,
        $q$select public.dernier_changement_de_rib('{DC}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "2026-07-01", "geste": "change", "auteur": "cabinet", "rib_en_vigueur": "change"}}'),
      ('33', 'fait', 'C : le RIB retiré par le client le 31/12/2026 à 23 h 30 UTC', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, remplace_id, auteur, cree_le)
           values ('{VC6}', '{DC}', '{VC5}', '{CLIENT}', '2026-12-31 23:30:00+00')$q$,
        'OK', null),
      ('33b', 'controle', 'retiré, au jour de Paris en heure d''hiver : le 01/01/2027', 'chef', null,
        $q$select public.dernier_changement_de_rib('{DC}')::text$q$, 'OK', '{"changement": {"etat": "retire", "jour": "2027-01-01", "geste": "retire", "auteur": "inconnu", "rib_en_vigueur": "retire"}}'),
      ('33c', 'controle', 'le client n''a aucun accès au dossier C : refusé, même avec les deux cases sur A', 'client', 'deux',
        $q$select public.dernier_changement_de_rib('{DC}')::text$q$, '42501', 'Accès refusé à ce dossier.'),
      ('34', 'fait', 'C : une ligne qu''aucune fonction n''écrit, aucun RIB n''étant en vigueur — confirmée le 02/01/2027, avant sa version du 03/01/2027', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, iban, bic, titulaire_compte, rib_etat, rib_confirme_par, rib_confirme_le, remplace_id, auteur, cree_le)
           values ('{VC7}', '{DC}', 'FR5199999002480000RIBUN0100', 'ESSBFR22', 'TITULAIRE ESSAI UN', 'confirme', '{CHEF}', '2027-01-02 10:00:00+00', '{VC6}', '{CHEF}', '2027-01-03 10:00:00+00')$q$,
        'OK', null),
      ('34b', 'controle', 'la confirmation, au jour où elle est datée, d''un auteur inconnu ; le RIB en vigueur posé', 'chef', null,
        $q$select public.dernier_changement_de_rib('{DC}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "2027-01-02", "geste": "confirme", "auteur": "inconnu", "rib_en_vigueur": "pose"}}'),
      ('35', 'fait', 'C : un RIB proposé par le client, le 04/01/2027', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, iban, bic, titulaire_compte, rib_etat, remplace_id, auteur, cree_le)
           values ('{VC8}', '{DC}', 'FR7199999002480000RIBDEUX00', 'ESSCFR33XXX', 'TITULAIRE ESSAI DEUX', 'propose', '{VC7}', '{CLIENT}', '2027-01-04 10:00:00+00')$q$,
        'OK', null),
      ('35b', 'controle', 'proposé par un accès client, le RIB en vigueur inchangé', 'chef', null,
        $q$select public.dernier_changement_de_rib('{DC}')::text$q$, 'OK', '{"changement": {"etat": "propose", "jour": "2027-01-04", "geste": "change", "auteur": "client", "rib_en_vigueur": "inchange"}}'),
      ('36', 'fait', 'C : une ligne qu''aucune fonction n''écrit — le RIB déjà en vigueur, confirmé le 05/01/2027, avant sa version du 06/01/2027', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, iban, bic, titulaire_compte, rib_etat, rib_confirme_par, rib_confirme_le, remplace_id, auteur, cree_le)
           values ('{VC9}', '{DC}', 'FR5199999002480000RIBUN0100', 'ESSBFR22', 'TITULAIRE ESSAI UN', 'confirme', '{CHEF}', '2027-01-05 10:00:00+00', '{VC8}', '{CLIENT}', '2027-01-06 10:00:00+00')$q$,
        'OK', null),
      ('36b', 'controle', 'sa confirmation, d''un auteur inconnu, laisse le RIB en vigueur inchangé', 'chef', null,
        $q$select public.dernier_changement_de_rib('{DC}')::text$q$, 'OK', '{"changement": {"etat": "confirme", "jour": "2027-01-05", "geste": "confirme", "auteur": "inconnu", "rib_en_vigueur": "inchange"}}')
    ) as x(num, genre, controle, qui, droits, ordre, code, attendu)
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
      accepte := false; code_recu := null; message := null; rendu := null; fuite := null;
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
      -- Ce que la fonction rend ne porte JAMAIS un IBAN, un BIC ou un titulaire plantés, ni un identifiant : cherché dans
      -- chaque réponse qui l'a lue, quel que soit le profil.
      if accepte and s.ordre like '%dernier_changement_de_rib(%' then
        select string_agg(x, ', ' order by x) into fuite from unnest(plantes) x where position(x in coalesce(rendu, '')) > 0;
        if coalesce(rendu, '') ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-' then
          fuite := coalesce(fuite || ', ', '') || 'un identifiant';
        end if;
      end if;
      ok := case
        when s.code = 'OK' then accepte and (attendu is null or coalesce(rendu, '') like attendu)
        else not accepte and code_recu = s.code and message like attendu
      end and fuite is null;
      if s.genre = 'jeu' and not ok then
        raise exception 'ESSAI_IMPOSSIBLE : le jeu % n''a pas pu être posé (% %)', s.num, code_recu, message;
      end if;
      if s.genre <> 'jeu' then
        verdicts := verdicts || jsonb_build_object('controle', s.num || '. ' || s.controle, 'genre', s.genre,
          'observe', case when accepte then 'accepté : ' || coalesce(rendu, '—') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end
                     || coalesce(' — FUITE : ' || fuite, ''),
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
    ((select count(*) from dossier_assignations)), ((select count(*) from parametres_facturation))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || avant || ' -> ' || apres, 'ok', erreur is null and avant = apres);
  perform set_config('essai.dernier_changement_de_rib', verdicts::text, true);
end
$essai$;

-- Les verdicts, et une ligne d'INFORMATION : le texte que la base a reçu, sa longueur et son empreinte — sans le
-- commentaire que l'outil d'exécution ajoute à la fin —, à confronter à la copie transmise (sous psql, qui envoie les
-- instructions une à une, elle ne voit que cette requête-ci).
select x.genre, x.controle, x.verdict, x.observe from (
  select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                   else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
  from jsonb_to_recordset(current_setting('essai.dernier_changement_de_rib')::jsonb) as v(controle text, genre text, ok boolean, observe text)
  union all
  select 'information', '0. le texte reçu par la base', 'information', length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by x.genre desc, (regexp_match(x.controle, '^M?(\d+)'))[1]::int, x.controle;
