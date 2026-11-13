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
--   6ter. Les ORIGINAUX des factures reprises dans ce seau (A8d2a ; bloc « Les originaux des factures reprises », en fin de
--      fichier) : OI1 à OI7 — sous `<dossier>/imports/`, rien au client, même « Ventes », le cabinet du dossier seul en
--      lecture et en dépôt, sous la forme exacte du chemin, aucune mise à jour — et six mutations ; avant la migration
--      `originaux_des_imports`, une ligne « EN ATTENTE ».
--   6quater. Le DOSSIER DU CABINET (LM1, ligne 47 ; bloc « Le dossier du cabinet », en fin de fichier) : DC1 à DC7 — la
--      désignation ni par l'anonyme, ni par un compte rattaché à rien, ni par le client ; la colonne pas par la policy du
--      cabinet ; le chef désigne (contrôle positif) ; aucun accès client sur le dossier désigné ; le catalogue — et trois
--      mutations ; avant la migration `dossier_du_cabinet`, une ligne « EN ATTENTE ».
--   6quinquies. Les LETTRES DE MISSION (LM4, ligne 47 ; bloc « Les lettres de mission », après le dossier du cabinet) :
--      LM1 à LM7 — les six fonctions ni par l'anonyme, ni par un compte rattaché à rien, ni par le client ; le chef écrit
--      et lit (contrôle positif) ; le client ne lit rien ; l'insertion directe au super-administrateur seul ; le catalogue,
--      le drapeau de l'acceptation en ligne baissé — et trois mutations ; avant la migration `lettres_de_mission`, une
--      ligne « EN ATTENTE ».
--   6quinquies-bis. Les FACTURES D'HONORAIRES (LM7, ligne 47 ; bloc « Les factures d'honoraires », après les lettres de
--      mission) : HF1 à HF7 — la fonction ni par l'anonyme, ni par un compte rattaché à rien, ni par le client ; le chef
--      facture et lit (contrôle positif) ; le client ne lit rien ; l'insertion directe au super-administrateur seul ; le
--      catalogue — et trois mutations ; avant la migration `honoraires_factures`, une ligne « EN ATTENTE ».
--   6quinquies-ter. Le DÉPÔT DES FACTURES D'HONORAIRES chez le client (LM8, ligne 47 ; bloc « Le dépôt des factures
--      d'honoraires chez le client », après les factures d'honoraires) : HD1 à HD7 — la fonction ni par l'anonyme, ni par
--      un compte rattaché à rien, ni par le client ; le chef dépose et lit (contrôle positif) ; le client ne lit aucun dépôt
--      ni ceux du cabinet, mais lit que sa pièce vient de son cabinet ; l'insertion directe au super-administrateur seul ;
--      le catalogue — et trois mutations ; avant la migration `depot_des_honoraires`, une ligne « EN ATTENTE ».
--   6quinquies-quater. La FICHE DE FACTURATION LIÉE au dossier d'un client (LM3, ligne 47 ; bloc « La fiche de facturation
--      d'un client du cabinet, liée à son dossier », après le dépôt des honoraires) : FL1 à FL7 — ni l'anonyme, ni un
--      compte rattaché à rien, ni le client ne lient ni ne lisent l'identité ; le chef lie et lit (contrôle positif) ;
--      l'insertion directe au super-administrateur seul ; ni un compte rattaché à rien ni le client ne délient (LM3-Q1
--      (B)) ; le catalogue — et quatre mutations ; avant la migration
--      `fiche_liee_au_dossier_du_client`, une ligne « EN ATTENTE ».
--   6quinquies-quinquies. Les MISSIONS D'UN CLIENT, sans ses honoraires (LM5-Q2, ligne 47 ; bloc « Les missions d'un
--      client, sans ses honoraires », après la fiche liée) : MV1 à MV7 — la lecture ni par l'anonyme, ni par un compte
--      rattaché à rien, ni par le client, ni par un membre que le dossier du client n'a pas ; le membre assigné au seul
--      dossier du client lit (contrôle positif), la table des lettres lui restant fermée ; ses clés seules, aucun mot ni
--      montant des honoraires ; le catalogue — et trois mutations ; avant la migration `missions_du_client`, une ligne
--      « EN ATTENTE ».
--   6quinquies-sexies. Les LETTRES DE MISSION DANS L'ESPACE CLIENT (LM6, ligne 47 ; bloc « Les lettres de mission dans
--      l'espace client », après les missions d'un client) : LC1 à LC7 — la lecture ni par l'anonyme, ni par un compte
--      rattaché à rien, ni par le client sans la case « Documents », ni par un membre assigné au dossier du client ; le
--      client qui porte la case lit (contrôle positif), les deux tables lui restant fermées ; ni auteur, ni dossier du
--      cabinet, ni compte du signataire, ni papier signé ; le catalogue — et trois mutations ; avant la migration
--      `lettres_du_client`, une ligne « EN ATTENTE ».
--   6sexies. L'ADRESSE D'UN ACCÈS RETIRÉ (P1T-E2, ligne 51.5 ; bloc AR, après le bloc TD) : AR1 à AR3 — le cabinet du
--      dossier la lit (contrôle positif), ni le client ni l'anonyme ; le client ne l'écrit ni ne la réécrit ; le catalogue —
--      et deux mutations ; avant la migration `adresse_des_acces_retires`, une ligne « EN ATTENTE ».
--   6septies. Les DOCUMENTS ET LES DEMANDES DU CABINET (B2, ligne 51.5 ; bloc DM, en fin de fichier) : DM1 à DM4 — le client
--      « Documents » lit le document publié de son dossier et son fichier (contrôle positif), sans la case ni l'un ni
--      l'autre ; tout accès lit la demande ; l'anonyme et un compte rattaché à rien, rien ; le client n'écrit aucune des
--      cinq tables en direct ni ne dépose dans le seau ; le catalogue — et quatre mutations ; avant la migration
--      `documents_et_demandes`, une ligne « EN ATTENTE ». TC1 et TC3 ne jugent alors plus que « Achats » et « Notes de frais ».
--   6octies. Les ACHATS DU CLIENT (B4, ligne 51.5 ; bloc AC, en fin de fichier) : AC1 à AC4 — le client « Achats » lit les
--      paiements déclarés de son dossier et ses propres pièces vues (contrôle positif), sans la case rien ; l'anonyme et un
--      compte rattaché à rien, rien ; le client n'écrit aucune des deux tables en direct, ni l'échéance d'une pièce, que le
--      cabinet ne change que par sa fonction ; le catalogue — et quatre mutations ; avant la migration `achats_du_client`,
--      une ligne « EN ATTENTE ». TC1 et TC3 ne jugent alors plus « Achats », et M-TC1 lit sous « Notes de frais ».
--   6novies. Les NOTES DE FRAIS (B7, ligne 51.5 ; bloc NF, en fin de fichier) : NF1 à NF3 — le client « Notes de frais » lit
--      la note qu'il a saisie et soumise (contrôle positif), sans la case rien ; l'accès « Achats » la lit, soumise ;
--      l'anonyme et un compte rattaché à rien, rien ; le client n'écrit pas la table en direct ni ne la réécrit ; le
--      catalogue — et trois mutations ; avant la migration `notes_de_frais`, une ligne « EN ATTENTE ». B7 lisant « Notes de
--      frais » et « Achats », TC1 et TC3 ne jugent alors plus ni l'une ni l'autre, et M-TC1 lit sous « Documents » ; B2 en
--      base aussi, TC1 et TC3 sont sans objet, et M-TC1 ne se joue plus.
--   6decies. Le MODÈLE DE PLAN DU CABINET (PC5, ligne 43 ; bloc MP, en fin de fichier) : MP1 à MP3 — le chef et un membre de
--      l'équipe lisent le modèle (contrôles positifs), le client d'un dossier du cabinet et l'anonyme rien ; le client ne le
--      règle ni ne l'écrit ; le catalogue — et trois mutations ; avant la migration `modele_de_plan_du_cabinet`, une ligne
--      « EN ATTENTE ».
--   6undecies. La COPIE DES FICHIERS SUR UN SUPPORT DU CABINET (INAL6, lignes 20.65 et 44 ; bloc CF, en fin de fichier) :
--      CF1 à CF3 — le chef et un membre de l'équipe lisent la copie (contrôles positifs), le client d'un dossier du cabinet
--      et l'anonyme rien ; le client ne l'enregistre, ne l'écrit ni ne l'atteste ; le catalogue — et trois mutations ; avant la migration
--      `copies_des_fichiers`, une ligne « EN ATTENTE ».
--   6duodecies. Les OPÉRATIONS D'INVENTAIRE (INV2, ligne 35 ; bloc IV, en fin de fichier) : IV1 à IV3 — le chef lit la
--      régularisation qu'il a enregistrée (contrôle positif), le client qui a un accès au dossier, un membre de l'équipe à
--      qui le dossier n'est pas assigné et l'anonyme rien ; le client n'enregistre rien et n'écrit rien en direct, le
--      super-administrateur réinsère (la porte de la restauration, contrôle positif) ; le catalogue — et trois mutations ;
--      avant la migration `operations_d_inventaire`, une ligne « EN ATTENTE ». Le reste (les refus sous leurs mots, la
--      recomposition, le gel, les gardes) : `operationsDInventaire.sql`, sur une réplique.
--   6terdecies. Les STOCKS DE CLÔTURE (LIA2, ligne 36 ; bloc ST, en fin de fichier) : ST1 à ST3 — le chef lit le stock
--      qu'il a enregistré (contrôle positif), le client du dossier et l'anonyme rien ; le client n'écrit rien, ni par la
--      fonction ni en direct ; le catalogue — et trois mutations ; avant la migration `stocks_de_cloture`, une ligne « EN
--      ATTENTE ». Le reste : `stocks.sql`, sur une réplique.
--   6quaterdecies. Les EXERCICES DÉCLARÉS D'UN DOSSIER (EXD2, ligne 42 ; bloc EX, en fin de fichier) : EX1 à EX3 — le chef
--      lit l'exercice qu'il a déclaré dans un dossier jetable en engagement (contrôle positif), le client qui y a un accès
--      rien, ni par la table ni par `bornes_de_l_exercice`, ni l'anonyme ; le client ne déclare rien, ni par la fonction ni
--      en direct, et ne réécrit rien ; le catalogue — et trois mutations ; avant la migration `exercices_du_dossier`, une
--      ligne « EN ATTENTE ». Le reste : `exercicesDuDossier.sql`, sur une réplique.
--   6quindecies. Les PROVISIONS (INV4, ligne 35 ; bloc PV, en fin de fichier) : PV1 à PV3 — le chef lit la provision
--      qu'il a enregistrée (contrôle positif), le client du dossier, un membre de l'équipe à qui le dossier n'est pas
--      assigné et l'anonyme rien ; le client n'écrit rien, ni par la fonction ni en direct (la garde, puis la RLS), le
--      super-administrateur réinsère (la restauration) ; le catalogue — et trois mutations ; avant la migration
--      `provisions`, une ligne « EN ATTENTE ». Le reste (les refus, l'évaluation par différence, la ventilation, le
--      gel) : `provisions.sql`, sur une réplique.
--   6sexdecies. L'AFFECTATION DU RÉSULTAT (AFF2, lignes 33 et 45 ; bloc AF, en fin de fichier) : AF1 à AF3 — le chef
--      lit la décision qu'il a enregistrée et sa répartition (contrôle positif), le client du dossier, un membre de l'équipe
--      à qui le dossier n'est pas assigné et l'anonyme rien ; le client n'enregistre rien et n'écrit rien en direct, le
--      super-administrateur réinsère (la porte de la restauration, contrôle positif) ; le catalogue — et trois mutations ;
--      avant la migration `affectation_du_resultat`, une ligne « EN ATTENTE ». Le reste : `affectationDuResultat.sql`.
--   6septdecies. L'INVENTAIRE DÉCLARÉ (INV3, ligne 35 ; bloc ID, en fin de fichier) : ID1 à ID3 — le chef lit la
--      déclaration qu'il a faite dans un dossier jetable en engagement (contrôle positif), le client qui y a un accès, un
--      membre de l'équipe à qui le dossier n'est pas assigné et l'anonyme rien ; le client ne déclare rien, n'écrit rien en
--      direct et ne réécrit rien, le super-administrateur réinsère (la porte de la restauration, contrôle positif) ; le
--      catalogue — et trois mutations ; avant la migration `validation_de_l_inventaire`, une ligne « EN ATTENTE ». Le reste
--      (les refus sous leurs mots, la garde, le gel, la validation qui l'attend) : `validationDeLInventaire.sql`.
--   7. Les droits qui ne passent pas par la RLS (bloc HR, migration `droits_hors_rls`) : anon, authenticated et PUBLIC ne
--      portent, sur aucune relation du schéma, aucune de ses colonnes ni dans aucun défaut d'un propriétaire, que le DML —
--      lu au catalogue, la boucle sur `pg_class` attrapant une table créée demain —, et un contrôle POSITIF : le DML
--      d'anon et d'authenticated intact, service_role et le propriétaire gardent tout.
--   8. La double authentification exigée (bloc DF, migration `deux_facteurs_exiges`) : chaque table de public — une table
--      créée demain comprise : la boucle part de `pg_class` — et storage.objects portent la policy restrictive
--      `deux_facteurs`, à l'expression exacte, et la pré-requête de PostgREST garde les fonctions que la RLS ne voit pas.
--      Sept mutations.
--   9. La numérotation qui continue (bloc NC, migration `numerotation_continue`, préparée) : les modèles de numéro et les
--      paroles du cabinet sur la suite reprise d'une série, au cabinet du dossier seul — le client, même avec un accès au
--      dossier, n'en lit rien et n'en écrit rien —, un contrôle POSITIF, le catalogue, trois mutations.
--  10. Le fichier d'une pièce figée, ou d'une source citée par la révision, ne se supprime plus du seau `pieces` (bloc PF,
--      migration `piece_figee_dans_le_stockage`, INAL1) : la policy de suppression resserrée, lue au catalogue, et son
--      prédicat jugé sous la session du chef, SANS suppression, sur un fichier figé et deux libres. Deux mutations. La
--      suppression elle-même se joue sur une réplique seulement (`pieceFigeeDansLeStockage.sql`).
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
--
-- 25/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (chantier EC-Q3, étape VF7a : migration
-- `frontiere_des_encaissements`, appliquée le 26/10/2026), qui ne crée ni ne change aucune policy, mais une garde aux
-- droits du propriétaire que les fonctions du client « Ventes » atteignent : le bloc FE (FE1 à FE5, M-FE1 à M-FE3) la
-- rejoue, sa raison jugée, et l'ordre des déclencheurs qui la tient hors de portée de l'anonyme. Joué ENTIER par psql
-- sur la réplique de l'étape (signature.sql : les neuf familles, et l'historique, égaux à la production à 148
-- migrations ; puis `registre_virement_mixte`, de l'étape VF5h2, et le journal semé) : sans la migration, 47 lignes de
-- verdict (la ligne FE « EN ATTENTE » de plus), 0 en faute, 43 mutations sur 43 qui mordent ; avec elle, 52 lignes,
-- 0 en faute, 46 mutations sur 46 — seules les lignes FE diffèrent. Appliquée sans que ce fichier soit rejoué en
-- production : HISTORIQUE.md, « LES CINQ MIGRATIONS DE VF5H2, VF7 ET VF8A EN PRODUCTION ».
--
-- 25/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (chantier EC-Q3, étape VF7b : migration
-- `validation_des_ventes_facturees`, appliquée le 26/10/2026), qui ne crée ni ne change aucune policy, mais deux fonctions
-- qui lisent tout un dossier aux droits de l'appelant, et une validation qui nomme désormais ce qu'un dossier basculé
-- porte : le bloc VB (VB1 à VB3, M-VB1, M-VB2) les rejoue — ni l'une ni l'autre ne s'exécute en RPC, et le client « Ventes »
-- et « Banque » reçoit le refus d'hier avant toute lecture. Joué ENTIER par psql sur la réplique de l'étape (la
-- production à 148 migrations, `registre_virement_mixte` et `frontiere_des_encaissements` appliquées comme l'outil
-- l'aurait fait, le journal semé) : sans la migration, 53 lignes de verdict (la ligne VB « EN ATTENTE » de plus), 0 en
-- faute, 46 mutations sur 46 qui mordent ; avec elle, 56 lignes, 0 en faute, 48 mutations sur 48 — seules les lignes VB
-- diffèrent. M-VB1 voit l'appel buter ensuite sur `frontiere_validation`, que l'API n'exécute pas non plus : une défense
-- de plus, pas celle que VB1 juge. Le passage en production suivra l'application et se notera ici.
--
-- 26/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (chantier EC-Q3, étape VF8e : migration
-- `simulation_des_ventes_facturees`, PRÉPARÉE, pas appliquée), qui ne crée ni ne change aucune policy, mais une
-- fonction de lecture `security definer` qui ouvre à l'accès client qui porte « Banque », d'un dossier basculé, le
-- total hors taxe de chaque mois de ses ventes facturées et les identifiants de ses factures et avoirs sources : le
-- bloc SI (SI1 à SI5, M-SI1 à M-SI3) la rejoue — le client « Banque » lit (le contrôle positif), « Ventes » seul puis
-- aucune case reçoivent « Accès refusé à ce dossier. » (42501), l'autre dossier et un compte rattaché à rien aussi,
-- l'anonyme n'exécute pas la fonction, le catalogue la dit `security definer` ; EN ATTENTE sans la migration. Joué
-- ENTIER par psql sur la réplique de l'étape (la production à 153 migrations, puis munie de
-- `insertion_des_encaissements`, le journal semé) : sans la migration, 57 lignes de verdict (la ligne SI « EN
-- ATTENTE »), 0 en faute, 48 mutations sur 48 qui mordent ; avec elle, 62 lignes, 0 en faute, 51 mutations sur 51 —
-- seules les lignes SI diffèrent. Le passage en production suivra l'application et se notera ici.
--
-- 26/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (23Q2Q2-Q3 : migration `equipe_par_son_role`, PRÉPARÉE, pas
-- appliquée), qui ne crée ni ne change aucune policy, mais retire à `authenticated` le droit UPDATE sur la table
-- `cabinet_admins` et ne le lui rend que sur la colonne `role` : le bloc EQ (EQ1 à EQ5, M-EQ1 à M-EQ5) le rejoue — le
-- chef change le rôle d'un membre de son équipe (le contrôle positif), mais ni le compte, ni le cabinet, ni l'adresse
-- (42501, sa raison exigée), il retire toujours un membre, l'anonyme ne change aucune ligne, et le catalogue le dit — ;
-- EN ATTENTE sans la migration. Joué ENTIER par psql sur la réplique de l'étape (la production à 154 migrations, ses
-- neuf familles égales à celles de la production, le journal semé) : sans la migration, 58 lignes de verdict (la ligne
-- EQ « EN ATTENTE »), 0 en faute, 48 mutations sur 48 qui mordent ; avec elle, 63 lignes, 0 en faute, 53 mutations sur
-- 53 — seules les lignes EQ diffèrent. Le passage en production suivra l'application et se notera ici.
--
-- 27/10/2026 — LA MIGRATION DE VF8E APPLIQUÉE EN PRODUCTION, `simulation_des_ventes_facturees` (`20261027055129`, après
-- `index_des_avoirs`, `20261027055007`, et avant `contre_passation_sur_mouvement_fige`, `20261027055337`) : 157
-- migrations. Ce fichier n'a pas été rejoué en production : aucune des trois ne crée ni ne change de policy ni de droit
-- d'une table. `simulationDesVentesFacturees.sql`, lui, y a été joué le même jour : ses 29 contrôles justes, rien n'est
-- resté — le client « Banque » et un membre affecté au dossier lisent, « Ventes » seul, aucune case, l'autre dossier,
-- un membre hors de ses dossiers, un compte rattaché à rien et le rôle des Edge Functions reçoivent « Accès refusé à ce
-- dossier. » (42501), l'anonyme n'exécute pas la fonction : ce que le bloc SI juge, profil par profil. Le bloc SI ne se
-- dit plus EN ATTENTE en production.
--
-- 27/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (chantier EC-Q3, étape VF8f : migration `ventes_sur_dossier_bascule`,
-- PRÉPARÉE, pas appliquée), qui ne crée ni ne change aucune policy, mais une garde `security definer` sur `memberships` :
-- « Ventes » ne se porte que sur un accès d'un dossier dont les factures sont la source de leurs ventes. Chaque bloc qui
-- coche « Ventes » bascule donc d'abord TOUS les dossiers du client — il en a deux en production —, dans sa
-- sous-transaction, par le propriétaire sans session (3ter, 4ter, M3ter, la banque du client, les ventes du client, le seau
-- des ventes ; FE et VB, qui basculaient le seul dossier du client APRÈS avoir coché la case ; SI, qui le basculait seul).
-- Et le bloc VS (VS1 à VS3, M-VS1, M-VS2) rejoue la garde : un compte que la policy refuse n'apprend pas si le dossier a
-- basculé, le cabinet reçoit sa raison, le catalogue la dit hors de portée en RPC ; EN ATTENTE sans la migration. Joué
-- ENTIER par psql sur la réplique de l'étape (la production à 157 migrations, ses neuf familles égales à celles de la
-- production, le journal semé ; avec un, puis deux accès du client) : sans la migration, 64 lignes de verdict (la ligne VS
-- « EN ATTENTE »), 0 en faute, 51 mutations sur 51 qui mordent ; avec elle, 67 lignes, 0 en faute, 53 mutations sur 53 —
-- seules les lignes VS diffèrent, et les autres sont celles du fichier d'avant sur la base d'avant, au caractère près. Le
-- fichier d'avant, sur la base munie de la migration, s'arrête à 3ter (23514). Le passage en production suivra
-- l'application et se notera ici.
--
-- 27/10/2026 — LES MIGRATIONS DE 23Q2Q2-Q3 ET DE VF8F APPLIQUÉES EN PRODUCTION, `equipe_par_son_role`
-- (`20261027163235`) puis `ventes_sur_dossier_bascule` (`20261027163348`) : 159 migrations, les neuf familles de
-- `signature.sql` égales à celles des répliques. Ce fichier n'y a pas été rejoué entier (près de 130 000 caractères
-- sans ses commentaires) : ses blocs EQ et VS l'ont été, d'un seul appel, les deux tables de résultats
-- `on commit drop`, une ligne TEXTE ajoutée, sans le contrôle EQ3 ni la mutation M-EQ2 — une suppression et un retrait
-- de droit, que l'outil retient faute de confirmation, et que la réplique a jugés. La base a reçu 17 864 caractères
-- (`62b73106489bc62b8967a7747bd376d6`) : 9 lignes de verdict, 0 en faute, 6 mutations sur 6 qui mordent, rien n'est
-- resté. Les blocs EQ et VS ne se disent plus EN ATTENTE en production. `droitsAcces.sql` y a été joué entier le même
-- jour (HISTORIQUE.md, « LES DEUX MIGRATIONS DE 23Q2Q2-Q3 ET VF8F EN PRODUCTION »).
--
-- 29/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (ligne 26.6, étape C1 : migration `caisse`, PRÉPARÉE, pas
-- appliquée), qui crée `operations_caisse` et ses deux policies (la lecture sous `admin_du_dossier`, l'insertion de
-- restauration sous `is_super_admin`) : la table entre dans la boucle des invariants 1, 2, 3 et 3ter, et le bloc CA
-- (CA1 à CA4, M-CA1 à M-CA3) pose une opération dans le dossier même du client — il ne la lit pas, ni son écriture, et
-- ne l'écrit ni par la fonction, ni en direct, ni sous le réglage d'une fonction ; le chef la lit (le contrôle
-- positif) — ; EN ATTENTE sans la migration. Joué ENTIER par psql sur la réplique de l'étape (la production à 159
-- migrations, ses neuf familles égales à celles de la production, le journal semé) : sans la migration, 73 lignes de
-- verdict (la ligne CA « EN ATTENTE »), 0 en faute, 58 mutations sur 58 qui mordent ; avec elle, 77 lignes, 0 en faute,
-- 61 mutations sur 61 — seules les lignes CA diffèrent, et les quatre boucles comptent une table de plus. Le passage en
-- production suivra l'application.
--
-- 29/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (ligne 26.6, étape C1b : migration `caisse_retrait_et_versement`,
-- PRÉPARÉE, à coller, après `caisse`), qui ne crée ni ne change aucune policy, mais deux fonctions aux droits du
-- propriétaire qui écrivent la caisse : le bloc CR (CR1 à CR3, M-CR1 et M-CR2) — le client ne retire ni ne remplace une
-- opération de la caisse de son dossier, et elle reste entière ; l'anonyme n'exécute aucune des deux ; le catalogue ; le
-- chef retire et remplace (le contrôle positif) — ; EN ATTENTE sans la migration.
--
-- 30/10/2026 — LES DEUX MIGRATIONS DE LA CAISSE APPLIQUÉES EN PRODUCTION, `caisse` (`20261030073812`, par l'outil) puis
-- `caisse_retrait_et_versement` (`20261030123801`, collée par le cabinet) : 163 migrations, les neuf familles de
-- `signature.sql` égales à celles de la réplique du jour, où ce fichier a été joué ENTIER : 81 lignes de verdict, 0 en
-- faute, 63 mutations sur 63 qui mordent, aucune EN ATTENTE. En production, ses blocs CA et CR l'ont été, d'un seul
-- appel, les deux tables de résultats `on commit drop`, une ligne TEXTE ajoutée. La base a reçu 19 424 caractères
-- (`b68e6aa362092f10d7014470ef64110b`) : 9 lignes de verdict, 0 en faute, 5 mutations sur 5 qui mordent, rien n'est
-- resté. Les blocs CA et CR ne se disent plus EN ATTENTE en production (HISTORIQUE.md, « LA CAISSE EN PRODUCTION : LES
-- DEUX MIGRATIONS ET LE DRAPEAU LEVÉ »).
--
-- 31/10/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (ligne 26.6, étape C8 : migration `paiement_par_la_caisse`,
-- PRÉPARÉE, pas appliquée), qui ne crée ni ne change aucune policy, mais une fonction aux droits du propriétaire qui
-- écrit la caisse (`regler_piece_par_la_caisse`) et trois gardes aux droits du propriétaire, dont celle du brouillon, qui
-- admet désormais la contrepartie d'un paiement écrite sous la RLS : le bloc CP (CP1 à CP3, M-CP1 et M-CP2) — le client
-- ne règle pas une pièce de son dossier par la caisse, n'écrit pas la contrepartie du paiement du chef, ne lit ni l'un ni
-- l'autre ; l'anonyme n'exécute pas la fonction ; le catalogue ; le chef règle et écrit la contrepartie (le contrôle
-- positif) — ; EN ATTENTE sans la migration.
--
-- 01/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (ligne 26.6, étape C10 : migration `caisse_du_client`, PRÉPARÉE, pas
-- appliquée, après les trois du jour de C8), qui pose une troisième case de l'accès client (`droit_caisse`) et une policy
-- PERMISSIVE de plus sur `operations_caisse`, la lecture du client qui la porte (`client_du_dossier(dossier_id,
-- 'caisse')`) : le bloc CC (CC1 à CC4, M-CC1 à M-CC3) — le profil « client portant Caisse », le dossier du client passé
-- exonéré le temps d'une sous-transaction : la boucle de l'invariant 3 sous lui ; il lit toute la caisse de son dossier,
-- rien du brouillon, rien d'un dossier où son accès ne porte pas la case ; il écrit par la fonction seule ; l'anonyme
-- n'exécute pas `caisse_du_client` — ; CA4 compte alors trois policies ; EN ATTENTE sans la migration.
--
-- 02/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (la correction de la facture, reprise pour FACTURE-Q1 : migration
-- `facture_dates_centimes_mention_tva`, PRÉPARÉE dans supabase/preparees/, pas appliquée), qui ne crée ni ne change
-- aucune policy, mais refuse à la validation, pour tout auteur, une facture sans sa mention de TVA, datée à venir ou
-- d'avant la plus récente de sa série — et, à un accès « Ventes » seulement, celle d'un dossier au statut de TVA à
-- préciser ou exonéré sans article : M5ter numérote une facture de 1999 (une année passée qu'aucun dossier ne facture ;
-- 2099 serait à venir), et les blocs du droit « Ventes », FE, VB et SI posent le dossier du client en franchise le temps
-- du bloc, quel que soit son statut, leurs factures portant la mention de l'art. 293 B. Joué ENTIER par psql sur la
-- réplique de l'étape (la production du jour, 168 migrations, ses neuf familles égales à celles de la production, le
-- journal semé), sans puis avec la migration : 90 invariants, 0 en faute, 68 mutations sur 68 qui mordent, les devis EN
-- ATTENTE — les deux sorties égales, et égales à celle du texte d'avant hors de la ligne M5ter. Le passage en production
-- suivra l'application (HISTORIQUE.md, « LA FACTURE : LA DATE DANS L'ORDRE DE SA SÉRIE, LE DEMI-CENTIME ET LA MENTION DE
-- TVA, REPRISE POUR FACTURE-Q1 (PRÉPARÉE, PAS APPLIQUÉE) »).
--
-- 04/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (C12B-Q1 : migration `correction_du_paiement_par_la_caisse`,
-- PRÉPARÉE, pas appliquée), qui ne crée ni ne change aucune policy, mais une fonction aux droits du propriétaire qui écrit
-- la caisse (`remplacer_paiement_par_la_caisse`, la correction d'un paiement d'un seul geste) : le bloc CQ (CQ1 à CQ3,
-- M-CQ1 et M-CQ2) — le client ne corrige pas le paiement du chef, sans la case « Caisse » comme en la portant, et corrige
-- le sien en la portant (le contrôle positif : l'ancien retiré, le nouveau le désigne, à lui) ; l'anonyme n'exécute pas la
-- fonction ; le catalogue — ; EN ATTENTE sans la migration. Joué ENTIER par psql sur la réplique de l'étape (la
-- production du jour, 170 migrations, ses neuf familles égales à celles de la production, le journal semé), par le
-- super-utilisateur : sans la migration, 91 lignes de verdict (la ligne CQ « EN ATTENTE » de plus), 0 en faute, 68
-- mutations sur 68 qui mordent ; avec elle, 94 lignes, 0 en faute, 70 mutations sur 70 — seules les lignes CQ diffèrent
-- (HISTORIQUE.md, « LA CAISSE : CORRIGER UN PAIEMENT EN ESPÈCES D'UN SEUL GESTE (C12B-Q1) (PRÉPARÉE, PAS APPLIQUÉE) »).
--
-- 04/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (P6c1 : migration `envoi_des_devis`, PRÉPARÉE, pas appliquée), qui ne
-- crée ni ne change aucune policy, mais admet le type « devis » au journal des envois, et sa colonne `devis_id` — la
-- lecture du client « Ventes » (`emails_envoyes_lecture_ventes`) attendait déjà ces lignes. Le bloc 3bis y pose, la
-- migration en base, l'envoi du devis de son jeu (la ligne que `send-email` écrira, sous la clé de service), et dit ce que
-- le client en lit — rien sans droit ni avec « Banque » seul, la ligne avec « Ventes », le contrôle positif —, avec sa
-- mutation (M3bis-devis : le droit retiré au profil) ; EN ATTENTE sans la migration. Joué ENTIER par psql, par le
-- super-utilisateur, sur la réplique des devis (la production à 171 migrations, plus les deux des devis) : sans la
-- migration, 94 lignes de verdict (la ligne « EN ATTENTE » de plus), 0 en faute, 72 mutations sur 72 qui mordent ; avec
-- elle, 94 lignes, 0 en faute, 73 sur 73 ; la lecture du client resserrée aux factures y met deux lignes en faute
-- (HISTORIQUE.md, « LES DEVIS : L'ENVOI PAR E-MAIL, EN BASE (P6C1) (PRÉPARÉE, PAS APPLIQUÉE) »).
--
-- 05/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (P1-trace : migration `trace_des_droits`, PRÉPARÉE, pas appliquée), qui
-- crée `trace_des_droits` — la lecture du cabinet du dossier, l'insertion de restauration du super-administrateur, aucune
-- autre policy, aucune branche client — et son déclencheur sur `memberships`. Le bloc TD (TD1 à TD3, M-TD1, M-TD2) ; EN
-- ATTENTE sans la migration ; la boucle des invariants y voit la table de plus. Ce qu'il rend : HISTORIQUE.md, « LA TRACE
-- DES DROITS D'UN ACCÈS, EN BASE (P1-TRACE) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- 06/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (C4a : migration `situations_publiees`, PRÉPARÉE, pas appliquée), qui
-- crée `situations_publiees` — la lecture du cabinet du dossier, celle d'un accès « Comptes » (la situation EN COURS de son
-- dossier seule), l'insertion de restauration du super-administrateur — et la case `memberships.droit_comptes`. Le bloc SP
-- (SP1 à SP3, M-SP1, M-SP2) ; EN ATTENTE sans la migration ; la boucle des invariants y voit la table de plus. Ce qu'il
-- rend : HISTORIQUE.md, « LES SITUATIONS PUBLIÉES, EN BASE (C4A) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- 07/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (B1 : migration `trois_cases_de_l_acces`, PRÉPARÉE, pas appliquée, après
-- P1-trace et C4a), qui pose trois cases de l'accès client — « Achats », « Notes de frais », « Documents » — qu'aucune
-- policy ne lit encore. Le bloc TC (TC1 à TC3, M-TC1, M-TC2) ; EN ATTENTE sans la migration. Ce qu'il rend : HISTORIQUE.md,
-- « TROIS CASES DE PLUS : « ACHATS », « NOTES DE FRAIS », « DOCUMENTS » (B1, LIGNE 51.5) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- 06/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (relecture de sécurité : migration `droits_hors_rls`, PRÉPARÉE, pas
-- appliquée), qui retire à anon et à authenticated les quatre droits d'une table que la RLS ne garde pas, sur toutes les
-- relations de public et dans le défaut du propriétaire. Le bloc HR (HR1 à HR5, M-HR1 à M-HR6) ne lit que le catalogue et
-- ne pose que des GRANT annulés ; EN ATTENTE tant que l'historique ne porte pas la migration et que l'état est celui
-- d'avant. Joué ENTIER, en une transaction, sur la réplique PostgreSQL 17 égale à la production : sans la migration, 97
-- lignes d'invariants, 0 en faute, 73 mutations sur 73, HR EN ATTENTE ; avec elle, 104 lignes, 0 en faute, 79 sur 79 ;
-- après son retour, de nouveau EN ATTENTE. La preuve par le geste, sur une réplique seulement : `droitsHorsRls.sql`. Ce
-- qu'il rend : HISTORIQUE.md, « LES DROITS QUE LA RLS NE GARDE PAS ».
--
-- 07/11/2026 — EN PRODUCTION, LE BLOC HR SEUL, après `droits_hors_rls` (collée par le cabinet, version 20261107122909),
-- qui ne touche que des droits — ni policy, ni table, ni fonction : le reste du fichier, rejoué entier la veille sur la
-- réplique migrée (dont le relevé des droits et la signature sont ceux de la production), ne peut pas en changer. Le
-- texte transmis, le bloc tel qu'il est ici, exécuté depuis une table d'un seul tenant, rend sa longueur et son
-- empreinte (18 946 caractères, f5c5bed8f977ae99fdc09a6319a2a0c9) ; les deux tables de résultats `on commit drop`. HR
-- jugé : huit lignes d'invariants, 0 en faute, six mutations sur six qui mordent, sous postgres.
--
-- 11/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (A8d2c, ligne 51.5 : migration `originaux_des_imports`, A8d2a,
-- PRÉPARÉE, pas appliquée), qui réserve la lecture de `<dossier>/imports/` du seau `ventes` au cabinet du dossier et y
-- ouvre le dépôt d'un original sous la forme exacte du chemin. Le bloc OI (OI1 à OI7, M-OI1 à M-OI6) ; EN ATTENTE sans la
-- migration. Joué ENTIER, en une transaction, sur une copie de la réplique d'A8d2a : avec la migration, 142 lignes
-- d'invariants, 0 en faute, 103 mutations sur 103 ; les deux policies rendues à la forme large (le sous-arbre lu et déposé
-- sous `gere_les_ventes`), OI3, OI4, OI5 et les deux OI7 en faute ; après son retour, 133 lignes, 0 en faute, 97 sur 97,
-- OI EN ATTENTE. Ce qu'il rend : HISTORIQUE.md, « A8D2C ».
--
-- 11/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (LM1, ligne 47 : migration `dossier_du_cabinet`, PRÉPARÉE, pas
-- appliquée), qui fait désigner par le chef le dossier du cabinet et y refuse tout accès client. Le bloc DC (DC1 à DC7,
-- M-DC2, M-DC6, M-DC7) ; EN ATTENTE sans la migration. Ce qu'il rend : HISTORIQUE.md, « 11/11/2026 — LM1 ».
--
-- 11/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (A8C-Q1 et A8Q5-Q2, ligne 51.5 : migration `reprises_au_client`,
-- PRÉPARÉE, pas appliquée), qui ne crée ni ne change aucune policy, mais deux fonctions de lecture `security definer` : ce
-- que l'encaissement d'une facture reprise demande, au cabinet et à l'accès « Ventes » ; les pièces citées par une facture
-- reprise, au cabinet et à l'accès « Banque ». Le bloc RC (RC1 à RC5, M-RC1 à M-RC3) ; EN ATTENTE sans la migration. Ce
-- qu'il rend : HISTORIQUE.md, « A8C-Q1 ET A8Q5-Q2 : LES FACTURES REPRISES, AU CLIENT ».
--
-- 11/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (LM4, ligne 47 : migration `lettres_de_mission`, PRÉPARÉE, pas
-- appliquée, après LM1), qui range les modèles et les lettres de mission dans le dossier du cabinet. Le bloc LM (LM1 à LM7,
-- M-LM2, M-LM5, M-LM7) ; EN ATTENTE sans la migration. Ce qu'il rend : HISTORIQUE.md, « 11/11/2026 — LM4 ».
--
-- 11/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (LM7, ligne 47 : migration `honoraires_factures`, PRÉPARÉE, pas
-- appliquée, après LM1 et LM4), qui lie une facture du dossier du cabinet à la période d'honoraires qu'elle facture. Le
-- bloc HF (HF1 à HF7, M-HF2, M-HF5, M-HF7) ; EN ATTENTE sans la migration. Ce qu'il rend : HISTORIQUE.md, « 11/11/2026 —
-- LM7 ».
--
-- 11/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (LM8, ligne 47 : migration `depot_des_honoraires`, PRÉPARÉE, pas
-- appliquée, après LM1, LM4 et LM7), qui dépose la facture d'honoraires validée dans le dossier de son client. Le bloc HD
-- (HD1 à HD7, M-HD2, M-HD5, M-HD7) ; EN ATTENTE sans la migration. Ce qu'il rend : HISTORIQUE.md, « 11/11/2026 — LM8 ».
--
-- 11/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (LM3, ligne 47 : migration `fiche_liee_au_dossier_du_client`, PRÉPARÉE,
-- pas appliquée, après LM1), qui lie une fiche du dossier du cabinet au dossier de son client, et la délie (LM3-Q1 (B)).
-- Le bloc FL (FL1 à FL7, M-FL2, M-FL3, M-FL6, M-FL7) ; EN ATTENTE sans la migration. Ce qu'il rend : HISTORIQUE.md, « 11/11/2026 — LM3 ».
--
-- 11/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (LM5-Q2, ligne 47 : migration `missions_du_client`, PRÉPARÉE, pas
-- appliquée, après LM1 et LM4), qui ne crée ni ne change aucune policy, mais une fonction de lecture `security definer` :
-- les lettres d'un client, brouillons compris (LM5Q2-Q1 (B)), sans leurs honoraires, à qui lit son dossier au titre du
-- cabinet. Le bloc MV (MV1 à MV7, M-MV3, M-MV5, M-MV6) ; EN ATTENTE sans la migration. Ce qu'il rend : HISTORIQUE.md,
-- « LM5-Q2 », puis « LM5Q2-Q1 ET LM7-Q4 ».
--
-- 12/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (LM6, ligne 47 : migration `lettres_du_client`, PRÉPARÉE, pas
-- appliquée, après LM1, B1 et LM4), qui ne crée ni ne change aucune policy, mais une fonction de lecture `security definer` :
-- les lettres PROPOSÉES d'un client, figées, à l'accès client de son dossier qui porte la case « Documents ». Le bloc LC
-- (LC1 à LC7, M-LC3, M-LC5, M-LC6) ; EN ATTENTE sans la migration. Ce qu'il rend : HISTORIQUE.md, « 12/11/2026 — LM6 ».
--
-- 11/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (P1T-E2, ligne 51.5 : migration `adresse_des_acces_retires`, PRÉPARÉE,
-- pas appliquée), qui garde l'adresse d'un accès retiré que la trace nomme — la lecture du cabinet du dossier, l'insertion
-- de restauration du super-administrateur, aucune branche client — et son déclencheur sur `memberships`. Le bloc AR (AR1 à
-- AR3, M-AR1, M-AR2) ; EN ATTENTE sans la migration ; la boucle des invariants y voit la table de plus. Ce qu'il rend :
-- HISTORIQUE.md, « 11/11/2026 — P1T-E2 ».
--
-- 11/11/2026 — SUR UNE RÉPLIQUE, PAS EN PRODUCTION (A8D2A-Q1, ligne 51.5 : migration `originaux_retenus_par_leur_import`,
-- PRÉPARÉE, pas appliquée), qui refuse la suppression de l'original d'un import qui existe et rend au chef du cabinet
-- d'un dossier supprimé les originaux que ce dossier retenait. Le bloc OR (OR1 à OR4, M-OR1 à M-OR3) ; EN ATTENTE sans la
-- migration ; OI7 admet le cas `imports/` de la lecture suivi de la libération. Joué ENTIER, en une transaction, sur une
-- copie de la réplique égale à la production (197 migrations) : sans la migration, 145 lignes d'invariants, 0 en faute,
-- 103 mutations sur 103, OR EN ATTENTE ; avec, 150 lignes, 0 en faute, 106 sur 106. Ce qu'il rend : HISTORIQUE.md,
-- « 11/11/2026 — A8D2A-Q1 ».
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
    -- « Ventes » ne se porte que sur un accès d'un dossier basculé (garder_droit_ventes, étape VF8f) : les dossiers du
    -- client basculent d'abord, par le propriétaire sans session, le temps de la sous-transaction.
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true
     where id in (select m.dossier_id from memberships m where m.user_id = client) and not ventes_par_les_factures;
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
      -- « Ventes » ne se porte que sur un accès d'un dossier basculé (garder_droit_ventes, étape VF8f) : les dossiers
      -- du client basculent d'abord, par le propriétaire sans session, le temps de la sous-transaction.
      perform set_config('request.jwt.claims', '', true);
      update dossiers set ventes_par_les_factures = true
       where id in (select m.dossier_id from memberships m where m.user_id = client) and not ventes_par_les_factures;
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
  -- L'écart du compteur, non plus le plus grand numéro de la base, qui serait celui d'un dossier réel (audit du 29/10/2026).
  insert into rls_verdict values ('5bis. le compteur n''a pas bougé', 'facture_numerotation',
    'compteur ' || to_char(numero_apres - numero_avant, 'FMSG9999999990'), numero_avant = numero_apres);
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
-- que la fuite trouvée sur `categories` : ce qui protège est le prédicat, pas le rôle. (INAL1, la migration
-- `piece_figee_dans_le_stockage`, passe `pieces_storage_delete` à `authenticated` en la resserrant : le bloc PF la lit.)

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
  -- Qu'il y en a, pas combien : sous le chef, qui voit tout, le nombre dirait ce que porte un dossier réel (audit du 29/10/2026).
  insert into rls_mutation values ('M1 — contrôle 1 joué sous le chef', 'des tables en faute', case when en_faute > 0 then 'au moins une table' else 'aucune table' end, en_faute > 0);

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
  -- Qu'il y en a, pas combien : sous le chef, qui voit tout, le nombre dirait ce que porte un dossier réel (audit du 29/10/2026).
  insert into rls_mutation values ('M3 — contrôle 3 joué sous le chef', 'des tables en faute', case when en_faute > 0 then 'au moins une table' else 'aucune table' end, en_faute > 0);

  -- M3ter : le contrôle 3ter joué sous le chef — les droits posés de même, puis la boucle sous un profil qui voit tout le
  -- cabinet. Elle doit trouver des tables en faute : sinon, sous ce profil-là non plus, elle ne regarderait rien.
  en_faute := 0;
  begin
    -- « Ventes » ne se porte que sur un accès d'un dossier basculé (garder_droit_ventes, étape VF8f) : les dossiers du
    -- client basculent d'abord, par le propriétaire sans session, le temps de la sous-transaction.
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true
     where id in (select m.dossier_id from memberships m where m.user_id = client) and not ventes_par_les_factures;
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
  -- Qu'il y en a, pas combien : sous le chef, qui voit tout, le nombre dirait ce que porte un dossier réel (audit du 29/10/2026).
  insert into rls_mutation values ('M3ter — contrôle 3ter joué sous le chef', 'des tables en faute', case when en_faute > 0 then 'au moins une table' else 'aucune table' end, en_faute > 0);

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
  -- L'écart du compteur, non plus le plus grand numéro de la base, qui serait celui d'un dossier réel (audit du 29/10/2026).
  insert into rls_mutation values ('M5bis — l''annulation efface la consommation et le droit', '0 ligne 2099, compteur inchangé, 0 droit',
    restes || ' ligne(s) 2099, compteur ' || to_char(numero_apres - numero_avant, 'FMSG9999999990') || ', ' || n || ' droit(s)',
    restes = 0 and numero_avant = numero_apres and n = 0);

  -- M5ter : le contrôle POSITIF. Sans lui, les refus de 5 et 5bis seraient satisfaits par une
  -- numérotation que plus personne n'atteint — la facturation à l'arrêt. Le chef numérote par le seul
  -- chemin qui reste, `enregistrer_facture`, une facture d'une année fictive, annulée aussitôt : 1999, une année
  -- passée qu'aucun dossier ne facture — depuis la correction de la facture (31/10/2026), une date à venir ne se valide
  -- plus, ni sans sa mention une facture d'un dossier en franchise ou exonéré, si bien que le dossier du client passe en
  -- franchise le temps de la sous-transaction, quel que soit son statut, et que la facture porte sa mention.
  select coalesce(max(dernier_numero), -1) into numero_avant from facture_numerotation;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
  accepte := false; motif := null; raison := null;
  begin
    update dossiers set statut_tva = 'franchise', article_exoneration = null where id = dossier_du_client;
    select f.numero into raison from enregistrer_facture(dossier_du_client, null,
      '{"tiers_nom":"ESSAI RLS","date_emission":"1999-01-15","mentions_legales":"TVA non applicable, art. 293 B du CGI.","montant_ht":1,"montant_tva":0,"montant_ttc":1}'::jsonb,
      '[{"designation":"essai","quantite":1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, true) as f;
    -- Depuis la numérotation qui continue (A9a, préparée ; son témoin : `modeles_numerotation`), le chef numérote dans la
    -- série de son mandataire, M (MEG1-Q5) ; avant elle, dans la série unique, F.
    accepte := raison like case when to_regclass('public.modeles_numerotation') is null then 'F1999-%' else 'M1999-%' end;
    raise exception 'ANNULATION_ESSAI';
  exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate; end;
  reset role;
  select coalesce(max(dernier_numero), -1) into numero_apres from facture_numerotation;
  select count(*) into restes from facture_numerotation where annee = 1999;
  -- L'écart du compteur, non plus le plus grand numéro de la base, qui serait celui d'un dossier réel (audit du 29/10/2026).
  insert into rls_mutation values ('M5ter — le chef numérote par enregistrer_facture', 'ACCEPTÉ',
    case when accepte then 'ACCEPTÉ ' || raison else 'refusé par ' || coalesce(motif,'?') end
    || ', ' || restes || ' ligne(s) 1999, compteur ' || to_char(numero_apres - numero_avant, 'FMSG9999999990'),
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
  -- Qu'il y en a, pas combien : sous le chef, qui voit tout, le nombre dirait ce que porte un dossier réel (audit du 29/10/2026).
  insert into rls_mutation values ('MS1 — S1 joué sous le chef', 'des fichiers visibles', case when n > 0 then 'au moins un fichier' else 'aucun fichier' end, n > 0);

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
  -- Qu'il y en a, pas combien : sous le chef, qui voit tout, le nombre dirait ce que porte un dossier réel (audit du 29/10/2026).
  insert into rls_mutation values ('MS3 — S3 joué sous le chef', 'des fichiers hors de ses dossiers', case when hors > 0 then 'au moins un fichier' else 'aucun fichier' end, hors > 0);

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
--   4bis   avec la case, il n'écrit directement dans aucune des six (sept avec les comptes bancaires d'un dossier, MCB1, dès
--          leur migration) : l'insertion refusée en 42501, la mise à jour sans ligne touchée ;
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
  -- Les comptes bancaires d'un dossier (ligne 26.6, MCB1 ; migration `comptes_bancaires`, PRÉPARÉE) : le client « Banque »
  -- les lit tous (MCB-Q8), dès que la migration est en base — avant, la table n'existe pas et rien ne l'attend.
  banque_attendues text[] := array['controles_releves_bancaires', 'justificatifs_proposes', 'lignes_bancaires',
                                   'precisions_mouvements', 'reglements_groupes', 'ventilations_bancaires']
    || case when to_regclass('public.comptes_bancaires') is not null then array['comptes_bancaires'] else '{}'::text[] end;
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

    -- « Ventes » ne se porte que sur un accès d'un dossier basculé (garder_droit_ventes, étape VF8f) : les dossiers du
    -- client basculent, le jeu posé, par le propriétaire sans session, le temps de la sous-transaction.
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true
     where id in (select m.dossier_id from memberships m where m.user_id = client) and not ventes_par_les_factures;

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
    -- Un second compte bancaire du dossier (MCB1), dès que sa migration est en base : la dernière écriture, chacune se jouant
    -- dans sa sous-transaction, annulée.
    if to_regclass('public.comptes_bancaires') is not null then
      ecritures := ecritures || format('insert into comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis) values (%L, %L, %L, %L)',
        dossier_du_client, 'essai 4bis', '512901', '2026-01-01');
    end if;
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
-- Le jeu d'essai naît dans le dossier du client, dans un bloc qui s'annule : une facture validée de l'année fictive 1999
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
  -- L'envoi d'un devis (étape P6c1) : sa migration en base, les lignes « devis » que le client lit sous chaque réglage, et
  -- combien ses dossiers en portent.
  envoi_en_base boolean; devis_lus jsonb := '{}'::jsonb; envois_de_devis bigint;
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
  -- L'envoi d'un devis (étape P6c1), dès que sa migration est en base ; avant, une ligne le dit.
  envoi_en_base := exists (select 1 from pg_attribute where attrelid = 'public.emails_envoyes'::regclass
                            and attname = 'devis_id' and not attisdropped);
  if not envoi_en_base then
    insert into rls_verdict values ('3bis. l''envoi d''un devis : EN ATTENTE de la migration envoi_des_devis',
      'emails_envoyes.devis_id', 'absente : la lecture d''une ligne « devis » se juge dès que la migration y est', true);
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
    -- Le dossier du client en franchise le temps du bloc, quel que soit son statut, et une facture de 1999 qui porte sa
    -- mention : depuis la correction de la facture (31/10/2026), ni une date à venir (l'année fictive d'hier, 2099) ni,
    -- sans sa mention, une facture d'un dossier en franchise ou exonéré ne se valident.
    update dossiers set statut_tva = 'franchise', article_exoneration = null where id = dossier_du_client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select e.facture_id into f_validee from enregistrer_facture(dossier_du_client, null,
      '{"tiers_nom":"ESSAI RLS","date_emission":"1999-01-15","mentions_legales":"TVA non applicable, art. 293 B du CGI.","montant_ht":100,"montant_tva":20,"montant_ttc":120,"type_client":"assujetti","tiers_adresse":"Adresse fictive du client","nature_operation":"services"}'::jsonb,
      '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true) e;
    select e.facture_id into f_brouillon from enregistrer_facture(dossier_du_client, null,
      '{"tiers_nom":"ESSAI RLS","date_emission":"1999-01-16","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb,
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
      -- L'envoi de ce devis (étape P6c1), dès que sa migration est en base : la ligne que `send-email` écrit après
      -- l'envoi, sous la clé de service.
      if envoi_en_base then
        execute format('insert into emails_envoyes (dossier_id, type, destinataire, objet, devis_id) values (%L, %L, %L, %L, %L)',
          dossier_du_client, 'devis', 'essai-rls@exemple.invalid', 'essai rls', dv);
      end if;
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
    -- « Ventes » ne se porte que sur un accès d'un dossier basculé (garder_droit_ventes, étape VF8f) : les dossiers du
    -- client basculent, le jeu posé — ses factures, validées avant, restent comptées par leurs pièces —, par le
    -- propriétaire sans session, le temps de la sous-transaction.
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true
     where id in (select m.dossier_id from memberships m where m.user_id = client) and not ventes_par_les_factures;

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
      -- L'envoi d'un devis (étape P6c1) : les lignes « devis » que le client lit sous ce réglage.
      if envoi_en_base then
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        select count(*) into vus from emails_envoyes where type = 'devis';
        reset role;
        devis_lus := devis_lus || jsonb_build_object(reglage, vus);
      end if;
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
    select count(*) into envois_de_devis from emails_envoyes
     where type = 'devis' and dossier_id in (select m.dossier_id from memberships m where m.user_id = client);

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
  if envoi_en_base then
    verdicts := verdicts || jsonb_build_object('controle', '3bis. l''envoi d''un devis : lu avec le droit « Ventes », jamais sans (étape P6c1)',
      'cible', 'emails_envoyes (devis)', 'observe', 'aucun droit : ' || coalesce(devis_lus ->> 'aucun', '?') || ', « Banque » seul : '
        || coalesce(devis_lus ->> 'banque', '?') || ', « Ventes » : ' || coalesce(devis_lus ->> 'ventes', '?') || ' vue(s) sur '
        || coalesce(envois_de_devis::text, '?') || ' en base',
      'ok', coalesce((devis_lus ->> 'aucun')::bigint = 0 and (devis_lus ->> 'banque')::bigint = 0
        and (devis_lus ->> 'ventes')::bigint = envois_de_devis and envois_de_devis > 0, false));
  end if;

  -- M3bis : le contrôle positif, le droit retiré au profil — ce que le client voit sans droit ne fait pas le compte.
  mauvais := null;
  foreach t in array a_lire loop
    if coalesce((lus -> t ->> 'aucun')::bigint = (lus -> t ->> 'attendus')::bigint and (lus -> t ->> 'attendus')::bigint > 0, false) then
      mauvais := coalesce(mauvais || ', ', '') || t;
    end if;
  end loop;
  mutations := mutations || jsonb_build_object('mutation', 'M3bis — le contrôle positif de 3bis, le droit retiré au profil',
    'attendu', 'aucune table où le compte tombe juste', 'observe', coalesce('juste sur : ' || mauvais, 'aucune'), 'mord', mauvais is null);
  -- M3bis-devis : le contrôle de l'envoi d'un devis, le droit retiré au profil — sans « Ventes », le compte ne tombe pas
  -- juste (étape P6c1).
  if envoi_en_base then
    mutations := mutations || jsonb_build_object('mutation', 'M3bis-devis — le contrôle de l''envoi d''un devis, le droit retiré au profil',
      'attendu', 'la ligne « devis » non vue', 'observe', coalesce(devis_lus ->> 'aucun', '?') || ' vue(s) sur ' || coalesce(envois_de_devis::text, '?'),
      'mord', not coalesce((devis_lus ->> 'aucun')::bigint = envois_de_devis and envois_de_devis > 0, false));
  end if;

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
    -- « Ventes » ne se porte que sur un accès d'un dossier basculé (garder_droit_ventes, étape VF8f) : les dossiers du
    -- client basculent, par le propriétaire sans session, le temps de la sous-transaction.
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true
     where id in (select m.dossier_id from memberships m where m.user_id = client) and not ventes_par_les_factures;

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
  -- Une policy RESTRICTIVE n'ouvre rien (la double authentification, bloc DF) : seules les permissives atteignent le seau.
  select count(*) into n from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polcmd in ('w', '*') and p.polpermissive
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

-- ═══ Les originaux des factures reprises dans le seau des ventes (A8d2a, ligne 51.5) ═════════════════════════════════
--
-- La migration `originaux_des_imports` range l'ORIGINAL d'une facture reprise de l'ancien logiciel sous
-- `<dossier>/imports/<lot>/<empreinte>.<pdf|xml|csv>` du seau `ventes`. Elle RESSERRE la lecture de ce sous-arbre au cabinet
-- du dossier (`ventes_lecture`, `admin_du_dossier`) — le client « Ventes », qui lit le logo de son dossier, n'y lit rien —
-- et ouvre le dépôt d'un original au cabinet du dossier seul, sous la forme EXACTE du chemin (`ventes_depot_d_un_original`).
-- Les questions, aux quatre profils : l'anonyme et un compte rattaché à rien ne voient aucun original (OI1, OI2) ; le client
-- qui porte « Ventes » et « Banque » ne voit aucun original, même de son dossier, et voit toujours le logo de son dossier —
-- le reste du seau comme hier (OI3, son contrôle POSITIF) ; le chef du cabinet voit les originaux des dossiers de son
-- cabinet (OI3bis) ; ni le client, même sous la forme exacte et dans son dossier, ni un inconnu ne déposent un original
-- (OI4) ; le cabinet ne dépose que sous la forme exacte — ni une autre extension, ni un nom qui n'est pas une empreinte, ni
-- hors d'un lot, ni en majuscules, ni un segment de plus (OI5) ; personne ne modifie un original (OI6) ; au catalogue, la
-- policy de dépôt est permissive, d'insertion, `to authenticated`, sur `admin_du_dossier`, et la lecture garde son cas
-- `imports/` (OI7). Le jeu : deux originaux et un logo rangés par le propriétaire, dans une sous-transaction annulée.
-- Six mutations, qui doivent mordre. EN ATTENTE tant que ni la policy de dépôt ni le cas `imports/` de la lecture ne
-- sont en base ; l'un sans l'autre est un état partiel, que OI7 dit en faute. Ce que la migration refuse et accepte de
-- plus (les bornes du seau, la fonction des paramètres) est éprouvé par `originauxDesImports.sql`.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  dossier_du_client text := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  autre_dossier     text := '001c7ed7-c23b-4590-901e-693489f8af24';
  lot text := '5b0f3c1e-8a2d-4c6b-9e7f-1a2b3c4d5e6f';
  original_sien  text := 'ac538d93-7da3-4403-bca6-2d7836810a6f/imports/5b0f3c1e-8a2d-4c6b-9e7f-1a2b3c4d5e6f/' || repeat('a', 64) || '.pdf';
  original_autre text := '001c7ed7-c23b-4590-901e-693489f8af24/imports/5b0f3c1e-8a2d-4c6b-9e7f-1a2b3c4d5e6f/' || repeat('b', 64) || '.xml';
  logo_sien      text := 'ac538d93-7da3-4403-bca6-2d7836810a6f/logos/' || repeat('c', 64) || '.png';
  depot_exact    text := 'ac538d93-7da3-4403-bca6-2d7836810a6f/imports/5b0f3c1e-8a2d-4c6b-9e7f-1a2b3c4d5e6f/' || repeat('d', 64) || '.csv';
  formes text[];
  forme text;
  qui uuid;
  depot int; lecture int;
  n bigint; originaux bigint; logos bigint; touchees int; accepte boolean; motif text; erreur text; construit boolean := false;
  refusees int; acceptees text[];
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  select count(*) filter (where p.polname = 'ventes_depot_d_un_original'),
         count(*) filter (where p.polname = 'ventes_lecture' and pg_get_expr(p.polqual, p.polrelid) like '%/imports/%')
    into depot, lecture
    from pg_policy p where p.polrelid = 'storage.objects'::regclass;
  if depot = 0 and lecture = 0 then
    insert into rls_verdict values ('OI. les originaux des factures reprises : EN ATTENTE de la migration originaux_des_imports',
      'storage.objects (ventes, imports/)', 'absente : le sous-arbre se juge dès que la migration y est', true);
    return;
  end if;
  begin
    insert into storage.objects (bucket_id, name, metadata) values
      ('ventes', original_sien, '{"size": 10, "mimetype": "application/pdf"}'),
      ('ventes', original_autre, '{"size": 10, "mimetype": "text/plain"}'),
      ('ventes', logo_sien, '{"size": 10, "mimetype": "image/png"}');
    construit := true;
    -- « Ventes » ne se porte que sur un accès d'un dossier basculé (garder_droit_ventes, étape VF8f) : les dossiers du
    -- client basculent, par le propriétaire sans session, le temps de la sous-transaction ; puis ses deux droits.
    perform set_config('request.jwt.claims', '', true);
    update dossiers set ventes_par_les_factures = true
     where id in (select m.dossier_id from memberships m where m.user_id = client) and not ventes_par_les_factures;
    update memberships set droit_ventes = true, droit_banque = true where user_id = client;

    -- OI1 et OI2 : l'anonyme, puis un compte rattaché à rien.
    set local role anon;
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    select count(*) into n from storage.objects where bucket_id = 'ventes' and name in (original_sien, original_autre);
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'OI1. anonyme ne voit aucun original d''une facture reprise', 'cible', 'ventes (imports/)',
      'observe', n::text, 'ok', n = 0);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
    select count(*) into n from storage.objects where bucket_id = 'ventes' and name in (original_sien, original_autre);
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'OI2. inconnu authentifié ne voit aucun original d''une facture reprise', 'cible', 'ventes (imports/)',
      'observe', n::text, 'ok', n = 0);
    -- M-OI1 : OI1 rejoué par le propriétaire, qui voit les deux.
    select count(*) into n from storage.objects where bucket_id = 'ventes' and name in (original_sien, original_autre);
    mutations := mutations || jsonb_build_object('mutation', 'M-OI1 — OI1 rejoué par le propriétaire', 'attendu', 'les deux originaux vus',
      'observe', n || ' vu(s)', 'mord', n = 2);

    -- OI3 : le client « Ventes » et « Banque » — aucun original, même de son dossier ; le logo de son dossier, toujours.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) filter (where name in (original_sien, original_autre)), count(*) filter (where name = logo_sien)
      into originaux, logos from storage.objects where bucket_id = 'ventes' and name in (original_sien, original_autre, logo_sien);
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'OI3. client « Ventes » ne voit aucun original, même de son dossier, et voit le logo de son dossier (contrôle positif)',
      'cible', 'ventes (imports/, logos/)', 'observe', originaux || ' original(aux), ' || logos || ' logo(s)', 'ok', originaux = 0 and logos = 1);
    -- M-OI3 : OI3 rejoué sous le chef, qui voit les deux originaux.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into n from storage.objects where bucket_id = 'ventes' and name in (original_sien, original_autre);
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-OI3 — OI3 rejoué sous le chef du cabinet', 'attendu', 'les deux originaux vus',
      'observe', n || ' vu(s)', 'mord', n = 2);
    -- OI3bis : le chef voit les originaux des dossiers de son cabinet — le contrôle positif de la lecture resserrée.
    verdicts := verdicts || jsonb_build_object('controle', 'OI3bis. le chef du cabinet voit les originaux des dossiers de son cabinet (contrôle positif)',
      'cible', 'ventes (imports/)', 'observe', n::text, 'ok', n = 2);

    -- OI4 : ni le client, sous la forme exacte et dans son dossier, ni un inconnu ne déposent un original.
    foreach qui in array array[client, inconnu] loop
      accepte := false; motif := null;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', qui, 'role', 'authenticated')::text, true);
        insert into storage.objects (bucket_id, name, metadata) values ('ventes', depot_exact, '{"size": 10, "mimetype": "text/csv"}');
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', 'OI4. ni le client « Ventes » ni un inconnu ne déposent un original, même sous la forme exacte',
        'cible', 'ventes (insert, ' || case when qui = client then 'client' else 'inconnu' end || ')',
        'observe', case when accepte then 'ACCEPTÉ' else 'refusé par ' || coalesce(motif, '?') end, 'ok', (not accepte) and motif = '42501');
    end loop;
    -- M-OI4 : OI4 rejoué par le chef — il dépose.
    accepte := false; motif := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into storage.objects (bucket_id, name, metadata) values ('ventes', depot_exact, '{"size": 10, "mimetype": "text/csv"}');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-OI4 — OI4 rejoué par le chef du cabinet', 'attendu', 'le dépôt accepté',
      'observe', case when accepte then 'accepté' else 'refusé par ' || coalesce(motif, '?') end, 'mord', accepte);

    -- OI5 : le chef ne dépose que sous la forme exacte.
    formes := array[
      dossier_du_client || '/imports/' || lot || '/' || repeat('d', 64) || '.exe',
      dossier_du_client || '/imports/' || lot || '/facture.pdf',
      dossier_du_client || '/imports/' || repeat('d', 64) || '.pdf',
      dossier_du_client || '/imports/' || upper(lot) || '/' || repeat('d', 64) || '.pdf',
      dossier_du_client || '/imports/' || lot || '/' || repeat('D', 64) || '.pdf',
      dossier_du_client || '/imports/' || lot || '/' || repeat('d', 64) || '.pdf/x',
      dossier_du_client || '/imports/' || lot || '/' || repeat('d', 63) || '.pdf',
      'pas-un-dossier/imports/' || lot || '/' || repeat('d', 64) || '.pdf'];
    refusees := 0; acceptees := '{}';
    foreach forme in array formes loop
      accepte := false; motif := null;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        insert into storage.objects (bucket_id, name, metadata) values ('ventes', forme, '{"size": 10, "mimetype": "application/pdf"}');
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate;
      end;
      reset role;
      if (not accepte) and motif = '42501' then refusees := refusees + 1; else acceptees := acceptees || (coalesce(motif, 'accepté') || ' : ' || forme); end if;
    end loop;
    verdicts := verdicts || jsonb_build_object('controle', 'OI5. le cabinet ne dépose un original que sous la forme exacte du chemin',
      'cible', 'ventes (insert, chef, huit formes)', 'observe', refusees || ' refusée(s) en 42501' ||
        case when cardinality(acceptees) > 0 then ' ; ' || array_to_string(acceptees, ' ; ') else '' end,
      'ok', refusees = cardinality(formes));
    -- M-OI5 : la forme exacte, une autre empreinte et le xml, par le chef — acceptée.
    accepte := false; motif := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into storage.objects (bucket_id, name, metadata)
        values ('ventes', dossier_du_client || '/imports/' || lot || '/' || repeat('e', 64) || '.xml', '{"size": 10, "mimetype": "text/plain"}');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when sqlstate 'P0001' then null; when others then accepte := false; motif := sqlstate;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-OI5 — OI5 rejoué sous la forme exacte', 'attendu', 'le dépôt accepté',
      'observe', case when accepte then 'accepté' else 'refusé par ' || coalesce(motif, '?') end, 'mord', accepte);

    -- OI6 : personne ne modifie un original — le client, puis le chef.
    foreach qui in array array[client, chef] loop
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', qui, 'role', 'authenticated')::text, true);
      update storage.objects set metadata = '{"size": 20, "mimetype": "application/pdf"}'
       where bucket_id = 'ventes' and name in (original_sien, original_autre);
      get diagnostics touchees = row_count;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', 'OI6. personne ne modifie un original d''une facture reprise',
        'cible', 'ventes (imports/, ' || case when qui = client then 'client « Ventes »' else 'chef' end || ')',
        'observe', touchees || ' ligne(s) touchée(s)', 'ok', touchees = 0);
    end loop;
    -- M-OI6 : OI6 rejoué par le propriétaire, qui touche les deux lignes.
    update storage.objects set metadata = '{"size": 20, "mimetype": "application/pdf"}'
     where bucket_id = 'ventes' and name in (original_sien, original_autre);
    get diagnostics touchees = row_count;
    mutations := mutations || jsonb_build_object('mutation', 'M-OI6 — OI6 rejoué par le propriétaire', 'attendu', 'les deux lignes touchées',
      'observe', touchees || ' ligne(s)', 'mord', touchees = 2);

    -- M-OI3b : OI3 rejoué sur le logo seul — le client « Ventes » le voit : la lecture du client n'est pas aveugle.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from storage.objects where bucket_id = 'ventes' and name = logo_sien;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-OI3b — OI3 rejoué sur le logo de son dossier', 'attendu', 'le logo vu',
      'observe', n || ' vu(s)', 'mord', n = 1);

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  -- OI7 : au catalogue, la policy de dépôt — permissive, d'insertion, au seul rôle authenticated, sur admin_du_dossier et
  -- la forme exacte — et le cas `imports/` de la lecture, sur admin_du_dossier.
  select count(*) into n from pg_policy p
   where p.polrelid = 'storage.objects'::regclass and p.polname = 'ventes_depot_d_un_original' and p.polcmd = 'a' and p.polpermissive
     and p.polroles = array['authenticated'::regrole]::oid[]
     and pg_get_expr(p.polwithcheck, p.polrelid) like '%admin\_du\_dossier%'
     and pg_get_expr(p.polwithcheck, p.polrelid) like '%/imports/%{64}\\.(pdf|xml|csv)$%';
  verdicts := verdicts || jsonb_build_object('controle', 'OI7. la policy de dépôt d''un original : permissive, d''insertion, to authenticated, sur admin_du_dossier et la forme exacte (lecture du catalogue)',
    'cible', 'ventes_depot_d_un_original', 'observe', case when n = 1 then 'présente, telle quelle' else 'ABSENTE OU ÉLARGIE' end, 'ok', n = 1);
  select count(*) into n from pg_policy p
   where p.polrelid = 'storage.objects'::regclass and p.polname = 'ventes_lecture' and p.polcmd = 'r'
     -- Le cas `imports/` sur admin_du_dossier seul (A8d2a), ou suivi de la libération des originaux d'un dossier supprimé
     -- (A8D2A-Q1, `originaux_retenus_par_leur_import`, dont le bloc OR juge le texte entier) — rien d'autre.
     and pg_get_expr(p.polqual, p.polrelid) ~ '/imports/''::text\) THEN ((public\.)?admin_du_dossier\(\(\(storage\.foldername\(name\)\)\[1\]\)::uuid\)|\((public\.)?admin_du_dossier\(\(\(storage\.foldername\(name\)\)\[1\]\)::uuid\) OR (public\.)?original_libere\(name\)\))\s+WHEN';
  verdicts := verdicts || jsonb_build_object('controle', 'OI7. la lecture du seau des ventes réserve imports/ au cabinet du dossier (lecture du catalogue)',
    'cible', 'ventes_lecture', 'observe', case when n = 1 then 'cas imports/ sur admin_du_dossier' else 'ABSENT OU ÉLARGI' end, 'ok', n = 1);
  verdicts := verdicts || jsonb_build_object('controle', 'OI. le jeu d''essai des originaux s''est construit', 'cible', 'ventes (imports/)',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ═══ Le dossier du cabinet (LM1, ligne 47) ═════════════════════════════════════════════════════════════════════════
--
-- La migration `dossier_du_cabinet` fait DÉSIGNER par le cabinet l'un de ses dossiers comme le sien
-- (`cabinets.dossier_du_cabinet`), où il facture ses honoraires en son propre nom. Ce qu'elle ouvre et ferme, aux quatre
-- profils : la désignation ne s'exécute pas par l'anonyme (DC1), se refuse en 42501 à un compte rattaché à rien et au
-- client (DC2, DC3) ; la colonne ne s'écrit pas par la policy `cabinets_update`, même du chef (DC4) ; le chef désigne
-- (DC5, le contrôle POSITIF) ; aucun accès client ne se pose sur le dossier désigné, même par le chef (DC6) — un client y
-- lirait les honoraires de tous les clients — ; au catalogue, la désignation est `security definer` et exécutable par
-- `authenticated` seul, la lecture et les gardes par aucun rôle de session (DC7). Le jeu : un dossier jetable du cabinet,
-- dans une sous-transaction annulée. Trois mutations, qui doivent mordre. EN ATTENTE tant que la colonne n'est pas en
-- base. Ce que la désignation refuse encore, la série et le mandataire, la suppression : `dossierDuCabinet.sql`.
do $dc$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  cabinet uuid := 'cab10000-0000-4000-8000-000000000001';
  jetable uuid := '1a100000-0000-4000-8000-0000000000dc';
  autre   uuid := '1a100000-0000-4000-8000-0000000000dd';
  n bigint; etat text; message text; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'cabinets' and column_name = 'dossier_du_cabinet') then
    insert into rls_verdict values ('DC. le dossier du cabinet : EN ATTENTE de la migration dossier_du_cabinet',
      'cabinets.dossier_du_cabinet', 'absente : la désignation se juge dès que la migration y est', true);
    return;
  end if;
  begin
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (jetable, 'RLS DOSSIER DU CABINET', cabinet, 'tresorerie', '455000'),
      (autre, 'RLS AUTRE DOSSIER', cabinet, 'tresorerie', '455000');
    construit := true;

    -- DC1 : l'anonyme n'exécute pas la désignation.
    begin
      set local role anon;
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      perform public.designer_dossier_du_cabinet(cabinet, jetable);
      etat := 'acceptée';
    exception when others then etat := sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'DC1. anonyme n''exécute pas la désignation du dossier du cabinet', 'cible', 'designer_dossier_du_cabinet',
      'observe', etat, 'ok', etat = '42501');

    -- DC2 et DC3 : un compte rattaché à rien, puis le client.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      perform public.designer_dossier_du_cabinet(cabinet, jetable);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'DC2. inconnu authentifié ne désigne pas le dossier du cabinet', 'cible', 'designer_dossier_du_cabinet',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = 'Accès refusé à ce cabinet.');
    -- M-DC2 : DC2 rejoué sous le chef — il désigne (annulé aussitôt).
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform public.designer_dossier_du_cabinet(cabinet, jetable);
      raise exception 'annuler' using errcode = 'P0001';
    exception when sqlstate 'P0001' then etat := 'acceptée'; when others then etat := sqlstate;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-DC2 — DC2 rejoué sous le chef du cabinet', 'attendu', 'la désignation acceptée',
      'observe', etat, 'mord', etat = 'acceptée');
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform public.designer_dossier_du_cabinet(cabinet, jetable);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'DC3. client ne désigne pas le dossier du cabinet', 'cible', 'designer_dossier_du_cabinet',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = 'Accès refusé à ce cabinet.');

    -- DC4 : la colonne ne s'écrit pas par la policy du cabinet, même du chef.
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      update cabinets set dossier_du_cabinet = jetable where id = cabinet;
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'DC4. la colonne de la désignation ne s''écrit pas par cabinets_update, même du chef', 'cible', 'cabinets.dossier_du_cabinet',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501');

    -- DC5 : le chef désigne (contrôle positif) ; DC6 : aucun accès client sur le dossier désigné, même par le chef.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform public.designer_dossier_du_cabinet(cabinet, jetable);
    reset role;
    select count(*) into n from cabinets where id = cabinet and dossier_du_cabinet = jetable;
    verdicts := verdicts || jsonb_build_object('controle', 'DC5. le chef du cabinet désigne le dossier du cabinet (contrôle positif)', 'cible', 'cabinets.dossier_du_cabinet',
      'observe', n || ' désignation(s)', 'ok', n = 1);
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into memberships (user_id, dossier_id, role, email) values (client, jetable, 'client', 'rls-dc@example.test');
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'DC6. aucun accès client sur le dossier du cabinet, même posé par le chef', 'cible', 'memberships',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '23514');
    -- M-DC6 : DC6 rejoué sur un autre dossier du cabinet — l'accès se pose (annulé aussitôt).
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into memberships (user_id, dossier_id, role, email) values (client, autre, 'client', 'rls-dc@example.test');
      raise exception 'annuler' using errcode = 'P0001';
    exception when sqlstate 'P0001' then etat := 'acceptée'; when others then etat := sqlstate;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-DC6 — DC6 rejoué sur un dossier qui n''est pas celui du cabinet', 'attendu', 'l''accès posé',
      'observe', etat, 'mord', etat = 'acceptée');
    raise exception 'annuler le jeu' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- DC7 : le catalogue.
  select count(*) into n from pg_proc p
   where p.oid = 'public.designer_dossier_du_cabinet(uuid, uuid)'::regprocedure and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false);
  verdicts := verdicts || jsonb_build_object('controle', 'DC7. la désignation : security definer, exécutable par authenticated seul (lecture du catalogue)',
    'cible', 'designer_dossier_du_cabinet', 'observe', case when n = 1 then 'telle quelle' else 'ÉLARGIE OU ABSENTE' end, 'ok', n = 1);
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('est_dossier_du_cabinet', 'garder_dossier_du_cabinet', 'garder_acces_au_dossier_du_cabinet',
                       'garder_suppression_du_dossier_du_cabinet', 'garder_cabinet_du_dossier_du_cabinet')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  verdicts := verdicts || jsonb_build_object('controle', 'DC7. la lecture et les gardes de la désignation : aucun rôle de session ne les exécute (lecture du catalogue)',
    'cible', 'est_dossier_du_cabinet et les quatre gardes', 'observe', n || ' exécutable(s)', 'ok', n = 0);
  -- M-DC7 : DC7 rejoué en lisant le droit du propriétaire, qui les exécute.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'est_dossier_du_cabinet'
     and has_function_privilege('proprietaire', p.oid, 'execute');
  mutations := mutations || jsonb_build_object('mutation', 'M-DC7 — DC7 rejoué pour le propriétaire', 'attendu', 'la lecture exécutable',
    'observe', n || ' exécutable(s)', 'mord', n = 1);
  verdicts := verdicts || jsonb_build_object('controle', 'DC. le jeu d''essai du dossier du cabinet s''est construit, et rien n''en est resté', 'cible', 'le dossier jetable',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null and not exists (select 1 from dossiers where id in (jetable, autre))
      and not exists (select 1 from cabinets where dossier_du_cabinet = jetable));

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $dc$;
-- ═══ Les lettres de mission (LM4, ligne 47) ═════════════════════════════════════════════════════════════════════════
--
-- La migration `lettres_de_mission` range les modèles et les lettres de mission du cabinet dans le dossier du cabinet
-- (LM1), écrits par six fonctions `security definer`, lus par `admin_du_dossier` seul. Ce qu'elle ouvre et ferme, aux
-- quatre profils : les fonctions ne s'exécutent pas par l'anonyme (LM1), se refusent en 42501 à un compte rattaché à rien
-- et au client, même le dossier désigné (LM2, LM3) ; le chef écrit un modèle et un brouillon et les lit (LM4, le contrôle
-- POSITIF) ; le client ne lit ni l'un ni l'autre (LM5) ; un compte rattaché à rien n'insère pas directement — la porte
-- de la restauration est au super-administrateur (LM6) ; au catalogue, les six fonctions sont `security definer` et
-- exécutables par `authenticated` seul, l'empreinte et les gardes par aucun rôle de session, le drapeau de l'acceptation
-- en ligne rend faux, et les deux tables n'ont que des policies `to authenticated` (LM7). Le jeu : deux dossiers jetables
-- du cabinet, dans une sous-transaction annulée. Trois mutations, qui doivent mordre. EN ATTENTE tant que la table n'est
-- pas en base. Ce que les fonctions refusent encore, la proposition figée, la réponse et le retrait : `lettresDeMission.sql`.
do $lm$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  cabinet uuid := 'cab10000-0000-4000-8000-000000000001';
  k uuid := '1a100000-0000-4000-8000-0000000000e4';
  c uuid := '1a100000-0000-4000-8000-0000000000e5';
  missions jsonb := '{"tenue_comptable": "Tenir la comptabilité."}';
  n bigint; etat text; message text; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.lettres_de_mission') is null then
    insert into rls_verdict values ('LM. les lettres de mission : EN ATTENTE de la migration lettres_de_mission',
      'lettres_de_mission', 'absente : les lettres se jugent dès que la migration y est', true);
    return;
  end if;
  begin
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, siret, adresse) values
      (k, 'RLS DOSSIER DU CABINET LM', cabinet, 'tresorerie', '455000', '12345678200010', 'RLS ADRESSE'),
      (c, 'RLS CLIENT LM', cabinet, 'tresorerie', '455000', null, 'RLS ADRESSE');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform public.designer_dossier_du_cabinet(cabinet, k);
    reset role;
    construit := true;

    -- LM1 : l'anonyme n'exécute pas les fonctions.
    begin
      set local role anon;
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      perform public.enregistrer_modele_de_lettre(k, 'T', 'CG', missions, '{}', null);
      etat := 'acceptée';
    exception when others then etat := sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'LM1. anonyme n''exécute pas les fonctions des lettres de mission', 'cible', 'enregistrer_modele_de_lettre',
      'observe', etat, 'ok', etat = '42501');

    -- LM2 et LM3 : un compte rattaché à rien, puis le client.
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      perform public.enregistrer_brouillon_de_lettre(k, null, '{}'::jsonb, null);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'LM2. inconnu authentifié n''écrit pas de lettre de mission', 'cible', 'enregistrer_brouillon_de_lettre',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = 'Accès refusé à ce dossier.');
    -- M-LM2 : LM2 rejoué sous le chef — il écrit (annulé aussitôt).
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform public.enregistrer_brouillon_de_lettre(k, null, '{}'::jsonb, null);
      raise exception 'annuler' using errcode = 'P0001';
    exception when sqlstate 'P0001' then etat := 'acceptée'; when others then etat := sqlstate;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-LM2 — LM2 rejoué sous le chef du cabinet', 'attendu', 'le brouillon accepté',
      'observe', etat, 'mord', etat = 'acceptée');
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform public.enregistrer_modele_de_lettre(k, 'T', 'CG', missions, '{}', null);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'LM3. client n''écrit pas de modèle de lettre de mission', 'cible', 'enregistrer_modele_de_lettre',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = 'Accès refusé à ce dossier.');

    -- LM4 : le chef écrit un modèle et un brouillon, et les lit (contrôle positif).
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform public.enregistrer_modele_de_lettre(k, 'Modèle RLS', 'Conditions RLS', missions, '{}', null);
    perform public.enregistrer_brouillon_de_lettre(k, null, jsonb_build_object('dossier_client_id', c), null);
    select (select count(*) from lettres_de_mission where dossier_id = k) + (select count(*) from modeles_lettre_de_mission where dossier_id = k) into n;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'LM4. le chef écrit et lit un modèle et une lettre du dossier du cabinet (contrôle positif)', 'cible', 'lettres_de_mission',
      'observe', n || ' ligne(s)', 'ok', n = 2);

    -- LM5 : le client ne lit rien ; M-LM5 : la même lecture sous le chef.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select (select count(*) from lettres_de_mission where dossier_id = k) + (select count(*) from modeles_lettre_de_mission where dossier_id = k) into n;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'LM5. client ne lit ni les modèles ni les lettres de mission', 'cible', 'lettres_de_mission',
      'observe', n || ' ligne(s)', 'ok', n = 0);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select (select count(*) from lettres_de_mission where dossier_id = k) into n;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-LM5 — LM5 rejoué sous le chef', 'attendu', 'la lettre lue',
      'observe', n || ' ligne(s)', 'mord', n = 1);

    -- LM6 : un compte rattaché à rien n'insère pas directement.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      insert into lettres_de_mission (dossier_id, auteur) values (k, inconnu);
      etat := 'acceptée';
    exception when others then etat := sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'LM6. inconnu authentifié n''insère pas de lettre directement (la restauration est au super-administrateur)', 'cible', 'lettres_de_mission_restauration',
      'observe', etat, 'ok', etat = '42501');
    raise exception 'annuler le jeu' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- LM7 : le catalogue.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and p.proname in ('enregistrer_modele_de_lettre', 'retirer_modele_de_lettre', 'enregistrer_brouillon_de_lettre',
                       'proposer_lettre_de_mission', 'enregistrer_reponse_a_la_lettre', 'retirer_lettre_de_mission')
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false);
  verdicts := verdicts || jsonb_build_object('controle', 'LM7. les six fonctions des lettres : security definer, exécutables par authenticated seul (lecture du catalogue)',
    'cible', 'les six fonctions', 'observe', n || ' telle(s) quelle(s)', 'ok', n = 6);
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('empreinte_de_la_lettre', 'garder_modele_de_lettre', 'garder_lettre_de_mission', 'garder_designation_des_lettres')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  verdicts := verdicts || jsonb_build_object('controle', 'LM7. l''empreinte et les gardes des lettres : aucun rôle de session ne les exécute (lecture du catalogue)',
    'cible', 'empreinte_de_la_lettre et les trois gardes', 'observe', n || ' exécutable(s)', 'ok', n = 0);
  -- M-LM7 : la même lecture pour le propriétaire, qui les exécute.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'empreinte_de_la_lettre'
     and has_function_privilege('proprietaire', p.oid, 'execute');
  mutations := mutations || jsonb_build_object('mutation', 'M-LM7 — LM7 rejoué pour le propriétaire', 'attendu', 'l''empreinte exécutable',
    'observe', n || ' exécutable(s)', 'mord', n = 1);
  verdicts := verdicts || jsonb_build_object('controle', 'LM7. l''acceptation en ligne : le drapeau de la base rend faux', 'cible', 'acceptation_en_ligne_ouverte',
    'observe', public.acceptation_en_ligne_ouverte()::text, 'ok', not public.acceptation_en_ligne_ouverte());
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename in ('lettres_de_mission', 'modeles_lettre_de_mission')
     and not (roles = '{authenticated}' and cmd in ('SELECT', 'INSERT'));
  verdicts := verdicts || jsonb_build_object('controle', 'LM7. les deux tables : des policies to authenticated, de lecture et de restauration seulement (lecture du catalogue)',
    'cible', 'lettres_de_mission, modeles_lettre_de_mission', 'observe', n || ' autre(s)', 'ok', n = 0
      and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('lettres_de_mission', 'modeles_lettre_de_mission')) = 4);
  verdicts := verdicts || jsonb_build_object('controle', 'LM. le jeu d''essai des lettres de mission s''est construit, et rien n''en est resté', 'cible', 'les dossiers jetables',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null and not exists (select 1 from dossiers where id in (k, c))
      and not exists (select 1 from cabinets where dossier_du_cabinet = k));

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $lm$;

-- ═══ Les factures d'honoraires (LM7, ligne 47) ═════════════════════════════════════════════════════════════════════════
--
-- La migration `honoraires_factures` lie une facture du dossier du cabinet à la période d'une ligne d'honoraires d'une
-- lettre acceptée (LM4) ; `facturer_honoraires`, `security definer`, crée le brouillon et pose les liens ; la table est lue
-- par `admin_du_dossier` seul. Ce qu'elle ouvre et ferme, aux quatre profils : la fonction ne s'exécute pas par l'anonyme
-- (HF1), se refuse en 42501 à un compte rattaché à rien et au client, même le dossier désigné (HF2, HF3) ; le chef facture
-- une période et lit son lien (HF4, le contrôle POSITIF) ; le client ne lit rien (HF5) ; un compte rattaché à rien n'insère
-- pas directement — la porte de la restauration est au super-administrateur (HF6) ; au catalogue, la fonction est
-- `security definer` et exécutable par `authenticated` seul, la garde par aucun rôle de session, et la table n'a que deux
-- policies `to authenticated`, de lecture et de restauration (HF7). Le jeu : deux dossiers jetables du cabinet, un
-- document et une lettre acceptée sur papier, dans une sous-transaction annulée. Trois mutations, qui doivent mordre. EN
-- ATTENTE tant que la table n'est pas en base. Ce que la fonction refuse encore, l'avoir, l'avenant, la garde :
-- `honorairesFactures.sql`.
do $hf$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  cabinet uuid := 'cab10000-0000-4000-8000-000000000001';
  k uuid := '1a100000-0000-4000-8000-0000000000e6';
  c uuid := '1a100000-0000-4000-8000-0000000000e7';
  d uuid := '1a100000-0000-4000-8000-0000000000e8';
  l uuid := '1a100000-0000-4000-8000-0000000000e9';
  elements jsonb := '[{"lettre_id": "1a100000-0000-4000-8000-0000000000e9", "ligne": 1, "periode_debut": "2026-01-01", "periode_fin": "2026-01-31"}]';
  fac uuid;
  n bigint; etat text; message text; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.honoraires_factures') is null then
    insert into rls_verdict values ('HF. les factures d''honoraires : EN ATTENTE de la migration honoraires_factures',
      'honoraires_factures', 'absente : les liens se jugent dès que la migration y est', true);
    return;
  end if;
  begin
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, siret, adresse) values
      (k, 'RLS DOSSIER DU CABINET HF', cabinet, 'tresorerie', '455000', '12345678200010', 'RLS ADRESSE'),
      (c, 'RLS CLIENT HF', cabinet, 'tresorerie', '455000', '98765432100017', 'RLS ADRESSE');
    insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, storage_hash) values
      (d, k, k || '/divers/signee.pdf', 'signee.pdf', 'autre', repeat('ab', 32));
    insert into memberships (user_id, dossier_id, role, email) values (client, c, 'client', 'rls-hf@example.test');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform public.designer_dossier_du_cabinet(cabinet, k);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    insert into lettres_de_mission (id, dossier_id, dossier_client_id, missions, honoraires, date_effet, premier_exercice,
        fin_initiale, signataire_nom, identite_client, identite_cabinet, clauses, empreinte, proposee_le, proposee_par,
        acceptee_le, acceptee_par, mode_acceptation, empreinte_acceptee, document_signe_id, empreinte_papier, signee_le, auteur)
    values (l, k, c, '{tenue_comptable}', '[{"forme": "forfait", "libelle": "Tenue", "montant_ht": 100, "periodicite": "mois"}]',
      '2026-01-01', 2026, '2026-12-31', 'S', '{}', '{}', '{sous_traitance}', repeat('1', 64), '2025-12-01', chef, '2025-12-05',
      chef, 'papier', repeat('1', 64), d, repeat('ab', 32), '2025-12-04', chef);
    construit := true;

    -- HF1 : l'anonyme n'exécute pas la fonction.
    begin
      set local role anon;
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      perform public.facturer_honoraires(k, elements, 20, null);
      etat := 'acceptée';
    exception when others then etat := sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'HF1. anonyme n''exécute pas facturer_honoraires', 'cible', 'facturer_honoraires',
      'observe', etat, 'ok', etat = '42501');

    -- HF2 et HF3 : un compte rattaché à rien, puis le client.
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      perform public.facturer_honoraires(k, elements, 20, null);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'HF2. inconnu authentifié ne facture pas d''honoraires', 'cible', 'facturer_honoraires',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = 'Accès refusé à ce dossier.');
    -- M-HF2 : HF2 rejoué sous le chef — il facture (annulé aussitôt).
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform public.facturer_honoraires(k, elements, 20, null);
      raise exception 'annuler' using errcode = 'P0001';
    exception when sqlstate 'P0001' then etat := 'acceptée'; when others then etat := sqlstate;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-HF2 — HF2 rejoué sous le chef du cabinet', 'attendu', 'le brouillon créé',
      'observe', etat, 'mord', etat = 'acceptée');
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform public.facturer_honoraires(k, elements, 20, null);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'HF3. client ne facture pas d''honoraires', 'cible', 'facturer_honoraires',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = 'Accès refusé à ce dossier.');

    -- HF4 : le chef facture janvier et lit le lien (contrôle positif).
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    fac := public.facturer_honoraires(k, elements, 20, null);
    select count(*) into n from honoraires_factures where dossier_id = k;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'HF4. le chef facture une période et lit son lien (contrôle positif)', 'cible', 'honoraires_factures',
      'observe', n || ' ligne(s)', 'ok', n = 1);

    -- HF5 : le client ne lit rien ; M-HF5 : la même lecture sous le chef.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from honoraires_factures where dossier_id = k;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'HF5. client ne lit pas les liens des factures d''honoraires', 'cible', 'honoraires_factures',
      'observe', n || ' ligne(s)', 'ok', n = 0);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into n from honoraires_factures where dossier_id = k;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-HF5 — HF5 rejoué sous le chef', 'attendu', 'le lien lu',
      'observe', n || ' ligne(s)', 'mord', n = 1);

    -- HF6 : un compte rattaché à rien n'insère pas directement.
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      -- La facture du chef, nommée par son identifiant : l'inconnu ne la lit pas, une sélection n'insérerait rien.
      insert into honoraires_factures (dossier_id, facture_id, lettre_id, ligne, periode_debut, periode_fin, auteur)
        values (k, fac, l, 1, '2026-02-01', '2026-02-28', inconnu);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    -- Une insertion se juge par la garde AVANT la policy : la garde, à ses droits, ne lit pas la lettre et refuse (23514,
    -- des mots qui ne disent pas si la lettre existe) ; sinon la policy refuserait (42501). Ni l'un ni l'autre n'écrit.
    verdicts := verdicts || jsonb_build_object('controle', 'HF6. inconnu authentifié n''insère pas de lien directement (la restauration est au super-administrateur)', 'cible', 'honoraires_factures_restauration',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501'
        or (etat = '23514' and message = 'Une facture d''honoraires se lie, dans le dossier du cabinet, à une lettre de mission de ce dossier.'));
    raise exception 'annuler le jeu' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- HF7 : le catalogue.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname = 'facturer_honoraires'
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false);
  verdicts := verdicts || jsonb_build_object('controle', 'HF7. facturer_honoraires : security definer, exécutable par authenticated seul (lecture du catalogue)',
    'cible', 'facturer_honoraires', 'observe', n || ' telle(s) quelle(s)', 'ok', n = 1);
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'garder_honoraires_factures'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  verdicts := verdicts || jsonb_build_object('controle', 'HF7. la garde des liens : aucun rôle de session ne l''exécute (lecture du catalogue)',
    'cible', 'garder_honoraires_factures', 'observe', n || ' exécutable(s)', 'ok', n = 0);
  -- M-HF7 : la même lecture pour le propriétaire, qui l'exécute.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'garder_honoraires_factures'
     and has_function_privilege('proprietaire', p.oid, 'execute');
  mutations := mutations || jsonb_build_object('mutation', 'M-HF7 — HF7 rejoué pour le propriétaire', 'attendu', 'la garde exécutable',
    'observe', n || ' exécutable(s)', 'mord', n = 1);
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'honoraires_factures' and not (roles = '{authenticated}' and cmd in ('SELECT', 'INSERT'));
  verdicts := verdicts || jsonb_build_object('controle', 'HF7. la table des liens : des policies to authenticated, de lecture et de restauration seulement (lecture du catalogue)',
    'cible', 'honoraires_factures', 'observe', n || ' autre(s)', 'ok', n = 0
      and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'honoraires_factures') = 2);
  verdicts := verdicts || jsonb_build_object('controle', 'HF. le jeu d''essai des factures d''honoraires s''est construit, et rien n''en est resté', 'cible', 'les dossiers jetables',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null and not exists (select 1 from dossiers where id in (k, c))
      and not exists (select 1 from cabinets where dossier_du_cabinet = k));

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $hf$;

-- ═══ Le dépôt des factures d'honoraires chez le client (LM8, ligne 47) ═════════════════════════════════════════════════
--
-- La migration `depot_des_honoraires` range, dans le dossier du cabinet, le DÉPÔT d'une facture d'honoraires validée dans
-- le dossier de son client ; `deposer_honoraires_chez_le_client`, `security definer`, y écrit la pièce « à valider » et le
-- dépôt ; la table est lue par `admin_du_dossier` seul ; `honoraires_deposes_au_dossier` dit au client lesquelles de ses
-- pièces viennent de son cabinet, et rien d'autre. Ce qu'elle ouvre et ferme, aux quatre profils : la fonction ne
-- s'exécute pas par l'anonyme (HD1), se refuse en 42501 à un compte rattaché à rien et au client (HD2, HD3) ; le chef
-- dépose la facture validée et lit son dépôt (HD4, le contrôle POSITIF) ; le client ne lit aucun dépôt ni ceux du
-- cabinet, mais lit que sa pièce vient de son cabinet (HD5) ; un compte rattaché à rien n'insère pas directement — la
-- porte de la restauration est au super-administrateur (HD6) ; au catalogue, les trois fonctions sont `security definer`
-- et exécutables par `authenticated` seul, la garde par aucun rôle de session, et la table n'a que deux policies `to
-- authenticated`, de lecture et de restauration (HD7). Le jeu : deux dossiers jetables du cabinet, un document, une lettre
-- acceptée sur papier, une facture facturée puis validée, un PDF rangé dans le seau des pièces, dans une sous-transaction
-- annulée. Trois mutations, qui doivent mordre. EN ATTENTE tant que la table n'est pas en base. Ce que la fonction refuse
-- encore, l'avoir, la pièce retirée, la garde : `depotDesHonoraires.sql`.
do $hd$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  cabinet uuid := 'cab10000-0000-4000-8000-000000000001';
  k uuid := '1a100000-0000-4000-8000-0000000000f6';
  c uuid := '1a100000-0000-4000-8000-0000000000f7';
  d uuid := '1a100000-0000-4000-8000-0000000000f8';
  l uuid := '1a100000-0000-4000-8000-0000000000f9';
  elements jsonb := '[{"lettre_id": "1a100000-0000-4000-8000-0000000000f9", "ligne": 1, "periode_debut": "2026-01-01", "periode_fin": "2026-01-31"}]';
  chemin text := '1a100000-0000-4000-8000-0000000000f7/rls-hd.pdf';
  empreinte text := repeat('cd', 32);
  fac uuid;
  piece uuid;
  n bigint; etat text; message text; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.honoraires_deposes') is null then
    insert into rls_verdict values ('HD. le dépôt des factures d''honoraires : EN ATTENTE de la migration depot_des_honoraires',
      'honoraires_deposes', 'absente : les dépôts se jugent dès que la migration y est', true);
    return;
  end if;
  begin
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, siret, adresse, statut_tva) values
      (k, 'RLS DOSSIER DU CABINET HD', cabinet, 'tresorerie', '455000', '12345678200010', 'RLS ADRESSE', 'redevable'),
      (c, 'RLS CLIENT HD', cabinet, 'tresorerie', '455000', '98765432100017', 'RLS ADRESSE', null);
    insert into documents_divers (id, dossier_id, storage_path, nom_fichier, categorie, storage_hash) values
      (d, k, k || '/divers/signee.pdf', 'signee.pdf', 'autre', repeat('ab', 32));
    insert into memberships (user_id, dossier_id, role, email) values (client, c, 'client', 'rls-hd@example.test');
    insert into storage.objects (bucket_id, name, metadata) values ('pieces', chemin, '{"size": 10, "mimetype": "application/pdf"}');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform public.designer_dossier_du_cabinet(cabinet, k);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    insert into lettres_de_mission (id, dossier_id, dossier_client_id, missions, honoraires, date_effet, premier_exercice,
        fin_initiale, signataire_nom, identite_client, identite_cabinet, clauses, empreinte, proposee_le, proposee_par,
        acceptee_le, acceptee_par, mode_acceptation, empreinte_acceptee, document_signe_id, empreinte_papier, signee_le, auteur)
    values (l, k, c, '{tenue_comptable}', '[{"forme": "forfait", "libelle": "Tenue", "montant_ht": 100, "periodicite": "mois"}]',
      '2026-01-01', 2026, '2026-12-31', 'S', '{}', '{}', '{sous_traitance}', repeat('1', 64), '2025-12-01', chef, '2025-12-05',
      chef, 'papier', repeat('1', 64), d, repeat('ab', 32), '2025-12-04', chef);
    -- La facture de janvier, facturée puis validée par le chef, comme toute facture.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    fac := public.facturer_honoraires(k, elements, 20, null);
    perform public.enregistrer_facture(k, fac, (select to_jsonb(f) from factures_emises f where f.id = fac),
      (select jsonb_agg(jsonb_build_object('designation', designation, 'quantite', quantite, 'prix_unitaire_ht', prix_unitaire_ht,
              'taux_tva', taux_tva, 'unite', unite, 'nature', nature) order by ordre) from facture_lignes where facture_id = fac), true);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    construit := true;

    -- HD1 : l'anonyme n'exécute pas la fonction.
    begin
      set local role anon;
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      perform public.deposer_honoraires_chez_le_client(k, fac, chemin, empreinte);
      etat := 'acceptée';
    exception when others then etat := sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'HD1. anonyme n''exécute pas deposer_honoraires_chez_le_client', 'cible', 'deposer_honoraires_chez_le_client',
      'observe', etat, 'ok', etat = '42501');

    -- HD2 et HD3 : un compte rattaché à rien, puis le client.
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      perform public.deposer_honoraires_chez_le_client(k, fac, chemin, empreinte);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'HD2. inconnu authentifié ne dépose pas de facture d''honoraires', 'cible', 'deposer_honoraires_chez_le_client',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = 'Accès refusé à ce dossier.');
    -- M-HD2 : HD2 rejoué sous le chef — il dépose (annulé aussitôt).
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform public.deposer_honoraires_chez_le_client(k, fac, chemin, empreinte);
      raise exception 'annuler' using errcode = 'P0001';
    exception when sqlstate 'P0001' then etat := 'acceptée'; when others then etat := sqlstate;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-HD2 — HD2 rejoué sous le chef du cabinet', 'attendu', 'la pièce déposée',
      'observe', etat, 'mord', etat = 'acceptée');
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform public.deposer_honoraires_chez_le_client(k, fac, chemin, empreinte);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'HD3. client ne dépose pas de facture d''honoraires', 'cible', 'deposer_honoraires_chez_le_client',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = 'Accès refusé à ce dossier.');

    -- HD4 : le chef dépose et lit le dépôt (contrôle positif).
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    piece := public.deposer_honoraires_chez_le_client(k, fac, chemin, empreinte);
    select count(*) into n from honoraires_deposes where dossier_id = k and piece_id = piece;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'HD4. le chef dépose la facture validée et lit son dépôt (contrôle positif)', 'cible', 'honoraires_deposes',
      'observe', n || ' ligne(s)', 'ok', n = 1);

    -- HD5 : le client ne lit aucun dépôt, ni ceux du cabinet ; il lit que sa pièce vient de son cabinet. M-HD5 : la même
    -- lecture de la table sous le chef.
    message := null;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from honoraires_deposes;
    begin
      perform 1 from public.depots_des_honoraires(k);
      etat := 'acceptée';
    exception when others then etat := sqlstate;
    end;
    message := (select string_agg(h.nature, ',') from public.honoraires_deposes_au_dossier(c) h where h.piece_id = piece);
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'HD5. client ne lit aucun dépôt ni ceux du cabinet ; il lit que sa pièce vient de son cabinet', 'cible', 'honoraires_deposes',
      'observe', n || ' ligne(s), dépôts du cabinet ' || etat || ', sa pièce ' || coalesce(message, 'non dite'), 'ok', n = 0 and etat = '42501' and message = 'facture');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    -- Les deux dossiers du bloc seuls : sous le chef, la table entière compterait aussi les dépôts des dossiers réels
    -- (le banc du leurre, le 11/11/2026).
    select count(*) into n from honoraires_deposes where dossier_id in (k, c);
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-HD5 — HD5 rejoué sous le chef', 'attendu', 'le dépôt lu',
      'observe', n || ' ligne(s)', 'mord', n >= 1);

    -- HD6 : un compte rattaché à rien n'insère pas directement.
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      insert into honoraires_deposes (dossier_id, facture_id, depot, dossier_client_id, piece_id, empreinte, auteur)
        values (k, fac, 2, c, gen_random_uuid(), empreinte, inconnu);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    -- Une insertion se juge par la garde AVANT la policy : la garde, à ses droits, ne lit pas la désignation et refuse
    -- (23514, des mots qui ne disent rien du dossier) ; sinon la policy refuserait (42501). Ni l'un ni l'autre n'écrit.
    verdicts := verdicts || jsonb_build_object('controle', 'HD6. inconnu authentifié n''insère pas de dépôt directement (la restauration est au super-administrateur)', 'cible', 'honoraires_deposes_restauration',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501'
        or (etat = '23514' and message = 'Une facture d''honoraires se dépose depuis le dossier du cabinet.'));
    raise exception 'annuler le jeu' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- HD7 : le catalogue.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and p.proname in ('deposer_honoraires_chez_le_client', 'depots_des_honoraires', 'honoraires_deposes_au_dossier')
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false);
  verdicts := verdicts || jsonb_build_object('controle', 'HD7. le dépôt et ses deux lectures : security definer, exécutables par authenticated seul (lecture du catalogue)',
    'cible', 'deposer_honoraires_chez_le_client', 'observe', n || ' telle(s) quelle(s)', 'ok', n = 3);
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'garder_honoraires_deposes'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  verdicts := verdicts || jsonb_build_object('controle', 'HD7. la garde des dépôts : aucun rôle de session ne l''exécute (lecture du catalogue)',
    'cible', 'garder_honoraires_deposes', 'observe', n || ' exécutable(s)', 'ok', n = 0);
  -- M-HD7 : la même lecture pour le propriétaire, qui l'exécute.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'garder_honoraires_deposes'
     and has_function_privilege('proprietaire', p.oid, 'execute');
  mutations := mutations || jsonb_build_object('mutation', 'M-HD7 — HD7 rejoué pour le propriétaire', 'attendu', 'la garde exécutable',
    'observe', n || ' exécutable(s)', 'mord', n = 1);
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'honoraires_deposes' and not (roles = '{authenticated}' and cmd in ('SELECT', 'INSERT'));
  verdicts := verdicts || jsonb_build_object('controle', 'HD7. la table des dépôts : des policies to authenticated, de lecture et de restauration seulement (lecture du catalogue)',
    'cible', 'honoraires_deposes', 'observe', n || ' autre(s)', 'ok', n = 0
      and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'honoraires_deposes') = 2);
  verdicts := verdicts || jsonb_build_object('controle', 'HD. le jeu d''essai des dépôts d''honoraires s''est construit, et rien n''en est resté', 'cible', 'les dossiers jetables',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null and not exists (select 1 from dossiers where id in (k, c))
      and not exists (select 1 from cabinets where dossier_du_cabinet = k)
      and not exists (select 1 from storage.objects where bucket_id = 'pieces' and name = chemin));

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $hd$;

-- ═══ La fiche de facturation d'un client du cabinet, liée à son dossier (LM3, ligne 47) ════════════════════════════════
--
-- La migration `fiche_liee_au_dossier_du_client` lie une fiche de `contacts` du dossier du cabinet au dossier de son
-- client (`dossier_client_id`, par `enregistrer_contact`, rang 4 bis) ; liée, la fiche ne garde aucune identité, que
-- `identites_des_fiches_liees`, `security definer`, lit du dossier pour le cabinet du dossier du cabinet. Ce qu'elle ouvre
-- et ferme, aux quatre profils : ni l'anonyme ni un compte rattaché à rien ne lient ni ne lisent l'identité (FL1, FL2) ;
-- le client d'un dossier lié ne lie rien dans le dossier du cabinet, n'en lit ni les fiches ni l'identité de son propre
-- dossier par cette porte (FL3) ; le chef lie et lit (FL4, le contrôle POSITIF) ; un compte rattaché à rien n'insère pas
-- de fiche liée directement — la porte de la restauration est au super-administrateur (FL5) ; au catalogue, la lecture
-- et le déliement sont `security definer` et exécutables par `authenticated` seul, les deux gardes par aucun rôle de
-- session, et les policies des contacts restent trois (FL6) ; ni un compte rattaché à rien ni le client du dossier lié ne
-- délient la fiche, `delier_fiche_liee` (LM3-Q1 (B)), le chef si (FL7). Le jeu : un dossier du cabinet désigné et un dossier client jetables, dans
-- une sous-transaction annulée. Quatre mutations, qui doivent mordre. EN ATTENTE tant que la colonne n'est pas en base.
-- Ce que les fonctions refusent encore, la garde, l'effacement, le dossier parti, le déliement : `fichesLieesAuxDossiers.sql`.
do $fl$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  cabinet uuid := 'cab10000-0000-4000-8000-000000000001';
  k uuid := '1a100000-0000-4000-8000-0000000000fa';
  c uuid := '1a100000-0000-4000-8000-0000000000fb';
  fiche uuid;
  n bigint; etat text; message text; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'contacts' and column_name = 'dossier_client_id') then
    insert into rls_verdict values ('FL. la fiche liée au dossier du client : EN ATTENTE de la migration fiche_liee_au_dossier_du_client',
      'contacts', 'absente : les fiches liées se jugent dès que la migration y est', true);
    return;
  end if;
  begin
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, siret, adresse, statut_tva) values
      (k, 'RLS DOSSIER DU CABINET FL', cabinet, 'tresorerie', '455000', '12345678200010', 'RLS ADRESSE', 'redevable'),
      (c, 'RLS CLIENT FL', cabinet, 'tresorerie', '455000', '98765432100017', 'RLS ADRESSE', null);
    insert into memberships (user_id, dossier_id, role, email) values (client, c, 'client', 'rls-fl@example.test');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform public.designer_dossier_du_cabinet(cabinet, k);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    construit := true;

    -- FL1 : l'anonyme ne lie pas et ne lit pas l'identité.
    begin
      set local role anon;
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      perform public.enregistrer_contact(k, null, jsonb_build_object('dossier_client_id', c));
      etat := 'acceptée';
    exception when others then etat := sqlstate;
    end;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      perform 1 from public.identites_des_fiches_liees(k);
      message := 'acceptée';
    exception when others then message := sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'FL1. anonyme ne lie pas de fiche et ne lit pas l''identité des dossiers liés', 'cible', 'identites_des_fiches_liees',
      'observe', etat || ' / ' || message, 'ok', etat = '42501' and message = '42501');

    -- FL2 : un compte rattaché à rien. M-FL2 : FL2 rejoué sous le chef — il lie (annulé aussitôt).
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      perform public.enregistrer_contact(k, null, jsonb_build_object('dossier_client_id', c));
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'FL2. inconnu authentifié ne lie pas de fiche', 'cible', 'enregistrer_contact',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = 'Accès refusé à ce dossier.');
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform public.enregistrer_contact(k, null, jsonb_build_object('dossier_client_id', c));
      raise exception 'annuler' using errcode = 'P0001';
    exception when sqlstate 'P0001' then etat := 'acceptée'; when others then etat := sqlstate;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-FL2 — FL2 rejoué sous le chef du cabinet', 'attendu', 'la fiche liée',
      'observe', etat, 'mord', etat = 'acceptée');

    -- FL4 : le chef lie et lit l'identité (contrôle positif) ; la fiche reste, pour FL3.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    fiche := (public.enregistrer_contact(k, null, jsonb_build_object('dossier_client_id', c, 'delai_paiement_jours', 30))).id;
    select count(*) into n from public.identites_des_fiches_liees(k) i where i.contact_id = fiche and i.tiers_siret = '98765432100017';
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'FL4. le chef lie la fiche et lit l''identité que le dossier donne (contrôle positif)', 'cible', 'identites_des_fiches_liees',
      'observe', n || ' ligne(s)', 'ok', n = 1);

    -- FL3 : le client du dossier lié ne lie rien dans le dossier du cabinet, n'en lit ni les fiches ni l'identité.
    -- M-FL3 : la même lecture des fiches sous le chef.
    message := null;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into n from contacts where dossier_id = k or dossier_client_id = c;
    begin
      perform public.enregistrer_contact(k, null, jsonb_build_object('dossier_client_id', c));
      etat := 'acceptée';
    exception when others then etat := sqlstate;
    end;
    begin
      perform 1 from public.identites_des_fiches_liees(k);
      message := 'acceptée';
    exception when others then message := sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'FL3. client ne lie rien dans le dossier du cabinet, n''en lit ni les fiches ni l''identité de son dossier', 'cible', 'contacts',
      'observe', n || ' fiche(s), lier ' || etat || ', lire ' || message, 'ok', n = 0 and etat = '42501' and message = '42501');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into n from contacts where dossier_id = k or dossier_client_id = c;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-FL3 — FL3 rejoué sous le chef', 'attendu', 'la fiche lue',
      'observe', n || ' fiche(s)', 'mord', n >= 1);

    -- FL7 : ni un compte rattaché à rien ni le client du dossier lié ne délient la fiche (LM3-Q1 (B)).
    -- M-FL7 : FL7 rejoué sous le chef, à la version lue — la fiche se délie (annulé aussitôt).
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      perform public.delier_fiche_liee(k, fiche, null);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'FL7. inconnu authentifié ne délie pas une fiche liée', 'cible', 'delier_fiche_liee',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = 'Accès refusé à ce dossier.');
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform public.delier_fiche_liee(k, fiche, null);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'FL7. client du dossier lié ne délie pas sa fiche dans le dossier du cabinet', 'cible', 'delier_fiche_liee',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = 'Accès refusé à ce dossier.');
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform public.delier_fiche_liee(k, fiche, (select f.modifie_le from public.contacts f where f.id = fiche));
      raise exception 'annuler' using errcode = 'P0001';
    exception when sqlstate 'P0001' then etat := 'acceptée'; when others then etat := sqlstate;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-FL7 — FL7 rejoué sous le chef du cabinet', 'attendu', 'la fiche déliée',
      'observe', etat, 'mord', etat = 'acceptée');

    -- FL5 : un compte rattaché à rien n'insère pas de fiche liée directement.
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      insert into contacts (dossier_id, dossier_client_id) values (k, gen_random_uuid());
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'FL5. inconnu authentifié n''insère pas de fiche liée directement (la restauration est au super-administrateur)', 'cible', 'contacts_restauration',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501');
    raise exception 'annuler le jeu' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- FL6 : le catalogue.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proname in ('identites_des_fiches_liees', 'delier_fiche_liee')
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false);
  verdicts := verdicts || jsonb_build_object('controle', 'FL6. la lecture des identités liées et le déliement : security definer, exécutables par authenticated seul (lecture du catalogue)',
    'cible', 'identites_des_fiches_liees', 'observe', n || ' telle(s) quelle(s)', 'ok', n = 2);
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('garder_fiche_liee', 'garder_designation_des_fiches_liees')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  verdicts := verdicts || jsonb_build_object('controle', 'FL6. les gardes des fiches liées : aucun rôle de session ne les exécute (lecture du catalogue)',
    'cible', 'garder_fiche_liee', 'observe', n || ' exécutable(s)', 'ok', n = 0);
  -- M-FL6 : la même lecture pour le propriétaire, qui les exécute.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('garder_fiche_liee', 'garder_designation_des_fiches_liees')
     and has_function_privilege('proprietaire', p.oid, 'execute');
  mutations := mutations || jsonb_build_object('mutation', 'M-FL6 — FL6 rejoué pour le propriétaire', 'attendu', 'les deux gardes exécutables',
    'observe', n || ' exécutable(s)', 'mord', n = 2);
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'contacts' and not (roles = '{authenticated}' and cmd in ('SELECT', 'INSERT'));
  verdicts := verdicts || jsonb_build_object('controle', 'FL6. les contacts : trois policies to authenticated, deux lectures et la restauration, rien d''autre (lecture du catalogue)',
    'cible', 'contacts', 'observe', n || ' autre(s)', 'ok', n = 0
      and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'contacts') = 3);
  verdicts := verdicts || jsonb_build_object('controle', 'FL. le jeu d''essai des fiches liées s''est construit, et rien n''en est resté', 'cible', 'les dossiers jetables',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null and not exists (select 1 from dossiers where id in (k, c))
      and not exists (select 1 from cabinets where dossier_du_cabinet = k));

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $fl$;

-- ═══ Les missions d'un client, sans ses honoraires (LM5-Q2, ligne 47) ══════════════════════════════════════════════════
--
-- La migration `missions_du_client` ne crée ni ne change aucune policy : une fonction de lecture `security definer` rend,
-- pour le dossier d'un client, ses lettres de mission, brouillons compris (LM5Q2-Q1 (B)), sans leurs honoraires — à qui
-- lit ce dossier au titre du
-- cabinet (`admin_du_dossier`), alors que la table des lettres reste fermée à qui n'est pas du dossier du cabinet. Ce
-- qu'elle ouvre et ferme : l'anonyme ne l'exécute pas (MV1) ; un compte rattaché à rien et le client du dossier, par son
-- accès, sont refusés en 42501, la raison exigée (MV2, MV3) ; un membre de l'équipe que le dossier du client n'a pas aussi
-- (MV4) ; assigné au SEUL dossier du client, il lit — le contrôle POSITIF — alors que la table lui reste fermée (MV5) ; la
-- valeur ne porte que ses clés, et aucun mot ni montant des honoraires (MV6) ; au catalogue, `security definer`, chemin
-- fixé, `stable`, exécutable par `authenticated` seul (MV7). Le jeu : deux dossiers jetables du cabinet de la réplique et
-- son membre d'équipe, dans une sous-transaction annulée. Trois mutations, qui doivent mordre. EN ATTENTE tant que la
-- fonction n'est pas en base. Ce qu'elle rend en détail (l'ordre, le brouillon, l'autre client, le dossier inconnu, le
-- cabinet sans dossier désigné) : `missionsDuClient.sql`.
do $mv$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre uuid := '3e3b0000-0000-4000-8000-000000000001';
  inconnu uuid := gen_random_uuid();
  cabinet uuid := 'cab10000-0000-4000-8000-000000000001';
  k uuid := '1a100000-0000-4000-8000-0000000000fc';
  c uuid := '1a100000-0000-4000-8000-0000000000fd';
  refus text := 'Accès refusé à ce dossier.';
  cles text[] := array['id', 'remplace_id', 'dossier_client_id', 'missions', 'date_effet', 'fin_initiale', 'reconduction_tacite',
                       'proposee_le', 'acceptee_le', 'refusee_le', 'retiree_le', 'fin_au'];
  interdit text := '(montant|libell|periodicit|livrable|honorair|repartition|identite|empreinte|clause|signataire|modele|auteur|2468\.13|1357\.91)';
  m uuid; l uuid; l2 uuid; v jsonb; ligne jsonb;
  n bigint; etat text; message text; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.missions_du_client(uuid)') is null then
    insert into rls_verdict values ('MV. les missions d''un client : EN ATTENTE de la migration missions_du_client',
      'missions_du_client', 'absente : ses droits se jugent dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : le chef désigne K, y écrit un modèle et une lettre pour C (un forfait de 2468.13 €), et la propose ──
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, siret, adresse) values
      (k, 'RLS DOSSIER DU CABINET MV', cabinet, 'tresorerie', '455000', '12345678200010', 'RLS ADRESSE'),
      (c, 'RLS CLIENT MV', cabinet, 'tresorerie', '455000', null, 'RLS ADRESSE');
    insert into memberships (user_id, dossier_id, role, email) values (client, c, 'client', 'rls-mv@example.test');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform public.designer_dossier_du_cabinet(cabinet, k);
    select (public.enregistrer_modele_de_lettre(k, 'Modèle RLS MV', 'Conditions RLS',
      '{"tenue_comptable": "Tenir la comptabilité."}'::jsonb, '{"sous_traitance": "Clause RLS."}'::jsonb, null)).id into m;
    select (public.enregistrer_brouillon_de_lettre(k, null, jsonb_build_object('dossier_client_id', c, 'modele_id', m,
      'missions', jsonb_build_array('tenue_comptable'), 'date_effet', '2026-01-01', 'premier_exercice', 2026,
      'fin_initiale', '2026-12-31', 'signataire_nom', 'Signataire RLS', 'signataire_qualite', 'Titulaire', 'repartition', '[{"tache": "Transmettre les pièces", "par": "client"}]'::jsonb,
      'honoraires', '[{"forme": "forfait", "libelle": "Tenue RLS", "montant_ht": 2468.13, "periodicite": "trimestre"}]'::jsonb), null)).id into l;
    perform public.proposer_lettre_de_mission(k, l, (select modifiee_le from lettres_de_mission where id = l));
    -- Un brouillon pour C (LM5Q2-Q1 (B)) : rendu lui aussi, après la lettre proposée, sans ses honoraires (1357.91 €).
    select (public.enregistrer_brouillon_de_lettre(k, null, jsonb_build_object('dossier_client_id', c, 'modele_id', m,
      'missions', jsonb_build_array('tenue_comptable'), 'date_effet', '2027-01-01', 'premier_exercice', 2027,
      'fin_initiale', '2027-12-31', 'signataire_nom', 'Signataire RLS', 'signataire_qualite', 'Titulaire', 'repartition', '[{"tache": "Transmettre les pièces", "par": "client"}]'::jsonb,
      'honoraires', '[{"forme": "forfait", "libelle": "Brouillon RLS", "montant_ht": 1357.91, "periodicite": "mois"}]'::jsonb), null)).id into l2;
    reset role;
    construit := true;

    -- MV1 : l'anonyme n'exécute pas la fonction.
    begin
      set local role anon;
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      perform public.missions_du_client(c);
      etat := 'acceptée';
    exception when others then etat := sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'MV1. anonyme n''exécute pas la lecture des missions d''un client', 'cible', 'missions_du_client',
      'observe', etat, 'ok', etat = '42501');

    -- MV2 et MV3 : un compte rattaché à rien, puis le client, par son accès au dossier.
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      perform public.missions_du_client(c);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'MV2. inconnu authentifié ne lit pas les missions d''un client', 'cible', 'missions_du_client',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = refus);
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform public.missions_du_client(c);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'MV3. client ne lit pas les missions de son dossier (ni leurs honoraires)', 'cible', 'missions_du_client',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = refus);
    -- M-MV3 : MV3 rejoué sous le chef — il lit.
    v := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      v := public.missions_du_client(c);
      etat := 'acceptée';
    exception when others then etat := sqlstate;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-MV3 — MV3 rejoué sous le chef du cabinet', 'attendu', 'la lecture acceptée',
      'observe', etat, 'mord', etat = 'acceptée' and jsonb_array_length(v -> 'lettres') = 2);

    -- MV4 : le membre de l'équipe, que le dossier du client n'a pas.
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', membre, 'role', 'authenticated')::text, true);
      perform public.missions_du_client(c);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'MV4. membre de l''équipe non assigné au dossier du client ne lit pas ses missions', 'cible', 'missions_du_client',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = refus);

    -- MV5 : assigné au SEUL dossier du client, il lit ; la table des lettres lui reste fermée.
    perform set_config('request.jwt.claims', '', true);
    insert into dossier_assignations (dossier_id, user_id) values (c, membre);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', membre, 'role', 'authenticated')::text, true);
    v := public.missions_du_client(c);
    select count(*) into n from lettres_de_mission where dossier_id = k;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'MV5. le membre assigné au seul dossier du client lit ses missions, la table des lettres fermée (contrôle positif)', 'cible', 'missions_du_client',
      'observe', coalesce(jsonb_array_length(v -> 'lettres'), -1) || ' lettre(s) rendue(s), ' || n || ' ligne(s) de la table',
      'ok', jsonb_array_length(v -> 'lettres') = 2 and v -> 'lettres' -> 0 ->> 'id' = l::text and v -> 'lettres' -> 1 ->> 'id' = l2::text
        and v -> 'lettres' -> 1 ->> 'proposee_le' is null and n = 0);
    -- M-MV5 : la même lecture de la table sous le chef — il la lit.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into n from lettres_de_mission where dossier_id = k;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-MV5 — la table relue sous le chef', 'attendu', 'les deux lettres lues',
      'observe', n || ' ligne(s)', 'mord', n = 2);

    -- MV6 : ses clés, et aucun mot ni montant des honoraires ; M-MV6 : le même contrôle sur la ligne de la table.
    select count(*) into n from jsonb_array_elements(v -> 'lettres') e
     where (select count(*) from jsonb_object_keys(e) x) <> 12 or exists (select 1 from jsonb_object_keys(e) x where x <> all (cles));
    verdicts := verdicts || jsonb_build_object('controle', 'MV6. les missions d''un client ne portent que leurs clés, sans montant ni contenu réservé', 'cible', 'missions_du_client',
      'observe', n || ' lettre(s) à clé de trop, ' || case when v::text ~* interdit then 'un mot des honoraires' else 'aucun mot des honoraires' end,
      'ok', n = 0 and v::text !~* interdit
        and (select array_agg(x order by x collate "C") from jsonb_object_keys(v) x) = array['dossier_du_cabinet_designe', 'lettres']);
    select to_jsonb(t) into ligne from lettres_de_mission t where t.id = l;
    mutations := mutations || jsonb_build_object('mutation', 'M-MV6 — MV6 appliqué à la ligne de la table', 'attendu', 'un mot des honoraires',
      'observe', case when ligne::text ~* interdit then 'un mot des honoraires' else 'aucun' end, 'mord', ligne::text ~* interdit);
    raise exception 'annuler le jeu' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- MV7 : le catalogue.
  select count(*) into n from pg_proc p
   where p.oid = to_regprocedure('public.missions_du_client(uuid)') and p.prosecdef and p.provolatile = 's'
     and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=public'
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false);
  verdicts := verdicts || jsonb_build_object('controle', 'MV7. la lecture des missions d''un client : security definer, chemin fixé, stable, exécutable par authenticated seul (lecture du catalogue)',
    'cible', 'missions_du_client', 'observe', n || ' telle(s) quelle(s)', 'ok', n = 1);
  verdicts := verdicts || jsonb_build_object('controle', 'MV. le jeu d''essai des missions d''un client s''est construit, et rien n''en est resté', 'cible', 'les dossiers jetables',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null and not exists (select 1 from dossiers where id in (k, c))
      and not exists (select 1 from cabinets where dossier_du_cabinet = k));

  insert into rls_verdict select v2.controle, v2.cible, v2.observe, v2.ok
    from jsonb_to_recordset(verdicts) as v2(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m2.mutation, m2.attendu, m2.observe, m2.mord
    from jsonb_to_recordset(mutations) as m2(mutation text, attendu text, observe text, mord boolean);
end $mv$;

-- ═══ Les lettres de mission dans l'espace client (LM6, ligne 47) ═══════════════════════════════════════════════════════
--
-- La migration `lettres_du_client` ne crée ni ne change aucune policy : une fonction de lecture `security definer` rend, au
-- client d'un dossier qui porte la case « Documents » (B1), ses lettres de mission PROPOSÉES, figées, honoraires compris
-- (le contrat est le sien), sans auteur, sans le dossier du cabinet ni le papier signé — alors que les deux tables restent
-- fermées à qui n'est pas du dossier du cabinet. Ce qu'elle ouvre et ferme : l'anonyme ne l'exécute pas (LC1) ; un compte
-- rattaché à rien est refusé en 42501, la raison exigée (LC2) ; le client sans la case aussi (LC3) ; un membre de l'équipe
-- assigné au dossier du client aussi : le cabinet lit ses lettres dans son dossier (LC4) ; le client qui porte la case lit
-- — le contrôle POSITIF — alors que les tables lui restent fermées (LC5) ; la valeur ne porte ni auteur, ni le dossier du
-- cabinet, ni le compte du signataire, ni le document signé (LC6) ; au catalogue, `security definer`, chemin fixé,
-- `stable`, exécutable par `authenticated` seul (LC7). Le jeu : deux dossiers jetables du cabinet de la réplique et son
-- membre d'équipe, dans une sous-transaction annulée. Trois mutations, qui doivent mordre. EN ATTENTE tant que la fonction
-- n'est pas en base. Ce qu'elle rend en détail (l'ordre, les brouillons, l'autre client, l'empreinte qui ne répond plus,
-- le cabinet sans dossier désigné) : `lettresDuClient.sql`.
do $lc$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre uuid := '3e3b0000-0000-4000-8000-000000000001';
  inconnu uuid := gen_random_uuid();
  cabinet uuid := 'cab10000-0000-4000-8000-000000000001';
  k uuid := '1a100000-0000-4000-8000-0000000000ec';
  c uuid := '1a100000-0000-4000-8000-0000000000ed';
  refus text := 'Accès refusé à ce dossier.';
  interdit text;
  m uuid; l uuid; v jsonb;
  etat text; message text; erreur text; construit boolean := false; n bigint;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.lettres_de_mission_du_client(uuid)') is null then
    insert into rls_verdict values ('LC. les lettres de mission du client : EN ATTENTE de la migration lettres_du_client',
      'lettres_de_mission_du_client', 'absente : ses droits se jugent dès que la migration y est', true);
    return;
  end if;
  interdit := '(' || k || '|' || chef || '|"proposee_par"|"auteur"|"signataire_compte"|"document_signe_id"|"empreinte_papier"|"dossier_id")';
  begin
    -- ── Le jeu : le chef désigne K, y écrit un modèle et une lettre pour C (un forfait de 2468.13 €), et la propose ──
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, siret, adresse) values
      (k, 'RLS DOSSIER DU CABINET LC', cabinet, 'tresorerie', '455000', '12345678200010', 'RLS ADRESSE'),
      (c, 'RLS CLIENT LC', cabinet, 'tresorerie', '455000', null, 'RLS ADRESSE');
    insert into memberships (user_id, dossier_id, role, email) values (client, c, 'client', 'rls-lc@example.test');
    insert into dossier_assignations (dossier_id, user_id) values (c, membre);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform public.designer_dossier_du_cabinet(cabinet, k);
    select (public.enregistrer_modele_de_lettre(k, 'Modèle RLS LC', 'Conditions RLS',
      '{"tenue_comptable": "Tenir la comptabilité."}'::jsonb, '{"sous_traitance": "Clause RLS."}'::jsonb, null)).id into m;
    select (public.enregistrer_brouillon_de_lettre(k, null, jsonb_build_object('dossier_client_id', c, 'modele_id', m,
      'missions', jsonb_build_array('tenue_comptable'), 'date_effet', '2026-01-01', 'premier_exercice', 2026,
      'fin_initiale', '2026-12-31', 'signataire_nom', 'Signataire RLS', 'signataire_qualite', 'Titulaire', 'repartition', '[{"tache": "Transmettre les pièces", "par": "client"}]'::jsonb,
      'honoraires', '[{"forme": "forfait", "libelle": "Tenue RLS", "montant_ht": 2468.13, "periodicite": "trimestre"}]'::jsonb), null)).id into l;
    perform public.proposer_lettre_de_mission(k, l, (select modifiee_le from lettres_de_mission where id = l));
    reset role;
    construit := true;

    -- LC1 : l'anonyme n'exécute pas la fonction.
    begin
      set local role anon;
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      perform public.lettres_de_mission_du_client(c);
      etat := 'acceptée';
    exception when others then etat := sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'LC1. anonyme n''exécute pas la lecture des lettres de mission du client', 'cible', 'lettres_de_mission_du_client',
      'observe', etat, 'ok', etat = '42501');

    -- LC2, LC3, LC4 : un compte rattaché à rien ; le client sans la case « Documents » ; le membre assigné au dossier du client.
    for etat, message in
      select q.qui::text, q.controle from (values
        (inconnu, 'LC2. inconnu authentifié ne lit pas les lettres de mission d''un client'),
        (client, 'LC3. client sans la case « Documents » ne lit pas les lettres de mission de son dossier'),
        (membre, 'LC4. membre de l''équipe assigné au dossier du client ne passe pas par la lecture du client')) as q(qui, controle)
    loop
      declare r text;
      begin
        begin
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub', etat, 'role', 'authenticated')::text, true);
          perform public.lettres_de_mission_du_client(c);
          r := 'acceptée';
        exception when others then r := sqlstate || ' ' || sqlerrm;
        end;
        reset role;
        verdicts := verdicts || jsonb_build_object('controle', message, 'cible', 'lettres_de_mission_du_client',
          'observe', r, 'ok', r = '42501 ' || refus);
      end;
    end loop;

    -- M-LC3 : LC3 rejoué avec la case — il lit.
    update memberships set droit_documents = true where dossier_id = c and user_id = client;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      v := public.lettres_de_mission_du_client(c);
      etat := 'acceptée';
    exception when others then etat := sqlstate; v := null;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-LC3 — LC3 rejoué avec la case « Documents »', 'attendu', 'la lecture acceptée',
      'observe', etat, 'mord', etat = 'acceptée');

    -- LC5 : avec la case, il lit sa lettre ; les deux tables lui restent fermées — comptées dans le seul dossier du cabinet
    -- de l'essai (k), comme M-LC5 : joué en production, l'essai ne rend rien qui dépende d'une ligne hors de ses dossiers.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select (select count(*) from lettres_de_mission where dossier_id = k) + (select count(*) from modeles_lettre_de_mission where dossier_id = k) into n;
    exception when others then n := -1;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'LC5. le client qui porte la case lit sa lettre proposée, les tables des lettres et des modèles fermées (contrôle positif)', 'cible', 'lettres_de_mission_du_client',
      'observe', coalesce(jsonb_array_length(v -> 'lettres'), -1) || ' lettre(s) ; ' || n || ' ligne(s) des tables',
      'ok', coalesce(jsonb_array_length(v -> 'lettres'), -1) = 1 and v -> 'lettres' -> 0 ->> 'id' = l::text and n = 0);
    -- M-LC5 : la même lecture des tables sous le chef — il les lit.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select (select count(*) from lettres_de_mission where dossier_id = k) + (select count(*) from modeles_lettre_de_mission where dossier_id = k) into n;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-LC5 — les tables relues sous le chef', 'attendu', 'la lettre et le modèle lus',
      'observe', n || ' ligne(s)', 'mord', n = 2);

    -- LC6 : ni auteur, ni dossier du cabinet, ni compte du signataire, ni papier signé ; M-LC6 : le même contrôle sur la
    -- ligne de la table.
    verdicts := verdicts || jsonb_build_object('controle', 'LC6. les lettres du client ne portent ni auteur, ni le dossier du cabinet, ni le compte du signataire, ni le papier signé', 'cible', 'lettres_de_mission_du_client',
      'observe', case when v is null then 'pas de valeur' when v::text ~ interdit then 'TROUVÉ' else 'aucun' end,
      'ok', v is not null and v::text !~ interdit);
    mutations := mutations || jsonb_build_object('mutation', 'M-LC6 — LC6 appliqué à la ligne de la table', 'attendu', 'un auteur ou le dossier du cabinet',
      'observe', case when (select to_jsonb(x) from lettres_de_mission x where x.id = l)::text ~ interdit then 'trouvé' else 'AVEUGLE' end,
      'mord', (select to_jsonb(x) from lettres_de_mission x where x.id = l)::text ~ interdit);

    raise exception using errcode = 'P0001', message = 'LC_ANNULE';
  exception
    when raise_exception then
      if sqlerrm <> 'LC_ANNULE' then erreur := sqlstate || ' ' || sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- LC7 : le catalogue.
  select count(*) into n from pg_proc p
   where p.oid = to_regprocedure('public.lettres_de_mission_du_client(uuid)') and p.prosecdef and p.provolatile = 's'
     and coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=public'
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false);
  verdicts := verdicts || jsonb_build_object('controle', 'LC7. la lecture des lettres de mission du client : security definer, chemin fixé, stable, exécutable par authenticated seul (lecture du catalogue)',
    'cible', 'lettres_de_mission_du_client', 'observe', n || ' telle(s) quelle(s)', 'ok', n = 1);
  verdicts := verdicts || jsonb_build_object('controle', 'LC. le jeu d''essai des lettres de mission du client s''est construit, et rien n''en est resté', 'cible', 'les dossiers jetables',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null and not exists (select 1 from dossiers where id in (k, c))
      and not exists (select 1 from cabinets where dossier_du_cabinet = k));

  insert into rls_verdict select v2.controle, v2.cible, v2.observe, v2.ok
    from jsonb_to_recordset(verdicts) as v2(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m2.mutation, m2.attendu, m2.observe, m2.mord
    from jsonb_to_recordset(mutations) as m2(mutation text, attendu text, observe text, mord boolean);
end $lc$;

-- ═══ La frontière des encaissements (chantier EC-Q3, étape VF7a) ═══════════════════════════════════════════════
--
-- Depuis la migration `frontiere_des_encaissements`, une garde aux droits du propriétaire
-- (`garder_frontiere_des_encaissements`) refuse, pour l'encaissement d'une facture SOURCE, ce que la frontière d'un
-- exercice validé fige — par n'importe quel chemin, les fonctions que le client « Ventes » appelle comprises. Elle
-- contourne la RLS : elle se rejoue, et son refus se juge à sa RAISON.
--   FE1. Le client qui porte « Ventes » et « Banque » ne date pas, par sa fonction, un encaissement dans un exercice
--        validé : refusé (22023), sous la raison de la frontière.
--   FE2. Ni n'y cite un mouvement que la frontière fige : la fonction le laisse passer, la garde le refuse (23514), sous
--        sa raison.
--   FE3. Le contrôle POSITIF : le même encaissement, daté après la frontière, sans mouvement, s'enregistre.
--   FE4. La garde ne s'exécute pas en RPC, ni pour l'anonyme ni pour un compte connecté (lecture du catalogue).
--   FE5. L'anonyme et un compte rattaché à rien qui nomment la facture source, en insertion directe : le refus de la garde
--        d'hier, qui lit la facture à LEURS droits — jamais la raison de la frontière, qui leur dirait que la facture est
--        source et qu'un exercice est validé. C'est pourquoi la garde de la frontière passe APRÈS celle d'hier (l'ordre des
--        noms) : une insertion se juge avant la RLS.
-- Le jeu, dans le dossier du client, le temps d'une sous-transaction annulée : le dossier bascule ; le relevé reçoit un
-- crédit au 31 décembre 2025 ; le chef valide une facture source de 2025 ; puis le propriétaire valide l'exercice 2025.
-- Trois mutations, qui doivent mordre : M-FE1 (avant l'exercice validé, la date passe), M-FE2 (un mouvement d'après la
-- frontière se cite), M-FE3 (la garde de la frontière renommée pour passer AVANT celle d'hier : l'anonyme lit la raison
-- de la frontière). Avant la migration, une ligne dit que la frontière attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  raison_date text := 'L''exercice 2025 est validé : un encaissement de cette facture ne s''y date plus.';
  raison_mouvement text := 'L''exercice 2025 est validé : ce mouvement ne se cite plus.';
  repartition jsonb := '[{"taux":20,"montant":1}]';
  f_source uuid; m_fige uuid; m_apres uuid; profil text; n bigint;
  accepte boolean; motif text; message text; erreur text; construit boolean := false; obs text;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.garder_frontiere_des_encaissements()') is null then
    insert into rls_verdict values ('FE. la frontière des encaissements : EN ATTENTE de la migration frontiere_des_encaissements',
      'garder_frontiere_des_encaissements', 'absente : la frontière se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu ──
    -- Les dossiers du client basculent AVANT que « Ventes » ne s'y porte (garder_droit_ventes, étape VF8f) — tous, le
    -- client pouvant en avoir plus d'un.
    update dossiers set ventes_par_les_factures = true
     where id in (select m.dossier_id from memberships m where m.user_id = client) and not ventes_par_les_factures;
    update memberships set droit_ventes = true, droit_banque = true where user_id = client;
    insert into lignes_bancaires (dossier_id, date, libelle, montant, statut)
      values (dossier_du_client, '2025-12-31', 'ESSAI RLS FE', 10, 'non_rapprochee') returning id into m_fige;
    insert into lignes_bancaires (dossier_id, date, libelle, montant, statut)
      values (dossier_du_client, '2026-01-05', 'ESSAI RLS FE', 10, 'non_rapprochee') returning id into m_apres;
    -- En franchise le temps du bloc, la facture portant sa mention (la correction de la facture, 31/10/2026).
    update dossiers set statut_tva = 'franchise', article_exoneration = null where id = dossier_du_client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select e.facture_id into f_source from enregistrer_facture(dossier_du_client, null,
      '{"tiers_nom":"ESSAI RLS FE","date_emission":"2025-06-15","mentions_legales":"TVA non applicable, art. 293 B du CGI.","montant_ht":100,"montant_tva":20,"montant_ttc":120,"type_client":"assujetti","tiers_adresse":"Adresse fictive du client","nature_operation":"services"}'::jsonb,
      '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true) e;
    reset role;

    -- M-FE1 : avant l'exercice validé, le client date l'encaissement du 30 décembre — la frontière seule le refusera.
    accepte := false;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_encaissement(dossier_du_client, f_source, '2025-12-30', 1, 'cheque', null, repartition);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then null;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-FE1 — FE1 rejoué avant que l''exercice 2025 soit validé',
      'attendu', 'l''encaissement du 30 décembre accepté', 'observe', case when accepte then 'accepté' else 'refusé' end, 'mord', accepte);

    insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit,
      total_credit, empreinte, declaration)
      values (dossier_du_client, 2025, now(), chef, (select d.mode_comptable from dossiers d where d.id = dossier_du_client),
        0, 0, 0, 0, repeat('f', 64), '{}');
    construit := true;

    -- FE1 : la date, par sa fonction.
    accepte := false; motif := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_encaissement(dossier_du_client, f_source, '2025-12-30', 1, 'cheque', null, repartition);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then motif := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'FE1. le client « Ventes » ne date pas, par sa fonction, un encaissement dans un exercice validé — la raison dite',
      'cible', 'enregistrer_encaissement', 'observe', case when accepte then 'accepté' else motif || ' ' || message end,
      'ok', not accepte and motif = '22023' and message = raison_date);

    -- FE2 : un mouvement figé cité, après la frontière — la garde.
    accepte := false; motif := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_encaissement(dossier_du_client, f_source, '2026-01-05', 1, 'virement', m_fige, repartition);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then motif := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'FE2. … ni n''y cite un mouvement figé : la garde le refuse, la raison dite',
      'cible', 'garder_frontiere_des_encaissements', 'observe', case when accepte then 'accepté' else motif || ' ' || message end,
      'ok', not accepte and motif = '23514' and message = raison_mouvement);

    -- M-FE2 : un mouvement d'après la frontière se cite.
    accepte := false;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_encaissement(dossier_du_client, f_source, '2026-01-05', 1, 'virement', m_apres, repartition);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then null;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-FE2 — FE2 rejoué sur un mouvement du 5 janvier 2026',
      'attendu', 'l''encaissement accepté', 'observe', case when accepte then 'accepté' else 'refusé' end, 'mord', accepte);

    -- FE3 : le contrôle positif.
    accepte := false; motif := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_encaissement(dossier_du_client, f_source, '2026-01-05', 1, 'virement', null, repartition);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then motif := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'FE3. le contrôle positif : daté après la frontière, sans mouvement, il s''enregistre',
      'cible', 'enregistrer_encaissement', 'observe', case when accepte then 'accepté' else motif || ' ' || message end,
      'ok', accepte and motif = 'P0001');

    -- FE5 : l'anonyme et un compte rattaché à rien, en insertion directe, ne lisent pas la raison de la frontière.
    foreach profil in array array['anon', 'inconnu'] loop
      accepte := false; motif := null; message := null;
      begin
        execute format('set local role %I', case profil when 'anon' then 'anon' else 'authenticated' end);
        perform set_config('request.jwt.claims', case profil when 'anon' then '{"role":"anon"}'
          else json_build_object('sub', inconnu, 'role', 'authenticated')::text end, true);
        insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen)
          values (dossier_du_client, f_source, '2025-12-30', 1, 'cheque');
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then motif := sqlstate; message := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', 'FE5. l''anonyme et un compte rattaché à rien : le refus de la garde d''hier, jamais la raison de la frontière',
        'cible', profil, 'observe', case when accepte then 'accepté' else motif || ' ' || message end,
        -- La porte d'accès en base (acces_avant_les_gardes) : la RLS refuse avant toute garde, ni l'une ni l'autre ne parle.
        'ok', not accepte and case when exists (select 1 from pg_trigger g where g.tgrelid = 'public.encaissements_factures'::regclass and g.tgname = '_acces_avant_les_gardes')
                                   then motif = '42501' and message = 'new row violates row-level security policy for table "encaissements_factures"'
                                   else motif = '23514' and message like 'Seule une facture validée de son dossier reçoit un encaissement%' end);
    end loop;

    -- M-FE3 : la garde de la frontière renommée pour passer AVANT celle d'hier — l'anonyme lirait sa raison.
    obs := null;
    begin
      alter trigger encaissements_factures_gardes_frontiere on public.encaissements_factures rename to encaissements_factures_a_frontiere;
      -- La porte d'accès en base, elle se coupe aussi : sans elle, la mutation montre ce que FE5 verrait.
      if exists (select 1 from pg_trigger g where g.tgrelid = 'public.encaissements_factures'::regclass and g.tgname = '_acces_avant_les_gardes') then
        alter table public.encaissements_factures disable trigger _acces_avant_les_gardes;
      end if;
      begin
        set local role anon;
        perform set_config('request.jwt.claims', '{"role":"anon"}', true);
        insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen)
          values (dossier_du_client, f_source, '2025-12-30', 1, 'cheque');
      exception when others then obs := sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then null;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-FE3 — FE5 rejoué, la garde de la frontière passant avant celle d''hier',
      'attendu', 'l''anonyme lit la raison de la frontière', 'observe', coalesce(obs, 'accepté'), 'mord', obs = raison_date);

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  -- FE4 : la garde hors de portée en RPC (lecture du catalogue).
  select count(*) into n from pg_proc p
   where p.oid = to_regprocedure('public.garder_frontiere_des_encaissements()') and p.prosecdef
     and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute');
  verdicts := verdicts || jsonb_build_object('controle', 'FE4. la garde de la frontière ne s''exécute pas en RPC (lecture du catalogue)',
    'cible', 'garder_frontiere_des_encaissements', 'observe', case when n = 1 then 'security definer, ni anon ni authenticated' else 'EXÉCUTABLE OU ABSENTE' end,
    'ok', n = 1);
  verdicts := verdicts || jsonb_build_object('controle', 'FE. le jeu d''essai de la frontière s''est construit', 'cible', 'frontière',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ VB. La validation des ventes facturées (chantier EC-Q3, étape VF7b ; migration `validation_des_ventes_facturees`) ══
-- Deux fonctions neuves, `ecritures_attendues_de_la_periode` et `ventes_facturees_de_l_exercice`, lisent tout un dossier
-- aux droits de l'appelant : seule la validation les appelle, aux droits du propriétaire. Elles ne s'exécutent donc pas
-- en RPC — ni par l'anonyme, ni par un client, ni par le chef du cabinet (VB1, VB3). Et `valider_exercice`, qui refuse
-- désormais un mouvement réservé sous son nom, refuse le client « Ventes » et « Banque » sur son propre dossier basculé
-- sous les mots d'hier, AVANT toute lecture : il n'apprend pas qu'un mouvement y est réservé à l'encaissement d'une facture
-- (VB2) — ce que la mutation M-VB2, le client fait chef du cabinet le temps d'un appel, fait lire.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  refus_chef text := 'Seul le chef du cabinet valide un exercice.';
  f_source uuid; m_reserve uuid; cabinet_du_client uuid; profil text; fonction text; n bigint;
  accepte boolean; motif text; message text; erreur text; construit boolean := false; obs text;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.ventes_facturees_de_l_exercice(uuid, integer)') is null then
    insert into rls_verdict values ('VB. la validation des ventes facturées : EN ATTENTE de la migration validation_des_ventes_facturees',
      'ventes_facturees_de_l_exercice', 'absente : ses droits se jugent dès que la migration y est', true);
    return;
  end if;
  select d.cabinet_id into cabinet_du_client from dossiers d where d.id = dossier_du_client;
  begin
    -- ── Le jeu : le dossier du client bascule ; une facture source de 2025, son encaissement par virement sur un crédit de
    -- son jour, que rien ne classe — le mouvement est réservé. ──
    -- Les dossiers du client basculent AVANT que « Ventes » ne s'y porte (garder_droit_ventes, étape VF8f) — tous, le
    -- client pouvant en avoir plus d'un.
    update dossiers set ventes_par_les_factures = true
     where id in (select m.dossier_id from memberships m where m.user_id = client) and not ventes_par_les_factures;
    update memberships set droit_ventes = true, droit_banque = true where user_id = client;
    insert into lignes_bancaires (dossier_id, date, libelle, montant, statut)
      values (dossier_du_client, '2025-03-10', 'ESSAI RLS VB', 120, 'non_rapprochee') returning id into m_reserve;
    -- En franchise le temps du bloc, la facture portant sa mention (la correction de la facture, 31/10/2026).
    update dossiers set statut_tva = 'franchise', article_exoneration = null where id = dossier_du_client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select e.facture_id into f_source from enregistrer_facture(dossier_du_client, null,
      '{"tiers_nom":"ESSAI RLS VB","date_emission":"2025-03-01","mentions_legales":"TVA non applicable, art. 293 B du CGI.","montant_ht":100,"montant_tva":20,"montant_ttc":120,"type_client":"assujetti","tiers_adresse":"Adresse fictive du client","nature_operation":"services"}'::jsonb,
      '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true) e;
    perform enregistrer_encaissement(dossier_du_client, f_source, '2025-03-10', 120, 'virement', m_reserve, '[{"taux":20,"montant":120}]'::jsonb);
    reset role;
    construit := true;

    -- VB1 : les deux fonctions neuves, en RPC, par l'anonyme, un compte rattaché à rien, le client, le chef.
    foreach fonction in array array['ventes_facturees_de_l_exercice', 'ecritures_attendues_de_la_periode'] loop
      foreach profil in array array['anon', 'inconnu', 'client', 'chef'] loop
        accepte := false; motif := null; message := null;
        begin
          execute format('set local role %I', case profil when 'anon' then 'anon' else 'authenticated' end);
          perform set_config('request.jwt.claims', case profil when 'anon' then '{"role":"anon"}'
            else json_build_object('sub', case profil when 'inconnu' then inconnu when 'client' then client else chef end,
                                   'role', 'authenticated')::text end, true);
          if fonction = 'ventes_facturees_de_l_exercice' then
            perform count(*) from ventes_facturees_de_l_exercice(dossier_du_client, 2025);
          else
            perform count(*) from ecritures_attendues_de_la_periode(dossier_du_client, null, '2025-12-31');
          end if;
          accepte := true;
          raise exception 'ANNULATION_ESSAI';
        exception when others then motif := sqlstate; message := sqlerrm;
        end;
        reset role;
        verdicts := verdicts || jsonb_build_object('controle', 'VB1. les deux fonctions neuves ne s''exécutent pas en RPC, pas même par le chef du cabinet',
          'cible', fonction || ' / ' || profil, 'observe', case when accepte then 'accepté' else motif || ' ' || message end,
          'ok', not accepte and motif = '42501' and message = 'permission denied for function ' || fonction);
      end loop;
    end loop;

    -- M-VB1 : les deux fonctions ouvertes à `authenticated` (la première appelle la seconde) — l'appel du client ne bute
    -- plus sur elles, et VB1 le verrait (ce qu'il rencontre ensuite, une fonction plus profonde qu'il n'exécute pas, est
    -- une défense de plus, pas celle que VB1 juge).
    obs := null;
    begin
      grant execute on function public.ventes_facturees_de_l_exercice(uuid, integer) to authenticated;
      grant execute on function public.ecritures_attendues_de_la_periode(uuid, date, date) to authenticated;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform count(*) from ventes_facturees_de_l_exercice(dossier_du_client, 2025);
      obs := 'accepté';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if obs is null then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-VB1 — VB1 rejoué, les deux fonctions ouvertes à authenticated',
      'attendu', 'l''appel ne bute plus sur la fonction des sources en défaut', 'observe', coalesce(obs, '?'),
      'mord', obs is distinct from '42501 permission denied for function ventes_facturees_de_l_exercice');

    -- VB2 : le client « Ventes » et « Banque », sur son propre dossier basculé : le refus d'hier, avant toute lecture.
    accepte := false; motif := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform valider_exercice(dossier_du_client, 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then motif := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'VB2. le client « Ventes » et « Banque » ne valide pas son dossier basculé, et ne lit pas qu''un mouvement y est réservé',
      'cible', 'valider_exercice', 'observe', case when accepte then 'accepté' else motif || ' ' || message end,
      'ok', not accepte and motif = '42501' and message = refus_chef);

    -- M-VB2 : le client fait chef du cabinet le temps de l'appel — il passe le refus d'hier, et lit la suite.
    obs := null;
    begin
      insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet_du_client, 'comptable_en_chef');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform valider_exercice(dossier_du_client, 2025, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb);
      raise exception 'ANNULATION_ESSAI';
    exception when others then obs := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-VB2 — VB2 rejoué, le client fait chef du cabinet',
      'attendu', 'un autre refus que celui du chef', 'observe', coalesce(obs, '?'),
      'mord', obs is distinct from '42501 ' || refus_chef);

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  -- VB3 : lecture du catalogue — aux droits de l'appelant, et exécutables par personne de l'API.
  select count(*) into n from pg_proc p
   where p.oid in (to_regprocedure('public.ventes_facturees_de_l_exercice(uuid, integer)'),
                   to_regprocedure('public.ecritures_attendues_de_la_periode(uuid, date, date)'))
     and not p.prosecdef
     and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute');
  verdicts := verdicts || jsonb_build_object('controle', 'VB3. les deux fonctions neuves, aux droits de l''appelant, exécutables par personne de l''API (lecture du catalogue)',
    'cible', 'ventes_facturees_de_l_exercice, ecritures_attendues_de_la_periode',
    'observe', n || ' sur 2', 'ok', n = 2);
  verdicts := verdicts || jsonb_build_object('controle', 'VB. le jeu d''essai de la validation des ventes facturées s''est construit', 'cible', 'validation',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ SI. La simulation des ventes facturées (chantier EC-Q3, étape VF8e ; migration `simulation_des_ventes_facturees`) ══
-- Une fonction neuve, `ventes_facturees_de_la_simulation`, lit aux droits de son propriétaire les factures d'un dossier,
-- leurs lignes, leurs encaissements et leurs parts, et ne rend que le total hors taxe de chaque mois de l'année et les
-- identifiants des factures et avoirs sources — à qui la case « Banque » ouvre le dossier (VF8-Q2). Elle contourne la
-- RLS : elle se rejoue, chaque refus jugé à sa RAISON.
--   SI1. Le client qui porte « Banque » sur son dossier basculé la lit, et y trouve le hors-taxe de sa facture source et
--        son identifiant — le contrôle POSITIF : sans lui, une fonction qui refuserait tout le monde passerait la suite.
--        Le hors-taxe se juge par l'ÉCART : le total du mois relu avant la construction, puis après — jamais une valeur
--        que les autres lignes du dossier feraient varier.
--   SI2. Sans « Banque » — « Ventes » seule, puis aucune case —, sur son propre dossier : « Accès refusé à ce dossier. »
--        (42501).
--   SI3. L'autre dossier, où il n'a aucun accès, ses deux cases posées sur le sien : refusé de même.
--   SI4. L'anonyme bute sur le droit d'exécution (42501, « permission denied for function … ») ; un compte rattaché à rien,
--        sur la raison de la fonction.
--   SI5. Le catalogue : `security definer`, son chemin fixé ; exécutable par les connectés, ni par l'anonyme ni par PUBLIC.
-- Trois mutations, qui doivent mordre : M-SI1 (SI1 rejoué sans « Banque » : refusé), M-SI2 (SI2 rejoué avec « Banque » :
-- accepté), M-SI3 (l'exécution rendue à l'anonyme : il lit la raison de la fonction, plus le droit d'exécution). Le jeu,
-- dans le dossier du client, le temps d'une sous-transaction annulée : le dossier bascule ; le chef y valide une facture
-- source de 2026, de 100 € hors taxe, et son encaissement du même mois. Sa date se CALCULE : le 10/01/2026, ou la plus
-- récente des factures validées de la série F2026 du dossier si elle est plus tardive — la garde des factures refuse
-- une date d'avant (la correction de la facture, 02/11/2026), et la production porte des factures validées de cette
-- série dans ce dossier ; l'encaissement cinq jours après, dans le même mois, jamais après le jour de Paris. Avant la
-- migration, une ligne dit que la simulation attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  autre_dossier     uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  refus text := 'Accès refusé à ce dossier.';
  f_source uuid; profil text; n bigint; v jsonb;
  accepte boolean; motif text; message text; erreur text; construit boolean := false; obs text;
  jour_facture date; jour_encaissement date; mois text; avant bigint;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.ventes_facturees_de_la_simulation(uuid, integer)') is null then
    insert into rls_verdict values ('SI. la simulation des ventes facturées : EN ATTENTE de la migration simulation_des_ventes_facturees',
      'ventes_facturees_de_la_simulation', 'absente : ses droits se jugent dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu, sans session : le propriétaire bascule le dossier (la garde du réglage ne juge que les sessions) ──
    perform set_config('request.jwt.claims', '', true);
    update memberships set droit_ventes = false, droit_banque = true where user_id = client;
    -- Tous ses dossiers : « Ventes » s'y porte ensuite sur chacun de ses accès (SI2, M-SI2, SI3 ; garder_droit_ventes,
    -- étape VF8f).
    update dossiers set ventes_par_les_factures = true
     where id in (select m.dossier_id from memberships m where m.user_id = client) and not ventes_par_les_factures;
    -- En franchise le temps du bloc, la facture portant sa mention (la correction de la facture, 31/10/2026).
    update dossiers set statut_tva = 'franchise', article_exoneration = null where id = dossier_du_client;
    -- La date de la facture : le 10/01/2026, ou la plus récente facture validée de sa série si elle est plus tardive
    -- (`greatest` ignore le nul d'une série vide) ; l'encaissement cinq jours après, sans quitter le mois de la facture
    -- (qu'une simulation en trésorerie compte à l'encaissement, en engagement à l'émission) ni dépasser le jour de Paris.
    select greatest(date '2026-01-10', max(f.date_emission)) into jour_facture
      from factures_emises f
     where f.dossier_id = dossier_du_client and f.statut = 'validee' and split_part(f.numero, '-', 1) = 'F2026';
    jour_encaissement := least(jour_facture + 5, (date_trunc('month', jour_facture) + interval '1 month - 1 day')::date,
                               (now() at time zone 'Europe/Paris')::date);
    mois := to_char(jour_facture, 'YYYY-MM');
    -- Le total du mois AVANT la construction, lu comme SI1 le lira : SI1 juge l'écart.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    avant := coalesce((ventes_facturees_de_la_simulation(dossier_du_client, 2026) -> 'par_mois' ->> mois)::bigint, 0);
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select e.facture_id into f_source from enregistrer_facture(dossier_du_client, null,
      jsonb_build_object('tiers_nom', 'ESSAI RLS SI', 'date_emission', jour_facture,
        'mentions_legales', 'TVA non applicable, art. 293 B du CGI.', 'montant_ht', 100, 'montant_tva', 20, 'montant_ttc', 120,
        'type_client', 'assujetti', 'tiers_adresse', 'Adresse fictive du client', 'nature_operation', 'services'),
      '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true) e;
    perform enregistrer_encaissement(dossier_du_client, f_source, jour_encaissement, 120, 'cheque', null, '[{"taux":20,"montant":120}]'::jsonb);
    reset role;
    construit := true;

    -- SI1 : le client « Banque », sur son dossier basculé.
    accepte := false; motif := null; message := null; v := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      v := ventes_facturees_de_la_simulation(dossier_du_client, 2026);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then motif := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'SI1. le client « Banque » lit la simulation de son dossier basculé (contrôle positif)',
      'cible', 'ventes_facturees_de_la_simulation', 'observe', case when accepte then coalesce(v::text, '∅') else motif || ' ' || message end,
      'ok', accepte and motif = 'P0001' and coalesce((v -> 'par_mois' ->> mois)::bigint, 0) - avant = 10000
        and (v -> 'sources') ? f_source::text);

    -- M-SI1 : le même, sans « Banque ».
    obs := null;
    begin
      update memberships set droit_banque = false where user_id = client;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform ventes_facturees_de_la_simulation(dossier_du_client, 2026);
      obs := 'accepté';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if obs is null then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-SI1 — SI1 rejoué sans la case « Banque »',
      'attendu', 'refusé', 'observe', obs, 'mord', obs = '42501 ' || refus);

    -- SI2 : sans « Banque » — « Ventes » seule, puis aucune case.
    foreach profil in array array['ventes', 'aucune'] loop
      accepte := false; motif := null; message := null;
      begin
        update memberships set droit_ventes = (profil = 'ventes'), droit_banque = false where user_id = client;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        perform ventes_facturees_de_la_simulation(dossier_du_client, 2026);
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then motif := sqlstate; message := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', 'SI2. sans la case « Banque », le client ne lit pas la simulation de son dossier',
        'cible', profil, 'observe', case when accepte then 'accepté' else motif || ' ' || message end,
        'ok', not accepte and motif = '42501' and message = refus);
    end loop;

    -- M-SI2 : SI2 rejoué avec « Banque ».
    obs := null;
    begin
      update memberships set droit_ventes = true, droit_banque = true where user_id = client;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform ventes_facturees_de_la_simulation(dossier_du_client, 2026);
      obs := 'accepté';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if obs is null then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-SI2 — SI2 rejoué avec la case « Banque »',
      'attendu', 'accepté', 'observe', obs, 'mord', obs = 'accepté');

    -- SI3 : l'autre dossier, ses deux cases posées sur le sien.
    accepte := false; motif := null; message := null;
    begin
      update memberships set droit_ventes = true, droit_banque = true where user_id = client;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform ventes_facturees_de_la_simulation(autre_dossier, 2026);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then motif := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'SI3. le client ne lit pas la simulation d''un autre dossier',
      'cible', 'autre dossier', 'observe', case when accepte then 'accepté' else motif || ' ' || message end,
      'ok', not accepte and motif = '42501' and message = refus);

    -- SI4 : l'anonyme, puis un compte rattaché à rien.
    foreach profil in array array['anon', 'inconnu'] loop
      accepte := false; motif := null; message := null;
      begin
        execute format('set local role %I', case profil when 'anon' then 'anon' else 'authenticated' end);
        perform set_config('request.jwt.claims', case profil when 'anon' then '{"role":"anon"}'
          else json_build_object('sub', inconnu, 'role', 'authenticated')::text end, true);
        perform ventes_facturees_de_la_simulation(dossier_du_client, 2026);
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then motif := sqlstate; message := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', 'SI4. l''anonyme n''exécute pas la fonction ; un compte rattaché à rien est refusé',
        'cible', profil, 'observe', case when accepte then 'accepté' else motif || ' ' || message end,
        'ok', not accepte and motif = '42501'
          and message = case profil when 'anon' then 'permission denied for function ventes_facturees_de_la_simulation' else refus end);
    end loop;

    -- M-SI3 : l'exécution rendue à l'anonyme — il lit la raison de la fonction, plus le droit d'exécution.
    obs := null;
    begin
      grant execute on function public.ventes_facturees_de_la_simulation(uuid, integer) to anon;
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      perform ventes_facturees_de_la_simulation(dossier_du_client, 2026);
      obs := 'accepté';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if obs is null then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-SI3 — SI4 rejoué, l''exécution rendue à l''anonyme',
      'attendu', 'un autre refus que le droit d''exécution', 'observe', coalesce(obs, '?'),
      'mord', obs is distinct from '42501 permission denied for function ventes_facturees_de_la_simulation');

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  -- SI5 : le catalogue.
  select count(*) into n from pg_proc p
   where p.oid = to_regprocedure('public.ventes_facturees_de_la_simulation(uuid, integer)') and p.prosecdef
     and p.proconfig @> array['search_path=public']
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0);
  verdicts := verdicts || jsonb_build_object('controle', 'SI5. security definer, son chemin fixé ; les connectés l''exécutent, ni l''anonyme ni PUBLIC (lecture du catalogue)',
    'cible', 'ventes_facturees_de_la_simulation', 'observe', case when n = 1 then 'conforme' else 'NON CONFORME' end, 'ok', n = 1);
  verdicts := verdicts || jsonb_build_object('controle', 'SI. le jeu d''essai de la simulation s''est construit', 'cible', 'simulation',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ EQ. L'équipe ne change que par son rôle (23Q2Q2-Q3 ; migration `equipe_par_son_role`) ═══════════════════════════════
-- La policy de mise à jour de `cabinet_admins` ne juge que le cabinet (`est_chef_du_cabinet`), avant et après l'écriture :
-- tant qu'`authenticated` portait UPDATE sur la table entière, un chef changeait le COMPTE d'une ligne de son équipe pour
-- celui d'un client de ses dossiers, sans passer par `create-team-member` (le « trouvé en passant » de 23Q2-Q2). Depuis la
-- migration, le droit ne vaut plus que pour la colonne `role` : il se juge avant la policy, et refuse en 42501 toute
-- écriture qui nomme une autre colonne, quelle que soit la valeur.
--   EQ1. Le contrôle POSITIF : le chef change le rôle d'un membre de son équipe — une ligne touchée ; sans lui, un droit
--        retiré à tous passerait la suite, et la page de l'équipe ne changerait plus aucun rôle.
--   EQ2. Ni le compte (`user_id`), ni le cabinet (`cabinet_id`), ni l'adresse (`email`) : chacun refusé par le droit
--        (42501, « permission denied for table cabinet_admins »), même remis à sa propre valeur — le droit se juge avant
--        toute contrainte —, et le rôle avec l'adresse dans la même écriture aussi.
--   EQ3. Le chef retire toujours un membre (« Retirer ») : une ligne ôtée — la suppression n'a pas bougé.
--   EQ4. Le catalogue : `authenticated` ne met plus à jour la table, seulement `role`, sans pouvoir transmettre ce droit,
--        et garde la lecture et la suppression ; `service_role` (les Edge Functions) garde l'insertion et la mise à jour
--        de la table.
--   EQ5. L'anonyme ne change aucune ligne : il garde ses droits de table, comme sur toute table du schéma, et la policy,
--        qu'aucune session ne satisfait, n'en laisse passer aucune.
-- Cinq mutations, qui doivent mordre : M-EQ1 (UPDATE rendu sur la table, la migration défaite : les quatre écritures
-- d'EQ2 passent), M-EQ2 (le droit sur `role` retiré : EQ1 se refuse), M-EQ3 (EQ2 jugé sur un échec sans rapport — une
-- colonne qui n'existe pas, 42703 —, qui doit être EN FAUTE : la RAISON est exigée), M-EQ4 (EQ1 joué par le membre
-- lui-même, un comptable : aucune ligne), M-EQ5 (EQ5 joué par le chef : le rôle change). Le jeu, le temps d'une
-- sous-transaction annulée : le client entre dans l'équipe du cabinet du chef, comme comptable, sous une adresse
-- fictive. Avant la migration, une ligne dit que l'équipe attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  refus text := 'permission denied for table cabinet_admins';
  -- Les écritures d'EQ2 sur la ligne du membre : une colonne autre que `role`, remise à sa propre valeur quand une autre
  -- buterait sur une contrainte (le droit se juge avant elle, et M-EQ1 les accepte toutes sans lui), puis le rôle avec
  -- l'adresse.
  ecritures text[] := array[
    'user_id = user_id',
    'cabinet_id = cabinet_id',
    'email = ''autre-membre@example.test''',
    'role = ''comptable_en_chef'', email = ''autre-membre@example.test'''];
  ecriture text; cabinet_du_chef uuid; touchees int; n bigint;
  accepte boolean; motif text; message text; erreur text; construit boolean := false; obs text;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if has_table_privilege('authenticated', 'public.cabinet_admins', 'UPDATE')
     and not exists (select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) d
                      where a.attrelid = 'public.cabinet_admins'::regclass and a.attnum > 0 and not a.attisdropped) then
    insert into rls_verdict values ('EQ. l''équipe ne change que par son rôle : EN ATTENTE de la migration equipe_par_son_role',
      'cabinet_admins', 'UPDATE sur la table, aucun droit par colonne : ses droits se jugent dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : le client entre dans l'équipe du cabinet du chef, comme comptable ──
    select ca.cabinet_id into cabinet_du_chef from cabinet_admins ca where ca.user_id = chef;
    insert into cabinet_admins (user_id, cabinet_id, role, email)
      values (client, cabinet_du_chef, 'comptable', 'membre-essai@example.test');
    construit := true;

    -- EQ1 : le chef change le rôle du membre.
    touchees := 0; motif := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      update cabinet_admins set role = 'comptable_en_chef' where user_id = client;
      get diagnostics touchees = row_count;
      raise exception 'ANNULATION_ESSAI';
    exception when others then motif := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'EQ1. le chef change le rôle d''un membre de son équipe (contrôle positif)',
      'cible', 'role', 'observe', touchees || ' ligne(s), ' || coalesce(motif, '?') || ' ' || coalesce(message, '?'),
      'ok', touchees = 1 and motif = 'P0001' and message = 'ANNULATION_ESSAI');

    -- EQ2 : ni le compte, ni le cabinet, ni l'adresse.
    foreach ecriture in array ecritures loop
      accepte := false; motif := null; message := null;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        execute format('update public.cabinet_admins set %s where user_id = $1', ecriture) using client;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then motif := sqlstate; message := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', 'EQ2. ni le compte, ni le cabinet, ni l''adresse : le droit refuse (42501), le rôle avec l''adresse aussi',
        'cible', ecriture, 'observe', case when accepte then 'accepté' else motif || ' ' || message end,
        'ok', not accepte and motif = '42501' and message = refus);
    end loop;

    -- M-EQ1 : UPDATE rendu sur la table (la migration défaite) — les quatre écritures d'EQ2 passent.
    obs := '';
    begin
      grant update on table public.cabinet_admins to authenticated;
      foreach ecriture in array ecritures loop
        accepte := false;
        begin
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute format('update public.cabinet_admins set %s where user_id = $1', ecriture) using client;
          get diagnostics touchees = row_count;
          accepte := touchees = 1;
          raise exception 'ANNULATION_ESSAI';
        exception when others then null;
        end;
        reset role;
        obs := obs || case when accepte then 'acceptée ' else 'refusée ' end;
      end loop;
      raise exception 'ANNULATION_ESSAI';
    exception when others then null;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-EQ1 — EQ2 rejoué, UPDATE rendu sur la table (la migration défaite)',
      'attendu', 'les quatre écritures acceptées', 'observe', obs, 'mord', obs = 'acceptée acceptée acceptée acceptée ');

    -- M-EQ2 : le droit sur `role` retiré — EQ1 se refuse.
    obs := null;
    begin
      revoke update (role) on table public.cabinet_admins from authenticated;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      update cabinet_admins set role = 'comptable_en_chef' where user_id = client;
      obs := 'accepté';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if obs is null then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-EQ2 — EQ1 rejoué, le droit sur role retiré',
      'attendu', 'refusé par le droit', 'observe', obs, 'mord', obs = '42501 ' || refus);

    -- M-EQ3 : le jugement d'EQ2 sur un échec sans rapport — une colonne qui n'existe pas (42703) : il doit être EN FAUTE.
    accepte := false; motif := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      execute format('update public.cabinet_admins set %s where user_id = $1', 'colonne_qui_n_existe_pas = 1') using client;
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then motif := sqlstate; message := sqlerrm;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-EQ3 — EQ2 jugé sur un échec sans rapport (une colonne qui n''existe pas)',
      'attendu', 'EN FAUTE', 'observe', 'sqlstate ' || coalesce(motif, '?'),
      'mord', not (not accepte and motif = '42501' and message = refus));

    -- M-EQ4 : EQ1 joué par le membre lui-même, un comptable — la policy ne lui ouvre aucune ligne.
    touchees := 0; motif := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      update cabinet_admins set role = 'comptable_en_chef' where user_id = client;
      get diagnostics touchees = row_count;
      raise exception 'ANNULATION_ESSAI';
    exception when others then motif := sqlstate;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-EQ4 — EQ1 joué par le membre lui-même, un comptable',
      'attendu', 'aucune ligne', 'observe', touchees || ' ligne(s), ' || coalesce(motif, '?'), 'mord', touchees = 0 and motif = 'P0001');

    -- EQ3 : le chef retire toujours un membre.
    touchees := 0; motif := null; message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      delete from cabinet_admins where user_id = client;
      get diagnostics touchees = row_count;
      raise exception 'ANNULATION_ESSAI';
    exception when others then motif := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'EQ3. le chef retire toujours un membre de son équipe (« Retirer »)',
      'cible', 'cabinet_admins', 'observe', touchees || ' ligne(s), ' || coalesce(motif, '?') || ' ' || coalesce(message, '?'),
      'ok', touchees = 1 and motif = 'P0001' and message = 'ANNULATION_ESSAI');

    -- EQ5 : l'anonyme ne change aucune ligne — ni le rôle, ni le compte.
    foreach ecriture in array array['role = ''comptable_en_chef''', 'user_id = user_id'] loop
      touchees := 0; motif := null; message := null;
      begin
        set local role anon;
        perform set_config('request.jwt.claims', '{"role":"anon"}', true);
        execute format('update public.cabinet_admins set %s where user_id = $1', ecriture) using client;
        get diagnostics touchees = row_count;
        raise exception 'ANNULATION_ESSAI';
      exception when others then motif := sqlstate; message := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', 'EQ5. l''anonyme ne change aucune ligne de l''équipe (la policy, sans session)',
        'cible', ecriture, 'observe', touchees || ' ligne(s), ' || coalesce(motif, '?') || ' ' || coalesce(message, '?'),
        'ok', touchees = 0);
    end loop;

    -- M-EQ5 : EQ5 joué par le chef — le rôle change.
    touchees := 0;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      update cabinet_admins set role = 'comptable_en_chef' where user_id = client;
      get diagnostics touchees = row_count;
      raise exception 'ANNULATION_ESSAI';
    exception when others then null;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-EQ5 — EQ5 joué par le chef',
      'attendu', 'une ligne', 'observe', touchees || ' ligne(s)', 'mord', touchees = 1);

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  -- EQ4 : le catalogue, après les mutations (qui n'y ont rien laissé).
  select count(*) into n
   where not has_table_privilege('authenticated', 'public.cabinet_admins', 'UPDATE')
     and (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
           where a.attrelid = 'public.cabinet_admins'::regclass and a.attnum > 0 and not a.attisdropped
             and has_column_privilege('authenticated', 'public.cabinet_admins', a.attname, 'UPDATE')) = 'role'
     and has_table_privilege('authenticated', 'public.cabinet_admins', 'SELECT')
     and has_table_privilege('authenticated', 'public.cabinet_admins', 'DELETE')
     and has_table_privilege('service_role', 'public.cabinet_admins', 'INSERT')
     and has_table_privilege('service_role', 'public.cabinet_admins', 'UPDATE')
     -- Le droit sur `role` ne se transmet pas : `authenticated` ne le donne à personne.
     and not exists (select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) d
                      where a.attrelid = 'public.cabinet_admins'::regclass and a.attnum > 0 and not a.attisdropped and d.is_grantable);
  verdicts := verdicts || jsonb_build_object('controle', 'EQ4. authenticated ne met à jour que role, sans le transmettre, lit et retire toujours ; service_role garde la table (lecture du catalogue)',
    'cible', 'cabinet_admins', 'observe', case when n = 1 then 'conforme' else 'NON CONFORME' end, 'ok', n = 1);
  verdicts := verdicts || jsonb_build_object('controle', 'EQ. le jeu d''essai de l''équipe s''est construit', 'cible', 'équipe',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ VS. « Ventes » ne se porte que sur un dossier basculé (chantier EC-Q3, étape VF8f ; migration
-- `ventes_sur_dossier_bascule`) ══════════════════════════════════════════════════════════════════════════════════
-- Une garde neuve, `garder_droit_ventes`, aux droits du propriétaire, lit le réglage du dossier d'un accès qui reçoit
-- « Ventes » et le refuse sur un dossier qui n'a pas basculé (23514). Elle contourne la RLS : elle se rejoue. Elle passe
-- APRÈS l'écriture, donc après la policy d'insertion de `memberships` : à qui la policy refuse, elle ne dit rien.
--   VS1. L'anonyme, un compte rattaché à rien et le client, qui insèrent chacun un accès « Ventes » sur un dossier qui a
--        basculé puis sur un dossier qui n'a pas basculé : refusés (42501), et chacun reçoit la MÊME réponse des deux
--        côtés — aucun n'apprend si le dossier a basculé.
--   VS2. Le contrôle POSITIF : le client rangé chef du cabinet, qui n'est pas super-administrateur (l'insertion de
--        celui-ci passe : la restauration), insère l'accès « Ventes » d'un compte : sur le dossier qui n'a pas basculé, la
--        raison de la garde ; sur celui qui a basculé, accepté. Sans lui, une garde qui refuserait tout passerait VS1.
--   VS3. La garde ne s'exécute pas en RPC, ni pour l'anonyme ni pour un compte connecté (lecture du catalogue).
-- Deux mutations, qui doivent mordre : M-VS1 (la garde posée AUSSI avant l'insertion, le temps d'une sous-transaction :
-- l'anonyme reçoit deux réponses différentes), M-VS2 (VS2 joué par le super-administrateur : sur le dossier qui n'a pas
-- basculé, son insertion passe). Le jeu, le temps d'une sous-transaction annulée, dans le cabinet du dossier du client :
-- deux dossiers jetables, l'un basculé par le propriétaire sans session, l'autre non. Avant la migration, une ligne dit que
-- le resserrement attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  dj uuid := 'f8f00000-0000-4000-8000-0000000000e1';
  dk uuid := 'f8f00000-0000-4000-8000-0000000000e2';
  raison text := 'Le droit « Ventes » suppose que les factures de ce dossier soient la source de leurs ventes, ce qu''elles ne sont pas : changer d''abord la source des ventes du dossier.';
  cabinet_du_client uuid; profil text; cible uuid; reponses jsonb; n bigint;
  erreur text; construit boolean := false; obs text;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.garder_droit_ventes()') is null then
    insert into rls_verdict values ('VS. « Ventes » sur un dossier basculé : EN ATTENTE de la migration ventes_sur_dossier_bascule',
      'garder_droit_ventes', 'absente : la garde se juge dès que la migration y est', true);
    return;
  end if;
  select d.cabinet_id into cabinet_du_client from dossiers d where d.id = dossier_du_client;
  begin
    -- ── Le jeu, sans session ──
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id, ventes_par_les_factures) values
      (dj, 'ESSAI RLS VS DJ', cabinet_du_client, false), (dk, 'ESSAI RLS VS DK', cabinet_du_client, true);
    construit := true;

    -- VS1 : l'anonyme, un compte rattaché à rien, le client — sur DK (basculé), puis sur DJ (non).
    foreach profil in array array['anon', 'inconnu', 'client'] loop
      reponses := '[]'::jsonb;
      foreach cible in array array[dk, dj] loop
        obs := null;
        begin
          execute format('set local role %I', case profil when 'anon' then 'anon' else 'authenticated' end);
          perform set_config('request.jwt.claims', case profil when 'anon' then '{"role":"anon"}'
            else json_build_object('sub', case profil when 'inconnu' then inconnu else client end, 'role', 'authenticated')::text end, true);
          insert into memberships (user_id, dossier_id, role, email, droit_ventes)
            values (client, cible, 'client', 'essai-rls-vs@example.test', true);
          obs := 'ACCEPTÉ';
          raise exception 'ANNULATION_ESSAI';
        exception when others then if obs is null then obs := sqlstate || ' ' || sqlerrm; end if;
        end;
        reset role;
        reponses := reponses || to_jsonb(obs);
      end loop;
      verdicts := verdicts || jsonb_build_object('controle', 'VS1. un compte que la policy refuse n''apprend pas si le dossier a basculé',
        'cible', profil, 'observe', 'basculé : ' || (reponses ->> 0) || ' | non basculé : ' || (reponses ->> 1),
        'ok', (reponses ->> 0) = (reponses ->> 1) and (reponses ->> 0) like '42501 %');
    end loop;

    -- VS2 : le client rangé chef du cabinet, qui n'est pas super-administrateur.
    reponses := '[]'::jsonb;
    foreach cible in array array[dj, dk] loop
      obs := null;
      begin
        insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet_du_client, 'comptable_en_chef');
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        insert into memberships (user_id, dossier_id, role, email, droit_ventes)
          values (chef, cible, 'client', 'essai-rls-vs@example.test', true);
        obs := 'ACCEPTÉ';
        raise exception 'ANNULATION_ESSAI';
      exception when others then if obs is null then obs := sqlstate || ' ' || sqlerrm; end if;
      end;
      reset role;
      reponses := reponses || to_jsonb(obs);
    end loop;
    verdicts := verdicts || jsonb_build_object('controle', 'VS2. le cabinet du dossier : la raison de la garde sur un dossier qui n''a pas basculé, accepté sur un dossier basculé (contrôle positif)',
      'cible', 'chef qui n''est pas super-administrateur', 'observe', 'non basculé : ' || (reponses ->> 0) || ' | basculé : ' || (reponses ->> 1),
      'ok', (reponses ->> 0) = '23514 ' || raison and (reponses ->> 1) = 'ACCEPTÉ');

    -- M-VS1 : la garde posée AUSSI avant l'insertion — elle passe alors avant la policy, et parle à l'anonyme.
    reponses := '[]'::jsonb;
    begin
      create trigger rls_mutation_garde_avant before insert on public.memberships
        for each row execute function public.garder_droit_ventes();
      -- La porte d'accès sur memberships (acces_avant_les_gardes, posée avec la garde de la conservation d'INAL5) se coupe
      -- aussi : sans elle, la mutation montre ce que VS1 verrait.
      if exists (select 1 from pg_trigger g where g.tgrelid = 'public.memberships'::regclass and g.tgname = '_acces_avant_les_gardes') then
        alter table public.memberships disable trigger _acces_avant_les_gardes;
      end if;
      foreach cible in array array[dk, dj] loop
        obs := null;
        begin
          set local role anon;
          perform set_config('request.jwt.claims', '{"role":"anon"}', true);
          insert into memberships (user_id, dossier_id, role, email, droit_ventes)
            values (client, cible, 'client', 'essai-rls-vs@example.test', true);
          obs := 'ACCEPTÉ';
          raise exception 'ANNULATION_ESSAI';
        exception when others then if obs is null then obs := sqlstate || ' ' || sqlerrm; end if;
        end;
        reset role;
        reponses := reponses || to_jsonb(obs);
      end loop;
      raise exception 'ANNULATION_ESSAI';
    exception when others then null;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-VS1 — VS1 rejoué, la garde posée aussi avant l''insertion',
      'attendu', 'deux réponses différentes', 'observe', 'basculé : ' || coalesce(reponses ->> 0, '?') || ' | non basculé : ' || coalesce(reponses ->> 1, '?'),
      'mord', (reponses ->> 0) is distinct from (reponses ->> 1));

    -- M-VS2 : VS2 joué par le super-administrateur, sur le dossier qui n'a pas basculé — la restauration passe.
    obs := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into memberships (user_id, dossier_id, role, email, droit_ventes)
        values (client, dj, 'client', 'essai-rls-vs@example.test', true);
      obs := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if obs is null then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-VS2 — VS2 joué par le super-administrateur',
      'attendu', 'accepté', 'observe', obs, 'mord', obs = 'ACCEPTÉ');

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  -- VS3 : le catalogue.
  select count(*) into n from pg_proc p
   where p.oid = to_regprocedure('public.garder_droit_ventes()') and p.prosecdef and p.proconfig @> array['search_path=public']
     and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute');
  verdicts := verdicts || jsonb_build_object('controle', 'VS3. la garde du droit « Ventes » ne s''exécute pas en RPC (lecture du catalogue)',
    'cible', 'garder_droit_ventes', 'observe', case when n = 1 then 'security definer, ni anon ni authenticated' else 'EXÉCUTABLE OU ABSENTE' end,
    'ok', n = 1);
  verdicts := verdicts || jsonb_build_object('controle', 'VS. le jeu d''essai du droit « Ventes » s''est construit', 'cible', 'dossiers jetables',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ CA. La caisse d'un dossier (ligne 26.6, étape C1 ; migration `caisse`) ═══════════════════════════════════════════
-- Une table du dossier, `operations_caisse`, que le cabinet lit (`admin_du_dossier`) et où personne n'écrit en direct —
-- la restauration exceptée, le super-administrateur (la policy d'insertion), sous la garde de la table — ; le client
-- n'en lit rien (CAISSE-Q1, (B) : sa lecture viendra avec son droit, une migration présentée au cabinet). Les
-- invariants 1 à 3 la prennent déjà dans leur boucle, mais sur une table vide « refusé » et « rien à voir » se
-- ressemblent : le bloc pose une opération dans le dossier même du client, le temps d'une sous-transaction annulée.
--   CA1. Une opération de la caisse du dossier du client, saisie par le chef (la fonction) : le client ne la lit pas,
--        ni les lignes de son écriture ; le chef les lit (le contrôle POSITIF).
--   CA2. Le client n'écrit pas : la fonction lui refuse l'accès (42501, sa raison), l'insertion directe se refuse
--        (42501, la garde) et, sous le réglage d'une fonction, la policy (42501).
--   CA3. L'anonyme n'exécute aucune des deux fonctions d'écriture (42501).
--   CA4. Le catalogue : la RLS active, deux policies exactement, `to authenticated` — la lecture sous
--        `admin_du_dossier`, l'insertion de restauration sous `is_super_admin` —, aucune de mise à jour ni de
--        suppression.
-- Trois mutations, qui doivent mordre : M-CA1 (CA1 lu par le chef), M-CA2 (la lecture ouverte, le temps d'une
-- sous-transaction, aux accès du dossier : le client voit l'opération), M-CA3 (CA2 joué par le super-administrateur
-- sous le réglage : son insertion passe). Avant la migration, une ligne dit que la caisse attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  op uuid := 'ca155e00-0000-4000-8004-0000000000c1';
  ecriture jsonb := '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]';
  ses_operations bigint; ses_lignes bigint; vues_chef bigint; lignes_chef bigint; vues_mutation bigint;
  fonction text; directe text; reglee text; anon_un text; anon_lot text; super text; n bigint;
  erreur text; construit boolean := false; c10 boolean;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.operations_caisse') is null then
    insert into rls_verdict values ('CA. la caisse d''un dossier : EN ATTENTE de la migration caisse', 'operations_caisse',
      'absente : la table se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : une opération de la caisse du dossier du client, saisie par le chef ──
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform enregistrer_operation_caisse(dossier_du_client, 'apport', '2026-03-03', 10, null, null, null, ecriture);
    reset role;
    construit := true;

    -- CA1 : le client, puis le chef.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into ses_operations from operations_caisse where dossier_id = dossier_du_client;
    select count(*) into ses_lignes from ecritures_brouillon where dossier_id = dossier_du_client and operation_caisse_id is not null;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into vues_chef from operations_caisse where dossier_id = dossier_du_client;
    select count(*) into lignes_chef from ecritures_brouillon where dossier_id = dossier_du_client and operation_caisse_id is not null;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'CA1. le client ne lit pas la caisse de son dossier ; le chef la lit (contrôle positif)',
      'cible', 'operations_caisse, ecritures_brouillon', 'observe', 'client : ' || ses_operations || ' opération, ' || ses_lignes
        || ' ligne ; chef : ' || vues_chef || ' opération, ' || lignes_chef || ' lignes',
      'ok', ses_operations = 0 and ses_lignes = 0 and vues_chef = 1 and lignes_chef = 2);

    -- CA2 : le client écrit — par la fonction, en direct, sous le réglage.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_operation_caisse(dossier_du_client, 'apport', '2026-03-04', 10, null, null, null, ecriture);
      fonction := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if fonction is null then fonction := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into operations_caisse (dossier_id, genre, date, montant, origine) values (dossier_du_client, 'apport', '2026-03-04', 10, 'client');
      directe := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if directe is null then directe := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform set_config('jd.caisse', op::text, true);
      insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values (op, dossier_du_client, 'apport', '2026-03-04', 10, 'client');
      reglee := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if reglee is null then reglee := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('jd.caisse', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'CA2. le client n''écrit pas la caisse de son dossier : ni par la fonction, ni en direct, ni sous le réglage',
      'cible', 'operations_caisse', 'observe', 'fonction : ' || fonction || ' | directe : ' || directe || ' | réglée : ' || reglee,
      'ok', fonction = '42501 Accès refusé à ce dossier.'
        -- La porte d'accès en base (acces_avant_les_gardes) : la RLS refuse l'insertion directe avant la garde.
        and directe = case when exists (select 1 from pg_trigger g where g.tgrelid = 'public.operations_caisse'::regclass and g.tgname = '_acces_avant_les_gardes')
                           then '42501 new row violates row-level security policy for table "operations_caisse"'
                           else '42501 Une opération de caisse ne s''écrit que par les fonctions de la caisse, avec son écriture.' end
        and reglee = '42501 new row violates row-level security policy for table "operations_caisse"');

    -- M-CA1 : CA1 lu par le chef — il voit l'opération (vues_chef, plus haut).
    mutations := mutations || jsonb_build_object('mutation', 'M-CA1 — CA1 lu par le chef', 'attendu', 'une opération vue',
      'observe', vues_chef::text, 'mord', vues_chef = 1);

    -- M-CA2 : la lecture ouverte aux accès du dossier, le temps d'une sous-transaction.
    begin
      create policy rls_mutation_caisse_client on public.operations_caisse for select to authenticated
        using (exists (select 1 from public.memberships m where m.dossier_id = operations_caisse.dossier_id and m.user_id = auth.uid()));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into vues_mutation from operations_caisse where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then null;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-CA2 — la lecture de la caisse ouverte aux accès du dossier',
      'attendu', 'le client voit l''opération', 'observe', coalesce(vues_mutation::text, '?'), 'mord', coalesce(vues_mutation = 1, false));

    -- M-CA3 : CA2 joué par le super-administrateur, sous le réglage — la restauration passe.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform set_config('jd.caisse', op::text, true);
      insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values (op, dossier_du_client, 'apport', '2026-03-04', 10, 'cabinet');
      super := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if super is null then super := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('jd.caisse', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-CA3 — CA2 joué par le super-administrateur, sous le réglage',
      'attendu', 'accepté', 'observe', super, 'mord', super = 'ACCEPTÉ');

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- CA3 : l'anonyme.
  begin
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform enregistrer_operation_caisse(dossier_du_client, 'apport', '2026-03-04', 10, null, null, null, ecriture);
    anon_un := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then if anon_un is null then anon_un := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  begin
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform enregistrer_operations_de_caisse(dossier_du_client, '[]'::jsonb);
    anon_lot := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then if anon_lot is null then anon_lot := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('controle', 'CA3. l''anonyme n''exécute aucune des deux fonctions d''écriture',
    'cible', 'enregistrer_operation_caisse, enregistrer_operations_de_caisse', 'observe', anon_un || ' | ' || anon_lot,
    'ok', anon_un = '42501 permission denied for function enregistrer_operation_caisse'
      and anon_lot = '42501 permission denied for function enregistrer_operations_de_caisse');

  -- CA4 : le catalogue. La migration de l'étape C10 (`caisse_du_client`) y ajoute la lecture du client qui porte « Caisse ».
  c10 := to_regprocedure('public.caisse_du_client(uuid, integer)') is not null;
  select count(*) into n from pg_policies p
   where p.tablename = 'operations_caisse' and p.roles = array['authenticated']::name[]
     and ((p.policyname = 'operations_caisse_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check is null)
       or (p.policyname = 'operations_caisse_restauration' and p.cmd = 'INSERT' and p.qual is null and p.with_check = 'is_super_admin()')
       or (c10 and p.policyname = 'operations_caisse_lecture_caisse' and p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE'
           and p.qual = 'client_du_dossier(dossier_id, ''caisse''::text)' and p.with_check is null));
  verdicts := verdicts || jsonb_build_object('controle', 'CA4. la caisse : la RLS active, deux policies exactement, au compte connecté (lecture du catalogue)',
    'cible', 'operations_caisse', 'observe', n || ' policies attendues sur ' || (select count(*) from pg_policies where tablename = 'operations_caisse' and not (policyname = 'deux_facteurs' and permissive = 'RESTRICTIVE'))
      || ', RLS ' || (select case when relrowsecurity then 'active' else 'INACTIVE' end from pg_class where oid = 'public.operations_caisse'::regclass),
    'ok', n = case when c10 then 3 else 2 end and (select count(*) from pg_policies where tablename = 'operations_caisse' and not (policyname = 'deux_facteurs' and permissive = 'RESTRICTIVE')) = n
      and (select relrowsecurity from pg_class where oid = 'public.operations_caisse'::regclass));
  verdicts := verdicts || jsonb_build_object('controle', 'CA. le jeu d''essai de la caisse s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ CR. Retirer et remplacer une opération de caisse (ligne 26.6, étape C1b ; migration `caisse_retrait_et_versement`) ══
-- Deux fonctions aux droits du propriétaire, exécutables par les connectés, qui écrivent une table que personne ne met à
-- jour en direct (aucune policy de mise à jour) : elles contournent la RLS, avec leur propre contrôle
-- (`qui_ecrit_la_caisse`, au cabinet seul tant que la migration du droit du client ne l'a pas remplacée), avant toute
-- lecture.
--   CR1. Une opération de la caisse du dossier du client, saisie par le chef : le client ne la retire ni ne la remplace
--        (42501, sa raison), et elle reste entière — non retirée, son écriture là.
--   CR2. L'anonyme n'exécute aucune des deux (42501).
--   CR3. Le catalogue : les deux, `security definer`, leur chemin fixé ; exécutables par les connectés, ni par
--        l'anonyme ni par PUBLIC.
-- Deux mutations, qui doivent mordre : M-CR1 (CR1 joué par le chef : le retrait passe), M-CR2 (CR1 joué par le chef :
-- le remplacement passe). Avant la migration, une ligne dit que le bloc attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  ecriture jsonb := '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]';
  nouvelle jsonb := '[{"compte":"530000","sens":"debit","montant":12},{"compte":"108000","sens":"credit","montant":12}]';
  op uuid; retrait text; remplacement text; intacte boolean; chef_retrait text; chef_remplacement text;
  anon_retrait text; anon_remplacement text; n bigint; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.retirer_operation_caisse(uuid, uuid)') is null
     or to_regprocedure('public.remplacer_operation_caisse(uuid, uuid, text, date, numeric, uuid, numeric, uuid[], jsonb)') is null then
    insert into rls_verdict values ('CR. retirer et remplacer une opération de caisse : EN ATTENTE de la migration caisse_retrait_et_versement',
      'retirer_operation_caisse, remplacer_operation_caisse', 'absentes : elles se jugent dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : une opération de la caisse du dossier du client, saisie par le chef ──
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select o.id into op from enregistrer_operation_caisse(dossier_du_client, 'apport', '2026-03-03', 10, null, null, null, ecriture) o;
    reset role;
    construit := true;

    -- CR1 : le client retire, puis remplace ; l'opération reste entière.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform retirer_operation_caisse(dossier_du_client, op);
      retrait := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if retrait is null then retrait := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform remplacer_operation_caisse(dossier_du_client, op, 'apport', '2026-03-03', 12, null, null, null, nouvelle);
      remplacement := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if remplacement is null then remplacement := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    select o.retire_le is null and (select count(*) from ecritures_brouillon b where b.operation_caisse_id = o.id) = 2
      into intacte from operations_caisse o where o.id = op;
    verdicts := verdicts || jsonb_build_object('controle', 'CR1. le client ne retire ni ne remplace une opération de la caisse de son dossier ; elle reste entière',
      'cible', 'retirer_operation_caisse, remplacer_operation_caisse',
      'observe', 'retrait : ' || retrait || ' | remplacement : ' || remplacement || ' | entière : ' || coalesce(intacte::text, '?'),
      'ok', retrait = '42501 Accès refusé à ce dossier.' and remplacement = '42501 Accès refusé à ce dossier.' and coalesce(intacte, false));

    -- M-CR1 et M-CR2 : CR1 joué par le chef — le retrait, puis le remplacement passent.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform retirer_operation_caisse(dossier_du_client, op);
      chef_retrait := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if chef_retrait is null then chef_retrait := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform remplacer_operation_caisse(dossier_du_client, op, 'apport', '2026-03-03', 12, null, null, null, nouvelle);
      chef_remplacement := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if chef_remplacement is null then chef_remplacement := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('jd.caisse', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-CR1 — CR1 joué par le chef : le retrait',
      'attendu', 'accepté', 'observe', chef_retrait, 'mord', chef_retrait = 'ACCEPTÉ');
    mutations := mutations || jsonb_build_object('mutation', 'M-CR2 — CR1 joué par le chef : le remplacement',
      'attendu', 'accepté', 'observe', chef_remplacement, 'mord', chef_remplacement = 'ACCEPTÉ');

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- CR2 : l'anonyme.
  begin
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform retirer_operation_caisse(dossier_du_client, null);
    anon_retrait := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then if anon_retrait is null then anon_retrait := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  begin
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform remplacer_operation_caisse(dossier_du_client, null, 'apport', '2026-03-03', 12, null, null, null, nouvelle);
    anon_remplacement := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then if anon_remplacement is null then anon_remplacement := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('controle', 'CR2. l''anonyme n''exécute ni le retrait ni le remplacement',
    'cible', 'retirer_operation_caisse, remplacer_operation_caisse', 'observe', anon_retrait || ' | ' || anon_remplacement,
    'ok', anon_retrait = '42501 permission denied for function retirer_operation_caisse'
      and anon_remplacement = '42501 permission denied for function remplacer_operation_caisse');

  -- CR3 : le catalogue.
  select count(*) into n from pg_proc p
   where p.oid in (to_regprocedure('public.retirer_operation_caisse(uuid, uuid)'),
                   to_regprocedure('public.remplacer_operation_caisse(uuid, uuid, text, date, numeric, uuid, numeric, uuid[], jsonb)'))
     and p.prosecdef and p.proconfig @> array['search_path=public']
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0);
  verdicts := verdicts || jsonb_build_object('controle', 'CR3. security definer, leur chemin fixé ; les connectés les exécutent, ni l''anonyme ni PUBLIC (lecture du catalogue)',
    'cible', 'retirer_operation_caisse, remplacer_operation_caisse', 'observe', n || ' sur 2', 'ok', n = 2);
  verdicts := verdicts || jsonb_build_object('controle', 'CR. le jeu d''essai du retrait s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ CP. Le paiement d'une pièce par la caisse (ligne 26.6, étape C8 ; migration `paiement_par_la_caisse`) ══════════
-- Une fonction aux droits du propriétaire, exécutable par les connectés, qui écrit une table que personne n'écrit en
-- direct : elle contourne la RLS, avec son propre contrôle (`qui_ecrit_la_caisse`, au cabinet seul tant que la migration
-- du droit du client ne l'a pas remplacée), avant toute lecture. La garde du brouillon, aux droits du propriétaire, admet
-- la contrepartie d'un paiement hors de toute fonction : la RLS du brouillon reste ce qui la borne au cabinet.
--   CP1. Dans le dossier du client, une pièce et un apport posés, le chef y règle la pièce par la caisse : le client ne
--        la règle pas lui-même (42501, sa raison), et rien n'est écrit ; il n'écrit pas la contrepartie du paiement du
--        chef (la RLS du brouillon, 42501) ; il ne lit ni le paiement ni une ligne qui le cite.
--   CP2. L'anonyme n'exécute pas la fonction (42501).
--   CP3. Le catalogue : la fonction, `security definer`, son chemin fixé, exécutable par les connectés, ni par
--        l'anonyme ni par PUBLIC ; les deux gardes neuves, `security definer`, leur chemin fixé, exécutables par personne.
-- Deux mutations, qui doivent mordre : M-CP1 (CP1 joué par le chef : le paiement passe), M-CP2 (la contrepartie écrite
-- par le chef : elle passe). Avant la migration, une ligne dit que le bloc attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  apport jsonb := '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]';
  piece uuid; paiement uuid; reglement text; contrepartie text; ecrites bigint; vus bigint; lignes_vues bigint;
  chef_reglement text; chef_contrepartie text; anon_reglement text; n bigint; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.regler_piece_par_la_caisse(uuid, uuid, date, numeric)') is null then
    insert into rls_verdict values ('CP. le paiement d''une pièce par la caisse : EN ATTENTE de la migration paiement_par_la_caisse',
      'regler_piece_par_la_caisse', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : une pièce d'achat du dossier du client (par le propriétaire), un apport et un paiement par le chef ──
    insert into pieces (dossier_id, storage_path, nom_fichier, type_piece, statut)
    values (dossier_du_client, dossier_du_client::text || '/essai-rls-caisse-cp.pdf', 'essai-rls-caisse-cp.pdf', 'achat', 'a_valider')
    returning id into piece;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform enregistrer_operation_caisse(dossier_du_client, 'apport', '2026-03-03', 10, null, null, null, apport);
    select o.id into paiement from regler_piece_par_la_caisse(dossier_du_client, piece, '2026-03-04', -5) o;
    reset role;
    construit := true;

    -- CP1 : le client règle la pièce, puis écrit la contrepartie du paiement du chef ; puis ce qu'il lit.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform regler_piece_par_la_caisse(dossier_du_client, piece, '2026-03-04', -5);
      reglement := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if reglement is null then reglement := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, operation_caisse_id, piece_id)
      values (dossier_du_client, '2026-03-04', '530000', 'essai', 5, 'credit', paiement, piece);
      contrepartie := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if contrepartie is null then contrepartie := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into vus from operations_caisse where dossier_id = dossier_du_client;
    select count(*) into lignes_vues from ecritures_brouillon where operation_caisse_id = paiement;
    reset role;
    select count(*) into ecrites from operations_caisse where dossier_id = dossier_du_client and genre = 'paiement';
    verdicts := verdicts || jsonb_build_object('controle', 'CP1. le client ne règle pas une pièce de son dossier par la caisse, n''écrit pas la contrepartie du paiement du chef, et ne lit ni l''un ni l''autre',
      'cible', 'regler_piece_par_la_caisse, ecritures_brouillon',
      'observe', 'règlement : ' || reglement || ' | contrepartie : ' || contrepartie || ' | paiements écrits : ' || ecrites
        || ' | lus par le client : ' || vus || '/' || lignes_vues,
      'ok', reglement = '42501 Accès refusé à ce dossier.'
        and contrepartie = '42501 new row violates row-level security policy for table "ecritures_brouillon"'
        and ecrites = 1 and vus = 0 and lignes_vues = 0);

    -- M-CP1 et M-CP2 : joué par le chef — le paiement, puis la contrepartie, passent.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform regler_piece_par_la_caisse(dossier_du_client, piece, '2026-03-04', -5);
      chef_reglement := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if chef_reglement is null then chef_reglement := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, operation_caisse_id, piece_id)
      values (dossier_du_client, '2026-03-04', '530000', 'essai', 5, 'credit', paiement, piece);
      chef_contrepartie := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if chef_contrepartie is null then chef_contrepartie := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('jd.caisse', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-CP1 — CP1 joué par le chef : le paiement',
      'attendu', 'accepté', 'observe', chef_reglement, 'mord', chef_reglement = 'ACCEPTÉ');
    mutations := mutations || jsonb_build_object('mutation', 'M-CP2 — CP1 joué par le chef : la contrepartie',
      'attendu', 'accepté', 'observe', chef_contrepartie, 'mord', chef_contrepartie = 'ACCEPTÉ');

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- CP2 : l'anonyme.
  begin
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform regler_piece_par_la_caisse(dossier_du_client, null, null, null);
    anon_reglement := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then if anon_reglement is null then anon_reglement := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('controle', 'CP2. l''anonyme n''exécute pas le paiement d''une pièce par la caisse',
    'cible', 'regler_piece_par_la_caisse', 'observe', anon_reglement,
    'ok', anon_reglement = '42501 permission denied for function regler_piece_par_la_caisse');

  -- CP3 : le catalogue.
  select count(*) into n from pg_proc p
   where p.prosecdef and p.proconfig @> array['search_path=public']
     and not has_function_privilege('anon', p.oid, 'execute')
     and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)
     and (p.oid = to_regprocedure('public.regler_piece_par_la_caisse(uuid, uuid, date, numeric)')
            and has_function_privilege('authenticated', p.oid, 'execute')
          or p.oid in (to_regprocedure('public.garder_piece_payee_par_la_caisse()'), to_regprocedure('public.garder_caisse_depuis_l_ouverture()'))
            and not has_function_privilege('authenticated', p.oid, 'execute'));
  verdicts := verdicts || jsonb_build_object('controle', 'CP3. security definer, leur chemin fixé ; le paiement exécutable par les connectés, les deux gardes par personne, ni l''anonyme ni PUBLIC (lecture du catalogue)',
    'cible', 'regler_piece_par_la_caisse, garder_piece_payee_par_la_caisse, garder_caisse_depuis_l_ouverture', 'observe', n || ' sur 3', 'ok', n = 3);
  verdicts := verdicts || jsonb_build_object('controle', 'CP. le jeu d''essai du paiement s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ CC. Le droit « Caisse » du client (ligne 26.6, étape C10 ; migration `caisse_du_client`) ════════════════════════
-- Une troisième case de l'accès client, `droit_caisse`, et une policy PERMISSIVE de plus sur `operations_caisse` — `for
-- select to authenticated using (client_du_dossier(dossier_id, 'caisse'))`, présentée au cabinet avant d'être appliquée
-- (CAISSE-Q1, (B)) : l'accès qui la porte lit toute la caisse de son dossier ; il n'y écrit que par les fonctions de la
-- caisse, qui le disent « client » (`qui_ecrit_la_caisse`) sur un dossier exonéré de TVA ou en franchise en base. Le
-- profil « client portant Caisse » : le dossier du client passé exonéré, la case posée sur son accès, le temps d'une
-- sous-transaction annulée ; et un dossier jetable, exonéré lui aussi, où son accès ne porte pas la case.
--   CC1. La boucle de l'invariant 3 sous ce profil : il ne voit, table par table, que ses dossiers.
--   CC2. Ce qu'il lit : l'opération du chef et la sienne dans la caisse de son dossier (le contrôle POSITIF) ; aucune ligne
--        du brouillon ; rien de la caisse du dossier où son accès ne porte pas la case ; `caisse_du_client` de son dossier,
--        jour par jour, et le refus (42501) sur l'autre.
--   CC3. Ce qu'il écrit : par la fonction (accepté, le contrôle POSITIF) ; jamais en direct — ni une insertion (la garde),
--        ni sous le réglage d'une fonction (la policy), ni une mise à jour (aucune policy : aucune ligne touchée). Une
--        suppression ne se joue pas ici (l'outil d'exécution de la production la retient) : aucune policy ne l'ouvre, ce
--        que CA4 lit au catalogue.
--   CC4. L'anonyme n'exécute pas `caisse_du_client` (42501).
-- La policy elle-même, au catalogue : CA4. Trois mutations, qui doivent mordre : M-CC1 (CC2 sans la case : il ne lit plus
-- rien), M-CC2 (la lecture du client passée à « membre », le temps d'une sous-transaction : il lit la caisse du dossier
-- où son accès ne porte pas la case), M-CC3 (CC3 sur un dossier redevable, la case restaurée : la fonction le refuse,
-- 23514). Avant la migration, une ligne dit que le bloc attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  sans_case uuid := 'ca155e00-0000-4000-800c-0000000000d9';
  redevable uuid := 'ca155e00-0000-4000-800c-0000000000da';
  op uuid := 'ca155e00-0000-4000-800c-0000000000c1';
  apport jsonb := '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]';
  t record; hors bigint; vues bigint; du_cabinet bigint; du_client bigint; lignes bigint; ailleurs bigint; jours bigint;
  refus_autre text; ecrite text; directe text; reglee text; modifiees int; anon_lecture text; vues_sans bigint;
  vues_membre bigint; refus_redevable text; porteurs bigint;
  erreur text; construit boolean := false;
  boucle jsonb := '[]'::jsonb; verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.caisse_du_client(uuid, integer)') is null then
    insert into rls_verdict values ('CC. le droit « Caisse » du client : EN ATTENTE de la migration caisse_du_client', 'operations_caisse',
      'absente : il se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : le dossier du client exonéré, la case sur son accès ; un dossier jetable exonéré où son accès ne la porte
    --    pas ; un apport du chef dans chacun ──
    perform set_config('request.jwt.claims', '', true);
    update dossiers set statut_tva = 'exonere' where id = dossier_du_client and statut_tva is distinct from 'exonere';
    update memberships set droit_caisse = true where user_id = client and dossier_id = dossier_du_client;
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva)
      select sans_case, 'ESSAI CAISSE CC SANS CASE', d.cabinet_id, 'tresorerie', '455000', 'exonere' from dossiers d where d.id = dossier_du_client;
    insert into memberships (user_id, dossier_id, role, email) values (client, sans_case, 'client', 'essai-caisse-cc@example.test');
    select count(*) into porteurs from memberships where user_id = client and dossier_id = dossier_du_client and droit_caisse;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform enregistrer_operation_caisse(dossier_du_client, 'apport', '2026-03-03', 10, null, null, null, apport);
    perform enregistrer_operation_caisse(sans_case, 'apport', '2026-03-03', 10, null, null, null, apport);
    reset role;
    construit := true;

    -- CC3, le contrôle positif d'abord : le client apporte 10 € par la fonction, sans écriture — la base compose la sienne.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_operation_caisse(dossier_du_client, 'apport', '2026-03-04', 10, null, null, null, null);
      ecrite := 'ACCEPTÉ';
    exception when others then ecrite := sqlstate || ' ' || sqlerrm;
    end;
    reset role;

    -- CC1 : la boucle de l'invariant 3, sous ce profil.
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
      boucle := boucle || jsonb_build_object('cible', t.nom, 'observe', hors::text, 'ok', hors = 0);
    end loop;

    -- CC2 : ce qu'il lit.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*), count(*) filter (where origine = 'cabinet'), count(*) filter (where origine = 'client')
      into vues, du_cabinet, du_client from operations_caisse where dossier_id = dossier_du_client;
    select count(*) into lignes from ecritures_brouillon where dossier_id = dossier_du_client and operation_caisse_id is not null;
    select count(*) into ailleurs from operations_caisse where dossier_id = sans_case;
    select count(*) into jours from caisse_du_client(dossier_du_client, 2026) c where c.jour in ('2026-03-03', '2026-03-04');
    begin
      perform caisse_du_client(sans_case, 2026);
      refus_autre := 'ACCEPTÉ';
    exception when others then refus_autre := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'CC2. le client portant « Caisse » lit toute la caisse de son dossier, rien du brouillon, rien d''un dossier où son accès ne la porte pas',
      'cible', 'operations_caisse, ecritures_brouillon, caisse_du_client',
      'observe', vues || ' opérations (' || du_cabinet || ' du cabinet, ' || du_client || ' à lui), ' || lignes || ' ligne du brouillon, '
        || ailleurs || ' ailleurs ; caisse_du_client : ' || jours || ' jours, ailleurs ' || refus_autre,
      'ok', porteurs = 1 and vues = 2 and du_cabinet = 1 and du_client = 1 and lignes = 0 and ailleurs = 0 and jours = 2
        and refus_autre = '42501 Accès refusé à ce dossier.');

    -- CC3 : jamais en direct.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into operations_caisse (dossier_id, genre, date, montant, origine) values (dossier_du_client, 'apport', '2026-03-05', 10, 'client');
      directe := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if directe is null then directe := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform set_config('jd.caisse', op::text, true);
      insert into operations_caisse (id, dossier_id, genre, date, montant, origine) values (op, dossier_du_client, 'apport', '2026-03-05', 10, 'client');
      reglee := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if reglee is null then reglee := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('jd.caisse', '', true);
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      update operations_caisse set montant = 1000 where dossier_id = dossier_du_client;
      get diagnostics modifiees = row_count;
      raise exception 'ANNULATION_ESSAI';
    exception when others then null;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'CC3. le client portant « Caisse » écrit par la fonction seule : ni en direct, ni sous le réglage, ni par une mise à jour',
      'cible', 'operations_caisse',
      'observe', 'fonction : ' || ecrite || ' | directe : ' || directe || ' | réglée : ' || reglee || ' | mise à jour : ' || coalesce(modifiees::text, '?') || ' ligne',
      'ok', ecrite = 'ACCEPTÉ'
        -- La porte d'accès en base (acces_avant_les_gardes) : la RLS refuse l'insertion directe avant la garde.
        and directe = case when exists (select 1 from pg_trigger g where g.tgrelid = 'public.operations_caisse'::regclass and g.tgname = '_acces_avant_les_gardes')
                           then '42501 new row violates row-level security policy for table "operations_caisse"'
                           else '42501 Une opération de caisse ne s''écrit que par les fonctions de la caisse, avec son écriture.' end
        and reglee = '42501 new row violates row-level security policy for table "operations_caisse"'
        and modifiees = 0);

    -- M-CC1 : CC2 sans la case — il ne lit plus rien.
    begin
      perform set_config('request.jwt.claims', '', true);
      update memberships set droit_caisse = false where user_id = client and dossier_id = dossier_du_client;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into vues_sans from operations_caisse where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then null;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-CC1 — CC2 sans la case « Caisse »', 'attendu', 'aucune opération vue',
      'observe', coalesce(vues_sans::text, '?'), 'mord', coalesce(vues_sans = 0, false));

    -- M-CC2 : la lecture du client passée à « membre », le temps d'une sous-transaction.
    begin
      create policy rls_mutation_caisse_membre on public.operations_caisse for select to authenticated
        using (public.client_du_dossier(dossier_id, 'membre'));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into vues_membre from operations_caisse where dossier_id = sans_case;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then null;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-CC2 — la lecture du client passée à « membre »',
      'attendu', 'le client lit la caisse du dossier où son accès ne porte pas la case', 'observe', coalesce(vues_membre::text, '?'),
      'mord', coalesce(vues_membre = 1, false));

    -- M-CC3 : CC3 sur un dossier redevable où la restauration a posé la case — la fonction le refuse.
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva)
        select redevable, 'ESSAI CAISSE CC REDEVABLE', d.cabinet_id, 'tresorerie', '455000', 'redevable' from dossiers d where d.id = dossier_du_client;
      insert into memberships (user_id, dossier_id, role, email, droit_caisse) values (client, redevable, 'client', 'essai-caisse-cc@example.test', true);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_operation_caisse(redevable, 'apport', '2026-03-04', 10, null, null, null, null);
      refus_redevable := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if refus_redevable is null then refus_redevable := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-CC3 — CC3 sur un dossier redevable, la case restaurée',
      'attendu', 'refusé (23514)', 'observe', coalesce(refus_redevable, '?'), 'mord', coalesce(refus_redevable like '23514 %', false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- CC4 : l'anonyme.
  begin
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform caisse_du_client(dossier_du_client, 2026);
    anon_lecture := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then if anon_lecture is null then anon_lecture := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('controle', 'CC4. l''anonyme n''exécute pas la lecture de la caisse du client',
    'cible', 'caisse_du_client', 'observe', anon_lecture, 'ok', anon_lecture = '42501 permission denied for function caisse_du_client');
  verdicts := verdicts || jsonb_build_object('controle', 'CC. le jeu d''essai du droit « Caisse » s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict
    select 'CC1. client portant « Caisse » ne voit que ses dossiers', v.cible, v.observe, v.ok
    from jsonb_to_recordset(boucle) as v(cible text, observe text, ok boolean);
  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ CQ. Corriger un paiement par la caisse (C12B-Q1, ligne 26.6 ; migration
--    `correction_du_paiement_par_la_caisse`) ═════════════════════════════════════════════════════════════════════════
-- Une fonction aux droits du propriétaire, exécutable par les connectés, qui écrit une table que personne n'écrit en
-- direct : elle contourne la RLS, avec son propre contrôle (`qui_ecrit_la_caisse`) avant toute lecture, puis celui du
-- retrait : le client ne corrige que ses propres paiements. Elle ne crée ni ne change aucune policy.
--   CQ1. Dans le dossier du client, une pièce, un apport et un paiement du chef posés : le client sans la case « Caisse »
--        ne corrige pas ce paiement (42501, sa raison) ; portant la case — le dossier passé exonéré, le temps d'une
--        sous-transaction annulée —, il ne corrige pas davantage le paiement du chef (42501, la raison du retrait), et
--        corrige le sien (le contrôle POSITIF : l'ancien retiré, le nouveau le désigne, à lui, à son jour) ; le paiement
--        du chef reste entier.
--   CQ2. L'anonyme n'exécute pas la fonction (42501).
--   CQ3. Le catalogue : la fonction, `security definer`, son chemin fixé, exécutable par les connectés, ni par l'anonyme
--        ni par PUBLIC.
-- Deux mutations, qui doivent mordre : M-CQ1 (CQ1 joué par le chef sur son paiement : la correction passe), M-CQ2 (le
-- contrôle positif sans la case : refusé). Avant la migration, une ligne dit que le bloc attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  apport jsonb := '[{"compte":"530000","sens":"debit","montant":10},{"compte":"108000","sens":"credit","montant":10}]';
  piece uuid; du_chef uuid; du_client uuid; sans_case text; celui_du_chef text; le_sien text; porteurs bigint;
  nouveau public.operations_caisse; ancien_retire boolean; chef_entier boolean; chef_correction text; sans_la_case text;
  anon_correction text; n bigint; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.remplacer_paiement_par_la_caisse(uuid, uuid, date, numeric)') is null then
    insert into rls_verdict values ('CQ. corriger un paiement par la caisse : EN ATTENTE de la migration correction_du_paiement_par_la_caisse',
      'remplacer_paiement_par_la_caisse', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : une pièce d'achat du dossier du client (par le propriétaire), un apport et un paiement par le chef ──
    insert into pieces (dossier_id, storage_path, nom_fichier, type_piece, statut)
    values (dossier_du_client, dossier_du_client::text || '/essai-rls-caisse-cq.pdf', 'essai-rls-caisse-cq.pdf', 'achat', 'a_valider')
    returning id into piece;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform enregistrer_operation_caisse(dossier_du_client, 'apport', '2026-03-03', 10, null, null, null, apport);
    select o.id into du_chef from regler_piece_par_la_caisse(dossier_du_client, piece, '2026-03-04', -5) o;
    reset role;
    construit := true;

    -- CQ1 : le client, sans la case, corrige le paiement du chef.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform remplacer_paiement_par_la_caisse(dossier_du_client, du_chef, '2026-03-05', -5);
      sans_case := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sans_case is null then sans_case := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;

    -- CQ1 (suite) : portant la case, le temps d'une sous-transaction annulée — le paiement du chef, puis le sien.
    begin
      perform set_config('request.jwt.claims', '', true);
      update dossiers set statut_tva = 'exonere' where id = dossier_du_client and statut_tva is distinct from 'exonere';
      update memberships set droit_caisse = true where user_id = client and dossier_id = dossier_du_client;
      select count(*) into porteurs from memberships where user_id = client and dossier_id = dossier_du_client and droit_caisse;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select o.id into du_client from regler_piece_par_la_caisse(dossier_du_client, piece, '2026-03-04', -2) o;
      begin
        perform remplacer_paiement_par_la_caisse(dossier_du_client, du_chef, '2026-03-05', -5);
        celui_du_chef := 'ACCEPTÉ';
        raise exception 'ANNULATION_ESSAI';
      exception when others then if celui_du_chef is null then celui_du_chef := sqlstate || ' ' || sqlerrm; end if;
      end;
      begin
        select o.* into nouveau from remplacer_paiement_par_la_caisse(dossier_du_client, du_client, '2026-03-05', -2) o;
        le_sien := 'ACCEPTÉ';
      exception when others then le_sien := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      select o.retire_le is not null into ancien_retire from operations_caisse o where o.id = du_client;
      select o.retire_le is null and o.date = '2026-03-04' and o.montant = -5 into chef_entier from operations_caisse o where o.id = du_chef;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then le_sien := coalesce(le_sien, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'CQ1. le client ne corrige pas le paiement du chef, avec ou sans la case « Caisse » ; portant la case, il corrige le sien',
      'cible', 'remplacer_paiement_par_la_caisse',
      'observe', 'sans la case : ' || coalesce(sans_case, '?') || ' | le paiement du chef : ' || coalesce(celui_du_chef, '?')
        || ' | le sien : ' || coalesce(le_sien, '?') || ' | ancien retiré : ' || coalesce(ancien_retire::text, '?')
        || ' | nouveau : ' || coalesce(nouveau.origine || ' ' || nouveau.date || ' ' || nouveau.montant
          || ' remplace ' || case when nouveau.remplace_id = du_client then 'le sien' else coalesce(nouveau.remplace_id::text, 'rien') end, '?')
        || ' | le paiement du chef entier : ' || coalesce(chef_entier::text, '?'),
      'ok', porteurs = 1
        and sans_case = '42501 Accès refusé à ce dossier.'
        and celui_du_chef = '42501 Cette opération a été saisie par ton cabinet : demande-lui de la corriger.'
        and le_sien = 'ACCEPTÉ' and ancien_retire
        and nouveau.origine = 'client' and nouveau.cree_par = client and nouveau.remplace_id = du_client
        and nouveau.piece_id = piece and nouveau.date = '2026-03-05' and nouveau.montant = -2
        and chef_entier);

    -- M-CQ1 : CQ1 joué par le chef, sur son paiement — la correction passe.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform remplacer_paiement_par_la_caisse(dossier_du_client, du_chef, '2026-03-05', -5);
      chef_correction := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if chef_correction is null then chef_correction := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('jd.caisse', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-CQ1 — CQ1 joué par le chef, sur son paiement',
      'attendu', 'accepté', 'observe', chef_correction, 'mord', chef_correction = 'ACCEPTÉ');

    -- M-CQ2 : le contrôle positif sans la case — le dossier exonéré, le paiement du client posé, puis la case retirée.
    begin
      perform set_config('request.jwt.claims', '', true);
      update dossiers set statut_tva = 'exonere' where id = dossier_du_client and statut_tva is distinct from 'exonere';
      update memberships set droit_caisse = true where user_id = client and dossier_id = dossier_du_client;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select o.id into du_client from regler_piece_par_la_caisse(dossier_du_client, piece, '2026-03-04', -2) o;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      update memberships set droit_caisse = false where user_id = client and dossier_id = dossier_du_client;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform remplacer_paiement_par_la_caisse(dossier_du_client, du_client, '2026-03-05', -2);
      sans_la_case := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sans_la_case is null then sans_la_case := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-CQ2 — le contrôle positif de CQ1 sans la case « Caisse »',
      'attendu', 'refusé (42501, sa raison)', 'observe', coalesce(sans_la_case, '?'),
      'mord', coalesce(sans_la_case = '42501 Accès refusé à ce dossier.', false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- CQ2 : l'anonyme.
  begin
    set local role anon;
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform remplacer_paiement_par_la_caisse(dossier_du_client, null, null, null);
    anon_correction := 'ACCEPTÉ';
    raise exception 'ANNULATION_ESSAI';
  exception when others then if anon_correction is null then anon_correction := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('controle', 'CQ2. l''anonyme n''exécute pas la correction d''un paiement par la caisse',
    'cible', 'remplacer_paiement_par_la_caisse', 'observe', anon_correction,
    'ok', anon_correction = '42501 permission denied for function remplacer_paiement_par_la_caisse');

  -- CQ3 : le catalogue.
  select count(*) into n from pg_proc p
   where p.prosecdef and p.proconfig @> array['search_path=public']
     and not has_function_privilege('anon', p.oid, 'execute')
     and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.oid = to_regprocedure('public.remplacer_paiement_par_la_caisse(uuid, uuid, date, numeric)');
  verdicts := verdicts || jsonb_build_object('controle', 'CQ3. security definer, son chemin fixé, exécutable par les connectés, ni par l''anonyme ni par PUBLIC (lecture du catalogue)',
    'cible', 'remplacer_paiement_par_la_caisse', 'observe', n || ' sur 1', 'ok', n = 1);
  verdicts := verdicts || jsonb_build_object('controle', 'CQ. le jeu d''essai de la correction s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ TD. La trace des droits d'un accès (espace client, étape P1-trace ; migration `trace_des_droits`) ═══════════════════
-- Une table du cabinet que le client ne lit pas, pas même pour son dossier, et que personne n'écrit en direct : la lecture
-- du cabinet du dossier (`admin_du_dossier`, à authenticated) et l'insertion de la restauration (le super-administrateur) ;
-- aucune autre policy ; une garde, avant la RLS, qui refuse toute écriture hors du déclencheur et de la restauration.
--   TD1. « Banque » de l'accès du client à son dossier changée par le chef (une ligne de trace de plus) : le chef la lit (le
--        contrôle POSITIF, l'écart seul) ; le client n'en lit rien ; l'anonyme non plus.
--   TD2. Le client ne l'écrit pas (42501, la garde) ; ne la réécrit pas (aucune policy : aucune ligne touchée, la ligne
--        relue). Un retrait ne se joue pas ici (l'outil d'exécution de la production le retient) :
--        `traceDesDroitsSuppression.sql`, sur une réplique.
--   TD3. Le catalogue : la RLS active, deux policies à authenticated seul — la lecture `admin_du_dossier(dossier_id)`,
--        l'insertion `is_super_admin()`.
-- Deux mutations, qui doivent mordre : M-TD1 (la lecture élargie au client « membre », le temps d'une sous-transaction : il
-- lit la ligne de son dossier), M-TD2 (la lecture fermée : le chef ne lit plus la ligne). Avant la migration, une ligne dit
-- que le bloc attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  acces uuid; chef_avant bigint; chef_apres bigint; du_client bigint; de_l_anon text; ecrite text; reecrites bigint;
  relue boolean; elargie bigint; fermee bigint; n bigint; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.trace_des_droits') is null then
    insert into rls_verdict values ('TD. la trace des droits d''un accès : EN ATTENTE de la migration trace_des_droits',
      'trace_des_droits', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : le chef inverse « Banque » sur l'accès du client à son dossier — une ligne de trace de plus ──
    perform set_config('request.jwt.claims', '', true);
    select m.id into acces from memberships m where m.user_id = client and m.dossier_id = dossier_du_client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into chef_avant from trace_des_droits where dossier_id = dossier_du_client;
    perform changer_droits_acces(acces, null, not (select m.droit_banque from memberships m where m.id = acces), null);
    select count(*) into chef_apres from trace_des_droits where dossier_id = dossier_du_client;
    reset role;
    construit := true;

    -- TD1 : le client, puis l'anonyme.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into du_client from trace_des_droits where dossier_id = dossier_du_client;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*)::text into de_l_anon from trace_des_droits;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'TD1. le chef lit la trace du dossier du client (le contrôle positif) ; le client n''en lit rien, ni l''anonyme',
      'cible', 'trace_des_droits',
      'observe', 'le chef : ' || (chef_apres - chef_avant) || ' de plus | le client : ' || du_client || ' | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', chef_apres - chef_avant = 1 and du_client = 0 and de_l_anon = '0');

    -- TD2 : le client n'écrit ni ne réécrit la trace.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste)
        values (dossier_du_client, acces, client, 'ventes', true, 'changement');
      ecrite := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if ecrite is null then ecrite := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with t as (update trace_des_droits set coche = not coche where dossier_id = dossier_du_client returning 1)
      select count(*) into reecrites from t;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select exists (select 1 from trace_des_droits t where t.acces_id = acces and t.droit = 'banque' and t.geste = 'changement'
                    and t.fait_le = now() and t.coche = (select m.droit_banque from memberships m where m.id = acces)) into relue;
    verdicts := verdicts || jsonb_build_object('controle', 'TD2. le client n''écrit pas la trace (la garde) et ne la réécrit pas (aucune policy, la ligne relue)',
      'cible', 'trace_des_droits',
      'observe', 'écrite : ' || coalesce(ecrite, '?') || ' | réécrites : ' || reecrites || ' | relue : ' || coalesce(relue::text, '?'),
      'ok', ecrite = '42501 La trace des droits ne s''écrit que par l''écriture des droits d''un accès.' and reecrites = 0 and relue);

    -- M-TD1 : la lecture élargie au client « membre ».
    begin
      alter policy trace_des_droits_lecture on public.trace_des_droits
        using (admin_du_dossier(dossier_id) or client_du_dossier(dossier_id, 'membre'));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from trace_des_droits where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-TD1 — la lecture de la trace élargie au client « membre »',
      'attendu', 'le client lit la ligne de son dossier', 'observe', coalesce(elargie::text, '?') || ' lue(s)', 'mord', coalesce(elargie >= 1, false));

    -- M-TD2 : la lecture fermée.
    begin
      alter policy trace_des_droits_lecture on public.trace_des_droits using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select count(*) into fermee from trace_des_droits where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-TD2 — la lecture de la trace fermée',
      'attendu', 'le chef ne lit plus la ligne', 'observe', coalesce(fermee::text, '?') || ' lue(s)', 'mord', coalesce(fermee = 0, false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- TD3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'trace_des_droits' and p.roles = array['authenticated']::name[]
     and ((p.policyname = 'trace_des_droits_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check is null)
       or (p.policyname = 'trace_des_droits_restauration' and p.cmd = 'INSERT' and p.qual is null and p.with_check = 'is_super_admin()'));
  verdicts := verdicts || jsonb_build_object('controle', 'TD3. la RLS active ; deux policies à authenticated seul, la lecture du cabinet et l''insertion du super-administrateur (lecture du catalogue)',
    'cible', 'trace_des_droits',
    'observe', n || ' sur 2, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'trace_des_droits' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout, RLS '
      || (select c.relrowsecurity::text from pg_class c where c.oid = 'public.trace_des_droits'::regclass),
    'ok', n = 2 and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'trace_des_droits' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 2
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.trace_des_droits'::regclass));
  verdicts := verdicts || jsonb_build_object('controle', 'TD. le jeu d''essai de la trace s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ AR. L'adresse d'un accès retiré (espace client, P1T-E2 ; migration `adresse_des_acces_retires`) ═══════════════════
-- Une table du cabinet que le client ne lit pas, pas même pour son dossier, et que personne n'écrit en direct : la lecture
-- du cabinet du dossier (`admin_du_dossier`, à authenticated) et l'insertion de la restauration (le super-administrateur) ;
-- aucune autre policy ; une garde, avant la RLS, qui refuse toute écriture hors du déclencheur et de la restauration.
--   AR1. Une adresse réinsérée dans le dossier du client par la restauration (le chef, super-administrateur) : le chef la
--        lit (le contrôle POSITIF, l'écart seul) ; le client n'en lit rien ; l'anonyme non plus.
--   AR2. Le client ne l'écrit pas (42501, la garde) ; ne la réécrit pas (aucune policy : aucune ligne touchée, la ligne
--        relue). Un retrait ne se joue pas ici (l'outil d'exécution de la production le retient) :
--        `adresseDesAccesRetiresSuppression.sql`, sur une réplique.
--   AR3. Le catalogue : la RLS active, deux policies à authenticated seul — la lecture `admin_du_dossier(dossier_id)`,
--        l'insertion `is_super_admin()`.
-- Deux mutations, qui doivent mordre : M-AR1 (la lecture élargie au client « membre » : il lit la ligne de son dossier),
-- M-AR2 (la lecture fermée : le chef ne lit plus la ligne). Avant la migration, une ligne dit que le bloc attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  ligne uuid := gen_random_uuid(); chef_avant bigint; chef_apres bigint; du_client bigint; de_l_anon text; ecrite text;
  reecrites bigint; relue boolean; elargie bigint; fermee bigint; n bigint; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.adresses_des_acces_retires') is null then
    insert into rls_verdict values ('AR. l''adresse d''un accès retiré : EN ATTENTE de la migration adresse_des_acces_retires',
      'adresses_des_acces_retires', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : le chef, super-administrateur, réinsère une adresse dans le dossier du client (la porte de la restauration) ──
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into chef_avant from adresses_des_acces_retires where dossier_id = dossier_du_client;
    insert into adresses_des_acces_retires (id, dossier_id, acces_id, adresse)
      values (ligne, dossier_du_client, gen_random_uuid(), 'essai-rls-ar@example.test');
    select count(*) into chef_apres from adresses_des_acces_retires where dossier_id = dossier_du_client;
    reset role;
    construit := true;

    -- AR1 : le client, puis l'anonyme.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into du_client from adresses_des_acces_retires where dossier_id = dossier_du_client;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*)::text into de_l_anon from adresses_des_acces_retires;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'AR1. le chef lit l''adresse retenue dans le dossier du client (le contrôle positif) ; le client n''en lit rien, ni l''anonyme',
      'cible', 'adresses_des_acces_retires',
      'observe', 'le chef : ' || (chef_apres - chef_avant) || ' de plus | le client : ' || du_client || ' | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', chef_apres - chef_avant = 1 and du_client = 0 and de_l_anon = '0');

    -- AR2 : le client n'écrit ni ne réécrit la table.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into adresses_des_acces_retires (dossier_id, acces_id, adresse)
        values (dossier_du_client, gen_random_uuid(), 'essai-rls-ar@example.test');
      ecrite := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if ecrite is null then ecrite := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with r as (update adresses_des_acces_retires set adresse = 'autre@example.test' where dossier_id = dossier_du_client returning 1)
      select count(*) into reecrites from r;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select exists (select 1 from adresses_des_acces_retires r where r.id = ligne and r.adresse = 'essai-rls-ar@example.test') into relue;
    verdicts := verdicts || jsonb_build_object('controle', 'AR2. le client n''écrit pas l''adresse d''un accès retiré (la garde) et ne la réécrit pas (aucune policy, la ligne relue)',
      'cible', 'adresses_des_acces_retires',
      'observe', 'écrite : ' || coalesce(ecrite, '?') || ' | réécrites : ' || reecrites || ' | relue : ' || coalesce(relue::text, '?'),
      'ok', ecrite = '42501 L''adresse d''un accès retiré ne s''écrit que par le retrait de l''accès.' and reecrites = 0 and relue);

    -- M-AR1 : la lecture élargie au client « membre ».
    begin
      alter policy adresses_des_acces_retires_lecture on public.adresses_des_acces_retires
        using (admin_du_dossier(dossier_id) or client_du_dossier(dossier_id, 'membre'));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from adresses_des_acces_retires where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-AR1 — la lecture de l''adresse d''un accès retiré élargie au client « membre »',
      'attendu', 'le client lit la ligne de son dossier', 'observe', coalesce(elargie::text, '?') || ' lue(s)', 'mord', coalesce(elargie >= 1, false));

    -- M-AR2 : la lecture fermée.
    begin
      alter policy adresses_des_acces_retires_lecture on public.adresses_des_acces_retires using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select count(*) into fermee from adresses_des_acces_retires where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-AR2 — la lecture de l''adresse d''un accès retiré fermée',
      'attendu', 'le chef ne lit plus la ligne', 'observe', coalesce(fermee::text, '?') || ' lue(s)', 'mord', coalesce(fermee = 0, false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- AR3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'adresses_des_acces_retires' and p.roles = array['authenticated']::name[]
     and ((p.policyname = 'adresses_des_acces_retires_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check is null)
       or (p.policyname = 'adresses_des_acces_retires_restauration' and p.cmd = 'INSERT' and p.qual is null and p.with_check = 'is_super_admin()'));
  verdicts := verdicts || jsonb_build_object('controle', 'AR3. la RLS active ; deux policies à authenticated seul, la lecture du cabinet et l''insertion du super-administrateur (lecture du catalogue)',
    'cible', 'adresses_des_acces_retires',
    'observe', n || ' sur 2, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'adresses_des_acces_retires' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout, RLS '
      || (select c.relrowsecurity::text from pg_class c where c.oid = 'public.adresses_des_acces_retires'::regclass),
    'ok', n = 2 and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'adresses_des_acces_retires' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 2
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.adresses_des_acces_retires'::regclass));
  verdicts := verdicts || jsonb_build_object('controle', 'AR. le jeu d''essai de l''adresse d''un accès retiré s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ SP. Les situations publiées (espace client, étape C4a ; migration `situations_publiees`) ══════════════════════════
-- Une table que le client LIT sous sa case « Comptes » — la situation en cours de son dossier, rien d'autre —, que le
-- cabinet du dossier lit entière, et que personne n'écrit en direct : ses deux fonctions, ou la restauration.
--   SP1. Le chef coche « Comptes » sur l'accès du client et publie une situation de son dossier : le client la lit (le
--        contrôle POSITIF) ; la case décochée, il n'en lit rien ; l'anonyme non plus.
--   SP2. Le client ne l'écrit pas en direct (42501, la garde, sous ses mots).
--   SP3. Le catalogue : la RLS active, trois policies à authenticated seul, hors la restrictive `deux_facteurs` (C7).
-- Deux mutations, qui doivent mordre : M-SP1 (la lecture du client passée à « membre », sans `situation_publiee_en_cours`,
-- qui garde aussi la case depuis la relecture de sécurité du 06/11/2026 : la case décochée, il lit encore), M-SP2 (la
-- lecture du client fermée : la case cochée, il ne lit plus). Avant la migration, une ligne dit que le bloc attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  acces uuid; contenu jsonb; avec_case bigint; sans_case bigint; de_l_anon text; ecrite text; elargie bigint; fermee bigint;
  n bigint; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.situations_publiees') is null then
    insert into rls_verdict values ('SP. les situations publiées : EN ATTENTE de la migration situations_publiees',
      'situations_publiees', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : le chef coche « Comptes » et publie une situation au 30 juin 2025, au statut de l'exercice ──
    perform set_config('request.jwt.claims', '', true);
    select m.id into acces from memberships m where m.user_id = client and m.dossier_id = dossier_du_client;
    contenu := jsonb_build_object('version', 1,
      'statut', case when exists (select 1 from exercices_valides e where e.dossier_id = dossier_du_client and e.annee = 2025)
                     then 'validee' else 'provisoire' end,
      'periode', jsonb_build_object('debut', '2025-01-01', 'fin', '2025-06-30'),
      'postes', jsonb_build_array(jsonb_build_object('poste', 'Recettes', 'montant', 100)),
      'recettes', 100, 'depenses', 0, 'resultat', 100, 'tva', jsonb_build_object('assujetti', false), 'n_moins_1', null);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform changer_droits_acces(acces, null, null, null, true);
    perform publier_situation(dossier_du_client, '2025-06-30', contenu,
      (select s.id from situations_publiees s where s.dossier_id = dossier_du_client and s.arretee_au = '2025-06-30'
          and situation_publiee_en_cours(s.id)));
    reset role;
    construit := true;

    -- SP1 : le client avec la case, sans elle ; l'anonyme.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into avec_case from situations_publiees where dossier_id = dossier_du_client;
    reset role;
    update memberships set droit_comptes = false where id = acces;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into sans_case from situations_publiees where dossier_id = dossier_du_client;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*)::text into de_l_anon from situations_publiees;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'SP1. le client « Comptes » lit la situation en cours de son dossier (le contrôle positif) ; sans la case, rien ; l''anonyme rien',
      'cible', 'situations_publiees',
      'observe', 'avec la case : ' || avec_case || ' | sans : ' || sans_case || ' | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', avec_case = 1 and sans_case = 0 and de_l_anon = '0');

    -- SP2 : le client n'écrit pas en direct.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into situations_publiees (dossier_id, annee, geste, arretee_au, statut, contenu, auteur)
        values (dossier_du_client, 2025, 'publication', '2025-06-29', 'provisoire', contenu, client);
      ecrite := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if ecrite is null then ecrite := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'SP2. le client n''écrit pas de situation en direct (42501, la garde)',
      'cible', 'situations_publiees', 'observe', coalesce(ecrite, '?'),
      'ok', ecrite = '42501 Une situation ne s''écrit que par sa publication ou son retrait.');

    -- M-SP1 : la lecture du client passée à « membre » — la case décochée, il lit encore. La fonction de la situation en
    -- cours part avec la case : elle ne répond vrai qu'au cabinet et à un accès « Comptes », et suffirait à fermer la lecture.
    begin
      alter policy situations_publiees_lecture_comptes on public.situations_publiees
        using (client_du_dossier(dossier_id, 'membre') and geste = 'publication');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from situations_publiees where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-SP1 — la lecture des situations passée à « membre »',
      'attendu', 'le client sans la case lit la situation', 'observe', coalesce(elargie::text, '?') || ' lue(s)', 'mord', coalesce(elargie >= 1, false));

    -- M-SP2 : la lecture du client fermée — la case cochée, il ne lit plus.
    begin
      update memberships set droit_comptes = true where id = acces;
      alter policy situations_publiees_lecture_comptes on public.situations_publiees using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into fermee from situations_publiees where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-SP2 — la lecture des situations du client fermée',
      'attendu', 'le client « Comptes » ne lit plus la situation', 'observe', coalesce(fermee::text, '?') || ' lue(s)', 'mord', coalesce(fermee = 0, false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- SP3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'situations_publiees' and p.roles = array['authenticated']::name[]
     and ((p.policyname = 'situations_publiees_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check is null)
       or (p.policyname = 'situations_publiees_lecture_comptes' and p.cmd = 'SELECT' and p.with_check is null
           and p.qual = '(client_du_dossier(dossier_id, ''comptes''::text) AND (geste = ''publication''::text) AND situation_publiee_en_cours(id))')
       or (p.policyname = 'situations_publiees_restauration' and p.cmd = 'INSERT' and p.qual is null and p.with_check = 'is_super_admin()'));
  verdicts := verdicts || jsonb_build_object('controle', 'SP3. la RLS active ; trois policies à authenticated seul : la lecture du cabinet, celle d''un accès « Comptes », l''insertion du super-administrateur (lecture du catalogue)',
    'cible', 'situations_publiees',
    'observe', n || ' sur 3, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'situations_publiees'
                                     and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout, RLS '
      || (select c.relrowsecurity::text from pg_class c where c.oid = 'public.situations_publiees'::regclass),
    'ok', n = 3 and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'situations_publiees'
                       and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 3
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.situations_publiees'::regclass));
  verdicts := verdicts || jsonb_build_object('controle', 'SP. le jeu d''essai des situations s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ TC. Trois cases de plus sur un accès client (espace client, étape B1 ; migration `trois_cases_de_l_acces`) ═════════
-- « Achats », « Notes de frais » et « Documents » : trois colonnes de `memberships` qu'aucune policy ne lit encore — B1
-- n'ouvre rien ; B2, B4 et B7 s'en serviront, chacune présentant au cabinet la lecture qu'elle ouvre.
--   TC1. Par le geste : le client, ses trois cases cochées sur son dossier (le temps d'une sous-transaction), voit, table par
--        table de public et dans le stockage, exactement les lignes qu'il voit sans elles (seul l'écart est rendu).
--   TC2. Il lit ses trois cases sur sa ligne (le contrôle POSITIF) ; il ne les écrit ni en direct (aucune policy de mise à
--        jour : aucune ligne touchée) ni par `changer_droits_acces` à huit (42501).
--   TC3. Le catalogue : aucune policy, de tous les schémas, ne nomme les trois mots.
-- Deux mutations, qui doivent mordre : M-TC1 (la trace des droits lue sous « Achats » : il voit, avec la case, les lignes
-- que le geste vient d'y écrire), M-TC2 (une policy de mise à jour de sa ligne : il décoche lui-même sa case). Avant la
-- migration, une ligne dit que le bloc attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  t record; obs text; ecarts text; comparees bigint; lue text; ecrites bigint; refus text; acces uuid;
  sans jsonb; avec jsonb; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
  -- B2 (`documents_et_demandes`, préparée) se sert de « Documents » : en base, TC1 et TC3 ne jugent plus que « Achats » et
  -- « Notes de frais », et le bloc DM juge ce que « Documents » ouvre.
  b2 constant boolean := to_regclass('public.documents_cabinet') is not null;
  -- B4 (`achats_du_client`, préparée) se sert de « Achats » : en base, TC1 et TC3 ne la jugent plus, et le bloc AC juge ce
  -- qu'elle ouvre ; M-TC1 lit donc la trace sous « Notes de frais », que ni B2 ni B4 n'ouvrent.
  b4 constant boolean := to_regclass('public.paiements_declares') is not null;
  -- B7 (`notes_de_frais`, préparée) se sert de « Notes de frais » et de « Achats » (qui lit les notes soumises) : en base, TC1
  -- et TC3 ne jugent plus ni l'une ni l'autre, et le bloc NF juge ce qu'elles ouvrent. M-TC1 lit la trace sous une case
  -- qu'aucune migration en base n'ouvre ; B2 et B7 en base, il ne se joue plus (TC1 ne coche alors plus rien).
  b7 constant boolean := to_regclass('public.notes_de_frais') is not null;
  mot_libre constant text := case when not b7 then 'frais' when not b2 then 'documents' end;
begin
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.memberships'::regclass and a.attname = 'droit_documents'
                  and not a.attisdropped) then
    insert into rls_verdict values ('TC. trois cases de plus sur un accès client : EN ATTENTE de la migration trois_cases_de_l_acces',
      'memberships', 'absente : elles se jugent dès que la migration y est', true);
    return;
  end if;
  select m.id into acces from memberships m where m.user_id = client and m.dossier_id = dossier_du_client;
  -- TC1, puis M-TC1 : la même comparaison, sans puis avec la policy mutante.
  for scenario in 0 .. case when mot_libre is null then 0 else 1 end loop
    begin
      if scenario = 1 then
        execute format('create policy essai_tc_achats on public.trace_des_droits for select to authenticated '
                       'using (client_du_dossier(dossier_id, %L))', mot_libre);
      end if;
      sans := '{}'::jsonb; avec := '{}'::jsonb;
      for n in 1 .. 2 loop
        perform set_config('request.jwt.claims', '', true);
        update memberships set droit_achats = case when b4 or b7 then droit_achats else (n = 2) end,
          droit_frais = case when b7 then droit_frais else (n = 2) end,
          droit_documents = case when b2 then droit_documents else (n = 2) end where id = acces;
        for t in select c.relname as nom from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
                  where ns.nspname = 'public' and c.relkind = 'r' order by c.relname loop
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
          begin
            execute format('select count(*)::text from public.%I', t.nom) into obs;
          exception when others then obs := sqlstate;
          end;
          reset role;
          if n = 1 then sans := sans || jsonb_build_object(t.nom, obs); else avec := avec || jsonb_build_object(t.nom, obs); end if;
        end loop;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        begin
          select count(*)::text into obs from storage.objects;
        exception when others then obs := sqlstate;
        end;
        reset role;
        if n = 1 then sans := sans || jsonb_build_object('storage.objects', obs); else avec := avec || jsonb_build_object('storage.objects', obs); end if;
      end loop;
      select coalesce(string_agg(k, ', ' order by k), 'aucun') into ecarts from jsonb_each_text(avec) as e(k, v)
       where v is distinct from sans ->> k;
      comparees := (select count(*) from jsonb_object_keys(avec));
      if scenario = 0 then
        construit := true;
        verdicts := verdicts || jsonb_build_object('controle', 'TC1. les trois cases cochées, le client voit les mêmes lignes partout : tables de public et stockage (l''écart seul)',
          'cible', 'memberships', 'observe', 'écarts : ' || ecarts || ' (' || comparees || ' relations comparées)',
          'ok', ecarts = 'aucun' and comparees > 50);
      else
        mutations := mutations || jsonb_build_object('mutation', 'M-TC1 — la trace des droits lue sous la case « ' || mot_libre || ' »',
          'attendu', 'un écart sur trace_des_droits', 'observe', 'écarts : ' || ecarts, 'mord', ecarts like '%trace_des_droits%');
      end if;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  end loop;

  -- TC2, puis M-TC2 : sa ligne, lue et pas écrite.
  for scenario in 0 .. 1 loop
    begin
      if scenario = 1 then
        create policy essai_tc_ecriture on public.memberships for update to authenticated
          using (user_id = auth.uid()) with check (user_id = auth.uid());
      end if;
      perform set_config('request.jwt.claims', '', true);
      update memberships set droit_achats = true, droit_frais = true, droit_documents = true where id = acces;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select concat_ws(' ', m.droit_achats, m.droit_frais, m.droit_documents) into lue from memberships m where m.id = acces;
      with x as (update memberships set droit_achats = false where id = acces returning 1) select count(*) into ecrites from x;
      begin
        perform changer_droits_acces(acces, null, null, null, null, null, false, null);
        refus := 'ACCEPTÉ';
      exception when others then refus := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      if scenario = 0 then
        verdicts := verdicts || jsonb_build_object('controle', 'TC2. le client lit ses trois cases (le contrôle positif) ; il ne les écrit ni en direct ni par la forme à huit',
          'cible', 'memberships', 'observe', 'lues : ' || coalesce(lue, '?') || ' | écrites : ' || ecrites || ' | forme à huit : ' || refus,
          'ok', lue = 't t t' and ecrites = 0 and refus = '42501 Accès refusé à ce dossier.');
      else
        mutations := mutations || jsonb_build_object('mutation', 'M-TC2 — une policy de mise à jour de sa ligne',
          'attendu', 'il décoche lui-même « Achats »', 'observe', ecrites || ' écrite(s)', 'mord', ecrites >= 1);
      end if;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  end loop;

  -- TC3 : le catalogue.
  select coalesce(string_agg(p.schemaname || '.' || p.tablename || '.' || p.policyname, ', '), 'aucune') into obs from pg_policies p
   where mot_libre is not null
     and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~ ('''(' || array_to_string(array_remove(array_remove(array_remove(
           array['achats', 'frais', 'documents'], case when b4 or b7 then 'achats' end), case when b2 then 'documents' end),
           case when b7 then 'frais' end), '|') || ')''');
  verdicts := verdicts || jsonb_build_object('controle', 'TC3. aucune policy, de tous les schémas, ne nomme « achats », « frais » ni « documents » (lecture du catalogue)',
    'cible', 'pg_policies', 'observe', obs, 'ok', obs = 'aucune');
  verdicts := verdicts || jsonb_build_object('controle', 'TC. le jeu d''essai des trois cases s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null and acces is not null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null and acces is not null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ HR. Les droits hors de la RLS (relecture de sécurité du 06/11/2026 ; migration `droits_hors_rls`) ════════════════════
-- Quatre droits d'une table ne passent ni par la RLS ni par les déclencheurs de ligne : la vider d'un coup (la lettre D de
-- l'ACL), y poser une clé étrangère (REFERENCES), un déclencheur (TRIGGER), et MAINTAIN (PostgreSQL 17 : VACUUM, ANALYZE,
-- CLUSTER, REINDEX, REFRESH MATERIALIZED VIEW ; LOCK TABLE aussi, que UPDATE et DELETE permettent de toute façon),
-- qu'information_schema tait. Le relevé du 06/11/2026 les trouvait à anon et à authenticated sur les 85 tables et dans
-- le défaut du propriétaire ; la migration les retire. Le bloc
-- ne lit que le catalogue, et ses mutations ne sont que des GRANT, chacun annulé avec sa sous-transaction : il se joue en
-- production (sous postgres, propriétaire et non super-utilisateur) comme sur une réplique (sous le super-utilisateur).
--   HR1. Sur chaque relation de public, anon, authenticated et PUBLIC ne portent que SELECT, INSERT, UPDATE et DELETE :
--        liste BLANCHE lue à l'ACL par aclexplode, tout donneur — un privilège qu'on ne connaît pas s'y dirait —, et
--        has_table_privilege faux pour chaque privilège d'une relation hors du DML que le serveur connaît (sa liste, lue à
--        acldefault), quel que soit le chemin (un autre donneur, PUBLIC, une appartenance).
--   HR2. Sur leurs colonnes, rien d'autre que SELECT, INSERT ou UPDATE, et has_any_column_privilege faux pour REFERENCES :
--        un REFERENCES sur une seule colonne suffit à poser une clé étrangère, et HR1 ne le voit pas.
--   HR3. Les droits par défaut (de public et globaux, pour les tables) de chaque propriétaire d'une relation de public ne
--        leur donnent que le DML. L'entrée de supabase_admin ne se juge pas ici : hors de portée de postgres (il faudrait
--        être membre de supabase_admin pour la changer), elle donnerait tout à une table qu'il créerait — que HR1
--        attraperait aussitôt.
--   HR4. anon et authenticated ne sont membres d'aucun rôle (pg_maintain, à lui seul, donnerait MAINTAIN partout).
--   HR5. Le contrôle POSITIF : sur chaque relation, anon et authenticated gardent SELECT, INSERT, DELETE et une mise à jour
--        (de la table, ou d'une colonne : cabinet_admins.role), service_role et le propriétaire chaque privilège d'une
--        relation ; le défaut du propriétaire leur donne toujours le DML, et tout à service_role. Sans lui, un retrait trop
--        large passerait HR1 à HR3. Et un plancher : au moins les 85 relations du relevé, toutes examinées.
-- Six mutations, qui doivent mordre : M-HR1 (MAINTAIN rendu à authenticated sur cabinet_admins : HR1), M-HR2 (TRIGGER donné
-- à PUBLIC sur cabinet_admins : HR1, la branche de PUBLIC et le chemin d'anon par elle), M-HR3 (REFERENCES sur la colonne
-- user_id de cabinet_admins, donné à anon : HR2, que HR1 ne voit pas), M-HR4 (TRIGGER rendu à anon dans le défaut du
-- propriétaire, nommé au catalogue : HR3), M-HR5 (SELECT retiré à authenticated sur cabinet_admins : HR5), M-HR6 (HR4 jugé
-- pour pg_monitor, membre de pg_read_all_stats dans toute grappe depuis PostgreSQL 10 — et non l'inverse, que le premier
-- jeu sur la réplique a montré muet : la lecture des appartenances n'est pas aveugle). Aucune appartenance n'est
-- réellement posée : depuis PostgreSQL 16, donner un rôle demande l'option ADMIN sur lui, et le relevé n'établit pas que
-- postgres la tienne en production ; une mutation qui ne s'y jouerait pas ne prouverait rien là où le bloc compte.
-- EN ATTENTE tant que l'historique ne porte pas la migration (aucune ligne `droits_hors_rls`, ou une ligne
-- `retour_droits_hors_rls` plus récente) ET que l'état est celui d'avant (anon et authenticated tiennent, sur chaque
-- relation, chaque privilège hors du DML). L'historique seul laisserait « en attente » une réplique migrée sans sa ligne ;
-- l'état seul dirait « en attente » une régression complète après l'application (tout rendu d'un coup) : une fois la
-- ligne posée, toute régression est EN FAUTE.
do $$
declare
  -- Les lectures du bloc, rejouées telles quelles sous les mutations ; chacune rend '' quand elle ne trouve rien. $1 : la
  -- relation (HR1, HR2, HR5), le propriétaire (HR3 et le défaut de HR5), la liste des rôles (HR4).
  q_table constant text := $q$
    select coalesce(string_agg(l.x, ', ' order by l.x collate "C"), '')
      from (select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ' ' || a.privilege_type as x
              from pg_class c
             cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
             where c.oid = $1 and (a.grantee = 0 or a.grantee in (to_regrole('anon'), to_regrole('authenticated')))
               and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
            union
            select r.n || ' ' || p.privilege_type || ' (tout chemin)'
              from (values ('anon'), ('authenticated')) r(n)
             cross join (select distinct d.privilege_type from aclexplode(acldefault('r', to_regrole('anon'))) d
                          where d.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) p
             where has_table_privilege(r.n, $1, p.privilege_type)) l$q$;
  q_colonnes constant text := $q$
    select coalesce(string_agg(l.x, ', ' order by l.x collate "C"), '')
      from (select att.attname || ' ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                   || ' ' || a.privilege_type as x
              from pg_attribute att
             cross join lateral aclexplode(att.attacl) a
             where att.attrelid = $1 and att.attnum > 0 and not att.attisdropped
               and (a.grantee = 0 or a.grantee in (to_regrole('anon'), to_regrole('authenticated')))
               and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE')
            union
            select r.n || ' REFERENCES sur une colonne (tout chemin)'
              from (values ('anon'), ('authenticated')) r(n)
             where has_any_column_privilege(r.n, $1, 'REFERENCES')) l$q$;
  q_defaut constant text := $q$
    select coalesce(string_agg(l.x, ', ' order by l.x collate "C"), '')
      from (select case when d.defaclnamespace = 0 then 'global ' else 'public ' end
                   || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ' ' || a.privilege_type as x
              from pg_default_acl d
             cross join lateral aclexplode(d.defaclacl) a
             where d.defaclrole = $1 and d.defaclnamespace in (0, 'public'::regnamespace) and d.defaclobjtype = 'r'
               and (a.grantee = 0 or a.grantee in (to_regrole('anon'), to_regrole('authenticated')))
               and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) l$q$;
  q_membres constant text := $q$
    select coalesce(string_agg(pg_get_userbyid(m.member) || ' membre de ' || pg_get_userbyid(m.roleid), ', '
                               order by pg_get_userbyid(m.member)::text collate "C", pg_get_userbyid(m.roleid)::text collate "C"), '')
      from pg_auth_members m
     where pg_get_userbyid(m.member)::text = any ($1)$q$;
  q_positif constant text := $q$
    select coalesce(string_agg(l.x, ', ' order by l.x collate "C"), '')
      from (select r.n || ' sans ' || p.p as x
              from (values ('anon'), ('authenticated')) r(n)
             cross join (values ('SELECT'), ('INSERT'), ('DELETE')) p(p)
             where not has_table_privilege(r.n, $1, p.p)
            union
            select r.n || ' sans mise à jour'
              from (values ('anon'), ('authenticated')) r(n)
             where not has_any_column_privilege(r.n, $1, 'UPDATE')
            union
            select r.lib || ' sans ' || p.privilege_type
              from (select 'service_role' as lib, to_regrole('service_role')::oid as qui
                    union all
                    select 'le propriétaire', c.relowner from pg_class c where c.oid = $1) r
             cross join (select distinct d.privilege_type from aclexplode(acldefault('r', to_regrole('anon'))) d) p
             where not has_table_privilege(r.qui, $1, p.privilege_type)) l$q$;
  q_defaut_positif constant text := $q$
    select coalesce(string_agg(l.x, ', ' order by l.x collate "C"), '')
      from (select r.lib || ' sans ' || p.privilege_type || ' par défaut' as x
              from (values ('anon', true), ('authenticated', true), ('service_role', false)) r(lib, dml_seul)
             cross join (select distinct d.privilege_type from aclexplode(acldefault('r', to_regrole('anon'))) d) p
             where (not r.dml_seul or p.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
               and not exists (select 1
                                 from pg_default_acl d
                                cross join lateral aclexplode(d.defaclacl) a
                                where d.defaclrole = $1 and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
                                  and a.grantee = to_regrole(r.lib) and a.privilege_type = p.privilege_type)) l$q$;
  rel record; proprio oid; proprietaire oid; role_api text; applique text; retour text; obs text; obs_table text;
  examinees bigint := 0; hors_dml bigint;
  mutations jsonb := '[]'::jsonb;
begin
  -- EN ATTENTE : ni la ligne d'historique de la migration (ou un retour plus récent qu'elle), et l'état d'avant, entier.
  select max(version) filter (where name = 'droits_hors_rls'), max(version) filter (where name = 'retour_droits_hors_rls')
    into applique, retour from supabase_migrations.schema_migrations;
  if (applique is null or (retour is not null and retour > applique))
     and exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f'))
     and not exists (select 1
                       from pg_class c
                      cross join (values ('anon'), ('authenticated')) r(n)
                      cross join (select distinct d.privilege_type from aclexplode(acldefault('r', to_regrole('anon'))) d
                                   where d.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) p
                      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
                        and not has_table_privilege(r.n, c.oid, p.privilege_type)) then
    insert into rls_verdict values ('HR. les droits hors de la RLS : EN ATTENTE de la migration droits_hors_rls',
      'les relations de public', 'l''historique ne la porte pas, et anon et authenticated tiennent encore partout chaque droit hors du DML : ils se jugent dès que la migration y est', true);
    return;
  end if;

  -- La liste que HR1 et HR5 parcourent : le serveur connaît au moins quatre droits d'une relation hors du DML.
  select count(distinct d.privilege_type) into hors_dml
    from aclexplode(acldefault('r', to_regrole('anon'))) d
   where d.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  insert into rls_verdict values ('HR. le serveur connaît au moins quatre droits d''une relation hors du DML (la liste que HR1 et HR5 parcourent)',
    'acldefault', case when hors_dml >= 4 then 'au moins quatre' else 'moins de quatre' end, hors_dml >= 4);

  -- HR1, HR2 et HR5, relation par relation : la boucle part du catalogue, une table créée demain y entre d'elle-même.
  for rel in select c.oid, c.relname::text as nom
               from pg_class c
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
              order by c.relname collate "C" loop
    examinees := examinees + 1;
    execute q_table into obs using rel.oid;
    insert into rls_verdict values ('HR1. anon, authenticated et PUBLIC ne portent sur aucune relation de public un droit hors du DML (liste blanche, tout donneur, tout chemin)',
      rel.nom, case when obs = '' then 'le DML seul' else obs end, obs = '');
    execute q_colonnes into obs using rel.oid;
    insert into rls_verdict values ('HR2. ni sur une de ses colonnes : rien hors de SELECT, INSERT, UPDATE, aucun REFERENCES par colonne',
      rel.nom, case when obs = '' then 'rien' else obs end, obs = '');
    execute q_positif into obs using rel.oid;
    insert into rls_verdict values ('HR5. contrôle positif : anon et authenticated gardent le DML, service_role et le propriétaire chaque droit',
      rel.nom, case when obs = '' then 'intacts' else obs end, obs = '');
  end loop;
  insert into rls_verdict values ('HR5. plancher : toutes les relations de public examinées, au moins les 85 du relevé du 06/11/2026',
    'les relations de public', case when examinees >= 85 then 'plancher atteint' else 'sous le plancher' end, examinees >= 85);

  -- HR3 et le défaut de HR5, propriétaire par propriétaire.
  select c.relowner into proprietaire from pg_class c where c.oid = 'public.dossiers'::regclass;
  for proprio in select distinct c.relowner
                   from pg_class c
                  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') loop
    execute q_defaut into obs using proprio;
    insert into rls_verdict values ('HR3. les droits par défaut de chaque propriétaire d''une relation de public (de public et globaux) ne leur donnent que le DML',
      case when proprio = proprietaire then 'le propriétaire de dossiers' else pg_get_userbyid(proprio) end,
      case when obs = '' then 'le DML seul' else obs end, obs = '');
    execute q_defaut_positif into obs using proprio;
    insert into rls_verdict values ('HR5. contrôle positif : le défaut du propriétaire donne toujours le DML à anon et authenticated, chaque droit à service_role',
      case when proprio = proprietaire then 'le propriétaire de dossiers' else pg_get_userbyid(proprio) end,
      case when obs = '' then 'intact' else obs end, obs = '');
  end loop;

  -- HR4.
  foreach role_api in array array['anon', 'authenticated'] loop
    execute q_membres into obs using array[role_api];
    insert into rls_verdict values ('HR4. anon et authenticated ne sont membres d''aucun rôle', role_api,
      case when obs = '' then 'membre de rien' else obs end, obs = '');
  end loop;

  -- M-HR1 : MAINTAIN rendu à authenticated sur cabinet_admins — HR1 doit l'y voir.
  obs := null;
  begin
    grant maintain on table public.cabinet_admins to authenticated;
    execute q_table into obs using 'public.cabinet_admins'::regclass::oid;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then obs := coalesce(obs, '') || ' [' || sqlstate || ' ' || sqlerrm || ']'; end if;
  end;
  mutations := mutations || jsonb_build_object('mutation', 'M-HR1 — HR1 rejoué, MAINTAIN rendu à authenticated sur cabinet_admins',
    'attendu', 'HR1 en faute', 'observe', coalesce(nullif(obs, ''), 'rien vu'),
    'mord', coalesce(obs like '%authenticated MAINTAIN%', false));

  -- M-HR2 : TRIGGER donné à PUBLIC sur cabinet_admins — HR1 doit voir PUBLIC, et anon qui le tient par lui.
  obs := null;
  begin
    grant trigger on table public.cabinet_admins to public;
    execute q_table into obs using 'public.cabinet_admins'::regclass::oid;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then obs := coalesce(obs, '') || ' [' || sqlstate || ' ' || sqlerrm || ']'; end if;
  end;
  mutations := mutations || jsonb_build_object('mutation', 'M-HR2 — HR1 rejoué, TRIGGER donné à PUBLIC sur cabinet_admins',
    'attendu', 'HR1 en faute, PUBLIC et anon par lui', 'observe', coalesce(nullif(obs, ''), 'rien vu'),
    'mord', coalesce(obs like '%PUBLIC TRIGGER%' and obs like '%anon TRIGGER (tout chemin)%', false));

  -- M-HR3 : REFERENCES sur une seule colonne de cabinet_admins, donné à anon — HR2 le voit, HR1 non.
  obs := null; obs_table := null;
  begin
    grant references (user_id) on table public.cabinet_admins to anon;
    execute q_colonnes into obs using 'public.cabinet_admins'::regclass::oid;
    execute q_table into obs_table using 'public.cabinet_admins'::regclass::oid;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then obs := coalesce(obs, '') || ' [' || sqlstate || ' ' || sqlerrm || ']'; end if;
  end;
  mutations := mutations || jsonb_build_object('mutation', 'M-HR3 — HR2 rejoué, REFERENCES sur la colonne user_id de cabinet_admins donné à anon',
    'attendu', 'HR2 en faute, HR1 muet', 'observe', coalesce(nullif(obs, ''), 'rien vu') || ' ; HR1 : ' || coalesce(nullif(obs_table, ''), 'rien'),
    'mord', coalesce(obs like '%user_id anon REFERENCES%' and obs_table = '', false));

  -- M-HR4 : TRIGGER rendu à anon dans le défaut du propriétaire, nommé au catalogue — HR3 doit le voir.
  obs := null;
  begin
    execute format('alter default privileges for role %I in schema public grant trigger on tables to anon', pg_get_userbyid(proprietaire));
    execute q_defaut into obs using proprietaire;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then obs := coalesce(obs, '') || ' [' || sqlstate || ' ' || sqlerrm || ']'; end if;
  end;
  mutations := mutations || jsonb_build_object('mutation', 'M-HR4 — HR3 rejoué, TRIGGER rendu à anon dans le défaut du propriétaire',
    'attendu', 'HR3 en faute', 'observe', coalesce(nullif(obs, ''), 'rien vu'),
    'mord', coalesce(obs like '%public anon TRIGGER%', false));

  -- M-HR5 : SELECT retiré à authenticated sur cabinet_admins — le contrôle positif doit le voir.
  obs := null;
  begin
    revoke select on table public.cabinet_admins from authenticated;
    execute q_positif into obs using 'public.cabinet_admins'::regclass::oid;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then obs := coalesce(obs, '') || ' [' || sqlstate || ' ' || sqlerrm || ']'; end if;
  end;
  mutations := mutations || jsonb_build_object('mutation', 'M-HR5 — HR5 rejoué, SELECT retiré à authenticated sur cabinet_admins',
    'attendu', 'HR5 en faute', 'observe', coalesce(nullif(obs, ''), 'rien vu'),
    'mord', coalesce(obs like '%authenticated sans SELECT%', false));

  -- M-HR6 : HR4 jugé pour pg_monitor, membre de pg_read_all_stats dans toute grappe (le membre est pg_monitor).
  execute q_membres into obs using array['pg_monitor'];
  mutations := mutations || jsonb_build_object('mutation', 'M-HR6 — HR4 jugé pour pg_monitor, membre de pg_read_all_stats',
    'attendu', 'HR4 en faute', 'observe', coalesce(nullif(obs, ''), 'rien vu'),
    'mord', coalesce(obs like '%pg_monitor membre de pg_read_all_stats%', false));

  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ SA. Les saisies de la 2035 (étapes 2035S3 à S5 ; migration `saisies_2035`, PRÉPARÉE) ══════════════════════════════
-- Une table du cabinet que le client ne lit pas, pas même pour son dossier : une seule policy, `for all to authenticated`
-- sur `admin_du_dossier(dossier_id)`, aucune branche client ; l'écriture par `enregistrer_saisies_2035`, aux droits de
-- l'appelant. Le gel d'un exercice validé se rejoue dans `saisies2035.sql`.
--   SA1. Le chef écrit CC de 2099 dans le dossier du client et la lit (le contrôle POSITIF) ; le client, qui a un accès à
--        ce dossier, n'en lit rien ; l'anonyme non plus.
--   SA2. Le client n'écrit pas par la fonction (42501, sous ses mots), ni en direct (42501, la RLS), et ne réécrit rien.
--   SA3. Le catalogue : la RLS active, une seule policy permissive, à authenticated, `admin_du_dossier` des deux côtés.
-- Trois mutations, qui doivent mordre : M-SA1 (la lecture élargie au client « membre » : il lit la ligne de son dossier),
-- M-SA2 (la policy fermée : le chef ne lit plus la ligne), M-SA3 (l'écriture élargie au client « membre » : son insertion
-- directe passe). Avant la migration, une ligne dit que le bloc attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  lue jsonb; chef_apres bigint; du_client bigint; de_l_anon text; par_la_fonction text; en_direct text;
  reecrites bigint; elargie bigint; fermee bigint; ecrite_elargie text; n bigint; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.saisies_2035') is null then
    insert into rls_verdict values ('SA. les saisies de la 2035 : EN ATTENTE de la migration saisies_2035',
      'saisies_2035', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : le chef saisit CC de 2099 (un exercice qu'aucune validation ne fige) dans le dossier du client, contre la
    --    valeur qu'il en lit ──
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select jsonb_build_object('CC', jsonb_build_object('centimes', coalesce(max(s.centimes), 0), 'note_annexe', max(s.note_annexe)))
      into lue from saisies_2035 s where s.dossier_id = dossier_du_client and s.annee = 2099 and s.code = 'CC';
    perform enregistrer_saisies_2035(dossier_du_client, 2099, lue, '{"CC": {"centimes": 123456, "note_annexe": "Essai rls.sql"}}'::jsonb);
    select count(*) into chef_apres from saisies_2035
     where dossier_id = dossier_du_client and annee = 2099 and code = 'CC' and centimes = 123456;
    reset role;
    construit := true;

    -- SA1 : le client, puis l'anonyme.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into du_client from saisies_2035 where dossier_id = dossier_du_client;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*)::text into de_l_anon from saisies_2035;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'SA1. le chef lit la saisie de la 2035 qu''il a écrite dans le dossier du client (le contrôle positif) ; le client n''en lit rien, ni l''anonyme',
      'cible', 'saisies_2035',
      'observe', 'le chef : ' || chef_apres || ' | le client : ' || du_client || ' | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', chef_apres = 1 and du_client = 0 and de_l_anon = '0');

    -- SA2 : le client n'écrit ni ne réécrit les saisies.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_saisies_2035(dossier_du_client, 2098, '{"DE": {"centimes": 0, "note_annexe": null}}'::jsonb,
        '{"DE": {"centimes": 100, "note_annexe": null}}'::jsonb);
      par_la_fonction := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if par_la_fonction is null then par_la_fonction := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into saisies_2035 (dossier_id, annee, code, centimes) values (dossier_du_client, 2098, 'DE', 100);
      en_direct := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if en_direct is null then en_direct := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with t as (update saisies_2035 set centimes = 1 where dossier_id = dossier_du_client returning 1)
      select count(*) into reecrites from t;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'SA2. le client n''écrit pas les saisies de la 2035 (la fonction, puis la RLS) et ne les réécrit pas',
      'cible', 'saisies_2035',
      'observe', 'par la fonction : ' || coalesce(par_la_fonction, '?') || ' | en direct : ' || coalesce(en_direct, '?') || ' | réécrites : ' || reecrites,
      'ok', par_la_fonction = '42501 Les saisies de la 2035 ne s''écrivent que par le cabinet du dossier.'
        and en_direct like '42501 new row violates row-level security policy%' and reecrites = 0);

    -- M-SA1 : la lecture élargie au client « membre ».
    begin
      alter policy saisies_2035_cabinet on public.saisies_2035
        using (admin_du_dossier(dossier_id) or client_du_dossier(dossier_id, 'membre'));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from saisies_2035 where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-SA1 — la lecture des saisies de la 2035 élargie au client « membre »',
      'attendu', 'le client lit la ligne de son dossier', 'observe', coalesce(elargie::text, '?') || ' lue(s)', 'mord', coalesce(elargie >= 1, false));

    -- M-SA2 : la policy fermée.
    begin
      alter policy saisies_2035_cabinet on public.saisies_2035 using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select count(*) into fermee from saisies_2035 where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-SA2 — la policy des saisies de la 2035 fermée',
      'attendu', 'le chef ne lit plus la ligne', 'observe', coalesce(fermee::text, '?') || ' lue(s)', 'mord', coalesce(fermee = 0, false));

    -- M-SA3 : l'écriture élargie au client « membre ».
    begin
      alter policy saisies_2035_cabinet on public.saisies_2035
        with check (admin_du_dossier(dossier_id) or client_du_dossier(dossier_id, 'membre'));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      begin
        insert into saisies_2035 (dossier_id, annee, code, centimes) values (dossier_du_client, 2098, 'DE', 100);
        ecrite_elargie := 'ACCEPTÉ';
      exception when others then ecrite_elargie := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-SA3 — l''écriture des saisies de la 2035 élargie au client « membre »',
      'attendu', 'son insertion directe passe', 'observe', coalesce(ecrite_elargie, '?'), 'mord', coalesce(ecrite_elargie = 'ACCEPTÉ', false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- SA3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'saisies_2035' and p.roles = array['authenticated']::name[]
     and p.policyname = 'saisies_2035_cabinet' and p.permissive = 'PERMISSIVE' and p.cmd = 'ALL'
     and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check = 'admin_du_dossier(dossier_id)';
  verdicts := verdicts || jsonb_build_object('controle', 'SA3. la RLS active ; une seule policy, à authenticated, le cabinet du dossier des deux côtés (lecture du catalogue)',
    'cible', 'saisies_2035',
    'observe', n || ' sur 1, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'saisies_2035' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout, RLS '
      || (select c.relrowsecurity::text from pg_class c where c.oid = 'public.saisies_2035'::regclass),
    'ok', n = 1 and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'saisies_2035' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 1
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.saisies_2035'::regclass));
  verdicts := verdicts || jsonb_build_object('controle', 'SA. le jeu d''essai des saisies de la 2035 s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ SE. Les saisies de l'annexe 2035-E (ligne 48 ; migration `saisies_2035e`, PRÉPARÉE) ══════════════════════════════
-- Une table du cabinet que le client ne lit pas, pas même pour son dossier : une seule policy, `for all to authenticated`
-- sur `admin_du_dossier(dossier_id)`, aucune branche client ; l'écriture par `enregistrer_saisies_2035e`, aux droits de
-- l'appelant. Le gel d'un exercice validé, et le membre d'équipe non
-- assigné, se rejouent dans `saisies2035e.sql` (réplique seulement).
--   SE1. Le chef écrit EM de 2099 dans le dossier du client et la lit (le contrôle POSITIF) ; le client, qui a un accès à
--        ce dossier, n'en lit rien ; l'anonyme non plus.
--   SE2. Le client n'écrit pas par la fonction (42501, sous ses mots), ni en direct (42501, la RLS), et ne réécrit rien.
--   SE3. Le catalogue : la RLS active, une seule policy permissive, à authenticated, `admin_du_dossier` des deux côtés.
-- Trois mutations, qui doivent mordre : M-SE1 (la lecture élargie au client « membre » : il lit la ligne de son dossier),
-- M-SE2 (la policy fermée : le chef ne lit plus la ligne), M-SE3 (l'écriture élargie au client « membre » : son insertion
-- directe passe). Avant la migration, une ligne dit que le bloc attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  lue jsonb; chef_apres bigint; du_client bigint; de_l_anon text; par_la_fonction text; en_direct text;
  reecrites bigint; elargie bigint; fermee bigint; ecrite_elargie text; n bigint; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.saisies_2035e') is null then
    insert into rls_verdict values ('SE. les saisies de l''annexe 2035-E : EN ATTENTE de la migration saisies_2035e',
      'saisies_2035e', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : le chef saisit EM de 2099 (un exercice qu'aucune validation ne fige) dans le dossier du client, contre la
    --    valeur qu'il en lit ──
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select coalesce((select jsonb_build_object('loyers_deductibles', s.loyers_deductibles, 'plus_values', s.plus_values,
        'variation_de_stock', s.variation_de_stock, 'taxes_sur_le_chiffre_d_affaires', s.taxes_sur_le_chiffre_d_affaires,
        'dotations_biens_mis_a_disposition', s.dotations_biens_mis_a_disposition, 'moins_values', s.moins_values,
        'mono_etablissement', s.mono_etablissement, 'effectif', s.effectif)
      from saisies_2035e s where s.dossier_id = dossier_du_client and s.annee = 2099), '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}'::jsonb) into lue;
    perform enregistrer_saisies_2035e(dossier_du_client, 2099, lue, '{"loyers_deductibles": 1234, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}'::jsonb);
    select count(*) into chef_apres from saisies_2035e
     where dossier_id = dossier_du_client and annee = 2099 and loyers_deductibles = 1234;
    reset role;
    construit := true;

    -- SE1 : le client, puis l'anonyme.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into du_client from saisies_2035e where dossier_id = dossier_du_client;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*)::text into de_l_anon from saisies_2035e;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'SE1. le chef lit la saisie de l''annexe 2035-E qu''il a écrite dans le dossier du client (le contrôle positif) ; le client n''en lit rien, ni l''anonyme',
      'cible', 'saisies_2035e',
      'observe', 'le chef : ' || chef_apres || ' | le client : ' || du_client || ' | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', chef_apres = 1 and du_client = 0 and de_l_anon = '0');

    -- SE2 : le client n'écrit ni ne réécrit les saisies.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_saisies_2035e(dossier_du_client, 2098, '{"loyers_deductibles": null, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}'::jsonb,
        '{"loyers_deductibles": 1234, "plus_values": null, "variation_de_stock": null, "taxes_sur_le_chiffre_d_affaires": null, "dotations_biens_mis_a_disposition": null, "moins_values": null, "mono_etablissement": null, "effectif": null}'::jsonb);
      par_la_fonction := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if par_la_fonction is null then par_la_fonction := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into saisies_2035e (dossier_id, annee, loyers_deductibles) values (dossier_du_client, 2098, 100);
      en_direct := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if en_direct is null then en_direct := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with t as (update saisies_2035e set loyers_deductibles = 1 where dossier_id = dossier_du_client returning 1)
      select count(*) into reecrites from t;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'SE2. le client n''écrit pas les saisies de l''annexe 2035-E (la fonction, puis la RLS) et ne les réécrit pas',
      'cible', 'saisies_2035e',
      'observe', 'par la fonction : ' || coalesce(par_la_fonction, '?') || ' | en direct : ' || coalesce(en_direct, '?') || ' | réécrites : ' || reecrites,
      'ok', par_la_fonction = '42501 Les saisies de l''annexe 2035-E ne s''écrivent que par le cabinet du dossier.'
        and en_direct like '42501 new row violates row-level security policy%' and reecrites = 0);

    -- M-SE1 : la lecture élargie au client « membre ».
    begin
      alter policy saisies_2035e_cabinet on public.saisies_2035e
        using (admin_du_dossier(dossier_id) or client_du_dossier(dossier_id, 'membre'));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from saisies_2035e where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-SE1 — la lecture des saisies de l''annexe 2035-E élargie au client « membre »',
      'attendu', 'le client lit la ligne de son dossier', 'observe', coalesce(elargie::text, '?') || ' lue(s)', 'mord', coalesce(elargie >= 1, false));

    -- M-SE2 : la policy fermée.
    begin
      alter policy saisies_2035e_cabinet on public.saisies_2035e using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select count(*) into fermee from saisies_2035e where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-SE2 — la policy des saisies de l''annexe 2035-E fermée',
      'attendu', 'le chef ne lit plus la ligne', 'observe', coalesce(fermee::text, '?') || ' lue(s)', 'mord', coalesce(fermee = 0, false));

    -- M-SE3 : l'écriture élargie au client « membre ».
    begin
      alter policy saisies_2035e_cabinet on public.saisies_2035e
        with check (admin_du_dossier(dossier_id) or client_du_dossier(dossier_id, 'membre'));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      begin
        insert into saisies_2035e (dossier_id, annee, loyers_deductibles) values (dossier_du_client, 2098, 100);
        ecrite_elargie := 'ACCEPTÉ';
      exception when others then ecrite_elargie := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-SE3 — l''écriture des saisies de l''annexe 2035-E élargie au client « membre »',
      'attendu', 'son insertion directe passe', 'observe', coalesce(ecrite_elargie, '?'), 'mord', coalesce(ecrite_elargie = 'ACCEPTÉ', false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- SE3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'saisies_2035e' and p.roles = array['authenticated']::name[]
     and p.policyname = 'saisies_2035e_cabinet' and p.permissive = 'PERMISSIVE' and p.cmd = 'ALL'
     and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check = 'admin_du_dossier(dossier_id)';
  verdicts := verdicts || jsonb_build_object('controle', 'SE3. la RLS active ; une seule policy, à authenticated, le cabinet du dossier des deux côtés (lecture du catalogue)',
    'cible', 'saisies_2035e',
    'observe', n || ' sur 1, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'saisies_2035e' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout, RLS '
      || (select c.relrowsecurity::text from pg_class c where c.oid = 'public.saisies_2035e'::regclass),
    'ok', n = 1 and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'saisies_2035e' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 1
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.saisies_2035e'::regclass));
  verdicts := verdicts || jsonb_build_object('controle', 'SE. le jeu d''essai des saisies de l''annexe 2035-E s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ PC. Les paramètres des cotisations (ligne 27, TNS-Q1 et TNS-Q4 ; migration `parametres_des_cotisations`, PRÉPARÉE) ════
-- Deux tables du cabinet que le client ne lit pas, pas même pour son dossier : le début d'activité (`debuts_d_activite`,
-- hors de `dossiers`, que le client lit), l'ACRE et le taux dentiste d'un exercice (`parametres_des_cotisations`) ; une
-- seule policy chacune, `for all to authenticated` sur `admin_du_dossier(dossier_id)`, aucune branche client ; l'écriture
-- par `enregistrer_parametres_des_cotisations`, aux droits de l'appelant. Le gel se rejoue dans `parametresDesCotisations.sql`.
--   PC1. Le chef écrit les paramètres de 2099 dans le dossier du client et les lit (le contrôle POSITIF) ; le client, qui a
--        un accès à ce dossier, ne lit rien des deux tables ; l'anonyme non plus.
--   PC2. Le client n'écrit pas par la fonction (42501, sous ses mots), ni en direct dans l'une ou l'autre (42501, la RLS),
--        et ne réécrit rien.
--   PC3. Le catalogue : la RLS active sur les deux, une seule policy permissive chacune, à authenticated, `admin_du_dossier`
--        des deux côtés.
-- Trois mutations, qui doivent mordre : M-PC1 (la lecture des paramètres d'un exercice élargie au client « membre »),
-- M-PC2 (la policy du début d'activité fermée : le chef ne lit plus sa ligne), M-PC3 (l'écriture du début d'activité
-- élargie au client « membre »). Avant la migration, une ligne dit que le bloc attend.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  lus jsonb; chef_apres bigint; debut_du_chef bigint; du_client bigint; debut_du_client bigint; de_l_anon text;
  par_la_fonction text; en_direct text; debut_en_direct text; reecrites bigint; elargie bigint; fermee bigint;
  ecrite_elargie text; n bigint; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.parametres_des_cotisations') is null then
    insert into rls_verdict values ('PC. les paramètres des cotisations : EN ATTENTE de la migration parametres_des_cotisations',
      'parametres_des_cotisations', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : le chef saisit l'ACRE de 2099 (un exercice qu'aucune validation ne fige) et le début d'activité du dossier
    --    du client, contre les valeurs qu'il en lit ──
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select jsonb_build_object('debut_activite', (select d.date_debut::text from debuts_d_activite d where d.dossier_id = dossier_du_client),
      'acre', (select c.acre from parametres_des_cotisations c where c.dossier_id = dossier_du_client and c.annee = 2099),
      'taux_dentiste', (select c.taux_dentiste from parametres_des_cotisations c where c.dossier_id = dossier_du_client and c.annee = 2099))
      into lus;
    perform enregistrer_parametres_des_cotisations(dossier_du_client, 2099, lus,
      '{"debut_activite": "2098-07-01", "acre": true, "taux_dentiste": 0.42}'::jsonb);
    select count(*) into chef_apres from parametres_des_cotisations
     where dossier_id = dossier_du_client and annee = 2099 and acre and taux_dentiste = 0.42;
    select count(*) into debut_du_chef from debuts_d_activite where dossier_id = dossier_du_client and date_debut = date '2098-07-01';
    reset role;
    construit := true;

    -- PC1 : le client, puis l'anonyme.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into du_client from parametres_des_cotisations where dossier_id = dossier_du_client;
    select count(*) into debut_du_client from debuts_d_activite where dossier_id = dossier_du_client;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select ((select count(*) from parametres_des_cotisations) + (select count(*) from debuts_d_activite))::text into de_l_anon;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'PC1. le chef lit les paramètres des cotisations qu''il a écrits dans le dossier du client (le contrôle positif) ; le client n''en lit rien, ni l''anonyme',
      'cible', 'parametres_des_cotisations, debuts_d_activite',
      'observe', 'le chef : ' || chef_apres || ' et ' || debut_du_chef || ' | le client : ' || du_client || ' et ' || debut_du_client
        || ' | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', chef_apres = 1 and debut_du_chef = 1 and du_client = 0 and debut_du_client = 0 and de_l_anon = '0');

    -- PC2 : le client n'écrit ni ne réécrit les paramètres.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_parametres_des_cotisations(dossier_du_client, 2098,
        '{"debut_activite": null, "acre": null, "taux_dentiste": null}'::jsonb, '{"debut_activite": null, "acre": true, "taux_dentiste": null}'::jsonb);
      par_la_fonction := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if par_la_fonction is null then par_la_fonction := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into parametres_des_cotisations (dossier_id, annee, acre) values (dossier_du_client, 2098, true);
      en_direct := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if en_direct is null then en_direct := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      -- Le dossier du client porte déjà le début que le chef vient d'écrire : la RLS refuse avant l'unicité.
      insert into debuts_d_activite (dossier_id, date_debut) values (dossier_du_client, date '2098-01-01');
      debut_en_direct := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if debut_en_direct is null then debut_en_direct := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with t as (update parametres_des_cotisations set acre = false where dossier_id = dossier_du_client returning 1),
         u as (update debuts_d_activite set date_debut = null where dossier_id = dossier_du_client returning 1)
      select (select count(*) from t) + (select count(*) from u) into reecrites;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'PC2. le client n''écrit pas les paramètres des cotisations (la fonction, puis la RLS des deux tables) et ne les réécrit pas',
      'cible', 'parametres_des_cotisations, debuts_d_activite',
      'observe', 'par la fonction : ' || coalesce(par_la_fonction, '?') || ' | en direct : ' || coalesce(en_direct, '?')
        || ' | le début en direct : ' || coalesce(debut_en_direct, '?') || ' | réécrites : ' || reecrites,
      'ok', par_la_fonction = '42501 Les paramètres des cotisations ne s''écrivent que par le cabinet du dossier.'
        and en_direct like '42501 new row violates row-level security policy%'
        and debut_en_direct like '42501 new row violates row-level security policy%' and reecrites = 0);

    -- M-PC1 : la lecture des paramètres d'un exercice élargie au client « membre ».
    begin
      alter policy parametres_des_cotisations_cabinet on public.parametres_des_cotisations
        using (admin_du_dossier(dossier_id) or client_du_dossier(dossier_id, 'membre'));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from parametres_des_cotisations where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-PC1 — la lecture des paramètres des cotisations élargie au client « membre »',
      'attendu', 'le client lit la ligne de son dossier', 'observe', coalesce(elargie::text, '?') || ' lue(s)', 'mord', coalesce(elargie >= 1, false));

    -- M-PC2 : la policy du début d'activité fermée.
    begin
      alter policy debuts_d_activite_cabinet on public.debuts_d_activite using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select count(*) into fermee from debuts_d_activite where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-PC2 — la policy du début d''activité fermée',
      'attendu', 'le chef ne lit plus la ligne', 'observe', coalesce(fermee::text, '?') || ' lue(s)', 'mord', coalesce(fermee = 0, false));

    -- M-PC3 : l'écriture du début d'activité élargie au client « membre ».
    begin
      alter policy debuts_d_activite_cabinet on public.debuts_d_activite
        with check (admin_du_dossier(dossier_id) or client_du_dossier(dossier_id, 'membre'));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      -- La ligne du dossier existe (le chef l'a écrite) : élargie, la RLS laisse passer, et seule l'unicité refuse (23505).
      begin
        insert into debuts_d_activite (dossier_id, date_debut) values (dossier_du_client, date '2098-01-01');
        ecrite_elargie := 'ACCEPTÉ';
      exception when others then ecrite_elargie := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-PC3 — l''écriture du début d''activité élargie au client « membre »',
      'attendu', 'la RLS ne refuse plus son insertion directe', 'observe', coalesce(ecrite_elargie, '?'),
      'mord', coalesce(ecrite_elargie not like '42501%', false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- PC3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.roles = array['authenticated']::name[] and p.permissive = 'PERMISSIVE' and p.cmd = 'ALL'
     and ((p.tablename = 'parametres_des_cotisations' and p.policyname = 'parametres_des_cotisations_cabinet')
       or (p.tablename = 'debuts_d_activite' and p.policyname = 'debuts_d_activite_cabinet'))
     and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check = 'admin_du_dossier(dossier_id)';
  verdicts := verdicts || jsonb_build_object('controle', 'PC3. la RLS active sur les deux tables ; une seule policy chacune, à authenticated, le cabinet du dossier des deux côtés (lecture du catalogue)',
    'cible', 'parametres_des_cotisations, debuts_d_activite',
    'observe', n || ' sur 2, ' || (select count(*) from pg_policies p where p.schemaname = 'public'
        and p.tablename in ('parametres_des_cotisations', 'debuts_d_activite') and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE'))
      || ' en tout, RLS ' || (select string_agg(c.relrowsecurity::text, ' et ' order by c.relname)
        from pg_class c where c.oid in ('public.parametres_des_cotisations'::regclass, 'public.debuts_d_activite'::regclass)),
    'ok', n = 2 and (select count(*) from pg_policies p where p.schemaname = 'public'
        and p.tablename in ('parametres_des_cotisations', 'debuts_d_activite') and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 2
      and (select bool_and(c.relrowsecurity) from pg_class c
        where c.oid in ('public.parametres_des_cotisations'::regclass, 'public.debuts_d_activite'::regclass)));
  verdicts := verdicts || jsonb_build_object('controle', 'PC. le jeu d''essai des paramètres des cotisations s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $$;

-- ══ DF. La double authentification exigée (C7, second temps ; migration `deux_facteurs_exiges`, PRÉPARÉE) ═══════════════
-- Une policy RESTRICTIVE ne garde que la table qui la porte : la migration la pose sur chaque table de public présente à
-- son application et sur storage.objects ; une table créée APRÈS doit poser la sienne, sinon un compte exigé y lirait à
-- aal1. Le bloc ne lit que le catalogue, et ses mutations (une table créée, une policy ou un droit changés) s'annulent avec
-- leur sous-transaction : il se joue en production comme sur une réplique. La preuve par le geste (chaque profil à aal1
-- et à aal2, la pré-requête, les fonctions du cabinet) : supabase/essais/deuxFacteurs.sql, sur une réplique seulement.
--   DF1. Chaque table de public porte la policy `deux_facteurs` : restrictive, de toutes les commandes, à authenticated
--        seul, son expression ET sa vérification EXACTEMENT `(select public.deux_facteurs_satisfaits())` — le texte rendu
--        sous un chemin vide, qui nomme chaque schéma : un `or true` ajouté, une homonyme d'un autre schéma ne passent
--        pas — et dépendant d'elle (pg_depend).
--   DF2. storage.objects aussi.
--   DF3. La pré-requête de PostgREST est posée sur authenticator, vers deux_facteurs_avant_requete(), qui existe et que
--        anon, authenticated et service_role exécutent (sans elle, une fonction security definer répondrait à aal1).
--   DF4. Les tables de l'exigence n'ont aucune autre policy (rien ne s'y écrit qu'au travers des fonctions), l'anonyme
--        n'exécute ni deux_facteurs_satisfaits ni une fonction du cabinet, et aucun rôle de l'API deux_facteurs_autorite.
--   Et un plancher : au moins les 87 tables du relevé du 07/11/2026 (85, et les deux de la migration), toutes examinées.
-- Sept mutations, qui doivent mordre : M-DF1 (une table neuve, en RLS, sans la policy : DF1), M-DF2 (la policy de
-- cabinet_admins ouverte aussi à anon : DF1), M-DF3 (celle de storage.objects réduite à `true` : DF2), M-DF4 (DF3 jugé
-- pour anon, qui ne porte pas la pré-requête), M-DF5 (deux_facteurs_autorite rendue à authenticated : DF4), M-DF6 (une
-- policy d'insertion posée sur exigences_deux_facteurs : DF4), M-DF7 (celle de cabinet_admins qui nomme toujours la
-- fonction, mais s'ouvre d'un `or true` : DF1, au texte). EN ATTENTE tant que l'historique ne porte pas la migration
-- (ou porte un retour plus récent) et qu'aucune policy `deux_facteurs` n'existe.
do $df$
declare
  q_policy constant text := $q$
    select case when count(*) = 0 then 'sans la policy deux_facteurs'
                when bool_and(not p.polpermissive and p.polcmd = '*' and p.polroles = array[to_regrole('authenticated')]::oid[]
                              and p.polqual is not null and p.polwithcheck is not null
                              and pg_get_expr(p.polqual, p.polrelid) = '( SELECT public.deux_facteurs_satisfaits() AS deux_facteurs_satisfaits)'
                              and pg_get_expr(p.polwithcheck, p.polrelid) = '( SELECT public.deux_facteurs_satisfaits() AS deux_facteurs_satisfaits)'
                              and exists (select 1 from pg_depend d
                                           where d.classid = 'pg_policy'::regclass and d.objid = p.oid
                                             and d.refclassid = 'pg_proc'::regclass
                                             and d.refobjid = to_regprocedure('public.deux_facteurs_satisfaits()')))
                  then '' else 'policy deux_facteurs non conforme : ' || string_agg(
                    case when p.polpermissive then 'permissive ' else '' end || 'cmd ' || p.polcmd::text || ' rôles '
                    || (select string_agg(r::regrole::text, ',' order by r::regrole::text) from unnest(p.polroles) r) || ' '
                    || coalesce(pg_get_expr(p.polqual, p.polrelid), '∅'), '; ') end
      from pg_policy p where p.polrelid = $1 and p.polname = 'deux_facteurs'$q$;
  q_prerequete constant text := $q$
    select case when not exists (select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) as v(reglage)
                                  where s.setrole = to_regrole($1) and s.setdatabase = 0
                                    and v.reglage = 'pgrst.db_pre_request=public.deux_facteurs_avant_requete') then 'pré-requête absente de ' || $1
                when to_regprocedure('public.deux_facteurs_avant_requete()') is null then 'fonction de la pré-requête absente'
                when not (has_function_privilege('anon', 'public.deux_facteurs_avant_requete()', 'EXECUTE')
                          and has_function_privilege('authenticated', 'public.deux_facteurs_avant_requete()', 'EXECUTE')
                          and has_function_privilege('service_role', 'public.deux_facteurs_avant_requete()', 'EXECUTE'))
                  then 'un rôle de l''API ne l''exécute pas' else '' end$q$;
  q_exigence constant text := $q$
    select coalesce(string_agg(x, ', ' order by x collate "C"), '') from (
      select p.polrelid::regclass::text || '.' || p.polname as x from pg_policy p
       where p.polrelid in (to_regclass('public.exigences_deux_facteurs'), to_regclass('public.retraits_deux_facteurs'))
         and p.polname <> 'deux_facteurs'
      union all select 'anon exécute ' || f from unnest(array['public.deux_facteurs_satisfaits()', 'public.exiger_deux_facteurs(uuid)',
          'public.lever_deux_facteurs(uuid)', 'public.retirer_second_facteur(uuid)', 'public.deux_facteurs_des_comptes(uuid, uuid)']) f
       where has_function_privilege('anon', f, 'EXECUTE')
      union all select r || ' exécute deux_facteurs_autorite' from unnest(array['anon', 'authenticated', 'service_role']) r
       where has_function_privilege(r, 'public.deux_facteurs_autorite(uuid, boolean)', 'EXECUTE')) l$q$;
  rel record; applique text; retour text; obs text; examinees bigint := 0;
  mutations jsonb := '[]'::jsonb;
  chemin constant text := current_setting('search_path');
begin
  select max(version) filter (where name = 'deux_facteurs_exiges'), max(version) filter (where name = 'retour_deux_facteurs_exiges')
    into applique, retour from supabase_migrations.schema_migrations;
  if (applique is null or (retour is not null and retour > applique))
     and not exists (select 1 from pg_policy where polname = 'deux_facteurs') then
    insert into rls_verdict values ('DF. la double authentification exigée : EN ATTENTE de la migration deux_facteurs_exiges',
      'les tables de public et storage.objects', 'l''historique ne la porte pas, et aucune policy deux_facteurs n''existe : elles se jugent dès que la migration y est', true);
    return;
  end if;
  -- Le texte des expressions se rend sous un chemin vide, qui nomme le schéma de chaque fonction (DF1, DF2) ; le chemin
  -- d'avant revient à la fin du bloc.
  perform set_config('search_path', '', true);

  for rel in select c.oid, c.relname::text as nom from pg_class c
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by c.relname collate "C" loop
    examinees := examinees + 1;
    execute q_policy into obs using rel.oid;
    insert into rls_verdict values ('DF1. chaque table de public porte la policy restrictive deux_facteurs (à authenticated, toutes commandes)',
      rel.nom, case when obs = '' then 'conforme' else obs end, obs = '');
  end loop;
  insert into rls_verdict values ('DF1. plancher : toutes les tables de public examinées, au moins les 87 du relevé du 07/11/2026',
    'pg_class', examinees::text, examinees >= 87);
  execute q_policy into obs using 'storage.objects'::regclass::oid;
  insert into rls_verdict values ('DF2. storage.objects porte la policy restrictive deux_facteurs', 'storage.objects',
    case when obs = '' then 'conforme' else obs end, obs = '');
  execute q_prerequete into obs using 'authenticator';
  insert into rls_verdict values ('DF3. la pré-requête de PostgREST garde les fonctions que la RLS ne voit pas', 'authenticator',
    case when obs = '' then 'posée' else obs end, obs = '');
  execute q_exigence into obs;
  insert into rls_verdict values ('DF4. l''exigence ne s''écrit que par ses fonctions, que l''anonyme n''exécute pas', 'exigences_deux_facteurs',
    case when obs = '' then 'aucune autre porte' else obs end, obs = '');

  -- M-DF1 : une table neuve, en RLS, sans la policy — DF1 doit la voir.
  obs := null;
  begin
    create table public.df_mutation_table_neuve (id integer);
    alter table public.df_mutation_table_neuve enable row level security;
    execute q_policy into obs using 'public.df_mutation_table_neuve'::regclass::oid;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then obs := coalesce(obs, '') || ' [' || sqlstate || ' ' || sqlerrm || ']'; end if;
  end;
  mutations := mutations || jsonb_build_object('mutation', 'M-DF1 — DF1 rejoué, une table neuve sans la policy', 'attendu', 'DF1 en faute',
    'observe', coalesce(nullif(obs, ''), 'rien vu'), 'mord', coalesce(obs = 'sans la policy deux_facteurs', false));
  -- M-DF2 : la policy de cabinet_admins ouverte aussi à anon — DF1 doit le voir.
  obs := null;
  begin
    alter policy deux_facteurs on public.cabinet_admins to authenticated, anon;
    execute q_policy into obs using 'public.cabinet_admins'::regclass::oid;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then obs := coalesce(obs, '') || ' [' || sqlstate || ' ' || sqlerrm || ']'; end if;
  end;
  mutations := mutations || jsonb_build_object('mutation', 'M-DF2 — DF1 rejoué, la policy de cabinet_admins ouverte à anon', 'attendu', 'DF1 en faute',
    'observe', coalesce(nullif(obs, ''), 'rien vu'), 'mord', coalesce(obs like 'policy deux_facteurs non conforme%anon%', false));
  -- M-DF3 : celle de storage.objects réduite à `true` — DF2 doit le voir.
  obs := null;
  begin
    alter policy deux_facteurs on storage.objects using (true) with check (true);
    execute q_policy into obs using 'storage.objects'::regclass::oid;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then obs := coalesce(obs, '') || ' [' || sqlstate || ' ' || sqlerrm || ']'; end if;
  end;
  mutations := mutations || jsonb_build_object('mutation', 'M-DF3 — DF2 rejoué, la policy de storage.objects réduite à true', 'attendu', 'DF2 en faute',
    'observe', coalesce(nullif(obs, ''), 'rien vu'), 'mord', coalesce(obs like 'policy deux_facteurs non conforme%', false));
  -- M-DF4 : DF3 jugé pour anon, qui ne porte pas la pré-requête.
  execute q_prerequete into obs using 'anon';
  mutations := mutations || jsonb_build_object('mutation', 'M-DF4 — DF3 jugé pour anon, sans pré-requête', 'attendu', 'DF3 en faute',
    'observe', coalesce(nullif(obs, ''), 'rien vu'), 'mord', coalesce(obs = 'pré-requête absente de anon', false));
  -- M-DF5 : deux_facteurs_autorite rendue à authenticated — DF4 doit le voir.
  obs := null;
  begin
    grant execute on function public.deux_facteurs_autorite(uuid, boolean) to authenticated;
    execute q_exigence into obs;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then obs := coalesce(obs, '') || ' [' || sqlstate || ' ' || sqlerrm || ']'; end if;
  end;
  mutations := mutations || jsonb_build_object('mutation', 'M-DF5 — DF4 rejoué, deux_facteurs_autorite rendue à authenticated', 'attendu', 'DF4 en faute',
    'observe', coalesce(nullif(obs, ''), 'rien vu'), 'mord', coalesce(obs like '%authenticated exécute deux_facteurs_autorite%', false));
  -- M-DF6 : une policy d'insertion sur exigences_deux_facteurs — DF4 doit la voir.
  obs := null;
  begin
    create policy df_mutation_ecriture on public.exigences_deux_facteurs for insert to authenticated with check (true);
    execute q_exigence into obs;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then obs := coalesce(obs, '') || ' [' || sqlstate || ' ' || sqlerrm || ']'; end if;
  end;
  mutations := mutations || jsonb_build_object('mutation', 'M-DF6 — DF4 rejoué, une policy d''insertion sur exigences_deux_facteurs', 'attendu', 'DF4 en faute',
    'observe', coalesce(nullif(obs, ''), 'rien vu'), 'mord', coalesce(obs like '%exigences_deux_facteurs.df_mutation_ecriture%', false));
  -- M-DF7 : la policy de cabinet_admins nomme toujours la fonction, mais s'ouvre d'un `or true` — DF1 doit le voir au texte.
  obs := null;
  begin
    alter policy deux_facteurs on public.cabinet_admins
      using ((select public.deux_facteurs_satisfaits()) or true) with check ((select public.deux_facteurs_satisfaits()) or true);
    execute q_policy into obs using 'public.cabinet_admins'::regclass::oid;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then obs := coalesce(obs, '') || ' [' || sqlstate || ' ' || sqlerrm || ']'; end if;
  end;
  mutations := mutations || jsonb_build_object('mutation', 'M-DF7 — DF1 rejoué, la policy de cabinet_admins ouverte d''un or true', 'attendu', 'DF1 en faute',
    'observe', coalesce(nullif(obs, ''), 'rien vu'), 'mord', coalesce(obs like 'policy deux_facteurs non conforme%OR true%', false));
  perform set_config('search_path', chemin, true);

  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $df$;

-- ══ PR. La restauration des commentaires (RESTAU-Q1, MVP-D3 ; migration `restauration_et_suppression_d_un_dossier`,
-- PRÉPARÉE) ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- `piece_commentaires`, que le client écrit, liste ses droits un par un : la lecture (le cabinet du dossier, son client),
-- l'insertion par l'auteur lui-même sous l'origine que son droit dit, la suppression par le cabinet — et, depuis la
-- migration, l'insertion de la restauration, au super-administrateur seul. Aucune mise à jour : une parole datée ne se
-- réécrit pas.
--   PR1. Sur une pièce posée dans le dossier du client : le super-administrateur réinsère le commentaire du client (un
--        autre auteur, l'origine « client » — le contrôle POSITIF de la policy neuve) ; le client n'insère pas celui du
--        chef sous l'origine « cabinet » (42501), l'anonyme non plus ; le super-administrateur ne réécrit pas le
--        commentaire (aucune ligne touchée, le texte relu).
--   PR2. Le catalogue : quatre policies hors de la restrictive `deux_facteurs` — la lecture, l'insertion de l'auteur, la
--        suppression du cabinet, et l'insertion de la restauration, à authenticated seul, sur `is_super_admin()` ;
--        aucune policy de mise à jour ni pour toute commande.
-- Trois mutations, qui doivent mordre : M-PR1 (la policy de la restauration ouverte à tout compte : le client insère le
-- commentaire du chef), M-PR2 (la policy fermée : le super-administrateur ne réinsère plus le commentaire du client),
-- M-PR3 (une policy de mise à jour au super-administrateur : il réécrit le commentaire). Avant la migration, une ligne dit
-- que le bloc attend. Le récit : HISTORIQUE.md, « 09/11/2026 — RESTAU-Q1 ET RESTAU-Q4 ». L'essai de la migration :
-- `restaurationEtSuppressionDUnDossier.sql`.
do $pr$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  piece uuid := 'e57a0000-0000-4000-8109-0000000000f9';
  c_reinsere uuid := 'e57a0000-0000-4000-8109-0000000000e1';
  c_du_chef uuid := 'e57a0000-0000-4000-8109-0000000000e2';
  c_anon uuid := 'e57a0000-0000-4000-8109-0000000000e3';
  c_mutation uuid := 'e57a0000-0000-4000-8109-0000000000e4';
  reinsere text; du_chef text; de_l_anon text; reecrites bigint; relu text; elargie text; fermee text; maj bigint;
  n bigint; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from pg_policy p
                  where p.polrelid = 'public.piece_commentaires'::regclass and p.polname = 'piece_commentaires_restauration') then
    insert into rls_verdict values ('PR. la restauration des commentaires : EN ATTENTE de la migration restauration_et_suppression_d_un_dossier',
      'piece_commentaires', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : une pièce du dossier du client, posée par le propriétaire ──
    perform set_config('request.jwt.claims', '', true);
    insert into pieces (id, dossier_id, storage_path, nom_fichier)
      values (piece, dossier_du_client, dossier_du_client::text || '/essai-pr.pdf', 'essai-pr.pdf');
    construit := true;

    -- PR1 : le super-administrateur réinsère le commentaire du client, puis tente de le réécrire.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    begin
      insert into piece_commentaires (id, dossier_id, piece_id, auteur_id, origine, texte)
        values (c_reinsere, dossier_du_client, piece, client, 'client', 'Restauré.');
      reinsere := 'accepté';
    exception when others then reinsere := sqlstate;
    end;
    with t as (update piece_commentaires set texte = 'Réécrit.' where id = c_reinsere returning 1) select count(*) into reecrites from t;
    reset role;
    -- Le client signe du chef ; l'anonyme écrit.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    begin
      insert into piece_commentaires (id, dossier_id, piece_id, auteur_id, origine, texte)
        values (c_du_chef, dossier_du_client, piece, chef, 'cabinet', 'Signé du chef.');
      du_chef := 'ACCEPTÉ';
    exception when others then du_chef := sqlstate;
    end;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      insert into piece_commentaires (id, dossier_id, piece_id, auteur_id, origine, texte)
        values (c_anon, dossier_du_client, piece, null, 'client', 'Sans session.');
      de_l_anon := 'ACCEPTÉ';
    exception when others then de_l_anon := sqlstate;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select k.texte into relu from piece_commentaires k where k.id = c_reinsere;
    verdicts := verdicts || jsonb_build_object('controle', 'PR1. le super-administrateur réinsère le commentaire du client (le contrôle positif) et ne le réécrit pas ; le client ne signe pas du chef, l''anonyme n''écrit rien',
      'cible', 'piece_commentaires',
      'observe', 'réinséré : ' || coalesce(reinsere, '?') || ' | réécrit : ' || reecrites || ' | relu : ' || coalesce(relu, 'rien')
        || ' | le client sous le chef : ' || coalesce(du_chef, '?') || ' | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', reinsere = 'accepté' and reecrites = 0 and relu = 'Restauré.' and du_chef = '42501' and de_l_anon = '42501');

    -- M-PR1 : la policy de la restauration ouverte à tout compte.
    begin
      alter policy piece_commentaires_restauration on public.piece_commentaires with check (true);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      begin
        insert into piece_commentaires (id, dossier_id, piece_id, auteur_id, origine, texte)
          values (c_mutation, dossier_du_client, piece, chef, 'cabinet', 'Signé du chef.');
        elargie := 'accepté';
      exception when others then elargie := sqlstate;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-PR1 — la policy de la restauration des commentaires ouverte à tout compte',
      'attendu', 'le client insère le commentaire du chef', 'observe', coalesce(elargie, '?'), 'mord', coalesce(elargie = 'accepté', false));

    -- M-PR2 : la policy de la restauration fermée.
    begin
      alter policy piece_commentaires_restauration on public.piece_commentaires with check (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      begin
        insert into piece_commentaires (id, dossier_id, piece_id, auteur_id, origine, texte)
          values (c_mutation, dossier_du_client, piece, client, 'client', 'Restauré.');
        fermee := 'accepté';
      exception when others then fermee := sqlstate;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-PR2 — la policy de la restauration des commentaires fermée',
      'attendu', 'le super-administrateur ne réinsère plus le commentaire du client (42501)', 'observe', coalesce(fermee, '?'), 'mord', coalesce(fermee = '42501', false));

    -- M-PR3 : une policy de mise à jour au super-administrateur.
    begin
      create policy pr_mutation_mise_a_jour on public.piece_commentaires for update to authenticated using (is_super_admin());
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      with t as (update piece_commentaires set texte = 'Réécrit.' where id = c_reinsere returning 1) select count(*) into maj from t;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-PR3 — une policy de mise à jour des commentaires au super-administrateur',
      'attendu', 'il réécrit le commentaire réinséré', 'observe', coalesce(maj::text, '?') || ' réécrit(s)', 'mord', coalesce(maj >= 1, false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- PR2 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'piece_commentaires' and p.policyname = 'piece_commentaires_restauration'
     and p.permissive = 'PERMISSIVE' and p.cmd = 'INSERT' and p.roles = array['authenticated']::name[]
     and p.qual is null and p.with_check = 'is_super_admin()';
  verdicts := verdicts || jsonb_build_object('controle', 'PR2. quatre policies (la lecture, l''insertion de l''auteur, la suppression du cabinet, la restauration à authenticated seul sur is_super_admin()) ; aucune de mise à jour (lecture du catalogue)',
    'cible', 'piece_commentaires',
    'observe', n || ' | ' || (select string_agg(p.policyname || '=' || p.cmd, ',' order by p.policyname collate "C") from pg_policies p
                               where p.schemaname = 'public' and p.tablename = 'piece_commentaires' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE'))
      || ' | RLS ' || (select c.relrowsecurity::text from pg_class c where c.oid = 'public.piece_commentaires'::regclass),
    'ok', n = 1 and (select string_agg(p.policyname || '=' || p.cmd, ',' order by p.policyname collate "C") from pg_policies p
                      where p.schemaname = 'public' and p.tablename = 'piece_commentaires' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE'))
           = 'piece_commentaires_delete=DELETE,piece_commentaires_insert=INSERT,piece_commentaires_restauration=INSERT,piece_commentaires_select=SELECT'
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.piece_commentaires'::regclass));
  verdicts := verdicts || jsonb_build_object('controle', 'PR. le jeu d''essai des commentaires s''est construit, et rien n''en est resté', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end
      || ' | restés : ' || ((select count(*) from piece_commentaires where id in (c_reinsere, c_du_chef, c_anon, c_mutation)) + (select count(*) from pieces where id = piece)),
    'ok', construit and erreur is null
      and not exists (select 1 from piece_commentaires where id in (c_reinsere, c_du_chef, c_anon, c_mutation))
      and not exists (select 1 from pieces where id = piece));

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $pr$;

-- ══ NC. La numérotation qui continue (ligne 51.5, étape A9a ; migration `numerotation_continue`, PRÉPARÉE) ════════════
-- Deux tables du cabinet que le client ne lit pas, pas même pour son dossier : `modeles_numerotation` (le modèle de numéro
-- d'un dossier) et `continuite_des_series` (la fin confirmée d'une suite reprise, les trous levés, leur motif — un texte du
-- cabinet). Chacune : la lecture au cabinet du dossier, l'insertion de la restauration au super-administrateur, rien
-- d'autre ; l'écriture par les fonctions du chef, que la garde des deux tables annonce. Ce que ces fonctions refusent se
-- rejoue dans numerotationContinue.sql.
--   NC1. Le chef pose un modèle des factures du client dans le dossier du client, à partir de 2099 (aucune facture n'y est
--        datée), et le lit (le contrôle POSITIF) ; le client, qui a un accès à ce dossier, n'en lit rien ; l'anonyme non plus.
--   NC2. Le client ne pose pas de modèle par la fonction (42501, sous ses mots), ni en direct (42501, la garde), et ne
--        réécrit rien.
--   NC3. Le catalogue : la RLS active sur les deux tables, deux policies permissives chacune, à authenticated : la lecture
--        sur `admin_du_dossier(dossier_id)`, l'insertion sur `is_super_admin()` ; aucune autre (la restrictive
--        `deux_facteurs` mise à part).
-- Trois mutations, qui doivent mordre : M-NC1 (la lecture élargie au client « membre » : il lit le modèle de son dossier),
-- M-NC2 (la lecture fermée : le chef ne le lit plus), M-NC3 (l'insertion ouverte à tout compte, la garde ôtée : l'insertion
-- directe du client passe). Avant la migration, une ligne dit que le bloc attend.
do $nc$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  chef_lit bigint; du_client bigint; de_l_anon text; par_la_fonction text; en_direct text; reecrits bigint;
  elargie bigint; fermee bigint; ecrite text; n bigint; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.modeles_numerotation') is null then
    insert into rls_verdict values ('NC. la numérotation qui continue : EN ATTENTE de la migration numerotation_continue',
      'modeles_numerotation', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : le chef pose le modèle, et le relit ──
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform fixer_modele_numerotation(dossier_du_client, 'facture', 'client', 'RLS{AAAA}-{N:4}', true, 2099);
    select count(*) into chef_lit from modeles_numerotation where dossier_id = dossier_du_client and modele = 'RLS{AAAA}-{N:4}';
    reset role;
    construit := true;

    -- NC1 : le client, puis l'anonyme.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into du_client from modeles_numerotation where dossier_id = dossier_du_client;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*)::text into de_l_anon from modeles_numerotation;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'NC1. le chef lit le modèle qu''il a posé dans le dossier du client (le contrôle positif) ; le client n''en lit rien, ni l''anonyme',
      'cible', 'modeles_numerotation',
      'observe', 'le chef : ' || chef_lit || ' | le client : ' || du_client || ' | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', chef_lit = 1 and du_client = 0 and de_l_anon = '0');

    -- NC2 : le client ne pose ni ne réécrit un modèle.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform fixer_modele_numerotation(dossier_du_client, 'avoir', 'client', 'RLT{AAAA}-{N:4}', true, 2099);
      par_la_fonction := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if par_la_fonction is null then par_la_fonction := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into modeles_numerotation (dossier_id, nature, emetteur, modele, annuel, depuis)
        values (dossier_du_client, 'avoir', 'client', 'RLT{AAAA}-{N:4}', true, 2099);
      en_direct := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if en_direct is null then en_direct := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with t as (update modeles_numerotation set depuis = 2098 where dossier_id = dossier_du_client returning 1)
      select count(*) into reecrits from t;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'NC2. le client ne pose pas de modèle (la fonction, puis la garde) et n''en réécrit aucun',
      'cible', 'modeles_numerotation',
      'observe', 'par la fonction : ' || coalesce(par_la_fonction, '?') || ' | en direct : ' || coalesce(en_direct, '?') || ' | réécrits : ' || reecrits,
      'ok', par_la_fonction = '42501 Accès refusé à ce dossier.'
        and en_direct = case when exists (select 1 from pg_trigger g where g.tgrelid = 'public.modeles_numerotation'::regclass and g.tgname = '_acces_avant_les_gardes')
                             then '42501 new row violates row-level security policy for table "modeles_numerotation"'
                             else '42501 Un modèle de numéro ne se pose que par sa fonction, qui le juge.' end and reecrits = 0);

    -- M-NC1 : la lecture élargie au client « membre ».
    begin
      alter policy modeles_numerotation_lecture on public.modeles_numerotation
        using (admin_du_dossier(dossier_id) or client_du_dossier(dossier_id, 'membre'));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from modeles_numerotation where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-NC1 — la lecture des modèles de numéro élargie au client « membre »',
      'attendu', 'le client lit le modèle de son dossier', 'observe', coalesce(elargie::text, '?') || ' lu(s)', 'mord', coalesce(elargie >= 1, false));

    -- M-NC2 : la lecture fermée.
    begin
      alter policy modeles_numerotation_lecture on public.modeles_numerotation using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select count(*) into fermee from modeles_numerotation where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-NC2 — la lecture des modèles de numéro fermée',
      'attendu', 'le chef ne lit plus le modèle', 'observe', coalesce(fermee::text, '?') || ' lu(s)', 'mord', coalesce(fermee = 0, false));

    -- M-NC3 : l'insertion ouverte à tout compte, la garde ôtée.
    begin
      alter policy modeles_numerotation_restauration on public.modeles_numerotation with check (true);
      alter table public.modeles_numerotation disable trigger modeles_numerotation_garde;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      begin
        insert into modeles_numerotation (dossier_id, nature, emetteur, modele, annuel, depuis)
          values (dossier_du_client, 'avoir', 'client', 'RLT{AAAA}-{N:4}', true, 2099);
        ecrite := 'ACCEPTÉ';
      exception when others then ecrite := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-NC3 — l''insertion des modèles de numéro ouverte à tout compte, sans la garde',
      'attendu', 'l''insertion directe du client passe', 'observe', coalesce(ecrite, '?'), 'mord', coalesce(ecrite = 'ACCEPTÉ', false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- NC3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename in ('modeles_numerotation', 'continuite_des_series')
     and p.roles = array['authenticated']::name[] and p.permissive = 'PERMISSIVE'
     and ((p.policyname = p.tablename || '_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check is null)
       or (p.policyname = p.tablename || '_restauration' and p.cmd = 'INSERT' and p.with_check = 'is_super_admin()' and p.qual is null));
  verdicts := verdicts || jsonb_build_object('controle', 'NC3. la RLS active sur les deux tables ; deux policies chacune, à authenticated : la lecture du cabinet, l''insertion de la restauration (lecture du catalogue)',
    'cible', 'modeles_numerotation, continuite_des_series',
    'observe', n || ' sur 4, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename in ('modeles_numerotation', 'continuite_des_series') and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout, RLS '
      || (select string_agg(c.relrowsecurity::text, '/' order by c.relname) from pg_class c where c.oid in ('public.modeles_numerotation'::regclass, 'public.continuite_des_series'::regclass)),
    'ok', n = 4 and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename in ('modeles_numerotation', 'continuite_des_series') and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 4
      and (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.modeles_numerotation'::regclass, 'public.continuite_des_series'::regclass)));
  verdicts := verdicts || jsonb_build_object('controle', 'NC. le jeu d''essai de la numérotation qui continue s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end
      || ' | restés : ' || (select count(*) from modeles_numerotation where dossier_id = dossier_du_client and modele in ('RLS{AAAA}-{N:4}', 'RLT{AAAA}-{N:4}')),
    'ok', construit and erreur is null
      and not exists (select 1 from modeles_numerotation where dossier_id = dossier_du_client and modele in ('RLS{AAAA}-{N:4}', 'RLT{AAAA}-{N:4}')));

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $nc$;

-- ══ PF. Le fichier d'une pièce figée (ligne 44, INAL1 ; migration `piece_figee_dans_le_stockage`, PRÉPARÉE) ════════════
-- La policy de suppression du seau `pieces` refuse le fichier d'une pièce qu'une écriture validée cite (ou son bien), ou
-- que la révision cite, et d'un document que la révision cite (`fichier_fige`) ; elle passe à `authenticated`. Une
-- suppression ne se joue pas en production : ce bloc la juge sans elle.
--   PF1. Le catalogue : `pieces_storage_delete`, de suppression, permissive, à authenticated seul, sans vérification, son
--        prédicat mot pour mot (lu sous un chemin vide, qui nomme le schéma de chaque fonction), et qui dépend de
--        `fichier_fige`.
--   PF2. Aucune autre policy permissive de suppression, ni « pour tout », ne nomme le seau `pieces` : une seconde, jointe
--        par OU, défairait le resserrement.
--   PF3. Le prédicat de la policy, lu au catalogue et jugé sous la session du chef (lecture et suppression : la suppression
--        de l'API nomme et rend ses lignes, la policy de lecture s'y applique aussi), sur trois fichiers d'un dossier
--        jetable de son cabinet : le fichier d'une pièce qu'une écriture validée cite ne se supprimerait pas ; celui d'une
--        pièce libre et un fichier qu'aucune ligne ne désigne, si (le contrôle POSITIF). Sous la session du client, rien.
--   PF4. `fichier_fige` : `security definer`, stable, son chemin de recherche ; exécutable par authenticated, pas par
--        l'anonyme ni par PUBLIC.
-- Deux mutations, qui doivent mordre : M-PF1 (le prédicat d'hier, le temps d'une sous-transaction : le fichier figé se
-- supprimerait), M-PF2 (la policy rendue à `public` : PF1 tombe). Avant la migration, une ligne dit que le bloc attend.
-- Le récit : HISTORIQUE.md, « 10/11/2026 — INAL1 ET INAL2 ».
do $pf$
declare
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  cabinet uuid;
  dossier uuid := 'f19e0000-0000-4000-8109-0000000000a1';
  piece_figee uuid := 'f19e0000-0000-4000-8109-000000000f01';
  piece_libre uuid := 'f19e0000-0000-4000-8109-000000000f03';
  chemin_avant text := current_setting('search_path');
  attendu_predicat constant text := '((bucket_id = ''pieces''::text) AND public.admin_du_dossier(((storage.foldername(name))[1])::uuid) AND (NOT public.fichier_fige(name)))';
  q_catalogue constant text := $q$select count(*) from pg_policy p
     where p.polrelid = 'storage.objects'::regclass and p.polname = 'pieces_storage_delete' and p.polcmd = 'd' and p.polpermissive
       and p.polroles = array['authenticated'::regrole]::oid[] and p.polwithcheck is null
       and pg_get_expr(p.polqual, p.polrelid) = $1
       and exists (select 1 from pg_depend d where d.classid = 'pg_policy'::regclass and d.objid = p.oid
                     and d.refclassid = 'pg_proc'::regclass and d.refobjid = 'public.fichier_fige(text)'::regprocedure)$q$;
  predicat text; vu_chef text; vu_client text; muee text; autres text;
  n bigint; n_mutee bigint; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.fichier_fige(text)') is null then
    insert into rls_verdict values ('PF. le fichier d''une pièce figée : EN ATTENTE de la migration piece_figee_dans_le_stockage',
      'storage.objects', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  begin
    -- ── Le jeu : un dossier jetable du cabinet du chef, deux pièces et trois fichiers ; une écriture validée cite la
    -- première (le réglage que pose `valider_exercice`, le temps de l'insertion).
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id) values (dossier, 'ESSAI RLS PF', cabinet);
    insert into pieces (id, dossier_id, storage_path, nom_fichier) values
      (piece_figee, dossier, dossier::text || '/fige.pdf', 'fige.pdf'), (piece_libre, dossier, dossier::text || '/libre.pdf', 'libre.pdf');
    insert into storage.objects (bucket_id, name) values
      ('pieces', dossier::text || '/fige.pdf'), ('pieces', dossier::text || '/libre.pdf'), ('pieces', dossier::text || '/orphelin.pdf');
    perform set_config('jd.validation_exercice', dossier::text, true);
    insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, piece_id, valide_le, journal_code,
                                     numero_ecriture, piece_ref, piece_date, compte_lib) values
      (dossier, '2025-03-10', '606100', 'ESSAI RLS PF', 100, 'debit', 'validee', piece_figee, now(), 'AC', 1, 'F1', '2025-03-10', 'Achats'),
      (dossier, '2025-03-10', '512000', 'ESSAI RLS PF', 100, 'credit', 'validee', piece_figee, now(), 'AC', 1, 'F1', '2025-03-10', 'Banque');
    perform set_config('jd.validation_exercice', '', true);
    construit := true;

    -- PF3 : le prédicat de la policy, tel que le catalogue le porte (lu sous un chemin vide), jugé sous chaque session.
    perform set_config('search_path', '', true);
    select pg_get_expr(p.polqual, p.polrelid) into predicat from pg_policy p
     where p.polrelid = 'storage.objects'::regclass and p.polname = 'pieces_storage_delete';
    perform set_config('search_path', chemin_avant, true);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    execute format('select coalesce(string_agg(split_part(o.name, ''/'', 2), '','' order by o.name collate "C"), '''') from storage.objects o where o.bucket_id = ''pieces'' and o.name like %L and (%s)',
                   dossier::text || '/%', predicat) into vu_chef;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    execute format('select coalesce(string_agg(split_part(o.name, ''/'', 2), '','' order by o.name collate "C"), '''') from storage.objects o where o.bucket_id = ''pieces'' and o.name like %L and (%s)',
                   dossier::text || '/%', predicat) into vu_client;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'PF3. le prédicat de la suppression, jugé sans supprimer : le chef supprimerait le fichier libre et l''orphelin, pas le fichier figé (le contrôle positif) ; le client, rien',
      'cible', 'storage.objects (pieces)',
      'observe', 'le chef : ' || coalesce(vu_chef, '?') || ' | le client : ' || coalesce(nullif(vu_client, ''), 'rien'),
      'ok', vu_chef = 'libre.pdf,orphelin.pdf' and vu_client = '');

    -- M-PF1 : le prédicat d'hier, le temps d'une sous-transaction.
    begin
      alter policy pieces_storage_delete on storage.objects
        using (bucket_id = 'pieces' and admin_du_dossier(((storage.foldername(name))[1])::uuid));
      perform set_config('search_path', '', true);
      select pg_get_expr(p.polqual, p.polrelid) into predicat from pg_policy p
       where p.polrelid = 'storage.objects'::regclass and p.polname = 'pieces_storage_delete';
      perform set_config('search_path', chemin_avant, true);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      execute format('select coalesce(string_agg(split_part(o.name, ''/'', 2), '','' order by o.name collate "C"), '''') from storage.objects o where o.bucket_id = ''pieces'' and o.name like %L and (%s)',
                     dossier::text || '/%', predicat) into muee;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('search_path', chemin_avant, true);
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-PF1 — le prédicat d''hier sur la suppression du seau pieces',
      'attendu', 'le fichier figé se supprimerait', 'observe', coalesce(muee, '?'), 'mord', coalesce(muee like '%fige.pdf%', false));

    -- M-PF2 : la policy rendue à public — PF1 tombe.
    begin
      alter policy pieces_storage_delete on storage.objects to public;
      perform set_config('search_path', '', true);
      execute q_catalogue into n_mutee using attendu_predicat;
      perform set_config('search_path', chemin_avant, true);
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    perform set_config('search_path', chemin_avant, true);
    mutations := mutations || jsonb_build_object('mutation', 'M-PF2 — la policy de suppression du seau pieces rendue à public',
      'attendu', 'PF1 tombe (0 policy conforme)', 'observe', coalesce(n_mutee::text, '?') || ' conforme(s)', 'mord', coalesce(n_mutee = 0, false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('jd.validation_exercice', '', true);
  perform set_config('search_path', chemin_avant, true);

  -- PF1 et PF2 : le catalogue.
  perform set_config('search_path', '', true);
  execute q_catalogue into n using attendu_predicat;
  select string_agg(p.polname, ',' order by p.polname collate "C") into autres from pg_policy p
   where p.polrelid = 'storage.objects'::regclass and p.polpermissive and p.polcmd in ('d', '*')
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%''pieces''%';
  perform set_config('search_path', chemin_avant, true);
  verdicts := verdicts || jsonb_build_object('controle', 'PF1. pieces_storage_delete : de suppression, permissive, à authenticated seul, son prédicat mot pour mot, qui dépend de fichier_fige (lecture du catalogue)',
    'cible', 'storage.objects', 'observe', n || ' conforme(s)', 'ok', n = 1);
  verdicts := verdicts || jsonb_build_object('controle', 'PF2. aucune autre policy permissive de suppression, ni « pour tout », ne nomme le seau pieces (lecture du catalogue)',
    'cible', 'storage.objects', 'observe', coalesce(autres, 'aucune'), 'ok', autres = 'pieces_storage_delete');
  -- PF4 : la fonction.
  verdicts := verdicts || jsonb_build_object('controle', 'PF4. fichier_fige : security definer, stable, son chemin de recherche ; authenticated l''exécute, ni l''anonyme ni PUBLIC (lecture du catalogue)',
    'cible', 'fichier_fige',
    'observe', (select p.prosecdef || '/' || p.provolatile::text || '/' || coalesce(array_to_string(p.proconfig, ','), '')
                  from pg_proc p where p.oid = 'public.fichier_fige(text)'::regprocedure)
      || ' | anon ' || has_function_privilege('anon', 'public.fichier_fige(text)', 'execute')
      || ' | authenticated ' || has_function_privilege('authenticated', 'public.fichier_fige(text)', 'execute')
      || ' | public ' || coalesce((select bool_or(a.grantee = 0) from pg_proc p cross join lateral aclexplode(p.proacl) a
                                    where p.oid = 'public.fichier_fige(text)'::regprocedure), false),
    'ok', (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public']
             from pg_proc p where p.oid = 'public.fichier_fige(text)'::regprocedure)
      and not has_function_privilege('anon', 'public.fichier_fige(text)', 'execute')
      and has_function_privilege('authenticated', 'public.fichier_fige(text)', 'execute')
      and not coalesce((select bool_or(a.grantee = 0) from pg_proc p cross join lateral aclexplode(p.proacl) a
                         where p.oid = 'public.fichier_fige(text)'::regprocedure), false));
  verdicts := verdicts || jsonb_build_object('controle', 'PF. le jeu d''essai du fichier figé s''est construit, et rien n''en est resté', 'cible', 'le dossier jetable',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end
      || ' | restés : ' || ((select count(*) from dossiers where id = dossier)
                            + (select count(*) from storage.objects where bucket_id = 'pieces' and name like dossier::text || '/%')),
    'ok', construit and erreur is null and not exists (select 1 from dossiers where id = dossier)
      and not exists (select 1 from storage.objects where bucket_id = 'pieces' and name like dossier::text || '/%'));

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $pf$;

-- ══ RC. Les factures reprises, au client (ligne 51.5, A8C-Q1 et A8Q5-Q2 ; migration `reprises_au_client`, PRÉPARÉE) ════════
-- Deux fonctions neuves, `security definer`, lisent aux droits de leur propriétaire le registre des reprises et les liens
-- des pièces, que le cabinet lit seul : `reprise_de_la_facture` rend au cabinet et à l'accès « Ventes » les chiffres des
-- plafonds d'une facture reprise ; `pieces_citees_de_la_simulation` rend au cabinet et à l'accès « Banque » les pièces
-- citées par un lien actif. Elles contournent la RLS : elles se rejouent, chaque refus jugé à sa RAISON.
--   RC1. Le client qui porte « Ventes » lit ce que l'encaissement de sa facture reprise demande — le contrôle POSITIF —, et
--        rien d'autre : les six clés de la fonction.
--   RC2. Sans « Ventes » — « Banque » seule, puis aucune case — : « Accès refusé à ce dossier. » (42501).
--   RC3. Le client qui porte « Banque » lit les pièces citées de son dossier (le contrôle POSITIF) ; « Ventes » seule, puis
--        aucune case : refusé.
--   RC4. L'autre dossier, où il n'a aucun accès, ses deux cases posées : refusé aux deux fonctions ; l'anonyme bute sur le
--        droit d'exécution, un compte rattaché à rien sur la raison de la fonction.
--   RC5. Le catalogue : `security definer`, stables, leur chemin fixé ; exécutables par les connectés, ni par l'anonyme ni
--        par PUBLIC.
-- Trois mutations, qui doivent mordre : M-RC1 (RC1 rejoué sans « Ventes » : refusé), M-RC2 (RC3 rejoué sans « Banque » :
-- refusé), M-RC3 (l'exécution rendue à l'anonyme : il lit la raison de la fonction, plus le droit d'exécution). Le jeu : un
-- dossier jetable du cabinet du chef, basculé, l'accès du client d'essai, sa date de reprise, une facture reprise et la
-- pièce de vente qu'elle cite ; tout s'annule. Avant la migration, une ligne dit que le bloc attend. Le récit :
-- HISTORIQUE.md, « A8C-Q1 ET A8Q5-Q2 : LES FACTURES REPRISES, AU CLIENT ».
do $rc$
declare
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  autre_dossier uuid := '001c7ed7-c23b-4590-901e-693489f8af24';
  dossier uuid := 'a8c20000-0000-4000-8000-0000000000d1';
  acces uuid := 'a8c20000-0000-4000-8000-0000000000a1';
  piece uuid := 'a8c20000-0000-4000-8000-0000000000b1';
  cabinet uuid;
  reprise constant date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  refus constant text := 'Accès refusé à ce dossier.';
  cles constant text := 'credite_par_les_repris_centimes,credite_par_les_repris_par_taux,encaisse_avant_reprise_centimes,encaisse_par_taux,nature_operation,reprise_le';
  facture uuid; profil text; n bigint; v jsonb; obs text; motif text; message text; accepte boolean;
  erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.reprise_de_la_facture(uuid, uuid)') is null
     or to_regprocedure('public.pieces_citees_de_la_simulation(uuid)') is null then
    insert into rls_verdict values ('RC. les factures reprises, au client : EN ATTENTE de la migration reprises_au_client',
      'reprise_de_la_facture, pieces_citees_de_la_simulation', 'absentes : leurs droits se jugent dès que la migration y est', true);
    return;
  end if;
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  begin
    -- ── Le jeu, sans session : le dossier jetable, basculé, et l'accès du client ; puis, sous la session du chef, la date
    -- de reprise, une facture reprise (50 € encaissés avant la reprise) et la pièce de vente qu'elle cite.
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, statut_tva, siret,
                          adresse, forme_juridique, denomination_imprimee) values
      (dossier, 'ESSAI RLS RC', cabinet, 'tresorerie', '455000', true, 'redevable', '12345678200010',
       'ESSAI RLS RC ADRESSE', '5710', 'ESSAI RLS RC SOCIÉTÉ');
    insert into memberships (id, user_id, dossier_id, role, email, droit_ventes, droit_banque) values
      (acces, client, dossier, 'client', 'essai-rls-rc@example.test', false, false);
    insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, date_piece, montant_ttc) values
      (piece, dossier, dossier::text || '/essai-rls-rc.pdf', 'essai-rls-rc.pdf', 'vente', 'a_valider', reprise - 10, 120);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform fixer_reprise_des_factures(dossier, reprise);
    perform importer_factures(dossier, '{"format": "csv"}'::jsonb, jsonb_build_array(jsonb_build_object(
      'numero', 'RC-1', 'type', 'facture', 'date_emission', reprise - 10, 'tiers_nom', 'Client RC', 'type_client', 'non_assujetti',
      'nature_operation', 'services', 'option_debits', false, 'montant_ht', 100, 'montant_tva', 20, 'montant_ttc', 120,
      'lignes', jsonb_build_array(jsonb_build_object('designation', 'Prestation', 'quantite', 1, 'prix_unitaire_ht', 100, 'taux_tva', 20)),
      'encaisse_avant_reprise', 50, 'encaisse_par_taux', jsonb_build_array(jsonb_build_object('taux', 20, 'encaisse', 50)),
      'transmise_par', 'pdf')));
    select f.id into facture from factures_emises f where f.dossier_id = dossier and f.numero = 'RC-1';
    perform citer_piece_de_facture_reprise(dossier, facture, piece);
    reset role;
    perform set_config('request.jwt.claims', '', true);
    construit := true;

    -- RC1, RC2 : `reprise_de_la_facture`, sous chaque case.
    foreach profil in array array['ventes', 'banque', 'aucune'] loop
      accepte := false; motif := null; message := null; v := null;
      begin
        update memberships set droit_ventes = (profil = 'ventes'), droit_banque = (profil = 'banque') where id = acces;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        v := reprise_de_la_facture(dossier, facture);
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then motif := sqlstate; message := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || case when profil = 'ventes' then jsonb_build_object(
        'controle', 'RC1. le client « Ventes » lit ce que l''encaissement de sa facture reprise demande, six clés et elles seules (contrôle positif)',
        'cible', 'reprise_de_la_facture', 'observe', case when accepte then coalesce(v::text, '∅') else motif || ' ' || message end,
        'ok', accepte and motif = 'P0001' and (v ->> 'encaisse_avant_reprise_centimes') = '5000'
          and (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(v) k) = cles)
      else jsonb_build_object(
        'controle', 'RC2. sans « Ventes », le client ne lit pas ce qu''une facture reprise porte',
        'cible', profil, 'observe', case when accepte then 'accepté' else motif || ' ' || message end,
        'ok', not accepte and motif = '42501' and message = refus) end;
    end loop;

    -- M-RC1 : RC1 rejoué sans « Ventes ».
    obs := null;
    begin
      update memberships set droit_ventes = false, droit_banque = true where id = acces;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform reprise_de_la_facture(dossier, facture);
      obs := 'accepté';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if obs is null then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-RC1 — RC1 rejoué sans la case « Ventes »',
      'attendu', 'refusé', 'observe', obs, 'mord', obs = '42501 ' || refus);

    -- RC3 : `pieces_citees_de_la_simulation`, sous chaque case.
    foreach profil in array array['banque', 'ventes', 'aucune'] loop
      accepte := false; motif := null; message := null; v := null;
      begin
        update memberships set droit_ventes = (profil = 'ventes'), droit_banque = (profil = 'banque') where id = acces;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        v := pieces_citees_de_la_simulation(dossier);
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then motif := sqlstate; message := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object(
        'controle', 'RC3. le client « Banque » lit les pièces citées de son dossier (contrôle positif) ; « Ventes » seule ou aucune case, non',
        'cible', profil, 'observe', case when accepte then coalesce(v::text, '∅') else motif || ' ' || message end,
        'ok', case when profil = 'banque' then accepte and motif = 'P0001' and v = jsonb_build_array(piece)
                   else not accepte and motif = '42501' and message = refus end);
    end loop;

    -- M-RC2 : RC3 rejoué sans « Banque ».
    obs := null;
    begin
      update memberships set droit_ventes = true, droit_banque = false where id = acces;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform pieces_citees_de_la_simulation(dossier);
      obs := 'accepté';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if obs is null then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-RC2 — RC3 rejoué sans la case « Banque »',
      'attendu', 'refusé', 'observe', obs, 'mord', obs = '42501 ' || refus);

    -- RC4 : l'autre dossier, ses deux cases posées ; l'anonyme ; un compte rattaché à rien.
    foreach profil in array array['autre', 'anon', 'inconnu'] loop
      foreach obs in array array['reprise_de_la_facture', 'pieces_citees_de_la_simulation'] loop
        accepte := false; motif := null; message := null;
        begin
          update memberships set droit_ventes = true, droit_banque = true where id = acces;
          execute format('set local role %I', case profil when 'anon' then 'anon' else 'authenticated' end);
          perform set_config('request.jwt.claims', case profil when 'anon' then '{"role":"anon"}'
            else json_build_object('sub', case profil when 'inconnu' then inconnu else client end, 'role', 'authenticated')::text end, true);
          if obs = 'reprise_de_la_facture' then
            perform reprise_de_la_facture(case profil when 'autre' then autre_dossier else dossier end, facture);
          else
            perform pieces_citees_de_la_simulation(case profil when 'autre' then autre_dossier else dossier end);
          end if;
          accepte := true;
          raise exception 'ANNULATION_ESSAI';
        exception when others then motif := sqlstate; message := sqlerrm;
        end;
        reset role;
        verdicts := verdicts || jsonb_build_object(
          'controle', 'RC4. l''autre dossier et un compte rattaché à rien sont refusés ; l''anonyme n''exécute pas les fonctions',
          'cible', profil || ' / ' || obs, 'observe', case when accepte then 'accepté' else motif || ' ' || message end,
          'ok', not accepte and motif = '42501'
            and message = case profil when 'anon' then 'permission denied for function ' || obs else refus end);
      end loop;
    end loop;

    -- M-RC3 : l'exécution rendue à l'anonyme — il lit la raison de la fonction, plus le droit d'exécution.
    obs := null;
    begin
      grant execute on function public.reprise_de_la_facture(uuid, uuid) to anon;
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      perform reprise_de_la_facture(dossier, facture);
      obs := 'accepté';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if obs is null then obs := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-RC3 — RC4 rejoué, l''exécution rendue à l''anonyme',
      'attendu', 'un autre refus que le droit d''exécution', 'observe', coalesce(obs, '?'),
      'mord', obs is distinct from '42501 permission denied for function reprise_de_la_facture');

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- RC5 : le catalogue.
  select count(*) into n from pg_proc p
   where p.oid in (to_regprocedure('public.reprise_de_la_facture(uuid, uuid)'), to_regprocedure('public.pieces_citees_de_la_simulation(uuid)'))
     and p.prosecdef and p.provolatile = 's' and p.proconfig @> array['search_path=public']
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0);
  verdicts := verdicts || jsonb_build_object('controle', 'RC5. security definer, stables, leur chemin fixé ; les connectés les exécutent, ni l''anonyme ni PUBLIC (lecture du catalogue)',
    'cible', 'reprise_de_la_facture, pieces_citees_de_la_simulation', 'observe', case when n = 2 then 'conformes' else 'NON CONFORMES' end, 'ok', n = 2);
  verdicts := verdicts || jsonb_build_object('controle', 'RC. le jeu d''essai des reprises au client s''est construit, et rien n''en est resté', 'cible', 'le dossier jetable',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null and not exists (select 1 from dossiers where id = dossier)
      and not exists (select 1 from memberships where id = acces));

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $rc$;

-- ══ OR. L'original d'une facture reprise retenu par son import (ligne 51.5, A8D2A-Q1 ; migration
-- `originaux_retenus_par_leur_import`, PRÉPARÉE) ══════════════════════════════════════════════════════════════════════════
-- Sous `<dossier>/imports/` du seau `ventes`, la suppression refuse l'original d'un import qui existe
-- (`original_d_un_import`) ; la suppression d'un dossier libère ses originaux au chef de son cabinet (`originaux_liberes`,
-- le déclencheur `dossiers_liberer_les_originaux`), à qui la lecture et la suppression les ouvrent (`original_libere`).
-- Une suppression ne se joue pas en production : ce bloc juge les deux prédicats, lus au catalogue, sans elle ; la
-- suppression elle-même, le déclencheur et la restauration se jouent par `originalDUnImport.sql` (réplique).
--   OR1. Le catalogue : `ventes_suppression_par_le_chef`, de suppression, permissive, à authenticated seul, sans
--        vérification, son prédicat mot pour mot, qui dépend des deux fonctions ; `ventes_lecture`, de lecture, de même,
--        qui dépend de `original_libere`.
--   OR2. Aucune autre policy permissive de lecture, de suppression ni « pour tout » ne nomme le seau `ventes`.
--   OR3. Les deux prédicats, jugés ensemble (la suppression de l'API nomme et rend ses lignes) sous chaque session, sur un
--        dossier jetable du cabinet du chef qui porte un import (L, le fichier du lot ; X, un fichier du lot qu'aucune
--        ligne ne désigne) et sur l'original libéré R d'un dossier qui n'existe plus : le chef supprimerait X et R, pas L
--        (le contrôle POSITIF) ; le chef du cabinet qui n'est pas super-administrateur aussi ; le client et un compte
--        rattaché à rien, rien.
--   OR4. Les deux fonctions : `security definer`, stables, leur chemin de recherche ; authenticated les exécute, ni
--        l'anonyme ni PUBLIC ; personne n'exécute le déclencheur ; il est BEFORE DELETE de chaque ligne de `dossiers`,
--        actif ; `originaux_liberes` a sa RLS et aucune policy permissive.
-- Trois mutations, qui doivent mordre : M-OR1 (le prédicat de suppression d'A8d2a : L se supprimerait), M-OR2 (la lecture
-- sans la libération : le chef qui n'est pas super-administrateur ne verrait plus R), M-OR3 (une policy de lecture ouverte
-- sur `originaux_liberes` : OR4 tombe). Avant la migration, une ligne dit que le bloc attend.
do $or$
declare
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  cabinet uuid;
  dossier uuid := 'a8d2f000-0000-4000-8000-0000000000d1';
  lot uuid := 'a8d2f000-0000-4000-8000-00000000001a';
  chemin_l text := 'a8d2f000-0000-4000-8000-0000000000d1/imports/a8d2f000-0000-4000-8000-00000000001a/' || repeat('a', 64) || '.pdf';
  chemin_x text := 'a8d2f000-0000-4000-8000-0000000000d1/imports/a8d2f000-0000-4000-8000-00000000001a/' || repeat('b', 64) || '.csv';
  chemin_r text := 'a8d2f000-0000-4000-8000-0000000000e1/imports/a8d2f000-0000-4000-8000-00000000002a/' || repeat('c', 64) || '.xml';
  chemin_avant text := current_setting('search_path');
  attendu_suppression constant text := $a$((bucket_id = 'ventes'::text) AND
CASE
    WHEN (name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/'::text) THEN (((EXISTS ( SELECT 1
       FROM public.dossiers d
      WHERE ((d.id = ((storage.foldername(objects.name))[1])::uuid) AND public.est_chef_du_cabinet(d.cabinet_id)))) AND (NOT public.original_d_un_import(name))) OR public.original_libere(name))
    WHEN (name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'::text) THEN (EXISTS ( SELECT 1
       FROM public.dossiers d
      WHERE ((d.id = ((storage.foldername(objects.name))[1])::uuid) AND public.est_chef_du_cabinet(d.cabinet_id))))
    ELSE false
END)$a$;
  attendu_lecture constant text := $a$((bucket_id = 'ventes'::text) AND
CASE
    WHEN (name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imports/'::text) THEN (public.admin_du_dossier(((storage.foldername(name))[1])::uuid) OR public.original_libere(name))
    WHEN (name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'::text) THEN public.gere_les_ventes(((storage.foldername(name))[1])::uuid)
    ELSE false
END)$a$;
  -- Sans alias : le prédicat de suppression nomme la table (`objects.name`) dans sa sous-requête.
  q_vus constant text := $q$select coalesce(string_agg(case name when %L then 'L' when %L then 'X' when %L then 'R' end, ',' order by name collate "C"), '')
      from storage.objects where bucket_id = 'ventes' and name in (%L, %L, %L) and (%s) and (%s)$q$;
  pred_suppression text; pred_lecture text;
  vu_chef text; vu_chef_simple text; vu_client text; vu_inconnu text; muee1 text; muee2 text;
  n bigint; n_lecture bigint; n_mutee bigint; autres text; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regprocedure('public.original_d_un_import(text)') is null and to_regclass('public.originaux_liberes') is null then
    insert into rls_verdict values ('OR. l''original d''une facture reprise retenu par son import : EN ATTENTE de la migration originaux_retenus_par_leur_import',
      'storage.objects (ventes, imports/)', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  begin
    -- ── Le jeu, par le propriétaire sans session : un dossier jetable du cabinet du chef, son import (le réglage que pose
    -- `importer_factures`, le temps de l'insertion), deux fichiers du lot ; l'original libéré d'un dossier qui n'existe pas.
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id) values (dossier, 'ESSAI RLS OR', cabinet);
    perform set_config('jd.import_lot', lot::text, true);
    insert into imports_factures (id, dossier_id, format, fichier_sha256, fichier_taille, fichier_chemin, nombre_factures)
      values (lot, dossier, 'facturx', repeat('a', 64), 10, chemin_l, 1);
    perform set_config('jd.import_lot', '', true);
    insert into storage.objects (bucket_id, name, metadata) values
      ('ventes', chemin_l, '{"size": 10, "mimetype": "application/pdf"}'), ('ventes', chemin_x, '{"size": 10, "mimetype": "text/csv"}'),
      ('ventes', chemin_r, '{"size": 10, "mimetype": "text/plain"}');
    insert into originaux_liberes (chemin, cabinet_id) values (chemin_r, cabinet);
    construit := true;

    -- OR3 : les deux prédicats, tels que le catalogue les porte (lus sous un chemin vide), jugés sous chaque session.
    perform set_config('search_path', '', true);
    select pg_get_expr(p.polqual, p.polrelid) into pred_suppression from pg_policy p
     where p.polrelid = 'storage.objects'::regclass and p.polname = 'ventes_suppression_par_le_chef';
    select pg_get_expr(p.polqual, p.polrelid) into pred_lecture from pg_policy p
     where p.polrelid = 'storage.objects'::regclass and p.polname = 'ventes_lecture';
    perform set_config('search_path', chemin_avant, true);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    execute format(q_vus, chemin_l, chemin_x, chemin_r, chemin_l, chemin_x, chemin_r, pred_suppression, pred_lecture) into vu_chef;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    execute format(q_vus, chemin_l, chemin_x, chemin_r, chemin_l, chemin_x, chemin_r, pred_suppression, pred_lecture) into vu_client;
    perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
    execute format(q_vus, chemin_l, chemin_x, chemin_r, chemin_l, chemin_x, chemin_r, pred_suppression, pred_lecture) into vu_inconnu;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    -- Le chef du cabinet qui n'est pas super-administrateur : le compte du client, rangé ainsi le temps d'une
    -- sous-transaction annulée.
    begin
      insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      execute format(q_vus, chemin_l, chemin_x, chemin_r, chemin_l, chemin_x, chemin_r, pred_suppression, pred_lecture) into vu_chef_simple;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'OR3. les prédicats de lecture et de suppression, jugés sans supprimer : le chef supprimerait X et R, pas L (le contrôle positif) ; le chef qui n''est pas super-administrateur aussi ; le client et un compte rattaché à rien, rien',
      'cible', 'storage.objects (ventes, imports/)',
      'observe', 'le chef : ' || coalesce(vu_chef, '?') || ' | le chef simple : ' || coalesce(vu_chef_simple, '?')
        || ' | le client : ' || coalesce(nullif(vu_client, ''), 'rien') || ' | l''inconnu : ' || coalesce(nullif(vu_inconnu, ''), 'rien'),
      'ok', vu_chef = 'X,R' and vu_chef_simple = 'X,R' and vu_client = '' and vu_inconnu = '');

    -- M-OR1 : le prédicat de suppression d'A8d2a, le temps d'une sous-transaction — L se supprimerait.
    begin
      alter policy ventes_suppression_par_le_chef on storage.objects
        using (bucket_id = 'ventes' and case
          when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then exists (select 1 from public.dossiers d where d.id = (storage.foldername(name))[1]::uuid and public.est_chef_du_cabinet(d.cabinet_id))
          else false end);
      perform set_config('search_path', '', true);
      select pg_get_expr(p.polqual, p.polrelid) into pred_suppression from pg_policy p
       where p.polrelid = 'storage.objects'::regclass and p.polname = 'ventes_suppression_par_le_chef';
      perform set_config('search_path', chemin_avant, true);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      execute format(q_vus, chemin_l, chemin_x, chemin_r, chemin_l, chemin_x, chemin_r, pred_suppression, pred_lecture) into muee1;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('search_path', chemin_avant, true);
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-OR1 — le prédicat de suppression d''A8d2a sur le seau des ventes',
      'attendu', 'l''original L se supprimerait', 'observe', coalesce(muee1, '?'), 'mord', coalesce(muee1 like '%L%', false));

    -- M-OR2 : la lecture sans la libération — le chef qui n'est pas super-administrateur ne voit plus R.
    begin
      insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
      perform set_config('search_path', '', true);
      select pg_get_expr(p.polqual, p.polrelid) into pred_suppression from pg_policy p
       where p.polrelid = 'storage.objects'::regclass and p.polname = 'ventes_suppression_par_le_chef';
      perform set_config('search_path', chemin_avant, true);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      execute format(q_vus, chemin_l, chemin_x, chemin_r, chemin_l, chemin_x, chemin_r, pred_suppression,
                     replace(pred_lecture, ' OR public.original_libere(name)', '')) into muee2;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('search_path', chemin_avant, true);
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-OR2 — la lecture des originaux sans la libération',
      'attendu', 'R n''est plus vu du chef qui n''est pas super-administrateur', 'observe', coalesce(nullif(muee2, ''), 'rien'),
      'mord', coalesce(muee2 not like '%R%' and pred_lecture like '% OR public.original_libere(name)%', false));

    -- M-OR3 : une policy de lecture ouverte sur la table des libérations — OR4 tombe.
    begin
      create policy essai_rls_or on public.originaux_liberes for select to authenticated using (true);
      select count(*) into n_mutee from pg_policy p where p.polrelid = 'public.originaux_liberes'::regclass and p.polpermissive;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    mutations := mutations || jsonb_build_object('mutation', 'M-OR3 — une policy de lecture ouverte sur originaux_liberes',
      'attendu', 'OR4 tombe (une policy permissive)', 'observe', coalesce(n_mutee::text, '?') || ' policy permissive', 'mord', coalesce(n_mutee > 0, false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('jd.import_lot', '', true);
  perform set_config('search_path', chemin_avant, true);

  -- OR1 et OR2 : le catalogue, lu sous un chemin vide.
  perform set_config('search_path', '', true);
  select count(*) into n from pg_policy p
   where p.polrelid = 'storage.objects'::regclass and p.polname = 'ventes_suppression_par_le_chef' and p.polcmd = 'd' and p.polpermissive
     and p.polroles = array['authenticated'::regrole]::oid[] and p.polwithcheck is null
     and pg_get_expr(p.polqual, p.polrelid) = attendu_suppression
     and (select count(*) from pg_depend d where d.classid = 'pg_policy'::regclass and d.objid = p.oid and d.refclassid = 'pg_proc'::regclass
            and d.refobjid in (to_regprocedure('public.original_d_un_import(text)'), to_regprocedure('public.original_libere(text)'))) = 2;
  select count(*) into n_lecture from pg_policy p
   where p.polrelid = 'storage.objects'::regclass and p.polname = 'ventes_lecture' and p.polcmd = 'r' and p.polpermissive
     and p.polroles = array['authenticated'::regrole]::oid[] and p.polwithcheck is null
     and pg_get_expr(p.polqual, p.polrelid) = attendu_lecture
     and exists (select 1 from pg_depend d where d.classid = 'pg_policy'::regclass and d.objid = p.oid and d.refclassid = 'pg_proc'::regclass
                   and d.refobjid = to_regprocedure('public.original_libere(text)'));
  select string_agg(p.polname, ',' order by p.polname collate "C") into autres from pg_policy p
   where p.polrelid = 'storage.objects'::regclass and p.polpermissive and p.polcmd in ('d', 'r', '*')
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%''ventes''%';
  perform set_config('search_path', chemin_avant, true);
  verdicts := verdicts || jsonb_build_object('controle', 'OR1. ventes_suppression_par_le_chef et ventes_lecture : leur commande, permissives, à authenticated seul, leur prédicat mot pour mot, qui dépend des fonctions (lecture du catalogue)',
    'cible', 'storage.objects', 'observe', 'suppression ' || n || ' conforme(s) | lecture ' || n_lecture || ' conforme(s)', 'ok', n = 1 and n_lecture = 1);
  verdicts := verdicts || jsonb_build_object('controle', 'OR2. aucune autre policy permissive de lecture, de suppression ni « pour tout » ne nomme le seau ventes (lecture du catalogue)',
    'cible', 'storage.objects', 'observe', coalesce(autres, 'aucune'), 'ok', autres = 'ventes_lecture,ventes_suppression_par_le_chef');
  -- OR4 : les fonctions, le déclencheur, la table.
  verdicts := verdicts || jsonb_build_object('controle', 'OR4. original_d_un_import et original_libere : security definer, stables, leur chemin de recherche, exécutées par authenticated, ni par l''anonyme ni par PUBLIC ; le déclencheur de la libération, BEFORE DELETE de chaque ligne de dossiers, actif, que personne n''exécute ; originaux_liberes, sa RLS, aucune policy permissive (lecture du catalogue)',
    'cible', 'original_d_un_import, original_libere, dossiers_liberer_les_originaux, originaux_liberes',
    'observe', (select count(*) from pg_proc p where p.oid in (to_regprocedure('public.original_d_un_import(text)'), to_regprocedure('public.original_libere(text)'))
                  and p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public']
                  and not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')
                  and not coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), false))::text || ' fonction(s) conforme(s) | déclencheur '
      || coalesce((select (t.tgtype = 11 and t.tgenabled = 'O')::text from pg_trigger t where t.tgrelid = 'public.dossiers'::regclass and t.tgname = 'dossiers_liberer_les_originaux'), 'absent')
      || ' | exécutable par authenticated ' || coalesce(has_function_privilege('authenticated', to_regprocedure('public.liberer_les_originaux_du_dossier()'), 'execute')::text, '?')
      || ' | RLS ' || coalesce((select c.relrowsecurity::text from pg_class c where c.oid = to_regclass('public.originaux_liberes')), 'table absente')
      || ' | policies permissives ' || (select count(*) from pg_policy p where p.polrelid = to_regclass('public.originaux_liberes') and p.polpermissive),
    'ok', (select count(*) from pg_proc p where p.oid in (to_regprocedure('public.original_d_un_import(text)'), to_regprocedure('public.original_libere(text)'))
             and p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public']
             and not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')
             and not coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), false)) = 2
      and coalesce((select t.tgtype = 11 and t.tgenabled = 'O' from pg_trigger t
                     where t.tgrelid = 'public.dossiers'::regclass and t.tgname = 'dossiers_liberer_les_originaux'
                       and t.tgfoid = to_regprocedure('public.liberer_les_originaux_du_dossier()')), false)
      and not coalesce(has_function_privilege('authenticated', to_regprocedure('public.liberer_les_originaux_du_dossier()'), 'execute'), true)
      and coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.originaux_liberes')), false)
      and not exists (select 1 from pg_policy p where p.polrelid = to_regclass('public.originaux_liberes') and p.polpermissive));
  verdicts := verdicts || jsonb_build_object('controle', 'OR. le jeu d''essai des originaux retenus s''est construit, et rien n''en est resté', 'cible', 'le dossier jetable',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end
      || ' | restés : ' || ((select count(*) from dossiers where id = dossier)
                            + (select count(*) from storage.objects where bucket_id = 'ventes' and name in (chemin_l, chemin_x, chemin_r))),
    'ok', construit and erreur is null and not exists (select 1 from dossiers where id = dossier)
      and not exists (select 1 from storage.objects where bucket_id = 'ventes' and name in (chemin_l, chemin_x, chemin_r)));

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $or$;

-- ═══ Le départ d'un client : les paquets téléchargés et la conservation (INAL5, ligne 44) ═══════════════════════════
--
-- Depuis la migration `depart_du_client` (préparée le 11/11/2026), deux tables du cabinet : `paquets_d_archive_telecharges`
-- (une ligne par paquet d'archive téléchargé) et `conservations_des_dossiers` (la conservation d'un dossier, posée et levée).
-- Elles ne s'écrivent que par trois fonctions `security definer` ; la restauration y insère au super-administrateur.
-- Quatre profils : l'anonyme n'exécute pas les fonctions (DP1) ; un compte rattaché à rien se les voit refuser en 42501, à
-- leurs mots (DP2) ; le client ne lit ni le téléchargement ni la conservation de son dossier, que le chef lit (DP3, la
-- mutation M-DP3 rejoue la lecture sous le chef) ; un compte rattaché à rien n'insère dans aucune des deux (DP4) ; au
-- catalogue, les fonctions sont exécutables par `authenticated` seul, les gardes par aucun rôle de session, et les deux
-- tables n'ont que quatre policies `to authenticated`, de lecture et de restauration (DP5). Le jeu : une ligne de chaque
-- table dans le dossier du client, la conservation déjà LEVÉE (une conservation en cours ne cohabite pas avec son accès),
-- dans une sous-transaction annulée. Ce que les fonctions refusent encore, et la suppression : `departDuClient.sql`.
-- EN ATTENTE tant que la migration n'est pas en base.
do $dp$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  n bigint; etat text; message text; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.conservations_des_dossiers') is null then
    insert into rls_verdict values ('DP. le départ d''un client : EN ATTENTE de la migration depart_du_client',
      'conservations_des_dossiers', 'absente : le départ se juge dès que la migration y est', true);
    return;
  end if;
  begin
    perform set_config('request.jwt.claims', '', true);
    execute format('insert into paquets_d_archive_telecharges (dossier_id, annee, empreinte_exercice, empreinte_du_manifeste, '
      || 'nb_fichiers, nb_non_verifiees, telecharge_par) values (%L, 2025, repeat(''a'', 64), repeat(''b'', 64), 3, 0, %L)', dossier_du_client, chef);
    execute format('insert into conservations_des_dossiers (dossier_id, dernier_exercice, jusqu_au, posee_le, posee_par, levee_le, levee_par) '
      || 'values (%L, 2025, ''2035-12-31'', now() - interval ''1 day'', %L, now(), %L)', dossier_du_client, chef, chef);
    construit := true;

    -- DP1 : l'anonyme n'exécute pas les fonctions.
    begin
      set local role anon;
      perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      execute format('select conserver_le_dossier(%L)', dossier_du_client);
      etat := 'acceptée';
    exception when others then etat := sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'DP1. anonyme n''exécute pas les fonctions du départ', 'cible', 'conserver_le_dossier',
      'observe', etat, 'ok', etat = '42501');

    -- DP2 : un compte rattaché à rien.
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      execute format('select enregistrer_paquet_telecharge(%L, 2025, repeat(''a'', 64), repeat(''b'', 64), 3, 0)', dossier_du_client);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'DP2. inconnu authentifié n''enregistre pas de paquet', 'cible', 'enregistrer_paquet_telecharge',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = 'Accès refusé à ce dossier.');
    message := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      execute format('select lever_la_conservation(%L)', dossier_du_client);
      etat := 'acceptée';
    exception when others then etat := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'DP2. inconnu authentifié ne lève pas de conservation', 'cible', 'lever_la_conservation',
      'observe', etat || ' ' || coalesce(message, ''), 'ok', etat = '42501' and message = 'Seul le chef du cabinet conserve un dossier ou lève sa conservation.');

    -- DP3 : le client ne lit rien de son dossier ; M-DP3 : la même lecture sous le chef.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    execute format('select (select count(*) from paquets_d_archive_telecharges where dossier_id = %L) '
      || '+ (select count(*) from conservations_des_dossiers where dossier_id = %L)', dossier_du_client, dossier_du_client) into n;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'DP3. client ne lit ni les paquets téléchargés ni la conservation de son dossier', 'cible', 'paquets_d_archive_telecharges, conservations_des_dossiers',
      'observe', n || ' ligne(s)', 'ok', n = 0);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    execute format('select (select count(*) from paquets_d_archive_telecharges where dossier_id = %L) '
      || '+ (select count(*) from conservations_des_dossiers where dossier_id = %L)', dossier_du_client, dossier_du_client) into n;
    reset role;
    mutations := mutations || jsonb_build_object('mutation', 'M-DP3 — DP3 rejoué sous le chef', 'attendu', 'les deux lignes lues',
      'observe', n || ' ligne(s)', 'mord', n = 2);

    -- DP4 : un compte rattaché à rien n'insère dans aucune des deux tables.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      execute format('insert into paquets_d_archive_telecharges (dossier_id, annee, empreinte_exercice, empreinte_du_manifeste, '
        || 'nb_fichiers, nb_non_verifiees, telecharge_par) values (%L, 2024, repeat(''a'', 64), repeat(''b'', 64), 3, 0, %L)', dossier_du_client, inconnu);
      etat := 'acceptée';
    exception when others then etat := sqlstate;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      execute format('insert into conservations_des_dossiers (dossier_id, dernier_exercice, jusqu_au, posee_par, levee_le, levee_par) '
        || 'values (%L, 2024, ''2034-12-31'', %L, now(), %L)', dossier_du_client, inconnu, inconnu);
      etat := etat || '/acceptée';
    exception when others then etat := etat || '/' || sqlstate;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', 'DP4. inconnu authentifié n''insère ni téléchargement ni conservation (la restauration est au super-administrateur)', 'cible', 'paquets_d_archive_telecharges_restauration, conservations_des_dossiers_restauration',
      'observe', etat, 'ok', etat = '42501/42501');
    raise exception 'annuler le jeu' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- DP5 : le catalogue.
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and p.proname in ('enregistrer_paquet_telecharge', 'conserver_le_dossier', 'lever_la_conservation')
     and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
     and not coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false);
  verdicts := verdicts || jsonb_build_object('controle', 'DP5. les trois fonctions du départ : security definer, exécutables par authenticated seul (lecture du catalogue)',
    'cible', 'les trois fonctions', 'observe', n || ' telle(s) quelle(s)', 'ok', n = 3);
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('garder_conservation_du_dossier', 'garder_dossier_conserve', 'garder_depart_du_dossier')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  verdicts := verdicts || jsonb_build_object('controle', 'DP5. les trois gardes du départ : aucun rôle de session ne les exécute (lecture du catalogue)',
    'cible', 'les trois gardes', 'observe', n || ' exécutable(s)', 'ok', n = 0);
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename in ('paquets_d_archive_telecharges', 'conservations_des_dossiers')
     and not (roles = '{authenticated}' and cmd in ('SELECT', 'INSERT'));
  verdicts := verdicts || jsonb_build_object('controle', 'DP5. les deux tables : des policies to authenticated, de lecture et de restauration seulement (lecture du catalogue)',
    'cible', 'paquets_d_archive_telecharges, conservations_des_dossiers', 'observe', n || ' autre(s)', 'ok', n = 0
      and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('paquets_d_archive_telecharges', 'conservations_des_dossiers')) = 4);
  verdicts := verdicts || jsonb_build_object('controle', 'DP. le jeu d''essai du départ s''est construit, et rien n''en est resté', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $dp$;

-- ══ DM. Les documents et les demandes du cabinet (espace client, étape B2 ; migration `documents_et_demandes`, PRÉPARÉE) ══
-- Cinq tables et un seau : ce que le cabinet met à disposition, lu par l'accès « Documents » seul ; ses demandes, leurs
-- réponses et leurs relances, lues par tout accès du dossier ; rien d'écrit en direct, tout par les fonctions.
--   DM1. Le chef publie un document du dossier du client et y ouvre une demande : le client « Documents » lit le document et
--        son fichier (le contrôle POSITIF), et la demande ; sa case décochée, ni le document ni le fichier, mais la demande ;
--        l'anonyme et un compte rattaché à rien, rien.
--   DM2. Le client n'écrit directement aucune des cinq tables (42501, leurs gardes, avant la RLS).
--   DM3. Le client « Documents » ne dépose rien dans le seau (la policy de dépôt, au cabinet du dossier seul).
--   DM4. Le catalogue : la RLS des cinq tables, quinze policies à authenticated (hors la restrictive `deux_facteurs`), le
--        seau privé, la suppression au chef du cabinet du dossier (une suppression SQL du stockage se refuse à tous : elle se
--        lit au catalogue, RGPD.md §8.6 ; documentsCabinetSuppression.sql la joue sur une réplique).
-- Quatre mutations, qui doivent mordre : M-DM1 (la lecture des documents passée à « membre » : sans la case, il lit le
-- document), M-DM2 (la lecture du seau ouverte à tout accès du dossier : sans la case, il lit le fichier), M-DM3 (la lecture
-- des demandes fermée : il ne lit plus la demande), M-DM4 (le dépôt du seau ouvert à tout accès : il dépose). Avant la
-- migration, une ligne dit que le bloc attend.
do $dm$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  doc uuid := gen_random_uuid();
  chemin text;
  acces uuid; obs text; avec text; sans text; anon_vu text; inconnu_vu text; depot text; ecritures text; erreur text;
  construit boolean := false; n bigint;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.documents_cabinet') is null then
    insert into rls_verdict values ('DM. les documents et les demandes du cabinet : EN ATTENTE de la migration documents_et_demandes',
      'documents_cabinet', 'absente : elles se jugent dès que la migration y est', true);
    return;
  end if;
  chemin := dossier_du_client::text || '/' || doc::text || '/' || repeat('d', 64) || '.pdf';
  select m.id into acces from memberships m where m.user_id = client and m.dossier_id = dossier_du_client;
  for scenario in 0 .. 4 loop
    begin
      avec := null; sans := null; anon_vu := null; inconnu_vu := null; depot := null; ecritures := null;
      if scenario = 1 then
        alter policy documents_cabinet_lecture_documents on public.documents_cabinet
          using (client_du_dossier(dossier_id, 'membre') and retire_le is null);
      elsif scenario = 2 then
        alter policy documents_cabinet_storage_lecture on storage.objects
          using (bucket_id = 'documents-cabinet' and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
                 then public.client_du_dossier(((storage.foldername(name))[1])::uuid, 'membre') else false end);
      elsif scenario = 3 then
        alter policy demandes_cabinet_lecture_membre on public.demandes_cabinet using (false);
      elsif scenario = 4 then
        alter policy documents_cabinet_storage_depot on storage.objects
          with check (bucket_id = 'documents-cabinet' and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
                      then public.admin_du_dossier(((storage.foldername(name))[1])::uuid)
                           or public.client_du_dossier(((storage.foldername(name))[1])::uuid, 'membre') else false end);
      end if;
      -- Le jeu : le chef dépose le fichier, publie le document et ouvre une demande, sous sa session.
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into storage.objects (bucket_id, name, metadata) values ('documents-cabinet', chemin, '{"size": 10, "mimetype": "application/pdf"}');
      perform publier_document_du_cabinet(dossier_du_client, doc, 'Essai RLS', '2035', 2025, 'essai.pdf', chemin);
      perform ouvrir_demande(dossier_du_client, 'Essai RLS', null, null, 'fichier');
      reset role;
      construit := construit or scenario = 0;
      -- Le client, avec puis sans la case : le document, son fichier, la demande.
      for n in 1 .. 2 loop
        perform set_config('request.jwt.claims', '', true);
        update memberships set droit_documents = (n = 1) where id = acces;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        obs := (select count(*) from documents_cabinet where id = doc) || ' '
          || (select count(*) from storage.objects where bucket_id = 'documents-cabinet' and name = chemin) || ' '
          || (select count(*) from demandes_cabinet where dossier_id = dossier_du_client and objet = 'Essai RLS');
        reset role;
        if n = 1 then avec := obs; else sans := obs; end if;
      end loop;
      -- L'anonyme, puis un compte rattaché à rien.
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      anon_vu := ((select count(*) from documents_cabinet) + (select count(*) from demandes_cabinet)
        + (select count(*) from storage.objects where bucket_id = 'documents-cabinet'))::text;
      reset role;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      inconnu_vu := ((select count(*) from documents_cabinet) + (select count(*) from lectures_documents) + (select count(*) from demandes_cabinet)
        + (select count(*) from demandes_reponses) + (select count(*) from relances_demandes)
        + (select count(*) from storage.objects where bucket_id = 'documents-cabinet'))::text;
      reset role;
      -- Le client, la case cochée : un dépôt dans le seau, puis une écriture directe dans chacune des cinq tables.
      perform set_config('request.jwt.claims', '', true);
      update memberships set droit_documents = true where id = acces;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      begin
        insert into storage.objects (bucket_id, name, metadata)
          values ('documents-cabinet', dossier_du_client::text || '/' || gen_random_uuid()::text || '/' || repeat('e', 64) || '.pdf', '{"size": 10, "mimetype": "application/pdf"}');
        depot := 'ACCEPTÉ';
      exception when others then depot := sqlstate;
      end;
      ecritures := '';
      begin
        insert into documents_cabinet (dossier_id, titre, nature, chemin, nom_fichier, sha256, taille, type_mime, publie_par)
          values (dossier_du_client, 't', '2035', 'x', 'n', repeat('f', 64), 1, 'application/pdf', client);
        ecritures := ecritures || 'ACCEPTÉ ';
      exception when others then ecritures := ecritures || sqlstate || ' ';
      end;
      begin
        insert into lectures_documents (dossier_id, document_id, lecteur) values (dossier_du_client, doc, client);
        ecritures := ecritures || 'ACCEPTÉ ';
      exception when others then ecritures := ecritures || sqlstate || ' ';
      end;
      begin
        insert into demandes_cabinet (dossier_id, objet, attendu, auteur) values (dossier_du_client, 'x', 'fichier', client);
        ecritures := ecritures || 'ACCEPTÉ ';
      exception when others then ecritures := ecritures || sqlstate || ' ';
      end;
      begin
        insert into demandes_reponses (dossier_id, demande_id, auteur, texte)
          values (dossier_du_client, (select d.id from demandes_cabinet d where d.dossier_id = dossier_du_client and d.objet = 'Essai RLS'), client, 'x');
        ecritures := ecritures || 'ACCEPTÉ ';
      exception when others then ecritures := ecritures || sqlstate || ' ';
      end;
      begin
        insert into relances_demandes (dossier_id, demande_id, canal, relancee_par)
          values (dossier_du_client, (select d.id from demandes_cabinet d where d.dossier_id = dossier_du_client and d.objet = 'Essai RLS'), 'ecran', client);
        ecritures := ecritures || 'ACCEPTÉ';
      exception when others then ecritures := ecritures || sqlstate;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if scenario = 0 then
        verdicts := verdicts || jsonb_build_object('controle', 'DM1. le client « Documents » lit le document publié de son dossier, son fichier et la demande (le contrôle positif) ; sans la case, la demande seule ; l''anonyme et un compte rattaché à rien, rien',
          'cible', 'documents_cabinet, storage.objects, demandes_cabinet',
          'observe', 'avec la case : ' || avec || ' | sans : ' || sans || ' | l''anonyme : ' || anon_vu || ' | un inconnu : ' || inconnu_vu,
          'ok', avec = '1 1 1' and sans = '0 0 1' and anon_vu = '0' and inconnu_vu = '0');
        verdicts := verdicts || jsonb_build_object('controle', 'DM2. le client n''écrit directement aucune des cinq tables (42501, les gardes)',
          'cible', 'les cinq tables', 'observe', ecritures, 'ok', ecritures = '42501 42501 42501 42501 42501');
        verdicts := verdicts || jsonb_build_object('controle', 'DM3. le client « Documents » ne dépose rien dans le seau des documents',
          'cible', 'storage.objects (documents-cabinet)', 'observe', depot, 'ok', depot = '42501');
      elsif scenario = 1 then
        mutations := mutations || jsonb_build_object('mutation', 'M-DM1 — la lecture des documents passée à « membre »',
          'attendu', 'sans la case, il lit le document', 'observe', sans, 'mord', sans like '1 %');
      elsif scenario = 2 then
        mutations := mutations || jsonb_build_object('mutation', 'M-DM2 — la lecture du seau ouverte à tout accès du dossier',
          'attendu', 'sans la case, il lit le fichier', 'observe', sans, 'mord', split_part(sans, ' ', 2) = '1');
      elsif scenario = 3 then
        mutations := mutations || jsonb_build_object('mutation', 'M-DM3 — la lecture des demandes fermée au client',
          'attendu', 'il ne lit plus la demande', 'observe', avec, 'mord', split_part(avec, ' ', 3) = '0');
      else
        mutations := mutations || jsonb_build_object('mutation', 'M-DM4 — le dépôt du seau ouvert à tout accès du dossier',
          'attendu', 'il dépose', 'observe', depot, 'mord', depot = 'ACCEPTÉ');
      end if;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, 'scénario ' || scenario || ' : ' || sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  end loop;

  -- DM4 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('documents_cabinet', 'lectures_documents', 'demandes_cabinet', 'demandes_reponses', 'relances_demandes')
     and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')
     and p.roles = array['authenticated']::name[] and p.cmd in ('SELECT', 'INSERT')
     and (p.cmd = 'SELECT' or p.with_check = 'is_super_admin()');
  verdicts := verdicts || jsonb_build_object('controle', 'DM4. la RLS des cinq tables ; quinze policies à authenticated, de lecture ou de restauration ; le seau privé ; sa suppression au chef du cabinet du dossier (lecture du catalogue)',
    'cible', 'documents_cabinet, lectures_documents, demandes_cabinet, demandes_reponses, relances_demandes, documents-cabinet',
    'observe', n || ' sur 15, ' || (select count(*) from pg_policies p where p.schemaname = 'public'
        and p.tablename in ('documents_cabinet', 'lectures_documents', 'demandes_cabinet', 'demandes_reponses', 'relances_demandes')
        and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout',
    'ok', n = 15
      and (select count(*) from pg_policies p where p.schemaname = 'public'
             and p.tablename in ('documents_cabinet', 'lectures_documents', 'demandes_cabinet', 'demandes_reponses', 'relances_demandes')
             and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 15
      and (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relrowsecurity
             and c.relname in ('documents_cabinet', 'lectures_documents', 'demandes_cabinet', 'demandes_reponses', 'relances_demandes')) = 5
      and exists (select 1 from storage.buckets b where b.id = 'documents-cabinet' and not b.public)
      and exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass
                   and p.polname = 'documents_cabinet_storage_suppression' and p.polcmd = 'd'
                   and pg_get_expr(p.polqual, p.polrelid) like '%est_chef_du_cabinet(d.cabinet_id)%'
                   and pg_get_expr(p.polqual, p.polrelid) like '%''documents-cabinet''%'));
  verdicts := verdicts || jsonb_build_object('controle', 'DM. le jeu d''essai des documents et des demandes s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null and acces is not null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null and acces is not null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $dm$;

-- ══ AC. Les achats du client (espace client, étape B4 ; migration `achats_du_client`, PRÉPARÉE) ══
-- Deux tables : les paiements qu'un accès « Achats » déclare, lus par le cabinet et par « Achats » ; les pièces vues, lues
-- par le cabinet et par leur compte ; rien d'écrit en direct, tout par les fonctions ; l'échéance d'une pièce par la sienne.
--   AC1. Le client « Achats » déclare un paiement sur une facture d'achat de son dossier et la marque vue : il lit la
--        déclaration et sa vue (le contrôle POSITIF) ; sa case décochée, ni l'une ni l'autre ; l'anonyme et un compte
--        rattaché à rien, rien.
--   AC2. Le client n'écrit directement aucune des deux tables (42501, leurs gardes, avant la RLS), ni l'échéance d'une pièce
--        (aucune policy de mise à jour : zéro ligne).
--   AC3. Le cabinet (le super-administrateur) ne change pas l'échéance d'une pièce en direct (42501, la garde).
--   AC4. Le catalogue : la RLS des deux tables, six policies à authenticated (hors la restrictive `deux_facteurs`), de
--        lecture ou de restauration ; la garde de l'échéance sur `pieces`.
-- Quatre mutations, qui doivent mordre : M-AC1 (la lecture des déclarations passée à « membre » : sans la case, il la lit),
-- M-AC2 (la lecture des vues passée à « membre » : sans la case, il lit sa vue), M-AC3 (la lecture des déclarations fermée :
-- avec la case, il ne la lit plus), M-AC4 (la garde de l'échéance qui laisse tout passer : le cabinet la change en direct).
-- Avant la migration, une ligne dit que le bloc attend.
do $ac$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  piece uuid := gen_random_uuid();
  acces uuid; obs text; avec text; sans text; anon_vu text; inconnu_vu text; echeance text; ecritures text; erreur text;
  construit boolean := false; n bigint;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.paiements_declares') is null then
    insert into rls_verdict values ('AC. les achats du client : EN ATTENTE de la migration achats_du_client',
      'paiements_declares', 'absente : ils se jugent dès que la migration y est', true);
    return;
  end if;
  select m.id into acces from memberships m where m.user_id = client and m.dossier_id = dossier_du_client;
  for scenario in 0 .. 4 loop
    begin
      avec := null; sans := null; anon_vu := null; inconnu_vu := null; echeance := null; ecritures := null;
      if scenario = 1 then
        alter policy paiements_declares_lecture_achats on public.paiements_declares using (client_du_dossier(dossier_id, 'membre'));
      elsif scenario = 2 then
        alter policy pieces_vues_lecture_du_compte on public.pieces_vues
          using (utilisateur = (select auth.uid()) and client_du_dossier(dossier_id, 'membre'));
      elsif scenario = 3 then
        alter policy paiements_declares_lecture_achats on public.paiements_declares using (false);
      elsif scenario = 4 then
        create or replace function public.garder_echeance_piece() returns trigger language plpgsql set search_path = public
          as $f$ begin return new; end $f$;
      end if;
      -- Le jeu : le chef dépose une facture d'achat au dossier du client, sous sa session ; le client, la case cochée,
      -- déclare un paiement et la marque vue.
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into pieces (id, dossier_id, uploaded_by, storage_path, nom_fichier, type_piece)
        values (piece, dossier_du_client, chef, dossier_du_client::text || '/essai-rls-achat.pdf', 'essai.pdf', 'achat');
      reset role;
      perform set_config('request.jwt.claims', '', true);
      update memberships set droit_achats = true where id = acces;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform declarer_paiement_piece(piece, date '2026-11-01', 'virement', 10);
      perform marquer_vues(dossier_du_client, array[piece]);
      reset role;
      construit := construit or scenario = 0;
      -- Le client, avec puis sans la case : la déclaration, sa vue.
      for n in 1 .. 2 loop
        perform set_config('request.jwt.claims', '', true);
        update memberships set droit_achats = (n = 1) where id = acces;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        obs := (select count(*) from paiements_declares where piece_id = piece) || ' '
          || (select count(*) from pieces_vues where piece_id = piece);
        reset role;
        if n = 1 then avec := obs; else sans := obs; end if;
      end loop;
      -- L'anonyme, puis un compte rattaché à rien.
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      anon_vu := ((select count(*) from paiements_declares) + (select count(*) from pieces_vues))::text;
      reset role;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      inconnu_vu := ((select count(*) from paiements_declares) + (select count(*) from pieces_vues))::text;
      reset role;
      -- Le client, la case cochée : une écriture directe dans chacune des deux tables, puis l'échéance de la pièce.
      perform set_config('request.jwt.claims', '', true);
      update memberships set droit_achats = true where id = acces;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      ecritures := '';
      begin
        insert into paiements_declares (dossier_id, piece_id, date_paiement, moyen, montant, declare_par)
          values (dossier_du_client, piece, date '2026-11-01', 'carte', 1, client);
        ecritures := ecritures || 'ACCEPTÉ ';
      exception when others then ecritures := ecritures || sqlstate || ' ';
      end;
      begin
        insert into pieces_vues (dossier_id, piece_id, utilisateur) values (dossier_du_client, piece, inconnu);
        ecritures := ecritures || 'ACCEPTÉ ';
      exception when others then ecritures := ecritures || sqlstate || ' ';
      end;
      with x as (update pieces set date_echeance = date '2026-12-31' where id = piece returning 1) select count(*) into n from x;
      ecritures := ecritures || n;
      reset role;
      -- Le chef (super-administrateur), en direct, sur l'échéance de la pièce.
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      begin
        update pieces set date_echeance = date '2026-12-31' where id = piece;
        echeance := 'ACCEPTÉ';
      exception when others then echeance := sqlstate;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if scenario = 0 then
        verdicts := verdicts || jsonb_build_object('controle', 'AC1. le client « Achats » lit la déclaration et la vue de sa facture d''achat (le contrôle positif) ; sans la case, ni l''une ni l''autre ; l''anonyme et un compte rattaché à rien, rien',
          'cible', 'paiements_declares, pieces_vues',
          'observe', 'avec la case : ' || avec || ' | sans : ' || sans || ' | l''anonyme : ' || anon_vu || ' | un inconnu : ' || inconnu_vu,
          'ok', avec = '1 1' and sans = '0 0' and anon_vu = '0' and inconnu_vu = '0');
        verdicts := verdicts || jsonb_build_object('controle', 'AC2. le client n''écrit directement ni une déclaration ni une vue (42501, les gardes), ni l''échéance d''une pièce (zéro ligne)',
          'cible', 'paiements_declares, pieces_vues, pieces', 'observe', ecritures, 'ok', ecritures = '42501 42501 0');
        verdicts := verdicts || jsonb_build_object('controle', 'AC3. le cabinet ne change pas l''échéance d''une pièce en direct (42501, la garde)',
          'cible', 'pieces.date_echeance', 'observe', echeance, 'ok', echeance = '42501');
      elsif scenario = 1 then
        mutations := mutations || jsonb_build_object('mutation', 'M-AC1 — la lecture des déclarations passée à « membre »',
          'attendu', 'sans la case, il lit la déclaration', 'observe', sans, 'mord', sans like '1 %');
      elsif scenario = 2 then
        mutations := mutations || jsonb_build_object('mutation', 'M-AC2 — la lecture des vues passée à « membre »',
          'attendu', 'sans la case, il lit sa vue', 'observe', sans, 'mord', split_part(sans, ' ', 2) = '1');
      elsif scenario = 3 then
        mutations := mutations || jsonb_build_object('mutation', 'M-AC3 — la lecture des déclarations fermée au client',
          'attendu', 'il ne lit plus la déclaration', 'observe', avec, 'mord', split_part(avec, ' ', 1) = '0');
      else
        mutations := mutations || jsonb_build_object('mutation', 'M-AC4 — la garde de l''échéance laisse tout passer',
          'attendu', 'le cabinet change l''échéance en direct', 'observe', echeance, 'mord', echeance = 'ACCEPTÉ');
      end if;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, 'scénario ' || scenario || ' : ' || sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  end loop;

  -- AC4 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename in ('paiements_declares', 'pieces_vues')
     and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')
     and p.roles = array['authenticated']::name[] and p.cmd in ('SELECT', 'INSERT')
     and (p.cmd = 'SELECT' or p.with_check = 'is_super_admin()');
  verdicts := verdicts || jsonb_build_object('controle', 'AC4. la RLS des deux tables ; six policies à authenticated, de lecture ou de restauration ; la garde de l''échéance sur pieces (lecture du catalogue)',
    'cible', 'paiements_declares, pieces_vues, pieces',
    'observe', n || ' sur 6, ' || (select count(*) from pg_policies p where p.schemaname = 'public'
        and p.tablename in ('paiements_declares', 'pieces_vues')
        and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout',
    'ok', n = 6
      and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename in ('paiements_declares', 'pieces_vues')
             and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 6
      and (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relrowsecurity
             and c.relname in ('paiements_declares', 'pieces_vues')) = 2
      and exists (select 1 from pg_trigger t where t.tgrelid = 'public.pieces'::regclass and t.tgname = 'pieces_echeance_gardee'
                   and t.tgenabled = 'O'));
  verdicts := verdicts || jsonb_build_object('controle', 'AC. le jeu d''essai des achats du client s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null and acces is not null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null and acces is not null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $ac$;

-- ══ NF. Les notes de frais (espace client, étape B7 ; migration `notes_de_frais`, PRÉPARÉE) ══
-- Une table : les notes de frais, lues par le cabinet, par leur auteur sous « Notes de frais », par « Achats » une fois
-- soumises ; rien d'écrit en direct, tout par les six fonctions.
--   NF1. Le client « Notes de frais » dépose un ticket, saisit sa note et la soumet : il la lit (le contrôle POSITIF) ; ses
--        deux cases décochées, il ne la lit plus ; « Achats » seule cochée, il la lit, soumise ; l'anonyme et un compte
--        rattaché à rien, rien.
--   NF2. Le client n'écrit pas la table en direct (42501, la garde, avant la RLS), ni ne la réécrit (aucune policy de mise à
--        jour : zéro ligne).
--   NF3. Le catalogue : la RLS de la table, quatre policies à authenticated (hors la restrictive `deux_facteurs`), de lecture
--        ou de restauration ; la garde de la table et celle du justificatif sur `pieces`.
-- Trois mutations, qui doivent mordre : M-NF1 (la lecture de l'auteur sans sa case : ses cases décochées, il la lit),
-- M-NF2 (la lecture « Achats » passée à « membre » : ses cases décochées, il la lit), M-NF3 (la lecture « Achats » fermée :
-- « Achats » seule cochée, il ne la lit plus). Avant la migration, une ligne dit que le bloc attend.
do $nf$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu uuid := gen_random_uuid();
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  piece uuid := gen_random_uuid();
  note uuid;
  acces uuid; obs text; frais_vu text; aucun_vu text; achats_vu text; anon_vu text; inconnu_vu text; ecritures text; erreur text;
  construit boolean := false; n bigint;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.notes_de_frais') is null then
    insert into rls_verdict values ('NF. les notes de frais : EN ATTENTE de la migration notes_de_frais',
      'notes_de_frais', 'absente : elles se jugent dès que la migration y est', true);
    return;
  end if;
  select m.id into acces from memberships m where m.user_id = client and m.dossier_id = dossier_du_client;
  for scenario in 0 .. 3 loop
    begin
      frais_vu := null; aucun_vu := null; achats_vu := null; anon_vu := null; inconnu_vu := null; ecritures := null;
      if scenario = 1 then
        alter policy notes_de_frais_lecture_auteur on public.notes_de_frais using (auteur = (select auth.uid()));
      elsif scenario = 2 then
        alter policy notes_de_frais_lecture_achats on public.notes_de_frais
          using (etat not in ('brouillon', 'retiree') and client_du_dossier(dossier_id, 'membre'));
      elsif scenario = 3 then
        alter policy notes_de_frais_lecture_achats on public.notes_de_frais using (false);
      end if;
      -- Le jeu : la case « Notes de frais » cochée, le client dépose un ticket par le chemin d'aujourd'hui, saisit sa note et
      -- la soumet.
      perform set_config('request.jwt.claims', '', true);
      update memberships set droit_frais = true, droit_achats = false where id = acces;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into pieces (id, dossier_id, uploaded_by, storage_path, nom_fichier, type_piece)
        values (piece, dossier_du_client, client, dossier_du_client::text || '/essai-rls-ticket.pdf', 'ticket.pdf', 'note_frais');
      select n.id into note from enregistrer_note_de_frais(dossier_du_client, null, null, date '2026-11-02', 'repas', 'Déjeuner',
        24.50, null, null, piece, null, null, null, null) n;
      perform soumettre_note_de_frais(note, 1);
      reset role;
      construit := construit or scenario = 0;
      -- Le client : « Notes de frais » seule, aucune case, « Achats » seule.
      for n in 1 .. 3 loop
        perform set_config('request.jwt.claims', '', true);
        update memberships set droit_frais = (n = 1), droit_achats = (n = 3) where id = acces;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        obs := (select count(*) from notes_de_frais where id = note)::text;
        reset role;
        if n = 1 then frais_vu := obs; elsif n = 2 then aucun_vu := obs; else achats_vu := obs; end if;
      end loop;
      -- L'anonyme, puis un compte rattaché à rien.
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      anon_vu := (select count(*) from notes_de_frais)::text;
      reset role;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      inconnu_vu := (select count(*) from notes_de_frais)::text;
      reset role;
      -- Le client, ses deux cases cochées : une écriture directe, puis une réécriture.
      perform set_config('request.jwt.claims', '', true);
      update memberships set droit_frais = true, droit_achats = true where id = acces;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      begin
        insert into notes_de_frais (dossier_id, auteur, date_depense, nature, motif, montant_ttc)
          values (dossier_du_client, client, date '2026-11-02', 'repas', 'Déjeuner', 10);
        ecritures := 'ACCEPTÉ ';
      exception when others then ecritures := sqlstate || ' ';
      end;
      with x as (update notes_de_frais set motif = 'Autre' where id = note returning 1) select count(*) into n from x;
      ecritures := ecritures || n;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if scenario = 0 then
        verdicts := verdicts || jsonb_build_object('controle', 'NF1. le client « Notes de frais » lit la note qu''il a soumise (le contrôle positif) ; sans ses cases, rien ; « Achats » seule, il la lit ; l''anonyme et un compte rattaché à rien, rien',
          'cible', 'notes_de_frais',
          'observe', '« Notes de frais » : ' || frais_vu || ' | aucune case : ' || aucun_vu || ' | « Achats » : ' || achats_vu
            || ' | l''anonyme : ' || anon_vu || ' | un inconnu : ' || inconnu_vu,
          'ok', frais_vu = '1' and aucun_vu = '0' and achats_vu = '1' and anon_vu = '0' and inconnu_vu = '0');
        verdicts := verdicts || jsonb_build_object('controle', 'NF2. le client n''écrit pas une note en direct (42501, la garde) ni ne la réécrit (zéro ligne)',
          'cible', 'notes_de_frais', 'observe', ecritures, 'ok', ecritures = '42501 0');
      elsif scenario = 1 then
        mutations := mutations || jsonb_build_object('mutation', 'M-NF1 — la lecture de l''auteur sans sa case',
          'attendu', 'sans ses cases, il lit sa note', 'observe', aucun_vu, 'mord', aucun_vu = '1');
      elsif scenario = 2 then
        mutations := mutations || jsonb_build_object('mutation', 'M-NF2 — la lecture « Achats » passée à « membre »',
          'attendu', 'sans ses cases, il lit sa note soumise', 'observe', aucun_vu, 'mord', aucun_vu = '1');
      else
        mutations := mutations || jsonb_build_object('mutation', 'M-NF3 — la lecture « Achats » fermée',
          'attendu', '« Achats » seule, il ne lit plus la note', 'observe', achats_vu, 'mord', achats_vu = '0');
      end if;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, 'scénario ' || scenario || ' : ' || sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
  end loop;

  -- NF3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'notes_de_frais'
     and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')
     and p.roles = array['authenticated']::name[] and p.cmd in ('SELECT', 'INSERT')
     and (p.cmd = 'SELECT' or p.with_check = 'is_super_admin()');
  verdicts := verdicts || jsonb_build_object('controle', 'NF3. la RLS de la table ; quatre policies à authenticated, de lecture ou de restauration ; la garde de la table et celle du justificatif sur pieces (lecture du catalogue)',
    'cible', 'notes_de_frais, pieces',
    'observe', n || ' sur 4, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'notes_de_frais'
        and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout',
    'ok', n = 4
      and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'notes_de_frais'
             and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 4
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.notes_de_frais'::regclass)
      and exists (select 1 from pg_trigger t where t.tgrelid = 'public.notes_de_frais'::regclass and t.tgname = 'notes_de_frais_garde'
                   and t.tgenabled = 'O')
      and exists (select 1 from pg_trigger t where t.tgrelid = 'public.pieces'::regclass
                   and t.tgname = 'pieces_justificatif_d_une_note_de_frais' and t.tgenabled = 'O'));
  verdicts := verdicts || jsonb_build_object('controle', 'NF. le jeu d''essai des notes de frais s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null and acces is not null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null and acces is not null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $nf$;

-- ══ MP. Le modèle de plan du cabinet (ligne 43, étape PC5 ; migration `modele_de_plan_du_cabinet`, PRÉPARÉE) ══
-- Une table du CABINET, sans dossier : lue par l'équipe du cabinet (`admin_du_cabinet`, chef ou non), écrite par
-- `regler_modele_du_cabinet` seule, le chef du cabinet (aucune policy d'écriture, une garde). Le client ne la lit pas, même
-- quand il a un accès à un dossier du cabinet. Le reste (les refus sous leurs mots, l'application à un dossier) :
-- `modeleDuCabinet.sql`.
--   MP1. Le chef règle le modèle et en lit une ligne par rôle du catalogue (le contrôle POSITIF : 32 à la préparation de
--        PC5, 34 depuis `ecarts_de_reglement`, en production le 12/11/2026, davantage avec les rôles des migrations
--        préparées — le compte se lit au catalogue, jamais en dur) ; un membre de l'équipe qui n'est pas chef les lit aussi
--        (un second contrôle positif) ; le client, qui a un accès au dossier du client, n'en lit rien ; l'anonyme non plus.
--   MP2. Le client ne règle pas le modèle (42501, sous ses mots), n'y insère rien en direct (42501), ne réécrit rien.
--   MP3. Le catalogue : la RLS active, une seule policy permissive, en lecture, à authenticated, `admin_du_cabinet`.
-- Trois mutations, qui doivent mordre : M-MP1 (la lecture élargie au client d'un dossier du cabinet : il lit les lignes),
-- M-MP2 (la policy fermée : le chef ne lit plus rien), M-MP3 (une policy d'insertion ouverte et la garde désactivée : son
-- insertion directe passe). Avant la migration, une ligne dit que le bloc attend.
do $mp$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  cabinet uuid; chef_lit bigint; membre_lit bigint; du_client bigint; de_l_anon text; par_la_fonction text; en_direct text;
  reecrites bigint; elargie bigint; fermee bigint; ecrite_elargie text; n bigint; erreur text; construit boolean := false;
  roles_du_catalogue bigint := (select count(*) from roles_comptables);
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.plan_comptable_cabinet') is null then
    insert into rls_verdict values ('MP. le modèle de plan du cabinet : EN ATTENTE de la migration modele_de_plan_du_cabinet',
      'plan_comptable_cabinet', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : le chef règle le modèle du cabinet du dossier du client (la banque au 512100) ──
    select d.cabinet_id into cabinet from dossiers d where d.id = dossier_du_client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform regler_modele_du_cabinet(cabinet, '[{"role": "banque", "compte": "512100"}]'::jsonb);
    select count(*) into chef_lit from plan_comptable_cabinet where cabinet_id = cabinet;
    reset role;
    construit := true;

    -- MP1 : le client, l'anonyme, puis le client rattaché à l'équipe comme comptable, le temps d'une sous-transaction.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into du_client from plan_comptable_cabinet;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*)::text into de_l_anon from plan_comptable_cabinet;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    begin
      insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into membre_lit from plan_comptable_cabinet where cabinet_id = cabinet;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'MP1. le chef lit le modèle qu''il a réglé, un membre de l''équipe aussi (les contrôles positifs) ; le client, qui a un accès à un dossier du cabinet, n''en lit rien, ni l''anonyme',
      'cible', 'plan_comptable_cabinet',
      'observe', 'le chef : ' || chef_lit || ' | le membre : ' || coalesce(membre_lit::text, '?') || ' | le client : ' || du_client || ' | l''anonyme : ' || coalesce(de_l_anon, '?')
        || ' (le catalogue : ' || roles_du_catalogue || ' rôles)',
      'ok', roles_du_catalogue >= 32 and chef_lit = roles_du_catalogue and membre_lit = roles_du_catalogue and du_client = 0
        and de_l_anon = '0');

    -- MP2 : le client ne règle ni n'écrit ni ne réécrit le modèle.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform regler_modele_du_cabinet(cabinet, '[{"role": "banque", "compte": "512200"}]'::jsonb);
      par_la_fonction := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if par_la_fonction is null then par_la_fonction := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into plan_comptable_cabinet (cabinet_id, role, compte) values (cabinet, 'caisse', '531000');
      en_direct := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if en_direct is null then en_direct := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with t as (update plan_comptable_cabinet set libelle = 'RLS' where cabinet_id = cabinet returning 1)
      select count(*) into reecrites from t;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'MP2. le client ne règle pas le modèle du cabinet (la fonction), n''y écrit pas en direct et ne le réécrit pas',
      'cible', 'plan_comptable_cabinet',
      'observe', 'par la fonction : ' || coalesce(par_la_fonction, '?') || ' | en direct : ' || coalesce(en_direct, '?') || ' | réécrites : ' || reecrites,
      'ok', par_la_fonction = '42501 Le modèle de plan de ce cabinet ne se règle que par son chef.'
        and en_direct like '42501 %' and reecrites = 0);

    -- M-MP1 : la lecture élargie au client d'un dossier du cabinet.
    begin
      alter policy plan_comptable_cabinet_lecture on public.plan_comptable_cabinet
        using (admin_du_cabinet(cabinet_id) or exists (select 1 from dossiers d join memberships m on m.dossier_id = d.id
                                                        where d.cabinet_id = plan_comptable_cabinet.cabinet_id and m.user_id = auth.uid()));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from plan_comptable_cabinet where cabinet_id = cabinet;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-MP1 — la lecture du modèle du cabinet élargie au client d''un de ses dossiers',
      'attendu', 'le client lit les lignes', 'observe', coalesce(elargie::text, '?') || ' lue(s)', 'mord', coalesce(elargie >= 1, false));

    -- M-MP2 : la policy fermée.
    begin
      alter policy plan_comptable_cabinet_lecture on public.plan_comptable_cabinet using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select count(*) into fermee from plan_comptable_cabinet where cabinet_id = cabinet;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-MP2 — la policy du modèle du cabinet fermée',
      'attendu', 'le chef ne lit plus rien', 'observe', coalesce(fermee::text, '?') || ' lue(s)', 'mord', coalesce(fermee = 0, false));

    -- M-MP3 : une policy d'insertion ouverte au client, et la garde désactivée.
    begin
      execute 'create policy plan_comptable_cabinet_mutant on public.plan_comptable_cabinet for insert to authenticated with check (true)';
      alter table public.plan_comptable_cabinet disable trigger plan_comptable_cabinet_gardes;
      -- Un cabinet jetable, au modèle vide : l'insertion du client ne bute pas sur la clé d'une ligne du jeu.
      insert into cabinets (id, nom) values ('f5c00000-0000-4000-8000-0000000000ce', 'RLS MP3');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      begin
        insert into plan_comptable_cabinet (cabinet_id, role, compte) values ('f5c00000-0000-4000-8000-0000000000ce', 'caisse', '531000');
        ecrite_elargie := 'ACCEPTÉ';
      exception when others then ecrite_elargie := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-MP3 — une insertion ouverte au client, la garde du modèle désactivée',
      'attendu', 'son insertion directe passe', 'observe', coalesce(ecrite_elargie, '?'), 'mord', coalesce(ecrite_elargie = 'ACCEPTÉ', false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- MP3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'plan_comptable_cabinet' and p.roles = array['authenticated']::name[]
     and p.policyname = 'plan_comptable_cabinet_lecture' and p.permissive = 'PERMISSIVE' and p.cmd = 'SELECT'
     and p.qual = 'admin_du_cabinet(cabinet_id)' and p.with_check is null;
  verdicts := verdicts || jsonb_build_object('controle', 'MP3. la RLS active ; une seule policy, en lecture, à authenticated, l''équipe du cabinet (lecture du catalogue)',
    'cible', 'plan_comptable_cabinet',
    'observe', n || ' sur 1, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'plan_comptable_cabinet' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout, RLS '
      || (select c.relrowsecurity::text from pg_class c where c.oid = 'public.plan_comptable_cabinet'::regclass),
    'ok', n = 1 and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'plan_comptable_cabinet' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 1
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.plan_comptable_cabinet'::regclass));
  verdicts := verdicts || jsonb_build_object('controle', 'MP. le jeu d''essai du modèle de plan du cabinet s''est construit', 'cible', 'le cabinet du dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $mp$;

-- ══ CF. La copie des fichiers sur un support du cabinet (lignes 20.65 et 44, INAL6 ; migration `copies_des_fichiers`, PRÉPARÉE) ══
-- Une table du CABINET, sans dossier : lue par l'équipe du cabinet (`admin_du_cabinet`, chef ou non), écrite par
-- `enregistrer_copie_des_fichiers` seule, le chef du cabinet (aucune policy d'écriture). Le client ne la lit pas, même quand
-- il a un accès à un dossier du cabinet. Le reste (les refus sous leurs mots, la couverture de tous les dossiers) :
-- `copiesDesFichiers.sql`.
--   CF1. Le chef enregistre une copie et la lit (le contrôle POSITIF) ; un membre de l'équipe qui n'est pas chef la lit
--        aussi ; le client, qui a un accès au dossier du client, n'en lit rien ; l'anonyme non plus.
--   CF2. Le client n'enregistre pas de copie (42501, sous ses mots), n'y insère rien en direct (42501), ne réécrit rien (ni
--        l'attestation), n'atteste aucune copie par `attester_copie_des_fichiers` (42501, sous ses mots).
--   CF3. Le catalogue : la RLS active, une seule policy permissive, en lecture, à authenticated, `admin_du_cabinet`.
-- Trois mutations, qui doivent mordre : M-CF1 (la lecture élargie au client d'un dossier du cabinet : il lit la copie),
-- M-CF2 (la policy fermée : le chef ne lit plus rien), M-CF3 (une policy d'insertion ouverte : l'insertion directe du client
-- passe). Avant la migration, une ligne dit que le bloc attend.
do $cf$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  cabinet uuid; n_dossiers integer; chef_lit bigint; membre_lit bigint; du_client bigint; de_l_anon text; par_la_fonction text;
  en_direct text; reecrites bigint; elargie bigint; fermee bigint; ecrite_elargie text; n bigint; erreur text;
  la_copie uuid; attestee text;
  construit boolean := false; verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.copies_des_fichiers') is null then
    insert into rls_verdict values ('CF. la copie des fichiers : EN ATTENTE de la migration copies_des_fichiers',
      'copies_des_fichiers', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : le chef enregistre une copie de tous les dossiers du cabinet du dossier du client ──
    select d.cabinet_id into cabinet from dossiers d where d.id = dossier_du_client;
    select count(*) into n_dossiers from dossiers d where d.cabinet_id = cabinet;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    la_copie := enregistrer_copie_des_fichiers(gen_random_uuid(), cabinet, n_dossiers, 0, 0, 0, 0, 0, repeat('c', 64));
    select count(*) into chef_lit from copies_des_fichiers where cabinet_id = cabinet;
    reset role;
    construit := true;

    -- CF1 : le client, l'anonyme, puis le client rattaché à l'équipe comme comptable, le temps d'une sous-transaction.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into du_client from copies_des_fichiers;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*)::text into de_l_anon from copies_des_fichiers;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    begin
      insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into membre_lit from copies_des_fichiers where cabinet_id = cabinet;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'CF1. le chef lit la copie qu''il a enregistrée, un membre de l''équipe aussi (les contrôles positifs) ; le client, qui a un accès à un dossier du cabinet, n''en lit rien, ni l''anonyme',
      'cible', 'copies_des_fichiers',
      'observe', 'le chef : ' || (chef_lit >= 1)::text || ' | le membre : ' || coalesce((membre_lit = chef_lit)::text, '?') || ' | le client : ' || du_client || ' | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', chef_lit >= 1 and membre_lit = chef_lit and du_client = 0 and de_l_anon = '0');

    -- CF2 : le client n'enregistre ni n'écrit ni ne réécrit une copie.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_copie_des_fichiers(gen_random_uuid(), cabinet, n_dossiers, 0, 0, 0, 0, 0, repeat('c', 64));
      par_la_fonction := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if par_la_fonction is null then par_la_fonction := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into copies_des_fichiers (id, cabinet_id, faite_par, nb_dossiers, nb_fichiers, nb_verifies, nb_ecarts, nb_manquants, octets, empreinte_du_manifeste)
        values (gen_random_uuid(), cabinet, client, 1, 0, 0, 0, 0, 0, repeat('c', 64));
      en_direct := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if en_direct is null then en_direct := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with t as (update copies_des_fichiers set nb_ecarts = 0, rangee_le = now(), rangee_par = client where cabinet_id = cabinet returning 1)
      select count(*) into reecrites from t;
    begin
      perform attester_copie_des_fichiers(cabinet, la_copie, 'manifeste');
      attestee := 'ACCEPTÉ';
    exception when others then attestee := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'CF2. le client n''enregistre pas de copie des fichiers (la fonction), n''en écrit pas en direct, n''en réécrit aucune et n''en atteste aucune',
      'cible', 'copies_des_fichiers',
      'observe', 'par la fonction : ' || coalesce(par_la_fonction, '?') || ' | en direct : ' || coalesce(en_direct, '?') || ' | réécrites : ' || reecrites
        || ' | attestation : ' || coalesce(attestee, '?'),
      'ok', par_la_fonction = '42501 Seul le chef du cabinet enregistre une copie des fichiers.'
        and en_direct like '42501 %' and reecrites = 0
        and attestee = '42501 Seul le chef du cabinet atteste une copie des fichiers.');

    -- M-CF1 : la lecture élargie au client d'un dossier du cabinet.
    begin
      alter policy copies_des_fichiers_lecture on public.copies_des_fichiers
        using (admin_du_cabinet(cabinet_id) or exists (select 1 from dossiers d join memberships m on m.dossier_id = d.id
                                                        where d.cabinet_id = copies_des_fichiers.cabinet_id and m.user_id = auth.uid()));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from copies_des_fichiers where cabinet_id = cabinet;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-CF1 — la lecture des copies des fichiers élargie au client d''un dossier du cabinet',
      'attendu', 'le client lit la copie', 'observe', coalesce((elargie >= 1)::text, '?'), 'mord', coalesce(elargie >= 1, false));

    -- M-CF2 : la policy fermée.
    begin
      alter policy copies_des_fichiers_lecture on public.copies_des_fichiers using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select count(*) into fermee from copies_des_fichiers where cabinet_id = cabinet;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-CF2 — la policy des copies des fichiers fermée',
      'attendu', 'le chef ne lit plus rien', 'observe', coalesce(fermee::text, '?') || ' lue(s)', 'mord', coalesce(fermee = 0, false));

    -- M-CF3 : une policy d'insertion ouverte au client.
    begin
      execute 'create policy copies_des_fichiers_mutant on public.copies_des_fichiers for insert to authenticated with check (true)';
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      begin
        insert into copies_des_fichiers (id, cabinet_id, faite_par, nb_dossiers, nb_fichiers, nb_verifies, nb_ecarts, nb_manquants, octets, empreinte_du_manifeste)
          values (gen_random_uuid(), cabinet, client, 1, 0, 0, 0, 0, 0, repeat('c', 64));
        ecrite_elargie := 'ACCEPTÉ';
      exception when others then ecrite_elargie := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-CF3 — une insertion directe ouverte au client',
      'attendu', 'son insertion directe passe', 'observe', coalesce(ecrite_elargie, '?'), 'mord', coalesce(ecrite_elargie = 'ACCEPTÉ', false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- CF3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'copies_des_fichiers' and p.roles = array['authenticated']::name[]
     and p.policyname = 'copies_des_fichiers_lecture' and p.permissive = 'PERMISSIVE' and p.cmd = 'SELECT'
     and p.qual = 'admin_du_cabinet(cabinet_id)' and p.with_check is null;
  verdicts := verdicts || jsonb_build_object('controle', 'CF3. la RLS active ; une seule policy, en lecture, à authenticated, l''équipe du cabinet (lecture du catalogue)',
    'cible', 'copies_des_fichiers',
    'observe', n || ' sur 1, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'copies_des_fichiers' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout, RLS '
      || (select c.relrowsecurity::text from pg_class c where c.oid = 'public.copies_des_fichiers'::regclass),
    'ok', n = 1 and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'copies_des_fichiers' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 1
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.copies_des_fichiers'::regclass));
  verdicts := verdicts || jsonb_build_object('controle', 'CF. le jeu d''essai de la copie des fichiers s''est construit', 'cible', 'le cabinet du dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $cf$;

-- ══ IV. Les opérations d'inventaire (ligne 35, INV2 ; migration `operations_d_inventaire`, PRÉPARÉE) ══
-- Une table d'un dossier, lue par son cabinet (`admin_du_dossier`), écrite par `enregistrer_operation_inventaire` et
-- `retirer_operation_inventaire` seules (aucune policy d'écriture, une garde), réinsérée par le super-administrateur (la
-- restauration). Aucun client, même celui du dossier. Le reste : `operationsDInventaire.sql`, sur une réplique.
--   IV1. Le chef enregistre une régularisation d'un dossier en engagement et la lit (le contrôle POSITIF) ; le client, qui a
--        un accès au dossier, n'en lit rien ; un membre de l'équipe à qui le dossier n'est pas assigné non plus ; l'anonyme
--        non plus.
--   IV2. Le client n'enregistre rien (42501, sous ses mots), n'insère rien en direct (42501), ne réécrit rien ; le
--        super-administrateur réinsère une régularisation en direct (la restauration, le contrôle POSITIF).
--   IV3. Le catalogue : la RLS active, deux policies permissives à authenticated — la lecture sur `admin_du_dossier`, la
--        réinsertion sur `is_super_admin` —, et rien d'autre que la restrictive `deux_facteurs`.
-- Trois mutations, qui doivent mordre : M-IV1 (la lecture élargie au client du dossier : il lit la régularisation), M-IV2
-- (la lecture fermée : le chef ne lit plus rien), M-IV3 (la porte de la restauration fermée : le super-administrateur ne
-- réinsère plus). Avant la migration, une ligne dit que le bloc attend.
do $iv$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre uuid := '3e3b0000-0000-4000-8000-000000000001';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  dossier uuid := 'a1100000-0000-4000-8000-0000000000c1';
  ecritures jsonb := '[{"date": "2025-12-31", "journal": "OD", "libelle": "CCA 31/12/2025 — Essai de la RLS", "lignes": [{"compte": "486000", "sens": "debit", "centimes": 100}, {"compte": "616000", "sens": "credit", "centimes": 100}]}, {"date": "2026-01-01", "journal": "OD", "libelle": "Extourne — CCA 31/12/2025 — Essai de la RLS", "lignes": [{"compte": "616000", "sens": "debit", "centimes": 100}, {"compte": "486000", "sens": "credit", "centimes": 100}]}]';
  operation jsonb := '{"exercice": 2025, "nature": "cca", "compte_resultat": "616000", "compte_regularisation": "486000", "montant_centimes": 100, "tva_centimes": 0, "objet": "Essai de la RLS"}';
  chef_lit bigint; du_client bigint; du_membre bigint; de_l_anon text; par_la_fonction text; en_direct text; reecrites bigint;
  reinsere text; elargie bigint; fermee bigint; porte_fermee text; n bigint; erreur text;
  construit boolean := false; verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.operations_inventaire') is null then
    insert into rls_verdict values ('IV. les opérations d''inventaire : EN ATTENTE de la migration operations_d_inventaire',
      'operations_inventaire', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : un dossier en engagement du cabinet du dossier du client, que le client voit, que le membre ne suit pas ──
    insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva)
      select dossier, 'Essai RLS de l''inventaire', d.cabinet_id, 'engagement', 'franchise' from dossiers d where d.id = dossier_du_client;
    insert into memberships (user_id, dossier_id, role)
      select client, dossier, m.role from memberships m where m.user_id = client and m.dossier_id = dossier_du_client limit 1;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform enregistrer_operation_inventaire(dossier, operation, ecritures, null);
    select count(*) into chef_lit from operations_inventaire where dossier_id = dossier;
    reset role;
    construit := true;

    -- IV1 : le client du dossier, le membre à qui il n'est pas assigné, l'anonyme.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into du_client from operations_inventaire;
    perform set_config('request.jwt.claims', json_build_object('sub', membre, 'role', 'authenticated')::text, true);
    select count(*) into du_membre from operations_inventaire where dossier_id = dossier;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*)::text into de_l_anon from operations_inventaire;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'IV1. le chef lit la régularisation qu''il a enregistrée (le contrôle positif) ; le client du dossier, un membre de l''équipe à qui le dossier n''est pas assigné et l''anonyme n''en lisent rien',
      'cible', 'operations_inventaire',
      'observe', 'le chef : ' || chef_lit || ' | le client : ' || du_client || ' | le membre : ' || du_membre || ' | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', chef_lit = 1 and du_client = 0 and du_membre = 0 and de_l_anon = '0');

    -- IV2 : le client n'enregistre ni n'écrit ni ne réécrit ; le super-administrateur réinsère.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_operation_inventaire(dossier, operation, ecritures, null);
      par_la_fonction := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if par_la_fonction is null then par_la_fonction := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into operations_inventaire (dossier_id, exercice, nature, compte_resultat, compte_regularisation, montant_centimes, objet, cree_par)
        values (dossier, 2025, 'cca', '616000', '486000', 100, 'en direct', client);
      en_direct := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if en_direct is null then en_direct := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with t as (update operations_inventaire set objet = 'réécrit' where dossier_id = dossier returning 1)
      select count(*) into reecrites from t;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into operations_inventaire (dossier_id, exercice, nature, compte_resultat, compte_regularisation, montant_centimes, objet, cree_par)
        values (dossier, 2025, 'cca', '616000', '486000', 100, 'réinsérée', chef);
      reinsere := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if reinsere is null then reinsere := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'IV2. le client n''enregistre pas de régularisation (la fonction), n''en écrit pas en direct et n''en réécrit aucune ; le super-administrateur en réinsère une (la restauration, le contrôle positif)',
      'cible', 'operations_inventaire',
      'observe', 'par la fonction : ' || coalesce(par_la_fonction, '?') || ' | en direct : ' || coalesce(en_direct, '?') || ' | réécrites : ' || reecrites || ' | réinsérée : ' || coalesce(reinsere, '?'),
      'ok', par_la_fonction = '42501 Accès refusé à ce dossier.' and en_direct like '42501 %' and reecrites = 0 and reinsere = 'ACCEPTÉ');

    -- M-IV1 : la lecture élargie au client du dossier.
    begin
      alter policy operations_inventaire_lecture on public.operations_inventaire
        using (admin_du_dossier(dossier_id) or exists (select 1 from memberships m where m.dossier_id = operations_inventaire.dossier_id and m.user_id = auth.uid()));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from operations_inventaire where dossier_id = dossier;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-IV1 — la lecture des régularisations d''inventaire élargie au client du dossier',
      'attendu', 'le client lit la régularisation', 'observe', coalesce((elargie >= 1)::text, '?'), 'mord', coalesce(elargie >= 1, false));

    -- M-IV2 : la lecture fermée.
    begin
      alter policy operations_inventaire_lecture on public.operations_inventaire using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select count(*) into fermee from operations_inventaire where dossier_id = dossier;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-IV2 — la lecture des régularisations d''inventaire fermée',
      'attendu', 'le chef ne lit plus rien', 'observe', coalesce(fermee::text, '?') || ' lue(s)', 'mord', coalesce(fermee = 0, false));

    -- M-IV3 : la porte de la restauration fermée.
    begin
      alter policy operations_inventaire_restauration on public.operations_inventaire with check (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      begin
        insert into operations_inventaire (dossier_id, exercice, nature, compte_resultat, compte_regularisation, montant_centimes, objet, cree_par)
          values (dossier, 2025, 'cca', '616000', '486000', 100, 'réinsérée', chef);
        porte_fermee := 'ACCEPTÉ';
      exception when others then porte_fermee := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-IV3 — la porte de la restauration fermée',
      'attendu', 'le super-administrateur ne réinsère plus', 'observe', coalesce(porte_fermee, '?'), 'mord', coalesce(porte_fermee like '42501 %', false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- IV3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'operations_inventaire' and p.roles = array['authenticated']::name[]
     and p.permissive = 'PERMISSIVE'
     and ((p.policyname = 'operations_inventaire_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check is null)
       or (p.policyname = 'operations_inventaire_restauration' and p.cmd = 'INSERT' and p.qual is null and p.with_check = 'is_super_admin()'));
  verdicts := verdicts || jsonb_build_object('controle', 'IV3. la RLS active ; deux policies à authenticated : la lecture du cabinet du dossier, la réinsertion du super-administrateur (lecture du catalogue)',
    'cible', 'operations_inventaire',
    'observe', n || ' sur 2, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'operations_inventaire' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout, RLS '
      || (select c.relrowsecurity::text from pg_class c where c.oid = 'public.operations_inventaire'::regclass),
    'ok', n = 2 and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'operations_inventaire' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 2
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.operations_inventaire'::regclass));
  verdicts := verdicts || jsonb_build_object('controle', 'IV. le jeu d''essai des opérations d''inventaire s''est construit', 'cible', 'un dossier en engagement du cabinet du dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $iv$;

-- ══ ST. Les stocks de clôture (ligne 36, LIA2 ; migration `stocks_de_cloture`, PRÉPARÉE) ══════════════════════════════
-- Une table du cabinet que le client ne lit pas, pas même pour son dossier : une seule policy, `for all to authenticated`
-- sur `admin_du_dossier(dossier_id)`, aucune branche client ; l'écriture par `enregistrer_stock_de_cloture` et
-- `retirer_stock_de_cloture` (`security definer`, l'accès d'abord), une garde refusant toute écriture directe que la
-- policy laisserait passer. Les refus de la fonction, la recomposition, les gardes et le gel se rejouent dans `stocks.sql`
-- (réplique seulement).
--   ST1. Le chef enregistre un stock « néant » de 2026 dans le dossier du client, passé en engagement le temps du bloc, et
--        le lit (le contrôle POSITIF) ; le client, qui a un accès à ce dossier, n'en lit rien ; l'anonyme non plus.
--   ST2. Le client n'écrit pas par la fonction (42501, sous ses mots), ni en direct : la garde le refuse (42501, ses mots,
--        elle passe AVANT le contrôle d'écriture de la RLS), et, la garde débranchée, la RLS seule (42501) ; il ne réécrit
--        rien.
--   ST3. Le catalogue : la RLS active, une seule policy permissive, à authenticated, `admin_du_dossier` des deux côtés.
-- Trois mutations, qui doivent mordre : M-ST1 (la lecture élargie au client « membre » : il lit la ligne de son dossier),
-- M-ST2 (la policy fermée : le chef ne lit plus la ligne), M-ST3 (la garde débranchée et l'écriture élargie au client
-- « membre » : son insertion directe passe). Avant la migration, une ligne dit que le bloc attend.
do $st$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  saisie jsonb := '{"exercice": 2026, "compte_stock": "370000", "montant_centimes": 0, "methode": "cmup", "objet": "Inventaire rls.sql", "piece_citee_id": null}';
  chef_apres bigint; du_client bigint; de_l_anon text; par_la_fonction text; en_direct text; sans_garde text; reecrites bigint;
  elargie bigint; fermee bigint; ecrite_elargie text; n bigint; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.stocks_de_cloture') is null then
    insert into rls_verdict values ('ST. les stocks de clôture : EN ATTENTE de la migration stocks_de_cloture',
      'stocks_de_cloture', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : le dossier du client en engagement (annulé avec le bloc), le chef y enregistre un stock « néant » ──
    update dossiers set mode_comptable = 'engagement' where id = dossier_du_client;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform enregistrer_stock_de_cloture(dossier_du_client, saisie, '[]'::jsonb, null);
    select count(*) into chef_apres from stocks_de_cloture where dossier_id = dossier_du_client and exercice = 2026;
    reset role;
    construit := true;

    -- ST1 : le client, puis l'anonyme.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into du_client from stocks_de_cloture where dossier_id = dossier_du_client;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*)::text into de_l_anon from stocks_de_cloture;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'ST1. le chef lit le stock de clôture qu''il a enregistré dans le dossier du client (le contrôle positif) ; le client n''en lit rien, ni l''anonyme',
      'cible', 'stocks_de_cloture',
      'observe', 'le chef : ' || chef_apres || ' | le client : ' || du_client || ' | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', chef_apres = 1 and du_client = 0 and de_l_anon = '0');

    -- ST2 : le client n'écrit ni ne réécrit les stocks.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_stock_de_cloture(dossier_du_client, jsonb_set(saisie, '{compte_stock}', '"320000"'), '[]'::jsonb, null);
      par_la_fonction := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if par_la_fonction is null then par_la_fonction := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into stocks_de_cloture (dossier_id, exercice, compte_stock, montant_centimes, methode, objet, cree_par, modifie_par)
      values (dossier_du_client, 2026, '320000', 1, 'cmup', 'x', client, client);
      en_direct := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if en_direct is null then en_direct := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      alter table public.stocks_de_cloture disable trigger stocks_de_cloture_par_ses_fonctions;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into stocks_de_cloture (dossier_id, exercice, compte_stock, montant_centimes, methode, objet, cree_par, modifie_par)
      values (dossier_du_client, 2026, '320000', 1, 'cmup', 'x', client, client);
      sans_garde := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sans_garde is null then sans_garde := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with t as (update stocks_de_cloture set objet = 'y' where dossier_id = dossier_du_client returning 1)
      select count(*) into reecrites from t;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'ST2. le client n''écrit pas les stocks de clôture (la fonction, puis la RLS) et ne les réécrit pas',
      'cible', 'stocks_de_cloture',
      'observe', 'par la fonction : ' || coalesce(par_la_fonction, '?') || ' | en direct : ' || coalesce(en_direct, '?')
        || ' | la garde débranchée : ' || coalesce(sans_garde, '?') || ' | réécrites : ' || reecrites,
      'ok', par_la_fonction = '42501 Seul le cabinet du dossier enregistre un stock de clôture.'
        -- La porte d'accès en base (acces_avant_les_gardes) : la RLS refuse l'insertion directe avant la garde.
        and en_direct = case when exists (select 1 from pg_trigger g where g.tgrelid = 'public.stocks_de_cloture'::regclass and g.tgname = '_acces_avant_les_gardes')
                             then '42501 new row violates row-level security policy for table "stocks_de_cloture"'
                             else '42501 Un stock de clôture ne s''écrit que par enregistrer_stock_de_cloture.' end
        and sans_garde like '42501 new row violates row-level security policy%' and reecrites = 0);

    -- M-ST1 : la lecture élargie au client « membre ».
    begin
      alter policy stocks_de_cloture_cabinet on public.stocks_de_cloture
        using (admin_du_dossier(dossier_id) or client_du_dossier(dossier_id, 'membre'));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from stocks_de_cloture where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-ST1 — la lecture des stocks de clôture élargie au client « membre »',
      'attendu', 'le client lit la ligne de son dossier', 'observe', coalesce(elargie::text, '?') || ' lue(s)', 'mord', coalesce(elargie >= 1, false));

    -- M-ST2 : la policy fermée.
    begin
      alter policy stocks_de_cloture_cabinet on public.stocks_de_cloture using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select count(*) into fermee from stocks_de_cloture where dossier_id = dossier_du_client;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-ST2 — la policy des stocks de clôture fermée',
      'attendu', 'le chef ne lit plus la ligne', 'observe', coalesce(fermee::text, '?') || ' lue(s)', 'mord', coalesce(fermee = 0, false));

    -- M-ST3 : la garde débranchée et l'écriture élargie au client « membre » — plus rien ne refuse.
    begin
      alter table public.stocks_de_cloture disable trigger stocks_de_cloture_par_ses_fonctions;
      alter policy stocks_de_cloture_cabinet on public.stocks_de_cloture
        with check (admin_du_dossier(dossier_id) or client_du_dossier(dossier_id, 'membre'));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      begin
        insert into stocks_de_cloture (dossier_id, exercice, compte_stock, montant_centimes, methode, objet, cree_par, modifie_par)
        values (dossier_du_client, 2026, '320000', 1, 'cmup', 'x', client, client);
        ecrite_elargie := 'ACCEPTÉ';
      exception when others then ecrite_elargie := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-ST3 — la garde débranchée, l''écriture des stocks de clôture élargie au client « membre »',
      'attendu', 'son insertion directe passe', 'observe', coalesce(ecrite_elargie, '?'), 'mord', coalesce(ecrite_elargie = 'ACCEPTÉ', false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- ST3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'stocks_de_cloture' and p.roles = array['authenticated']::name[]
     and p.policyname = 'stocks_de_cloture_cabinet' and p.permissive = 'PERMISSIVE' and p.cmd = 'ALL'
     and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check = 'admin_du_dossier(dossier_id)';
  verdicts := verdicts || jsonb_build_object('controle', 'ST3. la RLS active ; une seule policy, à authenticated, le cabinet du dossier des deux côtés (lecture du catalogue)',
    'cible', 'stocks_de_cloture',
    'observe', n || ' sur 1, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'stocks_de_cloture' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout, RLS '
      || (select c.relrowsecurity::text from pg_class c where c.oid = 'public.stocks_de_cloture'::regclass),
    'ok', n = 1 and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'stocks_de_cloture' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 1
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.stocks_de_cloture'::regclass));
  verdicts := verdicts || jsonb_build_object('controle', 'ST. le jeu d''essai des stocks de clôture s''est construit', 'cible', 'le dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $st$;

-- ══ EX. Les exercices déclarés d'un dossier (ligne 42, EXD2 ; migration `exercices_du_dossier`, PRÉPARÉE) ══
-- Une table du cabinet que le client ne lit pas, pas même pour son dossier : une seule policy, `for all to authenticated`
-- sur `admin_du_dossier(dossier_id)`, aucune branche client ; l'écriture par `declarer_exercice`, `security definer`, le
-- contrôle d'accès d'abord. La garde, la suite, la période figée et la batterie civile se rejouent dans
-- `exercicesDuDossier.sql` (réplique seulement).
--   EX1. Le chef déclare un exercice dans un dossier jetable en engagement, auquel le client a un accès, et le lit (le
--        contrôle POSITIF) ; le client n'en lit rien, ni par la table ni par `bornes_de_l_exercice` ; l'anonyme non plus.
--   EX2. Le client ne déclare pas par la fonction (42501, sous ses mots), ni en direct (42501, la RLS), et ne réécrit rien.
--   EX3. Le catalogue : la RLS active, une seule policy permissive, à authenticated, `admin_du_dossier` des deux côtés.
-- Trois mutations, qui doivent mordre : M-EX1 (la lecture élargie au client « membre »), M-EX2 (la policy fermée : le chef
-- ne lit plus la ligne), M-EX3 (l'écriture élargie au client « membre » : son insertion directe passe). Avant la
-- migration, une ligne dit que le bloc attend.
do $ex$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  jetable uuid := 'e0d20000-0000-4000-8000-0000000000a1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  chef_lit bigint; du_client bigint; bornes_du_client bigint; de_l_anon text; par_la_fonction text; en_direct text;
  reecrites bigint; elargie bigint; fermee bigint; ecrite_elargie text; n bigint; erreur text; construit boolean := false;
  verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.exercices') is null then
    insert into rls_verdict values ('EX. les exercices déclarés : EN ATTENTE de la migration exercices_du_dossier',
      'exercices', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : un dossier jetable en engagement, un accès du client, et le chef y déclare un premier exercice décalé ──
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (jetable, 'RLS EXERCICES', cabinet, 'engagement', '455000');
    insert into memberships (user_id, dossier_id, role, email) values (client, jetable, 'client', 'rls-ex@example.test');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform declarer_exercice(jetable, '2026-03-15', '2027-06-30', 'premier', null, null);
    select count(*) into chef_lit from exercices where dossier_id = jetable and fin = '2027-06-30';
    reset role;
    construit := true;

    -- EX1 : le client, puis l'anonyme.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into du_client from exercices where dossier_id = jetable;
    select count(*) into bornes_du_client from bornes_de_l_exercice(jetable, 2027);
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*)::text into de_l_anon from exercices;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'EX1. le chef lit l''exercice qu''il a déclaré dans le dossier jetable (le contrôle positif) ; le client, qui y a un accès, n''en lit rien (ni la table, ni les bornes), ni l''anonyme',
      'cible', 'exercices',
      'observe', 'le chef : ' || chef_lit || ' | le client : ' || du_client || ' ligne(s), ' || bornes_du_client || ' borne(s) | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', chef_lit = 1 and du_client = 0 and bornes_du_client = 0 and de_l_anon = '0');

    -- EX2 : le client ne déclare ni ne réécrit.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform declarer_exercice(jetable, '2027-07-01', '2028-06-30', 'ordinaire', null, null);
      par_la_fonction := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if par_la_fonction is null then par_la_fonction := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into exercices (dossier_id, debut, fin, nature) values (jetable, '2027-07-01', '2028-06-30', 'ordinaire');
      en_direct := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if en_direct is null then en_direct := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with t as (update exercices set decision = null where dossier_id = jetable returning 1)
      select count(*) into reecrites from t;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'EX2. le client ne déclare pas d''exercice (la fonction, puis la RLS) et n''en réécrit aucun',
      'cible', 'exercices',
      'observe', 'par la fonction : ' || coalesce(par_la_fonction, '?') || ' | en direct : ' || coalesce(en_direct, '?') || ' | réécrits : ' || reecrites,
      'ok', par_la_fonction = '42501 Les exercices d''un dossier ne se déclarent que par son cabinet.'
        and en_direct like '42501 new row violates row-level security policy%' and reecrites = 0);

    -- M-EX1 : la lecture élargie au client « membre ».
    begin
      alter policy exercices_cabinet on public.exercices
        using (admin_du_dossier(dossier_id) or client_du_dossier(dossier_id, 'membre'));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from exercices where dossier_id = jetable;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-EX1 — la lecture des exercices déclarés élargie au client « membre »',
      'attendu', 'le client lit l''exercice de son dossier', 'observe', coalesce(elargie::text, '?') || ' lu(s)', 'mord', coalesce(elargie >= 1, false));

    -- M-EX2 : la policy fermée.
    begin
      alter policy exercices_cabinet on public.exercices using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select count(*) into fermee from exercices where dossier_id = jetable;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-EX2 — la policy des exercices déclarés fermée',
      'attendu', 'le chef ne lit plus l''exercice', 'observe', coalesce(fermee::text, '?') || ' lu(s)', 'mord', coalesce(fermee = 0, false));

    -- M-EX3 : l'écriture élargie au client « membre ».
    begin
      alter policy exercices_cabinet on public.exercices
        with check (admin_du_dossier(dossier_id) or client_du_dossier(dossier_id, 'membre'));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      begin
        insert into exercices (dossier_id, debut, fin, nature) values (jetable, '2027-07-01', '2028-06-30', 'ordinaire');
        ecrite_elargie := 'ACCEPTÉ';
      exception when others then ecrite_elargie := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-EX3 — l''écriture des exercices déclarés élargie au client « membre »',
      'attendu', 'son insertion directe passe', 'observe', coalesce(ecrite_elargie, '?'), 'mord', coalesce(ecrite_elargie = 'ACCEPTÉ', false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- EX3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'exercices' and p.roles = array['authenticated']::name[]
     and p.policyname = 'exercices_cabinet' and p.permissive = 'PERMISSIVE' and p.cmd = 'ALL'
     and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check = 'admin_du_dossier(dossier_id)';
  verdicts := verdicts || jsonb_build_object('controle', 'EX3. la RLS active ; une seule policy, à authenticated, le cabinet du dossier des deux côtés (lecture du catalogue)',
    'cible', 'exercices',
    'observe', n || ' sur 1, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'exercices' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout, RLS '
      || (select c.relrowsecurity::text from pg_class c where c.oid = 'public.exercices'::regclass),
    'ok', n = 1 and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'exercices' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 1
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.exercices'::regclass));
  verdicts := verdicts || jsonb_build_object('controle', 'EX. le jeu d''essai des exercices déclarés s''est construit', 'cible', 'le dossier jetable',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $ex$;

-- ══ PV. Les provisions (ligne 35, INV4 ; migration `provisions`, PRÉPARÉE, après `operations_d_inventaire`) ══════════════
-- Une table du cabinet que le client ne lit pas, pas même pour son dossier : une seule policy, `for all to authenticated`
-- sur `admin_du_dossier(dossier_id)`, aucune branche client ; l'écriture par `enregistrer_provision` et `retirer_provision`
-- (`security definer`, l'accès d'abord), une garde refusant toute écriture directe que la policy laisserait passer, sauf la
-- réinsertion du super-administrateur (la restauration). Les refus, l'évaluation, la ventilation et le gel se rejouent dans
-- `provisions.sql` (réplique seulement).
--   PV1. Le chef enregistre une provision dans un dossier en engagement du cabinet du dossier du client, que le client voit,
--        et la lit (le contrôle POSITIF) ; le client n'en lit rien, ni un membre à qui le dossier n'est pas assigné, ni
--        l'anonyme.
--   PV2. Le client n'écrit pas par la fonction (42501, sous ses mots), ni en direct : la garde le refuse (42501, ses mots,
--        AVANT le contrôle d'écriture de la RLS), et, la garde débranchée, la RLS seule (42501) ; il ne réécrit rien ; le
--        super-administrateur réinsère en direct (la restauration, le contrôle POSITIF).
--   PV3. Le catalogue : la RLS active, une seule policy permissive, à authenticated, `admin_du_dossier` des deux côtés.
-- Trois mutations, qui doivent mordre : M-PV1 (la lecture élargie au client du dossier : il lit la provision), M-PV2 (la
-- policy fermée : le chef ne lit plus rien), M-PV3 (la garde débranchée et l'écriture élargie au client du dossier : son
-- insertion directe passe). Avant la migration, une ligne dit que le bloc attend.
do $pv$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre uuid := '3e3b0000-0000-4000-8000-000000000001';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  dossier uuid := 'a1400000-0000-4000-8000-0000000000c1';
  saisie jsonb := '{"genre": "risque", "compte_provision": "151100", "objet": "Essai de la RLS", "ouverte_en": 2025}';
  chef_lit bigint; du_client bigint; du_membre bigint; de_l_anon text; par_la_fonction text; en_direct text; sans_garde text;
  reecrites bigint; reinsere text; elargie bigint; fermee bigint; ecrite_elargie text; n bigint; erreur text;
  construit boolean := false; verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.provisions') is null then
    insert into rls_verdict values ('PV. les provisions : EN ATTENTE de la migration provisions',
      'provisions', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : un dossier en engagement du cabinet du dossier du client, que le client voit, que le membre ne suit pas ──
    insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva)
      select dossier, 'Essai RLS des provisions', d.cabinet_id, 'engagement', 'franchise' from dossiers d where d.id = dossier_du_client;
    insert into memberships (user_id, dossier_id, role)
      select client, dossier, m.role from memberships m where m.user_id = client and m.dossier_id = dossier_du_client limit 1;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform enregistrer_provision(dossier, saisie, null);
    select count(*) into chef_lit from provisions where dossier_id = dossier;
    reset role;
    construit := true;

    -- PV1 : le client du dossier, le membre à qui il n'est pas assigné, l'anonyme.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into du_client from provisions;
    perform set_config('request.jwt.claims', json_build_object('sub', membre, 'role', 'authenticated')::text, true);
    select count(*) into du_membre from provisions where dossier_id = dossier;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*)::text into de_l_anon from provisions;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'PV1. le chef lit la provision qu''il a enregistrée (le contrôle positif) ; le client du dossier, un membre de l''équipe à qui le dossier n''est pas assigné et l''anonyme n''en lisent rien',
      'cible', 'provisions',
      'observe', 'le chef : ' || chef_lit || ' | le client : ' || du_client || ' | le membre : ' || du_membre || ' | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', chef_lit = 1 and du_client = 0 and du_membre = 0 and de_l_anon = '0');

    -- PV2 : le client n'écrit ni ne réécrit ; le super-administrateur réinsère.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_provision(dossier, saisie, null);
      par_la_fonction := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if par_la_fonction is null then par_la_fonction := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into provisions (dossier_id, genre, compte_provision, objet, ouverte_en, cree_par)
        values (dossier, 'risque', '151100', 'en direct', 2025, client);
      en_direct := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if en_direct is null then en_direct := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      alter table public.provisions disable trigger provisions_par_ses_fonctions;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into provisions (dossier_id, genre, compte_provision, objet, ouverte_en, cree_par)
        values (dossier, 'risque', '151100', 'en direct', 2025, client);
      sans_garde := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sans_garde is null then sans_garde := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with t as (update provisions set objet = 'réécrit' where dossier_id = dossier returning 1)
      select count(*) into reecrites from t;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into provisions (dossier_id, genre, compte_provision, objet, ouverte_en, cree_par)
        values (dossier, 'risque', '151100', 'réinsérée', 2025, chef);
      reinsere := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if reinsere is null then reinsere := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'PV2. le client n''écrit pas de provision (la fonction, la garde, puis la RLS) et n''en réécrit aucune ; le super-administrateur en réinsère une (la restauration, le contrôle positif)',
      'cible', 'provisions',
      'observe', 'par la fonction : ' || coalesce(par_la_fonction, '?') || ' | en direct : ' || coalesce(en_direct, '?')
        || ' | la garde débranchée : ' || coalesce(sans_garde, '?') || ' | réécrites : ' || reecrites || ' | réinsérée : ' || coalesce(reinsere, '?'),
      'ok', par_la_fonction = '42501 Accès refusé à ce dossier.'
        -- La porte d'accès en base (acces_avant_les_gardes) : la RLS refuse l'insertion directe avant la garde.
        and en_direct = case when exists (select 1 from pg_trigger g where g.tgrelid = 'public.provisions'::regclass and g.tgname = '_acces_avant_les_gardes')
                             then '42501 new row violates row-level security policy for table "provisions"'
                             else '42501 Une provision ne s’écrit que par enregistrer_provision et retirer_provision.' end
        and sans_garde like '42501 new row violates row-level security policy%' and reecrites = 0 and reinsere = 'ACCEPTÉ');

    -- M-PV1 : la lecture élargie au client du dossier.
    begin
      alter policy provisions_cabinet on public.provisions
        using (admin_du_dossier(dossier_id) or exists (select 1 from memberships m where m.dossier_id = provisions.dossier_id and m.user_id = auth.uid()));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from provisions where dossier_id = dossier;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-PV1 — la lecture des provisions élargie au client du dossier',
      'attendu', 'le client lit la provision de son dossier', 'observe', coalesce(elargie::text, '?') || ' lue(s)', 'mord', coalesce(elargie >= 1, false));

    -- M-PV2 : la policy fermée.
    begin
      alter policy provisions_cabinet on public.provisions using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select count(*) into fermee from provisions where dossier_id = dossier;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-PV2 — la policy des provisions fermée',
      'attendu', 'le chef ne lit plus la provision', 'observe', coalesce(fermee::text, '?') || ' lue(s)', 'mord', coalesce(fermee = 0, false));

    -- M-PV3 : la garde débranchée et l'écriture élargie au client du dossier — plus rien ne refuse.
    begin
      alter table public.provisions disable trigger provisions_par_ses_fonctions;
      alter policy provisions_cabinet on public.provisions
        with check (admin_du_dossier(dossier_id) or exists (select 1 from memberships m where m.dossier_id = provisions.dossier_id and m.user_id = auth.uid()));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      begin
        insert into provisions (dossier_id, genre, compte_provision, objet, ouverte_en, cree_par)
          values (dossier, 'risque', '151100', 'en direct', 2025, client);
        ecrite_elargie := 'ACCEPTÉ';
      exception when others then ecrite_elargie := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-PV3 — la garde débranchée, l''écriture des provisions élargie au client du dossier',
      'attendu', 'son insertion directe passe', 'observe', coalesce(ecrite_elargie, '?'), 'mord', coalesce(ecrite_elargie = 'ACCEPTÉ', false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- PV3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'provisions' and p.roles = array['authenticated']::name[]
     and p.policyname = 'provisions_cabinet' and p.permissive = 'PERMISSIVE' and p.cmd = 'ALL'
     and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check = 'admin_du_dossier(dossier_id)';
  verdicts := verdicts || jsonb_build_object('controle', 'PV3. la RLS active ; une seule policy, à authenticated, le cabinet du dossier des deux côtés (lecture du catalogue)',
    'cible', 'provisions',
    'observe', n || ' sur 1, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'provisions' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout, RLS '
      || (select c.relrowsecurity::text from pg_class c where c.oid = 'public.provisions'::regclass),
    'ok', n = 1 and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'provisions' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 1
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.provisions'::regclass));
  verdicts := verdicts || jsonb_build_object('controle', 'PV. le jeu d''essai des provisions s''est construit', 'cible', 'un dossier en engagement du cabinet du dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $pv$;

-- ══ AF. L'affectation du résultat (lignes 33 et 45, AFF2 ; migration `affectation_du_resultat`, PRÉPARÉE) ════════════════
--   AF1. Le chef lit la décision qu'il a enregistrée et sa répartition (contrôle positif) ; le client du dossier, un membre
--        de l'équipe à qui le dossier n'est pas assigné et l'anonyme n'en lisent rien.
--   AF2. Le client n'enregistre pas de décision (la fonction : 42501), n'en écrit pas en direct, n'en réécrit aucune ; le
--        super-administrateur en réinsère une (la restauration, contrôle positif).
--   AF3. Le catalogue : la RLS active sur les deux tables, deux policies permissives à authenticated sur chacune — la
--        lecture sur `admin_du_dossier`, la réinsertion sur `is_super_admin` —, et rien d'autre que la restrictive
--        `deux_facteurs`.
-- Trois mutations, qui doivent mordre : M-AF1 (la lecture élargie au client du dossier), M-AF2 (la lecture fermée), M-AF3
-- (la porte de la restauration fermée). Avant la migration, une ligne dit que le bloc attend.
do $af$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre uuid := '3e3b0000-0000-4000-8000-000000000001';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  dossier uuid := 'a1100000-0000-4000-8000-0000000000af';
  decision jsonb := '{"organe": "assemblee", "nombre_d_associes": "plusieurs", "date_decision": "2026-05-15", "comptes_approuves": true, "date_mise_en_paiement": null, "reserves_statutaires_distribuables": true}';
  lignes jsonb := '[{"origine": "benefice", "destination": "reserve_legale", "centimes": 5000}, {"origine": "benefice", "destination": "report_crediteur", "centimes": 95000}]';
  ecriture jsonb := '{"journal": "OD", "date": "2026-05-15", "pieceRef": "Affectation du résultat 2025 — décision du 15/05/2026", "pieceDate": "2026-05-15", "libelle": "Affectation du résultat 2025", "lignes": [{"compte": "120000", "sens": "debit", "centimes": 100000}, {"compte": "106100", "sens": "credit", "centimes": 5000}, {"compte": "110000", "sens": "credit", "centimes": 95000}]}';
  chef_lit bigint; du_client bigint; du_membre bigint; de_l_anon text; par_la_fonction text; en_direct text; reecrites bigint;
  reinsere text; elargie bigint; fermee bigint; porte_fermee text; n bigint; erreur text;
  construit boolean := false; verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
  reinsertion constant text := 'insert into affectations_du_resultat (dossier_id, exercice_affecte, version, etat, organe, nombre_d_associes_declare, '
    || 'date_decision, comptes_approuves, reserves_statutaires_distribuables, resultat_centimes, forme_juridique, capital_centimes, soldes_lus, '
    || 'cree_par, fin_par, fin_le) select dossier_id, exercice_affecte, 2, ''remplacee'', organe, nombre_d_associes_declare, date_decision, '
    || 'comptes_approuves, reserves_statutaires_distribuables, resultat_centimes, forme_juridique, capital_centimes, soldes_lus, cree_par, cree_par, now() '
    || 'from affectations_du_resultat where dossier_id = ''a1100000-0000-4000-8000-0000000000af''';
  -- En direct, le client ne lit pas ce qu'il recopierait : ses valeurs sont écrites ici (une insertion de zéro ligne ne
  -- prouverait rien).
  en_direct_sql constant text := 'insert into affectations_du_resultat (dossier_id, exercice_affecte, version, etat, organe, '
    || 'nombre_d_associes_declare, date_decision, comptes_approuves, reserves_statutaires_distribuables, resultat_centimes, '
    || 'forme_juridique, capital_centimes, soldes_lus, cree_par, fin_par, fin_le) values (''a1100000-0000-4000-8000-0000000000af'', '
    || '2025, 3, ''remplacee'', ''assemblee'', ''plusieurs'', ''2026-05-15'', false, true, 100000, ''5499'', 1000000, '
    || '''{"capitalAuxComptes": 0, "primes": 0, "ecartsDeReevaluation": 0, "reserveLegale": 0, "reservesIndisponibles": 0, '
    || '"reservesStatutaires": 0, "reservesReglementees": 0, "autresReserves": 0, "reportCrediteur": 0, "pertesAnterieures": 0, '
    || '"acomptesSurDividendes": 0}'', ''797fe440-df8d-4b8e-828b-d148927bfd60'', ''797fe440-df8d-4b8e-828b-d148927bfd60'', now())';
begin
  if to_regclass('public.affectations_du_resultat') is null then
    insert into rls_verdict values ('AF. l''affectation du résultat : EN ATTENTE de la migration affectation_du_resultat',
      'affectations_du_resultat', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : une SARL en engagement du cabinet du dossier du client, que le client voit, que le membre ne suit pas,
    --    son exercice 2025 validé (un bénéfice de 1 000,00) ──
    insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva, forme_juridique, capital, compte_notes_de_frais)
      select dossier, 'Essai RLS de l''affectation', d.cabinet_id, 'engagement', 'franchise', '5499', 10000, '455000'
        from dossiers d where d.id = dossier_du_client;
    insert into memberships (user_id, dossier_id, role)
      select client, dossier, m.role from memberships m where m.user_id = client and m.dossier_id = dossier_du_client limit 1;
    perform set_config('jd.validation_exercice', dossier::text, true);
    insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib)
      values (dossier, '2025-06-30', '706000', 'Essai', 1000, 'credit', 'validee', now(), 'OD', 1, 'Essai', '2025-06-30', 'Essai'),
             (dossier, '2025-06-30', '512000', 'Essai', 1000, 'debit', 'validee', now(), 'OD', 1, 'Essai', '2025-06-30', 'Essai');
    perform set_config('jd.validation_exercice', '', true);
    insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration)
      values (dossier, 2025, now(), chef, 'engagement', 0, 0, 0, 0, repeat('0', 64), null);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform enregistrer_affectation(dossier, 2025, null, decision, lignes, ecriture);
    select count(*) + (select count(*) from lignes_d_affectation where dossier_id = dossier) into chef_lit
      from affectations_du_resultat where dossier_id = dossier;
    reset role;
    construit := true;

    -- AF1 : le client du dossier, le membre à qui il n'est pas assigné, l'anonyme.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) + (select count(*) from lignes_d_affectation) into du_client from affectations_du_resultat;
    perform set_config('request.jwt.claims', json_build_object('sub', membre, 'role', 'authenticated')::text, true);
    select count(*) + (select count(*) from lignes_d_affectation where dossier_id = dossier) into du_membre
      from affectations_du_resultat where dossier_id = dossier;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select (count(*) + (select count(*) from lignes_d_affectation))::text into de_l_anon from affectations_du_resultat;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'AF1. le chef lit la décision qu''il a enregistrée et ses deux lignes (le contrôle positif) ; le client du dossier, un membre de l''équipe à qui le dossier n''est pas assigné et l''anonyme n''en lisent rien',
      'cible', 'affectations_du_resultat, lignes_d_affectation',
      'observe', 'le chef : ' || chef_lit || ' | le client : ' || du_client || ' | le membre : ' || du_membre || ' | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', chef_lit = 3 and du_client = 0 and du_membre = 0 and de_l_anon = '0');

    -- AF2 : le client n'enregistre ni n'écrit ni ne réécrit ; le super-administrateur réinsère.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform enregistrer_affectation(dossier, 2025, null, decision, lignes, ecriture);
      par_la_fonction := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if par_la_fonction is null then par_la_fonction := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      execute en_direct_sql;
      en_direct := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if en_direct is null then en_direct := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with t as (update affectations_du_resultat set organe = 'consultation_ecrite' where dossier_id = dossier returning 1)
      select count(*) into reecrites from t;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      execute reinsertion;
      reinsere := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if reinsere is null then reinsere := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'AF2. le client n''enregistre pas de décision (la fonction), n''en écrit pas en direct et n''en réécrit aucune ; le super-administrateur en réinsère une (la restauration, le contrôle positif)',
      'cible', 'affectations_du_resultat',
      'observe', 'par la fonction : ' || coalesce(par_la_fonction, '?') || ' | en direct : ' || coalesce(en_direct, '?') || ' | réécrites : ' || reecrites || ' | réinsérée : ' || coalesce(reinsere, '?'),
      'ok', par_la_fonction = '42501 Accès refusé à ce dossier.' and en_direct like '42501 %' and reecrites = 0 and reinsere = 'ACCEPTÉ');

    -- M-AF1 : la lecture élargie au client du dossier.
    begin
      alter policy affectations_du_resultat_lecture on public.affectations_du_resultat
        using (admin_du_dossier(dossier_id) or exists (select 1 from memberships m where m.dossier_id = affectations_du_resultat.dossier_id and m.user_id = auth.uid()));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from affectations_du_resultat where dossier_id = dossier;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-AF1 — la lecture des décisions d''affectation élargie au client du dossier',
      'attendu', 'le client lit la décision', 'observe', coalesce((elargie >= 1)::text, '?'), 'mord', coalesce(elargie >= 1, false));

    -- M-AF2 : la lecture fermée.
    begin
      alter policy lignes_d_affectation_lecture on public.lignes_d_affectation using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select count(*) into fermee from lignes_d_affectation where dossier_id = dossier;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-AF2 — la lecture des lignes d''affectation fermée',
      'attendu', 'le chef ne lit plus rien', 'observe', coalesce(fermee::text, '?') || ' lue(s)', 'mord', coalesce(fermee = 0, false));

    -- M-AF3 : la porte de la restauration fermée.
    begin
      alter policy affectations_du_resultat_restauration on public.affectations_du_resultat with check (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      begin
        execute reinsertion;
        porte_fermee := 'ACCEPTÉ';
      exception when others then porte_fermee := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-AF3 — la porte de la restauration des décisions fermée',
      'attendu', 'le super-administrateur ne réinsère plus', 'observe', coalesce(porte_fermee, '?'), 'mord', coalesce(porte_fermee like '42501 %', false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- AF3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.roles = array['authenticated']::name[] and p.permissive = 'PERMISSIVE'
     and ((p.tablename = 'affectations_du_resultat' and p.policyname = 'affectations_du_resultat_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check is null)
       or (p.tablename = 'affectations_du_resultat' and p.policyname = 'affectations_du_resultat_restauration' and p.cmd = 'INSERT' and p.qual is null and p.with_check = 'is_super_admin()')
       or (p.tablename = 'lignes_d_affectation' and p.policyname = 'lignes_d_affectation_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check is null)
       or (p.tablename = 'lignes_d_affectation' and p.policyname = 'lignes_d_affectation_restauration' and p.cmd = 'INSERT' and p.qual is null and p.with_check = 'is_super_admin()'));
  verdicts := verdicts || jsonb_build_object('controle', 'AF3. la RLS active sur les deux tables ; deux policies à authenticated sur chacune : la lecture du cabinet du dossier, la réinsertion du super-administrateur (lecture du catalogue)',
    'cible', 'affectations_du_resultat, lignes_d_affectation',
    'observe', n || ' sur 4, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename in ('affectations_du_resultat', 'lignes_d_affectation') and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout, RLS '
      || (select string_agg(c.relrowsecurity::text, ',' order by c.relname) from pg_class c where c.oid in ('public.affectations_du_resultat'::regclass, 'public.lignes_d_affectation'::regclass)),
    'ok', n = 4 and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename in ('affectations_du_resultat', 'lignes_d_affectation') and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 4
      and (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.affectations_du_resultat'::regclass, 'public.lignes_d_affectation'::regclass)));
  verdicts := verdicts || jsonb_build_object('controle', 'AF. le jeu d''essai de l''affectation du résultat s''est construit', 'cible', 'une SARL en engagement du cabinet du dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $af$;

-- ══ ID. L'inventaire déclaré (ligne 35, INV3 ; migration `validation_de_l_inventaire`, PRÉPARÉE, après `operations_d_inventaire`) ══
-- Une table d'un dossier, lue par son cabinet (`admin_du_dossier`), écrite par `declarer_inventaire` et
-- `retirer_declaration_inventaire` seules (aucune policy d'écriture, une garde), réinsérée par le super-administrateur (la
-- restauration). Aucun client, même celui du dossier. Le reste : `validationDeLInventaire.sql`, sur une réplique.
--   ID1. Le chef déclare l'inventaire de 2025 d'un dossier en engagement et le lit (le contrôle POSITIF) ; le client, qui a
--        un accès au dossier, n'en lit rien ; un membre de l'équipe à qui le dossier n'est pas assigné non plus ; l'anonyme
--        non plus.
--   ID2. Le client ne déclare rien (42501, sous ses mots), n'insère rien en direct (42501), ne réécrit rien ; le
--        super-administrateur réinsère une déclaration en direct (la restauration, le contrôle POSITIF).
--   ID3. Le catalogue : la RLS active, deux policies permissives à authenticated — la lecture sur `admin_du_dossier`, la
--        réinsertion sur `is_super_admin` —, et rien d'autre que la restrictive `deux_facteurs`.
-- Trois mutations, qui doivent mordre : M-ID1 (la lecture élargie au client du dossier : il lit la déclaration), M-ID2 (la
-- lecture fermée : le chef ne lit plus rien), M-ID3 (la porte de la restauration fermée : le super-administrateur ne réinsère
-- plus). Avant la migration, une ligne dit que le bloc attend.
do $id$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef   uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  membre uuid := '3e3b0000-0000-4000-8000-000000000001';
  dossier_du_client uuid := 'ac538d93-7da3-4403-bca6-2d7836810a6f';
  dossier uuid := 'a1300000-0000-4000-8000-0000000000d1';
  chef_lit bigint; du_client bigint; du_membre bigint; de_l_anon text; par_la_fonction text; en_direct text; reecrites bigint;
  reinsere text; elargie bigint; fermee bigint; porte_fermee text; n bigint; erreur text;
  construit boolean := false; verdicts jsonb := '[]'::jsonb; mutations jsonb := '[]'::jsonb;
begin
  if to_regclass('public.inventaires_declares') is null then
    insert into rls_verdict values ('ID. l''inventaire déclaré : EN ATTENTE de la migration validation_de_l_inventaire',
      'inventaires_declares', 'absente : elle se juge dès que la migration y est', true);
    return;
  end if;
  begin
    -- ── Le jeu : un dossier en engagement du cabinet du dossier du client, que le client voit, que le membre ne suit pas ──
    insert into dossiers (id, nom, cabinet_id, mode_comptable, statut_tva)
      select dossier, 'Essai RLS de l''inventaire déclaré', d.cabinet_id, 'engagement', 'franchise' from dossiers d where d.id = dossier_du_client;
    insert into memberships (user_id, dossier_id, role)
      select client, dossier, m.role from memberships m where m.user_id = client and m.dossier_id = dossier_du_client limit 1;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform declarer_inventaire(dossier, 2025);
    select count(*) into chef_lit from inventaires_declares where dossier_id = dossier;
    reset role;
    construit := true;

    -- ID1 : le client du dossier, le membre à qui il n'est pas assigné, l'anonyme.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    select count(*) into du_client from inventaires_declares;
    perform set_config('request.jwt.claims', json_build_object('sub', membre, 'role', 'authenticated')::text, true);
    select count(*) into du_membre from inventaires_declares where dossier_id = dossier;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      select count(*)::text into de_l_anon from inventaires_declares;
    exception when others then de_l_anon := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'ID1. le chef lit la déclaration qu''il a faite (le contrôle positif) ; le client du dossier, un membre de l''équipe à qui le dossier n''est pas assigné et l''anonyme n''en lisent rien',
      'cible', 'inventaires_declares',
      'observe', 'le chef : ' || chef_lit || ' | le client : ' || du_client || ' | le membre : ' || du_membre || ' | l''anonyme : ' || coalesce(de_l_anon, '?'),
      'ok', chef_lit = 1 and du_client = 0 and du_membre = 0 and de_l_anon = '0');

    -- ID2 : le client ne déclare ni n'écrit ni ne réécrit ; le super-administrateur réinsère.
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      perform declarer_inventaire(dossier, 2024);
      par_la_fonction := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if par_la_fonction is null then par_la_fonction := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      insert into inventaires_declares (dossier_id, exercice, declare_par) values (dossier, 2024, client);
      en_direct := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if en_direct is null then en_direct := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with t as (update inventaires_declares set exercice = 2024 where dossier_id = dossier returning 1)
      select count(*) into reecrites from t;
    reset role;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      insert into inventaires_declares (dossier_id, exercice, declare_par) values (dossier, 2024, chef);
      reinsere := 'ACCEPTÉ';
      raise exception 'ANNULATION_ESSAI';
    exception when others then if reinsere is null then reinsere := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('controle', 'ID2. le client ne déclare pas d''inventaire (la fonction), n''en écrit pas en direct et n''en réécrit aucun ; le super-administrateur en réinsère un (la restauration, le contrôle positif)',
      'cible', 'inventaires_declares',
      'observe', 'par la fonction : ' || coalesce(par_la_fonction, '?') || ' | en direct : ' || coalesce(en_direct, '?') || ' | réécrites : ' || reecrites || ' | réinsérée : ' || coalesce(reinsere, '?'),
      'ok', par_la_fonction = '42501 Accès refusé à ce dossier.' and en_direct like '42501 %' and reecrites = 0 and reinsere = 'ACCEPTÉ');

    -- M-ID1 : la lecture élargie au client du dossier.
    begin
      alter policy inventaires_declares_lecture on public.inventaires_declares
        using (admin_du_dossier(dossier_id) or exists (select 1 from memberships m where m.dossier_id = inventaires_declares.dossier_id and m.user_id = auth.uid()));
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      select count(*) into elargie from inventaires_declares where dossier_id = dossier;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-ID1 — la lecture des déclarations d''inventaire élargie au client du dossier',
      'attendu', 'le client lit la déclaration', 'observe', coalesce((elargie >= 1)::text, '?'), 'mord', coalesce(elargie >= 1, false));

    -- M-ID2 : la lecture fermée.
    begin
      alter policy inventaires_declares_lecture on public.inventaires_declares using (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select count(*) into fermee from inventaires_declares where dossier_id = dossier;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-ID2 — la lecture des déclarations d''inventaire fermée',
      'attendu', 'le chef ne lit plus rien', 'observe', coalesce(fermee::text, '?') || ' lue(s)', 'mord', coalesce(fermee = 0, false));

    -- M-ID3 : la porte de la restauration fermée.
    begin
      alter policy inventaires_declares_restauration on public.inventaires_declares with check (false);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      begin
        insert into inventaires_declares (dossier_id, exercice, declare_par) values (dossier, 2024, chef);
        porte_fermee := 'ACCEPTÉ';
      exception when others then porte_fermee := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      raise exception 'ANNULATION_ESSAI';
    exception when others then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := coalesce(erreur, sqlstate || ' ' || sqlerrm); end if;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    mutations := mutations || jsonb_build_object('mutation', 'M-ID3 — la porte de la restauration des déclarations fermée',
      'attendu', 'le super-administrateur ne réinsère plus', 'observe', coalesce(porte_fermee, '?'), 'mord', coalesce(porte_fermee like '42501 %', false));

    raise exception 'ANNULATION_ESSAI';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- ID3 : le catalogue.
  select count(*) into n from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'inventaires_declares' and p.roles = array['authenticated']::name[]
     and p.permissive = 'PERMISSIVE'
     and ((p.policyname = 'inventaires_declares_lecture' and p.cmd = 'SELECT' and p.qual = 'admin_du_dossier(dossier_id)' and p.with_check is null)
       or (p.policyname = 'inventaires_declares_restauration' and p.cmd = 'INSERT' and p.qual is null and p.with_check = 'is_super_admin()'));
  verdicts := verdicts || jsonb_build_object('controle', 'ID3. la RLS active ; deux policies à authenticated : la lecture du cabinet du dossier, la réinsertion du super-administrateur (lecture du catalogue)',
    'cible', 'inventaires_declares',
    'observe', n || ' sur 2, ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'inventaires_declares' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) || ' en tout, RLS '
      || (select c.relrowsecurity::text from pg_class c where c.oid = 'public.inventaires_declares'::regclass),
    'ok', n = 2 and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'inventaires_declares' and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE')) = 2
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.inventaires_declares'::regclass));
  verdicts := verdicts || jsonb_build_object('controle', 'ID. le jeu d''essai de l''inventaire déclaré s''est construit', 'cible', 'un dossier en engagement du cabinet du dossier du client',
    'observe', case when construit and erreur is null then 'construit' else coalesce(erreur, 'non construit') end,
    'ok', construit and erreur is null);

  insert into rls_verdict select v.controle, v.cible, v.observe, v.ok
    from jsonb_to_recordset(verdicts) as v(controle text, cible text, observe text, ok boolean);
  insert into rls_mutation select m.mutation, m.attendu, m.observe, m.mord
    from jsonb_to_recordset(mutations) as m(mutation text, attendu text, observe text, mord boolean);
end $id$;

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
