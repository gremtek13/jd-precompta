# Documentation des traitements comptables — jd-precompta

Ce document décrit, pour un expert-comptable ou un vérificateur, comment l'application produit les écritures d'un
titulaire de bénéfices non commerciaux tenu en comptabilité de TRÉSORERIE (CGI, art. 93 et 99), les fige à la
validation d'un exercice et les restitue dans le fichier des écritures comptables. Il ne porte ni nom ni donnée réelle.

- **Pourquoi il existe.** Le plan comptable général (règlement ANC n° 2014-03, numérotation du 1er janvier 2026) exige
  une documentation des procédures et de l'organisation comptables (art. 1011-2), gardée aussi longtemps que les
  documents qu'elle décrit (art. 1011-4), une piste d'audit (art. 1011-3) et des pièces justificatives sur un support
  qui en assure la fiabilité, la conservation et la restitution en clair (art. 1032-2). Durée : RGPD.md, § 5 (dix ans,
  LPF, art. L102 B, version du 01/01/2027).
- **Comment il se lit.** Chaque affirmation nomme ce qui la porte, entre accents graves : une fonction SQL suivie de
  parenthèses (son texte est dans `supabase/schema/`, l'export des migrations appliquées), un module par son chemin
  sous `src/`, une fonction ou une constante de ce module par son nom. Le garde
  `lib/documentationDesTraitements.test.ts` fait tomber la suite si l'un de ces noms disparaît : le document vieillit
  avec le code, ou la suite le dit.
- **Version.** Celle du commit qui le porte : la documentation en vigueur pour un exercice est celle du dépôt au jour
  de sa validation (`exercices_valides`, colonne `valide_le`). Le paquet d'archive d'un exercice validé
  (`lib/paquetDArchive.ts`) joint celle que l'application porte au jour où il se fabrique : le télécharger le jour de la
  validation.
- **Hors de son champ.** La comptabilité d'ENGAGEMENT (un dossier BIC ou une société : `lib/engagement.ts`), dite en
  une ligne quand elle diffère ; la déclaration 2035 elle-même, qui se calcule depuis les sources et se compare aux
  écritures (`lib/concordance2035.ts`) sans en produire.

## 1. Le principe : l'application compose, la base vérifie, le cabinet décide

1. Toute écriture naît d'une SOURCE : une pièce, un mouvement du relevé, une opération de caisse, une facture émise ou
   un encaissement, une échéance de cotisation, un bien immobilisé, un véhicule, une déclaration de TVA, une balance
   reprise. Aucune écriture n'est saisie librement : l'écran n'offre pas d'écriture d'opérations diverses à la main.
2. L'application COMPOSE l'écriture dans un module pur (sans accès à la base), au centime, sur les comptes du plan du
   dossier ; la plupart des sources l'envoient à une fonction SQL qui la RECOMPOSE depuis ses propres lectures, refuse
   ce qui en diffère, puis l'écrit d'un seul tenant avec sa source. L'exception — les pièces — est dite au § 3.1.
3. Rien ne s'écrit sans un clic du cabinet (ou du client, pour la caisse qu'un droit lui ouvre) ; une règle
   d'affectation PROPOSE, elle n'écrit pas (`lib/reglesAffectation.ts`).
4. Toute écriture entre au brouillon (`ecritures_brouillon`), statut « proposée ». Elle se remplace ou se retire tant
   que son exercice n'est pas validé ; validée, elle est figée en base (§ 4).

## 2. Le plan du dossier : des rôles, jamais des numéros écrits en dur

Chaque compte que l'application écrit d'elle-même est celui d'un RÔLE. Le catalogue `roles_comptables` donne le compte
par défaut de chaque rôle ; `plan_comptable_dossier` en remplace un pour un dossier ; `compte_du_role()` rend, en base,
le compte d'un rôle (son défaut quand le dossier ne règle rien), et `plan_du_dossier()` le plan entier à l'application,
que `lib/planComptable.ts` lit (`lireLePlanDuDossier`, `ROLES_COMPTABLES`, `PLAN_PAR_DEFAUT`). Plan absent ou incomplet,
aucun onglet comptable ne se monte. Aujourd'hui chaque dossier suit le plan par défaut : régler le plan d'un dossier
(PC4, `regler_plan_du_dossier()`, migration préparée dans `supabase/preparees/`, non appliquée) reste à faire.

