# L'écriture libre de l'expert-comptable : la conception

Décision du cabinet du 16/11/2026, dans la conversation : « une vraie ecriture libre reservé a l'expert comptable. je vois
pas un expert comptable utiliser un logiciel qui lui permet pas de faire ce qu'il veut. » Son exemple : « l'expert
comptable decide de rajouter une depense de janvier de l'année d'apres. et du coup changer les charges de l'année. il doi
pouvoir le faire. limité a l'expert comptable et pas au comptable mais l'expert comptable doit avoir une certaine liberté
sur le bilan ». Conception rendue le 16/11/2026 par l'architecte, sans code de l'application ni écriture en base. Le
récit court : HISTORIQUE.md, « L'ÉCRITURE LIBRE DE L'EXPERT-COMPTABLE : LA CONCEPTION ».

**Les réponses du cabinet du 17/11/2026 (§ 10.0) changent deux choses** : l'écriture libre s'ouvre à tout compte du cabinet
qui suit le dossier, le comptable compris (EL-Q1, un revirement : la réponse la plus récente l'emporte sur la parole du 16/11),
et un exercice validé peut être DÉGELÉ par le chef du cabinet (EL-Q10 (B), contre la recommandation), conçu au § 6.1, pas codé,
ses choix ouverts posés en EL10-Q1 à Q7. Les dix autres suivent la recommandation. EL1 (le module) et EL2 (la migration,
préparée) sont faits le même jour (§ 7.1) ; ce qui, plus bas, disait « le chef seul » pour ÉCRIRE se lit « le cabinet du
dossier » (`admin_du_dossier`), le texte d'origine barré là où il fixait le droit.

**17/11/2026, au soir — EXP58-Q3 (A)** : la désignation « contre la règle de la trésorerie » est RETIRÉE (conception 58,
§ 5 : l'expert-comptable ne passe pas une dépense de janvier dans la 2035 de l'année d'avant ; BOI-BNC-BASE-40-10 § 260).
Une charge ou un produit rattaché reste permis HORS de la 2035, l'extourne proposée, jamais exigée ; compté, il se refuse
(`rattacheeComptee`, le même mot dans le module et la migration préparée, récrite avant tout collage). Ce qui, plus bas, dit
« comptée contre la règle », « désignation explicite » ou `contre_la_regle` (§ 5.1 points 4 et 5, § 6, § 7.1, § 8, § 10) se
lit sous cette réponse.

Ce qui se lit avant : HISTORIQUE.md → « L'OPÉRATION DÉCOUVERTE APRÈS COUP », « UN EXERCICE VALIDÉ SE FIGE EN BASE », « LA
2035 SE COMPARE AUX ÉCRITURES », « LE FEC SUIT L'ARTICLE A47 A-1 », « Une piste d'audit se PRODUIT » ; et
docs/conceptions/35-inventaire.md, dont cette conception reprend le patron (une table source, une colonne du brouillon,
une fonction qui recompose, une garde).

## 0. En quinze lignes

1. Une écriture libre est une écriture en partie double, saisie compte par compte par l'expert-comptable, que rien dans
   l'application ne produit : une table source à elle (`ecritures_libres`), ses lignes au brouillon qui la CITENT
   (`ecriture_libre_id`), écrites, remplacées et retirées par deux fonctions `security definer` seules.
2. Le droit est en base : ~~`est_chef_du_cabinet`~~ `admin_du_dossier` depuis EL-Q1 (17/11/2026) — tout compte du cabinet
   qui suit le dossier, son chef, un membre assigné, le super-administrateur —, vérifié avant toute autre lecture ; l'auteur
   de chaque version posé par la base ; le client n'en lit rien. Le DÉGEL d'un exercice validé reste au chef seul (§ 6.1).
3. Équilibrée au centime, une seule date, au journal OD, sous une pièce produite par l'application (« EL2026-0003 »,
   l'état des écritures libres : le motif, l'auteur, l'instant), une pièce du dossier citée si l'expert le veut.
4. Les comptes : tout compte des classes 1 à 7 au format de l'application ; REFUSÉS, la banque et la caisse (l'argent ne
   s'invente pas : le relevé et la caisse le prouvent) et le résultat (120, 129) ; AVERTIS, ceux que l'application tient
   elle-même (TVA, tiers, immobilisations, emprunt, virements internes, attente).
5. Le cœur, un BNC en trésorerie : la 2035 reste calculée depuis les SOURCES ; l'écriture libre en devient une, ligne par
   ligne. Chaque ligne de charge ou de produit porte un « effet sur la 2035 » que l'expert choisit : un poste de la 2035
   (proposé depuis la catégorie du compte), ou « hors de la 2035 ».
6. L'exemple du cabinet — une dépense payée en janvier N+1 rattachée à N — est CONTRAIRE à la règle de la 2035 en
   trésorerie (CGI, art. 93 ; BOI-BNC-BASE-40-10 § 260 : les dépenses « effectivement acquittées ») : l'application le dit
   nettement, ne le refuse pas, le propose « hors de la 2035 » avec son extourne au 1er janvier N+1, et ne le compte dans
   la 2035 que sur une désignation explicite qui cite la règle — l'extourne alors obligatoire, sans quoi la 2035 de N+1 le
   déduirait une seconde fois.
7. La concordance 2035/écritures tient par construction pour une ligne comptée ; une ligne « hors de la 2035 » est un
   ÉCART DÉCLARÉ, chiffré, dit avant la validation, qui ne la retient pas (EL-Q6).
8. La CA3 ne lit pas l'écriture libre (elle se calcule des sources) ; une ligne sur un compte de TVA s'avertit.
9. Le FEC : une sorte `libre`, journal OD, PieceRef son numéro, les vingt-deux champs d'un BNC tirés des valeurs que la
   base admet déjà ; la piste d'audit la cite comme justifiée par l'état et, s'il y en a une, par la pièce citée.
10. La validation fige l'écriture et ses lignes ; après, elle ne change plus : on la CONTRE-PASSE dans un exercice ouvert
    (PCG, art. 1031-3 et 122-6), ou le chef du cabinet DÉGÈLE le dernier exercice validé (EL-Q10 (B), § 6.1, lot EL9) ; un
    effet sur la 2035 d'un exercice validé et non dégelé relève de B9.
11. `valider_exercice` n'est PAS remplacée : sa numérotation couvre déjà toute ligne du brouillon, et ses contrôles
    (équilibre, une date, une pièce, les champs BNC) valent pour la sorte neuve.
12. Neuf lots, EL1 à EL8 et EL2b, environ douze jours ; EL1 à EL5 et EL8 entrent au MVP (EL2b aussi si EL-Q11 (A)),
    prêts avant la validation de l'exercice 2025 de la répétition générale ; l'entrée des données réelles (vers le 20
    novembre) ne les attend pas.
13. Un défaut relevé en concevant : la policy du brouillon (`ecritures_brouillon_all`, `admin_du_dossier`) laisse déjà tout
    membre assigné insérer par l'API une ligne SANS SOURCE ; elle reste hors du FEC et retient la validation, mais pèse dans
    la balance et le bilan. Une garde à part (EL2b, EL-Q11) la fermerait, après une mesure en base.
14. Douze questions au cabinet (EL-Q1 à EL-Q12) et cinq à l'expert-comptable (EL-E1 à EL-E5), § 10.

---

## 1. Le constat (lu dans le dépôt le 16/11/2026, l'export de `supabase/schema/` et `src/lib`)

### 1.1 Ce qui s'écrit aujourd'hui, et par qui

- `ecritures_brouillon` (socle, `supabase/schema/socle/1_tables_sans_migration.sql`) porte neuf sources d'hier —
  `piece_id`, `ligne_bancaire_id`, `immobilisation_id`, `vehicule_id`, `declaration_tva_id`, `cotisation_id`,
  `encaissement_id`, `facture_id`, `operation_caisse_id` — et les contraintes « sans autre source » de chacune
  (`ecritures_brouillon_dotation_sans_piece_ni_mouvement`, `…_liquidation_sans_autre_source`, `…_caisse_sans_autre_source`…).
  Quatre sources neuves sont PRÉPARÉES, pas appliquées : `ouverture_compte_bancaire_id` (MCB5g), `operation_inventaire_id`
  (INV2), `stock_de_cloture_id` (LIA2), `affectation_id` (AFF2), chacune avec une contrainte par PAIRE envers ses sœurs.
- Chaque source s'écrit par une fonction qui recompose l'écriture de l'application en entiers et la compare en
  multiensemble (`ecrire_dotation_amortissement`, `ecrire_liquidation_tva`, `ecrire_vente_facturee`…), ou par les deux
  chemins directs que la policy permet (« Régénérer » une pièce, le rapprochement), toujours avec une pièce ou un
  mouvement.
- AUCUNE écriture ne s'écrit sans source par l'application. Une ligne sans source n'existe que comme « reste d'une pièce
  supprimée » (`piece_id` mis à nul) : le FEC la laisse dehors (`horsFec`, `src/lib/fec.ts`) et `absenceFec` la chiffre ;
  la concordance la dit `sans_justificatif` (`src/lib/concordance2035.ts`) ; la piste d'audit, rupture `sans_justificatif`
  (`src/lib/pisteAudit.ts`) ; la validation se refuse tant qu'elle reste, puisque la numérotation proposée ne la couvre pas
  (« La numérotation proposée ne couvre pas exactement les … écritures de l'exercice »).

### 1.2 Ce qui manque

L'expert-comptable ne peut passer aucune écriture de son choix : ni une OD de reclassement entre deux charges, ni la part
privée d'une dépense mixte au compte de l'exploitant, ni la correction d'une erreur, ni une charge à payer. Tout passe
par une source ; ce que les sources ne savent pas dire ne s'écrit pas. Les régularisations d'inventaire (ligne 35) sont
conçues, en ENGAGEMENT seulement, et en liste fermée par nature.

### 1.3 Un défaut relevé en concevant

La policy `ecritures_brouillon_all` (`for all to public using (admin_du_dossier(dossier_id)) with check (…)`) laisse tout
membre assigné INSÉRER par l'API une ligne sans aucune source, sur n'importe quel compte, à une date d'un exercice ouvert
(les déclencheurs de la validation refusent seulement une date figée). L'écran n'en offre aucun chemin. Une telle ligne
n'atteint jamais un FEC validé — elle retient la validation —, mais pèse dans la balance, le bilan, la révision et une
situation publiée au client. C'est, de fait, une écriture libre ouverte au comptable, que la décision du cabinet réserve à
l'expert. À mesurer en base (combien de lignes sans source, de quelle date) par la session principale, puis à fermer par
une garde à part (EL2b, EL-Q11).

### 1.4 Ce qui existe déjà et sert

- `lireCompteSaisi` (`src/lib/compteDeBilan.ts`) : la saisie d'un compte rendue à six à dix chiffres, les zéros de fin non
  significatifs ; `refusCompteDeBilanSelon` dit pourquoi un compte de bilan ne reçoit pas un mouvement de banque — ses
  phrases servent de modèle aux avertissements du § 3.4.
- `libelleCompte` (`src/lib/fec.ts`) : le libellé d'un compte, tenu, de catégorie ou du plan comptable.
- `POSTES_RATTACHES`, `posteRattache` et `cadreCompatible` (`src/lib/cases2035.ts`, la contrainte
  `ecritures_brouillon_champs_bnc_du_fec`) : les postes de la 2035 qu'une ligne de charge ou de produit peut porter.
- Les saisies du cabinet de la 2035 (`saisies_2035`, en production, l'écran derrière `SAISIES_2035_EXPORTEES` baissé) : CC
  « Divers à réintégrer » — dont « la quote-part personnelle des dépenses déduites » — et CL « Divers à déduire ». C'est le
  chemin EXTRA-COMPTABLE d'une correction fiscale ; l'écriture libre est le chemin comptable.

---

## 2. Les sources

- **Ordonnance n° 45-2138 du 19 septembre 1945**, art. 2 : l'expert-comptable est « habilité à tenir, centraliser,
  ouvrir, arrêter, surveiller, redresser et consolider les comptabilités » ; art. 20 (l'exercice illégal). NON RELUE ce
  jour sur Légifrance : texte connu, la raison du droit réservé (§ 4).
- **PCG** (règlement ANC n° 2014-03, consolidé au 1er janvier 2026, déjà lu par les conceptions de la validation, de
  l'opération découverte après coup et de l'inventaire) : art. 111-1 (qui y est tenu), 122-6 (une correction d'erreur passe
  au résultat de l'exercice où elle est constatée), 1031-3 (la validation interdit toute modification ou suppression),
  1031-4 (l'opération d'une période close s'enregistre au premier jour de la période non close), 1032-1 et 1032-2 (chaque
  écriture cite sa pièce justificative datée), 1121-1 (la liste des comptes), 1211-10 (l'exploitant, le 108, cité par
  « UNE ÉCHÉANCE PAYÉE DEPUIS LE COMPTE PERSONNEL S'ÉCRIT »), 1214-40, 1214-46 et 1214-48 (408, 468, 486 : la charge
  rattachée et sa contre-passation à l'ouverture suivante).
- **CGI** : art. 93, 1 (le bénéfice non commercial, « l'excédent des recettes totales sur les dépenses nécessitées par
  l'exercice de la profession ») ; art. 93 A (l'option pour les créances acquises et les dépenses engagées) ; art. 99 (le
  livre-journal des recettes et des dépenses). Légifrance, lus le 09/10/2026 par la conception de l'opération découverte
  après coup.
- **BOFiP** : BOI-BNC-BASE-20-10-10 § 1 (les recettes « encaissées au cours de l'année d'imposition ») ;
  BOI-BNC-BASE-40-10 § 260 (les dépenses « effectivement acquittées au titre de l'année d'imposition ») ; CE, 4 juillet
  1973, n° 78172 (la dépense se rattache à l'année civile de son paiement) ; BOI-CF-IOR-60-40-20 § 120 (EcritureDate, la
  date de comptabilisation) ; BOI-BIC-DECLA-30-10-20-40 (un exercice clos ne se rouvre pas) ; BOI-BNC-DECLA-10-20 § 280
  (le secret professionnel dans les documents remis à l'administration, cité par FEC22-Q4).
- **LPF** : art. L47 A et A47 A-1 (le FEC : une écriture équilibrée, une date, une pièce ; la virgule décimale ; le tableau
  des BNC en trésorerie, DateRglt, ModeRglt, NatOp, IdClient).
- NON VÉRIFIÉ ce jour : la date de paiement d'une dépense réglée par chèque (sa remise, ou son débit) ou par carte à débit
  différé (la transaction, ou le débit) au sens de BOI-BNC-BASE-40-10 ; la ligne de la CA3 qui reprend une correction de
  TVA. Ces deux points vont à l'expert-comptable (EL-E2, EL-E4) avant d'être écrits.
- Les normes AFNOR XP Z12-012 et XP Z12-013 ne sont pas utilisées (décision du 07/10/2026).

---

## 3. Ce qu'est une écriture libre en base

### 3.1 La table source, `ecritures_libres` (EL2)

| Colonne | Type | Règle |
|---|---|---|
| `id` | uuid | clé primaire |
| `dossier_id` | uuid not null | `references dossiers on delete cascade` |
| `numero` | integer not null | attribué par la fonction, croissant par dossier et par année de `date`, jamais réutilisé (un retrait laisse un trou, qui n'est pas un trou de la numérotation du FEC) — relevé le 24/11/2026 (EL7) : en base, le plus haut de l'année plus un, si bien que le numéro de la DERNIÈRE écriture retirée se reprend (EL7-Q2) ; unicité TOTALE `(dossier_id, exercice, numero)` |
| `exercice` | integer not null | l'année civile de `date` (check) |
| `date` | date not null | la date de l'écriture, la même pour toutes ses lignes (§ 3.3) |
| `libelle` | text not null | 1 à 200 caractères, sans saut de ligne ni caractère de contrôle ; part au FEC (EcritureLib) — § 3.5 |
| `motif` | text not null | 1 à 2 000 caractères ; la justification de l'expert, imprimée sur l'état des écritures libres, jamais au FEC |
| `lignes` | jsonb not null | un tableau de 2 à 200 lignes `{ rang, compte, sens, centimes, poste_2035 }` (§ 3.2) ; la forme jugée par la fonction, un `check (jsonb_typeof(lignes) = 'array')` en base |
| `piece_citee_id` | uuid | facultative ; `references pieces` sans action, une pièce du même dossier (contrôle) |
| `avec_extourne` | boolean not null | (EL2, 17/11/2026, au lieu d'une `extourne_de_id`) l'écriture du 31 décembre porte ELLE-MÊME son extourne au 1er janvier suivant : ses lignes inverses s'écrivent au brouillon à cette date, sous « Extourne — » et le libellé. La paire naît, change et se retire ensemble par construction (le patron d'INV2), sans clé auto-référencée ni seconde ligne à geler |
| `contre_passe_id` | uuid | facultative ; `references ecritures_libres`, une écriture libre VALIDÉE du même dossier qu'elle contre-passe — posée par EL7, pas par EL2 (rien ne l'écrit avant) ; préparée le 24/11/2026 (§ 7.2) |
| `version` | integer not null default 1 | incrémentée à chaque remplacement ; la saisie retient la version lue |
| `cree_par`, `cree_le`, `modifie_par`, `modifie_le` | | posés par la fonction (`auth.uid()`, `now()`), jamais par l'appelant |

Écartée, une table enfant des lignes : elle coûterait une policy, la porte, la restrictive, un bloc de `rls.sql` et une
entrée de sauvegarde de plus, pour des lignes qui EXISTENT déjà, au brouillon. Le jsonb garde ce que le brouillon ne peut
pas porter avant la validation — le poste de la 2035 d'une ligne (la contrainte `ecritures_brouillon_champs_bnc_du_fec`
veut `poste_rattache` nul sur une ligne proposée) —, et la fonction tient les deux égaux.

### 3.2 Les lignes : tout ou rien, équilibrées

- Une ligne : un compte (§ 3.4), un sens (`debit`, `credit`), un nombre ENTIER de centimes > 0 (`Number.isSafeInteger`),
  et, sur une ligne de classe 6 ou 7 d'un dossier en trésorerie, son effet sur la 2035 (§ 5.1) : un poste de
  `POSTES_RATTACHES` compatible avec la classe (`cadreCompatible`), ou nul pour « hors de la 2035 ». Nul toujours en
  engagement et sur un compte de bilan.
- L'écriture : au moins un débit et un crédit, la somme des débits égale à celle des crédits au centime (le FEC rejette une
  écriture déséquilibrée, et `valider_exercice` le refuse : « Une écriture n'est pas équilibrée au centime. ») ; deux
  lignes identiques (compte, sens) se fondent dans l'écran avant l'envoi, jamais en base.
- `enregistrer_ecriture_libre(p_dossier_id uuid, p_ecriture jsonb, p_ecritures jsonb, p_version_lue integer) returns uuid`
  (`security definer`, `set search_path = public`, `revoke execute … from public, anon`) — `p_ecritures`, les écritures que
  l'application compose (`composerEcrituresLibres`), comparées en multiensemble (le patron d'INV2) : refuse en 42501 tout
  compte que `admin_du_dossier` ne reconnaît pas (EL-Q1 ; ~~tout autre que son chef~~) AVANT toute autre lecture ; prend le verrou consultatif
  PARTAGÉ de la validation (`cle_validation`) ; juge la date (§ 3.3), les comptes au plan et leur refus (§ 3.4), les
  montants, l'équilibre, le libellé, le motif, la pièce citée (même dossier), les postes, la version lue ; RECOMPOSE les
  lignes du brouillon depuis `lignes` (une ligne du brouillon par ligne de l'écriture, `montant` = centimes / 100, le
  libellé de l'écriture) et les compare en multiensemble à ce que l'application propose ; remplace les lignes de
  l'écriture ; rend son identifiant. Refus en 42501 (accès), 22023 (saisie), 23514 (exercice figé, version dépassée),
  chacun sa phrase française, dans l'ordre que `lib/ecritureLibre.ts` (EL1) redit.
- `retirer_ecriture_libre(p_id uuid, p_version_lue integer)` : mêmes contrôles d'accès ; refusée si l'une de ses lignes
  est validée ; retire les lignes puis l'écriture. Elle SUPPRIME : sa migration se colle (CLAUDE.md, « Quand
  `apply_migration` attend une confirmation… »), comme INV2.

### 3.3 Le journal et la date

- **Journal OD**, toujours : une écriture libre n'est ni un achat ni une vente justifiés par une facture (AC, VE), ni un
  mouvement du relevé (BQ). La contrainte `ecritures_brouillon_validation_complete` ne connaît que AC, VE, BQ et OD : un
  journal propre (« EX ») demanderait de la récrire, pour rien que l'expert ait demandé (EL-E5).
- **La date** : au plus tôt le lendemain de la frontière de validation (`frontiere_validation`) et le jour d'ouverture du
  dossier (`a_nouveaux`), au plus tard le 31 décembre de l'année en cours lue à Paris — le 1er janvier qui suit pour la
  seule extourne d'une charge rattachée (§ 5.2), comme l'inventaire l'admet. Une date figée est déjà refusée par
  `ecritures_brouillon_intangibles` ; la fonction le dit avant, en français.
- Une seule date par écriture (« Les lignes d'une même écriture ne portent pas la même date », Test Compta Demat
  « Différentes dates comptables »).

### 3.4 Les comptes permis, avertis, refusés

Tout compte saisi passe `lireCompteSaisi` (six à dix chiffres, classes 1 à 7 ; la classe 8 n'est pas au FEC, la classe 9
non plus). Puis :

| Comptes | Sort | Pourquoi |
|---|---|---|
| La banque du plan (le rôle `banque`, et le 512 de chaque compte bancaire du dossier, MCB) | **refusé** (EL-Q4) | Le 512 est le relevé : une ligne sans mouvement fausse le rapprochement et la preuve du 512 au 31 décembre (`banque-au-releve`, `lib/releveAuTrenteEtUn.ts`). Un mouvement manquant s'importe avec son relevé. |
| La caisse du plan (53…) | **refusé** (EL-Q4) | La caisse se rejoue depuis ses opérations et ne passe jamais sous zéro (`lib/caisse.ts`) ; une écriture libre la ferait mentir. Une recette ou une dépense en espèces se saisit dans Caisse. |
| 120, 129 (le résultat) | **refusé** | Le résultat se calcule ; son affectation est un chantier à lui (AFF, ligne 45). |
| 44… (TVA) | averti | La CA3 se calcule des sources et ne lira pas cette ligne ; le compte ne se soldera plus par la liquidation (§ 5.4). |
| 40…, 41… (fournisseurs, clients) | averti | Le lettrage se déduit du rapprochement : la ligne restera non lettrée ; un 411 d'une facture de l'application est tenu par les ventes facturées. |
| 2… hors 28/29, 28…, 29… (immobilisations, amortissements) | averti | Le registre des immobilisations et ses dotations ne la verront pas : le bilan et le registre divergeront. |
| 164… (emprunts) | averti | L'échéancier de l'emprunt ne la verra pas. |
| 58… (virements internes), 47… (attente) | averti | Un compte de passage se solde avant la validation ; la révision le dira. |
| 108… (l'exploitant), 467/468 (dont le dirigeant), 6…, 7…, les autres comptes de bilan | permis | La liberté du cabinet ; une ligne de 6 ou 7 en trésorerie porte son effet sur la 2035 (§ 5.1). |

- Le compte doit avoir un libellé : celui que `libelleCompte` rend, ou, pour un compte qu'il ne nomme que par son numéro,
  un libellé saisi par l'expert, gardé dans `lignes` et figé à la validation (`compte_lib`) — jamais deux libellés pour un
  même compte (« Un même compte porte deux libellés. »).
- Le plan du dossier : un compte hors des rôles du plan est permis (le plan nomme les comptes que l'application ÉCRIT, pas
  ceux qu'un expert peut employer) ; un compte qui tombe sous la racine d'un rôle du plan (le dirigeant au 467 ou au 468,
  PC4-Q2) est permis et dit à l'écran (« compte du dirigeant »).
- Un AVERTISSEMENT se dit à la saisie, avant le clic, sous la ligne, et se répète dans la confirmation ; il ne refuse
  rien. La base ne redit que les REFUS.

### 3.5 Le libellé, et jamais un nom de patient

- Le libellé part au FEC (EcritureLib) et à la piste d'audit, et de là à un vérificateur. La règle du dépôt est qu'aucun
  chemin de l'application n'y fait entrer le nom d'un patient ni d'un client particulier (JJ1, FEC22-Q7, VF9CQ1 ; BOI-BNC-
  DECLA-10-20 § 280). La base ne sait pas reconnaître un nom : la règle se tient par l'écran et par la portée.
- Recommandé (EL-Q7, (A)) : un texte de l'expert, 200 caractères, sous un avertissement fixe (« Ce libellé part au FEC et à
  la piste d'audit : n'y écris jamais le nom d'un patient, ni celui d'un client qui n'est pas une entreprise ») ; le motif,
  plus long, reste dans la table et sur l'état des écritures libres, jamais au FEC.
- L'assistant n'en reçoit RIEN : ni le libellé, ni le motif (§ 5.9). L'état des écritures libres (PDF, CSV) est un
  document du cabinet, comme l'état d'inventaire.

### 3.6 La pièce justificative

PCG, art. 1032-2 : chaque écriture s'appuie sur une pièce datée. Recommandé (EL-Q8, (A)) : la pièce de l'écriture est
l'ÉTAT DES ÉCRITURES LIBRES de l'exercice, que l'application produit (une ligne par écriture : numéro, date, comptes,
montants, effet sur la 2035, libellé, motif, auteur, instant de la dernière version, pièce citée par sa date de dépôt et
son empreinte, jamais le nom du fichier) ; PieceRef « EL<année>-<numéro sur quatre chiffres> », PieceDate la date de
l'écriture. Une pièce du dossier se CITE (`piece_citee_id`), jamais par `ecritures_brouillon.piece_id`, qui rangerait
l'écriture au journal AC et la ferait régénérer avec la pièce (le raisonnement d'INV-Q7).

### 3.7 Immuable ? Avant et après la validation

- Avant la validation de son exercice : l'expert la REMPLACE (`enregistrer_ecriture_libre` avec son identifiant et la
  version lue) ou la RETIRE. Le brouillon n'est pas encore probant (PCG, art. 1031-3 vise la validation) ; la dernière
  version, son auteur et son instant restent (EL-Q9, (A)).
- La validation de son exercice fige ses lignes (les déclencheurs existants) ; sa garde fige l'écriture : plus de
  remplacement, plus de retrait (23514), la restauration exceptée.
- Après : elle se CONTRE-PASSE par une nouvelle écriture libre, dans un exercice ouvert, qui la cite
  (`contre_passe_id`) et porte ses lignes en sens inverse — puis, si l'expert le veut, la bonne écriture à côté (EL7).

### 3.8 Les gardes, les colonnes, les contraintes (EL2)

- `ecritures_brouillon.ecriture_libre_id uuid references ecritures_libres(id)` (SANS action à la suppression : la fonction
  retire les lignes d'abord), son index partiel.
- `ecritures_brouillon_libre_sans_autre_source` : `ecriture_libre_id is null or num_nonnulls(<les neuf sources d'hier>) =
  0` ; puis le bloc des PAIRES envers les quatre sources neuves préparées (`…_libre_hors_de_l_ouverture`,
  `…_libre_hors_de_l_inventaire`, `…_libre_hors_des_stocks`, `…_libre_hors_de_l_affectation`), posé par la seconde de chaque
  paire à se coller.
- **Les gardes de tête des quatre migrations sœurs refusent toute clé étrangère du brouillon qu'elles ne nomment pas**
  (INV2 : « Les sources du brouillon ne sont plus celles que cette migration nomme ») : si EL2 se colle avant elles, elles
  ne s'appliquent plus. EL2 les met donc à jour — `ecriture_libre_id` dans leur liste tolérée et dans leur bloc de paires —,
  sous `remplacementsDesPreparees.test.ts` et leurs tests de texte, puis la répétition de toutes les préparées est rejouée
  sur une copie de la réplique dans les deux ordres (avant et après EL2).
- `garder_ecritures_libres` (`before insert or update or delete` sur la table) et `garder_ecriture_libre_du_brouillon`
  (sur `ecritures_brouillon`, `insert`, `delete` et `update of ecriture_libre_id, dossier_id, date, compte, sens, montant,
  libelle`) : écrites par les deux fonctions seules (le réglage local `jd.ecriture_libre` posé sur leur dossier), la
  réinsertion du super-administrateur exceptée (la restauration), le départ du dossier aussi ; une écriture dont une ligne
  est validée ne change plus.
- Le déclencheur `_acces_avant_les_gardes` (en production depuis le 15/11/2026, GARDES-Q1) se pose sur la table neuve,
  premier de ses déclencheurs BEFORE ; `porteDevantLesGardes.test.ts` et l'étape 32 d'`accesAvantLesGardes.sql` le
  vérifient.

### 3.9 Sauvegarde, restauration, départ du client

La table au plan de sauvegarde derrière `ECRITURES_LIBRES_PREVUES` (`auPlanAujourdHui`), dans l'ordre `pieces` →
`ecritures_libres` (deux passes : `contre_passe_id` est auto-référencée, « une table auto-référencée se restaure en deux
passes ou par vagues ») → `ecritures_brouillon` ; `sauvegardeEcrituresLibres.test.ts`. Le paquet d'archive d'un départ
(INAL3) porte l'état des écritures libres de chaque exercice et compte leurs pièces citées (`piecesCiteesParLExercice`).

---

## 4. Le droit, en base

- **Écrire** (enregistrer, remplacer, retirer, contre-passer) : depuis EL-Q1 (17/11/2026, « les comptables peuvent faire
  les ecritures libre »), `admin_du_dossier(dossier)` — le chef du cabinet, un membre assigné au dossier, le
  super-administrateur —, vérifié dans chaque fonction avant toute autre lecture, refus 42501 « Accès refusé à ce dossier. »
  (~~`est_chef_du_cabinet`, « Seul l'expert-comptable du cabinet passe une écriture libre. »~~). AUCUNE policy d'écriture sur
  `ecritures_libres` : les fonctions seules, et les gardes refusent l'écriture directe d'une ligne qui la cite.
- **Ce qu'EL-Q1 change.** (1) La TRAÇABILITÉ porte la responsabilité que le droit réservé portait : `cree_par` et
  `modifie_par` (posés par la base, jamais par l'appelant) disent QUI a écrit chaque version ; l'état des écritures libres
  nomme l'auteur de la création et celui de la dernière version (l'adresse lue de `cabinet_admins` sous la session de qui
  regarde, sinon « Le cabinet », le patron de P1TQ2Q1-Q1) ; EL-Q9 (A) ne garde pas les versions intermédiaires — un membre qui
  remplace l'écriture du chef efface la version du chef, seul son auteur reste nommé (`cree_par`) : un risque accepté en
  tranchant EL-Q9. (2) EL2b ne se justifie plus par « réservée à l'expert » mais par « toute écriture sans source passe par la
  fonction qui la VÉRIFIE et la TRACE » : une ligne insérée par l'API n'a ni motif, ni auteur, ni équilibre vérifié, ni effet
  sur la 2035 dit — EL-Q11 (A) reste entière. (3) Le DÉGEL reste au chef seul (EL-Q10 (B) : « par le chef du cabinet ») :
  écrire dans un exercice ouvert n'est pas rouvrir un exercice validé. (4) La proposition par le membre (l'ancienne option (B)
  d'EL-Q1) devient sans objet.
- **Lire** : une policy `for select to authenticated using (admin_du_dossier(dossier_id))`. Le membre d'équipe assigné lit
  les écritures libres et leur motif : elles sont dans la balance, le bilan et le FEC qu'il prépare, et il doit savoir ce
  que l'expert a passé. Le chef lit tout.
- **Le client** : aucune branche, aucune case (ni « Ventes », ni « Banque », ni « Comptes ») ; une situation publiée
  (C4a) montre des soldes de comptes, qui portent l'effet de l'écriture libre, jamais l'écriture.
- **La double authentification** : la policy restrictive `deux_facteurs` sous condition (`to_regprocedure(
  'public.deux_facteurs_satisfaits()')`), comme INV2 ; `deuxFacteursDesTablesNeuves.test.ts` l'exige déjà de toute
  préparée qui crée une table.
- **Les droits hors RLS** : la table naît avec SELECT, INSERT, UPDATE et DELETE seuls (`droits_hors_rls`) ; le bloc HR de
  `rls.sql` le juge.
- **Un cabinet à plusieurs experts** : `cabinet_admins` admet plusieurs `comptable_en_chef` ; chacun passe ses écritures,
  l'auteur les distingue. Un « chef » qui n'est pas inscrit à l'Ordre reste une affaire du cabinet, que l'application ne
  peut pas vérifier (l'objectif : « un cabinet non inscrit en reste à la précomptabilité »).
- **Plus tard, peut-être** (EL-Q1) : le membre PROPOSE une écriture, l'expert la passe d'un clic. Rien de tel dans ces lots.

---

## 5. Ce qu'elle change dans chaque moteur

### 5.1 La 2035 d'un BNC en trésorerie — le cœur

**La règle, nettement.** En trésorerie, le bénéfice non commercial est l'excédent des recettes ENCAISSÉES sur les dépenses
EFFECTIVEMENT ACQUITTÉES dans l'année (CGI, art. 93, 1 ; BOI-BNC-BASE-20-10-10 § 1 ; BOI-BNC-BASE-40-10 § 260 ; CE, 4
juillet 1973, n° 78172). Seule l'option de l'article 93 A (créances acquises, dépenses engagées) rattache une dépense à
l'année de son engagement — et l'application ne la sait pas (INV-Q10 (A)). Une écriture comptable ne change pas cette
règle : la 2035 n'est pas la balance.

**Ce que fait l'application.** La 2035 reste calculée depuis les SOURCES (« LA 2035 SE COMPARE AUX ÉCRITURES » : un choix,
pour qu'un brouillon en retard ne donne pas une déclaration fausse en silence). L'écriture libre devient une source de
plus : une contribution par ligne de classe 6 ou 7 qui porte un poste, à la date de l'écriture, sous la nature de sa
classe (6 dépense, 7 recette), dans le sens de la ligne (un crédit au 6 diminue la dépense ; un poste négatif reste
négatif, « Case négative » dite à Clôture), le compte de la ligne pour compte de la contribution. Une ligne sans poste est
« hors de la 2035 » : la 2035 ne la compte pas. C'est l'option (A) d'EL-Q2.

- Le poste se PROPOSE depuis la catégorie qui porte le compte (`categories.compte_comptable`, puis `poste_2035`) ; un
  compte qu'aucune catégorie ne porte n'a pas de poste proposé : l'expert le choisit, ou laisse « hors de la 2035 ».
- La concordance tient par construction pour une ligne comptée : la contribution et la ligne du brouillon ont la même
  référence (`ecriture_libre:<id>`), le même compte, le même montant.

**Les cas où l'expert a raison, et ce que l'application fait de chacun :**

| Cas | Ce qui est vrai | Ce que l'application propose |
|---|---|---|
| Reclassement entre deux charges (6xx → 6xx) | Aucun paiement ne change ; le poste, si. | Les deux lignes comptées, chacune sous son poste : le total de la 2035 inchangé, sa répartition corrigée. |
| Part privée d'une dépense mixte (6xx au crédit, 108 au débit) | La dépense payée n'est déductible que pour sa part professionnelle. | Comptée sous le poste de la charge. La 2035 connaît aussi CC « Divers à réintégrer » (la quote-part personnelle) : l'un OU l'autre, jamais les deux, dit à l'écran (EL-E3). |
| Dépense payée depuis le compte personnel (6xx au débit, 108 au crédit) | Payée, à cette date : déductible. | Comptée ; si une pièce existe, l'écran dit que la pièce a son chemin (payée par le compte personnel, une note de frais) et qu'une écriture libre qui la cite en plus la compterait deux fois. |
| Erreur à corriger dans l'exercice ouvert | PCG, art. 122-6. | Comptée ou non selon la ligne : une OD de correction n'a pas d'effet par elle-même ; elle dit ce que l'expert veut. |
| Chèque remis en décembre, débité en janvier ; carte à débit différé | La date du PAIEMENT est peut-être la remise ou la transaction (NON VÉRIFIÉ). | Ce n'est pas une écriture libre qu'il faut, mais la bonne date de paiement de la pièce : EL-E2, un chantier à part si l'expert le confirme. |
| Option 93 A | Charges et produits rattachés. | Hors de l'application (INV-Q10) ; si un tel dossier venait, sa 2035 serait un autre chantier. |

**L'exemple du cabinet : une dépense payée en janvier N+1, rattachée à N.** C'est une charge à payer (PCG, art. 1214-40,
1214-46 : 6xx au débit, 408 ou 468 au crédit au 31/12/N, contre-passée à l'ouverture de N+1). En trésorerie, elle n'est
pas déductible en N : elle l'est en N+1, l'année de son paiement. Recommandé (EL-Q3, (A)) :

1. l'application la LAISSE passer — c'est la comptabilité de l'expert —, et ne la refuse jamais ;
2. une ligne de 6 ou 7 dont la contrepartie est un compte de rattachement (408, 418, 4286, 4386, 44812, 4482, 468, 467,
   486, 487) se PROPOSE « hors de la 2035 », sous la phrase : « En trésorerie, une dépense compte dans la 2035 de l'année
   où elle est payée (CGI, art. 93 ; BOI-BNC-BASE-40-10 § 260) : cette charge rattachée change les comptes de N, pas sa
   2035 » ;
3. elle se propose AVEC son extourne au 1er janvier N+1 (une seconde écriture libre, liée, qui naît, change et se retire
   avec elle, comme INV-Q1 (A)) : sans extourne, le paiement de janvier, écrit par sa pièce, compterait la charge une
   seconde fois dans les comptes de N+1 ;
4. ~~si l'expert veut pourtant la compter dans la 2035 de N, il choisit le poste~~ (retiré le 17/11/2026, EXP58-Q3 (A) : la
   ligne comptée se refuse) ; la confirmation le dit en toutes lettres
   (« Contraire à la règle de la trésorerie, sauf option pour les créances-dettes (CGI, art. 93 A), que ce dossier n'a
   pas ») et l'extourne devient OBLIGATOIRE et comptée de même en N+1 : la 2035 de N+1 compte le paiement de janvier ET
   l'extourne, et ne déduit donc la dépense qu'une fois sur les deux années ;
5. la Vue d'ensemble, Clôture et la confirmation de la validation disent « N écritures libres comptées contre la règle de
   la trésorerie » : un avertissement, jamais un refus.

### 5.2 La concordance, Clôture, la validation

- Une ligne comptée concorde par construction. Une ligne « hors de la 2035 » sur un compte de résultat est un ÉCART
  DÉCLARÉ (motif `ecriture_libre_hors_2035`), rangé dans une section à part de la carte « Concordance avec les écritures »,
  chiffré, avec le libellé et le numéro de l'écriture. Recommandé (EL-Q6, (A)) : il ne retient PAS la validation —
  `concorde` se juge hors des écarts déclarés —, et `prealablesValidation.ts` le dit en attention (« N écritures libres
  hors de la 2035 : le FEC et la 2035 diffèrent de X €, par décision de l'expert-comptable »). La règle du 04/10/2026
  (« la validation se refuse tant que la 2035 et les écritures ne concordent pas ») reste entière pour tout le reste.
- La CSG déductible, les ventes facturées, la caisse : inchangées.
- `valider_exercice` n'est PAS remplacée (les cinq chantiers préparés qui la remplacent n'ont rien à reprendre) : la
  numérotation proposée couvre les lignes de la sorte neuve ; ses contrôles d'équilibre, de date unique, de pièce unique,
  de libellé de compte et des champs BNC valent tels quels. La 2035 validée (`exercices_valides.declaration`) porte ses
  contributions ; la garde de la table fige l'écriture (son effet sur la 2035 compris), ce qui rend la 2035 validée
  relisible. L'empreinte en forme 2 scelle déjà toutes les lignes validées ; sceller aussi l'en-tête (le motif, les postes)
  est à vérifier contre `empreinte_exercice_forme_2` avant EL2 (§ 9), sans changer le texte d'un exercice sans écriture
  libre (le principe d'INV3-Q1 (A)).

### 5.3 La situation intermédiaire, l'estimation, « Ma simulation »

Calculées depuis les sources comme la 2035 : elles lisent les mêmes contributions (EL4), pour que la situation de
septembre et la 2035 de mai ne se contredisent pas. « Ma simulation » du client « Banque » : la contribution entre dans le
total, jamais la ligne, ni son libellé, ni son motif.

EL4-Q1, réponse du cabinet du 22/11/2026 (contre la recommandation) : une ligne comptée sous « Cotisations sociales
personnelles » s'ajoute aussi, signée et à sa date, aux cotisations de l'estimation (l'année, « à date », la projection),
jamais à ce qui se tire de l'échéancier par organisme ; l'écran en dit la part (« dont … par une écriture de
l'expert-comptable »).

### 5.4 La CA3

La CA3 se calcule des sources (l'exigibilité à l'encaissement ou au paiement) et NE LIT PAS l'écriture libre ; un test le
garde. Une ligne sur un compte 445… s'avertit (§ 3.4) : « La CA3 ne verra pas cette ligne ; une correction de TVA se
déclare sur la CA3 de la période où elle se constate, et le compte ne se soldera plus par la liquidation ». Comment la CA3
reprend une telle correction (une ligne de régularisation) : EL-E4, avant tout code.

### 5.5 L'engagement, le bilan, la balance, le report des soldes

- L'engagement : aucune 2035, aucun poste ; l'écriture libre est une OD comme les autres. Elle complète l'inventaire (ligne
  35) sans le refaire : une régularisation de clôture (CCA, PCA, FNP, FAE, charge à payer, produit à recevoir, provision)
  se passe par l'inventaire, qui la compose, l'extourne, la confronte à la balance reprise et la déclare ; l'écriture libre
  sert à ce qu'aucune liste fermée ne prévoit. L'écran de l'écriture libre, en engagement, dit pour un 486, 487, 408, 418,
  44586, 44587, 151 ou 491 : « Une régularisation d'inventaire a son onglet : elle s'y compose avec son extourne. » Une
  ligne de ces comptes reste permise (EL-Q5).
- Le bilan (`lib/bilan.ts`) et la balance (`calculerBalance`) lisent TOUTES les lignes du brouillon : l'écriture libre y
  entre sans changement de code ; le détail d'un compte la marque « écriture libre n° … » (EL6).
- Le report des soldes (`soldes_a_reporter`) lit les lignes validées des classes 1 à 5 : sans changement.
- « Régénérer » une pièce ne retire que les lignes de la pièce : une écriture libre n'en cite aucune ; un test le garde
  (le modèle : `lignesPropresAuMouvement.test.ts`).

### 5.6 Le FEC

- Une sorte `libre` dans `src/lib/fec.ts` : clé `libre|<id>`, journal OD, PieceRef « EL<année>-<numéro> », PieceDate la date
  de l'écriture, EcritureLib son libellé, CompteLib par `libelleCompte` ou le libellé saisi. Sans elle, les lignes
  tomberaient dans `horsFec` et retiendraient la validation.
- Les vingt-deux champs d'un BNC en trésorerie (`REGLES_DES_SORTES`, `src/lib/champsBncDuFec.ts`), des valeurs que la
  contrainte `ecritures_brouillon_champs_bnc_du_fec` admet déjà, sans la récrire : DateRglt nul, ModeRglt « Sans
  règlement » ; NatOp « Dépense » ou « Recette » sur une ligne comptée (et son poste, `poste_rattache`), « Opération de
  bilan » sur une ligne de bilan ; IdClient nul. Une ligne de 6 ou 7 hors de la 2035 : NatOp « Dépense » ou « Recette » sans
  poste. La lecture de ces valeurs par le logiciel de l'expert : EL-E1.
- Un exercice validé se relit de ses colonnes figées, comme toujours.

### 5.7 La piste d'audit et le lettrage

- La piste d'audit (`src/lib/pisteAudit.ts`) cite l'écriture libre comme justifiée par l'état des écritures libres
  (numéro, auteur, instant) et, s'il y en a une, par la pièce citée (date de dépôt et empreinte, jamais le nom du fichier) ;
  plus de rupture `sans_justificatif` pour elle ; `absenceFec` ne la compte plus.
- Le lettrage : une ligne de 401 ou 411 reste non lettrée (le lettrage se déduit du rapprochement) ; l'avertissement le dit.

### 5.8 La révision

- R1 (les soldes) : les lignes comptent. R2, R3 : une écriture libre est une PREUVE PROPOSÉE des comptes qu'elle touche
  (« écriture de l'expert-comptable n° … : elle dit une décision, pas un fait extérieur ») ; elle dit ce qu'elle n'établit
  pas. R4 : un travail « écritures libres de l'exercice » au cycle de clôture, proposé quand il y en a. R5 : rien de
  « normal ». R7 : rien.
- Une écriture libre sur un compte d'attente ou de virements internes non soldé au 31 décembre se dit comme tout solde de
  ces comptes.

### 5.9 L'assistant

- Une ligne qui cite une écriture libre arrive aujourd'hui au modèle comme « rattachée à rien » : sans libellé
  (`libelleDuBrouillon` n'est appelé que pour une source connue ; VF9CQ1). EL6 la nomme (`source: "ecriture_libre"`),
  toujours SANS libellé ni motif, sous son genre, sa date, ses comptes, ses montants et son effet sur la 2035 ; elle peut
  dire « N écritures libres comptées contre la règle de la trésorerie », jamais en écrire une. Redéploiement
  d'`agent-comptable` par sa ligne d'import.

### 5.10 Le client et ses écrans

Rien : ni « Mes ventes », ni « Ma banque », ni « Ma caisse », ni « Mon analyse » ne lisent le brouillon d'une écriture
libre. « Mes comptes » (une situation publiée) montre des soldes.

---

## 6. La validation, et après

- **Avant** : librement, sous les refus du § 3. Le verrou partagé de la validation est pris par les fonctions : une
  écriture libre ne change pas pendant qu'un exercice se valide.
- **La validation** : l'écriture se valide avec son exercice, numérotée au journal OD dans l'ordre des dates ; les
  attentions du § 5.2 se disent avant le clic.
- **Après** : figée. Une erreur trouvée dans un exercice validé se corrige sur un exercice ouvert (PCG, art. 1031-3 et
  122-6 ; BOI-BIC-DECLA-30-10-20-40) : une écriture libre de N+1 qui contre-passe celle de N (EL7) ou qui passe la
  correction. Son effet COMPTABLE est en N+1. Son effet FISCAL sur la 2035 de N n'est pas d'ici : c'est l'opération
  découverte après coup (B9 ; HISTORIQUE.md, « L'OPÉRATION DÉCOUVERTE APRÈS COUP ») — une régularisation datée du
  lendemain de la frontière, avec sa date de survenance, et la 2035 rectificative de N. Le jour où B9 se construit, sa
  table `regularisations` et l'écriture libre se rejoignent : une régularisation qui n'a ni pièce ni ligne dans
  l'application est, en pratique, une écriture libre avec une date de survenance. Recommandé : la colonne
  `date_survenance` de B9 s'ajoutera alors à `ecritures_libres`, pas avant.
- **Le dégel** : le cabinet l'a choisi (EL-Q10 (B), 17/11/2026), contre la recommandation de ne jamais rouvrir ; § 6.1.

### 6.1 Le dégel d'un exercice validé par le chef du cabinet (EL-Q10 (B)) : la conception, pas le code

Ce qui le cadre. Un exercice validé est figé PAR LA BASE : les déclencheurs des écritures validées
(`ecritures_brouillon_intangibles`), la garde de chaque table qui fige à la frontière (`frontiere_validation`, le 31 décembre du
dernier `exercices_valides`), l'empreinte en forme 2 chaînée à celle de l'exercice précédent, qui scelle aussi les pièces
citées et la 2035 (INAL2), le fichier d'une pièce figée gardé par le stockage (`fichier_fige`, INAL1). Le PCG veut que la
validation interdise toute modification ou suppression (art. 1031-3, cité par la conception, NON RELU ce jour) et que la
clôture d'une période se fasse au plus tard avant l'expiration de la suivante (art. 1031-4, idem). Le dégel est donc une
EXCEPTION tracée, jamais un retour silencieux : la version validée ne disparaît pas, elle s'ARCHIVE.

- **Qui** : le chef du cabinet du dossier seul (`est_chef_du_cabinet`, le super-administrateur compris), vérifié en base avant
  toute lecture ; jamais un membre (EL-Q1 ouvre l'ÉCRITURE, pas le dégel), jamais le client ; sous la double authentification
  quand elle sera exigée ; un MOTIF obligatoire (20 à 2 000 caractères) ; une confirmation qui nomme l'exercice, ce qui se
  défait et ce qui reste déposé.
- **Quoi** : le DERNIER exercice validé seul (EL10-Q1 (A)) — dégeler N quand N+1 est validé casserait l'ouverture et l'empreinte
  de N+1 ; dégeler N−1 demande de dégeler N d'abord.
- **Ce qu'il défait**, d'un seul tenant, par une fonction `degeler_exercice(p_dossier_id, p_annee, p_motif)` : la ligne
  `exercices_valides` de N (la frontière recule au 31 décembre de N−1, et avec elle TOUTES les gardes qui la lisent : pièces,
  cotisations, encaissements, désignations, écritures libres, inventaire) ; le statut des lignes de N (`validee` →
  `proposee`), leur numéro, leur date de validation et les cinq champs BNC (la contrainte `ecritures_brouillon_champs_bnc_du_fec`
  les veut nuls sur une ligne proposée) ; les soldes reportés de N vers N+1 (`soldes_reportes`), que la revalidation récrira.
  Elle SUPPRIME : sa migration se collera.
- **Ce qu'il garde** : une table IMMUABLE `degels_d_exercice` (aucune policy de mise à jour ni de suppression ; lue par le
  cabinet du dossier ; au plan de sauvegarde et au paquet d'archive d'un départ) — le dossier, l'année, qui a dégelé, quand, le
  motif, et l'INSTANTANÉ archivé de la validation : qui l'avait faite et quand, ses totaux, sa déclaration 2035 (version 2),
  son empreinte, celle du FEC validé, et les lignes validées elles-mêmes (le FEC de N tel qu'il a été figé, reproductible à
  l'identique, EL10-Q6 (A)) ; les soldes reportés défaits. L'empreinte de N−1 et toute la chaîne d'avant restent intactes :
  la revalidation de N se chaîne de nouveau à N−1, et l'archive dit quelle empreinte de N a été remplacée et pourquoi.
- **Ce qu'il ne touche pas** : une facture validée (figée pour elle-même) ; les déclarations de TVA enregistrées et leur
  liquidation, l'e-reporting déclaré, la 2035 DÉPOSÉE (EL10-Q5 (A) : elles restent et se DISENT — « la 2035 déposée reste
  celle d'avant ; la revalidation en produira une autre, à déposer en rectificative ») ; les fichiers des pièces citées, qui
  restent gardés tant qu'une archive les cite (EL10-Q4 (A)) ; les situations publiées au client (des instantanés).
- **La numérotation** : à la revalidation, recomposée entière par `valider_exercice` comme à la première (EL10-Q3 (A)) — le FEC
  d'un exercice est un tout, que l'article A47 A-1 veut numéroté en continu (à relire avant EL9) ; l'ancien FEC reste
  produisible depuis l'archive, sous son empreinte.
- **Jusqu'à quand** : tant que l'exercice suivant n'est pas validé (EL10-Q2 (A)) ; après le dépôt de la 2035 ou la date limite
  de mai, le dégel reste possible mais sa confirmation dit la 2035 rectificative à déposer.
- **Comment il se trace** : la ligne de `degels_d_exercice` ; la Vue d'ensemble, Clôture et l'onglet de la validation disent
  « Exercice dégelé le … par … : motif » jusqu'à la revalidation, puis « revalidé le … (dégelé le … par …) » ; la piste d'audit
  et le paquet d'archive portent les deux versions ; l'assistant n'en reçoit que le fait et la date, jamais le motif.
- **Comment il se revalide** : par `valider_exercice`, inchangée, sous les mêmes préalables ; l'écran montre avant le clic
  l'écart avec la version archivée (les cases de la 2035, les totaux, les écritures ajoutées, changées, retirées), et la
  confirmation nomme la 2035 rectificative si la première a été déposée.
- **Les risques** : un FEC remis à l'expert-comptable ou à l'administration avant le dégel ne correspond plus à la comptabilité
  revalidée (l'archive le reproduit) ; une garde qui lirait le gel autrement que par la frontière resterait figée (EL9 les relit
  toutes) ; le retour arrière d'EL9 serait destructif (la table d'archive).
- **Le lot** : EL9, après EL1 à EL5 : une migration (`degels_d_exercice`, `degeler_exercice`, la relecture de chaque garde qui
  lit la frontière) préparée sur une réplique avec toute la rigueur, un essai, puis l'écran ; rien ne se code avant que le
  cabinet tranche EL10-Q1 à Q7.

---

## 7. Les lots

| Lot | Contenu | Jours | Drapeau | Dépend de | MVP |
|---|---|---|---|---|---|
| EL1 — **fait le 17/11/2026** | `lib/ecritureLibre.ts`, pur, en centimes : la saisie (comptes par `lireCompteSaisi`), l'équilibre, les refus et les avertissements dans l'ordre et leurs mots, la fenêtre des dates, le poste proposé, le compte de rattachement reconnu, l'extourne composée ; ses tests | 1 | aucun (module) | — | oui |
| EL2 — **préparée le 17/11/2026** (§ 7.1) | Migration `ecritures_libres` : la table, la colonne, la contrainte et les paires, les deux gardes, la porte, la restrictive sous condition, `enregistrer_ecriture_libre`, `retirer_ecriture_libre`, la policy de lecture ; les quatre préparées sœurs mises à jour ; `ecrituresLibres.sql` (quatre profils : chef, membre assigné refusé en 42501, membre non assigné, client ; chaque refus avec sa raison ; écritures annulées par sous-transaction), le bloc de `rls.sql` ; sauvegarde derrière `ECRITURES_LIBRES_PREVUES` ; `types.ts` | 2,5 | `ECRITURES_LIBRES_PREVUES` baissé | EL1 | oui |
| EL2b | La garde qui refuse toute ligne NOUVELLE sans source au brouillon, la restauration exceptée (§ 1.3, EL-Q11) — après la mesure en base et la relecture de chaque écriture directe du navigateur | 1 | — | EL2 | oui, si EL-Q11 (A) |
| EL3 | Le FEC (sorte `libre`, ses champs BNC), la numérotation de la validation, la piste d'audit, `absenceFec`, le lettrage ; l'état des écritures libres (PDF, CSV par `champCsv`, BOM) | 1,5 | le même | EL2 | oui |
| EL4 | La 2035 (la source neuve, ses contributions), la concordance (le motif déclaré, `concorde` hors des écarts déclarés si EL-Q6 (A)), `prealablesValidation.ts`, Clôture, la situation intermédiaire et l'estimation ; un test qui garde la CA3 aveugle | 2 | le même | EL2 | oui |
| EL5 | L'écran : une section « Écritures de l'expert-comptable » de l'onglet Écritures — la liste de l'exercice, lue en entier (partielle : aucun geste) ; la saisie compte par compte au chef seul (un membre la lit, sans formulaire), l'équilibre affiché, les avertissements sous chaque ligne, le poste proposé, l'extourne proposée ; une confirmation qui NOMME les lignes, les totaux et l'effet sur la 2035 ; un verrou `useRef` par geste ; ses tests d'écran | 2 | `ECRITURES_LIBRES_EXPORTEES` baissé | EL3, EL4 | oui |
| EL6 | Le détail de la balance et du bilan, la révision (preuve, travail), l'assistant (lecture sans libellé) et son redéploiement | 1 | — | EL5 | non |
| EL7 — **préparée le 24/11/2026, en production le 25/11/2026 (251)** (§ 7.2) | La contre-passation d'une écriture validée, d'un geste, dans un exercice ouvert (`contre_passe_id`) | 0,5 | `CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE` levé le 25/11/2026 | EL5 | non |
| EL8 | La mise en production : la table au plan de sauvegarde derrière `ECRITURES_LIBRES_PREVUES` AVEC son bloc de l'essai de restauration (restauration.sql, que restaurationEssai.test.ts confronte au plan prévu), le bloc de `rls.sql` ; simulation (fichiers posés, drapeaux levés, suite entière), collage par le cabinet (les fonctions suppriment), les trois contrôles de l'export, `rejouer.py`, essais rejoués, drapeaux levés | 0,5 | levés | EL2 à EL5 | oui |
| EL9 | Le dégel d'un exercice validé par le chef (EL-Q10 (B), § 6.1) : `degels_d_exercice`, `degeler_exercice`, la relecture des gardes qui lisent la frontière, l'archive au plan de sauvegarde et au paquet d'archive, l'écran (le motif, l'écart avant la revalidation) | 2 | `DEGEL_PREVU` baissé | EL10-Q1 à Q7 | selon EL10-Q7 |

Environ quatorze jours, EL9 compris. L'ordre : EL1 → EL2 (→ EL2b) → (EL3 ∥ EL4) → EL5 → EL8, puis EL6 et EL7 ; EL9 après
EL5, une fois EL10-Q1 à Q7 tranchées. EL2 se prépare et se
rejoue sur une réplique en PostgreSQL 17 (ICU `en-US`) avec toute la rigueur (mutations, banc du leurre), jamais appliquée
avant l'accord du cabinet ; EL4, qui touche la 2035, aussi (les mutations qui mordent, la concordance rejouée sur le banc
de charge d'une année, `outils/charge/`).

**Le MVP.** Les données réelles du praticien entrent vers le 20 novembre ; rien de l'écriture libre n'est nécessaire pour
les recevoir. Elle l'est à la CLÔTURE : la répétition générale valide l'exercice 2025 et le compare à la 2035 déposée
(MVP-D6, MVP-D7) — si l'expert y avait passé des OD (une part privée, un reclassement), elles doivent pouvoir se refaire —,
puis la 2035 de 2026 en mai 2027. Recommandé (EL-Q12, (A)) : EL1 à EL5 et EL8 avant la validation de 2025, EL2b avec EL2 si
EL-Q11 (A) ; EL6 et EL7 après le MVP. Le FEC importé par l'expert (MVP-D5) porte alors ses écritures, sous un journal OD
qu'il connaît.

---

### 7.1 EL1 et EL2, le 17/11/2026 : ce qui a été fait, et ce qui a changé en route

- **EL1** (`src/lib/ecritureLibre.ts`, `ecritureLibre.test.ts`) : `refusDeLEcritureLibre` (vingt-quatre refus, l'ordre de la
  base, 22023 ou 23514), `avertissementsDeLEcritureLibre` (TVA, tiers, immobilisations, emprunt, passage, inventaire en
  engagement, hors de la 2035, charge rattachée, contre la règle), `propositionDeLaRegle` (hors de la 2035 et l'extourne devant
  une charge rattachée), `posteProposeDuCompte`, `composerEcrituresLibres`, `ecritureLibrePourLaBase`, `ecartDeclare`. Les
  longueurs se comptent en points de code, comme `char_length`. Les postes acceptés sont la liste fermée de la contrainte
  `ecritures_brouillon_champs_bnc_du_fec`, recopiée et confrontée (`ecritureLibreEnBase.test.ts`).
- **EL2** (`supabase/preparees/20261117120000_ecritures_libres.sql`, son retour, `supabase/essais/ecrituresLibres.sql`) : la
  table, la colonne, la contrainte « sans autre source », les quatre paires, les deux gardes, la porte, la restrictive sous
  condition, les deux fonctions. Trois écarts à la conception, choisis : l'extourne vit dans la MÊME ligne (`avec_extourne`, le
  patron d'INV2) plutôt qu'une `extourne_de_id` ; `contre_passe_id` attend EL7 ; la désignation « contre la règle de la
  trésorerie » (EL-Q3 (A)) est un booléen de la SAISIE (`contre_la_regle`), exigé quand une ligne de résultat comptée fait face à
  un compte de rattachement, refusé sinon, non gardé (la base le redéduit des lignes). Les quatre préparées sœurs (MCB5g, INV2,
  LIA2, AFF2) tolèrent `ecriture_libre_id` dans leur garde de tête et posent leur paire avec elle (`stocks.test.ts` : dix paires,
  vingt poses). Le plan de sauvegarde et le bloc de `rls.sql` vont à EL8, avec le bloc de l'essai de restauration.
- **Le banc** : une copie de `replique_227` portée à 236 : l'essai 67 sur 67, six mutations sur six qui mordent ; le retour puis
  EL2 de nouveau ; EL2 avant puis après les quatre sœurs, les dix paires posées dans les deux ordres, l'essai juste ; l'essai
  d'INV2 92 sur 92 et 14 mutations sur 14 à côté d'EL2.

### 7.2 EL7, le 24/11/2026 : la contre-passation, préparée

- **« Validée »** : une écriture libre n'a pas de statut à elle ; elle se valide avec son exercice — sa date au plus tard à la
  frontière de la validation, ou une de ses lignes validée, le gel qu'EL2 lit déjà. Après, elle se contre-passe.
- **La migration** (`supabase/schema/20261125123317_contre_passation_des_ecritures_libres.sql`, sans instruction de suppression :
  l'outil peut l'appliquer) : `contre_passe_id` (vers la même table, sans action, une contrainte d'unicité TOTALE, jamais avec une
  extourne) ; `contre_passer_ecriture_libre(p_id, p_version_lue, p_contre_passation, p_ecritures)` — l'accès avant toute lecture
  (`admin_du_dossier`), la version lue, l'écriture figée, sans extourne (son extourne la défait déjà), pas déjà contre-passée ; une
  date d'un exercice ouvert (proposée : le lendemain de la frontière, PCG art. 1031-4) ; l'effet sur la 2035, un choix sans défaut
  (les postes d'origine au sens inverse, ou hors de la 2035) ; le libellé et le motif obligatoires ; les lignes au sens inverse
  recomposées et comparées en multiensemble ; le numéro de son année, l'auteur posé par la base ; une garde à part qui tient la
  colonne (son chemin, la réinsertion du super-administrateur, le même dossier ; ni remplacement ni lien changé ; l'écriture
  contre-passée ne change ni ne se retire). Le retrait d'une contre-passation ouverte : `retirer_ecriture_libre`, telle quelle.
- **Écarts à la conception, choisis** : la pièce citée de l'écriture d'origine n'est pas recopiée (la contre-passation se justifie
  par son motif et l'état) ; une écriture extournée ne se contre-passe pas ; une contre-passation figée se contre-passe à son tour.
- **Les moteurs** : la 2035, le FEC, la piste d'audit et l'état la lisent comme une écriture libre ordinaire, sans changement ;
  son libellé proposé (« Contre-passation de EL2025-0003 — … ») nomme l'écriture d'origine jusqu'au FEC.

## 8. Les risques

- **Le double compte avec une source.** Une écriture libre comptée dans la 2035 qui dit la même dépense qu'une pièce payée
  la compte deux fois. Parades : l'écran dit, quand une écriture libre CITE une pièce dont la 2035 compte déjà le paiement,
  que la pièce a son chemin ; la charge rattachée comptée contre la règle porte son extourne obligatoire (§ 5.1) ; la
  concordance, qui compare source par source, ne voit PAS un double compte (chaque source concorde avec sa propre
  écriture) : seul l'expert le voit, et l'état des écritures libres le lui montre.
- **La banque et la caisse.** Une ligne au 512 sans mouvement fausserait le rapprochement, la suite des soldes et la preuve
  du 512 au relevé du 31 décembre ; à la caisse, la caisse rejouée. D'où le refus recommandé (EL-Q4) ; s'il devenait un
  avertissement, `banque-au-releve` dirait l'écart, en attention seulement.
- **Le libellé identifiant.** La base ne reconnaît pas un nom : un libellé peut porter celui d'un patient jusqu'au FEC.
  Parades : l'avertissement fixe, le motif hors du FEC, l'assistant aveugle ; la responsabilité reste à l'expert, tenu au
  secret. Un scanner de source vérifiera qu'aucun chemin n'envoie `ecritures_libres.libelle` ni `motif` à une Edge
  Function.
- **L'exercice validé.** Rien ne s'y écrit ; une écriture libre de N+1 qui corrige N ne change pas la 2035 validée de N.
  Le risque est humain : croire qu'elle la corrige. La confirmation le dit et renvoie à B9.
- **Les migrations préparées sœurs.** Leur garde de tête refuse une clé étrangère inconnue du brouillon : EL2 les met à
  jour et rejoue leur répétition, sinon INV2, LIA2, AFF2 et MCB5g ne se colleraient plus après elle.
- **La porte déjà ouverte au membre** (§ 1.3) : tant qu'EL2b n'est pas en base, un membre peut insérer une ligne sans
  source par l'API. Elle ne devient jamais une écriture libre (elle ne cite pas `ecritures_libres`, et la validation la
  refuse), mais elle pèse dans la balance.
- **La CA3, le registre des biens, l'échéancier** : une ligne sur leurs comptes les fait diverger des comptes ; averti, pas
  réparé.
- **Le retour arrière** : avant toute donnée, la levée des drapeaux et le retrait de l'écran suffisent ; retirer la table,
  la colonne et les fonctions serait une migration DESTRUCTIVE, à présenter au cabinet.

## 9. Points non vérifiés

- La date de paiement d'un chèque remis et d'une carte à débit différé au sens du BOFiP (EL-E2).
- La ligne de la CA3 qui reprend une correction de TVA (EL-E4).
- La possibilité d'étendre `empreinte_exercice_forme_2` à l'en-tête des écritures libres sans changer le texte d'un
  exercice qui n'en porte pas (le principe d'INV3-Q1 (A)) : à lire avant EL2.
- Le nombre de lignes sans source en base, et leurs dates (§ 1.3) : une lecture simple, par la session principale.
- Le texte des articles 2 et 20 de l'ordonnance du 19 septembre 1945, cités de mémoire.

## 10. Les questions

### 10.0 Les réponses du cabinet (17/11/2026)

- **EL-Q1** : aucune option cochée, une note — « les comptables peuvent faire les ecritures libre ». Un REVIREMENT sur la parole
  du 16/11 (« réservée à l'expert-comptable ») : la plus récente l'emporte. Tout compte du cabinet qui suit le dossier écrit
  (`admin_du_dossier`) ; ce que cela change : § 4.
- **EL-Q2** (A) le poste choisi, ou hors de la 2035 ; **EL-Q3** (A) permise, hors de la 2035 par défaut, comptée seulement sur
  désignation explicite avec extourne obligatoire ; **EL-Q4** (A) banque et caisse refusées ; **EL-Q5** (A) permis et avertis ;
  **EL-Q6** (A) l'écart déclaré ne retient pas la validation ; **EL-Q7** (A) le texte de l'expert sous un avertissement ;
  **EL-Q8** (A) l'état produit, la pièce citée facultative ; **EL-Q9** (A) la dernière version seulement ; **EL-Q11** (A) la
  garde des lignes sans source, après la mesure ; **EL-Q12** (A) au MVP, avant la validation de 2025.
- **EL-Q10** : (B) « Un dégel par le chef du cabinet », contre la recommandation : § 6.1, ses choix ouverts au § 10.3.

### 10.1 Au cabinet

**EL-Q1 — Le membre d'équipe peut-il proposer une écriture libre ?**
- Contexte : la décision réserve l'écriture libre à l'expert ; un comptable prépare souvent une OD que l'expert relit.
- Options : (A) non, pas dans ces lots — le membre la lit seulement ; (B) le membre la propose, l'expert la passe d'un clic
  (une écriture « proposée » hors du brouillon tant qu'elle n'est pas passée).
- Recommandation : (A) maintenant ; (B) plus tard si le cabinet le demande, sans rien changer au droit d'écrire.

**EL-Q2 — En trésorerie, comment une ligne de charge ou de produit agit-elle sur la 2035 ?**
- Contexte : la 2035 se calcule depuis les paiements (CGI, art. 93 ; BOFiP) et se compare aux écritures ; une OD n'est pas
  un paiement.
- Options : (A) l'expert choisit, ligne par ligne, un poste de la 2035 (proposé depuis la catégorie du compte) ou « hors de
  la 2035 » ; (B) la 2035 ne lit jamais une écriture libre, une correction fiscale passe par les cases CC et CL ; (C) la 2035
  lit toute ligne de charge ou de produit.
- Recommandation : (A) : la liberté de l'expert, dite ligne par ligne ; (B) obligerait à saisir deux fois un simple
  reclassement ; (C) compterait une charge à payer contre la règle sans que personne l'ait choisi.

**EL-Q3 — L'exemple : une dépense payée en janvier N+1, passée dans les charges de N ?**
- Contexte : en trésorerie, elle compte dans la 2035 de N+1, l'année du paiement (BOI-BNC-BASE-40-10 § 260), sauf option
  pour les créances-dettes (CGI, art. 93 A), que l'application ne gère pas.
- Options : (A) permise ; proposée « hors de la 2035 » avec son extourne au 1er janvier N+1 ; comptée dans la 2035 de N
  seulement si l'expert le choisit, après une confirmation qui cite la règle, l'extourne alors obligatoire ; un
  avertissement à la validation ; (B) refusée en trésorerie ; (C) permise et comptée sans rien dire.
- Recommandation : (A) : l'expert fait ce qu'il veut, l'application ne ment pas, et la dépense ne se déduit jamais deux fois.

**EL-Q4 — Les comptes de banque et de caisse ?**
- Contexte : le 512 et la caisse se prouvent par le relevé et par les opérations de caisse ; une ligne sans mouvement les
  ferait diverger.
- Options : (A) refusés, la phrase disant le bon chemin (importer le relevé, saisir dans Caisse) ; (B) permis avec un
  avertissement, l'écart dit à la validation.
- Recommandation : (A) : l'argent du dossier ne s'invente pas par une écriture ; aucun besoin réel n'a été cité.

**EL-Q5 — Les comptes que l'application tient elle-même (TVA, fournisseurs et clients, immobilisations et amortissements,
emprunts, virements internes, attente) ?**
- Options : (A) permis, avertis avant le clic et dans la confirmation ; (B) refusés.
- Recommandation : (A) : c'est là que l'expert a le plus souvent raison de corriger ; l'avertissement dit ce qui ne suivra
  pas (la CA3, le registre, l'échéancier, le lettrage).

**EL-Q6 — Une ligne « hors de la 2035 » retient-elle la validation ?**
- Contexte : depuis le 04/10/2026, la validation attend une concordance au centime entre la 2035 et les écritures.
- Options : (A) non : un écart DÉCLARÉ par l'expert, chiffré, dit en attention avant le clic ; tout autre écart retient
  comme aujourd'hui ; (B) oui : l'expert doit compter chaque ligne de résultat.
- Recommandation : (A) : l'écart est voulu, nommé et tracé ; (B) rendrait le choix « hors de la 2035 » impossible.

**EL-Q7 — Le libellé ?**
- Contexte : il part au FEC ; aucun nom de patient ne doit y entrer, et la base ne sait pas le reconnaître.
- Options : (A) un texte de l'expert (200 caractères), sous un avertissement fixe, jamais envoyé à l'assistant ; (B) un
  libellé composé par l'application (« Écriture libre EL2026-0003 »), le texte de l'expert dans le motif seulement.
- Recommandation : (A) : un vérificateur attend un libellé qui dit l'opération ; l'expert est tenu au secret.

**EL-Q8 — La pièce justificative ?**
- Options : (A) l'état des écritures libres produit par l'application (motif, auteur, instant), une pièce du dossier citée
  si l'expert le veut ; (B) une pièce déposée exigée.
- Recommandation : (A) : une part privée ou un reclassement n'a pas d'autre pièce que la décision motivée de l'expert.

**EL-Q9 — Avant la validation, garder les versions remplacées ?**
- Options : (A) non : la dernière version, son auteur, son instant et son numéro de version ; (B) oui, une table d'historique.
- Recommandation : (A) : le brouillon n'est pas encore probant ; la validation fige, et la contre-passation trace ensuite.

**EL-Q10 — Rouvrir un exercice validé ?**
- Contexte : un exercice validé est figé en base (PCG, art. 1031-3) ; un exercice clos ne se rouvre pas
  (BOI-BIC-DECLA-30-10-20-40).
- Options : (A) jamais : une correction passe dans l'exercice ouvert (contre-passation, EL7), et son effet sur la 2035
  d'un exercice validé par l'opération découverte après coup (B9, une 2035 rectificative) ; (B) un dégel par le chef.
- Recommandation : (A) : le dégel casserait l'empreinte chaînée des exercices et la valeur probante du FEC.

**EL-Q11 — Fermer la porte qui laisse un membre insérer une ligne sans source ?**
- Contexte : § 1.3 ; aucun écran ne l'offre, mais la policy du brouillon le permet par l'API.
- Options : (A) oui : une garde refuse toute ligne nouvelle sans source, la restauration exceptée, après une mesure en
  base ; (B) non.
- Recommandation : (A) : sans elle, la réservation à l'expert ne tient que par l'écran.

**EL-Q12 — Quand, par rapport au MVP ?**
- Options : (A) EL1 à EL5 et EL8 avant la validation de l'exercice 2025 de la répétition générale, EL2b avec EL2, EL6 et
  EL7 après le MVP ; (B) tout après le MVP.
- Recommandation : (A) : la répétition doit pouvoir refaire les OD de la 2035 déposée, et l'expert clôture 2026 avec.

### 10.2 À l'expert-comptable

**EL-E1 — NatOp d'une écriture libre dans le FEC à vingt-deux champs.** Une ligne comptée porte « Dépense » ou « Recette »
et son poste ; une ligne hors de la 2035 « Dépense » ou « Recette » sans poste ; une ligne de bilan « Opération de bilan » ;
ModeRglt « Sans règlement ». Recommandation : ces valeurs, déjà admises par la base ; votre logiciel les lit-il ainsi ?

**EL-E2 — Chèque remis en décembre et débité en janvier ; carte à débit différé.** L'application date le paiement d'une
pièce au mouvement du relevé. Recommandation : si la date du paiement est la remise du chèque ou la transaction, la corriger
sur la pièce (un chantier à part), plutôt qu'une écriture libre.

**EL-E3 — La part privée d'une dépense mixte.** Par une écriture (108 / 6xx, comptée sous le poste) ou par la case CC
« Divers à réintégrer » ? Recommandation : l'une ou l'autre selon votre usage, jamais les deux ; l'application le dit.

**EL-E4 — Une correction de TVA par écriture libre.** La CA3 de l'application ne la lira pas. Recommandation : nous dire sur
quelle ligne de la CA3 vous la déclarez, avant que l'application ne la propose.

**EL-E5 — Le journal.** Toutes les écritures libres au journal OD, numérotées avec les autres OD, PieceRef
« EL<année>-<numéro> ». Recommandation : OD ; un journal propre seulement si votre logiciel en a besoin.

### 10.3 Les questions du dégel (17/11/2026)

**EL10-Q1 — Quel exercice se dégèle ?** (A) le dernier validé seul, un exercice plus ancien après le dégel de ceux qui le
suivent ; (B) n'importe lequel, les suivants dégelés en cascade. Recommandation : (A) — l'ouverture et l'empreinte de N+1
reposent sur N validé.

**EL10-Q2 — Jusqu'à quand ?** (A) tant que l'exercice suivant n'est pas validé, la 2035 rectificative dite après le dépôt ; (B)
seulement avant le dépôt de la 2035 ; (C) sans limite. Recommandation : (A) — la clôture d'une période se fait avant
l'expiration de la suivante (PCG, art. 1031-4, à relire).

**EL10-Q3 — La numérotation à la revalidation ?** (A) recomposée entière, l'ancien FEC archivé sous son empreinte ; (B) les
numéros d'avant gardés, les écritures nouvelles à la suite. Recommandation : (A) — le FEC d'un exercice est un tout numéroté en
continu (LPF, art. A47 A-1, à relire).

**EL10-Q4 — Les fichiers des pièces figées ?** (A) ils restent gardés tant qu'une archive de dégel les cite, les lignes des
pièces redevenant modifiables ; (B) tout se dégèle. Recommandation : (A) — l'archive doit rester justifiable.

**EL10-Q5 — Les déclarations déjà faites (CA3, e-reporting, 2035 déposée) ?** (A) le dégel les laisse intactes et les dit,
la liquidation de TVA reste figée ; (B) le dégel se refuse tant qu'une CA3 de l'exercice est enregistrée. Recommandation : (A).

**EL10-Q6 — L'archive ?** (A) l'instantané validé ET les lignes validées (le FEC de N reproductible), dans une table immuable,
au plan de sauvegarde et au paquet d'archive ; (B) l'instantané seul. Recommandation : (A) — la valeur probante de ce qui a été
validé, puis remplacé.

**EL10-Q7 — Quand ?** (A) avant la validation de 2025 de la répétition générale, avec EL1 à EL5 : un écart trouvé en comparant
la 2035 validée à la 2035 déposée se corrigerait sinon dans 2026, l'exercice réel ; (B) après le MVP. Recommandation : (A), si
EL10-Q1 à Q6 sont tranchées à temps ; sinon, ne valider 2025 qu'après la comparaison.
