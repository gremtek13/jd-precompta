# L'affectation du résultat et l'approbation des comptes : la conception (lignes 33 et 45)

Ligne 33 de la feuille de route, « Bilan », pour ce qui en reste : l'affectation du résultat d'une société ; ligne 45,
« Approbation des comptes — assemblée, procès-verbal, affectation ». La ligne 46, le dépôt au greffe, n'est dite ici que
comme ce qui suit (§ 8). Conception rendue le 12/11/2026 par l'architecte, sans code de l'application ni écriture en base.
Le récit court est dans HISTORIQUE.md, à l'entrée « L'AFFECTATION DU RÉSULTAT ET L'APPROBATION DES COMPTES : LA CONCEPTION
(LIGNES 33 ET 45) ».

Ce qui se lit avant : HISTORIQUE.md → « LA VALIDATION D'UN EXERCICE ÉCRIT L'OUVERTURE DU SUIVANT », « UNE BALANCE REPRISE
DEVIENT LES À-NOUVEAUX », « LE BILAN SE LIT DANS LES RUBRIQUES DU 2033-A », « L'OUVERTURE CONFRONTÉE AU BILAN QUI LA
PRÉCÈDE », « UN EXERCICE VALIDÉ SE FIGE EN BASE », « LE PLAN COMPTABLE A CHANGÉ DE NUMÉROTATION », « L'IDENTITÉ LÉGALE DU
DOSSIER, À L'ÉCRAN » ; et les deux conceptions voisines, `docs/conceptions/35-inventaire.md` (ligne 35) et
`docs/conceptions/37-liasse-2033.md` (lignes 36 à 38, sur sa branche le 12/11/2026), dont la seconde fait de cette ligne
un préalable de la liasse (§ 8).

## 0. En quinze lignes

1. Une SOCIÉTÉ tenue en ENGAGEMENT garde aujourd'hui le résultat d'un exercice validé au 120 ou au 129 de l'exercice
   suivant, « en attente d'affectation » : le bilan le présente à part, hors case du 2033-A, et le dit
   (`affectation-non-ecrite`). Rien ne l'affecte : cette ligne l'écrit.
2. L'affectation est une DÉCISION des associés (assemblée, consultation écrite, décision de l'associé unique), jamais un
   calcul : l'application PROPOSE (la réserve légale minimale, le bénéfice distribuable), le cabinet SAISIT, le clic écrit.
3. Une décision par exercice affecté, IMMUABLE, qui se REMPLACE (une version nouvelle) ou se RETIRE, tant que l'exercice
   qui porte sa date n'est pas validé (`affectations_du_resultat` et ses lignes).
4. Elle porte aussi l'APPROBATION des comptes (ligne 45) : l'organe, la date, l'issue — un seul enregistrement, puisque
   l'assemblée approuve et affecte dans la même séance (AFF-Q1).
5. Son écriture va au journal OD, À LA DATE DE LA DÉCISION, dans l'exercice qui la contient (AFF-Q2) : 120 au débit, 1061,
   1063, 1068, 110 et 457 au crédit ; une perte, 129 au crédit, 119 (ou des réserves) au débit. Une fonction
   `security definer` la recompose en entiers et la compare, comme les dotations.
6. La base REFUSE ce que la loi interdit : une réserve légale sous le vingtième du bénéfice tant qu'elle n'atteint pas le
   dixième du capital (C. com., L232-10), un dividende au-delà du bénéfice distribuable ou qui ferait passer les capitaux
   propres sous le capital et les réserves indisponibles (L232-11), un résultat qui ne s'affecte pas en entier.