Les rôles qu'un BNC en trésorerie rencontre, et leur compte par défaut :

| Rôle | Compte | Rôle | Compte |
|---|---|---|---|
| `banque` | `512000` | `exploitant` | `108000` |
| `caisse` | `530000` | `capital_individuel` | `101000` |
| `tva_deductible` | `445660` | `resultat_benefice` / `resultat_perte` | `120000` / `129000` |
| `tva_immobilisations` | `445620` | `cotisations_exploitant` | `646000` |
| `tva_collectee` | `445710` | `dotations_amortissements` | `681100` |
| `tva_a_decaisser` | `445510` | `indemnites_kilometriques` | `625110` |
| `remboursement_tva_demande` | `445830` | `emprunt` | `164000` |
| `clients` | `411000` | `interets_emprunt` / `assurance_emprunt` | `661100` / `616800` |
| `prestations_de_services` | `706000` | `valeurs_a_l_encaissement` | `511000` |
| `ventes_de_biens` | `707000` | `services_bancaires` | `627000` |

Les comptes de charge et de produit d'une pièce ou d'un mouvement viennent de sa CATÉGORIE (`categories`, colonne
`compte_comptable`), choisie par le cabinet ; une catégorie sans compte n'écrit rien et se signale
(`categoriesSansCompte`, `lib/controles.ts`). Le plan se cite dans sa numérotation du 1er janvier 2026 (le compte de
l'exploitant au 108, son capital au 101).

## 3. Les sources, une à une

Les journaux sont quatre au brouillon validé — `AC` (achats), `VE` (ventes), `BQ` (banque), `OD` (opérations
diverses) — et `AN` pour les à-nouveaux du fichier (`LIBELLES_JOURNAUX`, `lib/fec.ts`). Le journal, le numéro
d'écriture et la référence de la pièce ne sont posés qu'à la validation (§ 4) : `numeroterFec` (`lib/fec.ts`) les
propose, `valider_exercice()` les juge et les fige.

### 3.1 Les pièces : achats, recettes, notes de frais, acquisitions

- **Ce qui s'écrit.** Une pièce VALIDÉE, catégorisée, de montant non nul (`piecesAComptabiliser`, `lib/ecritures.ts`).
  En trésorerie, la charge ou le produit au compte de sa catégorie, au montant retenu — hors taxe pour un dossier
  assujetti, toutes taxes pour un exonéré ou une franchise (`montantRetenu`, `lib/montantRetenu.ts`) —, la TVA au
  `tva_deductible` (ou `tva_immobilisations` pour un bien, `compteTvaDe`), datées à chaque PAIEMENT
  (`centimesParDate`, `lib/rattachement.ts`, la même répartition au centime que la 2035), face à une contrepartie par
  paiement : la `banque` pour un paiement par le relevé (`ligneContrepartieBanque`), la `caisse` pour un paiement en
  espèces (`ligneContrepartieCaisse`). `lignesPourPiece` est le seul point d'entrée ; `ecrituresAGenerer` en fait le lot.
- **Les paiements d'une pièce** se lisent par `paiementsDesPieces` (`lib/rattachement.ts`) : le mouvement rapproché, la
  part d'un virement groupé (`regler_pieces_par_mouvement()`, `lib/reglementGroupe.ts`), la part d'un virement mixte, le
  paiement par la caisse (`regler_piece_par_la_caisse()`, `lib/paiementParLaCaisse.ts`). Un rejet défait le paiement
  (`rejetAccepte`).
- **La note de frais** que l'exploitant a payée de sa poche s'écrit face au compte de l'`exploitant`, la ligne soldant
  les autres au centime (`ligneContrepartieDirigeant`) : un apport, ni charge ni recette de plus.
- **L'acquisition d'un bien** s'écrit sur la pièce du bien, au compte de sa nature et non de sa catégorie (le registre,
  `lib/amortissements.ts`, `acquisitionsDesBiens`) ; un bien repris d'avant l'ouverture n'a pas d'acquisition écrite,
  la balance reprise le porte (`bienReprisSansPiece`).
- **Le libellé** : « Recette du JJ/MM/AAAA » pour une pièce de vente, le fournisseur lu pour un achat, « Pièce du
  JJ/MM/AAAA » sans fournisseur lu ; jamais le nom du fichier, ni celui d'un patient (`libelleDUnePiece`,
  `lib/libellesDesVentes.ts`).
