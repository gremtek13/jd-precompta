# Plan de reprise — jd-precompta

À lire le jour où quelque chose a disparu. Ce document dit ce qui existe pour repartir, ce qui
n'existe pas, dans quel ordre s'y prendre, et comment savoir qu'on a réussi.

Il est dans le dépôt Git, et pas dans Notion ni dans l'application, pour une raison simple : un plan
de reprise hébergé sur ce dont il faut se passer n'est pas un plan de reprise.

---

## 1. Le fait qui commande tout le reste

**Le projet Supabase est sur le plan `free`, et le plan `free` ne fournit AUCUNE sauvegarde
automatique.** Pas de sauvegarde quotidienne, pas de restauration à un instant donné (PITR) : ce sont
des fonctions du plan Pro. Vérifié le 18/09/2026 (`get_organization` sur `dloewvpmposfbvdwtqfz`).

Conséquence à ne pas contourner : **la sauvegarde produite par l'application est la seule qui
existe.** Elle n'est pas une ceinture en plus des bretelles de l'hébergeur ; il n'y a pas de
bretelles. Et elle ne se déclenche pas toute seule — quelqu'un clique, ou il n'y a rien.

Les deux façons d'en sortir, par ordre de coût croissant :

- Passer le projet en plan Pro, qui ajoute les sauvegardes quotidiennes côté hébergeur. C'est le seul
  moyen d'avoir une sauvegarde qui ne dépend de personne. (Le même passage débloquerait au passage
  `auth_leaked_password_protection`, aujourd'hui inaccessible — voir CLAUDE.md.)
- À défaut, tenir un rythme écrit : une sauvegarde par dossier après chaque séance de saisie, et au
  minimum une par mois. Sans rythme noté quelque part, l'intervalle réel est « depuis la dernière
  fois qu'on y a pensé ».

---

## 2. Ce qui est sauvegardé, et par quoi

Trois choses différentes, trois mécanismes différents. Aucun ne couvre les autres.

| Ce qu'il faut | Où c'est | Comment on le récupère |
|---|---|---|
| **Les lignes** (dossiers, pièces, mouvements, écritures, factures, catégories, rapprochements) | Base Postgres | Onglet **Informations** d'un dossier → « Télécharger la sauvegarde ». Un fichier JSON par dossier. |
| **Les fichiers** (justificatifs, documents, packs) | Supabase Storage — 3 seaux : `pieces` (privé), `packs` (privé), `cabinet-logos` (public). 148 fichiers, 23 Mo au 18/09/2026 | Export de pack (onglet Informations, « Exporter avant suppression ») ou export global d'un cabinet (écran super-admin). |
| **Le code** (application, Edge Functions, schéma des migrations) | Dépôt Git GitHub | `git clone`. |

**Une sauvegarde de lignes sans les fichiers rend un dossier où chaque pièce pointe un justificatif
absent. Un pack sans les lignes rend un tas de PDF sans comptabilité.** Il faut les deux, faits le
même jour.

### Le fichier de sauvegarde est une donnée sensible

Il contient, en clair :

- le `client_secret` OAuth Super PDP de chaque dossier concerné (table `superpdp_credentials`) ;
- le texte OCR intégral des pièces (`piece_textes_ocr`), qui sur les dossiers de santé porte des noms
  de patients, des dates de naissance et des numéros de sécurité sociale.

Il se range comme on rangerait un dossier papier de ces mêmes clients. Jamais dans un dépôt Git,
jamais en pièce jointe d'un courriel ordinaire, jamais sur un service de partage grand public.

---

## 3. Ce qui n'est PAS sauvegardé, et qu'il faudra refaire à la main

C'est la partie du plan qu'on découvre d'habitude en pleine reprise. Elle est ici pour qu'on la
découvre avant.

1. **Les comptes utilisateurs** (`auth.users` — 2 comptes au 18/09/2026). Ni lus, ni restaurés.
   Ce n'est pas un oubli : ils appartiennent à Supabase Auth, pas au schéma applicatif. Mais quatre
   colonnes du schéma les exigent en NOT NULL — `cabinet_admins.user_id`,
   `dossier_assignations.user_id`, `memberships.user_id`, `packs.generated_by` — et **aucune ne se
   contourne en écrivant NULL**. Il faut donc recréer les comptes AVEC LEURS IDENTIFIANTS D'ORIGINE
   (les UUID), sinon la restauration s'arrête sur les accès clients, les affectations d'équipe et
   l'historique des packs. Le manifeste de chaque sauvegarde liste les UUID attendus.
