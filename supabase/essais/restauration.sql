-- Essai de restauration — à rejouer, pas à lire.
--
-- Une sauvegarde jamais restaurée n'est pas une sauvegarde, et un essai fait une fois ne prouve rien
-- du mois suivant. Les tests Vitest rejouent l'ORDRE et les CONTRÔLES à chaque exécution de la suite,
-- mais ils ne peuvent pas rejouer Postgres : ni les clés étrangères, ni les CHECK, ni le refus d'un
-- lien vers une ligne absente. C'est ce que fait ce script.
--
-- Il ne touche à rien : il fabrique un schéma jetable qui porte les VRAIES contraintes (copiées de
-- `public` par pg_get_constraintdef) et la génération des colonnes que la base calcule, y restaure un dossier table par
-- table dans l'ordre de ORDRE_RESTAURATION, compare le résultat à la source par empreinte de contenu, puis se supprime.
--
-- LE PLAN EST CELUI DE `src/lib/sauvegarde.ts`, recopié et non résumé : l'ordre (`_ordre`), le chemin
-- de chaque table (`_chemins`), les liens auto-référencés restaurés par vagues (`_vagues`) et les colonnes
-- générées que la restauration n'écrit pas (`_generees`).
-- `src/lib/restaurationEssai.test.ts` les confronte au code à chaque exécution de la suite : si les
-- deux divergent, c'est l'essai qui ment — c'est le code qui restaure en production.
--
-- LES VAGUES. Une ligne d'une table de `_vagues` part quand chacun de ses liens est vide, pointe hors du
-- dossier ou pointe une ligne déjà écrite — une instruction par vague, comme `planReinsertion`. Postgres
-- vérifie une clé étrangère à la fin de chaque instruction : une vague qui écrirait une ligne avant celle
-- qu'elle désigne échoue ici. Ce que l'essai ne voit PAS : tout écrire en une seule instruction, que
-- Postgres accepte, mais que les gardes de la révision et des encaissements refuseraient (l'ordre des
-- lignes à l'intérieur d'une instruction n'est pas garanti) — `sauvegardeDonnees.test.ts` et les essais
-- de ces mécanismes le gardent. L'avoir et sa facture d'origine gardent leurs deux passes.
--
-- LES COLONNES GÉNÉRÉES. Les tables d'essai portent la génération des colonnes que la base calcule (`including
-- generated`) : comme la base d'arrivée, elles refusent qu'une insertion en nomme une (428C9), même NULL, et avant d'avoir
-- lu une ligne. Chaque insertion de la restauration nomme donc ses colonnes — toutes, SAUF celles que le code retire
-- (`_generees`, recopiée de COLONNES_GENEREES), comme `planReinsertion` les ôte de chaque ligne envoyée. Une colonne
-- générée oubliée de la liste arrête l'essai sur sa table, le code de l'erreur dans la ligne ARRET ; les contrôles qui
-- suivent le verdict disent que la liste est celle du catalogue, que la colonne d'essai est générée comme dans la base, et
-- que chaque ligne restaurée y porte la valeur que la base vient de recalculer, égale à celle de la source.
--
-- OÙ IL SE JOUE : sur une réplique locale du schéma (HISTORIQUE.md, « LA RÉPLIQUE : LE PROCÉDÉ »), par
-- psql, sur un dossier qu'on y a semé. Il crée et supprime un schéma : l'outil d'exécution de la
-- production soumet une suppression à une confirmation qui n'arrive pas, et un schéma jetable qui
-- recopie les données d'un dossier n'a rien à faire dans la base du cabinet.
--
-- Ce qu'il NE prouve PAS, et qu'il faut savoir :
--   - Rien sur les comptes utilisateurs. Les clés étrangères vers `auth.users` sont volontairement
--     exclues, comme dans RELATIONS. Or quatre colonnes du plan sont NOT NULL vers cette table
--     (dossier_assignations.user_id, memberships.user_id, packs.generated_by, et cabinet_admins
--     hors plan) : sans les comptes, une vraie restauration s'arrête là, et aucun essai de ce
--     script ne le montrera. Voir PREREQUIS_AUTH.
--   - Rien sur les fichiers du stockage, qui ne sont pas des lignes de base.
--   - Rien sur les policies RLS : ce script tourne en propriétaire.
--   - Rien sur les DÉCLENCHEURS, que la copie d'une table n'emporte pas : ce que les gardes refusent
--     à la restauration — une décision de la révision avant sa cible, une preuve avant sa source, un
--     exercice validé posé trop tôt — est éprouvé par les essais de leur mécanisme (revisionSoldes.sql,
--     encaissementsFactures.sql, validationExercice.sql) et par `sauvegardeDonnees.test.ts`.
--
-- Passage du 18/09/2026, en production par `execute_sql`, section par section (40 tables), dossier
-- 001c7ed7-c23b-4590-901e-693489f8af24 :
--   40 tables recréées, 57 clés étrangères, 35 tables restaurées et IDENTIQUES à la source
--   (empreinte du contenu, pas seulement le compte), 0 écart, 4 contrôles de liens intacts
--   (10 mouvements rapprochés, 41 pièces en sous-dossier, 3 pièces catégorisées, 41 textes OCR).
--
-- Passage du 09/10/2026, sur la réplique locale de l'étape R1 de la ligne 41 (signature.sql : les neuf
-- familles égales à la production, migration `revision_des_soldes` comprise), le dossier `test` de la
-- réplique semé de deux pièces, un document, quatre écritures, l'exercice 2024 validé et cinq décisions de
-- la révision — une chaîne de trois sur 2024 et 2025, une reprise, quatre preuves — par les fonctions
-- de la base : 58 tables recréées, 53 restaurées et IDENTIQUES à la source (20 lignes), les décisions en
-- quatre vagues, 0 écart, aucun arrêt.
--
-- 09/10/2026, espace client P0 : `notes_internes` entre au plan (59 tables), après les pièces et les documents
-- qu'elle annote. Le script n'a PAS été rejoué depuis — aucune réplique complète n'était montée ; ce que la
-- restauration fait des anciennes colonnes des notes (`sansAnciennesNotes`, en TypeScript) n'est pas de son ressort :
-- il recopie des lignes, il ne les transforme pas.
--
-- 10/10/2026, ligne 28.5, étape e2 : `pieces_hors_de_france` et `pieces_hors_de_france_taux` entrent au plan (61 tables),
-- après les notes internes et avant le brouillon, les versions de la fiche par vagues (`remplace_id`). Rejoué sur la
-- réplique locale de l'étape (signature.sql : les neuf familles égales à la production, hors des objets de deux
-- migrations d'autres chantiers), le dossier `test` semé par les fonctions de la base — trois pièces, cinq fiches dont
-- une chaîne de trois versions et deux retirées, six lignes de ventilation : 61 tables recréées, 56 restaurées et
-- IDENTIQUES à la source (15 lignes), les fiches en trois vagues, 0 écart, aucun arrêt. Planté — la ventilation avant
-- sa fiche —, le script s'arrête sur la clé.
--
-- 10/10/2026, ligne 43, étape PC1 : le catalogue des rôles comptables entre à l'ordre (rang 4, référentiel `global` que
-- la base d'arrivée doit porter, comme le cabinet : il est recopié ci-dessous en prérequis) et le plan d'un dossier juste
-- après son dossier (61 tables) ; le contrôle du point NON VÉRIFIÉ 7 suit le verdict. Rejoué sur la réplique locale de
-- l'étape (signature.sql : les neuf familles égales à la production, migration `plan_comptable_des_dossiers` comprise),
-- dans une transaction annulée, le dossier `test` semé du plan fictif décalé — 26 rôles, posés par la seule porte
-- ouverte, le propriétaire sous la session du super-administrateur — puis de deux écritures ; la réplique portant, comme
-- la production, les deux tables de l'étape e2, le script joué leur ajoutait leurs lignes de l'ordre, des chemins et des
-- vagues telles que le correctif d'e2 les écrit : 63 tables recréées, 57 restaurées et IDENTIQUES à la source (29
-- lignes, dont les 26 du plan au rang 7), 0 écart, aucun arrêt ; un rôle inconnu de la base d'arrivée refusé par la clé
-- (23503), la même ligne acceptée une fois le rôle inscrit. Plantés — le catalogue absent de la base d'arrivée, puis le
-- plan avant son dossier —, le script s'arrête sur la clé du plan. Ce que la garde exige à la restauration (le
-- super-administrateur, un dossier encore sans écriture) n'est pas de son ressort : `planComptable.sql`.
--
-- 10/10/2026, espace client P7 : `justificatifs_proposes` et `precisions_mouvements` entrent au plan (63 tables), après
-- les mouvements et les pièces qu'elles désignent, avant `exercices_valides` — la migration `banque_du_client`,
-- appliquée en production le même jour. Rejoué sur la réplique de l'étape (signature.sql : les neuf familles égales à
-- la production, hors des objets de `plan_comptable_des_dossiers`, chantier PC1, dont les tables n'entrent pas au plan
-- de cette version), sur le dossier du client, semé PAR LES FONCTIONS de deux propositions du client — dont une
-- retirée par le cabinet — et de deux précisions (client, cabinet) : 63 tables recréées, 58 restaurées et IDENTIQUES
-- à la source (43 lignes, dont les quatre de l'étape), 0 écart, aucun arrêt. Plantées — une proposition, puis une
-- précision, avant les mouvements —, le script s'arrête sur leur clé.
--
-- 10/10/2026, espace client P5 (migrations préparées, NON appliquées) : `devis_numerotation`, `devis` et `devis_factures`
-- entrent au plan quand leurs tables existent (le bloc « Les devis », ci-dessous), juste avant `exercices_valides` et
-- après les registres de P7, comme le code les y met quand `DEVIS_EXPORTES` est levé. Rejoué sur une réplique en UTF8
-- égale à la production à 112 migrations (signature.sql, neuf familles), plus les deux de l'étape P2 et les deux de
-- celle-ci, le dossier `test` semé par les fonctions de la base (cinq devis : accepté puis transformé en facture,
-- refusé, en attente, un de 2025, un brouillon ; deux séries ; un lien) : 68 tables recréées, 62 restaurées et
-- IDENTIQUES à la source (28 lignes), 0 écart, aucun arrêt, les deux contrôles du catalogue des rôles justes ; sans les
-- migrations des devis, 65 tables, le plan d'hier. Planté — le lien avant son devis —, le script s'arrête sur la clé.
-- À 113 migrations (`revision_des_cycles`, appliquée le même jour), il s'arrête à la copie des clés : les tables de
-- la révision par cycle ne sont pas encore au plan de ce fichier.
--
-- 10/10/2026, ligne 41, étape R4 : `revision_conclusions`, `revision_notes` et `revision_revues` entrent au plan (68 tables,
-- 71 avec les devis), après les décisions de la révision et avant les registres de P7, les conclusions par vagues
-- (`remplace_id`), leurs revues après elles. Rejoué sur une copie de la réplique locale de l'étape, égale à la production
-- à 114 migrations (signature.sql : les neuf familles ; la seconde migration de P7 comprise, celles des devis absentes),
-- le dossier `test` semé par les fonctions de la base — une chaîne de trois conclusions dont deux revues, une conclusion
-- revue d'un autre cycle, une d'un autre exercice, trois notes du journal : 68 tables recréées, 62 restaurées et
-- IDENTIQUES à la source (12 lignes), les conclusions en trois vagues, 0 écart, aucun arrêt, les deux contrôles du
-- catalogue des rôles justes. Planté — les revues avant leurs conclusions —, le script s'arrête sur la clé.
--
-- 10/10/2026, espace client, étape P2 (`ventes_du_client` et `ventes_du_client_facturation`, en production) : aucune
-- table de plus, deux colonnes — `factures_emises.valide_par` et `transmissions_factures.cree_par`, sans clé vers
-- `auth.users`, donc aucun prérequis de compte de plus — ; le plan ne change pas, la sauvegarde recopiant des lignes
-- entières. Rejoué sur une copie de la réplique de l'étape, égale à la production à 116 migrations (signature.sql, neuf
-- familles), le dossier `test` semé, sa facture validée portant un `valide_par` et sa transmission un `cree_par` (posés
-- sur la copie, les gardes écartées le temps de semer) : 68 tables recréées, 119 clés recopiées, 62 restaurées et
-- IDENTIQUES à la source (18 lignes), 0 écart, aucun arrêt, les deux contrôles du catalogue des rôles justes. L'une ou
-- l'autre colonne effacée dans le schéma d'essai avant le verdict, sa table seule vire à l'ÉCART : la comparaison les voit.
--
-- 11/10/2026, ligne 41, étape R5 (migration `revue_analytique`, préparée, non appliquée) : `revision_seuils` et
-- `revision_explications` entrent au plan (70 tables, 73 avec les devis), après les cycles de la révision et avant les
-- registres de P7, leurs deux chaînes par vagues (`remplace_id`). Rejoué sur une copie de la réplique de l'étape, égale à
-- la production à 116 migrations (signature.sql, neuf familles), la migration appliquée, le dossier `test` semé par les
-- fonctions de la base — une chaîne de trois seuils et un seuil d'un autre exercice, une chaîne de trois explications du
-- résultat, une d'un poste, une d'un compte : 70 tables recréées, 123 clés recopiées, 64 restaurées et IDENTIQUES à la
-- source, les seuils et les explications en trois vagues chacun, 0 écart, aucun arrêt, les deux contrôles du catalogue
-- des rôles justes. Planté — un seuil avant son dossier —, le script s'arrête sur la clé. Sans la migration, ce fichier
-- s'arrête à la création de son schéma d'essai : la table `revision_seuils` n'existe pas encore.
--
-- 11/10/2026, ligne 28.5, étape e5a (migration `regimes_ereporting_et_pieces_ecartees`, préparée, à appliquer AVANT
-- que ce fichier ne soit fusionné) : `regimes_ereporting` et `pieces_ecartees_ereporting` entrent au plan
-- (70 tables, 73 avec les devis), après les registres de P7 et avant `exercices_valides`, sans vague (rien ne s'y
-- référence) ; seul le rang d'`exercices_valides` change. Rejoué sur la réplique de l'étape, égale à la production à 116
-- migrations plus celle-ci (signature.sql, neuf familles), le dossier `test` semé PAR LES FONCTIONS de trois régimes —
-- dont un retiré puis confirmé de nouveau le même jour — et de quatre écarts — dont un repris puis posé de nouveau — :
-- 70 tables recréées, 122 clés recopiées, 64 restaurées et IDENTIQUES à la source (62 lignes, dont les sept de l'étape),
-- 0 écart, aucun arrêt, les deux contrôles du catalogue des rôles justes. Plantés — un écart, puis un régime, avant son
-- dossier —, le script s'arrête sur leur clé. Sur une base qui n'a pas la migration, il s'arrête dès la création de ses
-- tables d'essai, en nommant la table absente.
--
-- 11/10/2026, les deux migrations appliquées en production (`revue_analytique`, 20261011090828, puis
-- `regimes_ereporting_et_pieces_ecartees`, 20261011091325) : 72 tables au plan (75 avec les devis), chaque étape à sa
-- place — la revue analytique après les cycles de la révision, le régime et l'écart après les registres de P7. Rejoué
-- sur une réplique dont `signature.sql` égale la production à 118 migrations, le dossier `test` semé par les fonctions
-- de la base des lignes des deux étapes (quatre seuils, cinq explications, trois régimes dont un retiré, quatre écarts
-- dont un repris) : 72 tables recréées, 126 clés recopiées, 66 restaurées et IDENTIQUES à la source (71 lignes), les
-- seuils et les explications en trois vagues chacun, 0 écart, aucun arrêt, les deux contrôles du catalogue des rôles
-- justes. Plantés — un seuil, puis un écart, avant leur dossier —, le script s'arrête sur leur clé.
--
-- 11/10/2026, ligne 28.5, étape e5b1 (migration `declarations_ereporting`, préparée, à appliquer AVANT que ce fichier
-- ne soit fusionné) : `declarations_ereporting` et `declarations_ereporting_sources` entrent au plan (74 tables, 77 avec
-- les devis), après le régime et l'écart et avant `exercices_valides`, les déclarations par vagues (`remplace_id` : une
-- rectificative après la déclaration qu'elle remplace, déjà « remplacée ») ; seul le rang d'`exercices_valides` change.
-- Rejoué sur la réplique de l'étape, égale à la production à 118 migrations plus celle-ci (signature.sql, neuf familles),
-- le dossier `test` semé PAR LES FONCTIONS (à l'horloge du serveur avancée : une période ne se déclare que finie) d'un
-- régime, de trois fiches, des achats de septembre 2027 — l'initiale remplacée par une rectificative — et de ceux
-- d'octobre : 74 tables recréées, 131 clés recopiées, 68 restaurées et IDENTIQUES à la source (72 lignes), les
-- déclarations en deux vagues, 0 écart, aucun arrêt, les deux contrôles du catalogue des rôles justes. Plantés — une
-- déclaration avant son régime, une source avant sa déclaration —, le script s'arrête sur leur clé. Ce script recopie les
-- clés, pas les gardes : la réinsertion par la porte du super-administrateur, gardes comprises (l'empreinte recalculée
-- sur le contenu relu en JSON, la rectificative après ce qu'elle remplace), a été jouée à part sur la même réplique —
-- lignes relues identiques ; la rectificative d'abord, la garde la refuse.
--
-- 11/10/2026, une colonne GÉNÉRÉE (défaut relevé à l'étape e5b1) : `piece_textes_ocr.texte_md5`, l'empreinte du texte
-- lu, que la base calcule, faisait refuser (428C9) toute restauration par l'application d'un dossier qui avait un texte
-- lu — et ce script ne le voyait pas, ses tables d'essai étant créées sans la génération : sur la réplique ci-dessous, il
-- rendait 68 tables IDENTIQUES. Elles la portent, et il rejoue le retrait du code (`_generees`, `_colonnes`). Rejoué sur
-- une réplique égale à la production à 119 migrations (signature.sql, neuf familles), le dossier `test` semé de trois
-- pièces, d'un document et de trois textes lus, dont deux ne diffèrent que par leurs blancs : 74 tables recréées, 131
-- clés recopiées, 68 restaurées et IDENTIQUES à la source (8 lignes), 0 écart, aucun arrêt, les trois empreintes
-- recalculées égales à la source, les contrôles du catalogue des rôles justes. Puis sur une copie de la réplique semée de
-- l'étape e5b1, les mêmes textes lus, une facture et son avoir en plus : 68 IDENTIQUES (78 lignes), les déclarations en
-- deux vagues, la double passe des avoirs, 0 écart. Plantés — la colonne retirée de `_generees`, la génération retirée
-- des tables d'essai, une colonne inventée dans la liste, les textes avant leurs pièces —, le script s'arrête sur
-- `piece_textes_ocr` en 428C9, puis en ÉCART (empreintes vides), puis en ÉCART sur la colonne inventée, puis sur la clé
-- (23503) ; chaque fois un contrôle le dit.
--
-- 11/10/2026, ligne 41, étape R7 (migration `dossier_permanent`, appliquée le 12/10/2026 sous la version
-- `20261012070920`, avant la fusion de ce fichier) : `dossier_permanent` entre au plan (75 tables, 78 avec les devis),
-- après les déclarations d'e-reporting et avant `exercices_valides`, ses versions par vagues (`remplace_id` : une
-- version après celle qu'elle remplace) ; seul le rang d'`exercices_valides` change. La pièce ou le document qu'une
-- entrée cite est un lien SANS CLÉ, que sa garde lit (`LIENS_GARDES`) : il est plus haut dans l'ordre, et ce script ne
-- le voit pas. Rejoué sur la réplique de l'étape, égale à la production à 125 migrations plus celle-ci (signature.sql,
-- neuf familles), le dossier `test` semé PAR LES FONCTIONS d'une lettre de mission en trois versions, d'un bail et d'un
-- contrat qui citent une pièce, de statuts qui citent un document puis retirés et d'une description, et de deux textes
-- lus : 75 tables recréées, 133 clés recopiées, 69 restaurées et IDENTIQUES à la source (68 lignes, dont les sept
-- entrées en trois vagues), 0 écart, aucun arrêt, les contrôles du catalogue des rôles et de la colonne générée justes
-- (2 sur 2). Planté — une entrée avant son dossier —, le script s'arrête sur sa clé (23503). Sur une base qui n'a pas
-- la migration, il s'arrête dès la création de ses tables d'essai, en nommant la table absente. La réinsertion par la
-- porte du super-administrateur, gardes comprises, a été jouée à part sur la même réplique, sur un dossier jetable :
-- six entrées en trois vagues, dont une retirée et trois citations, relues identiques après la cascade du dossier et
-- l'aller-retour JSON ; la suite d'abord, la garde la refuse (« … en remplace une de son dossier. ») ; l'entrée avant
-- la pièce qu'elle cite aussi (« … cite une pièce de son dossier. ») ; un autre compte, la policy de restauration.
--
-- 13/10/2026, ligne 22.7 (migration `pieces_jointes_ecartees`, préparée, non appliquée) : `pieces_jointes_ecartees`
-- entre au plan (76 tables, 79 avec les devis), après le dossier permanent et avant `exercices_valides`, sans vague ;
-- seuls les rangs des devis et d'`exercices_valides` changent. Rejoué sur la réplique de l'étape, égale à la production à
-- 127 migrations plus celle-ci (signature.sql, neuf familles, et l'historique), le dossier `test` portant deux pièces
-- jointes écartées dont une marquée vue par `marquer_pieces_jointes_vues` : 134 clés recopiées, 70 tables restaurées et
-- IDENTIQUES à la source (les deux lignes comprises), 0 écart, aucun arrêt, les contrôles du catalogue des rôles et de la
-- colonne générée justes. Planté — la table avant son dossier —, le script s'arrête sur sa clé (23503). Sur une base qui
-- n'a pas la migration, il s'arrête dès la création de ses tables d'essai, en nommant la table absente.
--
-- 13/10/2026, espace client, étape A1 (migration `articles`, préparée, non appliquée) : `articles` entre au plan par son
-- bloc à part dès que sa table existe (77 tables, 80 avec les devis), juste après `agent_conversations` — après le dossier,
-- avant les factures, dont une ligne désignera son article à l'étape A7 —, les tables qui suivent reculant d'un rang.
-- Rejoué sur la réplique de l'étape, égale à la production à 131 migrations plus celle-ci (signature.sql, neuf familles,
-- et l'historique), le dossier `test` portant trois articles posés par leurs fonctions (un retiré, un modifié) : 135 clés
-- recopiées, 71 tables restaurées et IDENTIQUES à la source (les trois articles compris), 0 écart, aucun arrêt, les
-- contrôles du catalogue des rôles et de la colonne générée justes. Planté — les articles ancrés avant le dossier —, le
-- script s'arrête sur leur clé (23503). Sur une base qui n'a pas la migration, rien n'entre : le plan est celui d'hier.
--
-- 14/10/2026, espace client, étape A6a (migration `adresses_reception`, préparée, non appliquée) : `adresses_reception`
-- entre au plan par son bloc à part dès que sa table existe (78 tables, 81 avec les devis), juste avant
-- `exercices_valides` — après les pièces jointes écartées, avant les devis —, par VAGUES (`remplace_id`) ; seuls les rangs
-- des devis et d'`exercices_valides` changent. Rejoué sur la réplique de l'étape, égale à la production à 132 migrations
-- plus celle-ci (signature.sql, neuf familles, et l'historique), le dossier `test` portant trois adresses déclarées par
-- leur fonction (une chaîne de trois versions) : 137 clés recopiées, 72 tables restaurées et IDENTIQUES à la source (69
-- lignes, dont les trois adresses en trois vagues), 0 écart, aucun arrêt, les contrôles du catalogue des rôles et de la
-- colonne générée justes. Planté — les adresses ancrées avant le dossier —, le script s'arrête sur leur clé (23503).
-- Sur une base qui n'a pas la migration, rien n'entre : le plan est celui d'hier (135 clés, 71 tables IDENTIQUES).
--
-- 15/10/2026, espace client, étape A4a (migration `contacts`, préparée, non appliquée) : `contacts` entre au plan par son
-- bloc à part dès que sa table existe (79 tables, 82 avec les devis), juste avant `exercices_valides` — après les adresses
-- de réception, avant les devis —, sans vague ; seuls les rangs des devis et d'`exercices_valides` changent. Rejoué sur la
-- réplique de l'étape, égale à la production à 133 migrations plus celle-ci (signature.sql, neuf familles, et
-- l'historique), le dossier `test` portant quatre contacts rangés par leurs fonctions (une entreprise modifiée, un
-- particulier retiré, un organisme public, un contact effacé) : 138 clés recopiées, 73 tables restaurées et IDENTIQUES à
-- la source (70 lignes, dont les quatre contacts), 0 écart, aucun arrêt, les contrôles du catalogue des rôles et de la
-- colonne générée justes. Planté — les contacts ancrés avant le dossier —, le script s'arrête sur leur clé (23503). Sur
-- une base qui n'a pas la migration, rien n'entre : le plan est celui d'hier (137 clés, 72 tables IDENTIQUES).
--
-- 17/10/2026, espace client, étape A5c1 (migration `logo_des_factures`, préparée, non appliquée) : aucune table de plus,
-- deux colonnes — `parametres_facturation.logo_chemin` et `logo_sha256`, sans clé vers une autre table — et trois
-- contraintes, que la copie des contraintes emporte ; le plan ne change pas, la sauvegarde recopiant des lignes entières.
-- Le FICHIER du logo, dans le seau `ventes`, n'est pas une ligne : ni la sauvegarde ni ce script ne le portent (le
-- manifeste le dit, `horsPerimetre`). Rejoué sur une copie de la réplique de l'étape (signature.sql : les neuf familles
-- égales à la production à 137 migrations, plus celle-ci), le dossier `test` semé PAR LA FONCTION de quatre versions — un
-- logo posé, gardé, changé, retiré — : 140 clés recopiées, 74 tables restaurées et IDENTIQUES à la source (70 lignes,
-- dont les quatre versions en quatre vagues), 0 écart, aucun arrêt, les contrôles du catalogue des rôles justes ; celui
-- de la colonne générée sans objet (aucun texte OCR dans le dossier de la réplique). Sans la migration : 140 clés, 74
-- tables IDENTIQUES, 66 lignes.
--
-- 17/10/2026, espace client, étape A5c2b : la SAUVEGARDE porte désormais le fichier de chaque logo qu'une version
-- désigne (format 2, src/lib/sauvegardeLogos.ts), et la restauration de l'application le redépose dans le seau `ventes`
-- après les lignes. Ce script n'en joue rien, et ne le simule pas : un fichier du stockage n'est pas une ligne, et ce
-- script recopie des lignes. Aucune table n'entre au plan, rien n'y change. Le dépôt à la restauration est éprouvé par
-- sauvegardeDonnees.test.ts, contre le SDK installé du stockage devant un seau factice ; son premier dépôt réel reste à
-- faire (PLAN_DE_REPRISE.md, §6).
--
-- 18/10/2026, chantier EC-Q3, étape VF1a (migration `exemplaires_des_factures`, préparée, non appliquée) : aucune table de
-- plus — une colonne, `pieces.facture_id`, et sa clé vers `factures_emises`, sans action à la suppression, que la copie
-- des clés recopie : les factures précèdent déjà les pièces ; le plan ne change pas, la sauvegarde recopiant des lignes
-- entières. Un contrôle de plus suit le verdict : chaque pièce désignée, restaurée désignée à la même facture, la clé
-- recopiée. Rejoué sur une copie de la réplique de l'étape (signature.sql : les neuf familles égales à la production à 139
-- migrations, plus celle-ci), le dossier `test` semé d'une facture validée et de son avoir (la porte de la restauration,
-- sous la session du super-administrateur) et de deux pièces de vente désignées par `designer_exemplaire_facture`, l'une
-- de la facture, l'autre de l'avoir : 141 clés recopiées, 74 tables restaurées et IDENTIQUES à la source (68 lignes),
-- 0 écart, aucun arrêt, le contrôle de la désignation juste (2 sur 2), ceux du catalogue des rôles justes ; celui de la
-- colonne générée sans objet (aucun texte OCR dans le dossier de la réplique). Planté — les factures restaurées après les
-- pièces —, le script s'arrête sur `pieces` (23503, `pieces_facture_id_fkey`). Sans la migration : 140 clés, 74 tables
-- IDENTIQUES, 68 lignes, et le contrôle se tait. Ce script recopie les clés, pas les gardes : la réinsertion d'une pièce
-- désignée par la porte du super-administrateur, et son refus pour la facture d'un autre dossier, un brouillon ou une
-- pièce qui n'est pas une vente, sont joués par exemplairesDesFactures.sql (contrôles 71 à 75).
--
-- 19/10/2026, chantier EC-Q3, étape VF2 (migrations `source_de_la_vente` et `encaissements_de_la_vente_facturee`, en
-- base) : aucune table de plus — cinq colonnes (`dossiers.ventes_par_les_factures`, `factures_emises.source_de_la_vente`,
-- `lignes_bancaires.encaissements_de_factures`, `ecritures_brouillon.encaissement_id` et `facture_id`) et deux clés des
-- écritures, vers l'encaissement et vers la facture qu'elles portent, sans action à la suppression, que la copie des clés
-- recopie : les factures (rang 21) et les encaissements (rang 51) précèdent déjà les écritures (rang 60) ; le plan ne
-- change pas, la sauvegarde recopiant des lignes entières. Cinq contrôles de plus suivent le verdict : chaque valeur de
-- la vente facturée restaurée telle qu'elle était, les deux clés recopiées. Rejoué sur une réplique égale à la production
-- (signature.sql, neuf familles), dans une transaction annulée, le dossier `test` semé PAR LES FONCTIONS : le réglage
-- posé, une facture source validée, son encaissement sur un mouvement que le cabinet classe par ses encaissements, et les
-- trois lignes de l'écriture de la vente, posées sous le réglage de leur encaissement (et, pour les contrôles d'avant,
-- une pièce désignée et un texte lu) : 143 clés recopiées, 74 tables restaurées et IDENTIQUES à la source (27 lignes),
-- 0 écart, aucun arrêt ; les cinq contrôles de la vente facturée justes (3 sur 3 pour chaque clé, 1 sur 1 pour chaque
-- colonne), ceux d'avant aussi. Sans le semis : 143 clés, 74 tables IDENTIQUES (18 lignes), et les cinq contrôles disent
-- que rien n'est prouvé. Planté — les écritures restaurées avant les encaissements —, le script s'arrête sur
-- `ecritures_brouillon` (23503, `ecritures_brouillon_encaissement_id_fkey`). Ce script recopie les clés, pas les gardes :
-- la réinsertion par la porte du super-administrateur — une facture source dans un dossier qui a basculé, jamais
-- ailleurs ; un mouvement classé ; un encaissement qui cite un mouvement classé ; une écriture qui porte un encaissement
-- — est jouée par ventesFacturees.sql (contrôles 20, 21, 42, 64 et 35).
--
-- 20/10/2026, chantier EC-Q3, étape VF4b (migration `ecritures_de_la_vente_facturee`, préparée) : aucune table ni clé de
-- plus — une colonne, `encaissements_factures.compte_contrepartie`, recopiée avec sa ligne ; un contrôle de plus la dit
-- restaurée telle qu'elle était, ou EN ATTENTE avant la migration. Rejoué sur la réplique de l'étape (signature.sql : les
-- neuf familles égales à la production, puis la migration), dans une transaction annulée, le dossier `test` semé PAR LES
-- FONCTIONS : le réglage, deux factures sources validées (des services, un bien), un virement sur un mouvement crédité le
-- lendemain que le cabinet classe, une compensation dont il choisit le compte, et leurs écritures — celles des deux
-- encaissements, du bien et du mouvement — écrites par `ecrire_vente_facturee` : 143 clés recopiées, 74 tables
-- IDENTIQUES (38 lignes), les douze contrôles justes ; sans le semis, ils disent que rien n'est prouvé ; sans la
-- migration, le contrôle du compte attend. La réinsertion par la porte du super-administrateur — un encaissement né avec
-- son compte, une ligne d'un mouvement classé — est jouée par ecrituresVentesFacturees.sql (contrôles 119c et 78).
--
-- 23/10/2026, chantier EC-Q3, étape VF6b (migration `jumelle_inversee`, préparée, non appliquée) : `designations_des_pieces`,
-- le journal des désignations, entre au plan par son bloc à part dès que sa table existe (81 tables, 84 avec les devis),
-- juste avant `exercices_valides` — après les paramètres de facturation, avant les devis —, sans vague ; seuls les rangs
-- des devis et d'`exercices_valides` changent ; et une colonne, `pieces.vente_hors_des_factures`, recopiée avec sa ligne
-- et sa contrainte. Un contrôle de plus suit le verdict : chaque pièce déclarée, restaurée déclarée. Rejoué sur une copie
-- de la réplique de l'étape (signature.sql : les neuf familles égales à la production à 146 migrations, plus celle de
-- VF5h, puis celle-ci), le dossier `test` semé PAR LES FONCTIONS, sous la session du chef : le dossier bascule, sa pièce
-- de vente est désignée exemplaire de sa facture validée, une seconde pièce de vente est déclarée, sa déclaration retirée
-- puis reposée, et la pièce validée (quatre lignes au journal) : 146 clés recopiées, 75 tables restaurées et IDENTIQUES à
-- la source (23 lignes, dont les quatre du journal et les trois pièces), 0 écart, aucun arrêt ; le contrôle de la
-- désignation juste (1 sur 1), celui de la déclaration aussi (1 sur 1). Planté — le journal restauré à la place des pièces
-- —, le script s'arrête sur `designations_des_pieces` (23503, `designations_des_pieces_piece_id_fkey`). Sans la
-- migration : 143 clés, 74 tables IDENTIQUES, 18 lignes, et le contrôle de la déclaration se tait. Ce script recopie les
-- clés, pas les gardes : la réinsertion d'une pièce déclarée et d'une ligne du journal par la porte du
-- super-administrateur, et leurs refus, sont joués par exemplairesDesFactures.sql (contrôles 336 à 339, 360 à 363) ; la
-- suppression d'une ligne du journal — refusée hors de la cascade de sa pièce ou de son dossier —, par une sonde sur la
-- réplique seulement.
--
-- 25/10/2026, chantier EC-Q3, étape VF8a (migration `reglage_des_ventes`, appliquée le 26/10/2026) : aucune table ni clé
-- de plus — une colonne de `dossiers`, la date de la bascule (`ventes_par_les_factures_depuis`), recopiée avec la ligne du
-- dossier ; le plan ne change pas. Un contrôle de plus suit le verdict : le dossier basculé restauré avec sa date et son
-- réglage, ou EN ATTENTE sans la colonne. Rejoué sur la réplique de l'étape (égale à la production munie des quatre
-- migrations préparées, puis de celle-ci), sur une copie jetable, contre le dossier de VF7e qui naît sans avoir basculé et
-- que le chef bascule aussitôt (la garde pose alors sa date) : IDENTIQUE, 75 tables, 56 lignes, des deux côtés ; la date,
-- 1 sur 1 avec la migration, EN ATTENTE sans elle ; les autres contrôles inchangés. Ce script recopie les tables, pas leurs
-- gardes : que la garde laisse la date que le super-administrateur réinsère, et pose celle de toute autre insertion,
-- ventesFacturees.sql le prouve (9c à 9f, 191).

-- ══ 1. Le schéma d'essai ══════════════════════════════════════════════════════════════════════════
-- L'essai s'ARRÊTE à la première erreur, nommément. Sans cela, psql passe à l'instruction suivante : la recopie des clés
-- étrangères, qui échoue quand une table de la base n'est pas au plan, laissait la restauration courir sans aucune clé
-- jusqu'à un verdict « IDENTIQUE » qui ne prouvait rien (défaut relevé le 10/10/2026, ligne 41, étape R4). `\set` est
-- une commande de psql : le script ne se joue que par lui, sur une réplique. Arrêté, il laisse son schéma d'essai, que
-- le passage suivant supprime en commençant. Éprouvé le 10/10/2026 sur une copie de la réplique de l'étape R4, égale à
-- la production à 114 migrations, où l'on avait planté une table hors du plan liée au dossier : il s'arrête sur la
-- recopie des clés et nomme la clé, sans avoir recopié aucune ligne ; sans l'arrêt, son verdict se dit EN FAUTE ; le
-- script d'avant y rendait 62 tables IDENTIQUES. Sans la table plantée : 119 clés recopiées, le verdict d'avant.
\set ON_ERROR_STOP on
drop schema if exists essai_restauration cascade;
create schema essai_restauration;

create table essai_restauration._ordre (rang int primary key, table_nom text not null);
create table essai_restauration._chemins (table_nom text primary key, acces text not null, parent text, colonne text);
create table essai_restauration._vagues (table_nom text not null, colonne text not null);
create table essai_restauration._generees (table_nom text not null, colonne text not null);

-- Recopiés de src/lib/sauvegarde.ts (ORDRE_RESTAURATION, CHEMINS_DOSSIER, TABLES_AUTO_REFERENCEES_PAR_VAGUES,
-- COLONNES_GENEREES).
insert into essai_restauration._ordre (rang, table_nom) values
 (1,'cabinets'),(2,'super_admins'),(3,'taux_change_bce'),(4,'roles_comptables'),(5,'cabinet_admins'),
 (6,'dossiers'),(7,'plan_comptable_dossier'),(8,'a_nouveaux'),(9,'agent_conversations'),(10,'categories'),
 (11,'comptes_courants_associes'),(12,'connexions_bancaires'),(13,'connexions_plateformes'),(14,'controles_releves_bancaires'),(15,'cotisations_declarees'),
 (16,'declarations_tva'),(17,'dossier_assignations'),(18,'emprunts'),(19,'exercices_clotures'),(20,'facture_numerotation'),
 (21,'factures_emises'),(22,'informations_dossier'),(23,'memberships'),(24,'natures_immobilisation'),(25,'packs'),
 (26,'previsionnels_bancaires'),(27,'references_annuelles'),(28,'references_postes_annuels'),(29,'regles_bancaires_ignorees'),(30,'soldes_reportes'),
 (31,'sous_dossiers'),(32,'superpdp_credentials'),(33,'vehicules'),(34,'volet_social_pamc'),(35,'documents_divers'),
 (36,'emails_envoyes'),(37,'facture_lignes'),(38,'facture_superpdp_events'),(39,'statuts_factures_recus'),(40,'transmissions_factures'),
 (41,'mouvements_cca'),(42,'pieces'),(43,'supplements'),(44,'regles_affectation_bancaire'),(45,'tiers_categories'),
 (46,'tiers_categories_cabinet'),(47,'immobilisations'),(48,'lignes_bancaires'),(49,'ventilations_bancaires'),(50,'reglements_groupes'),
 (51,'encaissements_factures'),(52,'encaissements_factures_taux'),(53,'transmissions_encaissements'),(54,'lettrages_manuels'),(55,'piece_commentaires'),
 (56,'piece_textes_ocr'),(57,'notes_internes'),(58,'pieces_hors_de_france'),(59,'pieces_hors_de_france_taux'),(60,'ecritures_brouillon'),
 (61,'revision_justifications'),(62,'revision_preuves'),(63,'revision_conclusions'),(64,'revision_notes'),(65,'revision_revues'),
 (66,'revision_seuils'),(67,'revision_explications'),(68,'justificatifs_proposes'),(69,'precisions_mouvements'),(70,'regimes_ereporting'),
 (71,'pieces_ecartees_ereporting'),(72,'declarations_ereporting'),(73,'declarations_ereporting_sources'),(74,'dossier_permanent'),
 (75,'pieces_jointes_ecartees'),(76,'exercices_valides');

insert into essai_restauration._chemins (table_nom, acces, parent, colonne) values
 ('a_nouveaux','direct',null,null),('agent_conversations','direct',null,null),('cabinet_admins','cabinet',null,null),
 ('cabinets','global',null,null),('categories','partage',null,null),('comptes_courants_associes','direct',null,null),
 ('connexions_bancaires','direct',null,null),('connexions_plateformes','direct',null,null),('controles_releves_bancaires','direct',null,null),
 ('cotisations_declarees','direct',null,null),('declarations_tva','direct',null,null),('documents_divers','direct',null,null),
 ('declarations_ereporting','direct',null,null),('declarations_ereporting_sources','direct',null,null),
 ('dossier_assignations','direct',null,null),('dossiers','le_dossier',null,null),('ecritures_brouillon','direct',null,null),
 ('dossier_permanent','direct',null,null),
 ('emails_envoyes','direct',null,null),('emprunts','direct',null,null),('encaissements_factures','direct',null,null),
 ('encaissements_factures_taux','direct',null,null),('exercices_clotures','direct',null,null),('exercices_valides','direct',null,null),
 ('facture_lignes','par_parent','factures_emises','facture_id'),('facture_numerotation','direct',null,null),('facture_superpdp_events','direct',null,null),
 ('factures_emises','direct',null,null),('immobilisations','direct',null,null),('informations_dossier','direct',null,null),
 ('justificatifs_proposes','direct',null,null),
 ('lettrages_manuels','direct',null,null),('lignes_bancaires','direct',null,null),('memberships','direct',null,null),
 ('mouvements_cca','par_parent','comptes_courants_associes','compte_id'),('natures_immobilisation','partage',null,null),('notes_internes','direct',null,null),
 ('packs','direct',null,null),
 ('piece_commentaires','direct',null,null),('piece_textes_ocr','direct',null,null),('pieces','direct',null,null),
 ('pieces_ecartees_ereporting','direct',null,null),
 ('pieces_hors_de_france','direct',null,null),('pieces_hors_de_france_taux','direct',null,null),
 ('plan_comptable_dossier','direct',null,null),
 ('precisions_mouvements','direct',null,null),
 ('previsionnels_bancaires','direct',null,null),('references_annuelles','direct',null,null),('references_postes_annuels','direct',null,null),
 ('regimes_ereporting','direct',null,null),
 ('reglements_groupes','direct',null,null),('regles_affectation_bancaire','direct',null,null),('regles_bancaires_ignorees','direct',null,null),
 ('revision_justifications','direct',null,null),('revision_preuves','direct',null,null),('roles_comptables','global',null,null),
 ('revision_conclusions','direct',null,null),('revision_notes','direct',null,null),('revision_revues','direct',null,null),
 ('revision_seuils','direct',null,null),('revision_explications','direct',null,null),
 ('soldes_reportes','direct',null,null),
 ('sous_dossiers','direct',null,null),('statuts_factures_recus','direct',null,null),('super_admins','global',null,null),
 ('superpdp_credentials','direct',null,null),('supplements','direct',null,null),('taux_change_bce','global',null,null),
 ('tiers_categories','direct',null,null),('tiers_categories_cabinet','cabinet',null,null),('transmissions_encaissements','direct',null,null),
 ('transmissions_factures','direct',null,null),('vehicules','direct',null,null),('ventilations_bancaires','direct',null,null),
 ('volet_social_pamc','direct',null,null),
 ('pieces_jointes_ecartees','direct',null,null);

insert into essai_restauration._vagues (table_nom, colonne) values
 ('encaissements_factures','annule_id'),('revision_justifications','remplace_id'),('revision_justifications','reprise_de'),
 ('pieces_hors_de_france','remplace_id'),
 ('revision_conclusions','remplace_id'),
 ('revision_seuils','remplace_id'),
 ('revision_explications','remplace_id'),
 ('declarations_ereporting','remplace_id'),
 ('dossier_permanent','remplace_id');

insert into essai_restauration._generees (table_nom, colonne) values
 ('piece_textes_ocr','texte_md5');

-- ══ Les articles (espace client, étape A1) ══ Au plan du code quand `ARTICLES_EXPORTES` est levé — c'est-à-dire quand
-- leur migration est en base : le script les y met dès que leur table existe, juste après `agent_conversations`
-- (ORDRE_RESTAURATION_PREVU : après le dossier, avant les factures, dont une ligne désignera son article à l'étape A7) ; les
-- tables qui suivent reculent d'un rang — par les rangs négatifs, que la clé de `_ordre` admet. Absente de la base, rien
-- n'entre : le plan est celui d'hier. restaurationEssai.test.ts confronte ce bloc au plan prévu du code.
do $$
declare v_rang int;
begin
  if to_regclass('public.articles') is not null then
    select o.rang into v_rang from essai_restauration._ordre o where o.table_nom = 'agent_conversations';
    update essai_restauration._ordre set rang = -(rang + 1) where rang > v_rang;
    update essai_restauration._ordre set rang = -rang where rang < 0;
    insert into essai_restauration._ordre (rang, table_nom) values (v_rang + 1, 'articles');
    insert into essai_restauration._chemins (table_nom, acces, parent, colonne) values
     ('articles','direct',null,null);
  end if;
end $$;

-- ══ Les adresses de réception (espace client, étape A6a) ══ Au plan du code quand `ADRESSES_RECEPTION_EXPORTEES` est levé
-- — c'est-à-dire quand leur migration est en base : le script les y met dès que leur table existe, juste avant
-- `exercices_valides` (ORDRE_RESTAURATION_PREVU : après les pièces jointes écartées, avant les devis, que leur bloc met
-- ensuite au même endroit), `exercices_valides` reculant d'un rang ; leur chemin, et leur vague (une version remplace la
-- courante, `remplace_id`). Absente de la base, rien n'entre : le plan est celui d'hier. restaurationEssai.test.ts confronte
-- ce bloc au plan prévu du code.
do $$
begin
  if to_regclass('public.adresses_reception') is not null then
    update essai_restauration._ordre set rang = rang + 1 where table_nom = 'exercices_valides';
    insert into essai_restauration._ordre (rang, table_nom)
      select o.rang - 1, 'adresses_reception' from essai_restauration._ordre o where o.table_nom = 'exercices_valides';
    insert into essai_restauration._chemins (table_nom, acces, parent, colonne) values
     ('adresses_reception','direct',null,null);
    insert into essai_restauration._vagues (table_nom, colonne) values
     ('adresses_reception','remplace_id');
  end if;
end $$;

-- ══ Les contacts (espace client, étape A4a) ══ Au plan du code quand `CONTACTS_EXPORTES` est levé — c'est-à-dire quand
-- leur migration est en base : le script les y met dès que leur table existe, juste avant `exercices_valides`
-- (ORDRE_RESTAURATION_PREVU : après les adresses de réception, que leur bloc vient d'y mettre, avant les devis, que leur
-- bloc met ensuite au même endroit), `exercices_valides` reculant d'un rang ; leur chemin. Aucune vague : un contact ne
-- pointe aucun contact. Absente de la base, rien n'entre : le plan est celui d'hier. restaurationEssai.test.ts confronte
-- ce bloc au plan prévu du code.
do $$
begin
  if to_regclass('public.contacts') is not null then
    update essai_restauration._ordre set rang = rang + 1 where table_nom = 'exercices_valides';
    insert into essai_restauration._ordre (rang, table_nom)
      select o.rang - 1, 'contacts' from essai_restauration._ordre o where o.table_nom = 'exercices_valides';
    insert into essai_restauration._chemins (table_nom, acces, parent, colonne) values
     ('contacts','direct',null,null);
  end if;
end $$;

-- ══ Les paramètres de facturation (espace client, étape A5a) ══ Au plan du code quand `PARAMETRES_FACTURATION_EXPORTES` est
-- levé — c'est-à-dire quand leur migration est en base : le script les y met dès que leur table existe, juste avant
-- `exercices_valides` (ORDRE_RESTAURATION_PREVU : après les contacts, que leur bloc vient d'y mettre, avant les devis, que
-- leur bloc met ensuite au même endroit), `exercices_valides` reculant d'un rang ; leur chemin, et leur vague (une version
-- remplace la courante, `remplace_id`). Absente de la base, rien n'entre : le plan est celui d'hier.
-- restaurationEssai.test.ts confronte ce bloc au plan prévu du code.
do $$
begin
  if to_regclass('public.parametres_facturation') is not null then
    update essai_restauration._ordre set rang = rang + 1 where table_nom = 'exercices_valides';
    insert into essai_restauration._ordre (rang, table_nom)
      select o.rang - 1, 'parametres_facturation' from essai_restauration._ordre o where o.table_nom = 'exercices_valides';
    insert into essai_restauration._chemins (table_nom, acces, parent, colonne) values
     ('parametres_facturation','direct',null,null);
    insert into essai_restauration._vagues (table_nom, colonne) values
     ('parametres_facturation','remplace_id');
  end if;
end $$;

-- ══ Le journal des désignations (chantier EC-Q3, étape VF6b) ══ Au plan du code quand `JUMELLE_INVERSEE_EXPORTEE` est levé
-- — c'est-à-dire quand sa migration est en base : le script l'y met dès que sa table existe, juste avant
-- `exercices_valides` (ORDRE_RESTAURATION_PREVU : après les paramètres de facturation, que leur bloc vient d'y mettre,
-- avant les devis, que leur bloc met ensuite au même endroit), `exercices_valides` reculant d'un rang ; son chemin. Aucune
-- vague : une ligne du journal n'en pointe aucune autre ; sa pièce et sa facture la précèdent. Absente de la base, rien
-- n'entre : le plan est celui d'hier. restaurationEssai.test.ts confronte ce bloc au plan prévu du code.
do $$
begin
  if to_regclass('public.designations_des_pieces') is not null then
    update essai_restauration._ordre set rang = rang + 1 where table_nom = 'exercices_valides';
    insert into essai_restauration._ordre (rang, table_nom)
      select o.rang - 1, 'designations_des_pieces' from essai_restauration._ordre o where o.table_nom = 'exercices_valides';
    insert into essai_restauration._chemins (table_nom, acces, parent, colonne) values
     ('designations_des_pieces','direct',null,null);
  end if;
end $$;

-- ══ Les devis (espace client, étape P5) ══ Au plan du code quand `DEVIS_EXPORTES` est levé — c'est-à-dire quand leurs
-- migrations sont en base : le script les y met dès que leurs tables existent, juste avant `exercices_valides`, qui ferme
-- la marche (ORDRE_RESTAURATION_PREVU), leurs rangs calculés pour qu'aucune table d'hier ne change de place. Absentes de
-- la base, rien n'entre : le plan est celui d'hier. restaurationEssai.test.ts confronte ce bloc au plan prévu du code.
do $$
begin
  if to_regclass('public.devis') is not null then
    update essai_restauration._ordre set rang = rang + 3 where table_nom = 'exercices_valides';
    insert into essai_restauration._ordre (rang, table_nom)
      select (select o.rang from essai_restauration._ordre o where o.table_nom = 'exercices_valides') - 4 + v.i, v.t
        from (values (1,'devis_numerotation'),(2,'devis'),(3,'devis_factures')) as v(i, t);
    insert into essai_restauration._chemins (table_nom, acces, parent, colonne) values
     ('devis','direct',null,null),('devis_factures','direct',null,null),('devis_numerotation','direct',null,null);
  end if;
end $$;

do $$
declare t text;
begin
  for t in select table_nom from essai_restauration._ordre order by rang loop
    execute format('create table essai_restauration.%I (like public.%I including defaults including constraints including indexes including generated)', t, t);
  end loop;
end $$;

-- Les clés étrangères telles que Postgres les déclare, redirigées vers le schéma d'essai. Seules
-- celles entre tables de `public` — voir l'en-tête pour ce que cette exclusion coûte. Une clé dont une table n'est pas
-- au plan — une base en avance sur le code : une migration appliquée, pas encore au plan de ce fichier — ne peut pas se
-- recopier : le bloc les NOMME toutes et s'arrête avant d'en recopier aucune. Le témoin `_cles_recopiees` ne s'écrit que
-- si toutes ont passé ; le verdict (section 3) se dit EN FAUTE sans lui.
create table essai_restauration._cles_recopiees (nombre bigint not null);
do $$
declare r record; hors_plan text;
begin
  select string_agg(format('%s (%s → %s)', c.conname, te.relname, tp.relname), ', ' order by c.conname)
    into hors_plan
    from pg_constraint c
    join pg_class te on te.oid = c.conrelid
    join pg_namespace ne on ne.oid = te.relnamespace
    join pg_class tp on tp.oid = c.confrelid
    join pg_namespace np on np.oid = tp.relnamespace
   where c.contype = 'f' and ne.nspname = 'public' and np.nspname = 'public'
     and (to_regclass(format('essai_restauration.%I', te.relname)) is null
          or to_regclass(format('essai_restauration.%I', tp.relname)) is null);
  if hors_plan is not null then
    raise exception 'ESSAI EN FAUTE : des clés étrangères ne se recopient pas, une de leurs tables n''est pas au plan — %',
      hors_plan;
  end if;
  for r in
    select c.conname, te.relname as enfant, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_class te on te.oid = c.conrelid
    join pg_namespace ne on ne.oid = te.relnamespace
    join pg_class tp on tp.oid = c.confrelid
    join pg_namespace np on np.oid = tp.relnamespace
    where c.contype = 'f' and ne.nspname = 'public' and np.nspname = 'public'
  loop
    execute format('alter table essai_restauration.%I add constraint %I %s',
      r.enfant, r.conname, replace(r.def, 'REFERENCES ', 'REFERENCES essai_restauration.'));
  end loop;
  insert into essai_restauration._cles_recopiees
    select count(*) from pg_constraint c join pg_namespace ns on ns.oid = c.connamespace
     where c.contype = 'f' and ns.nspname = 'essai_restauration';
end $$;

select nombre as cles_etrangeres_recopiees from essai_restauration._cles_recopiees;

-- ══ 2. La restauration ════════════════════════════════════════════════════════════════════════════
-- Remplacer l'identifiant ci-dessous par le dossier à éprouver.
create table essai_restauration._verdict (etape text, detail text);
create table essai_restauration._cible (dossier uuid primary key);
insert into essai_restauration._cible values ('001c7ed7-c23b-4590-901e-693489f8af24');

-- Les prérequis que la sauvegarde ne contient pas (voir referencesExternes) : le cabinet du dossier, et le catalogue des
-- rôles comptables, qu'une migration pose dans toute base d'arrivée (`PARENTS_HORS_PLAN_VOULUS`, ligne 43, PC1).
insert into essai_restauration.cabinets
  select * from public.cabinets
  where id = (select cabinet_id from public.dossiers where id = (select dossier from essai_restauration._cible));
insert into essai_restauration.roles_comptables select * from public.roles_comptables;

-- Les colonnes qu'une insertion de la restauration nomme : toutes celles de la table, dans leur ordre, SAUF les colonnes
-- générées que le code retire (`_generees`) — comme `planReinsertion`, qui les ôte de chaque ligne envoyée. Le préfixe
-- qualifie chaque colonne de l'alias de la source quand l'instruction en a un (`s.`).
create function essai_restauration._colonnes(t text, prefixe text) returns text language sql stable as $f$
  select string_agg(prefixe || quote_ident(a.attname), ', ' order by a.attnum)
    from pg_attribute a
   where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname not in (select g.colonne from essai_restauration._generees g where g.table_nom = t)
$f$;

do $$
declare d uuid := (select dossier from essai_restauration._cible); r record; n bigint; ecrits bigint; vagues int; condition text;
        colonnes text; colonnes_s text;
begin
  for r in
    select o.rang, o.table_nom, c.acces, c.parent, c.colonne
    from essai_restauration._ordre o join essai_restauration._chemins c on c.table_nom = o.table_nom
    order by o.rang
  loop
    if r.acces in ('global','cabinet') then continue; end if;
    vagues := 0;
    colonnes := essai_restauration._colonnes(r.table_nom, '');
    colonnes_s := essai_restauration._colonnes(r.table_nom, 's.');

    if r.acces = 'le_dossier' then
      execute format('insert into essai_restauration.%I (%s) select %s from public.%I where id = $1',
        r.table_nom, colonnes, colonnes, r.table_nom) using d;
    elsif r.acces = 'direct' and exists (select 1 from essai_restauration._vagues v where v.table_nom = r.table_nom) then
      -- Par vagues (TABLES_AUTO_REFERENCEES_PAR_VAGUES) : une ligne part quand chacun de ses liens est vide, pointe hors
      -- de la sauvegarde ou pointe une ligne déjà écrite — une écriture par vague. Ce qui ne peut plus avancer (un cycle)
      -- part en dernier, et c'est Postgres qui dira non.
      select string_agg(format('(s.%1$I is null or s.%1$I not in (select x.id from public.%2$I x where x.dossier_id = $1)'
                               || ' or s.%1$I in (select y.id from essai_restauration.%2$I y))', v.colonne, r.table_nom), ' and ')
        into condition from essai_restauration._vagues v where v.table_nom = r.table_nom;
      loop
        execute format('insert into essai_restauration.%I (%s) select %s from public.%I s where s.dossier_id = $1'
                       || ' and s.id not in (select z.id from essai_restauration.%I z) and %s',
          r.table_nom, colonnes, colonnes_s, r.table_nom, r.table_nom, condition)
          using d;
        get diagnostics ecrits = row_count;
        exit when ecrits = 0;
        vagues := vagues + 1;
      end loop;
      execute format('insert into essai_restauration.%I (%s) select %s from public.%I s where s.dossier_id = $1'
                     || ' and s.id not in (select z.id from essai_restauration.%I z)', r.table_nom, colonnes, colonnes_s, r.table_nom, r.table_nom)
        using d;
    elsif r.acces = 'direct' then
      if r.table_nom = 'factures_emises' then
        -- Première des deux passes : le lien auto-référencé part vide (voir TABLES_AUTO_REFERENCEES).
        execute format('insert into essai_restauration.factures_emises (%s) select %s from public.factures_emises s where s.dossier_id = $1',
          colonnes, colonnes_s) using d;
        update essai_restauration.factures_emises set facture_origine_id = null;
      else
        execute format('insert into essai_restauration.%I (%s) select %s from public.%I where dossier_id = $1',
          r.table_nom, colonnes, colonnes, r.table_nom) using d;
      end if;
    elsif r.acces = 'partage' then
      execute format('insert into essai_restauration.%I (%s) select %s from public.%I where dossier_id = $1 or dossier_id is null',
        r.table_nom, colonnes, colonnes, r.table_nom) using d;
    elsif r.acces = 'par_parent' then
      execute format('insert into essai_restauration.%I (%s) select %s from public.%I where %I in (select id from essai_restauration.%I)',
        r.table_nom, colonnes, colonnes, r.table_nom, r.colonne, r.parent);
    end if;

    execute format('select count(*) from essai_restauration.%I', r.table_nom) into n;
    insert into essai_restauration._verdict values (lpad(r.rang::text,2,'0') || ' ' || r.table_nom,
      n || ' lignes (' || r.acces || case when vagues > 0 then ', ' || vagues || ' vague(s)' else '' end || ')');
  end loop;
exception when others then
  -- Le code de l'erreur avec son message : un refus se reconnaît à son code (428C9 : une colonne générée nommée).
  insert into essai_restauration._verdict values ('ARRET', 'sur ' || r.table_nom || ' : ' || sqlstate || ' ' || sqlerrm);
end $$;

-- Seconde passe : les liens auto-référencés, une fois toutes les lignes en place.
update essai_restauration.factures_emises e
   set facture_origine_id = p.facture_origine_id
  from public.factures_emises p
 where p.id = e.id and p.facture_origine_id is not null;

select etape, detail from essai_restauration._verdict order by etape;

-- ══ 3. Le verdict ═════════════════════════════════════════════════════════════════════════════════
-- Le compte de lignes ne suffit pas : on compare le CONTENU, par empreinte de la table entière triée.
create table essai_restauration._egalite (table_nom text, nb_essai bigint, nb_source bigint, verdict text);
do $$
declare d uuid := (select dossier from essai_restauration._cible); r record; ne bigint; ns bigint; ee text; es text; filtre text;
begin
  for r in
    select o.rang, o.table_nom, c.acces, c.parent, c.colonne
    from essai_restauration._ordre o join essai_restauration._chemins c on c.table_nom = o.table_nom
    where c.acces not in ('global','cabinet') order by o.rang
  loop
    filtre := case r.acces
      when 'le_dossier' then format('id = %L', d)
      when 'direct' then format('dossier_id = %L', d)
      when 'partage' then format('(dossier_id = %L or dossier_id is null)', d)
      when 'par_parent' then format('%I in (select id from essai_restauration.%I)', r.colonne, r.parent)
    end;
    execute format('select count(*), md5(coalesce(string_agg(t::text, %L order by t::text), %L)) from essai_restauration.%I t', '|', '', r.table_nom) into ne, ee;
    execute format('select count(*), md5(coalesce(string_agg(t::text, %L order by t::text), %L)) from public.%I t where %s', '|', '', r.table_nom, filtre) into ns, es;
    insert into essai_restauration._egalite values (r.table_nom, ne, ns, case when ne = ns and ee = es then 'IDENTIQUE' else 'ECART' end);
  end loop;
end $$;

select verdict, count(*) as tables, sum(nb_essai) as lignes, string_agg(table_nom || ' (' || nb_essai || ')', ', ' order by table_nom) as lesquelles
from essai_restauration._egalite group by verdict
union all
select 'EN FAUTE', 0, 0, 'les clés étrangères n''ont pas été recopiées : rien ci-dessus ne prouve que la restauration tient'
 where not exists (select 1 from essai_restauration._cles_recopiees)
order by verdict;

-- Le point NON VÉRIFIÉ 7 de la conception du plan comptable (ligne 43, PC1) : une sauvegarde dont le plan désigne un rôle
-- que la base d'arrivée ne connaît pas — une base plus ancienne que celle qui l'a écrite. La clé étrangère vers le
-- catalogue le refuse (23503) ; `restaurerSauvegarde` le refuse AVANT d'écrire, en lisant les rôles dans la base
-- d'arrivée (`referencesExternes`). Et la même ligne passe dès que le catalogue connaît son rôle : le refus est celui de
-- la clé, pas d'autre chose. Chaque essai s'annule (`ANNULATION_ESSAI`) : le contenu comparé ci-dessus reste celui de la
-- restauration.
create table essai_restauration._controles (controle text, attendu text, observe text);
do $$
declare d uuid := (select dossier from essai_restauration._cible); code text; inscrit boolean;
begin
  foreach inscrit in array array[false, true] loop
    code := null;
    begin
      if inscrit then
        insert into essai_restauration.roles_comptables (role, racines, compte_defaut, libelle_defaut, ordre)
        values ('role_d_une_base_plus_recente', '{512}', '512900', 'Essai', 999);
      end if;
      insert into essai_restauration.plan_comptable_dossier (dossier_id, role, compte)
      values (d, 'role_d_une_base_plus_recente', '512100');
      code := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if code is null then code := sqlstate; end if;
    end;
    insert into essai_restauration._controles values (
      case when inscrit then 'le même rôle, une fois inscrit au catalogue de la base d''arrivée'
           else 'un rôle que la base d''arrivée ne connaît pas' end,
      case when inscrit then 'ACCEPTÉ' else '23503' end, coalesce(code, '?'));
  end loop;
end $$;

-- LES COLONNES GÉNÉRÉES (défaut relevé à l'étape e5b1, corrigé le 11/10/2026). La liste que le code retire (`_generees`)
-- est celle des colonnes générées de la base dans les tables du plan, ni plus ni moins : l'une sans l'autre, l'essai
-- prouverait une autre restauration que celle du code. Chaque colonne de la liste est générée dans sa table d'essai comme
-- dans la base — la restauration s'est faite contre une table qui la CALCULE. Et chaque ligne restaurée y porte la valeur
-- que la table d'essai vient de calculer, égale à celle de la source, jointe sur sa clé primaire : au moins une ligne, ou
-- rien n'est prouvé, et le contrôle le dit.
do $$
declare g record; ecarts text; genre_base text; genre_essai text; jointure text; n bigint; egales bigint;
begin
  select string_agg(x, ', ' order by x) into ecarts from (
    (select c.relname || '.' || a.attname as x
       from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
        and a.attgenerated <> '' and c.relname in (select table_nom from essai_restauration._ordre)
     except
     select table_nom || '.' || colonne from essai_restauration._generees)
    union all
    (select table_nom || '.' || colonne from essai_restauration._generees
     except
     select c.relname || '.' || a.attname
       from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
        and a.attgenerated <> '')) e;
  insert into essai_restauration._controles values (
    'les colonnes générées de la base, au plan, sont celles que la restauration retire', 'aucun écart',
    coalesce('écart : ' || ecarts, 'aucun écart'));
  for g in select table_nom, colonne from essai_restauration._generees order by table_nom, colonne loop
    select case a.attgenerated::text when 's' then 'générée (stockée)' when '' then 'ordinaire' else 'générée (' || a.attgenerated::text || ')' end
      into genre_base from pg_attribute a
     where a.attrelid = to_regclass(format('public.%I', g.table_nom)) and a.attname = g.colonne and not a.attisdropped;
    select case a.attgenerated::text when 's' then 'générée (stockée)' when '' then 'ordinaire' else 'générée (' || a.attgenerated::text || ')' end
      into genre_essai from pg_attribute a
     where a.attrelid = to_regclass(format('essai_restauration.%I', g.table_nom)) and a.attname = g.colonne and not a.attisdropped;
    insert into essai_restauration._controles values (g.table_nom || '.' || g.colonne || ' : la table d''essai la calcule comme la base',
      coalesce(genre_base, 'absente de la base'), coalesce(genre_essai, 'absente de la table d''essai'));
    select string_agg(format('e.%1$I = s.%1$I', a.attname), ' and ' order by a.attnum) into jointure
      from pg_constraint co join pg_attribute a on a.attrelid = co.conrelid and a.attnum = any (co.conkey)
     where co.conrelid = to_regclass(format('public.%I', g.table_nom)) and co.contype = 'p';
    n := 0; egales := 0;
    if genre_essai is not null and jointure is not null then
      execute format('select count(*), count(*) filter (where e.%1$I is not distinct from s.%1$I)'
                     || ' from essai_restauration.%2$I e join public.%2$I s on %3$s', g.colonne, g.table_nom, jointure)
        into n, egales;
    end if;
    insert into essai_restauration._controles values (g.table_nom || '.' || g.colonne || ' : recalculée à la restauration, égale à la source',
      case when n > 0 then n || ' sur ' || n else 'au moins une ligne restaurée' end,
      case when n > 0 then egales || ' sur ' || n else 'aucune ligne restaurée : rien n''est prouvé' end);
  end loop;
end $$;

-- L'EXEMPLAIRE D'UNE FACTURE (chantier EC-Q3, étape VF1a ; migration `exemplaires_des_factures`) : une colonne de plus sur
-- une table au plan, `pieces.facture_id`, et sa clé vers `factures_emises`, que la copie des clés recopie — les factures
-- précèdent déjà les pièces. Ce contrôle dit que la désignation a été restaurée telle qu'elle était, chaque pièce désignée
-- à la même facture que dans la source, la clé recopiée : au moins une pièce désignée, ou rien n'est prouvé, et le
-- contrôle le dit. Sans la migration, il ne dit rien : la colonne n'existe pas.
do $$
declare d uuid := (select dossier from essai_restauration._cible); n bigint; egales bigint; cle boolean;
begin
  if exists (select 1 from pg_attribute where attrelid = 'public.pieces'::regclass and attname = 'facture_id' and not attisdropped) then
    execute 'select count(*), count(*) filter (where e.facture_id = s.facture_id) from public.pieces s'
            || ' left join essai_restauration.pieces e on e.id = s.id where s.dossier_id = $1 and s.facture_id is not null'
      into n, egales using d;
    select exists (select 1 from pg_constraint c where c.conrelid = 'essai_restauration.pieces'::regclass and c.contype = 'f'
                     and c.confrelid = 'essai_restauration.factures_emises'::regclass) into cle;
    insert into essai_restauration._controles values ('pieces.facture_id : chaque pièce désignée restaurée désignée à sa facture, la clé recopiée',
      case when n > 0 then n || ' sur ' || n || ', clé recopiée' else 'au moins une pièce désignée' end,
      case when n > 0 then egales || ' sur ' || n || ', clé ' || case when cle then 'recopiée' else 'absente' end
           else 'aucune pièce désignée dans le dossier : rien n''est prouvé' end);
  end if;
end $$;

-- LA JUMELLE INVERSÉE (chantier EC-Q3, étape VF6b ; migration `jumelle_inversee`) : une colonne de plus sur une table au
-- plan, `pieces.vente_hors_des_factures`, recopiée avec sa ligne et sa contrainte, et le journal des désignations, au plan
-- par son bloc, jugé comme toute table par l'empreinte de son contenu. Ce contrôle dit que chaque pièce déclarée a été
-- restaurée déclarée : au moins une, ou rien n'est prouvé, et il le dit. Sans la migration, il ne dit rien : la colonne
-- n'existe pas.
do $$
declare d uuid := (select dossier from essai_restauration._cible); n bigint; egales bigint;
begin
  if exists (select 1 from pg_attribute where attrelid = 'public.pieces'::regclass and attname = 'vente_hors_des_factures'
              and not attisdropped) then
    execute 'select count(*), count(*) filter (where e.vente_hors_des_factures) from public.pieces s'
            || ' left join essai_restauration.pieces e on e.id = s.id where s.dossier_id = $1 and s.vente_hors_des_factures'
      into n, egales using d;
    insert into essai_restauration._controles values ('pieces.vente_hors_des_factures : chaque pièce déclarée restaurée déclarée',
      case when n > 0 then n || ' sur ' || n else 'au moins une pièce déclarée' end,
      case when n > 0 then egales || ' sur ' || n else 'aucune pièce déclarée dans le dossier : rien n''est prouvé' end);
  end if;
end $$;

-- LA VENTE FACTURÉE (chantier EC-Q3, étape VF2) : cinq colonnes de tables au plan, et deux clés des écritures — vers
-- l'encaissement et vers la facture qu'elles portent —, que la copie des clés recopie. Ces contrôles disent que chaque
-- valeur de la vente facturée a été restaurée telle qu'elle était, et que les deux clés l'ont été : au moins une ligne
-- chacun, ou rien n'est prouvé, et le contrôle le dit.
do $$
declare d uuid := (select dossier from essai_restauration._cible); n bigint; egales bigint; cle boolean; c record;
begin
  for c in select * from (values ('encaissement_id', 'encaissements_factures'), ('facture_id', 'factures_emises')) as v(col, parent) loop
    execute format('select count(*), count(*) filter (where e.%1$I = s.%1$I) from public.ecritures_brouillon s'
                   || ' left join essai_restauration.ecritures_brouillon e on e.id = s.id where s.dossier_id = $1 and s.%1$I is not null', c.col)
      into n, egales using d;
    select exists (select 1 from pg_constraint k
                    where k.conrelid = 'essai_restauration.ecritures_brouillon'::regclass and k.contype = 'f'
                      and k.confrelid = format('essai_restauration.%I', c.parent)::regclass
                      and k.conkey = array[(select a.attnum from pg_attribute a
                                             where a.attrelid = 'essai_restauration.ecritures_brouillon'::regclass and a.attname = c.col)]::int2[])
      into cle;
    insert into essai_restauration._controles values ('ecritures_brouillon.' || c.col || ' : chaque écriture restaurée la porte, la clé recopiée',
      case when n > 0 then n || ' sur ' || n || ', clé recopiée' else 'au moins une écriture' end,
      case when n > 0 then egales || ' sur ' || n || ', clé ' || case when cle then 'recopiée' else 'absente' end
           else 'aucune écriture de la vente facturée dans le dossier : rien n''est prouvé' end);
  end loop;
  for c in select * from (values ('dossiers', 'ventes_par_les_factures', 'id'), ('factures_emises', 'source_de_la_vente', 'dossier_id'),
                                 ('lignes_bancaires', 'encaissements_de_factures', 'dossier_id')) as v(t, col, lien) loop
    execute format('select count(*), count(*) filter (where e.%1$I) from public.%2$I s left join essai_restauration.%2$I e on e.id = s.id'
                   || ' where s.%3$I = $1 and s.%1$I', c.col, c.t, c.lien)
      into n, egales using d;
    insert into essai_restauration._controles values (c.t || '.' || c.col || ' : chaque ligne qui la porte, restaurée la portant',
      case when n > 0 then n || ' sur ' || n else 'au moins une ligne' end,
      case when n > 0 then egales || ' sur ' || n else 'aucune ligne qui la porte dans le dossier : rien n''est prouvé' end);
  end loop;
end $$;

-- LE COMPTE DE CONTREPARTIE D'UN ENCAISSEMENT (chantier EC-Q3, étape VF4b) : une colonne de plus d'une table au plan,
-- recopiée avec sa ligne. Ce contrôle dit que chaque compte de contrepartie a été restauré tel qu'il était — au moins un,
-- ou rien n'est prouvé, et il le dit ; avant la migration, la colonne n'existe pas et le contrôle attend.
do $$
declare d uuid := (select dossier from essai_restauration._cible); n bigint; egales bigint;
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.encaissements_factures'::regclass
                  and attname = 'compte_contrepartie' and not attisdropped) then
    insert into essai_restauration._controles values
      ('encaissements_factures.compte_contrepartie : EN ATTENTE de la migration ecritures_de_la_vente_facturee', 'absente', 'absente');
    return;
  end if;
  execute 'select count(*), count(*) filter (where e.compte_contrepartie = s.compte_contrepartie) from public.encaissements_factures s'
          || ' left join essai_restauration.encaissements_factures e on e.id = s.id where s.dossier_id = $1 and s.compte_contrepartie is not null'
    into n, egales using d;
  insert into essai_restauration._controles values ('encaissements_factures.compte_contrepartie : chaque encaissement qui le porte, restauré le portant',
    case when n > 0 then n || ' sur ' || n else 'au moins un encaissement' end,
    case when n > 0 then egales || ' sur ' || n else 'aucun compte de contrepartie dans le dossier : rien n''est prouvé' end);
end $$;

-- LA DATE DE LA BASCULE (chantier EC-Q3, étape VF8a ; migration `reglage_des_ventes`, appliquée) : une colonne de plus de
-- `dossiers`, recopiée avec sa ligne, que la restauration envoie telle (elle n'est pas générée). Ce contrôle dit que le
-- dossier basculé a été restauré avec sa date, telle qu'elle était — un dossier daté, ou rien n'est prouvé, et il le dit ;
-- avant la migration, la colonne n'existe pas et le contrôle attend. Ce script recopie les tables, pas leurs gardes : que la
-- garde du réglage laisse la date que le super-administrateur réinsère, et pose celle de toute autre insertion,
-- ventesFacturees.sql le prouve (9c à 9f, 191).
do $$
declare d uuid := (select dossier from essai_restauration._cible); n bigint; egales bigint;
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.dossiers'::regclass
                  and attname = 'ventes_par_les_factures_depuis' and not attisdropped) then
    insert into essai_restauration._controles values
      ('dossiers.ventes_par_les_factures_depuis : EN ATTENTE de la migration reglage_des_ventes', 'absente', 'absente');
    return;
  end if;
  execute 'select count(*), count(*) filter (where e.ventes_par_les_factures_depuis = s.ventes_par_les_factures_depuis'
          || ' and e.ventes_par_les_factures = s.ventes_par_les_factures) from public.dossiers s'
          || ' left join essai_restauration.dossiers e on e.id = s.id where s.id = $1 and s.ventes_par_les_factures_depuis is not null'
    into n, egales using d;
  insert into essai_restauration._controles values ('dossiers.ventes_par_les_factures_depuis : le dossier basculé, restauré avec sa date et son réglage',
    case when n > 0 then n || ' sur ' || n else 'un dossier daté' end,
    case when n > 0 then egales || ' sur ' || n else 'aucune date de bascule dans le dossier : rien n''est prouvé' end);
end $$;

select controle, attendu, observe, observe = attendu as ok from essai_restauration._controles order by controle;

-- ══ 4. Nettoyage ══════════════════════════════════════════════════════════════════════════════════
-- Le schéma d'essai contient de vraies données comptables : ne pas le laisser traîner.
drop schema if exists essai_restauration cascade;