7. Le PROCÈS-VERBAL (ou la décision de l'associé unique) se tire des comptes FIGÉS de l'exercice validé et de la décision :
   un PDF, son empreinte gardée ; présences, votes et signature se complètent hors de l'application (AFF-Q6).
8. La validation juridique reste au cabinet (ligne 45) : l'application ne dit jamais qu'une assemblée est régulière.
9. Un dossier en TRÉSORERIE (BNC, 2035) et toute entreprise individuelle ne sont touchés par rien : les fonctions les
   refusent, l'écran ne s'y monte pas ; le résultat d'un exploitant passe au 101 par le report des soldes, comme hier.
10. Le 2033-A de l'exercice de la décision range enfin ces soldes dans leurs cases (126, 132, 134, 175) ; le FEC écrit
    l'affectation sous une sorte à elle ; la révision la propose comme preuve des capitaux propres ; l'assistant la lit.
11. Sept rôles neufs au catalogue (1061, 1063, 1068, 110, 119, 457, 1209), dans la numérotation du 1er janvier 2026, où
    aucun de ces comptes n'a changé de numéro et le 1209 « Acomptes sur dividendes » est neuf.
12. Sept lots, environ quatorze jours, derrière deux drapeaux (`AFFECTATION_PREVUE`, `AFFECTATION_EXPORTEE`) ; deux
    migrations non destructives, dont une qui remplace `valider_exercice`.
13. Hors du MVP (« Hors BNC ») : la ligne suit la ligne 31 (l'engagement) et précède la liasse (37), qui l'exige.
14. Treize questions au cabinet, AFF-Q1 à AFF-Q13, chacune avec sa recommandation (§ 11).
15. Sur la base réelle (12/11/2026) : quatre dossiers, tous en trésorerie, aucune forme juridique ni capital posés, aucun
    exercice validé ; aucun ne serait touché.

---

## 1. Le constat

### 1.1 Ce que l'application fait aujourd'hui du résultat de l'exercice précédent

- **Le report des soldes** (`lib/reportDesSoldes.ts`, jumeau de `soldes_a_reporter` en base, écrit par `valider_exercice`
  dans `soldes_reportes`) : à la validation de N, les classes 6 et 7 font le résultat ; une ENTREPRISE INDIVIDUELLE
  (`exploitantIndividuel` : le compte du dirigeant est le 108) le verse au 101000 avec le 101, le 108 et le 12 (PCG, art.
  1211-10) ; une SOCIÉTÉ le garde au 120000 (bénéfice) ou au 129000 (perte ou résultat nul), « en attente d'affectation »
  (`compteDuResultat`, `compteQuiRecoit`). Quand un résultat antérieur non affecté s'y ajoute, la ligne prend le libellé
  « Résultats en attente d'affectation » (`LIBELLE_RESULTATS_EN_ATTENTE`) : les résultats de deux exercices se cumulent
  alors sur un même compte, sans plus rien dire de leur origine.
- **La reprise d'une balance** (`lib/aNouveaux.ts`) : un 120 ou un 129 de la balance d'un ancien logiciel est repris tel
  quel, « en attente d'affectation » ; l'application « ne décide pas de son affectation (compte de l'exploitant,
  associés…) : c'est l'arbitrage du cabinet ».
- **Le bilan** (`lib/bilan.ts`, rubriques du 2033-A-SD) : pour une société, la racine 12 va à la rubrique
  `resultats-en-attente`, « Résultats antérieurs en attente d'affectation », SANS CASE du formulaire ; le point
  `affectation-non-ecrite` (attention) dit le montant et les comptes. Les comptes d'affectation sont déjà rangés :
  1061 → « Réserve légale » (126), 1062, 1063, 1068 → « Autres réserves » (132), 1064 → « Réserves réglementées » (130),
  11 → « Report à nouveau » (134), 457 → « Autres dettes » (175) ; le 1209 est « à classer » (« ils se soldent à
  l'affectation du résultat »), le 106 aussi (la réserve n'est pas dite).
- **L'ouverture confrontée** (`lib/ouvertureConfrontee.ts`) : confronte l'ouverture de N au bilan de clôture de N−1
  « avant répartition » (PCG, art. 112-2 ; C. com., L123-19, al. 3), et dit que l'affectation « ne s'écrit pas encore dans
  l'application ». Une affectation écrite en cours de N, après l'ouverture, ne change rien à cette confrontation.
- **La liasse** (conception 37, § 8) : « sans [l'affectation], le 2033-A d'une société à son deuxième exercice garde le
  résultat précédent "en attente d'affectation", hors case, et la liasse ne peut pas se déposer juste (le contrôle 1 tient,
  mais les capitaux propres mentent) ».

### 1.2 Où se lisent la forme et le capital

- `dossiers.forme_juridique` (migration `parametres_facturation`, étape A5a, ligne 51.5) : un code de l'INSEE au niveau III,
  liste FERMÉE de 260 positions (`lib/categoriesJuridiques.ts`, contrainte `dossiers_forme_juridique_insee`). Le premier
  chiffre dit la famille (1 entrepreneur individuel, 5 société commerciale, 6 autre personne morale au RCS dont les sociétés
  civiles) ; le code, la forme : 5499 SARL, 5485 SELARL, 5599 et 5699 SA, 5710 SAS, 5785 SELAS…
- **Ce que la nomenclature ne dit pas** : l'associé UNIQUE. L'INSEE n'a qu'un code pour la SARL et l'EURL (5499), et un pour
  la SAS et la SASU (5710) — la liste du module n'a ni « unipersonnelle » ni code propre à la SASU. Le nombre d'associés est
  donc une donnée de la décision, saisie, jamais déduite du code.
- `dossiers.capital` (même migration) : un montant en euros au centime, `> 0`, nul pour un entrepreneur individuel
  (`dossiers_capital_d_une_societe`) ; « écrit par le cabinet seul », imprimé par la facture (A7a le fige à la validation
  d'une facture). Il n'est confronté à rien : le 101 des comptes peut dire autre chose.
- Le régime d'imposition (IR ou IS) n'est pas une forme : il ne se lit pas ici (conception 37, `fiscalite_des_exercices`,
  LIA-Q1). L'affectation n'en dépend pas : une SARL à l'IR affecte son résultat comme une autre.

### 1.3 Un écart de doctrine relevé en concevant (sans défaut du code)

CLAUDE.md dit « le plan comptable se cite dans sa numérotation du 1er janvier 2026 (le 108 passe au 101) ». Ce n'est pas
une RENUMÉROTATION : le 108 « Compte de l'exploitant » existe toujours dans la nomenclature applicable aux exercices
ouverts à compter du 1er janvier 2025 (règlement ANC n° 2022-06) ; ce qui « passe au 101 » est son SOLDE, en fin
d'exercice (PCG, art. 1211-10, cité par HISTORIQUE.md au 09/10/2026). Le code fait juste (`reportDesSoldes.ts`) ; la phrase
de CLAUDE.md se lit « le solde du 108 passe au 101 ». À reformuler par la session si elle le juge utile ; rien à corriger
dans `src/`.

### 1.4 L'état réel de la base (lu le 12/11/2026, en lecture seule, des `select` sur le catalogue)

- `dossiers` : quatre lignes, `mode_comptable = 'tresorerie'` pour les quatre, `forme_juridique` et `capital` nuls partout.
- `exercices_valides` : aucune ligne.
- `roles_comptables` : six rôles en classes 1 et 4-5 de capitaux (`exploitant` 108000, `associe` 455000,
  `autres_debiteurs_crediteurs` 467000, `capital_individuel` 101000, `resultat_benefice` 120000, `resultat_perte` 129000) ;
  aucun pour 1061, 1063, 1068, 110, 119, 457, 1209.
- Aucune table dont le nom dise une affectation, une approbation, une assemblée, une décision ou un procès-verbal
  (`regles_affectation_bancaire` est une autre chose : les règles du relevé).
- `ecritures_brouillon` : les sources citées sont `piece_id`, `ligne_bancaire_id`, `immobilisation_id`, `vehicule_id`,
  `declaration_tva_id`, `cotisation_id`, `encaissement_id`, `facture_id`, `operation_caisse_id` ; le journal validé est l'un
  de `AC`, `VE`, `BQ`, `OD` (contrainte de `validation_des_exercices`).
- 200 migrations à l'historique.

---

## 2. Les sources

- **Code de commerce** (Légifrance ; textes connus et confirmés en substance le 12/11/2026 par des recherches, leur
  version en vigueur à RELIRE mot pour mot avant AFF1, § 10) :
  - **L232-10** : dans les SARL et les sociétés par actions (SA, SAS, SASU, SCA), « à peine de nullité de toute délibération
    contraire », un prélèvement d'un VINGTIÈME AU MOINS sur le bénéfice de l'exercice, « diminué, le cas échéant, des pertes
    antérieures », est affecté à la réserve légale ; il cesse d'être obligatoire quand elle atteint le DIXIÈME du capital
    social. La SARL n'a pas d'article à elle : c'est celui-ci (il n'y a pas de « L223-? » de la réserve légale).
  - **L232-11** : le bénéfice distribuable est le bénéfice de l'exercice, diminué des pertes antérieures et des sommes à
    porter en réserve en application de la loi ou des statuts, augmenté du report bénéficiaire ; l'assemblée peut aussi
    distribuer des réserves dont elle a la disposition, en indiquant les postes prélevés ; aucune distribution quand les
    capitaux propres sont ou deviendraient inférieurs au capital augmenté des réserves que la loi ou les statuts ne
    permettent pas de distribuer.
  - **L232-12** : l'assemblée, après approbation des comptes et constatation des sommes distribuables, décide la part
    attribuée aux associés sous forme de dividendes ; les acomptes sur dividendes, sur un bilan certifié par un
    commissaire aux comptes.
  - **L232-13** : les modalités de mise en paiement fixées par l'assemblée ou, à défaut, par les dirigeants ; la mise en
    paiement dans un délai maximal de NEUF MOIS après la clôture, prorogeable par décision de justice.
  - **L223-26** (SARL) : le rapport de gestion, l'inventaire et les comptes annuels soumis à l'approbation des associés
    réunis en assemblée dans les SIX MOIS de la clôture, prorogeable par le président du tribunal de commerce.
  - **L223-31** (EURL) : l'associé unique exerce les pouvoirs de l'assemblée ; ses décisions sont répertoriées dans un
    registre ; il approuve les comptes dans les six mois ; lorsqu'il est SEUL GÉRANT, le dépôt au registre du commerce, dans
    le même délai, de l'inventaire et des comptes annuels dûment signés VAUT APPROBATION sans inscription au registre
    (loi n° 2005-882 du 2 août 2005) ; il ne peut déléguer ses pouvoirs.
  - **L225-100** (SA) : l'assemblée générale ordinaire réunie chaque année dans les six mois de la clôture.
  - **L227-9** (SAS, SASU) : les statuts disent les décisions collectives ; l'approbation des comptes et l'affectation du
    résultat en sont, dans les six mois ; dans la SASU, l'associé unique, qui ne peut déléguer, et ses décisions au registre.
  - **L223-42, L225-248** : capitaux propres inférieurs à la moitié du capital du fait des pertes — la décision sur la
    dissolution anticipée dans les quatre mois de l'approbation (un signal, § 3.4, jamais une décision de l'application).
  - **L232-21, L232-22, L232-23, L232-25** : le dépôt au greffe dans le mois de l'approbation (deux mois par voie
    électronique), avec la proposition d'affectation soumise et la résolution votée ; la confidentialité des petites
    entreprises — c'est la ligne 46 (§ 8).
  - **L241-3, 2°** et **L242-6, 1°** : la répartition de dividendes fictifs est un délit des dirigeants (SARL, SA) ; c'est
    pourquoi la base REFUSE, et ne fait pas qu'avertir (AFF-Q4).
  - **R223-24** (SARL) : le procès-verbal (date et lieu, identité des associés présents ou représentés, documents et
    rapports soumis, résumé des débats, texte des résolutions, résultat des votes), signé par le ou les gérants, au registre
    spécial ; **R223-26**, le registre des décisions de l'associé unique. À relire avant AFF5.
- **PCG**, règlement ANC n° 2014-03 consolidé au 1er janvier 2026 (anc.gouv.fr ; lu comme données par les conceptions
  précédentes) : art. 112-2 (bilan d'ouverture = bilan de clôture AVANT répartition) ; art. 1211-10 (capital et réserves,
  le 108 viré au 101 en fin d'exercice) ; art. 1211-11 et 1211-12 (report à nouveau ; résultat de l'exercice, soldé par
  l'affectation) — ces deux-là à relire avant AFF1, la numérotation des articles ayant changé en 2025 (941-11 et 941-12
  avant).
- **La nomenclature des comptes** applicable aux exercices ouverts à compter du 1er janvier 2025 (règlement ANC n° 2022-06),
  confrontée le 12/11/2026 à un tableau de rapprochement d'éditeur (EBP, « Tableau comparatif des nomenclatures de comptes
  2025 », lu comme données, source SECONDAIRE à recouper sur le PCG consolidé) :

  | Compte | Intitulé 2025-2026 | Changement |
  |---|---|---|
  | 101 | Capital | inchangé |
  | 106, 1061, 1062, 1063, 1064, 1068 | Réserves ; Réserve légale ; Réserves indisponibles ; Réserves statutaires ou contractuelles ; Réserves réglementées ; Autres réserves | inchangés |
  | 108 | Compte de l'exploitant | inchangé (§ 1.3) |
  | 11, 110, 119 | Report à nouveau ; solde créditeur ; solde débiteur | inchangés (le 11 perd « (solde cr. ou déb.) ») |
  | 12, 120, 129 | Résultat de l'exercice ; Bénéfice ; Perte | inchangés |
  | **1209** | **Acomptes sur dividendes** | **CRÉÉ** |
  | 442, 4422, 4423, 4425 | Contributions, impôts et taxes recouvrés pour le compte de l'État ; Prélèvements forfaitaires non libératoires ; Retenues et prélèvements sur les distributions ; Associés | inchangés |
  | 455, 456, 457 | Associés — comptes courants ; opérations sur le capital ; dividendes à payer | inchangés |

