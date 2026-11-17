# 56 — Les options par cabinet : des modules que le super-administrateur ouvre ou ferme

Conçu le 17/11/2026, sans code de l'application ni écriture en base. La demande du cabinet, du même jour, mot pour mot :
« tout en continuant ce qu'on fait j'aimerai qu'on mette les fonctionalité en option sur l'application. que je puisse
choisir quelle option a chaque cabinet. »

Le besoin qui la motive, celui d'un expert-comptable rencontré le même jour, rapporté par le cabinet : « une application de
precompta qui puisse envoyé a son logiciel de compta et avec l'import noemi ou autre pour les professionel de santé pour
qu'il puisse faire le raprochement entre ce que la secu paye et ce qu'elle doit payer. import de relévé et import de
bordereau. en gros si on peut gerer la PA+precompta+Noemi (ou autre pour les autre professionel de santé) » (PA : la
plateforme agréée de facturation électronique).

Ce qui se lit avant : CLAUDE.md, « Objectif et périmètre » (« un cabinet non inscrit en reste à la précomptabilité »),
« Les droits sont en base », « Un resserrement vient en dernier » ; docs/conceptions/53-import-noemie-et-remboursements.md ;
RGPD.md §8.7 ; HISTORIQUE.md → « NOE4 : L'ÉCRAN D'IMPORT DES PAIEMENTS DE L'ASSURANCE MALADIE », « LA BANQUE DU CLIENT : LE
RESSERREMENT APPLIQUÉ ».

## 0. En douze lignes

1. L'application se découpe en un **socle** toujours présent (le cabinet, ses dossiers, les pièces, la banque, le brouillon
   et ses exports : la précomptabilité) et **huit modules** optionnels (§ 1.3), chacun avec ses dépendances.
2. Le réglage vit dans une **table à lui**, `options_des_cabinets` (une ligne par cabinet et par module), écrite par une
   fonction réservée au super-administrateur ; le cabinet la lit, ne l'écrit pas. Pas une colonne de `cabinets` : la policy
   `cabinets_update` ouvre au chef TOUTES les colonnes de sa ligne (§ 2.1, et le défaut qu'elle révèle, § 2.6).
3. L'application lit les options une fois par session, dans un contexte ; illisibles, elle tombe du côté FERMÉ (le socle
   seul, un bandeau) et n'écrit rien de ce qu'elle n'a pas lu.
4. « Éteinte » se gradue (§ 3) : **toujours** à l'écran (onglets, routes, tuiles, cases d'accès, cartes non montés) et dans
   les Edge Functions qui coûtent ou parlent à un tiers (403 avant toute dépense) ; **en base, seulement** pour les
   écritures qui franchissent la frontière de l'exercice professionnel — valider un exercice, passer une écriture libre,
   publier une situation — par des déclencheurs sur leurs tables, sans remplacer aucune fonction. Jamais un refus de LECTURE.
5. Une option éteinte ne supprime rien : ses données restent en base, comptent dans les moteurs comme avant, partent dans la
   sauvegarde, le pack, le FEC et le paquet d'archive. L'extinction se refuse quand un dossier en dépend pour ses chiffres.
6. Tout cabinet existant reçoit tous les modules ouverts ; rien ne change pour le MVP ; aucun lot n'y entre.
7. Le cabinet non inscrit à l'Ordre se tient par là : le module « Tenue et déclarations » reste fermé, et la base le dit.
8. L'offre « précompta + PA + NOEMIE » existe aux trois quarts : le relevé, les pièces, le brouillon et le FEC sont en ligne ;
   la PA est en ligne (sauf l'essai réel) ; NOEMIE est faite jusqu'à NOE4 derrière son drapeau.
9. « Envoyer à son logiciel de compta » : le FEC de l'onglet Écritures le fait déjà, au format légal ; un format propre à un
   logiciel attend son nom et sa spécification publique (OPT-Q5).
10. « Ce que la sécu doit payer » suppose de connaître ce qui a été FACTURÉ : l'export CSV du logiciel de facturation du
    praticien le porte, lu dans le navigateur comme NOEMIE, des agrégats seuls (OPT-Q6).
11. « L'import de bordereau » heurte RGPD.md §8.7 et la décision NOEMIE (« que les chiffres ») : exposé, pas tranché (OPT-Q6).
12. Sept lots OPT1 à OPT7, sept questions OPT-Q1 à OPT-Q7 (§ 8).

## 1. L'inventaire, tiré de la source

### 1.1 Ce qui a été lu (17/11/2026)

- `src/lib/ongletsDossier.ts` : les vingt-deux `DossierTab`, en six groupes (`GROUPES_SANS_CAISSE`, plus Caisse et
  Inventaire derrière `CAISSE_EXPORTEE` et `INVENTAIRE_EXPORTE`).
- `src/App.tsx` : les routes du cabinet (`/dossiers`, `/equipe`, `/apparence`, `/comptes-master`, `/securite`) et celles de
  l'espace client, chacune derrière un prédicat (`mesVentesOuvertes`, `maBanqueOuverte`, `maCaisseOuverte`,
  `mesComptesOuverts`, `mesDocumentsOuverts`, `lettresDuClientOuvertes`, `mesAchatsOuverts`, `mesNotesDeFraisOuvertes`,
  `monAnalyseOuverte`, `maTresorerieOuverte`) ; toujours montées : `/accueil`, `/mes-pieces`, `/mes-informations`,
  `/ma-simulation`, `/mon-echeancier`, `/securite`.
