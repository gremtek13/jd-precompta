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
naissance et parfois son NIR figurent sur les bordereaux de télétransmission du praticien — et
**ces bordereaux n'ont pas à être transmis au cabinet** : ils relèvent du secret médical, et c'est
le relevé SNIR, sans identité de patient, qui justifie les recettes auprès de l'expert-comptable
(règle rappelée par le cabinet le 24/09/2026). Le patient n'entre donc dans l'application que si un
bordereau y est déposé par erreur. Il n'a alors aucun compte, aucun écran, aucun moyen de savoir que
ses données sont là. Voir §6 et §8.7.

---

## 2. Registre des traitements

| Traitement | Finalité | Base légale | Personnes concernées | Données |
|---|---|---|---|---|
| **Tenue de la pré-comptabilité** | Produire la comptabilité et les déclarations d'un client | Obligation légale du client (Code de commerce L123-12 et s., CGI) + exécution du contrat de mission | Client, ses fournisseurs, ses clients | Identité, SIRET, adresse, montants, mouvements bancaires |
| **Collecte des justificatifs** | Rassembler les pièces (dépôt, e-mail, Super PDP) | Exécution du contrat de mission | Client, tiers figurant sur les pièces — des **patients** seulement si un bordereau est déposé par erreur (§8.7) | Fichiers, empreintes SHA-256, horodatages |
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
| **AWS Textract** | OCR des pièces déposées | `eu-central-1` (Francfort), repli du code **gardé par un test**, secret **mesuré** le 21/09/2026 (§8.1) | Non |
| **AWS Bedrock** | Assistant comptable (Claude), citation des champs d'une pièce lue, et proposition de sa catégorie — cette dernière seulement MESURÉE (25/09/2026, données fictives), pas encore une fonctionnalité | `eu-west-1` (Irlande) pour l'assistant, écrit dans son code ; `eu-central-1` (Francfort) pour la citation et la catégorie, même secret que Textract — **gardés par un test** | Non |
| **Super PDP** | Plateforme de dématérialisation agréée DGFiP | France | Non |
| **Resend** | Envoi et réception d'e-mails | `eu-west-1` (Irlande), confirmé par le cabinet le 22/09/2026 | Non, **sous réserve du DPA — voir §8.2** |
| **GitHub Pages** | Hébergement du front (fichiers statiques) | — | Aucune donnée de dossier n'y transite |
| **API SIRENE** | Code NAF depuis un SIRET | France (service public) | Non |

Deux précisions qui comptent :

- **GitHub Pages ne reçoit aucune donnée de dossier.** L'application est une SPA qui parle
  directement à Supabase depuis le navigateur ; GitHub ne sert que des fichiers statiques. Il voit
  en revanche les adresses IP des visiteurs, comme tout hébergeur.
- **L'API SIRENE ne reçoit qu'un SIRET**, et seulement sur clic explicite. Aucun appel réseau
  externe n'est silencieux dans cette application — c'est une règle du projet, pas une constatation.
- **Les polices ne partent plus chez Google** (25/09/2026). Jusque-là, `index.html` et la charte
  d'un cabinet les demandaient à Google Fonts à chaque ouverture : l'adresse IP de chaque
  utilisateur, clients compris, partait chez un destinataire absent de ce tableau, et la phrase
  ci-dessus était fausse sur ce point. Elles sont désormais servies par l'application elle-même
  (paquets @fontsource, licence OFL), et `src/lib/polices.test.ts` refuse toute adresse de Google
  Fonts dans ce que le navigateur reçoit.

---

## 4. Ce que la base contient réellement

