-- LA VALIDATION D'UN EXERCICE, ÉPROUVÉE EN BASE — à rejouer par `execute_sql` après toute migration qui
-- touche `valider_exercice`, `verifier_exercice_valide`, `empreinte_exercice`, `exercice_fige`, l'un des
-- déclencheurs qui figent un exercice validé (`garder_*`), la table `exercices_valides` ou les contraintes
-- d'`ecritures_brouillon` (ligne 26.6 de la feuille de route, étape d). Le détail du report des soldes sur
-- l'exercice suivant (ligne 34) vit dans `reportDesSoldes.sql` ; celui-ci en vérifie le montant sur ses dossiers.
--
-- Valider un exercice fige ses écritures — numérotées dans leur journal, avec ce que le FEC lit —, enregistre
-- son empreinte chaînée à celle de l'exercice validé précédent et, en trésorerie, la 2035 telle qu'elle a été
-- validée ; tout ce qui a produit ces écritures est figé avec elles, jusqu'au 31 décembre du dernier exercice
-- validé (la frontière). Ce qui se prouve ici, et ne se relit pas :
--   - QUI valide : un anonyme n'a pas le droit d'appeler ; un compte rattaché à rien, un client — sur le
--     dossier d'un autre comme sur le SIEN —, un membre assigné au dossier et le chef d'un AUTRE cabinet se
--     font refuser ; le chef du cabinet valide (le contrôle POSITIF), et pas seulement parce qu'il est aussi
--     super-administrateur sur ce projet : le client, fait chef d'un cabinet jetable le temps de l'essai, valide
--     un dossier de ce cabinet-là ;
--   - CE QUI SE REFUSE, avec sa RAISON : un exercice invalide, en cours, déjà validé, sauté, antérieur à
--     l'ouverture ou postérieur à celui des à-nouveaux ; des écritures antérieures non validées — et, avant
--     l'ouverture, le conseil de les retirer ou de les redater, que l'essai suit ; un mouvement à traiter ; une
--     2035 absente en trésorerie, présente en engagement ; et chaque défaut d'une numérotation proposée — une
--     écriture à deux pièces ou à deux DATES comprise (24b, depuis le 05/10/2026) ;
--   - CE QUE LA VALIDATION ÉCRIT : les écritures validées, numérotées, avec leur pièce et le libellé de leur
--     compte ; l'exercice, ses totaux, sa 2035 et son auteur ; les libellés des à-nouveaux ; et, de
--     l'exercice suivant, son ouverture seule — les soldes de fin, reportés au centime (36b, 118b, 132b, 139b),
--     dont la validation suivante pose les libellés, faute de quoi elle se refuse ;
--   - L'INTANGIBILITÉ : une écriture validée ne change plus, même pour le propriétaire de la base ; aucune
--     écriture ne se passe avant la frontière, ni ne s'y valide à la main ; et le super-administrateur ne
--     réinsère une écriture validée que dans un dossier qui n'a encore aucun exercice validé — la restauration ;
--   - L'EMPREINTE : stable quand l'échelle d'un nombre change, elle voit une écriture ou un libellé
--     d'à-nouveau falsifiés hors déclencheur, et un maillon cassé se voit sur l'exercice suivant ;
--   - LES SOURCES FIGÉES : pièce, mouvement, part d'une ventilation ou d'un règlement groupé, bien, ligne du
--     cadre 7, échéance de cotisation et à-nouveaux — ce qui ne change plus, ce qui reste libre, et ce qui
--     ne s'ajoute plus ; une modification est jugée comme une insertion sur la frontière de SON dossier, y
--     compris quand elle fait changer une ligne de dossier ;
--   - LE REFUS DIT VRAI : une date antérieure au premier exercice validé est « figée par la validation de »
--     cet exercice, jamais « validée » ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer : les déclencheurs refusent aussi la SUPPRESSION et
--     laissent passer celle d'un dossier entier (la cascade ne voit plus le dossier), et les droits
--     d'exécution. Jouer une suppression demande une instruction que l'outil d'exécution soumet à une
--     confirmation de l'utilisateur : ces comportements-là sont éprouvés sur une réplique locale du schéma
--     (essais locaux de la session du 04/10/2026, 73 et 78 contrôles, et 24 mutations qui mordent toutes) et
--     seulement LUS ici — plus faible, et annoncé comme tel ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Tout se joue dans des dossiers JETABLES, créés dans le cabinet du dossier `test` (et un cabinet jetable),
-- au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`). Chaque contrôle s'y joue
-- dans sa propre sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001), le verdict étant posé dans
-- une VARIABLE avant — le mécanisme de rls.sql ; les étapes « fait » (une validation dont la suite a besoin)
-- sont gardées jusqu'à l'annulation finale. Un refus se juge à son code ET à son message. Les verdicts
-- voyagent dans un réglage LOCAL à la transaction (`essai.validation`), que la requête finale lit : le
-- fichier se joue d'un seul appel, ne crée aucune table et ne contient aucune instruction de suppression.
--
-- Les identifiants des lignes jetables sont FIXES (préfixe `e55a1000`), pour que les requêtes se lisent ; une
-- étape les désigne par leur nom entre accolades (`{A}`, `{M1}`), remplacé avant l'exécution. Hors de l'outil
-- d'exécution, le fichier se joue en UNE transaction (`psql -1`) : le réglage qui porte les verdicts est local
-- à la transaction, et il serait vide pour la requête finale si le bloc avait déjà été validé.
--
-- JOUÉ EN PRODUCTION LE 04/10/2026, juste après la migration `frontiere_de_la_validation` : 145 contrôles sur
-- 145, et 4/1/1/77/998/3/2/1/43/0/0/0 lignes avant comme après (dossiers, cabinets, chefs et membres, pièces,
-- mouvements, écritures, biens, véhicules, échéances, à-nouveaux, exercices validés, assignations). Le texte
-- transmis, sans ses lignes de commentaire, a été comparé au fichier : identique sur 418 lignes.
--
-- REJOUÉ EN PRODUCTION LE 05/10/2026, juste après la migration `une_ecriture_une_date` : 146 contrôles sur 146 —
-- le 24b compris, refusé par « Les lignes d'une même écriture ne portent pas la même date. » —, et
-- 4/1/1/77/998/3/2/1/43/0/0/0 lignes avant comme après. Le texte transmis, sans ses lignes de commentaire, est
-- identique au fichier sur 419 lignes. Sur la réplique, la fonction d'AVANT ne fait tomber que le 24b (accepté), et
-- quatre mutations de la règle — le compte des jours pris sur la date de pièce, la pièce nommée à la place de la
-- date, deux jours admis, la règle retirée — ne font tomber que lui ; rétablie, la fonction repasse les 146.
--
-- REJOUÉ EN PRODUCTION LE 07/10/2026, juste après la migration `report_des_soldes` (ligne 34) : 151 contrôles sur
-- 151 — les cinq nouveaux compris (36b, 117a, 118b, 132b, 139b : l'ouverture de l'exercice suivant, et la validation
-- suivante qui pose ses libellés ou se refuse sans eux) —, et 4/1/1/77/998/3/2/1/43/0/0/0/0 lignes avant comme après,
-- les soldes reportés comptés en dernier. Le texte transmis, sans ses lignes de commentaire, est identique au fichier
-- sur 452 lignes. Sur la réplique, les trente-cinq mutations de la migration, jouées avec `reportDesSoldes.sql`,
-- mordent toutes. Et le harnais a été corrigé au passage : un contrôle qui attend un succès, accepté sans être
-- annulé, rendait un verdict NUL — ni vert ni rouge, qu'un décompte des contrôles faux ne voit pas. Il rend désormais
-- faux (`coalesce`) : sans l'annulation de chaque contrôle, vingt-sept contrôles tombent, dont les vingt-deux qui
-- attendent un succès.
--
-- MIS AU POINT SUR UNE RÉPLIQUE LOCALE, ET MUTÉ AVANT D'ÊTRE CRU. Trente-quatre mutations, chacune jouée dans
-- la transaction de l'essai puis annulée, toutes mordent :
--   - le code TEL QU'IL ÉTAIT avant la migration corrective, fonction par fonction : chacun des sept
--     déclencheurs et la validation font tomber les contrôles qui les visent — le message « validé » d'une date
--     antérieure au premier exercice, la ligne venue d'un autre dossier, la date d'acquisition avancée, la pièce
--     déjà validée donnée pour facture, le conseil de retirer ou de redater ;
--   - vingt-deux mutations du cœur : toute date figée dite « validée », le chef remplacé par un membre assigné,
--     l'anonyme admis, un exercice en cours, un mouvement à traiter, un exercice sauté, des écritures antérieures, la
--     2035, l'équilibre, la couverture de la numérotation, une seconde validation, le super-administrateur qui insère
--     partout, l'empreinte sensible à l'échelle ou aveugle aux à-nouveaux, la vérification qui ignore le maillon, une
--     pièce figée tout entière, la banque qui ne réimporte plus, l'échéance datée à son échéance, la date de mise à
--     jour du cadre 7 comptée comme un changement, un déclencheur désactivé, la cascade qui ne passe plus, l'ouverture
--     qui se remplace ;
--   - quatre mutations du harnais : sans changement de rôle (les quatre contrôles qui dépendent de la RLS
--     tombent), sans annulation de chaque contrôle (vingt-cinq tombent), sans annulation finale (le dernier
--     tombe), et sans le message des refus : la mutation « toute date figée se dit validée » ne fait alors plus
--     tomber que le contrôle qui compare lui-même ses messages, au lieu de sept — c'est le message qui la voit.
-- Une mutation a d'abord SURVÉCU, et c'est l'essai qu'elle accusait : la « sauvegarde » d'une ligne du cadre 7
-- posait `updated_at = now()`, or `now()` vaut l'heure du début de la transaction, celle de l'insertion de la
-- ligne — elle ne changeait rien. Elle décale désormais la date d'une seconde.
-- La lecture de la cascade (141) est TEXTUELLE : elle cherche la condition telle qu'elle est écrite aujourd'hui,
-- et les versions d'avant, qui l'écrivaient avec une variable, la faisaient tomber sans manquer de l'exemption.
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  dossier_client uuid; cabinet uuid; categorie uuid;
  annee_courante int := extract(year from (now() at time zone 'Europe/Paris'))::int;
  ids jsonb;
  etapes text[];
  etape text[];
  cle text; valeur text; s text;
  accepte boolean; code_recu text; message text; obs text;
  avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  select m.dossier_id into dossier_client from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  select id into categorie from categories where dossier_id is null order by code limit 1;
  if dossier_client is null or cabinet is null or categorie is null or dossier_client = dossier_test
     or exists (select 1 from cabinet_admins where user_id = client)
     or not exists (select 1 from super_admins where user_id = chef) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'CAT', categorie, 'DC', dossier_client, 'CHEF', chef, 'CLIENT', client)
    || jsonb_build_object(
      'A', 'e55a1000-0000-4000-8000-0000000000a1', 'X', 'e55a1000-0000-4000-8000-0000000000a2',
      'F', 'e55a1000-0000-4000-8000-0000000000a3', 'G', 'e55a1000-0000-4000-8000-0000000000a4',
      'H', 'e55a1000-0000-4000-8000-0000000000a5', 'J1', 'e55a1000-0000-4000-8000-0000000000a6',
      'R', 'e55a1000-0000-4000-8000-0000000000a7', 'CJ', 'e55a1000-0000-4000-8000-0000000000c1',
      'P1', 'e55a1000-0000-4000-8001-000000000001', 'P2', 'e55a1000-0000-4000-8001-000000000002',
      'P3', 'e55a1000-0000-4000-8001-000000000003', 'P4', 'e55a1000-0000-4000-8001-000000000004')
    || jsonb_build_object(
      'M1', 'e55a1000-0000-4000-8002-000000000001', 'M2', 'e55a1000-0000-4000-8002-000000000002',
      'M3', 'e55a1000-0000-4000-8002-000000000003', 'M4', 'e55a1000-0000-4000-8002-000000000004',
      'M5', 'e55a1000-0000-4000-8002-000000000005', 'M6', 'e55a1000-0000-4000-8002-000000000006',
      'M7', 'e55a1000-0000-4000-8002-000000000007', 'M8', 'e55a1000-0000-4000-8002-000000000008',
      'M9', 'e55a1000-0000-4000-8002-000000000009', 'M10', 'e55a1000-0000-4000-8002-00000000000a',
      'XM24', 'e55a1000-0000-4000-8002-000000000021', 'XM25', 'e55a1000-0000-4000-8002-000000000022',
      'XMV', 'e55a1000-0000-4000-8002-000000000023', 'GM', 'e55a1000-0000-4000-8002-000000000031',
      'RM', 'e55a1000-0000-4000-8002-000000000041')
    || jsonb_build_object(
      'E1', 'e55a1000-0000-4000-8003-000000000001', 'E2', 'e55a1000-0000-4000-8003-000000000002',
      'E3', 'e55a1000-0000-4000-8003-000000000003', 'E4', 'e55a1000-0000-4000-8003-000000000004',
      'E5', 'e55a1000-0000-4000-8003-000000000005', 'E6', 'e55a1000-0000-4000-8003-000000000006',
      'E7', 'e55a1000-0000-4000-8003-000000000007', 'E8', 'e55a1000-0000-4000-8003-000000000008',
      'E9', 'e55a1000-0000-4000-8003-000000000009', 'E10', 'e55a1000-0000-4000-8003-00000000000a',
      'E11', 'e55a1000-0000-4000-8003-00000000000b', 'E12', 'e55a1000-0000-4000-8003-00000000000c',
      'E13', 'e55a1000-0000-4000-8003-00000000000d', 'E14', 'e55a1000-0000-4000-8003-00000000000e',
      'E15', 'e55a1000-0000-4000-8003-00000000000f', 'E16', 'e55a1000-0000-4000-8003-000000000010',
      'E17', 'e55a1000-0000-4000-8003-000000000011', 'XE24', 'e55a1000-0000-4000-8003-000000000021')
    || jsonb_build_object(
      'FE1', 'e55a1000-0000-4000-8003-000000000031', 'FE2', 'e55a1000-0000-4000-8003-000000000032',
      'GE1', 'e55a1000-0000-4000-8003-000000000041', 'GE2', 'e55a1000-0000-4000-8003-000000000042',
      'GE3', 'e55a1000-0000-4000-8003-000000000043', 'GE4', 'e55a1000-0000-4000-8003-000000000044',
      'VP1', 'e55a1000-0000-4000-8004-000000000001', 'VP2', 'e55a1000-0000-4000-8004-000000000002',
      'RG1', 'e55a1000-0000-4000-8004-000000000003', 'XVP', 'e55a1000-0000-4000-8004-000000000021',
      'B1', 'e55a1000-0000-4000-8005-000000000001', 'B2', 'e55a1000-0000-4000-8005-000000000002',
      'B3', 'e55a1000-0000-4000-8005-000000000003', 'XB24', 'e55a1000-0000-4000-8005-000000000021')
    || jsonb_build_object(
      'V1', 'e55a1000-0000-4000-8006-000000000001', 'V2', 'e55a1000-0000-4000-8006-000000000002',
      'XV24', 'e55a1000-0000-4000-8006-000000000021', 'XV25', 'e55a1000-0000-4000-8006-000000000022',
      'C1', 'e55a1000-0000-4000-8007-000000000001', 'C2', 'e55a1000-0000-4000-8007-000000000002',
      'XC24', 'e55a1000-0000-4000-8007-000000000021', 'XAN', 'e55a1000-0000-4000-8008-000000000021',
      'GAN1', 'e55a1000-0000-4000-8008-000000000031', 'GAN2', 'e55a1000-0000-4000-8008-000000000032',
      'HAN1', 'e55a1000-0000-4000-8008-000000000041', 'HAN2', 'e55a1000-0000-4000-8008-000000000042');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)),
    ((select count(*) from pieces)), ((select count(*) from lignes_bancaires)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from immobilisations)), ((select count(*) from vehicules)), ((select count(*) from cotisations_declarees)),
    ((select count(*) from a_nouveaux)), ((select count(*) from exercices_valides)), ((select count(*) from dossier_assignations)),
    ((select count(*) from soldes_reportes))
  ) as t(n);

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (motif LIKE) ou valeur attendue}.
  --   jeu     : posée par le propriétaire de la base, gardée ; un échec est une faute de l'essai lui-même ;
  --   controle: jouée sous « qui », puis annulée ; « OK » attend qu'elle passe ;
  --   fait    : jouée sous « qui » et GARDÉE jusqu'à l'annulation finale (une validation dont la suite a besoin) ;
  --   valeur  : une lecture par le propriétaire, qui doit rendre exactement la valeur attendue.
  etapes := array[
    -- ══ Le jeu : des dossiers jetables, dans le cabinet du dossier test et dans un cabinet jetable ═════════════════
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable) values
      ('{A}', 'ESSAI VALIDATION A', '{CAB}', 'tresorerie'), ('{X}', 'ESSAI VALIDATION X', '{CAB}', 'tresorerie'),
      ('{F}', 'ESSAI VALIDATION F', '{CAB}', 'engagement'), ('{G}', 'ESSAI VALIDATION G', '{CAB}', 'tresorerie'),
      ('{H}', 'ESSAI VALIDATION H', '{CAB}', 'tresorerie'), ('{R}', 'ESSAI VALIDATION R', '{CAB}', 'tresorerie')$q$, '', ''],
    array['jeu', 'cabinet jetable', 'postgres', $q$insert into cabinets (id, nom) values ('{CJ}', 'ESSAI VALIDATION CABINET')$q$, '', ''],
    array['jeu', 'son dossier', 'postgres', $q$insert into dossiers (id, nom, cabinet_id) values ('{J1}', 'ESSAI VALIDATION J1', '{CJ}')$q$, '', ''],
    array['jeu', 'pièces de A', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, statut, type_piece, montant_ttc, date_piece) values
      ('{P1}', '{A}', 'essai/validation/p1.pdf', 'essai-p1.pdf', 'validee', 'achat', 100, '2024-03-01'),
      ('{P2}', '{A}', 'essai/validation/p2.pdf', 'essai-p2.pdf', 'validee', 'achat', 30, '2025-02-01'),
      ('{P3}', '{A}', 'essai/validation/p3.pdf', 'essai-p3.pdf', 'validee', 'achat', 40, '2024-05-01'),
      ('{P4}', '{A}', 'essai/validation/p4.pdf', 'essai-p4.pdf', 'validee', 'achat', 1200, '2023-06-01')$q$, '', ''],
    array['jeu', 'échéances de A', 'postgres', $q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele) values
      ('{C1}', '{A}', '2024-03-01', 80), ('{C2}', '{A}', '2024-12-15', 80)$q$, '', ''],
    array['jeu', 'mouvements de A', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, piece_id, categorie_id, ventilee, reglement_groupe, cotisation_id, id_externe) values
      ('{M1}', '{A}', '2024-03-05', 'ESSAI PRLV P1', -100, 'rapprochee', '{P1}', null, false, false, null, null),
      ('{M2}', '{A}', '2024-04-10', 'ESSAI VIR CPAM', 50, 'rapprochee', null, '{CAT}', false, false, null, null),
      ('{M3}', '{A}', '2024-04-20', 'ESSAI CB VENTILEE', -60, 'rapprochee', null, null, true, false, null, null),
      ('{M4}', '{A}', '2024-05-10', 'ESSAI VIR GROUPE', -40, 'rapprochee', null, null, false, true, null, null),
      ('{M5}', '{A}', '2024-03-01', 'ESSAI URSSAF', -80, 'rapprochee', null, null, false, false, '{C1}', null),
      ('{M6}', '{A}', '2025-01-05', 'ESSAI URSSAF', -80, 'rapprochee', null, null, false, false, '{C2}', null),
      ('{M7}', '{A}', '2025-02-01', 'ESSAI PRLV P2', -30, 'non_rapprochee', null, null, false, false, null, null),
      ('{M8}', '{A}', '2024-06-15', 'ESSAI FRAIS', -2, 'ignoree', null, null, false, false, null, 'ESSAI-EXT-1'),
      ('{M9}', '{A}', '2024-06-01', 'ESSAI A TRAITER', -7, 'non_rapprochee', null, null, false, false, null, null),
      ('{M10}', '{A}', '2026-01-15', 'ESSAI PLUS TARD', -9, 'non_rapprochee', null, null, false, false, null, null)$q$, '', ''],
    array['jeu', 'ventilation de A', 'postgres', $q$insert into ventilations_bancaires (id, dossier_id, ligne_bancaire_id, categorie_id, part_personnelle, montant) values
      ('{VP1}', '{A}', '{M3}', '{CAT}', false, -42), ('{VP2}', '{A}', '{M3}', null, true, -18)$q$, '', ''],
    array['jeu', 'règlement groupé de A', 'postgres', $q$insert into reglements_groupes (id, dossier_id, ligne_bancaire_id, piece_id, montant) values ('{RG1}', '{A}', '{M4}', '{P3}', -40)$q$, '', ''],
    array['jeu', 'biens de A', 'postgres', $q$insert into immobilisations (id, dossier_id, piece_id, libelle, valeur, date_acquisition, duree_annees) values
      ('{B1}', '{A}', '{P4}', 'ESSAI Ordinateur', 1200, '2023-06-01', 3), ('{B2}', '{A}', null, 'ESSAI Bien de 2025', 900, '2025-09-01', 3),
      ('{B3}', '{A}', null, 'ESSAI Bien sans écriture', 300, '2024-02-01', 3)$q$, '', ''],
    array['jeu', 'cadre 7 de A', 'postgres', $q$insert into vehicules (id, dossier_id, annee, modele, km_professionnel, puissance_fiscale) values
      ('{V1}', '{A}', 2024, 'VÉHICULE ESSAI 2024', 1000, 5), ('{V2}', '{A}', 2025, 'VÉHICULE ESSAI 2025', 900, 5)$q$, '', ''],
    array['jeu', 'écritures de A', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, piece_id, ligne_bancaire_id, immobilisation_id, vehicule_id, date, compte, libelle, montant, sens) values
      ('{E1}', '{A}', '{P1}', null, null, null, '2024-03-05', '606100', 'ESSAI P1', 100, 'debit'),
      ('{E2}', '{A}', '{P1}', '{M1}', null, null, '2024-03-05', '512000', 'ESSAI P1', 100, 'credit'),
      ('{E3}', '{A}', null, '{M2}', null, null, '2024-04-10', '706000', 'ESSAI CPAM', 50, 'credit'),
      ('{E4}', '{A}', null, '{M2}', null, null, '2024-04-10', '512000', 'ESSAI CPAM', 50, 'debit'),
      ('{E5}', '{A}', null, '{M3}', null, null, '2024-04-20', '606100', 'ESSAI VENTILEE', 42, 'debit'),
      ('{E6}', '{A}', null, '{M3}', null, null, '2024-04-20', '108000', 'ESSAI VENTILEE', 18, 'debit'),
      ('{E7}', '{A}', null, '{M3}', null, null, '2024-04-20', '512000', 'ESSAI VENTILEE', 60, 'credit'),
      ('{E8}', '{A}', '{P3}', null, null, null, '2024-05-10', '606100', 'ESSAI P3', 40, 'debit'),
      ('{E9}', '{A}', '{P3}', '{M4}', null, null, '2024-05-10', '512000', 'ESSAI P3', 40, 'credit'),
      ('{E10}', '{A}', null, '{M5}', null, null, '2024-03-01', '646000', 'ESSAI URSSAF', 80, 'debit'),
      ('{E11}', '{A}', null, '{M5}', null, null, '2024-03-01', '512000', 'ESSAI URSSAF', 80, 'credit'),
      ('{E12}', '{A}', null, null, '{B1}', null, '2024-12-31', '681100', 'ESSAI DOTATION', 400, 'debit'),
      ('{E13}', '{A}', null, null, '{B1}', null, '2024-12-31', '281830', 'ESSAI DOTATION', 400, 'credit'),
      ('{E14}', '{A}', null, null, null, '{V1}', '2024-12-31', '625110', 'ESSAI FORFAIT', 529, 'debit'),
      ('{E15}', '{A}', null, null, null, '{V1}', '2024-12-31', '108000', 'ESSAI FORFAIT', 529, 'credit'),
      ('{E16}', '{A}', '{P2}', null, null, null, '2025-02-01', '606100', 'ESSAI P2', 30, 'debit'),
      ('{E17}', '{A}', '{P2}', null, null, null, '2025-02-01', '512000', 'ESSAI P2', 30, 'credit')$q$, '', ''],
    -- La numérotation juste de 2024, celle que l'application composerait : un numéro par écriture, de 1 dans
    -- l'ordre des dates de chaque journal. Ses variantes fautives en dérivent, par leur rang dans cette liste.
    array['jeu', 'numérotation de 2024', 'postgres', $q$select set_config('essai.juste', $j$[
      {"id":"{E1}","journal":"AC","numero":1,"piece_ref":"essai-p1.pdf","piece_date":"2024-03-01","compte_lib":"Achats"},
      {"id":"{E2}","journal":"AC","numero":1,"piece_ref":"essai-p1.pdf","piece_date":"2024-03-01","compte_lib":"Banque"},
      {"id":"{E8}","journal":"AC","numero":2,"piece_ref":"essai-p3.pdf","piece_date":"2024-05-01","compte_lib":"Achats"},
      {"id":"{E9}","journal":"AC","numero":2,"piece_ref":"essai-p3.pdf","piece_date":"2024-05-01","compte_lib":"Banque"},
      {"id":"{E10}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2024-03-01","compte_lib":"Cotisations"},
      {"id":"{E11}","journal":"BQ","numero":1,"piece_ref":"Relevé essai","piece_date":"2024-03-01","compte_lib":"Banque"},
      {"id":"{E3}","journal":"BQ","numero":2,"piece_ref":"Relevé essai","piece_date":"2024-04-10","compte_lib":"Honoraires"},
      {"id":"{E4}","journal":"BQ","numero":2,"piece_ref":"Relevé essai","piece_date":"2024-04-10","compte_lib":"Banque"},
      {"id":"{E5}","journal":"BQ","numero":3,"piece_ref":"Relevé essai","piece_date":"2024-04-20","compte_lib":"Achats"},
      {"id":"{E6}","journal":"BQ","numero":3,"piece_ref":"Relevé essai","piece_date":"2024-04-20","compte_lib":"Exploitant"},
      {"id":"{E7}","journal":"BQ","numero":3,"piece_ref":"Relevé essai","piece_date":"2024-04-20","compte_lib":"Banque"},
      {"id":"{E12}","journal":"OD","numero":1,"piece_ref":"Tableau d'amortissement 2024","piece_date":"2024-12-31","compte_lib":"Dotations"},
      {"id":"{E13}","journal":"OD","numero":1,"piece_ref":"Tableau d'amortissement 2024","piece_date":"2024-12-31","compte_lib":"Amortissements"},
      {"id":"{E14}","journal":"OD","numero":2,"piece_ref":"Barème kilométrique 2024","piece_date":"2024-12-31","compte_lib":"Indemnités kilométriques"},
      {"id":"{E15}","journal":"OD","numero":2,"piece_ref":"Barème kilométrique 2024","piece_date":"2024-12-31","compte_lib":"Exploitant"}
    ]$j$, true)$q$, '', ''],
    array['jeu', 'mouvements de X', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, ventilee) values
      ('{XM24}', '{X}', '2024-02-02', 'ESSAI X 2024', -12, 'non_rapprochee', false), ('{XM25}', '{X}', '2025-02-02', 'ESSAI X 2025', -13, 'non_rapprochee', false),
      ('{XMV}', '{X}', '2024-02-03', 'ESSAI X VENTILEE', -20, 'rapprochee', true)$q$, '', ''],
    array['jeu', 'part de X', 'postgres', $q$insert into ventilations_bancaires (id, dossier_id, ligne_bancaire_id, categorie_id, montant) values ('{XVP}', '{X}', '{XMV}', '{CAT}', -20)$q$, '', ''],
    array['jeu', 'bien de X', 'postgres', $q$insert into immobilisations (id, dossier_id, libelle, valeur, date_acquisition) values ('{XB24}', '{X}', 'ESSAI X bien', 900, '2024-04-01')$q$, '', ''],
    array['jeu', 'cadre 7 de X', 'postgres', $q$insert into vehicules (id, dossier_id, annee, modele, km_professionnel) values
      ('{XV24}', '{X}', 2024, 'VÉHICULE ESSAI X 2024', 10), ('{XV25}', '{X}', 2025, 'VÉHICULE ESSAI X 2025', 10)$q$, '', ''],
    array['jeu', 'échéance de X', 'postgres', $q$insert into cotisations_declarees (id, dossier_id, echeance, montant_appele) values ('{XC24}', '{X}', '2024-06-01', 40)$q$, '', ''],
    array['jeu', 'à-nouveau de X', 'postgres', $q$insert into a_nouveaux (id, dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values ('{XAN}', '{X}', '2024-01-01', '512000', 'debit', 1, 'balance-essai-x.csv', repeat('d', 64))$q$, '', ''],
    array['jeu', 'écriture de X', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values ('{XE24}', '{X}', '2024-07-01', '606100', 'ESSAI X', 1, 'debit')$q$, '', ''],

    -- ══ Qui peut valider ═══════════════════════════════════════════════════════════════════════════════════════════
    array['controle', '1. anonyme : pas le droit d''appeler', 'anon', $q$select valider_exercice('{A}', 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '42501', 'permission denied%'],
    array['controle', '2. rattaché à rien', 'inconnu', $q$select valider_exercice('{A}', 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '42501', 'Seul le chef du cabinet valide un exercice.'],
    array['controle', '3. client, le dossier d''un autre', 'client', $q$select valider_exercice('{A}', 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '42501', 'Seul le chef du cabinet valide un exercice.'],
    array['controle', '4. client, son propre dossier', 'client', $q$select valider_exercice('{DC}', 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '42501', 'Seul le chef du cabinet valide un exercice.'],
    array['jeu', 'le client devient membre du cabinet jetable, assigné à son dossier', 'postgres', $q$insert into cabinet_admins (user_id, cabinet_id, role) values ('{CLIENT}', '{CJ}', 'comptable')$q$, '', ''],
    array['jeu', '', 'postgres', $q$insert into dossier_assignations (dossier_id, user_id) values ('{J1}', '{CLIENT}')$q$, '', ''],
    array['controle', '5. membre du cabinet, assigné au dossier', 'client', $q$select valider_exercice('{J1}', 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '42501', 'Seul le chef du cabinet valide un exercice.'],
    array['jeu', 'le client devient chef du cabinet jetable', 'postgres', $q$update cabinet_admins set role = 'comptable_en_chef' where user_id = '{CLIENT}' and cabinet_id = '{CJ}'$q$, '', ''],
    array['controle', '6. chef d''un autre cabinet', 'client', $q$select valider_exercice('{A}', 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '42501', 'Seul le chef du cabinet valide un exercice.'],
    array['controle', '7. dossier inexistant', 'chef', $q$select valider_exercice(gen_random_uuid(), 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '42501', 'Seul le chef du cabinet valide un exercice.'],
    array['fait', '8. un chef de cabinet qui n''est pas super-administrateur valide un dossier de son cabinet', 'client', $q$select valider_exercice('{J1}', 2024, '[]'::jsonb, '[]'::jsonb, '{"essai":"J1"}'::jsonb)$q$, 'OK', ''],
    array['valeur', '9. la validation porte le nom de qui l''a faite', 'postgres', $q$select (valide_par = '{CLIENT}')::text || '/' || nb_lignes || '/' || (declaration->>'essai') from exercices_valides where dossier_id = '{J1}'$q$, '', 'true/0/J1'],

    -- ══ Ce qui se refuse, avec sa raison ═══════════════════════════════════════════════════════════════════════════
    array['controle', '10. exercice invalide', 'chef', $q$select valider_exercice('{A}', 1999, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Exercice invalide.'],
    array['controle', '11. exercice en cours', 'chef', format($q$select valider_exercice('{A}', %s, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, annee_courante), '22023', format('L''exercice %s n''est pas terminé : il se valide une fois clos.', annee_courante)],
    array['controle', '12. un mouvement de 2024 reste à traiter', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514', 'L''exercice 2024 porte des mouvements bancaires à traiter : ils se traitent avant la validation.'],
    array['jeu', 'le mouvement à traiter est ignoré', 'postgres', $q$update lignes_bancaires set statut = 'ignoree' where id = '{M9}'$q$, '', ''],
    array['controle', '13. la 2035 manque', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb, '[]'::jsonb, null)$q$, '22023', 'La 2035 à valider manque.'],
    array['controle', '14. la 2035 n''est pas un objet', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb, '[]'::jsonb, '[]'::jsonb)$q$, '22023', 'La 2035 à valider manque.'],
    array['controle', '15. numérotation illisible', 'chef', $q$select valider_exercice('{A}', 2024, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'La numérotation proposée est illisible.'],
    array['controle', '16. libellés des à-nouveaux illisibles', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb, null, '{}'::jsonb)$q$, '22023', 'Les libellés proposés des à-nouveaux sont illisibles.'],
    array['controle', '17. une ligne manque', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb - 14, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'La numérotation proposée ne couvre pas exactement les 15 écritures de l''exercice 2024.'],
    array['controle', '18. une ligne d''un autre exercice', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb || '[{"id":"{E16}","journal":"AC","numero":3,"piece_ref":"x","piece_date":"2025-02-01","compte_lib":"Achats"}]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'La numérotation proposée ne couvre pas exactement les 15 écritures de l''exercice 2024.'],
    array['controle', '19. une ligne en double', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb || jsonb_build_array(current_setting('essai.juste')::jsonb -> 0), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'La numérotation proposée ne couvre pas exactement les 15 écritures de l''exercice 2024.'],
    array['controle', '20. un journal inconnu', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(jsonb_set(current_setting('essai.juste')::jsonb, '{0,journal}', '"XX"'), '{1,journal}', '"XX"'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Une ligne de la numérotation proposée est incomplète.'],
    array['controle', '21. des numéros qui sautent', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(jsonb_set(current_setting('essai.juste')::jsonb, '{0,numero}', '3'), '{1,numero}', '3'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Les numéros d''un journal ne se suivent pas.'],
    array['controle', '22. des numéros à rebours des dates', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(jsonb_set(jsonb_set(jsonb_set(current_setting('essai.juste')::jsonb, '{0,numero}', '2'), '{1,numero}', '2'), '{2,numero}', '1'), '{3,numero}', '1'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Les numéros d''un journal ne suivent pas l''ordre des dates.'],
    array['controle', '23. une écriture déséquilibrée', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(jsonb_set(jsonb_set(current_setting('essai.juste')::jsonb, '{1,numero}', '2'), '{2,numero}', '3'), '{3,numero}', '3'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Une écriture n''est pas équilibrée au centime.'],
    array['controle', '24. deux pièces dans une écriture', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(current_setting('essai.juste')::jsonb, '{1,piece_ref}', '"autre"'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Les lignes d''une même écriture ne portent pas la même pièce.'],
    -- La pièce P3 rangée sous le numéro de P1, avec sa référence et sa date de pièce : équilibrée, une seule pièce,
    -- mais ses lignes du 10 mai sous l'écriture du 5 mars. C'est la forme qu'avait une pièce payée en deux fois avant
    -- le 05/10/2026, et l'outil de la DGFiP la range parmi ses anomalies (« Différentes dates comptables »).
    array['controle', '24b. deux dates dans une écriture', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(jsonb_set(current_setting('essai.juste')::jsonb, '{2}', (current_setting('essai.juste')::jsonb -> 2) || '{"numero":1,"piece_ref":"essai-p1.pdf","piece_date":"2024-03-01"}'), '{3}', (current_setting('essai.juste')::jsonb -> 3) || '{"numero":1,"piece_ref":"essai-p1.pdf","piece_date":"2024-03-01"}'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Les lignes d''une même écriture ne portent pas la même date.'],
    array['controle', '25. deux libellés pour un compte', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(current_setting('essai.juste')::jsonb, '{7,compte_lib}', '"Compte bancaire"'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Un même compte porte deux libellés.'],
    array['controle', '26. un compte auxiliaire sans libellé', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(current_setting('essai.juste')::jsonb, '{0,comp_aux_num}', '"FESSAI"'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Une ligne de la numérotation proposée est incomplète.'],
    array['controle', '27. deux libellés pour un compte auxiliaire', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(jsonb_set(current_setting('essai.juste')::jsonb, '{0}', (current_setting('essai.juste')::jsonb -> 0) || '{"comp_aux_num":"FESSAI","comp_aux_lib":"Essai"}'), '{2}', (current_setting('essai.juste')::jsonb -> 2) || '{"comp_aux_num":"FESSAI","comp_aux_lib":"Autre"}'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Un même compte auxiliaire porte deux libellés.'],
    array['controle', '28. une pièce sans date', 'chef', $q$select valider_exercice('{A}', 2024, jsonb_set(current_setting('essai.juste')::jsonb, '{4}', (current_setting('essai.juste')::jsonb -> 4) - 'piece_date'), '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Une ligne de la numérotation proposée est incomplète.'],
    array['controle', '29. une écriture validée à la main', 'chef', $q$update ecritures_brouillon set statut = 'validee', valide_le = now(), journal_code = 'AC', numero_ecriture = 1, piece_ref = 'x', piece_date = '2024-03-01', compte_lib = 'x' where id = '{E1}'$q$, '42501', 'Une écriture ne se valide que par la validation de son exercice.'],
    array['controle', '30. ni celle d''un exercice qu''on ne valide pas, par le super-administrateur', 'chef', $q$update ecritures_brouillon set statut = 'validee', valide_le = now(), journal_code = 'OD', numero_ecriture = 9, piece_ref = 'x', piece_date = '2025-02-01', compte_lib = 'x' where id = '{E16}'$q$, '42501', 'Une écriture ne se valide que par la validation de son exercice.'],
    array['valeur', '31. rien n''est validé après les refus', 'postgres', $q$select (select count(*) from ecritures_brouillon where dossier_id = '{A}' and statut = 'validee') || '/' || (select count(*) from exercices_valides where dossier_id = '{A}')$q$, '', '0/0'],

    -- ══ Le contrôle POSITIF : le chef valide 2024 ══════════════════════════════════════════════════════════════════
    array['fait', '32. le chef valide 2024', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb, '[]'::jsonb, '{"essai":"oui"}'::jsonb)$q$, 'OK', ''],
    array['valeur', '33. les écritures de 2024 sont figées et numérotées, avec le libellé de leur compte', 'postgres', $q$select string_agg(journal_code || numero_ecriture || ':' || compte || ':' || compte_lib, ',' order by journal_code collate "C", numero_ecriture, compte collate "C") from ecritures_brouillon where dossier_id = '{A}' and statut = 'validee'$q$, '',
      'AC1:512000:Banque,AC1:606100:Achats,AC2:512000:Banque,AC2:606100:Achats,BQ1:512000:Banque,BQ1:646000:Cotisations,BQ2:512000:Banque,BQ2:706000:Honoraires,BQ3:108000:Exploitant,BQ3:512000:Banque,BQ3:606100:Achats,OD1:281830:Amortissements,OD1:681100:Dotations,OD2:108000:Exploitant,OD2:625110:Indemnités kilométriques'],
    array['valeur', '34. une écriture validée porte sa pièce', 'postgres', $q$select piece_ref || ' ' || piece_date || ' ' || (comp_aux_num is null) from ecritures_brouillon where id = '{E13}'$q$, '', 'Tableau d''amortissement 2024 2024-12-31 true'],
    array['valeur', '35. l''exercice est enregistré : lignes, écritures, totaux, 2035, premier maillon, auteur, date', 'postgres', $q$select nb_lignes || '/' || nb_ecritures || '/' || total_debit || '/' || total_credit || '/' || mode_comptable || '/' || (declaration->>'essai') || '/' || (empreinte_precedente is null) || '/' || (valide_par = '{CHEF}') || '/' || (valide_le = (select max(valide_le) from ecritures_brouillon where dossier_id = '{A}')) from exercices_valides where dossier_id = '{A}'$q$, '', '15/7/1259.00/1259.00/tresorerie/oui/true/true/true'],
    array['valeur', '36. rien de 2025 n''est validé', 'postgres', $q$select count(*) filter (where statut = 'proposee') || '/' || count(*) from ecritures_brouillon where dossier_id = '{A}' and date >= '2025-01-01'$q$, '', '2/2'],
    -- Les soldes de fin de 2024 : la banque et l'amortissement sous leur numéro et leur libellé figé ; le 108 (18 − 529)
    -- et le résultat (une perte de 1 141) au capital individuel, A étant tenu en trésorerie. Sans libellé de compte tant
    -- que 2025 n'est pas validé, et chacun porte l'empreinte de 2024.
    array['valeur', '36b. la validation écrit l''ouverture de 2025 : les soldes de fin de 2024', 'postgres', $q$select string_agg(compte || ':' || sens || ':' || montant || ':' || libelle, ',' order by compte collate "C") || '/' || min(source_nom) || '/' || bool_and(source_empreinte = (select empreinte from exercices_valides where dossier_id = '{A}' and annee = 2024)) || '/' || min(date) || '/' || count(compte_lib) from soldes_reportes where dossier_id = '{A}'$q$, '',
      '101000:debit:630.00:Capital individuel,281830:credit:400.00:Amortissements,512000:credit:230.00:Banque/Exercice 2024 validé/true/2025-01-01/0'],
    array['controle', '37. le chef vérifie l''empreinte', 'chef', $q$do $x$ begin if not verifier_exercice_valide('{A}', 2024) then raise exception 'EMPREINTE FAUSSE'; end if; end $x$$q$, 'OK', ''],
    array['controle', '38. le client ne lit ni la validation ni les écritures d''un autre', 'client', $q$do $x$ begin if verifier_exercice_valide('{A}', 2024) is not null or exists (select 1 from exercices_valides where dossier_id = '{A}') or exists (select 1 from ecritures_brouillon where dossier_id = '{A}') then raise exception 'VU'; end if; end $x$$q$, 'OK', ''],
    array['controle', '39. l''anonyme ne vérifie rien', 'anon', $q$select verifier_exercice_valide('{A}', 2024)$q$, '42501', 'permission denied%'],
    array['controle', '40. valider 2024 une seconde fois', 'chef', $q$select valider_exercice('{A}', 2024, current_setting('essai.juste')::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514', 'L''exercice 2024 est déjà validé, ou un exercice postérieur l''est.'],
    array['controle', '41. ni un exercice antérieur', 'chef', $q$select valider_exercice('{A}', 2023, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514', 'L''exercice 2023 est déjà validé, ou un exercice postérieur l''est.'],

    -- ══ L'intangibilité ════════════════════════════════════════════════════════════════════════════════════════════
    array['controle', '42. modifier une écriture validée', 'chef', $q$update ecritures_brouillon set libelle = 'x' where id = '{E1}'$q$, '23514', 'Cette écriture est validée (exercice 2024) : elle ne se modifie plus.'],
    array['controle', '43. ni même par une sauvegarde sans changement, à la différence de ses sources', 'chef', $q$update ecritures_brouillon set libelle = libelle where id = '{E1}'$q$, '23514', 'Cette écriture est validée (exercice 2024) : elle ne se modifie plus.'],
    array['controle', '44. ni le propriétaire de la base', 'postgres', $q$update ecritures_brouillon set montant = 99 where id = '{E1}'$q$, '23514', 'Cette écriture est validée (exercice 2024) : elle ne se modifie plus.'],
    array['controle', '45. passer une écriture dans 2024', 'chef', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values ('{A}', '2024-12-31', '606100', 'ESSAI TARD', 1, 'debit')$q$, '23514', 'L''exercice 2024 est validé : aucune écriture ne s''y passe plus.'],
    array['controle', '46. ni avant le premier exercice validé, sans le dire validé', 'chef', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values ('{A}', '2023-06-01', '606100', 'ESSAI TARD', 1, 'debit')$q$, '23514', 'L''exercice 2023 est figé par la validation de l''exercice 2024 : aucune écriture ne s''y passe plus.'],
    array['controle', '47. une écriture de 2025 passe', 'chef', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values ('{A}', '2025-01-02', '606100', 'ESSAI 2025', 1, 'debit')$q$, 'OK', ''],
    array['controle', '48. reculer une écriture de 2025 dans 2024', 'chef', $q$update ecritures_brouillon set date = '2024-12-31' where id = '{E16}'$q$, '23514', 'L''exercice 2024 est validé : aucune écriture ne s''y passe plus.'],
    array['controle', '49. le super-administrateur n''insère pas d''écriture validée dans un dossier qui a un exercice validé', 'chef', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values ('{A}', '2025-03-01', '606100', 'ESSAI', 1, 'debit', 'validee', now(), 'OD', 9, 'x', '2025-03-01', 'Achats')$q$, '42501', 'Une écriture ne se valide que par la validation de son exercice.'],
    array['controle', '50. une écriture de 2024 venue d''un autre dossier', 'chef', $q$update ecritures_brouillon set dossier_id = '{A}' where id = '{XE24}'$q$, '23514', 'L''exercice 2024 est validé : aucune écriture ne s''y passe plus.'],
    array['controle', '51. une écriture validée ne quitte pas son dossier', 'chef', $q$update ecritures_brouillon set dossier_id = '{X}' where id = '{E3}'$q$, '23514', 'Cette écriture est validée (exercice 2024) : elle ne se modifie plus.'],
    array['controle', '52. l''écriture d''un dossier sans exercice validé reste libre', 'chef', $q$update ecritures_brouillon set libelle = 'ESSAI X modifiée' where id = '{XE24}'$q$, 'OK', ''],
    array['controle', '53. une écriture validée ne reçoit pas une autre pièce', 'chef', $q$update ecritures_brouillon set piece_id = '{P2}' where id = '{E1}'$q$, '23514', 'Cette écriture est validée (exercice 2024) : elle ne se modifie plus.'],

    -- ══ L'empreinte ════════════════════════════════════════════════════════════════════════════════════════════════
    array['jeu', 'réécrire l''échelle d''un montant hors déclencheur', 'postgres', $q$set local session_replication_role = replica$q$, '', ''],
    array['jeu', '', 'postgres', $q$update ecritures_brouillon set montant = 100.00 where id = '{E1}'$q$, '', ''],
    array['jeu', '', 'postgres', $q$set local session_replication_role = origin$q$, '', ''],
    array['valeur', '54. une échelle réécrite ne change pas l''empreinte', 'postgres', $q$select verifier_exercice_valide('{A}', 2024)::text || '/' || (select montant::text from ecritures_brouillon where id = '{E1}')$q$, '', 'true/100.00'],
    array['jeu', 'falsifier un libellé hors déclencheur', 'postgres', $q$set local session_replication_role = replica$q$, '', ''],
    array['jeu', '', 'postgres', $q$update ecritures_brouillon set libelle = 'falsifié' where id = '{E1}'$q$, '', ''],
    array['jeu', '', 'postgres', $q$set local session_replication_role = origin$q$, '', ''],
    array['valeur', '55. une écriture falsifiée hors déclencheur se voit', 'postgres', $q$select verifier_exercice_valide('{A}', 2024)::text$q$, '', 'false'],
    array['jeu', 'rétablir le libellé', 'postgres', $q$set local session_replication_role = replica$q$, '', ''],
    array['jeu', '', 'postgres', $q$update ecritures_brouillon set libelle = 'ESSAI P1' where id = '{E1}'$q$, '', ''],
    array['jeu', '', 'postgres', $q$set local session_replication_role = origin$q$, '', ''],
    array['valeur', '56. rétablie, elle se relit', 'postgres', $q$select verifier_exercice_valide('{A}', 2024)::text$q$, '', 'true'],

    -- ══ Les pièces ═════════════════════════════════════════════════════════════════════════════════════════════════
    array['controle', '57. le montant d''une pièce dont l''écriture est validée', 'chef', $q$update pieces set montant_ttc = 99 where id = '{P1}'$q$, '23514', 'Cette pièce porte une écriture validée de l''exercice 2024 : ses montants, sa date et sa catégorie ne changent plus.'],
    array['controle', '58. sa catégorie', 'chef', $q$update pieces set categorie_id = '{CAT}' where id = '{P1}'$q$, '23514', 'Cette pièce porte une écriture validée de l''exercice 2024 : ses montants, sa date et sa catégorie ne changent plus.'],
    array['controle', '59. ses notes, son sous-dossier et la confiance de sa lecture restent libres', 'chef', $q$update pieces set notes = 'vu', sous_dossier_id = null, confiance = 'haute', updated_at = now() where id = '{P1}'$q$, 'OK', ''],
    array['controle', '60. une sauvegarde sans changement passe', 'chef', $q$update pieces set montant_ttc = 100.00 where id = '{P1}'$q$, 'OK', ''],
    array['controle', '61. la facture d''un bien amorti en 2024', 'chef', $q$update pieces set montant_ttc = 1100 where id = '{P4}'$q$, '23514', 'Cette pièce porte une écriture validée de l''exercice 2024 : ses montants, sa date et sa catégorie ne changent plus.'],
    array['controle', '62. une pièce figée ne change pas de dossier', 'chef', $q$update pieces set dossier_id = '{X}' where id = '{P1}'$q$, '23514', 'Cette pièce porte une écriture validée de l''exercice 2024 : ses montants, sa date et sa catégorie ne changent plus.'],
    array['controle', '63. une pièce de 2025 reste modifiable', 'chef', $q$update pieces set montant_ttc = 31 where id = '{P2}'$q$, 'OK', ''],
    array['controle', '64. une pièce de 2024 déposée après coup', 'chef', $q$insert into pieces (dossier_id, storage_path, nom_fichier, date_piece) values ('{A}', 'essai/validation/tard.pdf', 'essai-tard.pdf', '2024-06-01')$q$, 'OK', ''],

    -- ══ Les mouvements et leurs parts ══════════════════════════════════════════════════════════════════════════════
    array['controle', '65. le statut d''un mouvement de 2024', 'chef', $q$update lignes_bancaires set statut = 'non_rapprochee', piece_id = null where id = '{M1}'$q$, '23514', 'L''exercice 2024 est validé : ce mouvement ne change plus.'],
    array['controle', '66. sa sauvegarde sans changement passe', 'chef', $q$update lignes_bancaires set libelle = libelle where id = '{M1}'$q$, 'OK', ''],
    array['controle', '67. importer un mouvement de 2024', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{A}', '2024-11-02', 'ESSAI TARD', -5)$q$, '23514', 'L''exercice 2024 est validé : un mouvement de cet exercice ne s''importe plus.'],
    array['controle', '68. ni un mouvement antérieur au premier exercice validé, sans le dire validé', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{A}', '2023-05-05', 'ESSAI ANCIEN', -5)$q$, '23514', 'L''exercice 2023 est figé par la validation de l''exercice 2024 : un mouvement de cet exercice ne s''importe plus.'],
    array['controle', '69. la banque réimporte un mouvement de 2024 qu''elle connaît, et la base l''écarte', 'chef', $q$do $x$ begin insert into lignes_bancaires (dossier_id, date, libelle, montant, id_externe) values ('{A}', '2024-06-15', 'ESSAI FRAIS', -2, 'ESSAI-EXT-1') on conflict (dossier_id, id_externe) do nothing; if (select count(*) from lignes_bancaires where dossier_id = '{A}' and date <= '2024-12-31') <> 7 then raise exception 'IMPORTÉ'; end if; end $x$$q$, 'OK', ''],
    array['controle', '70. sans l''écart de la base, ce doublon est refusé par elle', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, id_externe) values ('{A}', '2024-06-15', 'ESSAI FRAIS', -2, 'ESSAI-EXT-1')$q$, '23505', '%'],
    array['controle', '71. un mouvement de 2024 que la banque ne connaissait pas', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, id_externe) values ('{A}', '2024-06-16', 'ESSAI NOUVEAU', -2, 'ESSAI-EXT-2') on conflict (dossier_id, id_externe) do nothing$q$, '23514', 'L''exercice 2024 est validé : un mouvement de cet exercice ne s''importe plus.'],
    array['controle', '72. importer un mouvement de 2025', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{A}', '2025-03-02', 'ESSAI 2025', -5)$q$, 'OK', ''],
    array['controle', '73. reculer un mouvement de 2025 dans 2024', 'chef', $q$update lignes_bancaires set date = '2024-12-30' where id = '{M7}'$q$, '23514', 'L''exercice 2024 est validé : un mouvement ne s''y déplace plus.'],
    array['controle', '74. rapprocher un mouvement de 2025', 'chef', $q$update lignes_bancaires set statut = 'rapprochee', piece_id = '{P2}' where id = '{M7}'$q$, 'OK', ''],
    array['controle', '75. un mouvement de 2024 venu d''un autre dossier', 'chef', $q$update lignes_bancaires set dossier_id = '{A}' where id = '{XM24}'$q$, '23514', 'L''exercice 2024 est validé : un mouvement ne s''y déplace plus.'],
    array['controle', '76. un mouvement de 2025 venu d''un autre dossier', 'chef', $q$update lignes_bancaires set dossier_id = '{A}' where id = '{XM25}'$q$, 'OK', ''],
    array['controle', '77. un mouvement de 2024 ne quitte pas son dossier', 'chef', $q$update lignes_bancaires set dossier_id = '{X}' where id = '{M2}'$q$, '23514', 'L''exercice 2024 est validé : ce mouvement ne change plus.'],
    array['controle', '78. une part d''une ventilation de 2024', 'chef', $q$update ventilations_bancaires set montant = -41 where id = '{VP1}'$q$, '23514', 'L''exercice 2024 est validé : la répartition de ce mouvement ne change plus.'],
    array['controle', '79. une part ajoutée à une ventilation de 2024', 'chef', $q$insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, part_personnelle, montant) values ('{A}', '{M3}', true, -1)$q$, '23514', 'L''exercice 2024 est validé : la répartition de ce mouvement ne change plus.'],
    array['controle', '80. une part d''un règlement groupé de 2024', 'chef', $q$update reglements_groupes set montant = -39 where id = '{RG1}'$q$, '23514', 'L''exercice 2024 est validé : la répartition de ce mouvement ne change plus.'],
    array['controle', '81. une part de 2024 venue d''un autre dossier', 'chef', $q$update ventilations_bancaires set dossier_id = '{A}' where id = '{XVP}'$q$, '23514', 'L''exercice 2024 est validé : la répartition de ce mouvement ne change plus.'],
    array['controle', '82. une part de 2024 ne quitte pas son dossier', 'chef', $q$update ventilations_bancaires set dossier_id = '{X}' where id = '{VP1}'$q$, '23514', 'L''exercice 2024 est validé : la répartition de ce mouvement ne change plus.'],

    -- ══ Les biens ══════════════════════════════════════════════════════════════════════════════════════════════════
    array['controle', '83. la valeur d''un bien amorti en 2024', 'chef', $q$update immobilisations set valeur = 1100 where id = '{B1}'$q$, '23514', 'Ce bien porte une écriture validée de l''exercice 2024 : sa valeur, ses dates et sa durée ne changent plus.'],
    array['controle', '84. sa sauvegarde sans changement passe', 'chef', $q$update immobilisations set libelle = libelle where id = '{B1}'$q$, 'OK', ''],
    array['controle', '85. ce bien ne quitte pas son dossier', 'chef', $q$update immobilisations set dossier_id = '{X}' where id = '{B1}'$q$, '23514', 'Ce bien porte une écriture validée de l''exercice 2024 : sa valeur, ses dates et sa durée ne changent plus.'],
    array['controle', '86. inscrire un bien acquis en 2024', 'chef', $q$insert into immobilisations (dossier_id, libelle, valeur, date_acquisition) values ('{A}', 'ESSAI Tard', 900, '2024-09-01')$q$, '23514', 'L''exercice 2024 est validé : un bien acquis dans cet exercice ne s''inscrit plus au registre.'],
    array['controle', '87. ni un bien acquis avant le premier exercice validé, sans le dire validé', 'chef', $q$insert into immobilisations (dossier_id, libelle, valeur, date_acquisition) values ('{A}', 'ESSAI Ancien', 900, '2023-01-10')$q$, '23514', 'L''exercice 2023 est figé par la validation de l''exercice 2024 : un bien acquis dans cet exercice ne s''inscrit plus au registre.'],
    array['controle', '88. immobiliser une pièce dont l''écriture est validée', 'chef', $q$insert into immobilisations (dossier_id, piece_id, libelle, valeur, date_acquisition) values ('{A}', '{P3}', 'ESSAI Tard', 40, '2025-01-15')$q$, '23514', 'Cette pièce porte une écriture validée : elle ne devient plus une immobilisation.'],
    array['controle', '89. avancer dans 2024 la date d''acquisition d''un bien de 2025', 'chef', $q$update immobilisations set date_acquisition = '2024-12-15' where id = '{B2}'$q$, '23514', 'L''exercice 2024 est validé : la date d''acquisition d''un bien ne s''y porte plus.'],
    array['controle', '90. lui donner pour facture une pièce dont l''écriture est validée', 'chef', $q$update immobilisations set piece_id = '{P3}' where id = '{B2}'$q$, '23514', 'Cette pièce porte une écriture validée : elle ne devient plus une immobilisation.'],
    array['controle', '91. son libellé, et sa date dans 2025, restent libres', 'chef', $q$update immobilisations set libelle = 'ESSAI Bien de 2025 (écran)', date_acquisition = '2025-10-01' where id = '{B2}'$q$, 'OK', ''],
    array['controle', '92. un bien de 2024 sans écriture validée garde son libellé', 'chef', $q$update immobilisations set libelle = 'ESSAI Bien renommé' where id = '{B3}'$q$, 'OK', ''],
    array['controle', '93. un bien de 2024 venu d''un autre dossier', 'chef', $q$update immobilisations set dossier_id = '{A}' where id = '{XB24}'$q$, '23514', 'L''exercice 2024 est validé : la date d''acquisition d''un bien ne s''y porte plus.'],

    -- ══ La restauration : le super-administrateur, dans un dossier sans exercice validé ════════════════════════════
    array['jeu', 'un mouvement à restaurer', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{RM}', '{R}', '2024-03-05', 'ESSAI RESTAURE', -100, 'rapprochee')$q$, '', ''],
    array['fait', '94. la restauration réinsère des écritures déjà validées', 'chef', $q$insert into ecritures_brouillon (dossier_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values
      ('{R}', null, '2024-03-05', '606100', 'ESSAI R', 100, 'debit', 'validee', '2025-02-01 10:00+00', 'BQ', 1, 'Relevé essai', '2024-03-05', 'Achats'),
      ('{R}', '{RM}', '2024-03-05', '512000', 'ESSAI R', 100, 'credit', 'validee', '2025-02-01 10:00+00', 'BQ', 1, 'Relevé essai', '2024-03-05', 'Banque')$q$, 'OK', ''],
    array['controle', '95. le client ne restaure pas d''exercice validé', 'client', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{R}', 2024, now(), '{CLIENT}', 'tresorerie', 0, 0, 0, 0, repeat('c', 64), '{}'::jsonb)$q$, '42501', 'new row violates row-level security policy%'],
    array['fait', '96. puis l''exercice validé, en dernier', 'chef', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{R}', 2024, '2025-02-01 10:00+00', '{CHEF}', 'tresorerie', 2, 1, 100, 100, repeat('c', 64), '{}'::jsonb)$q$, 'OK', ''],
    array['controle', '97. restauré, l''exercice se ferme : plus de mouvement', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{R}', '2024-04-01', 'ESSAI APRES', -1)$q$, '23514', 'L''exercice 2024 est validé : un mouvement de cet exercice ne s''importe plus.'],
    array['controle', '98. ni d''écriture validée', 'chef', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values ('{R}', '2025-06-01', '606100', 'ESSAI', 1, 'debit', 'validee', now(), 'OD', 1, 'x', '2025-06-01', 'Achats')$q$, '42501', 'Une écriture ne se valide que par la validation de son exercice.'],
    array['jeu', 'une année sautée, que seule une restauration fabriquée produirait', 'postgres', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{R}', 2026, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('e', 64), '{}'::jsonb)$q$, '', ''],
    array['controle', '99. une année sautée est dite figée, pas validée', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{R}', '2025-04-01', 'ESSAI TROU', -1)$q$, '23514', 'L''exercice 2025 est figé par la validation de l''exercice 2026 : un mouvement de cet exercice ne s''importe plus.'],
    array['controle', '100. le refus nomme l''exercice validé qui suit, pas le dernier', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{R}', '2023-04-01', 'ESSAI AVANT', -1)$q$, '23514', 'L''exercice 2023 est figé par la validation de l''exercice 2024 : un mouvement de cet exercice ne s''importe plus.'],

    -- ══ Le cadre 7, les échéances et les à-nouveaux ════════════════════════════════════════════════════════════════
    array['controle', '101. le cadre 7 de 2024', 'chef', $q$update vehicules set km_professionnel = 1100 where id = '{V1}'$q$, '23514', 'L''exercice 2024 est validé : son cadre 7 ne change plus.'],
    array['controle', '102. sa sauvegarde sans changement passe, sa date de mise à jour comprise', 'chef', $q$update vehicules set updated_at = updated_at + interval '1 second' where id = '{V1}'$q$, 'OK', ''],
    array['controle', '103. une ligne du cadre 7 ajoutée en 2024', 'chef', $q$insert into vehicules (dossier_id, annee, modele, km_professionnel) values ('{A}', 2024, 'VÉHICULE ESSAI TARD', 10)$q$, '23514', 'L''exercice 2024 est validé : son cadre 7 ne change plus.'],
    array['controle', '104. ni en 2023, sans le dire validé', 'chef', $q$insert into vehicules (dossier_id, annee, modele, km_professionnel) values ('{A}', 2023, 'VÉHICULE ESSAI ANCIEN', 10)$q$, '23514', 'L''exercice 2023 est figé par la validation de l''exercice 2024 : son cadre 7 ne change plus.'],
    array['controle', '105. le cadre 7 de 2025 reste modifiable', 'chef', $q$update vehicules set km_professionnel = 950, updated_at = now() where id = '{V2}'$q$, 'OK', ''],
    array['controle', '106. une ligne du cadre 7 de 2024 venue d''un autre dossier est refusée, une de 2025 passe', 'chef', $q$do $x$ begin
        begin update vehicules set dossier_id = '{A}' where id = '{XV24}'; raise exception 'PASSÉE';
        exception when sqlstate '23514' then if sqlerrm <> 'L''exercice 2024 est validé : son cadre 7 ne change plus.' then raise; end if; end;
        update vehicules set dossier_id = '{A}' where id = '{XV25}'; end $x$$q$, 'OK', ''],
    array['controle', '107. une ligne du cadre 7 de 2024 ne quitte pas son dossier', 'chef', $q$update vehicules set dossier_id = '{X}' where id = '{V1}'$q$, '23514', 'L''exercice 2024 est validé : son cadre 7 ne change plus.'],
    array['controle', '108. une échéance payée en 2024', 'chef', $q$update cotisations_declarees set montant_csg_crds = 9 where id = '{C1}'$q$, '23514', 'L''exercice 2024 est validé : cette échéance ne change plus.'],
    array['controle', '109. sa sauvegarde sans changement passe', 'chef', $q$update cotisations_declarees set montant_appele = montant_appele where id = '{C1}'$q$, 'OK', ''],
    array['controle', '110. une échéance de 2024 payée en 2025 reste modifiable', 'chef', $q$update cotisations_declarees set montant_csg_crds = 9 where id = '{C2}'$q$, 'OK', ''],
    array['controle', '111. une échéance ajoutée en 2024 ou en 2023 est refusée, en 2025 elle passe', 'chef', $q$do $x$ begin
        begin insert into cotisations_declarees (dossier_id, echeance, montant_appele) values ('{A}', '2024-11-01', 50); raise exception 'PASSÉE';
        exception when sqlstate '23514' then if sqlerrm <> 'L''exercice 2024 est validé : une échéance ne s''y ajoute plus.' then raise; end if; end;
        begin insert into cotisations_declarees (dossier_id, echeance, montant_appele) values ('{A}', '2023-04-01', 50); raise exception 'PASSÉE';
        exception when sqlstate '23514' then if sqlerrm <> 'L''exercice 2023 est figé par la validation de l''exercice 2024 : une échéance ne s''y ajoute plus.' then raise; end if; end;
        insert into cotisations_declarees (dossier_id, echeance, montant_appele) values ('{A}', '2025-11-01', 50); end $x$$q$, 'OK', ''],
    array['controle', '112. une échéance de 2024 venue d''un autre dossier', 'chef', $q$update cotisations_declarees set dossier_id = '{A}' where id = '{XC24}'$q$, '23514', 'L''exercice 2024 est validé : une échéance ne s''y ajoute plus.'],
    array['controle', '113. une échéance payée en 2024 ne quitte pas son dossier', 'chef', $q$update cotisations_declarees set dossier_id = '{X}' where id = '{C1}'$q$, '23514', 'L''exercice 2024 est validé : cette échéance ne change plus.'],
    array['controle', '114. des à-nouveaux posés après la validation', 'chef', $q$insert into a_nouveaux (dossier_id, date, compte, sens, montant, source_nom, source_empreinte) values ('{A}', '2024-01-01', '512000', 'debit', 1, 'essai.csv', repeat('a', 64))$q$, '23514', 'Un exercice de ce dossier est validé : son ouverture ne change plus.'],
    array['controle', '115. ni par enregistrer_a_nouveaux, qui remplace l''ouverture', 'chef', $q$select enregistrer_a_nouveaux('{A}', '2025-01-01', 'essai.csv', repeat('a', 64), '[{"compte":"512000","sens":"debit","montant":1},{"compte":"101000","sens":"credit","montant":1}]'::jsonb)$q$, '23514', 'Un exercice de ce dossier est validé : son ouverture ne change plus.'],
    array['controle', '116. ni venus d''un autre dossier', 'chef', $q$update a_nouveaux set dossier_id = '{A}' where id = '{XAN}'$q$, '23514', 'Un exercice de ce dossier est validé : son ouverture ne change plus.'],

    -- ══ Le maillon de l'exercice suivant ═══════════════════════════════════════════════════════════════════════════
    array['jeu', 'le mouvement de 2025 à traiter est ignoré', 'postgres', $q$update lignes_bancaires set statut = 'ignoree' where id = '{M7}'$q$, '', ''],
    -- 2025 s'ouvre sur les soldes reportés de 2024 : ses libellés partent avec sa numérotation, comme ceux d'à-nouveaux
    -- repris — l'application les compose (`numeroterFec`) ; l'essai reprend le libellé de chaque solde.
    array['controle', '117a. 2025 ne se valide pas sans les libellés de son ouverture', 'chef', $q$select valider_exercice('{A}', 2025, '[{"id":"{E16}","journal":"AC","numero":1,"piece_ref":"essai-p2.pdf","piece_date":"2025-02-01","compte_lib":"Achats"},{"id":"{E17}","journal":"AC","numero":1,"piece_ref":"essai-p2.pdf","piece_date":"2025-02-01","compte_lib":"Banque"}]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Les libellés proposés ne couvrent pas exactement les 3 à-nouveaux de l''exercice 2025.'],
    array['fait', '117. le chef valide 2025', 'chef', $q$select valider_exercice('{A}', 2025, '[{"id":"{E16}","journal":"AC","numero":1,"piece_ref":"essai-p2.pdf","piece_date":"2025-02-01","compte_lib":"Achats"},{"id":"{E17}","journal":"AC","numero":1,"piece_ref":"essai-p2.pdf","piece_date":"2025-02-01","compte_lib":"Banque"}]'::jsonb, (select jsonb_agg(jsonb_build_object('id', id, 'compte_lib', libelle, 'ecriture_lib', 'À-nouveau ' || libelle)) from soldes_reportes where dossier_id = '{A}' and date = '2025-01-01'), '{}'::jsonb)$q$, 'OK', ''],
    array['valeur', '118. 2025 porte l''empreinte de 2024, et se vérifie', 'postgres', $q$select (b.empreinte_precedente = a.empreinte)::text || '/' || verifier_exercice_valide('{A}', 2025)::text from exercices_valides a, exercices_valides b where a.dossier_id = '{A}' and a.annee = 2024 and b.dossier_id = '{A}' and b.annee = 2025$q$, '', 'true/true'],
    -- Les libellés de l'ouverture de 2025 sont posés, et 2026 s'ouvre sur 2025 : la perte de 30 au capital individuel,
    -- la banque à 230 + 30, l'amortissement inchangé.
    array['valeur', '118b. l''ouverture de 2025 porte ses libellés, et 2026 s''ouvre sur les soldes de fin de 2025', 'postgres', $q$select (select string_agg(compte || ':' || compte_lib || ':' || ecriture_lib, ',' order by compte collate "C") from soldes_reportes where dossier_id = '{A}' and date = '2025-01-01') || '/' || string_agg(compte || ':' || sens || ':' || montant || ':' || libelle, ',' order by compte collate "C") || '/' || min(source_nom) || '/' || bool_and(source_empreinte = (select empreinte from exercices_valides where dossier_id = '{A}' and annee = 2025)) from soldes_reportes where dossier_id = '{A}' and date = '2026-01-01'$q$, '',
      '101000:Capital individuel:À-nouveau Capital individuel,281830:Amortissements:À-nouveau Amortissements,512000:Banque:À-nouveau Banque/101000:debit:660.00:Capital individuel,281830:credit:400.00:Amortissements,512000:credit:260.00:Banque/Exercice 2025 validé/true'],
    array['jeu', 'casser le maillon de 2024', 'postgres', $q$update exercices_valides set empreinte = repeat('0', 64) where dossier_id = '{A}' and annee = 2024$q$, '', ''],
    array['valeur', '119. un maillon cassé se voit sur l''exercice suivant', 'postgres', $q$select verifier_exercice_valide('{A}', 2024)::text || '/' || verifier_exercice_valide('{A}', 2025)::text$q$, '', 'false/false'],

    -- ══ L'ordre, et l'engagement (F) ═══════════════════════════════════════════════════════════════════════════════
    array['jeu', 'écritures de 2023, non validées, dans F', 'postgres', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens) values
      ('{F}', '2023-05-01', '606100', 'ESSAI F', 10, 'debit'), ('{F}', '2023-05-01', '401000', 'ESSAI F', 10, 'credit')$q$, '', ''],
    array['controle', '120. les exercices se valident dans l''ordre', 'chef', $q$select valider_exercice('{F}', 2024, '[]'::jsonb, '[]'::jsonb, null)$q$, '23514', 'L''exercice 2023 porte des écritures qui ne sont pas validées : les exercices se valident dans l''ordre.'],
    array['controle', '121. en engagement, une 2035 est refusée', 'chef', $q$select valider_exercice('{F}', 2022, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Un dossier tenu en engagement n''a pas de 2035.'],
    array['fait', '122. en engagement, un exercice vide se valide sans 2035', 'chef', $q$select valider_exercice('{F}', 2022, '[]'::jsonb, '[]'::jsonb, null)$q$, 'OK', ''],
    array['valeur', '123. sans 2035, et marqué en engagement', 'postgres', $q$select mode_comptable || '/' || (declaration is null) || '/' || nb_lignes from exercices_valides where dossier_id = '{F}'$q$, '', 'engagement/true/0'],
    array['controle', '124. 2023 ne se saute pas', 'chef', $q$select valider_exercice('{F}', 2024, '[]'::jsonb, '[]'::jsonb, null)$q$, '23514', 'L''exercice 2023 n''est pas validé : les exercices se valident dans l''ordre.'],

    -- ══ L'ouverture (G, repris au 1er janvier 2025 ; H, au 1er janvier 2024) ═══════════════════════════════════════
    array['jeu', 'à-nouveaux de G', 'postgres', $q$insert into a_nouveaux (id, dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values
      ('{GAN1}', '{G}', '2025-01-01', '512000', 'Banque Populaire', 'debit', 10, 'balance-essai.csv', repeat('a', 64)),
      ('{GAN2}', '{G}', '2025-01-01', '101000', 'Capital', 'credit', 10, 'balance-essai.csv', repeat('a', 64))$q$, '', ''],
    array['jeu', 'un mouvement de G antérieur à son ouverture', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{GM}', '{G}', '2024-12-15', 'ESSAI AVANT OUVERTURE', -4, 'non_rapprochee')$q$, '', ''],
    array['jeu', 'écritures de G, deux en 2025 et deux antérieures à son ouverture', 'postgres', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values
      ('{GE1}', '{G}', '2025-05-01', '606100', 'ESSAI G', 10, 'debit'), ('{GE2}', '{G}', '2025-05-01', '512000', 'ESSAI G', 10, 'credit'),
      ('{GE3}', '{G}', '2024-06-01', '606100', 'ESSAI G AVANT', 3, 'debit'), ('{GE4}', '{G}', '2024-06-01', '512000', 'ESSAI G AVANT', 3, 'credit')$q$, '', ''],
    array['jeu', 'la numérotation de G 2025, écritures redatées comprises', 'postgres', $q$select set_config('essai.g', $j$[
      {"id":"{GE1}","journal":"AC","numero":1,"piece_ref":"essai-g1.pdf","piece_date":"2025-05-01","compte_lib":"Achats"},
      {"id":"{GE2}","journal":"AC","numero":1,"piece_ref":"essai-g1.pdf","piece_date":"2025-05-01","compte_lib":"Banque"},
      {"id":"{GE3}","journal":"AC","numero":2,"piece_ref":"essai-g2.pdf","piece_date":"2025-05-02","compte_lib":"Achats"},
      {"id":"{GE4}","journal":"AC","numero":2,"piece_ref":"essai-g2.pdf","piece_date":"2025-05-02","compte_lib":"Banque"}
    ]$j$, true)$q$, '', ''],
    array['controle', '125. un exercice antérieur à l''ouverture ne se valide pas', 'chef', $q$select valider_exercice('{G}', 2024, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'L''exercice 2024 précède l''ouverture du dossier : il est dans les comptes repris.'],
    array['controle', '126. des écritures antérieures à l''ouverture : les retirer ou les redater', 'chef', $q$select valider_exercice('{G}', 2025, current_setting('essai.g')::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514', 'Des écritures antérieures à l''ouverture du dossier ne sont pas validées : cette période est dans les comptes repris, les retirer ou les redater avant la validation.'],
    array['jeu', 'les écritures antérieures sont redatées, comme le refus le conseille', 'postgres', $q$update ecritures_brouillon set date = '2025-05-02' where id in ('{GE3}', '{GE4}')$q$, '', ''],
    array['controle', '127. un mouvement antérieur à l''ouverture reste à traiter', 'chef', $q$select valider_exercice('{G}', 2025, current_setting('essai.g')::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514', 'Des mouvements bancaires antérieurs à l''ouverture du dossier restent à traiter : les ignorer avant la validation.'],
    array['jeu', 'le mouvement antérieur est ignoré', 'postgres', $q$update lignes_bancaires set statut = 'ignoree' where id = '{GM}'$q$, '', ''],
    array['controle', '128. les libellés des à-nouveaux manquent', 'chef', $q$select valider_exercice('{G}', 2025, current_setting('essai.g')::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '22023', 'Les libellés proposés ne couvrent pas exactement les 2 à-nouveaux de l''exercice 2025.'],
    array['controle', '129. un à-nouveau sans libellé d''écriture', 'chef', $q$select valider_exercice('{G}', 2025, current_setting('essai.g')::jsonb, '[{"id":"{GAN1}","compte_lib":"Banque","ecriture_lib":" "},{"id":"{GAN2}","compte_lib":"Capital","ecriture_lib":"À-nouveau Capital"}]'::jsonb, '{}'::jsonb)$q$, '22023', 'Un à-nouveau proposé est incomplet.'],
    array['controle', '130. la banque nommée autrement dans les à-nouveaux', 'chef', $q$select valider_exercice('{G}', 2025, current_setting('essai.g')::jsonb, '[{"id":"{GAN1}","compte_lib":"Banque Populaire","ecriture_lib":"À-nouveau Banque Populaire"},{"id":"{GAN2}","compte_lib":"Capital","ecriture_lib":"À-nouveau Capital"}]'::jsonb, '{}'::jsonb)$q$, '22023', 'Un même compte porte deux libellés.'],
    array['fait', '131. le chef valide 2025 avec ses à-nouveaux', 'chef', $q$select valider_exercice('{G}', 2025, current_setting('essai.g')::jsonb, '[{"id":"{GAN1}","compte_lib":"Banque","ecriture_lib":"À-nouveau Banque Populaire"},{"id":"{GAN2}","compte_lib":"Capital","ecriture_lib":"À-nouveau Capital"}]'::jsonb, '{}'::jsonb)$q$, 'OK', ''],
    array['valeur', '132. les à-nouveaux portent leurs libellés, l''exercice ses quatre lignes', 'postgres', $q$select string_agg(compte || ':' || compte_lib || ':' || ecriture_lib, ',' order by compte collate "C") || '/' || (select nb_lignes || '-' || nb_ecritures from exercices_valides where dossier_id = '{G}') from a_nouveaux where dossier_id = '{G}'$q$, '', '101000:Capital:À-nouveau Capital,512000:Banque:À-nouveau Banque Populaire/4-2'],
    -- Une ouverture reprise se reporte comme une autre : le capital repris (10) reçoit la perte de 2025 (13), sous le
    -- libellé que 2025 lui a figé ; la banque garde le sien, pas celui de la balance reprise.
    array['valeur', '132b. 2026 s''ouvre sur les soldes de fin de 2025, ouverture reprise comprise', 'postgres', $q$select string_agg(compte || ':' || sens || ':' || montant || ':' || libelle, ',' order by compte collate "C") || '/' || min(date) from soldes_reportes where dossier_id = '{G}'$q$, '',
      '101000:debit:3.00:Capital,512000:credit:3.00:Banque/2026-01-01'],
    array['controle', '133. l''ouverture validée ne change plus', 'chef', $q$update a_nouveaux set libelle = 'x' where id = '{GAN1}'$q$, '23514', 'Un exercice de ce dossier est validé : son ouverture ne change plus.'],
    array['controle', '134. ni ne quitte son dossier', 'chef', $q$update a_nouveaux set dossier_id = '{X}' where id = '{GAN2}'$q$, '23514', 'Un exercice de ce dossier est validé : son ouverture ne change plus.'],
    array['jeu', 'falsifier un libellé d''à-nouveau hors déclencheur', 'postgres', $q$set local session_replication_role = replica$q$, '', ''],
    array['jeu', '', 'postgres', $q$update a_nouveaux set ecriture_lib = 'falsifié' where id = '{GAN2}'$q$, '', ''],
    array['jeu', '', 'postgres', $q$set local session_replication_role = origin$q$, '', ''],
    array['valeur', '135. un libellé d''à-nouveau falsifié se voit', 'postgres', $q$select verifier_exercice_valide('{G}', 2025)::text$q$, '', 'false'],
    array['jeu', 'à-nouveaux de H, au 1er janvier 2024', 'postgres', $q$insert into a_nouveaux (id, dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte) values
      ('{HAN1}', '{H}', '2024-01-01', '512000', 'Banque', 'debit', 5, 'balance-essai-h.csv', repeat('b', 64)),
      ('{HAN2}', '{H}', '2024-01-01', '101000', 'Capital', 'credit', 5, 'balance-essai-h.csv', repeat('b', 64))$q$, '', ''],
    array['controle', '136. l''exercice des à-nouveaux se valide d''abord', 'chef', $q$select valider_exercice('{H}', 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)$q$, '23514', 'L''exercice 2024 porte les à-nouveaux du dossier : il se valide d''abord.'],
    array['fait', '137. 2024, sans écriture, se valide avec ses à-nouveaux', 'chef', $q$select valider_exercice('{H}', 2024, '[]'::jsonb, '[{"id":"{HAN1}","compte_lib":"Banque","ecriture_lib":"À-nouveau Banque"},{"id":"{HAN2}","compte_lib":"Capital","ecriture_lib":"À-nouveau Capital"}]'::jsonb, '{}'::jsonb)$q$, 'OK', ''],
    array['fait', '138. puis 2025', 'chef', $q$select valider_exercice('{H}', 2025, '[]'::jsonb, (select jsonb_agg(jsonb_build_object('id', id, 'compte_lib', libelle, 'ecriture_lib', 'À-nouveau ' || libelle)) from soldes_reportes where dossier_id = '{H}' and date = '2025-01-01'), '{}'::jsonb)$q$, 'OK', ''],
    array['valeur', '139. la chaîne de H tient', 'postgres', $q$select (b.empreinte_precedente = a.empreinte)::text || '/' || verifier_exercice_valide('{H}', 2024)::text || '/' || verifier_exercice_valide('{H}', 2025)::text from exercices_valides a, exercices_valides b where a.dossier_id = '{H}' and a.annee = 2024 and b.dossier_id = '{H}' and b.annee = 2025$q$, '', 'true/true/true'],
    -- Sans écriture, l'ouverture se reporte telle quelle d'un exercice sur l'autre.
    array['valeur', '139b. H s''ouvre en 2025 puis en 2026 sur les soldes de sa reprise', 'postgres', $q$select string_agg(to_char(date, 'YYYY') || ':' || compte || ':' || sens || ':' || montant || ':' || libelle, ',' order by date, compte collate "C") from soldes_reportes where dossier_id = '{H}'$q$, '',
      '2025:101000:credit:5.00:Capital,2025:512000:debit:5.00:Banque,2026:101000:credit:5.00:Capital,2026:512000:debit:5.00:Banque'],

    -- ══ Ce que le catalogue dit, faute de pouvoir le jouer ═════════════════════════════════════════════════════════
    array['valeur', '140. chaque déclencheur figeant refuse aussi la suppression, et il est actif', 'postgres', $q$select string_agg(c.relname || ':' || ((t.tgtype & 8) <> 0)::text || ':' || t.tgenabled::text, ',' order by c.relname collate "C") from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname in ('ecritures_brouillon_intangibles', 'pieces_figees_par_la_validation', 'lignes_bancaires_figees_par_la_validation', 'ventilations_bancaires_figees_par_la_validation', 'reglements_groupes_figes_par_la_validation', 'immobilisations_figees_par_la_validation', 'vehicules_figes_par_la_validation', 'cotisations_declarees_figees_par_la_validation', 'a_nouveaux_figes_par_la_validation', 'declarations_tva_figees_par_la_validation', 'soldes_reportes_ecrits_par_la_validation')$q$, '',
      'a_nouveaux:true:O,cotisations_declarees:true:O,declarations_tva:true:O,ecritures_brouillon:true:O,immobilisations:true:O,lignes_bancaires:true:O,pieces:true:O,reglements_groupes:true:O,soldes_reportes:true:O,vehicules:true:O,ventilations_bancaires:true:O'],
    array['valeur', '141. chacun laisse passer la cascade d''un dossier qu''on supprime', 'postgres', $q$select string_agg(p.proname, ',' order by p.proname collate "C") from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'garder%' and p.prosrc like '%not exists (select 1 from public.dossiers where id = old.dossier_id)%'$q$, '',
      'garder_a_nouveaux_valides,garder_bien_valide,garder_cotisation_valide,garder_declaration_valide,garder_ecritures_validees,garder_mouvement_valide,garder_parts_mouvement_valide,garder_piece_validee,garder_soldes_reportes,garder_vehicule_valide'],
    array['valeur', '142. un exercice validé part avec son dossier', 'postgres', $q$select string_agg(confdeltype::text, ',') from pg_constraint where conrelid = 'public.exercices_valides'::regclass and contype = 'f'$q$, '', 'c'],
    array['valeur', '143. les droits d''exécution (anonyme, connecté)', 'postgres', $q$select string_agg(f || ':' || has_function_privilege('anon', 'public.' || f || a, 'execute') || ':' || has_function_privilege('authenticated', 'public.' || f || a, 'execute'), ',' order by f collate "C") from (values
      ('valider_exercice', '(uuid, integer, jsonb, jsonb, jsonb)'), ('verifier_exercice_valide', '(uuid, integer)'), ('empreinte_exercice', '(uuid, integer, text)'),
      ('cle_validation', '(uuid)'), ('frontiere_validation', '(uuid)'), ('exercice_fige', '(uuid, integer)'), ('garder_ecritures_validees', '()'),
      ('garder_soldes_reportes', '()'), ('soldes_a_reporter', '(uuid, integer)')) as t(f, a)$q$, '',
      'cle_validation:false:false,empreinte_exercice:false:true,exercice_fige:false:false,frontiere_validation:false:false,garder_ecritures_validees:false:false,garder_soldes_reportes:false:false,soldes_a_reporter:false:false,valider_exercice:false:true,verifier_exercice_valide:false:true'],
    array['valeur', '144. un exercice validé est lu par le cabinet, réinséré par le super-administrateur, jamais modifié', 'postgres', $q$select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '+'), ',' order by policyname collate "C") from pg_policies where schemaname = 'public' and tablename = 'exercices_valides'$q$, '',
      'exercices_valides_lecture:SELECT:authenticated,exercices_valides_restauration:INSERT:authenticated']
  ];

  begin
    foreach etape slice 1 in array etapes loop
      s := etape[4];
      for cle, valeur in select key, value from jsonb_each_text(ids) loop
        s := replace(s, '{' || cle || '}', valeur);
      end loop;
      accepte := false; code_recu := null; message := null; obs := null;
      if etape[1] = 'jeu' then
        begin
          execute s;
        exception when others then
          verdicts := verdicts || jsonb_build_object('controle', '0. le jeu : ' || etape[2], 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
        end;
      elsif etape[1] = 'valeur' then
        begin
          execute s into obs;
        exception when others then obs := sqlstate || ' ' || sqlerrm;
        end;
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, '∅'), 'ok', coalesce(obs = etape[6], false));
      else
        begin
          if etape[3] <> 'postgres' then
            execute format('set local role %I', case when etape[3] = 'anon' then 'anon' else 'authenticated' end);
            perform set_config('request.jwt.claims', case when etape[3] = 'anon' then json_build_object('role', 'anon')::text
              else json_build_object('sub', case etape[3] when 'chef' then chef when 'client' then client else inconnu end,
                                     'role', 'authenticated')::text end, true);
          end if;
          execute s;
          accepte := true;
          if etape[1] = 'controle' then
            raise exception 'ANNULATION_ESSAI';
          end if;
        exception when others then code_recu := sqlstate; message := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        verdicts := verdicts || jsonb_build_object('controle', etape[2],
          'observe', case when accepte then 'accepté' else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
          'ok', case when etape[5] = 'OK' then accepte and (etape[1] = 'fait' or coalesce(code_recu = 'P0001', false))
                     else not accepte and coalesce(code_recu = etape[5] and message like etape[6], false) end);
      end if;
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      verdicts := verdicts || jsonb_build_object('controle', '0. le déroulé de l''essai', 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- ══ 145. Rien n'est resté ════════════════════════════════════════════════════════════════════════════════════════
  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from cabinets)), ((select count(*) from cabinet_admins)),
    ((select count(*) from pieces)), ((select count(*) from lignes_bancaires)), ((select count(*) from ecritures_brouillon)),
    ((select count(*) from immobilisations)), ((select count(*) from vehicules)), ((select count(*) from cotisations_declarees)),
    ((select count(*) from a_nouveaux)), ((select count(*) from exercices_valides)), ((select count(*) from dossier_assignations)),
    ((select count(*) from soldes_reportes))
  ) as t(n);
  verdicts := verdicts || jsonb_build_object('controle', '145. rien n''est resté en base',
    'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI VALIDATION%')
      and not exists (select 1 from cabinet_admins where user_id = client)
      and current_setting('session_replication_role') = 'origin');

  perform set_config('essai.validation', verdicts::text, true);
end $essai$;

select v.controle, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.validation')::jsonb) as v(controle text, ok boolean, observe text)
order by (regexp_match(v.controle, '^(\d+)'))[1]::int, v.controle;
