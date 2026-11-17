# 58 — Les réponses de l'expert-comptable du 17/11/2026 : l'analyse d'impact

Analyse du 17/11/2026 (agent architecte). Rien n'est changé dans le code de l'application, la base ou les Edge Functions :
ce document dit, réponse par réponse, ce que fait l'application aujourd'hui (module et fonction, lus dans le code), ce que
la réponse confirme, précise ou contredit, ce qu'il faudrait changer, et dans quel ordre.

Les réponses sont reformulées ici ; la transcription du questionnaire rempli reste hors du dépôt. Les questions d'origine :
HISTORIQUE.md (« LES QUESTIONS À L'EXPERT-COMPTABLE » de FEC22, les fiches 2035-E 7 à 13, VF5 § 8, PIECES-E1, B9),
`docs/conceptions/54-…` (EL-E1 à E5), `55-…` (2035SD-E1 à E4), `42-…` (EXD-Q4), `45-…` (la réserve légale).

**Un fait appris le même jour.** Le logiciel de production de l'expert-comptable est ACD. Un FEC de BNC qu'il a produit
porte 22 colonnes ; des comptes à huit chiffres complétés de zéros ; ModeRglt en une lettre (R, V, B, P) ; NatOp et
IdClient vides ; DateRglt égale à la date de l'écriture, partout ; aucun compte auxiliaire ; un numéro d'écriture continu
sur l'exercice ; PieceRef de la forme « AAAA-JJJJ-NNNNNN ». La signification des quatre lettres n'est écrite nulle part :
elle n'est pas devinée ici.

**Sources publiques relues pour trancher sans resolliciter l'expert-comptable.** La notice 2035-NOT-SD 2026
(impots.gouv.fr, `2035-sd_5385.pdf`, empreinte `356e1e8d5d98…`, la même que celle de la conception 55), lue le 17/11/2026 :
le renvoi (10) (le petit matériel « d'une valeur unitaire hors taxe inférieure à 500 € ») ; le passage sur le tableau des
immobilisations (« le barème couvrant déjà l'amortissement — les amortissements afférents à ces véhicules doivent être
réintégrés au cadre B ») ; la ligne 13 « Autres impôts » (« comprennent notamment » la taxe foncière, la taxe sur les
salaires : une liste ouverte) ; BZ (contrats « Madelin », CGI art. 154 bis) et BU (nouveaux plans d'épargne retraite). Le
BOFiP n'a pas été joignable au-delà d'une recherche (aucune page BOI rendue) : les points qui en dépendent le disent.

Légende. **Verdict** : CONFIRME (l'application fait déjà ce que dit la réponse), PRÉCISE (la réponse tranche un choix
laissé ouvert, sans contredire), CONTREDIT (l'application ou une décision du cabinet fait autrement), AMBIGUË (la réponse ne
suffit pas à trancher : l'application garde ce qu'elle fait, dit en quoi). **MVP** : touche le premier dossier BNC en
trésorerie (exercice 2026, répétition de 2025). **Ampleur** : petite (un module, sans base), moyenne (plusieurs modules, ou
une migration sans fonction de garde), grande (une fonction de garde ou un calcul vérifié en base, un drapeau à lever).

---

## 1. Le FEC et son import

### 1.1 Les vides de DateRglt et ModeRglt, la validation, le lettrage, les journaux (FEC22-E2, E6, E8, E13)

- **Aujourd'hui.** `lib/champsBncDuFec.ts` : une écriture qui n'est pas un règlement (dotation, forfait, liquidation,
  à-nouveaux, régularisation : `champsDUneDotation`, `champsDUnForfait`, `champsDUneLiquidation`, `champsDesANouveaux`…)
  rend DateRglt et ModeRglt vides sous le choix FEC22-Q1 (A), ou « date de l'écriture / Sans règlement » sous (B). Le FEC
  d'un exercice validé porte ValidDate du jour de la validation (`lib/fec.ts`) ; EcritureLet et DateLet restent vides en
  trésorerie ; les journaux AN, AC, VE, BQ, OD et l'ouverture en une écriture AN. Le drapeau `CHAMPS_BNC_EXPORTES`
  (`lib/champsBncExportes.ts`) est NUL : il attendait FEC22-E2.
- **La réponse.** Les vides lui conviennent ; le FEC de l'exercice validé, ValidDate le jour de la validation ; lettrage
  vide accepté ; les journaux et les pièces acceptés.
- **Verdict.** CONFIRME FEC22-Q1 (A), la recommandation de FEC22-E8, FEC22-E6, FEC22-E13. Son propre FEC remplit DateRglt
  de la date de l'écriture : c'est l'option (B) de FEC22-Q1, qu'il n'exige pas ; on garde (A).
- **Changement.** Aucun dans ces champs. FEC22-E2 étant répondue, le drapeau peut se lever — mais pas seul : ModeRglt
  (§ 1.2) doit être juste AVANT, car la demande de validation fige les quatre champs (FEC22c2). Lot L2.
- **MVP** : oui (le FEC de 2025 de la répétition, puis 2026).

### 1.2 Le mode de règlement (FEC22-E3)

- **Aujourd'hui.** `MODES_REGLEMENT` (`lib/champsBncDuFec.ts`) est une liste fermée en toutes lettres (BOI-CF-IOR-60-40-20,
  § 290). Un règlement par le relevé écrit « Banque » (`champsDUnMouvementDuReleve`, `champsDUnePiece`, branche `releve`) :
  FEC22-Q2 (A), le cabinet l'ayant décidé pour le MVP. La caisse écrit « Espèces », le compte personnel « Compte
  personnel », le registre des encaissements son moyen (`MODE_DU_MOYEN`). L'import ne garde du mouvement que sa date, son
  montant et son libellé (`lib/importReleve.ts`).
- **La réponse.** Il faut le type de règlement.
- **Verdict.** CONTREDIT FEC22-Q2 (A) (« Banque ») ; c'est l'option (B) que FEC22-Q2 prévoyait « s'il l'exige ».
- **Changement.** Le mode réel d'un mouvement : la liste existe déjà (Virement, Prélèvement, Chèque, Carte bancaire,
  Espèces). Deux voies, EXP58-Q1 : (A) le DÉDUIRE, au moment de composer le FEC ou la demande de validation, des préfixes
  normalisés du libellé bancaire (« VIR », « PRLV », « CB », « CHQ », « REM CHQ », « RETRAIT »), dans le navigateur, sans
  migration, « Banque » quand rien ne se reconnaît — le libellé n'est pas transmis, il est seulement lu ; (B) une colonne du
  mouvement, proposée par la même déduction et corrigée par le cabinet dans la fiche (une migration, un écran). Les lettres
  d'ACD : la liste en toutes lettres reste (le § 290 l'admet) ; la table des lettres ne s'écrira que si l'essai d'import
  échoue sur elle, et sa signification se lira dans un FEC d'ACD que le cabinet fournirait (EXP58-Q1). Ampleur : moyenne
  pour (A), grande pour (B). **MVP** : oui, AVANT la validation de 2025 (lot L2).

