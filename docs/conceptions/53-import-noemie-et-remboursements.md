# 53 — L'import des retours NOEMIE et le rapprochement des paiements de l'assurance maladie

Conçu le 16/11/2026. La demande du cabinet, du même jour : « j'aimerais qu'on rajoute l'import NOEMIE et le rapprochement des
remboursements sécu » (les dossiers BNC des praticiens de santé : infirmiers, médecins… ; le MVP est un praticien en
trésorerie). **Sa décision, du même jour, qui fixe l'architecture** : « pour l'import NOEMIE on récupère que les chiffres et on
stocke pas de données patients ».

Rien n'est écrit : ni code, ni migration. Cette page dit ce qu'on garde, la preuve qu'aucune valeur gardée n'identifie un
patient, le rapprochement avec les crédits du relevé, les lots NOE1 à NOE8 et les questions qui restent ouvertes.

## 1. La contrainte qui décide : pas d'hébergeur HDS, pas de patient en base

RGPD.md §8.7 (24/09/2026) : l'hébergement de données de santé (CSP, art. L.1111-8) n'est pas requis **tant qu'aucune donnée
de patient n'entre** ; le praticien ne transmet pas ses bordereaux de télétransmission (secret professionnel, CSP art.
L.1110-4 ; code pénal, art. 226-13), et le relevé SNIR justifie les recettes. Un retour NOEMIE porte, lui, des données de
patients (§2). La décision du 16/11/2026 tranche donc ainsi :

- **Retenu (A)** : le fichier est lu **dans le navigateur du praticien** ; seuls des agrégats sans patient en sortent, au clic,
  vers une fonction SQL. Le fichier ne part nulle part — ni au stockage, ni vers une Edge Function, ni dans un journal, ni au
  modèle de l'assistant. Le patron existe : l'import d'un fichier de clients (`lib/contactsImportFichier.ts`, « LE FICHIER NE
  PART NULLE PART »).
