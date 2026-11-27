# 53 — L'import des retours NOEMIE et le rapprochement des paiements de l'assurance maladie

Conçu le 16/11/2026. La demande du cabinet, du même jour : « j'aimerais qu'on rajoute l'import NOEMIE et le rapprochement des
remboursements sécu » (les dossiers BNC des praticiens de santé : infirmiers, médecins… ; le MVP est un praticien en
trésorerie). **Sa décision, du même jour, qui fixe l'architecture** : « pour l'import NOEMIE on récupère que les chiffres et on
stocke pas de données patients ».

Le 16/11/2026 au soir, le cabinet a répondu aux questions (§10) ; NOE1, NOE2 (en module) et NOE3 (la migration, préparée,
pas appliquée) sont faits le même jour. Cette page dit ce qu'on garde, la preuve qu'aucune valeur gardée n'identifie un
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

**Qui importe** (NOE-Q1, réponse du 16/11/2026 : « Le praticien et le cabinet », contre la recommandation) : **le praticien
depuis son espace client, sous la case « Banque », et le cabinet du dossier** ; le fichier se lit dans le navigateur de celui
qui importe, et rien d'autre que des agrégats n'en sort. Quand le cabinet importe, il a le fichier en main : la consigne du
24/09/2026 (le praticien ne transmet pas ses retours) devient un choix du praticien, que l'écran du cabinet rappelle (NOE4).
La migration préparée ouvre au client la lecture des imports et des paiements de son dossier, et les deux gestes (importer,
retirer) : présentés au cabinet avant d'être appliqués (la fiche NOE-migration).

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

**Le MVP** (NOE-Q5, réponse du 16/11/2026 : « Au MVP, en entier », contre la recommandation) : l'import et le contrôle
entrent au MVP. Ce qui suit était la recommandation : la 2035 de 2026 n'en dépend pas — les recettes viennent des crédits du relevé, et le SNIR les recoupe
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

## 10. Les réponses du cabinet (16/11/2026 au soir) et ce qu'elles changent

- **NOE-Q1** « Le praticien et le cabinet » : §4. Le droit du praticien est « Banque » (la case qui ouvre déjà ses crédits du
  relevé) ; la lecture et les deux gestes du client se présentent au cabinet avant l'application (NOE-migration).
- **NOE-Q2** « Les deux » : l'export CSV du logiciel du praticien se lit par un **réglage des colonnes** choisi à l'écran
  (`lib/paiementsAssuranceMaladie.ts` : une ligne est une facture, chaque part — obligatoire, complémentaire — a sa colonne de
  montant, de journée comptable, et au choix de statut et d'organisme ; les statuts, une liste fermée de mots ; le genre des
  colonnes montré sans une valeur). Le nom du logiciel et ses en-têtes restent à recevoir (NOE1) : le réglage les attend sans
  les deviner. **Le fichier brut (576, 580) est ARRÊTÉ** : le seul cahier public lisible (NOEMIE PS, mai 2004,
  sesam-vitale.fr) se déclare, en page 2, « la copropriété » de la CNAMTS, de la CCMSA, de l'AMPI et de l'UNRS, « titulaires
  des droits d'auteur », sa publication « n'entraîn[ant] aucune cession des droits d'auteurs » ; il est protégé contre la copie
  (Acrobat : copie interdite) ; la version de 2016 (ameli.fr) refuse toujours la lecture automatique (403). Aucune source dont
  les conditions permettent l'exploitation ne donne la disposition des zones : la question revient au cabinet (NOE2-Q1).
- **NOE-Q3** « la date de journée comptable seule » : appliquée (aucune référence de virement en base).
- **NOE-Q4** « le nombre et le montant total par import » : `nombre_de_rejets` et `montant_rejete_centimes` de l'import ; une
  part rejetée d'une facture (obligatoire ou complémentaire) compte un rejet ; nuls quand le fichier ne dit pas les statuts.
- **NOE-Q5** « Au MVP, en entier » : §7.
- **NOE-Q6** « Refuser au dépôt et écarter à la réception » : NOE7 ; il attend la forme du fichier (les en-têtes de l'export,
  NOE1 ; le brut, NOE2-Q1) — reconnaître un retour sans la connaître serait deviner.
