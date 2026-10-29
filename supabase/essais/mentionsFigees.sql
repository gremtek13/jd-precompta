-- LA FACTURE FIGE SES MENTIONS, ÉPROUVÉE EN BASE (espace client, étape A7a, ligne 51.5 ; migration `mentions_figees`) — à
-- rejouer par `execute_sql` après toute migration qui touche `enregistrer_facture`, `numero_tva_du_vendeur`,
-- `porte_la_mention_ei`, la garde des factures validées, les paramètres de facturation, l'identité légale de `dossiers`,
-- `contacts` ou `articles`.
--
-- Ce qui se prouve ici, par impersonation — le client de l'essai avec « Ventes », sans droit ; le chef du cabinet ; le
-- propriétaire de la base ; le rôle des Edge Functions :
--   - CHAQUE COLONNE FIGÉE À LA VALIDATION, par les deux espaces : le client « Ventes » valide une facture d'un dossier
--     d'entrepreneur individuel qui a des paramètres, un RIB confirmé PUIS un RIB seulement PROPOSÉ par lui, et un logo ;
--     le cabinet en valide une dans le même dossier, le RIB proposé confirmé entre-temps, une dans une société en
--     franchise sans paramètres, une dans un dossier exonéré qui a son numéro de TVA — sous un autre SIRET que celui du
--     dossier, et la dernière version de ses paramètres retirant le RIB. Le statut et le numéro de TVA (celui du SIRET
--     que la facture fige), l'identité légale, les paramètres de la version courante, le RIB CONFIRMÉ — jamais le proposé,
--     aucun quand la version courante l'a retiré —, le logo, le mandataire (le cabinet, jamais le client), le contact
--     d'où vient le client et la provenance des lignes ;
--   - LE NUMÉRO DE TVA, calculé en base comme `numeroTvaImprime` le calcule (src/lib/mentionsFigees.test.ts confronte le
--     module aux cas « TVA- » ci-dessous), et LA MENTION D'UN ENTREPRENEUR INDIVIDUEL (`porte_la_mention_ei`, confrontée
--     de même aux cas « EI- ») ;
--   - LES AUTRES MENTIONS DU DOSSIER (`dossiers.mentions_identite`, A5-Q9) : le cabinet seul les écrit, sous leur
--     contrainte ;
--   - LES REFUS NEUFS d'`enregistrer_facture`, chacun sous son code et ses mots, dans leur ordre, ceux d'hier passant
--     d'abord ; le contact que garde un brouillon écrit en direct, refusé à la validation ; une identité sans forme
--     juridique, que le client « Ventes » ne valide pas et le cabinet si (MEG1-Q14) ; la dénomination d'un entrepreneur
--     individuel ;
--   - LE NUMÉRO D'ENGAGEMENT ouvert à tout acheteur, le code service gardé à l'organisme public ;
--   - LA GARDE : une colonne figée ne s'écrit plus — ni par le chef, super-administrateur compris, ni par le propriétaire —,
--     ce que l'envoi écrit après coup si ; un brouillon ne porte rien de figé ; la RESTAURATION, seule porte, réinsère une
--     facture telle qu'elle a été figée, et chaque contrainte de la ligne refuse par son NOM ;
--   - UNE FACTURE D'AVANT : elle garde ses colonnes nulles, intactes, et son avoir fige du jour ; l'avoir d'une facture
--     qui a figé ses mentions en reprend la TVA et l'identité, même quand le dossier a changé depuis ;
--   - LA REPRISE SUR LES RÉPONSES DU CABINET DU 28/10/2026 (sections 2a, 13 à 16 ; le dossier G, basculé, et un second
--     accès « Ventes » du client à lui) : L'ÉMETTEUR DU DOSSIER (A7-Q2) — le client « Ventes » valide sous le SIRET et
--     l'adresse du dossier, aux blancs et aux fins de ligne près, jamais sous d'autres, ni dans un dossier sans SIRET ou
--     sans adresse ; le cabinet, si ; un avoir reprend l'émetteur de sa facture — ; L'IBAN HORS DES TEXTES LIBRES
--     (A7-Q3) — `porte_un_iban`, cas par cas (les cas « IBAN- », que src/lib/parametresFacturationIban.test.ts confronte
--     au module), un IBAN dans chaque texte libre que la facture imprime, pour le cabinet et pour le client, refusé à
--     l'enregistrement ; une clé fausse, qui passe ; ce qu'un brouillon garde, jugé ; un avoir, qui ne rejuge pas ce qu'il
--     recopie ; à la validation, l'identité du dossier et les paramètres en vigueur, dont une version d'avant la petite
--     migration `iban_hors_des_parametres` (posée ici par le propriétaire) ; la restauration, qui réinsère tel quel ;
--   - et que RIEN ne reste en base.
--
-- Tout se joue dans des dossiers JETABLES du cabinet du chef, au sein d'un bloc qui s'annule entièrement à la fin
-- (`ANNULATION_ESSAI_GLOBALE`) : chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`,
-- P0001), le verdict posé dans une VARIABLE avant ; les étapes « fait » sont gardées jusqu'à l'annulation finale, et une
-- étape peut rendre un identifiant que les suivantes citent (`{CLE}`). Un refus se juge à son code ET à son message. Les
-- droits de l'accès d'essai se posent avant chaque étape qui les nomme ; « Ventes » ne se porte que sur un dossier
-- basculé (garder_droit_ventes), d'où le dossier A, basculé, dont les factures validées portent la nature de leurs
-- opérations. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.mentions_figees`) : le fichier se joue
-- d'un seul appel, ne crée aucune table et ne porte AUCUNE instruction de suppression. Hors de l'outil d'exécution, il se
-- joue en UNE transaction (`psql -1`). Avant la migration, il se dit impossible. Les IBAN d'essai portent le code banque
-- 99999 ; les SIREN et SIRET sont fictifs, justes par leur clé ; aucune valeur d'une ligne de la base n'est rendue, hors
-- de celles que l'essai écrit (le nom du cabinet se compare, il ne s'affiche pas).
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil, une valeur ou une cible délibérément autres :
-- chacune doit MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait — la preuve qu'il n'est pas vrai
-- par construction.
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
  -- La migration d'abord : avant elle, cet essai n'a rien à juger. Son témoin : la colonne `mentions_figees`.
  if not exists (select 1 from pg_attribute where attrelid = 'public.factures_emises'::regclass and attname = 'mentions_figees'
                  and not attisdropped) then
    raise exception 'ESSAI_IMPOSSIBLE : la migration mentions_figees n''est pas en base';
  end if;
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from super_admins where user_id = client)
     or not exists (select 1 from super_admins where user_id = chef) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou comptes rattachés autrement qu''attendu';
  end if;

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet,
    'DA', 'a7a00000-0000-4000-8000-0000000000a1', 'DB', 'a7a00000-0000-4000-8000-0000000000b1',
    'DC', 'a7a00000-0000-4000-8000-0000000000c1', 'DD', 'a7a00000-0000-4000-8000-0000000000d1',
    'DE', 'a7a00000-0000-4000-8000-0000000000e1', 'DR', 'a7a00000-0000-4000-8000-0000000000f2',
    'ACCES', 'a7a00000-0000-4000-8000-0000000000f1',
    'KA', 'a7a00000-0000-4000-8000-0000000001a1', 'KB', 'a7a00000-0000-4000-8000-0000000001b1',
    'AA', 'a7a00000-0000-4000-8000-0000000002a1', 'AB', 'a7a00000-0000-4000-8000-0000000002b1',
    'V1', 'a7a00000-0000-4000-8000-0000000003a1',
    'VE1', 'a7a00000-0000-4000-8000-0000000003e1', 'VE2', 'a7a00000-0000-4000-8000-0000000003e2',
    'FD', 'a7a00000-0000-4000-8000-0000000004d1', 'LD', 'a7a00000-0000-4000-8000-0000000004d2',
    'FR', 'a7a00000-0000-4000-8000-0000000004f1',
    'DG', 'a7a00000-0000-4000-8000-0000000000a2', 'ACCES2', 'a7a00000-0000-4000-8000-0000000000f3',
    'VG1', 'a7a00000-0000-4000-8000-0000000003b1', 'VG2', 'a7a00000-0000-4000-8000-0000000003b2',
    'VG4', 'a7a00000-0000-4000-8000-0000000003b4', 'VG5', 'a7a00000-0000-4000-8000-0000000003b5',
    'VG6', 'a7a00000-0000-4000-8000-0000000003b6', 'VR', 'a7a00000-0000-4000-8000-0000000003f1',
    'FRI', 'a7a00000-0000-4000-8000-0000000004f2', 'LRI', 'a7a00000-0000-4000-8000-0000000004f3',
    'SHA', repeat('a7', 32), 'INCONNUE', gen_random_uuid());

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from factures_emises)),
    ((select count(*) from facture_lignes)), ((select count(*) from facture_numerotation)),
    ((select count(*) from parametres_facturation)), ((select count(*) from contacts)), ((select count(*) from articles)),
    ((select count(*) from cabinets))
  ) as t(n);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre(s), code attendu ou OK, message ou valeur attendus, clé)
      -- genre : « jeu » (posé, gardé ; un échec rend l'essai impossible), « controle » (annulé), « fait » (gardé),
      -- « valeur » (lecture par le propriétaire), « mutation » (un contrôle rejoué autrement, qui doit rendre l'inverse).
      -- Plusieurs ordres se séparent par « §§ » ; {RENDU} y vaut ce que le précédent a rendu ; la clé garde ce que l'étape
      -- a rendu.

      -- ══ Le jeu ══════════
      -- A : un entrepreneur individuel redevable, basculé, sa dénomination portant « EI » et une autre mention ; B : une
      -- société par actions simplifiée en franchise, son capital et son greffe, sans numéro de TVA ; C : un entrepreneur
      -- individuel sans dénomination ; D : un dossier sans aucune facture validée, pour une facture d'avant ; E : un dossier
      -- exonéré qui a son numéro de TVA ; R : un dossier vide, pour la restauration.
      ('j1', 'jeu', 'six dossiers jetables', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, siret, adresse, statut_tva, assujetti_tva, article_exoneration, numero_tva_attribue,
             ventes_par_les_factures, forme_juridique, denomination_imprimee, capital, rcs_ville, mentions_identite) values
          ('{DA}', 'ESSAI A7 A', '{CAB}', '12345678200010', 'ESSAI A7 ADRESSE A', 'redevable', true, null, false, true, '1000', 'ESSAI A7 DUPONT EI', null, null, 'ESSAI A7 RÉPERTOIRE DES MÉTIERS'),
          ('{DB}', 'ESSAI A7 B', '{CAB}', '12345678200010', null, 'franchise', false, null, false, false, '5710', 'ESSAI A7 SAS', 1000.50, 'Lyon', null),
          ('{DC}', 'ESSAI A7 C', '{CAB}', '12345678200010', null, 'redevable', true, null, false, false, '1000', null, null, null, null),
          ('{DD}', 'ESSAI A7 D', '{CAB}', '12345678200010', null, 'redevable', true, null, false, false, null, null, null, null, null),
          ('{DE}', 'ESSAI A7 E', '{CAB}', '12345678200010', null, 'exonere', false, 'cgi_261_4_1', true, false, null, null, null, null, null),
          ('{DR}', 'ESSAI A7 R', '{CAB}', null, null, null, false, null, false, false, null, null, null, null, null)$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A, sans droit', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-a7@example.test')$q$, 'OK', null, null),
      ('j3', 'jeu', 'un contact et un article dans A et dans B', 'proprietaire', null,
        $q$insert into contacts (id, dossier_id, type_client, nom, adresse) values
          ('{KA}', '{DA}', 'assujetti', 'ESSAI A7 CLIENT A', 'ESSAI A7 ADRESSE CLIENT A'), ('{KB}', '{DB}', 'assujetti', 'ESSAI A7 CLIENT B', 'ESSAI A7 ADRESSE CLIENT B')
        §§ insert into articles (id, dossier_id, reference, designation, unite, prix_unitaire_ht, taux_tva, nature) values
          ('{AA}', '{DA}', 'A7-REF-1', 'ESSAI A7 SÉANCE', 'HUR', 50, 20, 'services'), ('{AB}', '{DB}', 'A7-REF-2', 'ESSAI A7 PRODUIT', 'C62', 10, 0, 'biens')$q$, 'OK', null, null),
      ('j4', 'jeu', 'les paramètres de A, version 1 : le RIB confirmé par le cabinet, un logo', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, delai_paiement_jours, moyen_prefere, escompte, penalites, mentions_complementaires,
             pied_de_page, iban, bic, titulaire_compte, rib_etat, rib_confirme_par, rib_confirme_le, auteur, logo_chemin, logo_sha256) values
          ('{V1}', '{DA}', 30, 'virement', 'ESSAI A7 PAS D''ESCOMPTE', 'ESSAI A7 PÉNALITÉS', 'ESSAI A7 MENTIONS V1', 'ESSAI A7 PIED V1',
           'FR9399999000010000000000100', 'ESSAFR10', 'ESSAI A7 TITULAIRE UN', 'confirme', '{CHEF}', now(), '{CHEF}',
           '{DA}/logos/{SHA}.png', '{SHA}')$q$, 'OK', null, null),
      ('j5', 'jeu', 'une facture d''avant, restaurée dans D par le super-administrateur, et sa ligne', 'chef', null,
        $q$insert into factures_emises (id, dossier_id, type, statut, numero, date_emission, validated_at, tiers_nom, montant_ht, montant_tva, montant_ttc,
             emetteur_nom, emetteur_siret, nature_operation)
           values ('{FD}', '{DD}', 'facture', 'validee', 'F2026-0001', '2026-09-01', now(), 'ESSAI A7 CLIENT D', 100, 20, 120,
             'ESSAI A7 D', '12345678200010', 'services')
        §§ insert into facture_lignes (id, facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva)
           values ('{LD}', '{FD}', 0, 'ESSAI A7 LIGNE D', 1, 100, 20)$q$, 'OK', null, null),
      ('j6', 'jeu', 'les paramètres de E : une version au RIB confirmé, puis une qui le retire', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, delai_paiement_jours, moyen_prefere, iban, bic, titulaire_compte, rib_etat,
             rib_confirme_par, rib_confirme_le, auteur) values
          ('{VE1}', '{DE}', 30, 'virement', 'FR9399999000010000000000100', 'ESSAFR10', 'ESSAI A7 TITULAIRE E', 'confirme', '{CHEF}', now(), '{CHEF}')
        §§ insert into parametres_facturation (id, dossier_id, remplace_id, delai_paiement_jours, moyen_prefere, auteur) values
          ('{VE2}', '{DE}', '{VE1}', 30, 'cheque', '{CHEF}')$q$, 'OK', null, null),
      ('j7', 'jeu', 'G, un entrepreneur individuel redevable et basculé, son SIRET, son adresse, ses paramètres ; un second accès « Ventes » du client, à lui', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, siret, adresse, statut_tva, assujetti_tva, article_exoneration, numero_tva_attribue,
             ventes_par_les_factures, forme_juridique, denomination_imprimee) values
          ('{DG}', 'ESSAI A7 G', '{CAB}', '12345678200010', 'ESSAI A7 ADRESSE G', 'redevable', true, null, false, true, '1000', 'ESSAI A7 GARNIER EI')
        §§ insert into memberships (id, user_id, dossier_id, role, email, droit_ventes) values ('{ACCES2}', '{CLIENT}', '{DG}', 'client', 'essai-a7-g@example.test', true)
        §§ insert into parametres_facturation (id, dossier_id, delai_paiement_jours, moyen_prefere, pied_de_page, iban, bic, titulaire_compte, rib_etat,
             rib_confirme_par, rib_confirme_le, auteur) values
          ('{VG1}', '{DG}', 30, 'virement', 'ESSAI A7 PIED G', 'FR9399999000010000000000100', 'ESSAFR10', 'ESSAI A7 TITULAIRE G', 'confirme', '{CHEF}', now(), '{CHEF}')$q$,
        'OK', null, null),

      -- ══ 0. Le catalogue ══════════
      ('0a', 'valeur', 'factures_emises : les colonnes de l''étape, après la source de la vente', 'proprietaire', null,
        $q$select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' non nulle' else '' end
               || coalesce(' défaut ' || pg_get_expr(d.adbin, d.adrelid), ''), ', ' order by a.attnum)
             from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
            where a.attrelid = 'public.factures_emises'::regclass and not a.attisdropped
              and a.attnum > (select b.attnum from pg_attribute b where b.attrelid = 'public.factures_emises'::regclass and b.attname = 'source_de_la_vente')$q$,
        'OK', 'mentions_figees boolean non nulle défaut false, statut_tva text, article_exoneration text, numero_tva_attribue boolean, numero_tva_imprime text, denomination_imprimee text, forme_juridique text, capital numeric, rcs_ville text, mentions_identite text, moyen_prefere text, escompte text, penalites text, mentions_complementaires text, pied_de_page text, iban_imprime text, bic_imprime text, titulaire_imprime text, logo_chemin text, logo_sha256 text, parametres_id uuid, rib_parametres_id uuid, mandataire_nom text, contact_id uuid', null),
      ('0b', 'valeur', 'facture_lignes et dossiers : leurs colonnes de l''étape', 'proprietaire', null,
        $q$select string_agg(c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by c.relname, a.attnum)
             from pg_attribute a join pg_class c on c.oid = a.attrelid
            where (c.oid = 'public.facture_lignes'::regclass and a.attname in ('unite', 'reference', 'article_id', 'nature'))
               or (c.oid = 'public.dossiers'::regclass and a.attname = 'mentions_identite')$q$,
        'OK', 'dossiers.mentions_identite text, facture_lignes.unite text, facture_lignes.reference text, facture_lignes.article_id uuid, facture_lignes.nature text', null),
      ('0c', 'valeur', 'le contact, l''article et les deux versions des paramètres : des provenances, sans clé', 'proprietaire', null,
        $q$select count(*)::text from pg_constraint k
            where k.contype = 'f' and k.conrelid in ('public.factures_emises'::regclass, 'public.facture_lignes'::regclass)
              and exists (select 1 from unnest(k.conkey) as c(n) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = c.n
                           where a.attname in ('contact_id', 'article_id', 'parametres_id', 'rib_parametres_id'))$q$, 'OK', '0', null),
      ('0d', 'valeur', 'les trois fonctions neuves : immuables, ni security definer, ni l''anonyme, ni les comptes connectés, ni PUBLIC', 'proprietaire', null,
        $q$select string_agg(p.proname || ' ' || p.provolatile::text || ' ' || p.prosecdef::text
               || ' anon ' || has_function_privilege('anon', p.oid, 'execute') || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
               || ' public ' || exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'), ', ' order by p.proname)
             from pg_proc p where p.oid in ('public.numero_tva_du_vendeur(text,boolean,text)'::regprocedure, 'public.porte_la_mention_ei(text)'::regprocedure,
                                            'public.porte_un_iban(text)'::regprocedure)$q$,
        'OK', 'numero_tva_du_vendeur i false anon false authenticated false public false, porte_la_mention_ei i false anon false authenticated false public false, porte_un_iban i false anon false authenticated false public false', null),
      ('0e', 'valeur', 'enregistrer_facture : security definer, son chemin fixé ; les comptes connectés l''exécutent, pas l''anonyme', 'proprietaire', null,
        $q$select p.prosecdef || ' ' || array_to_string(p.proconfig, ',') || ' anon ' || has_function_privilege('anon', p.oid, 'execute')
               || ' authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
             from pg_proc p where p.oid = 'public.enregistrer_facture(uuid,uuid,jsonb,jsonb,boolean)'::regprocedure$q$,
        'OK', 'true search_path=public anon false authenticated true', null),
      ('0f', 'valeur', 'la contrainte remplacée : le code service à l''organisme public, le numéro d''engagement à tout acheteur', 'proprietaire', null,
        $q$select pg_get_constraintdef(k.oid) from pg_constraint k
            where k.conrelid = 'public.factures_emises'::regclass and k.conname = 'factures_emises_organisme_public'$q$,
        'OK', 'CHECK (((code_service IS NULL) OR COALESCE((type_client = ''organisme_public''::text), false)))', null),
      ('0g', 'valeur', 'la garde des factures validées est celle d''hier : elle fige toute colonne hors de v_modifiables', 'proprietaire', null,
        $q$select (md5(replace(p.prosrc, chr(13), '')) = 'e3dfa6dc1b3f127c66bab26d5637ef89')::text from pg_proc p
            where p.oid = 'public.garder_factures_validees()'::regprocedure$q$, 'OK', 'true', null),
      ('0h', 'valeur', 'les factures validées avant l''étape gardent leurs colonnes nulles, et leurs lignes aussi', 'proprietaire', null,
        $q$select (select count(*) from factures_emises f where f.validated_at < '2026-10-28' and f.dossier_id not in ('{DD}')
                    and (f.mentions_figees or num_nonnulls(f.statut_tva, f.article_exoneration, f.numero_tva_attribue, f.numero_tva_imprime,
                         f.denomination_imprimee, f.forme_juridique, f.capital, f.rcs_ville, f.mentions_identite, f.moyen_prefere, f.escompte,
                         f.penalites, f.mentions_complementaires, f.pied_de_page, f.iban_imprime, f.bic_imprime, f.titulaire_imprime,
                         f.logo_chemin, f.logo_sha256, f.parametres_id, f.rib_parametres_id, f.mandataire_nom, f.contact_id) > 0))
               || '/' || (select count(*) from facture_lignes l join factures_emises f on f.id = l.facture_id
                    where f.validated_at < '2026-10-28' and f.dossier_id not in ('{DD}')
                      and num_nonnulls(l.unite, l.reference, l.article_id, l.nature) > 0)$q$, 'OK', '0/0', null),

      -- ══ 1. Le numéro de TVA intracommunautaire (src/lib/mentionsFigees.test.ts lit ces cas entre les deux bornes) ══════════
      -- ── DÉBUT DES CAS TVA ──
      ('TVA', 'valeur', 'numero_tva_du_vendeur, cas par cas : le statut, la case du numéro, le SIRET', 'proprietaire', null,
        $q$select string_agg(c.cas || '=' || coalesce(public.numero_tva_du_vendeur(c.statut, c.attribue, c.siret), '-'), ' ' order by c.cas)
             from (values
               ('TVA-01', 'redevable', false, '12345678200010'),
               ('TVA-02', 'redevable', true, '12345678200010'),
               ('TVA-03', null, true, '12345678200010'),
               ('TVA-04', 'franchise', false, '12345678200010'),
               ('TVA-05', 'franchise', true, '12345678200010'),
               ('TVA-06', 'exonere', false, '12345678200010'),
               ('TVA-07', 'exonere', true, '12345678200010'),
               ('TVA-08', 'redevable', false, '123456782'),
               ('TVA-09', 'redevable', false, '123 456 782 00010'),
               ('TVA-10', 'redevable', false, '123' || chr(160) || '456' || chr(8239) || '782' || chr(9) || '00010'),
               ('TVA-11', 'redevable', false, '12345678300010'),
               ('TVA-12', 'redevable', false, '1234567820001'),
               ('TVA-13', 'redevable', false, '12345678A00010'),
               ('TVA-14', 'redevable', false, ''),
               ('TVA-15', 'redevable', false, null),
               ('TVA-16', 'redevable', false, '123456782000100'),
               ('TVA-17', 'redevable', false, '10000020700015'),
               ('TVA-18', 'redevable', false, chr(65279) || ' 12345678200010 ' || chr(10)),
               ('TVA-19', 'redevable', false, '000000000'),
               ('TVA-20', 'franchise', null, '12345678200010')
             ) as c(cas, statut, attribue, siret)$q$,
        'OK', 'TVA-01=FR11123456782 TVA-02=FR11123456782 TVA-03=- TVA-04=- TVA-05=FR11123456782 TVA-06=- TVA-07=FR11123456782 TVA-08=FR11123456782 TVA-09=FR11123456782 TVA-10=FR11123456782 TVA-11=- TVA-12=- TVA-13=- TVA-14=- TVA-15=- TVA-16=- TVA-17=FR03100000207 TVA-18=FR11123456782 TVA-19=FR12000000000 TVA-20=-', null),
      -- ── FIN DES CAS TVA ──

      -- ══ 2. La mention d'un entrepreneur individuel (src/lib/mentionsFigees.test.ts lit ces cas entre les deux bornes) ══════════
      -- ── DÉBUT DES CAS EI ──
      ('EI', 'valeur', 'porte_la_mention_ei, cas par cas', 'proprietaire', null,
        $q$select string_agg(c.cas || '=' || coalesce(public.porte_la_mention_ei(c.denomination)::text, '-'), ' ' order by c.cas)
             from (values
               ('EI-01', 'ESSAI DUPONT EI'),
               ('EI-02', 'EI ESSAI DUPONT'),
               ('EI-03', 'ESSAI DUPONT E.I.'),
               ('EI-04', 'ESSAI DUPONT (EI)'),
               ('EI-05', 'ESSAI DUPONT - EI'),
               ('EI-06', 'ESSAI DUPONT, entrepreneur individuel'),
               ('EI-07', 'Entrepreneure Individuelle ESSAI DUPONT'),
               ('EI-08', 'ESSAI DUPONT ENTREPRENEUR  INDIVIDUEL'),
               ('EI-09', 'ESSAI DUPONT'),
               ('EI-10', 'ESSAI DEI'),
               ('EI-11', 'ESSAI DUPONT EIRL'),
               ('EI-12', 'ESSAI DUPONT ei'),
               ('EI-13', null),
               ('EI-14', ''),
               ('EI-15', 'ESSAI ÉLODIE EI'),
               ('EI-16', 'ESSAIEI'),
               ('EI-17', 'ESSAI DUPONT EIÉ'),
               ('EI-18', 'ESSAI DUPONT entrepreneurindividuel'),
               ('EI-19', 'ESSAI DUPONT EI2'),
               ('EI-20', 'ESSAI DUPONT' || chr(160) || 'EI')
             ) as c(cas, denomination)$q$,
        'OK', 'EI-01=true EI-02=true EI-03=true EI-04=true EI-05=true EI-06=true EI-07=true EI-08=true EI-09=false EI-10=false EI-11=false EI-12=false EI-13=false EI-14=false EI-15=true EI-16=false EI-17=false EI-18=false EI-19=true EI-20=true', null),
      -- ── FIN DES CAS EI ──

      -- ══ 2a. Un IBAN dans un texte, reconnu par sa clé (A7-Q3 ; src/lib/parametresFacturationIban.test.ts lit ces cas entre les deux bornes) ══════════
      -- Les IBAN d'essai portent le code banque 99999 ; ceux d'autres pays, une clé calculée sur des chiffres fictifs.
      -- ── DÉBUT DES CAS IBAN ──
      ('IBAN', 'valeur', 'porte_un_iban, cas par cas : les deux formes, la clé, ce qui ne se lit pas', 'proprietaire', null,
        $q$select string_agg(c.cas || '=' || public.porte_un_iban(c.texte)::text, ' ' order by c.cas)
             from (values
               ('IBAN-01', 'FR9399999000010000000000100'),
               ('IBAN-02', 'FR93 9999 9000 0100 0000 0000 100'),
               ('IBAN-03', 'fr93 9999 9000 0100 0000 0000 100'),
               ('IBAN-04', 'Fr9399999000010000000000100'),
               ('IBAN-05', 'Merci de régler par virement sur FR93 9999 9000 0100 0000 0000 100 avant le 30.'),
               ('IBAN-06', 'IBAN : FR9399999000010000000000100.'),
               ('IBAN-07', 'Ancien compte : FR92 9999 9000 0100 0000 0000 700 ; nouveau : FR9399999000010000000000100'),
               ('IBAN-08', 'FR94 9999 9000 0100 0000 0000 100'),
               ('IBAN-09', 'FR9499999000010000000000100'),
               ('IBAN-10', 'FR9399999000010000000000010'),
               ('IBAN-11', 'N° TVA FR11123456782'),
               ('IBAN-12', 'SIRET 123 456 782 00010'),
               ('IBAN-13', 'TVA FR11123456782 SIRET 12345678200010'),
               ('IBAN-14', 'RIB : 99999 00001 00000000001 15'),
               ('IBAN-15', 'Réf. AB12 CDEF GHIJ KLMN'),
               ('IBAN-16', 'RD12 sous bois près de Lyon'),
               ('IBAN-17', 'DE73 9999 9999 0000 0012 34'),
               ('IBAN-18', 'BE60999000001234'),
               ('IBAN-19', 'GB27 ESSA 9999 9912 3456 78'),
               ('IBAN-20', 'IT27X9999999999000000001234'),
               ('IBAN-21', 'CH22 9999 9000 0000 0123 4'),
               ('IBAN-22', 'ES66 9999 9999 9900 0000 1234'),
               ('IBAN-23', 'NL95ESSA0000001234'),
               ('IBAN-24', 'NO4099990001234'),
               ('IBAN-25', 'MC12 9999 9000 0100 0000 0001 234'),
               ('IBAN-26', 'IBANFR9399999000010000000000100'),
               ('IBAN-27', 'FR93-9999-9000-0100-0000-0000-100'),
               ('IBAN-28', 'FR93' || chr(160) || '9999' || chr(160) || '9000' || chr(160) || '0100' || chr(160) || '0000' || chr(160) || '0000' || chr(160) || '100'),
               ('IBAN-29', 'FR93  9999  9000  0100  0000  0000  100'),
               ('IBAN-30', 'FR93 9999 9000 0100' || chr(10) || '0000 0000 100'),
               ('IBAN-31', 'BE60 9990 0000 1234 pour le solde'),
               ('IBAN-32', 'FR93999990000100000000001000000000000'),
               ('IBAN-33', ''),
               ('IBAN-34', null),
               ('IBAN-35', '12345678901234567890'),
               ('IBAN-36', chr(65318) || chr(65330) || chr(65305) || chr(65299) || chr(65305) || chr(65305) || chr(65305) || chr(65305) || chr(65305) || chr(65296) || chr(65296) || chr(65296) || chr(65296) || chr(65297) || chr(65296) || chr(65296) || chr(65296) || chr(65296) || chr(65296) || chr(65296) || chr(65296) || chr(65296) || chr(65296) || chr(65296) || chr(65297) || chr(65296) || chr(65296)),
               ('IBAN-37', 'FR93999990000100000000001009'),
               ('IBAN-38', '(FR9399999000010000000000100)'),
               ('IBAN-39', 'compte fr9399999000010000000000100 au nom de l’essai'),
               ('IBAN-40', 'FR549999'),
               ('IBAN-41', 'àFR9399999000010000000000100'),
               ('IBAN-42', 'FR59999990000000000000000000000001'),
               ('IBAN-43', 'FR529999900000000000000000000000001'),
               ('IBAN-44', 'FR899999900001'),
               ('IBAN-45', 'FR89 9999 9000 01'),
               ('IBAN-46', 'FRAB9999900001000000000006'),
               ('IBAN-47', 'FR939999 9000 0100 0000 0000 100'),
               ('IBAN-48', 'FR93 99999 0000 1000 0000 0001 00'),
               ('IBAN-49', 'FR93 9999 900 0010 0000 0000 0100'),
               ('IBAN-50', 'FR09 9999 9000 0000 0000 0000 0000 0000 0000'),
               ('IBAN-51', 'FR79 9999 9000 0000 0000 0000 0000 0000 000'),
               ('IBAN-52', 'NO40 9999 0001 234'),
               ('IBAN-53', 'ıT27X9999999999000000001234'),
               ('IBAN-54', 'FR93' || chr(32) || chr(160) || '9999' || chr(32) || chr(160) || '9000' || chr(32) || chr(160) || '0100' || chr(32) || chr(160) || '0000' || chr(32) || chr(160) || '0000' || chr(32) || chr(160) || '100')
             ) as c(cas, texte)$q$,
        'OK', 'IBAN-01=true IBAN-02=true IBAN-03=true IBAN-04=true IBAN-05=true IBAN-06=true IBAN-07=true IBAN-08=false IBAN-09=false IBAN-10=false IBAN-11=false IBAN-12=false IBAN-13=false IBAN-14=false IBAN-15=false IBAN-16=false IBAN-17=true IBAN-18=true IBAN-19=true IBAN-20=true IBAN-21=true IBAN-22=true IBAN-23=true IBAN-24=true IBAN-25=true IBAN-26=false IBAN-27=false IBAN-28=true IBAN-29=false IBAN-30=true IBAN-31=true IBAN-32=false IBAN-33=false IBAN-34=false IBAN-35=false IBAN-36=false IBAN-37=false IBAN-38=true IBAN-39=true IBAN-40=false IBAN-41=true IBAN-42=true IBAN-43=false IBAN-44=false IBAN-45=false IBAN-46=false IBAN-47=false IBAN-48=false IBAN-49=false IBAN-50=false IBAN-51=false IBAN-52=true IBAN-53=false IBAN-54=false', null),
      -- ── FIN DES CAS IBAN ──

      -- ══ 2b. Les autres mentions du dossier : le cabinet seul les écrit (la policy dossiers_update), sous leur contrainte ══════════
      ('5', 'controle', 'le client « Ventes » n''écrit pas les autres mentions de son dossier : rien ne change', 'client', 'ventes',
        $q$with u as (update dossiers set mentions_identite = 'ESSAI A7 AUTRE' where id = '{DA}' returning 1) select count(*)::text from u$q$,
        'OK', '0', null),
      ('6', 'controle', 'un texte blanc ne s''y écrit pas', 'chef', null,
        $q$update dossiers set mentions_identite = '   ' where id = '{DA}'$q$, '23514', '%"dossiers_mentions_identite_forme"%', null),
      ('7', 'controle', 'ni un texte de cinq cent un caractères', 'chef', null,
        $q$update dossiers set mentions_identite = repeat('é', 501) where id = '{DA}'$q$, '23514', '%"dossiers_mentions_identite_forme"%', null),
      ('M12', 'mutation', 'le contrôle 5 rejoué par le cabinet : il les écrit', 'chef', null,
        $q$with u as (update dossiers set mentions_identite = 'ESSAI A7 AUTRE' where id = '{DA}' returning 1) select count(*)::text from u$q$,
        'OK', '1', null),

      -- ══ 3. Le client « Ventes » propose un RIB, puis valide une facture : ce qu'elle fige ══════════
      ('10', 'fait', 'le client « Ventes » remplace la version 1 : il change le RIB, qui n''est que PROPOSÉ, et garde le logo', 'client', 'ventes',
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DA}', '{V1}', '{"delai_paiement_jours":45,"moyen_prefere":"virement","escompte":"ESSAI A7 ESCOMPTE V2","penalites":"ESSAI A7 PÉNALITÉS","mentions_complementaires":"ESSAI A7 MENTIONS V2","pied_de_page":"ESSAI A7 PIED V2","iban":"FR9299999000010000000000700","bic":"ESSAFR10","titulaire_compte":"ESSAI A7 TITULAIRE DEUX","logo_chemin":"{DA}/logos/{SHA}.png","logo_sha256":"{SHA}"}'::jsonb) p$q$,
        'OK', null, 'V2'),
      ('11', 'valeur', '… la version 2 est la courante, son RIB proposé', 'proprietaire', null,
        $q$select rib_etat || '|' || (remplace_id = '{V1}')::text from parametres_facturation where id = '{V2}'$q$, 'OK', 'propose|true', null),
      ('12', 'controle', 'sans droit, le client n''enregistre rien', 'client', 'aucun',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7"}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":20}]'::jsonb, false) f$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('13', 'fait', 'le client « Ventes » crée un brouillon : son contact, sa ligne venue d''un article, un numéro d''engagement à une entreprise', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 CLIENT A","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-15","date_echeance":"2026-11-14","emetteur_nom":"ESSAI A7 A","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE A","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{KA}","numero_engagement":"ESSAI-BC-1"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":2,"prix_unitaire_ht":50,"taux_tva":20,"unite":"HUR","reference":"A7-REF-1","article_id":"{AA}","nature":"services"}]'::jsonb, false) f$q$,
        'OK', null, 'F1'),
      ('14', 'valeur', '… le brouillon porte le contact et le numéro d''engagement, et rien de figé', 'proprietaire', null,
        $q$select concat_ws('|', (contact_id = '{KA}')::text, numero_engagement, mentions_figees::text,
               num_nonnulls(statut_tva, article_exoneration, numero_tva_attribue, numero_tva_imprime, denomination_imprimee, forme_juridique, capital,
                 rcs_ville, mentions_identite, moyen_prefere, escompte, penalites, mentions_complementaires, pied_de_page, iban_imprime, bic_imprime,
                 titulaire_imprime, logo_chemin, logo_sha256, parametres_id, rib_parametres_id, mandataire_nom)::text)
             from factures_emises where id = '{F1}'$q$, 'OK', 'true|ESSAI-BC-1|false|0', null),
      ('15', 'valeur', '… sa ligne, sa provenance', 'proprietaire', null,
        $q$select string_agg(concat_ws('|', unite, reference, (article_id = '{AA}')::text, nature), ';' order by ordre) from facture_lignes where facture_id = '{F1}'$q$,
        'OK', 'HUR|A7-REF-1|true|services', null),
      ('16', 'fait', 'le client « Ventes » la valide', 'client', 'ventes',
        $q$select f.numero from enregistrer_facture('{DA}', '{F1}', '{"tiers_nom":"ESSAI A7 CLIENT A","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-15","date_echeance":"2026-11-14","emetteur_nom":"ESSAI A7 A","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE A","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{KA}","numero_engagement":"ESSAI-BC-1"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":2,"prix_unitaire_ht":50,"taux_tva":20,"unite":"HUR","reference":"A7-REF-1","article_id":"{AA}","nature":"services"}]'::jsonb, true) f$q$,
        'OK', 'F2026-0001', null),
      ('17', 'valeur', '… elle fige le statut de TVA du jour et le numéro qu''il donne, calculé sur le SIRET figé', 'proprietaire', null,
        $q$select concat_ws('|', mentions_figees::text, coalesce(statut_tva, '-'), coalesce(article_exoneration, '-'), numero_tva_attribue::text, coalesce(numero_tva_imprime, '-'))
             from factures_emises where id = '{F1}'$q$, 'OK', 'true|redevable|-|false|FR11123456782', null),
      ('18', 'valeur', '… l''identité légale : la dénomination de l''entrepreneur individuel, sa forme, ses autres mentions', 'proprietaire', null,
        $q$select concat_ws('|', denomination_imprimee, forme_juridique, coalesce(capital::text, '-'), coalesce(rcs_ville, '-'), coalesce(mentions_identite, '-'))
             from factures_emises where id = '{F1}'$q$, 'OK', 'ESSAI A7 DUPONT EI|1000|-|-|ESSAI A7 RÉPERTOIRE DES MÉTIERS', null),
      ('19', 'valeur', '… les paramètres de la version COURANTE, son logo compris', 'proprietaire', null,
        $q$select concat_ws('|', (parametres_id = '{V2}')::text, moyen_prefere, escompte, penalites, mentions_complementaires, pied_de_page,
               (logo_chemin = '{DA}/logos/{SHA}.png')::text, (logo_sha256 = '{SHA}')::text)
             from factures_emises where id = '{F1}'$q$,
        'OK', 'true|virement|ESSAI A7 ESCOMPTE V2|ESSAI A7 PÉNALITÉS|ESSAI A7 MENTIONS V2|ESSAI A7 PIED V2|true|true', null),
      ('20', 'valeur', '… le RIB CONFIRMÉ de la version 1, jamais celui que le client n''a que proposé', 'proprietaire', null,
        $q$select concat_ws('|', iban_imprime, bic_imprime, titulaire_imprime, (rib_parametres_id = '{V1}')::text) from factures_emises where id = '{F1}'$q$,
        'OK', 'FR9399999000010000000000100|ESSAFR10|ESSAI A7 TITULAIRE UN|true', null),
      ('21', 'valeur', '… aucun mandataire : c''est le client qui l''a validée ; son contact, la source de sa vente, son numéro d''engagement', 'proprietaire', null,
        $q$select concat_ws('|', coalesce(mandataire_nom, '-'), (valide_par = '{CLIENT}')::text, (contact_id = '{KA}')::text, source_de_la_vente::text, numero_engagement)
             from factures_emises where id = '{F1}'$q$, 'OK', '-|true|true|true|ESSAI-BC-1', null),
      ('22', 'valeur', '… et sa ligne garde sa provenance', 'proprietaire', null,
        $q$select string_agg(concat_ws('|', unite, reference, (article_id = '{AA}')::text, nature), ';' order by ordre) from facture_lignes where facture_id = '{F1}'$q$,
        'OK', 'HUR|A7-REF-1|true|services', null),
      ('M1', 'mutation', 'le contrôle 20 rejoué sur la version 2 : son RIB existe, et n''est pas celui que la facture a figé', 'proprietaire', null,
        $q$select (iban <> (select f.iban_imprime from factures_emises f where f.id = '{F1}'))::text from parametres_facturation where id = '{V2}'$q$, 'OK', 'true', null),

      -- ══ 4. Le cabinet confirme le RIB, puis valide : ce qu'il fige de plus ══════════
      ('30', 'fait', 'le cabinet confirme le RIB proposé', 'chef', null,
        $q$select p.rib_etat from public.confirmer_rib('{DA}', '{V2}') p$q$, 'OK', 'confirme', null),
      ('31', 'fait', 'le cabinet crée et valide une facture d''un seul appel, dans le même dossier', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 CLIENT A","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-16","date_echeance":"2026-11-15","emetteur_nom":"ESSAI A7 A","emetteur_siret":"12345678200010","montant_ht":50,"montant_tva":10,"montant_ttc":60,"contact_id":"{KA}"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":50,"taux_tva":20,"unite":"HUR","nature":"services"}]'::jsonb, true) f$q$,
        'OK', null, 'F2'),
      ('32', 'valeur', '… le RIB confirmé depuis : celui de la version 2', 'proprietaire', null,
        $q$select concat_ws('|', numero, iban_imprime, bic_imprime, titulaire_imprime, (rib_parametres_id = '{V2}')::text, (parametres_id = '{V2}')::text)
             from factures_emises where id = '{F2}'$q$, 'OK', 'F2026-0002|FR9299999000010000000000700|ESSAFR10|ESSAI A7 TITULAIRE DEUX|true|true', null),
      ('33', 'valeur', '… le mandataire : le nom du cabinet du dossier, qui l''a validée', 'proprietaire', null,
        $q$select concat_ws('|', (mandataire_nom = (select c.nom from cabinets c where c.id = '{CAB}'))::text, (valide_par = '{CHEF}')::text)
             from factures_emises where id = '{F2}'$q$, 'OK', 'true|true', null),
      ('34', 'fait', 'le cabinet valide une facture de la société en franchise, sans paramètres ni contact', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DB}', null, '{"tiers_nom":"ESSAI A7 PARTICULIER","type_client":"non_assujetti","date_emission":"2026-10-16","emetteur_nom":"ESSAI A7 B","emetteur_siret":"12345678200010","montant_ht":10,"montant_tva":0,"montant_ttc":10}'::jsonb,
             '[{"designation":"ESSAI A7 PRODUIT","quantite":1,"prix_unitaire_ht":10,"taux_tva":0,"unite":"C62","reference":"A7-REF-2","article_id":"{AB}","nature":"biens"}]'::jsonb, true) f$q$,
        'OK', null, 'FB'),
      ('35', 'valeur', '… la franchise sans numéro de TVA, la forme, le capital et le greffe de la société', 'proprietaire', null,
        $q$select concat_ws('|', statut_tva, numero_tva_attribue::text, coalesce(numero_tva_imprime, '-'), denomination_imprimee, forme_juridique, capital,
               rcs_ville, coalesce(mentions_identite, '-')) from factures_emises where id = '{FB}'$q$,
        'OK', 'franchise|false|-|ESSAI A7 SAS|5710|1000.50|Lyon|-', null),
      ('36', 'valeur', '… aucun paramètre, aucun RIB, aucun logo, aucun contact ; le cabinet pour mandataire', 'proprietaire', null,
        $q$select num_nonnulls(parametres_id, moyen_prefere, escompte, penalites, mentions_complementaires, pied_de_page, logo_chemin, logo_sha256,
               iban_imprime, bic_imprime, titulaire_imprime, rib_parametres_id, contact_id)::text
               || '|' || (mandataire_nom = (select c.nom from cabinets c where c.id = '{CAB}'))::text
             from factures_emises where id = '{FB}'$q$, 'OK', '0|true', null),
      ('37', 'fait', 'le cabinet valide une facture du dossier exonéré qui a son numéro de TVA, sous un autre SIRET que celui du dossier', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DE}', null, '{"tiers_nom":"ESSAI A7 ÉTABLISSEMENT","type_client":"assujetti","date_emission":"2026-10-16","emetteur_nom":"ESSAI A7 E","emetteur_siret":"10000020700015","montant_ht":10,"montant_tva":0,"montant_ttc":10}'::jsonb,
             '[{"designation":"ESSAI A7 SOIN","quantite":1,"prix_unitaire_ht":10,"taux_tva":0}]'::jsonb, true) f$q$,
        'OK', null, 'FE'),
      ('38', 'valeur', '… l''exonération, son article, la case et le numéro qu''elle donne, celui du SIRET que la facture fige ; aucune forme connue', 'proprietaire', null,
        $q$select concat_ws('|', statut_tva, article_exoneration, numero_tva_attribue::text, coalesce(numero_tva_imprime, '-'), coalesce(denomination_imprimee, '-'), coalesce(forme_juridique, '-'))
             from factures_emises where id = '{FE}'$q$, 'OK', 'exonere|cgi_261_4_1|true|FR03100000207|-|-', null),
      ('39', 'valeur', '… la version courante, qui a retiré le RIB : aucun RIB figé, même confirmé avant elle', 'proprietaire', null,
        $q$select concat_ws('|', (parametres_id = '{VE2}')::text, moyen_prefere, coalesce(iban_imprime, '-'), coalesce(rib_parametres_id::text, '-'))
             from factures_emises where id = '{FE}'$q$, 'OK', 'true|cheque|-|-', null),

      -- ══ 5. Les refus neufs, sous leurs mots, dans leur ordre ; ceux d'hier d'abord ══════════
      ('40', 'controle', 'une unité hors de la liste, à la ligne 2', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS","montant_ht":20,"montant_tva":4,"montant_ttc":24}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20},{"designation":"y","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"unite":"XYZ"}]'::jsonb, false) f$q$,
        '22023', 'Ligne 2 : l''unité n''est pas de la liste des unités admises.', null),
      ('41', 'controle', 'une unité qui n''est pas un texte', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"unite":5}]'::jsonb, false) f$q$,
        '22023', 'Ligne 1 : l''unité n''est pas de la liste des unités admises.', null),
      ('42', 'controle', 'une référence qu''un blanc commence', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"reference":" A7"}]'::jsonb, false) f$q$,
        '22023', 'Ligne 1 : la référence tient en un à cent caractères, sans blanc au début ni à la fin.', null),
      ('43', 'controle', 'une référence vide', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"reference":""}]'::jsonb, false) f$q$,
        '22023', 'Ligne 1 : la référence tient en un à cent caractères, sans blanc au début ni à la fin.', null),
      ('44', 'controle', 'une référence de cent un caractères', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS"}'::jsonb,
             jsonb_build_array(jsonb_build_object('designation', 'x', 'quantite', 1, 'prix_unitaire_ht', 10, 'taux_tva', 20, 'reference', repeat('é', 101))), false) f$q$,
        '22023', 'Ligne 1 : la référence tient en un à cent caractères, sans blanc au début ni à la fin.', null),
      ('45', 'controle', 'une référence qui n''est pas un texte', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"reference":12}]'::jsonb, false) f$q$,
        '22023', 'Ligne 1 : la référence tient en un à cent caractères, sans blanc au début ni à la fin.', null),
      ('46', 'controle', 'une ligne « mixte »', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"nature":"mixte"}]'::jsonb, false) f$q$,
        '22023', 'Ligne 1 : la nature d''une ligne est « biens » ou « services ».', null),
      ('47', 'controle', 'le contact d''un autre dossier', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS","contact_id":"{KB}"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        'P0002', 'Le contact d''où vient le client de la facture est introuvable dans ce dossier.', null),
      ('48', 'controle', 'un contact qui n''existe pas', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS","contact_id":"{INCONNUE}"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        'P0002', 'Le contact d''où vient le client de la facture est introuvable dans ce dossier.', null),
      ('49', 'controle', 'un contact qui n''est pas un texte', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS","contact_id":5}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        'P0002', 'Le contact d''où vient le client de la facture est introuvable dans ce dossier.', null),
      ('50', 'controle', 'l''article d''un autre dossier', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"article_id":"{AB}"}]'::jsonb, false) f$q$,
        'P0002', 'Ligne 1 : l''article d''où elle vient est introuvable dans ce dossier.', null),
      ('51', 'controle', 'un article qui n''est pas un identifiant', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"article_id":"abc"}]'::jsonb, false) f$q$,
        'P0002', 'Ligne 1 : l''article d''où elle vient est introuvable dans ce dossier.', null),
      ('52', 'controle', 'l''ordre : la forme d''une ligne avant le contact', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS","contact_id":"{KB}"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20},{"designation":"y","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"unite":"XYZ"}]'::jsonb, false) f$q$,
        '22023', 'Ligne 2 : l''unité n''est pas de la liste des unités admises.', null),
      ('53', 'controle', 'l''ordre : le contact avant les articles', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS","contact_id":"{KB}"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"article_id":"{AB}"}]'::jsonb, false) f$q$,
        'P0002', 'Le contact d''où vient le client de la facture est introuvable dans ce dossier.', null),
      ('54', 'controle', 'l''ordre : la forme de la ligne 2 avant l''article de la ligne 1', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"article_id":"{AB}"},{"designation":"y","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"nature":"mixte"}]'::jsonb, false) f$q$,
        '22023', 'Ligne 2 : la nature d''une ligne est « biens » ou « services ».', null),
      ('55', 'controle', 'ceux d''hier d''abord : sans droit, l''accès', 'client', 'aucun',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"unite":"XYZ"}]'::jsonb, false) f$q$,
        '42501', 'Accès refusé à ce dossier.', null),
      ('56', 'controle', 'ceux d''hier d''abord : un avoir sans validation', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"type":"avoir","facture_origine_id":"{F1}","montant_ttc":-12}'::jsonb,
             '[{"designation":"x","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20,"unite":"XYZ"}]'::jsonb, false) f$q$,
        '22023', 'Un avoir se crée validé : il n''a pas de brouillon.', null),
      ('57', 'controle', 'ceux d''hier d''abord : une facture validée ne se modifie pas', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', '{F1}', '{"tiers_nom":"ESSAI A7 REFUS"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"unite":"XYZ"}]'::jsonb, false) f$q$,
        '22023', 'Une facture validée ne peut plus être modifiée — passer par un avoir.', null),
      ('58', 'controle', 'un avoir ignore le contact que l''appelant donne : il prend celui de sa facture', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"type":"avoir","facture_origine_id":"{F1}","date_emission":"2026-10-20","montant_ht":-10,"montant_tva":-2,"montant_ttc":-12,"contact_id":"{KB}"}'::jsonb,
             '[{"designation":"x","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f
        §§ select (contact_id = '{KA}')::text from factures_emises where id = '{RENDU}'$q$, 'OK', 'true', null),
      ('59', 'controle', 'le code service reste à l''organisme public', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 REFUS","type_client":"assujetti","code_service":"SERVICE-A7"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '23514', '%"factures_emises_organisme_public"%', null),
      ('M2', 'mutation', 'le contrôle 59 rejoué pour un organisme public : son code service passe', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 PUBLIC","type_client":"organisme_public","code_service":"SERVICE-A7","numero_engagement":"ESSAI-ENG-1"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$, 'OK', null, null),
      ('M3', 'mutation', 'les contrôles 40 et 41 rejoués avec une unité de la liste : elle passe', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 UNITE"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"unite":"DAY","reference":"A7","nature":"biens"}]'::jsonb, false) f$q$, 'OK', null, null),
      ('M4', 'mutation', 'les contrôles 47 et 50 rejoués avec le contact et l''article du dossier : ils passent', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 CONTACT","contact_id":"{KA}"}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"article_id":"{AA}"}]'::jsonb, false) f$q$, 'OK', null, null),

      -- ══ 6. Le contact que garde un brouillon écrit en direct ══════════
      ('60', 'fait', 'le cabinet crée un brouillon sans contact', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 BROUILLON","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-17","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$, 'OK', null, 'F3'),
      ('61', 'controle', 'un contact d''un autre dossier posé en direct sur le brouillon : la validation le refuse', 'chef', null,
        $q$update factures_emises set contact_id = '{KB}' where id = '{F3}'
        §§ select f.numero from enregistrer_facture('{DA}', '{F3}', '{"tiers_nom":"ESSAI A7 BROUILLON","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-17","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'P0002', 'Le contact d''où vient le client de la facture est introuvable dans ce dossier.', null),
      ('M5', 'mutation', 'le contrôle 61 rejoué avec un contact du dossier : la facture se valide', 'chef', null,
        $q$update factures_emises set contact_id = '{KA}' where id = '{F3}'
        §§ select f.numero from enregistrer_facture('{DA}', '{F3}', '{"tiers_nom":"ESSAI A7 BROUILLON","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-17","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$, 'OK', 'F2026-%', null),

      -- ══ 7. La dénomination d'un entrepreneur individuel (le dossier C) ══════════
      ('70', 'controle', 'un entrepreneur individuel sans dénomination ne valide pas', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DC}', null, '{"tiers_nom":"ESSAI A7 EI","date_emission":"2026-10-16","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'La forme juridique du dossier est celle d''un entrepreneur individuel : sa dénomination imprimée, son nom précédé ou suivi des initiales « EI » ou des mots « entrepreneur individuel » (C. com., art. R526-27), est à renseigner par le cabinet avant de valider une facture.', null),
      ('71', 'controle', 'ni sous une dénomination qui ne porte pas la mention', 'chef', null,
        $q$update dossiers set denomination_imprimee = 'ESSAI A7 MARTIN' where id = '{DC}'
        §§ select f.numero from enregistrer_facture('{DC}', null, '{"tiers_nom":"ESSAI A7 EI","date_emission":"2026-10-16","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'La forme juridique du dossier est celle d''un entrepreneur individuel : %', null),
      ('72', 'controle', 'un brouillon, lui, s''enregistre', 'chef', null,
        $q$select (f.numero is null)::text from enregistrer_facture('{DC}', null, '{"tiers_nom":"ESSAI A7 EI","date_emission":"2026-10-16","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$, 'OK', 'true', null),
      ('M6', 'mutation', 'le contrôle 71 rejoué sous une dénomination qui porte « EI » : la facture se valide, et la fige', 'chef', null,
        $q$update dossiers set denomination_imprimee = 'ESSAI A7 MARTIN EI' where id = '{DC}'
        §§ select f.facture_id::text from enregistrer_facture('{DC}', null, '{"tiers_nom":"ESSAI A7 EI","date_emission":"2026-10-16","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f
        §§ select denomination_imprimee || '|' || forme_juridique from factures_emises where id = '{RENDU}'$q$, 'OK', 'ESSAI A7 MARTIN EI|1000', null),
      ('M7', 'mutation', 'le contrôle 70 rejoué sans forme connue, par le cabinet : rien ne s''impose', 'chef', null,
        $q$update dossiers set forme_juridique = null where id = '{DC}'
        §§ select f.numero from enregistrer_facture('{DC}', null, '{"tiers_nom":"ESSAI A7 EI","date_emission":"2026-10-16","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$, 'OK', 'F2026-%', null),

      -- ══ 7b. La forme juridique, préalable de l'identité pour un accès « Ventes » (MEG1-Q14 ; le dossier A, le temps de la section) ══════════
      ('73', 'fait', 'le dossier A perd sa forme juridique, le temps de la section', 'proprietaire', null,
        $q$update dossiers set forme_juridique = null where id = '{DA}'$q$, 'OK', null, null),
      ('74', 'controle', 'sans forme juridique, le client « Ventes » ne valide pas', 'client', 'ventes',
        $q$select f.numero from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 FORME","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-18","emetteur_nom":"ESSAI A7 A","emetteur_siret":"12345678200010","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'La forme juridique du dossier n''est pas renseignée : l''identité légale qu''une facture imprime est à régler par le cabinet avant qu''une facture se valide depuis l''espace client.', null),
      ('75', 'controle', 'un brouillon, lui, s''enregistre', 'client', 'ventes',
        $q$select (f.numero is null)::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 FORME","nature_operation":"services","date_emission":"2026-10-18","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$, 'OK', 'true', null),
      ('76', 'controle', 'l''avoir d''une facture qui a figé son identité ne la rejuge pas', 'client', 'ventes',
        $q$select f.numero from enregistrer_facture('{DA}', null, '{"type":"avoir","facture_origine_id":"{F1}","date_emission":"2026-10-20","montant_ht":-10,"montant_tva":-2,"montant_ttc":-12}'::jsonb,
             '[{"designation":"x","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$, 'OK', 'A2026-%', null),
      ('M11', 'mutation', 'le contrôle 74 rejoué par le cabinet : il valide encore, l''écran le lui disant', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 FORME","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-18","emetteur_nom":"ESSAI A7 A","emetteur_siret":"12345678200010","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$, 'OK', 'F2026-%', null),
      ('76b', 'fait', 'le cabinet valide une facture sans forme juridique : elle fige une identité sans forme', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 SANS FORME","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-18","emetteur_nom":"ESSAI A7 A","emetteur_siret":"12345678200010","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$, 'OK', null, 'FN'),
      ('76c', 'controle', 'son avoir, par le client « Ventes » : il reprend cette identité, et la forme n''en est pas rejugée', 'client', 'ventes',
        $q$select f.numero from enregistrer_facture('{DA}', null, '{"type":"avoir","facture_origine_id":"{FN}","date_emission":"2026-10-20","montant_ht":-10,"montant_tva":-2,"montant_ttc":-12}'::jsonb,
             '[{"designation":"x","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f
        §§ select numero || '|' || coalesce(forme_juridique, '-') from factures_emises where facture_origine_id = '{FN}'$q$, 'OK', 'A2026-%|-', null),
      ('77', 'fait', 'le dossier A retrouve sa forme', 'proprietaire', null,
        $q$update dossiers set forme_juridique = '1000' where id = '{DA}'$q$, 'OK', null, null),
      ('78', 'controle', 'sa forme rendue, le client « Ventes » valide la même facture, sous le SIRET et l''adresse du dossier (A7-Q2)', 'client', 'ventes',
        $q$select f.numero from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI A7 FORME","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-18","emetteur_nom":"ESSAI A7 A","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE A","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$, 'OK', 'F2026-%', null),

      -- ══ 8. Un brouillon ne porte rien de figé ══════════
      ('80', 'controle', 'un brouillon ne se dit pas figé', 'chef', null,
        $q$update factures_emises set mentions_figees = true where id = '{F3}'$q$, '23514', '%"factures_emises_mentions_figees_validee"%', null),
      ('81', 'controle', 'un brouillon ne porte pas de RIB figé', 'chef', null,
        $q$update factures_emises set iban_imprime = 'FR9399999000010000000000100' where id = '{F3}'$q$, '23514', '%"factures_emises_mentions_figees_seules"%', null),
      ('82', 'controle', 'une ligne écrite en direct : son unité de la liste', 'chef', null,
        $q$insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva, unite) values ('{F3}', 9, 'x', 1, 1, 20, 'XYZ')$q$,
        '23514', '%"facture_lignes_unite_check"%', null),
      ('83', 'controle', 'sa référence sans blanc aux bords', 'chef', null,
        $q$insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva, reference) values ('{F3}', 9, 'x', 1, 1, 20, ' A7')$q$,
        '23514', '%"facture_lignes_reference_forme"%', null),
      ('84', 'controle', 'sa nature, biens ou services', 'chef', null,
        $q$insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva, nature) values ('{F3}', 9, 'x', 1, 1, 20, 'mixte')$q$,
        '23514', '%"facture_lignes_nature_check"%', null),
      ('M8', 'mutation', 'le contrôle 81 rejoué sur le contact du brouillon : il se change, le brouillon n''étant pas figé', 'chef', null,
        $q$with u as (update factures_emises set contact_id = '{KA}' where id = '{F3}' returning 1) select count(*)::text from u$q$, 'OK', '1', null),

      -- ══ 9. La garde : une colonne figée ne s'écrit plus ══════════
      ('90', 'controle', 'le chef, super-administrateur compris, ne retire pas le RIB figé', 'chef', null,
        $q$update factures_emises set iban_imprime = null, bic_imprime = null, titulaire_imprime = null, rib_parametres_id = null where id = '{F1}'$q$,
        '23514', 'La facture F2026-0001 est validée : elle ne se modifie plus — la corriger passe par un avoir.', null),
      ('91', 'controle', 'ni le contact d''où vient le client', 'chef', null,
        $q$update factures_emises set contact_id = null where id = '{F1}'$q$,
        '23514', 'La facture F2026-0001 est validée : elle ne se modifie plus — la corriger passe par un avoir.', null),
      ('92', 'controle', 'ni la marque d''une facture qui a figé ses mentions', 'chef', null,
        $q$update factures_emises set mentions_figees = false, statut_tva = null, article_exoneration = null, numero_tva_attribue = null, numero_tva_imprime = null,
             denomination_imprimee = null, forme_juridique = null, mentions_identite = null, parametres_id = null, moyen_prefere = null, escompte = null,
             penalites = null, mentions_complementaires = null, pied_de_page = null, logo_chemin = null, logo_sha256 = null, iban_imprime = null,
             bic_imprime = null, titulaire_imprime = null, rib_parametres_id = null where id = '{F1}'$q$,
        '23514', 'La facture F2026-0001 est validée : elle ne se modifie plus — la corriger passe par un avoir.', null),
      ('93', 'controle', 'le propriétaire de la base ne change pas la dénomination figée', 'proprietaire', null,
        $q$update factures_emises set denomination_imprimee = 'ESSAI A7 AUTRE EI' where id = '{F1}'$q$,
        '23514', 'La facture F2026-0001 est validée : elle ne se modifie plus — la corriger passe par un avoir.', null),
      ('94', 'controle', 'le client « Ventes » n''écrit pas une facture en direct : rien ne change', 'client', 'ventes',
        $q$with u as (update factures_emises set iban_imprime = null where id = '{F1}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('95', 'controle', 'ce que l''envoi écrit après coup s''écrit encore (le rôle des Edge Functions)', 'service_role', null,
        $q$with u as (update factures_emises set tiers_email = 'essai-a7@example.test' where id = '{F1}' returning 1) select count(*)::text from u$q$, 'OK', '1', null),
      ('96', 'controle', 'la provenance d''une ligne figée ne change plus', 'chef', null,
        $q$update facture_lignes set unite = 'C62' where facture_id = '{F1}'$q$,
        '23514', 'La facture F2026-0001 est validée : ses lignes ne changent plus — la corriger passe par un avoir.', null),

      -- ══ 10. La restauration, seule porte : une facture réinsérée telle qu'elle a été figée ══════════
      ('100', 'controle', 'le super-administrateur réinsère, dans un dossier sans compteur, une facture figée et sa ligne', 'chef', null,
        $q$insert into factures_emises (id, dossier_id, type, statut, numero, date_emission, validated_at, tiers_nom, montant_ht, montant_tva, montant_ttc,
             mentions_figees, statut_tva, numero_tva_attribue, numero_tva_imprime, denomination_imprimee, forme_juridique, parametres_id, escompte,
             iban_imprime, bic_imprime, titulaire_imprime, rib_parametres_id, mandataire_nom, contact_id)
           values ('{FR}', '{DR}', 'facture', 'validee', 'F2026-0007', '2026-10-01', now(), 'ESSAI A7 RESTAURÉ', 10, 2, 12,
             true, 'redevable', false, 'FR11123456782', 'ESSAI A7 RESTAURÉ EI', '1000', '{V1}', 'ESSAI A7 ESCOMPTE',
             'FR9399999000010000000000100', 'ESSAFR10', 'ESSAI A7 TITULAIRE UN', '{V1}', 'ESSAI A7 CABINET', '{KA}')
        §§ insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva, unite, reference, article_id, nature)
           values ('{FR}', 0, 'ESSAI A7 LIGNE', 1, 10, 20, 'HUR', 'A7-REF-1', '{AA}', 'services')
        §§ select concat_ws('|', f.mentions_figees::text, f.numero_tva_imprime, f.iban_imprime, f.mandataire_nom, l.unite, l.nature)
             from factures_emises f join facture_lignes l on l.facture_id = f.id where f.id = '{FR}'$q$,
        'OK', 'true|FR11123456782|FR9399999000010000000000100|ESSAI A7 CABINET|HUR|services', null),
      ('101', 'controle', 'pas dans un dossier qui a déjà numéroté', 'chef', null,
        $q$insert into factures_emises (dossier_id, type, statut, numero, date_emission, validated_at, tiers_nom, mentions_figees, numero_tva_attribue)
           values ('{DA}', 'facture', 'validee', 'F2026-0099', '2026-10-01', now(), 'ESSAI A7 RESTAURÉ', true, false)$q$,
        '42501', 'Une facture ne naît pas validée : elle se valide par enregistrer_facture, qui lui donne son numéro.', null),
      ('102', 'controle', 'la contrainte : figée, une facture est validée', 'chef', null,
        $q$insert into factures_emises (dossier_id, tiers_nom, mentions_figees, numero_tva_attribue) values ('{DR}', 'ESSAI A7 RESTAURÉ', true, false)$q$,
        '23514', '%"factures_emises_mentions_figees_validee"%', null),
      ('103', 'controle', 'la contrainte : figée, elle a lu la case du numéro de TVA', 'chef', null,
        $q$insert into factures_emises (dossier_id, type, statut, numero, date_emission, validated_at, tiers_nom, mentions_figees)
           values ('{DR}', 'facture', 'validee', 'F2026-0008', '2026-10-01', now(), 'ESSAI A7 RESTAURÉ', true)$q$,
        '23514', '%"factures_emises_numero_tva_attribue_fige"%', null),
      ('104', 'controle', 'la contrainte : non figée, elle ne porte rien de figé', 'chef', null,
        $q$insert into factures_emises (dossier_id, type, statut, numero, date_emission, validated_at, tiers_nom, escompte)
           values ('{DR}', 'facture', 'validee', 'F2026-0008', '2026-10-01', now(), 'ESSAI A7 RESTAURÉ', 'ESSAI A7')$q$,
        '23514', '%"factures_emises_mentions_figees_seules"%', null),
      ('105', 'controle', 'la contrainte : le numéro de TVA a sa forme', 'chef', null,
        $q$insert into factures_emises (dossier_id, type, statut, numero, date_emission, validated_at, tiers_nom, mentions_figees, numero_tva_attribue, numero_tva_imprime)
           values ('{DR}', 'facture', 'validee', 'F2026-0008', '2026-10-01', now(), 'ESSAI A7 RESTAURÉ', true, false, 'FR1')$q$,
        '23514', '%"factures_emises_numero_tva_imprime_forme"%', null),
      ('106', 'controle', 'la contrainte : un RIB figé dit la version qui le porte', 'chef', null,
        $q$insert into factures_emises (dossier_id, type, statut, numero, date_emission, validated_at, tiers_nom, mentions_figees, numero_tva_attribue, parametres_id, iban_imprime)
           values ('{DR}', 'facture', 'validee', 'F2026-0008', '2026-10-01', now(), 'ESSAI A7 RESTAURÉ', true, false, '{V1}', 'FR9399999000010000000000100')$q$,
        '23514', '%"factures_emises_rib_imprime_entier"%', null),
      ('107', 'controle', 'la contrainte : un logo figé a son chemin et son empreinte', 'chef', null,
        $q$insert into factures_emises (dossier_id, type, statut, numero, date_emission, validated_at, tiers_nom, mentions_figees, numero_tva_attribue, parametres_id, logo_chemin)
           values ('{DR}', 'facture', 'validee', 'F2026-0008', '2026-10-01', now(), 'ESSAI A7 RESTAURÉ', true, false, '{V1}', 'x.png')$q$,
        '23514', '%"factures_emises_logo_imprime_entier"%', null),
      ('108', 'controle', 'la contrainte : un paramètre figé dit la version qui le porte', 'chef', null,
        $q$insert into factures_emises (dossier_id, type, statut, numero, date_emission, validated_at, tiers_nom, mentions_figees, numero_tva_attribue, escompte)
           values ('{DR}', 'facture', 'validee', 'F2026-0008', '2026-10-01', now(), 'ESSAI A7 RESTAURÉ', true, false, 'ESSAI A7')$q$,
        '23514', '%"factures_emises_parametres_figes"%', null),
      ('M9', 'mutation', 'le contrôle 101 rejoué dans le dossier sans compteur : la restauration passe', 'chef', null,
        $q$insert into factures_emises (dossier_id, type, statut, numero, date_emission, validated_at, tiers_nom, mentions_figees, numero_tva_attribue)
           values ('{DR}', 'facture', 'validee', 'F2026-0099', '2026-10-01', now(), 'ESSAI A7 RESTAURÉ', true, false) returning numero$q$, 'OK', 'F2026-0099', null),

      -- ══ 11. Une facture d'avant, et son avoir ══════════
      ('110', 'valeur', 'la facture d''avant n''a rien figé', 'proprietaire', null,
        $q$select mentions_figees || '|' || num_nonnulls(statut_tva, article_exoneration, numero_tva_attribue, numero_tva_imprime, denomination_imprimee,
               forme_juridique, capital, rcs_ville, mentions_identite, moyen_prefere, escompte, penalites, mentions_complementaires, pied_de_page,
               iban_imprime, bic_imprime, titulaire_imprime, logo_chemin, logo_sha256, parametres_id, rib_parametres_id, mandataire_nom, contact_id)
               || '|' || (select num_nonnulls(l.unite, l.reference, l.article_id, l.nature) from facture_lignes l where l.id = '{LD}')
             from factures_emises where id = '{FD}'$q$, 'OK', 'false|0|0', null),
      ('111', 'controle', 'et ne se fige pas après coup : la garde la tient', 'chef', null,
        $q$update factures_emises set mentions_figees = true, numero_tva_attribue = false, numero_tva_imprime = 'FR11123456782' where id = '{FD}'$q$,
        '23514', 'La facture F2026-0001 est validée : elle ne se modifie plus — la corriger passe par un avoir.', null),
      ('111b', 'controle', 'son avoir, l''identité du jour portant un IBAN : refusé — d''une facture d''avant, il fige tout du jour', 'chef', null,
        $q$update dossiers set mentions_identite = 'ESSAI A7 AUTRES MENTIONS FR13 9999 9000 0200 0000 0001 234' where id = '{DD}'
        §§ select f.numero from enregistrer_facture('{DD}', null, '{"type":"avoir","facture_origine_id":"{FD}","date_emission":"2026-10-20","montant_ht":-50,"montant_tva":-10,"montant_ttc":-60}'::jsonb,
             '[{"designation":"ESSAI A7 LIGNE D","quantite":-0.5,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans les autres mentions de l''identité du dossier : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('112', 'fait', 'son avoir, par le cabinet', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DD}', null, '{"type":"avoir","facture_origine_id":"{FD}","date_emission":"2026-10-20","montant_ht":-50,"montant_tva":-10,"montant_ttc":-60}'::jsonb,
             '[{"designation":"ESSAI A7 LIGNE D","quantite":-0.5,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true) f$q$, 'OK', null, 'AD'),
      ('113', 'valeur', '… fige tout du jour : le statut du dossier, le numéro du SIRET repris, le cabinet pour mandataire', 'proprietaire', null,
        $q$select concat_ws('|', numero, mentions_figees::text, statut_tva, numero_tva_attribue::text, coalesce(numero_tva_imprime, '-'), coalesce(denomination_imprimee, '-'),
               (mandataire_nom = (select c.nom from cabinets c where c.id = '{CAB}'))::text) from factures_emises where id = '{AD}'$q$,
        'OK', 'A2026-0001|true|redevable|false|FR11123456782|-|true', null),

      -- ══ 12. L'avoir d'une facture qui a figé ses mentions, le dossier changé depuis ══════════
      ('120', 'fait', 'le dossier A change de dénomination, d''autres mentions et de statut de TVA', 'proprietaire', null,
        $q$update dossiers set denomination_imprimee = 'ESSAI A7 DURAND EI', mentions_identite = null, statut_tva = 'franchise', assujetti_tva = false where id = '{DA}'$q$,
        'OK', null, null),
      ('121', 'fait', 'le client « Ventes » crée l''avoir de sa facture', 'client', 'ventes',
        $q$select f.facture_id::text from enregistrer_facture('{DA}', null, '{"type":"avoir","facture_origine_id":"{F1}","date_emission":"2026-10-21","montant_ht":-50,"montant_tva":-10,"montant_ttc":-60}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":-1,"prix_unitaire_ht":50,"taux_tva":20,"unite":"HUR","reference":"A7-REF-1","article_id":"{AA}","nature":"services"}]'::jsonb, true) f$q$,
        'OK', null, 'AV'),
      ('122', 'valeur', '… il reprend de sa facture le statut et le numéro de TVA, et l''identité qu''elle imprime', 'proprietaire', null,
        $q$select concat_ws('|', numero, mentions_figees::text, statut_tva, numero_tva_attribue::text, coalesce(numero_tva_imprime, '-'), denomination_imprimee, forme_juridique,
               coalesce(mentions_identite, '-')) from factures_emises where id = '{AV}'$q$,
        'OK', 'A2026-0001|true|redevable|false|FR11123456782|ESSAI A7 DUPONT EI|1000|ESSAI A7 RÉPERTOIRE DES MÉTIERS', null),
      ('123', 'valeur', '… il fige du jour les paramètres et le RIB, prend le contact de sa facture, et n''a pas de mandataire', 'proprietaire', null,
        $q$select concat_ws('|', (parametres_id = '{V2}')::text, (rib_parametres_id = '{V2}')::text, iban_imprime, coalesce(mandataire_nom, '-'),
               (contact_id = '{KA}')::text, source_de_la_vente::text) from factures_emises where id = '{AV}'$q$,
        'OK', 'true|true|FR9299999000010000000000700|-|true|true', null),
      ('M10', 'mutation', 'le contrôle 122 rejoué sur le dossier : ce qu''il dit aujourd''hui n''est pas ce que l''avoir a figé', 'proprietaire', null,
        $q$select concat_ws('|', statut_tva, denomination_imprimee) from dossiers where id = '{DA}'$q$, 'OK', 'franchise|ESSAI A7 DURAND EI', null),

      -- ══ 13. A7-Q2 : un accès « Ventes » ne valide que sous le SIRET et l'adresse du dossier (le dossier G) ══════════
      -- « Les mêmes » : le SIRET, ses blancs retirés où qu'ils soient ; l'adresse, ses fins de ligne ramenées et les blancs
      -- de ses bords retirés. Le cabinet n'est pas jugé ; un avoir reprend l'émetteur de sa facture.
      ('130', 'fait', 'le client « Ventes » valide sous le SIRET et l''adresse du dossier : la facture passe', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'OK', null, 'FG1'),
      ('131', 'valeur', '… elle fige l''émetteur du dossier, et n''a pas de mandataire', 'proprietaire', null,
        $q$select concat_ws('|', numero, emetteur_siret, emetteur_adresse, coalesce(mandataire_nom, '-')) from factures_emises where id = '{FG1}'$q$,
        'OK', 'F2026-0001|12345678200010|ESSAI A7 ADRESSE G|-', null),
      ('132', 'controle', 'le même SIRET écrit en groupes, l''adresse entourée de blancs et d''une fin de ligne Windows : la facture passe', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"123 456 782 00010","emetteur_adresse":" ESSAI A7 ADRESSE G\r\n","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'OK', 'F2026-%', null),
      ('133', 'controle', 'un autre SIRET : refusé', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"10000020700015","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Le SIRET de l''émetteur n''est pas celui du dossier : une facture validée depuis l''espace client porte le SIRET que le cabinet a renseigné.', null),
      ('134', 'controle', 'aucun SIRET d''émetteur : refusé', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Le SIRET de l''émetteur n''est pas celui du dossier : une facture validée depuis l''espace client porte le SIRET que le cabinet a renseigné.', null),
      ('135', 'controle', 'une autre adresse : refusée', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 AUTRE ADRESSE","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'L''adresse de l''émetteur n''est pas celle du dossier : une facture validée depuis l''espace client porte l''adresse que le cabinet a renseignée.', null),
      ('136', 'controle', 'aucune adresse d''émetteur : refusée', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'L''adresse de l''émetteur n''est pas celle du dossier : une facture validée depuis l''espace client porte l''adresse que le cabinet a renseignée.', null),
      ('137', 'controle', 'l''adresse changée en son milieu, deux espaces au lieu d''un : refusée', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7  ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'L''adresse de l''émetteur n''est pas celle du dossier : une facture validée depuis l''espace client porte l''adresse que le cabinet a renseignée.', null),
      ('138', 'controle', 'l''ordre : un autre SIRET et une autre adresse, le SIRET d''abord', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"10000020700015","emetteur_adresse":"ESSAI A7 AUTRE ADRESSE","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Le SIRET de l''émetteur n''est pas celui du dossier : une facture validée depuis l''espace client porte le SIRET que le cabinet a renseigné.', null),
      ('139', 'controle', 'un brouillon, lui, s''enregistre sous un autre émetteur', 'client', null,
        $q$select (f.numero is null)::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"10000020700015","emetteur_adresse":"ESSAI A7 AUTRE ADRESSE","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        'OK', 'true', null),
      ('M13', 'mutation', 'le contrôle 133 rejoué par le cabinet : il valide sous un autre SIRET', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"10000020700015","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'OK', 'F2026-%', null),
      ('M14', 'mutation', 'le contrôle 135 rejoué par le cabinet : il valide sous une autre adresse', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 AUTRE ADRESSE","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'OK', 'F2026-%', null),
      ('140', 'fait', 'le cabinet valide une facture sous une autre adresse que celle du dossier', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 AUTRE ADRESSE","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'OK', null, 'FGX'),
      ('141', 'controle', 'son avoir, par le client « Ventes » : il reprend l''émetteur de sa facture, que rien ne rejuge', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"type":"avoir","date_emission":"2026-10-23","montant_ht":-10,"montant_tva":-2,"montant_ttc":-12,"facture_origine_id":"{FGX}"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'OK', 'A2026-%', null),
      ('142', 'fait', 'le dossier G perd son adresse : il ne lui reste que des blancs', 'proprietaire', null,
        $q$update dossiers set adresse = E' \n\t' where id = '{DG}'$q$,
        'OK', null, null),
      ('143', 'controle', 'sans adresse, le client « Ventes » ne valide pas, même en en donnant une', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'L''adresse du dossier n''est pas renseignée : le cabinet la renseigne avant qu''une facture se valide depuis l''espace client.', null),
      ('143b', 'controle', 'l''ordre : sans adresse, un autre SIRET — le SIRET d''abord', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"10000020700015","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Le SIRET de l''émetteur n''est pas celui du dossier : une facture validée depuis l''espace client porte le SIRET que le cabinet a renseigné.', null),
      ('144', 'controle', 'un brouillon, lui, s''enregistre', 'client', null,
        $q$select (f.numero is null)::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        'OK', 'true', null),
      ('M15', 'mutation', 'le contrôle 143 rejoué par le cabinet : il valide', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'OK', 'F2026-%', null),
      ('145', 'fait', 'le dossier G retrouve son adresse et perd son SIRET', 'proprietaire', null,
        $q$update dossiers set adresse = 'ESSAI A7 ADRESSE G', siret = null where id = '{DG}'$q$,
        'OK', null, null),
      ('146', 'controle', 'sans SIRET, le client « Ventes » ne valide pas', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Le SIRET du dossier n''est pas renseigné : le cabinet le renseigne avant qu''une facture se valide depuis l''espace client.', null),
      ('M16', 'mutation', 'le contrôle 146 rejoué par le cabinet : il valide', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'OK', 'F2026-%', null),
      ('147', 'fait', 'le dossier G perd aussi son adresse', 'proprietaire', null,
        $q$update dossiers set adresse = null where id = '{DG}'$q$,
        'OK', null, null),
      ('148', 'controle', 'l''ordre : sans SIRET ni adresse, le SIRET d''abord', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Le SIRET du dossier n''est pas renseigné : le cabinet le renseigne avant qu''une facture se valide depuis l''espace client.', null),
      ('149', 'fait', 'le dossier G perd aussi sa forme juridique', 'proprietaire', null,
        $q$update dossiers set forme_juridique = null where id = '{DG}'$q$,
        'OK', null, null),
      ('149b', 'controle', 'l''ordre : sans forme, ni SIRET, ni adresse, la forme d''abord (A7-Q1)', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'La forme juridique du dossier n''est pas renseignée : l''identité légale qu''une facture imprime est à régler par le cabinet avant qu''une facture se valide depuis l''espace client.', null),
      ('149c', 'fait', 'le dossier G retrouve sa forme, son SIRET et son adresse', 'proprietaire', null,
        $q$update dossiers set forme_juridique = '1000', siret = '12345678200010', adresse = 'ESSAI A7 ADRESSE G' where id = '{DG}'$q$,
        'OK', null, null),
      ('149d', 'fait', 'le SIRET de G écrit en groupes, un blanc insécable compris ; son adresse sur trois lignes, une fin de ligne Windows puis un retour chariot seul, un blanc et une fin de ligne au bout', 'proprietaire', null,
        $q$update dossiers set siret = '123 456 782' || chr(160) || '00010',
             adresse = 'ESSAI A7 ADRESSE G' || chr(13) || chr(10) || 'ESSAI A7 SECONDE LIGNE G' || chr(13) || 'ESSAI A7 TROISIÈME LIGNE G ' || chr(13) || chr(10) where id = '{DG}'$q$,
        'OK', null, null),
      ('149e', 'controle', 'le client « Ventes » valide sous ce SIRET sans ses blancs, et cette adresse, ses lignes séparées d''un retour chariot seul puis d''une fin de ligne : la facture passe', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G\rESSAI A7 SECONDE LIGNE G\nESSAI A7 TROISIÈME LIGNE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'OK', 'F2026-%', null),
      ('149e2', 'controle', 'ses lignes séparées de fins de ligne Windows : la facture passe', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G\r\nESSAI A7 SECONDE LIGNE G\r\nESSAI A7 TROISIÈME LIGNE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'OK', 'F2026-%', null),
      ('149f', 'controle', 'la même adresse sur une seule ligne : refusée — une fin de ligne n''est pas un espace', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G ESSAI A7 SECONDE LIGNE G ESSAI A7 TROISIÈME LIGNE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'L''adresse de l''émetteur n''est pas celle du dossier : une facture validée depuis l''espace client porte l''adresse que le cabinet a renseignée.', null),
      ('149g', 'fait', 'le SIRET de G n''est plus que des blancs', 'proprietaire', null,
        $q$update dossiers set siret = ' ' || chr(160) || chr(9) where id = '{DG}'$q$,
        'OK', null, null),
      ('149h', 'controle', 'un SIRET de blancs n''est pas un SIRET : le client « Ventes » ne valide pas', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G\nESSAI A7 SECONDE LIGNE G\nESSAI A7 TROISIÈME LIGNE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Le SIRET du dossier n''est pas renseigné : le cabinet le renseigne avant qu''une facture se valide depuis l''espace client.', null),
      ('149i', 'fait', 'le dossier G retrouve son SIRET et son adresse d''une ligne', 'proprietaire', null,
        $q$update dossiers set siret = '12345678200010', adresse = 'ESSAI A7 ADRESSE G' where id = '{DG}'$q$,
        'OK', null, null),

      -- ══ 14. A7-Q3 : un IBAN dans un texte libre que la facture imprime, à chaque enregistrement et pour tout auteur ══════════
      ('150', 'controle', 'un IBAN dans le nom de l''émetteur : le cabinet n''enregistre pas le brouillon', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G, IBAN FR13 9999 9000 0200 0000 0001 234","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le nom de l''émetteur : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('151', 'controle', 'un IBAN dans l''adresse de l''émetteur : le cabinet n''enregistre pas le brouillon', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G\nIBAN FR13 9999 9000 0200 0000 0001 234","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans l''adresse de l''émetteur : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('152', 'controle', 'un IBAN dans le SIRET de l''émetteur : le cabinet n''enregistre pas le brouillon', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"FR1399999000020000000001234","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le SIRET de l''émetteur : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('153', 'controle', 'un IBAN dans le nom du client : le cabinet n''enregistre pas le brouillon', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G FR13 9999 9000 0200 0000 0001 234","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le nom du client : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('154', 'controle', 'un IBAN dans l''adresse du client : le cabinet n''enregistre pas le brouillon', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"tiers_adresse":"ESSAI A7 ADRESSE CLIENT, fr1399999000020000000001234"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans l''adresse du client : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('155', 'controle', 'un IBAN dans le SIRET du client : le cabinet n''enregistre pas le brouillon', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"tiers_siret":"FR1399999000020000000001234"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le SIRET du client : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('156', 'controle', 'un IBAN dans l''adresse de livraison : le cabinet n''enregistre pas le brouillon', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"biens","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"livraison_adresse":"ESSAI A7 VOIE FR13 9999 9000 0200 0000 0001 234","livraison_code_postal":"69001","livraison_ville":"ESSAI A7 VILLE","livraison_pays":"FR"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans l''adresse de livraison : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('157', 'controle', 'un IBAN dans le code postal de livraison : le cabinet n''enregistre pas le brouillon', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"biens","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"livraison_adresse":"ESSAI A7 VOIE","livraison_code_postal":"FR1399999000020000000001234","livraison_ville":"ESSAI A7 VILLE","livraison_pays":"FR"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le code postal de livraison : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('158', 'controle', 'un IBAN dans la ville de livraison : le cabinet n''enregistre pas le brouillon', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"biens","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"livraison_adresse":"ESSAI A7 VOIE","livraison_code_postal":"69001","livraison_ville":"ESSAI A7 VILLE FR13 9999 9000 0200 0000 0001 234","livraison_pays":"FR"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans la ville de livraison : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('159', 'controle', 'un IBAN dans le code service : le cabinet n''enregistre pas le brouillon', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"organisme_public","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"code_service":"FR1399999000020000000001234"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le code service : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('160', 'controle', 'un IBAN dans le numéro d''engagement : le cabinet n''enregistre pas le brouillon', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"numero_engagement":"FR13 9999 9000 0200 0000 0001 234"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le numéro d''engagement : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('161', 'controle', 'un IBAN dans la mention légale : le cabinet n''enregistre pas le brouillon', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"mentions_legales":"Règlement par virement : fr13 9999 9000 0200 0000 0001 234."}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans la mention légale : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('162', 'controle', 'un IBAN dans la désignation de la ligne 1 : le cabinet n''enregistre pas le brouillon', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE, à régler sur FR13 9999 9000 0200 0000 0001 234","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans la désignation de la ligne 1 : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('163', 'controle', 'un IBAN dans la référence de la ligne 1 : le cabinet n''enregistre pas le brouillon', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"reference":"FR1399999000020000000001234"}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans la référence de la ligne 1 : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('164', 'controle', 'un IBAN dans le nom de l''émetteur : le client « Ventes » n''enregistre pas le brouillon', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G, IBAN FR13 9999 9000 0200 0000 0001 234","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le nom de l''émetteur : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('165', 'controle', 'un IBAN dans l''adresse de l''émetteur : le client « Ventes » n''enregistre pas le brouillon', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G\nIBAN FR13 9999 9000 0200 0000 0001 234","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans l''adresse de l''émetteur : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('166', 'controle', 'un IBAN dans le SIRET de l''émetteur : le client « Ventes » n''enregistre pas le brouillon', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"FR1399999000020000000001234","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le SIRET de l''émetteur : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('167', 'controle', 'un IBAN dans le nom du client : le client « Ventes » n''enregistre pas le brouillon', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G FR13 9999 9000 0200 0000 0001 234","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le nom du client : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('168', 'controle', 'un IBAN dans l''adresse du client : le client « Ventes » n''enregistre pas le brouillon', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"tiers_adresse":"ESSAI A7 ADRESSE CLIENT, fr1399999000020000000001234"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans l''adresse du client : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('169', 'controle', 'un IBAN dans le SIRET du client : le client « Ventes » n''enregistre pas le brouillon', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"tiers_siret":"FR1399999000020000000001234"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le SIRET du client : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('170', 'controle', 'un IBAN dans l''adresse de livraison : le client « Ventes » n''enregistre pas le brouillon', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"biens","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"livraison_adresse":"ESSAI A7 VOIE FR13 9999 9000 0200 0000 0001 234","livraison_code_postal":"69001","livraison_ville":"ESSAI A7 VILLE","livraison_pays":"FR"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans l''adresse de livraison : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('171', 'controle', 'un IBAN dans le code postal de livraison : le client « Ventes » n''enregistre pas le brouillon', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"biens","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"livraison_adresse":"ESSAI A7 VOIE","livraison_code_postal":"FR1399999000020000000001234","livraison_ville":"ESSAI A7 VILLE","livraison_pays":"FR"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le code postal de livraison : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('172', 'controle', 'un IBAN dans la ville de livraison : le client « Ventes » n''enregistre pas le brouillon', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"biens","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"livraison_adresse":"ESSAI A7 VOIE","livraison_code_postal":"69001","livraison_ville":"ESSAI A7 VILLE FR13 9999 9000 0200 0000 0001 234","livraison_pays":"FR"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans la ville de livraison : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('173', 'controle', 'un IBAN dans le code service : le client « Ventes » n''enregistre pas le brouillon', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"organisme_public","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"code_service":"FR1399999000020000000001234"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le code service : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('174', 'controle', 'un IBAN dans le numéro d''engagement : le client « Ventes » n''enregistre pas le brouillon', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"numero_engagement":"FR13 9999 9000 0200 0000 0001 234"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le numéro d''engagement : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('175', 'controle', 'un IBAN dans la mention légale : le client « Ventes » n''enregistre pas le brouillon', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"mentions_legales":"Règlement par virement : fr13 9999 9000 0200 0000 0001 234."}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans la mention légale : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('176', 'controle', 'un IBAN dans la désignation de la ligne 1 : le client « Ventes » n''enregistre pas le brouillon', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE, à régler sur FR13 9999 9000 0200 0000 0001 234","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans la désignation de la ligne 1 : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('177', 'controle', 'un IBAN dans la référence de la ligne 1 : le client « Ventes » n''enregistre pas le brouillon', 'client', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"reference":"FR1399999000020000000001234"}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans la référence de la ligne 1 : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('178', 'controle', 'à la validation aussi : un IBAN dans la mention légale', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"mentions_legales":"Règlement : FR13 9999 9000 0200 0000 0001 234"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans la mention légale : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('179', 'controle', 'un IBAN à clé fausse dans la mention légale : il ne se lit pas, le brouillon s''enregistre', 'chef', null,
        $q$select (f.numero is null)::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"mentions_legales":"Règlement : FR14 9999 9000 0200 0000 0001 234"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        'OK', 'true', null),
      ('180', 'controle', 'l''ordre : le nom de l''émetteur avant la mention légale', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G FR1399999000020000000001234","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"mentions_legales":"Règlement : FR13 9999 9000 0200 0000 0001 234"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans le nom de l''émetteur : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('181', 'controle', 'l''ordre : la référence de la ligne 1 avant la désignation de la ligne 2', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"reference":"FR1399999000020000000001234"},{"designation":"ESSAI A7 FR13 9999 9000 0200 0000 0001 234","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans la référence de la ligne 1 : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('182', 'controle', 'l''ordre : les lignes avant la mention légale', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"mentions_legales":"Règlement : FR13 9999 9000 0200 0000 0001 234"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20},{"designation":"ESSAI A7 FR13 9999 9000 0200 0000 0001 234","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans la désignation de la ligne 2 : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('183', 'controle', 'l''ordre : la provenance des lignes d''abord', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 FR13 9999 9000 0200 0000 0001 234","quantite":1,"prix_unitaire_ht":10,"taux_tva":20,"unite":"XYZ"}]'::jsonb, false) f$q$,
        '22023', 'Ligne 1 : l''unité n''est pas de la liste des unités admises.', null),
      ('184', 'fait', 'le cabinet crée un brouillon de biens livrés ailleurs', 'chef', null,
        $q$select f.facture_id::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"biens","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"livraison_adresse":"ESSAI A7 VOIE","livraison_code_postal":"69001","livraison_ville":"ESSAI A7 VILLE","livraison_pays":"FR"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        'OK', null, 'FGB'),
      ('185', 'controle', 'un IBAN posé en direct sur la ville de livraison du brouillon, que l''appel ne nomme pas : la base le garde, et le refuse', 'chef', null,
        $q$update factures_emises set livraison_ville = 'ESSAI A7 VILLE FR13 9999 9000 0200 0000 0001 234' where id = '{FGB}'
        §§ select f.facture_id::text from enregistrer_facture('{DG}', '{FGB}', '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"biens","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        '22023', 'Un IBAN figure dans la ville de livraison : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('M17', 'mutation', 'le contrôle 185 rejoué, l''appel nommant l''adresse de livraison : il la remplace, le brouillon s''enregistre', 'chef', null,
        $q$update factures_emises set livraison_ville = 'ESSAI A7 VILLE FR13 9999 9000 0200 0000 0001 234' where id = '{FGB}'
        §§ select f.facture_id::text from enregistrer_facture('{DG}', '{FGB}', '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"biens","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12,"livraison_adresse":"ESSAI A7 VOIE","livraison_code_postal":"69001","livraison_ville":"ESSAI A7 VILLE","livraison_pays":"FR"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        'OK', null, null),
      ('186', 'controle', 'l''avoir de la facture du client, un IBAN dans sa mention légale : refusé', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"type":"avoir","date_emission":"2026-10-23","montant_ht":-10,"montant_tva":-2,"montant_ttc":-12,"facture_origine_id":"{FG1}","mentions_legales":"Remboursé sur FR13 9999 9000 0200 0000 0001 234"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans la mention légale : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('187', 'controle', 'l''avoir, un IBAN dans la désignation de sa ligne : refusé', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"type":"avoir","date_emission":"2026-10-23","montant_ht":-10,"montant_tva":-2,"montant_ttc":-12,"facture_origine_id":"{FG1}"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE FR1399999000020000000001234","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans la désignation de la ligne 1 : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('M18', 'mutation', 'les contrôles 186 et 187 rejoués sans IBAN : l''avoir se crée', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"type":"avoir","date_emission":"2026-10-23","montant_ht":-10,"montant_tva":-2,"montant_ttc":-12,"facture_origine_id":"{FG1}"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'OK', 'A2026-%', null),

      -- ══ 15. A7-Q3 à la validation : l'identité du dossier et les paramètres en vigueur, que la facture figerait ══════════
      -- Une version « d'avant la petite migration » : posée par le propriétaire, que la fonction de la migration
      -- iban_hors_des_parametres refuserait ; l'essai se joue ainsi avec ou sans elle.
      ('190', 'fait', 'une version des paramètres de G d''avant la petite migration : un IBAN dans son pied de page', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, remplace_id, delai_paiement_jours, moyen_prefere, pied_de_page, iban, bic,
             titulaire_compte, rib_etat, rib_confirme_par, rib_confirme_le, auteur) values
          ('{VG2}', '{DG}', '{VG1}', 30, 'virement', 'ESSAI A7 PIED G, IBAN FR13 9999 9000 0200 0000 0001 234', 'FR9399999000010000000000100', 'ESSAFR10',
           'ESSAI A7 TITULAIRE G', 'confirme', '{CHEF}', now(), '{CHEF}')$q$,
        'OK', null, null),
      ('191', 'controle', 'le client « Ventes » ne valide pas : la facture figerait ce pied de page', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans le pied de page des paramètres de facturation : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('192', 'controle', 'ni le cabinet', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans le pied de page des paramètres de facturation : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('193', 'controle', 'un brouillon, lui, s''enregistre', 'client', null,
        $q$select (f.numero is null)::text from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) f$q$,
        'OK', 'true', null),
      ('194', 'controle', 'ni un avoir, qui fige les paramètres du jour', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"type":"avoir","date_emission":"2026-10-23","montant_ht":-10,"montant_tva":-2,"montant_ttc":-12,"facture_origine_id":"{FG1}"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans le pied de page des paramètres de facturation : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('195', 'fait', 'le client « Ventes » enregistre une version sans IBAN, qui la remplace', 'client', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DG}', '{VG2}', '{"delai_paiement_jours":30,"moyen_prefere":"virement","pied_de_page":"ESSAI A7 PIED G2"}'::jsonb) p$q$,
        'OK', null, 'VG3'),
      ('196', 'controle', 'la facture se valide', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'OK', 'F2026-%', null),
      ('197', 'fait', 'une autre version d''avant : un IBAN dans ses conditions d''escompte et dans son pied de page', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, remplace_id, delai_paiement_jours, escompte, pied_de_page, auteur) values
          ('{VG4}', '{DG}', '{VG3}', 30, 'Escompte versé sur FR13 9999 9000 0200 0000 0001 234', 'ESSAI A7 PIED G, IBAN FR1399999000020000000001234', '{CHEF}')$q$,
        'OK', null, null),
      ('198', 'controle', 'l''ordre : l''escompte avant le pied de page', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans les conditions d''escompte des paramètres de facturation : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('199', 'fait', 'les autres mentions de l''identité de G portent un IBAN', 'proprietaire', null,
        $q$update dossiers set mentions_identite = 'ESSAI A7 RÉPERTOIRE DES MÉTIERS, IBAN FR13 9999 9000 0200 0000 0001 234' where id = '{DG}'$q$,
        'OK', null, null),
      ('200', 'controle', 'l''ordre : l''identité avant les paramètres', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans les autres mentions de l''identité du dossier : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('M19', 'mutation', 'le contrôle 200 rejoué sous une identité sans IBAN : ce sont alors les paramètres qui refusent', 'chef', null,
        $q$update dossiers set mentions_identite = 'ESSAI A7 RÉPERTOIRE DES MÉTIERS' where id = '{DG}'
        §§ select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans les conditions d''escompte des paramètres de facturation : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('201', 'controle', 'l''avoir d''une facture qui a figé son identité ne la rejuge pas : seuls les paramètres du jour refusent', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"type":"avoir","date_emission":"2026-10-23","montant_ht":-10,"montant_tva":-2,"montant_ttc":-12,"facture_origine_id":"{FG1}"}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans les conditions d''escompte des paramètres de facturation : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('202', 'fait', 'une autre version d''avant : un IBAN dans ses pénalités de retard seules ; l''identité de G sans IBAN', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, remplace_id, delai_paiement_jours, penalites, auteur) values
          ('{VG5}', '{DG}', '{VG4}', 30, 'Pénalités dues sur FR13 9999 9000 0200 0000 0001 234', '{CHEF}')
        §§ update dossiers set mentions_identite = null where id = '{DG}'$q$,
        'OK', null, null),
      ('203', 'controle', 'à la validation, les pénalités de retard', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans les pénalités de retard des paramètres de facturation : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('204', 'fait', 'une autre version d''avant : un IBAN dans ses mentions complémentaires seules', 'proprietaire', null,
        $q$insert into parametres_facturation (id, dossier_id, remplace_id, delai_paiement_jours, mentions_complementaires, auteur) values
          ('{VG6}', '{DG}', '{VG5}', 30, 'Coordonnées : FR1399999000020000000001234', '{CHEF}')$q$,
        'OK', null, null),
      ('204b', 'controle', 'à la validation, les mentions complémentaires', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans les mentions complémentaires des paramètres de facturation : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('204c', 'fait', 'une version sans IBAN, par le cabinet ; un IBAN dans la dénomination de G, qui garde « EI »', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DG}', '{VG6}', '{"delai_paiement_jours":30,"pied_de_page":"ESSAI A7 PIED G3"}'::jsonb) p
        §§ update dossiers set denomination_imprimee = 'ESSAI A7 GARNIER EI FR13 9999 9000 0200 0000 0001 234' where id = '{DG}'$q$,
        'OK', null, null),
      ('204d', 'controle', 'à la validation, la dénomination du dossier', 'client', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans la dénomination du dossier : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('204e', 'fait', 'la dénomination de G sans IBAN ; un IBAN dans la ville de son greffe', 'chef', null,
        $q$update dossiers set denomination_imprimee = 'ESSAI A7 GARNIER EI', rcs_ville = 'Lyon FR1399999000020000000001234' where id = '{DG}'$q$,
        'OK', null, null),
      ('204f', 'controle', 'à la validation, la ville du greffe du dossier', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DG}', null, '{"tiers_nom":"ESSAI A7 CLIENT G","type_client":"assujetti","nature_operation":"services","date_emission":"2026-10-22","emetteur_nom":"ESSAI A7 G","emetteur_siret":"12345678200010","emetteur_adresse":"ESSAI A7 ADRESSE G","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"ESSAI A7 SÉANCE","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans la ville du greffe du dossier : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),

      -- ══ 16. La restauration réinsère tel quel ce qu'une sauvegarde porte (A7-Q3) ══════════
      ('210', 'fait', 'le super-administrateur réinsère, dans un dossier sans compteur, une facture figée dont la mention légale, l''adresse du client et les autres mentions de l''identité figée portent un IBAN, et sa ligne', 'chef', null,
        $q$insert into factures_emises (id, dossier_id, type, statut, numero, date_emission, validated_at, tiers_nom, tiers_adresse, montant_ht,
             montant_tva, montant_ttc, mentions_figees, numero_tva_attribue, mentions_legales, mentions_identite)
           values ('{FRI}', '{DR}', 'facture', 'validee', 'F2026-0011', '2026-10-01', now(), 'ESSAI A7 RESTAURÉ', 'ESSAI A7 ADRESSE FR13 9999 9000 0200 0000 0001 234',
             10, 2, 12, true, false, 'Règlement sur FR1399999000020000000001234', 'ESSAI A7 AUTRES MENTIONS FR13 9999 9000 0200 0000 0001 234')
        §§ insert into facture_lignes (id, facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva)
           values ('{LRI}', '{FRI}', 0, 'ESSAI A7 LIGNE FR13 9999 9000 0200 0000 0001 234', 1, 10, 20)$q$,
        'OK', null, null),
      ('211', 'controle', 'son avoir, par le cabinet : il ne rejuge ni les textes qu''il recopie, ni l''identité qu''il reprend', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DR}', null, '{"type":"avoir","date_emission":"2026-10-23","montant_ht":-10,"montant_tva":-2,"montant_ttc":-12,"facture_origine_id":"{FRI}"}'::jsonb,
             '[{"designation":"ESSAI A7 LIGNE","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'OK', 'A2026-%', null),
      ('212', 'fait', 'le super-administrateur réinsère une version des paramètres de R dont le pied de page porte un IBAN', 'chef', null,
        $q$insert into parametres_facturation (id, dossier_id, delai_paiement_jours, pied_de_page, auteur) values
          ('{VR}', '{DR}', 30, 'ESSAI A7 PIED R, IBAN FR13 9999 9000 0200 0000 0001 234', '{CHEF}')$q$,
        'OK', null, null),
      ('213', 'valeur', '… les textes réinsérés tels quels', 'proprietaire', null,
        $q$select concat_ws('|', public.porte_un_iban(f.mentions_legales)::text, public.porte_un_iban(f.tiers_adresse)::text,
               public.porte_un_iban(f.mentions_identite)::text,
               (select public.porte_un_iban(l.designation)::text from facture_lignes l where l.id = '{LRI}'),
               (select public.porte_un_iban(p.pied_de_page)::text from parametres_facturation p where p.id = '{VR}'))
             from factures_emises f where f.id = '{FRI}'$q$,
        'OK', 'true|true|true|true|true', null),
      ('214', 'controle', 'une facture du dossier R ne se valide plus sous ces paramètres', 'chef', null,
        $q$select f.numero from enregistrer_facture('{DR}', null, '{"tiers_nom":"ESSAI A7 R","date_emission":"2026-10-21","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        '22023', 'Un IBAN figure dans le pied de page des paramètres de facturation : sur une facture, un IBAN ne s''imprime que dans le RIB des paramètres de facturation, confirmé par le cabinet.', null),
      ('M20', 'mutation', 'le contrôle 214 rejoué après une version sans IBAN, par la fonction : la facture se valide', 'chef', null,
        $q$select p.id::text from public.enregistrer_parametres_facturation('{DR}', '{VR}', '{"pied_de_page":"ESSAI A7 PIED R2"}'::jsonb) p
        §§ select f.numero from enregistrer_facture('{DR}', null, '{"tiers_nom":"ESSAI A7 R","date_emission":"2026-10-21","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb,
             '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) f$q$,
        'OK', 'F2026-%', null)
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
    ((select count(*) from parametres_facturation)), ((select count(*) from contacts)), ((select count(*) from articles)),
    ((select count(*) from cabinets))
  ) as t(n);
  -- L'écart seul, non plus les comptes de toute la base, qui diraient le volume d'un dossier réel (audit du 29/10/2026).
  verdicts := verdicts || jsonb_build_object('controle', '999. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)), 'ok', erreur is null and avant = apres);
  perform set_config('essai.mentions_figees', verdicts::text, true);
end
$essai$;

select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                 else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
from jsonb_to_recordset(current_setting('essai.mentions_figees')::jsonb) as v(controle text, genre text, ok boolean, observe text)
order by v.genre desc, coalesce((regexp_match(v.controle, '^M?(\d+)'))[1]::int, 0), v.controle;
