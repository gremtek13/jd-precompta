-- Essai des policies RLS — à rejouer, pas à lire.
--
-- Les policies de ce schéma sont vérifiées par impersonation réelle à leur création, une par une.
-- Rien ne les rejouait ensuite : une migration pouvait en défaire une sans que quoi que ce soit le
-- signale. C'est ce que ce script corrige, et il l'a prouvé à sa PREMIÈRE exécution en trouvant une
-- fuite que personne n'avait vue (voir la migration `categories_et_natures_reservees_aux_connectes`).
--
-- Ce qu'il vérifie n'est pas une liste de comptes figés — elle pourrirait au premier dépôt de pièce —
-- mais des INVARIANTS qui restent vrais quelles que soient les données :
--
--   1. Un visiteur anonyme ne voit AUCUNE ligne, dans aucune des tables du schéma. La boucle passe
--      sur `pg_class`, donc une table ajoutée demain sans policy est attrapée sans que personne ait
--      à penser à l'ajouter ici. C'est le contrôle qui a trouvé la fuite.
--   2. Un utilisateur authentifié rattaché à rien — ni cabinet, ni dossier, ni super-admin — ne voit
--      rien non plus, hors exceptions nommées ci-dessous.
--   3. Un client ne voit, dans chaque table portant un `dossier_id`, que des lignes de SES dossiers.
--   3ter. Le même, quand ses accès portent les deux droits (« Ventes » et « Banque », espace client P1) — et il voit
--      bien ses pièces : un profil devenu aveugle passerait la boucle à vide.
--   3bis (Banque). Sans la case « Banque » (espace client P7), un accès ne voit AUCUNE ligne des tables de la banque —
--      lues au catalogue : celles qu'une policy ouvre au droit —, pas même de son dossier ; avec elle, toutes celles de
--      ses dossiers (le contrôle POSITIF : sans lui, une table devenue illisible à tous passerait 3bis). Section P7 ;
--      tant que ses migrations ne sont pas en base, une ligne « en attente » le dit, sans être en faute.
--   4. Un client ne peut pas écrire ce qui appartient au cabinet.
--   4ter. Ses accès portant les deux droits, il n'écrit directement ni une facture ni un mouvement du relevé (42501) :
--      les étapes suivantes ouvriront des LECTURES à ces droits, jamais une écriture directe.
--   4bis (Banque). Avec la case « Banque », il n'écrit directement dans aucune des tables de la banque (42501 à
--      l'insertion, aucune ligne touchée à la mise à jour) : il propose, précise et retire par les fonctions. Section P7.
--   3bis (Ventes). Sans le droit « Ventes » (aucun droit, ou « Banque » seul), le client ne lit aucune ligne des tables des ventes,
--      pas même de son dossier ; avec lui, il les lit toutes pour ses dossiers (contrôle positif), jamais une relance de
--      pièces ; et les tables ouvertes à ce droit, lues au catalogue, sont celles présentées au cabinet, en lecture seule
--      (espace client, étape P2 ; bloc « Les ventes du client », en fin de fichier).
--   4bis (Ventes). Avec les droits, il n'écrit directement aucune table des ventes (42501) : ses gestes passent par les fonctions.
--      Les devis (espace client, étape P5) rejoignent les tables des ventes dès que leur migration est en base (3bis et 4bis).
--      Les articles (espace client, étape A1) aussi, dès la leur, avec une mutation à eux (M3bis-membre (articles)).
--      Les adresses de réception (espace client, étape A6a) aussi, dès la leur, avec une mutation à elles
--      (M3bis-membre (adresses de réception)).
--      Les contacts (espace client, étape A4a) aussi, dès la leur, avec une mutation à eux (M3bis-membre (contacts)).
--      Les paramètres de facturation (espace client, étape A5a) aussi, dès la leur, avec une mutation à eux
--      (M3bis-membre (paramètres de facturation)).
--   5. `prochain_numero_facture` ne s'appelle pas. Malgré son nom elle CONSOMME un numéro : un appel
--      réussi creuserait un trou dans une suite annuelle qui n'en admet pas.
--   5bis. `attribuer_numero_facture`, qui l'enveloppe, non plus. Depuis la migration
--      factures_validees_figees (07/10/2026), PERSONNE ne les appelle — ni l'anonyme, ni le client, ni
--      le chef du cabinet : seule `enregistrer_facture` prend un numéro, dans la transaction qui
--      valide la facture qu'il désigne. Le refus doit donc être celui du DROIT D'EXÉCUTION (42501,
--      « permission denied »), et non le contrôle d'accès de la fonction, qu'un client atteignait
--      jusque-là.
--   6. Et les mêmes questions sur le STOCKAGE (section S), qui est l'endroit où vivent réellement
--      les données identifiantes de ce projet — plus un contrôle POSITIF (S3bis : le client voit
--      bien ses propres fichiers), sans lequel un bucket devenu illisible à tous passerait pour un
--      succès sur toute la section.
--   6bis. Le seau des VENTES (espace client, étape A5c1 ; bloc « Le seau des ventes », en fin de fichier) : SV0 à SV6, les
--      mêmes questions posées au seau privé du logo des factures — privé, rien sans le droit « Ventes », le dossier du client
--      seul avec lui (contrôle positif), aucun dépôt ailleurs que sous `<son dossier>/logos/`, aucune mise à jour, la suppression
--      au chef du cabinet du dossier (lue au catalogue) — et quatre mutations à lui ; avant sa migration, une ligne « EN
--      ATTENTE ».
--
-- Les écritures d'essai sont annulées par le mécanisme de sous-transaction de PL/pgSQL : un bloc
-- `BEGIN ... EXCEPTION` est un point de reprise implicite, donc lever volontairement une exception à
-- la fin du bloc annule ce qu'il a écrit. Les VARIABLES, elles, gardent leur valeur — c'est ce qui
-- permet de savoir si l'écriture avait été acceptée, sans en laisser la trace.
--
-- ══ Pourquoi la seconde moitié de ce fichier existe ═══════════════════════════════════════════
--
-- Une suite verte ne prouve rien tant qu'on ne l'a pas vue échouer. Un harnais d'impersonation est
-- particulièrement exposé : si `set local role` ne prenait pas, si le `sub` du jeton n'était pas lu,
-- si une table était refusée en bloc pour une raison sans rapport, TOUS les comptes rendraient zéro
-- et le fichier afficherait « 0 en faute » sur une base grande ouverte. C'est la panne dont on ne se
-- relève pas, parce qu'elle ressemble exactement au succès.
--
-- La seconde moitié rejoue donc chaque contrôle avec un profil ou un réglage délibérément faux et
-- exige qu'il vire au rouge. Elle se lance avec le reste, et son verdict est le second tableau.
-- Un contrôle qui « ne mord pas » est un contrôle à reprendre, même si le premier tableau est vert.
--
-- À lancer par l'outil MCP Supabase (`execute_sql`). Les identifiants ci-dessous sont ceux du projet
-- réel ; sur un autre jeu de données, les remplacer par un client et un chef existants.
--
-- Passage COMPLET du 19/09/2026 — 16 lignes de verdict (40 tables du schéma + 3 buckets,
-- 3 profils), 0 en faute, et 12 mutations sur 12 qui mordent.
--
-- 21/09/2026 — les contrôles 5bis et les mutations M5ter/M5quater ont été AJOUTÉS puis rejoués
-- SEULS (4 invariants ok, 2 mutations qui mordent) : `attribuer_numero_facture` refuse l'anonyme en
-- 42501 et le client en « Accès refusé à ce dossier. », sur son dossier comme sur celui d'un autre,
-- compteur inchangé (6 -> 6) ; le chef, lui, obtient bien un numéro. Le reste du fichier n'a pas été
-- relancé à cette occasion — il n'avait pas changé, et aucune migration n'est intervenue depuis.
-- Dit comme tel plutôt que laissé croire à un passage complet.
--
-- 04/10/2026 — après les migrations de la validation d'un exercice, qui créent `exercices_valides` et
-- ses deux policies : les invariants 1 à 3 seuls, rejoués sur les 48 tables du schéma (40 portant un
-- `dossier_id`), nouvelle table comprise — 0 en faute. Et ils savent échouer : sans le changement de
-- rôle, 29, 26 et 13 tables virent au rouge (les autres sont vides, où « refusé » et « rien à voir » se
-- ressemblent par construction — `exercices_valides` en fait partie, aucun exercice n'étant validé).
-- Les sections 4 à 6 et les mutations n'ont pas été relancées : ces migrations n'ajoutent que des
-- policies de LECTURE et de restauration sur une table nouvelle, et la table des verdicts a été créée
-- `on commit drop`, sans le `drop table` qui suit.
--
-- 07/10/2026 — après `reception_par_plateforme_agreee`, qui crée `connexions_plateformes` (RLS sans
-- aucune policy) et RESTREINT la policy d'insertion des pièces pour un client : les invariants 1 à 3
-- seuls, rejoués de la même façon sur les 51 tables du schéma (43 portant un `dossier_id`), nouvelle
-- table comprise — 0 en faute ; sans le changement de rôle, 29, 26 et 13 tables virent au rouge. Ce que
-- la migration change à l'écriture — un client ne dépose plus qu'une pièce « à valider », sans catégorie,
-- à son nom, sans provenance de plateforme — est éprouvé par `receptionPlateforme.sql` (40 contrôles), et
-- non par les sections 4 à 6, qui ne testent aucune insertion de pièce.
--
-- 07/10/2026 — après `factures_validees_figees`, qui retire le droit d'exécuter les deux fonctions de
-- numérotation à tout compte connecté : les contrôles 5 et 5bis ont été RÉÉCRITS (le chef y entre, et le
-- refus doit être celui du droit d'exécution) et rejoués seuls avec leurs mutations M5 à M5quater, M5
-- rendant ce droit le temps d'une sous-transaction annulée et M5ter numérotant par `enregistrer_facture`.
-- En production : 8 contrôles sur 8, les quatre mutations mordent, compteur inchangé (6 -> 6) — les deux
-- tables de résultats créées `on commit drop`, sans le `drop table` qui les précède ici. Le reste du
-- fichier n'a pas été relancé : la migration ne touche aucune policy. Ce qu'elle fige d'une facture
-- validée est éprouvé par factures.sql.
--
-- 08/10/2026 — PASSAGE COMPLET, le premier depuis le 19/09/2026, après `encaissements_des_factures`,
-- qui crée deux tables et leurs policies : 22 lignes de verdict (54 tables du schéma, dont 46 portant
-- un `dossier_id`, + 3 buckets, 3 profils), 0 en faute, et 14 mutations sur 14 qui mordent (M2 :
-- exactement 3). La transcription, qui faisait renoncer au fichier entier, est vérifiée : le texte
-- transmis — ce fichier sans son en-tête de commentaires ni ses deux `drop table`, les tables de
-- résultats `on commit drop`, et une ligne TEXTE ajoutée au verdict, qui rend la longueur et
-- l'empreinte du texte reçu — est celui de la copie adaptée, caractère pour caractère (HISTORIQUE.md,
-- entrée de l'étape d1). Les deux tables nouvelles sont vides en production : ce que leurs policies
-- refusent sur une ligne qui EXISTE est éprouvé par `encaissementsFactures.sql`.
--
-- 08/10/2026 — PASSAGE COMPLET après `transmissions_des_encaissements`, qui crée
-- `transmissions_encaissements` et ses deux policies (lecture sous `admin_du_dossier`, insertion de
-- restauration réservée au super-admin) : 22 lignes de verdict (55 tables du schéma, dont 47 portant un
-- `dossier_id`, + 3 buckets, 3 profils), 0 en faute, et 14 mutations sur 14 qui mordent (M2 : exactement
-- 3). Le texte reçu est celui du passage précédent, caractère pour caractère (32 144 caractères,
-- empreinte 95048df511611d0bd486747149697640) : seul cet en-tête a changé depuis. La table nouvelle est
-- vide en production : ce que ses policies et son déclencheur refusent sur une ligne qui EXISTE est
-- éprouvé par `transmissionsEncaissements.sql`.
--
-- 09/10/2026 — PASSAGE COMPLET après `cycle_de_vie_des_factures_emises`, qui crée `statuts_factures_recus`
-- et ses deux policies (lecture sous `admin_du_dossier`, insertion de restauration réservée au
-- super-admin) : 22 lignes de verdict (56 tables du schéma, dont 48 portant un `dossier_id`, + 3 buckets,
-- 3 profils), 0 en faute, et 14 mutations sur 14 qui mordent. Le texte reçu est celui des deux passages
-- précédents, caractère pour caractère (32 144 caractères, empreinte 95048df511611d0bd486747149697640) :
-- seul cet en-tête a changé depuis. La table nouvelle est vide en production : ce que ses policies et sa
-- garde refusent sur une ligne qui EXISTE est éprouvé par `statutsFacturesRecus.sql`.
--
-- 09/10/2026 — PASSAGE COMPLET après `identite_des_factures_recues`, qui ajoute à `pieces` quatre colonnes,
-- cinq contraintes et une garde, sans toucher à aucune policy : 22 lignes de verdict (56 tables du
-- schéma, dont 48 portant un `dossier_id`, + 3 buckets, 3 profils), 0 en faute, et 14 mutations sur 14
-- qui mordent (M2 : exactement 3). Le texte reçu est celui des trois passages précédents, caractère pour
-- caractère (32 144 caractères, empreinte 95048df511611d0bd486747149697640). Ce que la garde et les
-- contraintes refusent, et que le client ne peut pas écrire d'identité, est éprouvé par
-- `identiteFacturesRecues.sql`.
-- 09/10/2026 — PASSAGE COMPLET après `revision_des_soldes` (ligne 41, étape R1), qui crée
-- `revision_justifications` et `revision_preuves`, deux policies chacune (lecture sous
-- `admin_du_dossier`, insertion de restauration réservée au super-admin), et après
-- `paiement_personnel_des_cotisations`, appliquée entre-temps par une autre étape, qui ne touche aucune
-- policy : 22 lignes de verdict (58 tables du schéma, dont 50 portant un `dossier_id`, + 3 buckets,
-- 3 profils), 0 en faute, et 14 mutations sur 14 qui mordent (M2 : exactement 3). Le texte reçu est
-- celui des passages précédents, caractère pour caractère (32 144 caractères, empreinte
-- 95048df511611d0bd486747149697640) : seul cet en-tête a changé depuis. Les deux tables nouvelles sont
-- vides en production : ce que leurs policies et leurs gardes refusent sur une ligne qui EXISTE est
-- éprouvé par `revisionSoldes.sql`.
--
-- 09/10/2026 — PASSAGE COMPLET après `notes_internes_du_cabinet` (espace client, étape P0), qui crée
-- `notes_internes` et sa policy unique (`for all to authenticated`, `admin_du_dossier` et la cible du
-- dossier annoncé, aucune branche client) : 22 lignes de verdict (59 tables du schéma, dont 51 portant
-- un `dossier_id`, + 3 buckets, 3 profils), 0 en faute, et 14 mutations sur 14 qui mordent. Le texte
-- reçu est la copie adaptée de ce passage, caractère pour caractère (31 822 caractères, empreinte
-- c3609cc06322574b712a3c17e4d640fe) : adaptée comme les précédentes, ses bordures de commentaire en
-- plus ramenées à dix traits — rien de ce qui s'exécute ne change, l'empreinte si. La table nouvelle
-- porte les notes recopiées : ce que sa policy refuse et accepte sur une ligne qui EXISTE, profil par
-- profil, est éprouvé par `notesInternes.sql`.
--
-- 09/10/2026 — PASSAGE COMPLET après `droits_des_acces_clients` (espace client, étape P1), qui ajoute à `memberships` les
-- deux droits d'un accès et cinq fonctions, sans toucher à aucune policy — et avec un PROFIL DE PLUS, le client portant
-- les deux droits (conception de l'espace client, §3.7) : 3ter, la boucle de 3 sous ce profil, plus un contrôle positif
-- (ses 31 pièces, toutes vues) ; 4ter, aucune écriture directe d'une facture ni d'un mouvement (42501) ; leurs mutations
-- M3ter et M4c. 24 lignes de verdict (59 tables du schéma, dont 51 portant un `dossier_id`, + 3 buckets, 4 profils),
-- 0 en faute, et 16 mutations sur 16 qui mordent (M2 : exactement 3). Le texte reçu est la copie adaptée, caractère pour
-- caractère (39 000 caractères, empreinte b2ffbdc886c10091a6b3c81f6c8db862), adaptée comme celle de P0, bordures
-- comprises. CE QUI ATTEND P2 : l'invariant 3 bis (sans le droit d'un domaine, aucune ligne de ses tables) et son
-- contrôle positif — les tables des ventes sont fermées à TOUT client, 3 bis n'y serait vrai qu'à vide, et celles de la
-- banque ouvertes à tout accès jusqu'à P7, où il serait faux ; et les deux mutations de la conception (le droit retiré
-- au profil, `client_du_dossier` remplacé par « membre »), qui ne mordent que sur une lecture qu'un droit ouvre. Ce que
-- les droits et leurs fonctions refusent et acceptent, profil par profil, est éprouvé par `droitsAcces.sql`.
--
-- 10/10/2026 — PASSAGE COMPLET après `pieces_hors_de_france` (ligne 28.5, étape e2), qui crée
-- `pieces_hors_de_france` et `pieces_hors_de_france_taux`, deux policies chacune (lecture sous
-- `admin_du_dossier`, insertion de restauration réservée au super-admin) ; la production porte aussi
-- `droits_des_acces_clients` et `retrait_du_paiement_personnel`, appliquées par d'autres étapes : 22 lignes
-- de verdict (61 tables du schéma, dont 53 portant un `dossier_id`, + 3 buckets, 3 profils), 0 en faute, et
-- 14 mutations sur 14 qui mordent (M2 : exactement 3). Le texte reçu est la copie adaptée du passage
-- précédent, caractère pour caractère, son saut de ligne final compris (31 823 caractères, empreinte
-- 8e6cece826d8250ee893b379dd36f8d6 ; sans lui, 31 822 et c3609cc06322574b712a3c17e4d640fe) : seul cet
-- en-tête a changé depuis. Les deux tables nouvelles sont vides en production : ce que leurs policies,
-- leurs gardes et leurs fonctions refusent sur une ligne qui EXISTE est éprouvé par `piecesHorsDeFrance.sql`.
--
-- 10/10/2026 — PASSAGE COMPLET À L'INTÉGRATION DE L'ÉTAPE e2 : le passage précédent jouait la copie d'avant P1
-- (trois profils) ; celui-ci joue le fichier fusionné, dont la copie adaptée est celle de P1 au caractère près
-- (39 000 caractères, empreinte b2ffbdc886c10091a6b3c81f6c8db862, rendue par la base), sur la production à 110
-- migrations : 24 lignes de verdict (61 tables du schéma, dont 53 portant un `dossier_id`, 4 profils, et les
-- contrôles du stockage), 0 en faute, et 16 mutations sur 16 qui mordent.
--
-- 10/10/2026 — PRÉPARÉ POUR L'ÉTAPE P7, JOUÉ SUR LA RÉPLIQUE SEULEMENT (migrations `banque_du_client` et
-- `lectures_bancaires_au_droit_banque`, présentées au cabinet, non appliquées) : le domaine « Banque » — tiré du
-- catalogue, les tables dont une policy de lecture porte `client_du_dossier(…, 'banque')` ou `gere_la_banque`, et
-- confronté aux six attendues — reçoit 3bis (sans la case, aucune ligne de ces tables, même de son dossier), son contrôle
-- positif 3bis+ (avec elle, toutes celles de ses dossiers), 4bis (avec elle, aucune écriture directe : proposer et
-- préciser passent par les fonctions) et les mutations M3bis-a, M3bis-b et M4bis. Réplique de l'étape (neuf familles
-- égales à la production à 110 migrations, `pieces_hors_de_france` comprise, en UTF8), une ligne d'essai dans chacune des
-- six tables : AVANT les migrations, 25 lignes de verdict, 0 en faute — dont « en attente », qui dit l'étape absente sans
-- être une faute —, et 16 mutations sur 16 ; après la PREMIÈRE seule, la ligne du domaine EN FAUTE (trois tables sur six
-- portent la case : le resserrement manque) ; après les DEUX, 28 lignes de verdict (63 tables du schéma, dont 55 portant
-- un `dossier_id`, + 3 buckets, 4 profils), 0 en faute, et 19 mutations sur 19 — les mêmes verdicts qu'à 109 migrations.
-- En production, le passage se fait après la seconde migration. Ce que les fonctions refusent et acceptent, profil par
-- profil, est éprouvé par `banqueClient.sql`.
--
-- 10/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (espace client, étape P2 : préparée, présentée au cabinet, non
-- appliquée). Le bloc « Les ventes du client », en fin de fichier, ajoute 3bis et 4bis et leurs mutations M3bis,
-- M3bis-membre, M3bis-catalogue et M4bis (une par table). Joué ENTIER sur une réplique dont `signature.sql` égalait la
-- production sur ses neuf familles — à 109 migrations, puis à 110 (`pieces_hors_de_france`, appliquée le même jour) —,
-- semée d'un jeu fictif et d'un talon de `storage` aux policies relevées en production : sans les migrations, 25 lignes
-- de verdict (le bloc se dit SANS OBJET, son témoin `factures_emises.valide_par` absent), 0 en faute, 16 mutations sur 16
-- qui mordent ; avec elles, 30 lignes (à 110 migrations : 61 tables du schéma, dont 53 portant un `dossier_id`,
-- + 3 buckets, 4 profils), 0 en faute, 28 mutations sur 28 qui mordent ; la première migration seule, de même ; le
-- témoin posé seul, sans les policies, fait virer le bloc au rouge (contrôle positif 9 sur 9, catalogue, 4bis). Le
-- passage en production suivra l'application des migrations et se notera ici. Ce que les fonctions des ventes refusent
-- et acceptent, profil par profil et par leur raison, est éprouvé par `ventesClient.sql`.
--
-- 10/10/2026 — PASSAGE COMPLET après `plan_comptable_des_dossiers` (ligne 43, étape PC1), qui crée `roles_comptables` —
-- le catalogue des rôles, lisible par tout compte connecté : il rejoint les référentiels tolérés, et M2 en attend 4 — et
-- `plan_comptable_dossier` (lecture sous `admin_du_dossier`, AUCUNE policy d'écriture, une garde) ; la production porte
-- aussi `pieces_hors_de_france` et `banque_du_client`, appliquées par d'autres étapes : 24 lignes de verdict (65 tables
-- du schéma, dont 56 portant un `dossier_id`, + 3 buckets, 4 profils), 0 en faute, et 16 mutations sur 16 qui mordent
-- (M2 : exactement 4). Le texte reçu est la copie adaptée, caractère pour caractère (39 332 caractères, empreinte
-- b2ed6e7e4077d49aa582fafc18695b33), adaptée comme celle de P1, bordures comprises. La table du plan est vide en
-- production : ce que sa policy, sa garde et sa clé étrangère refusent et acceptent sur une ligne qui EXISTE, profil par
-- profil, est éprouvé par `planComptable.sql`.
--
-- 10/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (espace client, étape P5 : préparée, présentée au cabinet, non
-- appliquée). Les devis rejoignent le bloc « Les ventes du client » : dès que la table `devis` existe, `devis` et
-- `devis_factures` entrent dans la liste attendue, le jeu d'essai émet, accepte et transforme un devis, et 4bis tente une
-- insertion directe dans chacune et une mise à jour d'un devis ; avant, une ligne « EN ATTENTE ». Joué ENTIER sur une
-- réplique en UTF8 égale à la production à 113 migrations (`signature.sql`, neuf familles), semée du jeu de P2 : sans
-- P2, 42 lignes (le bloc SANS OBJET) et 16 mutations sur 16 ; avec P2, 60 lignes (la ligne des devis EN ATTENTE) et 28
-- sur 28 ; avec P2 et les deux migrations des devis, 61 lignes — le catalogue juste à onze tables, contrôle positif et
-- sans droit 11 sur 11, 4bis 15 vérifications — et 30 mutations sur 30 (M4bis 11 sur 11). Dans les trois états, une
-- seule ligne en faute, hors des devis et attendue : 3bis (Banque), « le domaine », entre les deux migrations de
-- `banque_du_client`. Ce fichier sans ses ajouts, joué avec les devis, vire au rouge (onze tables lues, neuf
-- présentées ; « 0 vue sur 0 » au contrôle positif). Ce que les fonctions des devis refusent et acceptent, profil par
-- profil et par leur raison, est éprouvé par `devis.sql`.
--
-- 10/10/2026 — PASSAGE COMPLET après `lectures_bancaires_au_droit_banque` (espace client, étape P7, la seconde
-- migration ; la première, `banque_du_client`, et `revision_des_cycles` (ligne 41, R4) sont en base depuis le matin) :
-- 29 lignes de verdict (68 tables du schéma, dont 59 portant un `dossier_id`, + 3 buckets, 4 profils), 0 en faute — le
-- domaine « Banque » complet, 3bis, 3bis+ et 4bis sur ses six tables ; le bloc des ventes SANS OBJET —, et 19 mutations
-- sur 19 qui mordent (M2 : exactement 4). Répété d'abord sur une réplique dont `signature.sql` égalait la production :
-- les mêmes verdicts. Le texte reçu est la copie adaptée À DIX LIGNES DE COMMENTAIRE PRÈS — 74 332 caractères,
-- empreinte 88fe09d17a4e89ef2b3d707bc82f8187, pour 74 256 et b505e109bb320f9449f17fc46ccf804e : la bordure
-- d'ouverture de dix titres a été transcrite en dix traits au lieu de deux ou trois. Reconstitué, ce texte rend
-- exactement l'empreinte reçue : le code exécuté est celui de la copie, caractère pour caractère.
--
-- 10/10/2026 — PASSAGE COMPLET après `revision_des_cycles` (ligne 41, étape R4), qui crée `revision_conclusions`,
-- `revision_notes` et `revision_revues` — lecture sous `admin_du_dossier`, insertion de restauration réservée au
-- super-administrateur, aucune autre policy, trois gardes. EN PRODUCTION, à 113 migrations : la copie adaptée de la
-- tête 2aa2ef4, caractère pour caractère (74 256 caractères, empreinte b505e109bb320f9449f17fc46ccf804e, rendue par la
-- base) : 26 lignes de verdict (68 tables du schéma, dont 59 portant un `dossier_id`, + 3 buckets, 4 profils), une
-- seule en faute, la ligne du domaine « Banque » (la seconde migration de P7 n'était pas en base), et 16 mutations sur
-- 16 qui mordent ; les trois tables y sont vides. SUR UNE RÉPLIQUE égale à la production à 114 migrations
-- (signature.sql, neuf familles ; la seconde migration de P7 comprise), munie du talon du stockage et du semis fictif
-- de l'étape P2 (policies du stockage égales à celles de la production) et des lignes de l'étape semées par ses
-- fonctions dans le dossier `test` : ce fichier, joué ENTIER par psql, 29 lignes de verdict à 0 en faute — le domaine
-- « Banque » compris — et 19 mutations sur 19 qui mordent ; M3 voit les trois tables de l'étape hors des dossiers du
-- client, que l'invariant 3 lui refuse. Ce que leurs policies, leurs gardes et leurs fonctions refusent et acceptent,
-- profil par profil, est éprouvé par `revisionCycles.sql`. Le passage de P7, ci-dessus, en production à 114 migrations,
-- compte ces trois tables parmi les 68 du schéma.
--
-- 10/10/2026 — PASSAGE COMPLET après `ventes_du_client` puis `ventes_du_client_facturation` (espace client, étape P2 ;
-- la seconde collée par le cabinet), qui ajoutent neuf policies de lecture au droit « Ventes » et aucune table. EN
-- PRODUCTION, à 116 migrations : 35 lignes de verdict (68 tables du schéma, dont 59 portant un `dossier_id`, + 3 buckets,
-- 4 profils), 0 en faute — le bloc des ventes JOUÉ : 3bis sans le droit et avec lui (contrôle positif, 9 tables sur 9,
-- sur le jeu d'essai qu'il construit dans le dossier du client et annule), le catalogue juste, jamais une relance de
-- pièces, 4bis sur douze écritures directes ; les devis EN ATTENTE, leurs migrations n'étant pas en base —, et 31
-- mutations sur 31 qui mordent (M2 : exactement 4). Le texte reçu est la copie adaptée de la tête 0a711c7, TOUTES ses
-- lignes de commentaire retirées, et donc aucune bordure à recopier (57 889 caractères, empreinte
-- d661fbbd0ee793ab9646200d67f97509, rendue par la base). Jouées d'abord sur une réplique dont `signature.sql` égalait la
-- production, la copie et ce fichier rendent les mêmes verdicts, à l'octet. Aucun accès de la production ne porte
-- « Ventes » : ce que les fonctions des ventes refusent et acceptent, profil par profil, est éprouvé par
-- `ventesClient.sql`, joué en production le même jour.
--
-- 11/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (ligne 41, étape R5 : préparée, non appliquée). La migration
-- `revue_analytique` crée `revision_seuils` et `revision_explications` — lecture sous `admin_du_dossier`, insertion de
-- restauration réservée au super-administrateur, aucune autre policy, deux gardes — et aucune ligne de ce fichier ne
-- change : la boucle sur `pg_class` les prend. Joué ENTIER par psql sur une réplique égale à la production à 116
-- migrations (`signature.sql`, neuf familles), munie du talon du stockage et du semis fictif de l'étape P2, la migration
-- appliquée et les lignes de l'étape semées par ses fonctions dans le dossier `test` (quatre seuils, cinq explications) :
-- 35 lignes de verdict (70 tables du schéma, dont 61 portant un `dossier_id`, + 3 buckets, 4 profils), 0 en faute, et
-- 31 mutations sur 31 qui mordent ; M3 voit sept tables hors des dossiers du client, cinq sans les lignes de l'étape.
-- Sans la migration, la même réplique rend le passage de P2, ci-dessus. Le passage en production suivra l'application et
-- se notera ici. Ce que les policies, les gardes et les deux fonctions refusent et acceptent, profil par profil et par
-- leur raison, est éprouvé par `revueAnalytique.sql`.
--
-- 11/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (ligne 28.5, étape e5a : migration
-- `regimes_ereporting_et_pieces_ecartees`, préparée, non appliquée), qui crée `regimes_ereporting` et
-- `pieces_ecartees_ereporting` — lecture sous `admin_du_dossier`, insertion de restauration réservée au
-- super-administrateur, aucune autre policy, aucune branche client — ; ce fichier n'y change rien que cet en-tête. Joué
-- ENTIER par psql sur la réplique de l'étape (signature.sql : les neuf familles égales à la production à 116
-- migrations) : sans la migration, 35 lignes de verdict (68 tables du schéma, dont 59 portant un `dossier_id`), 0 en
-- faute, 31 mutations sur 31 qui mordent ; avec elle, les deux tables semées PAR LES FONCTIONS dans le dossier `test`
-- (deux régimes, dont un retiré, et un écart) et dans celui du client (un régime, un écart), 35 lignes (70 tables, dont
-- 61 portant un `dossier_id`), 0 en faute, 31 sur 31 — M1 et M3 y voient les deux tables de plus (18 et 7 tables en
-- faute, pour 16 et 5), que les invariants 1 et 3 refusent à l'anonyme et au client. Le passage en production suivra
-- l'application de la migration et se notera ici. Ce que leurs policies, leurs gardes et leurs fonctions refusent et
-- acceptent, profil par profil, est éprouvé par `regimesEreporting.sql`.
--
-- 11/10/2026 — LES DEUX MIGRATIONS APPLIQUÉES EN PRODUCTION, `revue_analytique` (20261011090828) puis
-- `regimes_ereporting_et_pieces_ecartees` (20261011091325) : 118 migrations. Joué ENTIER par psql sur une réplique dont
-- `signature.sql` égale la production à 118 migrations (neuf familles), les deux migrations l'une sur l'autre et les
-- tables des deux étapes vides : 35 lignes de verdict (72 tables du schéma, dont 63 portant un `dossier_id`, + 3 buckets,
-- 4 profils), 0 en faute, et 31 mutations sur 31 qui mordent (M1 : 16 tables, M3 : 5). Sur la même réplique,
-- `revueAnalytique.sql` rend 228 verdicts et `regimesEreporting.sql` 186, sans une faute, chacun laissant la base comme
-- il l'a trouvée.
--
-- 11/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (ligne 28.5, étape e5b1 : migration `declarations_ereporting`,
-- préparée, non appliquée), qui crée `declarations_ereporting` et `declarations_ereporting_sources` — lecture sous
-- `admin_du_dossier`, insertion de restauration réservée au super-administrateur, aucune autre policy, aucune branche
-- client — ; ce fichier n'y change rien que cet en-tête. Joué ENTIER par psql sur la réplique de l'étape (signature.sql :
-- les neuf familles égales à la production à 118 migrations) : sans la migration, 35 lignes de verdict (72 tables, dont
-- 63 portant un `dossier_id`), 0 en faute, 31 mutations sur 31 qui mordent ; avec elle, les deux tables semées PAR LES
-- FONCTIONS (à l'horloge du serveur avancée au 29/02/2028 : une période ne se déclare que finie) dans le dossier `test`
-- (les achats de septembre 2027, l'initiale remplacée par une rectificative, et ceux d'octobre, sous un régime, sur trois
-- fiches) et dans celui du client (un régime, une fiche, une déclaration), 35 lignes (74 tables, dont 65 portant un
-- `dossier_id`), 0 en faute, 31 sur 31 — M1 et M3 y voient les tables semées de plus (21 et 10 tables en faute, pour
-- 16 et 5), que les invariants 1 et 3 refusent à l'anonyme et au client. Le passage en production suivra l'application
-- de la migration et se notera ici. Ce que leurs policies, leurs gardes et leur fonction refusent et acceptent, profil
-- par profil, est éprouvé par `declarationsEreporting.sql`.
--
-- 11/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (ligne 41, étape R7 : migration `dossier_permanent`, préparée, non
-- appliquée), qui crée `dossier_permanent` — lecture sous `admin_du_dossier`, insertion de restauration réservée au
-- super-administrateur, aucune autre policy, aucune branche client — ; ce fichier n'y change rien que cet en-tête. Joué
-- ENTIER par psql sur la réplique de l'étape (signature.sql : les neuf familles égales à la production à 125
-- migrations) : sans la migration, 35 lignes de verdict (74 tables, dont 65 portant un `dossier_id`), 0 en faute,
-- 31 mutations sur 31 qui mordent ; avec elle, la table semée PAR LES FONCTIONS dans le dossier `test` (une lettre de
-- mission en trois versions, un bail et un contrat qui citent une pièce, des statuts qui citent un document puis
-- retirés, une description) et dans celui du client (deux entrées), 35 lignes (75 tables, dont 66 portant un
-- `dossier_id` ; 75, 75 et 66 vérifications aux invariants 1, 2 et 3, pour 74, 74 et 65), 0 en faute, 31 sur 31 — M1
-- et M3 y voient deux tables de plus (18 et 7 en faute, pour 16 et 5) : la table nouvelle, et `documents_divers`, vide
-- avant d'être semée pour être citée. Le passage en production suivra l'application de la migration et se notera ici.
-- Ce que sa policy, sa garde et ses deux fonctions refusent et acceptent, profil par profil, est éprouvé par
-- `dossierPermanent.sql`.
--
-- 12/10/2026 — LA MIGRATION APPLIQUÉE EN PRODUCTION, `dossier_permanent` (`20261012070920`) : 126 migrations. La
-- signature de la production (signature.sql, neuf familles) est, à l'octet, celle de la réplique munie de la migration
-- sur laquelle ce fichier a rendu, ENTIER, les verdicts ci-dessus (35 lignes, 0 en faute, 31 mutations sur 31) : il n'a
-- pas été rejoué en production, où la table est vide. `dossierPermanent.sql`, lui, y a été joué le même jour : 188
-- verdicts sur 188.
--
-- 13/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (ligne 22.7 : migration `pieces_jointes_ecartees`, préparée, non
-- appliquée), qui crée `pieces_jointes_ecartees` — lecture sous `admin_du_dossier`, insertion de restauration réservée
-- au super-administrateur, aucune autre policy, aucune branche client — ; ce fichier n'y change rien que cet en-tête.
-- Joué ENTIER par psql sur la réplique de l'étape (signature.sql : les neuf familles, et l'historique, égaux à la
-- production à 127 migrations) : sans la migration, 35 lignes de verdict (75 tables, dont 66 portant un `dossier_id`),
-- 0 en faute, 31 mutations sur 31 qui mordent ; avec elle, la table semée dans le dossier `test` (deux pièces jointes
-- écartées, l'une marquée vue par `marquer_pieces_jointes_vues` sous la session du chef) et dans celui du client (une),
-- 35 lignes (76 tables, dont 67 portant un `dossier_id`), 0 en faute, 31 sur 31 — M1 et M3 y voient la table de plus
-- (19 et 8 tables en faute, pour 18 et 7). En production le même jour, la migration appliquée (`20261013061933`) :
-- 35 lignes, 0 en faute, 31 mutations sur 31 (76 tables, dont 67 portant un `dossier_id` ; M1 et M3 : 28 et 14 tables
-- en faute), le texte reçu par la base égal à la copie transmise (57 889 caractères, `d661fbbd…`). Ce que ses policies,
-- sa garde et sa fonction refusent et acceptent, profil par profil et par leur raison, est éprouvé par
-- `piecesJointesEcartees.sql`.
--
-- 13/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (ligne 22.9 : migration `pieces_jointes_ecartees_au_client`,
-- préparée, présentée au cabinet, non appliquée), qui ne pose AUCUNE policy : une fonction de lecture,
-- `pieces_jointes_ecartees_du_client` (`SECURITY DEFINER`, l'accès vérifié d'abord, exécutable par les connectés
-- seuls) ; la table reste fermée au client, et ce fichier n'y change rien que cet en-tête. Joué ENTIER par psql sur la
-- réplique de l'étape (signature.sql : les neuf familles, et l'historique, égaux à la production à 130 migrations) :
-- sans la migration, 35 lignes de verdict, 0 en faute, 31 mutations sur 31 qui mordent ; avec elle, la table semée dans
-- le dossier `test` (deux pièces jointes, l'une marquée vue) et dans celui du client (deux, dont une arrivée vide), 35
-- lignes, 0 en faute, 31 sur 31 — M1 et M3 voient la table semée (19 et 8 tables en faute, pour 18 et 7). Ce que la
-- fonction rend au client et refuse aux autres, profil par profil et par sa raison, est éprouvé par
-- `piecesJointesEcartees.sql` (contrôles 38a à 38r). En production le même jour, la migration appliquée sur l'accord du
-- cabinet (S228B-Q1, `20261013174021`) : ce fichier n'y a pas été rejoué — `signature.sql` y rend les policies (145),
-- la RLS (76) et les droits des tables (76) d'avant elle, au caractère près — ; `piecesJointesEcartees.sql` y rend ses
-- 81 verdicts, 0 en faute.
--
-- 13/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (espace client, étape A1 : migration `articles`, préparée, présentée
-- au cabinet, non appliquée), qui crée `articles` — lecture du cabinet (`admin_du_dossier`), lecture du droit « Ventes »
-- (`articles_lecture_ventes`), insertion de restauration réservée au super-administrateur, aucune autre policy ; trois
-- fonctions l'écrivent. Le bloc « Les ventes du client » la prend dès qu'elle existe (3bis, 4bis, M4bis, et une mutation
-- à elle, M3bis-membre (articles)) ; avant, une ligne « EN ATTENTE ». Joué ENTIER par psql sur la réplique de l'étape
-- (signature.sql : les neuf familles, et l'historique, égaux à la production à 131 migrations) : sans la migration,
-- 36 lignes de verdict (76 tables, dont 67 portant un `dossier_id`), 0 en faute, 31 mutations sur 31 qui mordent ; avec
-- elle, 35 lignes (77 tables, dont 68 portant un `dossier_id` ; 3bis sur dix tables des ventes, 4bis sur quatorze
-- écritures directes), 0 en faute, 33 mutations sur 33. La copie adaptée selon cet en-tête, toutes ses lignes de
-- commentaire retirées (60 193 caractères, `b49cdaf6538b8042f2447a96ca016531`), jouée d'un seul tenant sur la même
-- réplique, rend les mêmes verdicts, ligne à ligne, avec et sans la migration. Ce que les fonctions refusent et
-- acceptent, profil par profil et par leur raison, est éprouvé par `articles.sql`. Le passage en production suivra
-- l'application et se notera ici.
--
-- 14/10/2026 — LA MIGRATION APPLIQUÉE EN PRODUCTION, `articles` (`20261014063058`, sur l'accord du cabinet, A1-Q1) :
-- 132 migrations ; la signature de la production (signature.sql, neuf familles) est celle de la réplique migrée. La
-- copie adaptée (60 193 caractères, `b49cdaf6…`, ce que rend la ligne TEXTE) y rend 35 lignes, 0 en faute, 33 mutations
-- sur 33 (77 tables, dont 68 portant un `dossier_id` ; M1 et M3 : 28 et 14 tables en faute ; M3bis-membre (articles)
-- voit les deux articles du jeu). `articles.sql` y rend ses 159 verdicts, 0 en faute.
--
-- 14/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (espace client, étape A6a : migration `adresses_reception`, préparée,
-- présentée au cabinet, non appliquée), qui crée `adresses_reception` — lecture du cabinet (`admin_du_dossier`), lecture
-- du droit « Ventes » (`adresses_reception_lecture_ventes`), insertion de restauration réservée au super-administrateur,
-- aucune autre policy ; une fonction l'écrit, une autre (`etat_facture_electronique`) lit pour le client deux tables sans
-- policy. Le bloc « Les ventes du client » la prend dès qu'elle existe (3bis, 4bis, M4bis, et une mutation à elle,
-- M3bis-membre (adresses de réception)) ; avant, une ligne « EN ATTENTE ». Joué ENTIER par psql sur la réplique de
-- l'étape (signature.sql : les neuf familles, et l'historique, égaux à la production à 132 migrations) : sans la
-- migration, 36 lignes de verdict (77 tables, dont 68 portant un `dossier_id`), 0 en faute, 33 mutations sur 33 qui
-- mordent ; avec elle, 35 lignes (78 tables, dont 69 portant un `dossier_id` ; 3bis sur onze tables des ventes, 4bis sur
-- seize écritures directes), 0 en faute, 35 mutations sur 35. Ce que les fonctions refusent et acceptent, profil par
-- profil et par leur raison, et ce que l'état ne rend jamais, est éprouvé par `etatFactureElectronique.sql`. Le passage
-- en production suivra l'application et se notera ici.
--
-- 14/10/2026 — LA MIGRATION APPLIQUÉE EN PRODUCTION, `adresses_reception` (`20261014143141`, sur l'accord du cabinet,
-- A6-Q1) : 133 migrations ; la signature de la production (signature.sql, neuf familles) est celle de la réplique
-- migrée. La copie adaptée (63 449 caractères, `990deaf1…`, ce que rend la ligne TEXTE — les échappements de la classe
-- des blancs reçus tels quels) y rend 35 lignes, 0 en faute, 35 mutations sur 35 (78 tables, dont 69 portant un
-- `dossier_id` ; M1 et M3 : 28 et 14 tables en faute ; M3bis-membre (adresses de réception) voit les deux adresses du
-- jeu). `etatFactureElectronique.sql` y rend ses 129 verdicts, 0 en faute.
--
-- 15/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (espace client, étape A4a : migration `contacts`, préparée, présentée
-- au cabinet, non appliquée), qui crée `contacts` — lecture du cabinet (`admin_du_dossier`), lecture du droit « Ventes »
-- (`contacts_lecture_ventes`), insertion de restauration réservée au super-administrateur, aucune autre policy ; quatre
-- fonctions l'écrivent, dont l'effacement. Le bloc « Les ventes du client » la prend dès qu'elle existe (3bis, 4bis,
-- M4bis, et une mutation à elle, M3bis-membre (contacts)) ; avant, une ligne « EN ATTENTE ». Joué ENTIER par psql sur la
-- réplique de l'étape (signature.sql : les neuf familles, et l'historique, égaux à la production à 133 migrations) : sans
-- la migration, 36 lignes de verdict (78 tables, dont 69 portant un `dossier_id`), 0 en faute, 35 mutations sur 35 qui
-- mordent ; avec elle, 35 lignes (79 tables, dont 70 portant un `dossier_id` ; 3bis sur douze tables des ventes, 4bis sur
-- dix-huit écritures directes), 0 en faute, 37 mutations sur 37 (M3bis-membre (contacts) voit les deux contacts du jeu).
-- Ce que les fonctions refusent et acceptent, profil par profil et par leur raison, est éprouvé par `contacts.sql`. Le
-- passage en production suivra l'application et se notera ici.
--
-- 15/10/2026 — LA MIGRATION APPLIQUÉE EN PRODUCTION, `contacts` (`20261015070431`, sur l'accord du cabinet, A4-Q6) :
-- 134 migrations ; la signature de la production (signature.sql : huit familles changent, pas les déclencheurs) est
-- celle de la réplique migrée. La copie adaptée (65 724 caractères, `0705e4a7…`, ce que rend la ligne TEXTE — les
-- échappements de la classe des blancs reçus tels quels) y rend 35 lignes, 0 en faute, 37 mutations sur 37 (79 tables,
-- dont 70 portant un `dossier_id` ; M1 et M3 : 28 et 14 tables en faute ; M3bis-membre (contacts) voit les deux
-- contacts du jeu). `contacts.sql` y rend ses 224 verdicts, 0 en faute.
--
-- 16/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (espace client, étape A5a : migration `parametres_facturation`,
-- préparée, présentée au cabinet, non appliquée), qui crée `parametres_facturation` — lecture du cabinet
-- (`admin_du_dossier`), lecture du droit « Ventes » (`parametres_facturation_lecture_ventes`), insertion de restauration
-- réservée au super-administrateur, aucune autre policy ; deux fonctions l'écrivent, la confirmation du RIB au cabinet
-- seul — et pose sur `dossiers` quatre colonnes d'identité légale, sans policy neuve. Le bloc « Les ventes du client » la
-- prend dès qu'elle existe (3bis, 4bis, M4bis, et une mutation à elle, M3bis-membre (paramètres de facturation)) ; avant,
-- une ligne « EN ATTENTE ». Joué ENTIER par psql sur la réplique de l'étape (signature.sql : les neuf familles, et
-- l'historique, égaux à la production à 135 migrations) : sans la migration, 36 lignes de verdict (79 tables, dont 70
-- portant un `dossier_id`), 0 en faute, 37 mutations sur 37 qui mordent ; avec elle, 35 lignes (80 tables, dont 71
-- portant un `dossier_id` ; 3bis sur treize tables des ventes, 4bis sur vingt écritures directes), 0 en faute, 39
-- mutations sur 39 (M3bis-membre (paramètres de facturation) voit les deux versions du jeu). Ce que les fonctions refusent
-- et acceptent, profil par profil et par leur raison, et l'identité légale que le client n'écrit pas, sont éprouvés par
-- `parametresFacturation.sql`. Le passage en production suivra l'application et se notera ici.
--
-- 16/10/2026 — LA MIGRATION APPLIQUÉE EN PRODUCTION, `parametres_facturation` (`20261016064317`, sur l'accord du
-- cabinet, A5-Q1) : 136 migrations ; la signature de la production (signature.sql : les neuf familles changent) est
-- celle de la réplique migrée. La copie adaptée (68 363 caractères, `747866d5…`, ce que rend la ligne TEXTE — les
-- échappements de la classe des blancs reçus tels quels) y rend 35 lignes, 0 en faute, 39 mutations sur 39 (80 tables,
-- dont 71 portant un `dossier_id` ; M1 et M3 : 28 et 14 tables en faute ; M3bis-membre (paramètres de facturation) voit
-- les deux versions du jeu). `parametresFacturation.sql` y rend ses 204 verdicts, 0 en faute.
--
-- 17/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (espace client, étape A5c1 : migration `logo_des_factures`, préparée,
-- présentée au cabinet, non appliquée), qui pose le seau PRIVÉ `ventes` et trois policies sur `storage.objects` — la
-- lecture et le dépôt d'un logo au cabinet du dossier et au client « Ventes » (`gere_les_ventes`), la suppression au chef
-- du cabinet du dossier seul, aucune mise à jour — et deux colonnes sur `parametres_facturation`, sans policy neuve dans
-- le schéma public. Le bloc « Le seau des ventes », en fin de fichier, le juge dès que le seau existe (SV0 à SV6 et quatre
-- mutations : M-SV1, M-SV3, M-SV4, M-SV5) ; avant, une ligne « EN ATTENTE ». Joué ENTIER par psql sur la réplique de l'étape
-- (signature.sql : les neuf familles, et l'historique, égaux à la production à 137 migrations ; le talon du stockage, ses
-- huit policies, ses trois seaux et sa protection des suppressions égaux à ceux de la production) : ce fichier sans le
-- bloc, sans la migration puis avec elle, 35 lignes de verdict, 0 en faute, 39 mutations sur 39, sorties identiques ligne
-- à ligne ; avec le bloc, sans la migration, 36 lignes (la ligne « EN ATTENTE » en plus), 0 en faute, 39 sur 39 ; avec
-- elle, 46 lignes, 0 en faute, 43 mutations sur 43 — les lignes d'avant identiques ; joué contre des mutations de la
-- migration, le bloc vire au rouge (la lecture ouverte à tout accès, le dépôt ouvert sans le droit, une policy de mise à
-- jour, la suppression élargie, le seau public, le dépôt hors de logos/), et une lecture ouverte à PUBLIC fait LEVER la
-- section S elle-même : l'anonyme n'exécute pas `gere_les_ventes`, et toute lecture de `storage.objects` lui échoue. Ce
-- que le seau, ses policies et la fonction des paramètres refusent et acceptent, profil par profil et par leur raison,
-- est éprouvé par `logoDesFactures.sql` ; la suppression, sur une réplique seulement, par
-- `logoDesFacturesSuppression.sql`. Le passage en production suivra l'application et se notera ici.
--
-- 17/10/2026 — LA MIGRATION APPLIQUÉE EN PRODUCTION, `logo_des_factures` (`20261017120403`, sur l'accord du cabinet,
-- A5C-Q1) : 138 migrations ; la signature de la production (signature.sql : les colonnes, les contraintes et les
-- fonctions changent ; celle du stockage : deux déclencheurs, onze policies, quatre seaux) est celle de la réplique
-- migrée. La copie adaptée (81 101 caractères, `506f61be…`, ce que rend la ligne TEXTE — les échappements de la classe
-- des blancs reçus tels quels) y rend 46 lignes, 0 en faute, 43 mutations sur 43 (80 tables, dont 71 portant un
-- `dossier_id` ; M1 et M3 : 28 et 14 tables en faute ; M-SV1, M-SV3, M-SV4 et M-SV5 mordent). `logoDesFactures.sql` y
-- rend ses 126 verdicts, 0 en faute.
--
-- 23/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (chantier EC-Q3, étape VF6b : migration `jumelle_inversee`, préparée,
-- présentée au cabinet, non appliquée), qui crée `designations_des_pieces`, le journal des désignations — lecture du
-- cabinet (`admin_du_dossier`), insertion de restauration réservée au super-administrateur, aucune autre policy, aucune
-- branche client (VF6-Q3) — ; aucune autre policy ne change, et ce fichier n'y change rien que cet en-tête. Joué ENTIER
-- par psql sur la réplique de l'étape (signature.sql : les neuf familles, et l'historique, égaux à la production à 146
-- migrations, puis la migration `virement_mixte` de l'étape VF5h) : sans la migration, 46 lignes de verdict (80 tables,
-- dont 71 portant un `dossier_id`), 0 en faute, 43 mutations sur 43 qui mordent ; avec elle, le journal semé dans le
-- dossier `test` (une désignation et son retrait, par les fonctions, sous la session du chef) et dans celui du client
-- (une déclaration, par la porte de la restauration), 46 lignes (81 tables, dont 72 portant un `dossier_id`), 0 en
-- faute, 43 sur 43 — M1, M3 et M3ter y voient la table de plus (14, 5 et 5 tables en faute, pour 13, 4 et 4). Que le
-- client ne lise aucune ligne du journal, pas même de son dossier, que le membre d'ailleurs et l'anonyme n'en lisent rien,
-- et qui l'écrit : `exemplairesDesFactures.sql` (contrôles 350 à 366). Le passage en production suivra l'application et
-- se notera ici.

