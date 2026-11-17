# Les exports vers les logiciels de production comptable : la recherche

Demande du cabinet du 17/11/2026 : l'application doit pouvoir « envoyer » ses écritures de précomptabilité au logiciel de
production comptable d'un expert-comptable. Le premier visé utilise ACD (i-Suite Expert / DIA, « Comptabilité Expert ») ; le
cabinet veut ensuite couvrir « les plus grands logiciels ». Ce document est une RECHERCHE documentaire, rendue le 17/11/2026 :
aucun code de l'application, aucune écriture en base. Il dit, logiciel par logiciel, quel fichier d'écritures il sait IMPORTER,
d'après quelles sources, avec quelle confiance — pour qu'on écrive ensuite un export par format. Le récit court :
HISTORIQUE.md, « LES EXPORTS VERS LES LOGICIELS COMPTABLES : LA RECHERCHE ».

**Règles suivies** : sources PUBLIQUES seulement (documentation des éditeurs, aides en ligne, guides de tiers qui exportent
vers eux, forums), toutes consultées le 17/11/2026 ; aucun accès payant ou réservé contourné ; rien de décompilé ; le code
d'une bibliothèque tierce (le module comptable de Dolibarr) lu pour des NOMS de champs, jamais recopié. Ce qui n'a pas été
trouvé est écrit « non trouvé » ; aucun champ n'est inventé. Les degrés de confiance : **éditeur** (documentation de
l'éditeur du logiciel), **tiers** (documentation d'un tiers qui exporte vers lui), **forum**, **non trouvé**.

**Sources fermées à cette session** (protection anti-robot, réponse 403) : le centre d'aide de Qonto
(`support-fr.qonto.com`), celui d'iDocus (`idocus.zendesk.com`), celui d'EBP (`support.ebp.com`), celui de Chaintrust
(`aide.chaintrust.io`). Ce qui en est cité vient du RÉSUMÉ rendu par le moteur de recherche, et le dit (« résumé de
recherche ») : à relire à la main avant de s'y fier. `manuel.opensi.fr` (formats Sage, Cegid, Cador Dorac) répond 404.

## 0. En quinze lignes

1. **ACD importe le FEC**, en archive `.zip` qui porte le fichier et les justificatifs, avec une case « Reprise des pièces
   jointes » (deux tiers le documentent pas à pas). C'est la voie du premier export, et l'application produit déjà ce FEC.
2. ACD a aussi un format propre, le « format IN » (archive `.auto`), dont la structure n'est publiée nulle part : non trouvé.
3. ACD a une API (« API Suite Expert ») : `POST /v1/compta/ecriture`, les comptes, les journaux, la GED. Son swagger vit sur
   le serveur i-Suite de chaque cabinet ; les notes de version et la fiche des prérequis sont publiques.
4. Le FEC produit par ACD pour un BNC a la forme de notre FEC à vingt-deux champs — mais en Windows-1252, à comptes de
   huit chiffres, un journal par banque, ModeRglt en une lettre, NatOp et IdClient vides (§ 3.1, relevé du 17/11/2026).
5. **Le FEC « avec pièces » est le format pivot** : ACD, Sage Génération Experts, EBP, Tiime Expert, MyUnisoft, Cegid Loop
   (par API) et Pennylane le lisent. Ils diffèrent par des détails qui tiennent dans un PROFIL : la colonne du
   justificatif (aucune, `NumDoc`, `PieceJointe`), le dossier des pièces, l'encodage, la longueur des comptes, les journaux.
6. **Cegid Quadra** a son format propre, l'« ASCII Quadra », à largeur fixe, dont Cegid publie la description (document
   « public ») : le justificatif y tient en un nom de fichier de 8 caractères + extension, posé à côté du fichier.
7. **Cegid Expert** (et Loop, Fulll-Ibiza, MyUnisoft en fichier) lisent le **TRA**, à largeur fixe, décrit par des
   documents Cegid que deux éditeurs tiers redistribuent ; le justificatif y est un enregistrement « G » (chemin du document).
8. **Agiris Isacompta** lit un `.DEX` (une archive ZIP renommée : un `.ECR` et les PDF). La structure du `.ECR` : non trouvée.
9. **Cegid Loop, MyUnisoft, Pennylane, Inqom** ont une API publique documentée ; Loop et Pennylane acceptent le
   justificatif par URL ou par dépôt de fichier ; chacune demande un accord (clé de partenaire, OAuth, jumelage au cabinet).
10. Ordre recommandé : (1) le FEC avec pièces au profil ACD, sur le FEC existant ; (2) l'ASCII Quadra ; (3) le TRA ;
    (4) Isacompta et le format IN quand un fichier d'exemple existe ; (5) les API, après le MVP, une par une, sur décision.
11. Le justificatif part sous un nom NEUTRE (la référence de la pièce, jamais le nom du fichier déposé, qui nomme souvent
    un patient) : c'est déjà la règle de PieceRef (JJ1Q1-Q3).
12. Trois réglages par dossier sont inévitables et ne se devinent pas : la correspondance des journaux, la longueur des
    comptes, la forme des comptes de tiers. Tous les tiers qui exportent vers ces logiciels les demandent au cabinet.
13. Un export périodique pose une question que le FEC annuel ne pose pas : ne pas envoyer deux fois la même écriture
    (ACD ne détecte pas les doublons).
14. À demander à l'expert-comptable : un fichier d'exemple exporté de son logiciel, son plan de comptes, ses journaux, et
    un essai d'import de notre FEC fictif (`outils/fec/`) — § 6.
15. Huit questions au cabinet (EXP-Q1 à Q8), § 7 ; ce qui est resté « non trouvé », § 8.

---

## 1. Ce que l'application sait déjà exporter, et l'écart

Lu dans le dépôt le 17/11/2026 : `src/lib/fec.ts`, `src/lib/champsBncDuFec.ts`, `src/lib/champsBncExportes.ts`,
`outils/fec/fecFictif.mts`.

- **Un FEC par exercice** (article A47 A-1 du LPF), produit par `numeroterFec` puis `formaterFec` : la numérotation décide
  du journal, du numéro, de la pièce, du libellé du compte et de l'auxiliaire ; la mise en forme écrit. Tabulation, CRLF,
  virgule décimale, dates AAAAMMJJ, **UTF-8 sans BOM** (`telechargerTexte`), nom `<SIREN>FEC<AAAA>1231.txt`.
- **Dix-huit colonnes** en engagement ; **vingt-deux** pour un BNC en trésorerie (DateRglt, ModeRglt, NatOp, IdClient),
  derrière `CHAMPS_BNC_EXPORTES`, baissé jusqu'à la réponse de l'expert-comptable (FEC22-E2).
- **Journaux** : `AC` Achats, `VE` Ventes, `BQ` Banque, `OD` Opérations diverses, `AN` À-nouveaux (type `JournalCode`).
  **EcritureNum** : le code du journal et cinq chiffres (`AC00001`), une suite par journal.
- **Comptes à six chiffres** (512000, 706000), lus du plan du dossier ; auxiliaires (`CompAuxNum`, `CompAuxLib`) en
  engagement et pour le 411 d'une vente facturée.
