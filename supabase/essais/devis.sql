-- LES DEVIS, ÉPROUVÉS EN BASE (espace client, étape P5) — à rejouer par `execute_sql` après toute migration qui touche les
-- migrations `devis_du_client` et `devis_du_client_suppression`, `enregistrer_devis`, `decider_devis`, `facturer_devis`,
-- `supprimer_brouillon_devis`, les gardes des devis, `enregistrer_facture`, `supprimer_brouillon_facture`, `memberships`,
-- `client_du_dossier` ou `admin_du_dossier`.
--
-- Ce qui se prouve ici, par impersonation — anonyme, compte rattaché à rien, le client de l'essai sans droit, avec
-- « Banque » seul, avec « Ventes », sur SON dossier ou sur un autre, un membre du cabinet affecté ou non au dossier, le
-- chef du cabinet, et le propriétaire de la base :
--   - LE CATALOGUE : les trois tables sous RLS, leurs policies (lecture du cabinet, lecture du droit « Ventes »,
--     insertion de restauration), aucune policy sur la série ; les quatre fonctions SECURITY DEFINER, fermées à
--     l'anonyme et à PUBLIC, et qui vérifient l'accès AVANT toute autre chose ; la porte de la restauration et les gardes
--     fermées à tous ; l'unicité TOTALE du numéro ;
--   - QUI ÉCRIT : le cabinet et le client qui porte « Ventes », par les mêmes fonctions ; sans le droit, avec « Banque »
--     seul, sur un autre dossier, ou membre du cabinet non affecté au dossier, la RAISON d'accès (« Accès refusé à ce
--     dossier. », 42501) — qui passe avant « introuvable » ;
--   - LES REFUS D'`enregistrer_devis`, chacun sous ses mots, et leur ORDRE (un devis émis avant le nom ; ligne par ligne,
--     la désignation avant le taux, la première ligne avant la seconde ; les refus de la fonction avant les contraintes
--     des mentions) ; les totaux confrontés au centime, comme `calculerLigne` arrondit ;
--   - L'ÉMISSION : une seule série par dossier et par année de la date du devis, cabinet puis client, sans trou ni
--     doublon, reprise du plus haut numéro émis quand le repère retarde ; un devis émis ne se modifie plus, même par le
--     propriétaire de la base ; il ne s'émet ni ne naît émis autrement — sauf par la porte de la restauration ;
--   - LA RÉPONSE : une fois, datée, jamais avant le devis ni dans l'avenir ; une acceptation après la validité se
--     confirme ; ses refus, sous leurs mots ;
--   - LA FACTURE TIRÉE D'UN DEVIS ACCEPTÉ : un brouillon qui reprend le client, ses mentions, les lignes et les totaux,
--     jamais la date d'exécution prévue ni les mentions légales du devis ; une fois ; le lien part avec le brouillon
--     supprimé, et le devis se transforme de nouveau ; la garde du lien ;
--   - LA SUPPRESSION D'UN BROUILLON, ses trois refus dans l'ordre ;
--   - CE QUE LE CLIENT LIT : avec « Ventes », les devis et les liens de son dossier, toute la série jamais ; sans, rien ;
--     jamais ceux d'un autre dossier ; aucune écriture directe ;
--   - et que RIEN ne reste en base.
--
-- Tout se joue dans deux dossiers JETABLES du cabinet du chef (A, où le client de l'essai a un accès d'essai, et B, où il
-- n'en a pas), au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) : chaque contrôle dans sa
-- sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE avant ; les étapes
-- « fait » sont gardées jusqu'à l'annulation finale, et une étape peut rendre un identifiant que les suivantes citent
-- (`{CLE}`). Un refus se juge à son code ET à son message (`like` : « __/__/____ » pour la date du jour à Paris, « \% »
-- pour un signe pour cent). Les droits de l'accès d'essai se posent avant chaque étape qui les nomme ; le membre du
-- cabinet est le compte du client, rangé au cabinet le temps de son contrôle. Les verdicts voyagent dans un réglage LOCAL
-- à la transaction (`essai.devis`) : le fichier se joue d'un seul appel, ne crée aucune table et ne porte AUCUNE
-- instruction de retrait de ligne — ce qu'une telle instruction rencontre sur un devis émis ou sur le lien d'un devis
-- (la garde le refuse), et deux sessions qui émettent ou transforment en même temps se jouent sur une réplique : essais
-- locaux, hors du dépôt (HISTORIQUE.md, « LES DEVIS, EN BASE »). Hors de l'outil d'exécution, il se joue en UNE
-- transaction (`psql -1`). Avant les migrations de l'étape P2 et de celle-ci, il se dit impossible.
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil, un droit ou une cible délibérément faux : chacune
-- doit MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait.
--
-- src/lib/devis.test.ts lit les messages attendus ici : chaque refus que src/lib/devis.ts redit avant le clic doit y être
-- exigé de la base, sous les mêmes mots.
--
-- 10/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (les migrations attendent l'accord du cabinet) : la production à 112
-- migrations (`signature.sql`, neuf familles égales), plus les deux de l'étape P2 et les deux de celle-ci — 167 verdicts,
-- 0 en faute, 10 mutations sur 10 qui mordent, rien resté, sur la base nue comme sur la base semée du jeu de P2 ; sans B,
-- sans A ou sans P2, l'essai se dit impossible et nomme ce qui manque. Quarante-deux mutations des deux migrations y
-- virent toutes au rouge (HISTORIQUE.md, « LES DEVIS, EN BASE »). Rejoué le même jour sur une réplique en UTF8 égale à
-- la production à 113 migrations (`revision_des_cycles` comprise), nue et semée : 167 verdicts, 0 en faute, 10 sur 10.
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
  -- Les migrations d'abord : avant elles, cet essai n'a rien à juger. Leurs témoins : la colonne
  -- `factures_emises.valide_par` et `supprimer_brouillon_facture` (étape P2), la table `devis` et
  -- `supprimer_brouillon_devis` (étape P5).
  if not exists (select 1 from pg_attribute where attrelid = 'public.factures_emises'::regclass and attname = 'valide_par'
                  and not attisdropped)
     or to_regprocedure('public.supprimer_brouillon_facture(uuid, uuid)') is null then
    raise exception 'ESSAI_IMPOSSIBLE : les migrations de l''étape P2 (ventes_du_client, ventes_du_client_facturation) ne sont pas en base';
  end if;
  if to_regclass('public.devis') is null then
    raise exception 'ESSAI_IMPOSSIBLE : la migration devis_du_client n''est pas en base';
  end if;
  if to_regprocedure('public.supprimer_brouillon_devis(uuid, uuid)') is null then
    raise exception 'ESSAI_IMPOSSIBLE : la migration devis_du_client_suppression n''est pas en base';
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
    'DA', 'e55d0000-0000-4000-8000-0000000000a1', 'DB', 'e55d0000-0000-4000-8000-0000000000b1',
    'ACCES', 'e55d0000-0000-4000-8000-0000000000c1', 'INCONNUE', gen_random_uuid());

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from cabinet_admins)),
    ((select count(*) from dossier_assignations)), ((select count(*) from devis)), ((select count(*) from devis_numerotation)),
    ((select count(*) from devis_factures)), ((select count(*) from factures_emises)), ((select count(*) from facture_lignes)),
    ((select count(*) from facture_numerotation))
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
      ('j1', 'jeu', 'dossiers jetables A et B', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva) values
          ('{DA}', 'ESSAI DEVIS A', '{CAB}', 'redevable', true), ('{DB}', 'ESSAI DEVIS B', '{CAB}', 'redevable', true)$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-devis@exemple.invalid')$q$, 'OK', null, null),

      -- ══ 0. Le catalogue ══════════
      ('0a', 'valeur', 'les trois tables sous RLS, leurs policies : lecture du cabinet, lecture du droit « Ventes », insertion de restauration ; aucune sur la série', 'proprietaire', null,
        $q$select string_agg(c.relname || ':' || c.relrowsecurity || ':' || coalesce((select string_agg(p.polname || '/' || p.polcmd::text || '/' || p.polpermissive || '/'
                 || array_to_string(p.polroles::regrole[]::text[], ','), ',' order by p.polname) from pg_policy p where p.polrelid = c.oid), 'aucune'), ' | ' order by c.relname)
             from pg_class c where c.oid in ('public.devis'::regclass, 'public.devis_factures'::regclass, 'public.devis_numerotation'::regclass)$q$,
        'OK', 'devis:true:devis_lecture/r/true/authenticated,devis_lecture_ventes/r/true/authenticated,devis_restauration/a/true/authenticated | devis_factures:true:devis_factures_lecture/r/true/authenticated,devis_factures_lecture_ventes/r/true/authenticated,devis_factures_restauration/a/true/authenticated | devis_numerotation:true:aucune', null),
      ('0b', 'valeur', 'les quatre fonctions : security definer, search_path fixé ; ni anon ni PUBLIC ne les exécutent', 'proprietaire', null,
        $q$select string_agg(p.proname || ' ' || p.prosecdef || ' ' || array_to_string(p.proconfig, ',') || ' anon ' || has_function_privilege('anon', p.oid, 'execute')
               || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
               || ' public ' || exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'), ' | ' order by p.proname)
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('enregistrer_devis', 'decider_devis', 'facturer_devis', 'supprimer_brouillon_devis')$q$,
        'OK', 'decider_devis true search_path=public anon false authenticated true public false | enregistrer_devis true search_path=public anon false authenticated true public false | facturer_devis true search_path=public anon false authenticated true public false | supprimer_brouillon_devis true search_path=public anon false authenticated true public false', null),
      ('0c', 'valeur', 'la porte de la restauration et les deux gardes : à personne', 'proprietaire', null,
        $q$select string_agg(p.proname || ' ' || p.prosecdef || ' anon ' || has_function_privilege('anon', p.oid, 'execute')
               || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute'), ' | ' order by p.proname)
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('restauration_des_devis', 'garder_devis', 'garder_devis_facture')$q$,
        'OK', 'garder_devis true anon false authenticated false | garder_devis_facture false anon false authenticated false | restauration_des_devis true anon false authenticated false', null),
      ('0d', 'valeur', 'chacune des quatre vérifie l''accès au dossier annoncé AVANT toute autre chose', 'proprietaire', null,
        $q$select string_agg(p.proname || '=' || (regexp_replace(split_part(split_part(replace(p.prosrc, E'\r\n', E'\n'), E'\nbegin\n', 2), ';', 1), '\s+', ' ', 'g')
               = ' if not public.gere_les_ventes(p_dossier_id) then raise exception ''Accès refusé à ce dossier.'' using errcode = ''42501''')::text, ',' order by p.proname)
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('enregistrer_devis', 'decider_devis', 'facturer_devis', 'supprimer_brouillon_devis')$q$,
        'OK', 'decider_devis=true,enregistrer_devis=true,facturer_devis=true,supprimer_brouillon_devis=true', null),
      ('0e', 'valeur', 'le numéro est unique par dossier, d''une contrainte TOTALE ; une facture vient d''un devis au plus', 'proprietaire', null,
        $q$select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname) from pg_constraint
            where conname in ('devis_numero_unique', 'devis_factures_une_facture_un_devis')$q$,
        'OK', 'devis_factures_une_facture_un_devis UNIQUE (facture_id) | devis_numero_unique UNIQUE (dossier_id, numero)', null),

      -- ══ 1 à 9. Qui enregistre un devis ══════════
      ('1', 'controle', 'l''anonyme n''exécute pas enregistrer_devis', 'anon', null,
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '42501', 'permission denied for function enregistrer_devis', null),
      ('2', 'controle', 'un compte rattaché à rien est refusé', 'inconnu', null,
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('3', 'controle', 'le client sans droit est refusé, sur son dossier', 'client', 'aucun',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('4', 'controle', 'le client qui n''a que « Banque » est refusé', 'client', 'banque',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('5', 'controle', 'le client portant « Ventes » sur A est refusé sur B, où il n''a pas d''accès', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DB}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('6', 'controle', 'un membre du cabinet NON affecté au dossier B est refusé', 'membre', null,
        $q$select devis_id::text from enregistrer_devis('{DB}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('M1', 'mutation', 'le contrôle 6 rejoué avec le membre AFFECTÉ au dossier B : il passe', 'membre_affecte', null,
        $q$select (numero is null)::text from enregistrer_devis('{DB}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', 'true', null),
      ('M2', 'mutation', 'le contrôle 3 rejoué avec le droit « Ventes » : il passe', 'client', 'ventes',
        $q$select (numero is null)::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', 'true', null),
      ('7', 'fait', 'le client portant « Ventes » crée le brouillon DV1', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS 1","date_emission":"2026-09-20","date_validite":"2026-10-20","montant_ht":100,"montant_tva":20,"montant_ttc":120,"emetteur_nom":"ESSAI DEVIS A"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', null, 'DV1'),
      ('8', 'fait', 'le chef crée le brouillon DV2, au client assujetti, aux prestations prévues le 30/09/2026', 'chef', null,
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS 2","date_emission":"2026-09-15","date_validite":"2026-09-16","montant_ht":100,"montant_tva":20,"montant_ttc":120,"emetteur_nom":"ESSAI DEVIS A","type_client":"assujetti","tiers_siren":"123456789","nature_operation":"services","date_prestation":"2026-09-30","objet":"essai","conditions":"essai","mentions_legales":"Mentions du devis (essai)","notes":"essai"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', null, 'DV2'),
      ('8b', 'fait', 'le chef crée le brouillon DV3', 'chef', null,
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS 3","date_emission":"2026-09-21","date_validite":"2026-12-31","montant_ht":100,"montant_tva":20,"montant_ttc":120,"emetteur_nom":"ESSAI DEVIS A"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', null, 'DV3'),
      ('8c', 'fait', 'le client portant « Ventes » crée le brouillon DV4', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS 4","date_emission":"2026-09-22","date_validite":"2026-10-22","montant_ht":100,"montant_tva":20,"montant_ttc":120,"emetteur_nom":"ESSAI DEVIS A"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', null, 'DV4'),
      ('8d', 'fait', 'le chef crée le brouillon DVB dans le dossier B', 'chef', null,
        $q$select devis_id::text from enregistrer_devis('{DB}', null, '{"tiers_nom":"ESSAI DEVIS B","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120,"emetteur_nom":"ESSAI DEVIS B"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', null, 'DVB'),
      ('9', 'valeur', 'qui a créé : le client, le chef ; des brouillons, sans numéro ni émission ; les montants de l''en-tête, au centime', 'proprietaire', null,
        $q$select string_agg(tiers_nom || '=' || case cree_par when '{CHEF}' then 'chef' when '{CLIENT}' then 'client' else coalesce(cree_par::text, 'nul') end
               || '/' || statut || '/' || coalesce(numero, 'sans numéro') || '/' || num_nonnulls(emis_par, emis_le, reponse) || '/' || montant_ttc, ',' order by tiers_nom)
             from devis where id in ('{DV1}', '{DV2}')$q$,
        'OK', 'ESSAI DEVIS 1=client/brouillon/sans numéro/0/120.00,ESSAI DEVIS 2=chef/brouillon/sans numéro/0/120.00', null),
      ('9b', 'controle', 'le client portant « Ventes » modifie son brouillon : le même devis, ses lignes remplacées et réécrites telles que lues', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', '{DV1}', '{"tiers_nom":"ESSAI DEVIS 1","date_emission":"2026-09-20","date_validite":"2026-10-20","montant_ht":150.5,"montant_tva":30.1,"montant_ttc":180.6,"emetteur_nom":"ESSAI DEVIS A"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20,"en_trop":1},{"designation":"option","quantite":2,"prix_unitaire_ht":25.25,"taux_tva":20}]'::jsonb, false)
           §§ select (id = '{DV1}')::text || '/' || montant_ttc || '/' || jsonb_array_length(lignes) || '/' || (lignes -> 0 ? 'en_trop')::text from devis where id = '{RENDU}'$q$,
        'OK', 'true/180.60/2/false', null),

      -- ══ 10 à 29. Les refus d'enregistrer_devis, sous leurs mots et dans leur ordre ══════════
      ('10', 'controle', 'un devis qui n''existe pas : introuvable', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', '{INCONNUE}', '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        'P0002', 'Devis introuvable dans ce dossier.', null),
      ('11', 'controle', 'le devis d''un autre dossier, annoncé dans le sien : introuvable', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', '{DVB}', '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        'P0002', 'Devis introuvable dans ce dossier.', null),
      ('12', 'controle', 'sans droit, un devis qui n''existe pas : le refus d''accès, pas « introuvable »', 'client', 'aucun',
        $q$select devis_id::text from enregistrer_devis('{DA}', '{INCONNUE}', '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('13', 'controle', 'un nom de client blanc', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"   ","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Le nom du client est à renseigner.', null),
      ('13b', 'controle', 'pas de nom de client du tout', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Le nom du client est à renseigner.', null),
      ('14', 'controle', 'pas de date', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'La date du devis est à renseigner.', null),
      ('14b', 'controle', 'un 30 février n''est pas une date', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-02-30","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'La date du devis est à renseigner.', null),
      ('14c', 'controle', '« today » non plus, que Postgres lirait', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"today","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'La date du devis est à renseigner.', null),
      ('15', 'controle', 'une date avant l''an 2000', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"1999-12-31","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Un devis ne se date pas avant l''an 2000.', null),
      ('16', 'controle', 'pas de date de validité', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'La date de validité du devis est à renseigner.', null),
      ('17', 'controle', 'une validité avant la date du devis', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-09-14","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Un devis n''expire pas avant sa date : valable jusqu''au 14/09/2026, il est daté du 15/09/2026.', null),
      ('17b', 'controle', 'valable le jour même : accepté', 'client', 'ventes',
        $q$select (numero is null)::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-09-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', 'true', null),
      ('18', 'controle', 'aucune ligne', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":0,"montant_tva":0,"montant_ttc":0}'::jsonb, '[]'::jsonb, false)$q$,
        '22023', 'Un devis porte au moins une ligne, et au plus 500.', null),
      ('18b', 'controle', 'des lignes qui ne sont pas une liste', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}'::jsonb, false)$q$,
        '22023', 'Un devis porte au moins une ligne, et au plus 500.', null),
      ('18c', 'controle', '501 lignes', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":501,"montant_tva":100.2,"montant_ttc":601.2}'::jsonb,
             (select jsonb_agg(jsonb_build_object('designation', 'essai', 'quantite', 1, 'prix_unitaire_ht', 1, 'taux_tva', 20)) from generate_series(1, 501)), false)$q$,
        '22023', 'Un devis porte au moins une ligne, et au plus 500.', null),
      ('18d', 'controle', '500 lignes : accepté', 'client', 'ventes',
        $q$select (numero is null)::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":500,"montant_tva":100,"montant_ttc":600}'::jsonb,
             (select jsonb_agg(jsonb_build_object('designation', 'essai', 'quantite', 1, 'prix_unitaire_ht', 1, 'taux_tva', 20)) from generate_series(1, 500)), false)$q$,
        'OK', 'true', null),
      ('19', 'controle', 'une quantité écrite en texte : la ligne n''est pas une ligne de devis', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":"1","prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'La ligne 1 n''est pas une ligne de devis : une désignation, une quantité, un prix unitaire hors taxes et un taux de TVA.', null),
      ('19b', 'controle', 'une seconde ligne qui n''est qu''un nombre', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}, 7]'::jsonb, false)$q$,
        '22023', 'La ligne 2 n''est pas une ligne de devis : une désignation, une quantité, un prix unitaire hors taxes et un taux de TVA.', null),
      ('20', 'controle', 'une seconde ligne sans désignation', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":110,"montant_tva":22,"montant_ttc":132}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20},{"designation":"  ","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Ligne 2 : sa désignation manque.', null),
      ('21', 'controle', 'une quantité nulle', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":0,"montant_tva":0,"montant_ttc":0}'::jsonb, '[{"designation":"essai","quantite":0,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : la quantité est positive, avec quatre décimales au plus.', null),
      ('21b', 'controle', 'une quantité négative (une remise se saisit à prix négatif)', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":-100,"montant_tva":-20,"montant_ttc":-120}'::jsonb, '[{"designation":"essai","quantite":-1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : la quantité est positive, avec quatre décimales au plus.', null),
      ('21c', 'controle', 'une quantité à cinq décimales', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":123.46,"montant_tva":24.69,"montant_ttc":148.15}'::jsonb, '[{"designation":"essai","quantite":1.23456,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : la quantité est positive, avec quatre décimales au plus.', null),
      ('22', 'controle', 'un prix à sept décimales', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":1.12,"montant_tva":0.22,"montant_ttc":1.34}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":1.1234567,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : le prix unitaire hors taxes s''écrit avec six décimales au plus.', null),
      ('23', 'controle', 'une ligne de dix milliards d''euros', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":0,"montant_tva":0,"montant_ttc":0}'::jsonb, '[{"designation":"essai","quantite":100000,"prix_unitaire_ht":100000,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : son montant hors taxes atteint dix milliards d''euros.', null),
      ('23b', 'controle', 'une remise de dix milliards d''euros', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":0,"montant_tva":0,"montant_ttc":0}'::jsonb, '[{"designation":"remise","quantite":100000,"prix_unitaire_ht":-100000,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : son montant hors taxes atteint dix milliards d''euros.', null),
      ('24', 'controle', 'un taux que la DGFiP n''admet pas', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":7.5,"montant_ttc":107.5}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":7.5}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : le taux de 7,5 \% n''est pas un taux de TVA admis.', null),
      ('24b', 'controle', 'ni 21 %', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":21,"montant_ttc":121}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":21}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : le taux de 21 \% n''est pas un taux de TVA admis.', null),
      ('24c', 'controle', '2,10 % s''écrit 2,1 % : un taux admis', 'client', 'ventes',
        $q$select (numero is null)::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":2.1,"montant_ttc":102.1}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":2.10}]'::jsonb, false)$q$,
        'OK', 'true', null),
      ('25', 'controle', 'ORDRE dans une ligne : la désignation avant le taux', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":7.5,"montant_ttc":107.5}'::jsonb, '[{"designation":" ","quantite":1,"prix_unitaire_ht":100,"taux_tva":7.5}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : sa désignation manque.', null),
      ('25b', 'controle', 'ORDRE entre les lignes : la première d''abord', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":110,"montant_tva":9.5,"montant_ttc":119.5}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":7.5},{"designation":"","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : le taux de 7,5 \% n''est pas un taux de TVA admis.', null),
      ('25c', 'controle', 'ORDRE : la validité avant les lignes', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-09-01","montant_ht":0,"montant_tva":0,"montant_ttc":0}'::jsonb, '[]'::jsonb, false)$q$,
        '22023', 'Un devis n''expire pas avant sa date : valable jusqu''au 01/09/2026, il est daté du 15/09/2026.', null),
      ('26', 'controle', 'un en-tête qui contredit ses lignes', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":99,"montant_tva":20,"montant_ttc":119}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Les montants du devis ne sont pas ceux de ses lignes : 100,00 € HT, 20,00 € de TVA, 120,00 € TTC.', null),
      ('26b', 'controle', 'un TTC écrit en texte', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":"120"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Les montants du devis ne sont pas ceux de ses lignes : 100,00 € HT, 20,00 € de TVA, 120,00 € TTC.', null),
      ('26c', 'controle', 'le demi-centime s''arrondit loin de zéro, ligne par ligne, comme calculerLigne : 0,12 € refusé', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":0.12,"montant_tva":0.02,"montant_ttc":0.14}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":0.125,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Les montants du devis ne sont pas ceux de ses lignes : 0,13 € HT, 0,03 € de TVA, 0,16 € TTC.', null),
      ('26d', 'controle', 'et 0,13 € accepté, au centime', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":0.13,"montant_tva":0.03,"montant_ttc":0.16}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":0.125,"taux_tva":20}]'::jsonb, false)
           §§ select montant_ht || '/' || montant_tva || '/' || montant_ttc from devis where id = '{RENDU}'$q$,
        'OK', '0.13/0.03/0.16', null),
      ('27', 'controle', 'émettre un devis daté de l''avenir', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2099-01-01","date_validite":"2099-02-01","montant_ht":100,"montant_tva":20,"montant_ttc":120,"emetteur_nom":"ESSAI DEVIS A"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        '22023', 'Un devis ne s''émet pas daté de l''avenir : nous sommes le __/__/____.', null),
      ('27b', 'controle', 'le même, en brouillon : accepté', 'client', 'ventes',
        $q$select (numero is null)::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2099-01-01","date_validite":"2099-02-01","montant_ht":100,"montant_tva":20,"montant_ttc":120,"emetteur_nom":"ESSAI DEVIS A"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', 'true', null),
      ('28', 'controle', 'émettre un devis de total nul (une remise égale à la prestation)', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":0,"montant_tva":0,"montant_ttc":0,"emetteur_nom":"ESSAI DEVIS A"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20},{"designation":"remise","quantite":1,"prix_unitaire_ht":-100,"taux_tva":20}]'::jsonb, true)$q$,
        '22023', 'Un devis émis porte un montant : son total TTC est positif.', null),
      ('28b', 'controle', 'le même, en brouillon : accepté', 'client', 'ventes',
        $q$select (numero is null)::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":0,"montant_tva":0,"montant_ttc":0,"emetteur_nom":"ESSAI DEVIS A"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20},{"designation":"remise","quantite":1,"prix_unitaire_ht":-100,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', 'true', null),
      ('29', 'controle', 'émettre sans le nom de l''émetteur', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120,"emetteur_nom":" "}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        '22023', 'Le nom de l''émetteur du devis est à renseigner.', null),
      ('29b', 'controle', 'ORDRE à l''émission : la date avant le total', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2099-01-01","date_validite":"2099-02-01","montant_ht":0,"montant_tva":0,"montant_ttc":0}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20},{"designation":"remise","quantite":1,"prix_unitaire_ht":-100,"taux_tva":20}]'::jsonb, true)$q$,
        '22023', 'Un devis ne s''émet pas daté de l''avenir : nous sommes le __/__/____.', null),
      ('29c', 'controle', 'un SIREN du client mal formé : la contrainte des mentions', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120,"tiers_siren":"12345"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '23514', '%devis_tiers_siren_check%', null),
      ('29d', 'controle', 'une adresse de livraison sur des prestations de services', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120,"nature_operation":"services","livraison_adresse":"1 rue de l''Essai","livraison_code_postal":"75001","livraison_ville":"Paris","livraison_pays":"FR"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '23514', '%devis_livraison_de_biens%', null),
      ('29e', 'controle', 'ORDRE : les refus de la fonction avant les contraintes des mentions', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2099-01-01","date_validite":"2099-02-01","montant_ht":100,"montant_tva":20,"montant_ttc":120,"emetteur_nom":"ESSAI DEVIS A","tiers_siren":"12345"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        '22023', 'Un devis ne s''émet pas daté de l''avenir : nous sommes le __/__/____.', null),
      -- ORDRE, paire par paire : deux fautes dans la même écriture, le premier refus de la fonction exigé — l'ordre que
      -- src/lib/devis.ts redit avant le clic, et que devis.test.ts rejoue.
      ('29f', 'controle', 'ORDRE : ni nom ni date, le nom', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Le nom du client est à renseigner.', null),
      ('29g', 'controle', 'ORDRE : ni date ni validité, la date', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'La date du devis est à renseigner.', null),
      ('29h', 'controle', 'ORDRE : daté de 1999 et sans validité, l''an 2000', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"1999-12-31","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Un devis ne se date pas avant l''an 2000.', null),
      ('29i', 'controle', 'ORDRE : ni validité ni ligne, la validité', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","montant_ht":0,"montant_tva":0,"montant_ttc":0}'::jsonb, '[]'::jsonb, false)$q$,
        '22023', 'La date de validité du devis est à renseigner.', null),
      ('29j', 'controle', 'ORDRE : aucune ligne et des montants, le nombre de lignes', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[]'::jsonb, false)$q$,
        '22023', 'Un devis porte au moins une ligne, et au plus 500.', null),
      ('29k', 'controle', 'ORDRE : une ligne illisible sans désignation, illisible', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":" ","quantite":"1","prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'La ligne 1 n''est pas une ligne de devis : une désignation, une quantité, un prix unitaire hors taxes et un taux de TVA.', null),
      ('29l', 'controle', 'ORDRE : sans désignation et une quantité nulle, la désignation', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":0,"montant_tva":0,"montant_ttc":0}'::jsonb, '[{"designation":" ","quantite":0,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : sa désignation manque.', null),
      ('29m', 'controle', 'ORDRE : une quantité nulle et un prix à sept décimales, la quantité', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":0,"montant_tva":0,"montant_ttc":0}'::jsonb, '[{"designation":"essai","quantite":0,"prix_unitaire_ht":1.1234567,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : la quantité est positive, avec quatre décimales au plus.', null),
      ('29n', 'controle', 'ORDRE : un prix à sept décimales sur une ligne hors borne, le prix', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":0,"montant_tva":0,"montant_ttc":0}'::jsonb, '[{"designation":"essai","quantite":100000,"prix_unitaire_ht":100000.1234567,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : le prix unitaire hors taxes s''écrit avec six décimales au plus.', null),
      ('29o', 'controle', 'ORDRE : une ligne hors borne à un taux non admis, la borne', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":0,"montant_tva":0,"montant_ttc":0}'::jsonb, '[{"designation":"essai","quantite":100000,"prix_unitaire_ht":100000,"taux_tva":7.5}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : son montant hors taxes atteint dix milliards d''euros.', null),
      ('29p', 'controle', 'ORDRE : un taux non admis et des montants faux, le taux', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":7.5}]'::jsonb, false)$q$,
        '22023', 'Ligne 1 : le taux de 7,5 \% n''est pas un taux de TVA admis.', null),
      ('29q', 'controle', 'ORDRE : des montants faux sur une émission datée de l''avenir, les montants', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2099-01-01","date_validite":"2099-02-01","montant_ht":99,"montant_tva":20,"montant_ttc":119,"emetteur_nom":"ESSAI DEVIS A"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        '22023', 'Les montants du devis ne sont pas ceux de ses lignes : 100,00 € HT, 20,00 € de TVA, 120,00 € TTC.', null),
      ('29r', 'controle', 'ORDRE : émis sans montant ni émetteur, le montant', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS X","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":0,"montant_tva":0,"montant_ttc":0,"emetteur_nom":" "}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20},{"designation":"remise","quantite":1,"prix_unitaire_ht":-100,"taux_tva":20}]'::jsonb, true)$q$,
        '22023', 'Un devis émis porte un montant : son total TTC est positif.', null),

      -- ══ 30 à 39. L'émission : une série, le cabinet puis le client ; un devis émis est figé ══════════
      ('30', 'fait', 'le chef émet DV2 : le premier numéro de la série 2026', 'chef', null,
        $q$select numero from enregistrer_devis('{DA}', '{DV2}', '{"tiers_nom":"ESSAI DEVIS 2","date_emission":"2026-09-15","date_validite":"2026-09-16","montant_ht":100,"montant_tva":20,"montant_ttc":120,"emetteur_nom":"ESSAI DEVIS A","type_client":"assujetti","tiers_siren":"123456789","nature_operation":"services","date_prestation":"2026-09-30","objet":"essai","conditions":"essai","mentions_legales":"Mentions du devis (essai)","notes":"essai"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        'OK', 'D2026-0001', null),
      ('31', 'fait', 'le client portant « Ventes » émet DV1 : le numéro suivant', 'client', 'ventes',
        $q$select numero from enregistrer_devis('{DA}', '{DV1}', '{"tiers_nom":"ESSAI DEVIS 1","date_emission":"2026-09-20","date_validite":"2026-10-20","montant_ht":100,"montant_tva":20,"montant_ttc":120,"emetteur_nom":"ESSAI DEVIS A"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        'OK', 'D2026-0002', null),
      ('32', 'valeur', 'une seule série : deux numéros qui se suivent, qui a émis, et le repère', 'proprietaire', null,
        $q$select string_agg(numero || '=' || case emis_par when '{CHEF}' then 'chef' when '{CLIENT}' then 'client' else coalesce(emis_par::text, 'nul') end
               || '/' || (emis_le is not null)::text, ',' order by numero)
             || ' | repère ' || (select n.dernier_numero from devis_numerotation n where n.dossier_id = '{DA}' and n.annee = 2026)
             from devis where dossier_id = '{DA}' and statut = 'emis'$q$,
        'OK', 'D2026-0001=chef/true,D2026-0002=client/true | repère 2', null),
      ('33', 'controle', 'un devis émis ne se modifie plus par la fonction', 'client', 'ventes',
        $q$select devis_id::text from enregistrer_devis('{DA}', '{DV2}', '{"tiers_nom":"ESSAI DEVIS 2 BIS","date_emission":"2026-09-15","date_validite":"2026-09-16","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        '22023', 'Le devis D2026-0001 est émis : il ne se modifie plus — il se duplique.', null),
      ('33b', 'controle', 'ORDRE : un devis émis avant le nom du client', 'chef', null,
        $q$select devis_id::text from enregistrer_devis('{DA}', '{DV2}', '{"tiers_nom":"","date_emission":"2026-09-15","date_validite":"2026-09-16","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[]'::jsonb, false)$q$,
        '22023', 'Le devis D2026-0001 est émis : il ne se modifie plus — il se duplique.', null),
      ('34', 'controle', 'ni par le propriétaire de la base : la garde', 'proprietaire', null,
        $q$with u as (update devis set notes = 'changé' where id = '{DV2}' returning 1) select count(*)::text from u$q$,
        '23514', 'Le devis D2026-0001 est émis : il ne se modifie plus — il se duplique.', null),
      ('35', 'controle', 'un brouillon ne s''émet pas autrement que par la fonction, même pour le propriétaire', 'proprietaire', null,
        $q$with u as (update devis set statut = 'emis', numero = 'D2026-0009', emis_par = '{CHEF}', emis_le = now() where id = '{DV3}' returning 1) select count(*)::text from u$q$,
        '42501', 'Un devis ne s''émet que par enregistrer_devis, qui lui donne son numéro.', null),
      ('36', 'controle', 'un devis ne naît pas émis, même posé par le propriétaire', 'proprietaire', null,
        $q$insert into devis (dossier_id, numero, statut, date_emission, date_validite, tiers_nom, lignes, montant_ht, montant_tva, montant_ttc, emis_par, emis_le)
           values ('{DA}', 'D2026-0009', 'emis', '2026-09-15', '2026-10-15', 'ESSAI DEVIS X', '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, 100, 20, 120, '{CHEF}', now())$q$,
        '42501', 'Un devis ne naît pas émis : il s''émet par enregistrer_devis, qui lui donne son numéro.', null),
      ('36b', 'controle', 'ni par le super-administrateur dans un dossier qui a déjà émis : la porte de la restauration est fermée', 'chef', null,
        $q$insert into devis (dossier_id, numero, statut, date_emission, date_validite, tiers_nom, lignes, montant_ht, montant_tva, montant_ttc, emis_par, emis_le)
           values ('{DA}', 'D2026-0009', 'emis', '2026-09-15', '2026-10-15', 'ESSAI DEVIS X', '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, 100, 20, 120, '{CHEF}', now())$q$,
        '42501', 'Un devis ne naît pas émis : il s''émet par enregistrer_devis, qui lui donne son numéro.', null),
      ('M3', 'mutation', 'le contrôle 36b rejoué dans le dossier B, qui n''a jamais émis : la porte de la restauration s''ouvre', 'chef', null,
        $q$insert into devis (dossier_id, numero, statut, date_emission, date_validite, tiers_nom, lignes, montant_ht, montant_tva, montant_ttc, emis_par, emis_le)
           values ('{DB}', 'D2026-0009', 'emis', '2026-09-15', '2026-10-15', 'ESSAI DEVIS X', '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, 100, 20, 120, '{CHEF}', now())$q$,
        'OK', null, null),
      ('37', 'fait', 'un devis daté de 2025 ouvre la série 2025', 'chef', null,
        $q$select numero from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI DEVIS 2025","date_emission":"2025-06-01","date_validite":"2025-07-01","montant_ht":100,"montant_tva":20,"montant_ttc":120,"emetteur_nom":"ESSAI DEVIS A"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        'OK', 'D2025-0001', null),
      ('38', 'fait', 'le repère de la série 2026 remis à zéro par le propriétaire (comme une base restaurée)', 'proprietaire', null,
        $q$with u as (update devis_numerotation set dernier_numero = 0 where dossier_id = '{DA}' and annee = 2026 returning 1) select count(*)::text from u$q$,
        'OK', '1', null),
      ('38b', 'fait', 'le chef émet DV3 : la série REPREND du plus haut numéro émis', 'chef', null,
        $q$select numero from enregistrer_devis('{DA}', '{DV3}', '{"tiers_nom":"ESSAI DEVIS 3","date_emission":"2026-09-21","date_validite":"2026-12-31","montant_ht":100,"montant_tva":20,"montant_ttc":120,"emetteur_nom":"ESSAI DEVIS A"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        'OK', 'D2026-0003', null),
      ('38c', 'valeur', 'le repère suit', 'proprietaire', null,
        $q$select string_agg(annee || '=' || dernier_numero, ',' order by annee) from devis_numerotation where dossier_id = '{DA}'$q$,
        'OK', '2025=1,2026=3', null),

      -- ══ 40 à 55. La réponse ══════════
      ('40', 'controle', 'l''anonyme n''exécute pas decider_devis', 'anon', null,
        $q$select reponse from decider_devis('{DA}', '{DV1}', 'acceptee', '2026-09-25', false)$q$,
        '42501', 'permission denied for function decider_devis', null),
      ('41', 'controle', 'le client sans droit est refusé', 'client', 'aucun',
        $q$select reponse from decider_devis('{DA}', '{DV1}', 'acceptee', '2026-09-25', false)$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('42', 'controle', 'le client portant « Ventes » est refusé sur un autre dossier', 'client', 'ventes',
        $q$select reponse from decider_devis('{DB}', '{DVB}', 'acceptee', '2026-09-25', false)$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('43', 'controle', 'un devis qui n''existe pas', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{INCONNUE}', 'acceptee', '2026-09-25', false)$q$, 'P0002', 'Devis introuvable dans ce dossier.', null),
      ('44', 'controle', 'un brouillon ne reçoit pas de réponse', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV4}', 'acceptee', '2026-09-25', false)$q$,
        '22023', 'Le devis est un brouillon : il s''émet avant de recevoir une réponse.', null),
      ('44b', 'controle', 'ORDRE : un brouillon avant une réponse inconnue', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV4}', 'peut-être', null, false)$q$,
        '22023', 'Le devis est un brouillon : il s''émet avant de recevoir une réponse.', null),
      ('45', 'controle', 'une réponse inconnue', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV1}', 'acceptée', '2026-09-25', false)$q$,
        '22023', 'La réponse au devis est « acceptée » ou « refusée ».', null),
      ('45b', 'controle', 'aucune réponse', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV1}', null, '2026-09-25', false)$q$,
        '22023', 'La réponse au devis est « acceptée » ou « refusée ».', null),
      ('45c', 'controle', 'ORDRE : une réponse inconnue, sans date : la réponse', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV1}', 'peut-être', null, false)$q$,
        '22023', 'La réponse au devis est « acceptée » ou « refusée ».', null),
      ('46', 'controle', 'pas de date', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV1}', 'refusee', null, false)$q$,
        '22023', 'La date de la réponse est à renseigner.', null),
      ('47', 'controle', 'une réponse avant le devis', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV1}', 'refusee', '2026-09-19', false)$q$,
        '22023', 'Une réponse ne précède pas le devis, daté du 20/09/2026.', null),
      ('47b', 'controle', 'une réponse datée du jour même du devis : acceptée', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV1}', 'refusee', '2026-09-20', false)$q$, 'OK', 'refusee', null),
      ('48', 'controle', 'une réponse dans l''avenir', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV1}', 'refusee', '2099-01-01', false)$q$,
        '22023', 'Une réponse ne se date pas dans l''avenir : nous sommes le __/__/____.', null),
      ('49', 'controle', 'une acceptation après la validité, non confirmée', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV2}', 'acceptee', '2026-09-20', false)$q$,
        '22023', 'Le devis D2026-0001 n''était plus valable le 20/09/2026 : il l''était jusqu''au 16/09/2026. Son acceptation se confirme.', null),
      ('49b', 'controle', 'acceptée le dernier jour de la validité : sans confirmation', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV2}', 'acceptee', '2026-09-16', false)$q$, 'OK', 'acceptee', null),
      ('49c', 'controle', 'un refus après la validité ne se confirme pas', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV2}', 'refusee', '2026-09-20', false)$q$, 'OK', 'refusee', null),
      ('49d', 'controle', 'ORDRE : une acceptation dans l''avenir, hors validité : l''avenir', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV2}', 'acceptee', '2099-01-01', false)$q$,
        '22023', 'Une réponse ne se date pas dans l''avenir : nous sommes le __/__/____.', null),
      ('M4', 'mutation', 'le contrôle 49 rejoué confirmé : il passe', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV2}', 'acceptee', '2026-09-20', true)$q$, 'OK', 'acceptee', null),
      ('50', 'fait', 'le client portant « Ventes » enregistre le refus de DV1', 'client', 'ventes',
        $q$select reponse || '/' || to_char(date_reponse, 'DD/MM/YYYY') from decider_devis('{DA}', '{DV1}', 'refusee', '2026-09-25', false)$q$,
        'OK', 'refusee/25/09/2026', null),
      ('51', 'controle', 'une réponse ne change plus', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV1}', 'acceptee', '2026-09-26', false)$q$,
        '22023', 'La réponse au devis D2026-0002 est déjà enregistrée (refusé le 25/09/2026) : elle ne change plus.', null),
      ('51b', 'controle', 'ORDRE : une réponse déjà enregistrée, puis une réponse inconnue : déjà enregistrée', 'client', 'ventes',
        $q$select reponse from decider_devis('{DA}', '{DV1}', 'peut-être', null, false)$q$,
        '22023', 'La réponse au devis D2026-0002 est déjà enregistrée (refusé le 25/09/2026) : elle ne change plus.', null),
      ('52', 'fait', 'le chef enregistre l''acceptation de DV2, datée après sa validité et confirmée', 'chef', null,
        $q$select reponse from decider_devis('{DA}', '{DV2}', 'acceptee', '2026-09-20', true)$q$, 'OK', 'acceptee', null),
      ('53', 'valeur', 'qui a répondu, quoi et quand', 'proprietaire', null,
        $q$select string_agg(numero || '=' || reponse || '/' || case decide_par when '{CHEF}' then 'chef' when '{CLIENT}' then 'client' else coalesce(decide_par::text, 'nul') end
               || '/' || to_char(date_reponse, 'DD/MM/YYYY') || '/' || (decide_le is not null)::text, ',' order by numero)
             from devis where id in ('{DV1}', '{DV2}')$q$,
        'OK', 'D2026-0001=acceptee/chef/20/09/2026/true,D2026-0002=refusee/client/25/09/2026/true', null),
      ('54', 'controle', 'le propriétaire ne change pas une réponse enregistrée : la garde', 'proprietaire', null,
        $q$with u as (update devis set reponse = 'refusee' where id = '{DV2}' returning 1) select count(*)::text from u$q$,
        '23514', 'La réponse au devis D2026-0001 est enregistrée : elle ne change plus.', null),
      ('55', 'controle', 'ni le reste du devis', 'proprietaire', null,
        $q$with u as (update devis set notes = 'changé' where id = '{DV2}' returning 1) select count(*)::text from u$q$,
        '23514', 'Le devis D2026-0001 est émis : il ne se modifie plus — il se duplique.', null),

      -- ══ 60 à 79. La facture tirée d'un devis accepté ══════════
      ('60', 'controle', 'l''anonyme n''exécute pas facturer_devis', 'anon', null,
        $q$select facturer_devis('{DA}', '{DV2}')::text$q$, '42501', 'permission denied for function facturer_devis', null),
      ('61', 'controle', 'le client sans droit est refusé', 'client', 'aucun',
        $q$select facturer_devis('{DA}', '{DV2}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('62', 'controle', 'le client portant « Ventes » est refusé sur un autre dossier', 'client', 'ventes',
        $q$select facturer_devis('{DB}', '{DVB}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('63', 'controle', 'un devis qui n''existe pas', 'client', 'ventes',
        $q$select facturer_devis('{DA}', '{INCONNUE}')::text$q$, 'P0002', 'Devis introuvable dans ce dossier.', null),
      ('64', 'controle', 'un brouillon ne se transforme pas', 'client', 'ventes',
        $q$select facturer_devis('{DA}', '{DV4}')::text$q$,
        '22023', 'Le devis est un brouillon : seul un devis accepté se transforme en facture.', null),
      ('65', 'controle', 'un devis en attente de réponse non plus', 'client', 'ventes',
        $q$select facturer_devis('{DA}', '{DV3}')::text$q$,
        '22023', 'Seul un devis accepté se transforme en facture : le devis D2026-0003 est en attente de réponse.', null),
      ('66', 'controle', 'ni un devis refusé', 'client', 'ventes',
        $q$select facturer_devis('{DA}', '{DV1}')::text$q$,
        '22023', 'Seul un devis accepté se transforme en facture : le devis D2026-0002 est refusé.', null),
      ('67', 'fait', 'le client portant « Ventes » transforme DV2 en facture', 'client', 'ventes',
        $q$select facturer_devis('{DA}', '{DV2}')::text$q$, 'OK', null, 'FV'),
      ('68', 'valeur', 'un brouillon qui reprend le client, ses mentions, les lignes et les totaux, jamais la date prévue ni les mentions légales du devis ; daté du jour à Paris ; signé du client, comme le lien', 'proprietaire', null,
        $q$select concat_ws('|', statut, tiers_nom, tiers_siren, type_client, nature_operation, coalesce(date_prestation::text, 'sans date prévue'),
               coalesce(mentions_legales, 'sans mentions légales'), coalesce(notes, 'sans notes'), montant_ht, montant_tva, montant_ttc, emetteur_nom,
               (date_emission = (now() at time zone 'Europe/Paris')::date)::text,
               case created_by when '{CLIENT}' then 'client' else coalesce(created_by::text, 'nul') end,
               (select count(*) || ' ligne ' || min(l.designation) || ' ' || min(l.quantite) || '×' || min(l.prix_unitaire_ht) || ' à ' || min(l.taux_tva) from facture_lignes l where l.facture_id = '{FV}'),
               (select case l.cree_par when '{CLIENT}' then 'lien du client' else 'lien de ' || coalesce(l.cree_par::text, 'nul') end from devis_factures l where l.facture_id = '{FV}' and l.devis_id = '{DV2}' and l.dossier_id = '{DA}'))
             from factures_emises where id = '{FV}'$q$,
        'OK', 'brouillon|ESSAI DEVIS 2|123456789|assujetti|services|sans date prévue|sans mentions légales|sans notes|100.00|20.00|120.00|ESSAI DEVIS A|true|client|1 ligne essai 1×100 à 20|lien du client', null),
      ('69', 'controle', 'un devis se transforme une fois', 'client', 'ventes',
        $q$select facturer_devis('{DA}', '{DV2}')::text$q$,
        '22023', 'Le devis D2026-0001 a déjà sa facture (un brouillon) : un devis se transforme une fois.', null),
      ('70', 'fait', 'le chef supprime le brouillon de la facture', 'chef', null,
        $q$select supprimer_brouillon_facture('{DA}', '{FV}')::text$q$, 'OK', '{FV}', null),
      ('71', 'valeur', 'le lien est parti avec lui', 'proprietaire', null,
        $q$select count(*)::text from devis_factures where devis_id = '{DV2}'$q$, 'OK', '0', null),
      ('72', 'fait', 'le devis se transforme de nouveau, par le chef', 'chef', null,
        $q$select facturer_devis('{DA}', '{DV2}')::text$q$, 'OK', null, 'FV2'),
      ('73', 'fait', 'le chef valide la facture tirée du devis', 'chef', null,
        $q$select numero from enregistrer_facture('{DA}', '{FV2}', '{"tiers_nom":"ESSAI DEVIS 2","montant_ht":100,"montant_tva":20,"montant_ttc":120,"type_client":"assujetti","tiers_siren":"123456789","nature_operation":"services"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        'OK', 'F____-0001', null),
      ('74', 'controle', 'facturé : le numéro de sa facture dans le refus', 'client', 'ventes',
        $q$select facturer_devis('{DA}', '{DV2}')::text$q$,
        '22023', 'Le devis D2026-0001 a déjà sa facture (F____-0001) : un devis se transforme une fois.', null),
      ('74b', 'fait', 'le chef crée une facture brouillon FA dans le dossier A, et FB dans le dossier B', 'chef', null,
        $q$select facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI DEVIS FA","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"fa","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', null, 'FA'),
      ('74c', 'fait', 'et FB dans le dossier B', 'chef', null,
        $q$select facture_id::text from enregistrer_facture('{DB}', null, '{"tiers_nom":"ESSAI DEVIS FB","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"fb","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', null, 'FB'),
      ('75', 'controle', 'la garde du lien : une facture ne se tire pas d''un devis refusé, même posée par le propriétaire', 'proprietaire', null,
        $q$insert into devis_factures (dossier_id, devis_id, facture_id) values ('{DA}', '{DV1}', '{FA}')$q$,
        '23514', 'Une facture se tire d''un devis accepté de son dossier.', null),
      ('76', 'controle', 'ni vers la facture d''un autre dossier', 'proprietaire', null,
        $q$insert into devis_factures (dossier_id, devis_id, facture_id) values ('{DA}', '{DV2}', '{FB}')$q$,
        '23514', 'Le lien d''un devis vise une facture de son dossier, jamais un avoir.', null),
      ('77', 'controle', 'un lien ne change pas', 'proprietaire', null,
        $q$with u as (update devis_factures set cree_par = null where facture_id = '{FV2}' returning 1) select count(*)::text from u$q$,
        '23514', 'Le lien d''un devis à sa facture ne change pas.', null),
      ('M5', 'mutation', 'le contrôle 75 rejoué sur le devis accepté : la garde laisse passer un lien juste', 'proprietaire', null,
        $q$insert into devis_factures (dossier_id, devis_id, facture_id) values ('{DA}', '{DV2}', '{FA}')$q$, 'OK', null, null),
      ('78', 'controle', 'le client portant « Ventes » n''écrit pas un lien directement : la RLS', 'client', 'ventes',
        $q$insert into devis_factures (dossier_id, devis_id, facture_id) values ('{DA}', '{DV2}', '{FA}')$q$,
        '42501', 'new row violates row-level security policy%devis_factures%', null),
      ('M6', 'mutation', 'le contrôle 78 rejoué par le super-administrateur : la policy de la restauration le laisse passer', 'chef', null,
        $q$insert into devis_factures (dossier_id, devis_id, facture_id) values ('{DA}', '{DV2}', '{FA}')$q$, 'OK', null, null),

      -- ══ 80 à 89. La suppression d'un brouillon ══════════
      ('80', 'controle', 'l''anonyme n''exécute pas supprimer_brouillon_devis', 'anon', null,
        $q$select supprimer_brouillon_devis('{DA}', '{DV4}')::text$q$, '42501', 'permission denied for function supprimer_brouillon_devis', null),
      ('81', 'controle', 'le client sans droit est refusé', 'client', 'aucun',
        $q$select supprimer_brouillon_devis('{DA}', '{DV4}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('82', 'controle', 'le client portant « Ventes » est refusé sur un autre dossier', 'client', 'ventes',
        $q$select supprimer_brouillon_devis('{DB}', '{DVB}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('82b', 'controle', 'sans droit, un devis qui n''existe pas : le refus d''accès, pas « introuvable »', 'client', 'aucun',
        $q$select supprimer_brouillon_devis('{DA}', '{INCONNUE}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('83', 'controle', 'un devis qui n''existe pas', 'client', 'ventes',
        $q$select supprimer_brouillon_devis('{DA}', '{INCONNUE}')::text$q$, 'P0002', 'Devis introuvable dans ce dossier.', null),
      ('84', 'controle', 'le devis d''un autre dossier, annoncé dans le sien', 'client', 'ventes',
        $q$select supprimer_brouillon_devis('{DA}', '{DVB}')::text$q$, 'P0002', 'Devis introuvable dans ce dossier.', null),
      ('85', 'controle', 'un devis émis ne se supprime plus', 'client', 'ventes',
        $q$select supprimer_brouillon_devis('{DA}', '{DV3}')::text$q$, '22023', 'Le devis D2026-0003 est émis : il ne se supprime plus.', null),
      ('M7', 'mutation', 'le contrôle 85 rejoué sur un brouillon : il passe', 'client', 'ventes',
        $q$select supprimer_brouillon_devis('{DA}', '{DV4}')::text$q$, 'OK', '{DV4}', null),
      ('86', 'fait', 'le client portant « Ventes » supprime son brouillon DV4', 'client', 'ventes',
        $q$select supprimer_brouillon_devis('{DA}', '{DV4}')::text$q$, 'OK', '{DV4}', null),
      ('87', 'valeur', 'il n''est plus', 'proprietaire', null,
        $q$select count(*)::text from devis where id = '{DV4}'$q$, 'OK', '0', null),
      ('88', 'controle', 'le chef supprime un brouillon du dossier B', 'chef', null,
        $q$select supprimer_brouillon_devis('{DB}', '{DVB}')::text$q$, 'OK', '{DVB}', null),

      -- ══ 90 à 99. Ce que le client lit ══════════
      ('90', 'valeur', 'les devis du dossier A, lus par le propriétaire', 'proprietaire', null,
        $q$select count(*)::text from devis where dossier_id = '{DA}'$q$, 'OK', null, 'NDA'),
      ('90b', 'valeur', 'et les liens du dossier A', 'proprietaire', null,
        $q$select count(*)::text from devis_factures where dossier_id = '{DA}'$q$, 'OK', null, 'NLA'),
      ('91', 'controle', 'avec « Ventes », le client lit tous les devis du dossier A, brouillons compris', 'client', 'ventes',
        $q$select count(*)::text from devis where dossier_id = '{DA}'$q$, 'OK', '{NDA}', null),
      ('92', 'controle', 'et tous ses liens', 'client', 'ventes',
        $q$select count(*)::text from devis_factures where dossier_id = '{DA}'$q$, 'OK', '{NLA}', null),
      ('93', 'controle', 'sans droit, rien', 'client', 'aucun',
        $q$select (select count(*) from devis where dossier_id in ('{DA}', '{DB}')) || '/' || (select count(*) from devis_factures where dossier_id in ('{DA}', '{DB}'))$q$, 'OK', '0/0', null),
      ('94', 'controle', 'avec « Banque » seul, rien', 'client', 'banque',
        $q$select (select count(*) from devis where dossier_id in ('{DA}', '{DB}')) || '/' || (select count(*) from devis_factures where dossier_id in ('{DA}', '{DB}'))$q$, 'OK', '0/0', null),
      ('95', 'controle', 'avec « Ventes », rien du dossier B', 'client', 'ventes',
        $q$select (select count(*) from devis where dossier_id = '{DB}') || '/' || (select count(*) from devis_factures where dossier_id = '{DB}')$q$,
        'OK', '0/0', null),
      ('96', 'controle', 'un membre non affecté ne lit pas les devis du dossier B', 'membre', null,
        $q$select count(*)::text from devis where dossier_id = '{DB}'$q$, 'OK', '0', null),
      ('M8', 'mutation', 'le contrôle 96 rejoué avec le membre affecté : il lit', 'membre_affecte', null,
        $q$select count(*)::text from devis where dossier_id = '{DB}'$q$, 'OK', '1', null),
      ('M9', 'mutation', 'le contrôle 93 rejoué avec « Ventes » : il lit', 'client', 'ventes',
        $q$select ((select count(*) from devis where dossier_id in ('{DA}', '{DB}')) > 0)::text$q$, 'OK', 'true', null),
      ('97', 'controle', 'la série ne se lit pas : ni le client portant « Ventes »…', 'client', 'ventes',
        $q$select count(*)::text from devis_numerotation$q$, 'OK', '0', null),
      ('97b', 'controle', '… ni le chef', 'chef', null,
        $q$select count(*)::text from devis_numerotation$q$, 'OK', '0', null),
      ('98', 'controle', 'le client portant « Ventes » ne pose pas un devis directement : la RLS', 'client', 'ventes',
        $q$insert into devis (dossier_id, date_emission, date_validite, tiers_nom, lignes, montant_ht, montant_tva, montant_ttc)
           values ('{DA}', '2026-09-15', '2026-10-15', 'ESSAI DEVIS X', '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, 100, 20, 120)$q$,
        '42501', 'new row violates row-level security policy%devis%', null),
      ('98b', 'controle', 'ni ne modifie un brouillon directement : aucune ligne touchée', 'client', 'ventes',
        $q$with u as (update devis set notes = 'changé' where dossier_id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('98c', 'controle', 'le chef non plus : aucune policy de mise à jour', 'chef', null,
        $q$with u as (update devis set notes = 'changé' where dossier_id = '{DA}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('M10', 'mutation', 'le contrôle 98 rejoué par le super-administrateur : la policy de la restauration le laisse passer', 'chef', null,
        $q$insert into devis (dossier_id, date_emission, date_validite, tiers_nom, lignes, montant_ht, montant_tva, montant_ttc)
           values ('{DA}', '2026-09-15', '2026-10-15', 'ESSAI DEVIS X', '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, 100, 20, 120)$q$,
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
        -- Plusieurs ordres : chacun dans sa propre instruction, pour voir ce que le précédent a écrit — une même
        -- instruction lit la base telle qu'elle était à son début, sans ce qu'une fonction qu'elle appelle y écrit.
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
    ((select count(*) from dossier_assignations)), ((select count(*) from devis)), ((select count(*) from devis_numerotation)),
    ((select count(*) from devis_factures)), ((select count(*) from factures_emises)), ((select count(*) from facture_lignes)),
    ((select count(*) from facture_numerotation))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || avant || ' -> ' || apres, 'ok', erreur is null and avant = apres);
  perform set_config('essai.devis', verdicts::text, true);
end
$essai$;

select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                 else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
from jsonb_to_recordset(current_setting('essai.devis')::jsonb) as v(controle text, genre text, ok boolean, observe text)
order by v.genre desc, (regexp_match(v.controle, '^M?(\d+)'))[1]::int, v.controle;