> **Précision décisive, ajoutée le 19/09/2026 : la base ne contient aujourd'hui que des données
> FICTIVES.** Aucun patient réel, aucun praticien réel. Un seul dossier est vivant (`test`), les
> trois autres sont d'anciens bacs à sable.
>
> Ce que les chiffres ci-dessous décrivent est donc la **forme** de ce que l'application stocke —
> quel type de contenu entre en base, par quel chemin, et où il se loge — pas une exposition
> constatée. La conclusion du §4 (« les données de patients sont dans les FICHIERS, pas dans les
> tables ») reste valable comme propriété de l'ARCHITECTURE, et c'est bien ainsi qu'elle gouverne
> les §5 à §8.
>
> **Ce registre devra être remesuré au premier dossier réel**, et c'est à ce moment-là seulement
> qu'il décrira un traitement de données personnelles au sens du RGPD. D'ici là il documente une
> conception, ce qui est le bon moment pour le faire : la protection des données par conception
> (art. 25) se décide avant les données, pas après.

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
FICHIERS, pas dans la base.** Un bordereau déposé — par erreur, il n'a pas à l'être (§8.7) — porte
des noms et des numéros ; sa ligne en base
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

**La position qui correspond à la pratique, rappelée par le cabinet le 24/09/2026 : ces données
n'ont pas à entrer du tout.** Le praticien reste seul responsable des données de ses patients, et il
n'a pas le droit de transmettre ses bordereaux à son expert-comptable — c'est le relevé SNIR, qui
totalise les honoraires sans identifier personne, qui justifie les recettes. Le cabinet ne traite
donc aucune donnée de patient au titre de sa mission : un bordereau reçu est une erreur d'envoi, pas
un flux du traitement.

*Cette section disait auparavant que le cabinet traitait ces données « pour le compte » du
praticien.* C'est cette rédaction qui plaçait l'application dans le champ de l'hébergement de
données de santé (§8.7) : elle décrivait l'erreur d'envoi comme si c'était la règle. La
minimisation (§5) reste la réponse pour ce qui arrive malgré la consigne.

---

## 7. Mesures de sécurité

Ce qui est **prouvé**, pas seulement affirmé :

- **RLS sur l'intégralité du schéma**, avec une convention unique (`admin_du_dossier`) et trois
  tables volontairement fermées à tout accès client (`super_admins`, `superpdp_credentials`,
  `facture_numerotation`).
- **Isolation des fichiers entre cabinets**, corrigée après audit : les policies du stockage
  vérifient le dossier propriétaire et non plus « est admin d'un cabinet quelconque »
  (migration `storage_pieces_packs_isolation_cabinet`) — et **rejouée** depuis le 19/09/2026 par la
  section S de `supabase/essais/rls.sql`, qui est la seule partie de ce registre à porter sur les
  fichiers eux-mêmes plutôt que sur les lignes qui les décrivent. Mesuré : un anonyme et un
  authentifié rattaché à rien voient 0 des 146 fichiers privés ; le client en voit 61, exactement
  les siens, et aucun des 85 autres ; il ne peut pas déposer dans le dossier d'un tiers.
  Un contrôle POSITIF accompagne les autres — le client doit voir ses propres fichiers — sans quoi
  un bucket devenu illisible à tous passerait pour un succès.
- **Inférence IA en Europe** : Bedrock `eu-west-1`, choix explicite et commenté dans le code.
- **Secrets hors du bundle client** : clés Resend et Bedrock en secrets de fonctions,
  identifiants Super PDP dans une table sans aucune policy, atteinte uniquement par la clé de
  service.
