# CLAUDE.md — jd-precompta

Documentation durable du projet : son état et les règles qui le gouvernent, à tenir à jour au fil des évolutions.

**Ce fichier est rechargé en entier à chaque reprise de la mémoire de travail, des dizaines de fois par jour : chaque
ligne s'y paie autant de fois.** Il a été réduit deux fois à la demande du cabinet : le 08/10/2026 (863 000 caractères,
dont 81 % de récits de débogage, environ 475 000 tokens par reprise), puis le 18/10/2026 (228 000 caractères, 107 000
tokens par reprise). Les textes d'avant sont dans **HISTORIQUE.md**, que rien ne charge automatiquement — le second sous
l'entrée « CLAUDE.MD RÉDUIT UNE SECONDE FOIS : LE TEXTE D'AVANT ».

- Ici : l'état du projet et la règle, en quelques lignes. Le récit — comment un défaut a été trouvé et mesuré, ce que
  les mutations ont montré, les résultats négatifs à ne pas réenquêter — va dans HISTORIQUE.md (sous « Entrées
  postérieures au 08/10/2026 », daté) et dans la demande de fusion. Pas de compte de mutations, pas d'essai abandonné,
  pas de récit de session ici.
- Un renvoi `→ « … »` désigne un passage de HISTORIQUE.md : le chercher sans tenir compte de la casse, et le lire avant
  de toucher au domaine concerné. Un renvoi « voir CLAUDE.md » d'un commentaire ou d'un autre document vers un passage
  qui n'est plus ici se trouve dans HISTORIQUE.md, sous le même titre.

## Objectif et périmètre

Application de comptabilité pour cabinets comptables (multi-cabinets, multi-dossiers clients). Pour chaque dossier (=
client), le cabinet collecte les pièces, tient la comptabilité (rapprochement bancaire, écritures, validation des
exercices), prépare les déclarations (2035, CA3, volet social), suit les cotisations sociales, facture, et reçoit ou
transmet des factures électroniques (plateforme agréée du client, Super PDP).

Client historique : JD Consult (cabinet `jeremy.darnis@gmail.com`), mais l'application est multi-cabinets dès l'origine
(`cabinets`, `cabinet_admins`).

**Le but, fixé par le cabinet le 29/09/2026** : une application qui rend l'expert-comptable indépendant — sans autre
logiciel, tout centralisé ici, de la pièce à la déclaration. Pas de calendrier : le logiciel le plus complet et le plus
fiable possible, même si c'est long. Tenir la comptabilité d'autrui étant réservé aux experts-comptables inscrits à
l'Ordre, l'application est leur logiciel, ou celui d'un praticien qui tient la sienne ; un cabinet non inscrit en reste
à la précomptabilité.

## État des données (19/09/2026) — à lire avant tout chiffre

**La base ne contient que des données FICTIVES**, et un seul dossier est vivant : `test` (`001c7ed7`, créé le
16/09/2026). `deltasoins 10`, `2023` et `DARNIS` sont des bacs à sable abandonnés.

- Mesurer sur `test`, jamais sur l'ensemble des dossiers.
- Un défaut trouvé dans un ancien dossier reste un défaut du CODE, mais ne se raconte pas comme un préjudice comptable.
- RGPD.md décrit la FORME de ce que l'application stockera, pas une exposition constatée (son §4).
- Les dossiers de test se suppriment le jour où le premier dossier réel arrive, et les autorisations permanentes de la
  session se resserrent alors (décision du cabinet du 18/10/2026).

## Architecture actuelle

- **SPA React sur Supabase** (Postgres, Auth, Storage, Edge Functions), sans backend applicatif : la logique serveur vit
  dans les policies RLS, les fonctions SQL et les Edge Functions Deno.
- **Trois profils d'accès** : cabinet (chef de cabinet, ou membre d'équipe assigné à des dossiers) ; client (un compte
  créé par `create-client-access`, restreint à ses dossiers par `memberships` ; seuls chemins : `signInWithPassword`
  dans `Login.tsx`, et le lien « Mot de passe oublié », qui passe par `NouveauMotDePasse` avant tout autre écran) ;
  super-admin (`SuperAdminPage`). **Aucun écran ne s'affiche sans session** (`App.tsx`) : aucun chemin anonyme.
- **Routage** : `HashRouter` (react-router-dom 7), pour GitHub Pages sans réécriture serveur ; l'onglet d'un dossier
  fait partie de l'URL (`/dossiers/:id/:tab`).
- **Coque d'ordinateur en trois volets** : barre latérale (`Layout.tsx`, `BarreDossiers.tsx`), réductible (la barre
  d'onglets `DossierParcours` réapparaît alors) ; `.main` ; panneau de droite. Menu du compte et menu « … » du téléphone
  écrits une fois (`entreesDuCompte`). **Le mobile ne change pas** : barre du haut, navigation en bas. La liste des
  dossiers (`lib/listeDossiers.ts`), tronquée ou refusée, le dit.