- **Journal et pièce** : `AC` pour un achat ou une note de frais, `VE` pour une recette ; la référence de la pièce est
  sa date et les huit premiers caractères de son empreinte SHA-256 (`referenceDUnePiece`, `lib/fec.ts`, colonne
  `storage_hash` des `pieces`).
- **Ce que la base vérifie — et ce qu'elle ne vérifie pas.** Les lignes d'une pièce sont insérées par l'écran
  (`pages/dossier/EcrituresTab.tsx`, « Générer » et « Régénérer ») et, au rapprochement d'un mouvement, par
  `synchroniserContrepartieBanque` (`lib/contrepartieBanque.ts`), sous la policy du dossier : AUCUNE fonction SQL ne
  les recompose. La base les garde par ses déclencheurs (la contrepartie de caisse, `garder_ecriture_de_caisse()` ;
  l'exemplaire d'une facture source, `garder_exemplaire_d_une_source()` ; le gel, § 4) et les juge à la validation (une
  écriture équilibrée au centime, une pièce, une date, § 4). L'application les contrôle avant : `analyserEcritures` (`lib/ecritures.ts`), les
  ruptures de la piste d'audit (`rupturesPisteAudit`, `lib/pisteAudit.ts`) et la concordance de la 2035 avec le
  brouillon (`concordance`, `lib/concordance2035.ts`).

### 3.2 Le relevé bancaire : chaque mouvement s'écrit

Un mouvement importé (`lib/importReleve.ts`, contrôle des soldes `lib/controlesReleves.ts`) que ne règle aucune pièce
s'écrit par une fonction qui RECOMPOSE l'écriture envoyée et la refuse si elle diffère ; elle ne touche que les lignes
PROPRES au mouvement, jamais celles d'une facture ou d'un encaissement. Journal `BQ`, pièce : le relevé, sous la date du
mouvement (« Relevé du JJ/MM/AAAA », jamais le nom du fichier importé : `referenceDuReleve`, `lib/affectationBanque.ts`).

| Geste | Fonction qui écrit et vérifie | Composition | Comptes |
|---|---|---|---|
| Affecter à une catégorie | `affecter_mouvement_bancaire()` | `ecritureDuMouvement`, `lib/affectationBanque.ts` | `banque` face au compte de la catégorie (classe 6 ou 7) ; une recette d'un assujetti, sa TVA au `tva_collectee` |
| Ventiler entre catégories | `ventiler_mouvement_bancaire()` | `ecritureDeLaVentilation`, `lib/ventilationBanque.ts` | idem, une ligne par part |
| Virement personnel | `classer_virement_personnel()` | `ecritureDuVirementPersonnel`, `lib/virementPersonnel.ts` | `banque` face à l'`exploitant` (`compteDuDirigeant`) |
| Compte de bilan | `ecrire_mouvement_compte_bilan()` | `ecritureDuCompteDeBilan`, `lib/compteDeBilan.ts` | `banque` face au compte choisi par le cabinet |
| Échéance d'emprunt | `rapprocher_echeance_emprunt()` | `ecritureDeLEcheance`, `lib/echeanceEmprunt.ts` | capital à l'`emprunt`, intérêts et assurance à leurs rôles, `banque` ; un déblocage, `banque` face à l'`emprunt` |
| Cotisation sociale | `rapprocher_cotisation()` | `ecritureDeLaCotisation`, `lib/cotisationRapprochee.ts` | `cotisations_exploitant`, la CSG-CRDS à l'`exploitant` en trésorerie (`csgDeLEcriture`), `banque` |
| Paiement ou remboursement de TVA | `rapprocher_declaration_tva()` | `ecritureDuPaiementTva`, `lib/liquidationTva.ts` | `tva_a_decaisser` (ou `remboursement_tva_demande`) face à la `banque` |

**Le libellé** d'une écriture du relevé ne recopie pas la banque quand elle peut nommer qui a payé : « Crédit du relevé
du JJ/MM/AAAA » pour un crédit, « Débit du relevé du JJ/MM/AAAA » pour un débit qui rend ou défait l'argent d'un client,
le libellé de la banque pour tout autre débit (`libellerLEcritureDuReleve`, `libelleDeLEcritureDuReleve`,
`debitQuiRendLArgentDUnClient`, `lib/libellesDuReleve.ts`). Un mouvement « ignoré » ne s'écrit pas (§ 6).

