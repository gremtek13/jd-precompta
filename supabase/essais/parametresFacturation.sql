-- LES PARAMÈTRES DE FACTURATION, ÉPROUVÉS EN BASE (espace client, étape A5a) — à rejouer par `execute_sql` après toute
-- migration qui touche la migration `parametres_facturation`, `enregistrer_parametres_facturation`, `confirmer_rib`,
-- `garder_parametres_facturation`, `memberships`, `dossiers` (ses policies, ses quatre colonnes d'identité légale),
-- `client_du_dossier`, `gere_les_ventes` ou `admin_du_dossier`.
--
-- Ce qui se prouve ici, par impersonation — anonyme, compte rattaché à rien, le client de l'essai sans droit, avec
-- « Banque » seul, avec « Ventes », avec les deux, sur SON dossier ou sur un autre, un membre du cabinet affecté ou non au
-- dossier, le chef du cabinet (super-administrateur), et le propriétaire de la base :
--   - LE CATALOGUE : la table sous RLS, ses trois policies (lecture du cabinet, lecture du droit « Ventes », insertion de
--     restauration) et leurs prédicats, aucune autre ; ses colonnes ; la chaîne des versions (une suite par version, une
--     seule première, la garde) ; les deux fonctions SECURITY DEFINER, au chemin fixé, fermées à l'anonyme et à PUBLIC, qui
--     vérifient l'accès AVANT toute autre chose — `gere_les_ventes` pour enregistrer, `admin_du_dossier` pour confirmer ;
--     la garde, que personne n'exécute ; les quatre colonnes d'identité légale de `dossiers`, la liste fermée de l'INSEE
--     (260 codes) ; les policies de `dossiers`, et qu'AUCUNE fonction du schéma n'écrit `dossiers` ;
--   - QUI ENREGISTRE : le cabinet (le chef, un membre affecté au dossier) et le client qui porte « Ventes », par la même
--     fonction, chaque version signée de son auteur ; sans le droit, avec « Banque » seul, sur un autre dossier, membre du
--     cabinet non affecté, ou sur un dossier qui n'existe pas, la RAISON d'accès (« Accès refusé à ce dossier. », 42501) ;
--   - LE RIB (MEG1-Q12, hypothèse) : posé par le cabinet, confirmé d'emblée, et la version dit par qui et quand ; posé par
--     un client « Ventes », seulement PROPOSÉ — et le RIB qu'une facture verrait reste le confirmé d'avant (la chaîne
--     remontée au-delà des versions où il n'est que proposé) ; inchangé, il garde son état et sa confirmation, même quand
--     le cabinet réenregistre la version ; un client ne confirme JAMAIS un RIB, avec ou sans « Banque » ; le cabinet
--     confirme le RIB proposé de la version courante, une fois, et rien d'autre de la version ne bouge ; retiré, il n'y a
--     plus de RIB à confirmer ;
--   - LES REFUS d'`enregistrer_parametres_facturation`, chacun sous ses mots, et leur ORDRE (sept rangs : l'accès, la
--     version remplacée — une autre saisie passée entre-temps nommée par son jour et son heure, et DEUX SAISIES
--     CONCURRENTES, la seconde refusée —, la saisie et ses champs, les textes, le délai, le moyen de paiement, le RIB : la
--     forme puis la clé de l'IBAN, le BIC et le titulaire avec lui) ; ceux de `confirmer_rib` (cinq) ;
--   - CE QUE LE CLIENT LIT : avec « Ventes », toutes les versions de son dossier, le RIB, l'état et les auteurs compris ;
--     sans le droit ou avec « Banque » seul, aucune, pas même de son dossier ; jamais celles d'un autre dossier ;
--   - AUCUNE ÉCRITURE DIRECTE : une insertion refusée par la RLS (42501) — sauf la porte de la restauration, au
--     super-administrateur —, une mise à jour qui ne touche aucune ligne, pour le client comme pour le cabinet ; et même
--     le propriétaire ne modifie une version que pour confirmer le RIB proposé de la courante (la garde) ;
--   - LES CONTRAINTES DE LA TABLE disent ce que la fonction dit, pour ce que la restauration réinsère ;
--   - L'IDENTITÉ LÉGALE (MEG1-Q14, hypothèse) : le client — sans droit, « Banque », « Ventes », les deux — ne l'écrit pas
--     (aucune ligne touchée, la valeur inchangée) ; le cabinet l'écrit ; un membre non affecté, un compte rattaché à rien
--     et l'anonyme non plus ; ses contraintes ; le client la LIT, comme tout son dossier ;
--   - et que RIEN ne reste en base.
--
-- SANS LA MIGRATION `parametres_facturation`, une seule ligne la dit, « EN ATTENTE », SANS être une faute : la migration est
-- présentée au cabinet avant d'être appliquée, et une base qui ne la porte pas se rejoue aussi. Elle EN EST UNE si
-- l'historique des migrations porte `parametres_facturation` sans que la table existe — sauf si une ligne
-- `retour_parametres_facturation`, plus récente, dit son retour arrière. AVANT LES MIGRATIONS DE L'ÉTAPE P2, l'essai se dit
-- impossible : la migration les exige.
--
-- Tout se joue dans deux dossiers JETABLES du cabinet du chef (A, où le client de l'essai a un accès d'essai ; B, où il n'en
-- a pas), au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) : chaque contrôle dans sa
-- sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE avant ; les étapes
-- « fait » sont gardées jusqu'à l'annulation finale, et une étape peut rendre un identifiant que les suivantes citent
-- (`{CLE}`). Un refus se juge à son code ET à son message (`like`). Les droits de l'accès d'essai se posent avant chaque
-- étape qui les nomme ; le membre du cabinet est le compte du client, rangé au cabinet le temps de son contrôle (toujours
-- annulé), et ses étapes sur le dossier A posent un accès sans droit. Les IBAN sont FICTIFS, à clé juste (le code banque
-- 99999), le BIC aussi ; les noms sont fictifs. Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.parametres_facturation`) : le fichier se joue d'un seul appel, ne crée aucune table et ne porte AUCUNE
-- instruction de suppression — aucune policy n'en ouvre (contrôle 0a), et une version ne se supprime pas, elle se remplace.
-- Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Ce que l'essai ne peut pas jouer en production —
-- la suppression d'une version, refusée par la garde, et celle du dossier qui emporte les siennes ; deux sessions qui
-- enregistrent ensemble — se joue sur une réplique (HISTORIQUE.md, « LES PARAMÈTRES DE FACTURATION, EN BASE »).
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil, un droit ou une cible délibérément faux : chacune
-- doit MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait. Certaines se jouent juste après leur
-- contrôle, quand la version courante est encore celle qu'il vise.
--
-- src/lib/parametresFacturation.test.ts lit les étapes ici : chaque refus que src/lib/parametresFacturation.ts redit avant
-- le clic doit y être exigé de la base, sous les mêmes mots ; chaque écriture de l'essai, rejouée dans le module, y reçoit
-- le même premier refus, ou aucun ; et le RIB qu'une facture verrait, après chaque geste, est celui que le module déduit.
--
-- LE LOGO (étape A5c1, migration `logo_des_factures`, préparée le 17/10/2026) : il ajoute deux colonnes à la table et un
-- huitième rang à la fonction, que supabase/essais/logoDesFactures.sql éprouve. Cet essai se joue À L'IDENTIQUE avant et
-- après elle : le contrôle 0f lit les colonnes SANS les deux du logo, et le contrôle 23 nomme un champ qu'aucun des deux
-- états n'admet (« logo ») — il nommait `logo_chemin`, que la migration rend admis. Rejoué le 17/10/2026 sur une réplique
-- égale à la production, sans la migration puis avec : les mêmes verdicts, 0 en faute.
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
  if to_regclass('public.parametres_facturation') is null then
    select max(version) filter (where name = 'parametres_facturation'), max(version) filter (where name = 'retour_parametres_facturation')
      into applique, retour from supabase_migrations.schema_migrations;
    verdicts := verdicts || jsonb_build_object('controle', '0. EN ATTENTE : la migration parametres_facturation (étape A5a) n''est pas en base',
      'genre', 'controle',
      'observe', 'historique : ' || coalesce('parametres_facturation ' || applique, 'sans parametres_facturation')
                 || coalesce(', retour_parametres_facturation ' || retour, ''),
      'ok', applique is null or (retour is not null and retour > applique));
    perform set_config('essai.parametres_facturation', verdicts::text, true);
    return;
  end if;
  if to_regprocedure('public.gere_les_ventes(uuid)') is null
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
    'DA', 'a5a00000-0000-4000-8000-0000000000a1', 'DB', 'a5a00000-0000-4000-8000-0000000000b1',
    'ACCES', 'a5a00000-0000-4000-8000-0000000000ac', 'INCONNUE', gen_random_uuid());

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from parametres_facturation))
  ) as t(n);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre(s), code attendu ou OK, message ou valeur attendus, clé)
      -- genre : « jeu » (posé par le propriétaire, gardé), « controle » (annulé), « fait » (gardé), « valeur » (lecture
      -- par le propriétaire), « mutation » (un contrôle rejoué à faux, qui doit rendre l'inverse). Plusieurs ordres se
      -- séparent par « §§ » ; {RENDU} y vaut ce que le précédent a rendu ; la clé garde ce que l'étape a rendu.
      -- qui : anon, inconnu, client, chef, proprietaire, membre (le compte du client rangé au cabinet, non affecté),
      -- membre_affecte (le même, affecté au dossier B).
      -- Le RIB qu'une facture verrait (« le RIB en vigueur ») : de la version courante, en remontant la chaîne tant que la
      -- version n'a qu'un RIB proposé ; le premier IBAN confirmé, ou « aucun » quand la première version qui n'est pas
      -- proposée n'a pas de RIB, ou quand toute la chaîne l'est.

      -- ══ Le jeu : deux dossiers jetables, un accès d'essai sans droit ══════════
      -- A naît basculé : « Ventes » ne se porte que sur un accès d'un dossier dont les factures sont la source de leurs
      -- ventes (garder_droit_ventes, étape VF8f) ; ses paramètres de facturation n'en dépendent pas.
      ('j1', 'jeu', 'dossiers jetables A et B', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, ventes_par_les_factures) values
          ('{DA}', 'ESSAI PARAMETRES A', '{CAB}', 'redevable', true, true), ('{DB}', 'ESSAI PARAMETRES B', '{CAB}', 'redevable', true, false)$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-parametres@exemple.invalid')$q$, 'OK', null, null),

      -- ══ 0. Le catalogue ══════════
      ('0a', 'valeur', 'la table sous RLS, ses trois policies : lecture du cabinet, lecture du droit « Ventes », insertion de restauration ; aucune autre', 'proprietaire', null,
        $q$select c.relname || ':' || c.relrowsecurity || ':' || coalesce((select string_agg(p.polname || '/' || p.polcmd::text || '/' || p.polpermissive || '/'
                 || array_to_string(p.polroles::regrole[]::text[], ','), ',' order by p.polname) from pg_policy p where p.polrelid = c.oid), 'aucune')
             from pg_class c where c.oid = 'public.parametres_facturation'::regclass$q$,
        'OK', 'parametres_facturation:true:parametres_facturation_lecture/r/true/authenticated,parametres_facturation_lecture_ventes/r/true/authenticated,parametres_facturation_restauration/a/true/authenticated', null),
      ('0b', 'valeur', 'leurs prédicats : le cabinet du dossier, l''accès qui porte « Ventes », le super-administrateur', 'proprietaire', null,
        $q$select string_agg(p.polname || '=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), ' ; ' order by p.polname)
             from pg_policy p where p.polrelid = 'public.parametres_facturation'::regclass$q$,
        'OK', 'parametres_facturation_lecture=admin_du_dossier(dossier_id)| ; parametres_facturation_lecture_ventes=client_du_dossier(dossier_id, ''ventes''::text)| ; parametres_facturation_restauration=|is_super_admin()', null),
      ('0c', 'valeur', 'les deux fonctions : security definer, search_path fixé ; ni anon ni PUBLIC ne les exécutent ; la garde, personne', 'proprietaire', null,
        $q$select string_agg(p.proname || ' ' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',') || ' anon ' || has_function_privilege('anon', p.oid, 'execute')
               || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
               || ' public ' || exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'), ' | ' order by p.proname)
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('enregistrer_parametres_facturation', 'confirmer_rib', 'garder_parametres_facturation')$q$,
        'OK', 'confirmer_rib true search_path=public anon false authenticated true public false | enregistrer_parametres_facturation true search_path=public anon false authenticated true public false | garder_parametres_facturation false search_path=public anon false authenticated false public false', null),
      ('0d', 'valeur', 'chacune vérifie l''accès au dossier annoncé — et qu''il existe — AVANT toute autre chose : les ventes pour enregistrer, le cabinet pour confirmer', 'proprietaire', null,
        $q$select string_agg(p.proname || '=' || regexp_replace(split_part(split_part(replace(p.prosrc, E'\r\n', E'\n'), E'\nbegin\n', 2), ';', 1), '\s+', ' ', 'g'), ' ; ' order by p.proname)
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('enregistrer_parametres_facturation', 'confirmer_rib')$q$,
        'OK', 'confirmer_rib= if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then raise exception ''Accès refusé à ce dossier.'' using errcode = ''42501'' ; enregistrer_parametres_facturation= if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then raise exception ''Accès refusé à ce dossier.'' using errcode = ''42501''', null),
      ('0e', 'valeur', 'la chaîne : une suite par version, une seule première (partiel), la clé vers la version remplacée ; la garde avant toute écriture', 'proprietaire', null,
        $q$select (select pg_get_constraintdef(co.oid) from pg_constraint co where co.conrelid = 'public.parametres_facturation'::regclass and co.conname = 'parametres_facturation_une_suite')
               || ' ; ' || (select pg_get_indexdef(i.indexrelid) from pg_index i join pg_class x on x.oid = i.indexrelid where x.relname = 'parametres_facturation_une_premiere')
               || ' ; ' || (select pg_get_constraintdef(co.oid) from pg_constraint co where co.conrelid = 'public.parametres_facturation'::regclass and co.contype = 'f' and co.confrelid = co.conrelid)
               || ' ; ' || (select string_agg(pg_get_triggerdef(t.oid), ' ; ') from pg_trigger t where t.tgrelid = 'public.parametres_facturation'::regclass and not t.tgisinternal)$q$,
        'OK', 'UNIQUE (remplace_id) ; CREATE UNIQUE INDEX parametres_facturation_une_premiere ON public.parametres_facturation USING btree (dossier_id) WHERE (remplace_id IS NULL) ; FOREIGN KEY (remplace_id) REFERENCES parametres_facturation(id) ; CREATE TRIGGER parametres_facturation_gardes BEFORE INSERT OR DELETE OR UPDATE ON public.parametres_facturation FOR EACH ROW EXECUTE FUNCTION garder_parametres_facturation()', null),
      ('0f', 'valeur', 'les colonnes que le client « Ventes » lit, dans leur ordre (« ! » : non nulle) — hors les deux du logo, que logoDesFactures.sql juge (étape A5c1)', 'proprietaire', null,
        $q$select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
             from pg_attribute a where a.attrelid = 'public.parametres_facturation'::regclass and a.attnum > 0 and not a.attisdropped
              and a.attname not in ('logo_chemin', 'logo_sha256')$q$,
        'OK', 'id:uuid!,dossier_id:uuid!,delai_paiement_jours:integer,moyen_prefere:text,escompte:text,penalites:text,mentions_complementaires:text,pied_de_page:text,iban:text,bic:text,titulaire_compte:text,rib_etat:text,rib_confirme_par:uuid,rib_confirme_le:timestamp with time zone,remplace_id:uuid,auteur:uuid!,cree_le:timestamp with time zone!', null),
      ('0g', 'valeur', 'les quatre colonnes d''identité légale de dossiers, facultatives', 'proprietaire', null,
        $q$select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
             from pg_attribute a where a.attrelid = 'public.dossiers'::regclass and a.attname in ('denomination_imprimee', 'rcs_ville', 'forme_juridique', 'capital')
              and not a.attisdropped$q$,
        'OK', 'denomination_imprimee:text,rcs_ville:text,forme_juridique:text,capital:numeric', null),
      ('0h', 'valeur', 'les policies de dossiers : la seule qui modifie est celle du cabinet du dossier, en lecture comme en vérification ; aucune n''ouvre au client autre chose que la lecture', 'proprietaire', null,
        $q$select string_agg(p.polname || '/' || p.polcmd::text || '/' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), ' ; ' order by p.polname)
             from pg_policy p where p.polrelid = 'public.dossiers'::regclass and p.polcmd <> 'r'$q$,
        'OK', 'dossiers_delete/d/est_chef_du_cabinet(cabinet_id)| ; dossiers_update/w/admin_du_dossier(id)|admin_du_dossier(id) ; dossiers_write/a/|est_chef_du_cabinet(cabinet_id)', null),
      ('0i', 'valeur', 'aucune fonction du schéma n''écrit dossiers : la policy du cabinet est le seul chemin de ses quatre colonnes', 'proprietaire', null,
        $q$select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~* '(update|insert\s+into)\s+(public\.)?dossiers\M'$q$,
        'OK', '0', null),
      ('0j', 'valeur', 'la forme juridique : une liste FERMÉE, les 260 codes de l''INSEE au niveau III (empreinte des codes triés)', 'proprietaire', null,
        $q$select count(*) || ' ' || md5(string_agg(m[1], ',' order by m[1] collate "C"))
             from pg_constraint co, regexp_matches(pg_get_constraintdef(co.oid), '''([0-9]{4})''', 'g') as m
            where co.conrelid = 'public.dossiers'::regclass and co.conname = 'dossiers_forme_juridique_insee'$q$,
        'OK', '260 6cb2432ee0742876e69eed7e99e548f0', null),
      -- Les blancs retirés aux bords sont de vrais caractères de contrôle dans le texte de la contrainte : chacun rendu « · »
      -- (une barre oblique ferait un échappement pour `like`).
      ('0k', 'valeur', 'les contraintes de l''identité légale et du capital', 'proprietaire', null,
        $q$select string_agg(co.conname || '=' || regexp_replace(pg_get_constraintdef(co.oid), '[[:cntrl:]]', '·', 'g'), ' ; ' order by co.conname)
             from pg_constraint co where co.conrelid = 'public.dossiers'::regclass
              and co.conname in ('dossiers_denomination_imprimee_forme', 'dossiers_rcs_ville_forme', 'dossiers_capital_forme', 'dossiers_capital_d_une_societe')$q$,
        'OK', 'dossiers_capital_d_une_societe=CHECK (((capital IS NULL) OR (forme_juridique IS DISTINCT FROM ''1000''::text))) ; dossiers_capital_forme=CHECK (((capital > (0)::numeric) AND (capital = round(capital, 2)) AND (capital < (''10000000000000''::bigint)::numeric))) ; dossiers_denomination_imprimee_forme=CHECK (((btrim(denomination_imprimee, '' ···''::text) <> ''''::text) AND (char_length(denomination_imprimee) <= 200))) ; dossiers_rcs_ville_forme=CHECK (((btrim(rcs_ville, '' ···''::text) <> ''''::text) AND (char_length(rcs_ville) <= 100)))', null),

      -- ══ 1 à 6. Qui enregistre ══════════
      ('1', 'controle', 'l''anonyme n''exécute pas enregistrer_parametres_facturation : le droit d''exécution', 'anon', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', null, '{"delai_paiement_jours":30}'::jsonb) p$q$,
        '42501', 'permission denied for function enregistrer_parametres_facturation', null),
      ('1b', 'controle', 'l''anonyme n''exécute pas confirmer_rib', 'anon', null,
        $q$select p.id::text from public.confirmer_rib('{DA}', '{INCONNUE}') p$q$,
        '42501', 'permission denied for function confirmer_rib', null),
      ('2', 'controle', 'un compte rattaché à rien : la raison d''accès', 'inconnu', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', null, '{"delai_paiement_jours":30}'::jsonb) p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('3', 'controle', 'le client sans droit, sur son dossier', 'client', 'aucun',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', null, '{"delai_paiement_jours":30}'::jsonb) p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('M1', 'mutation', 'le contrôle 3 rejoué avec « Ventes » : il enregistre', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', null, '{"delai_paiement_jours":30}'::jsonb) p$q$,
        'OK', null, null),
      ('4', 'controle', 'le client avec « Banque » seul, sur son dossier', 'client', 'banque',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', null, '{"delai_paiement_jours":30}'::jsonb) p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('5', 'controle', 'le client avec « Ventes », sur un dossier où il n''a pas d''accès', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DB}', null, '{"delai_paiement_jours":30}'::jsonb) p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('6', 'controle', 'un membre du cabinet non affecté au dossier B', 'membre', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DB}', null, '{"delai_paiement_jours":30}'::jsonb) p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('M3', 'mutation', 'le contrôle 6 rejoué avec le membre affecté : il enregistre', 'membre_affecte', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DB}', null, '{"delai_paiement_jours":30}'::jsonb) p$q$,
        'OK', null, null),
      ('6b', 'controle', 'le super-administrateur, sur un dossier qui n''existe pas', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{INCONNUE}', null, '{"delai_paiement_jours":30}'::jsonb) p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('6c', 'controle', 'sans droit, une version qui n''existe pas : l''accès d''abord', 'client', 'aucun',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{INCONNUE}', '"pas un objet"'::jsonb) p$q$,
        '42501', 'Accès refusé à ce dossier.', null),

      -- ══ 7 à 19. Le RIB proposé, confirmé, et ce qu'une facture verrait ══════════
      ('7', 'fait', 'le chef enregistre la première version de A : des conditions et un RIB, confirmé d''emblée', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', null, '{"delai_paiement_jours":30,"moyen_prefere":"virement","escompte":"Pas d''escompte pour paiement anticipé.","penalites":"Pénalités de retard : taux de la BCE majoré de 10 points.","mentions_complementaires":"Mentions d essai","pied_de_page":"Pied de page d essai","iban":"FR9399999000010000000000100","bic":"ESSAFR10","titulaire_compte":"ESSAI PARAMETRES A"}'::jsonb) p$q$,
        'OK', null, 'V1'),
      ('7b', 'fait', 'le chef enregistre la première version de B, un RIB confirmé', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DB}', null, '{"iban":"FR9299999000010000000000700","titulaire_compte":"ESSAI PARAMETRES B"}'::jsonb) p$q$,
        'OK', null, 'VB1'),
      ('8', 'valeur', 'ce que la fonction a écrit, champ par champ ; le RIB confirmé par son auteur, au même instant', 'proprietaire', null,
        $q$select delai_paiement_jours || '|' || moyen_prefere || '|' || escompte || '|' || penalites || '|' || mentions_complementaires || '|' || pied_de_page
               || '|' || iban || '|' || bic || '|' || titulaire_compte || '|' || rib_etat || '|' || (rib_confirme_par = '{CHEF}') || '|' || (auteur = '{CHEF}')
               || '|' || (rib_confirme_le = cree_le) || '|' || coalesce(remplace_id::text, 'nul')
             from parametres_facturation where id = '{V1}'$q$,
        'OK', '30|virement|Pas d''escompte pour paiement anticipé.|Pénalités de retard : taux de la BCE majoré de 10 points.|Mentions d essai|Pied de page d essai|FR9399999000010000000000100|ESSAFR10|ESSAI PARAMETRES A|confirme|true|true|true|nul', null),
      ('9', 'fait', 'le client qui porte « Ventes » enregistre une version qui change les conditions, pas le RIB', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"delai_paiement_jours":45,"moyen_prefere":"virement","escompte":"Escompte de 1 % sous huit jours.","iban":"FR9399999000010000000000100","bic":"ESSAFR10","titulaire_compte":"ESSAI PARAMETRES A"}'::jsonb) p$q$,
        'OK', null, 'V2'),
      ('9b', 'valeur', 'le RIB inchangé garde son état et sa confirmation : confirmé par le chef, à l''instant de la première ; l''auteur, le client', 'proprietaire', null,
        $q$select v2.rib_etat || '|' || (v2.rib_confirme_par = '{CHEF}') || '|' || (v2.rib_confirme_le = v1.rib_confirme_le) || '|' || (v2.auteur = '{CLIENT}')
               || '|' || (v2.remplace_id = v1.id) || '|' || coalesce(v2.penalites, 'nul') || '|' || v2.delai_paiement_jours
             from parametres_facturation v1, parametres_facturation v2 where v1.id = '{V1}' and v2.id = '{V2}'$q$,
        'OK', 'confirme|true|true|true|true|nul|45', null),
      ('9c', 'controle', 'le client qui ne change que le titulaire du compte : le RIB n''est plus que proposé', 'client', 'ventes',
        $q$select p.rib_etat || '|' || coalesce(p.rib_confirme_par::text, 'nul') from public.enregistrer_parametres_facturation('{DA}', '{V2}', '{"iban":"FR9399999000010000000000100","bic":"ESSAFR10","titulaire_compte":"ESSAI AUTRE TITULAIRE"}'::jsonb) p$q$,
        'OK', 'propose|nul', null),
      ('9d', 'controle', 'le client qui ne change que le BIC, ou le retire : de même', 'client', 'ventes',
        $q$select p.rib_etat || '|' || coalesce(p.rib_confirme_par::text, 'nul') from public.enregistrer_parametres_facturation('{DA}', '{V2}', '{"iban":"FR9399999000010000000000100","titulaire_compte":"ESSAI PARAMETRES A"}'::jsonb) p$q$,
        'OK', 'propose|nul', null),
      ('10', 'fait', 'le client qui porte « Ventes » change l''IBAN', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V2}', '{"delai_paiement_jours":45,"iban":"FR1299999000010000000000200","bic":"ESSAFR10","titulaire_compte":"ESSAI PARAMETRES A"}'::jsonb) p$q$,
        'OK', null, 'V3'),
      ('10b', 'valeur', 'le RIB que le client pose n''est que PROPOSÉ : personne ne l''a confirmé', 'proprietaire', null,
        $q$select rib_etat || '|' || coalesce(rib_confirme_par::text, 'nul') || '|' || coalesce(rib_confirme_le::text, 'nul') || '|' || (auteur = '{CLIENT}')
             from parametres_facturation where id = '{V3}'$q$,
        'OK', 'propose|nul|nul|true', null),
      ('10c', 'valeur', 'une facture n''en verrait que le RIB confirmé d''avant', 'proprietaire', null,
        $q$with recursive chaine(id, remplace_id, iban, rib_etat, profondeur) as (
             select p.id, p.remplace_id, p.iban, p.rib_etat, 0 from parametres_facturation p
              where p.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation s where s.remplace_id = p.id)
             union all
             select q.id, q.remplace_id, q.iban, q.rib_etat, c.profondeur + 1 from parametres_facturation q join chaine c on q.id = c.remplace_id
              where c.rib_etat = 'propose')
           select coalesce((select c.iban from chaine c where c.rib_etat is distinct from 'propose' order by c.profondeur limit 1), 'aucun')$q$,
        'OK', 'FR9399999000010000000000100', null),
      ('10d', 'fait', 'l''empreinte de la version proposée, hors son état et sa confirmation', 'proprietaire', null,
        $q$select md5((to_jsonb(p) - array['rib_etat', 'rib_confirme_par', 'rib_confirme_le'])::text) from parametres_facturation p where p.id = '{V3}'$q$,
        'OK', null, 'EMPREINTE_V3'),
      ('11', 'controle', 'le client qui porte « Ventes » ne confirme jamais un RIB', 'client', 'ventes',
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{V3}') p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('M2', 'mutation', 'le contrôle 11 rejoué par le chef : il confirme', 'chef', null,
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{V3}') p$q$,
        'OK', 'confirme', null),
      ('11b', 'controle', 'ni avec les deux cases', 'client', 'deux',
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{V3}') p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('11c', 'controle', 'ni avec « Banque » seul', 'client', 'banque',
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{V3}') p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('11d', 'controle', 'ni sans droit', 'client', 'aucun',
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{V3}') p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('11e', 'controle', 'ni un compte rattaché à rien', 'inconnu', null,
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{V3}') p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('11f', 'controle', 'ni un membre du cabinet non affecté, sur le dossier B', 'membre', null,
        $q$select p.rib_etat from public.confirmer_rib('{DB}', '{VB1}') p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('11g', 'controle', 'le super-administrateur, sur un dossier qui n''existe pas', 'chef', null,
        $q$select p.rib_etat from public.confirmer_rib('{INCONNUE}', '{V3}') p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('M10', 'mutation', 'le contrôle 62b rejoué sur la version courante, au RIB proposé : la garde laisse le propriétaire le confirmer', 'proprietaire', null,
        $q$with u as (update parametres_facturation set rib_etat = 'confirme', rib_confirme_par = '{CHEF}', rib_confirme_le = now() where id = '{V3}' returning 1) select count(*)::text from u$q$,
        'OK', '1', null),
      ('12', 'fait', 'le chef confirme le RIB proposé de la version courante', 'chef', null,
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{V3}') p$q$,
        'OK', 'confirme', null),
      ('12b', 'valeur', 'confirmé par le chef ; l''auteur reste le client ; rien d''autre de la version n''a bougé', 'proprietaire', null,
        $q$select rib_etat || '|' || (rib_confirme_par = '{CHEF}') || '|' || (rib_confirme_le >= cree_le) || '|' || (auteur = '{CLIENT}') || '|'
               || (md5((to_jsonb(p) - array['rib_etat', 'rib_confirme_par', 'rib_confirme_le'])::text) = '{EMPREINTE_V3}')
             from parametres_facturation p where p.id = '{V3}'$q$,
        'OK', 'confirme|true|true|true|true', null),
      ('12c', 'valeur', 'une facture voit désormais le RIB confirmé', 'proprietaire', null,
        $q$with recursive chaine(id, remplace_id, iban, rib_etat, profondeur) as (
             select p.id, p.remplace_id, p.iban, p.rib_etat, 0 from parametres_facturation p
              where p.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation s where s.remplace_id = p.id)
             union all
             select q.id, q.remplace_id, q.iban, q.rib_etat, c.profondeur + 1 from parametres_facturation q join chaine c on q.id = c.remplace_id
              where c.rib_etat = 'propose')
           select coalesce((select c.iban from chaine c where c.rib_etat is distinct from 'propose' order by c.profondeur limit 1), 'aucun')$q$,
        'OK', 'FR1299999000010000000000200', null),
      ('13', 'controle', 'un RIB confirmé ne se confirme pas deux fois', 'chef', null,
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{V3}') p$q$,
        '22023', 'Le RIB de cette version est déjà confirmé.', null),
      ('14', 'fait', 'le chef change l''IBAN : confirmé d''emblée, par lui', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V3}', '{"delai_paiement_jours":45,"iban":"FR2899999000010000000000300","titulaire_compte":"ESSAI PARAMETRES A"}'::jsonb) p$q$,
        'OK', null, 'V4'),
      ('14b', 'valeur', 'le RIB posé par le cabinet : confirmé, par son auteur, au même instant', 'proprietaire', null,
        $q$select rib_etat || '|' || (rib_confirme_par = '{CHEF}') || '|' || (auteur = '{CHEF}') || '|' || (rib_confirme_le = cree_le) || '|' || coalesce(bic, 'nul')
             from parametres_facturation where id = '{V4}'$q$,
        'OK', 'confirme|true|true|true|nul', null),
      ('M11', 'mutation', 'le contrôle 10b rejoué par le chef : le RIB qu''il change est confirmé', 'chef', null,
        $q$select p.rib_etat from public.enregistrer_parametres_facturation('{DA}', '{V4}', '{"iban":"FR6099999000010000000000500"}'::jsonb) p$q$,
        'OK', 'confirme', null),
      ('15', 'fait', 'le client qui porte « Ventes » change de nouveau l''IBAN : proposé', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V4}', '{"delai_paiement_jours":45,"iban":"FR4499999000010000000000400","titulaire_compte":"ESSAI PARAMETRES A"}'::jsonb) p$q$,
        'OK', null, 'V5'),
      ('16', 'fait', 'le chef réenregistre la version en ne changeant que le pied de page : le RIB proposé ne se confirme pas en passant', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V5}', '{"delai_paiement_jours":45,"pied_de_page":"Nouveau pied de page d essai","iban":"FR4499999000010000000000400","titulaire_compte":"ESSAI PARAMETRES A"}'::jsonb) p$q$,
        'OK', null, 'V6'),
      ('16b', 'valeur', 'la version du chef garde le RIB PROPOSÉ, sans confirmation ; son auteur, le chef', 'proprietaire', null,
        $q$select rib_etat || '|' || coalesce(rib_confirme_par::text, 'nul') || '|' || coalesce(rib_confirme_le::text, 'nul') || '|' || (auteur = '{CHEF}') || '|' || pied_de_page
             from parametres_facturation where id = '{V6}'$q$,
        'OK', 'propose|nul|nul|true|Nouveau pied de page d essai', null),
      ('M12', 'mutation', 'le contrôle 16b rejoué avec un RIB que le chef change : confirmé', 'chef', null,
        $q$select p.rib_etat from public.enregistrer_parametres_facturation('{DA}', '{V6}', '{"iban":"FR7699999000010000000000600"}'::jsonb) p$q$,
        'OK', 'confirme', null),
      ('16c', 'valeur', 'une facture voit toujours le RIB confirmé d''avant : deux versions proposées remontées', 'proprietaire', null,
        $q$with recursive chaine(id, remplace_id, iban, rib_etat, profondeur) as (
             select p.id, p.remplace_id, p.iban, p.rib_etat, 0 from parametres_facturation p
              where p.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation s where s.remplace_id = p.id)
             union all
             select q.id, q.remplace_id, q.iban, q.rib_etat, c.profondeur + 1 from parametres_facturation q join chaine c on q.id = c.remplace_id
              where c.rib_etat = 'propose')
           select coalesce((select c.iban from chaine c where c.rib_etat is distinct from 'propose' order by c.profondeur limit 1), 'aucun')$q$,
        'OK', 'FR2899999000010000000000300', null),
      ('17', 'controle', 'une version remplacée ne se confirme plus : une autre saisie est passée, nommée par son jour et son heure', 'chef', null,
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{V5}') p$q$,
        '22023', 'D''autres paramètres de facturation ont été enregistrés entre-temps (le __/__/____ à __:__) : relire avant de confirmer le RIB.', null),
      ('18', 'fait', 'le chef confirme le RIB proposé que sa version a gardé', 'chef', null,
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{V6}') p$q$,
        'OK', 'confirme', null),
      ('18b', 'valeur', 'une facture voit le RIB confirmé', 'proprietaire', null,
        $q$with recursive chaine(id, remplace_id, iban, rib_etat, profondeur) as (
             select p.id, p.remplace_id, p.iban, p.rib_etat, 0 from parametres_facturation p
              where p.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation s where s.remplace_id = p.id)
             union all
             select q.id, q.remplace_id, q.iban, q.rib_etat, c.profondeur + 1 from parametres_facturation q join chaine c on q.id = c.remplace_id
              where c.rib_etat = 'propose')
           select coalesce((select c.iban from chaine c where c.rib_etat is distinct from 'propose' order by c.profondeur limit 1), 'aucun')$q$,
        'OK', 'FR4499999000010000000000400', null),
      ('19', 'fait', 'le client qui porte « Ventes » retire le RIB de ses factures', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V6}', '{"delai_paiement_jours":30,"escompte":"Pas d''escompte pour paiement anticipé."}'::jsonb) p$q$,
        'OK', null, 'V7'),
      ('19b', 'valeur', 'sans IBAN, ni BIC, ni titulaire, ni état ; une facture ne voit plus de RIB', 'proprietaire', null,
        $q$with recursive chaine(id, remplace_id, iban, rib_etat, profondeur) as (
             select p.id, p.remplace_id, p.iban, p.rib_etat, 0 from parametres_facturation p
              where p.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation s where s.remplace_id = p.id)
             union all
             select q.id, q.remplace_id, q.iban, q.rib_etat, c.profondeur + 1 from parametres_facturation q join chaine c on q.id = c.remplace_id
              where c.rib_etat = 'propose')
           select (select coalesce(v.iban, 'nul') || '|' || coalesce(v.bic, 'nul') || '|' || coalesce(v.titulaire_compte, 'nul') || '|' || coalesce(v.rib_etat, 'nul')
                     from parametres_facturation v where v.id = '{V7}')
                  || '|' || coalesce((select c.iban from chaine c where c.rib_etat is distinct from 'propose' order by c.profondeur limit 1), 'aucun')$q$,
        'OK', 'nul|nul|nul|nul|aucun', null),
      ('19c', 'controle', 'une version sans RIB n''a rien à confirmer', 'chef', null,
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{V7}') p$q$,
        '22023', 'Cette version n''a pas de RIB à confirmer.', null),

      -- ══ 20 à 39. Les refus d'enregistrer_parametres_facturation, chacun par sa raison, et leur ordre ══════════
      ('20', 'controle', 'une version à remplacer qui n''existe pas', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{INCONNUE}', '{"delai_paiement_jours":30}'::jsonb) p$q$,
        '22023', 'La version à remplacer n''est pas une version des paramètres de facturation de ce dossier.', null),
      ('20b', 'controle', 'une version du dossier B, désignée sur le dossier A', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{VB1}', '{"delai_paiement_jours":30}'::jsonb) p$q$,
        '22023', 'La version à remplacer n''est pas une version des paramètres de facturation de ce dossier.', null),
      ('21', 'controle', 'une version qui n''est plus la courante : une autre saisie est passée entre-temps, nommée', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"delai_paiement_jours":30}'::jsonb) p$q$,
        '22023', 'D''autres paramètres de facturation ont été enregistrés entre-temps (le __/__/____ à __:__) : relire avant d''enregistrer.', null),
      ('M6', 'mutation', 'le contrôle 21 rejoué avec la version courante : il enregistre', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"delai_paiement_jours":30}'::jsonb) p$q$,
        'OK', null, null),
      ('21b', 'controle', 'une « première » version quand le dossier en a déjà une', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', null, '{"delai_paiement_jours":30}'::jsonb) p$q$,
        '22023', 'D''autres paramètres de facturation ont été enregistrés entre-temps (le __/__/____ à __:__) : relire avant d''enregistrer.', null),
      ('21c', 'controle', 'deux saisies qui partent de la même version : la seconde est refusée, la première nommée', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"delai_paiement_jours":10}'::jsonb) p§§select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"delai_paiement_jours":20}'::jsonb) p$q$,
        '22023', 'D''autres paramètres de facturation ont été enregistrés entre-temps (le __/__/____ à __:__) : relire avant d''enregistrer.', null),
      ('22', 'controle', 'une saisie nulle', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', null) p$q$,
        '22023', 'Les paramètres de facturation se donnent en un objet JSON, un champ par paramètre.', null),
      ('22b', 'controle', 'une saisie qui est un tableau', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '[30]'::jsonb) p$q$,
        '22023', 'Les paramètres de facturation se donnent en un objet JSON, un champ par paramètre.', null),
      ('22c', 'controle', 'une saisie qui est un texte', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '"délai : 30 jours"'::jsonb) p$q$,
        '22023', 'Les paramètres de facturation se donnent en un objet JSON, un champ par paramètre.', null),
      ('22d', 'controle', 'une saisie vide : une version sans aucun paramètre passe', 'chef', null,
        $q$select coalesce(p.delai_paiement_jours::text, 'nul') || '|' || coalesce(p.iban, 'nul') from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{}'::jsonb) p$q$,
        'OK', 'nul|nul', null),
      ('23', 'controle', 'un champ qu''une version n''a pas — « logo » : le logo se donne par logo_chemin et logo_sha256 (étape A5c1)', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"delai_paiement_jours":30,"logo":"essai.png"}'::jsonb) p$q$,
        '22023', 'Le champ « logo » n''est pas un paramètre de facturation.', null),
      ('M8', 'mutation', 'le contrôle 23 rejoué sans le champ : il enregistre', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"delai_paiement_jours":30}'::jsonb) p$q$,
        'OK', null, null),
      ('23b', 'controle', 'deux champs inconnus : le premier dans l''ordre des octets (« Z » avant « a »)', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"alpha":1,"Zeta":2}'::jsonb) p$q$,
        '22023', 'Le champ « Zeta » n''est pas un paramètre de facturation.', null),
      ('23c', 'controle', 'un champ inconnu de cent caractères, nommé coupé', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object(repeat('x', 100), 1)) p$q$,
        '22023', 'Le champ « xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx… » n''est pas un paramètre de facturation.', null),
      ('23d', 'controle', 'l''identifiant n''est pas un champ : une version ne se choisit pas', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object('id', '{V1}')) p$q$,
        '22023', 'Le champ « id » n''est pas un paramètre de facturation.', null),
      ('23e', 'controle', 'l''état du RIB n''est pas un champ : il se déduit', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"FR9399999000010000000000100","rib_etat":"confirme"}'::jsonb) p$q$,
        '22023', 'Le champ « rib_etat » n''est pas un paramètre de facturation.', null),
      ('24', 'controle', 'des conditions d''escompte faites de blancs', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"escompte":" \t\n\r "}'::jsonb) p$q$,
        '22023', 'Les conditions d''escompte sont un texte de trois cents caractères au plus, qui ne soit pas vide.', null),
      ('24b', 'controle', 'des conditions d''escompte qui ne sont pas un texte', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"escompte":0}'::jsonb) p$q$,
        '22023', 'Les conditions d''escompte sont un texte de trois cents caractères au plus, qui ne soit pas vide.', null),
      ('24c', 'controle', 'des conditions d''escompte de trois cent un caractères', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object('escompte', repeat('e', 301))) p$q$,
        '22023', 'Les conditions d''escompte sont un texte de trois cents caractères au plus, qui ne soit pas vide.', null),
      ('24d', 'controle', 'trois cents caractères passent, comptés par caractère', 'chef', null,
        $q$select char_length(p.escompte)::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object('escompte', repeat('é', 300))) p$q$,
        'OK', '300', null),
      ('25', 'controle', 'des pénalités de trois cent un caractères', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object('penalites', repeat('p', 301))) p$q$,
        '22023', 'Les pénalités de retard sont un texte de trois cents caractères au plus, qui ne soit pas vide.', null),
      ('25b', 'controle', 'des pénalités vides', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"penalites":""}'::jsonb) p$q$,
        '22023', 'Les pénalités de retard sont un texte de trois cents caractères au plus, qui ne soit pas vide.', null),
      ('25c', 'controle', 'trois cents caractères de pénalités passent', 'chef', null,
        $q$select char_length(p.penalites)::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object('penalites', repeat('p', 300))) p$q$,
        'OK', '300', null),
      ('26', 'controle', 'des mentions complémentaires de mille et un caractères', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object('mentions_complementaires', repeat('m', 1001))) p$q$,
        '22023', 'Les mentions complémentaires sont un texte de mille caractères au plus, qui ne soit pas vide.', null),
      ('26b', 'controle', 'mille caractères de mentions passent', 'chef', null,
        $q$select char_length(p.mentions_complementaires)::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object('mentions_complementaires', repeat('m', 1000))) p$q$,
        'OK', '1000', null),
      ('26c', 'controle', 'des mentions qui sont un tableau', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"mentions_complementaires":["Mention"]}'::jsonb) p$q$,
        '22023', 'Les mentions complémentaires sont un texte de mille caractères au plus, qui ne soit pas vide.', null),
      ('27', 'controle', 'un pied de page de cinq cent un caractères', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object('pied_de_page', repeat('q', 501))) p$q$,
        '22023', 'Le pied de page est un texte de cinq cents caractères au plus, qui ne soit pas vide.', null),
      ('27b', 'controle', 'cinq cents caractères de pied de page passent', 'chef', null,
        $q$select char_length(p.pied_de_page)::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object('pied_de_page', repeat('q', 500))) p$q$,
        'OK', '500', null),
      ('28', 'controle', 'un délai de soixante et un jours', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"delai_paiement_jours":61}'::jsonb) p$q$,
        '22023', 'Le délai de paiement est un nombre entier de jours, de 0 à 60.', null),
      ('28b', 'controle', 'un délai négatif', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"delai_paiement_jours":-1}'::jsonb) p$q$,
        '22023', 'Le délai de paiement est un nombre entier de jours, de 0 à 60.', null),
      ('28c', 'controle', 'un délai d''un jour et demi de trop', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"delai_paiement_jours":30.5}'::jsonb) p$q$,
        '22023', 'Le délai de paiement est un nombre entier de jours, de 0 à 60.', null),
      ('28d', 'controle', 'un délai écrit en texte', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"delai_paiement_jours":"30"}'::jsonb) p$q$,
        '22023', 'Le délai de paiement est un nombre entier de jours, de 0 à 60.', null),
      ('28e', 'controle', 'zéro et soixante jours passent', 'chef', null,
        $q$select p.delai_paiement_jours::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"delai_paiement_jours":0}'::jsonb) p§§select p.delai_paiement_jours::text from public.enregistrer_parametres_facturation('{DA}', (select x.id from parametres_facturation x where x.dossier_id = '{DA}' and not exists (select 1 from parametres_facturation y where y.remplace_id = x.id)), '{"delai_paiement_jours":60}'::jsonb) p$q$,
        'OK', '60', null),
      ('29', 'controle', 'un moyen de paiement écrit avec une majuscule', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"moyen_prefere":"Virement"}'::jsonb) p$q$,
        '22023', 'Le moyen de paiement proposé est l''un des huit du registre des encaissements.', null),
      ('29b', 'controle', 'un moyen de paiement que le registre ne connaît pas', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"moyen_prefere":"portefeuille"}'::jsonb) p$q$,
        '22023', 'Le moyen de paiement proposé est l''un des huit du registre des encaissements.', null),
      ('29c', 'controle', 'un moyen de paiement qui n''est pas un texte', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"moyen_prefere":1}'::jsonb) p$q$,
        '22023', 'Le moyen de paiement proposé est l''un des huit du registre des encaissements.', null),
      ('29d', 'controle', 'chacun des huit moyens passe', 'chef', null,
        $q$select p.moyen_prefere from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"moyen_prefere":"compensation"}'::jsonb) p$q$,
        'OK', 'compensation', null),
      ('30', 'controle', 'un IBAN écrit avec ses espaces', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"FR93 9999 9000 0100 0000 0000 100"}'::jsonb) p$q$,
        '22023', 'L''IBAN s''écrit sans espace, en majuscules : les deux lettres du pays, deux chiffres de contrôle, puis d''un à trente lettres ou chiffres.', null),
      ('30b', 'controle', 'un IBAN en minuscules', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"fr9399999000010000000000100"}'::jsonb) p$q$,
        '22023', 'L''IBAN s''écrit sans espace, en majuscules : les deux lettres du pays, deux chiffres de contrôle, puis d''un à trente lettres ou chiffres.', null),
      ('30c', 'controle', 'un IBAN réduit à son pays et à sa clé', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"FR93"}'::jsonb) p$q$,
        '22023', 'L''IBAN s''écrit sans espace, en majuscules : les deux lettres du pays, deux chiffres de contrôle, puis d''un à trente lettres ou chiffres.', null),
      ('30d', 'controle', 'un IBAN de trente-cinq caractères', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object('iban', 'FR93' || repeat('9', 31))) p$q$,
        '22023', 'L''IBAN s''écrit sans espace, en majuscules : les deux lettres du pays, deux chiffres de contrôle, puis d''un à trente lettres ou chiffres.', null),
      ('30e', 'controle', 'un IBAN qui n''est pas un texte', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":93999990000100}'::jsonb) p$q$,
        '22023', 'L''IBAN s''écrit sans espace, en majuscules : les deux lettres du pays, deux chiffres de contrôle, puis d''un à trente lettres ou chiffres.', null),
      ('30f', 'controle', 'un IBAN à la clé fausse', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"FR9499999000010000000000100"}'::jsonb) p$q$,
        '22023', 'L''IBAN ne passe pas sa clé de contrôle : une erreur de saisie, sans doute.', null),
      ('M5', 'mutation', 'le contrôle 30f rejoué avec la clé juste : il enregistre', 'chef', null,
        $q$select p.iban from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"FR9399999000010000000000100"}'::jsonb) p$q$,
        'OK', 'FR9399999000010000000000100', null),
      ('30g', 'controle', 'deux chiffres échangés dans le compte : la clé le voit', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"FR9399999000010000000001000"}'::jsonb) p$q$,
        '22023', 'L''IBAN ne passe pas sa clé de contrôle : une erreur de saisie, sans doute.', null),
      ('30h', 'controle', 'un compte qui porte des lettres, à la clé juste, passe', 'chef', null,
        $q$select p.iban from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"FR5799999000010000ESSAI0100"}'::jsonb) p$q$,
        'OK', 'FR5799999000010000ESSAI0100', null),
      ('30i', 'controle', 'un IBAN d''un autre pays, à la clé juste, passe', 'chef', null,
        $q$select p.iban from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"DE93999999990000000001"}'::jsonb) p$q$,
        'OK', 'DE93999999990000000001', null),
      ('31', 'controle', 'un BIC sans IBAN', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"bic":"ESSAFR10"}'::jsonb) p$q$,
        '22023', 'Un BIC se donne avec l''IBAN du compte.', null),
      ('31b', 'controle', 'un BIC de neuf caractères', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"FR9399999000010000000000100","bic":"ESSAFR10X"}'::jsonb) p$q$,
        '22023', 'Le BIC s''écrit en huit ou onze caractères, sans espace, en majuscules : quatre lettres ou chiffres, les deux lettres du pays, deux lettres ou chiffres, puis trois facultatifs.', null),
      ('31c', 'controle', 'un BIC en minuscules', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"FR9399999000010000000000100","bic":"essafr10"}'::jsonb) p$q$,
        '22023', 'Le BIC s''écrit en huit ou onze caractères, sans espace, en majuscules : quatre lettres ou chiffres, les deux lettres du pays, deux lettres ou chiffres, puis trois facultatifs.', null),
      ('31d', 'controle', 'un BIC dont le pays porte un chiffre', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"FR9399999000010000000000100","bic":"ESSA1R10"}'::jsonb) p$q$,
        '22023', 'Le BIC s''écrit en huit ou onze caractères, sans espace, en majuscules : quatre lettres ou chiffres, les deux lettres du pays, deux lettres ou chiffres, puis trois facultatifs.', null),
      ('31e', 'controle', 'un BIC de onze caractères, dont un préfixe à chiffres (ISO 9362:2014), passe', 'chef', null,
        $q$select p.bic from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"FR9399999000010000000000100","bic":"E5SAFR10XXX"}'::jsonb) p$q$,
        'OK', 'E5SAFR10XXX', null),
      ('32', 'controle', 'un titulaire sans IBAN', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"titulaire_compte":"ESSAI PARAMETRES A"}'::jsonb) p$q$,
        '22023', 'Le titulaire du compte se donne avec son IBAN.', null),
      ('32b', 'controle', 'un titulaire de soixante et onze caractères', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object('iban', 'FR9399999000010000000000100', 'titulaire_compte', repeat('t', 71))) p$q$,
        '22023', 'Le titulaire du compte est un texte de soixante-dix caractères au plus, qui ne soit pas vide.', null),
      ('32c', 'controle', 'un titulaire fait de blancs', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"FR9399999000010000000000100","titulaire_compte":"  "}'::jsonb) p$q$,
        '22023', 'Le titulaire du compte est un texte de soixante-dix caractères au plus, qui ne soit pas vide.', null),
      ('32d', 'controle', 'soixante-dix caractères de titulaire passent', 'chef', null,
        $q$select char_length(p.titulaire_compte)::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object('iban', 'FR9399999000010000000000100', 'titulaire_compte', repeat('t', 70))) p$q$,
        'OK', '70', null),
      ('33', 'controle', 'l''ordre : la version remplacée avant la saisie', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '[1]'::jsonb) p$q$,
        '22023', 'D''autres paramètres de facturation ont été enregistrés entre-temps (le __/__/____ à __:__) : relire avant d''enregistrer.', null),
      ('33b', 'controle', 'l''ordre : un champ inconnu avant un texte trop long', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object('escompte', repeat('e', 301), 'remise', 1)) p$q$,
        '22023', 'Le champ « remise » n''est pas un paramètre de facturation.', null),
      ('33c', 'controle', 'l''ordre : les textes avant le délai', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', jsonb_build_object('pied_de_page', '', 'delai_paiement_jours', 99)) p$q$,
        '22023', 'Le pied de page est un texte de cinq cents caractères au plus, qui ne soit pas vide.', null),
      ('33d', 'controle', 'l''ordre : le délai avant le moyen de paiement', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"delai_paiement_jours":99,"moyen_prefere":"troc"}'::jsonb) p$q$,
        '22023', 'Le délai de paiement est un nombre entier de jours, de 0 à 60.', null),
      ('33e', 'controle', 'l''ordre : le moyen de paiement avant l''IBAN', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"moyen_prefere":"troc","iban":"fr93"}'::jsonb) p$q$,
        '22023', 'Le moyen de paiement proposé est l''un des huit du registre des encaissements.', null),
      ('33f', 'controle', 'l''ordre : la clé de l''IBAN avant le BIC', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"iban":"FR9499999000010000000000100","bic":"x"}'::jsonb) p$q$,
        '22023', 'L''IBAN ne passe pas sa clé de contrôle : une erreur de saisie, sans doute.', null),
      ('33g', 'controle', 'l''ordre : le BIC avant le titulaire', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"bic":"x","titulaire_compte":"ESSAI"}'::jsonb) p$q$,
        '22023', 'Un BIC se donne avec l''IBAN du compte.', null),
      ('33h', 'controle', 'l''ordre : l''accès avant la version remplacée', 'client', 'banque',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"delai_paiement_jours":30}'::jsonb) p$q$,
        '42501', 'Accès refusé à ce dossier.', null),

      -- ══ 40 à 45. Les refus de confirmer_rib ══════════
      ('40', 'controle', 'une version qui n''existe pas', 'chef', null,
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{INCONNUE}') p$q$,
        'P0002', 'Version des paramètres de facturation introuvable dans ce dossier.', null),
      ('40b', 'controle', 'une version du dossier B, désignée sur le dossier A', 'chef', null,
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{VB1}') p$q$,
        'P0002', 'Version des paramètres de facturation introuvable dans ce dossier.', null),
      ('40c', 'controle', 'sans droit, une version qui n''existe pas : l''accès d''abord', 'client', 'ventes',
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{INCONNUE}') p$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('41', 'controle', 'le membre affecté au dossier B passe l''accès : son RIB est déjà confirmé', 'membre_affecte', null,
        $q$select p.rib_etat from public.confirmer_rib('{DB}', '{VB1}') p$q$,
        '22023', 'Le RIB de cette version est déjà confirmé.', null),
      ('42', 'controle', 'le membre affecté au dossier B change l''IBAN : confirmé d''emblée, par lui', 'membre_affecte', null,
        $q$select p.rib_etat || '/' || (p.rib_confirme_par = '{CLIENT}') || '/' || (p.auteur = '{CLIENT}') from public.enregistrer_parametres_facturation('{DB}', '{VB1}', '{"iban":"FR1299999000010000000000200"}'::jsonb) p$q$,
        'OK', 'confirme/true/true', null),
      ('43', 'controle', 'le membre affecté au seul dossier B, sur le dossier A (son accès d''essai sans droit)', 'membre_affecte', 'aucun',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"delai_paiement_jours":30}'::jsonb) p$q$,
        '42501', 'Accès refusé à ce dossier.', null),

      -- ══ 50 à 59. Ce que le client lit ══════════
      ('50', 'controle', 'sans droit, aucune version, pas même de son dossier', 'client', 'aucun',
        $q$select (select count(*) from parametres_facturation where dossier_id = '{DA}') || '/' || (select count(*) from parametres_facturation where dossier_id = '{DB}')$q$, 'OK', '0/0', null),
      ('M7', 'mutation', 'le contrôle 50 rejoué avec « Ventes » : il lit', 'client', 'ventes',
        $q$select (select count(*) from parametres_facturation where dossier_id = '{DA}') || '/' || (select count(*) from parametres_facturation where dossier_id = '{DB}')$q$, 'OK', '7/0', null),
      ('51', 'controle', 'avec « Banque » seul, aucune', 'client', 'banque',
        $q$select (select count(*) from parametres_facturation where dossier_id = '{DA}') || '/' || (select count(*) from parametres_facturation where dossier_id = '{DB}')$q$, 'OK', '0/0', null),
      ('52', 'controle', 'avec « Ventes », toutes celles de son dossier, rien du dossier B', 'client', 'ventes',
        $q$select (select count(*) from parametres_facturation where dossier_id = '{DA}') || '/' || (select count(*) from parametres_facturation where dossier_id = '{DB}')$q$, 'OK', '7/0', null),
      ('52b', 'controle', 'avec les deux cases, de même', 'client', 'deux',
        $q$select (select count(*) from parametres_facturation where dossier_id = '{DA}') || '/' || (select count(*) from parametres_facturation where dossier_id = '{DB}')$q$, 'OK', '7/0', null),
      ('53', 'controle', 'avec « Ventes », les RIB, leur état, qui les a posés et confirmés', 'client', 'ventes',
        $q$select count(*) filter (where iban is not null) || '/' || count(*) filter (where rib_etat = 'confirme') || '/' || count(*) filter (where rib_etat = 'propose')
               || '/' || count(*) filter (where rib_confirme_par is not null) || '/' || count(*) filter (where auteur = '{CLIENT}')
             from parametres_facturation where dossier_id = '{DA}'$q$, 'OK', '6/5/1/5/4', null),
      ('54', 'controle', 'un membre non affecté ne lit pas celles du dossier B', 'membre', null,
        $q$select count(*)::text from parametres_facturation where dossier_id = '{DB}'$q$, 'OK', '0', null),
      ('55', 'controle', 'l''anonyme ne lit rien', 'anon', null,
        $q$select count(*)::text from parametres_facturation where dossier_id in ('{DA}', '{DB}')$q$, 'OK', '0', null),
      ('56', 'controle', 'un compte rattaché à rien ne lit rien', 'inconnu', null,
        $q$select count(*)::text from parametres_facturation where dossier_id in ('{DA}', '{DB}')$q$, 'OK', '0', null),
      ('57', 'controle', 'le membre affecté au dossier B lit les siennes', 'membre_affecte', null,
        $q$select count(*)::text from parametres_facturation where dossier_id = '{DB}'$q$, 'OK', '1', null),
      ('58', 'controle', 'le chef du cabinet lit toutes celles de A', 'chef', null,
        $q$select count(*)::text from parametres_facturation where dossier_id = '{DA}'$q$, 'OK', '7', null),

      -- ══ 60 à 69. Aucune écriture directe ══════════
      ('60', 'controle', 'le client qui porte « Ventes » ne pose pas une version directement : la RLS', 'client', 'ventes',
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur) values ('{DA}', '{V7}', '{CLIENT}')$q$,
        '42501', 'new row violates row-level security policy%parametres_facturation%', null),
      ('M4', 'mutation', 'le contrôle 60 rejoué par le super-administrateur : la policy de la restauration le laisse passer', 'chef', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur) values ('{DA}', '{V7}', '{CLIENT}')$q$,
        'OK', null, null),
      ('60b', 'controle', 'un membre affecté, qui n''est pas super-administrateur, non plus', 'membre_affecte', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur) values ('{DB}', '{VB1}', '{CLIENT}')$q$,
        '42501', 'new row violates row-level security policy%parametres_facturation%', null),
      -- Une version qui n'en remplace aucune : la garde, qui passe avant la RLS, ne lit rien, et c'est la RLS qui dit non
      -- (un compte qui ne lit pas la version remplacée tomberait sur la garde, avec une autre raison).
      ('60c', 'controle', 'un compte rattaché à rien non plus', 'inconnu', null,
        $q$insert into parametres_facturation (dossier_id, auteur) values ('{DA}', '{CLIENT}')$q$,
        '42501', 'new row violates row-level security policy%parametres_facturation%', null),
      ('61', 'controle', 'le client qui porte « Ventes » ne confirme pas un RIB directement : aucune ligne touchée', 'client', 'ventes',
        $q$with u as (update parametres_facturation set rib_etat = 'confirme', rib_confirme_par = '{CLIENT}', rib_confirme_le = now() where dossier_id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('61b', 'controle', 'ni ne change un IBAN directement', 'client', 'ventes',
        $q$with u as (update parametres_facturation set iban = 'FR9399999000010000000000100' where id = '{V5}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('61c', 'controle', 'le chef non plus : aucune policy de mise à jour', 'chef', null,
        $q$with u as (update parametres_facturation set escompte = escompte where dossier_id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('62', 'controle', 'même le propriétaire ne modifie pas une version : la garde', 'proprietaire', null,
        $q$update parametres_facturation set escompte = 'changé' where id = '{V7}'$q$,
        '23514', 'Une version des paramètres de facturation ne se modifie pas : une nouvelle version la remplace ; seul le RIB proposé de la version courante se confirme, une fois.', null),
      ('62b', 'controle', 'ni ne confirme le RIB proposé d''une version remplacée', 'proprietaire', null,
        $q$update parametres_facturation set rib_etat = 'confirme', rib_confirme_par = '{CHEF}', rib_confirme_le = now() where id = '{V5}'$q$,
        '23514', 'Une version des paramètres de facturation ne se modifie pas : une nouvelle version la remplace ; seul le RIB proposé de la version courante se confirme, une fois.', null),
      ('62c', 'controle', 'ni ne confirme le RIB proposé de la courante en changeant aussi un autre champ', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, iban, rib_etat) values ('{DA}', '{V7}', '{CLIENT}', 'FR4499999000010000000000400', 'propose') returning id::text§§update parametres_facturation set rib_etat = 'confirme', rib_confirme_par = '{CHEF}', rib_confirme_le = now(), pied_de_page = 'changé' where id = '{RENDU}'$q$,
        '23514', 'Une version des paramètres de facturation ne se modifie pas : une nouvelle version la remplace ; seul le RIB proposé de la version courante se confirme, une fois.', null),
      ('62d', 'controle', 'ni ne rend « proposé » un RIB confirmé', 'proprietaire', null,
        $q$update parametres_facturation set rib_etat = 'propose', rib_confirme_par = null, rib_confirme_le = null where id = '{V1}'$q$,
        '23514', 'Une version des paramètres de facturation ne se modifie pas : une nouvelle version la remplace ; seul le RIB proposé de la version courante se confirme, une fois.', null),
      ('62e', 'controle', 'ni ne fait remplacer une version d''un autre dossier', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur) values ('{DA}', '{VB1}', '{CHEF}')$q$,
        '23514', 'Une version des paramètres de facturation en remplace une de son dossier.', null),
      ('62f', 'controle', 'ni ne réécrit qui a confirmé le RIB de la courante, ni quand', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, iban, rib_etat, rib_confirme_par, rib_confirme_le) values ('{DA}', '{V7}', '{CLIENT}', 'FR4499999000010000000000400', 'confirme', '{CHEF}', now()) returning id::text§§update parametres_facturation set rib_confirme_par = '{CLIENT}', rib_confirme_le = now() + interval '1 day' where id = '{RENDU}'$q$,
        '23514', 'Une version des paramètres de facturation ne se modifie pas : une nouvelle version la remplace ; seul le RIB proposé de la version courante se confirme, une fois.', null),

      -- ══ 70 à 79. Les contraintes de la table : ce que la restauration réinsère passe par elles ══════════
      ('70', 'controle', 'un IBAN en minuscules', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, iban, rib_etat, rib_confirme_par, rib_confirme_le) values ('{DA}', '{V7}', '{CHEF}', 'fr9399999000010000000000100', 'confirme', '{CHEF}', now())$q$,
        '23514', '%parametres_facturation_iban_forme%', null),
      ('70b', 'controle', 'un BIC de neuf caractères', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, iban, bic, rib_etat, rib_confirme_par, rib_confirme_le) values ('{DA}', '{V7}', '{CHEF}', 'FR9399999000010000000000100', 'ESSAFR10X', 'confirme', '{CHEF}', now())$q$,
        '23514', '%parametres_facturation_bic_forme%', null),
      ('70c', 'controle', 'un titulaire de soixante et onze caractères', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, iban, titulaire_compte, rib_etat, rib_confirme_par, rib_confirme_le) values ('{DA}', '{V7}', '{CHEF}', 'FR9399999000010000000000100', repeat('t', 71), 'confirme', '{CHEF}', now())$q$,
        '23514', '%parametres_facturation_titulaire_forme%', null),
      ('71', 'controle', 'un IBAN sans état', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, iban) values ('{DA}', '{V7}', '{CHEF}', 'FR9399999000010000000000100')$q$,
        '23514', '%parametres_facturation_rib_avec_iban%', null),
      ('71b', 'controle', 'un état sans IBAN', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, rib_etat) values ('{DA}', '{V7}', '{CHEF}', 'propose')$q$,
        '23514', '%parametres_facturation_rib_avec_iban%', null),
      ('71c', 'controle', 'un état que la table ne connaît pas', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, iban, rib_etat) values ('{DA}', '{V7}', '{CHEF}', 'FR9399999000010000000000100', 'valide')$q$,
        '23514', '%parametres_facturation_rib_etat%', null),
      ('71d', 'controle', 'un BIC sans IBAN', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, bic) values ('{DA}', '{V7}', '{CHEF}', 'ESSAFR10')$q$,
        '23514', '%parametres_facturation_bic_avec_iban%', null),
      ('71e', 'controle', 'un titulaire sans IBAN', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, titulaire_compte) values ('{DA}', '{V7}', '{CHEF}', 'ESSAI')$q$,
        '23514', '%parametres_facturation_titulaire_avec_iban%', null),
      ('72', 'controle', 'un RIB confirmé sans instant de confirmation', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, iban, rib_etat) values ('{DA}', '{V7}', '{CHEF}', 'FR9399999000010000000000100', 'confirme')$q$,
        '23514', '%parametres_facturation_confirmation%', null),
      ('72b', 'controle', 'un RIB proposé qui porte une confirmation', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, iban, rib_etat, rib_confirme_par, rib_confirme_le) values ('{DA}', '{V7}', '{CHEF}', 'FR9399999000010000000000100', 'propose', '{CHEF}', now())$q$,
        '23514', '%parametres_facturation_confirmation%', null),
      ('72c', 'controle', 'une confirmation sans son auteur', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, iban, rib_etat, rib_confirme_le) values ('{DA}', '{V7}', '{CHEF}', 'FR9399999000010000000000100', 'confirme', now())$q$,
        '23514', '%parametres_facturation_confirmation_entiere%', null),
      ('73', 'controle', 'un délai de soixante et un jours', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, delai_paiement_jours) values ('{DA}', '{V7}', '{CHEF}', 61)$q$,
        '23514', '%parametres_facturation_delai%', null),
      ('73b', 'controle', 'un moyen de paiement inconnu', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, moyen_prefere) values ('{DA}', '{V7}', '{CHEF}', 'troc')$q$,
        '23514', '%parametres_facturation_moyen%', null),
      ('73c', 'controle', 'des conditions d''escompte faites de blancs', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, escompte) values ('{DA}', '{V7}', '{CHEF}', E' \t')$q$,
        '23514', '%parametres_facturation_escompte_forme%', null),
      ('73d', 'controle', 'un pied de page de cinq cent un caractères', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, pied_de_page) values ('{DA}', '{V7}', '{CHEF}', repeat('q', 501))$q$,
        '23514', '%parametres_facturation_pied_de_page_forme%', null),
      ('73e', 'controle', 'des pénalités de trois cent un caractères', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, penalites) values ('{DA}', '{V7}', '{CHEF}', repeat('p', 301))$q$,
        '23514', '%parametres_facturation_penalites_forme%', null),
      ('73f', 'controle', 'des mentions de mille et un caractères', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur, mentions_complementaires) values ('{DA}', '{V7}', '{CHEF}', repeat('m', 1001))$q$,
        '23514', '%parametres_facturation_mentions_forme%', null),
      ('74', 'controle', 'une seconde version qui remplace la même : une seule suite par version', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id, auteur) values ('{DA}', '{V6}', '{CHEF}')$q$,
        '23505', '%parametres_facturation_une_suite%', null),
      ('74b', 'controle', 'une seconde première version : une seule par dossier', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, auteur) values ('{DA}', '{CHEF}')$q$,
        '23505', '%parametres_facturation_une_premiere%', null),
      ('74c', 'controle', 'une version sans auteur', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, remplace_id) values ('{DA}', '{V7}')$q$,
        '23502', '%auteur%', null),
      ('75', 'controle', 'une ligne de sauvegarde complète — un RIB proposé par le client, daté, signé — se réinsère telle quelle', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, delai_paiement_jours, moyen_prefere, escompte, penalites, mentions_complementaires, pied_de_page, iban, bic, titulaire_compte, rib_etat, rib_confirme_par, rib_confirme_le, remplace_id, auteur, cree_le)
           values ('{DA}', 30, 'cheque', 'Pas d''escompte.', 'Pénalités restaurées.', 'Mentions restaurées.', 'Pied restauré.', 'FR4499999000010000000000400', 'ESSAFR10', 'ESSAI', 'propose', null, null, '{V7}', '{CLIENT}', now() - interval '2 days')
           returning rib_etat || '/' || (auteur = '{CLIENT}')$q$,
        'OK', 'propose/true', null),
      ('75b', 'controle', 'une ligne de sauvegarde au RIB confirmé se réinsère telle quelle', 'proprietaire', null,
        $q$insert into parametres_facturation (dossier_id, iban, rib_etat, rib_confirme_par, rib_confirme_le, remplace_id, auteur, cree_le)
           values ('{DA}', 'FR4499999000010000000000400', 'confirme', '{CHEF}', now() - interval '1 day', '{V7}', '{CLIENT}', now() - interval '2 days')
           returning rib_etat || '/' || (rib_confirme_par = '{CHEF}')$q$,
        'OK', 'confirme/true', null),

      -- ══ 80 à 89. L'identité légale du dossier : le cabinet l'écrit, le client ne l'écrit jamais ══════════
      ('80', 'controle', 'le client qui porte « Ventes » n''écrit pas la dénomination : aucune ligne touchée', 'client', 'ventes',
        $q$with u as (update dossiers set denomination_imprimee = 'ESSAI CLIENT' where id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('M9', 'mutation', 'le contrôle 80 rejoué par le chef : il l''écrit', 'chef', null,
        $q$with u as (update dossiers set denomination_imprimee = 'ESSAI CLIENT' where id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '1', null),
      ('80b', 'controle', 'ni la forme, le capital et la ville du greffe, avec les deux cases', 'client', 'deux',
        $q$with u as (update dossiers set forme_juridique = '5499', capital = 1000, rcs_ville = 'Essai' where id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('80c', 'controle', 'ni avec « Banque » seul', 'client', 'banque',
        $q$with u as (update dossiers set denomination_imprimee = 'ESSAI CLIENT' where id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('80d', 'controle', 'ni sans droit', 'client', 'aucun',
        $q$with u as (update dossiers set rcs_ville = 'Essai' where id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('80e', 'controle', 'ni un compte rattaché à rien', 'inconnu', null,
        $q$with u as (update dossiers set capital = 1 where id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('80f', 'controle', 'ni l''anonyme', 'anon', null,
        $q$with u as (update dossiers set forme_juridique = '1000' where id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('80g', 'controle', 'ni un membre du cabinet non affecté au dossier B', 'membre', null,
        $q$with u as (update dossiers set denomination_imprimee = 'ESSAI MEMBRE' where id = '{DB}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('80h', 'controle', 'et les fonctions des paramètres n''écrivent pas le dossier', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V7}', '{"delai_paiement_jours":30}'::jsonb) p§§select coalesce(denomination_imprimee, 'nul') || '|' || coalesce(rcs_ville, 'nul') || '|' || coalesce(forme_juridique, 'nul') || '|' || coalesce(capital::text, 'nul') from dossiers where id = '{DA}'$q$,
        'OK', 'nul|nul|nul|nul', null),
      ('81', 'valeur', 'après tout cela, l''identité de A est restée vide', 'proprietaire', null,
        $q$select coalesce(denomination_imprimee, 'nul') || '|' || coalesce(rcs_ville, 'nul') || '|' || coalesce(forme_juridique, 'nul') || '|' || coalesce(capital::text, 'nul') from dossiers where id = '{DA}'$q$,
        'OK', 'nul|nul|nul|nul', null),
      ('82', 'fait', 'le chef écrit l''identité légale de A', 'chef', null,
        $q$with u as (update dossiers set denomination_imprimee = 'ESSAI PARAMETRES SARL', rcs_ville = 'Ville d essai', forme_juridique = '5499', capital = 1000.5 where id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '1', null),
      ('82b', 'controle', 'le membre affecté écrit celle de B', 'membre_affecte', null,
        $q$with u as (update dossiers set denomination_imprimee = 'ESSAI B EI', forme_juridique = '1000' where id = '{DB}' returning 1) select count(*)::text from u$q$, 'OK', '1', null),
      ('83', 'controle', 'le client qui porte « Ventes » lit l''identité de son dossier, comme tout son dossier', 'client', 'ventes',
        $q$select denomination_imprimee || '|' || rcs_ville || '|' || forme_juridique || '|' || capital from dossiers where id = '{DA}'$q$,
        'OK', 'ESSAI PARAMETRES SARL|Ville d essai|5499|1000.5', null),
      ('83b', 'controle', 'et ne la change pas, même à la valeur qu''elle a', 'client', 'ventes',
        $q$with u as (update dossiers set capital = capital where id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('84', 'controle', 'une forme hors de la nomenclature de l''INSEE', 'proprietaire', null,
        $q$update dossiers set forme_juridique = '5498' where id = '{DA}'$q$,
        '23514', '%dossiers_forme_juridique_insee%', null),
      ('84b', 'controle', 'une forme écrite en trois chiffres', 'proprietaire', null,
        $q$update dossiers set forme_juridique = '549' where id = '{DA}'$q$,
        '23514', '%dossiers_forme_juridique_insee%', null),
      ('84c', 'controle', 'un capital nul', 'proprietaire', null,
        $q$update dossiers set capital = 0 where id = '{DA}'$q$,
        '23514', '%dossiers_capital_forme%', null),
      ('84d', 'controle', 'un capital au millième : jamais arrondi en silence', 'proprietaire', null,
        $q$update dossiers set capital = 1000.555 where id = '{DA}'$q$,
        '23514', '%dossiers_capital_forme%', null),
      ('84e', 'controle', 'un capital à un entrepreneur individuel', 'proprietaire', null,
        $q$update dossiers set forme_juridique = '1000' where id = '{DA}'$q$,
        '23514', '%dossiers_capital_d_une_societe%', null),
      ('84f', 'controle', 'une dénomination faite de blancs', 'proprietaire', null,
        $q$update dossiers set denomination_imprimee = E' \n' where id = '{DA}'$q$,
        '23514', '%dossiers_denomination_imprimee_forme%', null),
      ('84g', 'controle', 'une dénomination de deux cent un caractères', 'proprietaire', null,
        $q$update dossiers set denomination_imprimee = repeat('d', 201) where id = '{DA}'$q$,
        '23514', '%dossiers_denomination_imprimee_forme%', null),
      ('84h', 'controle', 'une ville du greffe de cent un caractères', 'proprietaire', null,
        $q$update dossiers set rcs_ville = repeat('v', 101) where id = '{DA}'$q$,
        '23514', '%dossiers_rcs_ville_forme%', null),
      ('84i', 'controle', 'l''entrepreneur individuel, sans capital, et une dénomination de deux cents caractères passent', 'proprietaire', null,
        $q$with u as (update dossiers set capital = null, forme_juridique = '1000', denomination_imprimee = repeat('d', 200) where id = '{DA}' returning 1) select count(*)::text from u$q$,
        'OK', '1', null),
      -- Plusieurs fautes à la fois : la base les juge dans l'ordre des NOMS de ses contraintes, celui que le module redit.
      ('84j', 'controle', 'l''ordre : un capital d''entrepreneur individuel avant un capital nul et une ville vide', 'proprietaire', null,
        $q$update dossiers set forme_juridique = '1000', capital = 0, rcs_ville = '' where id = '{DA}'$q$,
        '23514', '%dossiers_capital_d_une_societe%', null),
      ('84k', 'controle', 'l''ordre : un capital nul avant une dénomination vide', 'proprietaire', null,
        $q$update dossiers set capital = 0, denomination_imprimee = '' where id = '{DA}'$q$,
        '23514', '%dossiers_capital_forme%', null),
      ('84l', 'controle', 'l''ordre : une dénomination vide avant une forme inconnue et une ville vide', 'proprietaire', null,
        $q$update dossiers set denomination_imprimee = '', forme_juridique = '99', rcs_ville = '' where id = '{DA}'$q$,
        '23514', '%dossiers_denomination_imprimee_forme%', null),
      ('84m', 'controle', 'l''ordre : une forme inconnue avant une ville vide', 'proprietaire', null,
        $q$update dossiers set forme_juridique = '99', rcs_ville = '' where id = '{DA}'$q$,
        '23514', '%dossiers_forme_juridique_insee%', null)
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
    ((select count(*) from dossier_assignations)), ((select count(*) from parametres_facturation))
  ) as t(n);
  -- L'écart seul, non plus les comptes de toute la base, qui diraient le volume d'un dossier réel (audit du 29/10/2026).
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)), 'ok', erreur is null and avant = apres);
  perform set_config('essai.parametres_facturation', verdicts::text, true);
end
$essai$;

-- Les verdicts, et une ligne d'INFORMATION : le texte que la base a reçu, sa longueur et son empreinte — sans le
-- commentaire que l'outil d'exécution ajoute à la fin —, à confronter à la copie transmise (sous psql, qui envoie les
-- instructions une à une, elle ne voit que cette requête-ci).
select x.genre, x.controle, x.verdict, x.observe from (
  select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                   else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
  from jsonb_to_recordset(current_setting('essai.parametres_facturation')::jsonb) as v(controle text, genre text, ok boolean, observe text)
  union all
  select 'information', '0. le texte reçu par la base', 'information', length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by x.genre desc, (regexp_match(x.controle, '^M?(\d+)'))[1]::int, x.controle;