-- `drop if exists` parce qu'une connexion réutilisée garde ses tables temporaires : sans lui, le
-- second passage échoue sur « relation déjà existante » et on croit à une régression du schéma.
--
-- 24/10/2026 — EN PRODUCTION, la migration `jumelle_inversee` appliquée (`20261024052424`, après `virement_mixte`) : ce
-- fichier n'y a pas été rejoué entier (sa copie adaptée : 81 075 caractères, `bcad9dbd…`, de l'ordre de 130 000 jetons à
-- lire et recopier) ; la signature des neuf familles en production égale celle de la réplique où il a rendu 46 lignes,
-- 0 en faute, 43 mutations sur 43. À la place, un contrôle ciblé de `designations_des_pieces` par impersonation, la
-- transaction annulée : le super-administrateur y pose et y lit une ligne de restauration, le client d'essai, un compte
-- rattaché à rien et l'anonyme n'en lisent rien et n'y écrivent pas (42501), rien n'est resté ; la RLS active, les deux
-- policies à `authenticated` seul (HISTORIQUE.md, « LE VIREMENT MIXTE ET LA JUMELLE INVERSÉE EN PRODUCTION »).
drop table if exists rls_verdict;
create temp table rls_verdict (controle text, cible text, observe text, ok boolean);

do $$
declare
  -- Un `sub` qui n'est dans aucune table : ni cabinet_admins, ni memberships, ni super_admins.
  inconnu    uuid := gen_random_uuid();
  client     uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef       uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  autre_dossier     uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  -- Tables qu'un utilisateur CONNECTÉ peut légitimement lire en entier. Ce sont des référentiels
  -- sans donnée de dossier ni donnée personnelle, partagés par construction :
  --   - taux_change_bce : cours publiés par la BCE, publics par nature ;
  --   - categories / natures_immobilisation : libellés comptables partagés par le cabinet
  --     (`dossier_id` nul). Réservés aux connectés depuis la migration du 19/09/2026 — avant, ils
  --     étaient lisibles par un ANONYME, ce que ce script a découvert ;
  --   - roles_comptables : le catalogue des rôles du plan comptable (ligne 43, PC1, 10/10/2026) — des
  --     numéros et des intitulés du plan comptable général, publics par nature, sans `dossier_id` ; le
  --     plan d'un DOSSIER (`plan_comptable_dossier`) n'est pas ici : il se lit sous `admin_du_dossier`.
  -- Toute AUTRE table visible d'un inconnu serait une fuite. Cette liste est l'endroit où « on a
  -- décidé que c'était acceptable » est écrit ; elle doit rester courte et justifiée.
  tolerees text[] := array['taux_change_bce', 'categories', 'natures_immobilisation', 'roles_comptables'];

  t record; n bigint; hors bigint; accepte boolean; touchees int;
  numero_avant int; numero_apres int;
  -- Le profil « client portant les deux droits » (3ter, 4ter) : ses verdicts naissent dans une sous-transaction annulée,
  -- que la table de résultats ne traverserait pas — ils voyagent dans une variable.
  avec_droits jsonb := '[]'::jsonb; porteurs bigint; ses_pieces bigint; vues bigint;
  -- Le code d'erreur du refus, et non un simple « ça a échoué ». Sans lui, une colonne mal
  -- orthographiée dans l'écriture d'essai produirait `42703` (colonne inconnue) et le test
  -- conclurait « RLS a refusé » — il passerait pour la mauvaise raison, ce qui est pire qu'un échec.
  -- On exige donc 42501, le refus de policy, nommément.
  motif text;
  -- Et le MESSAGE, pour les refus qui viennent d'une fonction plpgsql : ceux-là arrivent en P0001,
  -- le même code que l'annulation volontaire de ce harnais. Le code seul ne les distingue donc pas
  -- d'un incident sans rapport (voir 5bis).
  raison text;
