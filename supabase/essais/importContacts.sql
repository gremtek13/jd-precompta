-- L'IMPORT D'UN FICHIER DE CLIENTS, ÉPROUVÉ EN BASE (espace client, étape A4b3a) — à rejouer par `execute_sql` après toute
-- migration qui touche `importer_contacts`, `enregistrer_contact`, la table `contacts`, `memberships`, `dossiers` (son
-- statut de TVA et son article d'exonération), `client_du_dossier`, `gere_les_ventes` ou `admin_du_dossier`.
--
-- Ce qui se prouve ici, par impersonation — anonyme, compte rattaché à rien, le client de l'essai sans droit, avec
-- « Banque » seul, avec « Ventes », sur SON dossier ou sur un autre, un membre du cabinet affecté ou non au dossier, le
-- chef du cabinet (super-administrateur), et le propriétaire de la base :
--   - LE CATALOGUE : la fonction SECURITY DEFINER, au chemin fixé, fermée à l'anonyme et à PUBLIC, qui rend un tableau
--     d'identifiants ; l'accès vérifié AVANT toute autre chose ; les champs qu'elle admet sont EXACTEMENT ceux
--     qu'`enregistrer_contact` lit ; elle n'écrit rien elle-même et n'appelle qu'`enregistrer_contact` (aucune règle d'un
--     contact recopiée) ; sa borne ;
--   - QUI IMPORTE : le cabinet (le chef, un membre affecté au dossier) et le client qui porte « Ventes », chaque contact
--     signé de son importateur — `auth.uid()` lu par `enregistrer_contact`, appelée par `importer_contacts` ; sans le
--     droit, avec « Banque » seul, sur un autre dossier, membre du cabinet non affecté, ou sur un dossier qui n'existe pas,
--     la RAISON d'accès (« Accès refusé à ce dossier. », 42501) — qui passe avant toute lecture de l'import, même vide,
--     même au-delà de la borne ;
--   - CE QUE L'IMPORT RANGE : chaque ligne, dans l'ordre du fichier, comme `enregistrer_contact` l'écrit ; les identifiants
--     rendus dans l'ordre ; un même auteur et un même instant de création pour les contacts d'un import ; aucun contact
--     existant modifié ; une clé absente ou nulle vaut nul ;
--   - TOUT OU RIEN : un import dont la troisième ligne est refusée — un SIRET déjà porté par un contact du dossier, un
--     SIRET en double dans le fichier, la règle des soins dans un dossier de soins JETABLE, une forme refusée — est refusé
--     ENTIER, « Ligne 3 : » suivi du message d'`enregistrer_contact`, sous son code ; le premier refus du fichier l'emporte.
--     Un refus qui sort de la fonction défait tout ce qu'elle a écrit (l'instruction est atomique) ; ces quatre imports sont
--     des étapes GARDÉES, et la lecture qui les suit exige le compte des contacts d'avant eux et aucun de leurs noms — une
--     fonction qui rangerait les lignes acceptables en écartant la refusée rendrait des identifiants, ses lignes
--     resteraient, et l'un et l'autre seraient EN FAUTE ;
--   - LES REFUS PROPRES DE L'IMPORT, dans leur ordre : l'accès, puis un tableau JSON, d'au moins une ligne, de mille lignes
--     au plus (la borne comprise : mille passent) ; puis, ligne par ligne, la ligne est un objet JSON, ses champs sont ceux
--     d'un contact (la première clé inconnue dans l'ordre des octets, nommée, son nom coupé à quatre-vingts caractères ;
--     « id » n'en est pas un : l'import ne vise aucun contact existant), avant ce qu'`enregistrer_contact` refuse ;
--   - et que RIEN ne reste en base.
--
-- SANS LA MIGRATION `importer_contacts`, une seule ligne la dit, « EN ATTENTE », SANS être une faute : la migration est
-- présentée au cabinet avant d'être appliquée, et une base qui ne la porte pas se rejoue aussi. Elle EN EST UNE si
-- l'historique des migrations porte `importer_contacts` sans que la fonction existe — sauf si une ligne
-- `retour_importer_contacts`, plus récente, dit son retour arrière.
--
-- Tout se joue dans trois dossiers JETABLES du cabinet du chef (A, redevable, où le client de l'essai a un accès d'essai ; B,
-- redevable, où il n'en a pas ; C, exonéré au titre des soins), au sein d'un bloc qui s'annule entièrement à la fin
-- (`ANNULATION_ESSAI_GLOBALE`) : chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001), le
-- verdict posé dans une VARIABLE avant ; les étapes « fait » sont gardées jusqu'à l'annulation finale, et une étape peut
-- rendre une valeur que les suivantes citent (`{CLE}`). Un refus se juge à son code ET à son message (`like`). Les droits
-- de l'accès d'essai se posent avant chaque étape qui les nomme ; le membre du cabinet est le compte du client, rangé au
-- cabinet le temps de son contrôle, et ses étapes sur le dossier A posent un accès sans droit. Le moteur est celui de
-- contacts.sql. Les identifiants sont ceux, FICTIFS, des autres essais du dépôt (SIREN 123456782, 987654324, 100000207,
-- 111111118 et leurs établissements) ; les noms et les adresses sont fictifs. Les verdicts voyagent dans un réglage LOCAL à
-- la transaction (`essai.import_contacts`) : le fichier se joue d'un seul appel, ne crée aucune table et ne porte AUCUNE
-- instruction de suppression. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Ce que l'essai ne
-- peut pas jouer en production — deux sessions qui écrivent dans le même dossier pendant un import, le délai d'une
-- instruction — se joue sur une réplique (HISTORIQUE.md, « L'IMPORT D'UN FICHIER DE CLIENTS, EN BASE »).
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil, un droit ou une ligne délibérément faux : chacune
-- doit MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait.
--
-- src/lib/contactsImport.test.ts lit les étapes ici : tant que l'export ne porte pas la migration, cet essai est la
-- RÉFÉRENCE des refus de src/lib/contactsImport.ts — chacun doit y être exigé de la base, sous les mêmes mots, et chaque
-- import de l'essai, rejoué dans le module, y reçoit le même premier refus, ou aucun.
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
  if to_regprocedure('public.importer_contacts(uuid, jsonb)') is null then
    select max(version) filter (where name = 'importer_contacts'), max(version) filter (where name = 'retour_importer_contacts')
      into applique, retour from supabase_migrations.schema_migrations;
    verdicts := verdicts || jsonb_build_object('controle', '0. EN ATTENTE : la migration importer_contacts (étape A4b3a) n''est pas en base',
      'genre', 'controle',
      'observe', 'historique : ' || coalesce('importer_contacts ' || applique, 'sans importer_contacts')
                 || coalesce(', retour_importer_contacts ' || retour, ''),
      'ok', applique is null or (retour is not null and retour > applique));
    perform set_config('essai.import_contacts', verdicts::text, true);
    return;
  end if;
  if to_regprocedure('public.enregistrer_contact(uuid, uuid, jsonb)') is null
     or to_regprocedure('public.gere_les_ventes(uuid)') is null then
    raise exception 'ESSAI_IMPOSSIBLE : la migration contacts (étape A4a) n''est pas en base';
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
    'DA', 'c4b30000-0000-4000-8000-0000000000a1', 'DB', 'c4b30000-0000-4000-8000-0000000000b1',
    'DC', 'c4b30000-0000-4000-8000-0000000000c1',
    'ACCES', 'c4b30000-0000-4000-8000-0000000000ac', 'INCONNUE', gen_random_uuid());

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from contacts))
  ) as t(n);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre(s), code attendu ou OK, message ou valeur attendus, clé)
      -- genre : « jeu » (posé par le propriétaire, gardé), « controle » (annulé), « fait » (gardé), « valeur » (lecture
      -- par le propriétaire), « mutation » (un contrôle rejoué à faux, qui doit rendre l'inverse). Plusieurs ordres se
      -- séparent par « §§ » ; {RENDU} y vaut ce que le précédent a rendu ; la clé garde ce que l'étape a rendu.
      -- qui : anon, inconnu, client, chef, proprietaire, membre (le compte du client rangé au cabinet, non affecté),
      -- membre_affecte (le même, affecté au dossier B).

      -- ══ Le jeu : trois dossiers jetables, un accès d'essai sans droit ══════════
      -- A naît basculé : « Ventes » ne se porte que sur un accès d'un dossier dont les factures sont la source de leurs
      -- ventes (garder_droit_ventes, étape VF8f) ; l'import de ses contacts n'en dépend pas.
      ('j1', 'jeu', 'dossiers jetables A, B et C (C dispense des soins exonérés)', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, article_exoneration, ventes_par_les_factures) values
          ('{DA}', 'ESSAI IMPORT A', '{CAB}', 'redevable', true, null, true), ('{DB}', 'ESSAI IMPORT B', '{CAB}', 'redevable', true, null, false),
          ('{DC}', 'ESSAI IMPORT C', '{CAB}', 'exonere', false, 'cgi_261_4_1', false)$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-import@exemple.invalid')$q$, 'OK', null, null),

      -- ══ 0. Le catalogue ══════════
      ('0a', 'valeur', 'la fonction : security definer, search_path fixé, volatile ; ni anon ni PUBLIC ne l''exécutent ; ses arguments, son résultat', 'proprietaire', null,
        $q$select p.proname || ' ' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',') || ' ' || p.provolatile::text
               || ' anon ' || has_function_privilege('anon', p.oid, 'execute')
               || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
               || ' public ' || exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
               || ' | ' || pg_get_function_identity_arguments(p.oid) || ' | ' || pg_get_function_result(p.oid)
             from pg_proc p where p.oid = 'public.importer_contacts(uuid, jsonb)'::regprocedure$q$,
        'OK', 'importer_contacts true search_path=public v anon false authenticated true public false | p_dossier_id uuid, p_contacts jsonb | uuid[]', null),
      ('0b', 'valeur', 'l''accès d''abord : la première instruction du corps', 'proprietaire', null,
        $q$select (prosrc ~ '^\s*declare\s(?:(?!\mbegin\M).)*\mbegin\M\s+(?:--[^\n]*\n\s*)*if not public\.gere_les_ventes\(p_dossier_id\) or not exists \(select 1 from public\.dossiers d where d\.id = p_dossier_id\) then\s+raise exception ''Accès refusé à ce dossier\.'' using errcode = ''42501'';')::text
             from pg_proc where oid = 'public.importer_contacts(uuid, jsonb)'::regprocedure$q$,
        'OK', 'true', null),
      ('0c', 'valeur', 'les champs d''une ligne sont exactement ceux qu''enregistrer_contact lit', 'proprietaire', null,
        $q$select (i.champs = e.champs)::text || ' ' || i.champs from
             (select string_agg(x, ',' order by x collate "C") as champs from (select m[1] as x
                from regexp_matches((regexp_match((select prosrc from pg_proc where oid = 'public.importer_contacts(uuid, jsonb)'::regprocedure),
                                                  'k not in \(([^)]*)\)'))[1], '''(\w+)''', 'g') as m) l) i,
             (select string_agg(x, ',' order by x collate "C") as champs from (select distinct m[1] as x
                from regexp_matches((select prosrc from pg_proc where oid = 'public.enregistrer_contact(uuid, uuid, jsonb)'::regprocedure),
                                    'p_contact->>?''(\w+)''', 'g') as m) l) e$q$,
        'OK', 'true adresse,adresse_electronique,code_service,delai_paiement_jours,email,nom,observations,siren,siret,type_client', null),
      ('0d', 'valeur', 'elle n''écrit rien elle-même et ne nomme que le prédicat, les dossiers et enregistrer_contact', 'proprietaire', null,
        $q$select (c !~* '\m(insert|update|delete|truncate|copy)\M')::text || ' ' || (select string_agg(x, ',' order by x collate "C") from (select distinct m[1] as x from regexp_matches(c, 'public\.(\w+)', 'g') as m) l)
             from (select regexp_replace(prosrc, '--[^\n]*', '', 'g') as c from pg_proc where oid = 'public.importer_contacts(uuid, jsonb)'::regprocedure) t$q$,
        'OK', 'true dossiers,enregistrer_contact,gere_les_ventes', null),
      ('0e', 'valeur', 'sa borne : mille lignes par import (A4B3-Q1)', 'proprietaire', null,
        $q$select string_agg(m[1], ',') from regexp_matches((select prosrc from pg_proc where oid = 'public.importer_contacts(uuid, jsonb)'::regprocedure),
             'jsonb_array_length\(p_contacts\) > (\d+)', 'g') as m$q$,
        'OK', '1000', null),

      -- ══ 1 à 13. Qui importe ══════════
      ('1', 'controle', 'l''anonyme n''exécute pas importer_contacts : le droit d''exécution', 'anon', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}]'::jsonb)::text$q$,
        '42501', 'permission denied for function importer_contacts', null),
      ('2', 'controle', 'un compte rattaché à rien : la raison d''accès', 'inconnu', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}]'::jsonb)::text$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('3', 'controle', 'le client sans droit, sur son dossier', 'client', 'aucun',
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}]'::jsonb)::text$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('4', 'controle', 'le client avec « Banque » seul, sur son dossier', 'client', 'banque',
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}]'::jsonb)::text$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('5', 'controle', 'le client avec « Ventes », sur un dossier où il n''a pas d''accès : le client d''un autre dossier', 'client', 'ventes',
        $q$select public.importer_contacts('{DB}', '[{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}]'::jsonb)::text$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('6', 'controle', 'un membre du cabinet non affecté au dossier B', 'membre', null,
        $q$select public.importer_contacts('{DB}', '[{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}]'::jsonb)::text$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('6b', 'controle', 'le super-administrateur, sur un dossier qui n''existe pas', 'chef', null,
        $q$select public.importer_contacts('{INCONNUE}', '[{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}]'::jsonb)::text$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('6c', 'controle', 'le membre affecté au seul dossier B, sur le dossier A (son accès d''essai sans droit)', 'membre_affecte', 'aucun',
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}]'::jsonb)::text$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('6d', 'controle', 'sans droit, un import vide : l''accès avant l''import', 'client', 'aucun',
        $q$select public.importer_contacts('{DA}', '[]'::jsonb)::text$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('6e', 'controle', 'sans droit, un import qui n''est pas un tableau : l''accès avant l''import', 'client', 'aucun',
        $q$select public.importer_contacts('{DA}', '{"nom":"Essai"}'::jsonb)::text$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('6f', 'controle', 'sans droit, mille et une lignes : l''accès avant la borne', 'client', 'aucun',
        $q$select public.importer_contacts('{DA}', (select jsonb_agg('{"nom":"Essai borne","type_client":"etranger","adresse":"Adresse fictive"}'::jsonb) from generate_series(1, 1001)))::text$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('7', 'fait', 'le chef range un contact dans A, par enregistrer_contact', 'chef', null,
        $q$select c.id::text from public.enregistrer_contact('{DA}', null, '{"nom":"Contact Essai déjà rangé","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200028"}'::jsonb) c$q$,
        'OK', null, 'CT0'),
      ('7b', 'valeur', 'son empreinte, avant tout import', 'proprietaire', null,
        $q$select md5(c::text) from contacts c where c.id = '{CT0}'$q$, 'OK', null, 'EMPREINTE0'),
      ('8', 'fait', 'le chef importe trois lignes dans A : une entreprise, un particulier, un organisme public', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Société Essai Import","type_client":"assujetti","adresse":"Adresse fictive, 00000 Essai","siren":"123456782","siret":"12345678200010","adresse_electronique":"123456782_12345678200010","email":"compta@exemple.invalid","delai_paiement_jours":30,"observations":"Importé d essai"},{"nom":"Particulier Essai Import","type_client":"non_assujetti","adresse":"Adresse fictive, 00000 Essai"},{"nom":"Organisme Essai Import","type_client":"organisme_public","adresse":"Adresse fictive","siren":"987654324","siret":"98765432400019","adresse_electronique":"987654324_98765432400019","code_service":"SERVICE-ESSAI","delai_paiement_jours":30}]'::jsonb)::text$q$,
        'OK', '{%,%,%}', 'IMP1'),
      ('8b', 'valeur', 'les trois contacts, dans l''ordre du fichier, signés du chef', 'proprietaire', null,
        $q$select string_agg(c.nom || ':' || c.type_client || ':' || coalesce(c.siret, '-') || ':' || (c.cree_par = '{CHEF}')::text, '|' order by u.n)
             from unnest('{IMP1}'::uuid[]) with ordinality as u(id, n) join contacts c on c.id = u.id and c.dossier_id = '{DA}'$q$,
        'OK', 'Société Essai Import:assujetti:12345678200010:true|Particulier Essai Import:non_assujetti:-:true|Organisme Essai Import:organisme_public:98765432400019:true', null),
      ('8c', 'valeur', 'la première ligne, champ par champ, comme enregistrer_contact l''écrit', 'proprietaire', null,
        $q$select genre || '|' || type_client || '|' || nom || '|' || adresse || '|' || siren || '|' || siret || '|' || adresse_electronique || '|'
               || coalesce(code_service, 'nul') || '|' || email || '|' || delai_paiement_jours || '|' || observations
             from contacts where id = ('{IMP1}'::uuid[])[1]$q$,
        'OK', 'client|assujetti|Société Essai Import|Adresse fictive, 00000 Essai|123456782|12345678200010|123456782_12345678200010|nul|compta@exemple.invalid|30|Importé d essai', null),
      ('8d', 'valeur', 'la deuxième : ses champs facultatifs nuls (une clé absente vaut nul) ; la troisième : son code service', 'proprietaire', null,
        $q$select coalesce(c2.siren, 'nul') || '|' || coalesce(c2.siret, 'nul') || '|' || coalesce(c2.adresse_electronique, 'nul') || '|' || coalesce(c2.code_service, 'nul')
               || '|' || coalesce(c2.email, 'nul') || '|' || coalesce(c2.delai_paiement_jours::text, 'nul') || '|' || coalesce(c2.observations, 'nul')
               || ' ; ' || c3.code_service || '|' || c3.delai_paiement_jours
             from contacts c2, contacts c3 where c2.id = ('{IMP1}'::uuid[])[2] and c3.id = ('{IMP1}'::uuid[])[3]$q$,
        'OK', 'nul|nul|nul|nul|nul|nul|nul ; SERVICE-ESSAI|30', null),
      ('8e', 'valeur', 'un import : un auteur, un instant de création, rien de modifié, retiré ni effacé', 'proprietaire', null,
        $q$select count(distinct cree_le) || '/' || count(distinct cree_par) || '/' || bool_and(modifie_le is null and modifie_par is null
               and retire_le is null and efface_le is null) from contacts where id = any('{IMP1}'::uuid[])$q$,
        'OK', '1/1/true', null),
      ('8f', 'valeur', 'le contact rangé avant l''import est inchangé', 'proprietaire', null,
        $q$select (md5(c::text) = '{EMPREINTE0}')::text from contacts c where c.id = '{CT0}'$q$, 'OK', 'true', null),
      ('9', 'fait', 'le client qui porte « Ventes » importe trois lignes dans A', 'client', 'ventes',
        $q$select public.importer_contacts('{DA}', '[{"nom":"Client Ventes Import Un","type_client":"etranger","adresse":"Adresse fictive hors de France","email":"facturation@exemple.invalid"},{"nom":"Client Ventes Import Deux","type_client":"assujetti","adresse":"Adresse fictive","siren":"100000207","siret":"10000020700017"},{"nom":"Client Ventes Import Trois","type_client":"non_assujetti","adresse":"Adresse fictive","delai_paiement_jours":0}]'::jsonb)::text$q$,
        'OK', '{%,%,%}', 'IMP2'),
      ('9b', 'valeur', 'ses trois contacts, dans l''ordre du fichier, signés du client : auth.uid() lu par enregistrer_contact, appelée par importer_contacts', 'proprietaire', null,
        $q$select string_agg(c.nom || ':' || (c.cree_par = '{CLIENT}')::text, '|' order by u.n)
             from unnest('{IMP2}'::uuid[]) with ordinality as u(id, n) join contacts c on c.id = u.id and c.dossier_id = '{DA}'$q$,
        'OK', 'Client Ventes Import Un:true|Client Ventes Import Deux:true|Client Ventes Import Trois:true', null),
      ('10', 'controle', 'un membre du cabinet affecté au dossier B y importe', 'membre_affecte', null,
        $q$select array_length(public.importer_contacts('{DB}', '[{"nom":"Essai membre","type_client":"assujetti","adresse":"Adresse fictive"}]'::jsonb), 1)::text$q$,
        'OK', '1', null),
      ('10b', 'controle', 'le dossier de soins range une entreprise et une association qui a son SIREN', 'chef', null,
        $q$select array_length(public.importer_contacts('{DC}', '[{"nom":"Entreprise Essai Soins","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200010"},{"nom":"Association Essai Soins","type_client":"non_assujetti","adresse":"Adresse fictive","siren":"111111118"}]'::jsonb), 1)::text$q$,
        'OK', '2', null),
      ('11', 'controle', 'une clé nulle vaut une clé absente', 'chef', null,
        $q$select array_length(public.importer_contacts('{DA}', '[{"nom":"Essai nuls","type_client":"non_assujetti","adresse":"Adresse fictive","siren":null,"siret":null,"adresse_electronique":null,"code_service":null,"email":null,"delai_paiement_jours":null,"observations":null}]'::jsonb), 1)::text$q$,
        'OK', '1', null),

      -- ══ 20 à 29. Les refus de l'import entier : un tableau, d'au moins une ligne, de mille lignes au plus ══════════
      ('20', 'controle', 'un objet n''est pas un import', 'chef', null,
        $q$select public.importer_contacts('{DA}', '{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb)::text$q$,
        '22023', 'Un import de contacts est un tableau JSON de lignes.', null),
      ('20b', 'controle', 'un import nul non plus', 'chef', null,
        $q$select public.importer_contacts('{DA}', null)::text$q$,
        '22023', 'Un import de contacts est un tableau JSON de lignes.', null),
      ('20c', 'controle', 'un texte non plus', 'chef', null,
        $q$select public.importer_contacts('{DA}', '"Essai"'::jsonb)::text$q$,
        '22023', 'Un import de contacts est un tableau JSON de lignes.', null),
      ('20d', 'controle', 'un nombre non plus', 'chef', null,
        $q$select public.importer_contacts('{DA}', '12'::jsonb)::text$q$,
        '22023', 'Un import de contacts est un tableau JSON de lignes.', null),
      ('21', 'controle', 'un tableau vide', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[]'::jsonb)::text$q$,
        '22023', 'L''import ne porte aucune ligne.', null),
      ('22', 'controle', 'mille et une lignes', 'chef', null,
        $q$select public.importer_contacts('{DA}', (select jsonb_agg('{"nom":"Essai borne","type_client":"etranger","adresse":"Adresse fictive"}'::jsonb) from generate_series(1, 1001)))::text$q$,
        '22023', 'Un import range mille lignes au plus ; celui-ci en porte 1001 : le partager en plusieurs fichiers.', null),
      ('22b', 'controle', 'mille lignes passent : la borne est comprise', 'chef', null,
        $q$select array_length(public.importer_contacts('{DA}', (select jsonb_agg('{"nom":"Essai borne","type_client":"etranger","adresse":"Adresse fictive"}'::jsonb) from generate_series(1, 1000))), 1)::text$q$,
        'OK', '1000', null),
      ('23', 'controle', 'la borne avant les lignes : mille et une lignes dont la première n''est pas un objet', 'chef', null,
        $q$select public.importer_contacts('{DA}', '["pas un objet"]'::jsonb || (select jsonb_agg('{"nom":"Essai borne","type_client":"etranger","adresse":"Adresse fictive"}'::jsonb) from generate_series(1, 1000)))::text$q$,
        '22023', 'Un import range mille lignes au plus ; celui-ci en porte 1001 : le partager en plusieurs fichiers.', null),

      -- ══ 29 à 39. Une ligne refusée : tout l'import l'est, « Ligne N : » suivi du refus, sous son code ══════════
      -- Les quatre imports dont la troisième ligne est refusée (30 à 33) sont des étapes GARDÉES : refusés, ils ne gardent
      -- rien ; rangés à tort, leurs lignes resteraient jusqu'à l'annulation finale, et la lecture 39 les verrait.
      ('29', 'valeur', 'les contacts des dossiers A et C, avant les imports refusés', 'proprietaire', null,
        $q$select count(*)::text from contacts where dossier_id in ('{DA}', '{DC}')$q$, 'OK', '7', 'AVANT'),
      ('30', 'fait', 'la troisième ligne porte un SIRET déjà porté par un contact du dossier', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai trente un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai trente deux","type_client":"etranger","adresse":"Adresse fictive"},{"nom":"Essai trente trois","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200028"}]'::jsonb)::text$q$,
        '23505', 'Ligne 3 : Le SIRET « 12345678200028 » est déjà celui du contact « Contact Essai déjà rangé » : un établissement ne se range qu''une fois par dossier.', null),
      ('30b', 'controle', 'la troisième ligne porte un SIRET qu''un import précédent a rangé', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai trente un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai trente deux","type_client":"etranger","adresse":"Adresse fictive"},{"nom":"Essai trente trois","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200010"}]'::jsonb)::text$q$,
        '23505', 'Ligne 3 : Le SIRET « 12345678200010 » est déjà celui du contact « Société Essai Import » : un établissement ne se range qu''une fois par dossier.', null),
      ('30c', 'controle', 'le client « Ventes » reçoit le même refus, le contact qui porte le SIRET nommé', 'client', 'ventes',
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai trente un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai trente deux","type_client":"etranger","adresse":"Adresse fictive"},{"nom":"Essai trente trois","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200028"}]'::jsonb)::text$q$,
        '23505', 'Ligne 3 : Le SIRET « 12345678200028 » est déjà celui du contact « Contact Essai déjà rangé » : un établissement ne se range qu''une fois par dossier.', null),
      ('31', 'fait', 'la troisième ligne reprend le SIRET de la première : le contact de la première nommé', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Établissement Essai Import","type_client":"assujetti","adresse":"Adresse fictive","siren":"987654324","siret":"98765432400027"},{"nom":"Essai trente et un deux","type_client":"etranger","adresse":"Adresse fictive"},{"nom":"Essai trente et un trois","type_client":"assujetti","adresse":"Adresse fictive","siren":"987654324","siret":"98765432400027"}]'::jsonb)::text$q$,
        '23505', 'Ligne 3 : Le SIRET « 98765432400027 » est déjà celui du contact « Établissement Essai Import » : un établissement ne se range qu''une fois par dossier.', null),
      ('32', 'fait', 'dans le dossier de soins, la troisième ligne est un particulier', 'chef', null,
        $q$select public.importer_contacts('{DC}', '[{"nom":"Entreprise Essai Soins","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200010"},{"nom":"Association Essai Soins","type_client":"non_assujetti","adresse":"Adresse fictive","siren":"111111118"},{"nom":"Particulier Essai Soins","type_client":"non_assujetti","adresse":"Adresse fictive"}]'::jsonb)::text$q$,
        '22023', 'Ligne 3 : Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de particulier dans ses contacts : ce seraient ses patients. Un autre non-assujetti, une association par exemple, s''y range avec son SIREN.', null),
      ('32b', 'controle', 'dans le dossier de soins, la troisième ligne est un client établi hors de France', 'chef', null,
        $q$select public.importer_contacts('{DC}', '[{"nom":"Entreprise Essai Soins","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200010"},{"nom":"Association Essai Soins","type_client":"non_assujetti","adresse":"Adresse fictive","siren":"111111118"},{"nom":"Client Essai Soins hors de France","type_client":"etranger","adresse":"Adresse fictive hors de France"}]'::jsonb)::text$q$,
        '22023', 'Ligne 3 : Un dossier qui dispense des soins exonérés (art. 261, 4, 1° du CGI) ne range pas de client établi hors de France dans ses contacts : il pourrait être un particulier, donc un patient.', null),
      ('33', 'fait', 'la troisième ligne porte un e-mail qui n''est pas une adresse', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai forme un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai forme deux","type_client":"etranger","adresse":"Adresse fictive"},{"nom":"Essai forme trois","type_client":"non_assujetti","adresse":"Adresse fictive","email":"pas une adresse"}]'::jsonb)::text$q$,
        '22023', 'Ligne 3 : L''e-mail du contact n''est pas une adresse valable (par exemple nom@exemple.fr) de 254 caractères au plus.', null),
      ('33b', 'controle', 'la troisième ligne n''a pas de nom (une clé absente vaut nul : enregistrer_contact le refuse sous ses mots)', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai forme un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai forme deux","type_client":"etranger","adresse":"Adresse fictive"},{"type_client":"non_assujetti","adresse":"Adresse fictive"}]'::jsonb)::text$q$,
        '22023', 'Ligne 3 : Le nom du contact est à renseigner.', null),
      ('33c', 'controle', 'la troisième ligne porte un SIRET sans son SIREN', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai forme un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai forme deux","type_client":"etranger","adresse":"Adresse fictive"},{"nom":"Essai forme trois","type_client":"assujetti","adresse":"Adresse fictive","siret":"98765432400027"}]'::jsonb)::text$q$,
        '22023', 'Ligne 3 : Un SIRET se donne avec le SIREN qu''il commence : renseigner aussi le SIREN du contact.', null),
      ('33d', 'controle', 'la troisième ligne porte un délai de soixante et un jours', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai forme un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai forme deux","type_client":"etranger","adresse":"Adresse fictive"},{"nom":"Essai forme trois","type_client":"non_assujetti","adresse":"Adresse fictive","delai_paiement_jours":61}]'::jsonb)::text$q$,
        '22023', 'Ligne 3 : Le délai de paiement du contact est un nombre entier de jours, de 0 à 60.', null),
      ('34', 'controle', 'la troisième ligne est un texte, pas un objet', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai forme un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai forme deux","type_client":"etranger","adresse":"Adresse fictive"},"Essai forme trois"]'::jsonb)::text$q$,
        '22023', 'Ligne 3 : Une ligne de l''import est un objet JSON aux champs d''un contact.', null),
      ('34b', 'controle', 'la troisième ligne est un tableau', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai forme un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai forme deux","type_client":"etranger","adresse":"Adresse fictive"},["Essai forme trois"]]'::jsonb)::text$q$,
        '22023', 'Ligne 3 : Une ligne de l''import est un objet JSON aux champs d''un contact.', null),
      ('34c', 'controle', 'la troisième ligne est nulle', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai forme un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai forme deux","type_client":"etranger","adresse":"Adresse fictive"},null]'::jsonb)::text$q$,
        '22023', 'Ligne 3 : Une ligne de l''import est un objet JSON aux champs d''un contact.', null),
      ('35', 'controle', 'la troisième ligne porte un champ qu''un contact n''a pas : nommé', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai forme un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai forme deux","type_client":"etranger","adresse":"Adresse fictive"},{"nom":"Essai forme trois","type_client":"non_assujetti","adresse":"Adresse fictive","telephone":"0000000000"}]'::jsonb)::text$q$,
        '22023', 'Ligne 3 : « telephone » n''est pas un champ d''un contact.', null),
      ('35b', 'controle', 'trois champs inconnus : le premier dans l''ordre des octets, la majuscule avant la minuscule (la collation de la base n''y est pour rien)', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai forme un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai forme deux","type_client":"etranger","adresse":"Adresse fictive"},{"nom":"Essai forme trois","type_client":"non_assujetti","adresse":"Adresse fictive","telephone":"0000000000","fax":"0000000000","Naissance":"2000-01-01"}]'::jsonb)::text$q$,
        '22023', 'Ligne 3 : « Naissance » n''est pas un champ d''un contact.', null),
      ('35c', 'controle', 'l''identifiant d''un contact existant n''est pas un champ : l''import ne modifie rien', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai forme un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai forme deux","type_client":"etranger","adresse":"Adresse fictive"},{"id":"{CT0}","nom":"Contact Essai renommé","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200028"}]'::jsonb)::text$q$,
        '22023', 'Ligne 3 : « id » n''est pas un champ d''un contact.', null),
      ('35d', 'controle', 'un champ inconnu de cent caractères se nomme coupé à quatre-vingts', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai forme un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai forme deux","type_client":"etranger","adresse":"Adresse fictive"},{"nom":"Essai forme trois","type_client":"non_assujetti","adresse":"Adresse fictive","xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx":"0"}]'::jsonb)::text$q$,
        '22023', 'Ligne 3 : « xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx… » n''est pas un champ d''un contact.', null),
      ('36', 'controle', 'dans une ligne, le champ inconnu avant ce qu''enregistrer_contact refuse', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai forme un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai forme deux","type_client":"etranger","adresse":"Adresse fictive"},{"type_client":"inconnu","telephone":"0000000000"}]'::jsonb)::text$q$,
        '22023', 'Ligne 3 : « telephone » n''est pas un champ d''un contact.', null),
      ('37', 'controle', 'le premier refus du fichier l''emporte : la ligne 2, avant la ligne 3', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai ordre un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai ordre deux","type_client":"non_assujetti","adresse":"Adresse fictive","email":"pas une adresse"},{"nom":"Essai ordre trois","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200028"}]'::jsonb)::text$q$,
        '22023', 'Ligne 2 : L''e-mail du contact n''est pas une adresse valable (par exemple nom@exemple.fr) de 254 caractères au plus.', null),
      ('38', 'controle', 'les lignes se comptent depuis un : la première refusée', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai ordre un","type_client":"entreprise","adresse":"Adresse fictive"},{"nom":"Essai ordre deux","type_client":"non_assujetti","adresse":"Adresse fictive"}]'::jsonb)::text$q$,
        '22023', 'Ligne 1 : Le type du contact est l''un des quatre de la facture : une entreprise établie en France, un organisme public, un particulier ou un autre non-assujetti, un client établi hors de France.', null),
      ('38b', 'controle', 'une ligne plus loin : la cinquième', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai ordre un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai ordre deux","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai ordre trois","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai ordre quatre","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai ordre cinq","type_client":"non_assujetti","adresse":"Adresse fictive","siren":"987654321"}]'::jsonb)::text$q$,
        '22023', 'Ligne 5 : Le SIREN du contact ne passe pas sa clé de contrôle.', null),
      ('39', 'valeur', 'AUCUNE ligne rangée par les quatre imports refusés (30 à 33) : le même compte, aucun de leurs noms', 'proprietaire', null,
        $q$select (count(*) = {AVANT})::text || '/' || count(*) filter (where nom like 'Essai trente%' or nom like 'Établissement Essai%'
               or nom like '%Essai Soins%' or nom like 'Essai forme%') from contacts where dossier_id in ('{DA}', '{DC}')$q$,
        'OK', 'true/0', null),

      -- ══ Les mutations ══════════
      ('M1', 'mutation', 'le contrôle 3 rejoué avec « Ventes » : il importe', 'client', 'ventes',
        $q$select array_length(public.importer_contacts('{DA}', '[{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}]'::jsonb), 1)::text$q$,
        'OK', '1', null),
      ('M2', 'mutation', 'le contrôle 30 rejoué sans le SIRET pris : il importe les trois lignes', 'chef', null,
        $q$select array_length(public.importer_contacts('{DA}', '[{"nom":"Essai trente un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai trente deux","type_client":"etranger","adresse":"Adresse fictive"},{"nom":"Essai trente trois","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782"}]'::jsonb), 1)::text$q$,
        'OK', '3', null),
      ('M3', 'mutation', 'le contrôle 31 rejoué sans le SIRET répété à la troisième ligne : il importe', 'chef', null,
        $q$select array_length(public.importer_contacts('{DA}', '[{"nom":"Établissement Essai Import","type_client":"assujetti","adresse":"Adresse fictive","siren":"987654324","siret":"98765432400027"},{"nom":"Essai trente et un deux","type_client":"etranger","adresse":"Adresse fictive"},{"nom":"Essai trente et un trois","type_client":"assujetti","adresse":"Adresse fictive","siren":"987654324"}]'::jsonb), 1)::text$q$,
        'OK', '3', null),
      ('M4', 'mutation', 'le contrôle 32 rejoué hors du dossier de soins : il importe le particulier', 'chef', null,
        $q$select array_length(public.importer_contacts('{DB}', '[{"nom":"Entreprise Essai Soins","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200010"},{"nom":"Association Essai Soins","type_client":"non_assujetti","adresse":"Adresse fictive","siren":"111111118"},{"nom":"Particulier Essai Soins","type_client":"non_assujetti","adresse":"Adresse fictive"}]'::jsonb), 1)::text$q$,
        'OK', '3', null),
      ('M5', 'mutation', 'le contrôle 21 rejoué avec une ligne : il importe', 'chef', null,
        $q$select array_length(public.importer_contacts('{DA}', '[{"nom":"Essai","type_client":"etranger","adresse":"Adresse fictive"}]'::jsonb), 1)::text$q$,
        'OK', '1', null),
      ('M6', 'mutation', 'le contrôle 35 rejoué sans le champ inconnu : il importe', 'chef', null,
        $q$select array_length(public.importer_contacts('{DA}', '[{"nom":"Essai forme un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai forme deux","type_client":"etranger","adresse":"Adresse fictive"},{"nom":"Essai forme trois","type_client":"non_assujetti","adresse":"Adresse fictive"}]'::jsonb), 1)::text$q$,
        'OK', '3', null),
      ('M7', 'mutation', 'le contrôle 2 rejoué par le chef : il importe', 'chef', null,
        $q$select array_length(public.importer_contacts('{DA}', '[{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}]'::jsonb), 1)::text$q$,
        'OK', '1', null),
      ('M8', 'mutation', 'le contrôle 5 rejoué sur le dossier de son accès : il importe', 'client', 'ventes',
        $q$select array_length(public.importer_contacts('{DA}', '[{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}]'::jsonb), 1)::text$q$,
        'OK', '1', null),
      ('M9', 'mutation', 'le contrôle 34 rejoué avec un objet à la troisième ligne : il importe', 'chef', null,
        $q$select array_length(public.importer_contacts('{DA}', '[{"nom":"Essai forme un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai forme deux","type_client":"etranger","adresse":"Adresse fictive"},{"nom":"Essai forme trois","type_client":"non_assujetti","adresse":"Adresse fictive"}]'::jsonb), 1)::text$q$,
        'OK', '3', null),
      ('M10', 'mutation', 'le contrôle 6 rejoué avec le membre affecté : il importe', 'membre_affecte', null,
        $q$select array_length(public.importer_contacts('{DB}', '[{"nom":"Essai","type_client":"assujetti","adresse":"Adresse fictive"}]'::jsonb), 1)::text$q$,
        'OK', '1', null),
      ('M11', 'mutation', 'le contrôle 37 rejoué avec l''e-mail de la ligne 2 juste : la ligne 3 refusée, à son tour', 'chef', null,
        $q$select public.importer_contacts('{DA}', '[{"nom":"Essai ordre un","type_client":"non_assujetti","adresse":"Adresse fictive"},{"nom":"Essai ordre deux","type_client":"non_assujetti","adresse":"Adresse fictive","email":"ordre@exemple.invalid"},{"nom":"Essai ordre trois","type_client":"assujetti","adresse":"Adresse fictive","siren":"123456782","siret":"12345678200028"}]'::jsonb)::text$q$,
        '23505', 'Ligne 3 : Le SIRET « 12345678200028 » est déjà celui du contact « Contact Essai déjà rangé » : un établissement ne se range qu''une fois par dossier.', null),
      ('M12', 'mutation', 'le contrôle 22 rejoué avec mille lignes : il importe', 'chef', null,
        $q$select array_length(public.importer_contacts('{DA}', (select jsonb_agg('{"nom":"Essai borne","type_client":"etranger","adresse":"Adresse fictive"}'::jsonb) from generate_series(1, 1000))), 1)::text$q$,
        'OK', '1000', null)
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
          'observe', case when accepte then 'accepté : ' || coalesce(left(rendu, 300), '—') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
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
    ((select count(*) from dossier_assignations)), ((select count(*) from contacts))
  ) as t(n);
  -- L'écart seul, non plus les comptes de toute la base, qui diraient le volume d'un dossier réel (audit du 29/10/2026).
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)), 'ok', erreur is null and avant = apres);
  perform set_config('essai.import_contacts', verdicts::text, true);
end
$essai$;

-- Les verdicts, et une ligne d'INFORMATION : le texte que la base a reçu, sa longueur et son empreinte — sans le
-- commentaire que l'outil d'exécution ajoute à la fin —, à confronter à la copie transmise (sous psql, qui envoie les
-- instructions une à une, elle ne voit que cette requête-ci).
select x.genre, x.controle, x.verdict, x.observe from (
  select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                   else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
  from jsonb_to_recordset(current_setting('essai.import_contacts')::jsonb) as v(controle text, genre text, ok boolean, observe text)
  union all
  select 'information', '0. le texte reçu par la base', 'information', length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by x.genre desc, (regexp_match(x.controle, '^M?(\d+)'))[1]::int, x.controle;