- **Gardé en complément (B)** : un relevé déjà agrégé (les virements de l'assurance maladie sans détail par facture), lu de la
  même façon ; il n'apprend rien de plus que (A) et passe par le même module.
- **Écartée (C)**, l'import des lignes de patients : elle exigerait de revenir sur la décision du 24/09/2026 et un hébergeur
  certifié ; la décision du 16/11/2026 l'écarte.

## 2. Ce qu'est un retour NOEMIE — ce qui est établi, et ce qui ne l'est pas

**NOEMIE** (« norme ouverte d'échange entre la maladie et les intervenants extérieurs ») est le canal de retour de
l'assurance maladie vers le professionnel, après la télétransmission de ses factures (feuilles de soins électroniques) :
paiements, rejets, par lot et par facture.

**Établi, par des sources publiques** (consultées le 16/11/2026) :

- Le retour se produit quand l'assurance maladie paie des factures **en tiers payant** ; un paiement forfaitaire ou une
  opération ponctuelle peut aussi y figurer. Le fichier détaille **le bénéficiaire du paiement, les numéros de lots et de
  factures, l'identification de l'assuré et du patient**, et le montant du remboursement, part obligatoire et part
  complémentaire réunies ; **sur le relevé bancaire, ce montant est scindé en deux avis de crédit**. Le virement paraît sous
  « Virement CPAM » suivi d'une référence dont **les six derniers chiffres sont la date de journée comptable (AAMMJJ)**, qui
  relie le virement aux factures. — ameli.fr, espace médecin, « Le retour NOEMIE »
  (https://www.ameli.fr/medecin/exercice-liberal/facturation-remuneration/teletransmission-retour-noemie/retour-noemie).
- Deux références de retour pour les professionnels : la **576**, la plus courante dans les logiciels, et la **580**, qui
  ajoute la référence du virement à côté de la date comptable ; une nouvelle norme de retour, annoncée, fournira la référence
  du virement. — ameli.fr, pages « Le retour NOEMIE » des pharmaciens
  (https://www.ameli.fr/pharmacien/exercice-professionnel/teletransmission/retour-noemie) et des laboratoires
  (https://www.ameli.fr/laboratoire-danalyses-medicales/exercice-liberal/facturation-remuneration/retour-noemie).
- Le **suivi des factures en tiers payant** des logiciels agréés SESAM-Vitale affiche l'état de chaque facture (payée,
  rejetée, en attente), les parts obligatoire et complémentaire, les régularisations et rémunérations forfaitaires, le détail
  de chaque virement, et **exporte les paiements vers un logiciel comptable**. — ameli.fr, « Le suivi des factures en tiers
  payant » (https://www.ameli.fr/laboratoire-danalyses-medicales/exercice-liberal/facturation-remuneration/pratique-tiers-payant/suivi-factures-tiers-payant ;
  pour la LPP, « norme NOEMIE 580 » :
  https://www.ameli.fr/professionnel-de-la-lpp/exercice-professionnel/facturation/pratique-tiers-payant/suivi-factures-tiers-payant).
- Au niveau de la facture : statut payée, rejetée (code et libellé) ou « traitement caisse » (un second retour suit) ; au
  niveau des lignes, la cotation, les dates de soins, le montant et le taux ; l'assuré ou le patient par son NIR, son nom, sa
  date de naissance ; une facture en tiers payant engendre **deux chaînes de paiement distinctes**, la part obligatoire (AMO)
  et la complémentaire (AMC), l'une pouvant être payée et l'autre rejetée. — un éditeur de logiciel infirmier, « Retour
  NOEMIE : comprendre et décoder vos rejets de facturation » (https://laruche.cbainfo.fr/gerer-cabinet-infirmier/facturation-idel/rejets-noemie/).
- Les éditeurs exportent les paiements en CSV, chacun sous sa forme (AxiSanté : « Export CSV ou Export vers AxiCompta »,
  https://afpa.org/content/uploads/2023/12/Le-nouveau-module-de-facturation-Addendum-8-dans-AxiSante-AFPA-.pdf).
- Les cahiers des charges sont publiés : ameli.fr, « Norme NOEMIE » (https://www.ameli.fr/infirmier/documentation-technique/norme-noemie),
  NOEMIE PS en version de juin 2016 ; une version de mai 2004 sur sesam-vitale.fr
  (https://sesam-vitale.fr/documents/20182/55864/cdc_noemie-ps-052004.pdf), dont le sommaire nomme une « référence 580 ».

**Non établi** :

- **La disposition des zones** (enregistrements, positions, longueurs) d'un fichier 576 ou 580 : le PDF de 2004 est publié
  **chiffré, la copie du texte interdite** par son éditeur ; je ne l'ai pas déchiffré (même prudence que pour les normes AFNOR,
  CLAUDE.md), et les pages d'ameli.fr ont refusé la lecture automatique (HTTP 403) : leur contenu ci-dessus est celui qu'en
  rendent les moteurs de recherche, **à relire à la main** avant NOE2. Les conditions d'usage du cahier de 2016 sont à lire
  aussi (NOE-Q2).
- **La forme des exports CSV** des logiciels : aucune n'est publique ; elle dépend du logiciel du praticien (NOE-Q2).
- **Le relevé des paiements sur amelipro** : son existence et sa forme côté professionnel ne sont pas établies (l'espace
  assuré en a un ; pas trouvé côté professionnel).
- **Si un virement regroupe plusieurs journées comptables**, et l'écart en jours entre la journée comptable et le crédit :
  à mesurer au premier relevé réel.
- **Si la part complémentaire de la mutuelle passe toujours par ce retour** (gestion unique par la caisse) ou par un retour
  de l'organisme complémentaire : ameli dit « réunies » pour le retour qu'elle décrit ; le reste n'est pas établi.

## 3. Ce qu'on garde, par paiement — et la preuve qu'aucune valeur n'identifie un patient

**Un paiement gardé** est l'agrégat de toutes les factures payées par l'assurance maladie sous une même **date de journée
comptable**, un même **organisme payeur** et une même **part** (obligatoire, complémentaire). Ses colonnes, et aucune autre :

| Colonne | Type | Pourquoi |
|---|---|---|
| `date_journee_comptable` | date | le lien au virement (ameli : les six derniers chiffres de sa référence) |
| `regime`, `caisse` | deux entiers (le code du régime, le numéro de la caisse) | distinguer la CPAM, la MSA, une mutuelle ; un organisme, jamais une personne |
| `part` | liste fermée : `obligatoire`, `complementaire`, `forfait` | les deux avis de crédit ; un forfait ne paie aucune facture |
| `montant_centimes` | entier signé | le net payé, régularisations déduites |
| `regularisations_centimes` | entier ≤ 0 | ce que les régularisations en ont retiré (zéro si le fichier ne les dit pas) |
| `nombre_de_factures` | entier ≥ 0 | un ordre de grandeur, jamais un détail |

Par import, en plus : la période lue (du, au), le nombre de paiements, et — selon NOE-Q4 — le nombre de factures rejetées et
leur montant total, **jamais par facture**. L'auteur et l'instant, posés par la base.

**Ce qui n'est jamais gardé, et pourquoi** :

- **Le NIR, le nom, la date de naissance, le rang, les actes, les dates de soins** : des données de santé, la décision du
  cabinet.
- **Le numéro d'une facture et celui d'un lot** : ce sont les numéros que le logiciel du praticien a donnés ; dans ce logiciel,
  une facture désigne UN patient et une date de soins, un lot un ensemble de factures. Gardés ici, ils seraient des données
  **pseudonymisées**, qui restent des données personnelles (RGPD, art. 4, 5), et considérant 26 : la personne est identifiable
  « par le recours à des informations supplémentaires », ici le logiciel du praticien). Ni gardés, ni empreinte de ces numéros.
- **La référence complète du virement** : elle désigne un virement, pas une personne, mais un virement qui ne paie qu'une
  facture se ramène, par le logiciel du praticien, à un patient. On n'en garde que la date de journée comptable (que la
  référence porte) ; le rapprochement relit la référence dans le libellé du relevé, déjà en base (NOE-Q3).
- **L'empreinte du fichier** : pas de SHA-256 du fichier (un document de santé ne laisse pas de trace ici) ; les doublons se
  jugent sur la clé naturelle du paiement (§4).
- **Le libellé d'un rejet, d'une régularisation, d'un forfait** : texte libre, il pourrait porter un nom. Les forfaits se
  disent `forfait`, sans leur libellé.

**La preuve, tenue en base et pas seulement par l'écran** : la table n'a **aucune colonne de texte** — des dates, des entiers,
une liste fermée. Aucune valeur qu'un navigateur fautif enverrait ne peut porter un nom. La fonction d'import refuse toute
clé hors de la liste fermée (comme `importer_contacts` refuse une colonne inconnue), un nombre négatif de factures, une part
hors de la liste. Ce que la base contient déjà n'en apprend pas plus : la date, l'organisme et le montant d'un virement sont
déjà dans le libellé et le montant du crédit du relevé (`lignes_bancaires`) ; s'y ajoutent une part et deux comptes.

**Le reste de la chaîne** :

- Le module de lecture (`lib/paiementsAssuranceMaladie.ts`, NOE2) est **pur** : ni `supabase`, ni `fetch`, ni stockage, ni
  `console`, ni horloge ; un scanner le garde (`paiementsAssuranceMaladieSansSortie.test.ts`, à écrire), éprouvé par un défaut
  planté. Une cellule du fichier ne quitte jamais la fonction qui la lit : il rend des agrégats, et une erreur de lecture se
  dit par son numéro de ligne et sa raison, **jamais avec la valeur** (un message d'erreur finit dans un journal).
- **L'aperçu n'affiche que les agrégats**, jamais une ligne du fichier. Le choix des colonnes (pour un CSV d'éditeur) montre
  les seuls en-têtes et le genre reconnu (date, montant, code) — pas d'exemples de valeurs.
- **Aucune Edge Function** ne le lit ; l'assistant lit les paiements gardés, qui ne portent rien d'autre (après le MVP).
- **Les tests** : uniquement des fichiers **fabriqués**, aux noms et NIR manifestement faux ; aucun fichier réel au dépôt,
  public.

## 4. Où vit le paiement, et qui l'écrit

Deux tables par dossier, préparées par l'outil (NOE3), derrière `PAIEMENTS_ASSURANCE_MALADIE_PREVUS` baissé :

- `imports_assurance_maladie` : un import (dossier, période, comptes, auteur, instant) ;
- `paiements_assurance_maladie` : les colonnes du §3, `import_id`, une contrainte unique TOTALE sur (dossier, journée
  comptable, régime, caisse, part) — réimporter une période recouvrante ne double rien ; un montant différent sur la même clé
  se refuse et se dit (deux exports qui divergent ne se tranchent pas en silence) ;
- `paiements_assurance_maladie_mouvements` : l'association d'un paiement à un ou deux crédits du relevé (§5), son auteur.

**Droits** : la lecture par `admin_du_dossier(dossier_id)` (le cabinet) et par l'accès client qui porte le droit de NOE-Q1 ;
**aucune policy d'écriture** : trois fonctions `security definer`, accès vérifié avant toute lecture, colonnes énumérées —
`importer_paiements_assurance_maladie` (tout ou rien), `retirer_import_assurance_maladie` (refusé tant qu'un de ses paiements
est associé, ou dans un exercice validé), `associer_paiement_assurance_maladie` et son retrait (le cabinet seul). Toute porte
`to authenticated` ; la restrictive `deux_facteurs` posée sous condition (`deuxFacteursDesTablesNeuves.test.ts`) ; la porte
`_acces_avant_les_gardes` si une garde `security definer` s'y pose (`porteDevantLesGardes.test.ts`) ; aucune mise à jour (un
import se retire et se refait). Au plan de sauvegarde derrière le drapeau (`sauvegardePaiementsAssuranceMaladie.test.ts`) ;
la restauration écrit en super-administrateur. Le figement de l'exercice validé les couvre (un paiement dont la journée
comptable est dans une année validée ne se retire ni ne s'associe plus).

**Qui importe** (NOE-Q1) : **le praticien, depuis son espace client** — le cabinet ne voit jamais le fichier, seulement les
agrégats. C'est ce qui tient la consigne du 24/09/2026 : le praticien ne transmet pas ses retours à son expert-comptable.
Le cabinet n'a pas d'écran d'import du fichier NOEMIE ; il pourrait importer un relevé déjà agrégé (B), sans patient, s'il
en existe un (NOE-Q2).

## 5. Le rapprochement avec les crédits du relevé

**Ce que le paiement N'EST PAS** : une recette. La 2035 compte le crédit du relevé, classé en recette (`affectationBanque.ts`),
à la date de son encaissement (CGI, art. 93, 1) ; le paiement NOEMIE ne s'ajoute à aucun moteur — ni 2035, ni CA3, ni
estimation, ni alerte de hausse, ni FEC. S'il comptait, la même recette entrerait deux fois (la leçon de la « vente entrée
deux fois », ligne 28.6). **Il justifie et il contrôle**, rien d'autre.

**Les signaux** (`lib/rapprochementAssuranceMaladie.ts`, NOE5, pur, sur le modèle d'`appariementBanque.ts`) :

1. **le montant au centime** : le paiement, ou la somme de ses deux parts (obligatoire + complémentaire de la même journée et
   du même organisme) quand le relevé n'a qu'un crédit — et, à l'inverse, une part par crédit quand il en a deux (ameli : deux
   avis de crédit) ;
2. **la référence** : les six derniers chiffres de la référence du libellé (`libelleExploitable`) égaux à la journée comptable
   (AAMMJJ) — « en général » selon ameli : un signal, jamais une condition ;
3. **la date** : le crédit après la journée comptable, dans une fenêtre à mesurer (proposée à cinq jours, comme
   `JOURS_TOLERANCE_RAPPROCHEMENT`) ; et le sens (un crédit, sauf une régularisation nette négative).

**Rien ne se valide ni ne s'associe seul** : « tout document importé arrive à valider ». Les trois signaux concordants, un
seul candidat dans les deux sens, la fiche du mouvement le PROPOSE (« Paiement de l'assurance maladie — journée comptable du
JJ/MM/AAAA, CPAM, 12 factures ; même montant, date dans la référence, crédité deux jours après ») et le cabinet clique
« Associer » ; un lot « Associer les concordances » se joue au clic, la confirmation nommant ce qui part. Deux signaux : la
fiche dit ce qui manque. À égalité, aucun proposé (la règle de `FicheMouvement`).

**Les cas difficiles** :

- **plusieurs lots dans un virement** : sans effet, le paiement les a déjà réunis par journée comptable ;
- **un virement qui couvrirait plusieurs journées** (non établi) : une association d'un crédit à plusieurs paiements, dont la
  somme fait le montant — prévue dans la table d'association, proposée seulement si le premier relevé réel la montre ;
- **les rejets** : aucun mouvement en face ; comptés par import (NOE-Q4), ils ne changent rien à la trésorerie ;
- **une régularisation** (un indu récupéré) : déduite du net, elle explique un crédit plus petit ; un net négatif (un débit de
  la caisse) se rapproche d'un débit et le dit ;
- **le tiers payant seulement** : ce que le patient paie lui-même (espèces, chèque, carte) n'est pas dans NOEMIE ; le contrôle
  ne couvre que ce que l'assurance maladie verse.

**Ce que ça change aux moteurs existants** :

- **Le classement du crédit** ne change pas : il reste affecté à sa catégorie de recette, par une règle ou à la main ; la
  fiche peut proposer la catégorie de recette habituelle du dossier pour un crédit associé (une proposition, le clic écrit).
- **Le libellé de l'écriture** ne change pas : « Crédit du relevé du JJ/MM/AAAA » (`libellesDuReleve.ts`, JJ1-Q1) ; le FEC n'en
  reçoit rien de plus (NOE-Q7). La piste d'audit, dans sa colonne du justificatif, peut citer « paiement de l'assurance maladie
  du JJ/MM/AAAA, N factures » — aucun nom, aucune référence (NOE6).
- **Un dossier basculé** (ventes par les factures) : un crédit associé à un paiement de l'assurance maladie n'est candidat
  d'aucune facture source (`candidatsDuMouvement`), et un mouvement classé ou réservé par des encaissements de factures ne
  s'associe pas (la règle G2 : il ne reçoit aucun autre classement).
- **La caisse, les cotisations, les lots du relevé** : intacts.
- **Le volet social** (`voletSocialPamc.ts`) : le SNIR reste saisi par le cabinet (DSAV) ; NOEMIE ne le remplace pas.

**Ce que ça permet de contrôler** (NOE6, des points d'attention, jamais bloquants) :

1. un crédit de l'assurance maladie sans paiement importé, un paiement sans crédit (un virement manquant, ou un relevé
   incomplet) ;
2. sur l'exercice, le total des paiements associés contre les crédits classés en recette qui viennent de l'assurance
   maladie — la frontière du 31 décembre jugée sur la date du **crédit**, pas de la journée comptable ;
3. puis contre le SNIR (DSAV) : l'écart attendu (ce que le patient paie directement, la date de soins contre la date de
   paiement) n'est pas établi ; la comparaison n'est dite qu'après l'avis de l'expert-comptable (NOE-E1).

## 6. Le dépôt accidentel d'un retour

Le risque monte avec cet écran : un praticien qui a le fichier en main peut le déposer dans « Mes pièces » (le CSV y est
accepté) ou l'envoyer par e-mail à l'adresse de collecte — il entrerait alors au stockage. Le §8.7 l'a accepté pour les
bordereaux (24/09/2026 : ne rien changer au code). NOE-Q6 propose de refuser, **dans le navigateur, avant tout envoi**, un
fichier reconnu comme un retour NOEMIE, et de l'écarter à la réception par e-mail sous la raison « format ».

## 7. Les lots

| Lot | Ce qu'il fait | Préalable |
|---|---|---|
| NOE1 | Le format : le nom du logiciel du praticien du MVP et les **en-têtes** de son export de paiements (aucune donnée) ; relire à la main les pages d'ameli citées et les conditions d'usage du cahier NOEMIE PS ; fabriquer les fichiers d'essai | NOE-Q2 |
| NOE2 | `lib/paiementsAssuranceMaladie.ts` : lecture, choix des colonnes, agrégats, refus ; scanner « sans sortie » | NOE1 |
| NOE3 | La migration préparée (trois tables, quatre fonctions, RLS, essais `paiementsAssuranceMaladie.sql`, `rls.sql`), au plan de sauvegarde derrière le drapeau | NOE-Q1, Q3, Q4 |
| NOE4 | L'écran d'import du praticien (espace client), l'aperçu des agrégats, la confirmation qui nomme ce qui part et ce qui reste dans le fichier | NOE2, NOE3 |
| NOE5 | `lib/rapprochementAssuranceMaladie.ts` et la fiche d'un mouvement : la proposition, « Associer », le lot des concordances | NOE3 |
| NOE6 | Les contrôles (Vue d'ensemble, Révision), la colonne du justificatif de la piste d'audit | NOE5, NOE-E1 |
| NOE7 | Le refus d'un retour NOEMIE au dépôt et à la réception par e-mail | NOE-Q6 |
| NOE8 | La mise en production : la migration par l'outil, le drapeau levé, les essais et les trois contrôles de l'export | tout |

**Le MVP** (NOE-Q5) : la 2035 de 2026 n'en dépend pas — les recettes viennent des crédits du relevé, et le SNIR les recoupe
déjà. Recommandé : NOE1 tout de suite (une question au praticien, sans code), le reste après la répétition générale, et le
contrôle de l'exercice 2026 avant la 2035 de mai 2027.

## 8. Les risques

- **Le format est inconnu** : sans les en-têtes réels (NOE1), NOE2 serait écrit contre une supposition.
- **Un en-tête mal choisi** fait d'une colonne de noms un « montant » : refusé, puisque la base n'a aucune colonne de texte et
  que le module exige un nombre ; mais l'aperçu doit le dire avant le clic.
- **Une erreur de lecture recopiée** dans un message (et de là dans un journal) : la règle « jamais la valeur » et son test.
- **Le doublement d'une recette** si un moteur venait à lire la table : un scanner liste les lecteurs de la table (seuls le
  rapprochement, les contrôles, l'écran, la sauvegarde).
- **Le retour arrière** : la migration est additive ; son retour retire les trois tables et se refuse tant qu'elles portent
  une ligne.

## 9. Les questions

Au cabinet : NOE-Q1 (qui importe), NOE-Q2 (quel fichier lire d'abord), NOE-Q3 (la référence du virement), NOE-Q4 (les rejets),
NOE-Q5 (le MVP), NOE-Q6 (le dépôt accidentel), NOE-Q7 (le libellé et le FEC). À l'expert-comptable : NOE-E1 (le contrôle contre
le SNIR), NOE-E2 (la frontière du 31 décembre), NOE-E3 (le paiement comme justificatif dans le FEC). Leurs fiches sont dans la
page « Arbitrages du cabinet ».
