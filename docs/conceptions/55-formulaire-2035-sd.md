# 55 — La déclaration principale n° 2035-SD

Conçue et construite le 17/11/2026 sur la demande du cabinet : « je trouve le formulaire 2035 A SD mais pas le formulaire
2035 SD », puis « oui ouvre-le maintenant ».

## 0. Ce qui manquait

La 2035 se dépose en deux documents de la DGFiP. L'application remplissait le premier, la liasse des ANNEXES
(`public/formulaires/2035-sd-2026.pdf`, cerfa 15945*08, cinq pages : 2035-A, 2035-B, 2035-E, 2035-F, 2035-G — vérifié page par
page le 17/11/2026, son nom de fichier « 2035-sd » trompe). Elle ne produisait pas le second, la DÉCLARATION elle-même.

Sources, toutes publiques (impots.gouv.fr, `/sites/default/files/formulaires/2035-sd/2026/`) :

| Fichier | Contenu | SHA-256 |
|---|---|---|
| `2035-sd_5382.pdf` | la déclaration n° 2035-SD 2026, cerfa 11176*28, quatre pages | `2dc4ba76…82f0` |
| `2035-sd_5385.pdf` | la notice 2035-NOT-SD 2026, cerfa 50532#28 | `356e1e8d…257b` |
| `2035-sd_5383.pdf` | l'annexe 2035-AS-SD (sociétés et groupements), hors du chantier | `72faa2a5…8624` |

Le formulaire est livré dans `public/formulaires/2035-sd-declaration-2026.pdf`, à son empreinte (`lib/modeles2035SD.ts`,
vérifiée par le test et avant chaque remplissage). Il n'a ni champs de formulaire ni codes de case : tout se repère par les
libellés imprimés et les filets (§ 3).

## 1. Cadre par cadre : ce que l'application remplit, ce qui est à saisir, ce qui reste vide

Règle du dépôt : rien n'est rempli à la place du cabinet ; une valeur que l'application sait due sans la connaître s'imprime
« à saisir » en rouge, jamais 0 ; un montant nul ne s'imprime pas (une case vide vaut zéro) ; une case n'est jamais devinée.

### Page 1 — identification et récapitulation

| Cadre | Rempli | Source |
|---|---|---|
| Nom et prénom | oui | `dossiers.nom` (l'instantané d'un exercice validé), comme la 2035-A |
| Adresse du déclarant (la première) | oui | `dossiers.adresse`, l'adresse professionnelle (celle des factures et de la 2035-E) — 2035SD-Q2 |
| N° SIRET | oui | `dossiers.siret`, quatorze chiffres, en clair dans sa case |
| Nature de l'activité | oui | `dossiers.libelle_naf`, comme la 2035-A |
| Adresse mail, téléphone, seconde adresse, cabinets secondaires, domicile, modifications | vide | l'application ne les a pas, ou pas sûrement |
| Date de début de l'exercice de la profession | vide | 2035SD-Q1 : `parametres_des_cotisations` a un début d'activité, que l'on ne confond pas sans l'accord du cabinet |
| Membre d'une société / d'une SCM | vide | non modélisé |
| Période (activité commencée ou cessée en cours d'année) | vide | non modélisé |
| **1 — Résultat fiscal** : Bénéfice / Déficit | **oui** | les cases CP / CR de la 2035-B telles que leur PDF les imprime (`arrondirPourFormulaire`, ou l'instantané validé) |
| Prélèvement à la source : produits et charges exclus | vide | CB et CK sont des saisies du cabinet sans table ; les subventions et indemnités ne sont pas modélisées |
| Revenus de capitaux mobiliers, 1 bis (brevets, 10 %) | vide | non modélisés |
| 2 — Plus-values à long terme (six cases) | vide | l'application ne connaît pas les cessions |

### Page 2

| Cadre | Rempli | Pourquoi |
|---|---|---|
| 3 — Exonérations et abattements, dispositifs, dates | vide | non modélisés (renvoi 21 de la notice) |
| 4 — BNC non professionnels | vide | l'application tient une activité professionnelle |
| Comptabilité informatisée, logiciel | vide | 2035SD-Q3 : l'expert-comptable importe le FEC dans son logiciel (MVP-D5) ; qui « tient » la comptabilité est à dire |
| Professionnel de l'expertise comptable, conseil, ECF | vide | 2035SD-Q3 |
| Signature | vide | au déclarant |

### Page 3

| Cadre | Rempli | Source |
|---|---|---|
| Nom, SIRET (grille de quatorze) | oui | comme la page 1 |
| Services assurés, personnel salarié (A) | vide | la DSN n'est pas dans l'application ; BB (salaires nets) n'est pas le brut demandé |
| **I — Immobilisations et amortissements (B)** | **oui** | le registre `immobilisations`, par `lib/amortissements.ts` (§ 2) |
| Fraction SCM | vide | non modélisée |
| (B) Véhicules sous le barème | « à saisir » quand un véhicule du registre (compte 2182) est amorti l'année d'un barème (`amortissementsSousLeBareme`), sinon vide | `lib/forfaitKilometrique.ts` : l'application le signale, le cabinet sait lequel |

### Page 4

| Cadre | Rempli | Pourquoi |
|---|---|---|
| Nom, SIRET | oui | |
| II — Plus et moins-values (C) | vide | l'application ne connaît pas les cessions ; un bien cédé reste au registre (2035SD-E2) |
| III — Répartition entre associés (D) | vide | réservé aux sociétés |

## 2. Le tableau I

- Les biens du registre acquis au plus tard le 31 décembre de l'exercice, dans l'ordre de leur mise en service.
- Colonne 1 : la date de mise en service, ou d'acquisition sans elle — celle d'où part l'amortissement.
- Colonnes 2 et 3 : pour un dossier qui n'est pas redevable, le prix payé est la valeur du registre (le montant retenu y est
  TTC) et la colonne 3 n'est pas servie (la notice : « les personnes qui ne sont pas redevables de la TVA n'ont pas à servir
  cette colonne »). Pour un redevable : « à saisir » (le prorata et les biens exclus du droit à déduction ne se devinent pas).