- **NOE-Q7** « Inchangé, cité dans la piste d'audit », **NOE-E3** « La piste d'audit seule » : NOE6 ; le FEC ne change pas.
- **NOE-E1** « Ne pas comparer » : le contrôle contre le SNIR est retiré de NOE6. **NOE-E2** (la frontière du 31 décembre) :
  sans réponse ; la base fige un paiement par l'année de sa journée comptable (l'exercice validé retient l'import et le
  retrait), le contrôle de NOE6 jugera la frontière sur la date du crédit.

**Ce que NOE3 pose, en écart de §4** : deux tables (l'import ; ses paiements, sous la clé TOTALE et la clé étrangère (import,
dossier)), deux fonctions (`importer_paiements_assurance_maladie`, tout ou rien ; `retirer_import_assurance_maladie`) et une
garde aux droits de l'appelant (aucune réécriture, aucune écriture hors de l'import et de la restauration, même pour le rôle des
Edge Functions). **L'association à un crédit du relevé est remise à NOE5**, avec sa propre migration : ses règles (un ou deux
crédits, la règle G2, les sommes) dépendent des signaux de NOE5 et du premier relevé réel ; sa clé étrangère retiendra le
retrait d'un import associé.

## 11. NOE5, fait le 17/11/2026 (préparé, pas appliqué)

- **Le module** `src/lib/rapprochementAssuranceMaladie.ts` (pur, testé à côté) : les candidats (§ 5, signal 1 et 3 : la somme au
  centime d'un paiement seul ou des deux parts d'une journée et d'un organisme, de zéro à cinq jours après la journée), la
  référence qui départage, la proposition et sa justification, le lot (trois signaux, un seul candidat dans les deux sens), les
  contrôles de NOE6 calculés (crédit sans paiement, écart, paiement sans crédit par ancienneté, association incohérente ou
  contredite), muet sur une lecture partielle ; les refus de la base redits avant le clic.
- **La migration** `supabase/schema/20261120110100_association_paiements_assurance_maladie.sql` (à coller après NOE3) : la table
  `paiements_assurance_maladie_mouvements` du § 4, deux fonctions (`associer_paiements_assurance_maladie`, tout ou rien, le lot
  compris ; `defaire_association_assurance_maladie`), le cabinet seul ; la lecture du client « Banque » (NOE5-Q1). Écarts du
  § 4 : l'exercice validé fige l'association par l'année du CRÉDIT, pas de la journée comptable (la réponse de
  l'expert-comptable du 17/11/2026 : la recette est à la date du crédit ; NOE5-Q2) ; la règle G2 n'est tenue en base que dans un
  sens (une association ne prend pas un mouvement retenu par les ventes ; l'inverse reste à l'écran).
- **Restent** : NOE5b, l'écran (la fiche d'un crédit et la section NOEMIE : la proposition justifiée, « Associer », « Défaire »,
  le lot, les contrôles ; `candidatsDuMouvement` qui écarte un crédit associé) ; à NOE8, la table au plan de sauvegarde et son
  bloc dans `rls.sql`, avec le drapeau `ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES`.

## 12. NOE3 amendée avant son collage (19/11/2026, avec BOR3)

- **L'organisme complémentaire** (BOR-Q5 (B), BORQ5-Q1 (A) ; conception 59, § 13.4 et § 14.6) : `paiements_assurance_maladie`
  reçoit `organisme_complementaire`, un entier de 1 à 9 999 999 999, de la seule part complémentaire, nul quand le fichier ne le
  dit pas (« non dit ») ; il entre dans la forme d'un paiement (huit clés : la version 1 redéfinie, rien n'ayant été importé) et
  dans la clé TOTALE, donc dans le conflit et « rien de neuf ». L'export CSV lu aujourd'hui ne le nomme pas : `lireLesPaiements`
  l'envoie nul ; un réglage de colonne s'ajoutera quand un état qui le nomme sera montré.
- **L'état des paiements de Télévitale** (la recherche du 19/11/2026 : des lignes sans facture — les aides, les régularisations
  — et des montants négatifs — les indus) : la table les admettait déjà, sans texte. Une somme positive versée sans facture est un
  `forfait`, sous son organisme ; une somme négative est une régularisation de sa part (`regularisations_centimes`), seule (le net
  égal aux régularisations, aucune facture) ou déduite des factures payées le même jour ; le net peut être négatif, le brut jamais.
  Une somme positive sans facture sur la part obligatoire, ou un indu écrit sans régularisation, se refusent : le lecteur de
  l'état, quand il s'écrira, les rangera ainsi. L'essai le prouve (étapes 60 à 72).