begin
  -- ══ 1 et 2. Anonyme, puis authentifié rattaché à rien ══════════════════════════════════════
  for t in
    select c.relname as nom from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'r' order by c.relname
  loop
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
    -- Un refus franc (erreur) vaut mieux que zéro ligne, et compte comme un succès : -1 le note.
    begin execute format('select count(*) from public.%I', t.nom) into n; exception when others then n := -1; end;
    reset role;
    insert into rls_verdict values ('1. anonyme ne voit rien', t.nom, n::text, n <= 0);

    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
    begin execute format('select count(*) from public.%I', t.nom) into n; exception when others then n := -1; end;
    reset role;
    insert into rls_verdict values ('2. inconnu authentifié ne voit rien', t.nom, n::text,
      (n <= 0) or (t.nom = any(tolerees)));
  end loop;

  -- ══ 3. Le client ne voit que ses dossiers ═══════════════════════════════════════════════════
  for t in
    select c.relname as nom from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'dossier_id' and a.attnum > 0 and not a.attisdropped
    where ns.nspname = 'public' and c.relkind = 'r' order by c.relname
  loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
    begin
      -- Un `dossier_id` nul est une ligne partagée, légitimement visible : exclue du compte.
      execute format(
        'select count(*) from public.%I x where x.dossier_id is not null and x.dossier_id not in (select m.dossier_id from memberships m where m.user_id = %L)',
        t.nom, client) into hors;
    exception when others then hors := 0;  -- table refusée en bloc : aucune fuite possible
    end;
    reset role;
    insert into rls_verdict values ('3. client ne voit que ses dossiers', t.nom, hors::text, hors = 0);
  end loop;

  -- ══ 3ter. Le client qui porte les deux droits ne voit toujours que ses dossiers ══════════════
  -- Les deux cases de chacun de ses accès posées le temps d'une sous-transaction annulée (espace client, étape P1). Le
  -- contrôle 3 se joue avec les droits tels qu'ils sont en base ; celui-ci les force. Aucune policy ne les lit encore :
  -- ils n'ouvrent rien, et c'est ce qu'il établit, table par table — l'étape qui ouvrira une lecture à un droit (P2, P7)
  -- le verra ici si elle ouvre plus que les dossiers du client.
  begin
    update memberships set droit_ventes = true, droit_banque = true where user_id = client;
    select count(*) into porteurs from memberships where user_id = client and droit_ventes and droit_banque;
    select count(*) into ses_pieces from pieces p where p.dossier_id in (select m.dossier_id from memberships m where m.user_id = client);
    for t in
      select c.relname as nom from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'dossier_id' and a.attnum > 0 and not a.attisdropped
      where ns.nspname = 'public' and c.relkind = 'r' order by c.relname
    loop
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
      begin
        execute format(
          'select count(*) from public.%I x where x.dossier_id is not null and x.dossier_id not in (select m.dossier_id from memberships m where m.user_id = %L)',
          t.nom, client) into hors;
      exception when others then hors := 0;
      end;
      reset role;
      avec_droits := avec_droits || jsonb_build_object('cible', t.nom, 'observe', hors::text, 'ok', hors = 0);
    end loop;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
    select count(*) into vues from pieces;
    reset role;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null;
  end;
  reset role;
  insert into rls_verdict
    select '3ter. client portant les deux droits ne voit que ses dossiers', v.cible, v.observe, v.ok
    from jsonb_to_recordset(avec_droits) as v(cible text, observe text, ok boolean);
  insert into rls_verdict values ('3ter. client portant les deux droits ne voit que ses dossiers',
    'le profil (contrôle positif)', porteurs || ' accès portant les deux droits, ' || vues || ' pièces vues sur ' || ses_pieces,
    porteurs > 0 and porteurs = (select count(*) from memberships where user_id = client) and ses_pieces > 0 and vues = ses_pieces);

  -- ══ 4. Le client ne peut pas écrire ce qui est au cabinet ══════════════════════════════════
  -- Modifier une pièce de SON dossier : le dépôt lui appartient, l'arbitrage non.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  touchees := 0;
  begin
    update pieces set statut = 'validee' where dossier_id = dossier_du_client;
    get diagnostics touchees = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then null;   -- notre annulation : l'update est défait, `touchees` survit
    when others then touchees := 0;    -- refus franc
  end;
  reset role;
  insert into rls_verdict values ('4. client ne valide pas une pièce', 'pieces (update)', touchees::text, touchees = 0);

  -- Écrire une écriture comptable : réservé au cabinet, sans exception.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false;
  begin
    insert into ecritures_brouillon (dossier_id, compte, libelle, sens, montant, date)
    values (dossier_du_client, '606100', 'essai rls', 'debit', 1, current_date);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then null;
    when others then accepte := false; motif := sqlstate;
  end;
  reset role;
  insert into rls_verdict values ('4. client n''écrit pas une écriture', 'ecritures_brouillon (insert)',
    case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif,'?') end,
    (not accepte) and motif = '42501');

  -- Lire le dossier d'un AUTRE : la fuite la plus coûteuse s'il y en avait une.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  select count(*) into n from pieces where dossier_id = autre_dossier;
  reset role;
  insert into rls_verdict values ('4. client ne lit pas un autre dossier', 'pieces (autre dossier)', n::text, n = 0);

  -- ══ 4ter. Ses accès portant les deux droits, le client n'écrit pas directement ═════════════
  -- Une facture (le domaine « Ventes ») et un mouvement du relevé (« Banque »), sur SON dossier : refusés par la policy
  -- (42501). Les deux lignes sont valides — sous le chef, elles passent (mutation M4c).
  for t in select * from (values ('factures_emises'), ('lignes_bancaires')) as v(nom) loop
    accepte := false; motif := null;
    begin
      update memberships set droit_ventes = true, droit_banque = true where user_id = client;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
      begin
        if t.nom = 'factures_emises' then
          insert into factures_emises (dossier_id, tiers_nom) values (dossier_du_client, 'ESSAI RLS');
        else
          insert into lignes_bancaires (dossier_id, date, libelle, montant) values (dossier_du_client, current_date, 'essai rls', 1);
        end if;
        accepte := true;
      exception when others then motif := sqlstate;
      end;
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null;
    end;
    reset role;
    insert into rls_verdict values ('4ter. client portant les deux droits n''écrit pas directement', t.nom || ' (insert)',
      case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif,'?') end,
      (not accepte) and motif = '42501');
  end loop;

  -- ══ 5 et 5bis. La numérotation ne s'appelle pas ═══════════════════════════════════════════
  -- Les deux fonctions CONSOMMENT un numéro : on relève le compteur avant et après pour prouver qu'aucun
  -- trou n'a été creusé, même si un appel avait réussi. Le chef y entre, et c'est le point : jusqu'au
  -- 07/10/2026 il avait le droit de les appeler, donc de consommer un numéro sans la facture qu'il
  -- désigne. Le refus attendu est celui du DROIT D'EXÉCUTION, nommément : « pas accepté » ne prouve rien
  -- (un échec sans rapport passerait — voir M5quater), et un refus du contrôle d'accès de la fonction
  -- dirait que le droit existe encore.
  select coalesce(max(dernier_numero), -1) into numero_avant from facture_numerotation;
  for t in
    select '5' as num, 'prochain_numero_facture' as fonction, 'anonyme' as profil, null::uuid as sub, autre_dossier as cible
    union all select '5', 'prochain_numero_facture', 'client, son propre dossier', client, dossier_du_client
    union all select '5', 'prochain_numero_facture', 'chef, un dossier de son cabinet', chef, dossier_du_client
    union all select '5bis', 'attribuer_numero_facture', 'anonyme', null::uuid, autre_dossier
    union all select '5bis', 'attribuer_numero_facture', 'client, dossier d''un autre', client, autre_dossier
    union all select '5bis', 'attribuer_numero_facture', 'client, son propre dossier', client, dossier_du_client
    union all select '5bis', 'attribuer_numero_facture', 'chef, un dossier de son cabinet', chef, dossier_du_client
  loop
    if t.sub is null then
      set local role anon;
      perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
    else
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', t.sub, 'role','authenticated')::text, true);
    end if;
    accepte := false; motif := null; raison := null;
    begin
      execute format('select %I($1, 2026, %L)', t.fonction, 'facture') using t.cible;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception
      -- `accepte` est posé AVANT le `raise`, donc ce handler n'a rien à corriger : l'annulation et un
      -- refus levé par la fonction arrivent tous deux en P0001, c'est la RAISON qui les sépare.
      when sqlstate 'P0001' then get stacked diagnostics raison = message_text;
      when others then accepte := false; motif := sqlstate;
                       get stacked diagnostics raison = message_text;
    end;
    reset role;
    insert into rls_verdict values (t.num || '. ' || t.profil || ' n''appelle pas la numérotation', t.fonction,
      case when accepte then 'ACCEPTÉ' else 'refusé : ' || coalesce(motif, '') || ' ' || coalesce(raison, '?') end,
      (not accepte) and motif = '42501' and raison like 'permission denied for function%');
  end loop;
  select coalesce(max(dernier_numero), -1) into numero_apres from facture_numerotation;
  insert into rls_verdict values ('5bis. le compteur n''a pas bougé', 'facture_numerotation',
    numero_avant::text || ' -> ' || numero_apres::text, numero_avant = numero_apres);