- **Ordonnance n° 45-2138 du 19 septembre 1945**, art. 22, al. 7 : l'expert-comptable peut faire des travaux d'ordre
  juridique à titre ACCESSOIRE pour les entreprises dont il tient la comptabilité — le fondement du « cabinet garde la
  validation juridique » (ligne 45). Non relu ce jour.
- **CGI**, art. 117 quater (prélèvement forfaitaire non libératoire) et la déclaration 2777 ; l'IFU (2561) : hors de cette
  ligne (§ 9), cités pour borner le périmètre ; leurs taux de 2026 NON VÉRIFIÉS.
- Les normes AFNOR XP Z12-012 et XP Z12-013 ne sont pas utilisées (décision du 07/10/2026).

---

## 3. Les principes

### 3.1 Une décision des associés, jamais un calcul

L'affectation est votée. L'application ne la DEVINE pas : elle PROPOSE, au centime et avec ses raisons, le minimum de la
réserve légale, le bénéfice distribuable, le plafond des dividendes, et le reste au report à nouveau ; le cabinet SAISIT
la décision telle qu'elle a été (ou sera) votée ; le clic écrit. Une proposition qu'il change n'est jamais « corrigée »
en silence : la base juge la décision saisie et la refuse si la loi l'interdit (§ 3.4), avec les mots de
`lib/affectationDuResultat.ts`, que l'écran dit AVANT le clic.

### 3.2 L'approbation et l'affectation, un seul enregistrement

L'assemblée approuve les comptes PUIS affecte le résultat (L232-12 : « après approbation des comptes ») ; une décision
porte les deux : l'organe (assemblée générale ordinaire, consultation écrite ou acte unanime selon les statuts, décision
de l'associé unique), la date, l'issue (« comptes approuvés », ou « comptes non approuvés », sans affectation ni écriture),
le nombre d'associés tel que le cabinet le déclare (un ou plusieurs : le modèle du document en dépend, § 1.2). Une
décision « comptes non approuvés » se garde : elle dit pourquoi le 120 reste en attente (AFF-Q1).

### 3.3 Ce qui s'affecte, et d'où

L'exercice AFFECTÉ est N, validé dans l'application — ou l'exercice qui précède la reprise, dont le résultat est le 120
ou le 129 de la balance reprise (AFF-Q13). Le RÉSULTAT à affecter se LIT, il ne se saisit pas : le résultat figé de N
(`exercices_valides` et les écritures validées de N : classes 6 et 7), ou le solde repris. Il se répartit EN ENTIER, en
lignes « origine → destination » :

| Origine | Destination possible |
|---|---|
| bénéfice (120) | réserve légale (1061), réserves statutaires (1063), autres réserves (1068), report à nouveau créditeur (110), report à nouveau débiteur (119 : apurer une perte antérieure), dividendes (457) |
| perte (129) | report à nouveau débiteur (119), imputation sur des réserves disponibles (1063, 1068) ou sur le report créditeur (110) (AFF-Q7) |
| report à nouveau créditeur (110) | dividendes (457), réserves (1068) — une distribution de report, que l'assemblée nomme |
| autres réserves (1068), réserves statutaires (1063) | dividendes (457) — « en indiquant les postes prélevés » (L232-11), jamais la réserve légale ni les réserves réglementées |
| acomptes sur dividendes (1209) | imputés sur les dividendes décidés (AFF-Q8 : hors du premier temps) |

