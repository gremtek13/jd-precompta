-- LES VENTES DU CLIENT, ÉPROUVÉES EN BASE (espace client, étape P2) — à rejouer par `execute_sql` après toute migration qui
-- touche les migrations `ventes_du_client` et `ventes_du_client_facturation`, `enregistrer_facture`, la numérotation,
-- `supprimer_brouillon_facture`, `abandonner_transmission`, les fonctions des encaissements, la garde des transmissions,
-- `memberships` ou `client_du_dossier`.
--
-- Ce qui se prouve ici, par impersonation — anonyme, compte rattaché à rien, le client de l'essai sans droit, avec
-- « Banque » seul, avec « Ventes », avec les deux, sur SON dossier ou sur un autre, et le chef du cabinet :
--   - QUI ENREGISTRE ET VALIDE : le client qui porte le droit « Ventes » crée, modifie et valide ses factures et ses
--     avoirs dans la série du dossier ; sans le droit, avec « Banque » seul, ou sur un autre dossier, il est refusé par la
--     RAISON d'hier (« Accès refusé à ce dossier. », 42501) ; la numérotation ne s'appelle toujours pas ;
--   - LA NUMÉROTATION, CABINET PUIS CLIENT : une seule série, sans trou ni doublon, et son compteur ;
--   - `valide_par` : le compte qui a validé, chef ou client, figé avec la facture — ni le chef ni le propriétaire de la
--     base ne le changent ensuite, un brouillon n'en porte pas, le client ne l'écrit pas ;
--   - LA SUPPRESSION D'UN BROUILLON par `supprimer_brouillon_facture` : ses trois refus dans l'ordre et sous leurs mots, le
--     brouillon parti avec ses lignes, pour le client comme pour le cabinet ;
--   - L'ABANDON d'une transmission restée sans issue : le client qui porte le droit l'abandonne, et le détail dit qui ;
--   - LES ENCAISSEMENTS : enregistrés, retirés, déclarés hors application et contre-passés par le client qui porte le droit,
--     et signés de son compte ; le REFUS NEUF — désigner un mouvement bancaire demande aussi le droit « Banque » — à son
--     rang, juste après l'accès ;
--   - `cree_par` d'une transmission : écrit à l'insertion, il ne change plus ;
--   - CE QUE LE CLIENT LIT : avec « Ventes », les ventes de son dossier ; sans, rien ; jamais celles d'un autre ;
--   - et que RIEN ne reste en base.
--
-- Tout se joue dans deux dossiers JETABLES du cabinet du chef (A, où le client de l'essai a un accès d'essai, et B, où il
-- n'en a pas), au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) : chaque contrôle dans sa
-- sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE avant ; les étapes
-- « fait » sont gardées jusqu'à l'annulation finale, et une étape peut rendre un identifiant que les suivantes citent
-- (`{CLE}`). Un refus se juge à son code ET à son message. Les droits de l'accès d'essai se posent avant chaque étape qui
-- les nomme. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.ventes_client`) : le fichier se joue d'un
-- seul appel, ne crée aucune table et ne porte AUCUNE instruction de suppression. Ce qu'une suppression DIRECTE rencontre
-- — le client qui porte les droits n'en fait aucune, le chef supprime encore un brouillon par la policy d'hier, jamais une
-- facture validée — et deux sessions qui valident ou suppriment en même temps se jouent sur une réplique : essais locaux
-- de la session, hors du dépôt (HISTORIQUE.md, « LES VENTES DU CLIENT, EN BASE »). Hors de l'outil d'exécution, il se
-- joue en UNE transaction (`psql -1`). Avant les deux migrations de l'étape, il se dit impossible.
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil, un droit ou une cible délibérément faux : chacune
-- doit MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait.
--
-- 10/10/2026, SUR UNE RÉPLIQUE, PAS EN PRODUCTION : une réplique dont `signature.sql` égale la production à 109 migrations,
-- les deux migrations de l'étape posées — 89 verdicts (50 contrôles, 20 faits, 12 valeurs, 7 mutations), tous justes,
-- rien laissé en base ; sans les migrations (cette garde retirée), 62 sur 89 en faute. Les vingt-huit mutations des deux
-- migrations, jouées une à une sur la réplique avec rls.sql et les six essais des factures et des encaissements : vingt-sept
-- vues par ces essais, la dernière — la suppression d'un brouillon sans le verrou de sa ligne — par une course de deux
-- sessions seulement. Le passage en production suivra l'application des migrations, et se notera ici.
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
  -- Les deux migrations de l'étape d'abord : avant elles, cet essai n'a rien à juger — ses contrôles du client y
  -- tomberaient tous, à raison. Leurs témoins : la colonne `factures_emises.valide_par`, que la première pose d'un seul
  -- tenant avec ses policies, et la fonction que la seconde crée.
  if not exists (select 1 from pg_attribute where attrelid = 'public.factures_emises'::regclass and attname = 'valide_par'
                  and not attisdropped) then
    raise exception 'ESSAI_IMPOSSIBLE : la migration ventes_du_client n''est pas en base';
  end if;
  if to_regprocedure('public.supprimer_brouillon_facture(uuid, uuid)') is null then
    raise exception 'ESSAI_IMPOSSIBLE : la migration ventes_du_client_facturation n''est pas en base';
  end if;
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from super_admins where user_id = client)
     or not exists (select 1 from memberships where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou comptes rattachés autrement qu''attendu';
  end if;

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet,
    'DA', 'e55a7000-0000-4000-8000-0000000000a1', 'DB', 'e55a7000-0000-4000-8000-0000000000b1',
    'ACCES', 'e55a7000-0000-4000-8000-0000000000c1',
    'MA', 'e55a7000-0000-4000-8000-0000000000d1', 'MB', 'e55a7000-0000-4000-8000-0000000000d2',
    'INCONNUE', gen_random_uuid());

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from factures_emises)),
    ((select count(*) from facture_lignes)), ((select count(*) from facture_numerotation)),
    ((select count(*) from transmissions_factures)), ((select count(*) from encaissements_factures)),
    ((select count(*) from encaissements_factures_taux)), ((select count(*) from transmissions_encaissements)),
    ((select count(*) from lignes_bancaires))
  ) as t(n);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre(s), code attendu ou OK, message ou valeur attendus, clé)
      -- genre : « jeu » (posé par le propriétaire, gardé), « controle » (annulé), « fait » (gardé), « valeur » (lecture
      -- par le propriétaire), « mutation » (un contrôle rejoué à faux, qui doit rendre l'inverse). Plusieurs ordres se
      -- séparent par « §§ » ; {RENDU} y vaut ce que le précédent a rendu ; la clé garde ce que l'étape a rendu.

      -- ══ Le jeu : deux dossiers jetables, un accès d'essai sans droit, deux mouvements ══════════
      ('j1', 'jeu', 'dossiers jetables A et B', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva) values
          ('{DA}', 'ESSAI VENTES A', '{CAB}', 'redevable', true), ('{DB}', 'ESSAI VENTES B', '{CAB}', 'redevable', true)$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-ventes@exemple.invalid')$q$, 'OK', null, null),
      ('j3', 'jeu', 'un crédit dans chaque dossier', 'proprietaire', null,
        $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant) values
          ('{MA}', '{DA}', '2026-09-20', 'ESSAI VENTES', 500), ('{MB}', '{DB}', '2026-09-20', 'ESSAI VENTES', 500)$q$, 'OK', null, null),

      -- ══ 0. Le catalogue ══════════
      ('0a', 'valeur', 'valide_par et cree_par : des identifiants de compte, nuls permis, sans défaut ni clé', 'proprietaire', null,
        $q$select string_agg(c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
               || case when a.attnotnull then ' non nulle' else ' nulle permise' end || ' défaut ' || coalesce(pg_get_expr(d.adbin, d.adrelid), 'aucun')
               || ' clé ' || (select count(*) from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and a.attnum = any(k.conkey))::text, ', ' order by c.relname)
             from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
            where (c.oid, a.attname) in (('public.factures_emises'::regclass, 'valide_par'), ('public.transmissions_factures'::regclass, 'cree_par')) and not a.attisdropped$q$,
        'OK', 'factures_emises.valide_par uuid nulle permise défaut aucun clé 0, transmissions_factures.cree_par uuid nulle permise défaut aucun clé 0', null),
      ('0b', 'valeur', 'supprimer_brouillon_facture : security definer, search_path fixé ; ni anon ni PUBLIC ne l''exécutent', 'proprietaire', null,
        $q$select p.prosecdef || ' ' || array_to_string(p.proconfig, ',') || ' anon ' || has_function_privilege('anon', p.oid, 'execute')
               || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
               || ' public ' || exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE')
             from pg_proc p where p.oid = 'public.supprimer_brouillon_facture(uuid,uuid)'::regprocedure$q$,
        'OK', 'true search_path=public anon false authenticated true public false', null),
      ('0c', 'valeur', 'les huit fonctions de la vente contrôlent l''accès par gere_les_ventes', 'proprietaire', null,
        $q$select string_agg(p.proname, ',' order by p.proname) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'if not public\.gere_les_ventes\('
              and p.prosrc !~ 'if not admin_du_dossier\('$q$,
        'OK', 'abandonner_transmission,annuler_encaissement,declarer_encaissement_hors_application,enregistrer_encaissement,enregistrer_facture,prochain_numero_facture,retirer_encaissement,supprimer_brouillon_facture', null),

      -- ══ 1 à 6. Qui enregistre une facture ══════════
      ('1', 'controle', 'l''anonyme n''exécute pas enregistrer_facture', 'anon', null,
        $q$select facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI VENTES X","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$,
        '42501', 'permission denied for function enregistrer_facture', null),
      ('2', 'controle', 'un compte rattaché à rien est refusé', 'inconnu', null,
        $q$select facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI VENTES X","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('3', 'controle', 'le client sans droit est refusé, sur son dossier', 'client', 'aucun',
        $q$select facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI VENTES X","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('4', 'controle', 'le client qui n''a que « Banque » est refusé', 'client', 'banque',
        $q$select facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI VENTES X","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('5', 'controle', 'le client portant « Ventes » sur A est refusé sur B, où il n''a pas d''accès', 'client', 'ventes',
        $q$select facture_id::text from enregistrer_facture('{DB}', null, '{"tiers_nom":"ESSAI VENTES X","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('6', 'controle', 'le client portant « Ventes » crée un brouillon sur son dossier, signé de son compte', 'client', 'ventes',
        $q$select facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI VENTES X","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)
           §§ select (created_by = '{CLIENT}' and statut = 'brouillon' and numero is null and valide_par is null)::text from factures_emises where id = '{RENDU}'$q$,
        'OK', 'true', null),
      ('M1', 'mutation', 'le contrôle 3 rejoué avec le droit « Ventes » : il passe', 'client', 'ventes',
        $q$select facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI VENTES X","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', null, null),

      -- ══ 7 à 17. La numérotation : le cabinet, puis le client, puis le cabinet ══════════
      ('7', 'fait', 'le chef valide F1', 'chef', null,
        $q$select facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI VENTES F1","date_emission":"2026-03-01","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"f1","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        'OK', null, 'F1'),
      ('7b', 'valeur', 'F1 porte le premier numéro de la série', 'proprietaire', null,
        $q$select numero from factures_emises where id = '{F1}'$q$, 'OK', 'F2026-0001', null),
      ('8', 'fait', 'le client portant « Ventes » crée le brouillon B1', 'client', 'ventes',
        $q$select facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI VENTES B1","date_emission":"2026-03-02","montant_ht":50,"montant_tva":10,"montant_ttc":60}'::jsonb, '[{"designation":"b1","quantite":1,"prix_unitaire_ht":50,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', null, 'B1'),
      ('9', 'fait', 'il le modifie : la même facture, ses lignes remplacées', 'client', 'ventes',
        $q$select facture_id::text from enregistrer_facture('{DA}', '{B1}', '{"tiers_nom":"ESSAI VENTES B1","date_emission":"2026-03-02","montant_ht":200,"montant_tva":40,"montant_ttc":240}'::jsonb, '[{"designation":"b1","quantite":1,"prix_unitaire_ht":150,"taux_tva":20},{"designation":"b1 bis","quantite":1,"prix_unitaire_ht":50,"taux_tva":20}]'::jsonb, false)
           §§ select (id = '{B1}' and montant_ttc = 240 and (select count(*) from facture_lignes l where l.facture_id = '{B1}') = 2)::text from factures_emises where id = '{RENDU}'$q$,
        'OK', 'true', null),
      ('10', 'fait', 'il le valide : le numéro suivant de la série', 'client', 'ventes',
        $q$select numero from enregistrer_facture('{DA}', '{B1}', '{"tiers_nom":"ESSAI VENTES B1","date_emission":"2026-03-02","montant_ht":200,"montant_tva":40,"montant_ttc":240}'::jsonb, '[{"designation":"b1","quantite":1,"prix_unitaire_ht":150,"taux_tva":20},{"designation":"b1 bis","quantite":1,"prix_unitaire_ht":50,"taux_tva":20}]'::jsonb, true)$q$,
        'OK', 'F2026-0002', null),
      ('11', 'fait', 'le chef valide F3', 'chef', null,
        $q$select facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI VENTES F3","date_emission":"2026-03-03","montant_ht":300,"montant_tva":60,"montant_ttc":360}'::jsonb, '[{"designation":"f3","quantite":3,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        'OK', null, 'F3'),
      ('11b', 'valeur', 'F3 porte le troisième', 'proprietaire', null,
        $q$select numero from factures_emises where id = '{F3}'$q$, 'OK', 'F2026-0003', null),
      ('12', 'valeur', 'une seule série : trois numéros qui se suivent, sans trou ni doublon, et le compteur', 'proprietaire', null,
        $q$select string_agg(numero, ',' order by numero) || ' | compteur ' || (select n.dernier_numero from facture_numerotation n where n.dossier_id = '{DA}' and n.annee = 2026 and n.type = 'facture')
             from factures_emises where dossier_id = '{DA}' and type = 'facture' and statut = 'validee'$q$,
        'OK', 'F2026-0001,F2026-0002,F2026-0003 | compteur 3', null),
      ('13', 'valeur', 'valide_par : le chef, le client, le chef — et l''auteur du brouillon reste le client', 'proprietaire', null,
        $q$select string_agg(numero || '=' || case valide_par when '{CHEF}' then 'chef' when '{CLIENT}' then 'client' else coalesce(valide_par::text, 'nul') end, ',' order by numero)
             || ' | B1 créée par ' || (select case created_by when '{CLIENT}' then 'client' else coalesce(created_by::text, 'nul') end from factures_emises where id = '{B1}')
             from factures_emises where dossier_id = '{DA}' and type = 'facture' and statut = 'validee'$q$,
        'OK', 'F2026-0001=chef,F2026-0002=client,F2026-0003=chef | B1 créée par client', null),
      ('14', 'fait', 'le client portant « Ventes » crée l''avoir de sa facture B1', 'client', 'ventes',
        $q$select numero from enregistrer_facture('{DA}', null, '{"type":"avoir","facture_origine_id":"{B1}","date_emission":"2026-03-04","montant_ht":-50,"montant_tva":-10,"montant_ttc":-60}'::jsonb, '[{"designation":"avoir","quantite":-1,"prix_unitaire_ht":50,"taux_tva":20}]'::jsonb, true)$q$,
        'OK', 'A2026-0001', null),
      ('15', 'fait', 'le chef crée l''avoir de F3, dans la même série « A »', 'chef', null,
        $q$select numero from enregistrer_facture('{DA}', null, '{"type":"avoir","facture_origine_id":"{F3}","date_emission":"2026-03-05","montant_ht":-100,"montant_tva":-20,"montant_ttc":-120}'::jsonb, '[{"designation":"avoir","quantite":-1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        'OK', 'A2026-0002', null),
      ('16', 'valeur', 'les avoirs : leur série, et qui les a validés', 'proprietaire', null,
        $q$select string_agg(numero || '=' || case valide_par when '{CHEF}' then 'chef' when '{CLIENT}' then 'client' else coalesce(valide_par::text, 'nul') end, ',' order by numero)
             from factures_emises where dossier_id = '{DA}' and type = 'avoir'$q$,
        'OK', 'A2026-0001=client,A2026-0002=chef', null),
      ('17', 'controle', 'le client portant « Ventes » n''appelle pas la numérotation', 'client', 'ventes',
        $q$select prochain_numero_facture('{DA}', 2026, 'facture')::text$q$,
        '42501', 'permission denied for function prochain_numero_facture', null),
      ('17b', 'controle', 'ni son enveloppe', 'client', 'ventes',
        $q$select attribuer_numero_facture('{DA}', 2026, 'facture')$q$,
        '42501', 'permission denied for function attribuer_numero_facture', null),
      ('M2', 'mutation', 'le contrôle 12 après un numéro consommé sans facture : le compteur passe la série', 'proprietaire', null,
        $q$select prochain_numero_facture('{DA}', 2026, 'facture')::text
           §§ select string_agg(numero, ',' order by numero) || ' | compteur ' || (select n.dernier_numero from facture_numerotation n where n.dossier_id = '{DA}' and n.annee = 2026 and n.type = 'facture')
             from factures_emises where dossier_id = '{DA}' and type = 'facture' and statut = 'validee'$q$,
        'OK', 'F2026-0001,F2026-0002,F2026-0003 | compteur 4', null),

      -- ══ 18 à 21. valide_par, figé ══════════
      ('18', 'controle', 'le chef ne change pas valide_par d''une facture validée', 'chef', null,
        $q$with u as (update factures_emises set valide_par = '{CHEF}' where id = '{B1}' returning 1) select count(*)::text from u$q$,
        '23514', 'La facture F2026-0002 est validée : elle ne se modifie plus — la corriger passe par un avoir.', null),
      ('19', 'controle', 'le propriétaire de la base non plus', 'proprietaire', null,
        $q$with u as (update factures_emises set valide_par = null where id = '{B1}' returning 1) select count(*)::text from u$q$,
        '23514', 'La facture F2026-0002 est validée : elle ne se modifie plus — la corriger passe par un avoir.', null),
      ('20', 'controle', 'le client portant « Ventes » ne l''écrit pas : sa mise à jour ne touche aucune ligne', 'client', 'ventes',
        $q$with u as (update factures_emises set valide_par = '{CHEF}' where id = '{B1}' returning 1) select count(*)::text from u$q$,
        'OK', '0', null),
      ('20b', 'valeur', 'relue, la facture garde le client pour valide_par', 'proprietaire', null,
        $q$select (valide_par = '{CLIENT}')::text from factures_emises where id = '{B1}'$q$, 'OK', 'true', null),
      ('21j', 'fait', 'le chef crée le brouillon B2', 'chef', null,
        $q$select facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI VENTES B2","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"b2","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', null, 'B2'),
      ('21', 'controle', 'un brouillon ne porte pas valide_par', 'chef', null,
        $q$with u as (update factures_emises set valide_par = '{CHEF}' where id = '{B2}' returning 1) select count(*)::text from u$q$,
        '23514', '%factures_emises_valide_par_de_la_validation%', null),
      ('M3', 'mutation', 'le contrôle 18 rejoué sur une colonne que l''envoi écrit après coup : elle passe', 'chef', null,
        $q$with u as (update factures_emises set tiers_email = 'essai@exemple.invalid' where id = '{B1}' returning 1) select count(*)::text from u$q$,
        'OK', '1', null),

      -- ══ 22 à 32. La suppression d'un brouillon ══════════
      ('22j', 'fait', 'le chef crée le brouillon B3 dans le dossier B', 'chef', null,
        $q$select facture_id::text from enregistrer_facture('{DB}', null, '{"tiers_nom":"ESSAI VENTES B3","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"b3","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', null, 'B3'),
      ('22k', 'fait', 'le client portant « Ventes » crée le brouillon B4', 'client', 'ventes',
        $q$select facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI VENTES B4","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"b4","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', null, 'B4'),
      -- valide_par est celui qui VALIDE, jamais celui qui a créé : un brouillon du client validé par le chef, et l'inverse
      -- (deux contrôles annulés, qui laissent B4 et B2 en brouillon pour la suite).
      ('22l', 'controle', 'le chef valide un brouillon du client : valide_par dit le chef, l''auteur reste le client', 'chef', null,
        $q$select numero from enregistrer_facture('{DA}', '{B4}', '{"tiers_nom":"ESSAI VENTES B4","date_emission":"2026-03-06","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"b4","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)
           §§ select (valide_par = '{CHEF}' and created_by = '{CLIENT}')::text from factures_emises where id = '{B4}'$q$,
        'OK', 'true', null),
      ('22m', 'controle', 'le client portant « Ventes » valide un brouillon du chef : valide_par dit le client, l''auteur reste le chef', 'client', 'ventes',
        $q$select numero from enregistrer_facture('{DA}', '{B2}', '{"tiers_nom":"ESSAI VENTES B2","date_emission":"2026-03-06","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"b2","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true)
           §§ select (valide_par = '{CLIENT}' and created_by = '{CHEF}')::text from factures_emises where id = '{B2}'$q$,
        'OK', 'true', null),
      ('22', 'controle', 'l''anonyme n''exécute pas supprimer_brouillon_facture', 'anon', null,
        $q$select supprimer_brouillon_facture('{DA}', '{B2}')::text$q$, '42501', 'permission denied for function supprimer_brouillon_facture', null),
      ('23', 'controle', 'un compte rattaché à rien est refusé', 'inconnu', null,
        $q$select supprimer_brouillon_facture('{DA}', '{B2}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('24', 'controle', 'le client sans droit est refusé', 'client', 'aucun',
        $q$select supprimer_brouillon_facture('{DA}', '{B2}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('25', 'controle', 'le client qui n''a que « Banque » est refusé', 'client', 'banque',
        $q$select supprimer_brouillon_facture('{DA}', '{B2}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('26', 'controle', 'le client portant « Ventes » est refusé sur un autre dossier, sous les mêmes mots', 'client', 'ventes',
        $q$select supprimer_brouillon_facture('{DB}', '{B3}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      -- L'accès au dossier ANNONCÉ passe avant toute lecture : sans droit, une facture qui n'existe pas reçoit le même
      -- refus qu'une facture qui existe — le compte n'apprend rien de ce que le dossier contient.
      ('26b', 'controle', 'sans droit, une facture qui n''existe pas : le refus d''accès, pas « introuvable »', 'client', 'aucun',
        $q$select supprimer_brouillon_facture('{DA}', '{INCONNUE}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('26c', 'controle', 'sur un dossier sans accès, une facture qui n''existe pas : le refus d''accès, pas « introuvable »', 'client', 'ventes',
        $q$select supprimer_brouillon_facture('{DB}', '{INCONNUE}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('27', 'controle', 'la facture d''un autre dossier, annoncée dans le sien : introuvable', 'client', 'ventes',
        $q$select supprimer_brouillon_facture('{DA}', '{B3}')::text$q$, 'P0002', 'Facture introuvable dans ce dossier.', null),
      ('28', 'controle', 'une facture qui n''existe pas : introuvable', 'client', 'ventes',
        $q$select supprimer_brouillon_facture('{DA}', '{INCONNUE}')::text$q$, 'P0002', 'Facture introuvable dans ce dossier.', null),
      ('29', 'controle', 'une facture validée ne se supprime pas : elle se corrige par un avoir', 'client', 'ventes',
        $q$select supprimer_brouillon_facture('{DA}', '{B1}')::text$q$,
        '22023', 'La facture F2026-0002 est validée : elle ne se supprime plus — la corriger passe par un avoir.', null),
      ('30', 'fait', 'le client portant « Ventes » supprime le brouillon B2 : la base rend son identifiant', 'client', 'ventes',
        $q$select (supprimer_brouillon_facture('{DA}', '{B2}') = '{B2}')::text$q$, 'OK', 'true', null),
      ('31', 'valeur', 'B2 est parti avec ses lignes', 'proprietaire', null,
        $q$select (select count(*) from factures_emises where id = '{B2}') || '/' || (select count(*) from facture_lignes where facture_id = '{B2}')$q$,
        'OK', '0/0', null),
      ('32', 'controle', 'le chef supprime un brouillon du dossier B par la même fonction, lignes comprises', 'chef', null,
        $q$select (supprimer_brouillon_facture('{DB}', '{B3}') = '{B3}')::text
           §§ select '{RENDU}/' || (select count(*) from factures_emises where id = '{B3}') || '/' || (select count(*) from facture_lignes where facture_id = '{B3}')$q$,
        'OK', 'true/0/0', null),
      ('M4', 'mutation', 'le contrôle 29 rejoué sur un brouillon de son dossier : il passe', 'client', 'ventes',
        $q$select (supprimer_brouillon_facture('{DA}', '{B4}') = '{B4}')::text$q$, 'OK', 'true', null),

      -- ══ 33 à 38. L'abandon d'une transmission restée sans issue ══════════
      ('33j', 'fait', 'une transmission de F3 partie il y a vingt minutes, sans issue connue', 'service_role', null,
        $q$insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, cree_le)
             values ('{DA}', '{F3}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), now() - interval '20 minutes') returning id::text$q$,
        'OK', null, 'T1'),
      ('33k', 'fait', 'une facture validée du dossier B', 'chef', null,
        $q$select facture_id::text from enregistrer_facture('{DB}', null, '{"tiers_nom":"ESSAI VENTES FB","date_emission":"2026-03-01","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"fb","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        'OK', null, 'FB'),
      ('33l', 'fait', 'et sa transmission sans issue', 'service_role', null,
        $q$insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, cree_le)
             values ('{DB}', '{FB}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), now() - interval '20 minutes') returning id::text$q$,
        'OK', null, 'TB'),
      ('33', 'controle', 'le client sans droit n''abandonne pas', 'client', 'aucun',
        $q$select etat from abandonner_transmission('{T1}')$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('34', 'controle', 'le client portant « Ventes » n''abandonne pas la transmission d''un autre dossier', 'client', 'ventes',
        $q$select etat from abandonner_transmission('{TB}')$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('35', 'controle', 'le client portant « Ventes » abandonne, et le détail dit que c''est lui', 'client', 'ventes',
        $q$select etat || ' : ' || detail from abandonner_transmission('{T1}')$q$,
        'OK', 'echec : Abandonnée par le client, qui a vérifié que la plateforme ne l''a pas reçue : la facture peut repartir.', null),
      ('36', 'controle', 'le chef abandonne, et le détail est celui d''hier', 'chef', null,
        $q$select etat || ' : ' || detail from abandonner_transmission('{T1}')$q$,
        'OK', 'echec : Abandonnée par le cabinet, qui a vérifié que la plateforme ne l''a pas reçue : la facture peut repartir.', null),
      ('M5', 'mutation', 'le contrôle 35 rejoué sous le chef : le détail n''est pas celui du client', 'chef', null,
        $q$select (etat || ' : ' || detail <> 'echec : Abandonnée par le client, qui a vérifié que la plateforme ne l''a pas reçue : la facture peut repartir.')::text from abandonner_transmission('{T1}')$q$,
        'OK', 'true', null),

      -- ══ 39 à 42. cree_par d'une transmission ══════════
      ('39j', 'fait', 'une transmission acceptée de B1, réservée par le client', 'service_role', null,
        $q$insert into transmissions_factures (dossier_id, facture_id, canal, hote, flux_id, sha256, etat, cree_par)
             values ('{DA}', '{B1}', 'plateforme', 'pa.exemple.fr', 'flux-essai-ventes', repeat('ab', 32), 'accepte', '{CLIENT}') returning id::text$q$,
        'OK', null, 'T2'),
      ('39', 'valeur', 'cree_par est gardé tel qu''écrit', 'proprietaire', null,
        $q$select (cree_par = '{CLIENT}')::text from transmissions_factures where id = '{T2}'$q$, 'OK', 'true', null),
      ('40', 'controle', 'l''auteur d''une transmission ne change pas', 'service_role', null,
        $q$with u as (update transmissions_factures set cree_par = '{CHEF}' where id = '{T2}' returning 1) select count(*)::text from u$q$,
        '23514', 'L''auteur d''une transmission ne change pas : c''est le compte qui l''a réservée.', null),
      ('41', 'controle', 'même nul : il ne se pose pas après coup', 'service_role', null,
        $q$with u as (update transmissions_factures set cree_par = '{CLIENT}' where id = '{T1}' returning 1) select count(*)::text from u$q$,
        '23514', 'L''auteur d''une transmission ne change pas : c''est le compte qui l''a réservée.', null),
      ('42', 'controle', 'le suivi d''une transmission, lui, avance', 'service_role', null,
        $q$with u as (update transmissions_factures set etat = 'depose', flux_id = 'flux-essai-suivi' where id = '{T1}' returning 1) select count(*)::text from u$q$,
        'OK', '1', null),

      -- ══ 43 à 57. Les encaissements ══════════
      ('43', 'controle', 'le client sans droit n''enregistre pas d''encaissement', 'client', 'aucun',
        $q$select id::text from enregistrer_encaissement('{DA}', '{B1}', '2026-09-20', 40, 'virement', null, '[{"taux":20,"montant":40}]'::jsonb)$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('44', 'controle', 'sans droit, l''accès refuse avant le mouvement (rang 1)', 'client', 'aucun',
        $q$select id::text from enregistrer_encaissement('{DA}', '{B1}', '2026-09-20', 40, 'virement', '{MA}', '[{"taux":20,"montant":40}]'::jsonb)$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('45', 'controle', 'avec « Ventes » seul, un mouvement ne se désigne pas : le refus neuf', 'client', 'ventes',
        $q$select id::text from enregistrer_encaissement('{DA}', '{B1}', '2026-09-20', 40, 'virement', '{MA}', '[{"taux":20,"montant":40}]'::jsonb)$q$,
        '42501', 'Le mouvement bancaire d''un encaissement ne se désigne qu''avec le droit « Banque » sur ce dossier : sans lui, l''encaissement s''enregistre sans mouvement.', null),
      ('46', 'controle', 'le refus neuf vient au rang 2 : avant la facture introuvable', 'client', 'ventes',
        $q$select id::text from enregistrer_encaissement('{DA}', '{FB}', '2026-09-20', 40, 'virement', '{MA}', '[{"taux":20,"montant":40}]'::jsonb)$q$,
        '42501', 'Le mouvement bancaire d''un encaissement ne se désigne qu''avec le droit « Banque » sur ce dossier : sans lui, l''encaissement s''enregistre sans mouvement.', null),
      ('46b', 'controle', 'sans mouvement, la même saisie sur la facture d''un autre dossier : introuvable', 'client', 'ventes',
        $q$select id::text from enregistrer_encaissement('{DA}', '{FB}', '2026-09-20', 40, 'virement', null, '[{"taux":20,"montant":40}]'::jsonb)$q$,
        'P0002', 'Facture introuvable dans ce dossier.', null),
      ('47', 'fait', 'avec « Ventes » seul, sans mouvement : enregistré, signé du client', 'client', 'ventes',
        $q$select e.id::text from enregistrer_encaissement('{DA}', '{B1}', '2026-09-20', 40, 'virement', null, '[{"taux":20,"montant":40}]'::jsonb) e where e.cree_par = '{CLIENT}'$q$,
        'OK', null, 'E1'),
      ('48', 'fait', 'avec les deux droits, un mouvement se désigne', 'client', 'deux',
        $q$select e.id::text from enregistrer_encaissement('{DA}', '{B1}', '2026-09-21', 50, 'virement', '{MA}', '[{"taux":20,"montant":50}]'::jsonb) e where e.cree_par = '{CLIENT}' and e.ligne_bancaire_id = '{MA}'$q$,
        'OK', null, 'E2'),
      ('49', 'controle', 'le chef désigne un mouvement : le cabinet a les deux droits', 'chef', null,
        $q$select (e.ligne_bancaire_id = '{MA}')::text from enregistrer_encaissement('{DA}', '{F1}', '2026-09-22', 10, 'virement', '{MA}', '[{"taux":20,"montant":10}]'::jsonb) e$q$,
        'OK', 'true', null),
      ('50', 'controle', 'le client portant les deux droits sur A n''encaisse pas une facture de B', 'client', 'deux',
        $q$select id::text from enregistrer_encaissement('{DB}', '{FB}', '2026-09-20', 10, 'virement', null, '[{"taux":20,"montant":10}]'::jsonb)$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('M6', 'mutation', 'le contrôle 45 rejoué avec le droit « Banque » aussi : il passe', 'client', 'deux',
        $q$select (e.ligne_bancaire_id = '{MA}')::text from enregistrer_encaissement('{DA}', '{F1}', '2026-09-20', 40, 'virement', '{MA}', '[{"taux":20,"montant":40}]'::jsonb) e$q$,
        'OK', 'true', null),
      ('51', 'controle', 'le client sans droit ne retire pas un encaissement', 'client', 'aucun',
        $q$select id::text from retirer_encaissement('{DA}', '{E1}')$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('52', 'fait', 'le client portant « Ventes » le retire, et le retrait est signé de son compte', 'client', 'ventes',
        $q$select (retire_par = '{CLIENT}' and retire_le is not null)::text from retirer_encaissement('{DA}', '{E1}')$q$, 'OK', 'true', null),
      ('53', 'controle', 'le client sans droit ne déclare pas un encaissement', 'client', 'aucun',
        $q$select id::text from declarer_encaissement_hors_application('{DA}', '{E2}', null)$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('54', 'fait', 'le client portant « Ventes » le déclare hors application, signé de son compte', 'client', 'ventes',
        $q$select (cree_par = '{CLIENT}' and canal = 'manuel' and hote = 'pa.exemple.fr' and etat = 'depose')::text
             from declarer_encaissement_hors_application('{DA}', '{E2}', 'Saisi sur la plateforme (essai)')$q$, 'OK', 'true', null),
      ('55', 'controle', 'le client sans droit ne contre-passe pas', 'client', 'aucun',
        $q$select id::text from annuler_encaissement('{DA}', '{E2}', '2026-10-01', 'essai')$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('56', 'fait', 'le client portant « Ventes » contre-passe l''encaissement déclaré, signé de son compte', 'client', 'ventes',
        $q$select (cree_par = '{CLIENT}' and montant = -50 and annule_id = '{E2}')::text
             from annuler_encaissement('{DA}', '{E2}', '2026-10-01', 'Chèque revenu impayé (essai)')$q$, 'OK', 'true', null),
      ('57', 'controle', 'le client portant « Ventes » sur A ne retire rien par le dossier B', 'client', 'ventes',
        $q$select id::text from retirer_encaissement('{DB}', '{E2}')$q$, '42501', 'Accès refusé à ce dossier.', null),

      -- ══ 60 à 66. Ce que le client lit ══════════
      ('60c', 'valeur', 'les identifiants des factures du dossier A, lus par le propriétaire', 'proprietaire', null,
        $q$select string_agg(quote_literal(id::text), ', ' order by id) from factures_emises where dossier_id = '{DA}'$q$, 'OK', null, 'FA_IDS'),
      ('60', 'valeur', 'les factures du dossier A, lues par le propriétaire', 'proprietaire', null,
        $q$select count(*)::text from factures_emises where dossier_id = '{DA}'$q$, 'OK', null, 'NFA'),
      ('61', 'controle', 'avec « Ventes », le client lit toutes les factures du dossier A, brouillons compris', 'client', 'ventes',
        $q$select count(*)::text from factures_emises where dossier_id = '{DA}'$q$, 'OK', '{NFA}', null),
      ('62', 'controle', 'et rien du dossier B', 'client', 'ventes',
        $q$select (select count(*) from factures_emises where dossier_id = '{DB}') || '/' || (select count(*) from transmissions_factures where dossier_id = '{DB}')$q$,
        'OK', '0/0', null),
      ('63', 'controle', 'avec « Ventes », ses transmissions, ses encaissements, leurs parts et leurs déclarations', 'client', 'ventes',
        $q$select (select count(*) from transmissions_factures where dossier_id = '{DA}') || '/' || (select count(*) from encaissements_factures where dossier_id = '{DA}')
             || '/' || (select count(*) from encaissements_factures_taux where dossier_id = '{DA}') || '/' || (select count(*) from transmissions_encaissements where dossier_id = '{DA}')$q$,
        'OK', '2/3/3/1', null),
      ('64', 'controle', 'sans droit, rien', 'client', 'aucun',
        $q$select (select count(*) from factures_emises where dossier_id = '{DA}') || '/' || (select count(*) from facture_lignes where facture_id in ({FA_IDS})) || '/' || (select count(*) from transmissions_factures where dossier_id = '{DA}')
             || '/' || (select count(*) from encaissements_factures where dossier_id = '{DA}') || '/' || (select count(*) from transmissions_encaissements where dossier_id = '{DA}')$q$,
        'OK', '0/0/0/0/0', null),
      ('65', 'controle', 'avec « Banque » seul, rien des ventes', 'client', 'banque',
        $q$select (select count(*) from factures_emises where dossier_id = '{DA}') || '/' || (select count(*) from encaissements_factures where dossier_id = '{DA}')$q$,
        'OK', '0/0', null),
      ('66', 'controle', 'avec « Ventes », il lit qui a validé et qui a réservé', 'client', 'ventes',
        $q$select (select (valide_par = '{CLIENT}')::text from factures_emises where id = '{B1}') || '/' || (select (cree_par = '{CLIENT}')::text from transmissions_factures where id = '{T2}')$q$,
        'OK', 'true/true', null),
      ('M7', 'mutation', 'le contrôle 64 rejoué avec « Ventes » : il voit des ventes', 'client', 'ventes',
        $q$select ((select count(*) from factures_emises where dossier_id = '{DA}') > 0)::text$q$, 'OK', 'true', null)
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
        if s.qui = 'anon' then
          set local role anon;
          perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        elsif s.qui = 'service_role' then
          set local role service_role;
          perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
        elsif s.qui in ('inconnu', 'client', 'chef') then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub',
            case s.qui when 'inconnu' then inconnu when 'client' then client else chef end, 'role', 'authenticated')::text, true);
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
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from factures_emises)),
    ((select count(*) from facture_lignes)), ((select count(*) from facture_numerotation)),
    ((select count(*) from transmissions_factures)), ((select count(*) from encaissements_factures)),
    ((select count(*) from encaissements_factures_taux)), ((select count(*) from transmissions_encaissements)),
    ((select count(*) from lignes_bancaires))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || avant || ' -> ' || apres, 'ok', erreur is null and avant = apres);
  perform set_config('essai.ventes_client', verdicts::text, true);
end
$essai$;

select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                 else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
from jsonb_to_recordset(current_setting('essai.ventes_client')::jsonb) as v(controle text, genre text, ok boolean, observe text)
order by v.genre desc, (regexp_match(v.controle, '^M?(\d+)'))[1]::int, v.controle;