### 3.3 La caisse

Une opération de caisse — recettes en espèces d'un jour, espèces rendues, apport, prélèvement — s'écrit avec elle, d'un
seul tenant, par `enregistrer_operation_caisse()` (un mois entier, tout ou rien : `enregistrer_operations_de_caisse()`),
qui relit les comptes au plan (`compte_du_role()`), recompose l'écriture et compose elle-même le libellé, sans nom :
« Recettes en espèces du JJ/MM/AAAA — catégorie », « Espèces rendues le … », « Apport en caisse de l'exploitant »,
« Prélèvement en espèces de l'exploitant » (`libelleDeLOperation`, `ecritureDeLOperation`, `lib/caisse.ts`). Comptes :
la `caisse` face au produit de la catégorie et au `tva_collectee`, ou face à l'`exploitant`. Journal `VE` pour une
recette, `OD` pour un apport ou un prélèvement (`journalDeLOperation`, `lib/controlesDeLaCaisse.ts`) ; pièce : « Caisse
du JJ/MM/AAAA » (`referenceDeLaCaisse`), le récapitulatif du jour que le praticien garde (PCG, art. 1032-2). La caisse
ne devient jamais négative (`refusDeLaCaisse`). Une opération ne se modifie pas : elle se retire ou se remplace
(`operations_caisse`, colonne `remplace_id`), et l'histoire reste. Le détail recette par recette reste au brouillard du
praticien, hors de l'application. Le paiement d'une pièce par la caisse : § 3.1.

### 3.4 Les ventes facturées (un dossier dont les factures sont la source de ses ventes)

Pour un dossier « basculé » (`ventes_par_les_factures_depuis`), la facture validée est la source de sa vente : son
exemplaire déposé ne s'écrit plus (§ 3.1). Les écritures se composent dans `lib/ecrituresVentesFacturees.ts`
(`ecrituresDesVentesFacturees`, `lignesAuBrouillon`), en centimes, la TVA lue au module des ventes facturées
(`ventesFacturees`, `lib/ventesFacturees.ts`), jamais recalculée ; elles ne s'écrivent que par `ecrire_vente_facturee()`,
qui les recompose et les compare ligne à ligne, et ne se retirent que par `retirer_ecriture_vente_facturee()`. En
trésorerie : la facture n'écrit rien (sauf une TVA due avant l'encaissement, `clients` face au `tva_collectee`) ;
l'encaissement, à sa date, écrit le compte de trésorerie (la `banque` pour un mouvement du même jour, les
`valeurs_a_l_encaissement` sinon, la `caisse` pour des espèces) face au produit (`prestations_de_services` ou
`ventes_de_biens`) et à la TVA ; une contre-passation l'inverse ; le mouvement que des encaissements classent
(`classer_mouvement_par_encaissements()`) solde ces comptes d'attente et porte l'écart des frais aux
`services_bancaires`. Journal `VE` (la facture, l'avoir, l'encaissement) ou `BQ` (le mouvement) ; pièce : le numéro de
la facture, ou le relevé. Libellé : le geste et le numéro du document, suivi du nom du client quand c'est une entreprise
(`libelleDUneVenteFacturee`, `libelleDUnMouvementDesVentes`). Un dossier qui n'a pas basculé compte ses ventes par les
pièces de vente déposées (§ 3.1).

### 3.5 Les cotisations sociales

Une échéance payée par le compte professionnel s'écrit au rapprochement de son mouvement (§ 3.2,
`rapprocher_cotisation()`). Payée depuis le compte PERSONNEL de l'exploitant, elle s'écrit par
`enregistrer_paiement_personnel_cotisation()` (`ecritureDuPaiementPersonnel`, `libelleDuPaiementPersonnel`,
`lib/cotisationPersonnelle.ts`) : `cotisations_exploitant` face à l'`exploitant`, un apport (PCG, art. 1211-10), journal
`OD`, pièce « Compte personnel du JJ/MM/AAAA » (`referenceDuPaiementPersonnel`, `lib/fec.ts`) — le relevé de ce compte,
que le cabinet a vu et que l'application ne garde pas.

### 3.6 Les immobilisations et le véhicule