- **NOE5 tient** : sa garde de tête relit les corps de `garder_paiements_assurance_maladie` et de
  `retirer_import_assurance_maladie`, que l'amendement ne touche pas ; ses deux essais passent tels quels. Son module ne forme plus
  de paire quand deux parts complémentaires nommées partagent une journée et une caisse (à égalité, rien de proposé). La section
  P7 de `rls.sql` prend désormais sa table (sans elle, NOE5 appliquée mettait 3bis+ en faute).

## 13. Le 27/11/2026 : le rangement de l'état des paiements, NOE7 et NOE8

- **Le lecteur du PDF des paiements, première partie** (`src/lib/etatDesPaiementsAssuranceMaladie.ts`, pur, sans appelant) : ce
  qu'un gabarit lira d'un état « Paiement Noemie par journée comptable » — la journée, l'organisme payeur (une caisse sous un régime
  de la liste fermée, ou une complémentaire sous son numéro ou « non dit »), le total imprimé, les lignes (part, facture ou non,
  montant signé) — se range aux huit clés de l'import selon le § 12 : le total d'une facture paie sa part ; une somme négative est
  une régularisation de sa part ; une aide, un `forfait`. Un versement sans facture d'une complémentaire, que la base ne range pas,
  écarte son état. Tout doute écarte l'état ENTIER sous son rang et sa raison ; un total imprimé que les lignes ne font pas, aussi ;
  sans total, l'état se compte à part pour que l'écran dise que rien ne confirme la lecture. Les rejets sont « non dits ».