2. **La ligne du cabinet** (`cabinets`). Une sauvegarde est par dossier ; elle suppose son cabinet
   déjà présent. Le manifeste donne son identifiant, et la restauration refuse de commencer s'il
   manque.
3. **Les secrets de fonctions** — à reposer à la main dans les secrets du projet, et listés un par
   un au bas de cette section (« Les variables d'environnement, une par une »). Ce point tenait en
   une ligne jusqu'au 25/09/2026 — « `RESEND_API_KEY`, les identifiants Bedrock » — et en oubliait
   quatre, dont `AWS_TEXTRACT_BUCKET`, sans lequel aucun PDF ne se lit.
4. **Le domaine d'envoi et de réception** `precompta.jdarnis.fr` chez Resend (vérification DNS),
   **et le webhook de réception.** Celui-ci appelle `https://<projet>.supabase.co/functions/v1/receive-email`
   (un seul webhook, sur `email.received`, vérifié le 21/09/2026) : un projet recréé change cette
   adresse, il faut donc le repointer. Et le secret de signature appartient au WEBHOOK, pas au
   compte : un webhook recréé en porte un nouveau, à reposer dans `RESEND_WEBHOOK_SECRET` — sans quoi
   chaque e-mail entrant est refusé en 401 (« Signature invalide ») et les pièces envoyées par les
   clients n'arrivent plus dans l'application.
5. **Rien sur le schéma — cette ligne était la faiblesse principale de ce plan, elle est fermée.**
   Les 58 migrations du projet sont exportées dans `supabase/schema/`, une par fichier, telles que
   la base les a enregistrées, et vérifiées par empreinte agrégée. Elles restent un EXPORT : la
   source de vérité est la base, les migrations continuent de s'appliquer par l'outil MCP, et
   l'export peut donc dériver. `supabase/schema/README.md` donne la requête qui le vérifie en une
   ligne — à rejouer avant de compter dessus, et après toute nouvelle migration.

   **ET ELLE N'ÉTAIT FERMÉE QU'AUX DEUX TIERS, jusqu'au 22/09/2026.** Les migrations ne portent que
   **30 `create table` pour 41 tables** : douze tables ont été créées hors `apply_migration` et
   n'existaient donc dans aucun fichier — dont `lignes_bancaires`, la plus grosse table du projet,
   et `ecritures_brouillon`, le cœur comptable. Ce plan promettait un schéma reconstructible en
   s'appuyant sur une empreinte qui compare les FICHIERS aux MIGRATIONS, jamais les migrations au
   SCHÉMA. Le trou est comblé par `supabase/schema/socle/tables_sans_migration.sql` (instantané
   généré depuis `pg_catalog`, éprouvé par `supabase/essais/socle.py`), et gardé à chaque build par
   `src/lib/sauvegardeTables.test.ts`.
6. **Les réglages d'authentification** du tableau de bord Supabase (règles de mot de passe
   notamment) : aucun fichier de ce dépôt ne les porte. L'application n'envoie en revanche aucun lien
   par e-mail — les comptes sont créés avec leur mot de passe par `create-cabinet`,
   `create-team-member` et `create-client-access` —, donc l'URL du site et les adresses de
   redirection n'y jouent aucun rôle.
   **L'inscription publique est à FERMER** (Authentication → Sign In / Providers, « Allow new users
   to sign up ») : aucun écran ne s'en sert — les trois fonctions ci-dessus passent par
   `auth.admin.createUser`, que ce réglage n'affecte pas —, et un projet neuf la laisse ouverte, ce
   qui donne une vraie session à qui détient la clé publique et une adresse jetable. Rien ne se lit
   alors dans les données (la RLS exige un rattachement, voir `rls.sql`, invariant 2), et
   `extract-piece` exige elle aussi un compte rattaché ; mais c'est une porte que rien d'autre ne
   ferme. **Sur le projet actuel, elle était encore ouverte le 26/09/2026** (lu sur
   `/auth/v1/settings`, `disable_signup: false`) : ce point vaut aussi hors reprise.

### Les variables d'environnement, une par une