- **PieceRef neutre** : `AAAAMMJJ-xxxxxxxx` (la date et les huit premiers caractères de l'empreinte SHA-256 du fichier),
  jamais le nom du fichier (JJ1Q1-Q3) ; le relevé, la caisse, la CA3, les dotations ont leur référence à eux.
- **ModeRglt en toutes lettres** (« Banque », « Espèces », « Virement »…), **NatOp** remplie (« Dépense — Achats »),
  **IdClient** rempli (le SIREN d'une entreprise, sinon le numéro de la facture).
- **Lettrage** (EcritureLet, DateLet) en engagement ; rien ne se lettre en trésorerie.

**L'écart avec un « envoi » vers un logiciel de production** :

| Ce qui manque | Pourquoi |
| --- | --- |
| Le justificatif lié à l'écriture | Le FEC ne le porte pas ; presque tous les imports l'acceptent (§ 4), et c'est ce que l'expert-comptable attend d'une précomptabilité |
| Une archive | Le fichier d'écritures et les pièces partent ensemble, en `.zip` (l'application sait écrire un ZIP : `jszip`, `lib/zipEnFlux.ts`) |
| Un profil par logiciel | Encodage, longueur des comptes, codes des journaux, forme des tiers, colonne du justificatif diffèrent |
| Un export par PÉRIODE | Le FEC est annuel ; un cabinet importe au mois ou au trimestre, et l'import ne détecte pas toujours les doublons |
| Les formats propres | ASCII Quadra, TRA, `.ECR`/`.DEX`, format IN : rien n'existe |
| Les API | Rien n'existe ; chacune serait une Edge Function, un secret par cabinet et une ligne du registre RGPD |

Ce qui ne manque PAS : la numérotation. Tout export doit en partir (`NumerotationFec`), jamais d'un second calcul — c'est
elle que la validation fige, et un export qui la contredirait contredirait le FEC.

## 2. Le tableau de synthèse

| Logiciel | Format conseillé | Importe le FEC ? | Pièce jointe liée ? | API d'import ? | Confiance |
| --- | --- | --- | --- | --- | --- |
| **ACD** (i-Suite Expert, DIA, Comptabilité Expert) | FEC en `.zip` avec les pièces | Oui (« Importation FEC ») | Oui, dans le zip, case « Reprise des pièces jointes » ; règle de nommage non trouvée | Oui (API Suite Expert, sur le serveur du cabinet) | tiers (import) ; éditeur (API, format IN nommé) |
| ACD, format IN | archive `.auto` | — | Oui d'après un tiers | — | tiers ; structure non trouvée |
| **Cegid Quadra** (Quadratus) | ASCII Quadra (`.txt`, largeur fixe) + pièces à côté | non trouvé | Oui : nom de fichier 8+3, position 182 | « API Quadra » citée par un tiers ; doc non trouvée | éditeur (format) ; tiers (procédure) |
| **Cegid Loop** | API `importJson` (ou `importFEC`, `importTRA`) | Oui, par API (`/importFEC`) | Oui : URL authentifiée (JSON) ; référence + dépôt (TRA) | Oui, documentée | éditeur |
| **Cegid Expert** | TRA (`.tra`, largeur fixe) + pièces | non trouvé | Oui : enregistrement `G` (chemin du document) | non trouvé | éditeur (format, document redistribué) ; tiers (procédure) |
| **Sage Génération Experts / Coala** | FEC + pièces dans le dossier `pieces` | Oui | Oui, par dépôt dans un répertoire ; règle de nommage non trouvée | Oui (Marketplace, payant côté cabinet) | tiers (FEC, pièces) ; éditeur (Marketplace, CSV) |
| Sage 50 / Sage 100 | FEC ; format paramétrable ; PNM (100) | Oui | non trouvé | non trouvé | forum |
| **Agiris Isacompta** | `.DEX` (ZIP renommé : `.ECR` + PDF) | Oui d'après une fiche produit (Isacompta Connect) | Oui, dans le `.DEX` | non trouvé | tiers ; structure du `.ECR` non trouvée |
| **EBP** (Hubbix, Open Line) | FEC en `.zip` avec un dossier de pièces | Oui | Oui : dossier `pieces_jointes` dans le zip | SDK cité ; non relu | éditeur, par résumé de recherche (page fermée) |
| **Ibiza** (Fulll) | TRA en `.zip` | non trouvé | Non en fichier d'après un tiers ; oui par API d'après un autre | Oui d'après des tiers ; doc non trouvée | tiers, par résumé de recherche |
| **MyUnisoft** | API : FEC ou TRA+PJ (zip), JSON, CSV | Oui (API `/FEC`, et dans l'écran) | Oui : colonne `PieceJointe` + fichiers dans le zip | Oui, documentée (clé de partenaire) | éditeur |
| **Pennylane** | API `ledger_entries` ; sinon import FEC | Oui (reprise) | Oui par API (`file_attachments`) ; en fichier : non trouvé | Oui, documentée (OAuth) | éditeur (API) ; tiers (import fichier) |
| **Tiime Expert** | FEC 22 colonnes + `NumDoc`, en `.zip` | Oui | Oui : 23ᵉ colonne `NumDoc` + fichiers dans le zip | non trouvé | éditeur |
| **Inqom** | API | non trouvé | Oui par API d'après un tiers | Oui (OpenAPI, partenaire) | éditeur (existence) ; tiers (usage) |
| **Cador** (groupe ACD) | format IN (`acd.in`) | non trouvé | non trouvé | non trouvé | tiers, par résumé de recherche |

## 3. Les fiches

### 3.1 ACD — i-Suite Expert, DIA, « Comptabilité Expert »

**Voie 1 — le FEC en archive, avec les justificatifs** (confiance : tiers, deux sources concordantes).

- Tiime Expert, « Import des écritures dans ACD », version du 30/11/2023 (PDF incorporé à
  `tiime-expert.helpscoutdocs.com/article/322-integrer-ecritures-acd`) : dans DiaClient, le dossier, onglet « Comptabilité
  Expert » → « Outils » → « Importation » → « Importation FEC » ; choisir le fichier **`.zip` (contenant le FEC et les pièces
  jointes)** ; cocher « Rupture par pièce », « Reprise des pièces jointes » et « Reprise de la date de saisie ». Le
  justificatif se relit ensuite dans « Révision des comptes », bouton « Voir la facture ». Tiime a dû ajouter une option
  d'export, « Liaison des pièces jointes compatible pour ACD et SAGE », « suite à des problèmes avec la gestion des noms
  des documents » : **le nom du fichier joint compte**, et sa règle n'est pas écrite dans le guide.
- Pennylane, « Exporter les écritures et les pièces jointes vers un logiciel comptable »
  (`help.pennylane.com/fr/articles/785854`) : « Importation > Interface générique > Importer… », champ « Nom du fichier
  d'écriture comptable (A47) », on y désigne le `.zip` SANS le décompresser ; options : « Suppression du radical pour les
  clients et les fournisseurs », « Adapter à la longueur de comptes du dossier », « Ajouter les racines C ou F devant les
  comptes auxiliaires », « Reprise des pièces jointes ». **« ACD ne détecte pas les doublons »** : un fichier importé deux
  fois crée les écritures deux fois. L'export de Pennylane ne porte ni l'analytique ni « les colonnes additionnelles
  DateRglt, ModeRglt et NatOp ».
- Les deux chemins de menu diffèrent (deux versions ou deux entrées du même import) : à voir chez l'expert-comptable.
- **Comptes** : la longueur s'adapte à l'import (case) ; les auxiliaires portent une racine `C` (clients) ou `F`
  (fournisseurs) — iPaidThat règle de même ses préfixes sur `C` et `F` et ses collectifs sur `CDIVERS` / `FDIVERS`
  (`help.ipaidthat.io/fr/articles/6895664`). L'API limite un compte à 13 caractères, racine comprise (éditeur).
- **Journaux** : ils doivent correspondre à ceux du dossier ACD (iPaidThat : « Modifier le journal … selon le code journal
  de votre dossier ACD »).
- **Lettrage, TVA** : non trouvé pour l'import du FEC (EcritureLet et DateLet sont dans le fichier ; rien ne dit qu'ACD
  les reprend). **Encodage accepté à l'import** : non trouvé.
- **Règle qui relie un fichier du zip à son écriture** (nom = PieceRef ? une colonne de plus ?) : **non trouvé**. C'est le
  point à faire trancher par un fichier d'exemple (§ 6).

**Voie 2 — le « format IN »** (confiance : éditeur pour l'existence, tiers pour l'usage ; structure non trouvée).

- Aide en ligne d'ACD, « Outils - Importation » (`www.suiteexpert.fr/AideProd/ISuite/ICompta/importation.htm`) :
  « Importation - Format ComptabilitéExpert » reprend « un fichier IN généré par la fonction Export ComptabilitéExpert
  (format IN) », et « permet également la reprise des données exportées pour les dossiers des logiciels autres que les
  Produits Experts ». La même page décrit l'import DiaFact (fichier `.TRS`, écritures et tiers) — sans objet ici.
- Pennylane : l'export « ACD (format IN) » est une archive **`.auto`** (« IN.auto »), importée telle quelle par « Importer
  vos FECs » → « Comptabilité Expert (Format IN)… », cases « Effacer le fichier après l'import » et « Adapter à la longueur
  des comptes du dossier » ; une autre devise demande un journal dédié (« E pour l'euro et $ pour le dollar »). Qonto nomme
  le même export « IN ZIP (.auto) » (résumé de recherche).
- iDocus proposerait un export ACD en `.txt` à séparateur « pipe » (résumé de recherche, page fermée) : peut-être le
  contenu du fichier IN, sans certitude.
- Forum Dolibarr (19/10/2023, `www.dolibarr.fr/forum/t/export-i-suite-expert/44501`) : un expert-comptable demande « le
  fichier format IN » ; réponse d'un intégrateur : « Format non disponible », utiliser le FEC.
- **La structure du fichier IN (enregistrements, champs) : non trouvée.**

**Voie 3 — un CSV à faire correspondre** (confiance : tiers, faible). Le module comptable de Dolibarr a un export « iSuite
Expert » : `;`, CRLF, Windows-1252, sans en-tête, treize champs — numéro d'écriture, date JJ/MM/AAAA, année, mois, jour,
référence de la pièce, libellé, compte (le général, ou l'auxiliaire sans ses zéros de fin pour un 411/401), nom du tiers,
débit, crédit, montant, code du journal. Rien ne dit quel import d'ACD le lit ni avec quel réglage ; pas de justificatif.

**L'API** (confiance : éditeur). « ACD a développé des API pour permettre à d'autres éditeurs d'interagir avec nos
logiciels » (fiche « Prérequis - API Suite Expert », 20/03/2025, publique sur `basdeco.suiteexpert.fr`).

- Prérequis : i-Suite Expert, la Suite Expert et ses services web à jour, **le dossier partagé (publié) sur i-Suite** en
  comptabilité. Pour se connecter : l'adresse du serveur i-Suite du cabinet, la référence de connexion (CNX), un
  identifiant — profil Collaborateur (ACD recommande « un collaborateur fictif spécialement dédié aux API », un par
  éditeur), Client (un seul dossier) ou Utilisateur i-Suite.
- Le swagger : `https://{adresse i-Suite du cabinet}/{CNX}/api/swagger/` — sur le serveur de CHAQUE cabinet, donc non
  consultable ici. Le détail des corps de requête : non lu.
- Les points d'entrée cités par les notes de version publiques (`www.suiteexpert.fr/Com/Documents/iSuiteExpert/API/`,
  versions 24.7 à 24.18, décembre 2024 à juin 2025) : `POST /v1/compta/ecriture` (création d'écritures ; quantités,
  échéances, analytique ; la date ne précède pas l'édition définitive ; une propriété `ReferenceGed`),
  `GET|POST /v1/compta/comptes/{clients|fournisseurs|généraux}`, `GET /v1/compta/comptes/collectifs`,
  `GET /v1/compta/journal` (dit si le numéro de facture est actif), `GET /v1/comptabilite/dossier` (`longueurComptes`,
  `gestionNumeroFacture`, `gestionEcheancier`, analytique), `POST /v1/compta/fec` (un EXPORT de FEC),
  `GET /v1/compta/planClassementEcriture/{codeJournal}` (le classement en GED des documents liés aux écritures),
  `/v1/ged/documents` (déposer, filtrer, supprimer), `POST /v2/sessions/dossier`. Dates forcées en `dd/MM/yyyy`.
- iPaidThat et Qonto s'y branchent avec l'adresse du serveur et un identifiant du cabinet (tiers) ; ACD publie la liste
  de ses partenaires (« Interfaces technologiques »). **Conditions d'un partenariat d'éditeur : non trouvées** — les
  prérequis publics ne citent aucune clé d'éditeur, seulement des identifiants que le cabinet crée.
- Comment un justificatif se lie à une écriture créée par l'API (`ReferenceGed` + dépôt en GED ?) : **non trouvé** hors
  du swagger.

**Relevé sur un FEC produit par ACD, 17/11/2026.** L'expert-comptable a remis un FEC réel d'un BNC produit par son
logiciel ACD (exercice 2025). Le fichier n'entre pas au dépôt et n'est pas cité ; seules ces observations de FORME en sont
retenues.

- Vingt-deux colonnes, dans l'ordre : JournalCode, JournalLib, EcritureNum, EcritureDate, CompteNum, CompteLib,
  CompAuxNum, CompAuxLib, PieceRef, PieceDate, EcritureLib, Debit, Credit, EcritureLet, DateLet, ValidDate,
  Montantdevise, Idevise, DateRglt, ModeRglt, NatOp, IdClient — les dix-huit de l'article A47 A-1 puis les quatre du BNC
  en trésorerie.
- Tabulation ; **Windows-1252** (ISO-8859) ; CRLF ; décimale à virgule, sans séparateur de milliers ; dates AAAAMMJJ ;
  nom `<SIREN>FEC<AAAAMMJJ>.txt`.
- **Comptes sur huit chiffres**, complétés de zéros (51210000, 10800000, 70600000…) ; **aucun auxiliaire** (CompAuxNum
  et CompAuxLib toujours vides).
- **Journaux** : un journal par banque, nommé au code de la banque (trois lettres) ; `AN` « A NOUVEAUX » ; `OD`
  « OPERATIONS DIVERSES » ; `BI` « OD D'INVENTAIRE ». **EcritureNum** : un entier continu sur tout l'exercice, tous
  journaux confondus (1 = les à-nouveaux, puis la banque, puis les OD) ; presque toutes les écritures de banque ont deux
  lignes.
- **PieceRef** : « AAAA-JJJJ-NNNNNN » (l'année, le code du journal sur quatre caractères complété d'espaces, un numéro
  sur six chiffres) ; PieceDate = EcritureDate partout.
- **ValidDate** : une même date pour presque tout l'exercice (le jour de la clôture, en avril N+1).
- Montantdevise « 0,00 » partout, Idevise vide ; **DateRglt = EcritureDate** partout ; **ModeRglt une LETTRE** (R très
  majoritaire, puis V, B, P) ; **NatOp et IdClient VIDES** partout.
- Lettrage (EcritureLet une lettre, DateLet) seulement sur 431, 471 et 120.

*Ce que le relevé confirme des sources publiques* : ACD connaît le tableau à vingt-deux colonnes d'un BNC en trésorerie,
et son import lit un fichier « A47 » (Pennylane) — notre FEC est dans sa forme native. La longueur des comptes est bien
un réglage du dossier (ici huit ; la case « Adapter à la longueur de comptes du dossier » et `longueurComptes` de l'API
en parlent). Les trois champs DateRglt, ModeRglt et NatOp sont de peu de poids à l'import : Pennylane ne les exporte pas,
Tiime Expert les lit « non pris en compte », et ACD lui-même laisse NatOp et IdClient vides.

*Ce qu'il contredit ou précise* : (1) l'encodage — ACD écrit en Windows-1252, quand le guide de Tiime fait choisir
« UTF-8 » pour l'import du même fichier dans Sage ; ce qu'ACD accepte à l'IMPORT reste non trouvé ; (2) rien de public ne
disait qu'un BNC en trésorerie y tient sans auxiliaire ni journal d'achats ou de ventes : tout passe par le journal de
la banque, en écritures de deux lignes ; (3) ModeRglt y est un CODE d'une lettre, dont la table n'est publiée nulle part
(le sens de R, V, B et P : non trouvé — ne pas le deviner).

*L'écart avec notre FEC à vingt-deux champs* (`src/lib/champsBncDuFec.ts`, `src/lib/fec.ts`) :

| Champ | ACD (relevé) | L'application | Conséquence pour un profil « ACD » |
| --- | --- | --- | --- |
| Encodage | Windows-1252 | UTF-8 sans BOM | À produire en Windows-1252 si l'import le veut ; « — » de NatOp existe en Windows-1252, pas en ISO-8859-15 |
| CompteNum | 8 chiffres | 6 chiffres | Compléter à la longueur du dossier (un réglage), ou s'en remettre à la case d'ACD |
| Journaux | un par banque (code de la banque), AN, OD, BI | AC, VE, BQ, OD, AN | Une correspondance par dossier ; nos écritures AC et VE d'un BNC n'ont pas de journal en face |
| EcritureNum | entier continu, tous journaux | `<journal><5 chiffres>`, par journal | Sans doute renuméroté à l'import (« Rupture par pièce ») : à éprouver |
| PieceRef | `AAAA-JJJJ-NNNNNN` | `AAAAMMJJ-xxxxxxxx` (pièce), autres références | « Rupture par pièce » coupe sur PieceRef : deux écritures d'un journal sous une même pièce se fondraient-elles ? à éprouver |
| ValidDate | la date de la clôture | la date de l'écriture au brouillon, de la validation ensuite | Sans effet attendu sur un import en brouillard : à confirmer |
| Montantdevise / Idevise | « 0,00 » / vide | vides | Aucune |
| DateRglt | = EcritureDate partout | la date du règlement, ou vide / la date de l'écriture (FEC22-Q1) | Aucune en trésorerie, où l'écriture est datée du règlement |
| ModeRglt | une lettre (R, V, B, P) | un mot (« Banque », « Espèces »…) | La table des lettres est à demander ; d'ici là, nos mots |
| NatOp | vide | « Dépense — Achats »… | ACD n'en attend rien ; la nôtre est permise par le texte (« à blanc si non utilisé ») |
| IdClient | vide | SIREN ou numéro de facture | Idem |
| CompAux | vides | vides en trésorerie, sauf le 411 d'une vente facturée | À voir avec la racine `C` / `F` d'ACD en engagement |
| Lettrage | 431, 471, 120 | rien en trésorerie | Aucune |

Rien de cela ne touche le FEC RÉGLEMENTAIRE de l'application (FEC22-Q1 à Q6 sont tranchées) : l'écart se traite dans le
profil d'export, à part.

### 3.2 Cegid Quadra (Quadratus, QuadraCompta) — l'« ASCII Quadra »

Source : Cegid, « Fichier d'entrée ASCII dans Cegid Quadra Comptabilité », fiche KB0014530, version Comptabilité
2023.194.10, mise à jour 08/2023, « Niveau : Document Public », conservée par le wiki de Dolibarr
(`wiki.dolibarr.org/images/f/fd/KB0014530_-_Fichier_d'entrée_ASCII.pdf`). Confiance : **éditeur**.

- Nom du fichier libre ; enregistrements de longueur variable, terminés par un retour ; le premier caractère dit le type.
  Encodage : non précisé par la fiche (« ASCII ») — non trouvé.
- **Enregistrement `M`, l'écriture** (une ligne par ligne d'écriture ; `*` = obligatoire) :

| Champ | Position | Longueur |
| --- | --- | --- |
| * Type = `M` | 1 | 1 |
| * Numéro de compte | 2 | 8 |
| * Code journal sur 2 caractères | 10 | 2 |
| * N° folio (« 000 » sans folio) | 12 | 3 |
| * Date d'écriture (JJMMAA) | 15 | 6 |
| Code libellé | 21 | 1 |
| Libellé libre | 22 | 20 |
| * Sens (D/C) | 42 | 1 |
| * Montant en centimes, signé (position 43 = le signe) | 43 | 13 |
| Compte de contrepartie | 56 | 8 |
| Date d'échéance (JJMMAA) | 64 | 6 |
| Code lettrage | 70 | 2 |
| Code statistiques | 72 | 3 |
| N° de pièce (5 caractères au plus) | 75 | 5 |
| Code affaire | 80 | 10 |
| Quantité 1 | 90 | 10 |
| Numéro de pièce (jusqu'à 8 caractères) | 100 | 8 |
| Code devise | 108 | 3 |
| * Code journal sur 3 caractères (Quadra Windows) | 111 | 3 |
| Drapeau « code TVA géré dans l'écriture » = O | 114 | 1 |
| Code TVA (0 à 9) | 115 | 1 |
| Méthode de calcul de la TVA (D débits, E encaissements) | 116 | 1 |
| Libellé d'écriture sur 30 caractères | 117 | 30 |
| Code TVA sur 2 caractères | 147 | 2 |
| N° de pièce alphanumérique sur 10 caractères | 149 | 10 |
| Réservé | 159 | 10 |
| Montant dans la devise (centimes signés) | 169 | 13 |
| **Pièce jointe : nom du fichier, 8 caractères + extension de 3** (import seulement) | 182 | 12 |
| Quantité 2 | 194 | 10 |
| NumUniq, code opérateur, date système (export seulement) | 204 | 10, 4, 14 |
| Numéro de pièce, prioritaire sur 149, 100 puis 75 | 232 | 20 |

- **Justificatif** : « les fichiers sont à localiser au même endroit que le fichier ASCII à importer ». Tiime Expert
  ajoute (tiers) qu'un numéro de pièce de plus de 8 caractères, ou qui porte « / », fait perdre le justificatif.
- **Tiers** : enregistrement `C` (compte : numéro sur 8 en 2, libellé 30 en 10, **compte collectif** 8 en 99, type
  C/F/G en 218, SIRET en 334…) ; **règlements** : enregistrement `R` après son `M` (échéance, montant, mode) ;
  **analytique** : `A`, `N`, `I` ; un enregistrement `Y;champ=valeur;…` après un `M` renseigne tout champ de l'écriture.
- **Journaux** : code sur 2 ET sur 3 caractères ; par défaut Quadra importe « en OD » si le journal n'est pas paramétré
  (Pennylane, tiers). **Lettrage** : un code de 2 caractères, position 70. **TVA** : des codes propres au dossier.
- **Procédure** (tiers : Tiime Expert, Pennylane) : « Outils » → « Suivi des dossiers » → « Import ASCII (Compta) » ; le
  fichier `.txt` et les images dans un même dossier décompressé.
- **Importe-t-il le FEC ?** non trouvé. **API** : Tiime Expert cite une « API Quadra » (interconnexion) ; documentation
  publique non trouvée.

### 3.3 Cegid Loop — une API documentée

Source : `developers.cegid.com/docreference/BusinessUnits/Loop-Api-Management-Docs/`. Confiance : **éditeur**.

- Points d'entrée (`https://api.cegid.com/loop-api-publiques/…`) : `importJson`, `importFEC`, `importTRA`, `importPerso`
  (un modèle d'import du dossier), `getImportStatus`, `storeDocument`, et le plan de comptes, les journaux, les tiers, les
  codes de TVA, le lettrage. En-tête `API-KEY`.
- **`importFEC`** : `{ codeIbs, URL | URI, SIRET }` — le FEC n'est pas envoyé, il est LU à une URL (ou un chemin Azure)
  « valide pendant au moins 24 heures ». Justificatifs avec le FEC : non documenté.
- **`importJson`** : par ligne, `date`, `journal`, `compte`, `tiers`, `libelle`, `reference`, `refPiece` (identifie les
  lignes d'une même pièce, consécutives), `debit` / `credit` (`amount`, `currency`…), `dateLettrage`, `codeLettrage`,
  `modePaiement` (1 aucun … 5 virement, 6 prélèvement…), `dateEcheance`, analytique ; **`fichier.uri` : « une URL
  authentifiée »** du justificatif, que Loop télécharge et dépose dans le SharePoint du dossier. Options : créer ou non
  les journaux, comptes et tiers absents, refuser le déséquilibre, à-nouveaux, plusieurs périodes.
- **`importTRA`** : le lettrage n'est pas repris ; pour les pièces, la référence du fichier dans le TRA puis le dépôt des
  fichiers dans un dossier du SharePoint / Teams du dossier (« Imports de fichiers »).
- **Accès** : une clé générée sur CegidLife (« Loop APIKey Standard », « toujours disponible » ; « APIKey Cabinet »,
  « seulement si le cabinet a acheté ce service ») ; le cabinet jumelle l'application dans « Loop Hub » (type
  « Partenaire ») et choisit les dossiers (tiers : Tiime Expert). Devenir une application proposée dans Loop Hub : non
  trouvé. Par défaut les écritures s'intègrent sans validation ; une attente de validation s'active sur demande (tiers).

### 3.4 Cegid Expert (et Y2, Loop, Fulll-Ibiza, MyUnisoft en fichier) — le TRA

Sources : « Description du fichier de mouvements .TRA », version 010 pour Yourcegid FINANCE Y2 (extrait Cegid diffusé par
LD Système, `www.ldsysteme.fr/…/Ecritures comptables Format CEGID TRA.pdf`) ; « Comptabilité S5 – Descriptif du fichier
de mouvement », version 7 du 04/08/2005 (diffusé par Logilys, `wikien.logilys.com`). Confiance : **éditeur**, par
documents redistribués, de deux versions — à confronter à un fichier d'exemple.

- Largeur fixe. **En-tête** : `***` (1-3), produit `S1`/`S3`/`S5`… (4-5), origine `CLI` ou `EXP` (6-8), contenu `JRL`
  journal / `DOS` dossier / `BAL` / `SYN` (9-11), format `STD` ou `ETE` (12-14), version (34-36), puis dossier, date,
  utilisateur. Des enregistrements `***PS1`…, de tiers, de comptes, de journaux, de RIB précèdent les écritures.
- **L'écriture** (une ligne par ligne) : JOURNAL a3 (1) ; DATECOMPTABLE JJMMAAAA (4) ; TYPE PIECE a2 (12 : `FC`, `AC`,
  `RC`, `FF`, `AF`, `RF`, `OD`, `OC`, `OF`) ; GENERAL a17 (14) ; TYPE CPTE a1 (31 : `X` auxiliaire, `A` analytique, `H`,
  `O`, `G` GED, `P`) ; AUXILIAIRE OU SECTION a17 (32) ; REFINTERNE a35 (49) ; LIBELLE a35 (84) ; MODEPAIE a3 (119) ;
  ECHEANCE (122) ; SENS `D`/`C` (130) ; MONTANT1 n20 (131, virgule, aligné à droite) ; TYPE ECRITURE a1 (151 : `N`
  normale, `S`, `U`, `R`) ; NUMEROPIECE n8 (152) ; DEVISE a3 (160) ; TAUXDEV n10 (163) ; CODEMONTANT a3 (173 : `E--`) ;
  MONTANT2, MONTANT3 n20 (176, 196) ; ETABLISSEMENT a3 (216) ; AXE a2 (219) ; NUMECHE n2 (221). Le format étendu (`ETE`)
  ajoute, entre autres, REFEXTERNE (223), DATECREATION (266), les codes de TVA (387-395), LETTRAGE a5 (1014),
  ETATLETTRAGE (1021), VALIDE (1177), ECRITURENUM, VALIDDATE (1400).
- **Justificatif** : un enregistrement de TYPE CPTE = `G` (GED) reprend journal, date, type de pièce, compte et
  REFINTERNE, puis **« Chemin du document + document associé », a255 en position 84**. Pennylane (tiers) : le `.tra` et
  les PDF dans le même dossier, « sans les renommer ».
- **Lettrage** : repris seulement d'un fichier `DOS` ou `SYN`, pas d'un journal. **Tiers** : compte général collectif +
  auxiliaire sur 17. Libellé limité à 35 caractères (Qonto, résumé de recherche).
- **Procédure dans Cegid Expert** (tiers, Pennylane) : « Traitements annexes » → « Récupération de données » → « Import
  Cegid (ComxSx) ». **Import du FEC dans Cegid Expert** : non trouvé. **API de Cegid Expert** : non trouvé.

### 3.5 Sage — Génération Experts (Coala), Sage 50, Sage 100

- **Génération Experts / Coala, par le FEC** (tiers : Tiime Expert, « Import des écritures dans Sage », 30/11/2023) :
  onglet « Exercice » → « Importer un fichier des écritures comptables », ou « Fichier » → « Importer » → « Format FEC » ;
  le zip DÉCOMPRESSÉ ; séparateur « tabulation », encodage « UTF-8 » ; les comptes sont tronqués à 11 caractères ;
  l'import propose de supprimer les lignes de l'exercice ou le plan comptable (à refuser). **Justificatifs** : à déposer
  dans `\Coala\grps\dossiers\<code dossier>\compta\doc\<exercice>\pieces` (ou par la GED de Sage), puis visibles « en
  double-cliquant sur le pictogramme situé à droite du numéro de pièce ». La règle de nommage (le nom = le numéro de
  pièce ?) : non trouvée.
- **Par la Marketplace** (éditeur, `sagegenerationexperts.online-help.sage.fr`) : une application tierce envoie des
  écritures, intégrées « dès l'ouverture du dossier comptable », avec un superviseur des lots et un verrou par période.
  Côté cabinet c'est payant (« Module Sage Tiers MKT Privé », d'après Tiime Expert), et l'application se rattache par un
  identifiant d'« application privée ». Documentation de l'API pour un éditeur : non trouvée.
- **Compta Collaborative** (éditeur) : un `.csv` à point-virgule, 1 Mo au plus, « format bien défini » (page liée, non
  relue) ; date, journal, compte, pièce et libellé obligatoires, montants sans signe, pièces équilibrées.
- **Format propre à Coala** : le module de Dolibarr écrit un CSV « Coala » à neuf champs (date JJ/MM/AAAA, journal, compte,
  numéro d'écriture, référence, débit, crédit, « E », auxiliaire) — tiers, faible ; spécification de Sage non trouvée.
  Dext nomme un export « SAGE GE + IMAGES (ZIP) » (résumé de recherche), sans le décrire.
- **Sage 50** (ex-Ciel) : une commande « importer des écritures ou FEC », des formats « Sage Expert » et des imports
  personnalisés (forum Sage) ; l'ancien format Ciel `XIMPORT.TXT`, à largeur fixe (Dolibarr, tiers).
- **Sage 100** : le FEC par un modèle paramétrable « Import FEC.ema » ; le PNM « supporté en standard », mais non
  importable depuis une application externe par la commande directe, d'après un intervenant de Sage (forum). La fiche
  « Sage - Format de fichier PNM » : non trouvée.

### 3.6 Agiris — Isacompta

Confiance : **tiers** (Tiime Expert, « Guide détaillé de l'export vers AGIRIS », 09/10/2024 ; Pennylane ; iPaidThat ;
RCA, « Importer les écritures dans Isacompta »).

- Le fichier d'échange est un **`.DEX`** : le renommer en `.ZIP` donne « le fichier des écritures (`.ECR`) et les
  justificatifs PDF ». Versions du format citées par RCA : « v12.60 », « v13.60 avec pièces jointes », « v13.60 avec
  pièces jointes et codes TVA ».
- **Import par dépôt** : le `.DEX`, dont le nom commence par le code du dossier, se dépose dans le répertoire `Maj`
  (`…\Agiris\isacowp.gi\Maj`), dossier fermé ; à l'ouverture du dossier, Isacompta propose l'intégration, écritures et
  justificatifs. **Import à la main** : « Comptabilité » → « Imports » → « Ecritures Isacompta » sur le `.ECR`, puis les
  PDF déposés dans le répertoire de la GED du dossier.
- L'export demande un code d'utilisateur, un numéro de dossier et une case « Écritures modifiables » (sans elle, seule
  une restauration défait l'import). Les journaux doivent exister dans Isacompta avant l'import.
- RCA annonce le remplacement du dépôt par une « Publication de fichiers » dans Isacompta Connect.
- **Structure du `.ECR`** (enregistrements, champs) : **non trouvée**. Le CSV « Agiris » de Dolibarr (treize champs à
  point-virgule) n'est pas ce format. **Import du FEC** : une fiche produit d'Agiris citerait « fichier texte, fichier
  FEC, Excel » pour Isacompta Connect (résumé de recherche). **API** : non trouvée.

### 3.7 EBP

Confiance : **éditeur, par résumé de recherche** (`support.ebp.com/hc/fr/articles/36938690809245`, page fermée à cette
session).

- « Importer un FEC » dans EBP Comptabilité Open Line : le fichier doit être un **`.zip`** qui contient le FEC en `.txt`,
  un dossier de justificatifs en PDF — nommé « Pieces jointes » à un endroit de l'article et « pieces_jointes » à un
  autre —, et la description technique du FEC en PDF ; un import par exercice. L'export depuis EBP Hubbix coche
  « Pièces jointes ».
- Format texte historique d'EBP (Dolibarr, tiers, faible) : à virgule — numéro de ligne, date, journal, compte, libellé
  (40), pièce (15), montant, sens, échéance. EBP a des imports paramétrables et un SDK (documents cités, non relus).
- Règle qui relie un PDF à son écriture : non trouvée (à lire dans l'article, puis à éprouver).

### 3.8 Ibiza (Fulll)

Confiance : **tiers, par résumé de recherche** (Qonto, iDocus). Qonto exporte un **TRA en `.zip`** pour « FULLL - Ibiza »
et écrit que l'import par fichier n'y reprend pas les justificatifs ; iDocus s'y connecte par un jeton (champ « Scan et
OCR ») et y dépose écritures et pièces ; Mooncard annonce une intégration native. Documentation publique d'un format ou
d'une API : **non trouvée**.

### 3.9 MyUnisoft

Source : `github.com/MyUnisoft/api-partenaires` et `partners.api.myunisoft.fr`. Confiance : **éditeur**.

- Imports par API : **JSON**, **TRA+PJ** (`/api/v1/TRA/partial` : un `.zip`, le `.TRA` et les pièces à la racine), **FEC**
  (`/api/v1/FEC?type=…&exercice_id=…` ; `type` 0 refuse s'il existe des écritures, 1 ajoute, 2 REMPLACE celles de
  l'exercice), **CSV** (un modèle maison, le même que l'écran « Tenue > Imports »), Factur-X.
- **Le FEC avec justificatifs** : un `.zip`, et une colonne de plus après les dix-huit, **`PieceJointe`**, qui porte le
  nom du fichier (« PJ-1.pdf »). Une pièce s'attache aussi après coup (`/document/add_all_types`, par l'identifiant de
  l'écriture).
- **Accès** : une clé d'éditeur `X-Third-Party-Secret`, délivrée par MyUnisoft après un dossier de partenariat (nom,
  description, logo, contacts), et un jeton par société ou par cabinet ; une « formule API Cabinet » pour un cabinet
  seul. Vingt requêtes par dix secondes d'après un agrégateur (tiers).

### 3.10 Pennylane

Source : `pennylane.readme.io` (API), `help.pennylane.com` (aide). Confiance : **éditeur**.

- **API v2** : `POST /api/external/v2/ledger_entries` (une date, un libellé, un `journal_id`, des lignes au débit et au
  crédit sur des `ledger_account_id` — des identifiants propres à chaque société, un même numéro de compte existant en
  plusieurs variantes de TVA), `journals`, `ledger_accounts`, **`file_attachments`** (100 Mo au plus, attaché à
  l'écriture), le lettrage de lignes. OAuth 2.0 obligatoire pour une intégration publiée (contact : le service des
  partenariats) ; un jeton de société ou de cabinet pour soi.
- **Import par fichier** : l'import de FEC existe pour la reprise d'un dossier, et un import Excel / CSV à modèles ;
  format exact et justificatifs en fichier : non trouvés dans l'aide lue.
- Pennylane est surtout ici une SOURCE : son article d'export vers ACD, Isacompta, Quadra et Cegid Expert est le guide
  public le plus précis sur ce que ces quatre logiciels importent.

### 3.11 Tiime Expert

Source : aide de Tiime Expert, « Import FEC avec pièces jointes », « Import CSV avec pièces jointes » (PDF incorporés à
`tiime-expert.helpscoutdocs.com/article/484-…`). Confiance : **éditeur**.

- **FEC** : `.TXT`, tabulation, **ISO-8859-15 ou UTF-8** ; « les 22 colonnes (18 obligatoires et 4 supplémentaires) sont
  nécessaires », les quatre dernières « non prises en compte » mais avec leur en-tête ; **une 23ᵉ colonne, `NumDoc`**,
  porte le nom du fichier joint, extension comprise ; le FEC et les pièces (PDF ou images) dans une archive **ZIP**, un
  seul `.TXT` par archive ; une même pièce peut servir à plusieurs écritures ; un nom sans fichier, ou un fichier sans
  nom, est ignoré. Caractères interdits dans `NumDoc` : `< > : " | ? *` et l'espace final.
- **CSV** : onze colonnes à tabulation — code journal, nom du journal, date JJ/MM/AAAA, compte, libellé du compte, n° de
  pièce, libellé, débit, crédit, lettrage, `NumDoc`.
- Options de l'import : mettre à jour les libellés des journaux et des comptes, ignorer l'en-tête, importer le lettrage ;
  un import s'annule depuis son historique. **API d'import** : non trouvée.

### 3.12 Inqom

Confiance : **éditeur** pour l'existence (`help.inqom.com`, `api.inqom.com/api/documentation`), **tiers** pour l'usage
(Tiime Expert, « API Inqom »).

- Une API (cœur comptable et écritures, pièces comptables, banque…), des « scopes », une authentification de partenaire
  (« Authorization Code »), une marketplace de connecteurs. Le détail des routes d'écriture : non lu.
- Ce que Tiime Expert en dit : **le plan comptable d'Inqom est fermé** (un compte doit exister ou y être créable), **les
  zéros de fin ne comptent pas** (67120000 → 6712), les banques s'y numérotent 51211, 51212…, les caisses 53111… ; des
  règles sur les journaux, le lettrage et les à-nouveaux ; l'envoi porte les pièces jointes.
- **Import d'un FEC par fichier** : non trouvé.

### 3.13 Cador (groupe ACD)

Confiance : **tiers, par résumé de recherche**. Chaintrust importerait dans « ACD Cador » un fichier nommé `acd.in` par
« Comptabilité Expert FORMAT IN » ; Qonto dit son export « IN ZIP » « compatible avec ACD Cador ». Un manuel d'OpenSi
décrirait un format « Cador Dorac » à largeur fixe (enregistrements 1, 2, 3) — page introuvable (404), non relu.
Structure : **non trouvée**. Le format IN semble commun à Cador et à Comptabilité Expert : une raison de plus de le
demander à ACD.

### 3.14 Les autres rencontrés

- **LD Compta** (LD Système) publie ses formats d'import, et c'est par son site qu'on lit le TRA. **Gestimum, Cogilog,
  Winfic / WinSis, Charlemagne, OpenConcerto, Bob50** ont un export dans Dolibarr : aucun n'est un logiciel de cabinet
  significatif en France.
- **Les agrégateurs** (Chift, Apideck, Unified) revendent une API unique vers MyUnisoft, Inqom, Pennylane, Cegid… : un
  service tiers de plus par lequel passeraient les écritures et les pièces — hors de la liste du registre RGPD.
- **Les tiers de précomptabilité** (Dext, iPaidThat, Chaintrust, Tiime, Qonto-Regate, MEG de RCA) font tous le même
  choix : une API quand elle existe, sinon « FEC + images », « Quadra ASCII », « Cegid TRA », `.DEX`, format IN.

## 4. Le lien vers le justificatif : sept conventions

| Convention | Qui | Ce que l'export doit produire |
| --- | --- | --- |
| Les pièces dans le zip du FEC, liées par une règle de nom | ACD ; Sage GE (dossier `pieces`) | Le nom du fichier ; **règle non trouvée** (le numéro de pièce ?) |
| Un dossier nommé dans le zip du FEC | EBP (`pieces_jointes`) | Un dossier et sa règle de nom (non trouvée) |
| Une colonne de plus dans le FEC | Tiime Expert (`NumDoc`, 23ᵉ) ; MyUnisoft (`PieceJointe`, 19ᵉ) ; Dolibarr écrit `FichierFacture` (21ᵉ) | Le nom du fichier, extension comprise |
| Un champ à largeur fixe | Quadra (position 182, 8+3 caractères) | Un nom court ; les fichiers à côté |
| Un enregistrement à part | TRA (type `G`, chemin sur 255) | Une ligne par document |
| Une archive propre | Isacompta (`.DEX`), ACD (`.auto`) | Structure non trouvée |
| Une URL ou un dépôt par API | Cegid Loop (`fichier.uri`, URL valable 24 h) ; Pennylane (`file_attachments`) ; MyUnisoft ; ACD (GED) | Une URL signée du stockage, ou l'envoi du fichier |

Trois conséquences pour l'application :

1. **Le nom du fichier joint est une donnée que nous écrivons** : il se tire de la référence neutre de la pièce
   (`referenceDUnePiece`, « AAAAMMJJ-xxxxxxxx »), jamais de `pieces.nom_fichier`, qui nomme souvent un patient. Pour
   Quadra, huit caractères : l'empreinte courte seule (`LONGUEUR_DE_L_EMPREINTE_COURTE` vaut déjà 8).
2. **Une écriture sans fichier n'a pas de justificatif à joindre** (le relevé, la caisse, une dotation, la CA3) : le
   champ reste vide, et l'export le compte.
3. **Une URL signée du stockage** (la voie de Loop) ferait sortir le fichier vers un tiers par une adresse valable un
   jour : à présenter au cabinet avant d'être écrite, comme toute lecture ouverte.

## 5. La recommandation : l'ordre de construction

**Le principe** : un seul moteur, la numérotation du FEC (`numeroterFec`), et des PROFILS d'export qui ne font que la
mettre en forme. Un profil dit : le format (FEC, ASCII Quadra, TRA), l'encodage, la longueur des comptes, la correspondance
des journaux, la forme des tiers, la convention du justificatif, le nom de l'archive. Aucun profil ne recalcule une
écriture. Rien ne part sans un clic, et l'écran dit avant le clic ce qui part (le nombre d'écritures, de fichiers, ce qui
n'a pas de justificatif).

1. **EXP1 — le pivot : le FEC « avec pièces », profil ACD.** Une archive ZIP, le FEC du dossier (dix-huit ou vingt-deux
   colonnes) et les justificatifs sous leur nom neutre. C'est le MVP (MVP-D5 : l'expert-comptable importe le FEC), et
   presque tout existe. Reste : l'archive, l'encodage Windows-1252 en option, la longueur des comptes, la correspondance
   des journaux, et la règle de nom que l'essai chez l'expert-comptable dira. **Préalable : l'essai d'import du FEC
   fictif** (`outils/fec/`), qui tranche aussi FEC22-E2.
2. **EXP2 — les variantes du pivot**, presque gratuites une fois EXP1 fait : Tiime Expert (`NumDoc`), MyUnisoft en
   fichier (`PieceJointe`), EBP (dossier `pieces_jointes`), Sage Génération Experts (UTF-8, dossier `pieces`). Chacune
   ne s'ouvre qu'à la demande d'un cabinet qui a le logiciel, et s'éprouve chez lui.
3. **EXP3 — l'ASCII Quadra** : le logiciel le plus répandu en cabinet après le pivot, et le seul format propre dont
   l'éditeur publie la description. Largeur fixe, montants en centimes entiers (l'application compte déjà en centimes),
   comptes sur 8, journal sur 2 et 3 caractères, justificatif en 8+3.
4. **EXP4 — le TRA** : Cegid Expert, et par ricochet Loop, Fulll-Ibiza et MyUnisoft. Largeur fixe, en-tête et
   enregistrements de paramètres à écrire ; deux versions de la description à confronter à un fichier d'exemple.
5. **EXP5 — Isacompta (`.DEX`) et le format IN d'ACD** : seulement quand un fichier d'exemple et, mieux, la description de
   l'éditeur existent. Sans eux, rien ne s'écrit : on n'invente pas un format.
6. **EXP6 — les API**, après le MVP, une par une, sur décision : ACD d'abord (le premier expert-comptable ; l'écriture ET
   le document en GED, sans fichier à manipuler), puis Cegid Loop, MyUnisoft, Pennylane. Chacune : une Edge Function, les
   identifiants du cabinet en secret côté Supabase (jamais au navigateur), une ligne du registre RGPD, un accord de
   l'éditeur quand il en faut un.

