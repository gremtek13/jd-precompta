-- LA FACTURE VALIDÉE, SOURCE DE SA VENTE, ÉPROUVÉE EN BASE (ligne 28.6, chantier EC-Q3, étape VF2 ; migrations
-- `source_de_la_vente`, 20261018201312, et `encaissements_de_la_vente_facturee`, 20261019070229, en base) — à rejouer par
-- `execute_sql` après toute migration qui touche le réglage `dossiers.ventes_par_les_factures`, la source
-- `factures_emises.source_de_la_vente` et la validation d'une facture (`enregistrer_facture`, les gardes des factures),
-- `lignes_bancaires` (ses contraintes de rapprochement, ses gardes, les fonctions des classements du relevé),
-- `encaissements_factures` et ses fonctions, les colonnes `encaissement_id` et `facture_id` des écritures, le catalogue
-- des rôles, `admin_du_dossier`, `gere_les_ventes`, `gere_la_banque`, `memberships` ou `cabinet_admins` ; et, depuis la
-- migration `virement_mixte` (étape VF5h), les exemplaires des factures (`pieces.facture_id` et ses fonctions), que le
-- classement d'un mouvement lit ; et, depuis la migration `validation_des_ventes_facturees` (étape VF7b), la
-- recomposition d'un bloc (`ecritures_attendues_de_la_periode`, 188).
--
-- Ce qui se prouve ici, et ne se relit pas — chaque refus jugé à son code ET à ses mots, ceux du texte des migrations,
-- que src/lib/sourceDeLaVente.test.ts et src/lib/encaissementsVenteFacturee.test.ts relisent ici :
--   - LE RÉGLAGE (1 à 5) : le cabinet le pose par sa policy ; le client ne le touche pas ; il ne se baisse plus dès
--     qu'une facture source existe, ni pour le cabinet ni pour le propriétaire, la facture nommée ; avant, il se baisse ;
--   - LE RÉGLAGE GARDÉ (6 à 9 ; migration `reglage_des_ventes`, étape VF8a, VF8-Q1 sur sa recommandation) : le membre
--     affecté ne le pose ni ne le baisse, la facture source se disant d'abord, et réécrit le reste du dossier comme hier ;
--     le chef, le chef simple, le propriétaire et le rôle des Edge Functions le posent ; le droit « Ventes » d'un accès en
--     retient la baisse, pour le propriétaire aussi, après la facture source — un accès « Banque » seul, celui d'un autre
--     dossier, rien ; la date posée quand il monte, effacée quand il descend, gardée sinon, quoi qu'une écriture y mette ;
--     à l'insertion, posée par la garde, sauf pour le super-administrateur, qui la réinsère telle qu'elle a été ;
--   - LA SOURCE FIXÉE À LA VALIDATION (10 à 24) : la facture validée d'un dossier qui a basculé est source, son avoir
--     aussi ; une facture validée avant la bascule ne l'est pas, ni son avoir ; un dossier qui n'a pas basculé valide
--     comme hier (sans nature, mixte, dans un exercice validé) ; dans un dossier qui a basculé, la validation se refuse
--     sans nature, mixte, ou à une date que la frontière fige (ses deux phrases, avoir compris), dans cet ordre ; la
--     restauration réinsère une source dans un dossier qui a basculé, jamais ailleurs ; personne ne pose ni ne retire
--     la source ;
--   - LES COLONNES DES ÉCRITURES, FERMÉES (30 à 38) : ni le chef qui n'est pas super-administrateur, ni le membre, ni le
--     propriétaire ne les posent ; le réglage d'une AUTRE source n'ouvre rien ; celui de SA source et la restauration du
--     super-administrateur les ouvrent ; personne ne les change sans le réglage ; une écriture ordinaire s'écrit comme hier ;
--   - G2, LE MOUVEMENT RÉSERVÉ, ET G1 (40 à 59) : le drapeau ne naît posé qu'à la restauration et ne change que par les
--     deux fonctions du cabinet, sous le réglage de CE mouvement ; le mouvement qui justifie un encaissement d'une
--     facture source ne reçoit aucun autre classement — par la policy du cabinet, par une fonction du relevé, par le rôle
--     des Edge Functions — ; libre, cité par une facture qui n'est pas source, par un encaissement retiré ou contre-passé
--     sans mouvement, il se classe comme hier ; contre-passé par un débit, il reste réservé, et le débit aussi ; classé,
--     il ne reçoit rien d'autre ; les deux contraintes de G1 ;
--   - LA GARDE DES ENCAISSEMENTS sans les fonctions (60 à 67) ; et, depuis la migration `insertion_des_encaissements`
--     (VF5H2-Q1), à l'insertion (68 à 69d, et 143c, 143e à 143g) : pour toute facture, ni le propriétaire ni le rôle
--     des Edge Functions ne citent un mouvement classé par ses encaissements — un crédit, ou le débit qu'une
--     contre-passation citerait —, ni ne posent la contre-passation sans mouvement d'un encaissement qui cite un tel
--     mouvement ; la restauration du super-administrateur les réinsère ; les règles d'hier se disent d'abord ; et, au
--     rattachement sous son réglage, pour tous, le super-administrateur compris (68g, 68i, 68j : VF5H2Q1-Q1), la
--     fonction du cabinet le refusant la première, sous ses mots (110b) ;
--   - LES REFUS NEUFS des fonctions, à leur rang : enregistrer (11, 17, 28, 30 — 27 et 29 avant l'étape VF5h2),
--     retirer (6, 7), contre-passer (12, 15 à 20, le cinquième paramètre ; et 2, le droit « Banque » que ce débit
--     demande depuis la migration `contre_passation_banque` : 94 à 96), rattacher (1 à 17), classer (1 à 11), retirer
--     le classement (1 à 4) ; et, pour une facture qui n'est pas source, ce qu'hier rendait : ni frontière, ni
--     mouvement réservé, les plafonds bruts ;
--   - L'IMPAYÉ D'UN ENCAISSEMENT JAMAIS DÉCLARÉ (97 à 97l ; migration `impaye_non_declare`, étape VF5d2) : celui d'une
--     facture source se contre-passe en citant le débit qui le défait, le rang 6 levé à ce seul cas ; ce que la
--     contre-passation écrit, le débit qu'elle réserve et que le cabinet classe par elle, le retrait qu'elle retient,
--     les rangs voisins qui tiennent ;
--   - LE VIREMENT MIXTE (128c à 128k ; migration `virement_mixte`, étape VF5h ; VF2-Q2, selon VF5-Q2) : le crédit
--     partagé entre une facture source et une facture d'avant la bascule se classe avec l'exemplaire unique et validé
--     de celle-ci, les deux encaissements comptés et les frais du tout ; sans lui, le rang 7, neuf, avant les sommes ;
--     retiré, ou défait par sa contre-passation sans mouvement, l'encaissement d'avant ne retient rien et ne compte
--     pas ; seul sur le crédit, il ne le fait pas classer (le rang 6 d'abord) ;
--   - LES REFUS DU REGISTRE POUR LA FACTURE D'AVANT D'UN VIREMENT MIXTE (140 à 144c, et 93b ; migration
--     `registre_virement_mixte`, étape VF5h2, VF5H-Q2) : sur un mouvement classé par ses encaissements, l'encaissement
--     d'une facture qui n'est pas source ne se cite pas (le rang 18 d'`enregistrer_encaissement`, avant le 19), ne se
--     retire pas — ni la contre-passation sans mouvement qui l'en écarte — (le rang 8 de `retirer_encaissement`, et la
--     garde des encaissements, en 23514, sans la fonction), ne se contre-passe pas sans débit (le rang 21
--     d'`annuler_encaissement` ; un débit cité bute avant sur le rang 15) ; le client « Ventes » s'y heurte comme le
--     cabinet ; sur un mouvement libre ou classé autrement, comme hier ; un débit, fût-il classé par ses
--     contre-passations, se refuse d'abord comme débit (le rang 16) ; la facture source du même virement, ses refus
--     d'hier, sous leurs mots ;
--   - LA FRONTIÈRE DES ENCAISSEMENTS (105, 145 à 149b, posés en dernier dans R ; migration
--     `frontiere_des_encaissements`, étape VF7a) : daté d'un exercice validé, un chèque se rattache encore au crédit de
--     janvier, qui se classe par lui (105, 145f, 145g) ; le rang 6 ne refuse plus que la compensation et un autre moyen
--     (145, 145b) ; le rang 9, neuf, refuse un mouvement figé, après le rang 8 et avant le 10, sous l'exercice du
--     MOUVEMENT (145c à 145e, 145h) ; sans les fonctions — le propriétaire, le rôle des Edge Functions, le
--     super-administrateur —, la garde refuse un encaissement ou une contre-passation datés d'un exercice validé, un
--     mouvement figé cité, le retrait, le compte, le rattachement par un autre moyen, celui d'une contre-passation dont
--     l'encaissement cite un mouvement de son jour (que la fonction refuse plus tôt, au rang 16), et une part (146 à
--     148) ; la contre-passation figée d'un chèque sans mouvement se rattache (147h) ; le client « Ventes » s'y heurte
--     comme le cabinet, la raison dite (148b, 148c) ; une facture qui n'est pas source, et ce qui suit la frontière,
--     comme hier (149, 149b) ;
--   - LE CATALOGUE (150 à 158b) : les six rôles et leurs défauts, aucune racine qui en commence une autre, les colonnes,
--     les contraintes, les déclencheurs, la sécurité et les droits des fonctions, les réglages et qui les nomme ;
--   - LES MUTATIONS (160 à 176, puis 177 à 182 pour l'étape VF5h2, 183 à 187 pour l'étape VF7a, 189 à 191 pour l'étape
--     VF8a, 192 à 197 pour VF5H2-Q1) : chacune rejoue un contrôle avec un profil, une
--     cible ou un réglage délibérément faux, et doit MORDRE ;
--   - et que RIEN ne reste en base (199).
--
-- Un seul état : les deux migrations en base. Tout se joue dans quatre dossiers JETABLES du cabinet du dossier `test`
-- (T et R ont basculé, A et N non), au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) ;
-- chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001) — le moteur d'étapes de
-- exemplairesDesFactures.sql, ses six genres et ses profils : « chef » (super-administrateur), « chef_simple » (le compte
-- client rattaché au cabinet comme chef, le temps du contrôle), « membre » (le même, affecté aux dossiers T, A et R — A et
-- R depuis l'étape VF8a, pour le réglage), « client_vb »
-- (un accès du compte client à T, avec « Ventes » et « Banque »), « client_v » (le même accès, avec « Ventes » seul :
-- migration `contre_passation_banque`), « service » (le rôle des Edge Functions), « postgres »
-- (le propriétaire) ; le moteur connaît aussi « client », « inconnu » et « anon », que rien n'emploie ici (l'accès de
-- l'anonyme aux fonctions neuves se lit au catalogue, 155). Une étape « retenir » nommée « * » fusionne aux identifiants
-- l'objet JSON que sa requête rend. Les exercices 2025 validés de T et de A, et les déclarations, se
-- posent en direct par le propriétaire. Les identifiants jetables sont FIXES (préfixe `5f200000`) ; ceux que les
-- fonctions donnent se retiennent. Des macros (`{FJ1}`, `{L1}`…) abrègent les arguments répétés. Les verdicts voyagent
-- dans un réglage LOCAL à la transaction (`essai.ventes_facturees`) : hors de l'outil d'exécution, le fichier se joue en
-- UNE transaction (`psql -1`). Aucune instruction de suppression, aucune mise à jour sans `where`.
--
-- ÉPROUVÉ LE 19/10/2026 SUR UNE RÉPLIQUE, PAS EN PRODUCTION (PostgreSQL 16, UTF8 ; `signature.sql` : les neuf familles
-- égales à la production, les deux migrations en base) : 164 contrôles, 0 en faute, rien n'est resté ; le texte sans
-- ses lignes de commentaire, envoyé en une requête comme le fait l'outil, rend les mêmes verdicts (59 764 caractères,
-- empreinte 1a9d47e64de41b962a5200ccb5269ad5). Les mutations des deux migrations — chaque refus retiré, chaque refus
-- neuf sous un autre code, cinquante opérateurs et conditions, trente et une de la structure (défauts, contraintes,
-- index, déclencheurs, catalogue des rôles, droits) — jouées contre cet essai, encaissementsFactures.sql, factures.sql,
-- planComptable.sql, restauration.sql, rls.sql, transmissionsEncaissements.sql et ventesClient.sql : 251 sur 253 tuées
-- (cet essai seul en tue 201) ; une seule ne l'est que par la suppression d'un encaissement, jouée à part sur la
-- réplique ; les deux survivantes sont équivalentes (un `coalesce` dont la valeur nulle ne se rencontre pas : un avoir
-- validé a toujours sa facture, une facture son dossier).
--
-- 20/10/2026, étape VF4b (migration `ecritures_de_la_vente_facturee`, préparée) : deux contrôles suivent G5 — 38 modifie
-- l'écriture ordinaire qu'il vient de poser, et non la ligne de l'encaissement, que G5 ne laisse plus changer qu'à sa
-- fonction (ecrituresVentesFacturees.sql, 80 à 86) ; 157 lit qui nomme les réglages hors des trois fonctions de VF4b, que
-- ecrituresVentesFacturees.sql (154) compte. Sur la réplique, 164 contrôles justes avant comme après la migration.
--
-- 22/10/2026, migration `contre_passation_banque` (appliquée sous la version `20261022185455` ; chantier EC-Q3, ligne
-- 28.65) : le débit qu'une contre-passation cite demande aussi « Banque », au rang 2, sous les mots et le code du rang
-- 2 d'`enregistrer_encaissement`, avant toute lecture ; les rangs suivants d'`annuler_encaissement` avancent d'un cran
-- (85 à 91). Huit contrôles de plus : 94 à 94e (le client « Ventes » sans « Banque » qui cite un débit, refusé avant ce
-- que les refus suivants lui apprenaient — le montant du débit, un encaissement inconnu, un mouvement d'un autre
-- dossier, un crédit, un débit classé), 95 (sans débit, il contre-passe comme hier), 96 (avec « Banque », il cite le
-- débit) et la mutation 170 (avec « Banque », le rang 2 passe). Sur une réplique dont `signature.sql` égalait la
-- production à 144 migrations (les neuf familles, et l'historique) : sans la migration, 172 contrôles, 5 en faute — 94
-- à 94e, exactement — ; avec elle, 172 justes, rien n'est resté, et les 164 d'hier rendent, ligne à ligne, ce qu'ils
-- rendaient. Dix mutations de la migration (le refus retiré, déplacé après la lecture de l'encaissement ou avant le
-- débit, un autre prédicat, la condition élargie ou faussée, un autre code, un mot changé) : dix tuées par cet essai.
-- Rejoué en production après l'application, sans ses lignes de commentaire (61 813 caractères, `7f0248f2…`) : 172
-- justes, rien n'est resté.
--
-- 23/10/2026, migration `impaye_non_declare` (appliquée le 23/10/2026 sous la version `20261023063657` ; chantier
-- EC-Q3, étape VF5d2, VF5-Q1) : l'encaissement JAMAIS DÉCLARÉ d'une facture source se contre-passe en citant le débit
-- qui le défait — le rang 6 d'`annuler_encaissement` levé à ce seul cas. Quinze contrôles de plus : 97 à 97l (le cas ;
-- ce que la contre-passation écrit ; le débit qu'elle réserve, puis que le cabinet classe par elle ; le retrait de
-- l'encaissement qu'elle retient, puis le sien d'abord ; les rangs 5, 8, 12 et 19 qui tiennent ; le client « Ventes »
-- et « Banque » ; une seconde contre-passation sans débit, qui bute sur le rang 6 avant le rang 8) et les mutations 171
-- à 173 (sans débit, hors facture source, sans « Banque » : le refus d'hier). Sur une réplique dont `signature.sql`
-- égalait la production à 145 migrations (les neuf familles, et l'historique) : sans la migration, 187 contrôles, 10 en
-- faute — 97, 97b à 97i et 97k, exactement — ; avec elle, 187 justes, rien n'est resté, et les 172 d'hier rendent,
-- verdict et observation, ce qu'ils rendaient. Quatorze mutations de la migration — la condition d'hier, chacun de ses
-- deux termes retiré ou inversé, « ou » pour « et », `found` pour `not found`, le refus retiré, sous un autre code ou
-- d'autres mots, jugé après le rang 8 ou après la date — : douze tuées, toutes par cet essai ; les deux survivantes
-- sont équivalentes (la source jugée `is false` ou `not v_source` : elle n'est jamais nulle). Le texte sans ses lignes
-- de commentaire, envoyé en une requête comme le fait l'outil : 66 060 caractères, empreinte
-- 7587424ef3ba9e6251775e2598bebe4b, 187 justes. Rejoué en production après l'application, sans ses lignes de
-- commentaire (66 060 caractères, `7587424e…`) : 187 justes, rien n'est resté.
--
-- 23/10/2026, migration `virement_mixte` (présentée au cabinet, pas encore appliquée ; chantier EC-Q3, étape VF5h ;
-- VF2-Q2, selon VF5-Q2) : `classer_mouvement_par_encaissements` compte aussi l'encaissement d'une facture d'avant la
-- bascule cité sur le mouvement, avec l'exemplaire unique et validé de cette facture, et le refuse sans lui au rang 7,
-- neuf. Le jeu pose trois pièces de vente de T ; 128c dit désormais le rang 7 (hier, la facture d'avant ne comptait
-- pas) ; onze contrôles de plus : 128d à 128k (l'exemplaire désigné, le crédit classé ; ce qui reste du crédit ;
-- l'encaissement d'avant retiré, défait sans mouvement, seul ; le rang 7 avant le rang 9, puis le rang 9 ; les frais du
-- tout) et les mutations 174 à 176 (un exemplaire à valider, deux exemplaires, l'exemplaire d'une autre facture). Sur
-- une réplique dont `signature.sql` égalait la production à 146 migrations (les neuf familles, et l'historique) : sans
-- la migration, 198 contrôles, 9 en faute — 128c à 128e, 128i à 128k, 174 à 176 — ; avec elle, 198 justes, rien n'est
-- resté, et les contrôles d'hier rendent, verdict et observation, ce qu'ils rendaient, hors de 128c et du compte des
-- tables de 199 (les pièces y entrent). Le texte sans ses lignes de commentaire, envoyé en une requête : 71 369
-- caractères, empreinte 70d26257a053e7d0216af5a257a584e8, 198 justes. Les douze mutations du classement, jouées contre
-- cet essai et ecrituresVentesFacturees.sql : dix tuées ; les deux survivantes sont équivalentes (le dossier et la
-- nature d'un exemplaire, que sa garde impose).
--
-- 24/10/2026 — la migration `virement_mixte` APPLIQUÉE en production (`20261024052038`), puis `jumelle_inversee` : ce
-- fichier n'y a pas été rejoué entier ; la signature des neuf familles en production égale celle de la réplique où il a
-- rendu ses 198 justes (HISTORIQUE.md, « LE VIREMENT MIXTE ET LA JUMELLE INVERSÉE EN PRODUCTION »).
--
-- 24/10/2026, migration `registre_virement_mixte` (appliquée le 26/10/2026 ; chantier EC-Q3, étape VF5h2, VF5H-Q2) : pour
-- une facture qui n'est pas source, sur un mouvement classé par ses encaissements — un virement mixte —, le rang 18
-- d'`enregistrer_encaissement` (les plafonds nets passent aux rangs 28 et 30), le rang 8 de `retirer_encaissement`, le
-- rang 21 d'`annuler_encaissement` et la garde au retrait direct (23514). 93b dit désormais le rang 21 (hier, la
-- contre-passation passait) ; trente-cinq verdicts de plus : 140 à 142d (dont 140g, le rang 16 avant le 18), les
-- mutations 177 à 182, et 143 à 144c avec les sept étapes de leur jeu, posé en dernier. Sur une réplique dont
-- `signature.sql` égalait la production à 148 migrations (les neuf familles, et l'historique) : sans la migration, 235
-- verdicts, 12 en faute — 93b, 140 à 140c, 141, 141b, 142, 143b, 143c, 144 à 144c, exactement — ; avec elle, 235 justes,
-- rien n'est resté, et les contrôles d'hier rendent, verdict et observation, ce qu'ils rendaient, hors de 93b. Le texte
-- sans ses lignes de commentaire, envoyé en une requête : 84 414 caractères, empreinte 223838a727548b9e9f8d26f17831c69c,
-- 235 justes. Trente-trois mutations de la migration, jouées contre cet essai et cinq autres : vingt-sept tuées —
-- vingt-cinq par cet essai, deux à l'application (une empreinte de sa garde changée, sa garde de tête retirée) — ; les six
-- survivantes sont équivalentes, déclarées d'avance (HISTORIQUE.md, « LES REFUS DU REGISTRE POUR LA FACTURE D'AVANT D'UN
-- VIREMENT MIXTE »).
--
-- 25/10/2026, migration `frontiere_des_encaissements` (appliquée le 26/10/2026 ; chantier EC-Q3, étape VF7a) : la
-- frontière d'un exercice validé tenue par une garde neuve pour l'encaissement d'une facture source, et le rattachement
-- jugé sur le mouvement. 105 dit désormais que le chèque se rattache au mouvement d'après (hier, le rang 6 le
-- refusait) ; 155 compte la garde ; trente-sept verdicts de plus : les six étapes du jeu de R, 145 à 149b, et les
-- mutations 183 à 187, posés en dernier. Sur une réplique dont `signature.sql` égalait la production à 148 migrations
-- (les neuf familles, et l'historique), munie de `registre_virement_mixte` (VF5h2) : sans la migration, 272
-- verdicts, 23 en faute — 105, 145c à 145h, 146 à 146e, 147 à 147d, 147f à 147h, 148 à 148c et 155, exactement — ;
-- avec elle, 272 justes, rien n'est resté, et les contrôles d'hier rendent, verdict et observation, ce qu'ils
-- rendaient, hors de 105 et 155 ; avec elle sans VF5h2, les douze de VF5h2 en faute, et eux seuls. Le texte sans ses
-- lignes de commentaire, envoyé en une requête : 96 200 caractères, empreinte 58037c913afacf195babb11a4ef2c3d8, 272
-- justes. Quarante-six mutations de la migration, jouées contre cet essai et cinq autres : quarante-deux tuées, quatre
-- équivalentes déclarées d'avance (HISTORIQUE.md, « LA FRONTIÈRE DES ENCAISSEMENTS, EN BASE »).
--
-- 25/10/2026, migration `validation_des_ventes_facturees` (appliquée le 26/10/2026 ; chantier EC-Q3, étape VF7b) : 188,
-- posé en dernier, confronte la recomposition d'un bloc (`ecritures_attendues_de_la_periode`), source par source, à
-- `ecriture_attendue_vente_facturee`, sur les quatre dossiers tels que l'essai les laisse : 27 sources, 0 écart. Sur une
-- réplique égale à la production munie de VF5h2 et de VF7a : sans la migration, 273 verdicts, 1 en faute — 188,
-- exactement — ; avec elle, 273 justes, rien n'est resté, et les contrôles d'hier rendent, verdict et observation, ce
-- qu'ils rendaient. Le texte sans ses lignes de commentaire, envoyé en une requête : 96 784 caractères, empreinte
-- 888fc6c56b993634c2ba97ea8312f4b6, 273 justes (HISTORIQUE.md, « LA VALIDATION REFUSE LES MANQUES DES VENTES
-- FACTURÉES »).
--
-- 25/10/2026, migration `reglage_des_ventes` (appliquée le 26/10/2026 ; chantier EC-Q3, étape VF8a ; VF8-Q1 suivie sur
-- sa recommandation) : le réglage gardé — depuis une session, le chef du cabinet seul le pose ou le baisse, le droit
-- « Ventes » d'un accès en retient la baisse, et la garde date la bascule. 154 dit désormais le déclencheur étendu à
-- l'insertion et à la colonne neuve ; vingt-huit verdicts de plus : 6 à 9f, 158, 158b et les mutations 189 à 191 ; le
-- profil « membre » est affecté aussi à A et à R, et la macro {CLIENT} nomme le compte client. Sur une réplique égale à la
-- production munie de VF5h2, VF7a, VF7b et VF7e (152) : sans la migration, 301 verdicts, 21 en faute — 6, 6b, 6d, 6e, 6g,
-- 7 à 7d, 8, 8b, 9 à 9f, 154, 158, 158b et 191, exactement — ; avec elle, 301 justes, rien n'est resté, et les contrôles
-- d'hier rendent, verdict et observation, ce qu'ils rendaient, hors de 154 ; sur la production seule munie de la seule
-- migration, les mêmes 21 se lèvent et rien d'autre ne change. Le texte sans ses lignes de commentaire, envoyé en une
-- requête : 105 609 caractères, empreinte 4abf04e55e0312daa48d28cc5778aa08, 301 justes. Trente-cinq mutations de la
-- migration, jouées contre cet essai : trente-cinq tuées (HISTORIQUE.md, « LE RÉGLAGE DES VENTES, GARDÉ »).
--
-- 26/10/2026, migration `insertion_des_encaissements` (PRÉPARÉE sous la version provisoire `20261027120000`, pas
-- appliquée ; chantier EC-Q3, VF5H2-Q1, « Oui, la fermer » ; VF5H2Q1-Q1, écrite sur la recommandation le même jour) : à
-- l'insertion, pour qui n'est pas le super-administrateur, la garde des encaissements refuse un mouvement classé par
-- ses encaissements cité — par l'encaissement de toute facture, ou par la contre-passation qui citerait un débit ainsi
-- classé — et la contre-passation sans mouvement d'un encaissement qui cite un tel mouvement ; au rattachement sous son
-- réglage, pour tous, un tel mouvement aussi. 64b dit désormais le refus (hier, le propriétaire citait M1) ; 67b et
-- 143c posent leur contre-passation par la restauration (la session du super-administrateur jouée dans le contrôle),
-- puis le rôle des Edge Functions la retire, refusé comme hier ; vingt-quatre verdicts de plus : 68 à 69d, 110b, 143e à
-- 143g et les mutations 192 à 197. Sur une réplique égale à la production à 153 migrations (les neuf familles, et
-- l'historique) : la sortie rend 324 lignes (323 verdicts et la ligne d'information ; 300 hier) ; sans la migration, 13
-- en faute — 64b, 68 à 68e, 68g, 68i, 68j, 69, 69b, 143e et 143f, exactement — ; avec elle, 0, rien n'est resté, et les
-- contrôles d'hier rendent, verdict et observation, ce qu'ils rendaient, hors du refus de 64b et des noms de 67b et
-- 143c. Le texte sans ses lignes de commentaire, envoyé en une requête : 113 217 caractères, empreinte
-- a6567da4ac0ead6bb142006c9a814cff, 0 en faute. Vingt-six mutations de la migration, jouées contre cet essai et cinq
-- autres : vingt-trois tuées, trois équivalentes déclarées d'avance (HISTORIQUE.md, « L'INSERTION DIRECTE D'UN
-- ENCAISSEMENT SUR UN MOUVEMENT CLASSÉ PAR SES ENCAISSEMENTS »).
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  cabinet uuid;
  ids jsonb;
  etapes text[];
  etape text[];
  cle text; valeur text; s text; attendu text; n bigint;
  tables text[] := array['dossiers', 'factures_emises', 'facture_lignes', 'facture_numerotation', 'lignes_bancaires',
    'encaissements_factures', 'encaissements_factures_taux', 'ecritures_brouillon', 'exercices_valides', 'transmissions_factures',
    'transmissions_encaissements', 'cabinet_admins', 'dossier_assignations', 'memberships', 'pieces'];
  accepte boolean; code_recu text; message text; obs text;
  avant text; apres text;
  verdicts jsonb := '[]'::jsonb;
begin
  select cabinet_id into cabinet from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24';
  if cabinet is null
     or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cabinet and role = 'comptable_en_chef')
     or not exists (select 1 from auth.users where id = client)
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou client déjà rattaché au cabinet';
  end if;

  ids := jsonb_build_object('CAB', cabinet, 'X', gen_random_uuid(),
      'T', '5f200000-0000-4000-8000-0000000000d1', 'A', '5f200000-0000-4000-8000-0000000000d2',
      'R', '5f200000-0000-4000-8000-0000000000d3', 'N', '5f200000-0000-4000-8000-0000000000d4',
      'W', '5f200000-0000-4000-8000-0000000000e1', 'CP', '5f200000-0000-4000-8000-0000000000e2',
      'Y1', '5f200000-0000-4000-8000-0000000000e3', 'Y2', '5f200000-0000-4000-8000-0000000000e4',
      'PE1', '5f200000-0000-4000-8000-0000000000f1', 'PE2', '5f200000-0000-4000-8000-0000000000f2',
      'PE3', '5f200000-0000-4000-8000-0000000000f3', 'D8', '5f200000-0000-4000-8000-0000000000d8')
    || jsonb_build_object(
      'M1', '5f200000-0000-4000-8000-0000000000b1', 'M2', '5f200000-0000-4000-8000-0000000000b2',
      'M3', '5f200000-0000-4000-8000-0000000000b3', 'M4', '5f200000-0000-4000-8000-0000000000b4',
      'M5', '5f200000-0000-4000-8000-0000000000b5', 'M6', '5f200000-0000-4000-8000-0000000000b6',
      'M7', '5f200000-0000-4000-8000-0000000000b7', 'M8', '5f200000-0000-4000-8000-0000000000b8',
      'M9', '5f200000-0000-4000-8000-0000000000b9', 'M10', '5f200000-0000-4000-8000-0000000000ba',
      'M11', '5f200000-0000-4000-8000-0000000000bb', 'M12', '5f200000-0000-4000-8000-0000000000bc',
      'MB', '5f200000-0000-4000-8000-0000000000bd', 'MC', '5f200000-0000-4000-8000-0000000000be',
      'MA', '5f200000-0000-4000-8000-0000000000c1', 'MD', '5f200000-0000-4000-8000-0000000000c2',
      'MK', '5f200000-0000-4000-8000-0000000000c3', 'M0', '5f200000-0000-4000-8000-0000000000bf', 'M13', '5f200000-0000-4000-8000-0000000000c4',
      'MV', '5f200000-0000-4000-8000-0000000000c5')
    -- La frontière des encaissements (étape VF7a), dans R : six encaissements, deux contre-passations et six mouvements.
    || jsonb_build_object(
      'ER1', '5f200000-0000-4000-8000-0000000000a1', 'ER2', '5f200000-0000-4000-8000-0000000000a2',
      'ER3', '5f200000-0000-4000-8000-0000000000a3', 'MR1', '5f200000-0000-4000-8000-0000000000a4', 'ER4', '5f200000-0000-4000-8000-0000000000a7',
      'MR2', '5f200000-0000-4000-8000-0000000000a5', 'MR3', '5f200000-0000-4000-8000-0000000000a6',
      'ER5', '5f200000-0000-4000-8000-0000000000a8', 'CP5', '5f200000-0000-4000-8000-0000000000a9',
      'ER6', '5f200000-0000-4000-8000-0000000000aa', 'CP6', '5f200000-0000-4000-8000-0000000000ab',
      'MR4', '5f200000-0000-4000-8000-0000000000ac', 'MR5', '5f200000-0000-4000-8000-0000000000ad',
      'MR6', '5f200000-0000-4000-8000-0000000000ae')
    || jsonb_build_object(
      'FJ1', $m$'{"tiers_nom":"ESSAI","tiers_siret":"12345678900012","emetteur_nom":"ESSAI","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb$m$,
      'FJ2', $m$'{"tiers_nom":"ESSAI","tiers_siret":"12345678900012","emetteur_nom":"ESSAI","montant_ht":200,"montant_tva":25.5,"montant_ttc":225.5}'::jsonb$m$,
      'L1', $m$'[{"designation":"x","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb$m$,
      'L2', $m$'[{"designation":"x","quantite":1,"prix_unitaire_ht":100,"taux_tva":20},{"designation":"y","quantite":1,"prix_unitaire_ht":100,"taux_tva":5.5}]'::jsonb$m$,
      'AV', $m$'{"type":"avoir","montant_ht":-10,"montant_tva":-2,"montant_ttc":-12}'::jsonb$m$,
      'LAV', $m$'[{"designation":"x","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb$m$,
      'BIL', $m$set statut = 'rapprochee', compte_bilan = '467000'$m$,
      'EC', $m$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, encaissement_id, facture_id) values ('5f200000-0000-4000-8000-0000000000d1', '2026-03-02', '512000', 'ESSAI', 1, 'debit'$m$,
      'ENC', $m$insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif) values$m$,
      'ENI', $m$insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif) values$m$,
      'MOT', $m$Ce mouvement est déjà classé : l'encaissement d'une facture source de sa vente ne cite qu'un mouvement que rien ne classe encore — retirer d'abord ce classement.$m$,
      'RES', $m$Ce mouvement justifie un encaissement de la facture F2026-0002, source de sa vente : il se classe par ses encaissements, et par rien d'autre.$m$,
      'ECR', $m$Une écriture ne porte une facture ou un encaissement que par la fonction qui écrit la vente facturée.$m$,
      'DEP', $m$Le mouvement dont dépend cet encaissement est classé : le cabinet retire d'abord ce classement.$m$,
      'MLI', $m$Ce mouvement ne justifie aucun encaissement d'une facture source de sa vente : il ne se classe pas par des encaissements.$m$,
      'M50', $m$Les encaissements que ce mouvement justifie font 50,00 € pour un crédit de 100,00 € : ce qui le dépasse reste à traiter.$m$,
      'NAI', $m$Un mouvement ne naît pas classé par des encaissements : le cabinet l'y classe ensuite, par sa fonction.$m$,
      'DRA', $m$Un mouvement ne se classe par ses encaissements, et ne cesse de l'être, que par la fonction du cabinet.$m$,
      'SRC', $m$La source de la vente se fixe à la validation de la facture : elle ne se pose pas.$m$,
      'REG', $m$Les factures de ce dossier sont la source de leurs ventes depuis la facture F2025-0001 : ce réglage ne se défait pas.$m$,
      'CHF', $m$Seul le chef du cabinet change la source des ventes d'un dossier.$m$,
      'VTE', $m$Un accès client de ce dossier porte le droit « Ventes », qui suppose que ses factures soient la source de leurs ventes : retirer d'abord ce droit.$m$,
      'AVE', $m$insert into memberships (user_id, dossier_id, role, droit_ventes, droit_banque) values ('{CLIENT}', $m$,
      'DOS', $m$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, ventes_par_les_factures_depuis) values ('5f200000-0000-4000-8000-0000000000d8', 'ESSAI VF2 D8', $m$,
      'FR5', $m$L'exercice 2025 est validé : une facture source de sa vente, ou son avoir, ne s'y valide plus.$m$,
      'SEU', $m$Seul l'encaissement d'une facture source de sa vente se rattache après coup au mouvement qui le prouve.$m$,
      'DEB', $m$Une contre-passation se justifie par un débit : ce mouvement n'en est pas un.$m$,
      'CRE', $m$Un encaissement se justifie par un crédit : ce mouvement n'en est pas un.$m$,
      'BQE', $m$Le mouvement bancaire d'un encaissement ne se désigne qu'avec le droit « Banque » sur ce dossier : sans lui, l'encaissement s'enregistre sans mouvement.$m$,
      'NDE', $m$Cet encaissement n'est pas déclaré : il se retire, sans contre-passation.$m$,
      'EXF', $m$Désignez d'abord l'exemplaire de la facture F2026-0001 : ce mouvement porte aussi son encaissement, et cette facture, qui n'est pas la source de sa vente, se compte par une seule pièce validée.$m$,
      'ENV', $m$Ce mouvement est déjà classé par ses encaissements : l'encaissement d'une facture qui n'est pas la source de sa vente ne s'y ajoute plus — retirer d'abord ce classement.$m$,
      'RVM', $m$Le mouvement dont dépend cet encaissement est classé par ses encaissements : le cabinet retire d'abord ce classement.$m$,
      'ANV', $m$Le mouvement de l'encaissement contre-passé est classé par ses encaissements : le cabinet retire d'abord ce classement.$m$,
      'ICL', $m$Un mouvement classé par ses encaissements ne se cite pas : ce qu'il justifie ne change plus — le cabinet retire d'abord ce classement.$m$,
      'DEX', $m$select designer_exemplaire_facture('5f200000-0000-4000-8000-0000000000d1', $m$)
    || jsonb_build_object(
      'ENE', $m$select enregistrer_encaissement($m$,
      'ENF', $m$select enregistrer_facture($m$,
      'RAT', $m$select rattacher_mouvement_encaissement($m$,
      'CLA', $m$select classer_mouvement_par_encaissements($m$,
      'RCL', $m$select retirer_classement_par_encaissements($m$,
      'ANN', $m$select annuler_encaissement($m$,
      'RET', $m$select retirer_encaissement($m$);

  foreach cle in array tables loop
    execute format('select count(*) from %I', cle) into n;
    avant := concat_ws('/', avant, n);
  end loop;

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (exact, ou motif LIKE fini par « % ») ou valeur}.
  etapes := array[
    -- ══ Le jeu : quatre dossiers, des mouvements, des factures validées par leur fonction, des encaissements ══════
    array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures) values
      ('{T}', 'ESSAI VF2 T', '{CAB}', 'tresorerie', '455000', false), ('{A}', 'ESSAI VF2 A', '{CAB}', 'tresorerie', '455000', false),
      ('{R}', 'ESSAI VF2 R', '{CAB}', 'tresorerie', '455000', true), ('{N}', 'ESSAI VF2 N', '{CAB}', 'tresorerie', '455000', false)$q$, '', ''],
    array['jeu', 'mouvements', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, compte_bilan) values
      ('{M1}', '{T}', '2026-03-02', 'ESSAI', 100, 'non_rapprochee', null), ('{M2}', '{T}', '2026-03-03', 'ESSAI', 100, 'non_rapprochee', null),
      ('{M3}', '{T}', '2026-03-10', 'ESSAI', -100, 'non_rapprochee', null), ('{M4}', '{T}', '2026-03-04', 'ESSAI', 50, 'rapprochee', '467000'),
      ('{M5}', '{T}', '2026-03-05', 'ESSAI', 10, 'non_rapprochee', null), ('{M6}', '{T}', '2026-03-11', 'ESSAI', -50, 'non_rapprochee', null),
      ('{M7}', '{T}', '2026-03-06', 'ESSAI', 100, 'non_rapprochee', null), ('{M8}', '{T}', '2026-03-12', 'ESSAI', -100, 'non_rapprochee', null),
      ('{M9}', '{T}', '2025-12-31', 'ESSAI', 50, 'non_rapprochee', null), ('{M10}', '{T}', '2026-03-08', 'ESSAI', 50, 'non_rapprochee', null),
      ('{M11}', '{T}', '2026-03-13', 'ESSAI', 1, 'non_rapprochee', null), ('{M12}', '{T}', '2026-03-13', 'ESSAI', -1, 'non_rapprochee', null),
      ('{MB}', '{T}', '2025-12-31', 'ESSAI', 20, 'non_rapprochee', null), ('{MC}', '{T}', '2026-03-14', 'ESSAI', -20, 'rapprochee', '467000'),
      ('{MA}', '{A}', '2026-03-02', 'ESSAI', 100, 'non_rapprochee', null), ('{MD}', '{A}', '2026-03-12', 'ESSAI', -30, 'non_rapprochee', null),
      ('{MK}', '{A}', '2026-03-04', 'ESSAI', 20, 'rapprochee', '467000'), ('{M0}', '{T}', '2026-03-15', 'ESSAI', 0, 'non_rapprochee', null),
      ('{M13}', '{T}', '2026-03-15', 'ESSAI', 98, 'non_rapprochee', null)$q$, '', ''],
    array['jeu', 'pièces de vente de T, que les contrôles du virement mixte désignent (étape VF5h)', 'postgres', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, date_piece, montant_ttc) values
      ('{PE1}', '{T}', '{T}/essai-vf5h-1.pdf', 'essai-vf5h-1.pdf', 'vente', 'validee', '2026-02-01', 120),
      ('{PE2}', '{T}', '{T}/essai-vf5h-2.pdf', 'essai-vf5h-2.pdf', 'vente', 'validee', '2026-02-01', 120),
      ('{PE3}', '{T}', '{T}/essai-vf5h-3.pdf', 'essai-vf5h-3.pdf', 'vente', 'a_valider', '2026-02-01', 120)$q$, '', ''],
    array['fait', '0. le jeu : une facture validée dans T AVANT la bascule (F2026-0001)', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2026-02-01"}', {L1}, true)$q$, 'OK', ''],
    array['fait', '1. le cabinet pose le réglage, par la policy des dossiers', 'chef', $q$update dossiers set ventes_par_les_factures = true where id = '{T}'$q$, 'OK', ''],
    array['fait', '0. le jeu : F2025-0001', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2025-06-01","nature_operation":"services"}', {L1}, true)$q$, 'OK', ''],
    array['fait', '0. le jeu : F2026-0002', 'chef', $q${ENF}'{T}', null, {FJ2} || '{"date_emission":"2026-03-01","nature_operation":"services"}', {L2}, true)$q$, 'OK', ''],
    array['retenir', '*', 'postgres', $q$select jsonb_object_agg(case numero when 'F2026-0001' then 'FP' when 'F2025-0001' then 'F25' else 'F1' end, id)::text from factures_emises where dossier_id = '{T}'$q$, '', ''],
    array['fait', '0. le jeu : l''avoir de F2026-0002', 'chef', $q${ENF}'{T}', null, {AV} || jsonb_build_object('facture_origine_id', '{F1}', 'date_emission', '2026-03-15'), {LAV}, true)$q$, 'OK', ''],
    array['fait', '0. le jeu : l''avoir de la facture d''avant la bascule', 'chef', $q${ENF}'{T}', null, {AV} || jsonb_build_object('facture_origine_id', '{FP}', 'date_emission', '2026-03-15'), {LAV}, true)$q$, 'OK', ''],
    array['fait', '18a. hors bascule, comme hier : sans nature', 'chef', $q${ENF}'{A}', null, {FJ2} || '{"date_emission":"2026-03-01"}', {L2}, true)$q$, 'OK', ''],
    array['retenir', 'FA1', 'postgres', $q$select id::text from factures_emises where dossier_id = '{A}' and numero = 'F2026-0001'$q$, '', ''],
    array['fait', '0. le jeu : l''avoir de la facture de A', 'chef', $q${ENF}'{A}', null, {AV} || jsonb_build_object('facture_origine_id', '{FA1}', 'date_emission', '2026-03-15'), {LAV}, true)$q$, 'OK', ''],
    array['valeur', '10. la source fixée à la validation', 'postgres', $q$select string_agg(numero || '=' || source_de_la_vente, ',' order by dossier_id = '{A}', numero collate "C") from factures_emises where dossier_id in ('{T}', '{A}')$q$, '',
      'A2026-0001=true,A2026-0002=false,F2025-0001=true,F2026-0001=false,F2026-0002=true,A2026-0001=false,F2026-0001=false'],
    array['fait', '0. le jeu : E1', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-02', 100, 'virement', '{M1}', '[{"taux":20,"montant":100}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : ES', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-05', 5, 'cheque', null, '[{"taux":20,"montant":5}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : E7', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-06', 50, 'virement', '{M7}', '[{"taux":5.5,"montant":50}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : E25', 'chef', $q${ENE}'{T}', '{F25}', '2025-06-15', 50, 'virement', '{M9}', '[{"taux":20,"montant":50}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : E25b', 'chef', $q${ENE}'{T}', '{F25}', '2025-12-31', 10, 'cheque', null, '[{"taux":20,"montant":10}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : E26', 'chef', $q${ENE}'{T}', '{F25}', '2026-03-08', 50, 'virement', '{M10}', '[{"taux":20,"montant":50}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : ES2', 'chef', $q${ENE}'{T}', '{F25}', '2026-03-07', 1, 'cheque', null, '[{"taux":20,"montant":1}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : EA', 'chef', $q${ENE}'{A}', '{FA1}', '2026-03-02', 100, 'virement', '{MA}', '[{"taux":20,"montant":100}]')$q$, 'OK', ''],
    array['fait', '0. le jeu : EA25', 'chef', $q${ENE}'{A}', '{FA1}', '2025-06-15', 10, 'cheque', null, '[{"taux":20,"montant":10}]')$q$, 'OK', ''],
    array['retenir', '*', 'postgres', $q$select jsonb_object_agg(case when ligne_bancaire_id = '{M1}' then 'E1' when ligne_bancaire_id = '{M7}' then 'E7' when ligne_bancaire_id = '{M9}' then 'E25' when ligne_bancaire_id = '{M10}' then 'E26' when ligne_bancaire_id = '{MA}' then 'EA' when montant = 5 then 'ES' when montant = 1 then 'ES2' when facture_id = '{FA1}' then 'EA25' else 'E25b' end, id)::text from encaissements_factures where dossier_id in ('{T}', '{A}')$q$, '', ''],
    array['fait', '0. le jeu : M9 classé par ses encaissements', 'chef', $q${CLA}'{T}', '{M9}')$q$, 'OK', ''],
    array['fait', '0. le jeu : M10 classé par ses encaissements', 'chef', $q${CLA}'{T}', '{M10}')$q$, 'OK', ''],
    array['jeu', 'l''exercice 2025 validé dans T et dans A', 'postgres', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values
      ('{T}', 2025, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('a', 64), '{}'), ('{A}', 2025, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('b', 64), '{}')$q$, '', ''],
    array['jeu', 'les factures acceptées, E1, ES, E25 et EA déclarés', 'postgres', $q$insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values
      ('{T}', '{F1}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), 'accepte', 'vf2-1'), ('{T}', '{F25}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), 'accepte', 'vf2-2'),
      ('{A}', '{FA1}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), 'accepte', 'vf2-3');
      insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values
      ('{T}', '{E1}', '{F1}', 'manuel', 'pa.exemple.fr', 'depose'), ('{T}', '{ES}', '{F1}', 'manuel', 'pa.exemple.fr', 'depose'),
      ('{T}', '{E25}', '{F25}', 'manuel', 'pa.exemple.fr', 'depose'), ('{A}', '{EA}', '{FA1}', 'manuel', 'pa.exemple.fr', 'depose')$q$, '', ''],

    -- ══ 1 à 5. Le réglage ══════════
    array['lecture', '2. le client ne touche pas au réglage (la policy le filtre)', 'client_vb', $q$with u as (update dossiers set ventes_par_les_factures = true where id = '{T}' returning 1) select count(*)::text from u$q$, '', '0'],
    array['controle', '3. le réglage ne se baisse plus, la première source nommée', 'chef', $q$update dossiers set ventes_par_les_factures = false where id = '{T}'$q$, '23514', '{REG}'],
    array['controle', '4. … ni pour le propriétaire', 'postgres', $q$update dossiers set ventes_par_les_factures = false where id = '{T}'$q$, '23514', '{REG}'],
    array['controle', '5. avant toute facture source, il se pose et se baisse', 'chef', $q$update dossiers set ventes_par_les_factures = true where id = '{A}'; update dossiers set ventes_par_les_factures = false where id = '{A}'$q$, 'OK', ''],

    -- ══ 6 à 9. Le réglage gardé (étape VF8a, migration `reglage_des_ventes`) : qui le change, ce qui le retient, sa date ══
    -- VF8-Q1, sur sa recommandation : depuis une session, le chef du cabinet seul — le super-administrateur compris — ; le
    -- membre affecté (à T, A et R) ne le pose ni ne le baisse ; sans session — le propriétaire, le rôle des Edge Functions
    -- —, rien ne se juge, comme sous une policy. L'ordre de la garde : la facture source d'abord (le refus d'hier), qui
    -- ensuite, le droit « Ventes » enfin. La date : posée quand le réglage monte, effacée quand il descend, gardée sinon ;
    -- réinsérée telle par le super-administrateur. R a basculé à son insertion et ne porte encore aucune facture ; A, ni
    -- basculé ni source. Chaque contrôle s'annule.
    array['controle', '6. le membre affecté ne pose pas le réglage', 'membre', $q$update dossiers set ventes_par_les_factures = true where id = '{A}'$q$, '42501', '{CHF}'],
    array['controle', '6b. … ni ne le baisse, sans facture source', 'membre', $q$update dossiers set ventes_par_les_factures = false where id = '{R}'$q$, '42501', '{CHF}'],
    array['controle', '6c. … et la facture source se dit d''abord : le refus d''hier, le premier', 'membre', $q$update dossiers set ventes_par_les_factures = false where id = '{T}'$q$, '23514', '{REG}'],
    array['lecture', '6d. la date qu''il écrit seule ne s''écrit pas', 'membre', $q$with u as (update dossiers set ventes_par_les_factures_depuis = now() where id = '{A}' returning ventes_par_les_factures_depuis d) select coalesce(d::text, '∅') from u$q$, '', '∅'],
    array['lecture', '6e. … ni sur un dossier basculé : elle reste celle de sa bascule', 'membre', $q$with avant as (select ventes_par_les_factures_depuis d from dossiers where id = '{R}'), u as (update dossiers set ventes_par_les_factures_depuis = '2020-01-01 00:00:00+00' where id = '{R}' returning ventes_par_les_factures_depuis d) select ((select d from u) = (select d from avant))::text$q$, '', 'true'],
    array['lecture', '6f. il réécrit le dossier comme hier, le réglage à sa valeur compris', 'membre', $q$with u as (update dossiers set nom = nom, ventes_par_les_factures = false where id = '{A}' returning 1) select count(*)::text from u$q$, '', '1'],
    array['controle', '6g. sous un accès « Ventes », la personne se dit avant le droit', 'membre', $q${AVE}'{R}', 'client', true, false); update dossiers set ventes_par_les_factures = false where id = '{R}'$q$, '42501', '{CHF}'],
    array['lecture', '7. le chef le pose : la date posée', 'chef', $q$with u as (update dossiers set ventes_par_les_factures = true where id = '{A}' returning ventes_par_les_factures_depuis d) select (d = now())::text from u$q$, '', 'true'],
    array['lecture', '7b. le chef simple le pose puis le baisse : la date posée, puis effacée', 'chef_simple', $q$update dossiers set ventes_par_les_factures = true where id = '{A}'; with avant as (select ventes_par_les_factures_depuis d from dossiers where id = '{A}'), u as (update dossiers set ventes_par_les_factures = false where id = '{A}' returning ventes_par_les_factures_depuis d) select (select (d = now())::text from avant) || ' -> ' || coalesce((select d::text from u), '∅')$q$, '', 'true -> ∅'],
    array['lecture', '7c. la date écrite avec le réglage ne compte pas : la garde la pose', 'chef', $q$with u as (update dossiers set ventes_par_les_factures = true, ventes_par_les_factures_depuis = '2020-01-01 00:00:00+00' where id = '{A}' returning ventes_par_les_factures_depuis d) select (d = now())::text from u$q$, '', 'true'],
    array['valeur', '7d. un dossier inséré basculé, ou qui a basculé, porte sa date ; les autres, aucune', 'postgres', $q$select string_agg(nom || '=' || coalesce((ventes_par_les_factures_depuis = now())::text, '∅'), ',' order by nom collate "C") from dossiers where id in ('{T}', '{A}', '{R}', '{N}')$q$, '',
      'ESSAI VF2 A=∅,ESSAI VF2 N=∅,ESSAI VF2 R=true,ESSAI VF2 T=true'],
    array['controle', '8. le droit « Ventes » d''un accès retient la baisse', 'chef', $q${AVE}'{R}', 'client', true, false); update dossiers set ventes_par_les_factures = false where id = '{R}'$q$, '23514', '{VTE}'],
    array['controle', '8b. … pour le propriétaire aussi', 'postgres', $q${AVE}'{R}', 'client', true, false); update dossiers set ventes_par_les_factures = false where id = '{R}'$q$, '23514', '{VTE}'],
    array['controle', '8c. … après la facture source, qui se dit d''abord', 'chef', $q${AVE}'{T}', 'client', true, false); update dossiers set ventes_par_les_factures = false where id = '{T}'$q$, '23514', '{REG}'],
    array['controle', '8d. un accès « Banque » seul ne retient rien', 'chef', $q${AVE}'{R}', 'client', false, true); update dossiers set ventes_par_les_factures = false where id = '{R}'$q$, 'OK', ''],
    array['controle', '8e. ni l''accès « Ventes » d''un autre dossier', 'chef', $q${AVE}'{T}', 'client', true, false); update dossiers set ventes_par_les_factures = false where id = '{R}'$q$, 'OK', ''],
    array['controle', '8f. ni, pour le poser, l''accès « Ventes » d''un dossier qui n''a pas basculé', 'chef', $q${AVE}'{A}', 'client', true, false); update dossiers set ventes_par_les_factures = true where id = '{A}'$q$, 'OK', ''],
    array['lecture', '9. le propriétaire passe la garde de la personne : il le pose, la date posée', 'postgres', $q$with u as (update dossiers set ventes_par_les_factures = true where id = '{A}' returning ventes_par_les_factures_depuis d) select (d = now())::text from u$q$, '', 'true'],
    array['lecture', '9b. … et le rôle des Edge Functions', 'service', $q$with u as (update dossiers set ventes_par_les_factures = true where id = '{A}' returning ventes_par_les_factures_depuis d) select (d = now())::text from u$q$, '', 'true'],
    array['lecture', '9c. la restauration : le super-administrateur réinsère un dossier basculé, sa date telle', 'chef', $q${DOS}'{CAB}', 'tresorerie', '455000', true, '2026-01-02 03:04:05+00'); select (ventes_par_les_factures_depuis = '2026-01-02 03:04:05+00')::text from dossiers where id = '{D8}'$q$, '', 'true'],
    array['lecture', '9d. … et une date nulle, nulle : une sauvegarde d''avant l''étape VF8a', 'chef', $q${DOS}'{CAB}', 'tresorerie', '455000', true, null); select coalesce(ventes_par_les_factures_depuis::text, '∅') from dossiers where id = '{D8}'$q$, '', '∅'],
    array['lecture', '9e. toute autre insertion : la garde pose la date, quoi qu''on y mette', 'chef_simple', $q${DOS}'{CAB}', 'tresorerie', '455000', true, '2026-01-02 03:04:05+00'); select (ventes_par_les_factures_depuis = now())::text from dossiers where id = '{D8}'$q$, '', 'true'],
    array['lecture', '9f. … et l''efface d''un dossier qui n''a pas basculé', 'postgres', $q${DOS}'{CAB}', 'tresorerie', '455000', false, '2026-01-02 03:04:05+00'); select coalesce(ventes_par_les_factures_depuis::text, '∅') from dossiers where id = '{D8}'$q$, '', '∅'],
    -- Leurs mutations (étape VF8a) : le même geste par un chef, sans le droit, ou par une autre porte — chacune doit mordre.
    array['controle', '189. MUTATION de 6 et 6b : le chef simple pose le réglage de A, et baisse celui de R', 'chef_simple', $q$update dossiers set ventes_par_les_factures = true where id = '{A}'; update dossiers set ventes_par_les_factures = false where id = '{R}'$q$, 'OK', ''],
    array['controle', '190. MUTATION de 8 : le droit « Ventes » retiré par la fonction du cabinet, la baisse passe', 'chef', $q${AVE}'{R}', 'client', true, false); select changer_droits_acces((select m.id from memberships m where m.dossier_id = '{R}' and m.user_id = '{CLIENT}'), false, null); update dossiers set ventes_par_les_factures = false where id = '{R}'$q$, 'OK', ''],
    array['lecture', '191. MUTATION de 9c : la même insertion par le chef simple, la date posée par la garde', 'chef_simple', $q${DOS}'{CAB}', 'tresorerie', '455000', true, '2026-01-02 03:04:05+00'); select (ventes_par_les_factures_depuis = '2026-01-02 03:04:05+00')::text from dossiers where id = '{D8}'$q$, '', 'false'],

    -- ══ 11 à 26. La source à la validation ══════════
    array['controle', '11. basculé : sans nature, elle ne se valide pas', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2026-03-20"}', {L1}, true)$q$, '23514', 'Dans un dossier dont les factures sont la source de leurs ventes, une facture dit si elle porte sur des biens ou sur des services : la nature de ses opérations est à renseigner avant sa validation.'],
    array['controle', '12. … ni une facture mixte', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2026-03-20","nature_operation":"mixte"}', {L1}, true)$q$, '23514', 'Dans un dossier dont les factures sont la source de leurs ventes, une facture qui mêle biens et services ne se valide pas encore : elle se scinde en deux factures, l''une de biens, l''autre de services, tant que ses lignes ne disent pas leur nature.'],
    array['controle', '13. … ni à une date d''un exercice validé', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2025-07-01","nature_operation":"biens"}', {L1}, true)$q$, '23514', '{FR5}'],
    array['controle', '14. … ni d''un exercice que la validation d''un autre fige', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2024-07-01","nature_operation":"services"}', {L1}, true)$q$, '23514', 'L''exercice 2024 est figé par la validation de l''exercice 2025 : une facture source de sa vente, ou son avoir, ne s''y valide plus.'],
    array['controle', '15. … ni l''avoir d''une facture source à une date figée', 'chef', $q${ENF}'{T}', null, {AV} || jsonb_build_object('facture_origine_id', '{F25}', 'date_emission', '2025-12-31'), {LAV}, true)$q$, '23514', '{FR5}'],
    array['controle', '16. l''ordre : la nature avant la frontière', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2025-07-01"}', {L1}, true)$q$, '23514', 'Dans un dossier dont les factures sont la source de leurs ventes, une facture dit si elle porte sur des biens ou sur des services%'],
    array['controle', '17. l''ordre : la facture mixte avant la frontière', 'chef', $q${ENF}'{T}', null, {FJ1} || '{"date_emission":"2025-07-01","nature_operation":"mixte"}', {L1}, true)$q$, '23514', 'Dans un dossier dont les factures sont la source de leurs ventes, une facture qui mêle biens et services%'],
    array['controle', '18b. hors bascule, comme hier : mixte, à une date figée', 'chef', $q${ENF}'{A}', null, {FJ1} || '{"date_emission":"2025-07-01","nature_operation":"mixte"}', {L1}, true)$q$, 'OK', ''],
    array['controle', '20. la restauration réinsère une source où le dossier a basculé', 'chef', $q$insert into factures_emises (dossier_id, numero, statut, type, date_emission, tiers_nom, emetteur_siret, montant_ht, montant_tva, montant_ttc, validated_at, source_de_la_vente) values ('{R}', 'F2026-0001', 'validee', 'facture', '2026-03-01', 'ESSAI', '12345678900012', 0, 0, 0, now(), true)$q$, 'OK', ''],
    array['controle', '21. … jamais dans un dossier qui n''a pas basculé', 'chef', $q$insert into factures_emises (dossier_id, numero, statut, type, date_emission, tiers_nom, emetteur_siret, montant_ht, montant_tva, montant_ttc, validated_at, source_de_la_vente) values ('{N}', 'F2026-0001', 'validee', 'facture', '2026-03-01', 'ESSAI', '12345678900012', 0, 0, 0, now(), true)$q$, '23514', 'Une facture n''est la source de sa vente que dans un dossier dont les factures sont la source de leurs ventes.'],
    array['controle', '22. personne ne pose la source d''un brouillon : à l''insertion', 'chef', $q$insert into factures_emises (dossier_id, tiers_nom, source_de_la_vente) values ('{T}', 'ESSAI', true)$q$, '42501', '{SRC}'],
    array['controle', '23. … ni après', 'chef', $q$insert into factures_emises (id, dossier_id, tiers_nom) values ('{X}', '{T}', 'ESSAI'); update factures_emises set source_de_la_vente = true where id = '{X}'$q$, '42501', '{SRC}'],
    array['controle', '24. personne ne retire la source d''une facture validée', 'postgres', $q$update factures_emises set source_de_la_vente = false where id = '{F1}'$q$, '23514', 'La facture F2026-0002 est validée : elle ne se modifie plus — la corriger passe par un avoir.'],

    -- ══ 30 à 38. Les colonnes des écritures, fermées ══════════
    array['controle', '30. le chef simple ne pose pas facture_id', 'chef_simple', $q${EC}, null, '{F1}')$q$, '42501', '{ECR}'],
    array['controle', '31. le membre ne pose pas encaissement_id', 'membre', $q${EC}, '{E1}', null)$q$, '42501', '{ECR}'],
    array['controle', '32. le propriétaire non plus, sans le réglage', 'postgres', $q${EC}, '{E1}', '{F1}')$q$, '42501', '{ECR}'],
    array['controle', '33. le réglage d''une AUTRE source n''ouvre rien', 'postgres', $q$select set_config('jd.ecriture_vente_facturee', '{F1}', true); {EC}, '{E1}', '{F1}')$q$, '42501', '{ECR}'],
    array['controle', '34. le réglage de SA source ouvre l''écriture', 'postgres', $q$select set_config('jd.ecriture_vente_facturee', '{E1}', true); {EC}, '{E1}', '{F1}')$q$, 'OK', ''],
    array['fait', '35. la restauration du super-administrateur l''ouvre aussi', 'chef', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens, encaissement_id, facture_id) values ('{W}', '{T}', '2026-03-02', '512000', 'ESSAI', 1, 'debit', '{E1}', '{F1}')$q$, 'OK', ''],
    array['controle', '36. personne ne les change sans le réglage', 'chef', $q$update ecritures_brouillon set facture_id = null where id = '{W}'$q$, '42501', '{ECR}'],
    array['controle', '37. sous le réglage de sa source, elles changent', 'postgres', $q$select set_config('jd.ecriture_vente_facturee', '{E1}', true); update ecritures_brouillon set facture_id = null where id = '{W}'$q$, 'OK', ''],
    array['controle', '38. une écriture ordinaire s''écrit comme hier', 'chef_simple', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values ('{X}', '{T}', '2026-03-02', '512000', 'ESSAI', 1, 'debit'); update ecritures_brouillon set libelle = 'ESSAI 2' where id = '{X}'$q$, 'OK', ''],

    -- ══ 40 à 59. G2, le mouvement réservé, et G1 ══════════
    array['controle', '40. un mouvement ne naît pas classé', 'chef_simple', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, encaissements_de_factures) values ('{T}', '2026-03-02', 'ESSAI', 1, 'rapprochee', true)$q$, '42501', '{NAI}'],
    array['controle', '41. … ni sous le propriétaire', 'postgres', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, encaissements_de_factures) values ('{T}', '2026-03-02', 'ESSAI', 1, 'rapprochee', true)$q$, '42501', '{NAI}'],
    array['controle', '42. la restauration du super-administrateur le réinsère classé', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, encaissements_de_factures) values ('{T}', '2026-03-02', 'ESSAI', 1, 'rapprochee', true)$q$, 'OK', ''],
    array['controle', '43. le drapeau ne se pose pas par la policy du cabinet', 'chef', $q$update lignes_bancaires set encaissements_de_factures = true, statut = 'rapprochee' where id = '{M2}'$q$, '42501', '{DRA}'],
    array['controle', '44. … ni par le rôle des Edge Functions', 'service', $q$update lignes_bancaires set encaissements_de_factures = true, statut = 'rapprochee' where id = '{M2}'$q$, '42501', '{DRA}'],
    array['controle', '45. … ni sous le réglage d''un AUTRE mouvement', 'postgres', $q$select set_config('jd.classement_encaissements', '{M1}', true); update lignes_bancaires set encaissements_de_factures = true, statut = 'rapprochee' where id = '{M2}'$q$, '42501', '{DRA}'],
    array['controle', '46. réservé, aucun autre classement par la policy du cabinet', 'chef', $q$update lignes_bancaires {BIL} where id = '{M1}'$q$, '23514', '{RES}'],
    array['controle', '46b. la facture nommée : celle du premier encaissement', 'chef', $q$insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, cree_le) values ('{T}', '{F1}', '2026-03-03', 1, 'virement', '{M2}', '2026-03-03 10:00+00'), ('{T}', '{F25}', '2026-03-03', 1, 'virement', '{M2}', '2026-03-03 09:00+00'); update lignes_bancaires {BIL} where id = '{M2}'$q$, '23514', 'Ce mouvement justifie un encaissement de la facture F2025-0001, source de sa vente : il se classe par ses encaissements, et par rien d''autre.'],
    array['controle', '47. … ni par une fonction du relevé', 'chef', $q$select ecrire_mouvement_compte_bilan('{M1}', '467000', '[{"compte":"512000","sens":"debit","montant":100},{"compte":"467000","sens":"credit","montant":100}]')$q$, '23514', '{RES}'],
    array['controle', '48. … ni par le rôle des Edge Functions, ni en virement personnel', 'service', $q$update lignes_bancaires set prelevement_personnel = true where id = '{M1}'$q$, '23514', '{RES}'],
    array['controle', '48b. … ni écarté', 'chef', $q$update lignes_bancaires set statut = 'ignoree' where id = '{M1}'$q$, '23514', '{RES}'],
    array['controle', '48c. … ni rapproché sans lien', 'chef', $q$update lignes_bancaires set statut = 'rapprochee' where id = '{M1}'$q$, '23514', '{RES}'],
    array['controle', '49. une mise à jour qui ne le classe pas passe', 'chef', $q$update lignes_bancaires set libelle = 'ESSAI 2' where id = '{M1}'$q$, 'OK', ''],
    array['controle', '50. cité par une facture non source, il se classe comme hier', 'chef', $q$update lignes_bancaires {BIL} where id = '{MA}'$q$, 'OK', ''],
    array['controle', '51. … par un encaissement retiré aussi', 'chef', $q${RET}'{T}', '{E7}'); update lignes_bancaires {BIL} where id = '{M7}'$q$, 'OK', ''],
    array['controle', '52. … et contre-passé sans mouvement', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI'); update lignes_bancaires {BIL} where id = '{M1}'$q$, 'OK', ''],
    array['controle', '52b. réservé de nouveau, la contre-passation retirée', 'chef', $q${ENI} ('{CP}', '{T}', '{F1}', '2026-03-12', -50, 'virement', null, '{E7}', 'ESSAI'); {RET}'{T}', '{CP}'); update lignes_bancaires {BIL} where id = '{M7}'$q$, '23514', '{RES}'],
    array['controle', '53. contre-passé par un débit, il reste réservé', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{M3}'); update lignes_bancaires {BIL} where id = '{M1}'$q$, '23514', '{RES}'],
    array['controle', '54. … et le débit aussi', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{M3}'); update lignes_bancaires {BIL} where id = '{M3}'$q$, '23514', '{RES}'],
    array['lecture', '55. le cabinet le classe ; le réglage retiré après l''appel', 'chef', $q$select concat_ws('|', l.statut, l.encaissements_de_factures::text, coalesce(nullif(current_setting('jd.classement_encaissements', true), ''), 'retiré')) from classer_mouvement_par_encaissements('{T}', '{M1}') l$q$, '', 'rapprochee|true|retiré'],
    array['fait', '56. M1 classé par ses encaissements', 'chef', $q${CLA}'{T}', '{M1}')$q$, 'OK', ''],
    array['controle', '57. classé, il ne reçoit aucun autre classement', 'chef', $q$update lignes_bancaires {BIL} where id = '{M1}'$q$, '23514', 'Ce mouvement est classé par ses encaissements : il ne reçoit aucun autre classement — le cabinet retire d''abord celui-ci.'],
    array['controle', '58. G1 : classé, il ne porte rien d''autre', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, encaissements_de_factures, compte_bilan) values ('{T}', '2026-03-02', 'ESSAI', 1, 'rapprochee', true, '467000')$q$, '23514', '%lignes_bancaires_un_seul_rapprochement%'],
    array['controle', '59. G1 : classé, il est rapproché', 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, encaissements_de_factures) values ('{T}', '2026-03-02', 'ESSAI', 1, true)$q$, '23514', '%lignes_bancaires_encaissements_rapproches%'],

    -- ══ 60 à 67. La garde des encaissements, sans les fonctions ══════════
    array['controle', '60. sous son réglage, une facture non source ne se rattache pas', 'postgres', $q$select set_config('jd.rattachement_encaissement', '{EA25}', true); update encaissements_factures set ligne_bancaire_id = '{MA}' where id = '{EA25}'$q$, '23514', '{SEU}'],
    array['controle', '61. sans le réglage, celui d''une facture source non plus', 'postgres', $q$update encaissements_factures set ligne_bancaire_id = '{M2}' where id = '{ES2}'$q$, '23514', 'Un encaissement ne se modifie pas : jamais déclaré, il se retire, une fois ; déclaré, il se contre-passe.'],
    array['controle', '62. sous son réglage, un mouvement classé ne se cite pas', 'postgres', $q$select set_config('jd.rattachement_encaissement', '{ES2}', true); update encaissements_factures set ligne_bancaire_id = '{M4}' where id = '{ES2}'$q$, '23514', 'Un mouvement déjà classé ne se cite pas : l''encaissement d''une facture source de sa vente ne cite qu''un mouvement que rien d''autre ne classe.'],
    array['controle', '62b. sous son réglage, un débit ne prouve pas un encaissement', 'postgres', $q$select set_config('jd.rattachement_encaissement', '{ES2}', true); update encaissements_factures set ligne_bancaire_id = '{M3}' where id = '{ES2}'$q$, '23514', 'Un encaissement se justifie par un crédit de son dossier.'],
    array['controle', '63. ni à l''insertion par le propriétaire', 'postgres', $q${ENC} ('{T}', '{F1}', '2026-03-04', 1, 'virement', '{M4}', null, null)$q$, '23514', 'Un mouvement déjà classé ne se cite pas%'],
    array['controle', '64. la restauration du super-administrateur le réinsère', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-04', 1, 'virement', '{M4}', null, null)$q$, 'OK', ''],
    array['controle', '64b. … ni, depuis VF5H2-Q1, un mouvement classé par ses encaissements (le propriétaire ; hier, il le citait)', 'postgres', $q${ENC} ('{T}', '{F1}', '2026-03-04', 1, 'virement', '{M1}', null, null)$q$, '23514', '{ICL}'],
    array['controle', '65. la contre-passation d''une source cite un débit, pas zéro', 'postgres', $q${ENC} ('{T}', '{F1}', '2026-03-12', -5, 'cheque', '{M0}', '{ES}', 'ESSAI')$q$, '23514', 'Une contre-passation se justifie par un débit de son dossier.'],
    array['controle', '66. celle d''une facture non source ne cite aucun mouvement', 'postgres', $q${ENC} ('{A}', '{FA1}', '2026-03-12', -100, 'virement', '{MD}', '{EA}', 'ESSAI')$q$, '23514', 'Seule la contre-passation d''une facture source de sa vente cite un mouvement : celui qui défait l''encaissement.'],
    array['controle', '67. le retrait direct, le mouvement classé', 'service', $q$update encaissements_factures set retire_le = now() where id = '{E26}'$q$, '23514', '{DEP}'],
    array['controle', '67b. … celui de l''encaissement qu''une contre-passation annule, que la restauration a posée (le super-administrateur insère ; depuis VF5H2-Q1, nul autre : 69)', 'service', $q$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true); {ENI} ('{CP}', '{T}', '{F25}', '2026-03-12', -50, 'virement', null, '{E26}', 'ESSAI'); select set_config('request.jwt.claims', '{"role":"service_role"}', true); update encaissements_factures set retire_le = now() where id = '{CP}'$q$, '23514', '{DEP}'],

    -- ══ 68 et 69. VF5H2-Q1 : sans les fonctions, un mouvement classé par ses encaissements ══════════
    -- Migration `insertion_des_encaissements` (VF5H2-Q1, « Oui, la fermer »). M1 est classé par ses encaissements (56) ;
    -- E1, de F2026-0002, source, le cite ; ES, de la même facture, n'en cite aucun. Pour toute facture, sans les fonctions
    -- — le propriétaire (64b), le rôle des Edge Functions — : ni un encaissement qui cite M1, ni la contre-passation qui
    -- citerait un débit classé par ses contre-passations (M6, que le cabinet y classe d'abord, ses gestes joués sous sa
    -- session dans le même contrôle), ni la contre-passation sans mouvement de E1 ; la restauration du
    -- super-administrateur les réinsère ; une règle d'hier se dit d'abord (68h, 69d). Au rattachement sous son réglage
    -- aussi (VF5H2Q1-Q1), pour tous — le rôle des Edge Functions (68g), le propriétaire (68i), et sous la session du
    -- super-administrateur (68j) : la restauration insère, elle ne rattache pas — ; la fonction du cabinet le refuse la
    -- première, sous ses mots (110b). La facture d'avant d'un virement mixte : 143c, 143e à 143g. Leurs mutations : 192
    -- à 197.
    array['controle', '68. … ni par le rôle des Edge Functions', 'service', $q${ENC} ('{T}', '{F1}', '2026-03-04', 1, 'virement', '{M1}', null, null)$q$, '23514', '{ICL}'],
    array['controle', '68b. … ni pour la facture d''avant la bascule, qui n''est pas source (le propriétaire)', 'postgres', $q${ENC} ('{T}', '{FP}', '2026-03-04', 1, 'virement', '{M1}', null, null)$q$, '23514', '{ICL}'],
    array['controle', '68c. … ni par le rôle des Edge Functions', 'service', $q${ENC} ('{T}', '{FP}', '2026-03-04', 1, 'virement', '{M1}', null, null)$q$, '23514', '{ICL}'],
    array['controle', '68d. la contre-passation de ES ne cite pas M6, classé par ses contre-passations (le propriétaire, M6 classé par le cabinet)', 'postgres', $q$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true); {ANN}'{T}', '{E7}', '2026-03-12', 'ESSAI', '{M6}'); {CLA}'{T}', '{M6}'); select set_config('request.jwt.claims', '', true); {ENC} ('{T}', '{F1}', '2026-03-12', -5, 'cheque', '{M6}', '{ES}', 'ESSAI')$q$, '23514', '{ICL}'],
    array['controle', '68e. … ni par le rôle des Edge Functions', 'service', $q$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true); {ANN}'{T}', '{E7}', '2026-03-12', 'ESSAI', '{M6}'); {CLA}'{T}', '{M6}'); select set_config('request.jwt.claims', '{"role":"service_role"}', true); {ENC} ('{T}', '{F1}', '2026-03-12', -5, 'cheque', '{M6}', '{ES}', 'ESSAI')$q$, '23514', '{ICL}'],
    array['controle', '68f. la restauration du super-administrateur les réinsère : F2026-0002 et F2026-0001 sur M1, la contre-passation de ES sur M6', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-04', 1, 'virement', '{M1}', null, null), ('{T}', '{FP}', '2026-03-04', 1, 'virement', '{M1}', null, null); {ANN}'{T}', '{E7}', '2026-03-12', 'ESSAI', '{M6}'); {CLA}'{T}', '{M6}'); {ENC} ('{T}', '{F1}', '2026-03-12', -5, 'cheque', '{M6}', '{ES}', 'ESSAI')$q$, 'OK', ''],
    array['controle', '68g. au rattachement sous son réglage aussi (VF5H2Q1-Q1) : ES ne se rattache pas à M1 sans la fonction (le rôle des Edge Functions)', 'service', $q$select set_config('jd.rattachement_encaissement', '{ES}', true); update encaissements_factures set ligne_bancaire_id = '{M1}' where id = '{ES}'$q$, '23514', '{ICL}'],
    array['controle', '68h. … une règle d''hier se dit d''abord : M6 classé, un encaissement ne cite pas un débit (le propriétaire)', 'postgres', $q$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true); {ANN}'{T}', '{E7}', '2026-03-12', 'ESSAI', '{M6}'); {CLA}'{T}', '{M6}'); select set_config('request.jwt.claims', '', true); {ENC} ('{T}', '{F1}', '2026-03-12', 1, 'virement', '{M6}', null, null)$q$, '23514', 'Un encaissement se justifie par un crédit de son dossier.'],
    array['controle', '68i. … ni par le propriétaire', 'postgres', $q$select set_config('jd.rattachement_encaissement', '{ES}', true); update encaissements_factures set ligne_bancaire_id = '{M1}' where id = '{ES}'$q$, '23514', '{ICL}'],
    array['controle', '68j. … ni sous la session du super-administrateur : la restauration insère, elle ne rattache pas (le rôle des Edge Functions)', 'service', $q$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true); select set_config('jd.rattachement_encaissement', '{ES}', true); update encaissements_factures set ligne_bancaire_id = '{M1}' where id = '{ES}'$q$, '23514', '{ICL}'],
    array['controle', '69. la contre-passation sans mouvement de E1, qui cite M1, ne s''insère pas (le propriétaire)', 'postgres', $q${ENC} ('{T}', '{F1}', '2026-03-12', -100, 'virement', null, '{E1}', 'ESSAI')$q$, '23514', '{ANV}'],
    array['controle', '69b. … ni par le rôle des Edge Functions', 'service', $q${ENC} ('{T}', '{F1}', '2026-03-12', -100, 'virement', null, '{E1}', 'ESSAI')$q$, '23514', '{ANV}'],
    array['controle', '69c. la restauration du super-administrateur la réinsère', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-12', -100, 'virement', null, '{E1}', 'ESSAI')$q$, 'OK', ''],
    array['controle', '69d. … une règle d''hier se dit d''abord : une contre-passation d''un autre montant (le propriétaire)', 'postgres', $q${ENC} ('{T}', '{F1}', '2026-03-12', -99, 'virement', null, '{E1}', 'ESSAI')$q$, '23514', 'Une annulation contre-passe l''encaissement montant pour montant.'],
    array['controle', '192. MUTATION de 64b : un mouvement libre (M2), le propriétaire le cite en direct', 'postgres', $q${ENC} ('{T}', '{F1}', '2026-03-04', 1, 'virement', '{M2}', null, null)$q$, 'OK', ''],
    array['controle', '193. MUTATION de 68b : un mouvement classé autrement (M4), la facture d''avant le cite en direct', 'postgres', $q${ENC} ('{T}', '{FP}', '2026-03-04', 1, 'virement', '{M4}', null, null)$q$, 'OK', ''],
    array['controle', '194. MUTATION de 69 : l''encaissement d''un mouvement libre (E7, sur M7) se contre-passe sans mouvement en direct', 'postgres', $q${ENC} ('{T}', '{F1}', '2026-03-12', -50, 'virement', null, '{E7}', 'ESSAI')$q$, 'OK', ''],
    array['controle', '195. MUTATION de 69 : la contre-passation de E1 qui cite un débit libre (M8) passe en direct', 'postgres', $q${ENC} ('{T}', '{F1}', '2026-03-12', -100, 'virement', '{M8}', '{E1}', 'ESSAI')$q$, 'OK', ''],
    array['controle', '197. MUTATION de 68g : sur un mouvement libre (M2), ES se rattache en direct sous son réglage', 'service', $q$select set_config('jd.rattachement_encaissement', '{ES}', true); update encaissements_factures set ligne_bancaire_id = '{M2}' where id = '{ES}'$q$, 'OK', ''],

    -- ══ 70 à 79. Enregistrer un encaissement ══════════
    array['controle', '70. rang 11 : une date d''un exercice validé', 'chef', $q${ENE}'{T}', '{F1}', '2025-12-31', 1, 'cheque', null, '[{"taux":20,"montant":1}]')$q$, '22023', 'L''exercice 2025 est validé : un encaissement de cette facture ne s''y date plus.'],
    array['controle', '71. … et d''un exercice figé par un autre', 'chef', $q${ENE}'{T}', '{F1}', '2024-03-01', 1, 'cheque', null, '[{"taux":20,"montant":1}]')$q$, '22023', 'L''exercice 2024 est figé par la validation de l''exercice 2025 : un encaissement de cette facture ne s''y date plus.'],
    array['controle', '72. une facture qui n''est pas source : ni frontière…', 'chef', $q${ENE}'{A}', '{FA1}', '2025-03-01', 1, 'cheque', null, '[{"taux":20,"montant":1}]')$q$, 'OK', ''],
    array['controle', '73. rang 17 : un mouvement classé autrement', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-04', 1, 'virement', '{M4}', '[{"taux":20,"montant":1}]')$q$, '22023', '{MOT}'],
    array['controle', '74. … ou par ses encaissements (avant le rang 19, « justifie déjà »)', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-04', 1, 'virement', '{M1}', '[{"taux":20,"montant":1}]')$q$, '22023', '{MOT}'],
    array['controle', '75. … ni mouvement réservé', 'chef', $q${ENE}'{A}', '{FA1}', '2026-03-04', 20, 'virement', '{MK}', '[{"taux":5.5,"montant":20}]')$q$, 'OK', ''],
    array['controle', '76. l''ordre : un débit, avant qu''il soit classé', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-14', 1, 'virement', '{MC}', '[{"taux":20,"montant":1}]')$q$, '22023', '{CRE}'],
    array['controle', '77. rang 28 : le total, net des avoirs validés', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-09', 58.51, 'virement', null, '[{"taux":20,"montant":3},{"taux":5.5,"montant":55.51}]')$q$, '22023', 'L''encaissement dépasserait le total de la facture, net de ses avoirs : il reste 58,50 € à encaisser.'],
    array['controle', '78. rang 30 : un taux, net des avoirs', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-09', 4, 'virement', null, '[{"taux":20,"montant":4}]')$q$, '22023', 'À 20 %, l''encaissement dépasserait ce que la facture porte, net de ses avoirs : il reste 3,00 € à encaisser à ce taux.'],
    array['controle', '79. … et les plafonds bruts d''hier', 'chef', $q${ENE}'{A}', '{FA1}', '2026-03-09', 10, 'virement', null, '[{"taux":20,"montant":10}]')$q$, 'OK', ''],

    -- ══ 80 à 82. Retirer un encaissement ══════════
    array['controle', '80. rang 6 : daté d''un exercice validé', 'chef', $q${RET}'{T}', '{E25b}')$q$, '22023', 'L''exercice 2025 est validé : cet encaissement ne se retire plus.'],
    array['controle', '81. rang 7 : son mouvement est classé', 'chef', $q${RET}'{T}', '{E26}')$q$, '22023', '{DEP}'],
    array['controle', '81b. … ou celui de l''encaissement que la contre-passation annule', 'chef', $q${ENI} ('{CP}', '{T}', '{F25}', '2026-03-12', -50, 'virement', null, '{E26}', 'ESSAI'); {RET}'{T}', '{CP}')$q$, '22023', '{DEP}'],
    array['controle', '82. une facture qui n''est pas source : comme hier', 'chef', $q${RET}'{A}', '{EA25}')$q$, 'OK', ''],

    -- ══ 85 à 93. Contre-passer, et le cinquième paramètre ══════════
    array['controle', '85. rang 12 : une date d''un exercice validé', 'chef', $q${ANN}'{T}', '{E25}', '2025-12-31', 'ESSAI')$q$, '22023', 'L''exercice 2025 est validé : une contre-passation ne s''y date plus.'],
    array['controle', '86. rang 15 : le débit d''une facture qui n''est pas source', 'chef', $q${ANN}'{A}', '{EA}', '2026-03-12', 'ESSAI', '{MD}')$q$, '22023', 'Seule la contre-passation d''une facture source de sa vente cite le mouvement qui défait l''encaissement.'],
    array['controle', '87. rang 16 : un mouvement d''un autre dossier', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{MD}')$q$, '22023', 'Ce mouvement n''est pas un mouvement de ce dossier.'],
    array['controle', '88. rang 17 : zéro, ni un crédit', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{M0}')$q$, '22023', '{DEB}'],
    array['controle', '89. rang 18 : un débit déjà classé', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{MC}')$q$, '22023', '{MOT}'],
    array['controle', '90. rang 19 : un débit que la contre-passation dépasse', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{M6}')$q$, '22023', 'Ce mouvement de 50,00 € justifierait 100,00 € de contre-passations : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['controle', '91. rang 20 : sans débit, le mouvement classé par ses encaissements', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI')$q$, '22023', 'Le mouvement de l''encaissement contre-passé est classé par ses encaissements : la contre-passation cite le débit qui défait l''encaissement, ou le cabinet retire d''abord ce classement.'],
    array['controle', '92. le débit qui défait l''encaissement : la contre-passation passe', 'chef', $q${ANN}'{T}', '{E1}', '2026-03-12', 'Chèque revenu impayé', '{M3}')$q$, 'OK', ''],
    array['controle', '93. non source : l''appel d''hier, à quatre paramètres', 'chef', $q${ANN}'{A}', '{EA}', '2026-03-12', 'ESSAI')$q$, 'OK', ''],
    array['controle', '93b. … mais plus sur un mouvement classé par ses encaissements : le rang 21 (étape VF5h2, VF5H-Q2 ; hier elle passait)', 'chef', $q${ENI} ('{CP}', '{T}', '{FP}', '2026-03-02', 10, 'virement', '{M1}', null, null); insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values ('{T}', '{FP}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), 'accepte', 'vf2-4'); insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values ('{T}', '{CP}', '{FP}', 'manuel', 'pa.exemple.fr', 'depose'); {ANN}'{T}', '{CP}', '2026-03-12', 'ESSAI')$q$, '22023', '{ANV}'],

    -- ══ 94 à 96. Le débit cité demande aussi « Banque » (migration contre_passation_banque) ══════════
    -- Le refus du rang 2 d'enregistrer_encaissement, sous ses mots et son code, AVANT toute lecture : sans lui, le
    -- client qui n'a que « Ventes » apprenait du refus suivant ce que la RLS lui cache — le montant d'un débit (94),
    -- qu'un encaissement n'existe pas (94b), qu'un mouvement n'est pas de son dossier (94c), un crédit (94d), un débit
    -- déjà classé (94e).
    array['controle', '94. rang 2 : sans « Banque », le client « Ventes » ne cite pas de débit — le montant ne se dit plus', 'client_v', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{M6}')$q$, '42501', '{BQE}'],
    array['controle', '94b. … avant l''encaissement : un encaissement qui n''existe pas', 'client_v', $q${ANN}'{T}', '{X}', '2026-03-12', 'ESSAI', '{M6}')$q$, '42501', '{BQE}'],
    array['controle', '94c. … avant le mouvement : celui d''un autre dossier', 'client_v', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{MD}')$q$, '42501', '{BQE}'],
    array['controle', '94d. … un crédit', 'client_v', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{M2}')$q$, '42501', '{BQE}'],
    array['controle', '94e. … un débit déjà classé', 'client_v', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{MC}')$q$, '42501', '{BQE}'],
    array['controle', '95. sans débit, le client « Ventes » contre-passe comme hier : le rang 2 ne s''interpose pas', 'client_v', $q${ANN}'{T}', '{ES}', '2026-03-12', 'ESSAI')$q$, 'OK', ''],
    array['controle', '96. avec « Banque », le client cite le débit qui défait l''encaissement', 'client_vb', $q${ANN}'{T}', '{E1}', '2026-03-12', 'Chèque revenu impayé', '{M3}')$q$, 'OK', ''],

    -- ══ 97. L'impayé d'un encaissement jamais déclaré (migration impaye_non_declare, étape VF5d2) ══════════
    -- E7 — 50 € à 5,5 % de F2026-0002, source de sa vente, sur le crédit M7, JAMAIS déclaré — se contre-passe en citant
    -- le débit M6 qui le défait : le rang 6 ne s'y oppose plus. Ce que la contre-passation écrit (97b) ; le débit réservé
    -- à ses contre-passations (97c), que le cabinet classe par elles (97d) ; vivante, elle retient le retrait de
    -- l'encaissement, et se retire d'abord (97e, 97f) ; les rangs qui suivent le 6 tiennent — la frontière (97g), le débit
    -- trop petit (97h), la contre-passation vivante (97i) —, et celui qui le précède aussi (97j) ; le client « Ventes » et
    -- « Banque » contre-passe ainsi (97k) ; la paire faite, une seconde contre-passation sans débit bute sur le rang 6
    -- avant le rang 8 (97l). Leurs mutations, 171 à 173 : sans débit, hors facture source, sans « Banque » — le refus
    -- d'hier.
    array['controle', '97. rang 6 levé : l''encaissement jamais déclaré d''une facture source se contre-passe, en citant le débit qui le défait', 'chef', $q${ANN}'{T}', '{E7}', '2026-03-12', 'Chèque revenu impayé', '{M6}')$q$, 'OK', ''],
    array['lecture', '97b. … ce qu''elle écrit : montant et part opposés, même moyen, le débit cité ; rien n''est déclaré', 'chef', $q$select set_config('essai.cp', (select a.id from annuler_encaissement('{T}', '{E7}', '2026-03-12', 'Chèque revenu impayé', '{M6}') a)::text, true); select concat_ws('|', c.montant, c.moyen, c.date_encaissement, c.ligne_bancaire_id = '{M6}', c.annule_id = '{E7}', c.motif, (select string_agg(trim_scale(t.taux)::text || ':' || t.montant, ',') from encaissements_factures_taux t where t.encaissement_id = c.id), (select count(*) from transmissions_encaissements x where x.encaissement_id in ('{E7}', c.id))) from encaissements_factures c where c.id = current_setting('essai.cp')::uuid$q$, '', '-50|virement|2026-03-12|t|t|Chèque revenu impayé|5.5:-50|0'],
    array['controle', '97c. … le débit cité, réservé à ses contre-passations (G2) : aucun autre classement', 'chef', $q${ANN}'{T}', '{E7}', '2026-03-12', 'ESSAI', '{M6}'); update lignes_bancaires {BIL} where id = '{M6}'$q$, '23514', '{RES}'],
    array['controle', '97d. … et le cabinet le classe par elles', 'chef', $q${ANN}'{T}', '{E7}', '2026-03-12', 'ESSAI', '{M6}'); {CLA}'{T}', '{M6}')$q$, 'OK', ''],
    array['controle', '97e. … vivante, elle retient le retrait de l''encaissement', 'chef', $q${ANN}'{T}', '{E7}', '2026-03-12', 'ESSAI', '{M6}'); {RET}'{T}', '{E7}')$q$, '22023', 'Cet encaissement est annulé par une contre-passation : retirez d''abord celle-ci.'],
    array['controle', '97f. … retirée d''abord, puis lui : l''une et l''autre se retirent', 'chef', $q$select set_config('essai.cp', (select a.id from annuler_encaissement('{T}', '{E7}', '2026-03-12', 'ESSAI', '{M6}') a)::text, true); {RET}'{T}', current_setting('essai.cp')::uuid); {RET}'{T}', '{E7}')$q$, 'OK', ''],
    array['controle', '97g. les rangs qui suivent tiennent : la frontière d''un exercice validé (rang 12)', 'chef', $q${ANN}'{T}', '{E25b}', '2025-12-31', 'ESSAI', '{M6}')$q$, '22023', 'L''exercice 2025 est validé : une contre-passation ne s''y date plus.'],
    array['controle', '97h. … un débit que la contre-passation dépasse (rang 19)', 'chef', $q${ANN}'{T}', '{E7}', '2026-03-12', 'ESSAI', '{M12}')$q$, '22023', 'Ce mouvement de 1,00 € justifierait 50,00 € de contre-passations : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['controle', '97i. … une contre-passation déjà vivante (rang 8)', 'chef', $q${ANN}'{T}', '{E7}', '2026-03-12', 'ESSAI', '{M6}'); {ANN}'{T}', '{E7}', '2026-03-13', 'ESSAI', '{M8}')$q$, '22023', 'Cet encaissement est déjà annulé par une contre-passation.'],
    array['controle', '97j. … et celui qui le précède : un encaissement retiré (rang 5)', 'chef', $q${RET}'{T}', '{E7}'); {ANN}'{T}', '{E7}', '2026-03-12', 'ESSAI', '{M6}')$q$, '22023', 'Un encaissement retiré ne s''annule pas : il n''a jamais été déclaré.'],
    array['controle', '97k. le client « Ventes » et « Banque » le contre-passe ainsi', 'client_vb', $q${ANN}'{T}', '{E7}', '2026-03-12', 'Chèque revenu impayé', '{M6}')$q$, 'OK', ''],
    array['controle', '97l. la paire faite, une seconde contre-passation sans débit : le rang 6 avant le rang 8', 'chef', $q${ANN}'{T}', '{E7}', '2026-03-12', 'ESSAI', '{M6}'); {ANN}'{T}', '{E7}', '2026-03-13', 'ESSAI')$q$, '22023', '{NDE}'],

    -- ══ 100 à 117. Rattacher un encaissement à son mouvement ══════════
    array['controle', '100. rang 1 : le client, même avec « Ventes » et « Banque »', 'client_vb', $q${RAT}'{T}', '{ES2}', '{M5}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '101. rang 2 : l''encaissement d''un autre dossier', 'chef', $q${RAT}'{T}', '{EA25}', '{M5}')$q$, 'P0002', 'Encaissement introuvable dans ce dossier.'],
    array['controle', '102. rang 3 : retiré', 'chef', $q${RET}'{T}', '{ES2}'); {RAT}'{T}', '{ES2}', '{M5}')$q$, '22023', 'Cet encaissement est retiré : il ne se rattache plus à un mouvement.'],
    array['controle', '103. rang 4 : il cite déjà un mouvement', 'chef', $q${RAT}'{T}', '{E1}', '{M5}')$q$, '22023', 'Cet encaissement cite déjà un mouvement : il ne se rattache qu''une fois.'],
    array['controle', '104. rang 5 : une facture qui n''est pas source', 'chef', $q${RAT}'{A}', '{EA25}', '{MA}')$q$, '22023', '{SEU}'],
    array['controle', '105. rang 6 : daté d''un exercice validé, un chèque se rattache encore au mouvement d''après (étape VF7a)', 'chef', $q${RAT}'{T}', '{E25b}', '{M5}')$q$, 'OK', ''],
    array['controle', '106. rang 7 : aucun mouvement désigné', 'chef', $q${RAT}'{T}', '{ES2}', null)$q$, '22023', 'Le mouvement à rattacher est à désigner.'],
    array['controle', '107. rang 8 : un mouvement d''un autre dossier', 'chef', $q${RAT}'{T}', '{ES2}', '{MA}')$q$, '22023', 'Ce mouvement n''est pas un mouvement de ce dossier.'],
    array['controle', '108. rang 9 : zéro, ni un débit, pour un encaissement', 'chef', $q${RAT}'{T}', '{ES2}', '{M0}')$q$, '22023', '{CRE}'],
    array['controle', '109. rang 10 : un crédit pour une contre-passation', 'chef', $q${RAT}'{T}', (annuler_encaissement('{T}', '{ES}', '2026-03-13', 'ESSAI')).id, '{M5}')$q$, '22023', '{DEB}'],
    array['controle', '110. rang 11 : un mouvement déjà classé', 'chef', $q${RAT}'{T}', '{ES2}', '{M4}')$q$, '22023', '{MOT}'],
    array['controle', '110b. … ni un mouvement classé par ses encaissements (M1) : la fonction le refuse avant d''écrire, sous ses mots (VF5H2Q1-Q1)', 'chef', $q${RAT}'{T}', '{ES2}', '{M1}')$q$, '22023', '{MOT}'],
    array['controle', '111. rang 12 : il justifie déjà un encaissement de la facture', 'chef', $q${RAT}'{T}', '{ES}', '{M7}')$q$, '22023', 'Ce mouvement justifie déjà un encaissement de cette facture.'],
    array['controle', '112. rang 13 : l''écart des frais, sur les encaissements', 'chef', $q${RAT}'{T}', '{ES}', '{M11}')$q$, '22023', 'Ce mouvement de 1,00 € justifierait 5,00 € d''encaissements : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['controle', '113. rang 14 : l''écart des frais, sur les contre-passations', 'chef', $q${RAT}'{T}', (annuler_encaissement('{T}', '{ES}', '2026-03-13', 'ESSAI')).id, '{M12}')$q$, '22023', 'Ce mouvement de 1,00 € justifierait 5,00 € de contre-passations : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['controle', '114. rang 15 : le mouvement de l''encaissement contre-passé, classé', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-12', -100, 'virement', null, '{E1}', 'ESSAI'); {RAT}'{T}', (select id from encaissements_factures where annule_id = '{E1}'), '{M3}')$q$, '22023', 'Le mouvement de l''encaissement contre-passé est classé : rattachée à un débit, la contre-passation le lui ferait justifier de nouveau — le cabinet retire d''abord ce classement.'],
    array['controle', '115. rang 16 : … ou qu''il justifierait alors au-delà des frais', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-12', -50, 'virement', null, '{E7}', 'ESSAI'); {ENE}'{T}', '{F1}', '2026-03-06', 55, 'virement', '{M7}', '[{"taux":5.5,"montant":55}]'); {RAT}'{T}', (select id from encaissements_factures where annule_id = '{E7}'), '{M6}')$q$, '22023', 'Le mouvement de l''encaissement contre-passé, de 100,00 €, justifierait alors 105,00 € d''encaissements : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['lecture', '116. le cabinet rattache ; le réglage retiré après l''appel', 'chef', $q$select concat_ws('|', (e.ligne_bancaire_id = '{M5}')::text, coalesce(nullif(current_setting('jd.rattachement_encaissement', true), ''), 'retiré')) from rattacher_mouvement_encaissement('{T}', '{ES2}', '{M5}') e$q$, '', 'true|retiré'],
    array['controle', '117. la contre-passation rattachée, l''encaissement justifie de nouveau', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-12', -50, 'virement', null, '{E7}', 'ESSAI'); {RAT}'{T}', (select id from encaissements_factures where annule_id = '{E7}'), '{M6}'); {CLA}'{T}', '{M7}')$q$, '22023', '{M50}'],

    -- ══ 120 à 139. Classer un mouvement par ses encaissements, et retirer ce classement ══════════
    array['controle', '120. rang 1 : le client, même avec « Ventes » et « Banque »', 'client_vb', $q${CLA}'{T}', '{M7}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '121. le client cite un mouvement (P2), et ne le classe pas', 'client_vb', $q${ENE}'{T}', '{F25}', '2026-03-05', 9, 'virement', '{M5}', '[{"taux":20,"montant":9}]'); {CLA}'{T}', '{M5}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '122. … le citer, il le peut', 'client_vb', $q${ENE}'{T}', '{F25}', '2026-03-05', 9, 'virement', '{M5}', '[{"taux":20,"montant":9}]')$q$, 'OK', ''],
    array['controle', '124. rang 2 : le mouvement d''un autre dossier', 'chef', $q${CLA}'{T}', '{MA}')$q$, 'P0002', 'Mouvement introuvable dans ce dossier.'],
    array['controle', '125. rang 3 : daté d''un exercice validé', 'chef', $q${CLA}'{T}', '{MB}')$q$, '22023', 'L''exercice 2025 est validé : ce mouvement ne change plus.'],
    array['controle', '126. rang 4 : déjà classé par ses encaissements', 'chef', $q${CLA}'{T}', '{M1}')$q$, '22023', 'Ce mouvement est déjà classé par ses encaissements.'],
    array['controle', '127. rang 5 : classé autrement', 'chef', $q${CLA}'{T}', '{M4}')$q$, '22023', 'Ce mouvement est déjà classé : retirer d''abord ce classement.'],
    array['controle', '128. rang 6 : rien d''une facture source', 'chef', $q${CLA}'{T}', '{M2}')$q$, '22023', '{MLI}'],
    array['controle', '128b. … une facture qui n''est pas source n''y compte pas', 'chef', $q${CLA}'{A}', '{MA}')$q$, '22023', '{MLI}'],
    array['controle', '128c. VF5h, rang 7 : un crédit partagé avec une facture d''avant la bascule (VF2-Q2), sans l''exemplaire de cette facture', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-03', 50, 'virement', '{M2}', null, null), ('{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}')$q$, '22023', '{EXF}'],
    array['lecture', '128d. … son exemplaire désigné, unique et validé : le crédit se classe, les deux encaissements comptés', 'chef', $q${DEX}'{PE1}', '{FP}'); {ENC} ('{T}', '{F1}', '2026-03-03', 50, 'virement', '{M2}', null, null), ('{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); select concat_ws('|', l.statut, l.encaissements_de_factures::text) from classer_mouvement_par_encaissements('{T}', '{M2}') l$q$, '', 'rapprochee|true'],
    array['controle', '128e. … ce qui reste du crédit compte la facture d''avant', 'chef', $q${DEX}'{PE1}', '{FP}'); {ENC} ('{T}', '{F1}', '2026-03-03', 50, 'virement', '{M2}', null, null), ('{T}', '{FP}', '2026-03-03', 30, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}')$q$, '22023', 'Les encaissements que ce mouvement justifie font 80,00 € pour un crédit de 100,00 € : ce qui le dépasse reste à traiter.'],
    array['controle', '128f. … retiré, l''encaissement de la facture d''avant ne retient pas le crédit, et ne compte pas', 'chef', $q${ENC} ('{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null), ('{T}', '{F1}', '2026-03-03', 50, 'virement', '{M2}', null, null); select retirer_encaissement('{T}', (select id from encaissements_factures where facture_id = '{FP}' and ligne_bancaire_id = '{M2}')); {CLA}'{T}', '{M2}')$q$, '22023', '{M50}'],
    array['controle', '128g. … défait par sa contre-passation sans mouvement, non plus', 'chef', $q$insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id) values ('{Y1}', '{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}'); insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif) values ('{T}', '{FP}', '2026-03-04', -50, 'virement', '{Y1}', 'ESSAI'); {ENC} ('{T}', '{F1}', '2026-03-03', 50, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}')$q$, '22023', '{M50}'],
    array['controle', '128h. … seule sur le crédit, elle ne le fait pas classer : le rang 6 avant le 7', 'chef', $q${ENC} ('{T}', '{FP}', '2026-03-03', 100, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}')$q$, '22023', '{MLI}'],
    array['controle', '128i. … le rang 7 avant le 9 : sans son exemplaire, une facture d''avant qui ferait dépasser le crédit', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-03', 100, 'virement', '{M2}', null, null), ('{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}')$q$, '22023', '{EXF}'],
    array['controle', '128j. … son exemplaire désigné, le rang 9 : la facture d''avant comptée, le crédit dépassé au-delà des frais', 'chef', $q${DEX}'{PE1}', '{FP}'); {ENC} ('{T}', '{F1}', '2026-03-03', 100, 'virement', '{M2}', null, null), ('{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}')$q$, '22023', 'Les encaissements que ce mouvement justifie font 150,00 € pour un crédit de 100,00 € : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['controle', '128k. … les frais sont ceux du tout : crédité de 1 € de moins que les deux, il se classe', 'chef', $q${DEX}'{PE1}', '{FP}'); {ENC} ('{T}', '{F1}', '2026-03-03', 51, 'virement', '{M2}', null, null), ('{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}')$q$, 'OK', ''],
    array['controle', '129. rang 8 : un crédit que ses encaissements ne font pas', 'chef', $q${CLA}'{T}', '{M7}')$q$, '22023', '{M50}'],
    array['controle', '130. rang 9 : … ou qu''ils dépassent au-delà des frais', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-03', 120, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}')$q$, '22023', 'Les encaissements que ce mouvement justifie font 120,00 € pour un crédit de 100,00 € : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['controle', '131. rang 10 : un débit que ses contre-passations dépassent', 'chef', $q$insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen) values ('{Y1}', '{T}', '{F1}', '2026-03-12', 120, 'virement'); insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif) values ('{Y2}', '{T}', '{F1}', '2026-03-12', -120, 'virement', '{M8}', '{Y1}', 'ESSAI'); {CLA}'{T}', '{M8}')$q$, '22023', 'Les contre-passations que ce mouvement justifie font 120,00 € pour un débit de 100,00 € : elles le dépassent.'],
    array['controle', '131b. rang 11 : … ou qu''elles ne le font pas aux frais près', 'chef', $q$insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen) values ('{Y1}', '{T}', '{F1}', '2026-03-12', 90, 'virement'); insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif) values ('{Y2}', '{T}', '{F1}', '2026-03-12', -90, 'virement', '{M8}', '{Y1}', 'ESSAI'); {CLA}'{T}', '{M8}')$q$, '22023', 'Les contre-passations que ce mouvement justifie font 90,00 € pour un débit de 100,00 € : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['controle', '132. crédité de 2 % de moins (le seuil) : il se classe', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-15', 100, 'virement', '{M13}', null, null); {CLA}'{T}', '{M13}')$q$, 'OK', ''],
    array['controle', '135. retirer le classement, rang 1 : le client', 'client_vb', $q${RCL}'{T}', '{M1}')$q$, '42501', 'Accès refusé à ce dossier.'],
    array['controle', '136. rang 2 : le mouvement d''un autre dossier', 'chef', $q${RCL}'{T}', '{MA}')$q$, 'P0002', 'Mouvement introuvable dans ce dossier.'],
    array['controle', '137. rang 3 : daté d''un exercice validé', 'chef', $q${RCL}'{T}', '{M9}')$q$, '22023', 'L''exercice 2025 est validé : ce mouvement ne change plus.'],
    array['controle', '138. rang 4 : pas classé par ses encaissements', 'chef', $q${RCL}'{T}', '{M2}')$q$, '22023', 'Ce mouvement n''est pas classé par ses encaissements.'],
    array['lecture', '139. le cabinet retire le classement ; le réglage retiré', 'chef', $q$select concat_ws('|', l.statut, l.encaissements_de_factures::text, coalesce(nullif(current_setting('jd.classement_encaissements', true), ''), 'retiré')) from retirer_classement_par_encaissements('{T}', '{M1}') l$q$, '', 'non_rapprochee|false|retiré'],
    array['controle', '139b. … et le mouvement redevient réservé', 'chef', $q${RCL}'{T}', '{M1}'); update lignes_bancaires {BIL} where id = '{M1}'$q$, '23514', '{RES}'],

    -- ══ 140 à 142. VF5h2 : les refus du registre pour la facture d'avant d'un virement mixte (VF5H-Q2) ══════════
    -- Migration `registre_virement_mixte`. F2026-0001 (FP), validée avant la bascule, n'est pas source. Sur un mouvement
    -- classé par ses encaissements — M1, classé par E1 depuis le contrôle 56 ; M2, classé dans le contrôle même avec
    -- l'exemplaire PE1 de FP, le virement mixte —, son encaissement ne se cite pas (rang 18), ne se retire pas (rang 8),
    -- ne se contre-passe pas sans débit (rang 21) ; sur un mouvement libre (M2) ou classé autrement (M4, un compte de
    -- bilan), comme hier ; un débit classé par ses contre-passations (M6, comme en 97d), le rang 16 d'abord ; la facture
    -- source du même virement, ses refus d'hier. Leurs mutations : 177 à 179 ; la garde et le client, sur un état posé en
    -- dernier : 143 et 144.
    array['controle', '140. rang 18 : la facture d''avant la bascule ne cite pas un mouvement classé par ses encaissements', 'chef', $q${ENE}'{T}', '{FP}', '2026-03-02', 1, 'virement', '{M1}', '[{"taux":20,"montant":1}]')$q$, '22023', '{ENV}'],
    array['controle', '140b. … ni le virement mixte classé qui compte déjà son encaissement : le rang 18 avant le 19', 'chef', $q${DEX}'{PE1}', '{FP}'); {ENC} ('{T}', '{F1}', '2026-03-03', 51, 'virement', '{M2}', null, null), ('{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}'); {ENE}'{T}', '{FP}', '2026-03-03', 1, 'virement', '{M2}', '[{"taux":20,"montant":1}]')$q$, '22023', '{ENV}'],
    array['controle', '140c. … ni pour le client « Ventes » et « Banque »', 'client_vb', $q${ENE}'{T}', '{FP}', '2026-03-02', 1, 'virement', '{M1}', '[{"taux":20,"montant":1}]')$q$, '22023', '{ENV}'],
    array['controle', '140d. sur un mouvement libre, elle le cite comme hier', 'chef', $q${ENE}'{T}', '{FP}', '2026-03-03', 1, 'virement', '{M2}', '[{"taux":20,"montant":1}]')$q$, 'OK', ''],
    array['controle', '140e. … et sur un mouvement classé autrement (un compte de bilan)', 'chef', $q${ENE}'{T}', '{FP}', '2026-03-04', 1, 'virement', '{M4}', '[{"taux":20,"montant":1}]')$q$, 'OK', ''],
    array['controle', '140f. la facture source du même virement mixte : le rang 17, sous ses mots d''hier', 'chef', $q${DEX}'{PE1}', '{FP}'); {ENC} ('{T}', '{F1}', '2026-03-03', 51, 'virement', '{M2}', null, null), ('{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}'); {ENE}'{T}', '{F1}', '2026-03-03', 1, 'virement', '{M2}', '[{"taux":20,"montant":1}]')$q$, '22023', '{MOT}'],
    array['controle', '140g. … et un débit, fût-il classé par ses contre-passations, reste un débit : le rang 16 avant le 18', 'chef', $q${ANN}'{T}', '{E7}', '2026-03-12', 'ESSAI', '{M6}'); {CLA}'{T}', '{M6}'); {ENE}'{T}', '{FP}', '2026-03-12', 1, 'virement', '{M6}', '[{"taux":20,"montant":1}]')$q$, '22023', 'Un encaissement se justifie par un crédit : ce mouvement n''en est pas un.'],
    array['controle', '141. rang 8 : l''encaissement de la facture d''avant que compte un virement mixte classé ne se retire pas', 'chef', $q${DEX}'{PE1}', '{FP}'); {ENC} ('{T}', '{F1}', '2026-03-03', 51, 'virement', '{M2}', null, null); {ENI} ('{Y1}', '{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}'); {RET}'{T}', '{Y1}')$q$, '22023', '{RVM}'],
    array['controle', '141b. … ni la contre-passation sans mouvement qui l''en écarte : retirée, elle le ferait compter de nouveau', 'chef', $q${ENC} ('{T}', '{F1}', '2026-03-03', 100, 'virement', '{M2}', null, null); {ENI} ('{Y1}', '{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); {ENI} ('{Y2}', '{T}', '{FP}', '2026-03-04', -50, 'virement', null, '{Y1}', 'ESSAI'); {CLA}'{T}', '{M2}'); {RET}'{T}', '{Y2}')$q$, '22023', '{RVM}'],
    array['controle', '141c. sur un mouvement classé autrement, il se retire comme hier', 'chef', $q${RET}'{T}', (enregistrer_encaissement('{T}', '{FP}', '2026-03-04', 1, 'virement', '{M4}', '[{"taux":20,"montant":1}]')).id)$q$, 'OK', ''],
    array['controle', '141d. la facture source du même virement mixte : le rang 7, sous ses mots d''hier', 'chef', $q${DEX}'{PE1}', '{FP}'); {ENI} ('{Y1}', '{T}', '{F1}', '2026-03-03', 51, 'virement', '{M2}', null, null); {ENC} ('{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}'); {RET}'{T}', '{Y1}')$q$, '22023', '{DEP}'],
    array['controle', '142. rang 21 : l''encaissement déclaré de la facture d''avant que compte un virement mixte classé ne se contre-passe pas sans débit', 'chef', $q${DEX}'{PE1}', '{FP}'); {ENC} ('{T}', '{F1}', '2026-03-03', 51, 'virement', '{M2}', null, null); {ENI} ('{Y1}', '{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values ('{T}', '{FP}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), 'accepte', 'vf5h2-1'); insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values ('{T}', '{Y1}', '{FP}', 'manuel', 'pa.exemple.fr', 'depose'); {CLA}'{T}', '{M2}'); {ANN}'{T}', '{Y1}', '2026-03-12', 'ESSAI')$q$, '22023', '{ANV}'],
    array['controle', '142b. … le débit cité : le rang 15, avant', 'chef', $q${DEX}'{PE1}', '{FP}'); {ENC} ('{T}', '{F1}', '2026-03-03', 51, 'virement', '{M2}', null, null); {ENI} ('{Y1}', '{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values ('{T}', '{FP}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), 'accepte', 'vf5h2-1'); insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values ('{T}', '{Y1}', '{FP}', 'manuel', 'pa.exemple.fr', 'depose'); {CLA}'{T}', '{M2}'); {ANN}'{T}', '{Y1}', '2026-03-12', 'ESSAI', '{M3}')$q$, '22023', 'Seule la contre-passation d''une facture source de sa vente cite le mouvement qui défait l''encaissement.'],
    array['controle', '142c. sur un mouvement classé autrement, l''encaissement déclaré se contre-passe comme hier', 'chef', $q${ENI} ('{Y1}', '{T}', '{FP}', '2026-03-04', 1, 'virement', '{M4}', null, null); insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values ('{T}', '{FP}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), 'accepte', 'vf5h2-1'); insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values ('{T}', '{Y1}', '{FP}', 'manuel', 'pa.exemple.fr', 'depose'); {ANN}'{T}', '{Y1}', '2026-03-12', 'ESSAI')$q$, 'OK', ''],
    array['controle', '142d. la facture source du même virement mixte : le rang 20, sous ses mots d''hier', 'chef', $q${DEX}'{PE1}', '{FP}'); {ENI} ('{Y1}', '{T}', '{F1}', '2026-03-03', 51, 'virement', '{M2}', null, null); {ENC} ('{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values ('{T}', '{Y1}', '{F1}', 'manuel', 'pa.exemple.fr', 'depose'); {CLA}'{T}', '{M2}'); {ANN}'{T}', '{Y1}', '2026-03-12', 'ESSAI')$q$, '22023', 'Le mouvement de l''encaissement contre-passé est classé par ses encaissements : la contre-passation cite le débit qui défait l''encaissement, ou le cabinet retire d''abord ce classement.'],

    -- ══ 150 à 157. Ce que le catalogue dit ══════════
    array['valeur', '150. les six rôles, et leur défaut lu par un dossier sans plan', 'postgres', $q$select string_agg(role || ':' || array_to_string(racines, '/') || ':' || compte_defaut || ':' || coalesce(libelle_defaut, '∅') || ':' || coalesce(prefixe_auxiliaire_defaut, '∅') || ':' || public.compte_du_role('{T}', role), ',' order by ordre) from roles_comptables where ordre >= 270$q$, '',
      'prestations_de_services:706:706000:Prestations de services:∅:706000,ventes_de_biens:701/707:707000:Ventes de marchandises:∅:707000,tva_collectee_en_attente:44580/44574:445800:Taxes sur le chiffre d''affaires à régulariser ou en attente:∅:445800,valeurs_a_l_encaissement:511:511000:Valeurs à l''encaissement:∅:511000,caisse:53:530000:Caisse:∅:530000,services_bancaires:627:627000:Services bancaires et assimilés:∅:627000'],
    array['valeur', '151. aucune racine du catalogue n''en commence une autre', 'postgres', $q$select count(*)::text from roles_comptables a cross join unnest(a.racines) ra, roles_comptables b cross join unnest(b.racines) rb where a.role <> b.role and rb like ra || '%'$q$, '', '0'],
    array['valeur', '152. les cinq colonnes', 'postgres', $q$select string_agg(c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ',' order by c.relname, a.attname) from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where c.relnamespace = 'public'::regnamespace and not a.attisdropped and (c.relname, a.attname) in (('dossiers', 'ventes_par_les_factures'), ('factures_emises', 'source_de_la_vente'), ('lignes_bancaires', 'encaissements_de_factures'), ('ecritures_brouillon', 'encaissement_id'), ('ecritures_brouillon', 'facture_id'))$q$, '',
      'dossiers.ventes_par_les_factures boolean true false,ecritures_brouillon.encaissement_id uuid false -,ecritures_brouillon.facture_id uuid false -,factures_emises.source_de_la_vente boolean true false,lignes_bancaires.encaissements_de_factures boolean true false'],
    array['valeur', '153. les contraintes, et celle des annulations retirée', 'postgres', $q$select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname) from pg_constraint where conrelid in ('public.factures_emises'::regclass, 'public.lignes_bancaires'::regclass, 'public.ecritures_brouillon'::regclass, 'public.encaissements_factures'::regclass) and conname in ('factures_emises_source_d_une_facture_validee', 'lignes_bancaires_un_seul_rapprochement', 'lignes_bancaires_encaissements_rapproches', 'ecritures_brouillon_encaissement_id_fkey', 'ecritures_brouillon_facture_id_fkey', 'encaissements_factures_annulation_sans_mouvement')$q$, '',
      'ecritures_brouillon_encaissement_id_fkey FOREIGN KEY (encaissement_id) REFERENCES encaissements_factures(id) | ecritures_brouillon_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES factures_emises(id) | factures_emises_source_d_une_facture_validee CHECK (((NOT source_de_la_vente) OR (statut = ''validee''::text))) | lignes_bancaires_encaissements_rapproches CHECK (((NOT encaissements_de_factures) OR ((statut = ''rapprochee''::text) AND (NOT prelevement_personnel)))) | lignes_bancaires_un_seul_rapprochement CHECK ((num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id, NULLIF(ventilee, false), NULLIF(reglement_groupe, false), NULLIF(encaissements_de_factures, false)) <= 1))'],
    array['valeur', '153b. les deux index partiels des écritures', 'postgres', $q$select string_agg(d, ' | ' order by d) from (select pg_get_indexdef(indexrelid) d from pg_index where indrelid = 'public.ecritures_brouillon'::regclass) x where d ~ '(encaissement|facture)_id\)'$q$, '',
      'CREATE INDEX ecritures_brouillon_encaissement_id_idx ON public.ecritures_brouillon USING btree (encaissement_id) WHERE (encaissement_id IS NOT NULL) | CREATE INDEX ecritures_brouillon_facture_id_idx ON public.ecritures_brouillon USING btree (facture_id) WHERE (facture_id IS NOT NULL)'],
    array['valeur', '154. les quatre déclencheurs, actifs', 'postgres', $q$select string_agg(pg_get_triggerdef(oid) || ' ' || tgenabled::text, ' | ' order by tgname) from pg_trigger where not tgisinternal and tgname in ('dossiers_ventes_par_les_factures', 'factures_emises_source_de_la_vente', 'ecritures_brouillon_vente_facturee', 'lignes_bancaires_reservees_aux_encaissements')$q$, '',
      'CREATE TRIGGER dossiers_ventes_par_les_factures BEFORE INSERT OR UPDATE OF ventes_par_les_factures, ventes_par_les_factures_depuis ON public.dossiers FOR EACH ROW EXECUTE FUNCTION garder_ventes_par_les_factures() O | CREATE TRIGGER ecritures_brouillon_vente_facturee BEFORE INSERT OR UPDATE OF encaissement_id, facture_id ON public.ecritures_brouillon FOR EACH ROW EXECUTE FUNCTION garder_ecriture_vente_facturee() O | CREATE TRIGGER factures_emises_source_de_la_vente BEFORE INSERT OR UPDATE ON public.factures_emises FOR EACH ROW EXECUTE FUNCTION fixer_source_de_la_vente() O | CREATE TRIGGER lignes_bancaires_reservees_aux_encaissements BEFORE INSERT OR UPDATE ON public.lignes_bancaires FOR EACH ROW EXECUTE FUNCTION garder_mouvement_reserve() O'],
    array['valeur', '155. sécurité, chemin et droits des fonctions', 'postgres', $q$select string_agg(proname || ':' || prosecdef || ':' || coalesce(array_to_string(proconfig, ','), '-') || ':' || has_function_privilege('anon', oid, 'execute') || ':' || has_function_privilege('authenticated', oid, 'execute'), ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('annuler_encaissement', 'classer_mouvement_par_encaissements', 'encaissement_justifie_son_mouvement', 'enregistrer_encaissement', 'fixer_source_de_la_vente', 'garder_ecriture_vente_facturee', 'garder_encaissement_facture', 'garder_frontiere_des_encaissements', 'garder_mouvement_reserve', 'garder_ventes_par_les_factures', 'mouvement_libre', 'rattacher_mouvement_encaissement', 'retirer_classement_par_encaissements', 'retirer_encaissement')$q$, '',
      'annuler_encaissement:true:search_path=public:false:true,classer_mouvement_par_encaissements:true:search_path=public:false:true,encaissement_justifie_son_mouvement:false:search_path=public:false:false,enregistrer_encaissement:true:search_path=public:false:true,fixer_source_de_la_vente:true:search_path=public:false:false,garder_ecriture_vente_facturee:false:search_path=public:false:false,garder_encaissement_facture:false:search_path=public:false:false,garder_frontiere_des_encaissements:true:search_path=public:false:false,garder_mouvement_reserve:true:search_path=public:false:false,garder_ventes_par_les_factures:true:search_path=public:false:false,mouvement_libre:false:search_path=public:false:true,rattacher_mouvement_encaissement:true:search_path=public:false:true,retirer_classement_par_encaissements:true:search_path=public:false:true,retirer_encaissement:true:search_path=public:false:true'],
    array['valeur', '156. contre-passer : une seule signature, à cinq paramètres', 'postgres', $q$select string_agg(pg_get_function_identity_arguments(oid), ' | ') from pg_proc where pronamespace = 'public'::regnamespace and proname = 'annuler_encaissement'$q$, '', 'p_dossier_id uuid, p_encaissement_id uuid, p_date date, p_motif text, p_ligne_bancaire_id uuid'],
    array['valeur', '157. qui nomme les trois réglages', 'postgres', $q$select string_agg(r || ':' || (select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%' || r || '%' and proname not in ('ecrire_vente_facturee', 'garder_lignes_de_la_vente_facturee', 'retirer_ecriture_vente_facturee')), ' | ' order by r) from unnest(array['jd.classement_encaissements', 'jd.ecriture_vente_facturee', 'jd.rattachement_encaissement']) r$q$, '',
      'jd.classement_encaissements:classer_mouvement_par_encaissements,garder_mouvement_reserve,retirer_classement_par_encaissements | jd.ecriture_vente_facturee:garder_ecriture_vente_facturee | jd.rattachement_encaissement:garder_encaissement_facture,rattacher_mouvement_encaissement'],
    -- L'étape VF8a : la colonne de la date, et la garde qui ne juge la personne qu'à un endroit — la condition de VF8-Q1.
    array['valeur', '158. la date de la bascule : un instant, nul par défaut', 'postgres', $q$select string_agg(format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ',') from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.dossiers'::regclass and a.attname = 'ventes_par_les_factures_depuis' and not a.attisdropped$q$, '',
      'timestamp with time zone false -'],
    array['valeur', '158b. la garde juge la personne une fois, par le chef du cabinet du dossier (VF8-Q1)', 'postgres', $q$select (length(prosrc) - length(replace(prosrc, 'est_chef_du_cabinet', ''))) / length('est_chef_du_cabinet') || ' ' || (prosrc like '%if auth.uid() is not null and not public.est_chef_du_cabinet(old.cabinet_id) then%') from pg_proc where oid = 'public.garder_ventes_par_les_factures()'::regprocedure$q$, '',
      '1 true'],

    -- ══ 160 à 173. Les mutations : chacune doit MORDRE ══════════
    array['controle', '160. MUTATION de 3 : sans facture source, il se baisse', 'chef', $q$update dossiers set ventes_par_les_factures = false where id = '{R}'$q$, 'OK', ''],
    array['controle', '161. MUTATION de 11 : hors bascule, elle se valide', 'chef', $q${ENF}'{A}', null, {FJ1} || '{"date_emission":"2026-03-20"}', {L1}, true)$q$, 'OK', ''],
    array['controle', '162. MUTATION de 30 : le super-administrateur la pose', 'chef', $q${EC}, null, '{F1}')$q$, 'OK', ''],
    array['controle', '163. MUTATION de 45 : sous SON réglage, il change', 'postgres', $q$select set_config('jd.classement_encaissements', '{M2}', true); update lignes_bancaires set encaissements_de_factures = true, statut = 'rapprochee' where id = '{M2}'$q$, 'OK', ''],
    array['controle', '164. MUTATION de 46 : non cité, il se classe', 'chef', $q$update lignes_bancaires {BIL} where id = '{M2}'$q$, 'OK', ''],
    array['controle', '165. MUTATION de 73 : libre, il se cite', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-04', 1, 'virement', '{M2}', '[{"taux":20,"montant":1}]')$q$, 'OK', ''],
    array['controle', '166. MUTATION de 100 : le membre affecté rattache', 'membre', $q${RAT}'{T}', '{ES2}', '{M5}')$q$, 'OK', ''],
    array['controle', '167. MUTATION de 120 : le chef simple classe', 'chef_simple', $q${RCL}'{T}', '{M1}'); {CLA}'{T}', '{M1}')$q$, 'OK', ''],
    array['controle', '168. MUTATION de 60 : une facture source se rattache', 'postgres', $q$select set_config('jd.rattachement_encaissement', '{ES2}', true); update encaissements_factures set ligne_bancaire_id = '{M5}' where id = '{ES2}'$q$, 'OK', ''],
    array['controle', '169. MUTATION de 81 : le classement retiré, il se retire', 'chef', $q${RCL}'{T}', '{M10}'); {RET}'{T}', '{E26}')$q$, 'OK', ''],
    array['controle', '170. MUTATION de 94 : avec « Banque », le rang 2 passe, et le rang 19 dit le montant', 'client_vb', $q${ANN}'{T}', '{E1}', '2026-03-12', 'ESSAI', '{M6}')$q$, '22023', 'Ce mouvement de 50,00 € justifierait 100,00 € de contre-passations : l''écart dépasse ce que des frais bancaires expliquent.'],
    array['controle', '171. MUTATION de 97 : sans débit, le rang 6 retient — le refus d''hier', 'chef', $q${ANN}'{T}', '{E7}', '2026-03-12', 'Chèque revenu impayé')$q$, '22023', '{NDE}'],
    array['controle', '172. MUTATION de 97 : une facture qui n''est pas source, le débit cité — le rang 6 retient, avant le rang 15', 'chef', $q${ANN}'{A}', '{EA25}', '2026-03-12', 'Chèque revenu impayé', '{MD}')$q$, '22023', '{NDE}'],
    array['controle', '173. MUTATION de 97k : sans « Banque », le rang 2 retient le client, avant le rang 6', 'client_v', $q${ANN}'{T}', '{E7}', '2026-03-12', 'Chèque revenu impayé', '{M6}')$q$, '42501', '{BQE}'],
    array['controle', '174. MUTATION de 128d : un exemplaire à valider ne suffit pas — le rang 7', 'chef', $q${DEX}'{PE3}', '{FP}'); {ENC} ('{T}', '{F1}', '2026-03-03', 50, 'virement', '{M2}', null, null), ('{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}')$q$, '22023', '{EXF}'],
    array['controle', '175. MUTATION de 128d : deux exemplaires validés non plus', 'chef', $q${DEX}'{PE1}', '{FP}'); {DEX}'{PE2}', '{FP}'); {ENC} ('{T}', '{F1}', '2026-03-03', 50, 'virement', '{M2}', null, null), ('{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}')$q$, '22023', '{EXF}'],
    array['controle', '176. MUTATION de 128d : l''exemplaire d''une AUTRE facture non plus', 'chef', $q${DEX}'{PE1}', '{F1}'); {ENC} ('{T}', '{F1}', '2026-03-03', 50, 'virement', '{M2}', null, null), ('{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); {CLA}'{T}', '{M2}')$q$, '22023', '{EXF}'],
    array['controle', '177. MUTATION de 140 : le classement retiré, la facture d''avant cite le mouvement', 'chef', $q${RCL}'{T}', '{M1}'); {ENE}'{T}', '{FP}', '2026-03-02', 1, 'virement', '{M1}', '[{"taux":20,"montant":1}]')$q$, 'OK', ''],
    array['controle', '178. MUTATION de 141 : sans le classement, l''encaissement de la facture d''avant se retire', 'chef', $q${DEX}'{PE1}', '{FP}'); {ENC} ('{T}', '{F1}', '2026-03-03', 51, 'virement', '{M2}', null, null); {ENI} ('{Y1}', '{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); {RET}'{T}', '{Y1}')$q$, 'OK', ''],
    array['controle', '179. MUTATION de 142 : sans le classement, il se contre-passe sans débit', 'chef', $q${DEX}'{PE1}', '{FP}'); {ENC} ('{T}', '{F1}', '2026-03-03', 51, 'virement', '{M2}', null, null); {ENI} ('{Y1}', '{T}', '{FP}', '2026-03-03', 50, 'virement', '{M2}', null, null); insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values ('{T}', '{FP}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), 'accepte', 'vf5h2-1'); insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values ('{T}', '{Y1}', '{FP}', 'manuel', 'pa.exemple.fr', 'depose'); {ANN}'{T}', '{Y1}', '2026-03-12', 'ESSAI')$q$, 'OK', ''],

    -- ══ 143 et 144. VF5h2 : la garde et le client, sur deux virements mixtes classés posés EN DERNIER ══════════
    -- Un virement mixte classé ne se monte que par le cabinet (désigner l'exemplaire, classer) : la garde sans la
    -- fonction — le rôle des Edge Functions — et le client, qui n'ont pas ces gestes, le trouvent posé. Posé plus tôt, il
    -- aurait changé ce que voient les contrôles qui suivent (M5, que 166 et 168 rattachent ; PE1, que 174 à 176
    -- désignent). M5 (10 €) porte un encaissement de F2025-0001, source, et EW2, de F2026-0001, jamais déclaré ; MV
    -- (100 €) un encaissement de F2026-0002, source, et EV2, de F2026-0001, déclaré ; PE1 est l'exemplaire de F2026-0001.
    -- Tout s'annule avec l'essai. Leurs mutations : 180 à 182.
    array['jeu', 'VF5h2 : MV, un crédit de 100 €', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{MV}', '{T}', '2026-03-16', 'ESSAI', 100, 'non_rapprochee')$q$, '', ''],
    array['fait', '0. le jeu (VF5h2) : PE1, l''exemplaire de F2026-0001', 'chef', $q${DEX}'{PE1}', '{FP}')$q$, 'OK', ''],
    array['fait', '0. le jeu (VF5h2) : M5 paie F2025-0001…', 'chef', $q${ENE}'{T}', '{F25}', '2026-03-05', 9, 'virement', '{M5}', '[{"taux":20,"montant":9}]')$q$, 'OK', ''],
    array['fait', '0. le jeu (VF5h2) : … et F2026-0001 (EW2, jamais déclaré)', 'chef', $q${ENE}'{T}', '{FP}', '2026-03-05', 1, 'virement', '{M5}', '[{"taux":20,"montant":1}]')$q$, 'OK', ''],
    array['fait', '0. le jeu (VF5h2) : MV paie F2026-0002…', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-16', 50, 'virement', '{MV}', '[{"taux":5.5,"montant":50}]')$q$, 'OK', ''],
    array['fait', '0. le jeu (VF5h2) : … et F2026-0001 (EV2)', 'chef', $q${ENE}'{T}', '{FP}', '2026-03-16', 50, 'virement', '{MV}', '[{"taux":20,"montant":50}]')$q$, 'OK', ''],
    array['retenir', '*', 'postgres', $q$select jsonb_build_object('EW2', (select id from encaissements_factures where facture_id = '{FP}' and ligne_bancaire_id = '{M5}'), 'EV2', (select id from encaissements_factures where facture_id = '{FP}' and ligne_bancaire_id = '{MV}'))::text$q$, '', ''],
    array['jeu', 'VF5h2 : EV2 déclaré', 'postgres', $q$insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values ('{T}', '{FP}', 'plateforme', 'pa.exemple.fr', repeat('ab', 32), 'accepte', 'vf5h2-1'); insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values ('{T}', '{EV2}', '{FP}', 'manuel', 'pa.exemple.fr', 'depose')$q$, '', ''],
    array['fait', '0. le jeu (VF5h2) : M5 classé par ses encaissements', 'chef', $q${CLA}'{T}', '{M5}')$q$, 'OK', ''],
    array['fait', '0. le jeu (VF5h2) : MV classé par ses encaissements', 'chef', $q${CLA}'{T}', '{MV}')$q$, 'OK', ''],
    array['valeur', '143. l''état posé : M5 et MV classés par leurs encaissements, deux chacun, PE1 seul exemplaire de F2026-0001', 'postgres', $q$select concat_ws('|', (select string_agg(l.encaissements_de_factures::text || ':' || (select count(*) from encaissements_factures e where e.ligne_bancaire_id = l.id and e.retire_le is null), ',' order by l.date) from lignes_bancaires l where l.id in ('{M5}', '{MV}')), (select count(*) from pieces where facture_id = '{FP}'))$q$, '', 'true:2,true:2|1'],
    array['controle', '143b. la garde, sans la fonction (le rôle des Edge Functions) : le retrait direct de EW2, que compte M5 classé', 'service', $q$update encaissements_factures set retire_le = now() where id = '{EW2}'$q$, '23514', '{RVM}'],
    array['controle', '143c. … ni celui de la contre-passation sans mouvement qui écarterait EV2 de MV, que la restauration a posée (le super-administrateur insère ; depuis VF5H2-Q1, nul autre : 143e)', 'service', $q$select set_config('request.jwt.claims', json_build_object('sub', '{CHEF}', 'role', 'authenticated')::text, true); {ENI} ('{CP}', '{T}', '{FP}', '2026-03-17', -50, 'virement', null, '{EV2}', 'ESSAI'); select set_config('request.jwt.claims', '{"role":"service_role"}', true); update encaissements_factures set retire_le = now() where id = '{CP}'$q$, '23514', '{RVM}'],
    array['controle', '143d. … sur un mouvement classé autrement, le retrait direct passe comme hier', 'service', $q${ENI} ('{CP}', '{T}', '{FP}', '2026-03-04', 1, 'virement', '{M4}', null, null); update encaissements_factures set retire_le = now() where id = '{CP}'$q$, 'OK', ''],
    array['controle', '143e. VF5H2-Q1 : la contre-passation sans mouvement qui écarterait EV2 de MV ne s''insère pas (le rôle des Edge Functions)', 'service', $q${ENI} ('{CP}', '{T}', '{FP}', '2026-03-17', -50, 'virement', null, '{EV2}', 'ESSAI')$q$, '23514', '{ANV}'],
    array['controle', '143f. … ni par le propriétaire', 'postgres', $q${ENI} ('{CP}', '{T}', '{FP}', '2026-03-17', -50, 'virement', null, '{EV2}', 'ESSAI')$q$, '23514', '{ANV}'],
    array['controle', '143g. … la restauration du super-administrateur la réinsère', 'chef', $q${ENI} ('{CP}', '{T}', '{FP}', '2026-03-17', -50, 'virement', null, '{EV2}', 'ESSAI')$q$, 'OK', ''],
    array['controle', '144. le client « Ventes » et « Banque » ne cite pas MV pour la facture d''avant', 'client_vb', $q${ENE}'{T}', '{FP}', '2026-03-16', 1, 'virement', '{MV}', '[{"taux":20,"montant":1}]')$q$, '22023', '{ENV}'],
    array['controle', '144b. le client « Ventes » seul ne retire pas EW2', 'client_v', $q${RET}'{T}', '{EW2}')$q$, '22023', '{RVM}'],
    array['controle', '144c. … ni ne contre-passe EV2 sans débit', 'client_v', $q${ANN}'{T}', '{EV2}', '2026-03-17', 'ESSAI')$q$, '22023', '{ANV}'],
    array['controle', '180. MUTATION de 143b : le classement de M5 retiré, le retrait direct passe', 'postgres', $q$select set_config('jd.classement_encaissements', '{M5}', true); update lignes_bancaires set encaissements_de_factures = false, statut = 'non_rapprochee' where id = '{M5}'; select set_config('jd.classement_encaissements', '', true); update encaissements_factures set retire_le = now() where id = '{EW2}'$q$, 'OK', ''],
    array['controle', '181. MUTATION de 144b : le classement retiré par le cabinet, EW2 se retire', 'chef', $q${RCL}'{T}', '{M5}'); {RET}'{T}', '{EW2}')$q$, 'OK', ''],
    array['controle', '182. MUTATION de 144c : le classement retiré par le cabinet, EV2 se contre-passe sans débit', 'chef', $q${RCL}'{T}', '{MV}'); {ANN}'{T}', '{EV2}', '2026-03-17', 'ESSAI')$q$, 'OK', ''],
    array['controle', '196. MUTATION de 143e : sur un mouvement classé autrement (M4), l''encaissement de la facture d''avant se contre-passe sans mouvement en direct', 'service', $q${ENI} ('{CP}', '{T}', '{FP}', '2026-03-04', 1, 'virement', '{M4}', null, null); {ENC} ('{T}', '{FP}', '2026-03-12', -1, 'virement', null, '{CP}', 'ESSAI')$q$, 'OK', ''],

    -- ══ 145 à 149. VF7a : la frontière des encaissements, posée EN DERNIER, dans R ══════════
    -- Migration `frontiere_des_encaissements`. R a basculé et ne porte encore aucun exercice validé : le relevé y reçoit
    -- MR1 (+10 €) et MR3 (−10 €) au 31 décembre 2025, MR2 (+10 €) au 5 janvier 2026 ; le cabinet y valide F2025-0001 (FR)
    -- par sa fonction ; la restauration du super-administrateur y pose, sans frontière qui la retienne, le chèque du
    -- 31 décembre (ER1, 10 €) et un encaissement par un autre moyen du même jour (ER2, 5 €) — la frontière même —, sans
    -- répartition. Pour les contre-passations : le relevé reçoit MR4 (+10 €) au 31 décembre, MR5 (−10 €) et MR6 (−5 €)
    -- en janvier ; la restauration pose ER5, un chèque de 10 € du 31 décembre sur MR4, du même jour, et ER6, un chèque de
    -- 5 € sans mouvement ; le cabinet classe MR4 par ER5 ; puis la restauration pose CP5 et CP6, leurs contre-passations
    -- sans mouvement du même jour (CP5, la fonction l'aurait refusée sur MR4 classé ; depuis VF5H2-Q1, seule la
    -- restauration le peut). Puis le propriétaire valide l'exercice 2025, et le cabinet pose un chèque du 2 janvier 2026
    -- (ER4, 5 €).
    -- Posé plus tôt, R aurait changé ce que voient les contrôles d'avant (20 et 160 l'emploient). Tout s'annule avec
    -- l'essai. Leurs mutations : 183 à 187.
    array['jeu', 'VF7a : MR1, MR3 et MR2', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{MR1}', '{R}', '2025-12-31', 'ESSAI', 10, 'non_rapprochee'), ('{MR3}', '{R}', '2025-12-31', 'ESSAI', -10, 'non_rapprochee'), ('{MR2}', '{R}', '2026-01-05', 'ESSAI', 10, 'non_rapprochee')$q$, '', ''],
    array['fait', '0. le jeu (VF7a) : FR, F2025-0001 de R', 'chef', $q${ENF}'{R}', null, {FJ1} || '{"date_emission":"2025-06-01","nature_operation":"services"}', {L1}, true)$q$, 'OK', ''],
    array['retenir', 'FR', 'postgres', $q$select id::text from factures_emises where dossier_id = '{R}' and numero = 'F2025-0001'$q$, '', ''],
    array['fait', '0. le jeu (VF7a) : la restauration pose ER1 et ER2, aucune frontière ne la retenant', 'chef', $q${ENI} ('{ER1}', '{R}', '{FR}', '2025-12-31', 10, 'cheque', null, null, null), ('{ER2}', '{R}', '{FR}', '2025-12-31', 5, 'autre', null, null, null)$q$, 'OK', ''],
    array['jeu', 'VF7a : MR4 au 31 décembre 2025, MR5 et MR6 en janvier 2026', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{MR4}', '{R}', '2025-12-31', 'ESSAI', 10, 'non_rapprochee'), ('{MR5}', '{R}', '2026-01-06', 'ESSAI', -10, 'non_rapprochee'), ('{MR6}', '{R}', '2026-01-07', 'ESSAI', -5, 'non_rapprochee')$q$, '', ''],
    array['fait', '0. le jeu (VF7a) : la restauration pose ER5, un chèque sur MR4, du même jour, et ER6, un chèque sans mouvement', 'chef', $q${ENI} ('{ER5}', '{R}', '{FR}', '2025-12-31', 10, 'cheque', '{MR4}', null, null), ('{ER6}', '{R}', '{FR}', '2025-12-31', 5, 'cheque', null, null, null)$q$, 'OK', ''],
    array['fait', '0. le jeu (VF7a) : le cabinet classe MR4 par ER5', 'chef', $q${CLA}'{R}', '{MR4}')$q$, 'OK', ''],
    array['fait', '0. le jeu (VF7a) : la restauration pose CP5 et CP6, leurs contre-passations sans mouvement', 'chef', $q${ENI} ('{CP5}', '{R}', '{FR}', '2025-12-31', -10, 'cheque', null, '{ER5}', 'ESSAI'), ('{CP6}', '{R}', '{FR}', '2025-12-31', -5, 'cheque', null, '{ER6}', 'ESSAI')$q$, 'OK', ''],
    array['jeu', 'VF7a : l''exercice 2025 validé dans R', 'postgres', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{R}', 2025, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('c', 64), '{}')$q$, '', ''],
    array['fait', '0. le jeu (VF7a) : ER4, un chèque du 2 janvier 2026, après la frontière', 'chef', $q${ENI} ('{ER4}', '{R}', '{FR}', '2026-01-02', 5, 'cheque', null, null, null)$q$, 'OK', ''],
    array['controle', '145. rattacher, rang 6 : daté d''un exercice validé, par un autre moyen, il ne se rattache plus', 'chef', $q${RAT}'{R}', '{ER2}', '{MR2}')$q$, '22023', 'L''exercice 2025 est validé : cet encaissement ne se rattache plus à un mouvement.'],
    array['controle', '145b. … le rang 6 avant le rang 7 (aucun mouvement désigné)', 'chef', $q${RAT}'{R}', '{ER2}', null)$q$, '22023', 'L''exercice 2025 est validé : cet encaissement ne se rattache plus à un mouvement.'],
    array['controle', '145c. rang 9, neuf : un mouvement daté d''un exercice validé ne se cite plus', 'chef', $q${RAT}'{R}', '{ER1}', '{MR1}')$q$, '22023', 'L''exercice 2025 est validé : ce mouvement ne se cite plus.'],
    array['controle', '145d. … le rang 9 avant le rang 10 (un débit, pour un encaissement)', 'chef', $q${RAT}'{R}', '{ER1}', '{MR3}')$q$, '22023', 'L''exercice 2025 est validé : ce mouvement ne se cite plus.'],
    array['controle', '145h. … l''exercice que nomme le rang 9 est celui du MOUVEMENT (l''encaissement, de 2026)', 'chef', $q${RAT}'{R}', '{ER4}', '{MR1}')$q$, '22023', 'L''exercice 2025 est validé : ce mouvement ne se cite plus.'],
    array['controle', '145e. … le rang 8 avant le rang 9 (le mouvement figé d''un autre dossier)', 'chef', $q${RAT}'{R}', '{ER1}', '{MB}')$q$, '22023', 'Ce mouvement n''est pas un mouvement de ce dossier.'],
    array['lecture', '145f. le chèque du 31 décembre se rattache au crédit de janvier', 'chef', $q$select (e.ligne_bancaire_id = '{MR2}')::text from rattacher_mouvement_encaissement('{R}', '{ER1}', '{MR2}') e$q$, '', 'true'],
    array['controle', '145g. … et le crédit de janvier se classe par lui', 'chef', $q${RAT}'{R}', '{ER1}', '{MR2}'); {CLA}'{R}', '{MR2}')$q$, 'OK', ''],
    -- La garde, sans les fonctions : le propriétaire, le rôle des Edge Functions, le super-administrateur.
    array['controle', '146. la garde : un encaissement ne naît pas daté d''un exercice validé (le propriétaire)', 'postgres', $q${ENC} ('{R}', '{FR}', '2025-12-31', 1, 'cheque', null, null, null)$q$, '23514', 'L''exercice 2025 est validé : un encaissement de cette facture ne s''y date plus.'],
    array['controle', '146b. … ni par le rôle des Edge Functions', 'service', $q${ENC} ('{R}', '{FR}', '2025-12-31', 1, 'cheque', null, null, null)$q$, '23514', 'L''exercice 2025 est validé : un encaissement de cette facture ne s''y date plus.'],
    array['controle', '146c. … ni par le super-administrateur : la restauration passe avant les exercices validés, jamais après', 'chef', $q${ENC} ('{R}', '{FR}', '2025-12-31', 1, 'cheque', null, null, null)$q$, '23514', 'L''exercice 2025 est validé : un encaissement de cette facture ne s''y date plus.'],
    array['controle', '146d. … ni une contre-passation, à sa propre date', 'postgres', $q${ENC} ('{R}', '{FR}', '2025-12-31', -10, 'cheque', null, '{ER1}', 'ESSAI')$q$, '23514', 'L''exercice 2025 est validé : une contre-passation ne s''y date plus.'],
    array['controle', '146e. un mouvement daté d''un exercice validé ne se cite pas à la naissance', 'service', $q${ENC} ('{R}', '{FR}', '2026-01-05', 1, 'virement', '{MR1}', null, null)$q$, '23514', 'L''exercice 2025 est validé : ce mouvement ne se cite plus.'],
    array['controle', '147. la garde : un encaissement figé ne se retire pas', 'service', $q$update encaissements_factures set retire_le = now() where id = '{ER1}'$q$, '23514', 'L''exercice 2025 est validé : cet encaissement ne se retire plus.'],
    array['controle', '147b. … ne change pas de compte de contrepartie, sous le réglage de la fonction', 'postgres', $q$select set_config('jd.contrepartie_encaissement', '{ER2}', true); update encaissements_factures set compte_contrepartie = '467000' where id = '{ER2}'$q$, '23514', 'L''exercice 2025 est validé : le compte de contrepartie de cet encaissement ne change plus.'],
    array['controle', '147c. … ne se rattache pas, par un autre moyen, sous le réglage du rattachement', 'postgres', $q$select set_config('jd.rattachement_encaissement', '{ER2}', true); update encaissements_factures set ligne_bancaire_id = '{MR2}' where id = '{ER2}'$q$, '23514', 'L''exercice 2025 est validé : cet encaissement ne se rattache plus à un mouvement.'],
    array['controle', '147d. … ni à un mouvement figé', 'service', $q$select set_config('jd.rattachement_encaissement', '{ER1}', true); update encaissements_factures set ligne_bancaire_id = '{MR1}' where id = '{ER1}'$q$, '23514', 'L''exercice 2025 est validé : ce mouvement ne se cite plus.'],
    array['controle', '147e. le chèque figé se rattache au crédit de janvier, sans la fonction aussi', 'service', $q$select set_config('jd.rattachement_encaissement', '{ER1}', true); update encaissements_factures set ligne_bancaire_id = '{MR2}' where id = '{ER1}'$q$, 'OK', ''],
    array['controle', '147f. … ni une contre-passation figée dont l''encaissement cite un mouvement de son jour : elle le défait sur la banque de ce mouvement, et rattachée, elle s''écrirait au 511', 'service', $q$select set_config('jd.rattachement_encaissement', '{CP5}', true); update encaissements_factures set ligne_bancaire_id = '{MR5}' where id = '{CP5}'$q$, '23514', 'L''exercice 2025 est validé : cet encaissement ne se rattache plus à un mouvement.'],
    array['controle', '147g. … ce que la fonction du cabinet refuse plus tôt : le mouvement de l''encaissement contre-passé est classé (le rang 16)', 'chef', $q${RAT}'{R}', '{CP5}', '{MR5}')$q$, '22023', 'Le mouvement de l''encaissement contre-passé est classé : rattachée à un débit, la contre-passation le lui ferait justifier de nouveau — le cabinet retire d''abord ce classement.'],
    array['controle', '147h. la contre-passation figée d''un chèque sans mouvement se rattache au débit de janvier, par la fonction du cabinet : son écriture, au 511, ne change pas', 'chef', $q${RAT}'{R}', '{CP6}', '{MR6}')$q$, 'OK', ''],
    array['controle', '148. la garde : une part ne s''ajoute pas à un encaissement figé', 'service', $q$insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values ('{ER1}', '{R}', 20, 1)$q$, '23514', 'L''exercice 2025 est validé : la répartition de cet encaissement ne change plus.'],
    array['controle', '148b. le client « Ventes » et « Banque » : sa fonction s''y heurte, et la raison est dite', 'client_vb', $q${ENE}'{T}', '{F1}', '2026-03-05', 1, 'virement', '{MB}', '[{"taux":20,"montant":1}]')$q$, '23514', 'L''exercice 2025 est validé : ce mouvement ne se cite plus.'],
    array['controle', '148c. … comme celle du cabinet', 'chef', $q${ENE}'{T}', '{F1}', '2026-03-05', 1, 'virement', '{MB}', '[{"taux":20,"montant":1}]')$q$, '23514', 'L''exercice 2025 est validé : ce mouvement ne se cite plus.'],
    array['controle', '149. ce qui ne change pas : l''encaissement d''une facture qui n''est pas source, dans un exercice validé', 'postgres', $q${ENC} ('{A}', '{FA1}', '2025-12-30', 1, 'cheque', null, null, null)$q$, 'OK', ''],
    array['controle', '149b. … ni ce qui suit la frontière : un encaissement de 2026, sa part, son retrait', 'service', $q${ENI} ('{ER3}', '{R}', '{FR}', '2026-01-02', 5, 'cheque', null, null, null); insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values ('{ER3}', '{R}', 20, 5); update encaissements_factures set retire_le = now() where id = '{ER3}'$q$, 'OK', ''],
    array['controle', '183. MUTATION de 146 : le lendemain de la frontière, il naît', 'postgres', $q${ENC} ('{R}', '{FR}', '2026-01-01', 1, 'cheque', null, null, null)$q$, 'OK', ''],
    array['controle', '184. MUTATION de 145 : daté de 2026, par un autre moyen, il se rattache', 'chef', $q${ENI} ('{ER3}', '{R}', '{FR}', '2026-01-02', 5, 'autre', null, null, null); {RAT}'{R}', '{ER3}', '{MR2}')$q$, 'OK', ''],
    array['controle', '185. MUTATION de 146e : un mouvement de 2026 se cite à la naissance', 'service', $q${ENC} ('{R}', '{FR}', '2026-01-05', 1, 'virement', '{MR2}', null, null)$q$, 'OK', ''],
    array['controle', '186. MUTATION de 148b : le client cite un mouvement libre de 2026', 'client_vb', $q${ENE}'{T}', '{F1}', '2026-03-05', 1, 'virement', '{M2}', '[{"taux":20,"montant":1}]')$q$, 'OK', ''],
    array['controle', '187. MUTATION de 147f : l''encaissement contre-passé sans mouvement, la contre-passation figée se rattache, sans la fonction aussi', 'service', $q$select set_config('jd.rattachement_encaissement', '{CP6}', true); update encaissements_factures set ligne_bancaire_id = '{MR6}' where id = '{CP6}'$q$, 'OK', ''],
    -- LA RECOMPOSITION D'UN BLOC (étape VF7b0, migration `validation_des_ventes_facturees`), à la fin de l'essai : chaque source
    -- des quatre dossiers, sur toute son histoire, rend recomposée d'un bloc ce que `ecriture_attendue_vente_facturee` rend.
    array['valeur', '188. la recomposition d''un bloc : chaque source des quatre dossiers rend ce que la composition rend (étape VF7b0)', 'postgres', $q$select count(*) || ' sources, ' || count(*) filter (where (b.motif, b.detail, b.lignes) is distinct from (c.motif, c.detail, c.lignes)) || ' écart(s)' from (values ('{T}'::uuid), ('{A}'::uuid), ('{R}'::uuid), ('{N}'::uuid)) z(d) cross join lateral ecritures_attendues_de_la_periode(z.d, null, '9999-12-31') b cross join lateral ecriture_attendue_vente_facturee(z.d, b.genre, b.source_id) c$q$, '',
      '27 sources, 0 écart(s)']
  ];

  begin
    foreach etape slice 1 in array etapes loop
      s := etape[4];
      attendu := etape[6];
      for cle, valeur in select key, value from jsonb_each_text(ids || jsonb_build_object('CHEF', chef, 'CLIENT', client)) loop
        s := replace(s, '{' || cle || '}', valeur);
        attendu := replace(attendu, '{' || cle || '}', valeur);
      end loop;
      accepte := false; code_recu := null; message := null; obs := null;
      if etape[1] = 'jeu' then
        begin
          execute s;
        exception when others then
          verdicts := verdicts || jsonb_build_object('controle', '0. le jeu : ' || etape[2], 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
        end;
      elsif etape[1] = 'retenir' then
        begin
          execute s into obs;
        exception when others then obs := null;
        end;
        if obs is null then
          verdicts := verdicts || jsonb_build_object('controle', '0. retenir ' || etape[2], 'observe', 'rien à retenir', 'ok', false);
        elsif etape[2] = '*' then
          ids := ids || obs::jsonb;
        else
          ids := ids || jsonb_build_object(etape[2], obs);
        end if;
      elsif etape[1] = 'valeur' then
        begin
          execute s into obs;
        exception when others then obs := sqlstate || ' ' || sqlerrm;
        end;
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, '∅'), 'ok', coalesce(obs = attendu, false));
      else
        if etape[3] in ('membre', 'chef_simple', 'client_vb', 'client_v') and etape[1] not in ('controle', 'lecture') then
          raise exception 'ESSAI_MAL_ECRIT : le profil % ne sert qu''à un contrôle ou à une lecture, qui s''annulent', etape[3];
        end if;
        begin
          if etape[3] in ('membre', 'chef_simple') then
            insert into cabinet_admins (user_id, cabinet_id, role)
              values (client, cabinet, case etape[3] when 'membre' then 'comptable' else 'comptable_en_chef' end);
            if etape[3] = 'membre' then
              -- A et R depuis l'étape VF8a : le réglage d'un dossier qui n'a pas basculé, et d'un qui a basculé sans facture.
              insert into dossier_assignations (dossier_id, user_id)
                values ((ids ->> 'T')::uuid, client), ((ids ->> 'A')::uuid, client), ((ids ->> 'R')::uuid, client);
            end if;
          elsif etape[3] = 'client_vb' then
            insert into memberships (user_id, dossier_id, role, droit_ventes, droit_banque) values (client, (ids ->> 'T')::uuid, 'client', true, true);
          elsif etape[3] = 'client_v' then
            insert into memberships (user_id, dossier_id, role, droit_ventes, droit_banque) values (client, (ids ->> 'T')::uuid, 'client', true, false);
          end if;
          if etape[3] <> 'postgres' then
            execute format('set local role %I', case etape[3] when 'anon' then 'anon' when 'service' then 'service_role' else 'authenticated' end);
            perform set_config('request.jwt.claims', case etape[3] when 'anon' then '{"role":"anon"}' when 'service' then '{"role":"service_role"}'
              else json_build_object('sub', case etape[3] when 'chef' then chef when 'inconnu' then inconnu else client end, 'role', 'authenticated')::text end, true);
          end if;
          if etape[1] = 'lecture' then
            execute s into obs;
          else
            execute s;
          end if;
          accepte := true;
          if etape[1] in ('controle', 'lecture') then
            raise exception 'ANNULATION_ESSAI';
          end if;
        exception when others then code_recu := sqlstate; message := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        perform set_config('jd.ecriture_vente_facturee', '', true);
        perform set_config('jd.classement_encaissements', '', true);
        perform set_config('jd.rattachement_encaissement', '', true);
        if etape[1] = 'lecture' then
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', case when accepte then coalesce(obs, '∅') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
            'ok', accepte and coalesce(code_recu = 'P0001', false) and coalesce(obs = attendu, false));
        else
          verdicts := verdicts || jsonb_build_object('controle', etape[2],
            'observe', case when accepte then 'accepté' else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
            'ok', case when etape[5] = 'OK' then accepte and (etape[1] = 'fait' or coalesce(code_recu = 'P0001', false))
                       else not accepte and coalesce(code_recu = etape[5]
                         and case when right(attendu, 1) = '%' then message like attendu else message = attendu end, false) end);
        end if;
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

  -- ══ 199. Rien n'est resté ══════════
  foreach cle in array tables loop
    execute format('select count(*) from %I', cle) into n;
    apres := concat_ws('/', apres, n);
  end loop;
  verdicts := verdicts || jsonb_build_object('controle', '199. rien n''est resté en base', 'observe', avant || ' -> ' || apres,
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI VF2%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.ventes_facturees', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.ventes_facturees')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
