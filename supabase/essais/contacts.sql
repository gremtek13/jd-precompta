-- LES CONTACTS, ÉPROUVÉS EN BASE (espace client, étape A4a) — à rejouer par `execute_sql` après toute migration qui touche
-- la migration `contacts`, `enregistrer_contact`, `retirer_contact`, `reprendre_contact`, `effacer_contact`,
-- `memberships`, `dossiers` (son statut de TVA et son article d'exonération), `client_du_dossier`, `gere_les_ventes` ou
-- `admin_du_dossier`.
--
-- Ce qui se prouve ici, par impersonation — anonyme, compte rattaché à rien, le client de l'essai sans droit, avec
-- « Banque » seul, avec « Ventes », avec les deux, sur SON dossier ou sur un autre, un membre du cabinet affecté ou non au
-- dossier, le chef du cabinet (super-administrateur), et le propriétaire de la base :
--   - LE CATALOGUE : la table sous RLS, ses trois policies (lecture du cabinet, lecture du droit « Ventes », insertion de
--     restauration) et leurs prédicats, aucune autre ; ses colonnes ; les contraintes de la facture RECOPIÉES TELLES
--     QUELLES ; l'unicité TOTALE du SIRET, aucun index partiel, aucun déclencheur ; les quatre fonctions SECURITY DEFINER,
--     au chemin fixé, fermées à l'anonyme et à PUBLIC, et qui vérifient l'accès AVANT toute autre chose ;
--   - QUI ÉCRIT : le cabinet (le chef, un membre affecté au dossier) et le client qui porte « Ventes », par les mêmes
--     fonctions, chaque contact signé de son auteur ; sans le droit, avec « Banque » seul, sur un autre dossier, membre du
--     cabinet non affecté, ou sur un dossier qui n'existe pas, la RAISON d'accès (« Accès refusé à ce dossier. », 42501) —
--     qui passe avant « introuvable » ;
--   - LES REFUS D'`enregistrer_contact`, chacun sous ses mots, et leur ORDRE (douze rangs : l'accès, le contact du
--     dossier, retiré, effacé, le nom et l'adresse, le type, les identifiants dans l'ordre de la facture — le SIRET pris
--     nommant le contact qui le porte, dit retiré s'il l'est —, l'adresse électronique et le code service, l'e-mail, le
--     délai, les observations, la règle des soins) ; ce que la fonction écrit ;
--   - LA RÈGLE DES SOINS (MEG1-Q10, hypothèse ; A4-Q1 à A4-Q3), dans des dossiers JETABLES : un dossier exonéré au titre
--     des soins, puis redevable d'une activité en partie exonérée au même titre, refuse un particulier et un client établi
--     hors de France, admet une association qui a son SIREN ; un dossier exonéré à un autre titre admet un particulier ;
--     un dossier dont le statut CHANGE après coup garde ses contacts, qui ne se modifient ni ne se reprennent plus, mais
--     se retirent et s'effacent ;
--   - LE RETRAIT, LA REPRISE ET L'EFFACEMENT : leurs refus dans l'ordre, qui les a faits ; l'effacement vérifié COLONNE PAR
--     COLONNE, son retrait effacé avec lui, le SIRET rendu libre, et la COPIE d'une facture brouillon d'essai au même nom
--     de client INCHANGÉE ; un contact effacé ne se modifie, ne se retire, ne se reprend ni ne s'efface plus ;
--   - CE QUE LE CLIENT LIT : avec « Ventes », tous les contacts de son dossier, retirés, effacés et auteurs compris ; sans
--     le droit ou avec « Banque » seul, aucun, pas même de son dossier ; jamais ceux d'un autre dossier ;
--   - AUCUNE ÉCRITURE DIRECTE : une insertion refusée par la RLS (42501) — sauf la porte de la restauration, au
--     super-administrateur —, une mise à jour qui ne touche aucune ligne, pour le client comme pour le cabinet ;
--   - LES CONTRAINTES DE LA TABLE disent ce que la fonction dit, pour ce que la restauration réinsère ;
--   - et que RIEN ne reste en base.
--
-- SANS LA MIGRATION `contacts`, une seule ligne la dit, « EN ATTENTE », SANS être une faute : la migration est présentée au
-- cabinet avant d'être appliquée, et une base qui ne la porte pas se rejoue aussi. Elle EN EST UNE si l'historique des
-- migrations porte `contacts` sans que la table existe — sauf si une ligne `retour_contacts`, plus récente, dit son
-- retour arrière. AVANT LES MIGRATIONS DE L'ÉTAPE P2, l'essai se dit impossible : la migration `contacts` les exige.
--
-- Tout se joue dans six dossiers JETABLES du cabinet du chef (A, où le client de l'essai a un accès d'essai ; B, où il n'en
-- a pas ; C, exonéré au titre des soins ; D, redevable d'une activité en partie exonérée au même titre ; E, en franchise,
-- qui passe aux soins en cours d'essai ; F, exonéré au titre de l'enseignement), au sein d'un bloc qui s'annule
-- entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) : chaque contrôle dans sa sous-transaction, annulée elle aussi
-- (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE avant ; les étapes « fait » sont gardées jusqu'à
-- l'annulation finale, et une étape peut rendre un identifiant que les suivantes citent (`{CLE}`). Un refus se juge à son
-- code ET à son message (`like`). Les droits de l'accès d'essai se posent avant chaque étape qui les nomme ; le membre du
-- cabinet est le compte du client, rangé au cabinet le temps de son contrôle, et ses étapes sur le dossier A posent un
-- accès sans droit. Les identifiants sont ceux, FICTIFS, des autres essais et tests du dépôt (SIREN 123456782, 987654324,
-- 100000207, 111111118 et leurs établissements ; 987654321 n'a pas de clé juste) ; les noms et les adresses sont fictifs. Les
-- verdicts voyagent dans un réglage LOCAL à la transaction (`essai.contacts`) : le fichier se joue d'un seul appel, ne
-- crée aucune table et ne porte AUCUNE instruction de suppression — aucune policy n'en ouvre (contrôle 0a), et un contact
-- ne se supprime pas, il s'efface. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Ce que
-- l'essai ne peut pas jouer en production — la suppression du dossier qui emporte ses contacts, deux sessions qui
-- prennent le même SIRET, le SIRET d'un établissement de La Poste (une entreprise réelle) — se joue sur une réplique
-- (HISTORIQUE.md, « LES CONTACTS, EN BASE »).
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil, un droit ou une cible délibérément faux : chacune
-- doit MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait.
--
-- src/lib/contacts.test.ts lit les étapes ici : chaque refus que src/lib/contacts.ts redit avant le clic doit y être exigé
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
  if to_regclass('public.contacts') is null then
    select max(version) filter (where name = 'contacts'), max(version) filter (where name = 'retour_contacts')
      into applique, retour from supabase_migrations.schema_migrations;
    verdicts := verdicts || jsonb_build_object('controle', '0. EN ATTENTE : la migration contacts (étape A4a) n''est pas en base',
      'genre', 'controle',
      'observe', 'historique : ' || coalesce('contacts ' || applique, 'sans contacts') || coalesce(', retour_contacts ' || retour, ''),
      'ok', applique is null or (retour is not null and retour > applique));
    perform set_config('essai.contacts', verdicts::text, true);
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
    'DA', 'c4a40000-0000-4000-8000-0000000000a1', 'DB', 'c4a40000-0000-4000-8000-0000000000b1',
    'DC', 'c4a40000-0000-4000-8000-0000000000c1', 'DD', 'c4a40000-0000-4000-8000-0000000000d1',
    'DE', 'c4a40000-0000-4000-8000-0000000000e1', 'DF', 'c4a40000-0000-4000-8000-0000000000f1',
    'ACCES', 'c4a40000-0000-4000-8000-0000000000ac', 'INCONNUE', gen_random_uuid());

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from contacts)), ((select count(*) from factures_emises))
  ) as t(n);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre(s), code attendu ou OK, message ou valeur attendus, clé)
      -- genre : « jeu » (posé par le propriétaire, gardé), « controle » (annulé), « fait » (gardé), « valeur » (lecture
      -- par le propriétaire), « mutation » (un contrôle rejoué à faux, qui doit rendre l'inverse). Plusieurs ordres se
      -- séparent par « §§ » ; {RENDU} y vaut ce que le précédent a rendu ; la clé garde ce que l'étape a rendu.
      -- qui : anon, inconnu, client, chef, proprietaire, membre (le compte du client rangé au cabinet, non affecté),
      -- membre_affecte (le même, affecté au dossier B).

      -- ══ Le jeu : six dossiers jetables, un accès d'essai sans droit, une facture brouillon au nom d'un client ══════════
      -- A naît basculé : « Ventes » ne se porte que sur un accès d'un dossier dont les factures sont la source de leurs
      -- ventes (garder_droit_ventes, étape VF8f) ; ses contacts n'en dépendent pas.
      ('j1', 'jeu', 'dossiers jetables A à F', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, article_exoneration, ventes_par_les_factures) values
          ('{DA}', 'ESSAI CONTACTS A', '{CAB}', 'redevable', true, null, true), ('{DB}', 'ESSAI CONTACTS B', '{CAB}', 'redevable', true, null, false),
          ('{DC}', 'ESSAI CONTACTS C', '{CAB}', 'exonere', false, 'cgi_261_4_1', false), ('{DD}', 'ESSAI CONTACTS D', '{CAB}', 'redevable', true, 'cgi_261_4_1', false),
          ('{DE}', 'ESSAI CONTACTS E', '{CAB}', 'franchise', false, null, false), ('{DF}', 'ESSAI CONTACTS F', '{CAB}', 'exonere', false, 'cgi_261_4_4_a', false)$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-contacts@exemple.invalid')$q$, 'OK', null, null),
      ('j3', 'jeu', 'une facture brouillon du dossier A au nom du client que le contact rangera', 'proprietaire', null,
        $q$insert into factures_emises (dossier_id, tiers_nom, tiers_adresse, tiers_siren, tiers_siret, type_client) values ('{DA}', 'Société Essai Contacts', 'Adresse fictive, 00000 Essai', '123456782', '12345678200010', 'assujetti') returning id::text$q$, 'OK', null, 'FACT'),
      ('j4', 'jeu', 'l''empreinte de la facture brouillon, avant tout contact', 'proprietaire', null,
        $q$select md5(f::text) from factures_emises f where f.id = '{FACT}'$q$, 'OK', null, 'EMPREINTE'),

      -- ══ 0. Le catalogue ══════════
      ('0a', 'valeur', 'la table sous RLS, ses trois policies : lecture du cabinet, lecture du droit « Ventes », insertion de restauration ; aucune autre', 'proprietaire', null,
        $q$select c.relname || ':' || c.relrowsecurity || ':' || coalesce((select string_agg(p.polname || '/' || p.polcmd::text || '/' || p.polpermissive || '/'
                 || array_to_string(p.polroles::regrole[]::text[], ','), ',' order by p.polname) from pg_policy p where p.polrelid = c.oid), 'aucune')
             from pg_class c where c.oid = 'public.contacts'::regclass$q$,
        'OK', 'contacts:true:contacts_lecture/r/true/authenticated,contacts_lecture_ventes/r/true/authenticated,contacts_restauration/a/true/authenticated', null),
      ('0b', 'valeur', 'leurs prédicats : le cabinet du dossier, l''accès qui porte « Ventes », le super-administrateur', 'proprietaire', null,
        $q$select string_agg(p.polname || '=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), ' ; ' order by p.polname)
             from pg_policy p where p.polrelid = 'public.contacts'::regclass$q$,
        'OK', 'contacts_lecture=admin_du_dossier(dossier_id)| ; contacts_lecture_ventes=client_du_dossier(dossier_id, ''ventes''::text)| ; contacts_restauration=|is_super_admin()', null),
      ('0c', 'valeur', 'les quatre fonctions : security definer, search_path fixé ; ni anon ni PUBLIC ne les exécutent', 'proprietaire', null,
        $q$select string_agg(p.proname || ' ' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',') || ' anon ' || has_function_privilege('anon', p.oid, 'execute')
               || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
               || ' public ' || exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'), ' | ' order by p.proname)
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('enregistrer_contact', 'retirer_contact', 'reprendre_contact', 'effacer_contact')$q$,
        'OK', 'effacer_contact true search_path=public anon false authenticated true public false | enregistrer_contact true search_path=public anon false authenticated true public false | reprendre_contact true search_path=public anon false authenticated true public false | retirer_contact true search_path=public anon false authenticated true public false', null),
      ('0d', 'valeur', 'chacune vérifie l''accès au dossier annoncé — et qu''il existe — AVANT toute autre chose', 'proprietaire', null,
        $q$select string_agg(p.proname || '=' || (regexp_replace(split_part(split_part(replace(p.prosrc, E'\r\n', E'\n'), E'\nbegin\n', 2), ';', 1), '\s+', ' ', 'g')
               = ' if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then raise exception ''Accès refusé à ce dossier.'' using errcode = ''42501''')::text, ',' order by p.proname)
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('enregistrer_contact', 'retirer_contact', 'reprendre_contact', 'effacer_contact')$q$,
        'OK', 'effacer_contact=true,enregistrer_contact=true,reprendre_contact=true,retirer_contact=true', null),
      ('0e', 'valeur', 'le SIRET unique par une contrainte TOTALE ; aucun index partiel ; aucun déclencheur', 'proprietaire', null,
        $q$select pg_get_constraintdef(co.oid) || ' ; index partiels ' || (select count(*) from pg_index i where i.indrelid = 'public.contacts'::regclass and i.indpred is not null)
               || ' ; déclencheurs ' || (select count(*) from pg_trigger t where t.tgrelid = 'public.contacts'::regclass and not t.tgisinternal)
             from pg_constraint co where co.conrelid = 'public.contacts'::regclass and co.conname = 'contacts_siret_unique'$q$,
        'OK', 'UNIQUE (dossier_id, siret) ; index partiels 0 ; déclencheurs 0', null),
      ('0f', 'valeur', 'les colonnes que le client « Ventes » lit, dans leur ordre (« ! » : non nulle) — aucun téléphone, aucune date de naissance', 'proprietaire', null,
        $q$select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
             from pg_attribute a where a.attrelid = 'public.contacts'::regclass and a.attnum > 0 and not a.attisdropped$q$,
        'OK', 'id:uuid!,dossier_id:uuid!,genre:text!,type_client:text,nom:text!,adresse:text,siren:text,siret:text,adresse_electronique:text,code_service:text,email:text,delai_paiement_jours:integer,observations:text,retire_le:timestamp with time zone,retire_par:uuid,efface_le:timestamp with time zone,efface_par:uuid,cree_par:uuid,cree_le:timestamp with time zone!,modifie_par:uuid,modifie_le:timestamp with time zone', null),
      ('0g', 'valeur', 'les contraintes de la facture, recopiées TELLES QUELLES : un contact range ce qu''une facture accepte', 'proprietaire', null,
        $q$select string_agg(f.suffixe || '=' || (replace(pg_get_constraintdef(fe.oid), 'tiers_', '') = pg_get_constraintdef(co.oid))::text, ',' order by f.suffixe)
             from (values ('type_client_check', 'type_client_check'), ('tiers_siren_check', 'siren_check'), ('siret_du_siren', 'siret_du_siren'),
                          ('adresse_electronique_check', 'adresse_electronique_check'), ('adresse_electronique_routee', 'adresse_electronique_routee'),
                          ('code_service_check', 'code_service_check')) as f(suffixe, contact)
             join pg_constraint fe on fe.conrelid = 'public.factures_emises'::regclass and fe.conname = 'factures_emises_' || f.suffixe
             join pg_constraint co on co.conrelid = 'public.contacts'::regclass and co.conname = 'contacts_' || f.contact$q$,
        'OK', 'adresse_electronique_check=true,adresse_electronique_routee=true,code_service_check=true,siret_du_siren=true,tiers_siren_check=true,type_client_check=true', null),
      ('0h', 'valeur', 'le code service, à un organisme public seulement : la contrainte de la facture, sans le numéro d''engagement (celui d''une commande)', 'proprietaire', null,
        $q$select (replace(pg_get_constraintdef(fe.oid), '(code_service IS NULL) AND (numero_engagement IS NULL)', 'code_service IS NULL')
               = pg_get_constraintdef(co.oid))::text
             from pg_constraint fe, pg_constraint co
            where fe.conrelid = 'public.factures_emises'::regclass and fe.conname = 'factures_emises_organisme_public'
              and co.conrelid = 'public.contacts'::regclass and co.conname = 'contacts_organisme_public'$q$,
        'OK', 'true', null),

      -- ══ 1 à 13. Qui enregistre un contact ══════════
      ('1', 'controle', 'l''anonyme n''exécute pas enregistrer_contact : le droit d''exécution', 'anon', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '42501', 'permission denied for function enregistrer_contact', null),
      ('1b', 'controle', 'l''anonyme n''exécute pas effacer_contact', 'anon', null,
        $q$select c.id::text from public.effacer_contact('{DA}', '{INCONNUE}') c$q$,
        '42501', 'permission denied for function effacer_contact', null),
      ('2', 'controle', 'un compte rattaché à rien : la raison d''accès', 'inconnu', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('3', 'controle', 'le client sans droit, sur son dossier', 'client', 'aucun',
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('4', 'controle', 'le client avec « Banque » seul, sur son dossier', 'client', 'banque',
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('5', 'controle', 'le client avec « Ventes », sur un dossier où il n''a pas d''accès', 'client', 'ventes',
        $q$select c.id::text from public.enregistrer_contact('{DB}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('6', 'controle', 'un membre du cabinet non affecté au dossier B', 'membre', null,
        $q$select c.id::text from public.enregistrer_contact('{DB}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('6b', 'controle', 'le super-administrateur, sur un dossier qui n''existe pas', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{INCONNUE}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('7', 'fait', 'le chef range une entreprise dans A', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Société Essai Contacts","type_client":"assujetti","adresse":"Adresse fictive, 00000 Essai","siren":"123456782","siret":"12345678200010","adresse_electronique":"123456782_12345678200010","email":"compta@exemple.invalid","delai_paiement_jours":30,"observations":"Client d essai"}'::jsonb) c$q$,
        'OK', null, 'CT1'),
      ('7b', 'fait', 'le client qui porte « Ventes » range un particulier dans A', 'client', 'ventes',
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Particulier Essai","type_client":"non_assujetti","adresse":"Adresse fictive, 00000 Essai"}'::jsonb) c$q$,
        'OK', null, 'CT2'),
      ('7c', 'fait', 'un organisme public, son code service et son adresse électronique', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Organisme Essai","type_client":"organisme_public","adresse":"Adresse fictive","siren":"987654324","siret":"98765432400019","adresse_electronique":"987654324_98765432400019","code_service":"SERVICE-ESSAI","delai_paiement_jours":30}'::jsonb) c$q$,
        'OK', null, 'CT3'),
      ('7d', 'fait', 'un client établi hors de France, qui sera retiré', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Client Essai hors de France","type_client":"etranger","adresse":"Adresse fictive hors de France","email":"facturation@exemple.invalid"}'::jsonb) c$q$,
        'OK', null, 'CT4'),
      ('7e', 'fait', 'un contact au nom de quatre-vingt-cinq caractères et à son SIRET', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, jsonb_build_object('nom', repeat('é', 85), 'type_client', 'assujetti', 'adresse', 'Adresse fictive', 'siren', '100000207', 'siret', '10000020700017')) c$q$,
        'OK', null, 'CT5'),
      ('7f', 'fait', 'un contact du dossier B, au SIRET du premier contact de A', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DB}', null, '{"nom":"Contact du dossier B","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200010"}'::jsonb) c$q$,
        'OK', null, 'CTB'),
      ('8', 'valeur', 'ce que la fonction a écrit, champ par champ', 'proprietaire', null,
        $q$select genre || '|' || type_client || '|' || nom || '|' || adresse || '|' || siren || '|' || siret || '|' || adresse_electronique || '|'
               || coalesce(code_service, 'nul') || '|' || email || '|' || delai_paiement_jours || '|' || observations
             from contacts where id = '{CT1}'$q$,
        'OK', 'client|assujetti|Société Essai Contacts|Adresse fictive, 00000 Essai|123456782|12345678200010|123456782_12345678200010|nul|compta@exemple.invalid|30|Client d essai', null),
      ('8b', 'valeur', 'un particulier : ses champs facultatifs nuls', 'proprietaire', null,
        $q$select type_client || '|' || coalesce(siren, 'nul') || '|' || coalesce(siret, 'nul') || '|' || coalesce(adresse_electronique, 'nul') || '|' || coalesce(code_service, 'nul')
               || '|' || coalesce(email, 'nul') || '|' || coalesce(delai_paiement_jours::text, 'nul') || '|' || coalesce(observations, 'nul')
             from contacts where id = '{CT2}'$q$,
        'OK', 'non_assujetti|nul|nul|nul|nul|nul|nul|nul', null),
      ('8c', 'valeur', 'chaque contact signé de son auteur, ni modifié, ni retiré, ni effacé', 'proprietaire', null,
        $q$select (c1.cree_par = '{CHEF}')::text || '/' || (c2.cree_par = '{CLIENT}')::text || '/'
               || (c1.modifie_le is null and c1.modifie_par is null and c1.retire_le is null and c1.efface_le is null and c2.modifie_le is null
                   and c2.retire_le is null and c2.efface_le is null and c1.cree_le is not null)::text
             from contacts c1, contacts c2 where c1.id = '{CT1}' and c2.id = '{CT2}'$q$,
        'OK', 'true/true/true', null),
      ('8d', 'valeur', 'l''organisme public : son code service, son adresse électronique, son délai', 'proprietaire', null,
        $q$select code_service || '|' || adresse_electronique || '|' || delai_paiement_jours from contacts where id = '{CT3}'$q$,
        'OK', 'SERVICE-ESSAI|987654324_98765432400019|30', null),
      ('9', 'controle', 'un membre du cabinet affecté au dossier B y range un contact', 'membre_affecte', null,
        $q$select c.id::text from public.enregistrer_contact('{DB}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'OK', null, null),
      ('10', 'fait', 'le client qui porte « Ventes » modifie l''entreprise, qui garde son SIRET', 'client', 'ventes',
        $q$select c.id::text from public.enregistrer_contact('{DA}', '{CT1}', '{"nom":"Société Essai Contacts","type_client":"assujetti","adresse":"Adresse fictive, 00000 Essai","siren":"123456782","siret":"12345678200010","adresse_electronique":"123456782_12345678200010","email":"compta@exemple.invalid","delai_paiement_jours":45,"observations":"Client d essai, délai porté à 45 jours"}'::jsonb) c$q$,
        'OK', null, null),
      ('10b', 'valeur', 'la modification signée du client ; l''auteur de la création inchangé', 'proprietaire', null,
        $q$select (modifie_par = '{CLIENT}')::text || '/' || (modifie_le is not null)::text || '/' || (cree_par = '{CHEF}')::text || '/' || delai_paiement_jours
             from contacts where id = '{CT1}'$q$,
        'OK', 'true/true/true/45', null),
      ('11', 'controle', 'un contact de A, désigné sur le dossier B : introuvable', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DB}', '{CT1}', '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'P0002', 'Contact introuvable dans ce dossier.', null),
      ('12', 'controle', 'sans droit, un contact qui n''existe pas : l''accès d''abord', 'client', 'aucun',
        $q$select c.id::text from public.enregistrer_contact('{DA}', '{INCONNUE}', '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('13', 'controle', 'le membre affecté au seul dossier B, sur le dossier A (son accès d''essai sans droit)', 'membre_affecte', 'aucun',
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '42501', 'Accès refusé à ce dossier.', null),

      -- ══ 20 à 39. Les refus d'enregistrer_contact, chacun par sa raison, et leur ordre ══════════
      ('20', 'controle', 'un contact qui n''existe pas', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', '{INCONNUE}', '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'P0002', 'Contact introuvable dans ce dossier.', null),
      ('21', 'fait', 'le chef retire le client établi hors de France', 'chef', null,
        $q$select c.id::text from public.retirer_contact('{DA}', '{CT4}') c$q$, 'OK', null, null),
      ('21b', 'controle', 'un contact retiré ne se modifie pas', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', '{CT4}', '{"nom":"Client Essai hors de France","type_client":"etranger","adresse":"Adresse fictive hors de France"}'::jsonb) c$q$,
        '22023', 'Ce contact est retiré : le reprendre avant de le modifier.', null),
      ('22', 'controle', 'le nom absent', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '22023', 'Le nom du contact est à renseigner.', null),
      ('22b', 'controle', 'le nom fait d''espaces', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"   ","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '22023', 'Le nom du contact est à renseigner.', null),
      ('22c', 'controle', 'le nom fait de tabulations et de sauts de ligne', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"\t\n\r ","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '22023', 'Le nom du contact est à renseigner.', null),
      ('22d', 'controle', 'le nom qui n''est pas un texte', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":7,"type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '22023', 'Le nom du contact est à renseigner.', null),
      ('22e', 'controle', 'le nom nul', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":null,"type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '22023', 'Le nom du contact est à renseigner.', null),
      ('22f', 'controle', 'le nom de deux cent un caractères', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, jsonb_build_object('nom', repeat('n', 201), 'type_client', 'assujetti', 'adresse', 'Adresse fictive')) c$q$,
        '22023', 'Le nom du contact tient en deux cents caractères au plus.', null),
      ('22g', 'controle', 'le nom de deux cents caractères passe', 'chef', null,
        $q$select char_length(c.nom)::text from public.enregistrer_contact('{DA}', null, jsonb_build_object('nom', repeat('n', 200), 'type_client', 'assujetti', 'adresse', 'Adresse fictive')) c$q$,
        'OK', '200', null),
      ('22h', 'controle', 'l''adresse absente', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti"}'::jsonb) c$q$,
        '22023', 'L''adresse du contact est à renseigner.', null),
      ('22i', 'controle', 'l''adresse faite de blancs', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":" \n "}'::jsonb) c$q$,
        '22023', 'L''adresse du contact est à renseigner.', null),
      ('22j', 'controle', 'l''adresse qui n''est pas un texte', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":["Adresse fictive"]}'::jsonb) c$q$,
        '22023', 'L''adresse du contact est à renseigner.', null),
      ('22k', 'controle', 'l''adresse de mille et un caractères', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, jsonb_build_object('nom', 'Essai', 'type_client', 'assujetti', 'adresse', repeat('a', 1001))) c$q$,
        '22023', 'L''adresse du contact tient en mille caractères au plus.', null),
      ('22l', 'controle', 'l''adresse de mille caractères passe', 'chef', null,
        $q$select char_length(c.adresse)::text from public.enregistrer_contact('{DA}', null, jsonb_build_object('nom', 'Essai', 'type_client', 'assujetti', 'adresse', repeat('a', 1000))) c$q$,
        'OK', '1000', null),
      ('22m', 'controle', 'une saisie qui n''est pas un objet', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '["Essai","assujetti"]'::jsonb) c$q$,
        '22023', 'Le nom du contact est à renseigner.', null),
      ('22n', 'controle', 'une saisie nulle', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, null) c$q$,
        '22023', 'Le nom du contact est à renseigner.', null),
      ('23', 'controle', 'le type absent', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '22023', 'Le type du contact est l''un des quatre de la facture : une entreprise établie en France, un organisme public, un particulier ou un autre non-assujetti, un client établi hors de France.', null),
      ('23b', 'controle', 'un type que la facture ne connaît pas', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"entreprise","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '22023', 'Le type du contact est l''un des quatre de la facture : une entreprise établie en France, un organisme public, un particulier ou un autre non-assujetti, un client établi hors de France.', null),
      ('23c', 'controle', 'un type écrit avec une majuscule', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"Assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '22023', 'Le type du contact est l''un des quatre de la facture : une entreprise établie en France, un organisme public, un particulier ou un autre non-assujetti, un client établi hors de France.', null),
      ('23d', 'controle', 'un type qui n''est pas un texte', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":1,"adresse":"Adresse fictive"}'::jsonb) c$q$,
        '22023', 'Le type du contact est l''un des quatre de la facture : une entreprise établie en France, un organisme public, un particulier ou un autre non-assujetti, un client établi hors de France.', null),
      ('24', 'controle', 'un client établi hors de France avec un SIREN', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"etranger","adresse":"Adresse fictive","siren":"123456782"}'::jsonb) c$q$,
        '22023', 'Un client établi hors de France n''a ni SIREN ni SIRET.', null),
      ('24a', 'controle', 'un client établi hors de France avec un SIRET seul', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"etranger","adresse":"Adresse fictive","siret":"12345678200028"}'::jsonb) c$q$,
        '22023', 'Un client établi hors de France n''a ni SIREN ni SIRET.', null),
      ('24b', 'controle', 'un SIREN de huit chiffres', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"12345678"}'::jsonb) c$q$,
        '22023', 'Le SIREN du contact s''écrit en neuf chiffres.', null),
      ('24c', 'controle', 'un SIREN écrit avec ses espaces', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"123 456 782"}'::jsonb) c$q$,
        '22023', 'Le SIREN du contact s''écrit en neuf chiffres.', null),
      ('24d', 'controle', 'un SIREN qui n''est pas un texte', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":123456782}'::jsonb) c$q$,
        '22023', 'Le SIREN du contact s''écrit en neuf chiffres.', null),
      ('24e', 'controle', 'un SIREN dont la clé est fausse', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"987654321"}'::jsonb) c$q$,
        '22023', 'Le SIREN du contact ne passe pas sa clé de contrôle.', null),
      ('24f', 'controle', 'un non-assujetti — une association — avec son SIREN passe', 'chef', null,
        $q$select c.siren from public.enregistrer_contact('{DA}', null, '{"nom":"Association Essai","type_client":"non_assujetti","adresse":"Adresse fictive","siren":"111111118"}'::jsonb) c$q$,
        'OK', '111111118', null),
      ('24g', 'controle', 'un SIRET de treize chiffres', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"1234567820001"}'::jsonb) c$q$,
        '22023', 'Le SIRET du contact s''écrit en quatorze chiffres.', null),
      ('24h', 'controle', 'un SIRET dont la clé est fausse', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200011"}'::jsonb) c$q$,
        '22023', 'Le SIRET du contact ne passe pas sa clé de contrôle.', null),
      ('24i', 'controle', 'un SIRET sans son SIREN', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siret":"12345678200028"}'::jsonb) c$q$,
        '22023', 'Un SIRET se donne avec le SIREN qu''il commence : renseigner aussi le SIREN du contact.', null),
      ('24j', 'controle', 'un SIRET d''une autre entreprise que son SIREN', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"987654324","siret":"12345678200028"}'::jsonb) c$q$,
        '22023', 'Le SIRET du contact ne commence pas par son SIREN.', null),
      ('24k', 'controle', 'le SIRET d''un autre contact du dossier : il est nommé', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200010"}'::jsonb) c$q$,
        '23505', 'Le SIRET « 12345678200010 » est déjà celui du contact « Société Essai Contacts » : un établissement ne se range qu''une fois par dossier.', null),
      ('24l', 'controle', 'un nom long se nomme par ses soixante-dix-neuf premiers caractères', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"100000207","siret":"10000020700017"}'::jsonb) c$q$,
        '23505', 'Le SIRET « 10000020700017 » est déjà celui du contact « ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé… » : un établissement ne se range qu''une fois par dossier.', null),
      ('24m', 'fait', 'le chef retire le contact au nom long', 'chef', null,
        $q$select c.id::text from public.retirer_contact('{DA}', '{CT5}') c$q$, 'OK', null, null),
      ('24n', 'controle', 'le SIRET d''un contact retiré : il est nommé, et dit retiré', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"100000207","siret":"10000020700017"}'::jsonb) c$q$,
        '23505', 'Le SIRET « 10000020700017 » est déjà celui du contact « ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé… » (retiré) : un établissement ne se range qu''une fois par dossier.', null),
      ('24o', 'controle', 'le même SIRET dans un autre dossier passe (le contact du dossier B le porte déjà)', 'chef', null,
        $q$select c.siret from public.enregistrer_contact('{DC}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200010"}'::jsonb) c$q$,
        'OK', '12345678200010', null),
      ('24p', 'controle', 'un contact ne prend pas le SIRET d''un autre en se modifiant', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', '{CT3}', '{"nom":"Organisme Essai","type_client":"organisme_public","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200010"}'::jsonb) c$q$,
        '23505', 'Le SIRET « 12345678200010 » est déjà celui du contact « Société Essai Contacts » : un établissement ne se range qu''une fois par dossier.', null),
      ('24q', 'controle', 'deux contacts sans SIRET ne se heurtent pas', 'chef', null,
        $q$select c.type_client from public.enregistrer_contact('{DA}', null, '{"nom":"Particulier Essai","type_client":"non_assujetti","adresse":"Adresse fictive, 00000 Essai"}'::jsonb) c$q$,
        'OK', 'non_assujetti', null),
      ('25', 'controle', 'une adresse de facturation électronique à un particulier', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"non_assujetti","adresse":"Adresse fictive","adresse_electronique":"123456782"}'::jsonb) c$q$,
        '22023', 'Une adresse de facturation électronique ne se donne qu''à une entreprise établie en France ou à un organisme public.', null),
      ('25b', 'controle', 'une adresse de facturation électronique à un client établi hors de France', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"etranger","adresse":"Adresse fictive","adresse_electronique":"123456782"}'::jsonb) c$q$,
        '22023', 'Une adresse de facturation électronique ne se donne qu''à une entreprise établie en France ou à un organisme public.', null),
      ('25c', 'controle', 'une adresse de facturation électronique écrite avec une espace', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","adresse_electronique":"123456782 ESSAI"}'::jsonb) c$q$,
        '22023', 'L''adresse de facturation électronique s''écrit SIREN, SIREN_SIRET, SIREN_SIRET_code de routage ou SIREN_suffixe, sans espace ni accent.', null),
      ('25d', 'controle', 'une adresse de facturation électronique qui ne commence pas par le SIREN du contact', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"987654324","adresse_electronique":"123456782_ESSAI"}'::jsonb) c$q$,
        '22023', 'L''adresse de facturation électronique du contact ne commence pas par son SIREN.', null),
      ('25e', 'controle', 'une adresse à suffixe, sans SIREN au contact, passe', 'chef', null,
        $q$select c.adresse_electronique from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","adresse_electronique":"123456782_ESSAI.COMPTA@1"}'::jsonb) c$q$,
        'OK', '123456782_ESSAI.COMPTA@1', null),
      ('26', 'controle', 'un code service à une entreprise', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","code_service":"SERVICE"}'::jsonb) c$q$,
        '22023', 'Un code service ne se donne qu''à un organisme public.', null),
      ('26b', 'controle', 'un code service fait de blancs', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"organisme_public","adresse":"Adresse fictive","code_service":" \t "}'::jsonb) c$q$,
        '22023', 'Le code service est à renseigner en cent caractères au plus.', null),
      ('26c', 'controle', 'un code service de cent un caractères', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, jsonb_build_object('nom', 'Essai', 'type_client', 'organisme_public', 'adresse', 'Adresse fictive', 'code_service', repeat('s', 101))) c$q$,
        '22023', 'Le code service est à renseigner en cent caractères au plus.', null),
      ('26d', 'controle', 'un code service de cent caractères passe', 'chef', null,
        $q$select char_length(c.code_service)::text from public.enregistrer_contact('{DA}', null, jsonb_build_object('nom', 'Essai', 'type_client', 'organisme_public', 'adresse', 'Adresse fictive', 'code_service', repeat('s', 100))) c$q$,
        'OK', '100', null),
      ('27', 'controle', 'un e-mail sans arobase', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","email":"compta.exemple.invalid"}'::jsonb) c$q$,
        '22023', 'L''e-mail du contact n''est pas une adresse valable (par exemple nom@exemple.fr) de 254 caractères au plus.', null),
      ('27b', 'controle', 'un e-mail qui porte une espace', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","email":"compta @exemple.invalid"}'::jsonb) c$q$,
        '22023', 'L''e-mail du contact n''est pas une adresse valable (par exemple nom@exemple.fr) de 254 caractères au plus.', null),
      ('27c', 'controle', 'un e-mail de deux cent cinquante-cinq caractères', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, jsonb_build_object('nom', 'Essai', 'type_client', 'assujetti', 'adresse', 'Adresse fictive', 'email', repeat('e', 239) || '@exemple.invalid')) c$q$,
        '22023', 'L''e-mail du contact n''est pas une adresse valable (par exemple nom@exemple.fr) de 254 caractères au plus.', null),
      ('27d', 'controle', 'un e-mail qui n''est pas un texte', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","email":true}'::jsonb) c$q$,
        '22023', 'L''e-mail du contact n''est pas une adresse valable (par exemple nom@exemple.fr) de 254 caractères au plus.', null),
      ('27e', 'controle', 'un e-mail de deux cent cinquante-quatre caractères, au signe plus, passe', 'chef', null,
        $q$select char_length(c.email)::text from public.enregistrer_contact('{DA}', null, jsonb_build_object('nom', 'Essai', 'type_client', 'assujetti', 'adresse', 'Adresse fictive', 'email', repeat('e', 236) || '+a@exemple.invalid')) c$q$,
        'OK', '254', null),
      ('28', 'controle', 'un délai de soixante et un jours', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","delai_paiement_jours":61}'::jsonb) c$q$,
        '22023', 'Le délai de paiement du contact est un nombre entier de jours, de 0 à 60.', null),
      ('28b', 'controle', 'un délai négatif', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","delai_paiement_jours":-1}'::jsonb) c$q$,
        '22023', 'Le délai de paiement du contact est un nombre entier de jours, de 0 à 60.', null),
      ('28c', 'controle', 'un délai d''une demi-journée', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","delai_paiement_jours":30.5}'::jsonb) c$q$,
        '22023', 'Le délai de paiement du contact est un nombre entier de jours, de 0 à 60.', null),
      ('28d', 'controle', 'un délai écrit en texte', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","delai_paiement_jours":"30"}'::jsonb) c$q$,
        '22023', 'Le délai de paiement du contact est un nombre entier de jours, de 0 à 60.', null),
      ('28e', 'controle', 'un délai de soixante jours passe', 'chef', null,
        $q$select c.delai_paiement_jours::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","delai_paiement_jours":60}'::jsonb) c$q$,
        'OK', '60', null),
      ('28f', 'controle', 'un délai nul passe, à un particulier aussi', 'chef', null,
        $q$select c.delai_paiement_jours::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"non_assujetti","adresse":"Adresse fictive","delai_paiement_jours":0}'::jsonb) c$q$,
        'OK', '0', null),
      ('29', 'controle', 'des observations de mille et un caractères', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, jsonb_build_object('nom', 'Essai', 'type_client', 'assujetti', 'adresse', 'Adresse fictive', 'observations', repeat('o', 1001))) c$q$,
        '22023', 'Les observations du contact sont un texte de mille caractères au plus.', null),
      ('29b', 'controle', 'des observations qui ne sont pas un texte', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","observations":{"a":1}}'::jsonb) c$q$,
        '22023', 'Les observations du contact sont un texte de mille caractères au plus.', null),
      ('29c', 'controle', 'des observations de mille caractères passent', 'chef', null,
        $q$select char_length(c.observations)::text from public.enregistrer_contact('{DA}', null, jsonb_build_object('nom', 'Essai', 'type_client', 'assujetti', 'adresse', 'Adresse fictive', 'observations', repeat('o', 1000))) c$q$,
        'OK', '1000', null),
      ('30', 'controle', 'L''ORDRE : introuvable avant le nom', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', '{INCONNUE}', '{"nom":" "}'::jsonb) c$q$,
        'P0002', 'Contact introuvable dans ce dossier.', null),
      ('30a', 'controle', 'L''ORDRE : retiré avant le nom', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', '{CT4}', '{"nom":" "}'::jsonb) c$q$,
        '22023', 'Ce contact est retiré : le reprendre avant de le modifier.', null),
      ('30b', 'controle', 'L''ORDRE : le nom avant l''adresse', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":" ","type_client":"assujetti"}'::jsonb) c$q$,
        '22023', 'Le nom du contact est à renseigner.', null),
      ('30c', 'controle', 'L''ORDRE : l''adresse avant le type', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"entreprise"}'::jsonb) c$q$,
        '22023', 'L''adresse du contact est à renseigner.', null),
      ('30d', 'controle', 'L''ORDRE : le type avant le SIREN', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"entreprise","adresse":"Adresse fictive","siren":"1"}'::jsonb) c$q$,
        '22023', 'Le type du contact est l''un des quatre de la facture : une entreprise établie en France, un organisme public, un particulier ou un autre non-assujetti, un client établi hors de France.', null),
      ('30e', 'controle', 'L''ORDRE : un client établi hors de France, son SIREN refusé avant sa forme', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"etranger","adresse":"Adresse fictive","siren":"1"}'::jsonb) c$q$,
        '22023', 'Un client établi hors de France n''a ni SIREN ni SIRET.', null),
      ('30f', 'controle', 'L''ORDRE : la clé du SIREN avant la forme du SIRET', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"987654321","siret":"1"}'::jsonb) c$q$,
        '22023', 'Le SIREN du contact ne passe pas sa clé de contrôle.', null),
      ('30g', 'controle', 'L''ORDRE : la clé du SIRET avant son SIREN', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siret":"12345678200011"}'::jsonb) c$q$,
        '22023', 'Le SIRET du contact ne passe pas sa clé de contrôle.', null),
      ('30h', 'controle', 'L''ORDRE : le SIREN du SIRET avant son unicité', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"987654324","siret":"12345678200010"}'::jsonb) c$q$,
        '22023', 'Le SIRET du contact ne commence pas par son SIREN.', null),
      ('30i', 'controle', 'L''ORDRE : l''unicité du SIRET avant l''adresse électronique', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200010","adresse_electronique":"x"}'::jsonb) c$q$,
        '23505', 'Le SIRET « 12345678200010 » est déjà celui du contact « Société Essai Contacts » : un établissement ne se range qu''une fois par dossier.', null),
      ('30j', 'controle', 'L''ORDRE : à qui se donne une adresse électronique, avant sa forme', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"non_assujetti","adresse":"Adresse fictive","adresse_electronique":"x"}'::jsonb) c$q$,
        '22023', 'Une adresse de facturation électronique ne se donne qu''à une entreprise établie en France ou à un organisme public.', null),
      ('30k', 'controle', 'L''ORDRE : l''adresse électronique avant le code service', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","adresse_electronique":"x","code_service":"S"}'::jsonb) c$q$,
        '22023', 'L''adresse de facturation électronique s''écrit SIREN, SIREN_SIRET, SIREN_SIRET_code de routage ou SIREN_suffixe, sans espace ni accent.', null),
      ('30l', 'controle', 'L''ORDRE : à qui se donne un code service, avant sa forme ; avant l''e-mail', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","code_service":" ","email":"x"}'::jsonb) c$q$,
        '22023', 'Un code service ne se donne qu''à un organisme public.', null),
      ('30m', 'controle', 'L''ORDRE : l''e-mail avant le délai', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","email":"x","delai_paiement_jours":61}'::jsonb) c$q$,
        '22023', 'L''e-mail du contact n''est pas une adresse valable (par exemple nom@exemple.fr) de 254 caractères au plus.', null),
      ('30n', 'controle', 'L''ORDRE : le délai avant les observations', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, jsonb_build_object('nom', 'Essai', 'type_client', 'assujetti', 'adresse', 'Adresse fictive', 'delai_paiement_jours', 61, 'observations', repeat('o', 1001))) c$q$,
        '22023', 'Le délai de paiement du contact est un nombre entier de jours, de 0 à 60.', null),
      ('30o', 'controle', 'L''ORDRE : les observations avant la règle des soins', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DC}', null, jsonb_build_object('nom', 'Essai', 'type_client', 'non_assujetti', 'adresse', 'Adresse fictive', 'observations', repeat('o', 1001))) c$q$,
        '22023', 'Les observations du contact sont un texte de mille caractères au plus.', null),
      ('30p', 'controle', 'L''ORDRE : l''e-mail avant la règle des soins', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DC}', null, '{"nom":"Essai","type_client":"etranger","adresse":"Adresse fictive","email":"x"}'::jsonb) c$q$,
        '22023', 'L''e-mail du contact n''est pas une adresse valable (par exemple nom@exemple.fr) de 254 caractères au plus.', null),

      -- ══ 40 à 49. Retirer, reprendre, effacer : l'accès, le contact, puis l'état ══════════
      ('40', 'controle', 'retirer : un compte rattaché à rien', 'inconnu', null,
        $q$select c.id::text from public.retirer_contact('{DA}', '{CT1}') c$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('40b', 'controle', 'retirer : le client sans droit', 'client', 'aucun',
        $q$select c.id::text from public.retirer_contact('{DA}', '{CT1}') c$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('40c', 'controle', 'retirer : le client avec « Banque » seul', 'client', 'banque',
        $q$select c.id::text from public.retirer_contact('{DA}', '{CT1}') c$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('40d', 'controle', 'retirer : le client avec « Ventes », sur un dossier où il n''a pas d''accès', 'client', 'ventes',
        $q$select c.id::text from public.retirer_contact('{DB}', '{CTB}') c$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('40e', 'controle', 'reprendre : le client sans droit, avant « introuvable »', 'client', 'aucun',
        $q$select c.id::text from public.reprendre_contact('{DA}', '{INCONNUE}') c$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('40f', 'controle', 'effacer : un compte rattaché à rien', 'inconnu', null,
        $q$select c.id::text from public.effacer_contact('{DA}', '{CT2}') c$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('40g', 'controle', 'effacer : le client avec « Banque » seul', 'client', 'banque',
        $q$select c.id::text from public.effacer_contact('{DA}', '{CT2}') c$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('40h', 'controle', 'effacer : le client avec « Ventes », sur un dossier où il n''a pas d''accès', 'client', 'ventes',
        $q$select c.id::text from public.effacer_contact('{DB}', '{CTB}') c$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('40i', 'controle', 'effacer : un membre du cabinet non affecté au dossier B', 'membre', null,
        $q$select c.id::text from public.effacer_contact('{DB}', '{CTB}') c$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('41', 'controle', 'retirer : un contact qui n''existe pas', 'chef', null,
        $q$select c.id::text from public.retirer_contact('{DA}', '{INCONNUE}') c$q$, 'P0002', 'Contact introuvable dans ce dossier.', null),
      ('41b', 'controle', 'retirer : un contact de A désigné sur B', 'chef', null,
        $q$select c.id::text from public.retirer_contact('{DB}', '{CT1}') c$q$, 'P0002', 'Contact introuvable dans ce dossier.', null),
      ('41c', 'controle', 'reprendre : un contact de A désigné sur B', 'chef', null,
        $q$select c.id::text from public.reprendre_contact('{DB}', '{CT4}') c$q$, 'P0002', 'Contact introuvable dans ce dossier.', null),
      ('41d', 'controle', 'effacer : un contact qui n''existe pas', 'chef', null,
        $q$select c.id::text from public.effacer_contact('{DA}', '{INCONNUE}') c$q$, 'P0002', 'Contact introuvable dans ce dossier.', null),
      ('41e', 'controle', 'effacer : un contact de A désigné sur B', 'chef', null,
        $q$select c.id::text from public.effacer_contact('{DB}', '{CT2}') c$q$, 'P0002', 'Contact introuvable dans ce dossier.', null),
      ('42', 'fait', 'le client qui porte « Ventes » retire le particulier', 'client', 'ventes',
        $q$select c.id::text from public.retirer_contact('{DA}', '{CT2}') c$q$, 'OK', null, null),
      ('42b', 'valeur', 'le retrait signé du client', 'proprietaire', null,
        $q$select (retire_par = '{CLIENT}')::text || '/' || (retire_le is not null)::text from contacts where id = '{CT2}'$q$,
        'OK', 'true/true', null),
      ('43', 'controle', 'un contact déjà retiré ne se retire pas', 'chef', null,
        $q$select c.id::text from public.retirer_contact('{DA}', '{CT2}') c$q$, '22023', 'Ce contact est déjà retiré.', null),
      ('44', 'controle', 'un contact qui n''est pas retiré ne se reprend pas', 'chef', null,
        $q$select c.id::text from public.reprendre_contact('{DA}', '{CT1}') c$q$, '22023', 'Ce contact n''est pas retiré.', null),
      ('45', 'fait', 'le chef reprend le particulier retiré par le client', 'chef', null,
        $q$select c.id::text from public.reprendre_contact('{DA}', '{CT2}') c$q$, 'OK', null, null),
      ('45b', 'valeur', 'repris : plus de retrait, la reprise est sa dernière modification, l''auteur de la création inchangé', 'proprietaire', null,
        $q$select (retire_le is null and retire_par is null)::text || '/' || (modifie_par = '{CHEF}')::text || '/' || (modifie_le is not null)::text || '/' || (cree_par = '{CLIENT}')::text
             from contacts where id = '{CT2}'$q$,
        'OK', 'true/true/true/true', null),
      ('46', 'controle', 'le client qui porte « Ventes » reprend un contact (hors d''un dossier de soins)', 'client', 'ventes',
        $q$select coalesce(c.retire_le::text, 'repris') from public.reprendre_contact('{DA}', '{CT4}') c$q$, 'OK', 'repris', null),
      ('46b', 'controle', 'repris, le contact se modifie de nouveau', 'chef', null,
        $q$select c.adresse from public.enregistrer_contact('{DA}', '{CT2}', '{"nom":"Particulier Essai","type_client":"non_assujetti","adresse":"Autre adresse fictive"}'::jsonb) c$q$,
        'OK', 'Autre adresse fictive', null),

      -- ══ 50 à 59. L'effacement : colonne par colonne, la facture inchangée, l'état final ══════════
      ('50', 'fait', 'le client qui porte « Ventes » efface l''entreprise', 'client', 'ventes',
        $q$select c.id::text from public.effacer_contact('{DA}', '{CT1}') c$q$, 'OK', null, null),
      ('51', 'valeur', 'effacé, colonne par colonne : le nom du jour de Paris, ses données vidées, la ligne et ses auteurs gardés', 'proprietaire', null,
        $q$select (nom = 'Contact effacé le ' || to_char((now() at time zone 'Europe/Paris')::date, 'DD/MM/YYYY'))::text || '|' || genre
               || '|' || coalesce(type_client, 'nul') || '|' || coalesce(adresse, 'nul') || '|' || coalesce(siren, 'nul') || '|' || coalesce(siret, 'nul')
               || '|' || coalesce(adresse_electronique, 'nul') || '|' || coalesce(code_service, 'nul') || '|' || coalesce(email, 'nul')
               || '|' || coalesce(delai_paiement_jours::text, 'nul') || '|' || coalesce(observations, 'nul') || '|' || coalesce(retire_le::text, 'nul')
               || '|' || (efface_par = '{CLIENT}')::text || '|' || (efface_le is not null)::text || '|' || (cree_par = '{CHEF}')::text
               || '|' || (modifie_par = '{CLIENT}')::text || '|' || (dossier_id = '{DA}')::text
             from contacts where id = '{CT1}'$q$,
        'OK', 'true|client|nul|nul|nul|nul|nul|nul|nul|nul|nul|nul|true|true|true|true|true', null),
      ('52', 'valeur', 'la facture brouillon au même nom de client : INCHANGÉE, ligne entière', 'proprietaire', null,
        $q$select md5(f::text) from factures_emises f where f.id = '{FACT}'$q$, 'OK', '{EMPREINTE}', null),
      ('52b', 'valeur', 'et elle nomme toujours le client, ses identifiants avec lui', 'proprietaire', null,
        $q$select tiers_nom || '|' || tiers_siren || '|' || tiers_siret from factures_emises where id = '{FACT}'$q$,
        'OK', 'Société Essai Contacts|123456782|12345678200010', null),
      ('53', 'controle', 'un contact effacé ne se modifie plus', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', '{CT1}', '{"nom":"Société Essai Contacts","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '22023', 'Ce contact est effacé : il ne se modifie plus.', null),
      ('53b', 'controle', 'L''ORDRE : effacé avant le nom', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', '{CT1}', '{"nom":" "}'::jsonb) c$q$,
        '22023', 'Ce contact est effacé : il ne se modifie plus.', null),
      ('54', 'controle', 'un contact effacé ne se retire plus', 'chef', null,
        $q$select c.id::text from public.retirer_contact('{DA}', '{CT1}') c$q$, '22023', 'Ce contact est effacé : il ne se retire plus.', null),
      ('55', 'controle', 'un contact effacé ne se reprend plus', 'chef', null,
        $q$select c.id::text from public.reprendre_contact('{DA}', '{CT1}') c$q$, '22023', 'Ce contact est effacé : il ne se reprend plus.', null),
      ('56', 'controle', 'un contact effacé ne s''efface pas deux fois', 'client', 'ventes',
        $q$select c.id::text from public.effacer_contact('{DA}', '{CT1}') c$q$, '22023', 'Ce contact est déjà effacé.', null),
      ('57', 'controle', 'effacé, il rend son SIRET : un autre contact le prend', 'chef', null,
        $q$select c.siret from public.enregistrer_contact('{DA}', null, '{"nom":"Société Essai Contacts","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200010"}'::jsonb) c$q$,
        'OK', '12345678200010', null),
      ('58', 'fait', 'le chef efface le client établi hors de France, retiré', 'chef', null,
        $q$select c.id::text from public.effacer_contact('{DA}', '{CT4}') c$q$, 'OK', null, null),
      ('58b', 'valeur', 'effacé, son retrait l''est aussi : retiré et effacé s''excluent', 'proprietaire', null,
        $q$select (retire_le is null)::text || '/' || (retire_par is null)::text || '/' || (efface_le is not null)::text || '/' || (efface_par = '{CHEF}')::text
               || '/' || coalesce(type_client, 'nul') || '/' || coalesce(email, 'nul')
             from contacts where id = '{CT4}'$q$,
        'OK', 'true/true/true/true/nul/nul', null),
      ('59', 'controle', 'le client qui porte « Ventes » lit le contact effacé, sous son nom d''effacé', 'client', 'ventes',
        $q$select nom from contacts where id = '{CT1}'$q$, 'OK', 'Contact effacé le __/__/____', null),

      -- ══ 60 à 69. La règle des soins (MEG1-Q10, hypothèse ; A4-Q1 à A4-Q4) ══════════
      ('60', 'controle', 'un dossier exonéré au titre des soins ne range pas de particulier', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DC}', null, '{"nom":"Essai","type_client":"non_assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '22023', 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de particulier dans ses contacts : ce seraient ses patients. Un autre non-assujetti, une association par exemple, s''y range avec son SIREN.', null),
      ('60b', 'controle', 'il range une association, avec son SIREN (A4-Q2)', 'chef', null,
        $q$select c.type_client from public.enregistrer_contact('{DC}', null, '{"nom":"Association Essai","type_client":"non_assujetti","adresse":"Adresse fictive","siren":"111111118"}'::jsonb) c$q$,
        'OK', 'non_assujetti', null),
      ('60c', 'controle', 'il ne range pas de client établi hors de France (A4-Q3)', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DC}', null, '{"nom":"Essai","type_client":"etranger","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '22023', 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de client établi hors de France dans ses contacts : il pourrait être un particulier, donc un patient.', null),
      ('60d', 'controle', 'il range une entreprise', 'chef', null,
        $q$select c.type_client from public.enregistrer_contact('{DC}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'OK', 'assujetti', null),
      ('60e', 'controle', 'il range un organisme public', 'chef', null,
        $q$select c.type_client from public.enregistrer_contact('{DC}', null, '{"nom":"Essai","type_client":"organisme_public","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'OK', 'organisme_public', null),
      ('61', 'controle', 'un dossier REDEVABLE dont les soins sont exonérés ne range pas de particulier non plus (A4-Q1)', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DD}', null, '{"nom":"Essai","type_client":"non_assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '22023', 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de particulier dans ses contacts : ce seraient ses patients. Un autre non-assujetti, une association par exemple, s''y range avec son SIREN.', null),
      ('61b', 'controle', 'ni de client établi hors de France', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DD}', null, '{"nom":"Essai","type_client":"etranger","adresse":"Adresse fictive"}'::jsonb) c$q$,
        '22023', 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de client établi hors de France dans ses contacts : il pourrait être un particulier, donc un patient.', null),
      ('62', 'controle', 'un dossier exonéré à un autre titre (l''enseignement) range un particulier', 'chef', null,
        $q$select c.type_client from public.enregistrer_contact('{DF}', null, '{"nom":"Essai","type_client":"non_assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'OK', 'non_assujetti', null),
      ('64', 'fait', 'dans un dossier en franchise, le chef range un particulier', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DE}', null, '{"nom":"Particulier Essai","type_client":"non_assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'OK', null, 'CTE'),
      ('64b', 'fait', 'et un client établi hors de France', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DE}', null, '{"nom":"Client Essai hors de France","type_client":"etranger","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'OK', null, 'CTE2'),
      ('65', 'fait', 'le dossier passe aux soins exonérés : la fonction ne réécrit rien d''elle-même', 'proprietaire', null,
        $q$update dossiers set statut_tva = 'exonere', assujetti_tva = false, article_exoneration = 'cgi_261_4_1' where id = '{DE}' returning id::text$q$,
        'OK', null, null),
      ('65b', 'valeur', 'ses contacts sont toujours là, tels quels', 'proprietaire', null,
        $q$select string_agg(type_client || '/' || coalesce(retire_le::text, 'actif'), ',' order by type_client) from contacts where dossier_id = '{DE}'$q$,
        'OK', 'etranger/actif,non_assujetti/actif', null),
      ('66', 'controle', 'le particulier rangé avant ne se modifie plus', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DE}', '{CTE}', '{"nom":"Particulier Essai","type_client":"non_assujetti","adresse":"Autre adresse fictive"}'::jsonb) c$q$,
        '22023', 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de particulier dans ses contacts : ce seraient ses patients. Un autre non-assujetti, une association par exemple, s''y range avec son SIREN.', null),
      ('66b', 'controle', 'sauf à dire l''association qu''il est, avec son SIREN', 'chef', null,
        $q$select c.siren from public.enregistrer_contact('{DE}', '{CTE}', '{"nom":"Association Essai","type_client":"non_assujetti","adresse":"Adresse fictive","siren":"111111118"}'::jsonb) c$q$,
        'OK', '111111118', null),
      ('67', 'fait', 'le particulier se retire', 'chef', null,
        $q$select c.id::text from public.retirer_contact('{DE}', '{CTE}') c$q$, 'OK', null, null),
      ('67b', 'controle', 'mais ne se reprend pas', 'chef', null,
        $q$select c.id::text from public.reprendre_contact('{DE}', '{CTE}') c$q$,
        '22023', 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de particulier dans ses contacts : ce seraient ses patients. Un autre non-assujetti, une association par exemple, s''y range avec son SIREN.', null),
      ('67c', 'fait', 'le client établi hors de France se retire', 'chef', null,
        $q$select c.id::text from public.retirer_contact('{DE}', '{CTE2}') c$q$, 'OK', null, null),
      ('67d', 'controle', 'et ne se reprend pas non plus', 'chef', null,
        $q$select c.id::text from public.reprendre_contact('{DE}', '{CTE2}') c$q$,
        '22023', 'Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de client établi hors de France dans ses contacts : il pourrait être un particulier, donc un patient.', null),
      ('68', 'fait', 'le particulier s''efface', 'chef', null,
        $q$select c.id::text from public.effacer_contact('{DE}', '{CTE}') c$q$, 'OK', null, null),
      ('68b', 'valeur', 'effacé : plus rien de lui, ni son retrait', 'proprietaire', null,
        $q$select (efface_le is not null)::text || '/' || (retire_le is null)::text || '/' || coalesce(type_client, 'nul') || '/' || coalesce(adresse, 'nul')
             from contacts where id = '{CTE}'$q$,
        'OK', 'true/true/nul/nul', null),

      -- ══ 70 à 79. Ce que le client lit ══════════
      ('70', 'controle', 'sans droit, aucun contact, pas même de son dossier', 'client', 'aucun',
        $q$select (select count(*) from contacts where dossier_id = '{DA}') || '/' || (select count(*) from contacts where dossier_id = '{DB}')$q$, 'OK', '0/0', null),
      ('71', 'controle', 'avec « Banque » seul, aucun', 'client', 'banque',
        $q$select (select count(*) from contacts where dossier_id = '{DA}') || '/' || (select count(*) from contacts where dossier_id = '{DB}')$q$, 'OK', '0/0', null),
      ('72', 'controle', 'avec « Ventes », tous ceux de son dossier, rien du dossier B', 'client', 'ventes',
        $q$select (select count(*) from contacts where dossier_id = '{DA}') || '/' || (select count(*) from contacts where dossier_id = '{DB}')$q$, 'OK', '5/0', null),
      ('72b', 'controle', 'avec les deux cases, de même', 'client', 'deux',
        $q$select (select count(*) from contacts where dossier_id = '{DA}') || '/' || (select count(*) from contacts where dossier_id = '{DB}')$q$, 'OK', '5/0', null),
      ('73', 'controle', 'avec « Ventes », les retirés, les effacés et les auteurs aussi', 'client', 'ventes',
        $q$select count(*) filter (where retire_le is not null) || '/' || count(*) filter (where efface_le is not null) || '/' || count(*) filter (where cree_par is not null)
             from contacts where dossier_id = '{DA}'$q$, 'OK', '1/2/5', null),
      ('74', 'controle', 'un membre non affecté ne lit pas les contacts du dossier B', 'membre', null,
        $q$select count(*)::text from contacts where dossier_id = '{DB}'$q$, 'OK', '0', null),
      ('75', 'controle', 'l''anonyme ne lit rien', 'anon', null,
        $q$select count(*)::text from contacts where dossier_id in ('{DA}', '{DB}')$q$, 'OK', '0', null),
      ('76', 'controle', 'un compte rattaché à rien ne lit rien', 'inconnu', null,
        $q$select count(*)::text from contacts where dossier_id in ('{DA}', '{DB}')$q$, 'OK', '0', null),
      ('77', 'controle', 'le membre affecté au seul dossier B ne lit pas ceux de A (son accès d''essai sans droit)', 'membre_affecte', 'aucun',
        $q$select count(*)::text from contacts where dossier_id = '{DA}'$q$, 'OK', '0', null),
      ('78', 'controle', 'le chef du cabinet lit tous ceux de A', 'chef', null,
        $q$select count(*)::text from contacts where dossier_id = '{DA}'$q$, 'OK', '5', null),

      -- ══ 80 à 89. Aucune écriture directe ══════════
      ('80', 'controle', 'le client qui porte « Ventes » ne pose pas un contact directement : la RLS', 'client', 'ventes',
        $q$insert into contacts (dossier_id, nom, type_client, adresse) values ('{DA}', 'ESSAI DIRECT', 'assujetti', 'Adresse fictive')$q$,
        '42501', 'new row violates row-level security policy%contacts%', null),
      ('80b', 'controle', 'un membre affecté, qui n''est pas super-administrateur, non plus', 'membre_affecte', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse) values ('{DB}', 'ESSAI DIRECT', 'assujetti', 'Adresse fictive')$q$,
        '42501', 'new row violates row-level security policy%contacts%', null),
      ('80c', 'controle', 'un compte rattaché à rien non plus', 'inconnu', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse) values ('{DA}', 'ESSAI DIRECT', 'assujetti', 'Adresse fictive')$q$,
        '42501', 'new row violates row-level security policy%contacts%', null),
      ('81', 'controle', 'le client qui porte « Ventes » ne modifie pas un contact directement : aucune ligne touchée', 'client', 'ventes',
        $q$with u as (update contacts set nom = 'changé' where dossier_id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('81b', 'controle', 'ni ne l''efface directement', 'client', 'ventes',
        $q$with u as (update contacts set nom = 'Contact effacé le 01/01/2000', type_client = null, adresse = null, efface_le = now(), efface_par = '{CLIENT}' where id = '{CT2}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('82', 'controle', 'le chef non plus : aucune policy de mise à jour', 'chef', null,
        $q$with u as (update contacts set nom = 'changé' where dossier_id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('82b', 'controle', 'ni un membre affecté', 'membre_affecte', null,
        $q$with u as (update contacts set nom = 'changé' where dossier_id = '{DB}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),

      -- ══ 90 à 99. Les contraintes de la table : ce que la restauration réinsère passe par elles ══════════
      ('90', 'controle', 'un type que la facture ne connaît pas', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse) values ('{DA}', 'Essai', 'entreprise', 'Adresse fictive')$q$,
        '23514', '%contacts_type_client_check%', null),
      ('90b', 'controle', 'un fournisseur (MEG1-Q9 : les clients seulement)', 'proprietaire', null,
        $q$insert into contacts (dossier_id, genre, nom, type_client, adresse) values ('{DA}', 'fournisseur', 'Essai', 'assujetti', 'Adresse fictive')$q$,
        '23514', '%contacts_genre_check%', null),
      ('91', 'controle', 'un SIREN de huit chiffres', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse, siren) values ('{DA}', 'Essai', 'assujetti', 'Adresse fictive', '12345678')$q$,
        '23514', '%contacts_siren_check%', null),
      ('91b', 'controle', 'le SIRET d''un autre SIREN', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse, siren, siret) values ('{DA}', 'Essai', 'assujetti', 'Adresse fictive', '987654324', '12345678200028')$q$,
        '23514', '%contacts_siret_du_siren%', null),
      ('92', 'controle', 'une adresse électronique hors de la forme de l''annuaire', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse, adresse_electronique) values ('{DA}', 'Essai', 'assujetti', 'Adresse fictive', '123456782 ESSAI')$q$,
        '23514', '%contacts_adresse_electronique_check%', null),
      ('92b', 'controle', 'une adresse électronique à un particulier', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse, adresse_electronique) values ('{DA}', 'Essai', 'non_assujetti', 'Adresse fictive', '123456782')$q$,
        '23514', '%contacts_adresse_electronique_routee%', null),
      ('93', 'controle', 'un code service à une entreprise', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse, code_service) values ('{DA}', 'Essai', 'assujetti', 'Adresse fictive', 'SERVICE')$q$,
        '23514', '%contacts_organisme_public%', null),
      ('93b', 'controle', 'un code service fait d''espaces', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse, code_service) values ('{DA}', 'Essai', 'organisme_public', 'Adresse fictive', '   ')$q$,
        '23514', '%contacts_code_service_check%', null),
      ('94', 'controle', 'un e-mail sans arobase', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse, email) values ('{DA}', 'Essai', 'assujetti', 'Adresse fictive', 'compta.exemple.invalid')$q$,
        '23514', '%contacts_email_forme%', null),
      ('95', 'controle', 'un délai de soixante et un jours', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse, delai_paiement_jours) values ('{DA}', 'Essai', 'assujetti', 'Adresse fictive', 61)$q$,
        '23514', '%contacts_delai_check%', null),
      ('96', 'controle', 'des observations de mille et un caractères', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse, observations) values ('{DA}', 'Essai', 'assujetti', 'Adresse fictive', repeat('o', 1001))$q$,
        '23514', '%contacts_observations_forme%', null),
      ('97', 'controle', 'un nom de blancs', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse) values ('{DA}', E' \t\n', 'assujetti', 'Adresse fictive')$q$,
        '23514', '%contacts_nom_forme%', null),
      ('97b', 'controle', 'un nom de deux cent un caractères', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse) values ('{DA}', repeat('n', 201), 'assujetti', 'Adresse fictive')$q$,
        '23514', '%contacts_nom_forme%', null),
      ('97c', 'controle', 'une adresse de blancs', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse) values ('{DA}', 'Essai', 'assujetti', E'\r\n')$q$,
        '23514', '%contacts_adresse_forme%', null),
      ('98', 'controle', 'un retrait sans son auteur', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse, retire_le) values ('{DA}', 'Essai', 'assujetti', 'Adresse fictive', now())$q$,
        '23514', '%contacts_retrait_entier%', null),
      ('98b', 'controle', 'un effacement sans son auteur', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, efface_le) values ('{DA}', 'Contact effacé le 01/01/2026', now())$q$,
        '23514', '%contacts_effacement_entier%', null),
      ('98c', 'controle', 'une modification sans son instant', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse, modifie_par) values ('{DA}', 'Essai', 'assujetti', 'Adresse fictive', '{CHEF}')$q$,
        '23514', '%contacts_modification_entiere%', null),
      ('98d', 'controle', 'retiré et effacé à la fois', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, retire_le, retire_par, efface_le, efface_par) values ('{DA}', 'Contact effacé le 01/01/2026', now(), '{CHEF}', now(), '{CHEF}')$q$,
        '23514', '%contacts_retire_ou_efface%', null),
      ('98e', 'controle', 'un contact vivant sans type', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, adresse) values ('{DA}', 'Essai', 'Adresse fictive')$q$,
        '23514', '%contacts_vivant_complet%', null),
      ('98f', 'controle', 'un contact vivant sans adresse', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client) values ('{DA}', 'Essai', 'assujetti')$q$,
        '23514', '%contacts_vivant_complet%', null),
      ('98g', 'controle', 'un contact effacé qui garde une donnée', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, email, efface_le, efface_par) values ('{DA}', 'Contact effacé le 01/01/2026', 'compta@exemple.invalid', now(), '{CHEF}')$q$,
        '23514', '%contacts_efface_vide%', null),
      ('98h', 'controle', 'un contact effacé qui garde son nom', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, efface_le, efface_par) values ('{DA}', 'Société Essai Contacts', now(), '{CHEF}')$q$,
        '23514', '%contacts_efface_vide%', null),
      ('99', 'controle', 'le SIRET d''un autre contact du dossier', 'proprietaire', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse, siren, siret) values ('{DA}', 'Essai', 'assujetti', 'Adresse fictive', '100000207', '10000020700017')$q$,
        '23505', '%contacts_siret_unique%', null),
      ('99b', 'controle', 'une ligne de sauvegarde complète — retirée, modifiée, signée — se réinsère telle quelle', 'proprietaire', null,
        $q$insert into contacts (dossier_id, genre, type_client, nom, adresse, siren, siret, adresse_electronique, code_service, email, delai_paiement_jours, observations, retire_le, retire_par, cree_par, cree_le, modifie_par, modifie_le)
           values ('{DA}', 'client', 'organisme_public', 'Organisme Essai restauré', 'Adresse fictive', '987654324', '98765432400027', '987654324_98765432400027_ROUTAGE', 'SERVICE-ESSAI', 'compta@exemple.invalid', 30, 'Restauré', now(), '{CLIENT}', '{CHEF}', now() - interval '2 days', '{CLIENT}', now() - interval '1 day')
           returning type_client || '/' || (retire_par = '{CLIENT}')$q$,
        'OK', 'organisme_public/true', null),
      ('99c', 'controle', 'une ligne de sauvegarde d''un contact effacé se réinsère telle quelle', 'proprietaire', null,
        $q$insert into contacts (dossier_id, genre, nom, efface_le, efface_par, cree_par, cree_le) values ('{DA}', 'client', 'Contact effacé le 01/01/2026', now(), '{CLIENT}', '{CHEF}', now() - interval '3 days')
           returning nom$q$,
        'OK', 'Contact effacé le 01/01/2026', null),

      -- ══ Les mutations ══════════
      ('M1', 'mutation', 'le contrôle 3 rejoué avec « Ventes » : il range', 'client', 'ventes',
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'OK', null, null),
      ('M2', 'mutation', 'le contrôle 70 rejoué avec « Ventes » : il lit', 'client', 'ventes',
        $q$select (select count(*) from contacts where dossier_id = '{DA}') || '/' || (select count(*) from contacts where dossier_id = '{DB}')$q$, 'OK', '5/0', null),
      ('M3', 'mutation', 'le contrôle 6 rejoué avec le membre affecté : il range', 'membre_affecte', null,
        $q$select c.id::text from public.enregistrer_contact('{DB}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'OK', null, null),
      ('M4', 'mutation', 'le contrôle 80 rejoué par le super-administrateur : la policy de la restauration le laisse passer', 'chef', null,
        $q$insert into contacts (dossier_id, nom, type_client, adresse) values ('{DA}', 'ESSAI DIRECT', 'assujetti', 'Adresse fictive')$q$,
        'OK', null, null),
      ('M5', 'mutation', 'le contrôle 24k rejoué avec un SIRET libre : il range', 'chef', null,
        $q$select c.siret from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200028"}'::jsonb) c$q$,
        'OK', '12345678200028', null),
      ('M6', 'mutation', 'le contrôle 43 rejoué sur un contact qui n''est pas retiré : il retire', 'chef', null,
        $q$select c.id::text from public.retirer_contact('{DA}', '{CT3}') c$q$, 'OK', null, null),
      ('M7', 'mutation', 'le contrôle 2 rejoué par le chef : il range', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'OK', null, null),
      ('M8', 'mutation', 'le contrôle 74 rejoué avec le membre affecté : il lit', 'membre_affecte', null,
        $q$select count(*)::text from contacts where dossier_id = '{DB}'$q$, 'OK', '1', null),
      ('M9', 'mutation', 'le contrôle 44 rejoué sur un contact retiré : il reprend', 'chef', null,
        $q$select c.id::text from public.reprendre_contact('{DA}', '{CT5}') c$q$, 'OK', null, null),
      ('M10', 'mutation', 'le contrôle 21b rejoué sur un contact qui n''est pas retiré : il modifie', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', '{CT3}', '{"nom":"Organisme Essai","type_client":"organisme_public","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'OK', null, null),
      ('M11', 'mutation', 'le contrôle 60 rejoué hors d''un dossier de soins : il range le particulier', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"non_assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'OK', null, null),
      ('M12', 'mutation', 'le contrôle 60c rejoué hors d''un dossier de soins : il range le client établi hors de France', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"etranger","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'OK', null, null),
      ('M13', 'mutation', 'le contrôle 53 rejoué sur un contact qui n''est pas effacé : il modifie', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', '{CT2}', '{"nom":"Particulier Essai","type_client":"non_assujetti","adresse":"Adresse fictive"}'::jsonb) c$q$,
        'OK', null, null),
      ('M14', 'mutation', 'le contrôle 56 rejoué sur un contact qui n''est pas effacé : il efface', 'client', 'ventes',
        $q$select c.id::text from public.effacer_contact('{DA}', '{CT3}') c$q$, 'OK', null, null),
      ('M15', 'mutation', 'le contrôle 24e rejoué avec la clé juste : il range', 'chef', null,
        $q$select c.siren from public.enregistrer_contact('{DA}', null, '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive","siren":"987654324"}'::jsonb) c$q$,
        'OK', '987654324', null)
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
    ((select count(*) from dossier_assignations)), ((select count(*) from contacts)), ((select count(*) from factures_emises))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || avant || ' -> ' || apres, 'ok', erreur is null and avant = apres);
  perform set_config('essai.contacts', verdicts::text, true);
end
$essai$;

-- Les verdicts, et une ligne d'INFORMATION : le texte que la base a reçu, sa longueur et son empreinte — sans le
-- commentaire que l'outil d'exécution ajoute à la fin —, à confronter à la copie transmise (sous psql, qui envoie les
-- instructions une à une, elle ne voit que cette requête-ci).
select x.genre, x.controle, x.verdict, x.observe from (
  select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                   else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
  from jsonb_to_recordset(current_setting('essai.contacts')::jsonb) as v(controle text, genre text, ok boolean, observe text)
  union all
  select 'information', '0. le texte reçu par la base', 'information', length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by x.genre desc, (regexp_match(x.controle, '^M?(\d+)'))[1]::int, x.controle;