**Ce que tout export devra tenir, quel que soit le format** (règles du projet) : une lecture partielle n'exporte rien ;
le fichier se tire de la numérotation, figée pour un exercice validé ; aucun nom de patient (ni libellé de banque, ni nom
de fichier) ; l'export est un geste du cabinet, jamais du client ; les réglages du profil sont SAISIS, « à saisir » tant
qu'ils ne le sont pas, jamais devinés.

**Les trois risques à éprouver avant d'écrire** :

- *Les doublons.* « ACD ne détecte pas les doublons. » Un export par période sans mémoire de ce qui est parti promet une
  écriture importée deux fois ; Pennylane tient un export « incrémental » pour cela. EXP-Q3.
- *Les écritures qui bougent.* Avant la validation, une écriture du brouillon se réécrit (un rapprochement défait, une
  pièce corrigée) : ce qui est déjà chez l'expert-comptable ne suit pas. Ou bien on n'exporte que des périodes arrêtées,
  ou bien l'écran dit ce qui a changé depuis le dernier export.
- *Les à-nouveaux.* Notre FEC ouvre par le journal `AN` ; le logiciel de l'expert-comptable a les siens. Les importer les
  doublerait : un profil doit pouvoir les exclure (Loop en a l'option).

## 6. Ce qu'il faut demander à l'expert-comptable

Pour valider le profil ACD — et la même liste vaudra pour tout autre logiciel :

- **EXP-E1 — un fichier d'exemple exporté de son logiciel avec ses pièces** : un mois d'un dossier FICTIF ou de
  démonstration, exporté en FEC avec justificatifs (et, s'il le peut, en « format IN »). On y lira la règle de nom des
  pièces, l'encodage, ce que portent PieceRef et EcritureNum. Jamais un fichier réel au dépôt.
- **EXP-E2 — son plan de comptes** pour un BNC : la longueur des comptes (huit, d'après son FEC), les comptes qu'il
  emploie pour la banque, la caisse, l'exploitant (108…), les honoraires, la TVA ; ses comptes de tiers s'il en tient.
- **EXP-E3 — ses journaux** : les codes et libellés (un par banque, AN, OD, BI d'après son FEC), et dans lequel il veut
  recevoir nos écritures d'achats (`AC`), de ventes (`VE`), de banque (`BQ`), d'OD.
- **EXP-E4 — l'essai d'import** de notre FEC fictif (`outils/fec/lancer.mjs`, vingt-deux champs, les deux variantes) dans
  un dossier d'essai : par quel menu, quelles cases, quel message ; l'UTF-8 passe-t-il, ou faut-il du Windows-1252 ;
  « Rupture par pièce » garde-t-elle nos écritures telles quelles ; les à-nouveaux gênent-ils.
- **EXP-E5 — la table de ModeRglt** de son logiciel (les lettres R, V, B, P de son FEC) et ce qu'il attend, à l'import,
  de DateRglt, ModeRglt, NatOp et IdClient — c'est aussi FEC22-E2.
- **EXP-E6 — sa façon de travailler** : importe-t-il au mois, au trimestre ou à l'année ; veut-il les justificatifs dans
  sa GED ; importe-t-il en brouillard ou en écritures validées ; que fait-il d'une écriture corrigée après un import.
- **EXP-E7 — l'API** : son cabinet a-t-il i-Suite Expert et les services web ; accepterait-il de créer un collaborateur
  dédié à l'application et de publier le dossier — pour plus tard (EXP6).

## 7. Les questions au cabinet

```json
[
  {
    "id": "EXP-Q1",
    "chantier": "Exports vers les logiciels comptables (57)",
    "titre": "Le premier export vers ACD : par quel chemin",
    "question": "Pour envoyer les écritures au logiciel ACD de l'expert-comptable, on commence par le FEC accompagné des justificatifs, par le « format IN » d'ACD, ou par l'API d'ACD ?",
    "contexte": "ACD importe un FEC en archive ZIP avec les pièces (deux guides de tiers le décrivent, case « Reprise des pièces jointes »), et l'application produit déjà ce FEC. Le « format IN » existe mais sa structure n'est publiée nulle part. L'API existe (création d'écritures, GED) mais vit sur le serveur de chaque cabinet et demande une Edge Function, des identifiants du cabinet en secret et une ligne au registre RGPD.",
    "recommandation": "Le FEC avec pièces : c'est le chemin du MVP (MVP-D5), il sert aussi Sage, EBP, Tiime Expert et MyUnisoft, et il ne demande aucun accord d'éditeur. Le format IN seulement si ACD en donne la description ; l'API après le MVP.",
    "options": ["(A) Le FEC avec les justificatifs, en archive", "(B) Le format IN d'ACD, une fois sa description obtenue", "(C) L'API d'ACD tout de suite"],
    "option_recommandee": "(A)",
    "source": "docs/conceptions/57-exports-vers-les-logiciels-comptables.md, § 3.1 et § 5",
    "pose": "17/11/2026"
  },
  {
    "id": "EXP-Q2",
    "chantier": "Exports vers les logiciels comptables (57)",
    "titre": "Les justificatifs partent-ils avec les écritures ?",
    "question": "L'export vers le logiciel de l'expert-comptable emporte-t-il les fichiers des pièces, et sous quel nom ?",
    "contexte": "Presque tous les logiciels savent rattacher le justificatif à l'écriture importée, et c'est ce qu'un expert-comptable attend d'une précomptabilité. Mais les fichiers peuvent porter des données de patients (RGPD.md), et leur nom d'origine nomme souvent un patient : la référence d'une pièce au FEC est déjà neutre (date et empreinte, JJ1Q1-Q3).",
    "recommandation": "Oui, sur une case que le cabinet coche à chaque export, chaque fichier renommé par la référence neutre de sa pièce ; l'écran dit avant le clic combien de fichiers partent et combien d'écritures n'en ont pas.",
    "options": ["(A) Oui, sur une case cochée à chaque export, sous un nom neutre", "(B) Non : les écritures seules, les pièces restent dans l'application et dans le pack", "(C) Oui, toujours, sans case"],
    "option_recommandee": "(A)",
    "source": "docs/conceptions/57-exports-vers-les-logiciels-comptables.md, § 4",
    "pose": "17/11/2026"
  },
  {
    "id": "EXP-Q3",
    "chantier": "Exports vers les logiciels comptables (57)",
    "titre": "Ce qu'un export couvre, et la mémoire de ce qui est parti",
    "question": "Un export couvre-t-il l'exercice entier, ou une période choisie — et l'application retient-elle ce qui a déjà été exporté ?",
    "contexte": "Le FEC est annuel. Un cabinet importe plutôt au mois ou au trimestre, et ACD ne détecte pas les doublons : un même fichier importé deux fois double les écritures. Retenir ce qui est parti demande une table en base (une migration) ; et une écriture du brouillon peut encore changer après son export.",
    "recommandation": "Une période choisie par le cabinet, et un journal des exports en base (la période, le profil, l'empreinte du fichier, l'auteur) : l'écran avertit quand une période est exportée une seconde fois ou quand une écriture déjà partie a changé, sans rien bloquer. Pour le MVP, l'exercice entier suffit.",
    "options": ["(A) Une période choisie, avec un journal des exports qui avertit", "(B) L'exercice entier seulement, comme le FEC", "(C) Une période choisie, sans mémoire, avec un simple avertissement écrit"],
    "option_recommandee": "(A)",
    "source": "docs/conceptions/57-exports-vers-les-logiciels-comptables.md, § 5",
    "pose": "17/11/2026"
  },
  {
    "id": "EXP-Q4",
    "chantier": "Exports vers les logiciels comptables (57)",
    "titre": "Les journaux, la longueur des comptes et les comptes de tiers : qui les règle",
    "question": "La correspondance entre nos journaux et ceux du logiciel, la longueur des comptes et la forme des comptes de tiers se règlent-elles par dossier, par le cabinet ?",
    "contexte": "Le FEC produit par ACD pour un BNC a des comptes sur huit chiffres et un journal par banque, quand l'application écrit six chiffres et les journaux AC, VE, BQ, OD, AN. Tous les tiers qui exportent vers ces logiciels demandent au cabinet d'aligner les journaux. Rien de cela ne se devine.",
    "recommandation": "Un réglage par dossier et par logiciel, saisi par le cabinet (« à saisir » tant qu'il manque, et l'export le refuse alors en le disant) ; aucune valeur par défaut tirée d'un autre dossier. Une table en base, donc une migration.",
    "options": ["(A) Un réglage par dossier, saisi par le cabinet, sans défaut", "(B) Des valeurs par défaut par logiciel, que le cabinet corrige", "(C) Rien : on exporte nos codes et l'expert-comptable règle son import"],
    "option_recommandee": "(A)",
    "source": "docs/conceptions/57-exports-vers-les-logiciels-comptables.md, § 3.1 et § 5",
    "pose": "17/11/2026"
  },
  {
    "id": "EXP-Q5",
    "chantier": "Exports vers les logiciels comptables (57)",
    "titre": "Les quatre champs du BNC dans l'export vers ACD",
    "question": "Dans le fichier destiné à ACD, écrit-on ModeRglt, NatOp et IdClient comme l'application les écrit, ou comme ACD les produit lui-même ?",
    "contexte": "Le FEC qu'ACD produit pour un BNC porte ModeRglt en une lettre (R, V, B, P) et laisse NatOp et IdClient vides ; l'application écrit ModeRglt en toutes lettres (« Banque »…) et remplit NatOp et IdClient (FEC22-Q1 à Q6). Les guides publics disent ces champs peu ou pas repris à l'import. La table des lettres d'ACD n'est pas publiée.",
    "recommandation": "Ne rien changer au FEC réglementaire. Dans le seul profil ACD, attendre l'essai d'import chez l'expert-comptable (EXP-E4, EXP-E5) : si nos valeurs passent, on les garde ; sinon on écrit ce qu'il indique.",
    "options": ["(A) Selon l'essai d'import chez l'expert-comptable, nos valeurs d'ici là", "(B) Comme ACD : une lettre pour ModeRglt, NatOp et IdClient vides", "(C) Les quatre champs vides dans l'export vers ACD"],
    "option_recommandee": "(A)",
    "source": "docs/conceptions/57-exports-vers-les-logiciels-comptables.md, § 3.1 (relevé du 17/11/2026)",
    "pose": "17/11/2026"
  },
  {
    "id": "EXP-Q6",
    "chantier": "Exports vers les logiciels comptables (57)",
    "titre": "Les formats suivants, et dans quel ordre",
    "question": "Après le FEC avec pièces, quels formats propres écrit-on, et quand ?",
    "contexte": "L'ASCII de Cegid Quadra est décrit par l'éditeur dans un document public. Le TRA de Cegid Expert est décrit par des documents Cegid que des tiers redistribuent. Le .DEX d'Isacompta et le format IN d'ACD n'ont pas de description publique.",
    "recommandation": "Quadra, puis le TRA, chacun quand un premier cabinet qui a le logiciel peut éprouver le fichier ; Isacompta et le format IN seulement sur un fichier d'exemple ou la description de l'éditeur. Rien de cela avant le MVP.",
    "options": ["(A) Quadra puis TRA, chacun à la demande d'un cabinet qui l'éprouve ; les autres sur un fichier d'exemple", "(B) Quadra et TRA tout de suite après le MVP, sans attendre de demande", "(C) Le FEC avec pièces seulement, tant qu'aucun cabinet ne demande autre chose"],
    "option_recommandee": "(A)",
    "source": "docs/conceptions/57-exports-vers-les-logiciels-comptables.md, § 3.2, § 3.4 et § 5",
    "pose": "17/11/2026"
  },
  {
    "id": "EXP-Q7",
    "chantier": "Exports vers les logiciels comptables (57)",
    "titre": "Les envois par API, et par quel intermédiaire",
    "question": "L'application enverra-t-elle un jour les écritures directement par l'API des logiciels (ACD, Cegid Loop, MyUnisoft, Pennylane), et accepte-t-on un agrégateur tiers ?",
    "contexte": "Quatre éditeurs documentent une API d'import ; chacune demande des identifiants du cabinet gardés en secret, une Edge Function, une ligne au registre RGPD, parfois un accord de partenariat (clé d'éditeur chez MyUnisoft, OAuth chez Pennylane). Des agrégateurs (Chift…) offrent une API unique, mais les écritures et les pièces passeraient par un service tiers de plus.",
    "recommandation": "Après le MVP, une API à la fois, sur décision du cabinet, ACD la première ; pas d'agrégateur (les données fictives sont traitées comme identifiantes : aucun service tiers hors de la liste).",
    "options": ["(A) Après le MVP, une par une, sur décision, ACD d'abord, sans agrégateur", "(B) L'API d'ACD dès maintenant", "(C) Jamais : des fichiers seulement", "(D) Par un agrégateur tiers"],
    "option_recommandee": "(A)",
    "source": "docs/conceptions/57-exports-vers-les-logiciels-comptables.md, § 3.1, § 3.3, § 3.9, § 3.10 et § 5",
    "pose": "17/11/2026"
  },
  {
    "id": "EXP-Q8",
    "chantier": "Exports vers les logiciels comptables (57)",
    "titre": "Qui exporte",
    "question": "L'export vers un logiciel comptable est-il un geste du cabinet seul ?",
    "contexte": "Le FEC se télécharge aujourd'hui depuis l'onglet Écritures, côté cabinet. Un accès client ne lit ni les écritures ni les catégories (règle des accès restreints) ; un praticien qui tient sa propre comptabilité est son propre cabinet.",
    "recommandation": "Le cabinet du dossier seul (`admin_du_dossier`), depuis l'onglet Écritures ; aucun écran client.",
    "options": ["(A) Le cabinet du dossier seul", "(B) Le chef du cabinet seul", "(C) Aussi un accès client qui porterait un droit neuf"],
    "option_recommandee": "(A)",
    "source": "docs/conceptions/57-exports-vers-les-logiciels-comptables.md, § 5",
    "pose": "17/11/2026"
  }
]
```

## 8. Ce qui est resté « non trouvé »

- **ACD** : la structure du format IN (`.auto`, `acd.in`) ; la règle qui relie un fichier du zip à son écriture à
  l'import du FEC ; l'encodage accepté à l'import ; ce que l'import fait d'EcritureNum, de ValidDate, du lettrage et des
  quatre champs du BNC ; la table des lettres de ModeRglt ; le corps de `POST /v1/compta/ecriture` et le lien d'une
  écriture à son document en GED (le swagger est sur le serveur de chaque cabinet) ; les conditions d'un partenariat.
- **Cegid Quadra** : l'encodage du fichier ASCII ; l'import du FEC ; la documentation de l'« API Quadra ».
- **Cegid Expert** : l'import du FEC ; une API ; la version du TRA que la version courante attend.
- **Cegid Loop** : les justificatifs avec `importFEC` ; les conditions pour figurer dans Loop Hub.
- **Sage** : la description du format propre à Coala et de l'export « Sage GE + images » ; la règle de nom des pièces du
  dossier `pieces` ; la fiche du format PNM ; la documentation de l'API de la Marketplace pour un éditeur.
- **Agiris** : la structure du `.ECR` et du `.DEX` (versions 12.60 et 13.60) ; l'import du FEC dans Isacompta ; une API.
- **EBP** : l'article lui-même (page fermée, lu par résumé) ; le nom exact du dossier des pièces et la règle de nom.
- **Ibiza / Fulll** : toute documentation publique d'un format ou d'une API.
- **Pennylane** : le format exact de l'import d'écritures par fichier, et les justificatifs dans ce cas.
- **Tiime Expert** : une API d'import. **Inqom** : l'import d'un FEC par fichier ; les routes d'écriture (non lues).
- **Cador** : tout, hors le nom du format.
- **À relire dans le texte avant d'écrire** : les jeux de caractères que l'article A47 A-1 admet pour le FEC (l'ISO
  8859-15 et l'UTF-8 y figurent de mémoire ; Windows-1252 n'est pas l'ISO 8859-15).

## 9. Les sources (toutes consultées le 17/11/2026)

**Éditeurs**

- ACD — aide en ligne i-Compta, « Outils - Importation » : `https://www.suiteexpert.fr/AideProd/ISuite/ICompta/importation.htm`
- ACD — « Prérequis - API Suite Expert », 20/03/2025 :
  `https://basdeco.suiteexpert.fr/cnx/api/v1/ged/documents/public/DC_SQL_PRÉREQUIS API SUITE EXPERT.PDF/apercu`
- ACD — notes de version de l'API : `https://www.suiteexpert.fr/Com/Documents/iSuiteExpert/API/Lisez-moi_API_V24.18.52.7.pdf`,
  `…_V24.16.49.2.pdf`, `…_V24.7.32.11.pdf`
- ACD — « Connexion entre notre outil de comptabilité et iPaidThat », 10/12/2024 :
  `https://www.acd-groupe.fr/2024/12/10/connexion-entre-notre-outil-de-comptabilite-et-ipaidthat/`
- Cegid — « Fichier d'entrée ASCII dans Cegid Quadra Comptabilité », KB0014530, 08/2023 (hébergé par Dolibarr) :
  `https://wiki.dolibarr.org/images/f/fd/KB0014530_-_Fichier_d%27entr%C3%A9e_ASCII.pdf`
- Cegid — API de Cegid Loop : `https://developers.cegid.com/docreference/BusinessUnits/Loop-Api-Management-Docs/`
  (`EcritureComptableImportJson.html`, `…ImportFec.html`, `…ImportTRA.html`, `…ImportPerso.html`, `Storedocument.html`,
  `Getapikey.html`)
- Cegid — description du fichier `.TRA`, version 010 (hébergée par LD Système) :
  `https://www.ldsysteme.fr/fileadmin/depot/np/ldcompta/Documentation/Ecritures%20comptables%20Format%20CEGID%20TRA.pdf` ;
  version 7 de 2005 (hébergée par Logilys) :
  `https://wikien.logilys.com/images/d/d5/Module_int%C3%A9gration_comptable_CEGID_FormatTRA_007.pdf`
- Sage — aide de Génération Experts : `https://sagegenerationexperts.online-help.sage.fr/import-decritures-dune-application-marketplace/`,
  `…/importer-fichier-ecritures-comptables-format-csv/`
- MyUnisoft — `https://github.com/MyUnisoft/api-partenaires` (`docs/documentation.md`, `docs/accounting/folder/import/`
  `tra.md`, `fec.md`, `csv.md`, `pj.md`) ; `https://partners.api.myunisoft.fr/`
- Pennylane — `https://pennylane.readme.io/llms.txt`, `https://pennylane.readme.io/docs/create-a-ledger-entry.md`,
  `https://pennylane.readme.io/docs/getting-started` ;
  `https://help.pennylane.com/fr/articles/785854-exporter-les-ecritures-et-les-pieces-jointes-vers-un-logiciel-comptable`
- Tiime Expert — `https://tiime-expert.helpscoutdocs.com/category/447-export` et `…/category/448-comptabilite`
  (articles 274, 322, 323, 324, 435, 436, 438, 469, 471, 484, et leurs guides PDF incorporés)
- Inqom — `https://help.inqom.com/fr/urls-api-inqom`, `https://help.inqom.com/fr/intégrations`,
  `https://api.inqom.com/api/documentation`
- EBP — `https://support.ebp.com/hc/fr/articles/36938690809245` (page fermée : lu par résumé de recherche)

**Tiers qui exportent vers ces logiciels**

- iPaidThat — `https://help.ipaidthat.io/fr/articles/6895664-connecter-acd-i-suite-expert-sur-ipaidthat`,
  `https://help.ipaidthat.io/fr/articles/7194723-comment-importer-vos-ecritures-sur-isacompta-agiris`
- RCA (MEG) — `https://supportrca.freshdesk.com/support/solutions/articles/101000428394`
- Dolibarr — le module comptable (`htdocs/accountancy/class/accountancyexport.class.php`, branche `develop`), lu pour les
  noms de champs des exports « iSuite Expert », « Coala », « Agiris », « EBP », « Ciel », « Quadratus », « FEC »
- Dext — `https://dext.com/fr/ressources/export-comptable-et-integration`, `…/acd`
- Qonto (pages fermées, résumés de recherche) — `https://support-fr.qonto.com/hc/en-us/articles/47539574858641`,
  `…/44967443678993`, `…/47404298732561`, `…/47433741210769`
- iDocus (page fermée, résumé de recherche) — `https://idocus.zendesk.com/hc/fr/articles/115002034169`
- Chaintrust (page fermée, résumé de recherche) — `https://aide.chaintrust.io/hc/fr/articles/9492570589341`

**Forums**

- Dolibarr — « Export I suite Expert », 19/10/2023 : `https://www.dolibarr.fr/forum/t/export-i-suite-expert/44501`
- Sage Community Hub — fils sur l'import du FEC et du PNM dans Sage 50, Sage 100 et Génération Experts
  (`https://communityhub.sage.com/fr/…`, lus par résumé de recherche)

**Hors des sources** : le relevé de forme du § 3.1 vient d'un FEC réel remis par l'expert-comptable le 17/11/2026, qui
n'est ni au dépôt ni cité.
