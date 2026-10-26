-- LES ÉCRITURES D'UNE VENTE FACTURÉE, ÉPROUVÉES EN BASE (ligne 28.6, chantier EC-Q3, étape VF4b ; migration
-- `ecritures_de_la_vente_facturee`, après `source_de_la_vente` et `encaissements_de_la_vente_facturee`) — à rejouer par
-- `execute_sql` après toute migration qui touche `ecrire_vente_facturee`, `retirer_ecriture_vente_facturee`,
-- `choisir_compte_contrepartie`, la règle du cumul (`prorata_arrondi`, `calcul_vente_facturee`), la recomposition
-- (`ecriture_attendue_vente_facturee`, `refus_compte_de_contrepartie`), les deux gardes (`garder_lignes_de_la_vente_facturee`,
-- `garder_encaissement_facture`), `ecritures_brouillon` et ses déclencheurs, `encaissements_factures`, la frontière de la
-- validation, `compte_du_role` et le catalogue des rôles, `admin_du_dossier`, et les dix-huit fonctions du relevé qui
-- classent ou déclassent un mouvement (le lot de R1, migration `lignes_propres_au_mouvement` : 95, 96, 130 à 139,
-- 155) ; et, depuis la migration `virement_mixte` (étape VF5h), le classement d'un mouvement par ses encaissements
-- (`classer_mouvement_par_encaissements`, 53 à 57) et les exemplaires des factures (`pieces.facture_id`,
-- `garder_exemplaire_facture`), que le classement et la recomposition lisent ; et, depuis la migration
-- `validation_des_ventes_facturees` (étape VF7b), la recomposition d'un bloc (`ecritures_attendues_de_la_periode`, 9c et
-- 177).
--
-- Ce qui se prouve ici — chaque refus jugé à son code ET à ses mots, ceux de la migration, que
-- src/lib/ecritureVenteFacturee.test.ts confronte à ses listes ; chaque recomposition confrontée au MODULE, que ce même test
-- relit ici (src/test/essaiEcrituresVentesFacturees.ts) :
--   - LA RECOMPOSITION (1 à 9) : la règle du cumul en entiers, sur une table de triplets relevée par le module
--     (`prorataArrondi`) ; les parts du jeu, TTC et TVA au centime du module (`ventesFacturees`) ; puis TOUTES les sources
--     du jeu, rendues dans les deux modèles comptables — trésorerie / engagement, une seule fois quand ils disent pareil —
--     comme `ecrituresDesVentesFacturees` les compose : un cas par point du § 5 de la conception (la facture, l'avoir,
--     l'encaissement et sa trésorerie, la contre-passation, le mouvement, le paiement partiel, le retrait, la franchise),
--     ce qui ne s'écrit pas et pourquoi, une vente écartée par motif, l'exercice validé ; un dossier qui n'a pas basculé
--     n'a rien à écrire. Le jeu tient aussi les BORNES que les mutations de la migration ont demandées : le 31 décembre
--     d'un exercice validé, un avoir du jour d'un encaissement ou du fait générateur, un encaissement du jour de la
--     livraison, deux encaissements du même jour que leur création range, une contre-passation qui n'est pas la
--     dernière, les seuils des frais (au seuil, au-delà de 5 €, au-delà de 2 %, en deçà du mouvement), des espèces versées
--     un autre jour, un mouvement classé que citent un encaissement retiré et un encaissement défait sans mouvement.
--     Les attendus longs (2 à 9) sont leur EMPREINTE (« md5: »), le moteur comparant l'empreinte de ce que la base rend ;
--     leur texte, celui du module, est en commentaire au-dessus de chaque contrôle (« -- attendu N : »), et le test relit
--     l'un et l'autre ;
--   - ÉCRIRE (10 à 19) : une source s'écrit telle que la base la recompose, sous le réglage de SA source retiré aussitôt ;
--     réécrite, elle se REMPLACE d'un tenant — deux dates pour une facture, de nouvelles lignes après un avoir ; un
--     mouvement s'écrit sans facture ni encaissement ; l'ordre et le libellé des lignes n'en décident pas ;
--   - LES REFUS D'ÉCRIRE (20 à 52), à leur rang, et l'ordre de rangs voisins ; LES REFUS DE RETIRER (60 à 69), et deux
--     retraits — un encaissement retiré, un mouvement déclassé ;
--   - G5 (70 à 89) : une écriture directe refusée sur les trois genres — une facture, un encaissement, un mouvement classé
--     par ses encaissements —, sauf sous le réglage de sa source, à la restauration du super-administrateur et pour la
--     validation d'un exercice ; une écriture ordinaire passe comme hier ;
--   - LES AUTRES CHEMINS (90 à 96) : sur un mouvement classé par ses encaissements, déjà écrit, ils butent sur leurs
--     propres refus ou sur G1 et G2, sous leurs mots d'hier, avant toute écriture (90 à 94). Sur un mouvement que rien ne
--     classe mais qui porte encore les lignes d'une vente facturée dont il n'est pas la source, ils passent, et ces
--     lignes restent (le lot de R1, migration `lignes_propres_au_mouvement` : les dix-huit fonctions du relevé ne
--     suppriment, ne jugent et ne vérifient que les lignes propres au mouvement, jamais une ligne qui porte une facture ou
--     un encaissement) : le mouvement déclassé, puis l'encaissement du même jour contre-passé sans mouvement, celui-ci ne
--     justifie plus son mouvement, que G2 libère ; ses lignes et celles de sa contre-passation (le [T] : la banque, sur ce
--     mouvement) y restent, légitimement, puisque la base les recompose encore ; le compte de bilan s'écrit à côté
--     d'elles (95) ; le mouvement déclassé, puis l'encaissement retiré, il s'écrit de même, et les lignes périmées de
--     l'encaissement restent jusqu'à `retirer_ecriture_vente_facturee`, qui les retire sans toucher au compte de bilan
--     (96). Hier, ces deux chemins butaient sur G5 en 42501, rien d'écrit ni de retiré ;
--   - L'IMPAYÉ D'UN ENCAISSEMENT JAMAIS DÉCLARÉ (97 ; migration `impaye_non_declare`, étape VF5d2) : la
--     contre-passation que la fonction écrit en citant un débit libre se compose et s'écrit comme toute
--     contre-passation ; rien de ce qui compose ne lit les déclarations ;
--   - LE VIREMENT MIXTE (6b, 14b à 14d, 46 à 46d, 53 à 59, 79a à 79d, 166 ; migration `virement_mixte`, étape VF5h ;
--     VF2-Q2, selon VF5-Q2) : un crédit qui paie une facture source et une facture d'avant la bascule — l'exemplaire
--     unique et validé de celle-ci désigné (les pièces 601 à 605, posées par la porte de la restauration) — se classe
--     (53) et s'écrit : la banque de ce que les encaissements du même jour des factures sources et l'exemplaire n'ont
--     pas porté, le 511 d'un chèque d'un autre jour, les frais du tout (6b, 14b, 14c) ; la banque de l'exemplaire, que
--     l'application écrit, fait avec eux le crédit (14d). Sans exemplaire, avec un exemplaire à valider, avec deux, le
--     classement et l'écriture refusent sous les mêmes mots, la facture au plus petit numéro nommée (46 à 46d, 54 à
--     57) ; déclassé, l'encaissement de la facture d'avant retiré ou défait sans mouvement ne retient plus la
--     composition (58, 59). G5 laisse la banque d'une pièce sur un mouvement classé être l'écriture de cette pièce —
--     posée par le membre ou le chef simple, reprise —, mais une ligne ne passe pas d'un genre à l'autre en perdant ou
--     en recevant sa pièce (79a à 79d, 166) ;
--   - R1, LES DIX-HUIT FONCTIONS DU RELEVÉ SUR LE MOUVEMENT LIBÉRÉ (130 à 139) : la même préparation (la macro PR1 — le
--     mouvement 401 déclassé, l'encaissement 501 contre-passé sans mouvement, ses lignes et celles de sa contre-passation
--     écrites —, et deux lignes posées par la validation sur ce mouvement, VALIDÉES : une ligne de la facture 101, que la
--     composition ne pose jamais sur un mouvement mais qu'une restauration peut porter, et une de l'encaissement 501) ;
--     puis chaque mécanisme classe le mouvement et le déclasse, par ses deux fonctions — l'affectation, le virement
--     personnel, le compte de bilan, la ventilation, le règlement groupé, l'emprunt, l'échéance de cotisation (retirée,
--     puis supprimée), la déclaration de TVA (son paiement retiré, puis la déclaration) : chacune passe, ses lignes propres
--     écrites puis retirées, les lignes de la vente facturée intactes. Les deux lignes validées et déséquilibrées font
--     de chaque filtre oublié un refus visible — une suppression qui les toucherait, une écriture validée qui retiendrait
--     le mouvement, un équilibre qui les compterait ; le retrait d'une pièce rapprochée en engagement, par le navigateur
--     (une suppression directe), ne se joue que sur la réplique ;
--   - LE COMPTE DE CONTREPARTIE (100 à 119) : ses refus à leur rang, la fonction qui le pose et le remplace, la garde des
--     encaissements qui ne le laisse naître qu'à la restauration et changer que sous son réglage ;
--   - LA FRONTIÈRE DES ENCAISSEMENTS (170 à 176, posés en dernier ; migration `frontiere_des_encaissements`, étape
--     VF7a) : le chèque de l'exercice validé de R, rattaché au crédit de janvier, garde sa recomposition et son
--     écriture validée ; le crédit se classe par lui, se compose — la banque au débit, le 511 au crédit — et s'écrit ;
--   - LE CATALOGUE (150 à 155 ; 155, les quatre contraintes qui font, sur une ligne qui porte un mouvement, des quatre
--     autres colonnes de source des colonnes nulles : ce que le filtre de R1 suppose) ; LES MUTATIONS (160 à 166) :
--     chacune rejoue un contrôle avec une cible ou un profil délibérément juste, et doit passer ; et que RIEN ne reste en
--     base (199).
--
-- Ce qui ne se joue PAS ici, faute de pouvoir supprimer en production : G5 refuse la suppression directe d'une écriture
-- de vente facturée, et laisse passer la cascade d'un dossier qu'on supprime ; depuis l'étape VF5h, elle laisse retirer
-- la banque d'une pièce sur un mouvement classé par ses encaissements, et refuse toujours d'en retirer une ligne du
-- mouvement — joué sur la réplique seulement.
--
-- Trois dossiers JETABLES du cabinet du dossier `test` : R (trésorerie) et G (engagement) ont basculé et portent le même
-- jeu, N n'a pas basculé. Le jeu se pose par la porte de la restauration (le super-administrateur), depuis la macro JEU
-- que `jeuPourLaBase` rend (un jour : son écart au 1er mars 2026) ; ses identifiants sont FIXES (préfixe `5f4b0000`, puis
-- cinq chiffres : ceux de G, 1 000 de plus). L'exercice 2025 de R est validé, une écriture de son encaissement de 2025
-- aussi. Les écritures que les contrôles envoient sont celles que la base recompose, retenues au début (`PA`…) : la VUE dit
-- qu'elles sont celles du module. Tout se joue dans un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) ;
-- chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001) — le moteur d'étapes de
-- ventesFacturees.sql, ses genres et ses profils (« membre » affecté au dossier R, « client_vb » un accès à R avec
-- « Ventes » et « Banque »). Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.ecritures_ventes`) : hors
-- de l'outil d'exécution, le fichier se joue en UNE transaction (`psql -1`). Aucune instruction de suppression, aucune mise
-- à jour sans `where`.
--
-- ÉPROUVÉ LE 20/10/2026 SUR UNE RÉPLIQUE, PAS EN PRODUCTION (PostgreSQL 16, UTF8 ; `signature.sql` : les neuf familles
-- égales à la production relevée le jour même, et ses 142 migrations ; la migration appliquée comme l'outil l'aurait fait,
-- puis collée comme le cabinet le fera : même signature) : 164 contrôles, 0 en faute, rien n'est resté ; le texte sans
-- ses lignes de commentaire, envoyé en une requête comme le fait l'outil, rend les mêmes verdicts (59 906 caractères
-- reçus, empreinte 86060716db956937055490cc50df5517). Les mutations de la migration — chaque refus retiré, et chaque
-- règle du compte de contrepartie oubliée (68), chaque refus neuf sous un autre code (49), 152 opérateurs et conditions,
-- 36 de la structure (contrainte, déclencheur, droits, sécurité, chemin, volatilité) — jouées contre cet essai et
-- vingt-trois autres (dont ventesFacturees.sql, encaissementsFactures.sql, restauration.sql, validationExercice.sql,
-- rls.sql, et les suppressions, jouées sur la réplique seulement) : 287 tuées sur 292 (cet essai seul en tue 269) ; 13
-- autres, déclarées équivalentes d'avance avec leur raison, survivent ; les 5 survivantes échouent FERMÉES — un
-- remplacement ou un retrait qui emporterait les écritures validées d'une facture (la garde des écritures validées le
-- refuse) ou les lignes d'un encaissement passées sur un mouvement (G5 le refuse), et un retrait qui refuserait à tort
-- une source aux écritures à la fois validées et proposées.
--
-- REJOUÉ LE 21/10/2026 SUR UNE RÉPLIQUE, PAS EN PRODUCTION, AVEC LE LOT DE R1 (`signature.sql` : les neuf familles
-- égales à la production relevée le jour même, et ses 143 migrations ; la migration `lignes_propres_au_mouvement`
-- collée comme le cabinet le fera, et appliquée comme l'outil l'aurait fait : même signature) : 175 contrôles, 0 en
-- faute, rien n'est resté ; sans la migration, 12 en faute — 95, 96 et 130 à 139, les chemins qui butaient hier ; le
-- texte sans ses lignes de commentaire, envoyé en une requête comme le fait l'outil, rend les mêmes verdicts (77 712
-- caractères reçus, empreinte ed45d71df8da3bce60ca0332d7cb5aef). Les mutations de la migration — chacune des
-- quarante-trois clauses rendue à son texte d'hier, puis privée de l'un ou l'autre de ses deux filtres : 129 — sont
-- toutes tuées par cet essai.
--
-- 23/10/2026, SUR UNE RÉPLIQUE, PAS EN PRODUCTION (migration `impaye_non_declare`, appliquée le 23/10/2026 sous la
-- version `20261023063657` ; chantier EC-Q3, étape VF5d2) : le contrôle 97 — la contre-passation que la fonction écrit
-- pour un encaissement jamais déclaré, en citant un débit libre du même jour, se compose (la banque sur ce débit) et
-- s'écrit comme toute contre-passation, et rien de ce qui compose ne lit les déclarations. Sur une réplique égale à la
-- production (145 migrations) : sans la migration, 176 contrôles, 1 en faute — 97 — ; avec elle, 176 justes, rien n'est
-- resté, les 175 d'hier inchangés. Le texte sans ses lignes de commentaire, envoyé en une requête : 79 113 caractères,
-- empreinte 80ee2b0fe8ab2d4f2b8a68e278af4228, 176 justes. Après l'application, la session n'a rejoué en production que
-- ventesFacturees.sql (187 justes), qui y éprouve `annuler_encaissement` pour une facture source comme pour une autre :
-- les fonctions que cet essai éprouve d'autre n'ont pas changé.
--
-- 23/10/2026, SUR UNE RÉPLIQUE, PAS EN PRODUCTION (migration `virement_mixte`, présentée au cabinet, pas encore
-- appliquée ; chantier EC-Q3, étape VF5h) : le jeu du virement mixte — les factures 124 à 134, dont six d'avant la
-- bascule ; les mouvements 420 à 424 ; les encaissements 560 à 570 ; les exemplaires 601 à 605 — et vingt contrôles
-- neufs (l'étape des exemplaires, 6b, 14b à 14d, 46b à 46d, 53 à 59, 79a à 79d, 166) ; 2, 8 et 46 suivent le jeu et le
-- module. Sur une réplique égale à la production (`signature.sql` : les neuf familles égales, et ses 146 migrations) :
-- sans la migration, 196 contrôles, 17 en faute — 6b, 8, 14b à 14d, 46 à 46d, 53 à 57, 79a, 79b et 79d — ; avec elle,
-- 196 justes, rien n'est resté, et les contrôles d'hier rendent, verdict et observation, ce qu'ils rendaient, hors de
-- 2, 8 et 46. Le texte sans ses lignes de commentaire, envoyé en une requête : 87 680 caractères, empreinte
-- e93a36faa98795aad666786584b1c697, 196 justes. Sur la réplique seulement, une sonde des suppressions de G5 (la banque
-- de l'exemplaire retirée par le chef, puis par le membre ; une ligne du mouvement, seule ou avec elle ; la suppression
-- du dossier) : justes avec la migration ; sans elle, la banque de l'exemplaire ne se retire pas (42501). Trente-deux
-- mutations des quatre fonctions de la migration (une condition, un filtre, un ordre, un mot changés), jouées contre
-- cet essai, ventesFacturees.sql et la sonde : vingt-sept tuées ; les cinq qui survivent sont déclarées équivalentes
-- d'avance, avec leur raison (le dossier et la nature d'un exemplaire, que sa garde impose ; la source d'une facture,
-- fixée à sa validation).
--
-- 23/10/2026, SUR UNE RÉPLIQUE, PAS EN PRODUCTION (migration `jumelle_inversee`, préparée, pas encore appliquée ; chantier
-- EC-Q3, étape VF6b) : un déclencheur de plus sur les écritures, G4 (`ecritures_brouillon_sans_exemplaire_d_une_source`),
-- que le contrôle 151 compte — G5 reste la dernière garde. Aucun autre contrôle ne change : la banque que VF5h écrit pour
-- l'exemplaire d'une facture d'avant passe G4, qui ne refuse que l'exemplaire d'une facture SOURCE. Sur une réplique égale
-- à la production plus la migration de VF5h : sans la migration, 198 contrôles, le 151 seul en faute ; avec elle, 198
-- justes, rien n'est resté.
--
-- 24/10/2026 — les migrations `virement_mixte` et `jumelle_inversee` APPLIQUÉES en production (`20261024052038`,
-- `20261024052424`) : ce fichier n'y a pas été rejoué entier ; la signature des neuf familles en production égale celle
-- de la réplique où il a rendu ses 198 justes (HISTORIQUE.md, « LE VIREMENT MIXTE ET LA JUMELLE INVERSÉE EN PRODUCTION »).
--
-- 25/10/2026, SUR UNE RÉPLIQUE, PAS EN PRODUCTION (migration `frontiere_des_encaissements`, appliquée le 26/10/2026 ;
-- chantier EC-Q3, étape VF7a) : 170 à 176 — le chèque de 30 € de F2025-0001, daté du 31 décembre 2025 dans
-- l'exercice validé de R, sans mouvement, se rattache au crédit de janvier ; sa recomposition reste celle d'avant (le
-- 511, au 31 décembre), son écriture validée est intacte, et le crédit de janvier se classe par lui, se compose et
-- s'écrit ; le module compose le même crédit (src/lib/ecritureVenteFacturee.test.ts). Sur une réplique égale à la
-- production (148 migrations) munie de `registre_virement_mixte` : sans la migration, 205 contrôles, 5 en faute — 170,
-- 173 à 176 — ; avec elle, 205 justes, rien n'est resté, et les 198 d'hier inchangés. Le texte sans ses lignes de
-- commentaire, envoyé en une requête : 89 884 caractères, empreinte adff7a718db8f96a3a77994fa5531683, 205 justes.
--
-- 25/10/2026, SUR UNE RÉPLIQUE, PAS EN PRODUCTION (migration `validation_des_ventes_facturees`, appliquée le 26/10/2026 ;
-- chantier EC-Q3, étape VF7b) : 9c et 177 confrontent la recomposition d'un bloc (`ecritures_attendues_de_la_periode`),
-- source par source, à `ecriture_attendue_vente_facturee` — les 198 sources des trois dossiers au départ, les 199 que
-- l'essai laisse à la fin, après tout ce qu'il a écrit, retiré et classé : 0 écart. Sur une réplique égale à la
-- production munie de VF5h2 et de VF7a : sans la migration, 207 contrôles, 2 en faute — 9c et 177, exactement — ; avec
-- elle, 207 justes, rien n'est resté, et les 205 d'hier inchangés. Le texte sans ses lignes de commentaire, envoyé en
-- une requête : 91 000 caractères, empreinte 652baa561e5596fbc74d521686d13991, 207 justes.
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
  tables text[] := array['dossiers', 'factures_emises', 'facture_lignes', 'lignes_bancaires', 'encaissements_factures',
    'encaissements_factures_taux', 'ecritures_brouillon', 'exercices_valides', 'cabinet_admins', 'dossier_assignations', 'memberships',
    'transmissions_factures', 'transmissions_encaissements', 'categories', 'pieces', 'ventilations_bancaires', 'reglements_groupes',
    'emprunts', 'cotisations_declarees', 'declarations_tva'];
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

  ids := jsonb_build_object('CAB', cabinet, 'X', gen_random_uuid(), 'U', '5f4b0000-0000-4000-8000-0000000',
      'D1', '5f4b0000-0000-4000-8000-000000000001', 'D2', '5f4b0000-0000-4000-8000-000000000002',
      'D3', '5f4b0000-0000-4000-8000-000000000003')
    || jsonb_build_object(
    'JEU', $m${"f":[[101,"F2026-0001",1,"s",0,1,100,20],[102,"F2026-0002",2,"s",0,1,1100,205.5],[103,"F2026-0003",3,"b",0,1,300,30,null,8],[104,"F2026-0004",4,"s",1,1,500,100],[301,"A2026-0001",11,"s",1,1,-50,-10,104],[105,"F2026-0005",5,"s",0,1,80,0],[106,"F2026-0006",6,"s",0,1,200,40],[107,"F2026-0007",7,"s",0,1,10,2],[108,"F2026-0008",8,"s",0,1,300,60],[109,"F2026-0009",9,"s",0,1,83.33,16.67],[302,"A2026-0002",14,"s",0,1,-0.83,-0.17,109],[110,"F2026-0010",10,"s",0,1,40,8],[111,"F2026-0011",11,"s",0,0,30,6],[303,"A2026-0003",12,"s",0,0,-5,-1,111],[112,"F2026-0012",11,"s",0,1,25,5],[113,"F2026-0013",12,"s",0,1,20,4],[114,"F2025-0001",-81,"s",0,1,50,10],[115,"F2026-0014",14,null,0,1,10,2],[116,"F2026-0015",14,"s",null,1,10,2],[117,"F2026-0016",14,"s",0,1,0,0],[118,"F2026-0017",15,"s",0,1,20,2.55],[119,"F2026-0018",15,"s",0,1,10,2],[304,"A2026-0004",17,"s",0,1,-10,-2,119],[120,"F2026-0019",24,"s",0,1,1000,200],[121,"F2026-0020",26,"s",0,1,100,20],[122,"F2026-0021",26,"s",0,1,10,2],[123,"F2026-0022",26,"s",0,1,20,2.55],[124,"F2026-0023",19,"s",0,1,200,40],[125,"F2026-0024",-9,"s",0,0,100,20],[126,"F2026-0025",19,"s",0,1,125,25],[127,"F2026-0026",-8,"s",0,0,50,0],[128,"F2026-0027",20,"s",0,1,50,10],[129,"F2026-0028",-7,"s",0,0,40,0],[130,"F2026-0029",21,"s",0,1,50,10],[131,"F2026-0030",-6,"s",0,0,40,0],[132,"F2026-0031",22,"s",0,1,50,0],[133,"F2026-0033",-5,"s",0,0,25,0],[134,"F2026-0032",-5,"s",0,0,25,0]],"l":[[101,1,1,100,20],[102,1,1,1000,20],[102,2,1,100,5.5],[103,1,2,150,10],[104,1,1,500,20],[301,1,-1,50,20],[105,1,1,80,0],[106,1,1,200,20],[107,1,1,10,20],[108,1,1,300,20],[109,1,1,83.33,20],[302,1,-1,0.83,20],[110,1,1,40,20],[111,1,1,30,20],[303,1,-1,5,20],[112,1,1,25,20],[113,1,1,20,20],[114,1,1,50,20],[115,1,1,10,20],[116,1,1,10,20],[118,1,1,10,20],[118,2,1,10,5.5],[119,1,1,10,20],[304,1,-1,10,20],[120,1,1,1000,20],[121,1,1,100,20],[122,1,1,10,20],[123,1,1,10,20],[123,2,1,10,5.5],[124,1,1,200,20],[125,1,1,100,20],[126,1,1,125,20],[127,1,1,50,0],[128,1,1,50,20],[129,1,1,40,0],[130,1,1,50,20],[131,1,1,40,0],[132,1,1,50,0],[133,1,1,25,0],[134,1,1,25,0]],"m":[[401,1,120,1],[402,19,1005.15,1],[403,8,230,1],[404,15,540,1],[405,16,240,1],[406,18,-240,1],[407,20,180,0],[408,21,60,1],[409,22,10,1],[410,8,0.02,1],[411,24,50,0],[412,15,300,1],[413,23,6,0],[414,22,60,1],[415,26,50,1],[416,26,295,1],[417,26,294.5,1],[418,26,97.5,1],[419,24,50,1],[420,27,359.5,1],[421,28,200,1],[422,28,100,1],[423,29,100,1],[424,29,100,1]],"e":[[501,101,1,120,"virement",401],[502,102,14,300,"especes",412],[503,102,17,1005.5,"virement",402],[504,103,5,100,"especes"],[505,103,8,230,"virement",403],[506,104,15,540,"virement",404],[507,105,7,80,"compensation",null,null,"467200"],[508,106,16,240,"virement",405],[509,106,17,-240,"virement",406,null,null,508],[510,106,18,12,"cheque"],[511,106,23,-12,"cheque",null,null,null,510],[512,107,8,0.02,"virement",410],[513,108,18,180,"virement",407],[514,108,19,50,"cheque",414,1],[515,109,10,33.33,"carte"],[516,109,11,33.33,"prelevement"],[517,109,14,32.34,"effet"],[518,110,11,24,"compensation"],[519,110,12,24,"autre",null,null,"411000"],[520,111,21,30,"virement",408],[521,112,21,30,"virement",408],[522,113,22,24,"virement",409],[523,114,-60,30,"compensation"],[524,114,-60,30,"cheque"],[525,118,15,12,"cheque"],[526,118,16,-12,"cheque",null,null,null,525],[527,119,17,12,"cheque"],[539,121,27,0.03,"virement"],[541,121,27,0.03,"virement"],[542,109,12,-33.33,"carte",null,null,null,515],[543,105,8,-80,"compensation",null,null,null,507],[544,111,23,6,"virement",413],[545,108,20,60,"virement",414],[546,108,20,40,"virement",414],[547,108,21,-40,"virement",null,null,null,546],[548,120,25,40,"virement",415],[549,120,25,300,"virement",416],[550,120,25,300,"virement",417],[551,120,25,100,"virement",418],[552,122,28,12,"cheque"],[553,122,27,-12,"cheque",null,null,null,552],[554,123,27,2,"cheque"],[555,123,28,-2,"cheque",null,null,null,554],[556,111,24,6,"virement",419],[557,111,25,-6,"virement",null,null,null,556],[558,120,24,50,"virement",419],[560,124,27,240,"virement",420],[561,125,25,120,"virement",420],[562,126,26,150,"cheque",421],[563,127,28,50,"virement",421],[564,128,28,60,"virement",422],[565,129,28,40,"virement",422],[566,130,29,60,"virement",423],[567,131,29,40,"virement",423],[568,132,29,50,"virement",424],[569,133,29,25,"virement",424],[570,134,29,25,"virement",424]],"p":[[501,20,120],[502,20,250],[502,5.5,50],[503,20,950],[503,5.5,55.5],[504,10,100],[505,10,230],[506,20,540],[507,0,80],[508,20,240],[509,20,-240],[510,20,12],[511,20,-12],[512,20,0.01],[513,20,180],[514,20,50],[515,20,33.33],[516,20,33.33],[517,20,32.34],[518,20,24],[519,20,24],[520,20,30],[521,20,30],[522,20,24],[523,20,30],[524,20,30],[525,20,12],[526,5.5,-12],[527,20,12],[539,20,0.03],[541,20,0.03],[542,20,-33.33],[543,0,-80],[544,20,6],[545,20,60],[546,20,40],[547,20,-40],[548,20,40],[549,20,300],[550,20,300],[551,20,100],[552,20,12],[553,20,-12],[554,20,1],[554,5.5,1],[555,20,-1.5],[555,5.5,-0.5],[556,20,6],[557,20,-6],[558,20,50],[560,20,240],[561,20,120],[562,20,150],[563,0,50],[564,20,60],[565,0,40],[566,20,60],[567,0,40],[568,0,50],[569,0,25],[570,0,25]],"x":[[601,125,1],[602,127,1],[603,131,0],[604,133,1],[605,133,1]]}$m$,
    'DK', $m$cross join (values (1, 0), (2, 1000)) d(n, k)$m$,
    'DN', $m$('5f4b0000-0000-4000-8000-0000000' || lpad(d.n::text, 5, '0'))::uuid$m$,
    'I0', $m$('5f4b0000-0000-4000-8000-0000000' || lpad(((x ->> 0)::int + d.k)::text, 5, '0'))::uuid$m$,
    'I8', $m$('5f4b0000-0000-4000-8000-0000000' || lpad(((x ->> 8)::int + d.k)::text, 5, '0'))::uuid$m$,
    'VUE', $m$select string_agg(s.x || ' : ' || (select case when min(v.r) = max(v.r) then min(v.r) else string_agg(v.r, ' / ' order by v.k) end from (select d.k, coalesce(a.motif || coalesce('(' || a.detail || ')', ''), (select string_agg(substr(j.jour, 6) || ' ' || j.l, ' ; ' order by j.jour) from (select left(u.l, 10) as jour, string_agg(rtrim(split_part(u.l, '|', 2), '0') || case split_part(u.l, '|', 3) when 'debit' then '+' else '-' end || split_part(u.l, '|', 4) || coalesce('@' || right(nullif(split_part(u.l, '|', 5), ''), 3), ''), ' ' order by u.o) as l from unnest(a.lignes) with ordinality u(l, o) group by 1) j), '∅') as r from (values (0), (1000)) d(k) cross join lateral ecriture_attendue_vente_facturee(('5f4b0000-0000-4000-8000-0000000' || lpad((1 + d.k / 1000)::text, 5, '0'))::uuid, case left(s.x, 1) when 'f' then 'facture' when 'a' then 'avoir' when 'e' then 'encaissement' else 'mouvement' end, ('5f4b0000-0000-4000-8000-0000000' || lpad((substr(s.x, 2)::int + d.k)::text, 5, '0'))::uuid) a) v), ' | ' order by s.o) from unnest($m$,
    'LIG', $m$(select string_agg(to_char(b.date, 'MM-DD') || ' ' || b.compte || case b.sens when 'debit' then '+' else '-' end || (b.montant * 100)::bigint || coalesce('@' || right(b.ligne_bancaire_id::text, 3), ''), ' ' order by b.date, b.compte, b.sens, b.montant) from ecritures_brouillon b where b.statut = 'proposee' and b.dossier_id = $m$,
    'PRO', $m$(select coalesce(jsonb_agg(jsonb_build_object('date', split_part(a, '|', 1), 'compte', split_part(a, '|', 2), 'sens', split_part(a, '|', 3), 'montant', round(split_part(a, '|', 4)::numeric / 100, 2), 'ligne_bancaire_id', nullif(split_part(a, '|', 5), ''), 'libelle', 'ESSAI')), '[]') from unnest((ecriture_attendue_vente_facturee($m$,
    'ORP', $m$)).lignes) a)$m$,
    'JWT', $m$select set_config('request.jwt.claims', '{"sub":"bd6bd047-0ef0-4c9d-a319-1b642aaf2162","role":"authenticated"}', true);$m$,
    'N', $m$select set_config('essai.n', $m$,
    'W', $m$ecrire_vente_facturee($m$,
    'W1', $m$select ecrire_vente_facturee('5f4b0000-0000-4000-8000-000000000001', '$m$,
    'WE', $m$select ecrire_vente_facturee('5f4b0000-0000-4000-8000-000000000001', 'encaissement', '5f4b0000-0000-4000-8000-000000000501', $m$,
    'R', $m$retirer_ecriture_vente_facturee($m$,
    'R1', $m$select retirer_ecriture_vente_facturee('5f4b0000-0000-4000-8000-000000000001', '$m$,
    'C', $m$choisir_compte_contrepartie($m$,
    'C1', $m$select choisir_compte_contrepartie('5f4b0000-0000-4000-8000-000000000001', '5f4b0000-0000-4000-8000-0000000$m$,
    'L402', $m$insert into ecritures_brouillon (dossier_id, ligne_bancaire_id, date, compte, libelle, montant, sens) values ('5f4b0000-0000-4000-8000-000000000001', '5f4b0000-0000-4000-8000-000000000402', '2026-03-20', '512000', 'ESSAI', 1, 'debit')$m$,
    'L411', $m$insert into ecritures_brouillon (dossier_id, ligne_bancaire_id, date, compte, libelle, montant, sens) values ('5f4b0000-0000-4000-8000-000000000001', '5f4b0000-0000-4000-8000-000000000411', '2026-03-25', '467000', 'ESSAI', 50, 'credit')$m$,
    'E110', $m$insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, compte_contrepartie) values ('5f4b0000-0000-4000-8000-000000000001', '5f4b0000-0000-4000-8000-000000000110', '2026-03-20', 1, 'compensation', '467100')$m$,
    'CBF', $m$ecrire_mouvement_compte_bilan('5f4b0000-0000-4000-8000-000000000401', '467000', '[{"compte":"512000","sens":"debit","montant":120},{"compte":"467000","sens":"credit","montant":120}]')$m$,
    'TRY', $m$do $t$ begin perform $m$,
    'YRT', $m$; perform set_config('essai.e', coalesce(current_setting('essai.e', true), '') || '|passé', true); exception when others then perform set_config('essai.e', coalesce(current_setting('essai.e', true), '') || '|' || sqlstate || ' ' || left(sqlerrm, 40), true); end $t$;$m$,
    'BAD', $m$'[{"date":"2026-03-02","compte":"512000","sens":"debit"$m$)
    || jsonb_build_object(
    'ACC', $m$Accès refusé à ce dossier.$m$,
    'GEN', $m$Une écriture de vente facturée a pour source une facture, un avoir, un encaissement ou un mouvement.$m$,
    'NBA', $m$Les factures de ce dossier ne sont pas la source de leurs ventes : aucune écriture de vente facturée ne s'y écrit.$m$,
    'ILL', $m$L'écriture proposée est illisible : une liste de lignes, chacune avec sa date, son compte, son sens, son montant positif au centime et son mouvement.$m$,
    'DIF', $m$L'écriture proposée n'est pas celle que la base recompose pour cette source : relire la source, puis la recomposer.$m$,
    'RIEN', $m$Cette source n'a rien à écrire : ses écritures, s'il y en a, se retirent.$m$,
    'FR5', $m$L'exercice 2025 est validé : aucune écriture ne s'y passe plus.$m$,
    'ECA', $m$ ne se compte pas sans deviner ($m$,
    'ECB', $m$) : ses écritures ne s'écrivent pas.$m$,
    'VF2', $m$Une écriture ne porte une facture ou un encaissement que par la fonction qui écrit la vente facturée.$m$,
    'INS', $m$Une écriture ne se passe sur un mouvement classé par ses encaissements que par la fonction qui écrit la vente facturée.$m$,
    'MOD', $m$Une écriture de vente facturée ne se modifie que par la fonction qui l'écrit.$m$,
    'CHF', $m$Le compte de contrepartie d'un encaissement ne se choisit que par la fonction du cabinet.$m$,
    'NAI', $m$Un encaissement ne naît pas avec un compte de contrepartie : le cabinet le choisit ensuite, par sa fonction.$m$,
    'BAN', $m$Un encaissement par la banque, par chèque ou en espèces se dit par son moyen de paiement, qui choisit son compte.$m$,
    'FOR', $m$Un compte de contrepartie est un compte de bilan, de classe 1 à 5, de six à dix chiffres.$m$,
    'AUC', $m$Cette source n'a aucune écriture proposée à retirer.$m$,
    'CLA', $m$Ce mouvement est classé par ses encaissements : il ne reçoit aucun autre classement — le cabinet retire d'abord celui-ci.$m$)
    -- R1 (130 à 139). Écrites EN CLAIR, sans marque : une marque se remplace dans l'ordre où jsonb range ses clés (les plus
    -- courtes d'abord), si bien qu'une marque glissée dans la valeur d'une autre ne se remplacerait pas toujours.
    -- PR1 : le mouvement 401 libéré qui porte encore les lignes d'une vente facturée — l'encaissement 501 écrit, le
    -- mouvement déclassé, l'encaissement déclaré puis contre-passé sans mouvement, la contre-passation écrite ([T]) ; puis
    -- deux lignes VALIDÉES posées sous le réglage de la validation : une de la facture 101 sur ce mouvement, que la
    -- composition ne pose jamais mais qu'une restauration peut porter, et une de l'encaissement 501. LPR : ses lignes
    -- propres ; LVF : ses lignes de vente facturée, avec leur statut.
    || jsonb_build_object(
    'PR1', $m$select set_config('request.jwt.claims', '{"sub":"bd6bd047-0ef0-4c9d-a319-1b642aaf2162","role":"authenticated"}', true);
    select ecrire_vente_facturee('5f4b0000-0000-4000-8000-000000000001', 'encaissement', '5f4b0000-0000-4000-8000-000000000501', (select coalesce(jsonb_agg(jsonb_build_object('date', split_part(a, '|', 1), 'compte', split_part(a, '|', 2), 'sens', split_part(a, '|', 3), 'montant', round(split_part(a, '|', 4)::numeric / 100, 2), 'ligne_bancaire_id', nullif(split_part(a, '|', 5), ''), 'libelle', 'ESSAI')), '[]') from unnest((ecriture_attendue_vente_facturee('5f4b0000-0000-4000-8000-000000000001', 'encaissement', '5f4b0000-0000-4000-8000-000000000501')).lignes) a));
    select retirer_classement_par_encaissements('5f4b0000-0000-4000-8000-000000000001', '5f4b0000-0000-4000-8000-000000000401');
    insert into transmissions_factures (dossier_id, facture_id, canal, hote, flux_id, sha256, etat) values ('5f4b0000-0000-4000-8000-000000000001', '5f4b0000-0000-4000-8000-000000000101', 'plateforme', 'p.fr', 'x', repeat('0', 64), 'accepte');
    insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values ('5f4b0000-0000-4000-8000-000000000001', '5f4b0000-0000-4000-8000-000000000501', '5f4b0000-0000-4000-8000-000000000101', 'manuel', 'p.fr', 'depose');
    select set_config('essai.cp', (select id from annuler_encaissement('5f4b0000-0000-4000-8000-000000000001', '5f4b0000-0000-4000-8000-000000000501', '2026-03-03', 'ESSAI', null))::text, true);
    select ecrire_vente_facturee('5f4b0000-0000-4000-8000-000000000001', 'encaissement', current_setting('essai.cp')::uuid, (select coalesce(jsonb_agg(jsonb_build_object('date', split_part(a, '|', 1), 'compte', split_part(a, '|', 2), 'sens', split_part(a, '|', 3), 'montant', round(split_part(a, '|', 4)::numeric / 100, 2), 'ligne_bancaire_id', nullif(split_part(a, '|', 5), ''), 'libelle', 'ESSAI')), '[]') from unnest((ecriture_attendue_vente_facturee('5f4b0000-0000-4000-8000-000000000001', 'encaissement', current_setting('essai.cp')::uuid)).lignes) a));
    select set_config('jd.validation_exercice', '5f4b0000-0000-4000-8000-000000000001', true);
    insert into ecritures_brouillon (dossier_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut, facture_id, encaissement_id, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib) values
      ('5f4b0000-0000-4000-8000-000000000001', '5f4b0000-0000-4000-8000-000000000401', '2026-03-04', '411000', 'ESSAI', 1, 'debit', 'validee', '5f4b0000-0000-4000-8000-000000000101', null, now(), 'VE', 901, 'R1', '2026-03-04', 'ESSAI'),
      ('5f4b0000-0000-4000-8000-000000000001', '5f4b0000-0000-4000-8000-000000000401', '2026-03-04', '512000', 'ESSAI', 0.5, 'debit', 'validee', null, '5f4b0000-0000-4000-8000-000000000501', now(), 'BQ', 902, 'R1', '2026-03-04', 'ESSAI');
    select set_config('jd.validation_exercice', '', true);$m$,
    'LPR', $m$coalesce((select string_agg(to_char(b.date, 'MM-DD') || ' ' || b.compte || case b.sens when 'debit' then '+' else '-' end || (b.montant * 100)::bigint, ' ' order by b.date, b.compte, b.sens, b.montant) from ecritures_brouillon b where b.ligne_bancaire_id = '5f4b0000-0000-4000-8000-000000000401' and b.facture_id is null and b.encaissement_id is null), '∅')$m$,
    'LVF', $m$(select string_agg(to_char(b.date, 'MM-DD') || ' ' || b.compte || case b.sens when 'debit' then '+' else '-' end || (b.montant * 100)::bigint || ' ' || b.statut || coalesce(' f' || right(b.facture_id::text, 3), '') || case when b.encaissement_id = '5f4b0000-0000-4000-8000-000000000501' then ' e501' when b.encaissement_id is not null then ' cp' else '' end, ' ' order by b.date, b.compte, b.sens, b.montant, b.statut) from ecritures_brouillon b where b.ligne_bancaire_id = '5f4b0000-0000-4000-8000-000000000401' and (b.facture_id is not null or b.encaissement_id is not null))$m$)
    -- Le virement mixte (étape VF5h). L420 : la banque de l'exemplaire 601 de la facture 125, qui n'est pas source, sur le
    -- mouvement 420 qu'il paie, à la date du mouvement — la ligne que l'application écrit pour toute pièce payée
    -- (src/lib/contrepartieBanque.ts). EXF et EXG : les deux moitiés du refus du rang 16, qui nomme la facture.
    || jsonb_build_object(
    'L420', $m$insert into ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens) values ('5f4b0000-0000-4000-8000-000000000001', '5f4b0000-0000-4000-8000-000000000601', '5f4b0000-0000-4000-8000-000000000420', '2026-03-28', '512000', 'ESSAI', 120, 'debit')$m$,
    'EXF', $m$Désignez d'abord l'exemplaire de la facture $m$,
    'EXG', $m$ : ce mouvement porte aussi son encaissement, et cette facture, qui n'est pas la source de sa vente, se compte par une seule pièce validée.$m$);

  foreach cle in array tables loop
    execute format('select count(*) from %I', cle) into n;
    avant := concat_ws('/', avant, n);
  end loop;

  -- Une étape : {genre, contrôle, qui, requête, code attendu, message attendu (exact, ou motif LIKE fini par « % ») ou valeur}.
  etapes := array[
  -- ══ Le jeu : trois dossiers, le jeu de R et G par la porte de la restauration, l'exercice 2025 de R validé ══════
  array['jeu', 'dossiers jetables', 'postgres', $q$insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures) values
    ('{D1}', 'ESSAI VF4B R', '{CAB}', 'tresorerie', '455000', true), ('{D2}', 'ESSAI VF4B G', '{CAB}', 'engagement', '455000', true),
    ('{D3}', 'ESSAI VF4B N', '{CAB}', 'tresorerie', '455000', false)$q$, '', ''],
  array['fait', '0. le jeu : les mouvements', 'chef', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, encaissements_de_factures)
    select {I0}, {DN}, date '2026-03-01' + (x ->> 1)::int, 'ESSAI',
           (x ->> 2)::numeric, case when x ->> 3 = '1' then 'rapprochee' else 'non_rapprochee' end, x ->> 3 = '1'
      from jsonb_array_elements('{JEU}'::jsonb -> 'm') x {DK};
    insert into lignes_bancaires (id, dossier_id, date, libelle, montant) values ('{U}02401', '{D3}', '2026-03-02', 'ESSAI', 120)$q$, 'OK', ''],
  array['fait', '0. le jeu : les factures et leurs lignes', 'chef', $q$insert into factures_emises (id, dossier_id, numero, statut, type, date_emission, tiers_nom, emetteur_siret, montant_ht, montant_tva, montant_ttc, validated_at, source_de_la_vente, nature_operation, option_debits, date_prestation, facture_origine_id)
    select {I0}, {DN}, x ->> 1, 'validee',
           case left(x ->> 1, 1) when 'A' then 'avoir' else 'facture' end, date '2026-03-01' + (x ->> 2)::int, 'ESSAI', '12345678900012',
           (x ->> 6)::numeric, (x ->> 7)::numeric, (x ->> 6)::numeric + (x ->> 7)::numeric, now(), x ->> 5 = '1',
           case x ->> 3 when 'b' then 'biens' when 's' then 'services' end, (x ->> 4)::int = 1, date '2026-03-01' + (x ->> 9)::int,
           {I8}
      from jsonb_array_elements('{JEU}'::jsonb -> 'f') x {DK} order by x ->> 8 is not null;
    insert into factures_emises (id, dossier_id, numero, statut, type, date_emission, tiers_nom, emetteur_siret, montant_ht, montant_tva, montant_ttc, validated_at, nature_operation, option_debits)
    values ('{U}02101', '{D3}', 'F2026-0001', 'validee', 'facture', '2026-03-02', 'ESSAI', '12345678900012', 100, 20, 120, now(), 'services', false);
    insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva)
    select {I0}, (x ->> 1)::int, 'ESSAI', (x ->> 2)::numeric, (x ->> 3)::numeric, (x ->> 4)::numeric
      from jsonb_array_elements('{JEU}'::jsonb -> 'l') x {DK}
    union all select '{U}02101', 1, 'ESSAI', 1, 100, 20$q$, 'OK', ''],
  array['fait', '0. le jeu : les encaissements et leurs parts', 'chef', $q$insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif, cree_le, retire_le, compte_contrepartie)
    select {I0}, {DN}, ('{U}' || lpad(((x ->> 1)::int + d.k)::text, 5, '0'))::uuid,
           date '2026-03-01' + (x ->> 2)::int, (x ->> 3)::numeric, x ->> 4, ('{U}' || lpad(((x ->> 5)::int + d.k)::text, 5, '0'))::uuid,
           {I8}, case when x ->> 8 is not null then 'ESSAI' end,
           (date '2026-03-01' + (x ->> 2)::int + time '10:00' + (x ->> 0)::int % 60 * interval '1 minute') at time zone 'UTC',
           case when x ->> 6 = '1' then (date '2026-03-01' + (x ->> 2)::int + time '12:00') at time zone 'UTC' end, x ->> 7
      from jsonb_array_elements('{JEU}'::jsonb -> 'e') x {DK} order by x ->> 8 is not null;
    insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id)
    values ('{U}02501', '{D3}', '{U}02101', '2026-03-02', 120, 'virement', '{U}02401');
    insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant)
    select {I0}, {DN}, (x ->> 1)::numeric, (x ->> 2)::numeric
      from jsonb_array_elements('{JEU}'::jsonb -> 'p') x {DK}
    union all select '{U}02501', '{D3}', 20, 120$q$, 'OK', ''],
  array['fait', '0. le jeu : les exemplaires des factures d''avant (VF5h)', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, facture_id)
    select {I0}, {DN}, {DN}::text || '/vf5h-' || (x ->> 0) || '.pdf', 'vf5h-' || (x ->> 0) || '.pdf', 'vente',
           case when x ->> 2 = '1' then 'validee' else 'a_valider' end, ('{U}' || lpad(((x ->> 1)::int + d.k)::text, 5, '0'))::uuid
      from jsonb_array_elements('{JEU}'::jsonb -> 'x') x {DK}$q$, 'OK', ''],
  array['fait', '0. le jeu : une écriture validée de 2025', 'chef', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, encaissement_id, valide_le, journal_code, numero_ecriture, piece_ref, piece_date, compte_lib)
    values ('{D1}', '2025-12-31', '511000', 'ESSAI', 30, 'debit', 'validee', '{U}00524', now(), 'VE', 1, 'F2025-0001', '2025-12-10', 'ESSAI')$q$, 'OK', ''],
  array['jeu', 'l''exercice 2025 validé dans R', 'postgres', $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit, total_credit, empreinte, declaration) values
    ('{D1}', 2025, now(), '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('a', 64), '{}')$q$, '', ''],
  array['retenir', '*', 'postgres', $q$select jsonb_object_agg(s.k, {PRO}s.d, s.g, s.i{ORP}::text)::text
    from (values ('PA', '{D1}'::uuid, 'encaissement', '{U}00501'::uuid), ('PB', '{D1}', 'mouvement', '{U}00402'), ('PC', '{D2}', 'facture', '{U}01103'),
                 ('PD', '{D1}', 'encaissement', '{U}00524'), ('PF', '{D1}', 'encaissement', '{U}00513'), ('PG', '{D2}', 'encaissement', '{U}01524'),
                 ('PH', '{D1}', 'mouvement', '{U}00420'), ('PI', '{D1}', 'mouvement', '{U}00421'), ('PJ', '{D1}', 'encaissement', '{U}00560')) s(k, d, g, i)$q$, '', ''],

  -- ══ 1 à 9. La recomposition : la base rend ce que le module compose ══════════
  array['valeur', '1. la règle du cumul, en entiers, comme le module', 'postgres', $q$select string_agg(prorata_arrondi(x.v, x.p, x.t)::text, ' ' order by x.o) from (values (1, 2000, 5000, 12000), (2, 2000, 6000, 12000), (3, -2000, 6000, 12000), (4, 1, 1, 2), (5, -1, 1, 2), (6, 1, 3, 2), (7, 3, 1, 2), (8, -3, 1, 2), (9, 0, 7, 9), (10, 7, 0, 9), (11, 1667, 3333, 10000), (12, 1667, 6666, 10000), (13, 1650, 9900, 9900), (14, 550, 1055, 10550), (15, 550, 5275, 10550), (16, -550, 5275, 10550), (17, 2000, 12001, 12000), (18, 2000, 11999, 12000), (19, 100, 1, 200), (20, 100, 3, 200), (21, 999999999999999, 999999999999999, 999999999999998), (22, 123456789012345, 98765432109, 999999999999999), (23, -123456789012345, 98765432109, 999999999999999), (24, 1, 999999999999999, 2000000000000000), (25, 1, 1000000000000000, 2000000000000000), (26, 5, 1, 10), (27, 15, 1, 10), (28, 25, 1, 10), (29, -25, 1, 10), (30, 833, 3333, 9999), (31, 999999999999997, 500000000000001, 999999999999998)) x(o, v, p, t)$q$, '',
    '833 1000 -1000 1 -1 2 2 -2 0 0 556 1111 1650 55 275 -275 2000 2000 1 2 1000000000000000 12193263114 -12193263114 0 1 1 2 3 -3 278 500000000000000'],
  -- attendu 2 : 501:20:12000:2000 502:20:25000:4167 502:5.5:5000:261 503:20:95000:15833 503:5.5:5550:289 504:10:10000:909 505:10:23000:2091 506:20:54000:9000 507:0:8000:0 508:20:24000:4000 509:20:-24000:-4000 510:20:1200:200 511:20:-1200:-200 513:20:18000:3000 515:20:3333:556 516:20:3333:555 517:20:3234:540 518:20:2400:400 519:20:2400:400 521:20:3000:500 522:20:2400:400 523:20:3000:500 524:20:3000:500 539:20:3:0 541:20:3:1 542:20:-3333:-556 543:0:-8000:0 545:20:6000:1000 546:20:4000:667 547:20:-4000:-667 548:20:4000:667 549:20:30000:5000 550:20:30000:5000 551:20:10000:1667 558:20:5000:833 560:20:24000:4000 562:20:15000:2500 564:20:6000:1000 566:20:6000:1000 568:0:5000:0
  array['valeur', '2. les parts du jeu, au centime du module', 'postgres', $q$select string_agg(right(c.encaissement_id::text, 3) || ':' || trim_scale(c.taux) || ':' || c.ttc_centimes || ':' || c.tva_centimes, ' ' order by c.encaissement_id, c.taux desc) from factures_emises f cross join lateral calcul_vente_facturee(f.id) c where f.dossier_id = '{D1}' and c.genre = 'part'$q$, '',
    'md5:da62f7e1e487479a80f79fd5dca1958f'],
  -- attendu 3 : f101 : ∅ / 03-02 411+12000 4458-2000 706-10000 | f102 : ∅ / 03-03 411+130550 4458-20550 706-110000 | f103 : 03-09 411+2091 44571-2091 / 03-04 411+33000 4458-3000 707-30000 ; 03-09 44571-2091 4458+2091 | f104 : 03-05 411+10000 44571-10000 / 03-05 411+60000 44571-10000 706-50000 | a301 : 03-12 411-1000 44571+1000 / 03-12 411-6000 44571+1000 706+5000 | f105 : ∅ / 03-06 411+8000 706-8000 | f106 : ∅ / 03-07 411+24000 4458-4000 706-20000 | f108 : ∅ / 03-09 411+36000 4458-6000 706-30000 | f109 : ∅ / 03-10 411+10000 4458-1667 706-8333 | a302 : ∅ / 03-15 411-100 4458+17 706+83 | f110 : ∅ / 03-11 411+4800 4458-800 706-4000 | f112 : ∅ / 03-12 411+3000 4458-500 706-2500 | f113 : ∅ / 03-13 411+2400 4458-400 706-2000 | f120 : ∅ / 03-25 411+120000 4458-20000 706-100000 | f121 : ∅ / 03-27 411+12000 4458-2000 706-10000
  array['valeur', '3. la facture et l''avoir', 'postgres', $q${VUE}'{f101,f102,f103,f104,a301,f105,f106,f108,f109,a302,f110,f112,f113,f120,f121}'::text[]) with ordinality s(x, o)$q$, '',
    'md5:1625e2c70f41aa89bf52e8878e097f18'],
  -- attendu 4 : e501 : 03-02 44571-2000 512+12000@401 706-10000 / 03-02 411-12000 44571-2000 4458+2000 512+12000@401 | e502 : 03-15 44571-4428 53+30000 706-25572 / 03-15 411-30000 44571-4428 4458+4428 53+30000 | e503 : 03-18 44571-16122 511+100550 706-84428 / 03-18 411-100550 44571-16122 4458+16122 511+100550 | e504 : 03-06 44571-909 53+10000 707-9091 / 03-06 411-10000 44571-909 4458+909 53+10000 | e505 : 03-09 411-2091 512+23000@403 707-20909 / 03-09 411-23000 512+23000@403 | e506 : 03-16 411-9000 512+54000@404 706-45000 / 03-16 411-54000 512+54000@404 | e507 : 03-08 4672+8000 706-8000 / 03-08 411-8000 4672+8000 | e521 : 03-22 44571-500 512+3000@408 706-2500 / 03-22 411-3000 44571-500 4458+500 512+3000@408 | e522 : 03-23 44571-400 512+2400@409 706-2000 / 03-23 411-2400 44571-400 4458+400 512+2400@409 | e548 : 03-26 44571-667 511+4000 706-3333 / 03-26 411-4000 44571-667 4458+667 511+4000 | e549 : 03-26 44571-5000 511+30000 706-25000 / 03-26 411-30000 44571-5000 4458+5000 511+30000 | e550 : 03-26 44571-5000 511+30000 706-25000 / 03-26 411-30000 44571-5000 4458+5000 511+30000 | e551 : 03-26 44571-1667 511+10000 706-8333 / 03-26 411-10000 44571-1667 4458+1667 511+10000 | e558 : 03-25 44571-833 512+5000@419 706-4167 / 03-25 411-5000 44571-833 4458+833 512+5000@419
  array['valeur', '4. l''encaissement et sa trésorerie', 'postgres', $q${VUE}'{e501,e502,e503,e504,e505,e506,e507,e521,e522,e548,e549,e550,e551,e558}'::text[]) with ordinality s(x, o)$q$, '',
    'md5:8f34afa89943bd92da4801c5b6173aba'],
  -- attendu 5 : e508 : 03-17 44571-4000 512+24000@405 706-20000 / 03-17 411-24000 44571-4000 4458+4000 512+24000@405 | e509 : 03-18 44571+4000 511-24000 706+20000 / 03-18 411+24000 44571+4000 4458-4000 511-24000 | e510 : 03-19 44571-200 511+1200 706-1000 / 03-19 411-1200 44571-200 4458+200 511+1200 | e511 : 03-24 44571+200 511-1200 706+1000 / 03-24 411+1200 44571+200 4458-200 511-1200 | e542 : 03-13 44571+556 511-3333 706+2777 / 03-13 411+3333 44571+556 4458-556 511-3333 | e543 : 03-09 4672-8000 706+8000 / 03-09 411+8000 4672-8000 | e547 : 03-22 44571+667 511-4000 706+3333 / 03-22 411+4000 44571+667 4458-667 511-4000
  array['valeur', '5. la contre-passation', 'postgres', $q${VUE}'{e508,e509,e510,e511,e542,e543,e547}'::text[]) with ordinality s(x, o)$q$, '',
    'md5:396cfd5037c52ea737dee51a70b83b86'],
  -- attendu 6 : m401 : ∅ | m402 : 03-20 511-100550@402 512+100515@402 627+35@402 | m403 : ∅ | m404 : ∅ | m405 : ∅ | m406 : 03-19 511+24000@406 512-24000@406 | m412 : 03-16 512+30000@412 53-30000@412 | m414 : 03-23 511-6000@414 512+6000@414 | m415 : mouvement_ecart | m416 : 03-27 511-30000@416 512+29500@416 627+500@416 | m417 : mouvement_ecart | m418 : mouvement_ecart | m419 : ∅
  array['valeur', '6. le mouvement', 'postgres', $q${VUE}'{m401,m402,m403,m404,m405,m406,m412,m414,m415,m416,m417,m418,m419}'::text[]) with ordinality s(x, o)$q$, '',
    'md5:6e265597418e734525721f8bb0c07ff2'],
  -- attendu 6b : f124 : ∅ / 03-20 411+24000 4458-4000 706-20000 | f125 : ∅ | f126 : ∅ / 03-20 411+15000 4458-2500 706-12500 | f127 : ∅ | f128 : ∅ / 03-21 411+6000 4458-1000 706-5000 | f129 : ∅ | f130 : ∅ / 03-22 411+6000 4458-1000 706-5000 | f131 : ∅ | f132 : ∅ / 03-23 411+5000 706-5000 | f133 : ∅ | f134 : ∅ | e560 : 03-28 44571-4000 512+24000@420 706-20000 / 03-28 411-24000 44571-4000 4458+4000 512+24000@420 | e561 : ∅ | e562 : 03-27 44571-2500 511+15000 706-12500 / 03-27 411-15000 44571-2500 4458+2500 511+15000 | e563 : ∅ | e564 : 03-29 44571-1000 512+6000@422 706-5000 / 03-29 411-6000 44571-1000 4458+1000 512+6000@422 | e565 : ∅ | e566 : 03-30 44571-1000 512+6000@423 706-5000 / 03-30 411-6000 44571-1000 4458+1000 512+6000@423 | e567 : ∅ | e568 : 03-30 512+5000@424 706-5000 / 03-30 411-5000 512+5000@424 | e569 : ∅ | e570 : ∅ | m420 : 03-28 512-50@420 627+50@420 | m421 : 03-29 511-15000@421 512+15000@421 | m422 : mouvement_facture_non_source(F2026-0028) | m423 : mouvement_facture_non_source(F2026-0030) | m424 : mouvement_facture_non_source(F2026-0032)
  array['valeur', '6b. le virement mixte : la part des sources et les frais du tout, ou la facture d''avant nommée', 'postgres', $q${VUE}'{f124,f125,f126,f127,f128,f129,f130,f131,f132,f133,f134,e560,e561,e562,e563,e564,e565,e566,e567,e568,e569,e570,m420,m421,m422,m423,m424}'::text[]) with ordinality s(x, o)$q$, '',
    'md5:cb9f7250c04121eb3170ea9dfcf30cfe'],
  -- attendu 7 : e513 : 03-19 44571-3000 511+18000 706-15000 / 03-19 411-18000 44571-3000 4458+3000 511+18000 | e514 : ∅ | e515 : 03-11 44571-556 511+3333 706-2777 / 03-11 411-3333 44571-556 4458+556 511+3333 | e516 : 03-12 44571-555 511+3333 706-2778 / 03-12 411-3333 44571-555 4458+555 511+3333 | e517 : 03-15 44571-540 511+3234 706-2694 / 03-15 411-3234 44571-540 4458+540 511+3234 | e545 : 03-21 44571-1000 511+6000 706-5000 / 03-21 411-6000 44571-1000 4458+1000 511+6000 | e546 : 03-21 44571-667 511+4000 706-3333 / 03-21 411-4000 44571-667 4458+667 511+4000 | e539 : 03-28 511+3 706-3 / 03-28 411-3 511+3 | e541 : 03-28 44571-1 511+3 706-2 / 03-28 411-3 44571-1 4458+1 511+3
  array['valeur', '7. le paiement partiel, le retrait, le cumul', 'postgres', $q${VUE}'{e513,e514,e515,e516,e517,e545,e546,e539,e541}'::text[]) with ordinality s(x, o)$q$, '',
    'md5:280fb99a1bca55ae1dbd097fd4a84e93'],
  -- attendu 8 : f107 : vente_ecartee(encaissement_illisible) | e512 : vente_ecartee(encaissement_illisible) | m410 : mouvement_vente_ecartee | e518 : compte_a_choisir | e519 : compte_refuse(411000) | m407 : mouvement_non_classe | m408 : mouvement_facture_non_source(F2026-0011) | m409 : mouvement_ecart | f111 : ∅ | a303 : ∅ | e520 : ∅ | m411 : ∅ | m413 : ∅ | e544 : ∅ | e556 : ∅ | e557 : ∅
  array['valeur', '8. ce qui ne s''écrit pas, et pourquoi', 'postgres', $q${VUE}'{f107,e512,m410,e518,e519,m407,m408,m409,f111,a303,e520,m411,m413,e544,e556,e557}'::text[]) with ordinality s(x, o)$q$, '',
    'md5:d252bf0ac2ac926f3897dc8c6031ab40'],
  -- attendu 9 : f114 : ∅ / 12-10 411+6000 4458-1000 706-5000 | e523 : compte_a_choisir | e524 : 12-31 44571-500 511+3000 706-2500 / 12-31 411-3000 44571-500 4458+500 511+3000 | f115 : vente_ecartee(nature) | f116 : vente_ecartee(option_debits) | f117 : vente_ecartee(sans_lignes) | f118 : vente_ecartee(contre_passation_illisible) | e525 : vente_ecartee(contre_passation_illisible) | e526 : vente_ecartee(contre_passation_illisible) | f119 : vente_ecartee(ttc_nul) | a304 : vente_ecartee(ttc_nul) | e527 : vente_ecartee(ttc_nul) | f122 : vente_ecartee(contre_passation_illisible) | e552 : vente_ecartee(contre_passation_illisible) | e553 : vente_ecartee(contre_passation_illisible) | f123 : vente_ecartee(contre_passation_illisible) | e554 : vente_ecartee(contre_passation_illisible) | e555 : vente_ecartee(contre_passation_illisible)
  array['valeur', '9. l''exercice 2025, une vente écartée par motif', 'postgres', $q${VUE}'{f114,e523,e524,f115,f116,f117,f118,e525,e526,f119,a304,e527,f122,e552,e553,f123,e554,e555}'::text[]) with ordinality s(x, o)$q$, '',
    'md5:3848a624c9cdb13a8aa38f463f522ff4'],
  array['valeur', '9b. un dossier qui n''a pas basculé : rien', 'postgres', $q$select string_agg(s.g || ':' || coalesce(a.motif, '') || cardinality(a.lignes), ' ' order by s.g) from (values ('facture', '{U}02101'), ('encaissement', '{U}02501'), ('mouvement', '{U}02401')) s(g, i) cross join lateral ecriture_attendue_vente_facturee('{D3}', s.g, s.i::uuid) a$q$, '',
    'encaissement:0 facture:0 mouvement:0'],
  -- LA RECOMPOSITION D'UN BLOC (étape VF7b0, migration `validation_des_ventes_facturees`) : chaque source du jeu, sur toute son
  -- histoire, rend recomposée d'un bloc ce que `ecriture_attendue_vente_facturee` rend pour elle (motif, détail, lignes).
  array['valeur', '9c. la recomposition d''un bloc (étape VF7b0) : chaque source des trois dossiers rend ce que la composition rend', 'postgres', $q$select count(*) || ' sources, ' || count(*) filter (where (b.motif, b.detail, b.lignes) is distinct from (c.motif, c.detail, c.lignes)) || ' écart(s)' from (values ('{D1}'::uuid), ('{D2}'::uuid), ('{D3}'::uuid)) z(d) cross join lateral ecritures_attendues_de_la_periode(z.d, null, '9999-12-31') b cross join lateral ecriture_attendue_vente_facturee(z.d, b.genre, b.source_id) c$q$, '',
    '198 sources, 0 écart(s)'],

  -- ══ 10 à 19. Écrire, et remplacer d'un tenant ══════════
  array['lecture', '10. un encaissement s''écrit ; le réglage retiré', 'chef', $q${N}{W}'{D1}', 'encaissement', '{U}00501', '{PA}')::text, true); select current_setting('essai.n') || '|' || coalesce(nullif(current_setting('jd.ecriture_vente_facturee', true), ''), 'retiré') || '|' || {LIG}'{D1}' and b.encaissement_id = '{U}00501' and b.facture_id is null and b.libelle = 'ESSAI')$q$, '',
    '3|retiré|03-02 445710-2000 03-02 512000+12000@401 03-02 706000-10000'],
  array['lecture', '11. réécrit, il remplace ses lignes', 'chef', $q${WE}'{PA}'); {N}{W}'{D1}', 'encaissement', '{U}00501', '{PA}')::text, true); select current_setting('essai.n') || '|' || (select count(*) from ecritures_brouillon where encaissement_id = '{U}00501')$q$, '', '3|3'],
  array['lecture', '12. émission et livraison d''un bien, d''un tenant', 'chef', $q$select {W}'{D2}', 'facture', '{U}01103', '{PC}'); select {LIG}'{D2}' and b.facture_id = '{U}01103' and b.encaissement_id is null)$q$, '',
    '03-04 411000+33000 03-04 445800-3000 03-04 707000-30000 03-09 445710-2091 03-09 445800+2091'],
  array['lecture', '13. un avoir du jour de la livraison : la facture réécrite ; l''avoir écrit', 'postgres', $q${JWT} {W1}facture', '{U}00103', {PRO}'{D1}', 'facture', '{U}00103'{ORP});
    insert into factures_emises (id, dossier_id, numero, statut, type, date_emission, tiers_nom, emetteur_siret, montant_ht, montant_tva, montant_ttc, validated_at, source_de_la_vente, nature_operation, option_debits, date_prestation, facture_origine_id)
    values ('{X}', '{D1}', 'A2026-0005', 'validee', 'avoir', '2026-03-09', 'ESSAI', '12345678900012', -10, -1, -11, now(), true, 'biens', false, '2026-03-09', '{U}00103');
    insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva) values ('{X}', 1, 'ESSAI', -1, 10, 10);
    {W1}facture', '{U}00103', {PRO}'{D1}', 'facture', '{U}00103'{ORP}); {W1}avoir', '{U}00301', {PRO}'{D1}', 'avoir', '{U}00301'{ORP});
    select {LIG}'{D1}' and b.facture_id = '{U}00103') || '|' || cardinality((ecriture_attendue_vente_facturee('{D1}', 'avoir', '{X}')).lignes) || '|' || {LIG}'{D1}' and b.facture_id = '{U}00301')$q$, '',
    '03-09 411000+1991 03-09 445710-1991|0|03-12 411000-1000 03-12 445710+1000'],
  array['lecture', '14. un mouvement : banque, valeurs à l''encaissement, frais', 'chef', $q${W1}mouvement', '{U}00402', '{PB}'); select {LIG}'{D1}' and b.ligne_bancaire_id = '{U}00402' and b.facture_id is null and b.encaissement_id is null)$q$, '',
    '03-20 511000-100550@402 03-20 512000+100515@402 03-20 627000+35@402'],
  array['lecture', '14b. le virement mixte : la banque de ce que la source du jour et l''exemplaire n''ont pas porté, et les frais du tout', 'chef', $q${W1}mouvement', '{U}00420', '{PH}'); select {LIG}'{D1}' and b.ligne_bancaire_id = '{U}00420' and b.facture_id is null and b.encaissement_id is null and b.piece_id is null)$q$, '',
    '03-28 512000-50@420 03-28 627000+50@420'],
  array['lecture', '14c. … le 511 d''un chèque d''un autre jour, sans frais', 'chef', $q${W1}mouvement', '{U}00421', '{PI}'); select {LIG}'{D1}' and b.ligne_bancaire_id = '{U}00421' and b.facture_id is null and b.encaissement_id is null and b.piece_id is null)$q$, '',
    '03-29 511000-15000@421 03-29 512000+15000@421'],
  array['lecture', '14d. … l''encaissement de la source, l''exemplaire et le mouvement : la banque fait le crédit', 'chef', $q$select {W}'{D1}', 'encaissement', '{U}00560', '{PJ}'); {W1}mouvement', '{U}00420', '{PH}'); {L420};
    select (sum(case b.sens when 'debit' then b.montant else -b.montant end) * 100)::bigint || '|' || count(*) || '|' || (select (montant * 100)::bigint from lignes_bancaires where id = '{U}00420')
      from ecritures_brouillon b where b.ligne_bancaire_id = '{U}00420' and b.compte = '512000'$q$, '',
    '35950|3|35950'],
  array['controle', '15. un autre ordre, d''autres libellés', 'chef', $q${WE}(select jsonb_agg(x || '{"libelle": "AUTRE"}' order by o desc) from jsonb_array_elements('{PA}') with ordinality t(x, o)))$q$, 'OK', ''],
  array['controle', '16. le membre affecté au dossier écrit', 'membre', $q${WE}'{PA}')$q$, 'OK', ''],
  array['controle', '17. le chef simple écrit', 'chef_simple', $q$select {W}'{D2}', 'facture', '{U}01103', '{PC}')$q$, 'OK', ''],
  array['fait', '19. le jeu : trois sources écrites', 'chef', $q${WE}'{PA}'); select {W}'{D2}', 'facture', '{U}01103', '{PC}'); {W1}mouvement', '{U}00402', '{PB}')$q$, 'OK', ''],

  -- ══ 20 à 52. Écrire : les refus, à leur rang ══════════
  array['controle', '20. rang 1 : le client « Ventes » et « Banque »', 'client_vb', $q${WE}'{PA}')$q$, '42501', '{ACC}'],
  array['controle', '22. … l''anonyme', 'anon', $q${WE}'{PA}')$q$, '42501', 'permission denied for function ecrire_vente_facturee'],
  array['controle', '23. … un dossier qui n''existe pas', 'chef', $q$select {W}'{X}', 'encaissement', '{U}00501', '{PA}')$q$, '42501', '{ACC}'],
  array['controle', '24. … le dossier d''à côté', 'membre', $q$select {W}'{D2}', 'facture', '{U}01103', '{PC}')$q$, '42501', '{ACC}'],
  array['controle', '25. l''accès avant le genre', 'client_vb', $q${W1}piece', '{U}00501', '[]')$q$, '42501', '{ACC}'],
  array['controle', '26. rang 2 : un genre inconnu', 'chef', $q${W1}piece', '{U}00501', '[]')$q$, '22023', '{GEN}'],
  array['controle', '27. … nul', 'chef', $q$select {W}'{D1}', null, '{U}00501', '[]')$q$, '22023', '{GEN}'],
  array['controle', '28. rang 3 : un dossier qui n''a pas basculé', 'chef', $q$select {W}'{D3}', 'facture', '{U}02101', '[]')$q$, '22023', '{NBA}'],
  array['controle', '29. le genre avant le réglage', 'chef', $q$select {W}'{D3}', 'piece', '{U}02101', '[]')$q$, '22023', '{GEN}'],
  array['controle', '30. le réglage avant la source', 'chef', $q$select {W}'{D3}', 'facture', '{X}', '[]')$q$, '22023', '{NBA}'],
  array['controle', '31. rang 4 : la facture d''un autre dossier', 'chef', $q${W1}facture', '{U}01101', '[]')$q$, 'P0002', 'Facture introuvable dans ce dossier.'],
  array['controle', '32. … un avoir', 'chef', $q${W1}facture', '{U}00301', '[]')$q$, 'P0002', 'Facture introuvable dans ce dossier.'],
  array['controle', '33. rang 5 : une facture pour un avoir', 'chef', $q${W1}avoir', '{U}00101', '[]')$q$, 'P0002', 'Avoir introuvable dans ce dossier.'],
  array['controle', '34. rang 6 : l''encaissement d''un autre dossier', 'chef', $q${W1}encaissement', '{U}01501', '[]')$q$, 'P0002', 'Encaissement introuvable dans ce dossier.'],
  array['controle', '35. rang 7 : le mouvement d''un autre dossier', 'chef', $q${W1}mouvement', '{U}01402', '[]')$q$, 'P0002', 'Mouvement introuvable dans ce dossier.'],
  array['controle', '36. rang 8 : une facture d''avant la bascule', 'chef', $q${W1}facture', '{U}00111', '[]')$q$, '22023', 'Cette facture n''est pas la source de sa vente : elle se compte par sa pièce, sans écriture de vente facturée.'],
  array['controle', '37. rang 9 : son avoir', 'chef', $q${W1}avoir', '{U}00303', '[]')$q$, '22023', 'Cet avoir n''est pas la source de sa vente : il se compte par sa pièce, sans écriture de vente facturée.'],
  array['controle', '38. rang 10 : son encaissement', 'chef', $q${W1}encaissement', '{U}00520', '[]')$q$, '22023', 'Cet encaissement est celui d''une facture qui n''est pas la source de sa vente : il n''a pas d''écriture de vente facturée.'],
  array['controle', '39. rang 11 : un mouvement cité par une facture non source', 'chef', $q${W1}mouvement', '{U}00413', '[]')$q$, '22023', 'Ce mouvement ne justifie aucun encaissement d''une facture source de sa vente : il n''a pas d''écriture de vente facturée.'],
  array['controle', '40. la source avant les lignes', 'chef', $q${W1}mouvement', '{U}00411', '{}')$q$, '22023', 'Ce mouvement ne justifie aucun encaissement%'],
  array['controle', '41a. rang 12 : un objet', 'chef', $q${WE}'{}')$q$, '22023', '{ILL}'],
  array['controle', '41b. … rien', 'chef', $q${WE}null)$q$, '22023', '{ILL}'],
  array['controle', '41c. … une ligne qui n''est pas un objet', 'chef', $q${WE}'[1]')$q$, '22023', '{ILL}'],
  array['controle', '41d. … sans date', 'chef', $q${WE}'[{"compte":"512000","sens":"debit","montant":1}]')$q$, '22023', '{ILL}'],
  array['controle', '41e. … un compte en nombre', 'chef', $q${WE}'[{"date":"2026-03-02","compte":512000,"sens":"debit","montant":1}]')$q$, '22023', '{ILL}'],
  array['controle', '41f. … un sens inconnu', 'chef', $q${WE}'[{"date":"2026-03-02","compte":"512000","sens":"D","montant":1}]')$q$, '22023', '{ILL}'],
  array['controle', '41g. … un montant en texte', 'chef', $q${WE}{BAD},"montant":"1"}]')$q$, '22023', '{ILL}'],
  array['controle', '41h. … un mouvement en nombre', 'chef', $q${WE}{BAD},"montant":1,"ligne_bancaire_id":5}]')$q$, '22023', '{ILL}'],
  array['controle', '41i. … un libellé en nombre', 'chef', $q${WE}{BAD},"montant":1,"libelle":5}]')$q$, '22023', '{ILL}'],
  array['controle', '41j. … un montant nul', 'chef', $q${WE}{BAD},"montant":0}]')$q$, '22023', '{ILL}'],
  array['controle', '41l. … au-delà du centime', 'chef', $q${WE}{BAD},"montant":1.001}]')$q$, '22023', '{ILL}'],
  array['controle', '41m. … une date mal écrite', 'chef', $q${WE}'[{"date":"2026-3-2","compte":"512000","sens":"debit","montant":1}]')$q$, '22023', '{ILL}'],
  array['controle', '41n. … une date qui n''existe pas', 'chef', $q${WE}'[{"date":"2026-02-30","compte":"512000","sens":"debit","montant":1}]')$q$, '22023', '{ILL}'],
  array['controle', '42. les lignes avant la vente écartée', 'chef', $q${W1}encaissement', '{U}00512', '{}')$q$, '22023', '{ILL}'],
  array['controle', '43a. rang 13 : une vente écartée — un encaissement illisible', 'chef', $q${W1}facture', '{U}00107', '[]')$q$, '22023', 'La facture F2026-0007{ECA}un encaissement ne se répartit pas sur les taux de la facture, au centime, pour son montant : la règle du cumul ne s''y applique pas{ECB}'],
  array['controle', '43b. … pour son encaissement aussi', 'chef', $q${W1}encaissement', '{U}00512', '[]')$q$, '22023', 'La facture F2026-0007{ECA}un encaissement ne se répartit pas sur les taux de la facture, au centime, pour son montant : la règle du cumul ne s''y applique pas{ECB}'],
  array['controle', '43c. … la nature', 'chef', $q${W1}facture', '{U}00115', '[]')$q$, '22023', 'La facture F2026-0014{ECA}la facture ne dit pas si elle porte sur des biens ou sur des services : on ne sait ni quand sa TVA est due, ni où la compter{ECB}'],
  array['controle', '43d. … l''option pour les débits', 'chef', $q${W1}facture', '{U}00116', '[]')$q$, '22023', 'La facture F2026-0015{ECA}la facture ne porte pas l''option pour les débits que sa validation fige : on ne sait pas quand sa TVA est due{ECB}'],
  array['controle', '43e. … aucune ligne', 'chef', $q${W1}facture', '{U}00117', '[]')$q$, '22023', 'La facture F2026-0016{ECA}la facture n''a aucune ligne : son TTC par taux est inconnu{ECB}'],
  array['controle', '43f. … une contre-passation', 'chef', $q${W1}encaissement', '{U}00526', '[]')$q$, '22023', 'La facture F2026-0017{ECA}une contre-passation n''est pas l''exact opposé d''un encaissement compté avant elle{ECB}'],
  array['controle', '43g. … un avoir qui annule le taux', 'chef', $q${W1}avoir', '{U}00304', '[]')$q$, '22023', 'La facture F2026-0018{ECA}ses avoirs datés au plus tard du jour d''un encaissement annulent le taux de cet encaissement : la règle du cumul n''a plus de TTC à répartir{ECB}'],
  array['controle', '44. rang 14 : une compensation sans compte', 'chef', $q${W1}encaissement', '{U}00518', '[]')$q$, '22023', 'Cet encaissement s''écrit sur un compte de contrepartie que le cabinet choisit, et il n''est pas encore choisi.'],
  array['controle', '45. rang 15 : son compte refusé', 'chef', $q${W1}encaissement', '{U}00519', '[]')$q$, '22023', 'Le compte de contrepartie de cet encaissement, 411000, est refusé : Le compte des clients est celui que l’encaissement solde : il n’en est pas la contrepartie.'],
  array['controle', '46. rang 16 : une facture non source sur le mouvement, sans exemplaire', 'chef', $q${W1}mouvement', '{U}00408', '[]')$q$, '22023', '{EXF}F2026-0011{EXG}'],
  array['controle', '46b. … la facture au plus petit numéro : F134 (F2026-0032) avant F133, que son identifiant précède', 'chef', $q${W1}mouvement', '{U}00424', '[]')$q$, '22023', '{EXF}F2026-0032{EXG}'],
  array['controle', '46c. … un exemplaire à valider ne suffit pas', 'chef', $q${W1}mouvement', '{U}00423', '[]')$q$, '22023', '{EXF}F2026-0030{EXG}'],
  array['controle', '46d. … deux exemplaires validés non plus : F134 désigné, F133 nommé', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, facture_id) values ('{X}', '{D1}', '{D1}/vf5h-x.pdf', 'vf5h-x.pdf', 'vente', 'validee', '{U}00134'); {W1}mouvement', '{U}00424', '[]')$q$, '22023', '{EXF}F2026-0033{EXG}'],
  array['controle', '47. rang 17 : … une vente écartée', 'chef', $q${W1}mouvement', '{U}00410', '[]')$q$, '22023', 'Ce mouvement porte l''encaissement d''une facture que les ventes facturées écartent : il ne s''écrit pas.'],
  array['controle', '48. rang 18 : pas encore classé', 'chef', $q${W1}mouvement', '{U}00407', '[]')$q$, '22023', 'Ce mouvement n''est pas encore classé par ses encaissements : son écriture attend ce classement.'],
  array['controle', '49. rang 19 : au-delà des frais', 'chef', $q${W1}mouvement', '{U}00409', '[]')$q$, '22023', 'Les encaissements que ce mouvement porte ne font pas son montant à l''écart des frais près : il ne s''écrit pas.'],
  array['controle', '50a. rang 20 : une écriture de l''exercice validé', 'chef', $q${W1}encaissement', '{U}00524', '{PD}')$q$, '22023', '{FR5}'],
  array['controle', '50b. … une ligne de cette date', 'chef', $q${WE}jsonb_set('{PA}', '{0,date}', '"2025-12-31"'))$q$, '22023', '{FR5}'],
  array['controle', '51a. rang 21 : rien après la frontière', 'chef', $q${W1}encaissement', '{U}00524', '[]')$q$, '22023', '{RIEN}'],
  array['controle', '51b. … déclassé, du jour de ses encaissements', 'chef', $q$select retirer_classement_par_encaissements('{D1}', '{U}00401'); {W1}mouvement', '{U}00401', '[]')$q$, '22023', '{RIEN}'],
  array['controle', '51c. … un encaissement retiré', 'chef', $q${W1}encaissement', '{U}00514', '[]')$q$, '22023', '{RIEN}'],
  array['controle', '51d. … une facture de services en trésorerie', 'chef', $q${W1}facture', '{U}00101', '[]')$q$, '22023', '{RIEN}'],
  array['controle', '52a. rang 22 : une ligne de moins', 'chef', $q${WE}'{PA}'::jsonb - 0)$q$, '22023', '{DIF}'],
  array['controle', '52b. … de trop', 'chef', $q${WE}'{PA}'::jsonb || ('{PA}'::jsonb -> 0))$q$, '22023', '{DIF}'],
  array['controle', '52c. … un centime de plus', 'chef', $q${WE}jsonb_set('{PA}', '{0,montant}', '20.01'))$q$, '22023', '{DIF}'],
  array['controle', '52d. … un autre compte', 'chef', $q${WE}jsonb_set('{PA}', '{0,compte}', '"445711"'))$q$, '22023', '{DIF}'],
  array['controle', '52e. … un autre jour', 'chef', $q${WE}jsonb_set('{PA}', '{0,date}', '"2026-03-03"'))$q$, '22023', '{DIF}'],
  array['controle', '52f. … l''autre sens', 'chef', $q${WE}jsonb_set('{PA}', '{0,sens}', '"debit"'))$q$, '22023', '{DIF}'],
  array['controle', '52g. … la banque sans son mouvement', 'chef', $q${WE}jsonb_set('{PA}', '{1,ligne_bancaire_id}', 'null'))$q$, '22023', '{DIF}'],
  array['controle', '52h. … un mouvement de trop', 'chef', $q${WE}jsonb_set('{PA}', '{0,ligne_bancaire_id}', '"{U}00401"'))$q$, '22023', '{DIF}'],
  array['controle', '52i. … aucune ligne', 'chef', $q${WE}'[]')$q$, '22023', '{DIF}'],
  array['controle', '52j. … les lignes d''une autre source', 'chef', $q${W1}encaissement', '{U}00521', '{PA}')$q$, '22023', '{DIF}'],

  -- ══ 53 à 59. Le virement mixte (VF5h) : déclassé, le mouvement se classe de nouveau avec l'exemplaire unique et validé
  -- de la facture d'avant, et le classement nomme sinon la facture au plus petit numéro, comme la composition (53 à 57) ;
  -- déclassé, l'encaissement de la facture d'avant retiré ou défait sans mouvement ne retient plus la composition, qui
  -- dit le mouvement à classer (58, 59 ; le propriétaire, sous le jeton du chef, comme en 95) ══════════
  array['lecture', '53. le virement mixte se classe : la source du jour et la facture d''avant, son exemplaire désigné', 'chef', $q$select retirer_classement_par_encaissements('{D1}', '{U}00420'); select concat_ws('|', l.statut, l.encaissements_de_factures::text) from classer_mouvement_par_encaissements('{D1}', '{U}00420') l$q$, '',
    'rapprochee|true'],
  array['controle', '54. le classement nomme la facture au plus petit numéro : F134 (F2026-0032) avant F133', 'chef', $q$select retirer_classement_par_encaissements('{D1}', '{U}00424'); select classer_mouvement_par_encaissements('{D1}', '{U}00424')$q$, '22023', '{EXF}F2026-0032{EXG}'],
  array['controle', '55. … deux exemplaires validés ne suffisent pas : F134 désigné, F133 nommé', 'chef', $q$insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, facture_id) values ('{X}', '{D1}', '{D1}/vf5h-x.pdf', 'vf5h-x.pdf', 'vente', 'validee', '{U}00134'); select retirer_classement_par_encaissements('{D1}', '{U}00424'); select classer_mouvement_par_encaissements('{D1}', '{U}00424')$q$, '22023', '{EXF}F2026-0033{EXG}'],
  array['controle', '56. … un exemplaire à valider non plus', 'chef', $q$select retirer_classement_par_encaissements('{D1}', '{U}00423'); select classer_mouvement_par_encaissements('{D1}', '{U}00423')$q$, '22023', '{EXF}F2026-0030{EXG}'],
  array['controle', '57. … ni aucun exemplaire', 'chef', $q$select retirer_classement_par_encaissements('{D1}', '{U}00422'); select classer_mouvement_par_encaissements('{D1}', '{U}00422')$q$, '22023', '{EXF}F2026-0028{EXG}'],
  array['lecture', '58. déclassé, l''encaissement de la facture d''avant retiré : la composition ne le compte plus', 'postgres', $q${JWT} select retirer_classement_par_encaissements('{D1}', '{U}00422'); select retirer_encaissement('{D1}', '{U}00565');
    select coalesce((ecriture_attendue_vente_facturee('{D1}', 'mouvement', '{U}00422')).motif, '-')$q$, '',
    'mouvement_non_classe'],
  array['lecture', '59. … défait par sa contre-passation sans mouvement, non plus', 'postgres', $q${JWT} select retirer_classement_par_encaissements('{D1}', '{U}00422');
    insert into transmissions_factures (dossier_id, facture_id, canal, hote, flux_id, sha256, etat) values ('{D1}', '{U}00129', 'plateforme', 'p.fr', 'x', repeat('0', 64), 'accepte');
    insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values ('{D1}', '{U}00565', '{U}00129', 'manuel', 'p.fr', 'depose');
    select annuler_encaissement('{D1}', '{U}00565', '2026-03-30', 'ESSAI', null);
    select coalesce((ecriture_attendue_vente_facturee('{D1}', 'mouvement', '{U}00422')).motif, '-')$q$, '',
    'mouvement_non_classe'],

  -- ══ 60 à 69. Retirer ══════════
  array['controle', '60. rang 1 : le client', 'client_vb', $q${R1}encaissement', '{U}00501')$q$, '42501', '{ACC}'],
  array['controle', '61. rang 2 : un genre inconnu', 'chef', $q${R1}piece', '{U}00501')$q$, '22023', '{GEN}'],
  array['controle', '62. rang 3 : un dossier qui n''a pas basculé', 'chef', $q$select {R}'{D3}', 'facture', '{U}02101')$q$, '22023', '{NBA}'],
  array['controle', '63a. rang 4 : la facture d''un autre dossier', 'chef', $q${R1}facture', '{U}01101')$q$, 'P0002', 'Facture introuvable dans ce dossier.'],
  array['controle', '63b. rang 5 : une facture pour un avoir', 'chef', $q${R1}avoir', '{U}00101')$q$, 'P0002', 'Avoir introuvable dans ce dossier.'],
  array['controle', '63c. rang 6 : l''encaissement d''un autre dossier', 'chef', $q${R1}encaissement', '{U}01501')$q$, 'P0002', 'Encaissement introuvable dans ce dossier.'],
  array['controle', '63d. rang 7 : le mouvement d''un autre dossier', 'chef', $q${R1}mouvement', '{U}01402')$q$, 'P0002', 'Mouvement introuvable dans ce dossier.'],
  array['controle', '64a. rang 8 : un mouvement classé autrement, sa ligne gardée', 'chef', $q$update lignes_bancaires set statut = 'rapprochee', compte_bilan = '467000' where id = '{U}00411'; {L411}; {R1}mouvement', '{U}00411')$q$, '22023', 'Ce mouvement est classé autrement que par ses encaissements : ses écritures sont celles de ce classement, et se retirent avec lui.'],
  array['controle', '64b. rang 9 : un mouvement libre cité par une facture non source', 'chef', $q${R1}mouvement', '{U}00413')$q$, '22023', 'Aucun encaissement d''une facture source de sa vente ne cite ce mouvement : il n''a pas d''écriture de vente facturée.'],
  array['controle', '65. rang 10 : encore à écrire', 'chef', $q${R1}mouvement', '{U}00402')$q$, '22023', 'Cette source a encore à écrire : ses écritures se réécrivent, elles ne se retirent pas.'],
  array['controle', '66. rang 11 : des écritures validées', 'chef', $q${R1}encaissement', '{U}00524')$q$, '22023', 'Les écritures de cette source sont validées : elles ne se retirent plus.'],
  array['controle', '67a. rang 12 : rien de proposé', 'chef', $q${R1}encaissement', '{U}00514')$q$, '22023', '{AUC}'],
  array['controle', '67b. … un mouvement cité, pas encore classé', 'chef', $q${R1}mouvement', '{U}00407')$q$, '22023', '{AUC}'],
  array['lecture', '68. un encaissement retiré : ses lignes se retirent', 'chef', $q${W1}encaissement', '{U}00513', '{PF}'); select retirer_encaissement('{D1}', '{U}00513'); {N}{R}'{D1}', 'encaissement', '{U}00513')::text, true); select current_setting('essai.n') || '|' || coalesce(nullif(current_setting('jd.ecriture_vente_facturee', true), ''), 'retiré') || '|' || (select count(*) from ecritures_brouillon where encaissement_id = '{U}00513')$q$, '', '3|retiré|0'],
  array['lecture', '69. un mouvement déclassé : ses écritures se retirent', 'chef', $q$select retirer_classement_par_encaissements('{D1}', '{U}00402'); {N}{R}'{D1}', 'mouvement', '{U}00402')::text, true); select current_setting('essai.n') || '|' || (select count(*) from ecritures_brouillon where ligne_bancaire_id = '{U}00402')$q$, '', '3|0'],

  -- ══ 70 à 89. G5 : les trois genres ne s'écrivent que par leurs fonctions ══════════
  array['controle', '70. à un encaissement, en direct : la garde des colonnes', 'membre', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, encaissement_id) values ('{D1}', '2026-03-02', '512000', 'ESSAI', 1, 'debit', '{U}00501')$q$, '42501', '{VF2}'],
  array['controle', '71. … à une facture', 'chef_simple', $q$insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, facture_id) values ('{D2}', '2026-03-04', '411000', 'ESSAI', 1, 'debit', '{U}01103')$q$, '42501', '{VF2}'],
  array['controle', '72. sur un mouvement classé : G5', 'chef_simple', $q${L402}$q$, '42501', '{INS}'],
  array['controle', '73. … le membre', 'membre', $q${L402}$q$, '42501', '{INS}'],
  array['controle', '74. … les Edge Functions', 'service', $q${L402}$q$, '42501', '{INS}'],
  array['controle', '75. … le propriétaire', 'postgres', $q${L402}$q$, '42501', '{INS}'],
  array['controle', '76. … sous le réglage d''une AUTRE source', 'postgres', $q$select set_config('jd.ecriture_vente_facturee', '{U}00501', true); {L402}$q$, '42501', '{INS}'],
  array['controle', '77. sous le réglage de SON mouvement, elle passe', 'postgres', $q$select set_config('jd.ecriture_vente_facturee', '{U}00402', true); {L402}$q$, 'OK', ''],
  array['controle', '78. la restauration du super-administrateur', 'chef', $q${L402}$q$, 'OK', ''],
  array['controle', '79a. la banque de l''exemplaire sur le mouvement mixte, par le membre : l''écriture de sa pièce', 'membre', $q${L420}$q$, 'OK', ''],
  array['controle', '79b. … le chef simple la pose et la reprend', 'chef_simple', $q${L420}; update ecritures_brouillon set montant = 119 where piece_id = '{U}00601' and ligne_bancaire_id = '{U}00420'$q$, 'OK', ''],
  array['controle', '79c. … mais elle ne perd pas sa pièce : elle deviendrait une ligne du mouvement', 'chef', $q${L420}; update ecritures_brouillon set piece_id = null where piece_id = '{U}00601' and ligne_bancaire_id = '{U}00420'$q$, '42501', '{MOD}'],
  array['controle', '79d. … ni une ligne du mouvement n''en reçoit une', 'chef', $q${W1}mouvement', '{U}00420', '{PH}'); update ecritures_brouillon set piece_id = '{U}00601' where ligne_bancaire_id = '{U}00420' and piece_id is null and facture_id is null and encaissement_id is null$q$, '42501', '{MOD}'],
  array['controle', '80. la ligne d''un encaissement ne se modifie pas', 'chef', $q$update ecritures_brouillon set libelle = 'AUTRE' where encaissement_id = '{U}00501'$q$, '42501', '{MOD}'],
  array['controle', '81. … ni celle d''une facture', 'chef', $q$update ecritures_brouillon set montant = montant + 1 where facture_id = '{U}01103'$q$, '42501', '{MOD}'],
  array['controle', '82. … ni celle d''un mouvement classé', 'chef', $q$update ecritures_brouillon set ligne_bancaire_id = null where ligne_bancaire_id = '{U}00402' and encaissement_id is null$q$, '42501', '{MOD}'],
  array['controle', '83. … ni sous le réglage d''une AUTRE source', 'postgres', $q$select set_config('jd.ecriture_vente_facturee', '{U}00402', true); update ecritures_brouillon set libelle = 'AUTRE' where encaissement_id = '{U}00501'$q$, '42501', '{MOD}'],
  array['controle', '84. sous le réglage de SA source, elle change', 'postgres', $q$select set_config('jd.ecriture_vente_facturee', '{U}00501', true); update ecritures_brouillon set libelle = 'AUTRE' where encaissement_id = '{U}00501'$q$, 'OK', ''],
  array['controle', '85. la validation d''un exercice la numérote', 'postgres', $q$select set_config('jd.validation_exercice', '{D1}', true); update ecritures_brouillon set statut = 'validee', valide_le = now(), journal_code = 'BQ', numero_ecriture = 1, piece_ref = 'R', piece_date = date, compte_lib = 'L', comp_aux_num = 'A', comp_aux_lib = 'A' where ligne_bancaire_id = '{U}00402' and encaissement_id is null$q$, 'OK', ''],
  array['controle', '86. … et rien d''autre', 'postgres', $q$select set_config('jd.validation_exercice', '{D1}', true); update ecritures_brouillon set statut = 'validee', numero_ecriture = 1, libelle = 'AUTRE' where ligne_bancaire_id = '{U}00402' and encaissement_id is null$q$, '42501', '{MOD}'],
  array['controle', '87. une écriture ordinaire vers un mouvement classé', 'membre', $q$insert into ecritures_brouillon (id, dossier_id, date, compte, libelle, montant, sens) values ('{X}', '{D1}', '2026-03-20', '471000', 'ESSAI', 1, 'debit'); update ecritures_brouillon set ligne_bancaire_id = '{U}00402' where id = '{X}'$q$, '42501', '{MOD}'],
  array['controle', '88. une écriture ordinaire, comme hier', 'membre', $q$insert into ecritures_brouillon (id, dossier_id, ligne_bancaire_id, date, compte, libelle, montant, sens) values ('{X}', '{D1}', '{U}00411', '2026-03-25', '471000', 'ESSAI', 1, 'debit'); update ecritures_brouillon set libelle = 'ESSAI 2', compte = '471100' where id = '{X}'$q$, 'OK', ''],
  array['controle', '89. … et dans un dossier qui n''a pas basculé', 'chef_simple',$q$insert into ecritures_brouillon (id, dossier_id, ligne_bancaire_id, date, compte, libelle, montant, sens) values ('{X}', '{D3}', '{U}02401', '2026-03-02', '512000', 'ESSAI', 120, 'debit'); update ecritures_brouillon set libelle = 'ESSAI 2' where id = '{X}'$q$, 'OK', ''],

  -- ══ 90 à 96. Les autres chemins : sur un mouvement classé et écrit, leurs refus d'hier d'abord ; sur un mouvement
  -- libéré qui porte encore des lignes de vente facturée, ils passent, et ces lignes restent (R1) ══════════
  array['controle', '90. la policy du cabinet', 'chef', $q$update lignes_bancaires set compte_bilan = '467000' where id = '{U}00402'$q$, '23514', '{CLA}'],
  array['controle', '91. le compte de bilan', 'chef', $q$select ecrire_mouvement_compte_bilan('{U}00402', '467000', '[{"compte":"512000","sens":"debit","montant":1005.15},{"compte":"467000","sens":"credit","montant":1005.15}]')$q$, '23514', '{CLA}'],
  array['controle', '92. l''affectation à une catégorie', 'chef', $q$insert into categories (id, dossier_id, code, libelle, ordre, compte_comptable, poste_2035) values ('{X}', '{D1}', 'essai', 'ESSAI', 999, '627000', 'Frais financiers'); select affecter_mouvement_bancaire('{U}00402', '{X}', '[{"compte":"512000","sens":"debit","montant":1005.15},{"compte":"627000","sens":"credit","montant":1005.15}]')$q$, '23514', '{CLA}'],
  array['controle', '93. le virement personnel', 'chef', $q$select classer_virement_personnel('{U}00402', '[{"compte":"512000","sens":"debit","montant":1005.15},{"compte":"108000","sens":"credit","montant":1005.15}]')$q$, '23514', '{CLA}'],
  array['controle', '94. le retrait d''une affectation', 'chef', $q$select retirer_affectation_mouvement_bancaire('{U}00402')$q$, '22023', 'Ce mouvement n''est affecté à aucune catégorie.'],
  array['lecture', '95. R1 : déclassé puis contre-passé sans mouvement, le mouvement libre se classe ; les lignes de la vente facturée restent', 'postgres', $q${JWT} {WE}'{PA}'); select retirer_classement_par_encaissements('{D1}', '{U}00401');
    insert into transmissions_factures (dossier_id, facture_id, canal, hote, flux_id, sha256, etat) values ('{D1}', '{U}00101', 'plateforme', 'p.fr', 'x', repeat('0', 64), 'accepte');
    insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values ('{D1}', '{U}00501', '{U}00101', 'manuel', 'p.fr', 'depose');
    {N}(select id from annuler_encaissement('{D1}', '{U}00501', '2026-03-03', 'ESSAI', null))::text, true);
    select {W}'{D1}', 'encaissement', current_setting('essai.n')::uuid, {PRO}'{D1}', 'encaissement', current_setting('essai.n')::uuid{ORP});
    {TRY}{CBF}{YRT} {TRY}{W}'{D1}', 'mouvement', '{U}00401', '[]'){YRT} {TRY}{R}'{D1}', 'mouvement', '{U}00401'){YRT}
    select current_setting('essai.e') || '|' || {LIG}'{D1}' and b.ligne_bancaire_id = '{U}00401' and b.encaissement_id is null)
      || '|' || {LIG}'{D1}' and b.ligne_bancaire_id = '{U}00401' and b.encaissement_id is not null) || '|' || (select statut || coalesce(compte_bilan, '') from lignes_bancaires where id = '{U}00401')
      || '|' || coalesce((ecriture_attendue_vente_facturee('{D1}', 'mouvement', '{U}00401')).motif, '-')$q$, '',
    '|passé|22023 Ce mouvement ne justifie aucun encaissem|22023 Ce mouvement est classé autrement que pa|03-02 467000-12000@401 03-02 512000+12000@401|03-02 512000+12000@401 03-03 512000-12000@401|rapprochee467000|-'],
  array['lecture', '96. … déclassé puis retiré : il se classe, les lignes périmées de l''encaissement restent jusqu''à leur retrait', 'chef', $q${WE}'{PA}'); select retirer_classement_par_encaissements('{D1}', '{U}00401'); select retirer_encaissement('{D1}', '{U}00501');
    {TRY}{CBF}{YRT} {TRY}{W}'{D1}', 'mouvement', '{U}00401', '[]'){YRT}
    select set_config('essai.o', {LIG}'{D1}' and b.ligne_bancaire_id = '{U}00401' and b.encaissement_id is null) || ' / ' || {LIG}'{D1}' and b.ligne_bancaire_id = '{U}00401' and b.encaissement_id is not null), true);
    {N}{R}'{D1}', 'encaissement', '{U}00501')::text, true); select current_setting('essai.e') || '|' || current_setting('essai.o') || '|' || current_setting('essai.n') || '|' || {LIG}'{D1}' and b.ligne_bancaire_id = '{U}00401')$q$, '',
    '|passé|22023 Ce mouvement ne justifie aucun encaissem|03-02 467000-12000@401 03-02 512000+12000@401 / 03-02 512000+12000@401|3|03-02 467000-12000@401 03-02 512000+12000@401'],

  -- ══ 97. L'impayé d'un encaissement jamais déclaré (migration impaye_non_declare, étape VF5d2) : la contre-passation
  -- que la fonction écrit pour l'encaissement 501, jamais déclaré, en citant un débit libre (499) du même jour, se compose
  -- et s'écrit comme toute contre-passation — celle du jeu, 509, que la restauration pose — : la banque sur ce débit,
  -- comme l'encaissement 501 sur son crédit du même jour ; rien de ce qui compose ne lit les déclarations. Le
  -- propriétaire, sous le jeton du chef, comme en 95 : la recomposition ne s'exécute pas au compte connecté. Sa mutation
  -- — sans débit, le refus d'hier — se joue dans ventesFacturees.sql (171) ══════════
  array['lecture', '97. VF5d2 : contre-passé en citant un débit, l''encaissement jamais déclaré s''écrit comme toute contre-passation ; rien de ce qui compose ne lit les déclarations', 'postgres', $q${JWT} insert into lignes_bancaires (id, dossier_id, date, libelle, montant) values ('{U}00499', '{D1}', '2026-03-05', 'ESSAI', -120);
    select set_config('essai.cp', (select a.id from annuler_encaissement('{D1}', '{U}00501', '2026-03-05', 'Chèque revenu impayé', '{U}00499') a)::text, true);
    {N}{W}'{D1}', 'encaissement', current_setting('essai.cp')::uuid, {PRO}'{D1}', 'encaissement', current_setting('essai.cp')::uuid{ORP})::text, true);
    select current_setting('essai.n') || '|' || {LIG}'{D1}' and b.encaissement_id = current_setting('essai.cp')::uuid)
      || '|' || (select count(*) from transmissions_encaissements x where x.encaissement_id in ('{U}00501', current_setting('essai.cp')::uuid))
      || '|' || (select count(*) || ':' || coalesce(string_agg(proname, ',') filter (where prosrc ~ '(transmissions_encaissements|encaissement_declare)'), '∅') from pg_proc where pronamespace = 'public'::regnamespace and proname in ('calcul_vente_facturee', 'ecriture_attendue_vente_facturee', 'ecrire_vente_facturee', 'retirer_ecriture_vente_facturee', 'prorata_arrondi', 'refus_compte_de_contrepartie'))$q$, '',
    '3|03-05 445710+2000 03-05 512000-12000@499 03-05 706000+10000|0|6:∅'],

  -- ══ 130 à 139. R1 : les dix-huit fonctions du relevé sur le mouvement libéré (PR1), chacune par son mécanisme — ce que
  -- la fonction qui classe rend, ce que celle qui déclasse rend, les lignes propres après le classement, puis après le
  -- déclassement, les lignes de la vente facturée (intactes : celles que PR1 a posées), l'état du mouvement et le nombre de
  -- ses liens ══════════
  array['lecture', '130. R1 : l''affectation, puis son retrait', 'postgres', $q${PR1}
    insert into categories (id, dossier_id, code, libelle, ordre, compte_comptable, poste_2035) values ('{X}', '{D1}', 'essai', 'ESSAI', 999, '627000', 'Frais financiers');
    {N}affecter_mouvement_bancaire('{U}00401', '{X}', '[{"compte":"512000","sens":"debit","montant":120},{"compte":"627000","sens":"credit","montant":120}]')::text, true);
    select set_config('essai.o', {LPR}, true);
    {N}current_setting('essai.n') || '|' || retirer_affectation_mouvement_bancaire('{U}00401')::text, true);
    select current_setting('essai.n') || '|' || current_setting('essai.o') || '|' || {LPR} || '|' || {LVF} || '|' || (select statut || ':' || num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id, nullif(ventilee, false), nullif(reglement_groupe, false), nullif(prelevement_personnel, false)) from lignes_bancaires where id = '{U}00401')$q$, '',
    '2|2|03-02 512000+12000 03-02 627000-12000|∅|03-02 512000+12000 proposee e501 03-03 512000-12000 proposee cp 03-04 411000+100 validee f101 03-04 512000+50 validee e501|non_rapprochee:0'],
  array['lecture', '131. … le virement personnel, puis son retrait', 'postgres', $q${PR1}
    {N}classer_virement_personnel('{U}00401', '[{"compte":"512000","sens":"debit","montant":120},{"compte":"108000","sens":"credit","montant":120}]')::text, true);
    select set_config('essai.o', {LPR}, true);
    {N}current_setting('essai.n') || '|' || retirer_virement_personnel('{U}00401')::text, true);
    select current_setting('essai.n') || '|' || current_setting('essai.o') || '|' || {LPR} || '|' || {LVF} || '|' || (select statut || ':' || num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id, nullif(ventilee, false), nullif(reglement_groupe, false), nullif(prelevement_personnel, false)) from lignes_bancaires where id = '{U}00401')$q$, '',
    '2|2|03-02 108000-12000 03-02 512000+12000|∅|03-02 512000+12000 proposee e501 03-03 512000-12000 proposee cp 03-04 411000+100 validee f101 03-04 512000+50 validee e501|non_rapprochee:0'],
  array['lecture', '132. … le compte de bilan, puis son retrait', 'postgres', $q${PR1}
    {N}{CBF}::text, true);
    select set_config('essai.o', {LPR}, true);
    {N}current_setting('essai.n') || '|' || retirer_mouvement_compte_bilan('{U}00401')::text, true);
    select current_setting('essai.n') || '|' || current_setting('essai.o') || '|' || {LPR} || '|' || {LVF} || '|' || (select statut || ':' || num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id, nullif(ventilee, false), nullif(reglement_groupe, false), nullif(prelevement_personnel, false)) from lignes_bancaires where id = '{U}00401')$q$, '',
    '2|2|03-02 467000-12000 03-02 512000+12000|∅|03-02 512000+12000 proposee e501 03-03 512000-12000 proposee cp 03-04 411000+100 validee f101 03-04 512000+50 validee e501|non_rapprochee:0'],
  array['lecture', '133. … la ventilation, puis son retrait', 'postgres', $q${PR1}
    insert into categories (id, dossier_id, code, libelle, ordre, compte_comptable, poste_2035) values ('{X}', '{D1}', 'essai', 'ESSAI', 999, '627000', 'Frais financiers');
    {N}ventiler_mouvement_bancaire('{U}00401', '[{"categorie_id":"{X}","montant":100},{"part_personnelle":true,"montant":20}]', '[{"compte":"512000","sens":"debit","montant":120},{"compte":"627000","sens":"credit","montant":100},{"compte":"108000","sens":"credit","montant":20}]')::text, true);
    select set_config('essai.o', {LPR}, true);
    {N}current_setting('essai.n') || '|' || retirer_ventilation_mouvement_bancaire('{U}00401')::text, true);
    select current_setting('essai.n') || '|' || current_setting('essai.o') || '|' || {LPR} || '|' || {LVF} || '|' || (select statut || ':' || num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id, nullif(ventilee, false), nullif(reglement_groupe, false), nullif(prelevement_personnel, false)) from lignes_bancaires where id = '{U}00401')$q$, '',
    '3|3|03-02 108000-2000 03-02 512000+12000 03-02 627000-10000|∅|03-02 512000+12000 proposee e501 03-03 512000-12000 proposee cp 03-04 411000+100 validee f101 03-04 512000+50 validee e501|non_rapprochee:0'],
  array['lecture', '134. … le règlement groupé (il retire aussi les lignes de ses pièces), puis son retrait', 'postgres', $q${PR1}
    insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, date_piece, montant_ttc) values
      ('{U}00901', '{D1}', '{D1}/r1-a.pdf', 'r1-a.pdf', 'vente', 'a_valider', '2026-03-01', 70), ('{U}00902', '{D1}', '{D1}/r1-b.pdf', 'r1-b.pdf', 'vente', 'a_valider', '2026-03-01', 50);
    insert into ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens) values ('{D1}', '{U}00901', '{U}00401', '2026-03-02', '512000', 'ESSAI', 70, 'debit');
    {N}regler_pieces_par_mouvement('{U}00401', '[{"piece_id":"{U}00901","montant":70},{"piece_id":"{U}00902","montant":50}]')::text, true);
    select set_config('essai.o', {LPR}, true);
    insert into ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens) values
      ('{D1}', '{U}00901', '{U}00401', '2026-03-02', '512000', 'ESSAI', 70, 'debit'), ('{D1}', '{U}00902', '{U}00401', '2026-03-02', '512000', 'ESSAI', 50, 'debit');
    {N}current_setting('essai.n') || '|' || retirer_reglement_groupe('{U}00401')::text, true);
    select current_setting('essai.n') || '|' || current_setting('essai.o') || '|' || {LPR} || '|' || {LVF} || '|' || (select statut || ':' || num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id, nullif(ventilee, false), nullif(reglement_groupe, false), nullif(prelevement_personnel, false)) from lignes_bancaires where id = '{U}00401')$q$, '',
    '2|2|∅|∅|03-02 512000+12000 proposee e501 03-03 512000-12000 proposee cp 03-04 411000+100 validee f101 03-04 512000+50 validee e501|non_rapprochee:0'],
  array['lecture', '135. … le déblocage d''un emprunt, puis son retrait', 'postgres', $q${PR1}
    insert into emprunts (id, dossier_id, nom, capital_initial, taux_annuel, date_debut, duree_mois) values ('{U}00904', '{D1}', 'ESSAI', 1000, 2, '2026-03-01', 24);
    {N}rapprocher_echeance_emprunt('{U}00401', '{U}00904', null, 0, 0, '[{"compte":"512000","sens":"debit","montant":120},{"compte":"164000","sens":"credit","montant":120}]')::text, true);
    select set_config('essai.o', {LPR}, true);
    {N}current_setting('essai.n') || '|' || retirer_echeance_emprunt('{U}00401')::text, true);
    select current_setting('essai.n') || '|' || current_setting('essai.o') || '|' || {LPR} || '|' || {LVF} || '|' || (select statut || ':' || num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id, nullif(ventilee, false), nullif(reglement_groupe, false), nullif(prelevement_personnel, false)) from lignes_bancaires where id = '{U}00401')$q$, '',
    '2|2|03-02 164000-12000 03-02 512000+12000|∅|03-02 512000+12000 proposee e501 03-03 512000-12000 proposee cp 03-04 411000+100 validee f101 03-04 512000+50 validee e501|non_rapprochee:0'],
  array['lecture', '136. … le remboursement d''une échéance de cotisation, puis son retrait', 'postgres', $q${PR1}
    insert into cotisations_declarees (id, dossier_id, echeance, montant_appele) values ('{U}00903', '{D1}', '2026-03-01', -120);
    {N}rapprocher_cotisation('{U}00401', '{U}00903', '[{"compte":"512000","sens":"debit","montant":120},{"compte":"646000","sens":"credit","montant":120}]')::text, true);
    select set_config('essai.o', {LPR}, true);
    {N}current_setting('essai.n') || '|' || retirer_rapprochement_cotisation('{U}00401')::text, true);
    select current_setting('essai.n') || '|' || current_setting('essai.o') || '|' || {LPR} || '|' || {LVF} || '|' || (select statut || ':' || num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id, nullif(ventilee, false), nullif(reglement_groupe, false), nullif(prelevement_personnel, false)) from lignes_bancaires where id = '{U}00401')$q$, '',
    '2|2|03-02 512000+12000 03-02 646000-12000|∅|03-02 512000+12000 proposee e501 03-03 512000-12000 proposee cp 03-04 411000+100 validee f101 03-04 512000+50 validee e501|non_rapprochee:0'],
  array['lecture', '137. … puis l''échéance supprimée par sa fonction', 'postgres', $q${PR1}
    insert into cotisations_declarees (id, dossier_id, echeance, montant_appele) values ('{U}00903', '{D1}', '2026-03-01', -120);
    {N}rapprocher_cotisation('{U}00401', '{U}00903', '[{"compte":"512000","sens":"debit","montant":120},{"compte":"646000","sens":"credit","montant":120}]')::text, true);
    select set_config('essai.o', {LPR}, true);
    {N}current_setting('essai.n') || '|' || supprimer_echeance_cotisation('{U}00903')::text, true);
    select current_setting('essai.n') || '|' || current_setting('essai.o') || '|' || {LPR} || '|' || {LVF} || '|' || (select statut || ':' || num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id, nullif(ventilee, false), nullif(reglement_groupe, false), nullif(prelevement_personnel, false)) from lignes_bancaires where id = '{U}00401')$q$, '',
    '2|1|03-02 512000+12000 03-02 646000-12000|∅|03-02 512000+12000 proposee e501 03-03 512000-12000 proposee cp 03-04 411000+100 validee f101 03-04 512000+50 validee e501|non_rapprochee:0'],
  array['lecture', '138. … le remboursement d''un crédit de TVA, puis son retrait', 'postgres', $q${PR1}
    insert into declarations_tva (id, dossier_id, periode_debut, periode_fin, tva_declaree, remboursement_demande) values ('{U}00905', '{D1}', '2026-01-01', '2026-01-31', -120, 120);
    {N}rapprocher_declaration_tva('{U}00401', '{U}00905', '[{"compte":"512000","sens":"debit","montant":120},{"compte":"445830","sens":"credit","montant":120}]')::text, true);
    select set_config('essai.o', {LPR}, true);
    {N}current_setting('essai.n') || '|' || retirer_rapprochement_declaration_tva('{U}00401')::text, true);
    select current_setting('essai.n') || '|' || current_setting('essai.o') || '|' || {LPR} || '|' || {LVF} || '|' || (select statut || ':' || num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id, nullif(ventilee, false), nullif(reglement_groupe, false), nullif(prelevement_personnel, false)) from lignes_bancaires where id = '{U}00401')$q$, '',
    '2|2|03-02 445830-12000 03-02 512000+12000|∅|03-02 512000+12000 proposee e501 03-03 512000-12000 proposee cp 03-04 411000+100 validee f101 03-04 512000+50 validee e501|non_rapprochee:0'],
  array['lecture', '139. … puis la déclaration retirée par sa fonction', 'postgres', $q${PR1}
    insert into declarations_tva (id, dossier_id, periode_debut, periode_fin, tva_declaree, remboursement_demande) values ('{U}00905', '{D1}', '2026-01-01', '2026-01-31', -120, 120);
    {N}rapprocher_declaration_tva('{U}00401', '{U}00905', '[{"compte":"512000","sens":"debit","montant":120},{"compte":"445830","sens":"credit","montant":120}]')::text, true);
    select set_config('essai.o', {LPR}, true);
    {N}current_setting('essai.n') || '|' || retirer_declaration_tva('{U}00905')::text, true);
    select current_setting('essai.n') || '|' || current_setting('essai.o') || '|' || {LPR} || '|' || {LVF} || '|' || (select statut || ':' || num_nonnulls(piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id, nullif(ventilee, false), nullif(reglement_groupe, false), nullif(prelevement_personnel, false)) from lignes_bancaires where id = '{U}00401')
      || '|' || (select count(*) from declarations_tva where id = '{U}00905')$q$, '',
    '2|1|03-02 445830-12000 03-02 512000+12000|∅|03-02 512000+12000 proposee e501 03-03 512000-12000 proposee cp 03-04 411000+100 validee f101 03-04 512000+50 validee e501|non_rapprochee:0|0'],

  -- ══ 100 à 119. Le compte de contrepartie ══════════
  array['controle', '100. rang 1 : le client « Ventes »', 'client_vb', $q${C1}00518', '467100')$q$, '42501', '{ACC}'],
  array['controle', '101. rang 2 : l''encaissement d''un autre dossier', 'chef', $q${C1}01518', '467100')$q$, 'P0002', 'Encaissement introuvable dans ce dossier.'],
  array['controle', '102. rang 3 : retiré', 'chef', $q${C1}00514', '467100')$q$, '22023', 'Cet encaissement est retiré : il ne s''écrit pas, et ne reçoit pas de compte de contrepartie.'],
  array['controle', '103. rang 4 : une contre-passation', 'chef', $q${C1}00511', '467100')$q$, '22023', 'Une contre-passation s''écrit sur le compte de l''encaissement qu''elle annule : elle ne reçoit pas de compte de contrepartie.'],
  array['controle', '104. rang 5 : d''une facture qui n''est pas source', 'chef', $q${C1}00520', '467100')$q$, '22023', 'Seul l''encaissement d''une facture source de sa vente s''écrit dans l''application : celui-ci ne reçoit pas de compte de contrepartie.'],
  array['controle', '105. rang 6 : daté de l''exercice validé', 'chef', $q${C1}00523', '467100')$q$, '22023', 'L''exercice 2025 est validé : le compte de contrepartie de cet encaissement ne change plus.'],
  array['controle', '106. rang 7 : il cite un mouvement', 'chef', $q${C1}00501', '467100')$q$, '22023', 'Cet encaissement cite un mouvement : il s''écrit par lui, sur la banque ou sur les valeurs à l''encaissement, jamais sur un compte de contrepartie.'],
  array['controle', '107. rang 8 : un chèque', 'chef', $q${C1}00510', '467100')$q$, '22023', 'Seul un encaissement par compensation, ou par un autre moyen, s''écrit sur un compte de contrepartie : celui-ci se dit par son moyen de paiement.'],
  array['controle', '108. rang 9 : aucun compte', 'chef', $q${C1}00518', null)$q$, '22023', 'Le compte de contrepartie est à choisir.'],
  array['controle', '109a. rang 10 : un compte de charge', 'chef', $q${C1}00518', '601000')$q$, '22023', '{FOR}'],
  array['controle', '109b. … cinq chiffres', 'chef', $q${C1}00518', '46710')$q$, '22023', '{FOR}'],
  array['controle', '109c. … onze', 'chef', $q${C1}00518', '46710000000')$q$, '22023', '{FOR}'],
  array['controle', '110. … le compte des clients', 'chef', $q${C1}00518', '411000')$q$, '22023', 'Le compte des clients est celui que l’encaissement solde : il n’en est pas la contrepartie.'],
  array['controle', '111a. … la banque', 'chef', $q${C1}00518', '512000')$q$, '22023', '{BAN}'],
  array['controle', '111b. … les valeurs à l''encaissement', 'chef', $q${C1}00518', '511000')$q$, '22023', '{BAN}'],
  array['controle', '111c. … la caisse', 'chef', $q${C1}00519', '530000')$q$, '22023', '{BAN}'],
  array['controle', '112. … un compte de TVA', 'chef', $q${C1}00518', '445660')$q$, '22023', 'Un compte de TVA ne reçoit pas un encaissement : la TVA d’une vente s’écrit avec elle.'],
  array['lecture', '113. le cabinet le choisit ; le réglage retiré', 'chef', $q$select c.compte_contrepartie || '|' || coalesce(nullif(current_setting('jd.contrepartie_encaissement', true), ''), 'retiré') from {C}'{D1}', '{U}00518', '467100') c$q$, '', '467100|retiré'],
  array['lecture', '114. choisi, l''encaissement s''écrit sur lui', 'postgres', $q${JWT} {C1}00518', '467100'); {W1}encaissement', '{U}00518', {PRO}'{D1}', 'encaissement', '{U}00518'{ORP}); select {LIG}'{D1}' and b.encaissement_id = '{U}00518')$q$, '',
    '03-12 445710-400 03-12 467100+2400 03-12 706000-2000'],
  array['lecture', '115. choisi de nouveau, il se remplace', 'postgres', $q${JWT} {C1}00519', '467100'); select compte_contrepartie from encaissements_factures where id = '{U}00519'$q$, '', '467100'],
  array['controle', '116. la garde : il ne change pas en direct', 'postgres', $q$update encaissements_factures set compte_contrepartie = '467100' where id = '{U}00518'$q$, '42501', '{CHF}'],
  array['controle', '117. … ni sous le réglage d''un AUTRE encaissement', 'postgres', $q$select set_config('jd.contrepartie_encaissement', '{U}00519', true); update encaissements_factures set compte_contrepartie = '467100' where id = '{U}00518'$q$, '42501', '{CHF}'],
  array['controle', '118. sous le SIEN, il change', 'postgres', $q$select set_config('jd.contrepartie_encaissement', '{U}00518', true); update encaissements_factures set compte_contrepartie = '467100' where id = '{U}00518'$q$, 'OK', ''],
  array['controle', '119a. un encaissement ne naît pas avec lui', 'postgres', $q${E110}$q$, '42501', '{NAI}'],
  array['controle', '119b. … ni par les Edge Functions', 'service', $q${E110}$q$, '42501', '{NAI}'],
  array['controle', '119c. la restauration du super-administrateur', 'chef', $q${E110}$q$, 'OK', ''],
  array['lecture', '119d. le client « Ventes » le lit', 'client_vb', $q$select compte_contrepartie from encaissements_factures where id = '{U}00507'$q$, '', '467200'],

  -- ══ 150 à 154. Ce que le catalogue dit ══════════
  array['valeur', '150. la colonne et sa contrainte', 'postgres', $q$select (select format_type(atttypid, atttypmod) || ' ' || attnotnull || ' ' || atthasdef from pg_attribute where attrelid = conrelid and attname = 'compte_contrepartie') || ' | ' || pg_get_constraintdef(oid) from pg_constraint where conname = 'encaissements_factures_compte_contrepartie'$q$, '',
    'text false false | CHECK ((compte_contrepartie ~ ''^[1-5][0-9]{5,9}$''::text))'],
  array['valeur', '151. G5, active, après les autres gardes', 'postgres', $q$select string_agg(tgname, ',' order by tgname) || ' | ' || (select pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text from pg_trigger t where t.tgname = 'ecritures_brouillon_vente_facturee_lignes') from pg_trigger where tgrelid = 'public.ecritures_brouillon'::regclass and not tgisinternal$q$, '',
    'ecritures_brouillon_intangibles,ecritures_brouillon_paiement_personnel,ecritures_brouillon_sans_exemplaire_d_une_source,ecritures_brouillon_vente_facturee,ecritures_brouillon_vente_facturee_lignes | CREATE TRIGGER ecritures_brouillon_vente_facturee_lignes BEFORE INSERT OR DELETE OR UPDATE ON public.ecritures_brouillon FOR EACH ROW EXECUTE FUNCTION garder_lignes_de_la_vente_facturee() O'],
  array['valeur', '152. sécurité, chemin et droits des fonctions', 'postgres', $q$select string_agg(proname || ':' || prosecdef::int || provolatile::text || coalesce(proconfig = '{search_path=public}', false)::int || has_function_privilege('anon', oid, 'execute')::int || has_function_privilege('authenticated', oid, 'execute')::int, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('calcul_vente_facturee', 'choisir_compte_contrepartie', 'ecrire_vente_facturee', 'ecriture_attendue_vente_facturee', 'garder_lignes_de_la_vente_facturee', 'prorata_arrondi', 'refus_compte_de_contrepartie', 'retirer_ecriture_vente_facturee')$q$, '',
    'calcul_vente_facturee:0s100,choisir_compte_contrepartie:1v101,ecrire_vente_facturee:1v101,ecriture_attendue_vente_facturee:0s100,garder_lignes_de_la_vente_facturee:1v100,prorata_arrondi:0i100,refus_compte_de_contrepartie:0s100,retirer_ecriture_vente_facturee:1v101'],
  array['valeur', '153. une signature chacune', 'postgres', $q$select string_agg(proname || '(' || pg_get_function_identity_arguments(oid) || ')', ' ' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname in ('choisir_compte_contrepartie', 'ecrire_vente_facturee', 'retirer_ecriture_vente_facturee')$q$, '',
    'choisir_compte_contrepartie(p_dossier_id uuid, p_encaissement_id uuid, p_compte text) ecrire_vente_facturee(p_dossier_id uuid, p_source text, p_source_id uuid, p_lignes jsonb) retirer_ecriture_vente_facturee(p_dossier_id uuid, p_source text, p_source_id uuid)'],
  array['valeur', '154. qui nomme les deux réglages', 'postgres', $q$select string_agg(r || ':' || (select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%' || r || '%'), ' | ' order by r) from unnest(array['jd.contrepartie_encaissement', 'jd.ecriture_vente_facturee']) r$q$, '',
    'jd.contrepartie_encaissement:choisir_compte_contrepartie,garder_encaissement_facture | jd.ecriture_vente_facturee:ecrire_vente_facturee,garder_ecriture_vente_facturee,garder_lignes_de_la_vente_facturee,retirer_ecriture_vente_facturee'],
  -- Le filtre de R1 ne nomme, parmi les colonnes de source, que la pièce, la facture et l'encaissement : sur une ligne qui
  -- porte un mouvement, ces quatre contraintes font des quatre autres des colonnes nulles. L'une relâchée, le filtre se revoit.
  array['valeur', '155. les quatre autres colonnes de source, nulles sur une ligne qui porte un mouvement', 'postgres', $q$select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname) from pg_constraint where conrelid = 'public.ecritures_brouillon'::regclass and conname in ('ecritures_brouillon_cotisation_sans_autre_source', 'ecritures_brouillon_dotation_sans_piece_ni_mouvement', 'ecritures_brouillon_forfait_sans_piece_ni_mouvement', 'ecritures_brouillon_liquidation_sans_autre_source')$q$, '',
    'ecritures_brouillon_cotisation_sans_autre_source CHECK (((cotisation_id IS NULL) OR ((piece_id IS NULL) AND (ligne_bancaire_id IS NULL) AND (immobilisation_id IS NULL) AND (vehicule_id IS NULL) AND (declaration_tva_id IS NULL)))) | ecritures_brouillon_dotation_sans_piece_ni_mouvement CHECK (((immobilisation_id IS NULL) OR ((piece_id IS NULL) AND (ligne_bancaire_id IS NULL)))) | ecritures_brouillon_forfait_sans_piece_ni_mouvement CHECK (((vehicule_id IS NULL) OR ((piece_id IS NULL) AND (ligne_bancaire_id IS NULL) AND (immobilisation_id IS NULL)))) | ecritures_brouillon_liquidation_sans_autre_source CHECK (((declaration_tva_id IS NULL) OR ((piece_id IS NULL) AND (ligne_bancaire_id IS NULL) AND (immobilisation_id IS NULL) AND (vehicule_id IS NULL))))'],

  -- ══ 160 à 166. Les mutations : chacune doit MORDRE ══════════
  array['controle', '161. MUTATION de 52c : au centime juste', 'chef', $q${WE}jsonb_set('{PA}', '{0,montant}', '20.00'))$q$, 'OK', ''],
  array['controle', '162. MUTATION de 50a : sans exercice validé', 'chef', $q$select {W}'{D2}', 'encaissement', '{U}01524', '{PG}')$q$, 'OK', ''],
  array['controle', '163. MUTATION de 64b : cité par un encaissement retiré', 'chef', $q$select retirer_classement_par_encaissements('{D1}', '{U}00402'); select retirer_encaissement('{D1}', '{U}00503'); {R1}mouvement', '{U}00402')$q$, 'OK', ''],
  array['controle', '165. MUTATION de 72 : sur un mouvement libre', 'chef_simple', $q${L411}$q$, 'OK', ''],
  array['controle', '166. MUTATION de 79a : la même ligne, sans sa pièce, est une ligne du mouvement', 'membre', $q$insert into ecritures_brouillon (dossier_id, ligne_bancaire_id, date, compte, libelle, montant, sens) values ('{D1}', '{U}00420', '2026-03-28', '512000', 'ESSAI', 120, 'debit')$q$, '42501', '{INS}'],

  -- ══ 170 à 176. VF7a : le chèque de l'exercice validé, rattaché au crédit de janvier (posé EN DERNIER) ══════════
  -- Migration `frontiere_des_encaissements`. {U}00524, le chèque de 30 € de F2025-0001 daté du 31 décembre 2025, sans
  -- mouvement, porte l'écriture validée de l'exercice 2025 de D1 (le 511 au débit). Le relevé reçoit en janvier le crédit
  -- {U}00430, de 30 € ; le cabinet y rattache le chèque, puis classe le crédit par lui. Ce qui se prouve : la recomposition
  -- du chèque est celle d'avant (le 511, au 31 décembre), son écriture validée est intacte, et le crédit de janvier se
  -- compose — la banque au débit, le 511 au crédit — et s'écrit. Le module compose le même crédit
  -- (src/lib/ecritureVenteFacturee.test.ts). Posé en dernier : aucun contrôle d'avant ne le voit.
  array['jeu', 'VF7a : le crédit de janvier {U}00430', 'postgres', $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values ('{U}00430', '{D1}', '2026-01-05', 'ESSAI', 30, 'non_rapprochee')$q$, '', ''],
  array['retenir', 'AV524', 'postgres', $q$select array_to_string((ecriture_attendue_vente_facturee('{D1}', 'encaissement', '{U}00524')).lignes, ';')$q$, '', ''],
  array['fait', '170. le cabinet rattache le chèque du 31 décembre de l''exercice validé au crédit de janvier', 'chef', $q$select rattacher_mouvement_encaissement('{D1}', '{U}00524', '{U}00430')$q$, 'OK', ''],
  array['valeur', '171. sa recomposition est celle d''avant : le 511, au 31 décembre', 'postgres', $q$select array_to_string((ecriture_attendue_vente_facturee('{D1}', 'encaissement', '{U}00524')).lignes, ';')$q$, '', '{AV524}'],
  array['valeur', '172. son écriture validée est intacte', 'postgres', $q$select string_agg(concat_ws('|', date, compte, sens, trim_scale(montant), statut, numero_ecriture), ';') from ecritures_brouillon where encaissement_id = '{U}00524'$q$, '', '2025-12-31|511000|debit|30|validee|1'],
  array['fait', '173. le cabinet classe le crédit de janvier par le chèque', 'chef', $q$select classer_mouvement_par_encaissements('{D1}', '{U}00430')$q$, 'OK', ''],
  array['valeur', '174. le crédit de janvier se compose : le 511 au crédit, la banque au débit', 'postgres', $q$select array_to_string((ecriture_attendue_vente_facturee('{D1}', 'mouvement', '{U}00430')).lignes, ';')$q$, '', '2026-01-05|511000|credit|3000|{U}00430;2026-01-05|512000|debit|3000|{U}00430'],
  array['retenir', 'PJ', 'postgres', $q$select ({PRO}'{D1}', 'mouvement', '{U}00430'{ORP})::text$q$, '', ''],
  array['fait', '175. et s''écrit', 'chef', $q${W1}mouvement', '{U}00430', '{PJ}')$q$, 'OK', ''],
  array['valeur', '176. ses lignes proposées, sur le crédit de janvier', 'postgres', $q$select string_agg(concat_ws('|', date, compte, sens, trim_scale(montant), statut), ';' order by compte collate "C") from ecritures_brouillon where ligne_bancaire_id = '{U}00430'$q$, '', '2026-01-05|511000|credit|30|proposee;2026-01-05|512000|debit|30|proposee'],
  -- La recomposition d'un bloc, à la fin de l'essai : de même.
  array['valeur', '177. et à la fin de l''essai, tout ce qu''il a écrit, retiré et classé : de même (étape VF7b0)', 'postgres', $q$select count(*) || ' sources, ' || count(*) filter (where (b.motif, b.detail, b.lignes) is distinct from (c.motif, c.detail, c.lignes)) || ' écart(s)' from (values ('{D1}'::uuid), ('{D2}'::uuid), ('{D3}'::uuid)) z(d) cross join lateral ecritures_attendues_de_la_periode(z.d, null, '9999-12-31') b cross join lateral ecriture_attendue_vente_facturee(z.d, b.genre, b.source_id) c$q$, '',
    '199 sources, 0 écart(s)']
  ];

  begin
    foreach etape slice 1 in array etapes loop
      s := etape[4];
      attendu := etape[6];
      for cle, valeur in select key, value from jsonb_each_text(ids || jsonb_build_object('CHEF', chef)) loop
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
        -- Un attendu long est son empreinte (« md5: »), son texte en commentaire au-dessus du contrôle.
        verdicts := verdicts || jsonb_build_object('controle', etape[2], 'observe', coalesce(obs, '∅'),
          'ok', coalesce(obs = attendu or 'md5:' || md5(obs) = attendu, false));
      else
        if etape[3] in ('membre', 'chef_simple', 'client_vb') and etape[1] not in ('controle', 'lecture') then
          raise exception 'ESSAI_MAL_ECRIT : le profil % ne sert qu''à un contrôle ou à une lecture, qui s''annulent', etape[3];
        end if;
        begin
          if etape[3] in ('membre', 'chef_simple') then
            insert into cabinet_admins (user_id, cabinet_id, role)
              values (client, cabinet, case etape[3] when 'membre' then 'comptable' else 'comptable_en_chef' end);
            if etape[3] = 'membre' then
              insert into dossier_assignations (dossier_id, user_id) values ((ids ->> 'D1')::uuid, client);
            end if;
          elsif etape[3] = 'client_vb' then
            insert into memberships (user_id, dossier_id, role, droit_ventes, droit_banque) values (client, (ids ->> 'D1')::uuid, 'client', true, true);
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
        perform set_config('jd.contrepartie_encaissement', '', true);
        perform set_config('jd.validation_exercice', '', true);
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
    'ok', avant = apres and not exists (select 1 from dossiers where nom like 'ESSAI VF4B%')
      and not exists (select 1 from cabinet_admins where user_id = client));

  perform set_config('essai.ecritures_ventes', verdicts::text, true);
end $essai$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.ecritures_ventes')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