- **Le panneau de droite** (`components/PanneauDroit.tsx`) : rendu par PORTAIL, un seul contenu désigné par son nom ;
  `fermer()` ne ferme que s'il occupe encore le volet ; vide, l'emplacement n'existe pas (`:empty`). Sous 1 280 px il se
  superpose ; sur mobile, carte flottante. **Garde de sortie** (`useGardePanneau`) : `ouvrir()` et `fermer()` la
  consultent avant qu'un AUTRE contenu prenne la place ; quitter l'onglet par la barre latérale n'est PAS couvert
  (`HashRouter` n'a pas de bloqueur).
- **Volets redimensionnables** (`lib/largeurVolets.ts`) : le panneau central garde 560 px ; une largeur n'est retenue
  qu'après un vrai glissé ; la poignée de droite vit AVANT l'emplacement (sinon `:empty` mentirait).
- **La fiche d'une pièce** (`FichePiece.tsx`) suit la liste AFFICHÉE, est clée par pièce ; une réponse pour une pièce
  quittée ne déplace rien. **Le rapprochement d'un mouvement** (`FicheMouvement.tsx`) justifie la pièce proposée par les
  signaux mesurés et dit ce que la banque ne confirme pas ; à égalité, aucune proposée ; l'onglet retient l'IDENTIFIANT
  et relit la ligne ; le choix à la main ne part qu'au clic sur « Associer ».
- **Une page ne se remonte pas d'un dossier à l'autre** (`DossierDetail` reste monté) : sous `AnneeProvider key={id}`,
  ou clé par dossier, ou gardant ce qu'il lit AVEC l'identifiant lu. Côté client, `<Outlet key>` dans la coque → « LA
  BARRE LATÉRALE A ROUVERT UNE COURSE ».
- **Hébergement** : GitHub Pages, publié par `deploy.yml` à chaque push sur `main` (Node 22, `npm test` puis
  `npm ci && npm run build`) ; domaine `compta.jdarnis.fr` (`public/CNAME`, d'où `base: '/'`).
- **Backend Supabase** : projet `jd-precompta`, id `mztayrhfgtsfjqighlue`, eu-west-1 — distinct de `jd-factu`.
- **Migrations** : uniquement par l'outil MCP `apply_migration`, jamais par `execute_sql`. Consulter l'état réel
  (`list_tables`, `execute_sql`) plutôt que supposer. `supabase/schema/` porte un EXPORT, pas la source de vérité. Après
  toute migration : y ajouter son fichier et rejouer les trois contrôles de `supabase/schema/README.md` (dérive, socle,
  inventaire).
- **Edge Functions** (`supabase/functions/`, Deno, déployées par MCP `deploy_edge_function`) :
  - `agent-comptable` — assistant IA (Bedrock), plafond de coût mensuel par cabinet ; aucun nom de cabinet
    (`cabinetEnDur.test.ts`), la TVA selon `lib/statutTva.ts` (`agentComptableConsigne.test.ts`).
  - `create-cabinet`, `delete-cabinet` (super-admin) ; `create-team-member`, `create-client-access`.
  - `extract-piece` — OCR (Textract) puis citation des champs ; réservée à un compte RATTACHÉ et à `receive-email` (clé
    secrète en `apikey`).
  - `receive-email` (webhook Resend, par dossier) ; `send-email` (facture : le cabinet et le client « Ventes », trente
    e-mails par dossier et par jour de Paris pour un client ; relance : le cabinet seul).
  - `superpdp-credentials`, `superpdp-sync`, `superpdp-emit` — Super PDP ; le client « Ventes » relie et transmet, la
    réception reste au cabinet.
  - `proposer-categorie` (sur un clic, rien d'écrit) ; `evaluer-extraction` (harnais de MESURE, facturé dans une fenêtre
    datée seulement) ; `taux-change-bce`.
  - `banque-connexion` (Enable Banking, bac à sable) et `plateforme-agreee` (la plateforme du CLIENT : rend les
    factures, dépose, relève les statuts) RENDENT, l'écran importe ; le secret d'une connexion ne revient jamais au
    navigateur, ni ne part vers une adresse changée sans être ressaisi.

## Stack technique

- React 19 + TypeScript ~6 + Vite 8, `react-router-dom` 7 (`HashRouter`).
- `@supabase/supabase-js` 2.x — client unique exporté par `src/lib/supabase.ts`, sur la clé publishable du projet
  (`sb_publishable_…`), que `lib/clePublique.ts` vérifie au démarrage.
- `exceljs` (packs Excel), `jszip` (packs ZIP), `pdfjs-dist` (lecture de PDF), `pdf-lib` (2035 remplie).
- Lint : `oxlint` (`npm run lint`), pas d'ESLint. Tests : Vitest (`npm test`).
- Aucun framework CSS — styles maison (`src/index.css`, `lib/theme.ts`, `lib/colors.ts`).

## Structure importante du projet

```
src/
  lib/            logique métier sans JSX. Client : lib/supabase.ts. Erreurs : lib/invokeErreur.ts,
                  lib/messageErreur.ts. Lecture d'une collection : lib/lectureComplete.ts (lireTout).
  components/     composants transverses (coque, PanneauDroit, modales, widgets). BarreRecherche +
                  lib/recherche.ts : le moteur de recherche commun — tout écran de liste s'y branche.
  pages/          un composant par écran ; pages/dossier/ les onglets d'un dossier, dont lib/ongletsDossier.ts
                  (GROUPES_PARCOURS, DossierTab) est la source UNIQUE de la barre latérale et des onglets.
  test/           fabriques des tests (faux clients, filtres PostgREST, harnais des Edge Functions). Un tirage
                  « au hasard » passe par `tirage` (tirage.test.ts) → « TROIS TESTS TIRAIENT LEURS CAS ».
supabase/
  functions/      une Edge Function par sous-dossier, auto-portée.
  essais/         essais à REJOUER, jamais seulement relire, par impersonation. Sans suppression ni mise à
                  jour sans `where` en production (l'outil les retient et l'appel expire) : ce qu'une
                  suppression rencontre se joue sur une réplique. rls.sql (toutes les tables, boucle sur
                  pg_class, se mute lui-même) ; restauration.sql (réplique, psql, gardé par
                  restaurationEssai.test.ts) ; allerretour.py (après chaque déploiement) ; bordures.py ;
                  socle.py/.sql et inventaire.py/.sql (après chaque migration) ; signature.sql (réplique ↔
                  production) ; un essai par mécanisme, à rejouer après toute migration qui touche ses
                  fonctions, ses tables ou les contraintes de lignes_bancaires et ecritures_brouillon ;
                  bornesStockage en lecture seule ; logoDesFacturesSuppression sur une réplique seulement ;
                  validationExercice, liquidationTva et factures en UNE transaction (psql -1).
  types/          prothèses de type des Edge Functions, HORS de functions/ (que des scanners énumèrent).
  schema/         export du schéma (voir PLAN_DE_REPRISE.md).
  config.toml     le réglage verify_jwt de chaque Edge Function, et rien d'autre.
PLAN_DE_REPRISE.md  quoi faire quand quelque chose a disparu ; RGPD.md, les traitements ; HISTORIQUE.md, le récit.
.github/workflows/  tests.yml (verifier : tests multi-fuseaux, lint, build), deploy.yml.
outils/captures/  banc VERSIONNÉ : l'application et un faux Supabase sous Playwright (mode d'emploi en tête de
                  vitrine.mjs) ; les visites `ereporting/*` (horloge au 5/11/2027) restent EN FIN de `VISITES`.
outils/cotisations/  oracle.mjs : les cas de référence Urssaf (moteur installé à la demande, jamais en dépendance).
outils/facturation/  valider.mjs, cdar/valider.mjs, ereporting/valider.mjs : les exemples fictifs jugés par les
                  instruments officiels (hors du dépôt, à leur empreinte), confrontés par leurs tests.
outils/references/  quatre dossiers fictifs que l'expert-comptable recalcule ; `donnees.ts` seule source ; nos
                  chiffres jamais commités, seule leur empreinte → « LES DOSSIERS DE RÉFÉRENCE ».
```

## Conventions de développement

- **Système visuel = `src/index.css` seul, aucune couleur d'accent en dur** : la charte d'un cabinet (`lib/branding.ts`)
  ne remplace que `--color-primary`, `-hover` et `-light` ; toute nuance dérivée par `color-mix()` depuis
  `--color-primary` ; fonds plats, ombres `--shadow-*`, rayons `--radius-*`, transitions `var(--duree) var(--ease)`.
- **Pièges de positionnement** : jamais de `backdrop-filter`, `filter` ni `transform` sur `.sidebar` ; jamais de
  `container-type` sur un ancêtre d'éléments `position: fixed` → « LA BARRE DU BAS NE RECOUVRE PAS LES BOUTONS D'UNE
  FENÊTRE ».
- **Tableaux de bord** : widgets partagés (`src/components/widgets/`) en grille `.bento` de 12 colonnes qui suit SA
  largeur ; le statut se lit à une pastille, jamais comme une série ; squelettes ; aucune fenêtre superposée dans une
  grille ni dans une carte.
- **Dans `.sidebar`, une seule `<nav>`** (sur mobile, la barre du bas) ; texte discret par `--color-text-barre`.
- **Une rangée de boutons ou de champs passe à la ligne** (`flex-wrap`), jamais ne déborde ; un tableau vit dans un
  `.table-scroll` ; un bouton aligné sur le bas des champs passe par `.field-row.aligne-bas`. Un tableau qui se replie
  en fiches (`table-empilable`, `data-libelle`) vit dans `.tableau-adaptable` (`tableauxFormulaires.test.ts`) ; le
  téléphone ne comprime jamais un tableau ; un nom de fichier porte `.nom-fichier`, une adresse électronique `.courriel`
  → « UN MOT NE SE COUPE PLUS AU MILIEU », « L'ADRESSE D'UN CLIENT NE SE COUPE PLUS AU MILIEU D'UN MOT ».
- **Vérification visuelle** : `outils/captures/` après toute modification de `index.css` ou de la coque ;
  `debordements.mjs` rend 0 aux quatre largeurs de référence, à 720 px et aux volets extrêmes ; un bouton de fenêtre
  qu'aucune position ne dégage est une faute ; la passe du client : `debordements.mjs <largeur> client` (ou
  `client-banque`). Ne JAMAIS donner au navigateur le mandataire de l'environnement (en-tête de `vitrine.mjs`). Sous un
  `node_modules` fait de liens, `outils/captures/vite.config.ts` autorise le réel et ne surveille pas `.claude` (jamais
  `**/.claude/**`) → « LE BANC D'UN WORKTREE MESURAIT LA POLICE DE REPLI ». Un montant ne se coupe pas : `formatMoney`
  ou `formaterMontant(n)` ; un test lit `textContent` → « UN MONTANT SE COUPAIT EN FIN DE LIGNE ».
- **Ce qui s'imprime n'a aucune mise en page en ligne** (elle l'emporte sur `@media print`) ; le bloc du téléphone vaut
  aussi à l'impression ; une impression se mesure sur un vrai PDF → « ET LA FACTURE IMPRIMÉE PORTAIT SES BOUTONS ».
- **Exercice partagé entre onglets** (`useAnnee()`) : toute vue dont un total dépend de l'exercice le rejoint, jamais un
  `useState` local (exceptions légitimes : « sans date » de `PiecesTab`, `AnneeTabs`, `ChecklistTab`) → « BALAYÉ LE
  21/09/2026, RÉSULTAT NÉGATIF ».
- **Français partout** ; un commentaire dit le POURQUOI. **Mutations optimistes** quand c'est simple et sûr ; annuler et
  dire l'erreur si l'appel échoue.
- **Aucun appel réseau externe silencieux** : toute API tierce part d'un clic, jamais au chargement ; les polices sont
  servies par l'application (`polices.test.ts`). **Rien n'est jamais validé ni importé automatiquement** : tout document
  importé arrive « à valider ».
- **Une facture validée est figée** par la base : un avoir puis une nouvelle facture, jamais en place. **Doublons** :
  SHA-256 du fichier avant tout dépôt ; l'empreinte du TEXTE OCR attrape deux exports du même document.
- **Edge Functions** : fichiers plats, un `Deno.serve`, helpers locaux au fichier.

## Décisions techniques déjà prises

- **RLS multi-cabinets** : `cabinet_admins`, `dossier_assignations`, fonctions `security definer`
  `est_chef_du_cabinet()`, `admin_du_dossier()`, `admin_du_cabinet()`, `is_super_admin()` (chacune inclut le
  super-admin). Toute table métier d'un dossier : une policy `FOR ALL to authenticated` sur
  `admin_du_dossier(dossier_id)` ; une table enfant remonte à son parent ; vérifiée par impersonation avant d'être crue.
- **Un prédicat de policy ne doit JAMAIS pouvoir être vrai sans session** : sans `to`, une policy vise `public`, donc
  `anon` ; toute nouvelle porte `to authenticated` → « Une policy sans clause `to` s'applique à `public` ».
- **Les policies se REJOUENT** (`rls.sql`) : quatre profils, boucle sur `pg_class`, écritures annulées par
  sous-transaction, refus exigé en 42501, des mutations qui doivent virer au rouge ; un bloc dont la migration manque se
  dit EN ATTENTE ; le fichier se rejoue ENTIER, son empreinte comparée à la copie transmise ; ce qui contourne la RLS se
  rejoue aussi, et un refus plpgsql (P0001) exige sa RAISON → « CE QUI CONTOURNE LA RLS ».
- **Stockage** : le premier segment du chemin EST le dossier (`(storage.foldername(name))[1]::uuid`) — un chemin
  non-UUID fait lever le cast pour tout le monde ; le seau `ventes` juge d'abord la FORME du chemin dans un `case`. Une
  suppression de fichier ne se teste pas en SQL : gardée par une lecture du catalogue (RGPD.md §8.6).
- **Une table que le CLIENT écrit** liste ses droits un par un (`piece_commentaires`) ; une parole datée ne se réécrit
  pas (aucune policy `UPDATE`).
- **Edge Functions auto-porteuses** : aucun import de `src/` ; une logique partagée est COPIÉE entre des bornes
  `── DÉBUT/FIN …`, gardée par un test qui l'extrait, la transpile et l'exécute contre `src/lib`, jamais l'une contre
  l'autre → « Une Edge Function auto-portée duplique du code ».
- **Erreurs** : `invoke()` lève avant de lire le corps — toujours `extraireErreurFonction(error, repli)` ; une erreur
  Postgrest est un OBJET NU : `messageErreur(erreur, repli)` ; `erreursSupabase.test.ts` interdit `instanceof Error`
  hors de `invokeErreur.ts` ; côté Edge Functions on ne lève que des `new …` → « ET LE MÊME DÉFAUT VIVAIT SUR L'AUTRE
  PORTE ».
- **Extraction : le modèle CITE, il ne calcule jamais** (`lib/extractionChamps.ts`) : la chaîne imprimée, vérifiée dans
  le texte source (accents jamais aplatis), puis analysée ; OCR obligatoire, citation best-effort ; jamais les valeurs
  au journal → « le modèle CITE, il ne calcule jamais ».
- **Modèle de citation : Haiku 4.5 (`MODELE_CITATION`)** ; en changer demande une mesure ET un appel réel avec les
  identifiants de production → « HAIKU 4.5 CITE AUSSI FIDÈLEMENT ». **L'OCR local est écarté** (21/09/2026) ; **l'étage
  2 tourne aussi sur les documents** : le sauter serait un paramètre de l'APPELANT, jamais la classification → « QUATRE
  CITATIONS SUR CINQ SONT PAYÉES PUIS JETÉES ».
- **Proposition de catégorie** (`lib/categorisationIa.ts`) : liste fermée filtrée sur le SENS, indice vérifié dans le
  texte, rien d'écrit, règles apprises d'abord, sur clic sous verrou → « UN MODÈLE PEUT PROPOSER UNE CATÉGORIE ».
- **N° de TVA intracommunautaire** calculé du SIREN (`FR` + `(12 + 3 × (SIREN mod 97)) mod 97` + SIREN). **GitHub
  Pages** malgré un signalement Safe Browsing (remédié) ; à reconsidérer seulement s'il revient.

## Services externes et MCP utilisés

- **Supabase** (MCP `Supabase`) — base, auth, stockage, Edge Functions du projet `mztayrhfgtsfjqighlue`.
- **Resend** (MCP `Resend`) — `send-email` et `receive-email`, domaine `precompta.jdarnis.fr` ; `RESEND_API_KEY` en
  secret Supabase ; un seul webhook, `email.received` → `receive-email`. Aussi le SMTP du service d'authentification (le
  lien « Mot de passe oublié »), réglé au tableau de bord avec sa propre clé, hors du dépôt ; ce lien reste lisible dans
  le journal de Resend tant qu'il vaut.
- **Super PDP** (`api.superpdp.tech`) — plateforme agréée partenaire, une application OAuth par entreprise
  (`superpdp_credentials`). **Cet environnement ne peut pas l'atteindre** : tout diagnostic passe par `query_logs` après
  un essai réel du cabinet.
- **API SIRENE** — code NAF depuis un SIRET (`lib/sirene.ts`), sur un clic.
- **Enable Banking** — agrégateur DSP2, BAC À SABLE ; jeton RS256 (secret `ENABLE_BANKING_CLE_PRIVEE`, jamais dans le
  dépôt ni la conversation) ; retour `https://compta.jdarnis.fr/retour-banque.html`. Prestataire définitif sur devis.
- **La plateforme agréée de chaque client** (depuis le 1er septembre 2026) : une connexion par dossier
  (`connexions_plateformes`), appelée sur clic ; Super PDP en est une ; aucune plateforme réelle n'a encore été appelée.
- **AWS** — Textract et Bedrock, régions de l'Union européenne seulement. **GitHub Actions** — `tests.yml` et
  `deploy.yml`.

## Contraintes de sécurité et RGPD

- **Registre : `RGPD.md`.** Les données de patients sont dans les FICHIERS, pas dans les tables ; le texte OCR est une
  copie dérivée sans durée légale propre (seul levier de minimisation) ; aucune pièce n'atteint ses 10 ans avant 2033.
- **Pas d'hébergement HDS** (24/09/2026, RGPD.md §8.7) : un praticien ne transmet pas ses bordereaux de télétransmission
  (secret médical), le relevé SNIR justifie les recettes. Décision du cabinet : la condition tient à la consigne aux
  clients ; ne rien changer au code, ne pas réenquêter.
- **Où partent les données** : `edgeFunctionsRegions.test.ts` (toute région AWS dans l'UE ; `AWS_REGION` relu par
  `evaluer-extraction` avec `limite: 0`). **Les droits chez AWS** : `edgeFunctionsIam.test.ts` (la policy vit chez AWS).
  **Qui voit quoi** : `rls.sql` (tables et stockage, pas la suppression d'un fichier) ; `edgeFunctionsHttp.test.ts` (les
  Edge Functions en HTTP).
- RLS activée sur toutes les tables. **Les accès clients sont restreints** (dépôt de pièces, pas de montants,
  catégories, packs ni autres onglets) — ne jamais les élargir sans décision explicite. **Trois domaines font
  exception** (décision du cabinet du 09/10/2026, « remplacer MEG ») : les devis, les factures et leur facture
  électronique, la vue de la banque — pour un accès qui en porte le DROIT, tenu en base, jamais par l'écran seul ; le
  client y écrit par les fonctions du cabinet, et une policy qui lui ouvre une lecture se présente au cabinet avant
  d'être appliquée.
- **Les droits sont en base** : `memberships.droit_ventes` et `droit_banque`, faux par défaut, posés par
  `changer_droits_acces` seule (un droit nul y est inchangé) ; prédicats `client_du_dossier`, `gere_les_ventes`,
  `gere_la_banque`, `droits_sur_le_dossier`. « Banque » ouvre la banque du client ; « Ventes » ses ventes et leurs
  gestes (un mouvement désigné demande aussi « Banque », le débit qu'une contre-passation cite compris → « LA
  CONTRE-PASSATION NE CITE UN MOUVEMENT QU'AVEC « BANQUE » »), articles, adresse de réception, clients, paramètres (un
  RIB qu'il pose n'est que PROPOSÉ jusqu'à `confirmer_rib`, le cabinet seul) et le seau `ventes` (lire, déposer ; jamais
  modifier ni supprimer) ; « Banque » seul n'apprend du RIB que `dernier_changement_de_rib`, jamais le RIB ; l'identité
  légale, le client ne l'écrit jamais. L'onglet Accès dit ce que la base ouvre à la SESSION du client
  (`ceQueDisentLesCases`, confronté à l'export) → « LES DROITS D'UN ACCÈS CLIENT, TENUS EN BASE ». **Un texte libre que
  le cabinet saisit dans une table qu'un droit du client ouvre le dit dans son libellé** (`LIBELLE_*` de
  `lib/droitsAcces.ts`).
- **Un resserrement vient en dernier** : ce qui s'ajoute, puis la bascule de l'application, puis le resserrement — une
  lecture que la RLS refuse rend ZÉRO ligne sans erreur, et un écran d'avant croirait le relevé vide → « LA BANQUE DU
  CLIENT : LE RESSERREMENT APPLIQUÉ ».
- **Aujourd'hui la restriction est une règle d'ÉCRAN** : la base laisse déjà le client lire les montants de ses pièces
  et les catégories ; un texte du cabinet seul ne se range jamais dans une table que le client lit → « L'ESPACE CLIENT
  DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION ». **Les notes internes** vivent dans `notes_internes`
  (aucune branche client) ; les anciennes colonnes `notes` ne se lisent ni ne s'écrivent plus → « LES NOTES INTERNES DU
  CABINET, HORS DE PORTÉE DU CLIENT ».
- **Les fonctions de la vente acceptent le client** (quatre) : `droits_sur_le_dossier` lu au jeton de l'appelant
  (`droitsDeLAppelant`) avant toute autre lecture, puis l'action jugée par `QUI_PEUT_QUOI` ; sans le droit 404, droits
  illisibles 503 ; le plafond d'e-mails se LIT, il ne se réserve pas → « LES FONCTIONS DE LA VENTE ACCEPTENT LE
  CLIENT ».
- **Les écrans de l'espace client — règles communes** : un écran des ventes sert les deux espaces, `espace` OBLIGATOIRE
  (union typée), sous le drapeau de sa migration (`*_EXPORTE(E)S`) ; la règle et les mots dans un module pur, la lecture
  à part (elle ne rejette jamais et se garde avec le dossier) ; liste lue EN ENTIER, rien avant le retour ; lue en
  partie, refusée ou rompue, l'écran le dit et n'offre AUCUN geste ; un geste passe la fonction SQL seule, sous un
  verrou `useRef` relâché après la relecture ; le refus du module se dit avant le clic, sur la saisie TELLE QU'ELLE
  PART, jamais une règle recopiée ; une saisie RETIENT la version qu'elle remplace ; une confirmation NOMME ce qui
  part ; « par le client » au cabinet seul, sur des accès lus en entier, jamais deviné ; les mots du client passent
  `MOTS_DU_CABINET` (aucun onglet, tutoiement), ses refus `REECRITURES_CLIENT`. Écran par écran :
  - « Mes ventes › Factures » sous `mesVentesOuvertes`, la case de la société AFFICHÉE relue ; sans « Banque », rien de
    la banque → « « MES VENTES › FACTURES » ». « Tes plateformes » : ni réception ni secret → « LES CONNEXIONS DU CLIENT
    ET LES TUILES DE SON ACCUEIL ». « Par le client » côté cabinet (`lib/auteursVentes.ts`) → « « PAR LE CLIENT » CÔTÉ
    CABINET ».
  - « Ma banque » sous `maBanqueOuverte` : l'état DÉDUIT, le solde LU au dernier relevé contrôlé, jamais calculé ; ni
    catégorie ni écriture → « « MA BANQUE » : L'ÉCRAN DU CLIENT « BANQUE » » ; avec « Ventes », le registre lu APRÈS la
    case dit le mouvement classé ou réservé par ses encaissements, lu en partie il tait les mouvements libres → « « MA
    BANQUE » DIT LES ENCAISSEMENTS DE SES FACTURES ». Côté cabinet, la pièce proposée en tête de la fiche ; écarter par
    `retirer_proposition` seule → « « MA BANQUE » CÔTÉ CABINET ».
  - « Règlements » : rien ne s'écrit d'ici ; totaux et CSV sur les lignes FILTRÉES → « « MES VENTES › RÈGLEMENTS » ».
    « Articles » : un prix infidèle est « illisible », jamais arrondi → « LA LISTE DES ARTICLES, À L'ÉCRAN ».
  - L'adresse de réception : sans SIRET lisible, aucun geste ; « Vérifier sur l'annuaire » est un LIEN → « L'ADRESSE DE
    RÉCEPTION, À L'ÉCRAN ». L'encart « Facture électronique » : jamais « active » d'une valeur non lue ; aucune fenêtre
    dans la grille → « L'ENCART « FACTURE ÉLECTRONIQUE », À L'ÉCRAN ».
  - « Clients » : un effacé ne s'affiche jamais ; dans une facture, le choix remplit le client ENTIER et l'échéance AU
    CHOIX, la règle des soins se DIT et ne refuse rien → « UN CLIENT DANS LA FACTURE ». L'import : le fichier ne part
    nulle part, son encodage dit ; tout ou rien, « ne se défait pas » → « IMPORTER DES CLIENTS, À L'ÉCRAN ». L'export :
    une copie FIDÈLE que l'import relit → « EXPORTER LA FICHE D'UN CLIENT ».
  - « Paramètres » : aucune facture ne les lit encore (A7) ; un RIB proposé retouché par le cabinet est confirmé
    d'emblée, dit avant le clic (`CONSEIL_VERIFICATION_RIB`) → « LES PARAMÈTRES DE FACTURATION, À L'ÉCRAN ». « Identité
    du dossier » : relue après écriture ; un entrepreneur individuel a son capital REMIS À NUL ; une colonne absente
    n'est pas nulle → « L'IDENTITÉ LÉGALE DU DOSSIER, À L'ÉCRAN ».
  - L'avis d'un changement de RIB : un RIB proposé reste chez le cabinet tant qu'il est le dernier changement, le reste
    trente jours ; illisible, une ligne discrète, jamais le silence → « L'AVIS D'UN CHANGEMENT DE RIB, À L'ÉCRAN ». Les
    RIB à confirmer, en tête du tableau de bord, hors de la grille → « LES RIB À CONFIRMER, SUR LE TABLEAU DE BORD ». Le
    logo : son empreinte recalculée AVANT toute image → « LE LOGO DES FACTURES, À L'ÉCRAN ».
  - Les pièces jointes écartées, dites au client : jour, raison et poids sur 90 jours, jamais l'identifiant → « LE
    CLIENT VOIT UNE PIÈCE JOINTE ÉCARTÉE DANS « MES PIÈCES » ».
- **Secrets** côté Supabase, jamais au bundle ni dans un journal ; les tables de connexions n'ont aucune policy ; la clé
  SECRÈTE n'entre ni au dépôt (public) ni au navigateur (`clesSupabase.test.ts`).
- **Mot de passe oublié** (`lib/recuperationMotDePasse.ts`) : flux IMPLICITE, gardé (le PKCE lierait le lien à son
  navigateur) ; `redirectTo` toujours passé, `https://compta.jdarnis.fr/`, sans « # » (`ADRESSE_DE_RETOUR`) ; `main.tsx`
  lit l'adresse AVANT le premier rendu ; le message de la demande est NEUTRE ; un code d'erreur ne s'affiche que s'il en
  a la forme. Le même lien part de l'onglet Accès, sur un clic confirmé, jamais sur une liste d'accès partielle → « MOT
  DE PASSE OUBLIÉ ».
- **Créer un accès ne touche jamais au mot de passe d'un compte existant** (décision du cabinet du 10/10/2026) :
  `compte: "cree"` ou `"existant"` ; d'un compte d'ailleurs, le 409 dit qu'il existe, rien de plus → « LA CRÉATION D'UN
  ACCÈS NE CHANGE PLUS LE MOT DE PASSE D'UN COMPTE EXISTANT ».
- **La règle des mots de passe est celle du tableau de bord** (une minuscule, une majuscule, un chiffre, un symbole ;
  dix caractères) : les quatre écrans en portent un REFLET (`REGLE_DU_MOT_DE_PASSE`), appliqué avant tout appel, et un
  réglage changé se reporte là et dans PLAN_DE_REPRISE.md ; le refus du service se lit au CODE, jamais au statut ni au
  message (`refusDuService`) → « UN MOT DE PASSE REFUSÉ SE DISAIT « UN COMPTE EXISTE DÉJÀ » ».
- **Variables d'environnement** : nommées dans PLAN_DE_REPRISE.md (§3), comparées au code
  (`variablesEnvironnement.test.ts`). Les données fictives sont traitées comme identifiantes : aucun service tiers hors
  de cette liste.

## Fonctionnalités déjà implémentées

- **Cabinets et accès** : multi-cabinets, super-admin, charte, équipe ; accès clients, droits « Ventes » et « Banque » ;
  client à plusieurs sociétés ; accueil client ; mot de passe oublié.
- **Espace client** : « Mes ventes » et « Ma banque », écran par écran dans les contraintes ci-dessus.
- **Dossiers, pièces, banque** : trois volets, PWA ; dépôt, OCR et citation, classification, doublons, validation, fil
  de précisions, notes internes, proposition de catégorie, fiche hors de France, bornes du stockage, pièces jointes
  écartées ; import des relevés (contrôle de solde), rapprochement, connexion bancaire (bac à sable).
- **Comptabilité et déclarations** : chaque mouvement du relevé s'écrit (ligne 26.6) ; inventaire ; validation d'un
  exercice ; engagement, étape 1 ; lettrage ; TVA liquidée ; report des soldes ; 2035, volet social et estimation
  Urssaf, CA3, FEC et piste d'audit, à-nouveaux, 2035-E et calendrier CFE-CVAE.
- **Facturation** : factures, avoirs, e-mail ; statut de TVA, CII, facture figée ; transmission et réception (plateforme
  du client, Super PDP) ; encaissements et leur déclaration ; cycle de vie ; vente entrée deux fois, l'exemplaire
  d'une facture, la source de la vente en base ; e-reporting e1 à e6.
- **Bilan**, **révision**, **plan comptable** lu par la base et l'application ; financement ; immobilisations,
  cotisations, Clôture, Estimation, Balance, Virements ; assistant IA.
- **Exports** : pack, export d'un cabinet, sauvegarde et restauration — **une sauvegarde n'est pas un pack** : le pack
  porte les fichiers, la sauvegarde les lignes qui les relient, et les logos des factures (PLAN_DE_REPRISE.md §4, point
  6).

## Fonctionnalités actuellement en cours

- **Proposition de catégorie** : à éprouver par un premier clic réel du cabinet.
- **Contre-calcul par l'expert-comptable** (ligne 23.3) : quatre dossiers de référence remis (2035, CA3, amortissements,
  bilan 2033-A) ; restent ses chiffres, l'analyse des écarts, puis ses chiffres en cas de référence → « LES DOSSIERS DE
  RÉFÉRENCE ».
- **Déclarations TNS** (ligne 27) : restent hors de l'estimation — médecins et chirurgiens-dentistes, retraite, revenus
  de remplacement, ACRE, exonérations, outre-mer, régularisation ; DSCS proposée depuis la ligne 4 de la 2035-A, à
  confirmer sur une première déclaration réelle.
- **CFE et CVAE** (ligne 48) : restent la saisie par exercice de la part déductible des loyers, du cadre des
  mono-établissements et de l'effectif (une table à créer), celle de BW, les dates d'activité d'un dossier qui cesse en
  cours d'année, le millésime 2027, le plafonnement de la CET (plus tard, 48-Q9) → « L'ANNEXE 2035-E SE TIRE DE LA 2035
  DÉPOSÉE ».
- **Télédéclaration de la TVA** (ligne 28) : étape 2, la transmission par un partenaire EDI — Teledec choisi, qui veut
  voir l'application fonctionner avant d'ouvrir son API ; ASPOne.fr l'autre voie. Rien n'est écrit.
- **Comptabilité d'engagement** (ligne 31) : restent les écarts de change et les frais bancaires (le rapprochement règle
  encore la pièce sur la banque ; à écrire à part, aux comptes 666, 766 et 627 : 31-changeFrais), les auxiliaires des
  à-nouveaux et des soldes reportés, l'affectation du résultat d'une société, la TVA des livraisons de biens, la liasse
  (2033 ou 2050), les exercices décalés.
- **FEC** : restent les vingt-deux champs d'un BNC en trésorerie et les montants en devise (réponse de
  l'expert-comptable du cabinet attendue).
- **Ligne 26.6** : reste (e), les vingt-deux champs et Test Compta Demat ; l'opération découverte après coup, conçue
  (B9, l'engagement, reste à l'expert-comptable). Aucun exercice n'est encore validé en base → « L'OPÉRATION DÉCOUVERTE
  APRÈS COUP ».
- **Connexion bancaire** (ligne 24) : le prestataire définitif et son contrat ; le chemin du CLIENT, conçu (seul le
  titulaire donne l'accord ; le serveur importe ; étapes P8 et P9) ; la récupération automatique ou au clic (RGPD.md
  §8.8).
- **Clés historiques de Supabase** : reste leur désactivation dans le tableau de bord, un clic du cabinet ; elle referme
  aussi `taux-change-bce` (23-tauxBce).
- **Les pièces jointes écartées** (ligne 22.7) : reste, sur les comptes réels, la décision sur les éléments de l'e-mail
  qui ne sont pas des pièces jointes — au premier client réel, la session les relève à chaque reprise pendant un mois
  (le journal ne vit qu'un jour), une table des comptes sans nom seulement s'il faut plus de recul (S229-Q3) ; « autre
  disposition » non nul, le filtre des pièces jointes se normalise dans une étape à part (S229-Q4) ; une liste fermée
  d'extensions seulement si ces fichiers font du bruit et si le cabinet la choisit (S227-Q5) → « UNE PIÈCE JOINTE
  ÉCARTÉE À LA RÉCEPTION PAR E-MAIL SE DIT AU CABINET ».
- **Mot de passe oublié** : le premier essai réel du cabinet (iPhone), et celui du lien envoyé depuis l'onglet Accès ;
  au tableau de bord, la longueur minimale à 10 (à relever) et le modèle d'e-mail en français. Un mot de passe de plus
  de 72 octets reçoit encore le refus anglais du service, en 500 (défaut 23.5 ; le refuser avant l'appel, en français :
  23-Q5, à écrire). Un compte dont le dernier accès au cabinet a été retiré n'y est plus « rattaché » : lui recréer un
  accès bute sur le 409 (le rattacher après une confirmation qui nomme l'adresse et ce qu'elle ouvre : 23-Q2, à écrire)
  → « LA CRÉATION D'UN ACCÈS NE CHANGE PLUS LE MOT DE PASSE D'UN COMPTE EXISTANT ».
- **Facturation électronique** (ligne 28.5) : (a) à (c) en ligne, la réception et le dépôt à éprouver sur la plateforme
  réelle d'un client ; (d) « Encaissée » : d1 à d4 en ligne ; d5, le message CDAR, en module (ses quatre choix et MDT-95
  tranchés par le premier essai réel ; le matricule d'une plateforme, une colonne de la connexion) ; d6 reste (les Edge
  Functions qui écriront `transmissions_encaissements`, l'effet du 601) ; d7 en ligne, le premier relevé réel reste à
  faire ; l'essai réel sur le bac à sable de Super PDP. (e) l'e-reporting, onze étapes (le point 15 en hypothèse ;
  E6-Q8 : l'identifiant tiré au téléchargement, donné ensuite à la base, une migration) ; restent e5b2 (Q6, la fiche
  déclarée qui retient sa pièce), e6b (le bouton qui télécharge le fichier) et la suite (e7 : une facture à un client
  étranger ; e9 : `fluxEreporting` recopié dans `plateforme-agreee`) → « L'E-REPORTING : LA CONCEPTION », « LE FICHIER
  D'UNE DÉCLARATION D'E-REPORTING ».
- **Défauts connus des Edge Functions** (3, `DEFAUTS_CONNUS`) : l'objet et l'expéditeur d'un e-mail reçu au journal
  (`receive-email`) : ne plus journaliser que des comptes, à écrire ; `taux-change-bce` sans contrôle d'appelant : la
  désactivation des clés historiques le referme → « LES DERNIERS CORPS MAL FORMÉS DES EDGE FUNCTIONS ».
- **Une vente entrée deux fois ; la facture validée, source de sa vente** (ligne 28.6 ; EC-Q3 a la sienne, la 28.65,
  depuis le 21/10/2026) : CONÇUE le 18/10/2026 — les moteurs lisent la facture et le registre des encaissements (la
  recette à sa date d'encaissement en trésorerie, la créance à sa date en engagement, un taux soldé portant exactement
  la TVA facturée), la jumelle et le PDF désignés « exemplaires » ne comptent plus, le double compte fermé en base (G1 à
  G5) ; la bascule par dossier, par le cabinet, sans effet rétroactif, irréversible ; neuf étapes, VF1 à VF9 ; ses
  questions (EC3-Q1 à Q12, EC3-Q6b, VF2-Q2) tranchées le 19/10/2026 à la recommandation, VF3-Q1 (la règle du cumul),
  VF6-Q1 (défaire l'exemplaire d'une facture source), VF4A-Q1 (le nom du 706000 et du 627000) et VF4A-Q2 (le compte
  d'une compensation) le 20/10/2026, VF4C1-Q1 (changer le compte d'une compensation) et VF4C2-Q1 (le nom des quatre
  autres comptes) le 21/10/2026, VF4C3-Q1 (le poste des frais d'un mouvement d'encaissements) et VF5-Q1 à VF5-Q3
  (l'impayé d'un encaissement jamais déclaré, la vente d'avant datée par son encaissement, rien de plus pour « Banque »
  seul) le 22/10/2026, de même ; fini avant que les clients facturent réellement ici → « LA FACTURE VALIDÉE, SOURCE DE
  SA VENTE : LA CONCEPTION ». VF1 en ligne le 18/10/2026 (28.6-Q1) : l'exemplaire d'une facture, en base (VF1a) puis
  désigné et défait depuis la fiche d'une pièce de vente (VF1b) → « L'EXEMPLAIRE D'UNE FACTURE, EN BASE »,
  « L'EXEMPLAIRE D'UNE FACTURE, À L'ÉCRAN ». VF2 en base le 19/10/2026, neutre (le réglage du dossier, la source fixée à
  la validation, les encaissements d'une facture source, le mouvement réservé puis classé par ses encaissements) → « LA
  SOURCE DE LA VENTE, EN BASE ». VF3a le 19/10/2026, neutre : une SECONDE forme, `VentesFacturees`
  (`lib/ventesFacturees.ts`, pur, et sa lecture) → « LES VENTES FACTURÉES, EN MODULE ». VF3b le 19/10/2026, en trois
  lots : la 2035 (Clôture, la Révision), la CA3 (l'onglet TVA), la situation et l'estimation (Financement, Estimation)
  les lisent, « Ma simulation » dit ne pas les compter jusqu'à VF8, et les confirmations de VF1b disent ce qui se
  compte ; jusqu'à VF4, une part sans compte et une déclaration qui ne s'enregistre pas → « LA 2035 LIT LES VENTES
  FACTURÉES », « LA CA3 LIT LES VENTES FACTURÉES », « LA SITUATION, L'ESTIMATION ET LA SIMULATION LISENT LES VENTES
  FACTURÉES ». VF4a le 20/10/2026, neutre : les six rôles de la vente facturée entrent dans le plan de l'application, et
  ses écritures se composent en module pur (`lib/ecrituresVentesFacturees.ts`), que rien ne lit encore → « LES ÉCRITURES
  D'UNE VENTE FACTURÉE, EN MODULE ». VF4b le 20/10/2026, neutre : les fonctions qui vérifient et remplacent ces
  écritures (`ecrire_vente_facturee`, `retirer_ecriture_vente_facturee`), la garde G5 et le compte d'une compensation,
  en base — une migration collée par le cabinet —, et `lib/ecritureVenteFacturee.ts`, qui redit leurs refus → « LES
  ÉCRITURES D'UNE VENTE FACTURÉE, EN BASE ». VF4c1 le 20/10/2026, neutre : l'onglet Écritures écrit, réécrit et retire
  ces écritures, source par source, et le cabinet y choisit le compte d'une compensation → « L'ONGLET ÉCRITURES ÉCRIT
  LES VENTES FACTURÉES ». VF4c2 le 21/10/2026 : le FEC, la piste d'audit et le lettrage lisent ces écritures, et le
  706000 et le 627000 prennent le nom du plan comptable général (VF4A-Q1) ; neutre hors de ce nom, qu'aucune ligne de la
  production ne porte → « LE FEC, LA PISTE D'AUDIT ET LE LETTRAGE LISENT LES VENTES FACTURÉES ». VF4c3 le 21/10/2026,
  neutre : la concordance de la 2035 et la CA3 lisent ces écritures — une période se déclare quand celles de ses ventes
  facturées sont à jour —, « Changer le compte » d'une compensation (VF4C1-Q1) et le nom du plan comptable général pour
  les quatre autres comptes (VF4C2-Q1), toutes deux sur la recommandation → « LA 2035 ET LA CA3 LISENT LES ÉCRITURES
  D'UNE VENTE FACTURÉE ». Le lot du mouvement libéré (R1 de VF4b) le 21/10/2026, neutre : les dix-huit fonctions du
  relevé et le navigateur ne suppriment, ne jugent et ne vérifient que les lignes propres au mouvement — une migration
  collée par le cabinet → « LES FONCTIONS DU RELEVÉ NE TOUCHENT QUE LES LIGNES PROPRES AU MOUVEMENT ». Les frais d'un
  mouvement d'encaissements le 22/10/2026, neutre : la 2035 les compte tels que la composition les écrit (VF4C3-Q1, sur
  la recommandation) → « LA 2035 COMPTE LES FRAIS D'UN MOUVEMENT D'ENCAISSEMENTS ». VF5 conçu le 22/10/2026 (neuf lots,
  VF5a1 à VF5h) → « VF5, LA BANQUE : LA CONCEPTION ». VF5a1 le 22/10/2026, neutre : le relevé reconnaît les mouvements
  que les encaissements de factures sources classent ou réservent (G2), un mouvement classé n'est plus « rapproché sans
  justificatif », leur fiche n'offre aucun geste d'hier, et des ventes lues en partie retiennent la fiche et les lots →
  « LE RELEVÉ RECONNAÎT LES MOUVEMENTS DES VENTES FACTURÉES ». VF5a2 le 22/10/2026, neutre : aucun lot du relevé ne
  prend ces mouvements, sa carte dit combien il en écarte, et un mouvement réservé se compte à part des non rapprochés →
  « LES LOTS DU RELEVÉ ÉCARTENT LES MOUVEMENTS DES VENTES FACTURÉES ». VF5b le 22/10/2026, neutre : la fenêtre des
  encaissements juge une facture source par les jugements de la vente — le reste net de ses avoirs, des mouvements
  libres, la contre-passation qui cite son débit, le geste qui rendrait un mouvement inclassable dit sans être refusé ;
  chez le client, qui ne lit pas les exercices validés, la frontière jugée par la base → « LA FENÊTRE DES ENCAISSEMENTS
  JUGE UNE FACTURE SOURCE ». VF5c le 22/10/2026, neutre : côté cabinet, la fiche d'un crédit classe un mouvement réservé
  par ses encaissements, retire ce classement, lui rattache un encaissement enregistré sans mouvement ou ouvre sur lui
  la fenêtre d'une facture (le mouvement imposé) ; une remise de chèques se rattache encaissement par encaissement →
  « LA FICHE D'UN CRÉDIT CLASSE, RETIRE ET RATTACHE LES ENCAISSEMENTS D'UNE FACTURE ». VF5d le 22/10/2026, neutre : côté
  cabinet, la fiche d'un débit classe un débit réservé par ses contre-passations, retire ce classement, lui rattache une
  contre-passation enregistrée sans mouvement ou ouvre sur lui la contre-passation d'un encaissement déclaré (la fenêtre
  des encaissements, ce débit imposé) → « LA FICHE D'UN DÉBIT : L'IMPAYÉ ET LA SOMME RENDUE ». VF5d2 le 23/10/2026
  (VF5-Q1), neutre : l'encaissement jamais déclaré d'une facture source se contre-passe en citant le débit qui l'a
  défait, et la paire ne se déclare pas — une migration accordée par le cabinet ; VF5D2-Q1 à Q3 faites sur la
  recommandation → « L'IMPAYÉ D'UN ENCAISSEMENT JAMAIS DÉCLARÉ ». VF5e le 23/10/2026, neutre : les candidats du relevé —
  une facture source ouverte ou un encaissement sans mouvement pour un crédit libre, une contre-passation sans mouvement
  pour un débit, acceptés par les jugements de la base — mettent le crédit « à rapprocher » dans le lot des règles,
  l'écartent des trois autres lots et se proposent en tête de sa fiche → « LES CANDIDATS DU RELEVÉ ». VF5f le
  23/10/2026, neutre : la Checklist et la Révision disent, en « attention » jusqu'à VF7, les mouvements réservés à des
  encaissements de factures, à classer (Banque), et les encaissements par un moyen du relevé sans mouvement (Factures,
  vue « Règlements », que Banque ne liste pas) ; lues en partie, les ventes taisent les deux points et un bandeau le
  dit ; un réservé ne se compte plus parmi les non rapprochées → « LA CHECKLIST ET LA RÉVISION DISENT LES MOUVEMENTS
  RÉSERVÉS ET LES ENCAISSEMENTS SANS MOUVEMENT ». VF5g le 23/10/2026, neutre : « Ma banque » d'un client « Banque » et
  « Ventes » dit le mouvement que les encaissements de ses factures classent ou réservent, et n'offre aucune pièce sur
  un réservé ; « Banque » seul, rien de plus (VF5-Q3) → « « MA BANQUE » DIT LES ENCAISSEMENTS DE SES FACTURES ». Restent
  VF5h et VF6 à VF9 — se conçoivent les encaissements de factures non sources que VF2-Q2 et EC3-Q9 font compter ; qui a
  désigné, et quand : à VF6 (VF1A-Q2) ; à VF8, ce que la simulation recevra dit aussi quelle pièce ignorer.
- **Bac à sable Super PDP** : l'essai réel de l'émission avec le cabinet.
- **Révision des comptes** (ligne 41, neuf étapes R1 à R9) : R1 à R5 et R7 en ligne ; l'onglet Révision n'a pas encore
  les préalables de la validation ; R6 (Q1 : la révision retient la validation) attend un premier exercice réel révisé ;
  puis R8 (une citation de fichier, `fichier_id`, refusée jusque-là) et R9 → « LA RÉVISION DES COMPTES : LA
  CONCEPTION ».
- **L'espace client, logiciel de gestion du client** (décision du cabinet du 09/10/2026 : devis, factures et facture
  électronique, vue de la banque ; onze étapes P0 à P10) → « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT :
  LA CONCEPTION ». Restent :
  - P0 : la suppression des anciennes colonnes `notes`, écrite et éprouvée sur une réplique, acceptée par le cabinet
    (EC-Q7), à appliquer — avec elle trois essais, `types.ts`, `inventaire.py` et le socle → « LES NOTES INTERNES DU
    CABINET, HORS DE PORTÉE DU CLIENT » ;
  - P1-trace : garder qui a changé les droits d'un accès, et quand — une migration à écrire ;
  - P4 : la mention du mandataire à l'impression (EC-Q2 : le nom du cabinet figé avec la facture, une migration
    d'`enregistrer_facture`) ;
  - P8 : la connexion bancaire du client ;
  - P5, les devis : deux migrations et un retour arrière, accordés le 18/10/2026, à rejouer d'abord sur une réplique de
    la base d'aujourd'hui ; le code suit derrière `DEVIS_EXPORTES` ; un mois de validité proposé, modifiable ; aucun
    modèle par métier pour l'instant ; l'acompte, une facture d'acompte puis une facture de solde (à ajouter :
    `facturer_devis` ne tire qu'une facture) ; un devis refusé ou expiré gardé trois ans, puis proposé à l'effacement,
    jamais effacé seul ; les devis de soins hors de l'application ; une acceptation après la validité, sur une
    confirmation explicite → « LES DEVIS, EN BASE ».
  - La suite, en trois parties (« au minimum faire comme le logiciel du client, et aller plus loin ») : le premier
    groupe, A1 à A11 ; la parité, B1 à B9 (achats, notes de frais, analyse, documents du cabinet, trois cases neuves
    « Achats », « Notes de frais », « Documents », le resserrement des pièces) ; « aller plus loin », C1 à C8
    (l'échéancier, l'état du dossier, les situations publiées). Toutes les questions sont tranchées sauf MEG2-Q10
    (combien de temps garder les documents du cabinet et ses demandes), ouverte → « L'ESPACE CLIENT, LOGICIEL DE GESTION
    DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ ».
  - Du premier groupe, faits : A1 à A6 (sauf ce qui suit). Restent, dans l'ordre recommandé : A4B3-Q6 (la ligne
    d'en-tête et les noms des colonnes du fichier de l'ancien logiciel, ouverte) ; puis A7 (la facture fige ses mentions
    — l'unité, la référence et l'article sur la ligne enregistrée, le contact d'où vient son client, le RIB et les
    conditions en vigueur, le logo qu'elle imprime, les autres mentions de R123-237 (A5-Q9) —, une migration) ; la liste
    des clients sans activité depuis trois ans, qui lit les factures d'un contact (A7 les relie) ; la suite du premier
    groupe, dont A9, la numérotation (MEG1-Q5 : deux séries par dossier, celle du client et celle du mandataire, choisie
    selon qui valide, et la série de l'ancien logiciel qui continue ; rien n'en est écrit) ; les devis (P5) ; P1-trace.
- **Bilan** (ligne 33) : restent l'affectation du résultat d'une société, la forme juridique du dossier (posée par A5b2,
  que le bilan lira : 33-Q6), l'impôt sur les sociétés, l'inventaire (35), les stocks (36), puis la liasse 2033 (37) ;
  sur l'ouverture, un écart retient la validation de N (O33-Q1, à écrire) et confronter une balance reprise (O33-Q2,
  plus tard) → « LE BILAN SE LIT DANS LES RUBRIQUES DU 2033-A », « L'OUVERTURE CONFRONTÉE AU BILAN QUI LA PRÉCÈDE ».
- **Plan comptable personnalisable** (ligne 43, étapes PC1 à PC9) : PC1, PC2 et PC3a en ligne, NEUTRES (le plan de
  chaque dossier est vide) ; restent la § 2.4 et la § 2.5 (les emplois comptés par `comptesEnDur.test.ts`) et les
  libellés du plan (§ 3.9), puis PC3b, l'assistant ; PC4, la fonction qui réglera le plan, déplace le compte des notes
  de frais du dirigeant dans la même transaction (PC3-Q1) ; PC6 range les comptes ouverts par une balance reprise ; puis
  la suite jusqu'à PC9 → « LE PLAN COMPTABLE PERSONNALISABLE : LA CONCEPTION », « L'APPLICATION LIT LE PLAN ».

## Feuille de route — page Notion à tenir à jour

La feuille de route vit dans Notion, pas ici : « jd-precompta — état des lieux et route vers le cabinet autonome »
(https://app.notion.com/p/3df6a715e8ad81148546d58c449c593a), base inline « Feuille de route — du premier commit au
cabinet autonome », triée par `Ordre` : le livré (phase 0), puis le restant dans l'ordre de ses dépendances (phases 1 à
7).

- **Chantier terminé** : `État = Fait`, `Effort = Fait`, `Phase = 0 — Livré`, et `Quand / ce qui bloque` complété (la
  date, ce que le travail a changé, coûté ou révélé). Les autres lignes gardent leur `Ordre`.
- **Une ligne dit l'état et ce qui reste, en résumé** ; le récit va dans HISTORIQUE.md, jamais dans la ligne (décision
  du cabinet du 18/10/2026, qui a fait résumer les longues lignes, leurs étapes restantes intactes).
- **Un chantier apparu en route reçoit sa ligne** (souvent un défaut trouvé en passant), avec sa case « Hors BNC ».
- **Deux barres d'avancement en tête de page**, recomptées dans la même édition que la ligne, par une requête sur la
  base (`GROUP BY "Phase", "État"`), jamais de tête : la part des lignes à `État = Fait` parmi celles qui ne sont pas en
  phase « 7 — Hors d'atteinte » ; puis la même sans les lignes `"Hors BNC" = '__YES__'` (celles qui ne servent qu'aux
  dossiers BIC / IS — la case porte la décision, pas la phase). Dix cases, une 🟩 par dizaine faite, arrondie au plus
  proche. Une ligne vaut une ligne : la barre compte des chantiers, pas du temps, et la phrase sous elle le dit.
- **Installation sur site : en attente** (décision du cabinet du 25/09/2026, sous-page « Rester migrable vers une
  installation sur site ») : ne pas ouvrir ce chantier en passant (pas de module OCR ou LLM commun, pas de file
  d'attente, pas de SMTP). Seule exception admise : une fonction redéployée pour une AUTRE raison peut passer son
  domaine, son modèle ou sa région en variable d'environnement.

## Problèmes connus importants

### Advisors Supabase — ne pas repartir en chasse à chaque audit → « Les advisors de sécurité Supabase »

- `auth_leaked_password_protection` : réservé au plan Pro (organisation `dloewvpmposfbvdwtqfz` en free). Réglable
  gratuitement : longueur minimale et classes de caractères des mots de passe.
- `anon_/authenticated_security_definer_function_executable` : vérifiés bénins par impersonation. Chaque fonction
  `SECURITY DEFINER` qui écrit contrôle l'accès avant toute lecture ; `garder_*`, `prochain_numero_facture` et
  `attribuer_numero_facture` ne sont exécutées par aucun rôle ; une lecture ne rend que ce que son essai vérifie. À
  revérifier : qu'une NOUVELLE fonction `SECURITY DEFINER` n'écrive pas sans contrôle interne.
- `rls_enabled_no_policy` sur `super_admins`, `superpdp_credentials`, `facture_numerotation`, `connexions_bancaires`,
  `connexions_plateformes` : volontaire. `function_search_path_mutable` sur `retour_declencheur` : bénin (`immutable`,
  ne nomme aucun objet).

### Base de données et schéma

- **Un export de schéma n'est pas un schéma** : des objets créés hors migration vivent dans `socle/`, que `socle.py` et
  `inventaire.py` comparent au catalogue ; la procédure qui rejouerait l'export n'a jamais tourné (ligne 20.6, sans
  urgence) → « UN EXPORT DE SCHÉMA N'EST PAS UN SCHÉMA ».
- **Une colonne GÉNÉRÉE ne se restaure pas, elle se recalcule** (`COLONNES_GENEREES`, `planReinsertion`) ; une empreinte
  qu'une GARDE vérifie reste une colonne ordinaire → « UNE COLONNE GÉNÉRÉE NE SE RESTAURE PAS, ELLE SE RECALCULE ».
- **La sauvegarde a deux formats** (`VERSION_SAUVEGARDE`) : 1, les lignes ; 2, plus les logos des factures (`fichiers`,
  chacun vérifié par son empreinte) ; un format 1 se restaure toujours, un plus récent se refuse à la LECTURE → « LE
  LOGO DES FACTURES DANS LA SAUVEGARDE ».
- **Ce qui doit être tout ou rien vit dans une fonction SQL** (`SECURITY DEFINER`, accès vérifié, colonnes énumérées).
  Le TypeScript testé n'est pas réécrit en SQL, sauf quand la base doit VÉRIFIER une écriture : même calcul, en entiers,
  confronté à une table relevée en base.
- **Un index unique PARTIEL ne peut pas être visé par un upsert** : contraintes TOTALES, `nulls not distinct` quand deux
  NULL doivent se heurter → « Un index unique PARTIEL ».
- **`ON DELETE SET NULL`** : adjugé relation par relation, les liens qui mentiraient gardés par un contrôle ; une
  restauration qui sacrifierait un lien le dit (`LienPerdu.effacable`) → « LA FAMILLE `ON DELETE SET NULL` EST CLOSE ».
- **`dossier_id` NULLABLE** sur `categories` et `natures_immobilisation` : une ligne à `dossier_id` nul est COMMUNE À
  TOUS LES CABINETS, écrite par le super-administrateur seul (sinon écartée SANS LEVER) ; jamais `WHERE dossier_id = ?`
  seul (`lib/categoriesCommunes.ts`) → « CINQ DÉFAUTS RELEVÉS EN CONCEVANT LE PLAN COMPTABLE PERSONNALISABLE ».
- **`id` n'est pas la clé primaire partout** (`CLES_PRIMAIRES`) ; une table auto-référencée se restaure en deux passes
  ou par vagues ; le plan free n'a AUCUNE sauvegarde automatique.
- **Une table préparée et non appliquée se déclare au plan de sauvegarde derrière son drapeau** (`*_PREVU(E)S`,
  `auPlanAujourdHui`) : la lire avant sa migration ferait échouer toute sauvegarde → « LES DEVIS, EN BASE ».
- **Un type de `types.ts` décrit la table**, NOT NULL compris — et les déclencheurs comptent (`dossiers` remplit
  `cabinet_id` et `code_email` s'ils sont nuls).
- **Un drapeau qui attend une migration se bascule d'abord en SIMULATION** (le fichier posé dans l'export, le drapeau
  levé, la suite ENTIÈRE). Une réplique se monte en UTF8 ; un ordre de texte qu'une fonction ou un essai doit tenir
  s'écrit `collate "C"` → « LA BANQUE DU CLIENT EN BASE ».

### Lectures et écritures Supabase

- **Une écriture est vérifiée**, jamais supposée réussie : `{ error }` lu et DIT (`ecrituresVerifiees.test.ts`,
  `edgeFunctionsEcritures.test.ts`) ; un `return` seul en fin de ligne JETTE l'écriture qui suit → « LES ÉCRITURES DU
  NAVIGATEUR LISENT LEUR ERREUR ».
- **Un lot d'insertion nomme l'UNION des clés de ses lignes** (NULL dans ce qu'une ligne omet) : la restauration
  n'envoie que des lots de même forme (`lotsDEcriture`) → « UN LOT D'INSERTION NE MÊLE PLUS DES LIGNES DE FORMES
  DIFFÉRENTES ».
- **Qui prend `data` prend `error`** ; un échec tombe du côté FERMÉ. **Le vide est une AFFIRMATION** : il ne se dit que
  d'une liste lue en entier et revenue ; avant, « Chargement… », et ce qui s'en calcule attend ; une clé qui change
  repart en chargement (`ecransAvantLecture.test.tsx`, `clientRetenu.ts`) → « AUCUN ÉCRAN N'AFFIRME LE VIDE AVANT
  D'AVOIR LU ».
- **Une lecture partielle — ou pas encore revenue — se SIGNALE et ne COMMANDE aucune écriture**
  (`BandeauLecturePartielle`) ; le second garde d'`ecransAvantLecture.test.tsx` tente chaque geste sans réponse revenue
  → « ET UNE LECTURE PARTIELLE COMMANDAIT ENCORE DES ÉCRITURES », « UNE ÉCRITURE COMMANDÉE PAR UNE LISTE PAS ENCORE
  REVENUE ». **Lecture → formulaire → écriture de tous les champs** : une lecture ratée n'offre AUCUN formulaire → « ET
  LA MÊME LECTURE SERT À REMPLIR UN FORMULAIRE ».
- **PostgREST plafonne les lignes rendues sans le dire** : toute collection passe par `lireTout` (`count: 'exact'`, tri
  TOTAL terminé par la clé primaire ; `lecturesPaginees.test.ts`, `lecturesSignalees.test.ts`) → « Et la TABLE se pagine
  aussi ». **Une lecture que deux écrans comptent s'écrit une fois** ; un compte ne se dit que de listes TOUTES lues en
  entier. **Une liste plafonnée dit qu'elle l'est** (`tronque`).
- **Stockage** : tout retrait par `retirerFichiers` (journalise, ne lève jamais) ; `list()` se pagine ; la suppression
  d'un dossier rend un bilan ; celle d'un cabinet laisse encore son logo PUBLIC orphelin (ligne 22.61) → « LA QUESTION
  QUI DÉCIDE N'A JAMAIS ÉTÉ POSÉE DU STOCKAGE ».
- **Les bornes des seaux** (`lib/bornesStockage.ts`) : tout dépôt passe par un `preparer…` : le type décidé par
  l'application (jamais `file.type`) et la taille jugés AVANT l'envoi, un Blob RÉÉTIQUETÉ ; pièces PDF, JPEG, PNG, CSV,
  20 Mio ; packs ZIP, XLSX, 50 Mio ; logos PNG, JPEG, WebP, 500 Kio, jamais de SVG ; `ventes` PNG ou JPEG, 500 Kio ; les
  mêmes en base (`bornesStockage.test.ts`, `depotsDansLesSeaux.test.ts`) → « LES BORNES DES SEAUX DU STOCKAGE ».
- **Une pièce jointe écartée se dit** : un `upsert` qui ne fait rien sur la clé (l'empreinte des identifiants Resend),
  jamais le nom, l'expéditeur ni l'objet ; raisons format, poids, `depot` (toute autre perte), `vide` ; « vue » par
  `marquer_pieces_jointes_vues` seule, l'insertion de restauration au super-administrateur ; le journal compte, ne
  recopie rien ; l'adresse de collecte ne se compose que dans `lib/adresseCollecte.ts` → « UNE PIÈCE JOINTE ÉCARTÉE À LA
  RÉCEPTION PAR E-MAIL SE DIT AU CABINET ».
- **Une suppression se confirme, et la confirmation NOMME ce qu'on perd** → « UNE SUPPRESSION SE CONFIRME ». En lot, la
  ligne d'abord, le fichier seulement si la base a RENDU la ligne (`.select('id').maybeSingle()`), le bilan dit
  (`lib/bilanSuppression.ts`).
- **Un fichier s'ouvre par `lib/apercu.ts` seulement** (pas de `noopener`, retour de `window.open` lu) → « UN BOUTON QUI
  OUVRE UN FICHIER ».

### Edge Functions : déploiement, clés, copies

- **`verify_jwt`** : `deploy_edge_function` le REMET à `true` si on l'omet ; toujours la valeur de
  `supabase/config.toml` (`configFonctions.test.ts`) ; `receive-email` à `false` → « ET DÉPLOYER PAR L'OUTIL MCP REMET
  `verify_jwt` ».
- **Un déploiement se vérifie** : la copie déployée comparée au dépôt AVANT d'écraser, puis `allerretour.py` ; l'outil
  décode les `\uXXXX` → « Déployer une Edge Function via l'outil MCP décode les échappements » ; les bordures `─`
  répétées d'abord par `bordures.py`, le texte ENVOYÉ relu dans le journal → « LES BORDURES SE RECOPIENT ». **Un commit
  n'est pas un déploiement, un déploiement n'est pas une autorisation** ; `bright-task` (410, hors du dépôt) : à
  supprimer quand un outil le permettra, ne pas réenquêter → « UN DÉPLOIEMENT N'EST PAS UN COMMIT NON PLUS ».
- **Clés de Supabase** : les historiques sont quittées ; le bloc `cleSupabase` lit les nouvelles ; une fonction appelée
  sans session passe à `verify_jwt = false` avec son propre contrôle → « LES CLÉS HISTORIQUES DE SUPABASE SONT
  QUITTÉES ». **`extract-piece`** : un compte RATTACHÉ ou la clé secrète en `apikey`, avant le corps ; l'inscription
  publique est fermée → « ET LA FONCTION DE LECTURE ÉTAIT OUVERTE ».
- **`evaluer-extraction` facture seulement dans sa fenêtre datée** (`ESSAI_OUVERT_JUSQU_A`) : commiter APRÈS la
  fermeture (`categorisationIaCopie.test.ts`) → « LE HARNAIS DE MESURE ÉTAIT UNE PORTE PUBLIQUE ». **Un corps mal
  formé** se refuse en 400 français avant toute dépense ; un journal ne recopie pas la réponse illisible d'un modèle.
- **Le mur d'une fonction est à 150 s** (`extractPieceBudget.test.ts`) ; Textract se pagine (`NextToken`) ;
  `tsconfig.edge.json` ne garantit que le CODE MORT.
- **Copies gardées** (un garde par bloc, dont `historiqueDuClient`, seule barrière entre le fil du navigateur et le
  modèle) → « ET LE SEUL INVARIANT DE SÉCURITÉ DU DÉPÔT ». **Chaque Edge Function s'appelle en HTTP dans la suite** : sa
  vraie source devant un monde factice (`fonctionsEdge.ts`, `contratsFonctions.ts` : aucune dépense avant un refus, ni
  secret ni valeur de pièce au journal) ; `DEFAUTS_CONNUS` au nombre près → « LES EDGE FUNCTIONS S'APPELLENT EN HTTP ».

### Scanners de source : la doctrine

- **Une liste d'inclusion tenue à la main ne contient que ce à quoi on a pensé** : un scanner part de TOUT ; une forme
  non reconnue est une faute ; une exception porte sa raison ET un nombre ; un plancher distingue « zéro faute »
  d'« aveugle ».
- **Lire l'EXPRESSION, jamais la ligne** ; un corps s'arrête au `.from(` suivant. Chaque scanner est éprouvé par un
  défaut PLANTÉ et par mutation. Le scanner voit qu'on CALCULE, le compilateur (`noUnusedLocals`) qu'on LIT, le test
  d'écran que ça ATTEINT l'opérateur.
- `npx tsc --noEmit` ne vérifie rien ici : `npx tsc -b`. `cmd | tail && echo OK` ment : lire `${PIPESTATUS[0]}`. Une
  phrase qui annonce un test nomme son fichier, et le test existe → « UNE PHRASE QUI ANNONÇAIT SON PROPRE TEST ».
- **Chercher toutes les copies avant de corriger la première** (`depot.ts`, `importFichiers.ts`, Edge Functions
  comprises) : chercher la VALEUR. **Le nom `notes` est réservé** (`notesInternesEcritures.test.ts`).

### Dates et fuseaux

- **Calendrier civil** (`lib/format.ts`) ; un `created_at` est un INSTANT ; jamais `toISOString().slice(0, 10)` sur
  « maintenant » (`datesUtc.test.ts`) ; côté Edge Functions, le jour de Paris par `Intl` → « ET CETTE RÈGLE-LÀ N'ÉTAIT
  GARDÉE PAR RIEN ».
- **`formatDate` discrimine sur la FORME** ; jamais `new Date(v).toLocale…String` sur une valeur
  (`datesAffichees.test.ts`) → « UNE DATE CIVILE N'A PAS DE FUSEAU ». **« Maintenant » ne se lit jamais au chargement
  d'un module** (`maintenantFige.test.ts`) → « LU AU CHARGEMENT D'UN MODULE EST FIGÉ ».
- **Annualiser** : diviser par les mois RÉELLEMENT écoulés, refuser sous un mois → « ET LE MÊME ÉCRAN DIVISAIT PAR LE
  NUMÉRO DU MOIS ». **Au 1er janvier on réclame encore l'exercice précédent tant qu'il n'est pas CLÔTURÉ** → « ET AU 1ER
  JANVIER, LES TROIS ÉCRANS ».
- **`parseDate`** relit sur le calendrier civil ; `toIsoDate` garantit quatre chiffres et refuse le futur → « Le dernier
  recours de `parseDate` ». **Le calendrier fiscal** (`lib/echeancesFiscales.ts`) se lit À PARIS, sur les onze jours
  fériés, la CFE reportée au premier jour ouvré. **Un test de date choisit son fuseau** ;
  `vi.useFakeTimers({ toFake: ['Date'] })` seulement.

### Écrans : verrous, courses, signaux

- **Un verrou d'exécution est un `useRef`**, posé AVANT le `try`, relâché dans un `finally` (après la relecture), sous
  un nom à lui ; deux clics dans le MÊME `act` (`verrousExecution.test.ts`) ; toute fonction d'écran qui écrit passe un
  verrou ou une enveloppe (`sousVerrou`, `agir`) (`verrousEcritures.test.ts`) → « Un verrou d'exécution est un
  `useRef` », « LES GESTIONNAIRES D'ÉCRITURE SANS VERROU ».
- **Une lecture plus lente écrit en dernier** : le drapeau d'annulation se pose avant la première écriture → « UNE
  LECTURE PLUS LENTE ÉCRIT EN DERNIER ». `AuthContext` ne relit les rôles qu'au changement d'IDENTIFIANT → « UN RETOUR
  SUR L'ONGLET RECHARGEAIT ». Banque : un seul verrou de rapprochement (`ecritureEnCours`) → « LE VOLET A OUVERT UNE
  COURSE ».
- **Une recherche filtre l'affichage, jamais un total ni un export** (`recherchesEtTotaux.test.ts`). Un état qui porte
  un sous-ensemble le dit dans son nom → « Un nom qui ment sur son filtre ». Un point de Checklist vérifie que sa cible
  peut MONTRER ce qu'il compte → « Un rapprochement qui hésite dit un symptôme ».
- **Un calcul refait pour chaque mouvement du relevé se mesure** sur un relevé fictif de 3 000 mouvements libres : ce
  qui parcourt le relevé ne se joue qu'après les signaux bon marché, qui ne font que filtrer → « LES CANDIDATS DU
  RELEVÉ ».
- **Un écran de saisie ne choisit pas l'exercice** à la place du cabinet ; un champ devenu sans objet est remis à zéro
  dans la même écriture. **Un lot parallèle réserve l'empreinte** dans un `Set` avant toute attente (`ClientUpload`),
  pas encore d'un lot à l'autre (28.8-ClientUpload, à écrire).
- **Un constructeur de requête n'est pas une promesse** : un module l'ATTEND, et une requête qui lève tombe du côté
  signalé. Les points de la Vue d'ensemble se calculent dans `lib/pointsDeLaChecklist.ts` et se lisent par
  `lib/checklistLecture.ts`, un point écrit `{ id: '…', …, severite: '…' }` (lu comme texte par deux tests) → « L'ÉCRAN
  DE LA RÉVISION ».

### Comptabilité

- **Trois portes vers l'écriture** : `categorie_id`, `compte_comptable`, `poste_2035`, à diagnostiquer ensemble ; une
  valeur par défaut connue s'applique d'elle-même.
- **Chaque mouvement du relevé s'écrit par une fonction SQL qui VÉRIFIE l'écriture composée par l'application**, d'un
  seul tenant ; elle ne supprime, ne juge et ne vérifie que les lignes PROPRES au mouvement, jamais celles d'une facture
  ou d'un encaissement (`lignesPropresAuMouvement.test.ts`) ; ses refus dits avant le clic, dans le même ordre ; les
  règles PROPOSENT, le clic écrit ; un mouvement dont le justificatif est peut-être au dossier n'entre jamais dans un
  lot ; un mouvement classé par ses encaissements de factures, ou réservé à eux (G2), ne reçoit aucun autre classement :
  sa fiche le dit et n'offre que ses gestes à lui (le classer par ses encaissements ou ses contre-passations, retirer ce
  classement, lui rattacher un encaissement ou une contre-passation, contre-passer sur un débit un encaissement
  déclaré ; `lib/mouvementsDesVentes.ts`), aucun lot ne le prend (`horsDesLots`, un paramètre obligatoire de chaque
  plan) et il se compte à part ; un mouvement libre qu'une vente facturée attend peut-être (ses candidats,
  `candidatsDuMouvement`) n'entre dans aucun lot non plus, et le lot des règles le dit « à rapprocher » → « LES RÈGLES
  D'AFFECTATION PROPOSENT », « UN VIREMENT PERSONNEL S'ÉCRIT », « UNE ÉCHÉANCE D'EMPRUNT S'ÉCRIT », « UN MOUVEMENT SE
  VENTILE », « UN VIREMENT RÈGLE PLUSIEURS PIÈCES », « UNE RECETTE DU RELEVÉ D'UN DOSSIER ASSUJETTI », « UNE ÉCHÉANCE DE
  COTISATION RAPPROCHÉE », « UN MOUVEMENT DU RELEVÉ S'ÉCRIT SUR UN COMPTE DE BILAN », « LES FONCTIONS DU RELEVÉ NE
  TOUCHENT QUE LES LIGNES PROPRES AU MOUVEMENT », « LE RELEVÉ RECONNAÎT LES MOUVEMENTS DES VENTES FACTURÉES », « LES
  LOTS DU RELEVÉ ÉCARTENT LES MOUVEMENTS DES VENTES FACTURÉES », « LA FICHE D'UN CRÉDIT CLASSE, RETIRE ET RATTACHE LES
  ENCAISSEMENTS D'UNE FACTURE », « LA FICHE D'UN DÉBIT : L'IMPAYÉ ET LA SOMME RENDUE », « LES CANDIDATS DU RELEVÉ ».
- **Une cotisation payée depuis le compte PERSONNEL** est un apport (PCG art. 1211-10), face au compte du dirigeant, à
  la date saisie, jamais proposée ; un mouvement OU le compte personnel, jamais les deux → « UNE ÉCHÉANCE PAYÉE DEPUIS
  LE COMPTE PERSONNEL S'ÉCRIT ». Les écritures d'inventaire suivent la même règle → « LES DOTATIONS AUX AMORTISSEMENTS
  S'ÉCRIVENT », « L'ACQUISITION D'UN BIEN S'ÉCRIT », « LE FORFAIT KILOMÉTRIQUE S'ÉCRIT », « UNE NOTE DE FRAIS EN
  TRÉSORERIE » ; la 2035 se calcule depuis les sources et se compare aux écritures → « LA 2035 SE COMPARE AUX
  ÉCRITURES ».
- **Le modèle comptable** se règle tant que le brouillon est vide → « LA COMPTABILITÉ D'ENGAGEMENT » ; le lettrage se
  DÉDUIT du rapprochement → « LE LETTRAGE SE DÉDUIT DU RAPPROCHEMENT ». **Ouverture** : une balance reprise contrôlée
  devient les à-nouveaux, une fois ; ensuite seulement après validation du précédent (`soldes_reportes`) → « LA
  VALIDATION D'UN EXERCICE ÉCRIT L'OUVERTURE » ; la reprise ne range que la banque, le 44566 et le 44571, et le dit
  (`compteQueLApplicationEcrit`) → « UNE BALANCE REPRISE DEVIENT LES À-NOUVEAUX ».
- **Un contrôle qui part d'un côté d'une relation ne voit pas l'autre** → « Un contrôle qui part d'un côté d'une
  relation ».
- **Le bilan se lit depuis les soldes** (`lib/bilan.ts`, rubriques du 2033-A-SD) : aucune compensation (le sens jugé
  compte par compte et tiers par tiers), un compte non nommé est « à classer » ; la colonne N−1 est le MÊME bilan
  calculé sur N−1, jamais l'ouverture relue ; l'ouverture se confronte à la clôture précédente
  (`lib/ouvertureConfrontee.ts`) → « LE BILAN SE LIT DANS LES RUBRIQUES DU 2033-A », « L'OUVERTURE CONFRONTÉE AU BILAN
  QUI LA PRÉCÈDE ».
- **La révision** (ligne 41) : décisions par solde, conclusions par cycle, seuil et explications, dossier permanent —
  immuables, qui se REMPLACENT ou se RETIRENT, écrites par leurs fonctions seules sous le verrou de la validation puis
  de la révision ; l'état se DÉDUIT, jamais stocké ; une preuve est PROPOSÉE et dit ce qu'elle n'établit pas ; plusieurs
  relevés au 31 décembre ne s'additionnent jamais ; le seuil est MOTIVÉ par le cabinet, aucune variation n'est dite
  « normale » ; le dossier permanent n'appartient à aucun exercice ; une source citée ne se supprime plus
  (`garder_source_citee`, dit avant le clic) ; l'onglet ne montre rien sur une lecture partielle → « LE MODULE DE LA
  RÉVISION », « L'ÉCRAN DE LA RÉVISION ».
- **Le plan comptable se cite dans sa numérotation du 1er janvier 2026** (le 108 passe au 101) ; une migration appliquée
  garde l'ancien numéro ; le 468 se traitera comme le 467 (Q12) → « LE PLAN COMPTABLE A CHANGÉ DE NUMÉROTATION ». **Le
  plan d'un dossier** : un rôle sans ligne prend le défaut du catalogue (`roles_comptables`), trente-deux rôles depuis
  VF4a, dont les six de la vente facturée, au nom du plan comptable général dans `LIBELLES_COMPTES` (le 706000 et le
  627000 depuis VF4c2, VF4A-Q1 ; les quatre autres depuis VF4c3, VF4C2-Q1) ; aucune policy d'écriture avant PC4 ;
  catalogue hors sauvegarde (`PARENTS_HORS_PLAN_VOULUS`) ; la base et l'application le lisent — plan absent ou
  incomplet, aucun onglet ne se monte —, jamais un compte de rôle en dur (`comptesEnDur.test.ts`,
  `compositionsAuPlan.test.ts`) → « L'APPLICATION LIT LE PLAN ».
- **Montant retenu** : HT pour un assujetti, TTC pour un exonéré (`lib/montantRetenu.ts`) → « HT OU TTC ». **La 2035
  compte une pièce à la date de son PAIEMENT** (`paiementsDesPieces`, entrées obligatoires) → « LA 2035 COMPTE UNE PIÈCE
  À LA DATE DE SON PAIEMENT ». **La CA3** : exigibilité à l'encaissement ou au paiement, arrondi fiscal par ligne,
  aucune somme négative sur un taux ; une déclaration enregistrée écrit sa liquidation → « LA TVA SE LIQUIDE ».
- **Le moteur de la 2035** : une ligne par poste ET par nature, un poste négatif reste négatif, une case n'appartient
  pas à la ligne en face (BH, BJ, BM groupent) ; amortissements en CH ; la CSG-CRDS entière au 108 en trésorerie, 6,8
  points en BV ; le cadre 8 sans l'abattement de 26 % → « Le cadre 8 du 2035-B ». **L'annexe 2035-E** se tire des cases
  à l'euro, rien rempli à la place du cabinet → « L'ANNEXE 2035-E SE TIRE DE LA 2035 DÉPOSÉE ». PDF :
  `Intl.NumberFormat('fr-FR')` casse pdf-lib ; pdf.js vide son tampon (`slice(0)`).
- **Barème kilométrique** saisi par millésime, à TROIS endroits → « Le barème kilométrique est saisi ». **Cotisations
  Urssaf** testées contre le moteur de l'Urssaf → « L'ESTIMATION DES COTISATIONS URSSAF ». **Dotations** : le cumul
  s'arrondit, pas l'annuité ; le compte d'amortissement est 28 + le compte du bien sans son 2 ni ses zéros de fin, à six
  chiffres, un sixième chiffre significatif gardé (218311 → 2818311 ; `amortissements.test.ts`).
- **FEC** : article A47 A-1, jamais exécuté dans Test Compta Demat → « LE FEC SUIT L'ARTICLE A47 A-1 ». **La piste
  d'audit se PRODUIT** ; un CSV porte un BOM UTF-8 et passe par `champCsv` → « Une piste d'audit se PRODUIT ».
- **Rapprochement** : valider automatiquement demande TROIS signaux ; un lot n'écrit que ce qui n'a qu'un candidat dans
  les DEUX sens ; la banque fait foi sous `min(2 %, 5 €)` ; un mouvement n'a qu'un lien
  (`lignes_bancaires_un_seul_rapprochement`) → « LA BANQUE FAIT FOI, MAIS SOUS UN SEUIL ». **Un exercice validé se
  fige** par DÉCLENCHEURS, frontière au 31 décembre, deux sorties seulement (suppression du dossier, restauration) ; une
  échéance de cotisation se fige à la date qui la compte ; préalables dits avant le clic (`prealablesValidation.ts`)
  → « UN EXERCICE VALIDÉ SE FIGE EN BASE ».

### Import, OCR, classification

- **Montants et dates bancaires** : `csv.ts` seul ; le contrôle de solde est CONSERVÉ → « Un relevé ne contient pas que
  des opérations ». **Classification** : le bordereau d'abord, le sens par `orientationDe` → « Le sens d'une pièce est
  décidé par la classification ».
- **Un fournisseur se reconnaît à une clé d'identité** (`cleFournisseur`), mot à mot, jamais par sous-chaîne.
  **« Textract sait le lire » n'est pas « l'application accepte ce fichier »** (`textractPeutLire`) ; une relecture OCR
  ne relit que ce qui manque.
- **Le texte OCR vit dans `piece_textes_ocr`** (doublons par `texte_md5`) ; une date déduite est dite « à vérifier ». Un
  ZIP écrase sans rien dire (`nomUnique`) ; un livrable incomplet le dit.

### Facturation électronique

- **La racine du mandataire (G1.45)** : deux séries par dossier, choisie selon QUI valide (MEG1-Q5) ; rien n'est écrit,
  la série du mandataire vient avec A9 ou avant une facture réelle validée par le cabinet.
- **Pièges EN 16931 / Super PDP** : TVA sur chaque ligne, unité `C62`, n° de TVA du vendeur, `is_valid=false` sur des
  avertissements, SIRET = l'entreprise authentifiée → « Pièges EN16931/Super PDP ». **Le statut de TVA du dossier**
  décide de la mention et du motif → « LE STATUT DE TVA DU DOSSIER ». En franchise ou exonéré, le numéro de TVA tient à
  une case (`numero_tva_attribue`) ; sans elle, ses factures sans TVA ne partent pas (G1.47).
- **Le générateur CII** refuse avant le clic → « LA FACTURE ÉLECTRONIQUE S'ÉCRIT EN CII ». **Une facture validée est
  figée en base** ; la numérotation par `enregistrer_facture` seule → « UNE FACTURE VALIDÉE SE FIGE EN BASE ».
- **Le dépôt** : une seule transmission ACTIVE par facture, RÉSERVÉE avant l'envoi ; une issue inconnue n'est jamais
  réessayée, elle s'abandonne après un quart d'heure (`DELAI_AVANT_ABANDON_MS`) → « LA FACTURE ÉLECTRONIQUE SE DÉPOSE ».
  Une facture rejetée ou refusée ne repart pas : un avoir interne, non transmis ; chez Super PDP, 213 et 501 rejettent,
  202 et la suite acceptent, un rejet l'emporte → « LES ÉCRANS DE LA FACTURE ÉLECTRONIQUE ».
- **Les encaissements** : un REGISTRE, jamais déduit d'un rapprochement, par `enregistrer_encaissement` seule (plafonds
  sous verrou, montants NETS, le TTC par taux refait en base) ; déclaré, il se CONTRE-PASSE (motif obligatoire, datée du
  décaissement) ; jamais déclaré, celui d'une facture source aussi, en citant le débit qui l'a défait, et la paire ne se
  déclare pas (`paireNonDeclaree` → « L'IMPAYÉ D'UN ENCAISSEMENT JAMAIS DÉCLARÉ ») ; aucune écriture directe hors de la
  restauration (`encaissementsEcritures.test.ts`) → « LES ENCAISSEMENTS D'UNE FACTURE ÉMISE ». **Sa fenêtre** juge par
  les fonctions de la vente, identiques à celles d'hier pour une facture qui n'est pas source ; le client ne lit pas les
  exercices validés (`ANNEES_ILLISIBLES`, jamais une liste vide) → « LA FENÊTRE DES ENCAISSEMENTS JUGE UNE FACTURE
  SOURCE ». **Sa déclaration** : sur la plateforme qui a accepté la facture, une seule ACTIVE → « LA DÉCLARATION HORS
  APPLICATION ». **Son message** (`lib/cdarEncaissee.ts`, CDAR D22B) : MDT-74 `false` ; un montant par `centimesExacts`,
  jamais `decimal` ; ce que l'annexe ne dit pas est un paramètre sans défaut → « LE MESSAGE DU STATUT « ENCAISSÉE » ».
- **Le cycle de vie des factures émises** : relevé sur un clic, lu sans jamais deviner (`lib/cdarRecu.ts`), rattaché par
  l'identité de G1.42 (SIREN figé à la validation) — ce qui ne se rattache pas se dit et ne se garde pas ; un 210 ou un
  213 vaut refus ; le 601 se dit, son effet appartient à d6 → « LE CYCLE DE VIE DES FACTURES ÉMISES ». Libellés de la
  DGFiP (`superpdpStatuts.test.ts`).
- **L'e-reporting** : les achats hors de France pour tout assujetti, à partir des factures du 1er septembre 2027, la
  fréquence PROPOSÉE, aucune transmission à blanc → « L'E-REPORTING : L'OBLIGATION DITE JUSTE ». La fiche d'un achat
  hors de France est SAISIE, versionnée (ni la France, ni Monaco, ni l'outre-mer) → « LA FICHE D'UN ACHAT HORS DE
  FRANCE, EN BASE ». Le contenu se calcule (`lib/ereporting.ts`), jamais « rien à déclarer » sur une lecture partielle
  → « LE CONTENU DES DÉCLARATIONS D'E-REPORTING ». Le régime est une donnée confirmée et datée ; une période se juge
  sous celui de son premier jour, refusée à cheval sur deux → « LE RÉGIME D'E-REPORTING CONFIRMÉ ET LA PIÈCE ÉCARTÉE, EN
  BASE ». La déclaration hors application garde le contenu figé et son empreinte ; une rectificative remplace la période
  ENTIÈRE ; une pièce source d'une déclaration active ne se supprime plus → « LA DÉCLARATION D'E-REPORTING HORS
  APPLICATION, EN BASE ». Le fichier FRR se tire du contenu FIGÉ, ses choix incertains en paramètres sans défaut
  (`ChoixFrr`) → « LE FICHIER D'UNE DÉCLARATION D'E-REPORTING ».
- **Réception par la plateforme du client** : le point de reprise ne recule jamais → « LA RÉCEPTION PAR LA PLATEFORME DU
  CLIENT ». **La pièce jumelle** : une facture émise ne compte nulle part, sa vente entre par la pièce qui revient,
  marquée, jamais refusée ; le lien se DÉDUIT, jamais d'un montant, d'une date ni d'un nom → « UNE VENTE PEUT ENTRER
  DEUX FOIS ». **L'exemplaire d'une facture** (`pieces.facture_id`) : la jumelle ou le PDF, DÉSIGNÉ par le cabinet seul
  (`designer_exemplaire_facture`, `defaire_exemplaire_facture`), sur une facture VALIDÉE du même dossier et une pièce de
  VENTE, figé avec la pièce ; la garde refuse toute autre écriture, sauf la restauration ; la quatrième preuve du pont,
  dite la première, sans faire taire les autres ; l'exemplaire d'une facture SOURCE ne compte plus (VF3b), celui d'une
  autre compte comme hier ; à l'écran, la fiche d'une pièce de vente seule, côté cabinet, sur des factures lues en
  entier, et chaque confirmation dit ce que désigner ou défaire change à ce qui se compte — défaire l'exemplaire d'une
  facture source la fait compter deux fois, ce que la base refusera à VF6, une erreur se corrigeant par un seul geste
  (VF6-Q1) → « L'EXEMPLAIRE D'UNE FACTURE, EN BASE », « L'EXEMPLAIRE D'UNE FACTURE, À L'ÉCRAN ». **La source de la
  vente** : le réglage d'un dossier, irréversible dès sa première facture source ; la source fixée à la validation, puis
  figée ; un mouvement qui justifie un encaissement d'une facture source est RÉSERVÉ (G2) et ne se classe que par ses
  encaissements, par le cabinet seul (G1) ; les colonnes des écritures, que seule la fonction de VF4b remplit ;
  `encaissementsFactures.ts` et `sourceDeLaVente.ts` redisent leurs refus → « LA SOURCE DE LA VENTE, EN BASE ». Les
  moteurs la lisent par `lib/ventesFacturees.ts`, une SECONDE forme (la CA3 n'y lit pas les événements de la 2035), en
  paramètre obligatoire : la TVA d'un paiement partiel au cumul, l'exigibilité selon le régime figé sur la facture →
  « LES VENTES FACTURÉES, EN MODULE ». La 2035 la lit depuis VF3b1, la CA3 depuis VF3b2, la situation et l'estimation
  depuis VF3b3 ; depuis VF4c3, la concordance la rapproche des écritures de son encaissement, sur le compte que la
  composition écrit (`compteDuProduit`), et une période qui en porte ne s'enregistre que quand leurs écritures sont à
  jour (`refusDesVentesFacturees`), jamais sur une exigibilité écartée ; les frais d'un mouvement d'encaissements y
  entrent tels que la composition les écrit, sous le poste de « Frais bancaires » (VF4C3-Q1), dans la 2035 comme dans la
  situation intermédiaire (ligne 28.65). L'estimation la reçoit en total hors taxe par mois, ou « non comptées », un
  état que l'appelant choisit et que son écran dit (« Ma simulation », jusqu'à VF8) → « LA 2035 LIT LES VENTES
  FACTURÉES », « LA CA3 LIT LES VENTES FACTURÉES », « LA SITUATION, L'ESTIMATION ET LA SIMULATION LISENT LES VENTES
  FACTURÉES », « LA 2035 ET LA CA3 LISENT LES ÉCRITURES D'UNE VENTE FACTURÉE », « LA 2035 COMPTE LES FRAIS D'UN
  MOUVEMENT D'ENCAISSEMENTS », « LA SITUATION INTERMÉDIAIRE COMPTE LES FRAIS D'UN MOUVEMENT D'ENCAISSEMENTS ». Ses
  écritures se composent dans `lib/ecrituresVentesFacturees.ts`, pur, en centimes, la TVA du module jamais recalculée,
  chaque écriture liée à sa source → « LES ÉCRITURES D'UNE VENTE FACTURÉE, EN MODULE ». Elles ne s'écrivent que par
  `ecrire_vente_facturee`, qui
  les recompose en entiers et les compare en multiensemble, et ne se retirent que par `retirer_ecriture_vente_facturee`
  (la garde G5) ; le compte d'une compensation sans mouvement est une colonne de l'encaissement, choisie par le cabinet
  seul (`choisir_compte_contrepartie`), que le client « Ventes » lit ; un mouvement libéré qui porte encore des lignes
  d'un encaissement se classe, ces lignes intactes : les fonctions du relevé n'en touchent que les lignes propres →
  « LES ÉCRITURES D'UNE VENTE FACTURÉE, EN BASE », « LES FONCTIONS DU RELEVÉ NE TOUCHENT QUE LES LIGNES PROPRES AU
  MOUVEMENT ». Elles se passent depuis la section « Ventes facturées » de l'onglet Écritures, côté cabinet, pour un
  dossier basculé : l'état de chaque source (à écrire, à jour, à réécrire, à retirer, validée, ne s'écrit pas) se
  calcule dans `lib/ecrituresVentesFactureesEcran.ts`, sur des lectures faites en entier dans la même relecture que le
  brouillon ; ces lignes ne sont pas des ruptures de la piste d'audit, dans l'onglet comme dans la Checklist
  (`ligneDUneVenteFacturee`) → « L'ONGLET ÉCRITURES ÉCRIT LES VENTES FACTURÉES ». Le FEC, la piste d'audit et le
  lettrage les lisent depuis VF4c2 : chaque ligne retrouve son écriture composée par sa SOURCE et sa DATE, jamais par un
  montant ni un libellé, et seulement si les lignes de la source à cette date SONT cette écriture
  (`rattachementDesVentes`, `lib/ventesFactureesDesExports.ts`), dont elle prend le journal, la pièce et l'auxiliaire du
  411 ; une ligne qui ne se rattache plus reste hors du FEC, et le badge le dit ; un dossier basculé dont les ventes ne
  sont pas lues en entier n'exporte rien ; la piste d'audit cite la facture et l'empreinte de son exemplaire ou du CII
  transmis, le registre, le relevé ; le 411 se lettre par facture ; jusqu'à VF7, un exercice qui porte ces lignes ne se
  valide pas → « LE FEC, LA PISTE D'AUDIT ET LE LETTRAGE LISENT LES VENTES FACTURÉES ». **Connexion bancaire** : 90
  jours sans nouvel accord → « LA CONNEXION BANCAIRE RÉCUPÈRE ».
- **Les ventes du client** : les essais exigent un client d'essai SANS « Ventes » → « LES VENTES DU CLIENT, EN BASE ».
  **Les devis** : `devis.sql` est la RÉFÉRENCE des refus tant que l'export ne porte pas leurs migrations. **Articles,
  contacts, paramètres** : une ligne, un client de facture gardent leur COPIE ; rien ne se supprime (un contact
  s'efface) → « LES ARTICLES, EN BASE », « LES CONTACTS, EN BASE », « LES PARAMÈTRES DE FACTURATION, EN BASE ». Un prix
  unitaire ne s'arrondit pas en silence (six décimales) → « UN ARTICLE DANS LA FACTURE ». Un contact : ni téléphone ni
  date de naissance ; la règle des soins ne range ni un non-assujetti sans SIREN ni un client établi hors de France ;
  l'import est tout ou rien, chaque ligne par `enregistrer_contact` elle-même → « L'IMPORT D'UN FICHIER DE CLIENTS, EN
  BASE ».
- **L'adresse de réception** est DÉCLARÉE et versionnée ; `etat_facture_electronique` ne rend JAMAIS une adresse de
  service, un identifiant ni un secret → « L'ADRESSE DE RÉCEPTION ET L'ÉTAT DE LA FACTURE ÉLECTRONIQUE, EN BASE ». **Le
  dernier changement du RIB** : jamais le RIB ni l'heure ; le dernier dans l'ordre de la CHAÎNE, jamais des instants ;
  `dossiers_au_rib_a_confirmer` l'APPELLE pour chaque dossier → « LE DERNIER CHANGEMENT DU RIB, EN BASE ».
- **Le logo des factures** : seau PRIVÉ `ventes`, PNG ou JPEG (pas de SVG, qui porte du script) ; aucune mise à jour ;
  un logo qu'aucune version ne désigne reste jusqu'à la suppression du dossier ; les suppressions se jouent sur une
  réplique → « LE LOGO DES FACTURES ET SON SEAU, EN BASE ». La restauration juge chaque fichier AVANT d'écrire, le
  redépose APRÈS les lignes sans écraser, et ne s'arrête jamais → « LE LOGO DES FACTURES DANS LA SAUVEGARDE ».

## Tests

Vitest, posés à côté de leur module ; `tsc -b` les type-vérifie avec le reste.

- **Deux projets** (`vitest.config.ts`) : « logique » (`src/**/*.test.ts`, node) et « écrans » (`src/**/*.test.tsx`,
  jsdom, Testing Library ; `src/test/ecrans.ts` démonte). Un test d'écran garde ce qu'aucun calcul pur ne voit (un
  verrou, un câblage, un bouton, un total) ; tous les onglets et écrans client ont le leur → « La couverture Vitest
  s'arrête à `src/lib` ».
- **Deux `fireEvent.click` de suite ne sont pas un double clic** : les deux dans le MÊME `act`. Un élément qui paraît
  après chargement se cherche HORS de l'`act`.
- **Ce qu'un effet consigne se lit sous `waitFor`** quand le rendu vient de lectures finies hors d'un `act` → « UN TEST
  LISAIT SES RENDUS AVANT LEUR EFFET ».
- **Un faux client APPLIQUE les filtres** qui décident de ce que l'écran voit (`src/test/filtresPostgrest.ts`, qui lève
  sur une forme inconnue), annonce un `count`, et se charge DANS la fabrique de `vi.mock`. Les jeux d'essai sont typés
  `Partial<T> => T`, sans `as`.
- **Un drapeau d'export levé garde son état d'avant éprouvé tant que son code existe** : forcé par `vi.mock`, ou ses
  deux états joués par un accesseur (`get DRAPEAU()`) ; une constante calculée au chargement d'un module se teste par sa
  fonction, état par état.
- **Un module qui redit une fonction SQL** a son test à côté (`<module>.test.ts`), qui le confronte au texte exporté et
  rejoue son essai (`supabase/essais/`) ; une copie d'Edge Function est gardée par un `…Copie.test.ts` (ou
  `copiesFacturation.test.ts`) ; une table au plan derrière son drapeau, par `sauvegarde<Table>.test.ts`.
- **Un module de calcul n'importe jamais `supabase.ts`** (il lève sans variables d'environnement) ; un module couplé se
  teste en simulant le client ; vérifier sans `.env`.
- **Un calcul lourd se paie dans un `beforeAll`, jamais en relevant le délai d'un test** : les gardes de copie compilent
  leurs blocs en UN programme par fichier (`src/test/compilationSeparee.ts`) → « LES GARDES DE COPIE COMPILAIENT DANS
  CHAQUE TEST ».
- **Le fuseau est porté par les scripts npm** (`fuseau.test.ts`) ; `test:fuseaux` rejoue Paris, UTC, New York et
  Auckland ; `tests.yml` tourne sur toutes les branches.
- **Une mutation qui ne mord pas accuse d'abord la mutation, puis le jeu d'essai** ; une suite rouge AVANT la mutation
  fait passer toute mutation pour tuée.
- **Une fonction testée qui a une valeur par défaut mérite son propre test** : le chemin par défaut est l'angle mort.
- **Une modification non commitée se copie HORS du dépôt avant tout harnais qui manipule git** (`git checkout` la
  réécrit, et la suite reste verte, plus courte).

## Commandes utiles

```bash
npm install         # installation des dépendances
npm run dev          # serveur de dev local (Vite)
npm run build        # tsc -b && vite build — build de prod
npm run preview      # sert le build de prod en local
npm run lint         # oxlint
npm test             # Vitest
npm run test:watch   # Vitest en continu
npm run test:fuseaux # la suite sous 4 fuseaux
npx tsc -p tsconfig.edge.json   # type-vérifie les Edge Functions (seul le CODE MORT y est garanti vert)
```

Déploiement du front : automatique sur push vers `main`. Edge Functions et migrations : exclusivement par les outils MCP
Supabase (`deploy_edge_function`, `apply_migration`, `execute_sql`, `query_logs`) ; la CLI Supabase n'est pas utilisée,
et `supabase/config.toml` ne porte que `verify_jwt`.

## Règles importantes pour les futures modifications

- **Délégation aux sous-agents** (`.claude/agents/`, demande du cabinet du 08/10/2026) : la session choisit d'elle-même
  le sous-agent adapté — `architecte` (Opus 5.5) pour tout ce qui touche la structure, la base, la sécurité ou la
  logique métier ; `dev` (Opus 5.5) pour les fonctionnalités ; `retouches` (Sonnet 5.5) pour le cosmétique. En cas de
  doute, l'`architecte`. Demande du cabinet du 11/10/2026 : quatre ou cinq agents au plus en même temps, chacun sur le
  modèle le plus économe qui suffit — `dev` en Sonnet (paramètre `model`) pour un écran dont la logique est déjà en
  module et qui ne touche ni aux droits ni aux calculs, un agent Haiku ou un script pour une exécution mécanique.
  Décision du cabinet du 18/10/2026 : chaque agent tourne à l'effort que sa tâche demande, ni plus ni moins — la session
  passe `effort` à chaque appel : faible pour une exécution mécanique (recopier dans Notion depuis des fichiers, la
  barrière, le banc), moyen pour les retouches et l'intégration de documents, élevé pour les fonctionnalités, les
  conceptions et les relectures, maximal pour la base (migrations, fonctions SQL, RLS, gardes), la sécurité et un défaut
  subtil. Elle dit au cabinet, en une ligne, quel agent elle utilise, et garde l'orchestration : commits, demandes de
  fusion, fusion, déploiements, Notion ; un agent d'exécution mécanique ne rend que les chiffres.
- Avant toute modification de schéma ou de policy RLS, inspecter l'état réel en base (`list_tables`, `execute_sql`) —
  jamais se fier à ce document ou à une session précédente.
- Toute nouvelle table métier d'un dossier suit la convention `admin_du_dossier(dossier_id)`, porte `to authenticated`,
  et est vérifiée par impersonation réelle avant d'être crue.
- Après toute migration touchant une policy, rejouer `supabase/essais/rls.sql` (invariants à 0 en faute **et** toutes
  ses mutations qui mordent) ; la CI n'a pas accès à la base.
- Toute Edge Function reste auto-porteuse ; lit les clés de Supabase par le bloc `cleSupabase` (jamais
  `SUPABASE_ANON_KEY` ni `SUPABASE_SERVICE_ROLE_KEY`) ; une nouvelle clé ne voyage que dans `apikey`, donc une fonction
  appelée sans session d'utilisateur passe à `verify_jwt = false` avec son propre contrôle avant toute dépense.
- Tout déploiement d'Edge Function passe `verify_jwt` EXPLICITEMENT, à la valeur de `supabase/config.toml` (vérifiée
  contre `list_edge_functions`) ; une nouvelle fonction y reçoit sa section avant son premier déploiement. Tout
  `invoke()` passe par `extraireErreurFonction()`, tout `{ error }` par `messageErreur()`.
- **Les normes AFNOR XP Z12-012 et XP Z12-013 ne s'utilisent pas** : leur éditeur interdit, en page de garde, leur
  exploitation par une IA (décision du cabinet du 07/10/2026). Ce qu'on attend d'une plateforme agréée ou d'une facture
  électronique se tire des sources publiques (Légifrance, spécifications de la DGFiP et annexes, artefacts EN 16931 de
  la Commission, documentations des plateformes, RFC), et le code cite la sienne. Une bibliothèque tierce se lit pour
  des noms de champs, jamais pour en copier le code.
- **Ce que le cabinet doit coller ou recopier se donne DANS la conversation**, en bloc de code prêt à coller : il suit
  la session sur iPhone, qui n'ouvre pas les fichiers qu'elle lui envoie. Le bloc va dans le message qui CLÔT le tour :
  écrit entre deux outils, il ne lui parvient pas (21/10/2026). Un fichier peut accompagner le texte, jamais le
  remplacer.
- **Les questions au cabinet ont leur page** : l'artefact privé « Arbitrages du cabinet », une fiche par question avec
  sa recommandation, ses réponses dans la collection `reponses`. À chaque reprise, la session relit cette collection EN
  ENTIER (outil ArtifactData, `list` ; une requête sur des identifiants n'en rend rien) et consigne ce qui a été
  tranché ; une question nouvelle y entre, une question tranchée ailleurs en sort. Son adresse n'entre pas au dépôt
  (public) : `Artifact list` la retrouve par son titre.
- **Quand `apply_migration` attend une confirmation qui n'arrive pas** (un texte qui contient une suppression, même dans
  le corps d'une fonction), on ne contourne pas le détecteur — ni texte réécrit, ni `execute_sql`. Le cabinet colle la
  migration dans l'éditeur SQL de Supabase, dans une transaction, avec la ligne d'historique que l'outil aurait posée
  (`supabase_migrations.schema_migrations` : version, nom, texte) ; puis la session vérifie l'empreinte de l'historique
  (fins de ligne `\r\n` ramenées à `\n`) et rejoue les trois contrôles de l'export.
- **Les outils MCP décodent les échappements `\uXXXX` de leurs paramètres**, `apply_migration` et `execute_sql` compris
  (l'outil d'écriture de fichiers aussi) : un texte SQL qui doit arriver tel quel écrit la barre oblique inverse de
  chaque échappement sous sa forme échappée, `\u005c`, suivie de « u » et des quatre chiffres ; l'empreinte que rend la
  base (la ligne d'historique, la ligne TEXTE d'un essai) le vérifie → « L'ADRESSE DE RÉCEPTION ET L'ÉTAT DE LA FACTURE
  ÉLECTRONIQUE, EN BASE ».
- Tout nouvel onglet de dossier rejoint `TABS_VALIDES` (`DossierDetail.tsx`), `GROUPES_PARCOURS`
  (`lib/ongletsDossier.ts`) et `ICONES_PARCOURS` (`components/icons.tsx`, fermée sur `DossierTab` : sans son icône, il
  ne compile pas) ; `DossierParcours.test.tsx` déroule chaque groupe et ouvre chaque écran.
- Facturation électronique : relire les pièges déjà rencontrés avant de les redécouvrir ; les journaux de production
  font foi en cas de rejet.
- Avant d'élargir le périmètre d'une fonctionnalité en cours de cadrage, le confirmer avec le cabinet. Un advisor au
  rouge n'est pas forcément une action : vérifier d'abord s'il est verrouillé par le plan ou volontaire.
- **Deux sessions ne poussent jamais sur la même branche.** Une session qui travaille depuis une autre machine prend sa
  propre branche.
- **Rien n'attend sur le disque seul** : avant toute attente (une réponse du cabinet, un collage), la session pousse sur
  SA branche ce qui n'est pas commité, même inachevé — le conteneur est repris après une inactivité, et le 19/10/2026
  il a emporté le code de VF2 → « LA SOURCE DE LA VENTE, EN BASE ».
- **`main` reste linéaire** (`git rev-list --count --merges origin/main` = 0) et **protégée** : rien n'y arrive sans une
  demande de fusion, fusionnée en « Rebase and merge » quand `verifier` est vert. **C'est la session qui fusionne**
  (décision du cabinet du 25/09/2026) : elle pousse sur SA branche, ouvre la demande quand la barrière passe en local
  (`tsc -b`, lint, `test:fuseaux`, build), la fusionne quand `verifier` est vert sur la tête, sans conflit ni fil de
  revue ouvert, en passant `expectedHeadSha` ; jamais squash ni commit de fusion. Puis elle vérifie la mise en ligne,
  tient la feuille de route Notion, dit au cabinet ce qui est parti, et réaligne sa branche sur `origin/main` (égalité
  des arbres, `--force-with-lease`). Une fusion refusée se dit ; jamais de contournement. Une branche qui a fusionné
  `main` en elle ne se pousse pas telle quelle : on rejoue ses commits à la suite de `main` et l'égalité des arbres se
  contrôle avant de pousser.
- **La Routine quotidienne `trig_011WworgC5Yw9whbjhNq8WA5` est DÉSACTIVÉE** (25/09/2026, décision du cabinet) : elle
  poussait sur `main` pendant qu'une session travaillait sur sa branche. La réactiver est une décision du cabinet, qui
  dira qui écrit sur `main`.
- Avant de supprimer une table jugée morte, réunir les six preuves : 0 ligne, 0 clé étrangère entrante, 0 vue
  dépendante, 0 déclencheur, 0 fonction qui la nomme (`pg_proc.prosrc`), 0 référence dans le code (front **et** Edge
  Functions) — et distinguer « vide » (rien ne l'a exercée) de « morte » (contournée alors que sa fonctionnalité a
  tourné).
- **Ce fichier reste court** : une entrée nouvelle tient en quelques lignes et renvoie à son récit dans HISTORIQUE.md.