- Colonne 4 : la valeur du registre. Colonne 5 : « L 20 % », le linéaire étant le seul mode de l'application.
- Colonne 6 : le cumul au 31 décembre d'avant ; colonne 7 : la dotation de l'année — le calcul même de la case CH et de
  `ecrire_dotation_amortissement` (prorata temporis en 30/360, le cumul arrondi).
- **La colonne 7 s'additionne en CH** : chaque dotation prend son euro inférieur, et les euros qui manquent pour atteindre CH
  vont aux plus forts restes (méthode du plus fort reste ; 2035SD-E1). Une ligne est toujours l'arrondi inférieur ou supérieur
  de sa dotation.
- **Confronté à CH** : si l'arrondi de la somme au centime n'est pas la case CH que la 2035-B imprime (le registre a bougé
  après la validation, ou une catégorie porte un poste « Amortissements »), le tableau s'imprime sans forcer, et l'écart se
  dit avant le clic et au bas de la page 3.
- Au-delà de vingt biens, des états annexes : des copies vierges de la page 3, en fin de document ; la page 3 porte son total
  et, en « Report du total de la dernière annexe », celui des annexes ; le total général (A) est sur la page 3.

## 3. Le code

- `src/lib/modeles2035SD.ts` — le millésime par exercice (N + 1), l'empreinte, l'avertissement d'un substitut (2035S-Q5 (B)),
  le drapeau `FORMULAIRE_2035_SD_OFFERT`, levé le 17/11/2026 sur la demande du cabinet.
- `src/lib/declaration2035SD.ts` — pur : la ligne 1 et le tableau I, ses avis.
- `src/lib/gabarit2035SD.ts` — pur : les cases repérées par leurs libellés et leurs filets (le premier filet à droite du libellé
  ouvre la case, le second la ferme), la grille du SIRET au pas irrégulier de la page 4, le tableau par les numéros de ses
  colonnes et ses lignes horizontales. Ce qui ne se retrouve pas n'est pas dessiné, il est dit.
- `src/lib/remplir2035SD.ts` — pdf.js lit la page (avec ses filets horizontaux), pdf-lib écrit ; l'empreinte vérifiée.
- Clôture : le bouton « Déclaration 2035-SD » à côté du PDF de la 2035-A/B, sous son verrou, retenu tant que le registre, les
  véhicules, les natures ou l'identité ne sont pas lus en entier ; un exercice validé relit son instantané (CP, CR, CH et le
  déclarant), l'adresse et le registre étant ceux d'aujourd'hui.

## 4. Questions

- **2035SD-Q1** (cabinet) — la date de début de l'exercice de la profession : la tirer du début d'activité de l'onglet
  Cotisations ? Recommandation : oui, quand il est saisi.
- **2035SD-Q2** (cabinet) — l'adresse du déclarant : l'adresse professionnelle du dossier ? Recommandation : oui.
- **2035SD-Q3** (cabinet) — « comptabilité informatisée » et le cadre du professionnel de l'expertise comptable : à remplir
  depuis le cabinet ? Recommandation : non pour l'instant ; une saisie par exercice, avec la 2035S3.
- **2035SD-E1** (expert-comptable) — l'arrondi de la colonne 7 par le plus fort reste, pour qu'elle redise CH.
- **2035SD-E2** (expert-comptable) — un bien cédé ou sorti : l'application ne connaît pas les cessions ; tant qu'elles ne sont
  pas modélisées, le tableau I liste tout le registre et le tableau II reste vide.
- **2035SD-E3** (expert-comptable) — les amortissements antérieurs d'un bien repris sont recalculés par la règle de
  l'application, pas relus de la reprise.

- **2035SD-E4** (expert-comptable) — le cadre 3, « exonérations… sur le bénéfice » : le reprendre des « dont » d'exonération de
  la ligne 43 que `saisies_2035` porte déjà (AW, CS, CU, CO, CI, CJ), quand l'écran des saisies se lèvera
  (`SAISIES_2035_EXPORTEES`) ? Recommandation : oui, la somme, le dispositif coché restant au cabinet.

Une saisie du cabinet pour les cadres vides (exonérations, salariés, plus-values) demanderait une migration (une table
`saisies_2035sd`, ou des codes de plus dans `saisies_2035`, dont la liste fermée ne connaît que des cases de la 2035-A/B) :
non préparée, à décider.