- **La dotation** d'un exercice, une par bien, s'écrit par `ecrire_dotation_amortissement()` (`ecritureDeLaDotation`,
  `dotationAEcrire`, `lib/amortissements.ts`) : `dotations_amortissements` face au compte d'amortissement du bien
  (`compteAmortissement`), au 31 décembre ; libellé « Dotation AAAA — désignation du bien » ; journal `OD`, pièce
  « Tableau d'amortissement AAAA ». Le cumul s'arrondit, pas l'annuité.
- **Le forfait kilométrique** (barème) s'écrit par `ecrire_forfait_kilometrique()` (`ecritureDuForfait`,
  `lib/forfaitKilometrique.ts`) : `indemnites_kilometriques` face à l'`exploitant` ; libellé « Indemnités kilométriques
  AAAA — » suivi du type et de la puissance du véhicule (`nomDuVehicule`) ; journal `OD`, pièce « Barème kilométrique
  AAAA ».

### 3.7 La TVA d'un dossier assujetti

La déclaration enregistrée (CA3, `lib/declarationTva.ts`) écrit sa liquidation par `ecrire_liquidation_tva()`
(`ecritureDeLaLiquidation`, `lib/liquidationTva.ts`), au dernier jour de sa période : chaque compte de TVA reçoit son
solde — le `tva_collectee` au débit, le `tva_deductible` et le `tva_immobilisations` au crédit —, la TVA à payer au
`tva_a_decaisser`, le crédit au `credit_tva_a_reporter`, le remboursement demandé au `remboursement_tva_demande`,
l'arrondi aux rôles `arrondi_charge` ou `arrondi_produit` ; rien pour une déclaration saisie à la main. Libellé « CA3 »
et sa période ; journal `OD`, pièce « CA3 au JJ/MM/AAAA » (`referenceDeLaLiquidation`). Son paiement : § 3.2.

### 3.8 La balance reprise et le report des soldes

- **La balance reprise** d'un autre logiciel ouvre le premier exercice : lue et contrôlée (`lireBalance`,
  `controlerBalance`, `lib/balanceImport.ts`), préparée (`preparerANouveaux`, `lib/aNouveaux.ts`, qui ne range d'office
  que la banque et la TVA, `compteQueLApplicationEcrit`), écrite par `enregistrer_a_nouveaux()` au 1er janvier,
  équilibrée, avec le nom et l'empreinte du fichier (`a_nouveaux`, colonnes `source_nom` et `source_empreinte`).
  L'ouverture se confronte au bilan qui la précède (`lib/ouvertureConfrontee.ts`).
- **Le report** : la validation d'un exercice écrit, dans le même clic, l'ouverture du suivant (`soldes_reportes`), par
  `soldes_a_reporter()` : les soldes des comptes de bilan au 1er janvier suivant ; pour un entrepreneur individuel, le
  compte de l'`exploitant` et le résultat passent au `capital_individuel`, et l'exercice suivant repart d'un 108 vide.
  Chaque ligne porte l'empreinte de l'exercice dont elle vient. `lib/reportDesSoldes.ts` (`soldesAReporter`) en est le
  jumeau, pour montrer l'ouverture avant le clic. Le FEC les écrit au journal `AN`.

## 4. La validation d'un exercice et son gel

**Le geste.** Le chef du cabinet seul valide, exercice clos, dans l'ordre des exercices, par `valider_exercice()`
(appelée par `pages/dossier/ValidationExerciceCard.tsx`, la demande composée par `demandeDeValidation`,
`lib/validationExercice.ts`, les préalables dits avant le clic par `prealablesDeValidation`,
`lib/prealablesValidation.ts`). La fonction refuse tout l'exercice, sans rien écrire, si :

- une écriture de l'exercice manque à la numérotation, ou n'est pas équilibrée au centime, ou mêle deux pièces ou deux
  dates ; si les numéros d'un journal ne se suivent pas depuis 1 ou ne suivent pas l'ordre des dates ; si un compte porte
  deux libellés (A47 A-1 : une écriture, une date ; une numérotation continue) ;
- un mouvement du relevé reste à traiter ou réservé à un encaissement ; une vente facturée n'est pas écrite à jour ; un
  paiement en espèces n'a pas sa contrepartie entière en caisse ;
- les soldes de clôture ne s'équilibrent pas, ou portent un compte hors des classes 1 à 5 après report ;
- en trésorerie, la 2035 à figer manque.