Le capital ne bouge pas ici : une incorporation au capital, une réduction pour pertes sont des décisions EXTRAORDINAIRES,
hors de cette ligne (§ 9).

### 3.4 Ce que la base refuse, et ce qu'elle dit

Refusé (le délit ou la nullité, AFF-Q3 et AFF-Q4), en centimes entiers :
- la somme des lignes dont l'origine est le résultat ≠ le résultat lu ;
- une ligne qui prélève plus que le solde de son origine à la date de la décision (110, 1063, 1068) ;
- une réserve légale inférieure à `min(ceil(5 % × max(0, bénéfice − pertes antérieures)), max(0, 10 % × capital −
  réserve légale existante))` — « un vingtième au moins », arrondi au centime SUPÉRIEUR ; les pertes antérieures sont le
  solde débiteur du 119 à la date de la décision ; aucune réserve légale sur une perte ;
- des dividendes au-delà du bénéfice distribuable (L232-11 : bénéfice − pertes antérieures − réserves légale et
  statutaires dotées + report créditeur prélevé) augmenté des réserves disponibles prélevées et nommées ;
- des dividendes qui feraient passer les capitaux propres (classe 1 hors 13 et 14 à la date de la décision, après
  affectation) sous le capital augmenté de la réserve légale, des réserves indisponibles (1062) et réglementées (1064) ;
- un dossier en trésorerie, une entreprise individuelle (le dirigeant au 108, ou la forme 1000), un dossier sans forme
  juridique, une forme qui n'est pas une société (premier chiffre hors de 5 et 6) — le minimum de réserve légale, lui, ne
  s'applique qu'aux SARL et aux sociétés par actions (codes 53xx, 54xx, 55xx, 56xx, 57xx) : une SNC, une SCS ou une
  société civile affectent librement ;
- une date de décision au plus tard au 31 décembre de N (le bilan est AVANT répartition, art. 112-2), dans le futur (au
  jour de Paris), ou dans un exercice déjà validé ;
- une société par actions ou une SARL sans capital posé au dossier (le dixième ne se calcule pas, AFF-Q5).

Dit, en attention, jamais refusé : une décision au-delà de six mois après la clôture (prorogation judiciaire possible) ;
une mise en paiement des dividendes au-delà de neuf mois (L232-13) ; un capital du dossier qui diffère du solde du 101 ;
des capitaux propres inférieurs à la moitié du capital après affectation (L223-42, L225-248 : la décision sur la
dissolution, dans les quatre mois, appartient aux associés).

### 3.5 Une décision immuable, qui se remplace