- **Reste du lecteur** : le gabarit de la page (ses ancres, ses colonnes, la forme imprimée de l'organisme et des montants), qui
  attend une page rendue anonyme (BOR6-Q2 (A)), puis l'écran (un PDF à côté du CSV dans la section de NOE4) et le refus de l'état
  au dépôt (NOE7).
- **NOE7** reste en attente de la forme : ni les en-têtes de l'export CSV (NOE1) ni la page de l'état ne sont connus ; la question
  NOE7-Q1 demande s'il faut attendre ou reconnaître, dès aujourd'hui, un fichier par les numéros d'assuré qu'il porte.
- **NOE8** : la migration, les drapeaux et les trois contrôles sont faits (20/11/2026) ; restent les essais
  `paiementsAssuranceMaladie.sql`, `associationPaiementsAssuranceMaladie.sql`, `facturesAssuranceMaladie.sql` et les blocs AM, FM et
  P7 de `rls.sql` rejoués en production, et un premier import réel.

## 14. Le 27/11/2026 : la période d'un import sur ses seuls paiements insérés (NOE4R-Q1) et le remplacement d'une journée (NOE4R-Q2)

Deux réponses du cabinet du 27/11/2026 à la relecture adverse du même jour (« la période et les rejets d'un import couvrent les
paiements passés » ; « une journée exportée incomplète ne se complète qu'en retirant tout l'import qui la porte »). Deux migrations
préparées, à coller dans cet ordre ; le récit : HISTORIQUE.md, « 27/11/2026 — NOE4R-Q1 ET NOE4R-Q2 ».

### 14.1 NOE4R-Q1 (A) : la période d'un import, celle de ses seuls paiements insérés

- **La règle.** `importer_paiements_assurance_maladie` écrit `periode_du` et `periode_au` sur les seuls paiements qu'elle INSÈRE —
  ceux qu'aucun paiement en base ne porte sous leur clé — et non plus sur tout le fichier : un fichier qui en recouvre un autre ne
  dit plus une période plus large que ce qu'il apporte, et la confirmation de son retrait ne nomme plus des journées qui ne partent
  pas avec lui. **Les rejets restent ceux du fichier** (le nombre et le montant qu'il dit) : un rejet ne porte aucune clé que la base
  saurait passer. L'écran le dit : « rejets du fichier : … », et, quand des journées du fichier sont déjà en base, « les rejets
  comptés restent ceux du fichier entier, ces journées comprises » (`rejetsDuFichierDits`, `confirmationDeLImport`) ; la colonne de
  la liste s'intitule « Rejets du fichier ».
- **Un import qui n'insère rien se refuse, comme hier** (« rien de neuf », 22023), plutôt que de s'écrire sans période. Retenu parce
  qu'il n'apporte aucun paiement à justifier ni à contrôler (NOE5, NOE6 ne lisent que des paiements) ; que ses rejets sont ceux d'un
  fichier dont chaque paiement est déjà en base, donc déjà comptés par l'import qui les a apportés — rien ne les rattache à une clé,
  et les écrire les compterait deux fois ; qu'une période nulle romprait le contrat de la table (`not null`, sa contrainte) et chaque
  lecteur (la liste, NOE6, BOR5). Écarté : l'import « sans période », pour garder des rejets — il double les rejets et change la table.
- **Ce que ça change aux lecteurs.** NOE6 (`creditsSansPaiement` contre `creditsHorsDesImports`) et BOR5 (l'étendue du payé) lisent la
  réunion des périodes. Elle ne rétrécit que dans un cas : entre une journée du fichier déjà en base et la plus proche des journées
  insérées, sans paiement d'aucun import ; un crédit tombé là se dit « hors des imports » (importer ce qui le couvre) au lieu de « sans
  paiement ». La base ne connaît pas l'étendue de l'export, seulement les journées de ses paiements : la nouvelle période dit ce qui
  est su.
- **Les imports d'avant** gardent la période qu'ils ont reçue (la garde de NOE3 refuse toute réécriture) ; aucun import réel n'est fait
  au 27/11/2026. Avant le collage, une lecture les compte — un nombre, rien d'autre :
  `select count(*) from imports_assurance_maladie i where i.periode_du is distinct from (select min(p.date_journee_comptable) from
  paiements_assurance_maladie p where p.import_id = i.id) or i.periode_au is distinct from (select max(p.date_journee_comptable) from
  paiements_assurance_maladie p where p.import_id = i.id)` ; non nul, chacun se retire et se refait sous la règle nouvelle.
- **La base et le module.** Un `create or replace` du corps, sa garde de tête vérifiant l'empreinte d'hier (`62b9f0f6…`,
  `remplacementsDesPreparees.test.ts`) ; même signature, mêmes droits, mêmes refus sous les mêmes mots. Le module :
  `paiementsInseres`, `periodeDeLImport` (`lib/paiementsAssuranceMaladie.ts`), confrontés au texte de la migration par
  `paiementsAssuranceMaladie.test.ts` (le corps est celui d'hier, à l'octet, son filtre et son commentaire ôtés). Aucun drapeau :
  l'écran ne dit rien que la règle de la base décide (la confirmation nomme les journées de ce qui part, vraies sous l'une comme
  sous l'autre). L'essai : `periodeDesImportsAssuranceMaladie.sql` ; les étapes 24 et 72 de `paiementsAssuranceMaladie.sql` suivent
  la règle que la base porte.

### 14.2 NOE4R-Q2 (B, contre la recommandation) : remplacer une journée comptable non associée

- **Ce qui est remplacé : la journée TELLE QUE L'EXPORT LA PORTE.** Pour chaque journée comptable du fichier où un paiement diffère de
  la base (même clé — journée, régime, caisse, part, organisme complémentaire —, d'autres chiffres — net, régularisations, factures) :
  le paiement qui diffère REMPLACE celui de la base ; un paiement d'une clé neuve ENTRE ; un paiement égal est PASSÉ ; un paiement en
  base que le fichier ne porte pas RESTE. Retenu, plutôt que de remplacer la journée entière : un fichier lu sur une seule part (le
  réglage de l'écran), ou un export sans les forfaits qu'un état des paiements a portés, ne dit pas que les autres paiements sont
  partis — les retirer serait perdre en silence (NOE4RQ2-Q2).
- **Jamais en silence.** Sous `REMPLACEMENT_DES_JOURNEES_PREVU` (baissé), là où un conflit refuse l'import, l'aperçu nomme chaque
  journée, son total en base et son total après, et ce qui change (« 1 paiement remplacé, 1 ajouté, 1 gardé ») ; « Remplacer … et
  importer » ; une confirmation qui nomme les journées et ce que le geste ne défera pas ; puis l'appel. L'import seul refuse toujours
  le conflit sous ses mots d'hier : le remplacement est un autre geste, nommé, confirmé.
- **La version, par journée.** L'écran envoie les identifiants de TOUS les paiements en base des journées qu'il a nommées (et non des
  seuls remplacés) : un import, un retrait ou un autre remplacement entre la lecture et le clic change cette liste, et la base refuse
  (« les journées à remplacer ont changé depuis leur lecture ») — les totaux que la confirmation a nommés sont ceux que le geste
  produit (CLAUDE.md : une saisie retient la version qu'elle remplace).
- **Jamais une journée associée.** Une journée dont UN paiement est associé à un crédit du relevé (NOE5) ne se remplace pas, même
  si le paiement associé n'est pas celui qui diffère : le cabinet défait d'abord l'association (il est seul à le faire), remplace, puis
  associe de nouveau sur les nouveaux chiffres ; l'écran le dit avant le clic, au praticien « ton cabinet doit d'abord défaire cette
  association ». Une association d'une AUTRE journée ne retient rien.
- **La trace.** `remplacements_assurance_maladie` : une ligne par paiement remplacé — son dossier, sa clé, ses chiffres d'avant et
  ceux qui les remplacent, l'import qui l'avait apporté et celui qui le remplace, qui et quand (posés par la base). Des dates, des
  entiers, la part (la liste fermée de NOE3) : aucune colonne de texte, aucune donnée de patient. Les deux imports sont nommés SANS
  clé étrangère : la trace survit au retrait de l'un comme de l'autre. Elle ne se modifie jamais et ne part qu'avec son dossier (sa
  garde, aux droits de l'appelant). Au plan de sauvegarde derrière le drapeau ; l'écran la montre (« Les journées remplacées »).
- **Qui possède quoi.** Les paiements qui remplacent, et ceux qui entrent, sont au NOUVEL import (sa période : NOE4R-Q1) ; ceux qui
  sont remplacés quittent l'ancien, qui garde sa période et ses rejets d'alors (un import dont tout a été remplacé reste, vide, et se
  retire). **Retirer le nouvel import ne rend pas les paiements remplacés** : leurs chiffres restent dans la trace, et l'ancien fichier
  se réimporte ; la confirmation du retrait le dit (NOE4RQ2-Q4).
- **Tout ou rien.** `remplacer_journees_assurance_maladie(dossier, import, paiements_lus)`, aux droits du propriétaire, sous le verrou
  des paiements du dossier, pour qui importe — le cabinet du dossier et l'accès « Banque » (NOE4RQ2-Q3) : refus dans l'ordre — l'appelant
  (42501), la forme de l'import (les mots de NOE3), celle des paiements lus, un exercice validé (les mots de l'import), rien à remplacer,
  la version changée, une journée associée nommée (22023) ; puis les paiements qui diffèrent, relus pour la trace, retirés import par
  import sous le réglage de la garde de NOE3 ; l'import par `importer_paiements_assurance_maladie` elle-même ; la trace. Une seule
  transaction : un refus, à toute étape, ne laisse rien.
- **La lecture du client.** Le client « Banque » lit la trace de son dossier, comme les imports et les paiements qu'elle relie —
  CETTE LECTURE SE PRÉSENTE AU CABINET AVANT D'ÊTRE APPLIQUÉE (NOE4RQ2-Q1) ; rls.sql la juge (bloc RJ, section P7).
- **Ce qui reste fermé.** Aucun moteur ne lit la trace (`paiementsAssuranceMaladieSansSortie.test.ts` la range avec les paiements) ;
  ni la 2035, ni la CA3, ni le FEC, ni NOE6 ne changent : ils lisent les paiements, qui sont les nouveaux.

### 14.3 L'ordre, les retours, les questions

- **Collage** : `periode_des_imports_assurance_maladie` (par l'outil : aucun mot de retrait), puis
  `remplacement_des_journees_assurance_maladie` (à coller : le retrait des paiements remplacés est un `delete` dans le corps de sa
  fonction ; sa garde de tête exige le corps de la première). Puis `REMPLACEMENT_DES_JOURNEES_PREVU` levé, les deux fichiers rangés
  dans l'export, les essais et `rls.sql` rejoués en production, les trois contrôles.
- **Retours**, à rebours : celui du remplacement (à coller ; il se refuse tant que la trace porte une ligne), puis celui de la période
  (par l'outil ; il se refuse tant que le remplacement est en base).
- **Questions** : NOE4RQ2-Q1 (la lecture de la trace par le client « Banque »), NOE4RQ2-Q2 (les paiements de la journée que le
  nouvel export ne porte pas : gardés), NOE4RQ2-Q3 (qui remplace : le cabinet et le praticien), NOE4RQ2-Q4 (le retrait du nouvel
  import ne rend pas les paiements remplacés) ; leurs fiches sont dans la page « Arbitrages du cabinet ».