### 1.3 NatOp (FEC22-E4)

- **Aujourd'hui.** `natOpDeLaLigne` écrit « la nature — le poste de la 2035 » (FEC22-Q3, tranchée (C)), la nature seule hors
  des lignes de résultat ; `lib/cases2035.ts` porte le poste. La 2035 se calcule depuis les SOURCES (catégorie → poste), et
  se compare aux écritures (« LA 2035 SE COMPARE AUX ÉCRITURES ») ; elle ne lit pas NatOp.
- **La réponse.** Il ne s'en sert pas : c'est le COMPTE qui doit donner la ligne de la 2035, pas l'inverse. Son FEC laisse
  NatOp vide.
- **Verdict.** PRÉCISE. NatOp reste ce qu'il est (permis, rempli sans texte libre, inutile chez lui mais inoffensif ; le
  champ est « à blanc si non utilisé » au VIII, 7°). Mais la seconde moitié de la phrase pèse plus : quand il importera le
  FEC, son logiciel classera chaque COMPTE sur une ligne de la 2035. Si deux catégories qui écrivent le même compte vont sur
  deux postes différents (ou une catégorie du dossier sur un compte que son plan range ailleurs), la 2035 qu'il recalculera
  depuis notre FEC ne sera pas la nôtre.
- **Changement.** Un contrôle, sans base : pour l'exercice, chaque compte de charge ou de produit écrit doit porter UN seul
  poste de la 2035 (sur les lignes du brouillon et leur catégorie) ; plusieurs, une attention dans la Vue d'ensemble et avant
  la validation, qui nomme le compte et ses postes (`lib/pointsDeLaChecklist.ts`, un point « attention »). Petite.
  **MVP** : oui (lot L1, avant la répétition, car la saisie de 2025 commence le 20/11).

### 1.4 IdClient (FEC22-E5)

- **Aujourd'hui.** `identificationDuClient` : le SIREN d'une entreprise cliente (Luhn vérifié, `sirenDuClient`), sinon le
  numéro de la facture (FEC22-Q4, tranchée (D)) ; jamais un nom ; vide hors des écritures d'une facture émise.
- **La réponse.** Un code par client.
- **Verdict.** CONTREDIT FEC22-Q4 (D) ; c'est l'option (C) que FEC22-Q4 prévoyait (« un code opaque par client du dossier et
  sa table de correspondance »). Son propre FEC de BNC laisse IdClient vide et n'a aucun auxiliaire : la réponse vaut pour
  les ventes FACTURÉES, pas pour les recettes du relevé.
