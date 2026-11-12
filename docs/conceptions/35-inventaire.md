# Les écritures d'inventaire : la conception (ligne 35)

Ligne 35 de la feuille de route, « Écritures d'inventaire — CCA, PCA, FNP, provisions », phase 3, case « Hors BNC ».
Conception rendue le 12/11/2026 par l'architecte, sans code de l'application ni écriture en base. Le récit court est dans
HISTORIQUE.md, à l'entrée « LES ÉCRITURES D'INVENTAIRE : LA CONCEPTION (LIGNE 35) ».

Ce qui se lit avant : HISTORIQUE.md → « LA COMPTABILITÉ D'ENGAGEMENT (BIC, IS), ÉTAPE 1 », « LES DOTATIONS AUX
AMORTISSEMENTS S'ÉCRIVENT », « UN EXERCICE VALIDÉ SE FIGE EN BASE », « LA VALIDATION D'UN EXERCICE ÉCRIT L'OUVERTURE DU
SUIVANT », « LE BILAN SE LIT DANS LES RUBRIQUES DU 2033-A », « L'OUVERTURE CONFRONTÉE AU BILAN QUI LA PRÉCÈDE », « LA
RÉVISION DES COMPTES : LA CONCEPTION », « LE PLAN COMPTABLE PERSONNALISABLE : LA CONCEPTION ».

## 0. En quinze lignes

1. Un dossier en ENGAGEMENT (BIC, IS) reçoit, à chaque clôture, les régularisations que l'inventaire impose : charges et
   produits constatés d'avance (486, 487), factures non parvenues et à établir (408, 418, avec leur TVA d'attente 44586,
   44587), charges à payer et produits à recevoir des comptes rattachés (4286, 4386, 4481, 4482, 439, 1688…), provisions
   pour risques (151, 6815, 7815) et dépréciations des créances (491, 6817, 7817).
2. Rien n'est deviné : chaque régularisation est SAISIE par le cabinet (montant, comptes, justification) ; l'application
   PROPOSE (le prorata d'une facture, la liste de l'an dernier, le solde d'une provision), le clic écrit.
3. Une régularisation vit dans une table à elle (`operations_inventaire`), et ses écritures dans `ecritures_brouillon`,
   qui la CITENT (`operation_inventaire_id`), au journal OD, au 31 décembre ; une fonction `security definer` les recompose
   en entiers et les compare en multiensemble à ce que l'application propose, comme les dotations.
4. Les régularisations « à extourner » (toutes, sauf les provisions) écrivent DANS LE MÊME GESTE leur contre-passation au
   1er janvier suivant (PCG, art. 1214-40, 1214-41, 1214-48) : la paire naît, change et se retire ensemble (INV-Q1).
5. Une provision ne s'extourne pas : elle se réajuste à chaque clôture par différence, dotation ou reprise (PCG, art.
   1211-15 et 1214-49), suivie risque par risque et créance par créance (`provisions`).
6. La validation de N fige l'opération et ses écritures de N ; l'extourne en N+1 est gardée par la même garde, et la
   validation de N+1 refuse une extourne absente ou altérée (filet).
7. Un dossier en TRÉSORERIE (BNC, 2035) n'est touché par rien : les fonctions le refusent, l'écran ne s'y monte pas, la
   2035 ne change pas.
8. Le bilan 2033-A les range déjà (`lib/bilan.ts`) ; le point `inventaire-non-revu` se refonde sur l'état d'inventaire
   déclaré, et sa liste de comptes passe à la numérotation de 2026 (un défaut relevé en concevant, § 1.3).
9. Le FEC les écrit au journal OD sous une sorte à elles (`inventaire`), PieceRef l'état d'inventaire de l'exercice.
10. La révision les PROPOSE comme preuves des soldes 486, 487, 408, 418, 15, 491 (R3) et en fait un travail du cycle de
    clôture (R4) ; l'assistant les lit, sans jamais les écrire.
11. Douze rôles neufs au catalogue (`roles_comptables`), dont aucun n'empiète sur le 467 ni le 468 (INV-Q2).
12. Huit lots, environ quinze jours, tous derrière deux drapeaux (`INVENTAIRE_PREVU`, `INVENTAIRE_EXPORTE`) ; une migration
    non destructive par lot de base (INV2, INV3, INV4), dont une qui remplace `valider_exercice`.
13. Rien ne passe avant le MVP : la ligne est « Hors BNC » ; elle suit la ligne 31 (engagement) et précède la liasse (37).
14. Douze questions au cabinet, INV-Q1 à INV-Q12, chacune avec sa recommandation (§ 10).
15. Sur la base réelle (12/11/2026) : quatre dossiers, tous en trésorerie ; aucun ne serait touché par la ligne 35.

---

## 1. Le constat

### 1.1 Ce qui s'écrit aujourd'hui à l'inventaire

L'application écrit déjà, au journal des opérations diverses et sans pièce du dossier, quatre écritures d'inventaire ou
assimilées (`src/lib/fec.ts`, la composition des écritures à numéroter) :

| Sorte | Source citée par `ecritures_brouillon` | Date | PieceRef | Fonction qui écrit |
|---|---|---|---|---|
| Dotation aux amortissements | `immobilisation_id` | 31/12 | « Tableau d'amortissement AAAA » | `ecrire_dotation_amortissement` |
| Forfait kilométrique | `vehicule_id` | 31/12 | « Barème kilométrique AAAA » | `ecrire_forfait_kilometrique` |
| Liquidation de la TVA | `declaration_tva_id` | fin de période | la CA3 | `ecrire_liquidation_tva` |
| Paiement personnel d'une cotisation | `cotisation_id` | jour du paiement | relevé du compte personnel | (rapprochement) |

Chacune suit le même patron, qui sera celui de la ligne 35 : une table SOURCE, une colonne de `ecritures_brouillon` qui la
cite, une contrainte « sans autre source » (`ecritures_brouillon_dotation_sans_piece_ni_mouvement`, etc.), une fonction qui
recompose l'écriture en entiers et la compare à celle de l'application, une sorte dans la numérotation du FEC.

### 1.2 Ce qui manque

- **Aucune régularisation de fin d'exercice ne se passe** : ni 486/487, ni 408/418, ni charge à payer, ni provision. Un
  dossier en engagement validé aujourd'hui aurait un résultat faux de tout ce qui chevauche le 31 décembre — ce que le PCG
  appelle le rattachement des charges et produits à l'exercice (art. 832-19 : l'annexe dit « des produits à recevoir et des
  charges à payer au titre de l'exercice » et « des produits et des charges imputables à un autre exercice »).
