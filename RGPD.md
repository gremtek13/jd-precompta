# RGPD — registre des traitements, sous-traitants, conservation

État au 19 septembre 2026. Les chiffres viennent de la base, pas d'une estimation ; les régions et
les flux, du code des Edge Functions. Ce qui reste à décider est nommé comme tel, à la fin.

---

## 1. Qui est responsable de quoi

La distinction commande tout le reste, et elle est double parce que l'application est
multi-cabinets dès l'origine.

- **Chaque cabinet est responsable de traitement** pour les dossiers de ses clients. C'est lui qui
  décide pourquoi et comment les données sont traitées : quelles pièces collecter, quelles
  catégories, quand clôturer.
- **L'éditeur de la plateforme est sous-traitant** au sens de l'article 28 : il héberge et fait
  fonctionner l'outil, sans finalité propre sur les données des cabinets.

Aujourd'hui JD Consult est les deux à la fois — le seul cabinet en production est le sien. C'est
confortable et trompeur : **le jour où un second cabinet arrive, il faudra un contrat de
sous-traitance entre lui et l'éditeur**, et l'éditeur ne pourra plus regarder les données d'un
dossier sans mandat. Le super-admin, qui voit tout par construction (`is_super_admin()` figure dans
le OR de chaque fonction d'accès), devient à ce moment-là un pouvoir à encadrer par écrit, pas
seulement par le code.

Un troisième acteur existe et n'est utilisateur de rien : **le patient**. Son nom, sa date de
naissance et parfois son NIR figurent sur les bordereaux de télétransmission que le praticien
dépose. Il n'a aucun compte, aucun écran, aucun moyen de savoir que ses données sont là. Voir §6.

---

## 2. Registre des traitements

| Traitement | Finalité | Base légale | Personnes concernées | Données |
|---|---|---|---|---|
| **Tenue de la pré-comptabilité** | Produire la comptabilité et les déclarations d'un client | Obligation légale du client (Code de commerce L123-12 et s., CGI) + exécution du contrat de mission | Client, ses fournisseurs, ses clients | Identité, SIRET, adresse, montants, mouvements bancaires |
| **Collecte des justificatifs** | Rassembler les pièces (dépôt, e-mail, Super PDP) | Exécution du contrat de mission | Client, tiers figurant sur les pièces, **patients** sur les bordereaux | Fichiers, empreintes SHA-256, horodatages |
| **Extraction automatique (OCR)** | Lire tiers, date et montants pour éviter la ressaisie | Intérêt légitime du cabinet (réduction de la saisie) | Idem collecte | Texte intégral du document (`piece_textes_ocr`) |
| **Assistant comptable** | Répondre à des questions sur un dossier, en lecture seule | Intérêt légitime du cabinet | Client | Question, réponse, comptage de tokens |
| **Facturation et relances** | Émettre et transmettre les factures d'honoraires | Exécution du contrat + obligation légale (facturation) | Client | Identité, adresse, e-mail, montants |
| **Facturation électronique** | Émettre et recevoir des factures au format réglementaire | Obligation légale (réforme de la facturation électronique) | Client et ses tiers | Facture complète, identité émetteur/destinataire |
| **Gestion des accès** | Ouvrir et fermer les comptes cabinet et client | Exécution du contrat | Membres du cabinet, clients | E-mail, identifiant, rôle |
| **Journalisation** | Savoir qui a reçu quoi et quand (envois d'e-mails, événements Super PDP) | Intérêt légitime (preuve et diagnostic) | Client | Destinataire, objet, horodatage, statut |

**Aucune décision automatisée au sens de l'article 22.** C'est une propriété du produit, pas un
hasard : l'application signale et propose, elle ne tranche jamais — une pièce importée arrive
toujours « à valider », et la catégorie reste un arbitrage humain.

---

## 3. Sous-traitants et transferts

| Sous-traitant | Rôle | Région vérifiée | Transfert hors UE |
|---|---|---|---|
| **Supabase** | Base, stockage des fichiers, authentification | `eu-west-1` (Irlande) | Non |
| **AWS Textract** | OCR des pièces déposées | `eu-central-1` (Francfort), repli du code **gardé par un test** | Non, **sauf si le secret `AWS_REGION` dit autre chose — §8.1** |
| **AWS Bedrock** | Assistant comptable (Claude) | `eu-west-1` (Irlande), **gardé par un test** | Non |
| **Super PDP** | Plateforme de dématérialisation agréée DGFiP | France | Non |
| **Resend** | Envoi et réception d'e-mails | **À établir — voir §8.2** | **À établir** |
| **GitHub Pages** | Hébergement du front (fichiers statiques) | — | Aucune donnée de dossier n'y transite |
| **API SIRENE** | Code NAF depuis un SIRET | France (service public) | Non |

Deux précisions qui comptent :

- **GitHub Pages ne reçoit aucune donnée de dossier.** L'application est une SPA qui parle
  directement à Supabase depuis le navigateur ; GitHub ne sert que des fichiers statiques. Il voit
  en revanche les adresses IP des visiteurs, comme tout hébergeur.
- **L'API SIRENE ne reçoit qu'un SIRET**, et seulement sur clic explicite. Aucun appel réseau
  externe n'est silencieux dans cette application — c'est une règle du projet, pas une constatation.

---

## 4. Ce que la base contient réellement

Mesuré le 19/09/2026, en comptant sans jamais extraire :

- **2 comptes** utilisateurs, **4 dossiers**, **1 cabinet**.
- **148 fichiers** dans le stockage, **23 Mo** — répartis en trois seaux : `pieces` (privé),
  `packs` (privé), `cabinet-logos` (public, logos seulement).
- **41 textes OCR** conservés, sur 108 fichiers déposés : les 67 documents antérieurs au 18/09/2026
  n'en ont pas.
- Dans ces 41 textes : **0 numéro de sécurité sociale apparent**, **0 date de naissance**,
  **1 bordereau de télétransmission**, 4 textes employant un vocabulaire de patient.
- **0 commentaire** de pièce, **0 e-mail journalisé**, **2 messages** d'assistant.

**Ce que ces chiffres disent, et c'est la conclusion utile : les données de patients sont dans les
FICHIERS, pas dans la base.** Un bordereau déposé porte des noms et des numéros ; sa ligne en base
ne porte qu'un chemin, un montant et une date. Le seul endroit où le contenu d'un document entre en
base est `piece_textes_ocr`, et il n'y en a aujourd'hui qu'un seul de cette famille.

Conséquence pratique : l'effort de protection porte d'abord sur le **stockage** (policies
`storage.objects`, URLs signées, exports), pas sur les tables.

---

## 5. Durées de conservation

### Ce que la loi impose de garder

| Donnée | Durée | Fondement |
|---|---|---|
| Pièces justificatives et livres comptables | **10 ans** à compter de la clôture | Code de commerce, art. L123-22 |
| Factures émises | **10 ans** | Idem |
| Pièces à l'appui d'une déclaration fiscale | **6 ans** | LPF, art. L102 B |

C'est le plus long qui commande : **10 ans**. Rien dans l'application ne peut être purgé avant,
et un contrôle qui proposerait de le faire serait une faute.

### Ce qui n'a AUCUNE durée légale propre, et c'est le levier

**Le texte OCR (`piece_textes_ocr`) est une copie dérivée.** Il sert à classer le document, à
retrouver une date et à aider l'arbitrage — aucune obligation comptable ne porte sur lui : c'est le
fichier d'origine qui fait foi devant un contrôle. Le supprimer ne retire rien à la comptabilité.

Or c'est précisément le seul endroit où le contenu d'un bordereau — donc des données de patients —
entre en base sous forme exploitable et interrogeable.

**D'où la mesure de minimisation qui se présente d'elle-même : purger le texte OCR des pièces
validées depuis un certain temps.** Une fois la pièce arbitrée, catégorisée et rapprochée, le texte
a fait son travail. Le combien de temps est une décision du cabinet (§8.3), pas une constante que
l'application devrait choisir seule.

### État aujourd'hui

- Pièce la plus ancienne : **31/12/2022**. Premier dépôt dans l'application : **26/08/2026**.
- **0 pièce** et **0 document** ont dépassé l'obligation de 10 ans. La première purge légalement
  possible n'aura pas lieu avant 2033.
- Il n'existe **aucun mécanisme de purge** dans l'application. Ce n'est pas urgent au sens des
  durées, et ça l'est au sens de la minimisation (le texte OCR, ci-dessus).

---

## 6. Droits des personnes

Pour le **client du cabinet**, les droits s'exercent auprès de son cabinet, et l'application les
sert déjà en pratique : il voit ses pièces et ses informations dans son espace, la sauvegarde d'un
dossier constitue une portabilité complète (JSON lisible tel quel), l'export de pack rassemble ses
fichiers, et la suppression d'un dossier efface en cascade tout ce qui s'y rattache, fichiers
compris.

Pour le **patient**, non. Et il faut le dire plutôt que de le contourner :

- il ne sait pas que son nom figure dans l'outil comptable de son praticien ;
- il ne peut pas s'adresser au cabinet, qui ne le connaît pas comme personne mais comme une ligne
  d'un bordereau ;
- aucune recherche de l'application ne permet aujourd'hui de retrouver « toutes les pièces où
  figure Monsieur X » — l'application n'indexe pas les patients, et c'est heureux.

La position défendable, et celle qui correspond à la réalité : **le praticien reste responsable de
traitement pour les données de ses patients**, le cabinet comptable les traite pour son compte au
titre de la mission, et la minimisation (§5) est la vraie réponse — moins ces données entrent, moins
la question se pose.

---

## 7. Mesures de sécurité

Ce qui est **prouvé**, pas seulement affirmé :

- **RLS sur l'intégralité du schéma**, avec une convention unique (`admin_du_dossier`) et trois
  tables volontairement fermées à tout accès client (`super_admins`, `superpdp_credentials`,
  `facture_numerotation`).
- **Isolation des fichiers entre cabinets**, corrigée après audit : les policies du stockage
  vérifient le dossier propriétaire et non plus « est admin d'un cabinet quelconque »
  (migration `storage_pieces_packs_isolation_cabinet`).
- **Inférence IA en Europe** : Bedrock `eu-west-1`, choix explicite et commenté dans le code.
- **Secrets hors du bundle client** : clés Resend et Bedrock en secrets de fonctions,
  identifiants Super PDP dans une table sans aucune policy, atteinte uniquement par la clé de
  service.
- **Une restauration éprouvée** contre Postgres, avec son plan de reprise (`PLAN_DE_REPRISE.md`).

Ce qui est **affirmé sans être rejoué** — et c'est la limite à connaître :

- Les policies RLS sont vérifiées **par impersonation réelle au cas par cas**, à leur création.
  Rien ne les rejoue après une migration. C'est le chantier 23 de la feuille de route, et c'est la
  faiblesse la plus sérieuse de cette section : une migration peut défaire une policy sans que rien
  ne le signale.
- **Le plan Supabase est `free`** : aucune sauvegarde automatique côté hébergeur, et le contrôle
  des mots de passe contre les fuites connues est réservé au plan Pro. Voir PLAN_DE_REPRISE.md §1.

---

## 8. Ce qui reste à décider ou à faire

### 8.1 — Lire le secret `AWS_REGION` *(à faire, une minute)*

Le contenu INTÉGRAL de chaque document déposé part chez AWS pour être lu, bordereaux compris. La
région décide si c'est un traitement en Europe ou un transfert hors UE.

**La moitié que le code gouverne est désormais gardée** : `edgeFunctionsRegions.test.ts` lit la
vraie source déployée et refuse toute région hors UE, pour Textract comme pour Bedrock — et vérifie
au passage que les deux clients Textract d'`extract-piece` partagent la même région, sans quoi une
partie des documents partirait ailleurs pendant que le registre annoncerait une seule région.

**La moitié qu'il ne gouverne pas reste à vérifier à la main** : si le secret `AWS_REGION` est
défini côté Supabase, il l'emporte sur le repli du code, et aucun fichier de ce dépôt ne peut le
savoir. À lire dans Supabase → Edge Functions → Secrets, et à confirmer ici. S'il n'est pas défini,
le repli `eu-central-1` s'applique et ce point est clos.

### 8.2 — Établir le statut de Resend *(à faire)*

Les e-mails sortants (factures, relances) et surtout les **pièces jointes entrantes** transitent par
Resend. Trois points à établir avec eux : où les données sont traitées, ce que dit leur accord de
sous-traitance, et combien de temps ils conservent les messages. Tant que ce n'est pas écrit, la
case « transfert hors UE » du §3 reste ouverte.

### 8.3 — Trancher la durée de conservation du texte OCR *(décision du cabinet)*

Combien de temps garder `piece_textes_ocr` après validation d'une pièce ? C'est le seul levier de
minimisation réellement disponible aujourd'hui, et il ne coûte rien à la comptabilité. Trois
options : le garder indéfiniment (état actuel), le purger après la clôture de l'exercice, ou le
purger après validation de la pièce. **L'application ne doit pas choisir à la place du cabinet.**

### 8.4 — Contrats de sous-traitance *(à faire avant le second cabinet)*

Aucun contrat n'existe aujourd'hui, et c'est cohérent : JD Consult est à la fois le cabinet et
l'éditeur. Le jour où un cabinet tiers arrive, il faut un contrat de sous-traitance éditeur/cabinet
et la liste des sous-traitants ultérieurs (§3) annexée.

### 8.5 — Rejouer les policies RLS après chaque migration *(chantier 23)*

Le patron existe déjà : `supabase/essais/restauration.sql` prouve une restauration contre les vraies
contraintes. Le même procédé appliqué à l'impersonation ferait de la section 7 une section
**démontrée** au lieu d'une section affirmée.