- **Une restauration éprouvée** contre Postgres, avec son plan de reprise (`PLAN_DE_REPRISE.md`).
- **Les policies RLS rejouées en bloc**, par impersonation réelle des trois profils
  (`supabase/essais/rls.sql`) : 40 tables, 32 d'entre elles portant un `dossier_id`, plus cinq
  tentatives d'écriture. Dernier passage le 19/09/2026, 0 en faute. La boucle part de `pg_class` et
  non d'une liste tenue à la main, donc une table ajoutée demain sans policy est attrapée sans que
  personne ait eu à y penser.
  **Et le harnais est lui-même éprouvé** : sept mutations délibérées (contrôles rejoués sous le
  super-admin, liste d'exceptions retirée) doivent toutes virer au rouge, et elles le font. Sans
  cela, une impersonation qui échouerait silencieusement rendrait zéro partout et afficherait « 0 en
  faute » sur une base grande ouverte — la panne qui ressemble exactement au succès.

Ce qui est **affirmé sans être rejoué** — et c'est la limite à connaître :

- **Le plan Supabase est `free`** : aucune sauvegarde automatique côté hébergeur, et le contrôle
  des mots de passe contre les fuites connues est réservé au plan Pro. Voir PLAN_DE_REPRISE.md §1.
- **Les Edge Functions** restent vérifiées par relecture, advisors et essais manuels : aucun test ne
  les appelle en HTTP, avec leur authentification et leurs erreurs.
- **La SUPPRESSION d'un fichier n'est pas démontrée**, et c'est une limite nommée plutôt qu'un
  oubli — voir §8.6.

---

## 8. Ce qui reste à décider ou à faire

### 8.1 — Lire le secret `AWS_REGION` *(FAIT le 21/09/2026 — `eu-central-1`, donc UE)*

Le contenu INTÉGRAL de chaque document déposé part chez AWS pour être lu, bordereaux compris. La
région décide si c'est un traitement en Europe ou un transfert hors UE.

**La moitié que le code gouverne est désormais gardée** : `edgeFunctionsRegions.test.ts` lit la
vraie source déployée et refuse toute région hors UE, pour Textract comme pour Bedrock — et vérifie
au passage que les deux clients Textract d'`extract-piece` partagent la même région, sans quoi une
partie des documents partirait ailleurs pendant que le registre annoncerait une seule région.

**La moitié qu'il ne gouverne pas est désormais MESURÉE, et c'est mieux qu'une lecture de tableau
de bord** : le secret `AWS_REGION` l'emporte sur le repli du code, et aucun fichier de ce dépôt ne
peut dire sa valeur. Plutôt que d'aller la lire dans Supabase → Edge Functions → Secrets — une
vérification humaine qu'on oublie de refaire, et que rien ne rappelle le jour où le secret change —
`evaluer-extraction` résout le MÊME secret que la production et REND la région obtenue. Appelée avec
`limite: 0` elle ne parcourt aucune pièce, donc ne facture rien.

**Résultat, le 21/09/2026 : `eu-central-1` (Francfort).** C'est bien la région annoncée au §3 comme
repli du code, elle est dans l'Union, et ce point est clos. **Il se rouvre en un appel** le jour où
le secret change ou qu'on veut s'en assurer, sans accès au tableau de bord.

### 8.2 — Établir le statut de Resend *(partiellement fait — deux points restent)*

Les e-mails sortants (factures, relances) et surtout les **pièces jointes entrantes** transitent par
Resend. Trois points étaient à établir : où les données sont traitées, ce que dit leur accord de
sous-traitance, et combien de temps ils conservent les messages.

**La région est confirmée le 22/09/2026 (réponse du cabinet dans « Décisions en attente ») :
`eu-west-1`.** Ce n'est donc pas un transfert hors UE au sens du traitement géographique — la case
« transfert hors UE » du §3 se referme sur ce point précis.

**Ce qui reste ouvert, et ce n'est pas la même question** : le contenu de l'accord de
sous-traitance (DPA) avec Resend, et la durée pendant laquelle ils conservent les messages et leurs
pièces jointes une fois traités. Une région correcte ne dit rien de la durée de rétention côté
Resend ni des garanties contractuelles — les deux restent à obtenir directement auprès d'eux avant
de clore ce point.

### 8.3 — Durée de conservation du texte OCR *(tranchée le 22/09/2026, implémentée le même jour)*

Le cabinet a choisi l'option B — purger après clôture de l'exercice — restreinte aux pièces
sensibles (celles qui portent des données de patients) : « Comme ta préférence, le B, et que pour
les documents sensibles » (« Décisions en attente »).

**Ce que « sensible » veut dire ici** : les justificatifs de recette (bordereaux de
télétransmission), seule famille de pièces à porter des noms de patients — voir §4 et §6. Une
facture EDF n'a aucune raison d'être purgée, et ne l'est pas. **Depuis le 24/09/2026, ces
bordereaux n'ont plus vocation à entrer (§8.7)** : la purge reste en place comme défense en
profondeur, pour ceux qui arriveraient malgré la consigne.

**Le geste** : `ClotureTab` porte un bouton « Clôturer l'exercice » par exercice affiché. Il pose une
ligne dans `exercices_clotures` (date de la demande, pas un vrai calcul de résultat — ce reste un
brouillon, voir le bandeau de l'écran) puis supprime le texte OCR (`piece_textes_ocr`) des pièces
validées de cet exercice dont `type_piece = 'vente'`. **Les fichiers déposés ne sont pas touchés** —
seul le texte déjà lu, la copie dérivée sans durée légale propre (voir §4), disparaît. Rejouer le
bouton sur un exercice déjà clôturé rattrape les pièces sensibles validées depuis, sans reposer une
seconde ligne de clôture.

**Ce que ce geste n'est PAS** : une clôture comptable réelle. `exercices_clotures` ne porte qu'une
date, exactement ce qu'il faut pour décider si la purge a été demandée — rien de plus.

Voir `src/lib/clotureExercice.ts` (logique, testée par mutation) et la migration
`20260922071331_creation_exercices_clotures` (RLS vérifiée par impersonation réelle : anonyme et
utilisateur étranger au dossier refusés, admin du dossier autorisé en lecture/écriture/suppression).

### 8.4 — Contrats de sous-traitance *(à faire avant le second cabinet)*

Aucun contrat n'existe aujourd'hui, et c'est cohérent : JD Consult est à la fois le cabinet et
l'éditeur. Le jour où un cabinet tiers arrive, il faut un contrat de sous-traitance éditeur/cabinet
et la liste des sous-traitants ultérieurs (§3) annexée.

### 8.5 — Rejouer les policies RLS après chaque migration *(fait le 19/09/2026)*

`supabase/essais/rls.sql` le fait, et la section 7 est passée de « affirmée » à « démontrée ».

**Ce qu'il a trouvé à sa première exécution justifie à lui seul le chantier** : un visiteur
**anonyme** — non connecté, muni de la seule clé publique de l'application — lisait les 10 catégories
comptables et les 8 natures d'immobilisation du cabinet. Les deux policies disaient
`using (dossier_id is null or ...)` sans clause `to`, or une policy sans `to` s'applique au rôle
`public`, donc à `anon`. La branche « dossier_id is null » voulait dire « partagé par tout le
cabinet » ; elle disait en fait « lisible par tout Internet ». Corrigé par la migration
`categories_et_natures_reservees_aux_connectes`.

Aucune donnée personnelle n'était exposée, aucune donnée de dossier — la configuration comptable du
cabinet seulement. Ce qui compte ici n'est pas le contenu mais la **forme du défaut** : une porte
qui s'élargit toute seule, le jour où une ligne partagée porte autre chose. Et surtout : ces deux
policies avaient été relues, plusieurs fois, sans que personne ne voie la clause manquante. Il
fallait l'exécuter pour la voir.

**Reste à faire** : le rejouer après chaque migration qui touche une policy. Ce n'est pas automatisé
— le harnais vit dans `supabase/essais/`, qui se rejoue à la main par l'outil MCP, comme la
restauration. L'automatiser supposerait un accès à la base depuis la CI, que ce dépôt n'a pas.

### 8.6 — La suppression d'un fichier reste un essai manuel *(limite assumée)*

Le harnais couvre la lecture et le dépôt des fichiers. Il ne couvre **pas** la suppression, et la
raison mérite d'être écrite parce qu'elle piège :

Un trigger de la plateforme, `protect_objects_delete` (BEFORE DELETE → `storage.protect_delete`),
refuse toute suppression SQL directe sur `storage.objects` — *« Direct deletion from storage tables
is not allowed. Use the Storage API instead. »* Il refuse pour **tout le monde**, et il refuse avec
le SQLSTATE **42501**, celui-là même qu'utilise un refus de policy.

Un essai de suppression est donc indiscernable d'un refus RLS : il **passerait au vert avec une
policy grande ouverte**. C'est ce qui s'est produit — le contrôle avait d'abord été écrit comme les
autres et il était vert. C'est sa MUTATION qui l'a démasqué : rejoué sous le super-admin, à qui la
suppression est permise, il refusait de mordre. Un contrôle vert dont la mutation ne mord pas ne
prouve rien.

Ce qui est gardé à la place est plus faible et dit comme tel : le harnais lit le catalogue et vérifie
que `pieces_storage_delete` existe toujours et porte encore `admin_du_dossier`. Cela ne prouve pas
que Postgres l'applique — seulement qu'aucune migration ne l'a supprimée ni élargie.

**Pour le démontrer vraiment, il faut passer par l'API Storage**, qu'un script SQL ne peut pas
appeler : c'est un essai manuel, depuis un client authentifié. À faire une fois, et à refaire le jour
où les policies du stockage changent.

### 8.7 — Hébergement de données de santé (HDS) *(tranché le 24/09/2026 : non requis, sous condition)*

**La question** : l'article L.1111-8 du Code de la santé publique impose un hébergeur certifié HDS à
« toute personne qui héberge pour le compte de tiers des données de santé […] recueillies à
l'occasion d'activités de […] soins ». Supabase n'est pas certifié HDS. Tant que ce registre disait
que le cabinet traite les données des patients « pour le compte » du praticien (ancienne rédaction
du §6), l'application était dans le cas prévu par ce texte.

**La réponse du cabinet** : le praticien n'a pas le droit de transmettre ses bordereaux de
télétransmission à son expert-comptable, et n'en a pas besoin — le relevé SNIR justifie les recettes
sans identifier aucun patient. Aucune donnée de santé n'a donc vocation à entrer dans l'application,
et l'HDS n'est pas requis.

**La condition, écrite plutôt que sous-entendue** : c'est vrai tant qu'aucun bordereau n'entre, et
aujourd'hui **seule la consigne donnée aux clients le garantit, pas le code**. L'application accepte
toujours les bordereaux : `extract-piece` les reconnaît à leur titre, `orientationDe` les range en
Pièces comme recettes, la fiche pièce annonce à l'opérateur « un justificatif de RECETTE, pas une
dépense », et la purge du §8.3 a été construite autour d'eux. **Décision du cabinet, le 24/09/2026 :
ne rien changer au code.** Deux options avaient été proposées et écartées — refuser le bordereau à
l'arrivée (détectable à son titre, et même dans le navigateur avant tout envoi pour un PDF généré
par le logiciel de télétransmission), ou l'accepter en le signalant comme à supprimer.

**Ce qui rouvrirait la question** : un bordereau, ou tout autre document portant des patients,
constaté dans un dossier réel. Le remède serait alors l'une des deux options ci-dessus, pas un
changement d'hébergeur.

**Pour mémoire, si un hébergement HDS devenait un jour nécessaire** (recherché le 24/09/2026) :
411 hébergeurs certifiés en mai 2026, liste tenue par l'Agence du Numérique en Santé ; depuis le
16/05/2026 seuls comptent les certificats au référentiel v2, qui impose l'Espace économique européen
et la déclaration de toute exposition à une loi extraterritoriale comme le CLOUD Act. Clever Cloud
est le seul hébergeur vérifié à proposer du PostgreSQL managé dans sa région HDS ; Scaleway certifie
son stockage objet mais pas ses bases managées ; chaque offre impose un contrat HDS et un support
payant, de l'ordre de 200 à 300 € par mois avant la première ressource. AWS n'est certifié que pour
une liste de services et de régions : il faudrait y vérifier Textract.