- `src/lib/droitsAcces.ts` : les sept cases d'un accès (`droit_ventes`, `droit_banque`, `droit_caisse`, `droit_comptes`,
  `droit_achats`, `droit_frais`, `droit_documents`).
- `supabase/functions/` : seize Edge Functions.
- L'export du schéma pour `cabinets` : `cabinets_select`, `cabinets_update` (`est_chef_du_cabinet(id)`, toutes colonnes),
  les colonnes `limite_ia_alerte_usd` et `limite_ia_blocage_usd` (20260909085242), aucune garde sur elles.

### 1.2 Le socle, toujours présent

| Étage | Ce qu'il porte |
|---|---|
| Cabinet | création et suppression (`create-cabinet`, `delete-cabinet`), équipe (`create-team-member`), charte, sécurité du compte, double authentification, modèle de plan du cabinet, sauvegarde, restauration, export du cabinet, copie des fichiers, départ d'un client |
| Dossier | Vue d'ensemble, Informations du dossier, Accès client (l'accès lui-même et le dépôt de pièces), Justificatifs, Documents administratifs, Packs ; le statut de TVA du dossier (aujourd'hui dans l'onglet TVA, § 1.5) |
| Pièces | dépôt, OCR et citation (`extract-piece`, `taux-change-bce`), réception par e-mail (`receive-email`), relance de pièces (`send-email`, son usage « pièces ») |
| Espace client | accueil, « Mes pièces », « Mes informations », « Mon échéancier », « Sécurité du compte » |

**Le socle comprend la précomptabilité** (le module P ci-dessous est réputé toujours ouvert) : rien dans l'application ne
tourne sans les pièces et le relevé, tous les moteurs les lisent, et la demande de l'expert-comptable en fait la base de
l'offre. Le séparer créerait un module qu'aucun cabinet ne fermerait.

### 1.3 Les modules