Tirées du CODE, et gardées par `src/lib/variablesEnvironnement.test.ts` : une variable lue par une
Edge Function ou par l'application web et absente d'ici fait échouer la suite, comme une ligne d'ici
que plus rien ne lit, ou une colonne « Lue par » qui ne dit plus vrai.

Ce que ce test ne peut PAS dire : quelles valeurs sont réellement posées dans le projet. Elles vivent
dans le tableau de bord (Edge Functions → Secrets), qu'aucun outil de ce dépôt ne lit. Les NOMS sont
gardés ; la présence des VALEURS se vérifie à la main, au moment de la reprise.

<!-- DÉBUT DE L'INVENTAIRE — tenu par src/lib/variablesEnvironnement.test.ts -->

**À poser à la main**, dans les secrets du projet :

| Variable | Lue par | Ce qu'il faut savoir |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | `agent-comptable`, `evaluer-extraction`, `extract-piece`, `proposer-categorie` | Identifiant de l'utilisateur IAM `jd-precompta-textract`. Les quatre fonctions partagent les MÊMES identifiants : sa policy doit donc autoriser Textract, S3 et Bedrock, ce dernier dans deux régions (celle de `AWS_REGION`, et `eu-west-1` pour l'assistant). La liste exacte des actions : `src/lib/edgeFunctionsIam.test.ts`. |
| `AWS_SECRET_ACCESS_KEY` | `agent-comptable`, `evaluer-extraction`, `extract-piece`, `proposer-categorie` | Le secret qui va avec. |
| `AWS_SESSION_TOKEN` | `agent-comptable` | À laisser vide. Il ne sert qu'à des identifiants temporaires, et seul l'assistant le transmet : avec de tels identifiants, l'assistant marcherait et la lecture des pièces échouerait. Ceux d'un utilisateur IAM sont permanents. |
| `AWS_REGION` | `evaluer-extraction`, `extract-piece`, `proposer-categorie` | Région de la lecture (Textract), de la citation des champs et de la proposition de catégorie (Bedrock) : `eu-central-1`, mesuré le 21/09/2026. Absente, le code retombe sur la même ; une région hors de l'UE serait un transfert (RGPD.md §8.1). L'assistant ne la lit pas : sa région est écrite dans son code. |
| `AWS_TEXTRACT_BUCKET` | `extract-piece` | Seau S3 où un PDF séjourne le temps de sa lecture, dans la région de `AWS_REGION`. Sans lui, les images se lisent et **aucun PDF** — c'est-à-dire la plupart des dépôts. |
| `RESEND_API_KEY` | `receive-email`, `send-email` | Clé d'API Resend. Absente, plus aucun e-mail ne part, et aucun n'est accepté à l'arrivée. |
| `RESEND_WEBHOOK_SECRET` | `receive-email` | Secret de signature du webhook de réception (`whsec_…`) — il change quand le webhook est recréé, voir le point 4. |

**Fournies par Supabase**, rien à poser : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

**Côté application web** : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Elles vivent dans
`.env.production`, suivi par Git — la clé publique n'est pas un secret, c'est la RLS qui protège. Le
build les ÉCRIT dans l'application : un projet recréé change les deux, et une application qui n'a pas
été reconstruite continue de parler à l'ancien (§4, étape 9).

<!-- FIN DE L'INVENTAIRE -->

La CI ne porte aucun secret : ni `deploy.yml` ni `tests.yml` n'en lit.

---

## 4. L'ordre de reprise

Chaque étape suppose la précédente. Les sauter, c'est buter sur une erreur de clé étrangère
incompréhensible trois étapes plus loin.

1. **Le projet Supabase** — recréer, région `eu-west-1` (RGPD). Les appels à AWS ne suivent pas
   cette région : elle est écrite dans le code de l'assistant et lue dans `AWS_REGION` pour le reste
   (inventaire du §3).
2. **Le schéma** — appliquer les 58 fichiers de `supabase/schema/` dans l'ordre de leur nom, un par
   un (`apply_migration`). Ils se suivent : plusieurs suppriment et recréent ce que les précédentes
   ont posé, les rejouer dans le désordre ne donne pas le même schéma. **Puis, et seulement
   ensuite**, jouer `supabase/schema/socle/tables_sans_migration.sql` en une fois : il porte les
   douze tables que les migrations ne créent pas, et il référence `dossiers`, `pieces` et
   `categories`, donc il vient après. Sans ces deux moitiés, rien d'autre n'est possible — et avec
   la première seule, on obtient un schéma qui a l'air complet et auquel il manque la banque et les
   écritures.
3. **Les comptes utilisateurs**, avec leurs UUID d'origine (§3.1).
4. **Le cabinet** — la ligne `cabinets`, et sa charte graphique.
5. **Les dossiers, un par un** — écran super-admin → « Restaurer une sauvegarde ». L'écran lit le
   fichier, vérifie son empreinte, montre ce qu'il contient, et refuse tout ce qu'il ne peut pas
   faire honnêtement : un fichier abîmé, un dossier déjà présent, un cabinet absent, un lien
   pointant une ligne manquante.
6. **Les fichiers** — reverser le contenu des packs dans le seau `pieces`, aux chemins que portent
   les lignes restaurées (`pieces.storage_path`).
7. **Les secrets, le domaine d'envoi et le webhook de réception** (§3.3, §3.4 et l'inventaire des
   variables en fin de §3).