end $$;


-- ═══ Le stockage ═══════════════════════════════════════════════════════════════════════════════
--
-- C'est ici que vivent les données identifiantes. RGPD.md §4 le mesure : les noms de patients sont
-- dans les FICHIERS, pas dans les tables — une ligne de pièce ne porte qu'un chemin, un montant et
-- une date. Les policies de `storage.objects` sont donc les plus importantes du projet, et étaient
-- les dernières à n'être vérifiées que par relecture.
--
-- Leur mécanique tient en une ligne : le premier segment du chemin EST le dossier
-- (`storage.foldername(name)[1]`, casté en uuid), et c'est lui qui est passé à `admin_du_dossier`
-- ou comparé aux `memberships`. D'où le contrôle S6, qui n'a l'air de rien : un chemin dont le
-- premier segment n'est pas un UUID ne masque pas une ligne, il fait LEVER le cast — donc casse
-- la lecture du bucket pour tout le monde, d'un coup.
--
-- Comme les policies de tables, toutes portent `roles = public`. Ici les prédicats sauvent la mise
-- (`auth.uid()` est nul sans session, donc aucune branche n'est vraie), mais c'est la même forme
-- que la fuite trouvée sur `categories` : ce qui protège est le prédicat, pas le rôle.

do $$
declare
  inconnu uuid := gen_random_uuid();
  client  uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  autre_dossier uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  n bigint; hors bigint; sien bigint; total_sien bigint;
  accepte boolean; motif text; mauvais bigint;
begin
  -- S1. L'anonyme ne voit aucun fichier des buckets privés.
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  select count(*) into n from storage.objects where bucket_id in ('pieces','packs');
  reset role;
  insert into rls_verdict values ('S1. anonyme ne voit aucun fichier privé', 'pieces + packs', n::text, n = 0);

  -- S1bis. Les logos SONT publics, et c'est voulu : ils s'affichent sur l'écran de connexion,
  -- avant toute session. Écrit ici pour que ce soit une décision constatée et non un oubli — et
  -- le contrôle exige qu'ils soient VISIBLES, donc il tombe aussi si on les ferme par mégarde.
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  select count(*) into n from storage.objects where bucket_id = 'cabinet-logos';
  reset role;
  insert into rls_verdict values ('S1bis. les logos restent publics, volontairement', 'cabinet-logos',
    n::text || ' visibles', n > 0);

  -- S2. Un authentifié rattaché à rien ne voit aucun fichier privé.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role','authenticated')::text, true);
  select count(*) into n from storage.objects where bucket_id in ('pieces','packs');
  reset role;
  insert into rls_verdict values ('S2. inconnu authentifié ne voit aucun fichier privé', 'pieces + packs', n::text, n = 0);

  -- S3. Le client ne voit aucun fichier hors de SES dossiers.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  select count(*) into hors from storage.objects o
   where o.bucket_id in ('pieces','packs')
     and ((storage.foldername(o.name))[1])::uuid not in (select m.dossier_id from memberships m where m.user_id = client);
  select count(*) into sien from storage.objects o
   where o.bucket_id = 'pieces'
     and ((storage.foldername(o.name))[1])::uuid in (select m.dossier_id from memberships m where m.user_id = client);
  reset role;
  insert into rls_verdict values ('S3. client ne voit aucun fichier d''un autre dossier', 'storage.objects', hors::text, hors = 0);

  -- S3bis. Contrôle POSITIF, et il est indispensable : sans lui, un bucket devenu illisible à tous
  -- passerait pour un succès sur toute la section ci-dessus. Le total de référence porte sur TOUS
  -- les dossiers du client — il en a plusieurs (voir le sélecteur multi-sociétés) — et non sur un
  -- seul : comparé à un dossier unique, ce contrôle annonçait « 61 vus sur 2 existants » et
  -- accusait à tort une policy qui faisait exactement son travail.
  select count(*) into total_sien from storage.objects o
   where o.bucket_id = 'pieces'
     and ((storage.foldername(o.name))[1])::uuid in (select m.dossier_id from memberships m where m.user_id = client);
  insert into rls_verdict values ('S3bis. le client voit BIEN ses propres fichiers', 'pieces (ses dossiers)',
    sien::text || ' vus sur ' || total_sien::text, sien = total_sien and total_sien > 0);

  -- S4. Le client ne dépose pas dans le dossier d'un autre.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
  accepte := false; motif := null;
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('pieces', autre_dossier::text || '/essai-rls.pdf', client::text);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate; end;
  reset role;
  insert into rls_verdict values ('S4. client ne dépose pas chez un autre', 'pieces (insert)',
    case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif,'?') end,
    (not accepte) and motif = '42501');

  -- S5. La suppression ne se teste PAS en SQL, et c'est une limite à connaître, pas un oubli.
  --
  -- Un trigger de la plateforme, `protect_objects_delete` (BEFORE DELETE → `storage.protect_delete`),
  -- refuse toute suppression SQL directe : « Direct deletion from storage tables is not allowed.
  -- Use the Storage API instead. » Il refuse pour TOUT LE MONDE, et il refuse avec le SQLSTATE
  -- **42501** — exactement celui d'un refus de policy.
  --
  -- Un essai de suppression est donc indiscernable d'un refus RLS : il passerait au vert avec une
  -- policy grande ouverte. C'est la version « stockage » du piège 42501/42703 du haut de ce fichier,
  -- et c'est le test de MUTATION qui l'a révélée — le contrôle avait d'abord été écrit comme les
  -- autres, il était vert, et sa mutation (le même essai sous le super-admin, à qui la suppression
  -- est permise) refusait de mordre. Un contrôle vert dont la mutation ne mord pas ne prouve rien.
  --
  -- Ce qui reste démontrable est plus faible, et dit comme tel : la policy porte-t-elle encore son
  -- prédicat ? C'est une lecture du catalogue, pas une exécution — ça n'atteste pas que Postgres
  -- l'applique, seulement qu'une migration ne l'a ni supprimée ni élargie. Le vrai chemin passe par
  -- l'API Storage, qu'un script SQL ne peut pas appeler : c'est un essai manuel (cf. RGPD.md §8.6).
  select count(*) into n from pg_policy
   where polrelid = 'storage.objects'::regclass
     and polname = 'pieces_storage_delete'
     and polcmd = 'd'
     and pg_get_expr(polqual, polrelid) like '%admin\_du\_dossier%';
  insert into rls_verdict values ('S5. la policy de suppression garde son prédicat (lecture du catalogue)',
    'pieces_storage_delete', case when n = 1 then 'présente, admin_du_dossier' else 'ABSENTE OU ÉLARGIE' end, n = 1);

  -- S6. Tout chemin commence par un UUID (voir l'en-tête de section : un chemin mal formé ne
  -- masque pas une ligne, il casse la lecture du bucket pour tout le monde).
  select count(*) into mauvais from storage.objects
   where (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  insert into rls_verdict values ('S6. tout chemin de fichier commence par un UUID', 'storage.objects',
    mauvais::text || ' mal formé(s)', mauvais = 0);
end $$;


-- ═══ Test de mutation du harnais ═══════════════════════════════════════════════════════════════
--
-- Chaque contrôle est rejoué sous le CHEF (super-admin, à qui tout est permis) ou sans sa liste
-- d'exceptions. Tout doit virer au rouge : un contrôle qui resterait vert ne regarde rien.
--
-- M5 appelle la numérotation sur une année FICTIVE (2099) et non sur l'année courante. L'annulation
-- par sous-transaction est justement ce que cette mutation met à l'épreuve : la supposer acquise
-- pour la tester serait circulaire. Sur une année fictive, même une annulation défaillante ne
-- toucherait aucune suite réelle — et M5bis vérifie qu'il ne reste rien.

drop table if exists rls_mutation;
create temp table rls_mutation (mutation text, attendu text, observe text, mord boolean);

do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  t record; n bigint; hors bigint; accepte boolean; touchees int; motif text;
  raison text; obs text;
  en_faute int; numero_avant int; numero_apres int; restes int;
begin
  -- M1 : le contrôle « anonyme ne voit rien » exécuté sous le chef.
  en_faute := 0;
  for t in select c.relname as nom from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
           where ns.nspname = 'public' and c.relkind = 'r'
  loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    begin execute format('select count(*) from public.%I', t.nom) into n; exception when others then n := -1; end;
    reset role;
    if not (n <= 0) then en_faute := en_faute + 1; end if;
  end loop;
  insert into rls_mutation values ('M1 — contrôle 1 joué sous le chef', 'des tables en faute', en_faute || ' tables', en_faute > 0);

  -- M2 : le contrôle 2 sans sa liste d'exceptions. Les 4 référentiels tolérés doivent ressortir —
  -- preuve que la boucle lit de vrais comptes, et non zéro parce que l'impersonation a échoué.
  en_faute := 0;
  for t in select c.relname as nom from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
           where ns.nspname = 'public' and c.relkind = 'r'
  loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role','authenticated')::text, true);
    begin execute format('select count(*) from public.%I', t.nom) into n; exception when others then n := -1; end;
    reset role;
    if not (n <= 0) then en_faute := en_faute + 1; end if;
  end loop;
  insert into rls_mutation values ('M2 — contrôle 2 sans sa liste tolerees', 'exactement 4 en faute', en_faute || ' tables', en_faute = 4);

  -- M3 : le contrôle 3 joué sous le chef, qui voit tout le cabinet.
  en_faute := 0;
  for t in select c.relname as nom from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
           join pg_attribute a on a.attrelid = c.oid and a.attname = 'dossier_id' and a.attnum > 0 and not a.attisdropped
           where ns.nspname = 'public' and c.relkind = 'r'
  loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    begin
      execute format('select count(*) from public.%I x where x.dossier_id is not null and x.dossier_id not in (select m.dossier_id from memberships m where m.user_id = %L)', t.nom, client) into hors;
    exception when others then hors := 0; end;
    reset role;
    if hors <> 0 then en_faute := en_faute + 1; end if;
  end loop;
  insert into rls_mutation values ('M3 — contrôle 3 joué sous le chef', 'des tables en faute', en_faute || ' tables', en_faute > 0);

  -- M3ter : le contrôle 3ter joué sous le chef — les droits posés de même, puis la boucle sous un profil qui voit tout le
  -- cabinet. Elle doit trouver des tables en faute : sinon, sous ce profil-là non plus, elle ne regarderait rien.
  en_faute := 0;
  begin
    update memberships set droit_ventes = true, droit_banque = true where user_id = client;
    for t in select c.relname as nom from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
             join pg_attribute a on a.attrelid = c.oid and a.attname = 'dossier_id' and a.attnum > 0 and not a.attisdropped
             where ns.nspname = 'public' and c.relkind = 'r'
    loop
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      begin
        execute format('select count(*) from public.%I x where x.dossier_id is not null and x.dossier_id not in (select m.dossier_id from memberships m where m.user_id = %L)', t.nom, client) into hors;
      exception when others then hors := 0; end;
      reset role;
      if hors <> 0 then en_faute := en_faute + 1; end if;
    end loop;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null;
  end;
  reset role;
  insert into rls_mutation values ('M3ter — contrôle 3ter joué sous le chef', 'des tables en faute', en_faute || ' tables', en_faute > 0);

  -- M4a : la validation de pièce tentée par le chef, à qui elle est permise.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  touchees := 0;
  begin
    update pieces set statut = 'validee' where dossier_id = dossier_du_client;
    get diagnostics touchees = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null; when others then touchees := 0; end;
  reset role;
  insert into rls_mutation values ('M4a — update pieces sous le chef', 'des lignes touchées', touchees || ' lignes', touchees > 0);

  -- M4b : l'écriture comptable tentée par le chef.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; motif := null;
  begin
    insert into ecritures_brouillon (dossier_id, compte, libelle, sens, montant, date)
    values (dossier_du_client, '606100', 'essai mutation', 'debit', 1, current_date);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate; end;
  reset role;
  insert into rls_mutation values ('M4b — insert écriture sous le chef', 'ACCEPTÉ',
    case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif,'?') end, accepte);

  -- M4c : les deux écritures du contrôle 4ter tentées par le chef. Elles doivent passer : sinon le refus de 4ter ne
  -- dirait rien du client, seulement d'une ligne que personne ne pourrait écrire.
  obs := '';
  for t in select * from (values ('factures_emises'), ('lignes_bancaires')) as v(nom) loop
    accepte := false; motif := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      begin
        if t.nom = 'factures_emises' then
          insert into factures_emises (dossier_id, tiers_nom) values (dossier_du_client, 'ESSAI MUTATION');
        else
          insert into lignes_bancaires (dossier_id, date, libelle, montant) values (dossier_du_client, current_date, 'essai mutation', 1);
        end if;
        accepte := true;
      exception when others then motif := sqlstate;
      end;
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null;
    end;
    reset role;
    obs := obs || t.nom || ' ' || case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif, '?') end || ' ';
  end loop;
  insert into rls_mutation values ('M4c — les écritures de 4ter sous le chef', 'ACCEPTÉ deux fois', obs,
    obs = 'factures_emises ACCEPTÉ lignes_bancaires ACCEPTÉ ');

  -- M5 : le droit d'exécution RENDU aux comptes connectés, le temps d'une sous-transaction annulée — la
  -- migration défaite. Le contrôle du chef doit alors virer au rouge : le chef consomme un numéro, sur
  -- l'année fictive 2099 (voir l'en-tête de section).
  select coalesce(max(dernier_numero), -1) into numero_avant from facture_numerotation;
  accepte := false; motif := null;
  begin
    grant execute on function prochain_numero_facture(uuid, integer, text) to authenticated;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
    perform prochain_numero_facture(dossier_du_client, 2099, 'facture');
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate; end;
  reset role;
  select coalesce(max(dernier_numero), -1) into numero_apres from facture_numerotation;
  insert into rls_mutation values ('M5 — le droit d''exécution rendu, le chef appelle', 'ACCEPTÉ',
    case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif,'?') end, accepte);

  -- M5bis : et l'annulation a bien effacé la consommation ET le droit rendu, jusque sur une fonction
  -- SECURITY DEFINER. C'est la preuve que tout le reste du fichier peut écrire sans laisser de trace.
  select count(*) into restes from facture_numerotation where annee = 2099;
  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name in ('prochain_numero_facture', 'attribuer_numero_facture')
     and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role');
  insert into rls_mutation values ('M5bis — l''annulation efface la consommation et le droit', '0 ligne 2099, compteur inchangé, 0 droit',
    restes || ' ligne(s) 2099, ' || numero_avant || ' -> ' || numero_apres || ', ' || n || ' droit(s)',
    restes = 0 and numero_avant = numero_apres and n = 0);

  -- M5ter : le contrôle POSITIF. Sans lui, les refus de 5 et 5bis seraient satisfaits par une
  -- numérotation que plus personne n'atteint — la facturation à l'arrêt. Le chef numérote par le seul
  -- chemin qui reste, `enregistrer_facture`, une facture de l'année fictive 2099, annulée aussitôt.
  select coalesce(max(dernier_numero), -1) into numero_avant from facture_numerotation;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; motif := null; raison := null;
  begin
    select f.numero into raison from enregistrer_facture(dossier_du_client, null,
      '{"tiers_nom":"ESSAI RLS","date_emission":"2099-01-15","montant_ht":1,"montant_tva":0,"montant_ttc":1}'::jsonb,
      '[{"designation":"essai","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, true) as f;
    accepte := raison like 'F2099-%';
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate; end;
  reset role;
  select coalesce(max(dernier_numero), -1) into numero_apres from facture_numerotation;
  select count(*) into restes from facture_numerotation where annee = 2099;
  insert into rls_mutation values ('M5ter — le chef numérote par enregistrer_facture', 'ACCEPTÉ',
    case when accepte then 'ACCEPTÉ ' || raison else 'refusé par ' || coalesce(motif,'?') end
    || ', ' || restes || ' ligne(s) 2099, ' || numero_avant || ' -> ' || numero_apres,
    accepte and restes = 0 and numero_avant = numero_apres);

  -- M5quater : l'exigence de RAISON de 5 et 5bis n'est pas décorative. On fait échouer l'essai pour un
  -- motif SANS RAPPORT — une fonction qui n'existe pas, donc 42883 — et le contrôle doit virer au
  -- rouge. Mesuré : sans cette exigence, « pas accepté » suffirait et l'essai passerait au VERT
  -- alors qu'il n'a jamais atteint la fonction. C'est le piège du 42703 que l'en-tête nomme déjà,
  -- ramené sur un appel de fonction.
  set local role anon;
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  accepte := false; motif := null; raison := null;
  begin
    perform attribuer_numero_facture_qui_n_existe_pas('00000000-0000-0000-0000-000000000000'::uuid, 2026, 'facture');
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then get stacked diagnostics raison = message_text;
    when others then accepte := false; motif := sqlstate;
                     get stacked diagnostics raison = message_text;
  end;
  reset role;
  insert into rls_mutation values ('M5quater — 5 et 5bis sur un échec sans rapport', 'EN FAUTE',
    'sqlstate ' || coalesce(motif,'?'),
    not ((not accepte) and motif = '42501' and raison like 'permission denied for function%'));
end $$;

-- Mutations de la section stockage. MS2 mérite un mot : le contrôle positif S3bis est le seul du
-- fichier qui exige de VOIR quelque chose, donc sa mutation est l'inverse des autres — on le rejoue
-- sous un inconnu, qui ne doit rien voir, et S3bis doit alors tomber.
do $$
declare
  client  uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef    uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  autre_dossier uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  n bigint; hors bigint; accepte boolean; motif text;
begin
  -- MS1 : S1 joué sous le chef, qui voit les fichiers de ses dossiers.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  select count(*) into n from storage.objects where bucket_id in ('pieces','packs');
  reset role;
  insert into rls_mutation values ('MS1 — S1 joué sous le chef', 'des fichiers visibles', n || ' fichiers', n > 0);

  -- MS2 : S3bis joué sous un inconnu. Le contrôle positif doit tomber.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role','authenticated')::text, true);
  select count(*) into n from storage.objects o
   where o.bucket_id = 'pieces'
     and ((storage.foldername(o.name))[1])::uuid in (select m.dossier_id from memberships m where m.user_id = client);
  reset role;
  insert into rls_mutation values ('MS2 — S3bis joué sous un inconnu', '0 fichier vu', n || ' fichiers', n = 0);

  -- MS3 : S3 joué sous le chef.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  select count(*) into hors from storage.objects o
   where o.bucket_id in ('pieces','packs')
     and ((storage.foldername(o.name))[1])::uuid not in (select m.dossier_id from memberships m where m.user_id = client);
  reset role;
  insert into rls_mutation values ('MS3 — S3 joué sous le chef', 'des fichiers hors de ses dossiers', hors || ' fichiers', hors > 0);

  -- MS4 : le dépôt chez un autre, tenté par le chef.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; motif := null;
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('pieces', autre_dossier::text || '/essai-mutation.pdf', chef::text);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate; end;
  reset role;
  insert into rls_mutation values ('MS4 — dépôt chez un autre sous le chef', 'ACCEPTÉ',
    case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif,'?') end, accepte);

  -- MS5 : la mutation de S5, qui est un contrôle d'une autre nature (lecture du catalogue). Le
  -- risque qu'il couvre est qu'une migration supprime ou élargisse la policy : on vérifie donc que
  -- le contrôle sait dire « absente » en le posant sur un nom de policy qui n'existe pas.
  select count(*) into n from pg_policy
   where polrelid = 'storage.objects'::regclass
     and polname = 'policy_qui_n_existe_pas'
     and polcmd = 'd'
     and pg_get_expr(polqual, polrelid) like '%admin\_du\_dossier%';
  insert into rls_mutation values ('MS5 — S5 posé sur une policy inexistante', '0 trouvée', n || ' trouvée(s)', n = 0);