| Module | Ce qu'il ouvre (onglets, écrans client, Edge Functions, cases) | Suppose |
|---|---|---|
| **P — Précomptabilité** (socle) | Banque (import CSV, OFX, QIF, rapprochement, règles, lots), Caisse, Écritures (le brouillon, l'export du FEC et de la piste d'audit), Balance des comptes, Virements, Cotisations (les échéances et leur rapprochement), Financement (les échéances d'emprunt rapprochées) ; la case « Caisse » et « Ma caisse » | — |
| **T — Tenue et déclarations** | Clôture (la validation de l'exercice), Bilan, Révision, Inventaire, Immobilisations, Suppléments, Estimation, la section CA3 de l'onglet TVA, la 2035, la 2035-SD, la 2035-E, le volet social, l'écriture libre, le dégel ; la case « Comptes » et « Mes comptes » (une situation publiée) | P |
| **F — Facturation** | Factures émises (factures, avoirs, devis, acomptes, articles, clients, relances, encaissements, la bascule des ventes), `send-email` (usages « facture », « devis », « relance d'une facture ») ; la case « Ventes » et « Mes ventes » ; la carte des RIB à confirmer | P |
| **E — Facture électronique (plateforme agréée)** | CII, dépôt, cycle de vie, message « Encaissée », e-reporting, adresse de réception, réception par la plateforme ; `superpdp-credentials`, `superpdp-sync`, `superpdp-emit`, `plateforme-agreee` ; « Tes plateformes » | P ; F pour l'émission (la réception et l'e-reporting des achats n'en ont pas besoin) |
| **N — Paiements de l'assurance maladie (NOEMIE)** | la section d'import de Banque et de « Ma banque » (`PaiementsAssuranceMaladie.tsx`), le rapprochement (NOE5), les contrôles (NOE6) ; demain les encours facturés (OPT-Q6) | P ; côté client, la case « Banque » (NOE-Q1), donc C |
| **C — Espace client « logiciel de gestion »** | les cases « Banque », « Achats », « Notes de frais », « Documents » et leurs écrans : « Ma banque », « Mon année », « Ma trésorerie », « Mon analyse », « Mes achats », « Mes notes de frais », « Mes documents », « Mes demandes », « Mes lettres de mission » | P ; « Mes lettres de mission » suppose H ; « Mon analyse » ouverte par « Ventes » suppose F |
| **A — Assistant IA** | l'assistant du dossier (`agent-comptable`), la proposition de catégorie (`proposer-categorie`) | P |
| **H — Honoraires du cabinet** | le dossier du cabinet, les lettres de mission, « À facturer », le dépôt des honoraires chez le client | F (ses factures sont celles du dossier du cabinet) |
| **B — Connexion bancaire** | `banque-connexion`, la carte de connexion (Enable Banking, bac à sable, prestataire sur devis) | P |

`evaluer-extraction` est un harnais de mesure, hors des modules (sa fenêtre datée le ferme). Le module T se découpera peut-être
plus tard (la tenue d'un côté, les déclarations de l'autre) ; un seul module suffit à la demande et au cabinet non inscrit.

### 1.4 Les dépendances, en règle

- Ouvrir un module ouvre ce qu'il suppose (E ouvre F seulement si l'émission est voulue : E sans F est permis, réception et
  e-reporting des achats seuls).
- Fermer un module se refuse tant qu'un module ouvert le suppose (fermer F sous H : refusé, la phrase nomme H).
- Une case d'accès client ne s'offre que si son module est ouvert ; « Banque » ouvre l'import NOEMIE au praticien seulement si
  N l'est aussi.

### 1.5 Ce que le découpage révèle

- **L'onglet TVA porte deux modules** : le statut de TVA du dossier (le socle : le montant retenu HT ou TTC en dépend,
  `lib/montantRetenu.ts`, et l'avis de la case « Caisse ») et la CA3 (T). Il se monte toujours ; sa section CA3 suit T.
- **Écritures appartient à P, Clôture à T** : le brouillon et son FEC sont la livraison de la précomptabilité ; valider
  l'exercice (« arrêter » les comptes) est l'acte de la tenue.
- **La Vue d'ensemble** déclare ses points par module (`lib/pointsDeLaChecklist.ts`) : les points de la validation, du bilan,
  de la révision ne se disent qu'avec T.
- **« Ma simulation »** (toujours montée côté client) appelle l'estimation des cotisations, qui est de T : elle suit T.

## 2. Où vit le réglage

### 2.1 La table

`options_des_cabinets` : `cabinet_id` (clé étrangère, `on delete cascade` : la suppression d'un cabinet l'emporte sans toucher
à `delete-cabinet`), `module` (liste fermée par un `check` : `tenue`, `facturation`, `facture_electronique`,
`assurance_maladie`, `espace_client`, `assistant`, `honoraires`, `connexion_bancaire` ; P n'y figure pas, il est le socle),
`ouverte` (booléen non nul), `changee_par` et `changee_le` posés par la base. Clé primaire (`cabinet_id`, `module`), TOTALE.

**Pourquoi pas une colonne de `cabinets`** : la policy `cabinets_update` (20260908085839) ouvre au chef du cabinet toutes les
colonnes de sa ligne ; une option posée là, le chef se l'ouvrirait par l'API. Le dossier du cabinet a dû poser une garde
pour sa seule colonne (20261112140859, `garder_dossier_du_cabinet`) ; une table à part n'en a besoin d'aucune.

**Pourquoi une ligne par module plutôt qu'une colonne par module** : un module neuf est une valeur de la liste fermée et une
ligne par cabinet, sans changer la forme de la table ni `types.ts`.

### 2.2 Qui écrit, qui lit

- **Écrire** : `regler_option_du_cabinet(cabinet, module, ouverte)`, `security definer`, `is_super_admin()` seul, vérifié
  avant toute lecture ; elle juge les dépendances (§ 1.4) et l'extinction gardée (§ 4), refuse en P0001 avec sa raison ;
  aucune policy d'écriture. Le chef d'un cabinet ne règle pas ses options.
- **Lire, côté cabinet** : une policy `select to authenticated` sur `admin_du_cabinet(cabinet_id)`.
- **Lire, côté client** : `modules_ouverts_du_dossier(dossier)`, `security definer`, au cabinet du dossier
  (`admin_du_dossier`) et à son accès client (`client_du_dossier`), qui ne rend que la liste des modules ouverts ; la table
  reste fermée au client.
- Toute porte `to authenticated` ; la restrictive `deux_facteurs` sous condition (`deuxFacteursDesTablesNeuves.test.ts`) ;
  aucune garde `security definer` sur la table, donc pas de porte `_acces_avant_les_gardes` ; les droits hors RLS de
  naissance (`droits_hors_rls`).
- La migration insère, pour chaque cabinet existant, une ligne `ouverte = true` par module : rien ne change le jour de son
  application.

### 2.3 La lecture par l'application

- **Une lecture par session**, au chargement de la coque, dans un contexte (`OptionsDuCabinetProvider`, sur le modèle
  d'`AuthContext` : relue au changement d'IDENTIFIANT du cabinet ou du dossier actif, jamais à chaque retour sur l'onglet).
  Côté client, par `modules_ouverts_du_dossier` du dossier actif, sous la clé du dossier (« Une page ne se remonte pas d'un
  dossier à l'autre »).
- **Illisible, elle tombe du côté FERMÉ** : seul le socle se monte, un bandeau dit « Les options du cabinet n'ont pas pu être
  lues » (la doctrine « un échec tombe du côté fermé ») ; avant le retour, « Chargement… » (« le vide est une affirmation »).
- **Un module pur** (`lib/modulesDuCabinet.ts`) porte la liste fermée, les dépendances et les tables d'appartenance (§ 6) ;
  les navigations l'appellent (`groupesDuParcours` reçoit les modules ouverts en paramètre OBLIGATOIRE, comme ses drapeaux).

### 2.4 Le grain

Le cabinet, comme la demande. Un réglage par dossier (un praticien sans NOEMIE dans un cabinet qui l'a) n'est pas demandé ;
la table le permettrait plus tard par une seconde table, sans rien changer à celle-ci.

### 2.5 L'écran du super-administrateur

`SuperAdminPage` : par cabinet, les huit modules en cases, les dépendances dites avant le clic, l'extinction refusée dite
avant le clic aux mots de la base (§ 4), la confirmation qui nomme ce qui disparaît des écrans ; à la création d'un cabinet,
le choix des modules (OPT-Q3).

### 2.6 Un défaut relevé en concevant : le plafond de l'assistant, modifiable par le chef

Lu dans l'export, **à confirmer en base** avant tout lot (`pg_policies`, `pg_trigger` sur `cabinets`) : les deux plafonds de
l'assistant (`limite_ia_alerte_usd`, `limite_ia_blocage_usd`), « réservés aux super-admins » selon leur migration, sont des
colonnes de `cabinets`, que `cabinets_update` ouvre au chef sans garde. Un chef peut donc lever son propre plafond de blocage
par l'API (l'écran ne l'offre pas). Le coût mensuel du cabinet n'est plus borné par le super-administrateur. Remède proposé
(OPT-Q7) : une garde en base, dans la migration d'OPT1, qui refuse tout changement de ces deux colonnes hors du
super-administrateur — additive, sans rien supprimer.

## 3. Ce que « éteinte » veut dire, étage par étage — la question de sécurité

### 3.1 Ce que l'option n'est pas

Une option n'est **pas une frontière de confidentialité** : elle ne change pas QUI lit QUELLES données. La RLS sépare déjà
les cabinets entre eux et le cabinet de son client ; une option fermée ne cache au cabinet que des fonctions qu'il n'a pas
souscrites, sur ses propres données. Un contournement de l'écran par l'API n'expose rien à personne : c'est un usage hors
contrat, pas une fuite. C'est ce qui permet de ne pas tout refuser en base.

Une exception : le **cabinet non inscrit à l'Ordre** (§ 5). Là, l'option porte une limite d'exercice professionnel, et ce que
« les droits sont en base » demande vaut pour elle.

### 3.2 Les quatre étages

| Étage | Ce qui se passe, option fermée | Quand |
|---|---|---|
| 1. Écran | l'onglet, la route, la tuile, l'entrée de menu, la carte ne se montent pas ; une adresse directe mène au socle et le dit (« Ce module n'est pas ouvert à votre cabinet ») ; une case d'accès client n'est pas offerte | toujours |
| 2. Edge Functions | celles du module refusent en 403 français AVANT toute dépense (Bedrock, Textract, plateforme, Enable Banking, Resend), options illisibles en 503 ; `send-email` juge l'usage | toujours |
| 3. Base, écritures | des déclencheurs `before insert` refusent, P0001 avec la raison, l'entrée dans les tables qui franchissent la frontière de T : `exercices_valides` (la validation), `ecritures_libres` (EL2, quand elle sera appliquée), `situations_publiees` | module T seul (OPT-Q1, OPT-Q4) |
| 4. Base, lectures | aucune : une lecture que la RLS refuse rend zéro ligne sans erreur, et un écran ou un moteur croirait le dossier vide (CLAUDE.md, « Un resserrement vient en dernier ») | jamais |

**Pourquoi des déclencheurs et pas les fonctions** : `valider_exercice` est déjà remplacée par cinq chantiers préparés (les
gardes allégées, INV3, LIA5, AFF3, EXD3), chacun partant du corps en production le jour de son collage ; une sixième
réécriture les heurterait toutes (`remplacementsDesPreparees.test.ts`). Un déclencheur sur la table qu'elle écrit ne touche
à aucun corps ; il juge le cabinet du dossier de la ligne, lit `options_des_cabinets` (security definer, `search_path` fixé),
et laisse passer le super-administrateur (la restauration) et la restauration elle-même.

**Pourquoi pas tout en base** : il faudrait une garde à l'entrée de chaque fonction et de chaque table des huit modules
(plusieurs dizaines), chacune à rejouer, pour un risque qui n'est pas une fuite (§ 3.1) ; et les prédicats des cases
(`gere_les_ventes`, `gere_la_banque`…) resserrés rendraient zéro ligne aux écrans d'avant. Si le cabinet le veut plus tard,
l'ordre est fixé : l'écran d'abord (étage 1, déployé), puis la base.

### 3.3 Les cases d'accès client déjà cochées

Une case dont le module se ferme reste en base (`memberships` intacte : la rouvrir rend l'accès tel qu'il était) ; ses écrans
ne se montent plus ; `changer_droits_acces` ne refuse rien (étage 3 réservé à T). Le client garde, par l'API, la lecture de
son propre dossier sous cette case : ce sont ses données (§ 3.1).

## 4. Les données d'une option éteinte

- **Jamais supprimées** : éteindre n'écrit rien ailleurs que dans `options_des_cabinets`.
- **Toujours comptées** : un moteur ne lit pas les options. La 2035 d'un dossier basculé lit ses factures sources que F soit
  ouvert ou non ; une option ne change jamais un chiffre.
- **Toujours exportées** : sauvegarde, pack, export du cabinet, FEC, piste d'audit, paquet d'archive du départ ; elles
  restent la mémoire de la comptabilité (six ans au titre du LPF, art. L. 102 B ; dix ans au code de commerce, art.
  L. 123-22).
- **Lisibles ?** Recommandé : non à l'écran, sauf ce qu'un écran du socle en montre déjà (une pièce citée, une écriture du
  brouillon) ; l'export les porte. Une lecture seule par module coûterait un second état par écran (OPT-Q2).
- **L'extinction gardée** : `regler_option_du_cabinet` refuse de fermer un module dont un dossier dépend pour ses chiffres ou
  ses obligations — F quand un dossier est basculé (ses ventes passent par ses factures, irréversiblement : sans l'écran, plus
  d'avoir ni d'encaissement) ; E quand une transmission est active ou un encaissement à déclarer ; N quand un paiement est
  associé à un crédit (NOE5). La phrase nomme les dossiers. Le critère exact se fixe en OPT1, liste fermée par module.

## 5. Le cabinet non inscrit à l'Ordre

CLAUDE.md : « Tenir la comptabilité d'autrui étant réservé aux experts-comptables inscrits à l'Ordre, l'application est leur
logiciel, ou celui d'un praticien qui tient la sienne ; un cabinet non inscrit en reste à la précomptabilité. » L'ordonnance
n° 45-2138 du 19/09/1945, art. 2, réserve à l'expert-comptable de « tenir, centraliser, ouvrir, arrêter, surveiller, redresser
et consolider les comptabilités » (Légifrance), et son art. 20 sanctionne l'exercice illégal.

**Les options sont le moyen de le tenir** : un cabinet non inscrit reçoit le socle (la précomptabilité), F, E, N, C, A, B
selon son offre — **jamais T**. Fermé, T ôte la validation de l'exercice (« arrêter »), le bilan, la révision, les
déclarations, l'écriture libre ; et l'étage 3 le tient en base, puisqu'ici l'option porte une limite légale (§ 3.1).

**Ce que l'application ne sait pas** : si un cabinet est inscrit. Le super-administrateur le vérifie à la main (le tableau
de l'Ordre est public) avant d'ouvrir T. **La frontière exacte** entre précomptabilité et tenue n'est pas tranchée par les
textes que j'ai lus ; celle proposée (le brouillon et son export à P ; la validation et tout ce qui la suit à T) est à
confirmer par le cabinet (OPT-Q4). Le praticien qui tient sa propre comptabilité est un cabinet à un dossier, T ouvert.

## 6. L'offre « précompta + PA + NOEMIE » : ce qui existe, ce qui manque

### 6.1 Ce qui existe

| Demande | Dans l'application |
|---|---|
| Import de relevé | en ligne : CSV, OFX, QIF (`lib/importReleve.ts`, `lib/releveOfxQif.ts`), contrôle de solde, plusieurs comptes (MCB) |
| Précompta | en ligne : dépôt, OCR, classification, rapprochement, règles, caisse, brouillon par pièce et par mouvement |
| Envoyer au logiciel de compta | en ligne : « Exporter FEC » et « Exporter la piste d'audit » de l'onglet Écritures (`lib/fec.ts`, article A47 A-1, 18 colonnes ; 22 derrière `CHAMPS_BNC_EXPORTES` baissé) ; le pack (ZIP, XLSX) porte les pièces |
| PA | en ligne : Super PDP et la plateforme du client (`connexions_plateformes`), réception, dépôt, cycle de vie, e-reporting ; restent l'essai réel, d6, e7c, e8 |
| NOEMIE | NOE1 à NOE4 faits (le module, la migration préparée, l'écran), derrière `PAIEMENTS_ASSURANCE_MALADIE_PREVUS` baissé ; restent NOE5 (l'association au relevé), NOE6, NOE7, NOE8 |

### 6.2 « Envoyer à son logiciel de compta »

Le FEC est le format que la loi impose à toute comptabilité informatisée et que les logiciels du marché savent généralement
relire ; c'est l'usage que le commentaire d'`EcrituresTab.tsx` lui donne déjà (« un fichier directement importable dans son
propre logiciel de comptabilité »). **Non établi** : que le logiciel de cet expert-comptable importe un FEC comme des
écritures courantes (certains ne le relisent que pour une reprise d'à-nouveaux), et sous quelles options (journaux, comptes
auxiliaires, pièces jointes). **Ce qu'il faudrait** pour un format propre : le nom du logiciel et sa spécification d'import
PUBLIQUE ; un adaptateur pur par format (`lib/exportsVersLogiciels/<format>.ts`) qui part des MÊMES lignes que le FEC
(`numeroterFec`), jamais d'une seconde composition — deux compositions divergeraient au premier défaut ; un test qui confronte
l'adaptateur au FEC ligne à ligne. Question OPT-Q5.

Un point à garder : le FEC d'un exercice non validé est un état du brouillon ; l'export doit le dire dans son nom ou son
en-tête de livraison, pour que l'expert-comptable ne le prenne pas pour un exercice arrêté.

### 6.3 « Ce que la sécu paye et ce qu'elle doit payer »

NOEMIE dit ce qui est **payé** (et rejeté). « Ce qu'elle doit payer » est ce qui a été **facturé** en tiers payant et n'est
pas encore payé : l'encours sur l'assurance maladie. Il n'est que dans le logiciel de facturation SESAM-Vitale du praticien,
dont le « suivi des factures en tiers payant » montre l'état de chaque facture (payée, rejetée, en attente) et exporte les
paiements (ameli.fr, cité au § 2 de la conception 53). Ce que cela demande, sans patient :

- lire l'export CSV de ce suivi dans le navigateur, par le réglage des colonnes de NOE4 (une ligne une facture), en ajoutant
  le statut « en attente » et la date de la facture (ou de sa transmission) ;
- n'en garder que des agrégats : par mois de facturation et par part, le facturé, le payé, le rejeté, l'en attente ; l'en
  attente par tranche d'ancienneté (moins de 30 jours, 30 à 60, plus de 60) ; aucun numéro de facture, aucune date de soins ;
- une table d'agrégats de plus, sans colonne de texte, sur le patron de NOE3 ;
- le contrôle : l'encours du mois M, plus les paiements des mois suivants, contre le facturé ; l'ancien en attente en point
  d'attention. La facture une à une reste le travail du logiciel du praticien, qui le fait déjà.

Une limite : la part qui ne passe pas par l'assurance maladie (le patient qui paie lui-même, une complémentaire hors du
retour) n'y est pas. « Ou autre pour les autres professionnels de santé » : NOEMIE couvre tous les professionnels qui
télétransmettent ; un retour propre à une complémentaire n'est pas établi ; le réglage des colonnes lit tout export CSV qui
a la même forme (une ligne une facture, un statut, un montant).

### 6.4 « Import de bordereau » : le heurt

Un bordereau de télétransmission liste des patients. Deux décisions en vigueur s'y opposent :

- RGPD.md §8.7 (24/09/2026) : pas d'hébergement HDS, sous la condition qu'aucune donnée de patient n'entre ; « le praticien
  n'a pas le droit de transmettre ses bordereaux de télétransmission à son expert-comptable » (CSP, art. L.1110-4 ; code
  pénal, art. 226-13) ;
- la décision du 16/11/2026 pour NOEMIE : « on récupère que les chiffres et on stocke pas de données patients ».

Les voies, sans trancher :

- **(A) des agrégats lus dans le navigateur**, depuis l'export CSV du logiciel (§ 6.3) — pas depuis le bordereau : le fichier
  ne part nulle part, rien d'identifiant n'est gardé, la preuve en base par l'absence de toute colonne de texte (le patron de
  NOE3) ; le mot « bordereau » de l'expert-comptable recouvrirait alors « ce qui a été facturé » ;
- **(B) le bordereau PDF lu dans le navigateur**, agrégats seuls : même garantie, mais un format de PDF non publié, propre à
  chaque logiciel, lu par `pdfjs-dist` sur une supposition ; et l'écran inviterait à manipuler un document que la consigne du
  §8.7 dit de ne pas transmettre (le cabinet qui importe l'a en main, comme pour NOEMIE-Q1) ;
- **(C) refuser** : NOEMIE seul (le payé), sans le facturé ;
- **(D) garder les bordereaux** : rouvre §8.7, exige un hébergeur certifié HDS ; écartée tant que le cabinet ne revient pas
  sur la décision du 24/09/2026.

Question OPT-Q6.

## 7. Les lots

| Lot | Ce qu'il fait | Préalable |
|---|---|---|
| OPT1 | La migration, préparée par l'outil : `options_des_cabinets`, `regler_option_du_cabinet`, `modules_ouverts_du_dossier`, toutes les lignes ouvertes pour les cabinets existants, la garde des plafonds de l'assistant (OPT-Q7) ; l'essai `optionsDesCabinets.sql`, son bloc dans `rls.sql` ; drapeau `OPTIONS_DES_CABINETS_PREVUES` baissé | OPT-Q1, Q2, Q7 ; vérifier § 2.6 en base |
| OPT2 | `lib/modulesDuCabinet.ts`, pur : la liste fermée, les dépendances, `MODULE_DE_L_ONGLET` (un `Record<DossierTab, Module>`, que le compilateur ferme), `MODULE_DE_LA_ROUTE` (espace client), `MODULE_DE_LA_CASE` (accès), `MODULE_DE_LA_FONCTION` (Edge Functions), les mots des refus ; le scanner `modulesDeclares.test.ts` | — |
| OPT3 | La lecture (`optionsDuCabinetLecture.ts`, côté fermé), le contexte, et le branchement : `groupesDuParcours` (paramètre obligatoire), `TABS_VALIDES`, les routes de `App.tsx`, les tuiles de l'accueil client, les cases de l'onglet Accès, les points de la Vue d'ensemble, la section CA3 de l'onglet TVA, les cartes du tableau de bord | OPT1, OPT2 |
| OPT4 | L'écran du super-administrateur et le choix des modules à la création d'un cabinet (`create-cabinet`) | OPT1, OPT3, OPT-Q3 |
| OPT5 | Les Edge Functions : un bloc copié `── DÉBUT/FIN OPTION DU CABINET ──`, gardé par un `…Copie.test.ts`, 403 avant toute dépense, dans les sept fonctions de modules et dans `send-email` par usage ; le harnais HTTP joue l'option fermée (`contratsFonctions.ts`) | OPT1, OPT2 |
| OPT6 | En base, la frontière de T : trois déclencheurs `before insert` (`exercices_valides`, `situations_publiees`, `ecritures_libres` sous condition que la table existe), préparés APRÈS le déploiement d'OPT3 (le resserrement vient en dernier) ; l'essai, ses mutations | OPT3 en ligne, OPT-Q1, Q4 |
| OPT7 | La mise en production : OPT1 par l'outil, le drapeau levé, les essais, les trois contrôles de l'export ; puis OPT5 déployée ; puis OPT6 | tout |

Hors des lots OPT, l'offre de l'expert-comptable : NOE5 à NOE8 (déjà conçus), un adaptateur d'export après OPT-Q5 (EXP1),
les encours facturés après OPT-Q6 (NOE9, sur le patron de NOE3 et NOE4).

**Le MVP** : aucun lot OPT n'y entre ; rien ne le retarde. Le dossier du MVP est dans un cabinet qui garde tous ses modules ;
la migration d'OPT1 ne change rien ce jour-là. Recommandé : OPT2 (pur, sans base) quand un agent est libre, OPT1 et OPT3
après la répétition générale, OPT6 après la 2035 de mai 2027 ou dès qu'un cabinet non inscrit arrive.

**Les tests** : le scanner d'OPT2 part de TOUT (`DossierTab`, les `<Route>` de l'espace client lues dans `App.tsx`, les sous-
dossiers de `supabase/functions/`, les colonnes `droit_*`) ; une forme non reconnue est une faute ; un plancher distingue
« zéro faute » d'« aveugle » ; éprouvé par un onglet planté sans module. `DossierParcours.test.tsx` déroule chaque groupe sous
« tous ouverts », « socle seul » et chaque module seul. `ecransAvantLecture.test.tsx` couvre la lecture des options.

**La sauvegarde** : la table est du CABINET, pas d'un dossier ; la sauvegarde d'un dossier ne la porte pas et ne doit pas la
porter (restaurer un dossier dans un autre cabinet ne lui donne pas les options de l'ancien). Les données de tous les modules
restent au plan de sauvegarde comme aujourd'hui (§ 4). La sauvegarde quotidienne du plan Pro couvre la table ;
PLAN_DE_REPRISE.md reçoit une ligne : après une reprise depuis l'export, le super-administrateur revoit les options.

## 8. Les risques

- **Un écran oublié** reste monté sous une option fermée : le scanner d'OPT2 le voit à la compilation pour les onglets, au
  test pour les routes et les fonctions.
- **Une lecture des options qui échoue** fermerait tout sauf le socle pendant une panne : le bandeau le dit, aucune donnée
  ne bouge ; l'inverse (ouvrir sur échec) montrerait des modules non souscrits.
- **Un moteur qui viendrait à lire les options** changerait un chiffre selon un réglage commercial : interdit, un scanner liste
  les lecteurs de la table (le contexte, les fonctions, le super-administrateur).
- **L'étage 3 sur `exercices_valides`** : un déclencheur de plus sur une table que la restauration et la validation écrivent ;
  l'essai de la validation et `restauration.sql` se rejouent.
- **Le retour arrière** : OPT1 est additive ; son retour retire la table et ses fonctions (un `drop`, donc collé par le
  cabinet) ; l'application d'avant ne lit rien d'elle.

## 9. Points non vérifiés

- § 2.6 (le plafond modifiable par le chef) : lu dans l'export, pas en base.
- Qu'un logiciel de comptabilité donné importe un FEC en écritures courantes (§ 6.2).
- La forme de l'export « suivi des factures en tiers payant » du logiciel du praticien, et s'il porte le statut « en attente »
  (§ 6.3) : à recevoir avec les en-têtes de NOE1.
- La frontière juridique exacte de la précomptabilité (§ 5).

## 10. Les questions au cabinet

```json
[
  {
    "id": "OPT-Q1",
    "chantier": "Options par cabinet (conception 56)",
    "titre": "Où une option fermée est-elle refusée ?",
    "question": "Une option fermée se refuse-t-elle à l'écran seulement, aussi dans les Edge Functions, ou aussi en base ?",
    "contexte": "Une option n'est pas une frontière de confidentialité : elle ne change pas qui lit quelles données. Refuser une lecture en base ferait croire aux écrans un dossier vide (« un resserrement vient en dernier »). Une garde en base à l'entrée de chaque fonction des huit modules coûterait des dizaines de gardes à rejouer, et valider_exercice est déjà remplacée par cinq chantiers préparés.",
    "recommandation": "(A) : l'écran et les Edge Functions toujours ; en base, seulement les écritures qui franchissent la frontière de la tenue (valider un exercice, une écriture libre, publier une situation), par des déclencheurs sur leurs tables, sans remplacer aucune fonction. Aucune lecture refusée.",
    "options": ["(A) Écran et Edge Functions ; en base, la frontière de la tenue seule", "(B) Écran et Edge Functions seulement", "(C) Écran, Edge Functions et toutes les écritures en base"],
    "option_recommandee": "A",
    "source": "docs/conceptions/56-options-par-cabinet.md § 3",
    "pose": "2026-11-17"
  },
  {
    "id": "OPT-Q2",
    "chantier": "Options par cabinet (conception 56)",
    "titre": "Les données d'une option éteinte",
    "question": "Quand une option s'éteint, que deviennent les données déjà saisies, et peut-on l'éteindre quand un dossier en dépend ?",
    "contexte": "Aucune donnée ne se supprime. Une facture validée se garde dix ans ; un dossier basculé compte ses ventes par ses factures, de façon irréversible ; un paiement de l'assurance maladie associé justifie un crédit.",
    "recommandation": "(A) : jamais supprimées, toujours comptées dans les moteurs (une option ne change jamais un chiffre), toujours exportées (sauvegarde, pack, FEC, archive), masquées des écrans ; l'extinction se refuse tant qu'un dossier en dépend, la phrase nomme les dossiers.",
    "options": ["(A) Masquées, comptées, exportées ; extinction refusée si un dossier en dépend", "(B) Comme (A), mais lisibles en lecture seule dans le module éteint", "(C) Comme (A), l'extinction toujours permise"],
    "option_recommandee": "A",
    "source": "docs/conceptions/56-options-par-cabinet.md § 4",
    "pose": "2026-11-17"
  },
  {
    "id": "OPT-Q3",
    "chantier": "Options par cabinet (conception 56)",
    "titre": "Les modules d'un nouveau cabinet",
    "question": "À la création d'un cabinet, quels modules sont ouverts ?",
    "contexte": "Les cabinets existants gardent tous leurs modules. Un nouveau cabinet peut être un cabinet non inscrit à l'Ordre, à qui la tenue ne doit pas s'ouvrir par mégarde.",
    "recommandation": "(C) : le formulaire de création propose trois formules (précompta seule ; précompta, facture électronique et assurance maladie ; complet), sans formule par défaut, chaque case ajustable ensuite.",
    "options": ["(A) Tous ouverts", "(B) Le socle seul, le super-administrateur coche le reste", "(C) Une formule choisie à la création, sans défaut"],
    "option_recommandee": "C",
    "source": "docs/conceptions/56-options-par-cabinet.md § 2.5",
    "pose": "2026-11-17"
  },
  {
    "id": "OPT-Q4",
    "chantier": "Options par cabinet (conception 56)",
    "titre": "La frontière de la précomptabilité, pour un cabinet non inscrit",
    "question": "Pour un cabinet non inscrit à l'Ordre, où passe la frontière entre la précomptabilité et la tenue ?",
    "contexte": "L'ordonnance n° 45-2138, art. 2, réserve à l'expert-comptable de tenir, arrêter, redresser les comptabilités. La conception met le brouillon et son export (FEC, piste d'audit) dans la précomptabilité, et la validation de l'exercice, le bilan, la révision, les déclarations et l'écriture libre dans la tenue.",
    "recommandation": "(A), à confirmer par le conseil du cabinet ou l'Ordre : le brouillon et le FEC restent à la précomptabilité (c'est ce que l'expert-comptable importe) ; tout ce qui arrête ou déclare est à la tenue, refusé en base au cabinet non inscrit.",
    "options": ["(A) Brouillon et FEC à la précomptabilité ; validation, bilan, révision, déclarations, écriture libre à la tenue", "(B) Comme (A), et le brouillon aussi à la tenue : le non-inscrit n'exporte que les pièces classées et le relevé rapproché"],
    "option_recommandee": "A",
    "source": "docs/conceptions/56-options-par-cabinet.md § 5",
    "pose": "2026-11-17"
  },
  {
    "id": "OPT-Q5",
    "chantier": "Offre précompta + PA + NOEMIE (conception 56)",
    "titre": "Le logiciel de comptabilité de destination",
    "question": "Quel logiciel l'expert-comptable utilise-t-il, et sous quel format importe-t-il des écritures ?",
    "contexte": "L'onglet Écritures exporte déjà le FEC (format légal, article A47 A-1), conçu pour être importé dans le logiciel de l'expert-comptable. Qu'un logiciel donné le relise en écritures courantes n'est pas établi ; un format propre demande sa spécification publique.",
    "recommandation": "(A) : essayer d'abord le FEC existant chez l'expert-comptable ; un adaptateur propre seulement si son logiciel ne le relit pas, sur sa spécification publique, tiré des mêmes lignes que le FEC.",
    "options": ["(A) Le FEC d'abord, un adaptateur s'il le faut", "(B) Un adaptateur au format du logiciel d'emblée"],
    "option_recommandee": "A",
    "source": "docs/conceptions/56-options-par-cabinet.md § 6.2",
    "pose": "2026-11-17"
  },
  {
    "id": "OPT-Q6",
    "chantier": "Offre précompta + PA + NOEMIE (conception 56)",
    "titre": "Ce que l'assurance maladie doit payer, et l'import de bordereau",
    "question": "Comment connaître ce qui a été facturé à l'assurance maladie, et faut-il importer les bordereaux ?",
    "contexte": "Un bordereau de télétransmission liste des patients. RGPD.md §8.7 (pas d'hébergement HDS, le praticien ne transmet pas ses bordereaux) et la décision NOEMIE du 16/11/2026 (« que les chiffres ») s'y opposent. Le facturé et l'en attente sont aussi dans l'export CSV du suivi des factures en tiers payant du logiciel du praticien.",
    "recommandation": "(A) : l'export CSV du logiciel lu dans le navigateur, comme NOEMIE ; seuls des agrégats gardés (facturé, payé, rejeté, en attente par mois et par part, l'en attente par ancienneté), aucune colonne de texte ; le bordereau jamais lu ni gardé.",
    "options": ["(A) Agrégats tirés de l'export CSV du logiciel, dans le navigateur", "(B) Agrégats tirés du bordereau PDF, dans le navigateur", "(C) Refuser : les paiements NOEMIE seuls", "(D) Garder les bordereaux : exige un hébergeur HDS, revient sur la décision du 24/09/2026"],
    "option_recommandee": "A",
    "source": "docs/conceptions/56-options-par-cabinet.md § 6.3 et § 6.4",
    "pose": "2026-11-17"
  },
  {
    "id": "OPT-Q7",
    "chantier": "Options par cabinet (conception 56)",
    "titre": "Le plafond de l'assistant, modifiable par le chef",
    "question": "Fermer au chef du cabinet le changement des plafonds de coût de l'assistant ?",
    "contexte": "Lu dans l'export (à confirmer en base) : limite_ia_alerte_usd et limite_ia_blocage_usd, réservés au super-administrateur selon leur migration, sont des colonnes de cabinets que la policy cabinets_update ouvre au chef sans garde : il peut lever son propre plafond de blocage par l'API.",
    "recommandation": "(A) : une garde en base, dans la migration d'OPT1, qui refuse tout changement de ces deux colonnes hors du super-administrateur ; additive, rien de supprimé.",
    "options": ["(A) Une garde en base dans OPT1", "(B) Déplacer les deux colonnes dans une table du super-administrateur (une suppression de colonnes, à coller)", "(C) Laisser en l'état"],
    "option_recommandee": "A",
    "source": "docs/conceptions/56-options-par-cabinet.md § 2.6",
    "pose": "2026-11-17"
  }
]
```