8. **Les Edge Functions** — redéployer depuis `supabase/functions/` via l'outil MCP, chacune avec
   le `verify_jwt` que porte `supabase/config.toml`. L'outil met `true` quand on omet ce paramètre,
   et `receive-email` refuserait alors tous les e-mails entrants à la passerelle, sans un log.
9. **L'application web** — remplacer dans `.env.production` l'URL et la clé publique du nouveau
   projet, puis pousser sur `main` : c'est le build qui les écrit dans l'application (inventaire du
   §3). Tant que ce n'est pas fait, l'application en ligne parle à l'ancien projet — ou à rien.

---

## 5. Comment savoir qu'on a réussi

La restauration ne se croit pas sur parole : elle **relit** le dossier par le chemin d'export et le
compare à la sauvegarde (`verifierRestauration`). L'écran affiche le verdict. Un compteur d'écriture
ne mesurerait que ce que le code croit avoir fait.

Trois écarts sont signalés nommément :

- `ligne_absente` — une ligne de la sauvegarde n'est pas arrivée ;
- `ligne_en_trop` — la base en contient une que la sauvegarde n'avait pas (restauration rejouée, base
  pas vide) ;
- `lien_non_repose` — le cas que le compte de lignes ne peut PAS voir : toutes les factures sont là,
  et l'avoir ne désigne plus la facture qu'il annule.

Puis, dans l'application : ouvrir la Banque du dossier et vérifier que les mouvements rapprochés le
sont encore. C'est le contrôle humain le plus rentable, parce que le rapprochement est justement ce
qu'une restauration ratée défait sans bruit.

---

## 6. Éprouver le plan sans attendre le sinistre

Un plan de reprise jamais exécuté est une intention. Deux niveaux de répétition existent :

- **À chaque exécution de la suite de tests** : l'ordre des 40 tables, la carte des chemins d'accès,
  les liens perdus, la double passe et le refus d'une sauvegarde incomplète sont rejoués par
  `npm test` (voir `src/lib/sauvegarde.test.ts`, `sauvegardeDonnees.test.ts`,
  `sauvegardeFichier.test.ts`).
- **Contre Postgres, à la demande** : `supabase/essais/restauration.sql` fabrique un schéma jetable
  portant les VRAIES contraintes du projet, y restaure un dossier réel, compare le résultat à la
  source par empreinte de contenu, puis se supprime. Dernier passage le 18/09/2026 : 35 tables
  restaurées, 35 identiques, 0 écart.

Ce que ces deux répétitions ne couvrent pas, et qu'il faut donc éprouver à la main au moins une fois :
recréer des comptes utilisateurs avec leurs UUID d'origine, et reverser les fichiers dans le stockage.

---

## 7. Ce que ce plan ne promet pas

- **Aucun objectif de temps de reprise.** Rien n'est automatisé de bout en bout : c'est une suite de
  gestes manuels, et leur durée dépend de qui les fait.
- **Aucune garantie sur l'intervalle de perte.** Il vaut le temps écoulé depuis la dernière
  sauvegarde téléchargée, laquelle dépend d'un clic humain (§1).
- **Rien sur les policies RLS.** L'essai de restauration tourne en service role : il prouve que les
  données reviennent, pas qu'elles sont protégées une fois revenues. À vérifier séparément, par
  impersonation réelle, comme le veut la convention du projet.