end $$;

-- ═══ P7 — La banque du client : 3bis, son contrôle positif, 4bis, et leurs mutations ═══════════════
--
-- Les tables de la banque sont celles qu'une policy de lecture ouvre au droit « Banque » (`client_du_dossier(…,
-- 'banque')` ou `gere_la_banque`), LUES AU CATALOGUE : une table qu'une migration future y ajoutera est attrapée sans
-- qu'on pense à l'inscrire ici. Les six de l'étape P7 doivent en être — sans quoi les deux migrations de P7 ne sont pas
-- (toutes) en base, et la section le dit au lieu de lever.
--
-- Tout se joue dans UNE sous-transaction annulée : chaque table de la banque reçoit une ligne d'essai dans un dossier du
-- client et une dans un autre dossier (3bis ne prouve rien sur une table vide), les droits du client sont posés puis
-- retirés, et une policy est réécrite le temps d'une mutation. Les verdicts voyagent dans des variables, comme ceux de
-- 3ter. Aucune suppression.
--
--   3bis   sans la case « Banque » — et AVEC la case « Ventes », qui n'ouvre rien ici —, le client ne voit aucune ligne ;
--   3bis+  avec la case « Banque », il voit TOUTES les lignes de ses dossiers, table par table (le contrôle positif) ;
--   4bis   avec la case, il n'écrit directement dans aucune des six : l'insertion refusée en 42501, la mise à jour sans
--          ligne touchée ;
--   M3bis-a  le contrôle positif joué SANS la case : il doit tomber ;
--   M3bis-b  le prédicat de chaque policy de la banque où « banque » devient « membre » (la mutation de la conception,
--            §3.7) : 3bis doit voir des lignes ;
--   M4bis  les écritures de 4bis tentées par le chef : elles doivent passer — sinon le refus de 4bis ne dirait rien du
--          client, seulement de lignes que personne ne pourrait écrire.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  autre_dossier     uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  banque_attendues text[] := array['controles_releves_bancaires', 'justificatifs_proposes', 'lignes_bancaires',
                                   'precisions_mouvements', 'reglements_groupes', 'ventilations_bancaires'];
  banque_lues text[];
  mvt_client uuid; mvt_client_2 uuid; mvt_autre uuid; piece_client uuid; piece_autre uuid;
  t record; p record; n bigint; ses bigint; hors bigint; touchees int; motif text;
  verdicts jsonb := '[]'::jsonb;  -- {controle, cible, observe, ok}
  mutations jsonb := '[]'::jsonb; -- {mutation, attendu, observe, mord}
  en_faute int; obs text;
  -- Les écritures directes de 4bis et M4bis : une ligne VALIDE par table, pour que seul le droit puisse la refuser.
  ecritures text[];
begin
  select coalesce(array_agg(distinct p2.tablename::text order by p2.tablename::text), '{}') into banque_lues
    from pg_policies p2
   where p2.schemaname = 'public' and p2.cmd in ('SELECT', 'ALL') and 'authenticated' = any (p2.roles)
     and (p2.qual like '%client_du_dossier(dossier_id, ''banque''%' or p2.qual like '%gere_la_banque(dossier_id)%');
  if to_regclass('public.justificatifs_proposes') is null then
    -- L'étape P7 n'est pas en base (sa première migration crée cette table) : 3bis, 3bis+ et 4bis l'attendent, et la
    -- ligne le DIT sans être en faute — ce fichier se rejoue entre-temps après d'autres migrations, et une faute y désigne
    -- une policy à reprendre. Dès que la table existe, le domaine doit être complet : entre les deux migrations, la ligne
    -- du domaine est en faute, et c'est le resserrement qui manque.
    insert into rls_verdict values ('3bis. (Banque) en attente : les migrations de l''étape P7 ne sont pas en base',
      'le domaine (catalogue)', array_to_string(banque_lues, ', '), true);
    return;
  end if;
  insert into rls_verdict values ('3bis. (Banque) les tables de la banque se lisent au droit « Banque »', 'le domaine (catalogue)',
    array_to_string(banque_lues, ', '), banque_attendues <@ banque_lues);
  if not (banque_attendues <@ banque_lues) then
    -- Les migrations de P7 ne sont pas (toutes) en base : rien de ce qui suit n'a de sens, et la ligne ci-dessus le dit.
    return;
  end if;

  begin
    -- ── Le jeu ──
    insert into lignes_bancaires (dossier_id, date, libelle, montant) values (dossier_du_client, '2026-01-15', 'essai rls banque', -12.34)
      returning id into mvt_client;
    insert into lignes_bancaires (dossier_id, date, libelle, montant) values (dossier_du_client, '2026-01-16', 'essai rls banque 2', -5.67)
      returning id into mvt_client_2;
    insert into lignes_bancaires (dossier_id, date, libelle, montant) values (autre_dossier, '2026-01-15', 'essai rls banque', -12.34)
      returning id into mvt_autre;
    insert into pieces (dossier_id, storage_path, nom_fichier) values (dossier_du_client, dossier_du_client || '/essai-rls-banque.pdf', 'essai-rls-banque.pdf')
      returning id into piece_client;
    insert into pieces (dossier_id, storage_path, nom_fichier) values (autre_dossier, autre_dossier || '/essai-rls-banque.pdf', 'essai-rls-banque.pdf')
      returning id into piece_autre;
    insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, part_personnelle, montant) values
      (dossier_du_client, mvt_client, true, -12.34), (autre_dossier, mvt_autre, true, -12.34);
    insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values
      (dossier_du_client, mvt_client, piece_client, -12.34), (autre_dossier, mvt_autre, piece_autre, -12.34);
    insert into controles_releves_bancaires (dossier_id, source_fichier, solde_initial, solde_final, somme_mouvements, ecart, coherent) values
      (dossier_du_client, 'essai-rls-banque.csv', 0, -12.34, -12.34, 0, true), (autre_dossier, 'essai-rls-banque.csv', 0, -12.34, -12.34, 0, true);
    insert into justificatifs_proposes (dossier_id, ligne_bancaire_id, piece_id, auteur_id, origine) values
      (dossier_du_client, mvt_client, piece_client, client, 'client'), (autre_dossier, mvt_autre, piece_autre, chef, 'cabinet');
    insert into precisions_mouvements (dossier_id, ligne_bancaire_id, auteur_id, origine, texte) values
      (dossier_du_client, mvt_client, client, 'client', 'essai rls banque'), (autre_dossier, mvt_autre, chef, 'cabinet', 'essai rls banque');

    -- ── 3bis : la case « Ventes » sans la case « Banque » ──
    update memberships set droit_ventes = true, droit_banque = false where user_id = client;
    for t in select unnest(banque_lues) as nom loop
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
      begin execute format('select count(*) from public.%I', t.nom) into n; exception when others then n := 0; end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', '3bis. (Banque) sans la case « Banque », le client ne voit aucune ligne',
        'cible', t.nom, 'observe', n::text || ' vue(s)', 'ok', n = 0);
    end loop;

    -- ── 3bis+ : avec la case « Banque », toutes les lignes de ses dossiers ──
    update memberships set droit_banque = true where user_id = client;
    for t in select unnest(banque_lues) as nom loop
      execute format('select count(*) from public.%I x where x.dossier_id in (select m.dossier_id from memberships m where m.user_id = %L)',
        t.nom, client) into ses;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
      begin execute format('select count(*) from public.%I', t.nom) into n; exception when others then n := -1; end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', '3bis+. (Banque) avec la case « Banque », le client voit toutes les lignes de ses dossiers',
        'cible', t.nom, 'observe', n::text || ' vue(s) sur ' || ses::text, 'ok', ses > 0 and n = ses);
    end loop;

    -- ── 4bis : avec la case, aucune écriture directe ──
    ecritures := array[
      format('insert into lignes_bancaires (dossier_id, date, libelle, montant) values (%L, %L, %L, -1)', dossier_du_client, '2026-01-17', 'essai 4bis'),
      format('insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, part_personnelle, montant) values (%L, %L, true, -5.67)', dossier_du_client, mvt_client_2),
      format('insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values (%L, %L, %L, -5.67)', dossier_du_client, mvt_client_2, piece_client),
      format('insert into controles_releves_bancaires (dossier_id, source_fichier, solde_initial, solde_final, somme_mouvements, ecart, coherent) values (%L, %L, 0, 1, 1, 0, true)', dossier_du_client, 'essai-4bis.csv'),
      format('insert into justificatifs_proposes (dossier_id, ligne_bancaire_id, piece_id, auteur_id, origine) values (%L, %L, %L, %L, %L)', dossier_du_client, mvt_client_2, piece_client, client, 'client'),
      format('insert into precisions_mouvements (dossier_id, ligne_bancaire_id, auteur_id, origine, texte) values (%L, %L, %L, %L, %L)', dossier_du_client, mvt_client_2, client, 'client', 'essai 4bis')];
    for t in select e as sql, split_part(split_part(e, 'insert into ', 2), ' ', 1) as nom from unnest(ecritures) e loop
      motif := null;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
        execute t.sql;
        motif := 'ACCEPTÉ';
        raise exception 'ANNULATION_ESSAI_4BIS';
      exception when others then
        if motif is null then motif := sqlstate; end if;
      end;
      reset role;
      touchees := 0;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
        execute format('update public.%I set dossier_id = dossier_id where dossier_id = %L', t.nom, dossier_du_client);
        get diagnostics touchees = row_count;
        raise exception 'ANNULATION_ESSAI_4BIS';
      exception when others then null;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', '4bis. (Banque) avec la case « Banque », le client n''écrit directement nulle part',
        'cible', t.nom || ' (insert, update)', 'observe', 'insert : ' || motif || ', update : ' || touchees || ' ligne(s)',
        'ok', motif = '42501' and touchees = 0);
    end loop;

    -- ── M3bis-a : le contrôle positif joué sans la case ──
    update memberships set droit_banque = false where user_id = client;
    en_faute := 0;
    for t in select unnest(banque_lues) as nom loop
      execute format('select count(*) from public.%I x where x.dossier_id in (select m.dossier_id from memberships m where m.user_id = %L)',
        t.nom, client) into ses;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
      begin execute format('select count(*) from public.%I', t.nom) into n; exception when others then n := -1; end;
      reset role;
      if not (ses > 0 and n = ses) then en_faute := en_faute + 1; end if;
    end loop;
    mutations := mutations || jsonb_build_object('mutation', 'M3bis-a — le contrôle positif de 3bis joué sans la case « Banque »',
      'attendu', 'les ' || cardinality(banque_lues) || ' tables en faute', 'observe', en_faute || ' tables', 'mord', en_faute = cardinality(banque_lues));

    -- ── M3bis-b : « banque » devient « membre » dans chaque policy de la banque ──
    for p in select p2.policyname, p2.tablename, p2.qual from pg_policies p2
              where p2.schemaname = 'public' and p2.tablename = any (banque_lues) and p2.cmd in ('SELECT', 'ALL')
                and (p2.qual like '%client_du_dossier(dossier_id, ''banque''%' or p2.qual like '%gere_la_banque(dossier_id)%') loop
      execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename,
        replace(replace(p.qual, '''banque''', '''membre'''), 'gere_la_banque(dossier_id)',
                '(admin_du_dossier(dossier_id) or client_du_dossier(dossier_id, ''membre''))'));
    end loop;
    en_faute := 0;
    for t in select unnest(banque_lues) as nom loop
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role','authenticated')::text, true);
      begin execute format('select count(*) from public.%I', t.nom) into n; exception when others then n := 0; end;
      reset role;
      if n > 0 then en_faute := en_faute + 1; end if;
    end loop;
    mutations := mutations || jsonb_build_object('mutation', 'M3bis-b — « banque » remplacé par « membre » dans les policies de la banque',
      'attendu', 'les ' || cardinality(banque_lues) || ' tables en faute', 'observe', en_faute || ' tables', 'mord', en_faute = cardinality(banque_lues));

    -- ── M4bis : les écritures de 4bis tentées par le chef ──
    obs := ''; en_faute := 0;
    for t in select e as sql, split_part(split_part(e, 'insert into ', 2), ' ', 1) as nom from unnest(ecritures) e loop
      motif := null;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
        execute t.sql;
        motif := 'ACCEPTÉ';
        raise exception 'ANNULATION_ESSAI_4BIS';
      exception when others then
        if motif is null then motif := sqlstate; end if;
      end;
      reset role;
      if motif <> 'ACCEPTÉ' then en_faute := en_faute + 1; obs := obs || t.nom || ' ' || motif || ' '; end if;
    end loop;
    mutations := mutations || jsonb_build_object('mutation', 'M4bis — les écritures de 4bis sous le chef',
      'attendu', 'ACCEPTÉ ' || cardinality(ecritures) || ' fois', 'observe', case when en_faute = 0 then 'ACCEPTÉ ' || cardinality(ecritures) || ' fois' else obs end,
      'mord', en_faute = 0);

    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null;
  end;
  reset role;
  insert into rls_verdict
    select v.controle, v.cible, v.observe, v.ok from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation
    select m.mutation, m.attendu, m.observe, m.mord from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ═══ Les ventes du client (espace client, étape P2) ═══════════════════════════════════════════
--
-- Depuis la migration `ventes_du_client`, un accès client qui porte le droit « Ventes » LIT les ventes de ses dossiers :
-- neuf tables, chacune par une policy `for select to authenticated` sur `client_du_dossier(…, 'ventes')`. Deux
-- invariants, et leurs mutations :
--   3bis. Sans le droit — aucun droit, ou « Banque » seul —, le client ne lit AUCUNE ligne de ces tables, pas même de
--         son dossier ; avec lui, il les lit TOUTES pour ses dossiers : le contrôle POSITIF, sans lequel une lecture que
--         la RLS refuse (zéro ligne, sans erreur) passerait pour un succès ; et jamais la relance de pièces que le cabinet
--         lui adresse, qui n'est pas une vente. Les tables se lisent au CATALOGUE — les policies qui appellent
--         `client_du_dossier(…, 'ventes')` — et se confrontent à la liste présentée au cabinet : une policy ouverte demain
--         à ce droit sur une autre table, à une autre commande que la lecture ou à un autre rôle fait virer ce contrôle.
--   4bis. Avec les droits, le client n'écrit DIRECTEMENT aucune de ces tables : chaque insertion est refusée par la RLS
--         (42501), nommément — les lignes tentées sont valides, leurs gardes les laissent passer, et le chef les écrit
--         (M4bis) — ; une mise à jour ne touche aucune ligne. Ses gestes passent par les fonctions (ventesClient.sql).
-- Le jeu d'essai naît dans le dossier du client, dans un bloc qui s'annule : une facture validée de l'année fictive 2099
-- (par `enregistrer_facture`, en chef du cabinet) et un brouillon, une transmission acceptée, un événement de Super PDP,
-- un statut lu, un encaissement (par sa fonction) et sa déclaration, un encaissement sans parts, deux e-mails (une
-- facture, une relance de pièces) ; il s'ajoute à ce que la base porte déjà. Les verdicts voyagent dans des variables.
-- Mutations : le droit retiré au profil (M3bis), le prédicat passé à « membre » (M3bis-membre), une policy d'écriture
-- ouverte au droit (M3bis-catalogue), les insertions de 4bis sous le chef (M4bis).
-- TANT QUE LA MIGRATION N'EST PAS EN BASE (son témoin : la colonne `factures_emises.valide_par`, qu'elle pose d'un seul
-- tenant avec les policies), le bloc le dit en une ligne et ne juge rien : préparée et présentée au cabinet avant d'être
-- appliquée, elle peut attendre son accord pendant qu'une autre migration fait rejouer ce fichier. Une fois la colonne
-- là, tout se juge — une policy qui manquerait fait virer le catalogue.
-- LES DEVIS (étape P5) rejoignent ce domaine dès que la migration `devis_du_client` est en base (son témoin : la table
-- `devis`) : `devis` et `devis_factures` entrent dans la liste attendue ; le jeu d'essai y ajoute un devis du jour, émis
-- par le chef, accepté puis transformé en facture, par leurs fonctions ; 4bis y tente l'insertion directe d'un devis et
-- d'un lien, et la mise à jour d'un devis. Le cabinet n'a AUCUNE policy d'écriture sur ces tables : le chef de l'essai,
-- super-administrateur, fait passer les insertions de M4bis par la policy de la restauration. La série
-- (`devis_numerotation`) n'a aucune policy et n'est pas une vente : le client ne la lit pas (devis.sql, 97). Avant cette
-- migration, une ligne dit que les devis attendent, et les neuf tables se jugent seules.
-- LES ARTICLES (étape A1) rejoignent ce domaine dès que la migration `articles` est en base (son témoin : la table
-- `articles`) : la table entre dans la liste attendue ; le jeu d'essai y pose deux articles du dossier du client, par leur
-- fonction et sous le chef, dont un retiré (le client qui porte « Ventes » lit aussi les retirés) ; 4bis y tente
-- l'insertion directe d'un article et sa mise à jour. Le cabinet n'a AUCUNE policy d'écriture sur cette table : le chef de
-- l'essai, super-administrateur, fait passer l'insertion de M4bis par la policy de la restauration. Une mutation à elle,
-- M3bis-membre (articles), compte ce que le client sans droit voit de CETTE table quand sa policy passe à « membre » : le
-- total de M3bis-membre, lui, mordrait par les autres tables. Avant la migration, une ligne dit que les articles attendent.
-- LES ADRESSES DE RÉCEPTION (étape A6a) rejoignent ce domaine dès que la migration `adresses_reception` est en base (son
-- témoin : la table `adresses_reception`) : la table entre dans la liste attendue ; le jeu d'essai y déclare deux adresses
-- du dossier du client, par leur fonction et sous le chef, la seconde remplaçant la première (le client qui porte
-- « Ventes » lit toute l'histoire) — le SIREN du dossier lu comme la fonction le lit, ou, s'il n'en a pas, un SIRET fictif
-- posé le temps du bloc, qui s'annule ; 4bis y tente l'insertion directe d'une version qui remplace la courante (valide :
-- sa garde la laisse passer) et une mise à jour. Le cabinet n'a AUCUNE policy d'écriture sur cette table : le chef de
-- l'essai, super-administrateur, fait passer l'insertion de M4bis par la policy de la restauration. Une mutation à elle,
-- M3bis-membre (adresses de réception), compte ce que le client sans droit voit de CETTE table quand sa policy passe à
-- « membre ». Avant la migration, une ligne dit que les adresses de réception attendent.
-- LES CONTACTS (étape A4a) rejoignent ce domaine dès que la migration `contacts` est en base (son témoin : la table
-- `contacts`) : la table entre dans la liste attendue ; le jeu d'essai y range deux contacts du dossier du client, par leur
-- fonction et sous le chef — deux entreprises, que la règle des soins admet quel que soit le statut du dossier —, dont un
-- retiré (le client qui porte « Ventes » lit aussi les retirés) ; 4bis y tente l'insertion directe d'un contact valide et
-- une mise à jour. Le cabinet n'a AUCUNE policy d'écriture sur cette table : le chef de l'essai, super-administrateur, fait
-- passer l'insertion de M4bis par la policy de la restauration. Une mutation à elle, M3bis-membre (contacts), compte ce
-- que le client sans droit voit de CETTE table quand sa policy passe à « membre ». Avant la migration, une ligne dit que
-- les contacts attendent.
-- LES PARAMÈTRES DE FACTURATION (étape A5a) rejoignent ce domaine dès que la migration `parametres_facturation` est en base
-- (son témoin : la table `parametres_facturation`) : la table entre dans la liste attendue ; le jeu d'essai y enregistre
-- deux versions du dossier du client, par leur fonction et sous le chef, la seconde remplaçant la première — un RIB
-- confirmé, puis des conditions seules (le client qui porte « Ventes » lit toute l'histoire) ; 4bis y tente l'insertion
-- directe d'une version qui remplace la courante (valide : sa garde la laisse passer) et une mise à jour. Le cabinet n'a
-- AUCUNE policy d'écriture sur cette table : le chef de l'essai, super-administrateur, fait passer l'insertion de M4bis par
-- la policy de la restauration. Une mutation à elle, M3bis-membre (paramètres de facturation), compte ce que le client
-- sans droit voit de CETTE table quand sa policy passe à « membre ». Avant la migration, une ligne dit que les paramètres
-- de facturation attendent. L'identité légale que la migration pose sur `dossiers` n'ouvre rien : sa seule écriture est
-- `dossiers_update`, qu'aucun profil client ne passe (parametresFacturation.sql, 80 à 84).
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  -- Les tables des ventes telles que présentées au cabinet (étape P2, 10/10/2026). Le catalogue doit dire exactement
  -- celles-ci : une de plus serait une lecture ouverte sans avoir été présentée, une de moins une vente qui manque.
  attendues text[] := array['emails_envoyes', 'encaissements_factures', 'encaissements_factures_taux', 'facture_lignes',
    'facture_superpdp_events', 'factures_emises', 'statuts_factures_recus', 'transmissions_encaissements',
    'transmissions_factures'];
  catalogue_sql text := $q$
    select coalesce(array_agg(distinct c.relname::text order by c.relname::text), '{}'),
           string_agg(c.relname || '.' || po.polname || ' (' || po.polcmd::text || ', '
                      || array_to_string(po.polroles::regrole[]::text[], ',') || ')', ', ')
             filter (where not (po.polcmd = 'r' and po.polpermissive and po.polroles = array['authenticated'::regrole::oid]))
      from pg_policy po join pg_class c on c.oid = po.polrelid join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and coalesce(pg_get_expr(po.polqual, po.polrelid), '') || ' ' || coalesce(pg_get_expr(po.polwithcheck, po.polrelid), '')
           ~ 'client_du_dossier\([^)]*''ventes'''
  $q$;
  tables_ventes text[]; a_lire text[]; hors_lecture text; t text; reglage text; r record;
  f_validee uuid; f_brouillon uuid; enc uuid; enc_nu uuid; empreinte text := repeat('ef', 32);
  vus bigint; attendus bigint; relances_vues bigint; relances bigint; touchees int; accepte boolean; motif text;
  construit boolean := false; erreur text; total bigint; obs text; mauvais text;
  lus jsonb := '{}'::jsonb;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
  -- Les devis (étape P5) : celui du jeu, son jour (à Paris, comme la base date une émission), et ce que 4bis tentera.
  dv uuid; jour date := (now() at time zone 'Europe/Paris')::date;
  ecritures_devis jsonb := '[]'::jsonb; mises_a_jour_devis jsonb := '[]'::jsonb;
  -- Les articles (étape A1) : celui du jeu, ce que 4bis tentera, et ce que la mutation à part voit de la table.
  art uuid; ecritures_articles jsonb := '[]'::jsonb; mises_a_jour_articles jsonb := '[]'::jsonb; articles_membre bigint;
  -- Les adresses de réception (étape A6a) : la courante du jeu, le SIREN du dossier, ce que 4bis tentera, et ce que la
  -- mutation à part voit de la table.
  adr uuid; siren_du_client text; ecritures_adresses jsonb := '[]'::jsonb; mises_a_jour_adresses jsonb := '[]'::jsonb;
  adresses_membre bigint;
  -- Les contacts (étape A4a) : celui du jeu, ce que 4bis tentera, et ce que la mutation à part voit de la table.
  ct uuid; ecritures_contacts jsonb := '[]'::jsonb; mises_a_jour_contacts jsonb := '[]'::jsonb; contacts_membre bigint;
  -- Les paramètres de facturation (étape A5a) : la courante du jeu, ce que 4bis tentera, et ce que la mutation à part voit
  -- de la table.
  pf uuid; ecritures_parametres jsonb := '[]'::jsonb; mises_a_jour_parametres jsonb := '[]'::jsonb; parametres_membre bigint;
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.factures_emises'::regclass and attname = 'valide_par'
                  and not attisdropped) then
    -- Le nom de la ligne porte l'état : le tableau final ne montre le détail que d'une ligne en faute.
    insert into rls_verdict values ('3bis et 4bis. SANS OBJET : la migration ventes_du_client n''est pas encore en base',
      'factures_emises.valide_par', 'absente : 3bis et 4bis se jugent dès que la migration y est', true);
    return;
  end if;
  -- Les devis, dès que leur migration est en base ; avant, une ligne le dit.
  if to_regclass('public.devis') is not null then
    attendues := array(select x from unnest(attendues || array['devis', 'devis_factures']) x order by 1);
  else
    insert into rls_verdict values ('3bis et 4bis. les devis : EN ATTENTE de la migration devis_du_client',
      'public.devis', 'absente : les devis se jugent avec les ventes dès que la migration y est', true);
  end if;
  -- Les articles (étape A1), dès que leur migration est en base ; avant, une ligne le dit.
  if to_regclass('public.articles') is not null then
    attendues := array(select x from unnest(attendues || array['articles']) x order by 1);
  else
    insert into rls_verdict values ('3bis et 4bis. les articles : EN ATTENTE de la migration articles',
      'public.articles', 'absente : les articles se jugent avec les ventes dès que la migration y est', true);
  end if;
  -- Les adresses de réception (étape A6a), dès que leur migration est en base ; avant, une ligne le dit.
  if to_regclass('public.adresses_reception') is not null then
    attendues := array(select x from unnest(attendues || array['adresses_reception']) x order by 1);
  else
    insert into rls_verdict values ('3bis et 4bis. les adresses de réception : EN ATTENTE de la migration adresses_reception',
      'public.adresses_reception', 'absente : les adresses de réception se jugent avec les ventes dès que la migration y est', true);
  end if;
  -- Les contacts (étape A4a), dès que leur migration est en base ; avant, une ligne le dit.
  if to_regclass('public.contacts') is not null then
    attendues := array(select x from unnest(attendues || array['contacts']) x order by 1);
  else
    insert into rls_verdict values ('3bis et 4bis. les contacts : EN ATTENTE de la migration contacts',
      'public.contacts', 'absente : les contacts se jugent avec les ventes dès que la migration y est', true);
  end if;
  -- Les paramètres de facturation (étape A5a), dès que leur migration est en base ; avant, une ligne le dit.
  if to_regclass('public.parametres_facturation') is not null then
    attendues := array(select x from unnest(attendues || array['parametres_facturation']) x order by 1);
  else
    insert into rls_verdict values ('3bis et 4bis. les paramètres de facturation : EN ATTENTE de la migration parametres_facturation',
      'public.parametres_facturation', 'absente : les paramètres de facturation se jugent avec les ventes dès que la migration y est', true);
  end if;
  -- Le catalogue, tel qu'il est.
  execute catalogue_sql into tables_ventes, hors_lecture;
  verdicts := verdicts || jsonb_build_object('controle', '3bis. les tables ouvertes au droit « Ventes » sont celles présentées au cabinet, en lecture seule',
    'cible', 'pg_policy', 'observe', coalesce(nullif(array_to_string(tables_ventes, ', '), ''), 'aucune') || coalesce(' — hors lecture : ' || hors_lecture, ''),
    'ok', tables_ventes = attendues and hors_lecture is null);
  a_lire := array(select distinct x from unnest(tables_ventes || attendues) x order by 1);

  begin
    -- ── Le jeu d'essai, dans le dossier du client ──
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select e.facture_id into f_validee from enregistrer_facture(dossier_du_client, null,
      '{"tiers_nom":"ESSAI RLS","date_emission":"2099-01-15","montant_ht":100,"montant_tva":20,"montant_ttc":120,"type_client":"assujetti","nature_operation":"services"}'::jsonb,
      '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true) e;
    select e.facture_id into f_brouillon from enregistrer_facture(dossier_du_client, null,
      '{"tiers_nom":"ESSAI RLS","date_emission":"2099-01-16","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb,
      '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false) e;
    reset role;
    insert into transmissions_factures (dossier_id, facture_id, canal, hote, flux_id, sha256, etat)
      values (dossier_du_client, f_validee, 'plateforme', 'pa.exemple.fr', 'flux-rls', empreinte, 'accepte');
    insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at)
      values (dossier_du_client, f_validee, -9001, 'fr:200', 'essai rls', now());
    insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code)
      values (dossier_du_client, f_validee, 'pa.exemple.fr', 'cycle-rls', '205');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select e.id into enc from enregistrer_encaissement(dossier_du_client, f_validee, current_date, 10, 'virement', null,
      '[{"taux":20,"montant":10}]'::jsonb) e;
    perform declarer_encaissement_hors_application(dossier_du_client, enc, null);
    reset role;
    insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen)
      values (dossier_du_client, f_validee, current_date, 5, 'virement') returning id into enc_nu;
    insert into emails_envoyes (dossier_id, type, destinataire, objet, facture_id) values
      (dossier_du_client, 'facture', 'essai-rls@exemple.invalid', 'essai rls', f_validee),
      (dossier_du_client, 'relance_pieces', 'essai-rls@exemple.invalid', 'essai rls', null);
    -- Les devis : un devis du jour émis par le chef, accepté, puis transformé en facture — par leurs fonctions.
    if to_regclass('public.devis') is not null then
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select e.devis_id into dv from enregistrer_devis(dossier_du_client, null,
        jsonb_build_object('tiers_nom', 'ESSAI RLS', 'date_emission', jour, 'date_validite', jour, 'montant_ht', 100,
          'montant_tva', 20, 'montant_ttc', 120, 'emetteur_nom', 'ESSAI RLS'),
        '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true) e;
      perform decider_devis(dossier_du_client, dv, 'acceptee', jour, false);
      perform facturer_devis(dossier_du_client, dv);
      reset role;
      -- Ce que 4bis tentera : un brouillon de devis valide, et un second lien de ce devis accepté, vers le brouillon de
      -- facture du jeu — que ses gardes laissent passer.
      ecritures_devis := jsonb_build_array(
        jsonb_build_object('nom', 'devis', 'ordre', format('insert into devis (dossier_id, date_emission, date_validite, tiers_nom, lignes, montant_ht, montant_tva, montant_ttc) values (%L, %L, %L, %L, %L::jsonb, 100, 20, 120)',
          dossier_du_client, jour, jour, 'ESSAI RLS 4bis', '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]')),
        jsonb_build_object('nom', 'devis_factures', 'ordre', format('insert into devis_factures (dossier_id, devis_id, facture_id) values (%L, %L, %L)',
          dossier_du_client, dv, f_brouillon)));
      mises_a_jour_devis := jsonb_build_array(
        jsonb_build_object('nom', 'devis', 'ordre', format('update devis set notes = notes where dossier_id = %L', dossier_du_client)));
    end if;
    -- Les articles (étape A1) : deux articles du dossier du client, posés par le chef par leur fonction, dont un retiré.
    if to_regclass('public.articles') is not null then
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select a.id into art from enregistrer_article(dossier_du_client, null,
        '{"designation":"ESSAI RLS","prix_unitaire_ht":10,"taux_tva":20,"nature":"services"}'::jsonb) a;
      perform retirer_article(dossier_du_client, art);
      perform enregistrer_article(dossier_du_client, null,
        '{"designation":"ESSAI RLS 2","unite":"HUR","prix_unitaire_ht":5,"taux_tva":5.5,"nature":"biens"}'::jsonb);
      reset role;
      -- Ce que 4bis tentera : un article valide, que les contraintes de la table laissent passer, et une mise à jour.
      ecritures_articles := jsonb_build_array(
        jsonb_build_object('nom', 'articles', 'ordre', format('insert into articles (dossier_id, designation, prix_unitaire_ht, taux_tva, nature) values (%L, %L, 1, 20, %L)',
          dossier_du_client, 'ESSAI RLS 4bis', 'services')));
      mises_a_jour_articles := jsonb_build_array(
        jsonb_build_object('nom', 'articles', 'ordre', format('update articles set designation = designation where dossier_id = %L', dossier_du_client)));
    end if;
    -- Les adresses de réception (étape A6a) : deux déclarations du dossier du client, par leur fonction et sous le chef, la
    -- seconde remplaçant la première. Le SIREN du dossier se lit comme la fonction le lit (ses blancs retirés, quatorze
    -- chiffres donnent les neuf premiers, neuf chiffres le SIREN) ; sans lui, un SIRET fictif le temps du bloc.
    if to_regclass('public.adresses_reception') is not null then
      select case when s.chiffres ~ '^[0-9]{14}$' then left(s.chiffres, 9) when s.chiffres ~ '^[0-9]{9}$' then s.chiffres end
        into siren_du_client
        from (select regexp_replace(coalesce(d.siret, ''), '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', '', 'g') as chiffres
                from dossiers d where d.id = dossier_du_client) s;
      if siren_du_client is null then
        update dossiers set siret = '12345678200010' where id = dossier_du_client;
        siren_du_client := '123456782';
      end if;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select a.id into adr from declarer_adresse_reception(dossier_du_client, 'siren', siren_du_client, 'ESSAI RLS',
        date '2026-09-01', 'declaration', null, (select c.id from adresses_reception c where c.dossier_id = dossier_du_client
          and not exists (select 1 from adresses_reception s where s.remplace_id = c.id))) a;
      select a.id into adr from declarer_adresse_reception(dossier_du_client, 'siren_suffixe', siren_du_client || '_ESSAI-RLS',
        'ESSAI RLS 2', date '2026-10-01', 'declaration', null, adr) a;
      reset role;
      -- Ce que 4bis tentera : une version qui remplace la courante, que la garde laisse passer, et une mise à jour.
      ecritures_adresses := jsonb_build_array(
        jsonb_build_object('nom', 'adresses_reception', 'ordre', format('insert into adresses_reception (dossier_id, forme, identifiant, plateforme, prise_effet, verification, remplace_id, auteur) values (%L, %L, %L, %L, %L, %L, %L, %L)',
          dossier_du_client, 'siren', siren_du_client, 'ESSAI RLS 4bis', '2026-09-01', 'declaration', adr, client)));
      mises_a_jour_adresses := jsonb_build_array(
        jsonb_build_object('nom', 'adresses_reception', 'ordre', format('update adresses_reception set plateforme = plateforme where dossier_id = %L', dossier_du_client)));
    end if;
    -- Les contacts (étape A4a) : deux entreprises du dossier du client, rangées par le chef par leur fonction, dont une
    -- retirée — sans SIRET, qu'aucun contact du dossier ne leur dispute.
    if to_regclass('public.contacts') is not null then
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select c.id into ct from enregistrer_contact(dossier_du_client, null,
        '{"nom":"ESSAI RLS","type_client":"assujetti","adresse":"Adresse fictive"}'::jsonb) c;
      perform retirer_contact(dossier_du_client, ct);
      perform enregistrer_contact(dossier_du_client, null,
        '{"nom":"ESSAI RLS 2","type_client":"assujetti","adresse":"Adresse fictive","delai_paiement_jours":30}'::jsonb);
      reset role;
      -- Ce que 4bis tentera : un contact valide, que les contraintes de la table laissent passer, et une mise à jour.
      ecritures_contacts := jsonb_build_array(
        jsonb_build_object('nom', 'contacts', 'ordre', format('insert into contacts (dossier_id, nom, type_client, adresse) values (%L, %L, %L, %L)',
          dossier_du_client, 'ESSAI RLS 4bis', 'assujetti', 'Adresse fictive')));
      mises_a_jour_contacts := jsonb_build_array(
        jsonb_build_object('nom', 'contacts', 'ordre', format('update contacts set nom = nom where dossier_id = %L', dossier_du_client)));
    end if;
    -- Les paramètres de facturation (étape A5a) : deux versions du dossier du client, par leur fonction et sous le chef, la
    -- première remplaçant la courante s'il en a une — un RIB fictif à clé juste, confirmé d'emblée, puis des conditions
    -- seules, sans RIB.
    if to_regclass('public.parametres_facturation') is not null then
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select p.id into pf from enregistrer_parametres_facturation(dossier_du_client,
        (select c.id from parametres_facturation c where c.dossier_id = dossier_du_client
          and not exists (select 1 from parametres_facturation s where s.remplace_id = c.id)),
        '{"delai_paiement_jours":30,"iban":"FR9399999000010000000000100","titulaire_compte":"ESSAI RLS"}'::jsonb) p;
      select p.id into pf from enregistrer_parametres_facturation(dossier_du_client, pf,
        '{"delai_paiement_jours":45,"escompte":"Pas d''escompte pour paiement anticipé."}'::jsonb) p;
      reset role;
      -- Ce que 4bis tentera : une version qui remplace la courante, que la garde laisse passer, et une mise à jour.
      ecritures_parametres := jsonb_build_array(
        jsonb_build_object('nom', 'parametres_facturation', 'ordre', format('insert into parametres_facturation (dossier_id, remplace_id, auteur) values (%L, %L, %L)',
          dossier_du_client, pf, client)));
      mises_a_jour_parametres := jsonb_build_array(
        jsonb_build_object('nom', 'parametres_facturation', 'ordre', format('update parametres_facturation set escompte = escompte where dossier_id = %L', dossier_du_client)));
    end if;
    construit := true;

    -- ── 3bis. Ce que le client lit, sans droit, avec « Banque » seul, avec « Ventes » ──
    foreach reglage in array array['aucun', 'banque', 'ventes'] loop
      update memberships set droit_ventes = (reglage = 'ventes'), droit_banque = (reglage = 'banque') where user_id = client;
      foreach t in array a_lire loop
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        begin execute format('select count(*) from public.%I', t) into vus; exception when others then vus := -1; end;
        reset role;
        lus := jsonb_set(lus, array[t], coalesce(lus -> t, '{}'::jsonb) || jsonb_build_object(reglage, vus));
      end loop;
    end loop;
    -- Ce qu'il doit lire avec le droit : les lignes de SES dossiers — par la facture pour les lignes, qui n'ont pas de
    -- dossier ; pour les e-mails, ceux d'une facture ou d'un devis seulement.
    foreach t in array a_lire loop
      if exists (select 1 from pg_attribute a where a.attrelid = ('public.' || quote_ident(t))::regclass
                  and a.attname = 'dossier_id' and not a.attisdropped) then
        execute format('select count(*) from public.%I x where x.dossier_id in (select m.dossier_id from memberships m where m.user_id = %L)%s',
          t, client, case when t = 'emails_envoyes' then ' and x.type in (''facture'', ''devis'')' else '' end) into attendus;
      else
        execute format('select count(*) from public.%I x where x.facture_id in (select f.id from factures_emises f where f.dossier_id in (select m.dossier_id from memberships m where m.user_id = %L))',
          t, client) into attendus;
      end if;
      lus := jsonb_set(lus, array[t], (lus -> t) || jsonb_build_object('attendus', attendus));
    end loop;
    update memberships set droit_ventes = true, droit_banque = false where user_id = client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into relances_vues from emails_envoyes where type = 'relance_pieces';
    reset role;
    select count(*) into relances from emails_envoyes
     where type = 'relance_pieces' and dossier_id in (select m.dossier_id from memberships m where m.user_id = client);

    -- ── 4bis. Avec les droits, aucune écriture directe ──
    update memberships set droit_ventes = true, droit_banque = true where user_id = client;
    for r in select * from (values
        ('factures_emises', format('insert into factures_emises (dossier_id, tiers_nom) values (%L, %L)', dossier_du_client, 'ESSAI RLS 4bis')),
        ('facture_lignes', format('insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva) values (%L, 9, %L, 1, 1, 20)', f_brouillon, 'essai 4bis')),
        ('transmissions_factures', format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat) values (%L, %L, %L, %L, %L, %L)', dossier_du_client, f_validee, 'plateforme', 'pb.exemple.fr', empreinte, 'echec')),
        ('facture_superpdp_events', format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) values (%L, %L, -9002, %L, %L, now())', dossier_du_client, f_validee, 'fr:205', 'essai 4bis')),
        ('statuts_factures_recus', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, %L, %L, %L)', dossier_du_client, f_validee, 'pa.exemple.fr', 'cycle-rls-4bis', '205')),
        ('encaissements_factures', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, current_date, 1, %L)', dossier_du_client, f_validee, 'virement')),
        ('encaissements_factures_taux', format('insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 20, 5)', enc_nu, dossier_du_client)),
        ('transmissions_encaissements', format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, %L, %L, %L)', dossier_du_client, enc_nu, f_validee, 'manuel', 'pa.exemple.fr', 'depose')),
        ('emails_envoyes', format('insert into emails_envoyes (dossier_id, type, destinataire, objet, facture_id) values (%L, %L, %L, %L, %L)', dossier_du_client, 'facture', 'essai-4bis@exemple.invalid', 'essai 4bis', f_validee))
      ) as v(nom, ordre)
      union all
      select d.nom, d.ordre from jsonb_to_recordset(ecritures_devis) as d(nom text, ordre text)
      union all
      select d.nom, d.ordre from jsonb_to_recordset(ecritures_articles) as d(nom text, ordre text)
      union all
      select d.nom, d.ordre from jsonb_to_recordset(ecritures_adresses) as d(nom text, ordre text)
      union all
      select d.nom, d.ordre from jsonb_to_recordset(ecritures_contacts) as d(nom text, ordre text)
      union all
      select d.nom, d.ordre from jsonb_to_recordset(ecritures_parametres) as d(nom text, ordre text)
    loop
      -- Sous le client portant les deux droits : refusé par la RLS, nommément.
      accepte := false; motif := null;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        execute r.ordre;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then motif := sqlstate;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', '4bis. client portant les droits n''écrit directement aucune table des ventes',
        'cible', r.nom || ' (insert)', 'observe', case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif, '?') end,
        'ok', not accepte and motif = '42501');
      -- La même, sous le chef : elle doit passer, sans quoi le refus ne dirait rien du client (M4bis).
      accepte := false; motif := null;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        execute r.ordre;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then motif := case when accepte then null else sqlstate end;
      end;
      reset role;
      mutations := mutations || jsonb_build_object('mutation', 'M4bis — l''écriture de 4bis sous le chef : ' || r.nom,
        'attendu', 'ACCEPTÉ', 'observe', case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif, '?') end, 'mord', accepte);
    end loop;
    -- Une mise à jour directe d'une facture, d'une transmission ou d'un encaissement ne touche aucune ligne.
    for r in select * from (values
        ('factures_emises', format('update factures_emises set tiers_nom = tiers_nom where dossier_id = %L', dossier_du_client)),
        ('transmissions_factures', format('update transmissions_factures set detail = detail where dossier_id = %L', dossier_du_client)),
        ('encaissements_factures', format('update encaissements_factures set moyen = moyen where dossier_id = %L', dossier_du_client))
      ) as v(nom, ordre)
      union all
      select d.nom, d.ordre from jsonb_to_recordset(mises_a_jour_devis) as d(nom text, ordre text)
      union all
      select d.nom, d.ordre from jsonb_to_recordset(mises_a_jour_articles) as d(nom text, ordre text)
      union all
      select d.nom, d.ordre from jsonb_to_recordset(mises_a_jour_adresses) as d(nom text, ordre text)
      union all
      select d.nom, d.ordre from jsonb_to_recordset(mises_a_jour_contacts) as d(nom text, ordre text)
      union all
      select d.nom, d.ordre from jsonb_to_recordset(mises_a_jour_parametres) as d(nom text, ordre text)
    loop
      touchees := -1; motif := null;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        execute r.ordre;
        get diagnostics touchees = row_count;
        raise exception 'ANNULATION_ESSAI';
      exception when sqlstate 'P0001' then null; when others then motif := sqlstate; touchees := 0;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', '4bis. client portant les droits n''écrit directement aucune table des ventes',
        'cible', r.nom || ' (update)', 'observe', touchees || ' ligne(s) touchée(s)' || coalesce(', refusé par ' || motif, ''),
        'ok', touchees = 0);
    end loop;

    -- ── M3bis-membre : le prédicat des neuf policies passé à « membre », le client sans droit ──
    begin
      for r in select po.polname, c.relname, pg_get_expr(po.polqual, po.polrelid) as qual
                 from pg_policy po join pg_class c on c.oid = po.polrelid join pg_namespace ns on ns.oid = c.relnamespace
                where ns.nspname = 'public' and pg_get_expr(po.polqual, po.polrelid) ~ 'client_du_dossier\([^)]*''ventes'''
      loop
        execute format('alter policy %I on public.%I using (%s)', r.polname, r.relname, replace(r.qual, '''ventes''::text', '''membre''::text'));
      end loop;
      update memberships set droit_ventes = false, droit_banque = false where user_id = client;
      total := 0;
      foreach t in array a_lire loop
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        begin execute format('select count(*) from public.%I', t) into vus; exception when others then vus := 0; end;
        reset role;
        total := total + vus;
        -- Les articles (étape A1), comptés à part : le total mordrait par les autres tables.
        if t = 'articles' then articles_membre := vus; end if;
        -- Les adresses de réception (étape A6a) aussi.
        if t = 'adresses_reception' then adresses_membre := vus; end if;
        -- Les contacts (étape A4a) aussi.
        if t = 'contacts' then contacts_membre := vus; end if;
        -- Les paramètres de facturation (étape A5a) aussi.
        if t = 'parametres_facturation' then parametres_membre := vus; end if;
      end loop;
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null;
    end;
    reset role;
    if to_regclass('public.articles') is not null then
      mutations := mutations || jsonb_build_object('mutation', 'M3bis-membre (articles) — 3bis sans droit, la policy des articles sur « membre »',
        'attendu', 'des articles vus', 'observe', coalesce(articles_membre::text, '?') || ' article(s) vu(s)', 'mord', coalesce(articles_membre > 0, false));
    end if;
    if to_regclass('public.adresses_reception') is not null then
      mutations := mutations || jsonb_build_object('mutation', 'M3bis-membre (adresses de réception) — 3bis sans droit, la policy des adresses sur « membre »',
        'attendu', 'des adresses vues', 'observe', coalesce(adresses_membre::text, '?') || ' adresse(s) vue(s)', 'mord', coalesce(adresses_membre > 0, false));
    end if;
    if to_regclass('public.contacts') is not null then
      mutations := mutations || jsonb_build_object('mutation', 'M3bis-membre (contacts) — 3bis sans droit, la policy des contacts sur « membre »',
        'attendu', 'des contacts vus', 'observe', coalesce(contacts_membre::text, '?') || ' contact(s) vu(s)', 'mord', coalesce(contacts_membre > 0, false));
    end if;
    if to_regclass('public.parametres_facturation') is not null then
      mutations := mutations || jsonb_build_object('mutation', 'M3bis-membre (paramètres de facturation) — 3bis sans droit, la policy des paramètres sur « membre »',
        'attendu', 'des versions vues', 'observe', coalesce(parametres_membre::text, '?') || ' version(s) vue(s)', 'mord', coalesce(parametres_membre > 0, false));
    end if;
    mutations := mutations || jsonb_build_object('mutation', 'M3bis-membre — 3bis sans droit, les policies sur « membre »',
      'attendu', 'des lignes vues', 'observe', total || ' ligne(s) vue(s)', 'mord', total > 0);

    -- ── M3bis-catalogue : une policy d'écriture ouverte au droit « Ventes » sur une autre table ──
    begin
      create policy rls_mutation_ecriture_ventes on public.pieces for insert to authenticated
        with check (client_du_dossier(dossier_id, 'ventes'));
      execute catalogue_sql into tables_ventes, hors_lecture;
      obs := coalesce(nullif(array_to_string(tables_ventes, ', '), ''), 'aucune') || coalesce(' — hors lecture : ' || hors_lecture, '');
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null;
    end;
    mutations := mutations || jsonb_build_object('mutation', 'M3bis-catalogue — une policy d''écriture ouverte au droit sur pieces',
      'attendu', 'le catalogue en faute', 'observe', obs, 'mord', not (tables_ventes = attendues and hors_lecture is null));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  verdicts := verdicts || jsonb_build_object('controle', '3bis. le jeu d''essai des ventes s''est construit dans le dossier du client',
    'cible', 'dossier du client', 'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);
  foreach t in array a_lire loop
    verdicts := verdicts || jsonb_build_object('controle', '3bis. sans le droit « Ventes », aucune ligne des ventes, même de son dossier',
      'cible', t, 'observe', 'aucun droit : ' || coalesce(lus -> t ->> 'aucun', '?') || ', « Banque » seul : ' || coalesce(lus -> t ->> 'banque', '?'),
      'ok', coalesce((lus -> t ->> 'aucun')::bigint = 0 and (lus -> t ->> 'banque')::bigint = 0, false));
    verdicts := verdicts || jsonb_build_object('controle', '3bis. avec le droit « Ventes », toutes les lignes de ses dossiers (contrôle positif)',
      'cible', t, 'observe', coalesce(lus -> t ->> 'ventes', '?') || ' vue(s) sur ' || coalesce(lus -> t ->> 'attendus', '?'),
      'ok', coalesce((lus -> t ->> 'ventes')::bigint = (lus -> t ->> 'attendus')::bigint and (lus -> t ->> 'attendus')::bigint > 0, false));
  end loop;
  verdicts := verdicts || jsonb_build_object('controle', '3bis. avec le droit « Ventes », jamais une relance de pièces',
    'cible', 'emails_envoyes (relance_pieces)', 'observe', coalesce(relances_vues::text, '?') || ' vue(s) sur ' || coalesce(relances::text, '?') || ' en base',
    'ok', coalesce(relances_vues = 0 and relances > 0, false));

  -- M3bis : le contrôle positif, le droit retiré au profil — ce que le client voit sans droit ne fait pas le compte.
  mauvais := null;
  foreach t in array a_lire loop
    if coalesce((lus -> t ->> 'aucun')::bigint = (lus -> t ->> 'attendus')::bigint and (lus -> t ->> 'attendus')::bigint > 0, false) then
      mauvais := coalesce(mauvais || ', ', '') || t;
    end if;
  end loop;
  mutations := mutations || jsonb_build_object('mutation', 'M3bis — le contrôle positif de 3bis, le droit retiré au profil',
    'attendu', 'aucune table où le compte tombe juste', 'observe', coalesce('juste sur : ' || mauvais, 'aucune'), 'mord', mauvais is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ═══ Le seau des ventes (espace client, étape A5c1) ═══════════════════════════════════════════
--
-- Le seau `ventes` (migration `logo_des_factures`) range le logo des factures d'un dossier, sous `<dossier>/logos/`. Il est
-- PRIVÉ, et ses trois policies ne valent que pour lui : la lecture et le dépôt d'un logo au cabinet du dossier et à l'accès
-- client qui porte « Ventes » (`gere_les_ventes`), la suppression au chef du cabinet du dossier seul ; aucune mise à jour.
-- Les questions de la section S, posées à ce seau : il est privé (SV0) ; l'anonyme et un compte rattaché à rien n'y voient
-- rien (SV1, SV2) ; le client sans le droit « Ventes » — aucune case, ou « Banque » seul — rien, pas même de son dossier
-- (SV3) ; avec lui, les fichiers de son dossier, et ceux-là seuls (SV3bis, le contrôle POSITIF) ; il dépose sous `<son
-- dossier>/logos/`, jamais ailleurs, et sans le droit pas même là (SV4) ; personne ne modifie un fichier (SV5) ; la policy
-- de suppression porte encore le chef du cabinet du dossier (SV6, une lecture du catalogue : le stockage refuse toute
-- suppression SQL, voir S5 — ce qu'elle rencontre se joue sur une réplique par `logoDesFacturesSuppression.sql`). Le jeu :
-- deux logos d'essai rangés par le propriétaire, l'un dans le dossier du client, l'autre dans un autre dossier, et les
-- droits du client posés pour chaque contrôle — le tout dans une sous-transaction annulée ; les verdicts voyagent dans une
-- variable. Quatre mutations, qui doivent mordre. Avant la migration, une ligne dit que le seau attend. Ce que le seau, ses
-- policies et la fonction des paramètres refusent et acceptent, profil par profil, est éprouvé par `logoDesFactures.sql`.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  autre_dossier     uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  chemin_sien text := 'ac538d93-7da3-4403-bca6-2d7836810a6f/logos/' || repeat('e', 64) || '.png';
  chemin_autre text := '001c7ed7-c23b-4590-901e-693489f8af24/logos/' || repeat('e', 64) || '.png';
  n bigint; sien bigint; autre bigint; touchees int; accepte boolean; motif text; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from storage.buckets where id = 'ventes') then
    insert into rls_verdict values ('SV. le seau des ventes : EN ATTENTE de la migration logo_des_factures',
      'storage.buckets (ventes)', 'absent : le seau se juge dès que la migration y est', true);
    return;
  end if;
  begin
    insert into storage.objects (bucket_id, name, metadata) values
      ('ventes', chemin_sien, '{"size": 10, "mimetype": "image/png"}'), ('ventes', chemin_autre, '{"size": 10, "mimetype": "image/png"}');
    construit := true;

    -- SV1 et SV2 : l'anonyme, puis un compte rattaché à rien.
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    select count(*) into n from storage.objects where bucket_id = 'ventes' and name in (chemin_sien, chemin_autre);
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'SV1. anonyme ne voit aucun fichier du seau des ventes', 'cible', 'ventes',
      'observe', n::text, 'ok', n = 0);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
    select count(*) into n from storage.objects where bucket_id = 'ventes' and name in (chemin_sien, chemin_autre);
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'SV2. inconnu authentifié ne voit aucun fichier du seau des ventes', 'cible', 'ventes',
      'observe', n::text, 'ok', n = 0);
    -- M-SV1 : SV1 rejoué sous le chef, qui voit les deux.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into n from storage.objects where bucket_id = 'ventes' and name in (chemin_sien, chemin_autre);
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-SV1 — SV1 rejoué sous le chef', 'attendu', 'les deux fichiers vus',
      'observe', n || ' vu(s)', 'mord', n = 2);

    -- SV3 : le client sans le droit « Ventes » — aucune case, puis « Banque » seul.
    update memberships set droit_ventes = false, droit_banque = false where user_id = client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from storage.objects where bucket_id = 'ventes' and name in (chemin_sien, chemin_autre);
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'SV3. client sans le droit « Ventes » ne voit aucun fichier du seau, même de son dossier',
      'cible', 'ventes (aucune case)', 'observe', n::text, 'ok', n = 0);
    update memberships set droit_ventes = false, droit_banque = true where user_id = client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from storage.objects where bucket_id = 'ventes' and name in (chemin_sien, chemin_autre);
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'SV3. client sans le droit « Ventes » ne voit aucun fichier du seau, même de son dossier',
      'cible', 'ventes (« Banque » seul)', 'observe', n::text, 'ok', n = 0);

    -- SV3bis : avec « Ventes », le fichier de son dossier, et lui seul.
    update memberships set droit_ventes = true, droit_banque = false where user_id = client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) filter (where name = chemin_sien), count(*) filter (where name = chemin_autre) into sien, autre
      from storage.objects where bucket_id = 'ventes' and name in (chemin_sien, chemin_autre);
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'SV3bis. avec le droit « Ventes », le fichier de son dossier, et lui seul (contrôle positif)',
      'cible', 'ventes', 'observe', sien || ' du sien, ' || autre || ' d''un autre', 'ok', sien = 1 and autre = 0);

    -- SV4 : il dépose sous son dossier, jamais ailleurs.
    accepte := false; motif := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into storage.objects (bucket_id, name, metadata) values ('ventes', autre_dossier || '/logos/' || repeat('d', 64) || '.png', '{"size": 10, "mimetype": "image/png"}');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'SV4. client « Ventes » ne dépose pas dans un autre dossier, ni hors de logos/',
      'cible', 'ventes (insert, autre dossier)', 'observe', case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif, '?') end,
      'ok', (not accepte) and motif = '42501');
    accepte := false; motif := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into storage.objects (bucket_id, name, metadata) values ('ventes', dossier_du_client || '/autre/' || repeat('d', 64) || '.png', '{"size": 10, "mimetype": "image/png"}');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'SV4. client « Ventes » ne dépose pas dans un autre dossier, ni hors de logos/',
      'cible', 'ventes (insert, hors de logos/)', 'observe', case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif, '?') end,
      'ok', (not accepte) and motif = '42501');
    -- Sans le droit « Ventes », il ne dépose pas même dans son dossier.
    update memberships set droit_ventes = false, droit_banque = true where user_id = client;
    accepte := false; motif := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into storage.objects (bucket_id, name, metadata) values ('ventes', dossier_du_client || '/logos/' || repeat('d', 64) || '.png', '{"size": 10, "mimetype": "image/png"}');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'SV4. sans le droit « Ventes », le client ne dépose pas, même dans son dossier',
      'cible', 'ventes (insert, « Banque » seul)', 'observe', case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif, '?') end,
      'ok', (not accepte) and motif = '42501');
    update memberships set droit_ventes = true, droit_banque = false where user_id = client;
    -- M-SV4 : SV4 rejoué dans son dossier, sous logos/ — il dépose.
    accepte := false; motif := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into storage.objects (bucket_id, name, metadata) values ('ventes', dossier_du_client || '/logos/' || repeat('d', 64) || '.png', '{"size": 10, "mimetype": "image/png"}');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-SV4 — SV4 rejoué dans son dossier, sous logos/', 'attendu', 'le dépôt accepté',
      'observe', case when accepte then 'accepté' else 'refusé par ' || coalesce(motif, '?') end, 'mord', accepte);

    -- SV5 : personne ne modifie un fichier — le client « Ventes », puis le chef.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    update storage.objects set metadata = '{"size": 20, "mimetype": "image/png"}' where bucket_id = 'ventes' and name in (chemin_sien, chemin_autre);
    get diagnostics touchees = row_count;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'SV5. personne ne modifie un fichier du seau des ventes', 'cible', 'ventes (client « Ventes »)',
      'observe', touchees || ' ligne(s) touchée(s)', 'ok', touchees = 0);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    update storage.objects set metadata = '{"size": 20, "mimetype": "image/png"}' where bucket_id = 'ventes' and name in (chemin_sien, chemin_autre);
    get diagnostics touchees = row_count;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'SV5. personne ne modifie un fichier du seau des ventes', 'cible', 'ventes (chef)',
      'observe', touchees || ' ligne(s) touchée(s)', 'ok', touchees = 0);
    -- M-SV5 : SV5 rejoué par le propriétaire, qui touche les deux lignes.
    update storage.objects set metadata = '{"size": 20, "mimetype": "image/png"}' where bucket_id = 'ventes' and name in (chemin_sien, chemin_autre);
    get diagnostics touchees = row_count;
    mutations := mutations || jsonb_build_object('mutation', 'M-SV5 — SV5 rejoué par le propriétaire', 'attendu', 'les deux lignes touchées',
      'observe', touchees || ' ligne(s)', 'mord', touchees = 2);

    -- M-SV3 : SV3 rejoué avec « Ventes » : le client voit le fichier de son dossier.
    update memberships set droit_ventes = true, droit_banque = false where user_id = client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from storage.objects where bucket_id = 'ventes' and name in (chemin_sien, chemin_autre);
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-SV3 — SV3 rejoué avec le droit « Ventes »', 'attendu', 'le fichier de son dossier vu',
      'observe', n || ' vu(s)', 'mord', n = 1);

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  -- SV0 : le seau est privé — un seau public servirait ses fichiers à quiconque en tient l'adresse, sans policy.
  select count(*) into n from storage.buckets where id = 'ventes' and not public;
  verdicts := verdicts || jsonb_build_object('controle', 'SV0. le seau des ventes est privé (lecture du catalogue)', 'cible', 'storage.buckets (ventes)',
    'observe', case when n = 1 then 'privé' else 'PUBLIC' end, 'ok', n = 1);
  -- SV6 : la policy de suppression garde son prédicat — le chef du cabinet du dossier —, et aucune policy de mise à jour
  -- n'atteint le seau (lectures du catalogue).
  select count(*) into n from pg_policy
   where polrelid = 'storage.objects'::regclass and polname = 'ventes_suppression_par_le_chef' and polcmd = 'd'
     and pg_get_expr(polqual, polrelid) like '%est\_chef\_du\_cabinet(d.cabinet\_id)%'
     and pg_get_expr(polqual, polrelid) like '%''ventes''%';
  verdicts := verdicts || jsonb_build_object('controle', 'SV6. la suppression du seau des ventes reste au chef du cabinet du dossier (lecture du catalogue)',
    'cible', 'ventes_suppression_par_le_chef', 'observe', case when n = 1 then 'présente, est_chef_du_cabinet' else 'ABSENTE OU ÉLARGIE' end,
    'ok', n = 1);
  select count(*) into n from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polcmd in ('w', '*')
     and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
         !~ 'bucket_id = ''(pieces|packs|cabinet-logos)''::text';
  verdicts := verdicts || jsonb_build_object('controle', 'SV6. aucune policy de mise à jour n''atteint le seau des ventes (lecture du catalogue)',
    'cible', 'storage.objects', 'observe', n || ' policy(s)', 'ok', n = 0);
  verdicts := verdicts || jsonb_build_object('controle', 'SV. le jeu d''essai du seau des ventes s''est construit', 'cible', 'ventes',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- Le verdict, les deux moitiés dans UN seul tableau. Ce n'est pas une coquetterie de présentation :
-- `execute_sql` ne rend que le résultat de la DERNIÈRE requête, donc en deux `select` le verdict des
-- invariants — le principal — ne s'afficherait jamais. Un harnais dont on ne voit pas la réponse est
-- un harnais absent.
--
-- Se lit ainsi : toute ligne INVARIANTS à « en faute » non nul est une policy à reprendre, pas un
-- réglage du test. Toute ligne MUTATIONS qui « NE MORD PAS » est un contrôle qui ne prouve plus rien,
-- même si les invariants au-dessus sont tous verts.
select 'INVARIANTS' as tableau, controle as ligne,
       count(*) filter (where not ok)::text || ' en faute / ' || count(*) || ' vérifications' as resultat,
       coalesce(string_agg(cible || ' (' || observe || ')', ', ') filter (where not ok), 'aucune') as detail
from rls_verdict group by controle
union all
select 'MUTATIONS', mutation,
       case when mord then 'le contrôle mord' else '*** NE MORD PAS ***' end,
       'attendu ' || attendu || ', observé ' || observe
from rls_mutation
order by 1 desc, 2;