- **Le code le sait et le dit** : `lib/bilan.ts` porte `COMPTE_D_INVENTAIRE` et le point `inventaire-non-revu`
  (« … et cette écriture ne se passe pas encore dans l'application »).
- **La balance reprise peut en porter** (à-nouveaux d'un dossier repris en engagement) : un 486 ou un 151 repris reste tel
  quel d'année en année, faux dès la première clôture.

### 1.3 Un défaut relevé en concevant (à corriger dans INV6, ou à part)

`COMPTE_D_INVENTAIRE` (`src/lib/bilan.ts`, vers la ligne 444) vaut
`/^(3|15|29|408|418|4286|4287|4386|4387|4486|4487|4686|4687|486|487|49|59)/` : la numérotation d'AVANT 2026. Le plan de
comptes du PCG consolidé au 1er janvier 2026 (art. 1121-1 et sa liste) n'a plus de 4486, 4487, 4686, 4687, 4287 ni 4387 :
l'État range ses charges à payer au 4481 (44812) et ses produits à recevoir au 4482 ; les organismes sociaux leurs produits à
recevoir au 439 ; les « divers » vont au 467 « Divers comptes débiteurs et produits à recevoir » et au 468 « Divers comptes
créditeurs et charges à payer » (art. 1214-46). La règle générale demeure : « Dans les comptes de la classe 4, la terminaison
8 est affectée à l'enregistrement des produits à recevoir et des charges à payer rattachés aux comptes qu'ils concernent »
(PCG 2026, règles de fonctionnement des comptes, I-II). Le point de la Checklist est donc AVEUGLE au 4481, au 4482 et au 439,
et cherche des comptes qui n'existent plus. Le 467 et le 468 ne peuvent pas entrer tels quels dans la liste : le 468 porte le
dirigeant non associé (PC4-Q2, `dirigeant_au_468`) et le rôle `autres_debiteurs_crediteurs`. Correction proposée : la liste
de 2026 (`3|15|29|408|418|4282|4286|4382|4386|4481|4482|439|4098|486|487|49|59|1688|518`), et les sous-comptes que le plan du
dossier déclare pour l'inventaire (rôles du § 4.4). Aucune donnée réelle n'est touchée (aucun dossier en engagement).

### 1.4 L'état réel de la base (lu le 12/11/2026, en lecture seule)

- `dossiers` : quatre lignes, `mode_comptable = 'tresorerie'` pour les quatre.
- `roles_comptables` : trente-deux rôles, aucun de l'inventaire (ni 486, 487, 408, 418, 151, 491, 6815, 6817, 7815, 7817).
  Le rôle `autres_debiteurs_crediteurs` a pour racines `{467, 468}`.
- `ecritures_brouillon` : aucune colonne d'inventaire ; aucune table dont le nom porte « inventaire », « regularis » ou
  « provision ».
- Fonctions d'écriture existantes : `ecrire_dotation_amortissement`, `ecrire_forfait_kilometrique`, `ecrire_liquidation_tva`,
  `ecrire_mouvement_compte_bilan`, `ecrire_vente_facturee`… ; `valider_exercice`, `soldes_a_reporter`, `empreinte_exercice`.

---

## 2. Les sources

- **PCG**, règlement ANC n° 2014-03, version consolidée au 1er janvier 2026 (anc.gouv.fr, téléchargé et lu comme données) :
  - art. 121-1 (image fidèle), 121-3 (régularité, sincérité, importance relative), 121-4 (prudence), 121-5 (permanence des
    méthodes) ;
  - art. 321-1 (définition du passif), 321-5 (« Une provision est un passif dont l'échéance ou le montant n'est pas fixé de
    façon précise »), 321-7 (« Les produits constatés d'avance constituent des passifs »), 322-1 (comptabilisation d'un
    passif) ;
  - art. 832-19 (l'annexe : produits à recevoir, charges à payer, produits et charges imputables à un autre exercice) ;
  - art. 1031-3 (la validation interdit toute modification), 1032-2 (chaque écriture s'appuie sur une pièce justificative
    datée) — déjà cités par la validation ;
  - art. 1121-1 et la liste des comptes : 151, 1511, 1518, 1688, 4081, 4084, 4088, 4098, 416, 4181, 428, 4282, 4286, 438,
    4386, 439, 4481, 44812, 4482, 44586, 44587, 467, 468, 486, 487, 491, 518, 6815, 6817, 7815, 7817 ;
  - art. 1211-15 (provisions : constitution, réajustement « à la fin de chaque exercice », par dotation si elle augmente,
    par reprise si elle diminue ou devient sans objet) ;
  - art. 1214-40 (408 « crédité, à la clôture de la période comptable, du montant, taxes comprises, des factures
    imputables à la période close mais non encore parvenues, dont le montant est suffisamment connu et évaluable […] À
    l'ouverture de la période suivante, ces écritures sont contre-passées ») ;
  - art. 1214-41 (418, le même texte côté clients, « débité […] du montant, taxes comprises […] par le crédit des comptes
    concernés des classes 4 et 7 […] contre-passées ») ;
  - art. 1214-46 (467 et 468) ; art. 1214-48 (486 « débité, en fin d'exercice, par le crédit des comptes de charges
    intéressés. Il est crédité, à l'ouverture de l'exercice suivant, par le débit de ces mêmes comptes » ; 487 de même ;
    « un autre procédé » : la quote-part affectée au 486 dès l'enregistrement de la facture) ;
  - art. 1214-49 (491 : crédités en fin d'exercice par le débit du 6817 ; débités par le crédit du 7817 quand la
    dépréciation devient sans objet, se révèle exagérée, ou que le risque se réalise).
- **Code de commerce**, art. L123-12 (inventaire au moins une fois tous les douze mois), L123-13 (les comptes annuels),
  L123-20 (prudence, amortissements et provisions même en l'absence de bénéfice), L123-21 (seuls les bénéfices réalisés).
  NON VÉRIFIÉ ce jour sur Légifrance : texte connu, cité par les conceptions précédentes ; à relire avant INV2.
- **CGI**, art. 39, 1-5° (déductibilité des provisions : nettement précisées, événements en cours rendant probables, constatées
  dans les écritures, figurant au relevé des provisions) ; art. 38, 2 bis (rattachement des produits). NON VÉRIFIÉ ce jour
  sur Légifrance ; le relevé des provisions est le tableau 2033-D de la liasse simplifiée (ligne 37), hors de cette ligne.
- Les normes AFNOR XP Z12-012 et XP Z12-013 ne sont pas utilisées (décision du 07/10/2026).

---

## 3. Les principes

### 3.1 La saisie du cabinet, jamais devinée

- Une régularisation est une DÉCISION du cabinet (NP 2300 § 12, repris par la conception de la révision : l'expert-comptable
  « propose les écritures comptables d'inventaire » sur la base des informations de la direction). L'application ne la
  déduit jamais d'une pièce, d'une date ni d'un montant.
- Elle PROPOSE, et le dit :
  - le prorata d'une pièce qui porte une période (assurance, abonnement, loyer) : le cabinet saisit les dates de début et
    de fin de la période couverte, l'application calcule en jours réels la part postérieure au 31 décembre (INV-Q6) ; le
    montant ÉCRIT est celui que le cabinet confirme ;
  - la liste des régularisations de l'exercice précédent, sans montant (INV-Q12) ;
  - pour une provision, son montant au 31 décembre précédent et l'écart que sa nouvelle évaluation produira ;
  - pour une dépréciation de créance, le reste dû hors taxes de la facture citée (lu au registre des encaissements).
- Une saisie RETIENT la version qu'elle remplace (`version_lue`) ; une confirmation NOMME ce qui part (les comptes, les
  deux dates, les montants) ; un verrou `useRef` par geste.

### 3.2 Le journal OD, le 31 décembre, une écriture par régularisation

- Journal OD, date le 31 décembre de l'exercice (l'exercice reste l'année civile, décision de la ligne 31) ; une écriture
  ÉQUILIBRÉE par régularisation, sous son numéro (le FEC rejette une écriture déséquilibrée).
- Libellé composé, jamais recopié d'un tiers : « CCA 31/12/AAAA — <libellé du compte de charge> », suivi de l'objet saisi
  par le cabinet (200 caractères au plus), et l'écran dit que ce texte part au FEC.
- Les comptes : la charge ou le produit (classe 6 ou 7, du plan du dossier), le compte de régularisation (§ 4.4, liste
  FERMÉE par nature), la TVA d'attente pour une FNP ou une FAE (INV-Q3).

### 3.3 La pièce justificative

PCG, art. 1032-2 : chaque écriture s'appuie sur une pièce justificative datée. Recommandé (INV-Q7) : l'écriture porte
pour PieceRef « Inventaire AAAA » — l'ÉTAT D'INVENTAIRE de l'exercice, que l'application produit (PDF et CSV, une ligne par
régularisation, son calcul, sa justification, son auteur et sa date) — à la manière du tableau d'amortissement des
dotations ; la régularisation CITE en plus, quand elle existe, la pièce du dossier qui la fonde (la facture d'assurance pour
une CCA, la facture de janvier pour une FNP) par une colonne de `operations_inventaire`, JAMAIS par
`ecritures_brouillon.piece_id` (qui rangerait l'écriture au journal AC et la ferait régénérer avec la pièce).

### 3.4 L'extourne au 1er janvier suivant

- Le PCG l'impose pour le 408, le 418 (art. 1214-40 et 1214-41, « contre-passées ») et le 486, le 487 (art. 1214-48) ;
  l'usage l'étend aux charges à payer et produits à recevoir des comptes rattachés (terminaison 8). Elle permet aux pièces
  de N+1 de s'écrire comme toute pièce, sans retouche.
- RECOMMANDÉ (INV-Q1, option A) : l'extourne naît avec la constatation, dans la même fonction et la même transaction, au
  1er janvier N+1, journal OD, mêmes comptes en sens inverse, PieceRef identique, libellé « Extourne — … ». La paire change
  et se retire ensemble. Ses lignes citent la même opération ; la date les sépare (clé FEC `inventaire|opération|date`).
- Écartée (B) : l'écrire dans `valider_exercice` de N — une fonction déjà lourde grossirait encore, et l'exercice N+1
  ignorerait l'extourne jusqu'à la validation de N, alors que le cabinet y travaille souvent avant (les pièces de janvier).
- Écartée (C) : un geste « Extourner » en N+1 — un oubli possible, que seul le filet rattraperait.
- Une écriture datée du 1er janvier N+1 n'est pas « à venir » au sens des fonctions d'aujourd'hui tant que l'inventaire se
  passe en N+1 ; saisie en décembre N, elle est future de quelques jours : la fonction l'admet pour la seule extourne
  (aucune autre écriture ne se date dans l'avenir).

### 3.5 Ce que fige la validation

- Validation de N : les lignes du 31/12/N sont validées (déclencheurs existants) ; l'opération devient intangible
  (`garder_operations_inventaire`, sur le modèle de `sources_figees_par_la_validation`) ; son extourne en N+1, encore au
  brouillon, ne se modifie ni ne se supprime plus, puisque sa source est figée — la garde le refuse, la restauration
  exceptée.
- Validation de N+1 : refusée si l'extourne d'une opération extournable de N manque ou diffère de sa recomposition
  (`extourne-manquante`, dit avant le clic par `prealablesValidation.ts`, aux mots de la base) ; refusée si une opération de
  N+1 n'est pas « à jour » (ses lignes ≠ sa recomposition).
- Validation de N, en engagement : retenue tant que l'ÉTAT D'INVENTAIRE de N n'est pas déclaré (même « aucune
  régularisation ») — INV-Q9 ; c'est ce qui rend au point `inventaire-non-revu` sa vérité (une extourne mouvemente le 486
  chaque année et le ferait taire sans que rien n'ait été revu).
- `empreinte_exercice` couvre déjà toutes les lignes validées de l'exercice : rien à changer pour elles ; la forme 2 de
  l'empreinte (INAL2) scelle aussi les sources citées — l'opération d'inventaire y entre comme une source (INV3), une
  forme 3 si la forme 2 ne peut s'étendre sans changer l'empreinte des exercices déjà validés (aucun en production).
- `soldes_a_reporter` ne change pas : 486, 487, 408, 418, 15, 491 sont des comptes de bilan (classes 1 à 5), leurs soldes
  passent en à-nouveaux de N+1 comme les autres ; l'extourne les solde ensuite au 1er janvier.

### 3.6 Le BNC en trésorerie, que rien ne touche

- Les fonctions refusent un dossier dont `mode_comptable <> 'engagement'` (P0001, raison dite), et la garde refuse toute
  ligne citant une opération d'inventaire sur un tel dossier.
- L'écran ne se monte pas en trésorerie ; la Checklist et la Clôture n'y disent rien de l'inventaire.
- La 2035 ne change pas : elle se calcule depuis les sources et en trésorerie seulement ; en engagement, la validation
  refuse une 2035 présente. Le BNC sous option « créances acquises et dépenses engagées » (CGI, art. 93 A) n'est pas
  couvert : l'engagement de l'application est celui des BIC et de l'IS (INV-Q10).
- Le verrou du modèle comptable (`dossiers_verrouiller_modele_comptable`) tient déjà : une ligne d'inventaire est une ligne
  du brouillon, et le modèle ne change plus.

---

## 4. Le schéma

Toutes les migrations sont ADDITIVES (tables, colonnes nullables, contraintes, fonctions, insertions au catalogue) ; aucune
ne supprime ni ne change un type. Une seule REMPLACE une fonction existante : `valider_exercice` (INV3), par
`create or replace` — son retour arrière est la recréation de la version d'avant, gardée dans l'export.

### 4.1 `operations_inventaire` (INV2)

| Colonne | Type | Règle |
|---|---|---|
| `id` | uuid | clé primaire |
| `dossier_id` | uuid not null | `references dossiers on delete cascade` |
| `exercice` | integer not null | l'année civile de la constatation |
| `nature` | text not null | `cca`, `pca`, `fnp`, `fae`, `charge_a_payer`, `produit_a_recevoir`, `provision` (check) |
| `compte_resultat` | text not null | classe 6 pour `cca`, `fnp`, `charge_a_payer` ; classe 7 pour `pca`, `fae`, `produit_a_recevoir` ; 6815/6817 ou 7815/7817 déduits pour `provision` |
| `compte_regularisation` | text not null | dans la liste fermée de sa nature (§ 4.4), au plan du dossier |
| `montant_centimes` | bigint not null | > 0 ; hors taxes pour un assujetti, TTC pour un exonéré (`montantRetenu`) ; pour une provision, le MONTANT CIBLE au 31/12 (≥ 0) |
| `tva_centimes` | bigint not null default 0 | > 0 seulement pour `fnp`, `fae` d'un dossier assujetti (INV-Q3) |
| `periode_debut`, `periode_fin` | date | facultatives ; le prorata proposé (INV-Q6), gardé pour l'état d'inventaire |
| `objet` | text not null | 1 à 200 caractères, sans saut de ligne |
| `piece_citee_id` | uuid | `references pieces` sans action ; une pièce du même dossier (contrôle) |
| `provision_id` | uuid | `references provisions` ; non nul si et seulement si `nature = 'provision'` |
| `version` | integer not null default 1 | incrémentée à chaque remplacement ; la saisie retient la version lue |
| `cree_par`, `cree_le`, `modifie_par`, `modifie_le` | | posées par la fonction, jamais par l'appelant |

Une évaluation par provision et par exercice : la contrainte d'unicité TOTALE `(provision_id, exercice)` (les opérations
sans provision y portent un `provision_id` nul, que PostgreSQL ne fait pas se heurter — sans `nulls not distinct`), jamais
un index unique partiel (CLAUDE.md, « Un index unique PARTIEL »).

### 4.2 `provisions` (INV4)

| Colonne | Règle |
|---|---|
| `id`, `dossier_id` | comme ci-dessus |
| `genre` | `risque` (151…, 6815, 7815) ou `depreciation_creance` (491, 6817, 7817) |
| `compte_provision` | sous la racine de son genre (1511, 1518… ; 491…) |
| `objet` | 1 à 200 caractères (le litige, la créance) |
| `facture_id` | pour une dépréciation : la facture émise dépréciée, du même dossier (le reste dû hors taxes en est la base) ; ou `piece_citee_id`, une pièce de vente, pour une créance hors des factures de l'application |
| `ouverte_en` | l'exercice de la première évaluation, ou de la reprise (INV-Q11) |
| `soldee_en` | l'exercice où sa cible tombe à zéro (le risque réalisé ou disparu) ; plus d'évaluation après |

L'écriture d'une évaluation est l'ÉCART entre la cible de N et celle de N−1 (ou, la première année d'un dossier repris, la
part de la provision dans les à-nouveaux) : écart positif → 681x au débit, 15x ou 491 au crédit ; écart négatif → 15x ou 491
au débit, 781x au crédit (PCG, art. 1211-15 et 1214-49 ; INV-Q4). Aucune extourne.

### 4.3 `ecritures_brouillon`

- Colonne `operation_inventaire_id uuid references operations_inventaire(id)` (SANS action à la suppression : la fonction
  retire les lignes d'abord, comme `immobilisation_id`).
- Contrainte `ecritures_brouillon_inventaire_sans_autre_source` : une ligne qui cite une opération ne cite ni pièce, ni
  mouvement, ni bien, ni véhicule, ni déclaration de TVA, ni cotisation, ni encaissement, ni facture, ni opération de caisse
  (ni `ouverture_compte_bancaire_id` quand MCB5 sera collée) ; sa date est le 31/12 de l'exercice de l'opération ou le 1er
  janvier suivant.
- Les autres contraintes « sans autre source » reçoivent la colonne nouvelle dans leur liste (de même que MCB5 l'a fait pour
  la sienne).

### 4.4 Le catalogue des rôles (INV2, et INV4 pour les provisions)

Douze rôles neufs (six pour les régularisations en INV2, six pour les provisions en INV4), insérés dans `roles_comptables` (une insertion, rien de retiré), avec leur libellé au plan comptable
général dans `LIBELLES_COMPTES` :

| Rôle | Racines | Défaut |
|---|---|---|
| `charges_constatees_avance` | 486 | 486000 |
| `produits_constates_avance` | 487 | 487000 |
| `factures_non_parvenues` | 408 | 408100 |
| `factures_a_etablir` | 418 | 418100 |
| `tva_factures_non_parvenues` | 44586 | 445860 |
| `tva_factures_a_etablir` | 44587 | 445870 |
| `provisions_risques` | 151 | 151100 |
| `depreciation_clients` | 491 | 491000 |
| `dotations_provisions_exploitation` | 6815 | 681500 |
| `dotations_depreciations_actif_circulant` | 6817 | 681700 |
| `reprises_provisions_exploitation` | 7815 | 781500 |
| `reprises_depreciations_actif_circulant` | 7817 | 781700 |

Les comptes de régularisation PAR NATURE (liste fermée, vérifiée par la fonction contre le plan du dossier) :

- `cca` : le rôle 486 ; `pca` : le rôle 487 ;
- `fnp` : le rôle 408 (et 4084 pour un fournisseur d'immobilisations, 4088 pour des intérêts courus) ;
- `fae` : le rôle 418 ;
- `charge_a_payer` : 4282, 4286, 4382, 4386, 44812, 1688 (intérêts courus sur emprunts), 518 (intérêts courus bancaires)
  — JAMAIS le 467 ni le 468 (INV-Q2) ;
- `produit_a_recevoir` : 4482, 439, 4098 (rabais, remises, ristournes à obtenir et autres avoirs non encore reçus) ;
  JAMAIS le 467 ni le 468 (le 418, la facture à établir, a sa nature à lui) ;
- `provision` : le compte de la provision citée.

### 4.5 Les fonctions (toutes `security definer`, `set search_path = public`, `revoke execute … from public, anon`)

- `enregistrer_operation_inventaire(p_dossier_id uuid, p_operation jsonb, p_ecritures jsonb, p_version_lue integer)
  returns uuid` : vérifie l'accès (`admin_du_dossier`, avant toute lecture), le mode du dossier (engagement), l'exercice
  (ni validé, ni avant l'ouverture du dossier, ni au-delà de l'année en cours lue à Paris), la nature et ses comptes (liste
  fermée, au plan), les montants (centimes > 0, TVA seulement où elle se peut), la pièce citée (même dossier), la version
  lue ; prend le verrou consultatif PARTAGÉ du dossier (celui que `valider_exercice` prend EXCLUSIF) ; RECOMPOSE en entiers
  l'écriture du 31/12 et, pour une nature extournable, celle du 1er janvier suivant ; compare en multiensemble à
  `p_ecritures` (compte, sens, centimes, date) ; remplace les lignes de l'opération ; rend son identifiant. Refus en
  42501 (accès), 22023 (saisie), 23514 (exercice figé), chacun sa phrase française.
- `retirer_operation_inventaire(p_id uuid, p_version_lue integer)` : mêmes contrôles ; retire les lignes puis l'opération ;
  refusé si l'une de ses lignes est validée (la constatation de N validée fige la paire).
- `enregistrer_provision(p_dossier_id, p_provision jsonb, p_version_lue)` et l'évaluation par
  `enregistrer_operation_inventaire` (nature `provision`), dont la recomposition lit la cible précédente EN BASE (jamais
  celle de l'appelant).
- `etat_inventaire_declare(p_dossier_id, p_exercice)` et sa table `inventaires_declares` (INV3, si INV-Q9 (A)) : le chef
  ou un membre assigné déclare l'inventaire de l'exercice « fait », avec ou sans régularisation ; une déclaration se retire
  tant que l'exercice n'est pas validé.
- `garder_operations_inventaire` (déclencheur `before insert or update or delete`) : toute écriture directe refusée, la
  fonction passant par un réglage de transaction local (le patron des gardes existantes), l'insertion du
  super-administrateur exceptée (la restauration) ; une opération dont une ligne est validée ne change plus.
- `valider_exercice` (INV3) : la sorte `inventaire` dans la numérotation reçue (journal OD) ; les filets
  `extourne-manquante`, `inventaire-a-recomposer` et, selon INV-Q9, `inventaire-non-declare` ; rien d'autre ne change.

### 4.6 Les policies et les droits

- `operations_inventaire`, `provisions`, `inventaires_declares` : RLS activée ; une policy `FOR SELECT to authenticated
  using (admin_du_dossier(dossier_id))` ; AUCUNE policy d'écriture (les fonctions seules) ; aucune branche client, aucun
  droit d'accès (ni « Ventes », ni « Banque », ni « Comptes ») : l'inventaire est un travail du cabinet. Une situation
  publiée au client (C4a) montre des comptes, pas les opérations.
- Les tables naissent avec les seuls SELECT, INSERT, UPDATE et DELETE pour `anon` et `authenticated` (le défaut posé par
  `droits_hors_rls`) ; si la double authentification exigée (SEC2) est appliquée d'ici là, chaque table reçoit sa policy
  RESTRICTIVE `deux_facteurs` (le bloc DF de `rls.sql`).
- Les fonctions `security definer` contrôlent l'accès avant toute lecture (la règle des advisors).

### 4.7 Les essais

- `supabase/essais/inventaire.sql` (nouveau) : par impersonation des quatre profils (chef, membre assigné, membre non
  assigné, client), chaque refus en 42501 ou P0001 avec sa RAISON ; la recomposition (une ligne de trop, un centime de
  moins, un compte hors liste, un 468, une TVA sur une CCA) ; l'extourne écrite, remplacée, retirée avec la constatation ;
  un dossier en trésorerie refusé ; la garde (insertion directe, mise à jour d'une opération figée) ; la provision par
  différence (hausse, baisse, solde à zéro). Écritures annulées par sous-transaction ; aucune suppression sans `where` en
  production ; ce qui supprime se joue sur une réplique.
- `rls.sql` : les trois tables entrent dans la boucle sur `pg_class` (bloc EN ATTENTE tant que la migration manque).
- `validationExercice.sql` : les trois filets, sur une réplique (`psql -1`).
- `restauration.sql` et la sauvegarde : les tables au plan derrière `INVENTAIRE_PREVU` (`auPlanAujourdHui`), l'ordre
  `provisions` → `operations_inventaire` → `ecritures_brouillon`.
- Après chaque migration : le fichier dans `supabase/schema/`, les trois contrôles de `supabase/schema/README.md` (dérive,
  socle, inventaire), `rejouer.py` et `signature.sql`.

---

## 5. Les effets ailleurs

### 5.1 La 2035

Aucun. En trésorerie rien ne s'écrit ; en engagement la 2035 n'existe pas (la validation la refuse présente). Un test le
garde : `cases2035` ne lit aucune ligne qui cite une opération d'inventaire.

### 5.2 Le bilan 2033-A

`lib/bilan.ts` range déjà : 486 → « Charges constatées d'avance » ; 487 → « Produits constatés d'avance » ; 408 → dettes
fournisseurs (règle du 40 selon le sens) ; 418 → clients (règle du 41) ; 15 → « Provisions pour risques et charges » ; 491 →
colonne « amortissements, dépréciations » des clients (`CORRECTIF`) ; 42, 43, 44 → dettes fiscales et sociales ; 1688 →
emprunts. Ce qui change (INV6) : la liste `COMPTE_D_INVENTAIRE` (§ 1.3) et le point `inventaire-non-revu`, qui lira l'état
d'inventaire déclaré au lieu du seul mouvement du compte. Le compte de résultat (2033-B) et le relevé des provisions
(2033-D) appartiennent à la liasse (ligne 37) : leurs lignes de dotations et de reprises liront les rôles du § 4.4.

### 5.3 Le FEC et la piste d'audit

- Une sorte `inventaire` dans `lib/fec.ts` : journal OD, PieceRef « Inventaire AAAA », PieceDate le 31/12/AAAA (pour
  l'extourne aussi : sa pièce est le même état), clé `inventaire|<opération>|<date>`, EcritureLib le libellé composé. Sans
  cette sorte, les lignes tomberaient dans « les autres écritures sans pièce », hors du fichier, comptées par `absenceFec`.
- Un FEC d'engagement n'a pas les quatre champs BNC ; rien à décider pour eux.
- La piste d'audit cite l'opération, sa pièce citée (date de dépôt et empreinte, jamais le nom du fichier), et l'état
  d'inventaire.
- Le lettrage : le 408 et le 418 se lettrent par opération (la constatation contre son extourne) ; ils ne se lettrent pas
  contre le 401 ou le 411 (méthode de l'extourne, art. 1214-40 et 1214-41, la variante « débiter directement le 408 par le
  crédit du 401 » écartée).

### 5.4 La TVA et les ventes facturées (risques)

- La CA3 se calcule depuis les sources : elle ne lit pas le 44586 ni le 44587 — un test le garde.
- La concordance des ventes facturées (VF4c3) et le contrôle « à régénérer » de l'engagement lisent des lignes du brouillon
  par compte : ils doivent ÉCARTER les lignes qui citent une opération d'inventaire, sans quoi une FAE au 706 ou une CCA au
  6xx se lirait comme un écart. Lot INV3, un test par lecteur.
- « Régénérer » (engagement) ne retire que les lignes de la pièce : les lignes d'inventaire n'en citent aucune ; un test le
  garde (`lignesPropresAuMouvement.test.ts` en est le modèle).

### 5.5 La révision (R1 à R9)

- R1 (la base des soldes) : rien ; les soldes incluent les lignes d'inventaire.
- R2, R3 (les décisions par solde) : la PREUVE PROPOSÉE d'un solde 486, 487, 408, 418, 15x, 491 est l'état d'inventaire de
  l'exercice, ses opérations sur ce compte et leurs pièces citées ; elle dit ce qu'elle n'établit pas (« la régularisation
  est saisie par le cabinet ; la pièce citée ne prouve pas le prorata »). Un solde de ces comptes égal à la somme de ses
  opérations du 31/12 est « justifiable » d'un clic ; un écart (une reprise d'ouverture non extournée) le reste à justifier.
- R4 (les cycles) : un travail « séparation des exercices » au cycle des achats et à celui des ventes, un travail
  « provisions » au cycle des tiers ; leur programme le propose, le cabinet conclut.
- R5 (la revue analytique) : les dotations et reprises se lisent comme les autres comptes ; aucune variation n'est dite
  « normale ».
- R6 (la révision retient la validation) : inchangé.
- R7 (le dossier permanent) : un contrat (bail, assurance, abonnement) cité au dossier permanent fait PROPOSER sa CCA
  chaque année (la « justification permanente proposée à l'exercice suivant » de la conception) ; jamais écrite seule.
- R8 (citations de fichier), R9 (finalisation, export) : l'état d'inventaire entre dans l'export du dossier de travail.

### 5.6 L'assistant

- `agent-comptable` LIT les opérations d'inventaire (lecture au jeton de l'appelant, le plan du dossier), les met au modèle
  sous leur nature, leur compte, leur exercice et leur montant ; l'objet saisi y va (un texte du cabinet, sur un dossier
  d'engagement : aucun patient) sauf décision contraire.
- Il peut dire un compte d'inventaire non revu ou une extourne manquante (les mêmes modules que la Checklist) ; il
  n'écrit rien. Une copie du module de composition, si l'assistant doit recalculer, entre sous bornes `── DÉBUT/FIN …` et
  son garde (`…Copie.test.ts`).

### 5.7 L'écran

Recommandé (INV-Q8) : un onglet « Inventaire » du groupe de la clôture, monté en engagement seulement (`TABS_VALIDES`,
`GROUPES_PARCOURS`, `ICONES_PARCOURS`) : la liste de l'exercice par nature (lue en entier ; partielle, aucun geste), la
saisie d'une régularisation (le prorata proposé, les comptes de la liste fermée, la confirmation qui nomme la paire), les
provisions (cible, écart, écriture), la déclaration de l'état d'inventaire, l'état en PDF et CSV (`champCsv`, BOM). La
Clôture y renvoie par une carte ; la Checklist par ses points.

---

## 6. Les lots

| Lot | Contenu | Jours | Drapeau | Dépend de |
|---|---|---|---|---|
| INV1 | `lib/inventaire.ts`, pur, en centimes : la composition (constatation, extourne, évaluation d'une provision), le prorata en jours, les listes fermées, les refus et leurs mots ; ses tests | 1,5 | aucun (module) | ligne 31 |
| INV2 | Migration `operations_d_inventaire` : la table, la colonne, les contraintes, les six rôles des régularisations, `enregistrer_operation_inventaire`, `retirer_operation_inventaire`, la garde, les policies ; `inventaire.sql`, `rls.sql` ; la table au plan de sauvegarde ; `types.ts` | 3 | `INVENTAIRE_PREVU` baissé | INV1 |
| INV3 | Migration `validation_de_l_inventaire` : `valider_exercice` (sorte, filets), `inventaires_declares` ; `fec.ts`, la numérotation, la piste d'audit, le lettrage ; les lecteurs qui écartent les lignes (concordance, « à régénérer ») ; `prealablesValidation.ts` | 2,5 | le même | INV2 |
| INV4 | Migration `provisions` : la table, les six rôles des provisions, l'évaluation par différence, la reprise ventilée (INV-Q11) ; essais | 2,5 | le même | INV2 |
| INV5 | L'onglet « Inventaire » (§ 5.7), l'état en PDF et CSV | 3 | `INVENTAIRE_EXPORTE` baissé | INV1 à INV4 |
| INV6 | Le bilan (`COMPTE_D_INVENTAIRE` en numérotation 2026, `inventaire-non-revu` refondé), la Checklist, la Clôture, la révision (preuves R3, travaux R4, propositions R7) | 1,5 | le même | INV5 |
| INV7 | L'assistant (lecture, points) ; redéploiement d'`agent-comptable` par sa ligne d'import | 1 | — | INV6 |
| INV8 | La mise en production : simulation (fichiers posés, drapeaux levés, suite entière), collage, les trois contrôles, `rejouer.py`, essais rejoués, drapeaux levés | 0,5 | levés | tout |

Environ quinze jours. INV2, INV3 et INV4 se préparent et se rejouent sur une réplique en PostgreSQL 17 (ICU `en-US`), jamais
appliqués avant l'accord du cabinet ; INV3, qui remplace `valider_exercice`, mérite toute la rigueur (mutations, banc du
leurre). L'ordre : INV1 → INV2 → (INV3 ∥ INV4) → INV5 → INV6 → INV7 → INV8. Le défaut du § 1.3 peut partir seul, avant,
en une petite correction de `lib/bilan.ts` et de son test.

## 7. Les risques

- **`valider_exercice` remplacée** : la fonction la plus gardée de la base ; un filet mal écrit bloquerait toute validation
  en engagement (aucun dossier aujourd'hui) — ou, en trésorerie, s'il ne s'y tait pas. Les essais de validation se rejouent
  en entier, les deux modèles.
- **Les lecteurs du brouillon par compte** (concordance, « à régénérer », bilan, balance, révision, assistant) : chacun doit
  savoir ce qu'est une ligne d'inventaire ; un lecteur oublié compte une régularisation comme un écart. Chercher toutes les
  lectures (`grep "ecritures_brouillon"` dans `src` et `supabase/functions`) avant INV3.
- **La sauvegarde** : deux tables neuves et une colonne ; une sauvegarde lue avant la migration échouerait sans le drapeau.
- **Le retour arrière** : avant toute donnée réelle, la recréation de la version précédente de `valider_exercice` et la
  levée des drapeaux suffisent ; retirer les tables et la colonne serait une migration DESTRUCTIVE, à présenter au cabinet.
- **La numérotation 2026** : les comptes cités ici sont ceux du PCG au 1er janvier 2026 ; une balance reprise d'un ancien
  logiciel peut porter des 4486 ou 4686 : la reprise les range « à classer » (`planDepuisLaBalance`), et l'écran de
  l'inventaire les montre à reclasser, jamais devinés.

## 8. Ce qui reste hors de la ligne 35

Les stocks (ligne 36, comptes 3 et 603), les écarts de conversion (476, 477), les intérêts courus calculés depuis un
tableau d'emprunt (proposés plus tard depuis `echeances_emprunt`), les congés payés calculés depuis une paie (aucune paie
dans l'application : un montant saisi), les pertes sur créances irrécouvrables (654), la provision réglementée (14), le
relevé des provisions 2033-D et la réintégration fiscale (ligne 37).

## 9. Points non vérifiés

- Le texte des articles L123-12, L123-20 et L123-21 du code de commerce et de l'article 39, 1-5° du CGI, cités de mémoire
  des conceptions précédentes ; à relire sur Légifrance avant INV2.
- La compatibilité de la forme 2 de l'empreinte (INAL2) avec une source de plus : à lire dans `empreinte_exercice` avant
  INV3.
- Le comportement de `ecritures_brouillon_validation_complete` pour une ligne datée du 1er janvier N+1 d'une opération de
  N : elle se valide avec N+1, sous sa propre numérotation — à éprouver sur la réplique.

## 10. Les questions au cabinet

### INV-Q1 — Quand s'écrit l'extourne du 1er janvier ?

- **Question** : la contre-passation d'une CCA, d'une PCA, d'une FNP, d'une FAE, d'une charge à payer ou d'un produit à
  recevoir s'écrit-elle en même temps que la constatation, par la validation de l'exercice, ou par un geste à part ?
- **Contexte** : le PCG (art. 1214-40, 1214-41, 1214-48) veut ces écritures « contre-passées » à l'ouverture de l'exercice
  suivant ; l'application peut l'écrire de trois façons.
- **Options** : (A) avec la constatation, dans le même geste : la paire naît, change et se retire ensemble ; (B) par la
  validation de N, dans le même clic que le report des soldes ; (C) par un geste « Extourner » dans N+1.
- **Recommandation : (A).** Le cabinet travaille N+1 avant d'avoir validé N (les pièces de janvier arrivent) : avec (B),
  l'exercice N+1 serait faux jusqu'à la validation ; (C) laisse place à l'oubli. (A) ne touche pas `valider_exercice` pour
  écrire, seulement pour vérifier (le filet).

### INV-Q2 — Les charges à payer et produits à recevoir « divers » : le 467 et le 468 ?

- **Question** : une charge à payer qui ne se rattache à aucun tiers nommé va-t-elle au 468, comme le permet la
  numérotation de 2026 ?
- **Contexte** : le PCG de 2026 a supprimé les 4686 et 4687 ; le 468 s'appelle « Divers comptes créditeurs et charges à
  payer ». Or le plan de l'application range au 468 le dirigeant non associé (PC4-Q2) et au 467/468 le rôle « autres
  débiteurs et créditeurs ».
- **Options** : (A) une liste fermée de comptes rattachés (408, 418, 4282, 4286, 4382, 4386, 44812, 4482, 439, 4098, 1688, 518),
  sans le 467 ni le 468 ; (B) en plus, un sous-compte du 468 ou du 467 que le plan du dossier déclare pour l'inventaire,
  par un rôle à lui ; (C) le 467 et le 468 libres.
- **Recommandation : (A)**, puis (B) le jour où un dossier en a besoin. (C) mêlerait au compte du dirigeant des charges à
  payer que l'extourne solderait : le compte courant mentirait chaque 1er janvier.

### INV-Q3 — Les factures non parvenues et à établir : toutes taxes comprises ?

- **Question** : une FNP ou une FAE d'un dossier assujetti s'écrit-elle TTC, avec sa TVA au 44586 ou au 44587 ?
- **Contexte** : le PCG (art. 1214-40 et 1214-41) dit « du montant, taxes comprises » ; la TVA d'attente ne se déduit ni ne
  se collecte avant la facture, et la CA3 de l'application ne la lit pas.
- **Options** : (A) TTC, la TVA aux comptes d'attente (rôles neufs) ; (B) hors taxes seulement.
- **Recommandation : (A)**, la lettre du PCG ; pour un dossier exonéré ou en franchise, TTC à la charge, sans ligne de TVA
  (la règle de `montantRetenu`).

### INV-Q4 — Une provision se réajuste-t-elle par différence ?

- **Question** : à chaque clôture, l'application écrit-elle l'écart entre la nouvelle évaluation et l'ancienne, ou reprend-
  elle toute la provision pour en doter une nouvelle ?
- **Contexte** : le PCG (art. 1211-15) parle de réajustement « à la fin de chaque exercice », dotation si elle augmente,
  reprise si elle diminue ou devient sans objet.
- **Options** : (A) par différence, une écriture d'écart par provision ; (B) reprise intégrale puis dotation nouvelle.
- **Recommandation : (A)** : c'est le texte, une écriture au lieu de deux, et le relevé des provisions (2033-D) lit
  directement dotations et reprises de l'exercice.

### INV-Q5 — Une créance dépréciée passe-t-elle au 416 « Clients douteux » ?

- **Question** : la dépréciation d'une créance s'accompagne-t-elle de son reclassement du 411 au 416 ?
- **Contexte** : le 416 existe au plan ; il n'est pas imposé. Les lignes du 411 d'une facture de l'application sont
  écrites par les fonctions des ventes facturées seules, et lettrées par facture.
- **Options** : (A) reclassement au 416 dans le même geste ; (B) pas de reclassement : la dépréciation au 491 cite la
  facture (et son auxiliaire) ; (C) au choix du cabinet, dépréciation par dépréciation.
- **Recommandation : (B)** pour la ligne 35 : un reclassement toucherait au 411 que la vente facturée tient seule, et au
  lettrage par facture ; le 416 pourra venir à part si le cabinet le veut.

### INV-Q6 — Le prorata d'une charge constatée d'avance se calcule-t-il en jours ?

- **Question** : la part d'une facture qui court au-delà du 31 décembre se propose-t-elle en jours réels, en mois, ou pas
  du tout ?
- **Contexte** : les amortissements suivent la règle fiscale du 30/360 ; rien n'impose une méthode pour le prorata d'une
  charge, sinon la permanence des méthodes (PCG, art. 121-5). Le montant écrit reste celui que le cabinet confirme.
- **Options** : (A) en jours réels, proposé ; (B) en mois de trente jours, proposé ; (C) aucun calcul : le cabinet saisit le
  montant.
- **Recommandation : (A)**, proposé et jamais imposé, la méthode écrite sur l'état d'inventaire.

### INV-Q7 — Quelle pièce justifie une écriture d'inventaire ?

- **Question** : l'écriture porte-t-elle pour pièce l'état d'inventaire produit par l'application, une pièce déposée par le
  cabinet, ou un texte ?
- **Contexte** : chaque écriture s'appuie sur une pièce justificative datée (PCG, art. 1032-2) ; les dotations ont pour
  pièce le tableau d'amortissement de l'exercice.
- **Options** : (A) l'état d'inventaire de l'exercice (PDF et CSV produits), et la pièce du dossier citée quand elle
  existe ; (B) une pièce déposée exigée pour chaque régularisation ; (C) l'objet saisi seul.
- **Recommandation : (A)** : le même patron que le tableau d'amortissement ; (B) bloquerait une provision pour litige, dont
  la pièce est souvent une lettre que le cabinet n'a pas au dossier.

### INV-Q8 — Où se saisit l'inventaire ?

- **Question** : un onglet « Inventaire » à lui, ou une section de l'onglet Clôture ?
- **Options** : (A) un onglet du groupe de la clôture, monté en engagement seulement ; (B) une section de Clôture.
- **Recommandation : (A)** : la saisie (listes par nature, provisions, état) est un écran entier ; Clôture garde une carte
  qui y renvoie.

### INV-Q9 — La validation attend-elle l'inventaire déclaré ?

- **Question** : en engagement, la validation d'un exercice se refuse-t-elle tant que le cabinet n'a pas déclaré son
  inventaire fait, même sans aucune régularisation ?
- **Contexte** : le code de commerce (art. L123-12) exige un inventaire au moins tous les douze mois ; sans déclaration,
  l'application ne peut distinguer « rien à régulariser » de « pas regardé » — l'extourne mouvemente le 486 chaque année
  et ferait taire le point d'aujourd'hui.
- **Options** : (A) bloquant, dit avant le clic ; (B) une attention seulement.
- **Recommandation : (A)**, un clic de plus par an et par dossier ; la déclaration se retire tant que l'exercice n'est pas
  validé.

### INV-Q10 — Le BNC sous option « créances-dettes » est-il hors du périmètre ?

- **Question** : un BNC qui a opté pour les créances acquises et les dépenses engagées (CGI, art. 93 A) doit-il recevoir
  l'inventaire ?
- **Contexte** : l'engagement de l'application est celui des BIC et de l'IS ; un tel BNC dépose une 2035 calculée en
  engagement, que l'application ne sait pas produire.
- **Options** : (A) hors périmètre, une ligne à part si un dossier le demande ; (B) l'inclure maintenant.
- **Recommandation : (A)** : aucun dossier ne le demande, et c'est un chantier de la 2035, pas de l'inventaire.

### INV-Q11 — Les provisions reprises d'une balance se ventilent-elles ?

- **Question** : un 151 ou un 491 repris d'une balance (sans détail) doit-il être ventilé en provisions nommées avant la
  première clôture ?
- **Options** : (A) le cabinet ventile le solde repris en provisions ; la somme doit égaler le solde, et un écart retient la
  validation ; (B) une provision unique « reprise » portant le solde.
- **Recommandation : (A)** : le réajustement par différence (INV-Q4) et le relevé des provisions ont besoin du détail ; (B)
  rendrait toute reprise partielle impossible à justifier.

### INV-Q12 — L'inventaire de l'an dernier se propose-t-il ?

- **Question** : à l'ouverture de l'inventaire de N, l'application propose-t-elle la liste des régularisations de N−1 (sans
  montant) et les contrats du dossier permanent ?
- **Options** : (A) proposée, rien d'écrit sans un clic par ligne ; (B) rien proposé.
- **Recommandation : (A)** : les régularisations reviennent d'une année sur l'autre (loyers, assurances, abonnements) ; la
  règle « rien n'est validé ni importé automatiquement » tient, puisque chaque ligne attend son clic.