Comme la révision : une décision ne se modifie pas en place. La « modifier » crée une version nouvelle qui REMPLACE la
précédente, sous le verrou de la validation, et réécrit son écriture dans le même geste ; la « retirer » retire aussi
l'écriture. Les deux sont refusés dès que l'exercice qui contient la date de la décision est validé : la décision et son
écriture sont alors figées avec lui. Une décision remplacée reste lisible (qui, quand, ce qu'elle disait), et son
procès-verbal aussi.

### 3.6 L'écriture

Au journal OD, À LA DATE DE LA DÉCISION, dans l'exercice qui la contient (AFF-Q2) ; une écriture par décision, une ligne
par destination et par origine ; PieceRef « Affectation du résultat AAAA — décision du JJ/MM/AAAA », PieceDate la date de
la décision ; les lignes citent la décision (`affectation_id`), sans pièce ni mouvement. Exemple, une SARL au capital de
10 000 €, réserve légale existante 800 €, bénéfice 2026 de 30 000 €, décision du 15/05/2027 :

| Compte | Débit | Crédit |
|---|---|---|
| 120000 Résultat de l'exercice — bénéfice | 30 000,00 | |
| 106100 Réserve légale (5 % = 1 500 €, plafonné au dixième restant : 200 €) | | 200,00 |
| 106800 Autres réserves | | 9 800,00 |
| 457000 Associés — dividendes à payer | | 20 000,00 |

Le paiement du dividende n'est PAS de cette écriture : il passe par le relevé, sur le 457 (« UN MOUVEMENT DU RELEVÉ
S'ÉCRIT SUR UN COMPTE DE BILAN »), ventilé s'il le faut avec les retenues au 4422 et au 4423 que le cabinet saisit
(AFF-Q10).

### 3.7 Le procès-verbal, tiré des comptes figés

Le document (procès-verbal d'assemblée, ou décision de l'associé unique) se compose de ce que la base a FIGÉ : le total
du bilan, le résultat, les capitaux propres avant et après affectation, tirés des écritures validées de N et de la
décision ; jamais d'une saisie libre pour un chiffre. Ce que l'application ne sait pas — l'identité des associés présents,
les parts, le résultat des votes, les signatures — reste en blanc, à compléter (AFF-Q6) : l'application ne garde aucun nom
d'associé (minimisation, RGPD.md ; voir aussi LIA-Q10). Le PDF est déposé dans le stockage du dossier, son empreinte
SHA-256 gardée sur la version de la décision ; une version nouvelle de la décision produit un document nouveau. Le
document dit, en pied, « projet préparé par le cabinet — la régularité de la décision relève des associés et de leurs
statuts » : la validation juridique reste au cabinet (ligne 45).

### 3.8 Le calendrier

L'échéancier (`lib/echeancesFiscales.ts` et « Mon échéancier ») porte, pour une société en engagement : l'approbation
dans les six mois de la clôture, le dépôt au greffe dans le mois qui suit (ligne 46), la mise en paiement des dividendes
dans les neuf mois. Ce sont des RAPPELS datés ; un délai dépassé se dit, il ne bloque rien.

### 3.9 Le BNC en trésorerie, que rien ne touche

Un dossier en trésorerie est une entreprise individuelle (`exploitantIndividuel`) : son résultat passe au 101 par le
report des soldes, et la 2035 ne connaît pas l'affectation. Les fonctions le refusent en premier (`mode_comptable`),
l'écran ne s'y monte pas, aucun lecteur de la 2035 ne lit les tables neuves, `valider_exercice` n'y change rien (le filet
du § 4.5 ne s'y lit pas). Une SCP ou une SCM tenue en trésorerie, dont le résultat se répartit entre associés par la 2035,
est hors de cette ligne (§ 9).

---

## 4. Le schéma

Toutes les migrations sont ADDITIVES (tables, colonne nullable, contraintes, fonctions, insertions au catalogue) ; aucune
ne supprime ni ne change un type. Une seule REMPLACE une fonction existante : `valider_exercice` (AFF3), par
`create or replace` — son retour arrière est la recréation de la version d'avant, gardée dans l'export
(`20261110124917_empreinte_des_exercices_forme_2.sql` aujourd'hui, ou la version qu'INV3 ou LIA5 auront posée d'ici là).
Le SQL qui suit est INDICATIF : aucune migration n'est préparée.

### 4.1 `affectations_du_resultat` (AFF2) — la décision, versionnée

```sql
create table public.affectations_du_resultat (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers(id) on delete cascade,
  exercice_affecte integer not null check (exercice_affecte between 2000 and 2100),
  version integer not null check (version >= 1),
  -- Remplacée par la version suivante, ou retirée : jamais modifiée en place (la garde le refuse).
  etat text not null default 'en_vigueur' check (etat in ('en_vigueur', 'remplacee', 'retiree')),
  organe text not null check (organe in ('assemblee', 'consultation_ecrite', 'acte_unanime', 'associe_unique')),
  date_decision date not null,
  comptes_approuves boolean not null,
  nombre_d_associes_declare text not null check (nombre_d_associes_declare in ('un', 'plusieurs')),
  -- Ce que la décision a LU, figé avec elle (en centimes) : jamais saisi par l'appelant, posé par la fonction.
  resultat_centimes bigint not null,                -- positif un bénéfice, négatif une perte
  origine_du_resultat text not null check (origine_du_resultat in ('exercice_valide', 'balance_reprise')),
  capital_centimes bigint,                           -- dossiers.capital à la décision (AFF-Q5)
  forme_juridique text not null,                     -- dossiers.forme_juridique à la décision
  reserve_legale_avant_centimes bigint not null,     -- solde du 1061 à la date de la décision
  pertes_anterieures_centimes bigint not null,       -- solde débiteur du 119 à la date de la décision
  date_mise_en_paiement date,                        -- nulle sans dividende
  document_empreinte text check (document_empreinte ~ '^[0-9a-f]{64}$'),
  document_chemin text,                              -- premier segment = le dossier (règle du stockage)
  cree_par uuid not null, cree_le timestamptz not null default now(),
  constraint affectations_version_unique unique (dossier_id, exercice_affecte, version),
  constraint affectations_paiement check (date_mise_en_paiement is null or date_mise_en_paiement >= date_decision),
  constraint affectations_document check ((document_empreinte is null) = (document_chemin is null))
);
-- Une seule décision en vigueur par exercice affecté : la fonction l'assure sous le verrou ; la contrainte totale
-- (dossier, exercice, version) suffit à l'upsert, jamais un index unique partiel (CLAUDE.md).
```

### 4.2 `lignes_d_affectation` (AFF2) — la répartition

```sql
create table public.lignes_d_affectation (
  affectation_id uuid not null references public.affectations_du_resultat(id) on delete cascade,
  rang smallint not null check (rang between 1 and 20),
  origine text not null check (origine in ('benefice', 'perte', 'report_crediteur', 'autres_reserves', 'reserves_statutaires')),
  destination text not null check (destination in (
    'reserve_legale', 'reserves_statutaires', 'autres_reserves', 'report_crediteur', 'report_debiteur', 'dividendes')),
  montant_centimes bigint not null check (montant_centimes > 0),
  constraint lignes_d_affectation_pkey primary key (affectation_id, rang),
  constraint lignes_d_affectation_sens check (origine <> destination)
);
```

Les couples admis (§ 3.3) sont jugés par la fonction, avec les plafonds du § 3.4 ; la table ne porte que la forme.

### 4.3 `ecritures_brouillon`

Une colonne `affectation_id uuid references affectations_du_resultat(id)` (sans action : la garde refuse le retrait d'une
décision dont l'écriture est validée), et une contrainte « sans autre source » sur le patron de
`ecritures_brouillon_dotation_sans_piece_ni_mouvement` : une ligne qui cite une affectation ne cite ni pièce, ni
mouvement, ni aucune autre source.

### 4.4 Le catalogue des rôles

Sept rôles neufs dans `roles_comptables` (et `lib/planComptable.ts`, `LIBELLES_COMPTES`), au nom du PCG :
`reserve_legale` (1061, 106100), `reserves_statutaires` (1063, 106300), `autres_reserves` (1068, 106800),
`report_a_nouveau_crediteur` (110, 110000), `report_a_nouveau_debiteur` (119, 119000), `dividendes_a_payer` (457,
457000), `acomptes_sur_dividendes` (1209, 120900). Aucun n'empiète sur un rôle existant (le 12 du résultat, le 455 de
l'associé, le 467 et le 468) ; `regler_plan_du_dossier` et la reprise qui propose le plan (PC6) les apprennent. Le bilan
range déjà ces comptes (§ 1.1) ; le 1209 reste « à classer » tant que son solde n'est pas imputé.

### 4.5 Les fonctions (toutes `security definer`, `set search_path = public`, `revoke execute … from public, anon`)

| Fonction | Ce qu'elle fait |
|---|---|
| `enregistrer_affectation(p_dossier_id, p_exercice, p_version_lue, p_decision jsonb, p_lignes jsonb, p_ecriture jsonb)` | Accès vérifié (`admin_du_dossier`) avant toute lecture ; verrou PARTAGÉ de la validation ; refus du § 3.4, dans l'ordre que le module redit ; lit et fige le résultat, le capital, la forme, les soldes ; marque la version lue `remplacee` (refus si elle n'est plus en vigueur : la saisie retient la version qu'elle remplace) ; écrit la décision, ses lignes, et l'écriture recomposée en entiers, comparée en multiensemble à `p_ecriture` (refus s'ils diffèrent) |
| `retirer_affectation(p_dossier_id, p_affectation_id, p_version_lue)` | Mêmes contrôles ; marque `retiree` ; retire l'écriture (les lignes PROPRES à la décision seulement) |
| `joindre_document_affectation(p_affectation_id, p_chemin, p_empreinte)` | Le PDF du procès-verbal déposé : chemin et empreinte, une fois par version |
| `garder_affectation` (déclencheur) | Refuse toute écriture directe dans les deux tables et sur les lignes du brouillon qui citent une décision, hors des fonctions et de la restauration (super-administrateur) ; refuse tout changement quand l'exercice de la date de décision est validé |
| `valider_exercice` (AFF3) | Le filet : une décision en vigueur dont la date tombe dans l'exercice validé doit avoir son écriture, intacte (recomposée et comparée) ; sinon refus, aux mots du module. Une décision « non approuvée » n'en demande aucune. Rien en trésorerie |

### 4.6 Les policies et les droits

Les deux tables : RLS activée, une policy `for select to authenticated using (admin_du_dossier(dossier_id))` (la table
enfant remonte à son parent), une policy d'insertion de restauration `to authenticated with check (is_super_admin())` ;
aucune autre écriture que par les fonctions ; aucune branche client (le client ne lit pas ses comptes ici : C4a, les
situations publiées, est le seul chemin ; un procès-verbal au client passera, plus tard, par les documents du cabinet,
B2). Les droits hors RLS naissent comme toute table neuve (SELECT, INSERT, UPDATE, DELETE seulement, `droits_hors_rls`) ;
la policy `deux_facteurs` si le second temps de C7 est appliqué d'ici là. Le PDF : le seau des dossiers, chemin
`<dossier>/affectations/<id>.pdf`.

### 4.7 Les essais

`supabase/essais/affectationDuResultat.sql` (une transaction, `psql -1`, sur une réplique en PostgreSQL 17, ICU `en-US`) :
chaque refus du § 3.4 avec sa RAISON (P0001), la réserve légale au centime (vingtième arrondi au supérieur, plafond du
dixième atteint, dépassé, pertes antérieures), le plancher des capitaux propres, la version lue périmée, le gel par la
validation, la trésorerie refusée en premier ; `rls.sql` (les deux tables dans la boucle, les mutations qui doivent
mordre) ; `validationExercice.sql` rejoué en entier, les deux modèles. Le module (`affectationDuResultat.test.ts`)
confronte ses refus au texte exporté.

---

## 5. Les effets ailleurs

### 5.1 Le bilan 2033-A

- **L'exercice de la décision** (N+1) : l'écriture solde le 120 ou le 129 ; leurs montants passent dans les cases 126,
  132, 134 et, pour les dividendes non payés au 31 décembre, 175. La rubrique `resultats-en-attente` se vide, et le point
  `affectation-non-ecrite` se tait de lui-même.
- **Le point se refonde** : il ne dit plus « l'application n'écrit pas encore l'affectation » mais, selon le cas, « aucune
  décision enregistrée pour l'exercice N » (et le délai de six mois, dépassé ou non) ou « une décision enregistrée, pas
  encore écrite ». Le 1209 qui porte un solde à la clôture se dit (AFF-Q8).
- **L'exercice affecté** (N) : rien ne change — son bilan est « avant répartition » (art. 112-2), et l'ouverture
  confrontée de N+1 reste juste, l'écriture venant après l'ouverture.
- **Le report des soldes** ne change pas : un 120 que l'affectation a soldé en N+1 laisse le 120 de N+2 au seul résultat de
  N+1, et le libellé « Résultats en attente d'affectation » ne sert plus qu'aux décisions manquantes.

### 5.2 La liasse 2033 (conception 37)

Le préalable de la liasse est levé ; la liasse lit les cases 126 à 134 comme les autres. Le 2065-bis (revenus distribués)
et le tableau d'affectation du régime normal (2058-C) restent hors (§ 9).

### 5.3 Le FEC et la piste d'audit

L'écriture va au journal OD sous une sorte à elle (`affectation`) dans la numérotation (`lib/fec.ts`), EcritureDate et
PieceDate la date de la décision, PieceRef « Affectation du résultat AAAA — décision du JJ/MM/AAAA », EcritureLib
« Affectation du résultat de l'exercice AAAA » ; aucun auxiliaire (le 457 n'a pas d'associé nommé, § 3.7). La piste
d'audit cite la décision, sa version, et l'empreinte du document s'il est joint.

### 5.4 La validation

Les préalables (`prealablesValidation.ts`) disent, avant le clic : une décision enregistrée sans écriture à jour (erreur,
le filet) ; un 120 ou un 129 d'ouverture non nul sans décision au-delà du 30 juin (attention, AFF-Q9).

### 5.5 La révision (R1 à R9)

La décision est PROPOSÉE comme preuve des soldes de 1061, 1063, 1068, 110, 119 et 457 (R3), et l'approbation des comptes
de N devient un travail du cycle « capitaux propres » de N+1 (R4) ; une preuve dit ce qu'elle n'établit pas — un projet de
procès-verbal n'établit pas que l'assemblée s'est tenue. R8 (la citation d'un fichier) pourra citer le procès-verbal
signé, rapporté par le cabinet.

### 5.6 L'assistant

Il lit la décision en vigueur (organe, date, montants par destination) et le délai, sans jamais l'écrire ; ses comptes par
le plan du dossier (`plan_du_dossier`). Aucun nom d'associé n'existe à lui transmettre. Redéploiement par sa ligne
d'import.

### 5.7 La sauvegarde et la restauration

Les deux tables au plan de sauvegarde derrière `AFFECTATION_PREVUE` (`auPlanAujourdHui`), la décision avant ses lignes,
avant le brouillon ; la restauration réinsère par le super-administrateur ; le PDF suit le pack (ce sont des fichiers du
dossier).

### 5.8 L'écran

Une carte « Approbation et affectation du résultat AAAA » dans l'onglet Clôture de l'exercice N validé (AFF-Q11) : le
résultat lu, la proposition (réserve légale minimale et son calcul dit, bénéfice distribuable, plafond des dividendes),
la saisie des lignes, les refus avant le clic, la confirmation qui NOMME ce qui s'écrit et dans quel exercice ; puis le
document (télécharger, régénérer après remplacement) et le calendrier. Une lecture partielle n'offre aucun geste. Rien
côté client.

---

## 6. Les lots

| Lot | Contenu | Jours | Drapeau | Dépend de |
|---|---|---|---|---|
| AFF1 | `lib/affectationDuResultat.ts`, pur, en centimes : le résultat à affecter, la réserve légale minimale, le bénéfice distribuable, le plancher des capitaux propres, la composition de l'écriture, les refus et leurs mots, les avertissements (six mois, neuf mois, moitié du capital) ; ses tests, dont des cas tirés des textes relus (§ 10) | 1,5 | aucun (module) | ligne 31 |
| AFF2 | Migration `affectation_du_resultat` : les deux tables, la colonne, la contrainte « sans autre source », les sept rôles, `enregistrer_affectation`, `retirer_affectation`, `joindre_document_affectation`, la garde, les policies ; `affectationDuResultat.sql`, `rls.sql` ; le plan de sauvegarde ; `types.ts` | 3 | `AFFECTATION_PREVUE` baissé | AFF1 |
| AFF3 | Migration `validation_et_affectation` : le filet de `valider_exercice` ; `fec.ts` (sorte, numérotation), la piste d'audit ; `prealablesValidation.ts` ; les lecteurs du brouillon qui doivent connaître la ligne (concordance, « à régénérer », balance) | 2 | le même | AFF2 ; après INV3 et LIA5 s'ils passent avant (§ 7) |
| AFF4 | La carte de l'onglet Clôture (§ 5.8) : proposition, saisie, refus avant le clic, remplacement, retrait, verrous | 2,5 | `AFFECTATION_EXPORTEE` baissé | AFF2 |
| AFF5 | Le document : procès-verbal d'assemblée, décision de l'associé unique, consultation écrite (pdf-lib), tiré des comptes figés, son dépôt et son empreinte ; le calendrier (six mois, greffe, neuf mois) dans `echeancesFiscales.ts` et « Mon échéancier » | 2,5 | le même | AFF4 ; R223-24 et R223-26 relus |
| AFF6 | Le bilan (`affectation-non-ecrite` refondé, le 1209), `ouvertureConfrontee.ts` (son texte), la Checklist, la révision (R3, R4), l'assistant (lecture, redéploiement par sa ligne d'import) | 1,5 | le même | AFF3, AFF4 |
| AFF7 | La mise en production : simulation (fichiers posés, drapeaux levés, suite entière), collage, les trois contrôles, `rejouer.py`, essais rejoués, drapeaux levés | 0,5 | levés | tout |

Environ quatorze jours (13,5). L'ordre : AFF1 → AFF2 → (AFF3 ∥ AFF4) → AFF5 → AFF6 → AFF7. AFF2 et AFF3 se préparent et
se rejouent sur une réplique en PostgreSQL 17 (ICU `en-US`), jamais appliquées avant l'accord du cabinet ; AFF3, qui
remplace `valider_exercice`, mérite toute la rigueur (mutations, banc du leurre, empreinte forme 2 rejouée à l'identique
en trésorerie).

## 7. Les risques

- **Trois conceptions remplacent `valider_exercice`** (INV3, LIA5, AFF3) : chacune doit partir de la version en
  production au moment où elle se prépare, et la dernière posée reprendre les filets des autres. Un ordre à tenir, dit à
  la feuille de route ; une seule migration commune si deux lots sont prêts ensemble.
- **Le filet mal écrit** bloquerait toute validation en engagement (aucun dossier aujourd'hui) — ou, en trésorerie, s'il
  ne s'y taisait pas. Les essais de validation se rejouent en entier, les deux modèles.
- **Une règle de droit lue de mémoire** (un vingtième « du bénéfice diminué des pertes antérieures », le plancher de
  L232-11) donnerait un refus faux, ou un dividende fictif accepté : rien n'entre en AFF1 qui ne cite son article relu ce
  jour-là (§ 10), et le contre-calcul de l'expert-comptable (ligne 23.3) gagne un cas : une SARL à son deuxième exercice.
- **Le capital du dossier** peut mentir (une augmentation non saisie) : le dixième serait faux. La décision fige le
  capital lu, et l'écart au 101 se dit (§ 3.4).
- **Les lecteurs du brouillon par compte** (concordance, « à régénérer », bilan, balance, révision, assistant) doivent
  savoir qu'une ligne d'affectation n'est pas un écart : `grep "ecritures_brouillon"` dans `src` et `supabase/functions`
  avant AFF3.
- **La sauvegarde** : deux tables et une colonne ; une sauvegarde lue avant la migration échouerait sans le drapeau.
- **Le document pris pour un acte** : un projet de procès-verbal n'est pas une assemblée tenue. Le pied du document et la
  preuve proposée à la révision le disent ; le cabinet garde la validation juridique.
- **Le retour arrière** : avant toute donnée réelle, la recréation de la version précédente de `valider_exercice` et les
  drapeaux baissés suffisent ; retirer les tables, la colonne ou les rôles serait une migration DESTRUCTIVE, à présenter au
  cabinet.

## 8. Ce qui suit : le dépôt au greffe (ligne 46)

Dans le mois de l'approbation (deux mois par voie électronique), la société dépose au greffe les comptes annuels, la
proposition d'affectation et la résolution votée (ou la décision de l'associé unique), le rapport du commissaire aux
comptes s'il y en a un (C. com., L232-21 à L232-23), avec l'option de confidentialité des micro et petites entreprises
(L232-25). Cette ligne-ci lui laisse : la date de la décision (le point de départ du délai), le document et son empreinte,
le rappel au calendrier. Le dépôt lui-même (guichet unique de l'INPI, ou greffe) reste hors de l'application, comme la
télétransmission de la liasse (LIA-Q11) ; la ligne 46 dira s'il se prépare (un paquet des pièces) ou se trace seulement
(la date et le récépissé).

## 9. Ce qui reste hors des lignes 33 et 45

Les décisions extraordinaires (augmentation de capital par incorporation de réserves, réduction pour pertes, dissolution
anticipée de L223-42) ; les acomptes sur dividendes (1209) dans le premier temps (AFF-Q8) ; le calcul des retenues sur
dividendes (prélèvement forfaitaire non libératoire, prélèvements sociaux), la 2777, l'IFU (2561), les cotisations sociales
sur les dividendes d'un gérant majoritaire de SARL au-delà de 10 % du capital (CSS, L131-6) — un rappel au plus ; le
2065-bis et le tableau 2058-C ; la composition du capital et les associés nommés (LIA-Q10) ; les sociétés civiles en
trésorerie (SCP, SCM) et la répartition de leur résultat entre associés (2035) ; les exercices décalés (ligne 31,
restante : d'ici là, l'exercice est civil et les délais partent du 31 décembre) ; la convocation, le rapport de gestion et
les documents communiqués avant l'assemblée (R223-18 ; la dispense de rapport de gestion des petites entreprises, L232-1,
à relire) ; les conventions réglementées.

## 10. Points non vérifiés

- Le texte en vigueur de L232-10, L232-11, L232-12, L232-13, L223-26, L223-31, L225-100, L227-9, L223-42, L225-248, L232-21 à
  L232-25, L241-3 et L242-6 du code de commerce, et de R223-18, R223-24 et R223-26 : confirmés en substance par des recherches
  le 12/11/2026 (des extraits de Légifrance et des commentaires), JAMAIS lus en entier ce jour ; à relire sur Légifrance
  avant AFF1 (le calcul) et AFF5 (le document).
- Les articles 1211-11 et 1211-12 du PCG consolidé (report à nouveau, résultat) : numéros déduits de l'ancienne
  numérotation (941-11, 941-12) ; à vérifier.
- La nomenclature 2025-2026 a été lue dans un tableau d'éditeur, source secondaire : à recouper sur la liste des comptes du
  PCG consolidé avant AFF2 (le 1209 surtout, et l'intitulé exact du 4423).
- Le cas de l'EURL dont l'associé unique personne physique est seul gérant : le dépôt des comptes « vaut approbation » ;
  vaut-il aussi décision d'AFFECTATION, ou celle-ci doit-elle figurer au registre ? Les commentaires divergent ; AFF-Q12.
- Le rang d'arrondi de la réserve légale (« un vingtième au moins » : au centime supérieur, retenu ici par prudence) et la
  base du dixième (le capital à la date de la décision, ou au 31 décembre) : à confirmer par l'expert-comptable.
- Le comportement de `ecritures_brouillon_validation_complete` et de l'empreinte forme 2 pour une source de plus : à lire
  avant AFF3.

## 11. Les questions au cabinet

### AFF-Q1 — L'approbation et l'affectation : un enregistrement ou deux ?

- **Question** : la décision porte-t-elle à la fois l'approbation des comptes et l'affectation du résultat, ou
  l'approbation (ligne 45) vit-elle à part ?
- **Options** : (A) un seul enregistrement, l'issue « comptes non approuvés » gardée sans affectation ni écriture ; (B)
  deux tables, l'approbation puis l'affectation.
- **Recommandation : (A).** L'assemblée fait les deux dans la même séance (L232-12 : « après approbation des comptes ») ;
  deux tables doubleraient les refus et les versions sans rien dire de plus.

### AFF-Q2 — À quelle date s'écrit l'affectation ?

- **Question** : l'écriture se date-t-elle du jour de la décision, du 1er janvier de N+1, ou du 31 décembre de N ?
- **Options** : (A) la date de la décision, dans l'exercice qui la contient ; (B) le 1er janvier de N+1, avec les
  à-nouveaux ; (C) le 31 décembre de N.
- **Recommandation : (A).** (C) contredit le bilan « avant répartition » (PCG, art. 112-2) ; (B) date une décision avant
  qu'elle soit prise. La date réelle est aussi celle de la mise en paiement et du délai de dépôt.

### AFF-Q3 — La réserve légale : refusée ou seulement dite ?

- **Question** : une dotation à la réserve légale sous le minimum (un vingtième, jusqu'au dixième du capital) se refuse-t-elle ?
- **Options** : (A) refusée par la base, le minimum proposé et son calcul dits ; (B) proposée, un écart dit en attention.
- **Recommandation : (A).** L232-10 la prescrit « à peine de nullité de toute délibération contraire » : aucun cas légitime
  à saisir en dessous.

### AFF-Q4 — Les dividendes au-delà du distribuable

- **Question** : un dividende supérieur au bénéfice distribuable, ou qui ferait passer les capitaux propres sous le capital
  et les réserves indisponibles, se refuse-t-il ?
- **Options** : (A) refusé ; (B) dit en erreur, laissé au cabinet.
- **Recommandation : (A).** C'est un dividende fictif (L232-11 ; délit, L241-3 et L242-6) ; une affectation contraire n'a
  rien à faire dans la comptabilité, et le cabinet peut toujours saisir ce que la loi permet.

### AFF-Q5 — La forme et le capital, pris au dossier ?

- **Question** : la décision lit-elle la forme juridique et le capital de l'identité du dossier, ou les saisit-elle ?
- **Options** : (A) lus au dossier (`forme_juridique`, `capital`), figés avec la décision, refus s'ils manquent, l'écart du
  capital au 101 dit ; (B) saisis à chaque décision.
- **Recommandation : (A).** Une seule vérité, déjà écrite par le cabinet seul et imprimée par la facture ; (B) laisserait
  deux capitaux se contredire.

### AFF-Q6 — Le procès-verbal

- **Question** : jusqu'où l'application rédige-t-elle le procès-verbal (ou la décision de l'associé unique) ?
- **Options** : (A) un projet tiré des comptes figés et de la décision, présences, votes et signatures en blanc ; (B) les
  associés saisis (noms, parts) pour un procès-verbal complet ; (C) aucun document, la décision chiffrée seulement.
- **Recommandation : (A).** Les chiffres viennent des comptes figés, ce qui ne se devine pas reste au cabinet ; (B)
  stockerait des données personnelles d'associés que rien d'autre n'exige encore (LIA-Q10) ; (C) laisserait le cabinet
  recopier des montants à la main.

### AFF-Q7 — L'affectation d'une perte

- **Question** : une perte va-t-elle seulement au report à nouveau débiteur, ou peut-elle s'imputer sur des réserves ?
- **Options** : (A) au 119 par défaut, l'imputation sur les réserves disponibles (1063, 1068) ou le report créditeur au
  choix ; (B) au 119 seulement.
- **Recommandation : (A).** Les deux usages existent et sont licites ; la réserve légale et les réserves réglementées
  restent hors d'atteinte (une réduction de capital, elle, est extraordinaire, § 9).

### AFF-Q8 — Les acomptes sur dividendes (1209)

- **Question** : l'affectation impute-t-elle les acomptes versés en cours d'exercice ?
- **Options** : (A) lus au 1209 et imputés sur les dividendes décidés ; (B) hors du premier temps : un 1209 qui porte un
  solde refuse la décision et le dit.
- **Recommandation : (B).** Un acompte exige un bilan certifié par un commissaire aux comptes (L232-12) : rare dans les
  dossiers visés ; le 1209 est neuf (2025) ; (A) viendra s'il sert.

### AFF-Q9 — La validation de N+1 sans affectation de N

- **Question** : un exercice N+1 qui ouvre sur un 120 ou un 129 non affecté peut-il se valider ?
- **Options** : (A) oui, en attention (le délai de six mois dit) ; (B) non, l'affectation retient la validation.
- **Recommandation : (A)**, et le filet seulement pour une décision enregistrée dont l'écriture manque. L'absence
  d'assemblée est une irrégularité juridique, pas une comptabilité fausse (le 120 « en attente » est exact) ; la liasse,
  elle, le dira (préalable de la conception 37).

### AFF-Q10 — Le paiement des dividendes

- **Question** : l'application écrit-elle le paiement des dividendes et ses retenues ?
- **Options** : (A) non : le paiement passe par le relevé sur le 457, ventilé avec les retenues (4422, 4423) que le cabinet
  saisit ; (B) l'application calcule les retenues et compose l'écriture.
- **Recommandation : (A).** Les outils existent (un mouvement du relevé s'écrit sur un compte de bilan, il se ventile) ;
  (B) demande les taux de l'année, la résidence et la situation de chaque associé, que l'application n'a pas.

### AFF-Q11 — Où vit la carte ?

- **Question** : où se saisit l'affectation ?
- **Options** : (A) l'onglet Clôture de l'exercice N validé ; (B) l'onglet Bilan de N+1 ; (C) un onglet « Juridique ».
- **Recommandation : (A).** C'est la suite de la clôture de N, et l'écriture apparaît d'elle-même dans les Écritures de
  N+1 ; (C) attendra la ligne 46 et d'autres actes.

### AFF-Q12 — L'EURL dont l'associé unique est seul gérant

- **Question** : quand le dépôt des comptes vaut approbation (L223-31), l'application produit-elle quand même une décision
  de l'associé unique ?
- **Options** : (A) toujours une décision d'affectation, le dépôt valant approbation dit en mention ; (B) l'organe « dépôt
  valant approbation », sans document.
- **Recommandation : (A)**, sous réserve de la validation juridique du cabinet : l'affectation reste une décision à dater
  et à garder, et un document de plus ne nuit pas (§ 10).

### AFF-Q13 — Le premier exercice après une reprise

- **Question** : l'affectation du résultat de l'exercice tenu dans l'ancien logiciel (le 120 ou le 129 de la balance
  reprise) se saisit-elle dans l'application ?
- **Options** : (A) oui, le résultat lu au 120 ou au 129 repris (`origine_du_resultat = 'balance_reprise'`) ; (B) non,
  seulement un exercice validé dans l'application.
- **Recommandation : (A).** C'est le premier cas réel de tout dossier repris en cours de vie : sans lui, une société
  reprise garderait son 120 en attente pendant toute son année.