- **Changement.** Un code opaque, stable, par fiche client (`contacts`), posé par la base à la création (une colonne et un
  compteur par dossier : une migration), jamais dérivé du nom ; IdClient = ce code sur les écritures d'une facture émise ;
  la table de correspondance dans l'export des clients (`EXPORTER LA FICHE D'UN CLIENT`) ; un seul système pour toutes les
  fiches, entreprises comprises (le SIREN ne servirait plus d'IdClient). EXP58-Q2. Moyenne. **MVP** : seulement si le praticien
  facture par l'application en 2026 (MVP-D1) — l'année 2025 rejouée n'a pas de facture source. Avant la validation de 2026
  (lot L3).

### 1.5 Les numéros de compte (FEC22-E11)

- **Aujourd'hui.** Six chiffres, la numérotation de 2026 (le 101 pour l'ancien 108) ; le plan du dossier (`plan_du_dossier`).
- **La réponse.** Le plan comptable en vigueur à la date d'établissement.
- **Verdict.** CONFIRME. Ses comptes à huit chiffres sont une forme de son logiciel : la longueur n'est fixée ni par l'A47
  A-1 ni par le PCG. Rien ne change ; l'essai d'import (§ 1.7) dira s'il les complète lui-même.

### 1.6 La devise ; un BNC en engagement (FEC22-E10, FEC22-E9)

- **Aujourd'hui.** Montantdevise et Idevise remplis sur la seule ligne au TTC entier d'une pièce en devise (FEC22-Q5 (A)) ;
  un BNC en engagement exporte dix-huit colonnes (`lib/fec.ts`, l'en-tête : « vingt-deux en trésorerie »).
- **Les réponses.** « En euros » ; un BNC en engagement : vingt-deux.
- **Verdicts.** E10 : AMBIGUË — « en euros » dit que la comptabilité est en euros (elle l'est), pas s'il veut ou refuse les
  deux colonnes facultatives ; on garde FEC22-Q5 (A), qui n'écrit rien pour une pièce en euros (le cas du MVP). E9 :
  CONTREDIT la lecture que l'application fait du VIII, 3° et 7° (vingt-deux colonnes pour la seule trésorerie) ; sans objet
  pour le MVP. On n'écrit rien tant qu'aucun BNC en engagement n'existe ; le jour où il en vient un, relire le VIII de l'A47
  A-1 à la source (Légifrance) avant de suivre l'un ou l'autre.

### 1.7 Le validateur, l'essai d'import, la forme du fichier (FEC22-E1, E7, E12, E14, le choix du fichier fictif)

- **Les réponses.** E12 : il passe Test Compta Demat, et le passera sur notre fichier fictif ; E1, E7, E14 et le choix du
  fichier : sans réponse (E1 se lit dans le fait du jour : ACD, vingt-deux colonnes).
- **Verdict.** E12 CONFIRME FEC22f. Les autres : rien à décider ; on garde UTF-8, tabulation, CRLF, la virgule, le nom
  `SirenFECAAAAMMJJ.txt`, et le fichier à vingt-deux colonnes d'`outils/fec/` est celui qu'on lui remettra. L'essai réel
  tranchera la forme ; aucune question n'est renvoyée.

---

## 2. La 2035 et la déclaration principale

### 2.1 Les dépenses payées par la carte personnelle ou en espèces ; la note de frais (PIECES-E1, 2035S-E2)

- **Aujourd'hui.** `ligneContrepartieDirigeant` (`lib/ecritures.ts`) : en trésorerie, une pièce de type « note de frais »
  qu'aucun mouvement ne paie s'écrit charge / compte de l'exploitant (108000 par défaut, le rôle du plan), datée de la pièce ;
  la 2035 la compte à cette date (`rattachementsTresorerie`, source `note_de_frais`, `lib/rattachement.ts`). MAIS une note
  remboursée par un virement du compte professionnel ET RAPPROCHÉE de lui « n'a plus de part note_de_frais : la banque la
  paie » — la charge tombe alors à la date du REMBOURSEMENT. Les espèces passent par la caisse (`paiementParLaCaisse.ts`).
  Le chantier B7 (`notes_de_frais`, préparée, `NOTES_DE_FRAIS_PREVUES` baissé) écrit la note d'un SALARIÉ au 421000.
- **Les réponses.** PIECES-E1 : en charge. 2035S-E2 : la note de frais n'existe pas en BNC en trésorerie ; une dépense
  payée de sa poche passe par le compte de l'exploitant, et son remboursement aussi.
- **Verdict.** CONFIRME le cas courant (charge face au compte de l'exploitant, à la date de la pièce) ; CONTREDIT le cas de la
  note RAPPROCHÉE de son remboursement, qui déplace la charge à la date du virement (l'exercice suivant, dans l'exemple de la
  question). Pour lui, le remboursement est un prélèvement de l'exploitant (compte de l'exploitant / banque), jamais le
  paiement de la dépense. Le 421 de B7 (un salarié) n'est pas visé : un salarié n'est pas l'exploitant, et sa dépense compte
  quand le praticien le rembourse (CGI art. 93, 1 : la dépense effectivement acquittée). Le 455 et le 421 n'ont jamais servi
  à l'exploitant en trésorerie (`compteDuDirigeant`, `lib/virementPersonnel.ts`).
- **Changement.** En trésorerie, une pièce « note de frais » de l'exploitant n'est ni proposée ni acceptée comme
  justificatif d'un mouvement : le virement qui la rembourse se classe en virement personnel (« UN VIREMENT PERSONNEL
  S'ÉCRIT »), la fiche du mouvement le proposant à la place et disant pourquoi. Sans migration (`candidatsDuMouvement`, la
  fiche, les lots) ; un rapprochement déjà fait se dit dans la Vue d'ensemble (« à reclasser »), sans réécriture
  automatique. Pour B7 : en trésorerie, la note du DIRIGEANT s'écrit au compte de l'exploitant à sa date, celle d'un salarié
  au 421 — à reprendre dans B8 avant sa levée. Petite à moyenne. **MVP** : oui (lot L1 : la saisie de 2025 en dépend).

### 2.2 Le chèque reçu en décembre et crédité en janvier ; la date de valeur (2035E-7, EL-E2, NOE-E2)

- **Aujourd'hui.** Une recette du relevé compte à la date du mouvement (`date` de `lignes_bancaires`, la date d'opération).
  L'import reconnaît une colonne « Date de valeur » (`lib/csv.ts`, rôle `date_valeur`) mais seulement pour l'écarter : elle
  n'est ni gardée ni lue. Un chèque émis est daté de son débit au relevé.
- **Les réponses.** 2035E-7 : à la date du crédit (sauf option pour l'engagement). EL-E2 : c'est la date de valeur qui fait
  foi. NOE-E2 : la date de valeur si on l'a, sinon la date d'encaissement.
- **Verdict.** 2035E-7 CONFIRME la règle de l'application (et contredit la lecture prudente de BOI-BNC-BASE-20-10-10, § 20,
  qui datait un chèque à sa remise : on suit l'expert-comptable, la date de la banque). EL-E2 et NOE-E2 PRÉCISENT : parmi les
  dates de la banque, la date de VALEUR d'abord ; à défaut, la date d'opération, ce que fait l'application. Le comportement
  actuel est donc la règle de repli admise, juste toute l'année sauf autour du 31 décembre.
- **Changement.** Garder la date de valeur quand le fichier la porte (une colonne `date_valeur` nullable de
  `lignes_bancaires`, lue par `csv.ts` et l'OFX — `DTAVAIL` quand il existe —, une migration non destructive), puis, plus
  tard, rattacher à l'année de sa date de valeur un mouvement dont les deux dates sont de part et d'autre du 31 décembre (les
  moteurs de la 2035, de la CA3, la validation, la concordance : grande). EXP58-Q4 : garder la date dès l'import du 20/11
  (sinon les relevés de 2025 importés sans elle ne la retrouveront pas : le dédoublonnage refuserait le réimport), son
  emploi plus tard. **MVP** : la capture oui (lot L1 si le cabinet l'accepte), l'emploi non (lot L4).

### 2.3 La fraction non déductible des repas (2035S-E3)

- **Aujourd'hui.** Rien : aucun paramètre de repas ; la case CC (« Divers à réintégrer ») se saisit par exercice
  (`saisies_2035`, écran derrière `SAISIES_2035_EXPORTEES`).
- **La réponse.** Elle change chaque année, selon le barème en vigueur l'année.
- **Verdict.** AMBIGUË pour le « où » demandé (elle répond sur le montant, pas sur la case) ; la notice 2035 ne cite pas les
  repas dans le renvoi (17) de CC. En attendant : la fraction non déductible se saisit en CC par le cabinet ; plus tard, un
  barème par millésime (la valeur du repas pris au foyer et le plafond), comme le barème kilométrique. Rien avant le MVP ;
  à la répétition, la CC de la 2035 déposée dira s'il l'a réintégrée là.

### 2.4 L'assurance emprunteur (2035S-E1)

- **Aujourd'hui.** `lib/echeanceEmprunt.ts` et `lib/comptes.ts` : l'intérêt au 661 (BN, « Frais financiers »), l'assurance
  au 616 (prime d'assurance, sous BH).
- **La réponse.** Peu importe. **Verdict.** CONFIRME (le choix est libre) ; rien ne change.

### 2.5 Les cotisations facultatives (2035S-E4)

- **Aujourd'hui.** `lib/cases2035.ts` : BZ « dont cotisations facultatives Madelin », BU « dont facultatives aux nouveaux plans
  d'épargne retraite », chacune sous BK, posée par le poste qui la nomme (2035S1) ; aucun plafond calculé.
- **La réponse.** Sous le plafond, en BU.
- **Verdict.** PRÉCISE, en partie AMBIGUË. La notice confirme la répartition : BZ pour les contrats Madelin (CGI art. 154
  bis), BU pour les PER. La réponse ajoute que seule la part SOUS LE PLAFOND se porte ; l'application ne calcule pas ce
  plafond (il dépend du bénéfice et du PASS). En attendant : la case reçoit le versement ; une attention avant la validation
  (« le plafond de déduction n'est pas calculé ; l'excédent se réintègre en CC ») quand BZ ou BU n'est pas nulle. Petite,
  hors du MVP sauf si le praticien verse à un PER (à voir sur la 2035 déposée).

### 2.6 Le remboursement qui dépasse la dépense (2035E-8)

- **Aujourd'hui.** Un remboursement rapproché d'une échéance négative réduit la case de la charge, qui peut devenir négative
  (`lib/declaration2035.ts` : « un poste négatif reste négatif »).
- **La réponse.** Une charge négative, ou le 758 (gains divers, AF).
- **Verdict.** CONFIRME (une des deux voies admises est la nôtre). Rien ne change.

### 2.7 Le tableau des immobilisations, la cession, le cadre des exonérations (2035SD-E1, E2, E4)

- **Aujourd'hui.** `lib/gabarit2035SD.ts` : la colonne 7 arrondie au plus fort reste pour redire CH ; le tableau II
  (plus-values) vide, l'application ne connaissant pas les cessions ; le cadre 3 des exonérations laissé au cabinet.
- **Les réponses.** E1 : oui. E2 : corriger à la main en attendant. E4 : certaines exonérations s'y mentionnent, d'autres
  non.
- **Verdicts.** E1 et E2 CONFIRMENT. E4 AMBIGUË : la recommandation de la conception 55 (reporter la somme des « dont »
  d'exonération de la ligne 43) est ABANDONNÉE — une somme mécanique mentionnerait ce qu'il ne faut pas ; le cadre reste
  vide, rempli par le cabinet, comme aujourd'hui. La notice ne tranche pas non plus dispositif par dispositif.

### 2.8 Le poste DC et la majoration du barème (2035S-E6, 2035S-E5)

- **Aujourd'hui.** DC en valeur absolue ; un véhicule à hydrogène suit la table thermique du barème (décision du 30/09,
  « Hybrides et hydrogène relèvent de la table thermique »).
- **Les réponses.** DC : oui. Hydrogène : selon la loi de l'exercice.
- **Verdicts.** DC CONFIRME. Hydrogène AMBIGUË : la réponse renvoie au texte de chaque année, ce que fait déjà le barème
  saisi par millésime (`lib/baremeKilometrique.ts`) ; rien ne change, le millésime de 2026 se relira à sa publication.

---

## 3. Les immobilisations

### 3.1 Le bien acquis avant la reprise : le tableau de l'année d'avant (2035SD-E3)

- **Aujourd'hui.** `lib/amortissements.ts` : chaque dotation se recalcule depuis le registre SEUL — linéaire, 30/360, depuis
  la mise en service (`amortissementCumuleCentimes`, `dotationAEcrire`) —, la base refaisant le même calcul
  (`amortissement_cumule_centimes`) et refusant une dotation qui ne le vaut pas. Le 28 de la balance reprise n'entre dans
  aucun calcul ; `lib/repriseDesAmortissements.ts` (IMMO-Q1) le confronte au registre, compte par compte, en attention.
- **La réponse.** On reprend le tableau au 31/12 de l'année d'avant, et on vérifie qu'il correspond à l'amortissement
  comptabilisé.
- **Verdict.** CONTREDIT la recommandation de 2035SD-E3 (garder le recalcul). La vérification qu'il décrit est IMMO-Q1, déjà
  faite ; c'est la SOURCE du cumul qui change : le tableau repris, pas le recalcul.
- **Changement.** Le cumul des amortissements au jour de l'ouverture, saisi par bien depuis le tableau repris (une colonne
  du registre), la dotation de N continuant le plan depuis ce cumul (la même annuité jusqu'à la valeur nette nulle) ; la base
  refait ce calcul-là (la fonction de garde des dotations change) ; IMMO-Q1 compare alors la somme des cumuls saisis au 28
  repris. Grande (base, garde, registre, 2035-SD). EXP58-Q5. **MVP** : oui pour la répétition (biens encore amortis de 2025)
  et pour 2026, avant la validation de 2025 (lot L2) ; d'ici là, la procédure de la répétition (aligner chaque bien sur
  l'ancien tableau, comparer bien par bien) tient lieu.

### 3.2 Le véhicule amorti l'année du barème (2035E-12)

- **Aujourd'hui.** La dotation d'un bien de matériel de transport s'écrit 6811 / 28 et compte en CH, même l'année où le barème
  est retenu ; `lib/prealablesValidation.ts` (`vehicule-amorti-sous-bareme`) l'avertit et dit de la réintégrer au cadre B du
  tableau des immobilisations ; le forfait s'écrit 625110 / compte de l'exploitant (`ecritureDuForfait`,
  `lib/forfaitKilometrique.ts`).
- **La réponse.** L'amortissement passe directement du compte de l'exploitant (débit) au 28 (crédit).
- **Verdict.** CONTREDIT l'écriture, pas l'effet fiscal. La notice dit que le barème couvre déjà l'amortissement et que la
  dotation se comptabilise puis se réintègre au cadre B ; l'expert-comptable l'écrit d'emblée hors du résultat — le 28 suit
  la valeur nette du bien, aucune charge, aucune réintégration à faire à la main. Aujourd'hui l'application compte une
  charge que le cabinet doit retirer lui-même.
- **Changement.** L'année où le barème est retenu, la dotation d'un bien de matériel de transport s'écrit compte de
  l'exploitant / 28 ; la 2035 ne la compte pas en CH ; le tableau des immobilisations de la 2035-SD la porte avec sa
  réintégration (la colonne 7 continuant de redire CH) ; l'avertissement disparaît. La fonction de garde des dotations
  accepte cette contrepartie : grande (base, `ecritureDeLaDotation`, `dotationConforme`, le moteur de la 2035, le gabarit
  2035-SD, la Clôture). Le lien entre le bien du registre et le véhicule du cadre 7 n'existe pas (`vehicules` et
  `immobilisations` ne se citent pas) : la règle visera, comme l'avertissement, tout bien de matériel de transport l'année du
  barème. **MVP** : oui si le praticien a un véhicule au registre et retient le barème (VEH-Q2) ; lot L2.

### 3.3 Le bien acquis en décembre et payé l'année suivante (2035E-11)

- **Aujourd'hui.** `bienRepris` (`lib/amortissements.ts`) : un bien acquis avant l'ouverture est « repris », son acquisition
  ne s'écrit pas (la balance la porterait). Son paiement de l'année suivante ne s'écrit nulle part — le compte du bien et
  celui du fournisseur sont refusés comme compte de bilan d'un mouvement : le 512 de 2025 est faux (D1 de la relecture des
  immobilisations).
- **La réponse.** En trésorerie, il ne s'inscrit pas dans la balance de l'année d'acquisition.
- **Verdict.** PRÉCISE, et donne le remède de D1 : le bien entre dans les comptes à son PAIEMENT, dans le premier exercice
  ouvert. Ce qu'il fait de la dotation de l'année d'acquisition (quelques jours de décembre) n'est pas dit : AMBIGU.
- **Changement.** Un bien acquis avant l'ouverture mais PAYÉ après n'est pas « repris » : son acquisition s'écrit au paiement
  (compte du bien / banque), comme un bien de l'exercice. En attendant de savoir le sort des jours de l'année d'acquisition,
  la dotation reste l'écart des cumuls (`dotationDeLExercice`), ce que la base vérifie déjà : la part de l'année d'avant
  n'est ni écrite ni déduite, et l'écran le dit. Moyenne (le prédicat, `acquisitionsDesBiens`, la fonction d'écriture de la
  pièce). **MVP** : oui si un tel bien existe au 31/12/2024 ; lot L2.

### 3.4 Le seuil de 500 € (2035E-13)

- **Aujourd'hui.** `SEUIL_IMMOBILISATION = 500` (`lib/candidatesImmobilisation.ts`), jugé sur la valeur qui s'amortit : hors
  taxe pour un assujetti, TTC pour un exonéré (`lib/montantRetenu.ts`).
- **La réponse.** Sur la charge, donc sur la somme payée.
- **Verdict.** CONFIRME pour l'exonéré (la charge d'un exonéré est son TTC). La notice dit « valeur unitaire hors taxe » (renvoi
  10) sans distinguer l'exonéré ; le BOFiP n'a pas été lu ; on suit l'expert-comptable et l'application, qui est la lecture la
  plus prudente (elle immobilise plutôt qu'elle ne déduit). « La somme payée » ne veut pas dire le seul acompte versé : le
  seuil reste celui du bien entier. Rien ne change.

---

## 4. Les cotisations et la retraite

### 4.1 L'année d'installation à la CARMF et à la CARCDSF (RET2Q3-Q2, RET2-Q3-B)

- **Aujourd'hui.** La 2035 compte ce qui est PAYÉ (CGI art. 93 ; `cotisationsComptees`, `lib/declaration2035.ts`).
  L'ESTIMATION proratise l'année d'installation aux jours d'activité, comme le moteur de l'Urssaf (RET2Q3-Q2 (A) : rien ne
  change d'ici un premier cas réel).
- **La réponse.** On enregistre le payé, pas l'appelé.
- **Verdict.** CONFIRME pour la 2035 ; AMBIGUË pour la question posée, qui portait sur le prorata de l'ESTIMATION (trimestres
  de la caisse ou jours) : la réponse ne la tranche pas. L'estimation garde le prorata aux jours (RET2Q3-Q2 (A)) et le dit ;
  rien ne change.

### 4.2 La CURPS et la contribution à la formation professionnelle (2035E-9)

- **Aujourd'hui.** Une échéance de cotisation va tout entière au compte des cotisations de l'exploitant et en BK, sa seule
  CSG-CRDS saisie mise à part (`lib/declaration2035.ts`, la boucle sur `cotisations` : `montant - csgCrds`). La CFP et la CURPS
  que l'Urssaf appelle avec les cotisations restent donc en BK. L'estimation, elle, les calcule à part
  (`lib/voletSocialPamc.ts` : `curps`, `formationProfessionnelle`).
- **La réponse.** Dans un sous-compte des autres impôts.
- **Verdict.** CONTREDIT. La ligne 13 « Autres impôts » (BS) de la notice est une liste ouverte (« notamment ») ; la réponse
  les y range.
- **Changement.** Une part « autres impôts » par échéance, comme la part de CSG-CRDS : une colonne de `cotisations_declarees`
  (migration), son écriture sur un sous-compte du 635 (un rôle du plan), la 2035 en BS, l'écran de l'onglet Cotisations qui
  la saisit (proposée depuis l'estimation quand elle est connue, jamais devinée). Moyenne à grande (`rapprocher_cotisation`
  vérifie l'écriture composée : sa fonction change). **MVP** : oui (le praticien en paie ; l'écart serait certain à la
  comparaison de la répétition) ; lot L2, avant la validation de 2025. D'ici là, la saisie de la répétition note ces montants
  pour les déplacer.

### 4.3 La CSG déductible (2035E-10)

- **Aujourd'hui.** `csgDeductible` (`lib/declaration2035.ts`) : 6,8 / 9,7 de la CSG-CRDS saisie sur ce qui est payé dans
  l'année, provisionnel et régularisation compris.
- **La réponse.** La calculer, au prorata, sur le provisionnel ou la régularisation payés.
- **Verdict.** CONFIRME. Rien ne change.

---

## 5. L'écriture libre (EL-E1 à E5, et la dépense de janvier)

- **Aujourd'hui.** `lib/ecritureLibre.ts` et la migration préparée `20261117120000_ecritures_libres` (pas appliquée,
  `ECRITURES_LIBRES_PREVUES` baissé) : journal OD, PieceRef « EL<année>-<numéro> » ; une ligne de résultat sous un poste ou
  « hors de la 2035 » ; une charge rattachée à N payée en N+1 permise, hors de la 2035 par défaut, comptée en N seulement sur
  la désignation « contre la règle de la trésorerie » (`contreLaRegle`, EL-Q3 (A)), l'extourne alors obligatoire ; la part
  privée d'une dépense mixte par une écriture OU par CC.
- **Les réponses.** La dépense de janvier rattachée à l'année d'avant : il ne la passe pas. EL-E3 : la part privée par une
  écriture, compte de l'exploitant / charge. EL-E5 : OD. EL-E4 : une correction de TVA dépend de la correction, on suit les
  textes. EL-E1 : sans réponse.
- **Verdicts.** EL-E5 CONFIRME. EL-E3 PRÉCISE (l'écriture plutôt que CC : l'écran le recommandera, CC restant possible). EL-E4
  AMBIGUË : la CA3 continue de ne pas lire une écriture libre, et l'avertissement le dit ; la ligne se choisit à la main.
  EL-E1 : on garde les valeurs prévues. La dépense de janvier CONTREDIT la moitié d'EL-Q3 (A) que le cabinet avait retenue :
  pas la permission d'écrire (hors de la 2035, elle ne ment pas), mais la désignation « contre la règle » qui la compterait
  dans la 2035 de N — l'expert-comptable ne le fait pas, et BOI-BNC-BASE-40-10 § 260 ne le permet pas.
- **Changement.** Retirer `contreLaRegle` du module et de la migration préparée, AVANT son collage (rien n'est en base) :
  petite. EXP58-Q3, parce qu'elle revient sur une décision du cabinet. **MVP** : oui (EL est au MVP, EL-Q12 (A)) ; lot L1.

---

## 6. La TVA et les ventes facturées (VF5-1 à 4)

- **VF5-1, l'impayé.** *Aujourd'hui* : un encaissement d'une facture source contre-passé (le chèque revenu impayé) compte la
  recette en moins dans l'exercice de l'impayé (`lib/ventesFacturees.ts`, parts opposées), sa TVA avec. *La réponse* : en
  trésorerie, le produit d'une facture impayée n'est pas enregistré. *Verdict* : AMBIGUË — elle répond pour une facture
  jamais payée (l'application ne la compte pas non plus : elle compte les encaissements), pas pour l'encaissement défait.
  La règle des recettes encaissées (CGI art. 93, 1) donne la même chose que l'application : l'argent rendu sort l'année où
  il sort. Rien ne change.
- **VF5-2.** La vente d'avant la bascule datée par l'encaissement, les frais d'un virement mixte en frais bancaires :
  CONFIRME.
- **VF5-3.** En engagement, la TVA d'une prestation reprise en attente puis exigible à l'encaissement : CONFIRME.
- **VF5-4, l'écart d'un débit.** *Aujourd'hui* : un débit qui dépasse ses contre-passations « aux frais près » se classe,
  l'écart au compte du rôle `services_bancaires` (627) (`lib/mouvementsDesVentes.ts`, `phraseDuDebit`,
  `confirmationDuClassementDuDebit`). *La réponse* : non, en frais divers. *Verdict* : CONTREDIT. *Changement* : l'écart d'un
  DÉBIT va à un compte de frais divers de gestion (BM « Frais divers de gestion » de la 2035), un rôle du plan ; l'écart d'un
  CRÉDIT reste au 627 (VF5-2). La fonction qui vérifie la composition du classement change : grande pour un cas rare.
  **MVP** : non (un dossier basculé, un impayé avec frais) ; lot L4.

---

## 7. Divers

- **B9, l'opération découverte après coup.** *Aujourd'hui* : conçue, pas modélisée (« L'OPÉRATION DÉCOUVERTE APRÈS COUP ») ;
  avant la validation, rien n'est figé et tout s'écrit dans N ; après, le PCG 1031-4 (une régularisation au premier jour non
  clos) et 122-6 (une correction significative sur une ligne séparée). *La réponse* : avant l'arrêté des comptes, dans N ;
  sinon l'année d'après ; une alerte si c'est important. *Verdict* : CONFIRME la conception (l'arrêté est la validation) et
  PRÉCISE l'alerte : une régularisation significative se signale. Hors du MVP (l'engagement).
- **EXD-Q4.** Pas d'exercice décalé en BNC. *Aujourd'hui* : `lib/exercices.ts` refuse un exercice non civil en trésorerie
  (`tresorerie-non-civile`) ; un dossier en ENGAGEMENT a des exercices déclarés, BNC compris (l'en-tête du module). *Verdict* : CONFIRME pour la trésorerie, PRÉCISE
  pour l'engagement (le bénéfice non commercial est celui de l'année civile, CGI art. 12 et 93 A). *Changement* : le refus
  s'étend à tout dossier BNC, quand EXD3 s'écrira (petit, hors du MVP).
- **La réserve légale.** Pas de réserve en BNC. CONFIRME la conception 45, qui ne vise que les sociétés.
- **LIA-Q14.** Sans réponse : pas de cinquième dossier de référence ; les quatre suffisent.

---

## 8. La synthèse

| Réponse | Verdict | Changement | MVP | Ampleur |
|---|---|---|---|---|
| FEC22-E2 (vides) | Confirme FEC22-Q1 (A) | lever `CHAMPS_BNC_EXPORTES` après E3 | oui | grande (drapeau, assistant) |
| FEC22-E3 (mode) | Contredit FEC22-Q2 (A) | le mode réel du mouvement | oui | moyenne (déduit) / grande (colonne) |
| FEC22-E4 (NatOp) | Précise | un compte, un seul poste de la 2035 (contrôle) | oui | petite |
| FEC22-E5 (IdClient) | Contredit FEC22-Q4 (D) | un code opaque par client | 2026 seulement | moyenne |
| FEC22-E6, E8, E13 | Confirment | — | — | — |
| FEC22-E9 (engagement : 22) | Contredit la lecture de l'A47 A-1 | relire le texte quand un BNC en engagement viendra | non | — |
| FEC22-E10 (devise) | Ambiguë | — (FEC22-Q5 (A) gardée) | non | — |
| FEC22-E11 (plan) | Confirme | — | — | — |
| FEC22-E12 (validateur) | Confirme | — | — | — |
| FEC22-E1, E7, E14, fichier | Sans réponse | — (les choix d'aujourd'hui) | — | — |
| PIECES-E1, 2035S-E2 (note de frais) | Confirme / contredit le remboursement rapproché | le remboursement en virement personnel | oui | petite à moyenne |
| 2035E-7 (chèque) | Confirme | — | — | — |
| EL-E2, NOE-E2 (date de valeur) | Précise | garder la date de valeur, l'employer au 31/12 | capture oui, emploi non | moyenne puis grande |
| 2035S-E3 (repas) | Ambiguë | CC en attendant ; un barème plus tard | non | moyenne (plus tard) |
| 2035S-E1 (assurance) | Confirme | — | — | — |
| 2035S-E4 (facultatives) | Précise / ambiguë | une attention sur le plafond | non | petite |
| 2035E-8 (excédent) | Confirme | — | — | — |
| 2035SD-E1, E2 | Confirment | — | — | — |
| 2035SD-E4 (exonérations) | Ambiguë | la somme proposée abandonnée | non | — |
| 2035S-E6, 2035S-E5 | Confirme / ambiguë | — | — | — |
| 2035SD-E3 (bien repris) | Contredit la recommandation | le cumul repris du tableau | oui | grande |
| 2035E-12 (véhicule au barème) | Contredit l'écriture | compte de l'exploitant / 28, hors de CH | oui (selon VEH-Q2) | grande |
| 2035E-11 (bien payé l'an d'après) | Précise (remède de D1) | l'acquisition écrite au paiement | oui (si le cas existe) | moyenne |
| 2035E-13 (500 €) | Confirme | — | — | — |
| RET2Q3-Q2, RET2-Q3-B | Confirme (2035) / ambiguë (estimation) | — | — | — |
| 2035E-9 (CFP, CURPS) | Contredit | une part « autres impôts » en BS | oui | moyenne à grande |
| 2035E-10 (CSG) | Confirme | — | — | — |
| Dépense de janvier (EL-Q3) | Contredit EL-Q3 (A) en partie | retirer `contreLaRegle` | oui | petite |
| EL-E3, EL-E5 | Précise / confirme | l'écran recommande l'écriture | oui | petite |
| EL-E4, EL-E1 | Ambiguë / sans réponse | — | — | — |
| VF5-1 | Ambiguë | — | — | — |
| VF5-2, VF5-3 | Confirment | — | — | — |
| VF5-4 (écart d'un débit) | Contredit | l'écart en frais divers (BM) | non | grande |
| B9 | Confirme / précise | l'alerte d'une régularisation significative | non | — (avec B9) |
| EXD-Q4 | Confirme / précise | tout BNC civil | non | petite |
| Réserve légale, LIA-Q14 | Confirme / sans réponse | — | — | — |

## 9. Le plan des lots

**L1 — avant les données réelles du 20/11/2026** (sans base, sauf la capture de la date de valeur si EXP58-Q4 (A)) :
1. La note de frais rapprochée de son remboursement : le remboursement proposé en virement personnel, la note hors des
   candidats d'un mouvement en trésorerie, l'ancien rapprochement signalé (§ 2.1).
2. Un compte, un seul poste de la 2035 : le point « attention » (§ 1.3).
3. `contreLaRegle` retiré du module et de la migration préparée d'EL, si EXP58-Q3 (A) (§ 5).
4. La date de valeur gardée à l'import (une colonne nullable, `csv.ts`, l'OFX), si EXP58-Q4 (A) (§ 2.2).

**L2 — avant la validation de l'exercice 2025 de la répétition** (base ; chacune préparée, répétée sur une réplique) :
5. Le mode réel du mouvement (EXP58-Q1), puis la levée de `CHAMPS_BNC_EXPORTES` et d'`ECRITURE_PAR_REGLEMENT` avec
   l'assistant redéployé (§ 1.1, 1.2).
6. La part « autres impôts » d'une échéance (CFP, CURPS) en BS (§ 4.2).
7. Le cumul repris d'un bien (EXP58-Q5) (§ 3.1) ; le bien payé après l'ouverture (§ 3.3) ; la dotation du véhicule au
   barème au compte de l'exploitant (§ 3.2).

**L3 — avant la validation de 2026** : le code par client (EXP58-Q2) (§ 1.4) ; dans B8, la note du dirigeant au compte de
l'exploitant (§ 2.1).

**L4 — après le MVP** : l'emploi de la date de valeur à la frontière du 31/12 ; l'écart d'un débit en frais divers ; le
barème des repas ; l'attention du plafond des facultatives ; le refus d'un exercice décalé pour tout BNC ; l'alerte de B9 ;
un BNC en engagement à vingt-deux colonnes, après relecture de l'A47 A-1.

## 10. Les questions au cabinet

```json
[
  {"id": "EXP58-Q1", "chantier": "FEC22d", "titre": "Le mode de règlement d'un mouvement du relevé",
   "question": "L'expert-comptable veut le type de règlement dans le FEC, là où l'application écrit « Banque » pour tout mouvement du relevé. Comment le connaître ?",
   "contexte": "FEC22-Q2 (A) avait retenu « Banque » pour le MVP, (B) s'il l'exigeait : il l'exige. Le mode se fige à la validation : il doit être juste avant la validation de 2025. Le libellé de la banque commence le plus souvent par un préfixe (VIR, PRLV, CB, CHQ, REM CHQ, RETRAIT). Son propre FEC écrit le mode en une lettre (R, V, B, P) dont la table n'est écrite nulle part.",
   "recommandation": "(A) : le déduire des préfixes du libellé, dans le navigateur, « Banque » quand rien ne se reconnaît ; (B) si l'essai d'import montre trop de « Banque ». Le mode en toutes lettres (BOI-CF-IOR-60-40-20 § 290) ; les lettres d'ACD seulement si son import les exige, leur table lue dans un FEC d'ACD que le cabinet fournirait hors du dépôt.",
   "options": ["(A) déduit du libellé, sans migration", "(B) une colonne du mouvement, proposée puis corrigée par le cabinet (migration, écran)", "(C) garder « Banque »"],
   "option_recommandee": "(A) déduit du libellé, sans migration",
   "source": "docs/conceptions/58-reponses-de-l-expert-comptable.md § 1.2", "pose": "2026-11-17"},
  {"id": "EXP58-Q2", "chantier": "FEC22", "titre": "Un code par client dans IdClient",
   "question": "Remplacer, dans IdClient, le SIREN ou le numéro de la facture par un code opaque et stable par fiche client ?",
   "contexte": "FEC22-Q4 avait retenu (D) : le SIREN d'une entreprise, sinon le numéro de la facture. L'expert-comptable veut un code par client. Le code ne dirait rien du client (aucun nom, aucun SIREN) ; sa table de correspondance irait dans l'export des clients. Seules les écritures d'une facture émise portent IdClient ; l'année 2025 rejouée n'en a pas.",
   "recommandation": "(A), après le 20/11 et avant la validation de 2026 : une colonne posée par la base à la création de la fiche.",
   "options": ["(A) un code opaque par fiche client (migration)", "(B) garder le SIREN ou le numéro de la facture"],
   "option_recommandee": "(A) un code opaque par fiche client (migration)",
   "source": "docs/conceptions/58-reponses-de-l-expert-comptable.md § 1.4", "pose": "2026-11-17"},
  {"id": "EXP58-Q3", "chantier": "EL", "titre": "Une dépense de janvier comptée dans la 2035 de l'année d'avant",
   "question": "Retirer de l'écriture libre la désignation « contre la règle de la trésorerie », qui permettait de compter dans la 2035 de N une charge payée en janvier N+1 ?",
   "contexte": "EL-Q3 (A) la permettait sur désignation explicite, avec extourne obligatoire. L'expert-comptable ne passe pas une telle dépense, et BOI-BNC-BASE-40-10 § 260 rattache une dépense à l'année de son paiement. L'écriture hors de la 2035 reste possible. La migration d'EL n'est pas collée : le retrait ne coûte qu'une modification du module et de la migration préparée.",
   "recommandation": "(A) : retirer la désignation ; l'écriture reste permise hors de la 2035.",
   "options": ["(A) retirer la désignation", "(B) la garder comme décidé le 17/11"],
   "option_recommandee": "(A) retirer la désignation",
   "source": "docs/conceptions/58-reponses-de-l-expert-comptable.md § 5", "pose": "2026-11-17"},
  {"id": "EXP58-Q4", "chantier": "26.6", "titre": "La date de valeur des mouvements du relevé",
   "question": "Garder la date de valeur des mouvements dès l'import des relevés réels, pour s'en servir plus tard autour du 31 décembre ?",
   "contexte": "L'expert-comptable fait foi de la date de valeur quand on l'a, sinon de la date d'encaissement, celle que l'application emploie. Les fichiers des banques la portent souvent ; l'import la reconnaît mais la jette. Un relevé importé sans elle ne se réimporte pas (le dédoublonnage le refuse) : la capture doit précéder l'import du 20/11. L'emploi (rattacher à l'année de sa date de valeur un mouvement à cheval sur le 31/12) touche tous les moteurs et viendra après le MVP.",
   "recommandation": "(A) : une colonne nullable et sa lecture à l'import avant le 20/11 ; l'emploi après le MVP.",
   "options": ["(A) la garder dès maintenant, l'employer plus tard", "(B) ne rien garder : la date d'opération suffit"],
   "option_recommandee": "(A) la garder dès maintenant, l'employer plus tard",
   "source": "docs/conceptions/58-reponses-de-l-expert-comptable.md § 2.2", "pose": "2026-11-17"},
  {"id": "EXP58-Q5", "chantier": "Immobilisations", "titre": "Le cumul d'amortissement d'un bien repris",
   "question": "Saisir, pour chaque bien d'avant la reprise, son cumul d'amortissement au tableau de l'année d'avant, et continuer le plan depuis lui, au lieu de le recalculer ?",
   "contexte": "L'application recalcule le cumul depuis la mise en service (30/360) et la base vérifie chaque dotation sur ce calcul ; IMMO-Q1 confronte le résultat au 28 repris. L'expert-comptable reprend le tableau de l'année d'avant et vérifie qu'il concorde avec les comptes. Le changement touche la fonction de garde des dotations (une migration), le registre et la 2035-SD.",
   "recommandation": "(A), avant la validation de 2025 ; d'ici là, la procédure de la répétition (aligner chaque bien sur l'ancien tableau) tient lieu.",
   "options": ["(A) le cumul repris saisi par bien, le plan continué", "(B) garder le recalcul et l'attention d'IMMO-Q1"],
   "option_recommandee": "(A) le cumul repris saisi par bien, le plan continué",
   "source": "docs/conceptions/58-reponses-de-l-expert-comptable.md § 3.1", "pose": "2026-11-17"}
]
```

## 11. Les questions à l'expert-comptable désormais closes

À sortir de la page des arbitrages (aucune n'est renvoyée) : FEC22-E1 à FEC22-E14, le choix du fichier fictif ; 2035S-E1 à
2035S-E6 ; 2035E-7 à 2035E-13 ; 2035SD-E1 à 2035SD-E4 ; PIECES-E1 ; EL-E1 à EL-E5 et la dépense de janvier ; VF5-1 à VF5-4
(§ 8 de la conception de VF5) ; NOE-E2 ; B9 ; EXD-Q4 (pour la part de l'expert-comptable) ; la réserve légale (AFF) ;
LIA-Q14 ; RET2Q3-Q2 et RET2-Q3-B (la réponse ne tranche pas le prorata de l'estimation : RET2Q3-Q2 reste à sa
recommandation (A), rien ne change, sans nouvelle question).