Puis, d'un seul tenant : chaque écriture passe « validée », avec son journal, son numéro, sa pièce, sa date de pièce et
le libellé de son compte ; l'en-tête s'écrit dans `exercices_valides` (mode, nombres de lignes et d'écritures, totaux,
empreintes, et la 2035 telle que validée, colonne `declaration`, un instantané versionné, `instantane2035`) ; les soldes
de l'exercice suivant s'écrivent (§ 3.8).

**Le gel.** Un exercice validé se fige par déclencheurs, la frontière étant le 31 décembre du dernier exercice validé
(`frontiere_validation()`, `exercice_fige()`) : les écritures (`garder_ecritures_validees()`), les pièces
(`garder_piece_validee()`), les mouvements et leurs parts (`garder_mouvement_valide()`,
`garder_parts_mouvement_valide()`), les biens et véhicules (`garder_bien_valide()`, `garder_vehicule_valide()`), les
échéances de cotisation (`garder_cotisation_valide()`), les à-nouveaux (`garder_a_nouveaux_valides()`). Seule la
validation elle-même passe ; aucune fonction ne dévalide un exercice. Deux sorties seulement : la suppression du
dossier entier, et sa restauration par le super-administrateur (policy `exercices_valides_restauration`).

**L'empreinte, forme 1 (en vigueur).** `empreinte_exercice()` calcule un SHA-256 sur l'empreinte de l'exercice
précédent, puis chaque écriture validée de l'exercice — identifiant, date, journal, numéro, compte et son libellé,
auxiliaire, pièce et sa date, libellé, montant, sens, instant de validation, et les quatre champs d'un BNC quand l'un
d'eux est posé —, dans l'ordre du journal et du numéro, puis l'ouverture (à-nouveaux et soldes reportés). L'empreinte
est CHAÎNÉE par dossier : chaque exercice porte celle du précédent (`empreinte_precedente`). `verifier_exercice_valide()`
la recalcule et vérifie le maillon ; l'écran la lance (`pages/dossier/ValidationExerciceCard.tsx`,
`pages/dossier/RevisionTab.tsx`).

**Ce que la forme 1 ne prouve pas.** Elle ne couvre ni les fichiers des pièces (leur `storage_hash`), ni la 2035
validée (`declaration`), ni l'en-tête (mode, totaux, date, auteur). Et le chaînage montre qu'une écriture validée a
changé par un chemin qui contourne les déclencheurs ; il ne prouve rien contre qui peut tout : le super-administrateur
qui supprime puis restaure un dossier retouché, ou le propriétaire de la base qui désactive un déclencheur — la chaîne
se recalcule de bout en bout. Seul un témoin hors de la base (une copie gardée ailleurs, un jeton d'horodatage) l'arrête.
Aujourd'hui aussi, le fichier d'une pièce figée peut encore être supprimé du stockage par qui administre le dossier
(policy `pieces_storage_delete` : la ligne est gelée, pas l'objet).

**À venir (ligne 44, conception dans HISTORIQUE.md, « L'INALTÉRABILITÉ ET L'ARCHIVAGE À VALEUR PROBANTE : LA
CONCEPTION (LIGNE 44) ») :**
- INAL1 — le stockage gèle le fichier d'une pièce figée et d'une source citée par la révision ;
- INAL2 — l'empreinte en forme 2 : les empreintes des fichiers cités, la 2035 validée et l'en-tête y entrent, une
  colonne dit la forme de chaque exercice, et la vérification lit les deux formes ; à appliquer avant toute validation
  réelle (INAL-Q1). Une fois appliquée, ce paragraphe dira quels champs elle couvre, et dans quel ordre ;
- INAL3 — l'archive d'un exercice validé, sur un clic : le FEC, la piste d'audit, la 2035 validée, les fichiers ORIGINAUX
  relus à leur empreinte, ce document en sa version du jour, et un manifeste ;
- INAL5 à INAL7 — le départ d'un client, la copie hors de Supabase, l'horodatage par un tiers.

Au 10/11/2026, aucun de ces lots n'est écrit, ni en base ni dans l'application.

## 5. Le fichier des écritures comptables (FEC) et la piste d'audit

**Le FEC** (LPF, art. L47 A ; art. A47 A-1) se produit dans `lib/fec.ts` : `numeroterFec` groupe les lignes en
écritures (une par source et par date) et leur donne journal, numéro et pièce ; `formaterFec` écrit le fichier, champs
séparés par des tabulations, montants à la virgule, dates AAAAMMJJ, les à-nouveaux en tête au journal `AN` ; `genererFec`
et `nomFichierFec` (le SIREN, « FEC », la date de clôture) le livrent. Pour un exercice validé, le fichier se relit des
colonnes FIGÉES par la validation (`numerotationValidee`) : deux exports d'un exercice validé sont identiques.

- Les dix-huit champs, et pour un BNC en trésorerie les quatre de plus de l'article A47 A-1, VIII, 7° (date et mode de
  règlement, nature de l'opération, identification du client), calculés par `lib/champsBncDuFec.ts`, jugés par la base
  à la validation (`lib/champsBncFiges.ts`, `REFUS_DES_CHAMPS_BNC`) ; leur export attend le choix de l'expert-comptable
  (FEC22-E2) : tant que `CHAMPS_BNC_EXPORTES` est baissé, le fichier sort à dix-huit colonnes.
- Une écriture que rien ne rattache à une source n'entre pas dans le fichier, et l'écran le dit ; inventer une pièce
  serait pire. Un mouvement ignoré non plus (`mouvementsIgnoresHorsFec`, `lib/controles.ts`).
- Aucun nom de patient : ni le libellé du relevé d'un crédit, ni le nom d'un fichier, ni le client d'une vente qui n'est
  pas une entreprise (`tiersAuFec`, `lib/libellesDesVentes.ts`).

**La piste d'audit** (PCG, art. 1011-3) se produit dans `lib/pisteAudit.ts` (`pisteAudit`, `genererPisteAuditCsv`) :
pour chaque écriture, son justificatif — la pièce (date de dépôt et empreinte, jamais le nom du fichier,
`designationDUnePiece`), le relevé, la facture et l'empreinte de son exemplaire ou du CII transmis, le tableau
d'amortissement, le barème, la CA3, le relevé du compte personnel, le brouillard de caisse. `rupturesPisteAudit` dit
chaque écriture dont le justificatif manque. Le CSV porte un BOM UTF-8 (`champCsv`).

## 6. Ce qui ne s'écrit pas

- Une pièce non validée, sans catégorie ou sans compte, ou de montant nul ; un bien sans nature ; l'exemplaire d'une
  facture source (`piecesAComptabiliser`).
- Une facture émise d'un dossier qui n'a pas basculé : sa vente entre par la pièce qui revient (`lib/ventesJumelles.ts`).
- En trésorerie, une facture avant son encaissement, sauf une TVA due d'avance (§ 3.4).
- Un mouvement « ignoré » par le cabinet ou par une règle « Toujours ignorer » (`lib/reglesIgnorees.ts`) ; un mouvement
  qu'une pièce peut justifier n'entre dans aucun lot ; un mouvement réservé à des encaissements ne se classe que par eux
  (`lib/mouvementsDesVentes.ts`).
- Le détail des recettes en espèces, patient par patient (§ 3.3), et les bordereaux de télétransmission (RGPD.md, § 8.7).
- Les saisies de la 2035 propres au cabinet (`saisies_2035`) : elles vont à la déclaration, pas au brouillon.
- Un second compte bancaire : un dossier ne tient qu'UN compte aujourd'hui, et le relevé d'un second ne s'importe pas
  juste ; plusieurs comptes (MCB) sont conçus, rien n'est écrit (HISTORIQUE.md, « PLUSIEURS COMPTES BANCAIRES D'UN
  DOSSIER : LA CONCEPTION »).
- Une écriture d'opérations diverses saisie à la main : aucun écran ne l'offre.

## 7. Ce que ce document ne remplace pas

Il décrit la chaîne ; il ne la prouve pas. Les preuves sont ailleurs : les essais de la base rejoués par impersonation
(`supabase/essais/`, dont `supabase/essais/validationExercice.sql` et `supabase/essais/reportDesSoldes.sql`), les tests
de chaque module (la suite Vitest), et, pour un exercice réel, la confrontation de la 2035 calculée avec les écritures
(`concordance`) et de la banque au relevé du 31 décembre (`lib/releveAuTrenteEtUn.ts`). Restent à faire et dits comme
tels : INAL1 à INAL7 (§ 4), PC4 (§ 2), MCB (§ 6), l'export des quatre champs d'un BNC (§ 5).
