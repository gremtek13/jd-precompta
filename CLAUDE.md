# CLAUDE.md — jd-precompta

Documentation durable du projet : son état et les règles qui le gouvernent, à tenir à jour au fil des évolutions.

**Ce fichier est rechargé en entier à chaque reprise de la mémoire de travail, des dizaines de fois par jour : chaque
ligne s'y paie autant de fois.** Il a été réduit deux fois à la demande du cabinet : le 08/10/2026 (863 000 caractères,
dont 81 % de récits de débogage, environ 475 000 tokens par reprise), puis le 18/10/2026 (228 000 caractères, 107 000
tokens par reprise). Les textes d'avant sont dans **HISTORIQUE.md**, que rien ne charge automatiquement — le second sous
l'entrée « CLAUDE.MD RÉDUIT UNE SECONDE FOIS : LE TEXTE D'AVANT », et les trois entrées condensées le 06/11/2026 sous
l'entrée « CLAUDE.MD CONDENSÉ : TROIS ENTRÉES D'AVANT ».

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

**Le MVP, fixé par le cabinet le 28/10/2026** : un premier dossier BNC réel — un praticien en trésorerie —, de la pièce
à la 2035 de l'exercice 2026, avec la facturation et le relevé importé par fichier ; l'application prête à recevoir ses
données vers la mi-décembre 2026 (sinon la mi-janvier 2027), la 2035 déposée en mai 2027 par l'expert-comptable, qui
importe le FEC (MVP-D5). La répétition générale rejoue son année 2025 réelle, dans le même dossier (MVP-D7), comparée à
la 2035 déposée (MVP-D6) : ses données entrent vers le 20 novembre, leurs préalables avant. Le praticien valide ses
factures (MVP-D1) ; la caisse entre (MVP-D2), terminée le 04/11/2026 de C1 à C13 — la base, les moteurs, le FEC, les
écrans du cabinet et du praticien, l'assistant —, ses règles sous « La caisse d'un BNC » (Comptabilité, plus bas) → « LA
CAISSE D'UN DOSSIER BNC : LA CONCEPTION », « LA CAISSE : LA SAISIE DU PRATICIEN ET LA PIÈCE RÉGLÉE PAR LA CAISSE », « LA
CAISSE EN PRODUCTION : LES DEUX MIGRATIONS ET LE DRAPEAU LEVÉ », « LA CAISSE ET LE FEC D'UN BNC EN PRODUCTION : LES
QUATRE MIGRATIONS DU 02/11/2026 » ; le plan Pro de Supabase sauvegarde la base chaque jour depuis le 12/11/2026 (MVP-D3,
le geste du cabinet fait ; les fichiers du stockage n'y sont pas : le pack et la copie des fichiers les portent). La case « MVP » de la feuille de route marque les lignes qui y comptent, souvent pour une partie,
et rien d'autre ne passe avant elles → « LE MVP : UN PREMIER DOSSIER BNC RÉEL, VERS LA MI-DÉCEMBRE 2026 ».

## État des données (19/09/2026) — à lire avant tout chiffre

**La base ne contient que des données FICTIVES**, et un seul dossier est vivant : `test` (`001c7ed7`, créé le
16/09/2026). `deltasoins 10`, `2023` et `DARNIS` sont des bacs à sable abandonnés.

- Mesurer sur `test`, jamais sur l'ensemble des dossiers.
- Un défaut trouvé dans un ancien dossier reste un défaut du CODE, mais ne se raconte pas comme un préjudice comptable.
- RGPD.md décrit la FORME de ce que l'application stockera, pas une exposition constatée (son §4).
- Les dossiers de test se suppriment le jour où le premier dossier réel arrive, et les autorisations permanentes de la
  session se resserrent alors (décision du cabinet du 18/10/2026). Ce jour avance vers le 20 novembre (MVP-D6) ; les
  trois dossiers dont 60 des 69 fichiers de `supabase/essais/` se servent restent, `test` compris, avec le compte client
  d'essai, et le quatrième se supprime ce jour-là (MVP-D8) → « NEUF RÉPONSES DU CABINET : VF9CQ1-Q1 ET Q2, MVP-D7 ET D8,
  CAISSE-Q1 À Q4, 28.5E-Q1 ».

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
  dossiers (`lib/listeDossiers.ts`), tronquée ou refusée, le dit ; elle ne montre que les dossiers que le cabinet ouvre
  au compte (`lib/dossiersOuverts.ts`, `admin_du_dossier`), jamais un dossier lu par un seul accès client, dont
  l'adresse directe le dit → « LA LISTE D'UN MEMBRE DE L'ÉQUIPE NE MONTRE QUE LES DOSSIERS QUE LE CABINET LUI OUVRE ».
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
  - `agent-comptable` — assistant IA (Bedrock), v52 depuis le 01/11/2026, plafond de coût mensuel par cabinet ; aucun
    nom de cabinet (`cabinetEnDur.test.ts`), la TVA selon `lib/statutTva.ts` (`agentComptableConsigne.test.ts`) ; devant
    un dossier basculé, une garde provisoire (VF9a), que VF9c a levée — elle ne ferme plus qu'une source des ventes
    illisible → « VF9A, LA GARDE PROVISOIRE DE L'ASSISTANT DEVANT UN DOSSIER BASCULÉ », « VF9C, LES POINTS ET LES OUTILS
    DE L'ASSISTANT » ; une pièce de vente, de tout dossier, sans son client — ni tiers, ni fichier, ni libellé —, par le
    seul passage du bloc PIÈCES DE VENTE (VF9C-Q1) → « VF9C-Q1, AUCUN CLIENT D'UNE PIÈCE DE VENTE AU MODÈLE » ; par le
    même passage, la ligne d'un crédit du relevé sous la date et le montant du mouvement, jamais qui a payé, et une
    ligne rattachée à rien sans libellé ; un débit garde le sien (VF9CQ1), sauf celui qui rend ou défait l'argent d'un
    client, nommé de même (VF9CQ1B) → « VF9CQ1, NI LE LIBELLÉ D'UN CRÉDIT NI CELUI D'UNE ÉCRITURE RATTACHÉE À RIEN AU
    MODÈLE », « VF9CQ1B, LE DÉBIT QUI REND OU DÉFAIT L'ARGENT D'UN CLIENT, SOUS SA DATE ET SON MONTANT ».
  - `create-cabinet`, `delete-cabinet` (super-admin) ; `create-team-member`, `create-client-access`.
  - `extract-piece` — OCR (Textract) puis citation des champs ; réservée à un compte RATTACHÉ et à `receive-email` (clé
    secrète en `apikey`).
  - `receive-email` (webhook Resend, par dossier) ; `send-email` (facture : le cabinet et le client « Ventes », trente
    e-mails par dossier et par jour de Paris pour un client ; relance de pièces : le cabinet seul ; relance d'une
    facture en retard : le cabinet et le client « Ventes » (MEG3-Q3), dans le même plafond).
  - `superpdp-credentials`, `superpdp-sync`, `superpdp-emit` — Super PDP ; le client « Ventes » relie et transmet, la
    réception reste au cabinet.
  - `proposer-categorie` (sur un clic, rien d'écrit) ; `evaluer-extraction` (harnais de MESURE, facturé dans une fenêtre
    datée seulement) ; `taux-change-bce`, réservée à un compte RATTACHÉ comme `extract-piece` (son bloc APPELANT
    recopié, ligne 23.4) → « TAUX-CHANGE-BCE CONTRÔLE SON APPELANT (LIGNE 23.4) ».
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
                  bornesStockage en lecture seule ; logoDesFacturesSuppression, frontiereDesEncaissements et
                  recompositionDesVentes (une batterie tirée d'une graine fixe) sur une réplique seulement ;
                  validationExercice, liquidationTva et factures en UNE transaction (psql -1). Joué en
                  production, un essai ne rend rien qui dépende d'une ligne hors de ses dossiers (pas même un
                  compte : l'écart seul) ; outils/leurre/banc.py le rejoue avec un leurre, sur une réplique, après
                  tout changement d'un essai → « CE QUE RENDENT LES ESSAIS DE LA BASE REJOUÉS EN PRODUCTION ».
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
- **Une facture validée est figée** par la base : un avoir puis une nouvelle facture, jamais en place ; elle fige aussi
  ce qu'elle imprime, des VALEURS lues en base, jamais un texte de l'appelant (A7a, en base depuis le 29/10/2026 → « LA
  FACTURE FIGE SES MENTIONS, EN BASE », « LES DEUX MIGRATIONS D'A7 EN PRODUCTION »). **Doublons** : SHA-256 du fichier
  avant tout dépôt ; l'empreinte du TEXTE OCR attrape deux exports du même document.
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
  suppression de fichier ne se teste pas en SQL : gardée par une lecture du catalogue (RGPD.md §8.6). La base ne
  vérifie pas encore que le chemin d'une LIGNE (`pieces.storage_path`, `documents_divers.storage_path`) commence par
  son dossier, et le client en insère (CFCS-Q1) : tout lecteur qui télécharge ou retire avec les droits du cabinet le
  vérifie lui-même (`lib/cheminDuDossier.ts`, dans `ouvrirApercu` et `retirerFichiers` ; ni barre oblique inversée, ni `%`,
  ni segment `.`/`..`), gardé par le scanner `cheminsDuStockage.test.ts` ; la contrainte en base est préparée
  (`chemin_dans_son_dossier`, par l'outil, zéro ligne fautive le 12/11/2026) → « LE CHEMIN D'UNE LIGNE VÉRIFIÉ PAR CHAQUE
  LECTEUR DU CABINET », « CFCS-Q1 : LE CHEMIN D'UN FICHIER DANS SON DOSSIER, EN BASE ».
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
- **Les droits d'une table que la RLS ne garde pas** (TRUNCATE, TRIGGER, REFERENCES, et MAINTAIN de PostgreSQL 17,
  qu'`information_schema` tait : lire `aclexplode`) : `anon` et `authenticated` n'ont plus, sur les tables de public et
  dans le défaut de `postgres`, que SELECT, INSERT, UPDATE et DELETE — migration `droits_hors_rls`, en production depuis
  le 07/11/2026 (DHR-Q1 (A), collée : le mot `truncate` retient l'outil) ; une table neuve naît ainsi. Le bloc HR de
  `rls.sql` le juge (une régression y est EN FAUTE), `droitsHorsRls.sql` (réplique) tente chaque geste ; LOCK reste ouvert
  par UPDATE et DELETE ; le défaut de `supabase_admin` et le schéma `net` sont hors de portée → « LES DROITS QUE LA RLS NE
  GARDE PAS », « LES DROITS QUE LA RLS NE GARDE PAS, EN PRODUCTION ».
- RLS activée sur toutes les tables. **Les accès clients sont restreints** (dépôt de pièces, pas de montants,
  catégories, packs ni autres onglets) — ne jamais les élargir sans décision explicite. **Trois domaines font
  exception** (décision du cabinet du 09/10/2026, « remplacer MEG ») : les devis, les factures et leur facture
  électronique, la vue de la banque — pour un accès qui en porte le DROIT, tenu en base, jamais par l'écran seul ; le
  client y écrit par les fonctions du cabinet, et une policy qui lui ouvre une lecture se présente au cabinet avant
  d'être appliquée.
- **Les droits sont en base** : `memberships.droit_ventes`, `droit_banque` et `droit_caisse`, faux par défaut, changés
  par `changer_droits_acces` seule, à quatre paramètres (un droit nul y est inchangé ; « Caisse » sur un dossier exonéré
  ou en franchise seulement, `garder_droit_caisse` ; l'onglet TVA dit ce refus avant le clic, `avisDuStatutSousLaCase`,
  C11-Q1, et l'onglet Accès ne coche pas « Caisse » en engagement, l'écran plus strict que la base, C11-Q2) — une
  insertion du cabinet les pose aussi, la policy ne regardant que le dossier ; « Ventes » ne se porte que sur un dossier
  basculé (`garder_droit_ventes`, VF8f, en base depuis le 27/10/2026 : 23514 pour tout auteur, l'insertion du
  super-administrateur exceptée — la restauration) → « « VENTES » NE SE PORTE QUE SUR UN DOSSIER BASCULÉ » ; prédicats
  `client_du_dossier`, `gere_les_ventes`, `gere_la_banque`, `droits_sur_le_dossier`. « Banque » ouvre la banque du
  client ; « Ventes » ses ventes et leurs gestes (un mouvement désigné demande aussi « Banque », le débit qu'une
  contre-passation cite compris → « LA CONTRE-PASSATION NE CITE UN MOUVEMENT QU'AVEC « BANQUE » »), articles, adresse de
  réception, clients, paramètres (un RIB qu'il pose n'est que PROPOSÉ jusqu'à `confirmer_rib`, le cabinet seul) et le
  seau `ventes` (lire, déposer ; jamais modifier ni supprimer) ; « Banque » seul n'apprend du RIB que
  `dernier_changement_de_rib`, jamais le RIB ; l'identité légale, le client ne l'écrit jamais. L'onglet Accès dit ce que
  la base ouvre à la SESSION du client (`ceQueDisentLesCases`, confronté à l'export) → « LES DROITS D'UN ACCÈS CLIENT,
  TENUS EN BASE ». **Un texte libre que le cabinet saisit dans une table qu'un droit du client ouvre le dit dans son
  libellé** (`LIBELLE_*` de `lib/droitsAcces.ts`).
- **Un resserrement vient en dernier** : ce qui s'ajoute, puis la bascule de l'application, puis le resserrement — une
  lecture que la RLS refuse rend ZÉRO ligne sans erreur, et un écran d'avant croirait le relevé vide → « LA BANQUE DU
  CLIENT : LE RESSERREMENT APPLIQUÉ ».
- **Aujourd'hui la restriction est une règle d'ÉCRAN** : la base laisse déjà le client lire les montants de ses pièces
  et les catégories ; un texte du cabinet seul ne se range jamais dans une table que le client lit → « L'ESPACE CLIENT
  DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION ». **Les notes internes** vivent dans `notes_internes`
  (aucune branche client) ; les anciennes colonnes `notes` n'existent plus (P0, collée le 06/11/2026) → « LES NOTES
  INTERNES DU CABINET, HORS DE PORTÉE DU CLIENT », « LES ANCIENNES COLONNES DES NOTES SUPPRIMÉES EN PRODUCTION ».
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
  - « Ma caisse » sous `maCaisseOuverte` : la caisse rejouée sur ce que le client lit, confrontée au total et au solde
    de la base, sinon aucun geste ; aucune catégorie, aucun compte, aucun nom → « LA CAISSE : « MA CAISSE », L'ÉCRAN DU
    PRATICIEN (C12A, LIGNE 26.6) ». Le paiement d'une pièce, dans « Mes pièces » : le sens tiré de la pièce, jamais son
    montant ; ce que le client ne lit pas jugé par la base seule → « LA CAISSE : LE PAIEMENT D'UNE PIÈCE DEPUIS « MES
    PIÈCES » (C12B, LIGNE 26.6) », « LA CAISSE : LA RELECTURE DE C11, C12A ET C12B, ET SES CORRECTIONS (LIGNE 26.6) ».
    « Corriger » un paiement d'un seul geste, cabinet et client (`remplacer_paiement_par_la_caisse`, C12B-Q1) : en
    production depuis le 04/11/2026, `CORRECTION_DU_PAIEMENT_EXPORTEE` levé, son retour un `drop function` ; les mots
    qui disent comment reprendre un paiement vivent dans `motsDuRemedeSelon`, jamais en dur → « LA CAISSE : CORRIGER UN
    PAIEMENT EN ESPÈCES D'UN SEUL GESTE (C12B-Q1) (PRÉPARÉE, PAS APPLIQUÉE) », « LA CAISSE : LA CORRECTION D'UN PAIEMENT
    EN PRODUCTION (C12B-Q1) ». La saisie d'un mois (C12A-Q1) : tout ou rien par `enregistrer_operations_de_caisse`,
    jugée par `jugerLaSaisieDUnMois` sur la caisse rejouée, une recette portant l'ensemble de son jour, sans catégorie,
    taux ni écriture → « LA CAISSE : LA CASE « CAISSE » DITE DANS L'ONGLET TVA, REFUSÉE EN ENGAGEMENT, ET LE MOIS DU
    PRATICIEN (C11-Q1, C11-Q2, C12A-Q1) ».
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
  - « Paramètres » : la validation d'une facture les fige depuis le 29/10/2026, le RIB CONFIRMÉ seul, et l'aperçu les
    imprime depuis A7b → « LA FACTURE FIGE SES MENTIONS, À L'ÉCRAN — ESPACE CLIENT, A7B » ; un RIB proposé retouché par
    le cabinet est confirmé d'emblée, dit avant le clic (`CONSEIL_VERIFICATION_RIB`) → « LES PARAMÈTRES DE FACTURATION,
    À L'ÉCRAN ». « Identité du dossier » : relue après écriture ; un entrepreneur individuel a son capital REMIS À NUL ;
    une colonne absente n'est pas nulle → « L'IDENTITÉ LÉGALE DU DOSSIER, À L'ÉCRAN ».
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
- **La double authentification** (C7, premier temps, 06/11/2026) : une application d'authentification s'inscrit dans
  « Sécurité du compte » (`/securite`, monté dans les deux espaces), et un compte qui en a une vérifiée donne son code à
  la connexion (`CodeDeConnexion`) ; le second temps, préparé le 07/11/2026 derrière ses drapeaux, s'applique en DERNIER
  (`deux_facteurs_exiges` : l'exigence compte par compte, une policy RESTRICTIVE `deux_facteurs` sur chaque table et sur
  le stockage, la pré-requête de PostgREST pour les fonctions `security definer`, le bloc DEUX FACTEURS de quatorze Edge
  Functions ; SEC2-Q1 à Q3) ; une fois appliquée, toute table neuve porte la policy `deux_facteurs` (le bloc DF de
  `rls.sql`) → « LA DOUBLE AUTHENTIFICATION, PREMIER TEMPS », « LA DOUBLE AUTHENTIFICATION, SECOND TEMPS : EXIGÉE EN
  BASE ».
- **Créer un accès ne touche jamais au mot de passe d'un compte existant** (décision du cabinet du 10/10/2026) :
  `compte: "cree"` ou `"existant"` ; d'un compte d'ailleurs, le 409 dit qu'il existe, rien de plus, et l'onglet Accès le
  rattache après une confirmation qui nomme l'adresse (le marqueur, puis le booléen `true` seul), jamais un membre d'un
  cabinet ni un super-administrateur (23-Q2) ; l'équipe n'accueille pas un compte client d'un autre cabinet, sous une
  phrase qui ne le dit pas (23Q2-Q2) ; une lecture qui dit un compte connu lit son erreur (500, rien d'écrit) → « LA
  CRÉATION D'UN ACCÈS NE CHANGE PLUS LE MOT DE PASSE D'UN COMPTE EXISTANT », « UN COMPTE QUE LE CABINET NE CONNAÎT PAS
  SE RATTACHE APRÈS UNE CONFIRMATION », « L'ÉQUIPE N'ACCUEILLE PAS LE CLIENT D'UN AUTRE CABINET ».
- **La règle des mots de passe est celle du tableau de bord** (une minuscule, une majuscule, un chiffre, un symbole ;
  dix caractères, soixante-douze OCTETS au plus : le maximum de bcrypt, que les trois fonctions refusent en 400 français
  avant tout appel) : les quatre écrans en portent un REFLET (`REGLE_DU_MOT_DE_PASSE`), appliqué avant tout appel, et un
  réglage changé se reporte là et dans PLAN_DE_REPRISE.md ; le refus du service se lit au CODE, jamais au statut ni au
  message (`refusDuService`) → « UN MOT DE PASSE REFUSÉ SE DISAIT « UN COMPTE EXISTE DÉJÀ » », « UN MOT DE PASSE DE PLUS
  DE 72 OCTETS SE REFUSE AVANT L'APPEL ».
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
- **La restauration, éprouvée de bout en bout le 09/11/2026** (MVP-D3) : arrêtée après la création du dossier, elle se
  retire sur confirmation, le stockage intact (RESTAU-Q2) ; la sauvegarde dit les connexions, les identifiants Super PDP
  et les compteurs qu'elle ne porte pas (RESTAU-Q3) ; les commentaires se restaurent et une règle du cabinet part avec sa
  catégorie, en production (RESTAU-Q1, Q4) → « RESTAU-Q2 ET RESTAU-Q3 : LA RESTAURATION INTERROMPUE ET CE QUE LA SAUVEGARDE
  NE PORTE PAS », « RESTAU-Q1 ET RESTAU-Q4 EN PRODUCTION ».

## Fonctionnalités actuellement en cours

- **Proposition de catégorie** : à éprouver par un premier clic réel du cabinet.
- **Le cabinet facture ses honoraires** (ligne 47, MVP depuis LM-Q9) : LM1, le dossier du cabinet, préparée le 11/11/2026, à
  coller (`dossier_du_cabinet`, `DOSSIER_DU_CABINET_PREVU` baissé) ; LM4, les lettres de mission et leurs versions figées,
  préparée le même jour, à coller APRÈS LM1 (`lettres_de_mission`, `LETTRES_DE_MISSION_PREVUES` baissé ; l'acceptation en
  ligne prévue et fermée par la base jusqu'à LM-Q10) ; LM8, le dépôt de la facture validée chez le client, préparé à coller
  APRÈS LM7 (`depot_des_honoraires`, `DEPOT_DES_HONORAIRES_PREVU` baissé ; son PDF et son écran restent) ; LM3, la fiche d'un
  client liée à son dossier, sans identité à elle, préparée à coller APRÈS LM1 (`fiche_liee_au_dossier_du_client`,
  `FICHES_LIEES_PREVUES` baissé ; son écran reste) ; LM5-Q2, les missions d'un client lues sans ses honoraires par qui suit son
  dossier, préparée APRÈS LM4 (`missions_du_client`, `MISSIONS_DU_CLIENT_PREVUES` baissé) ; LM6, les lettres au client et R7 déduite, préparée le 12/11/2026 APRÈS B1 et LM4 (`lettres_du_client`, son drapeau baissé) → « LM6 : LES LETTRES DE MISSION DANS L'ESPACE CLIENT (LIGNE 47) », « LM1 : LE DOSSIER DU CABINET, EN BASE », « LM4 : LES LETTRES
  DE MISSION ET LEURS VERSIONS FIGÉES, EN BASE », « LM8 : LA FACTURE D'HONORAIRES DÉPOSÉE CHEZ LE CLIENT, EN BASE », « LM3 : LA
  FICHE DE FACTURATION D'UN CLIENT DU CABINET, LIÉE À SON DOSSIER ».
- **Le départ d'un client** (ligne 44, INAL5, INAL-Q6) : `depart_du_client` préparée le 11/11/2026, à coller — les paquets
  d'archive téléchargés, la conservation dix ans posée et levée par le chef, la suppression gardée ; `DEPART_DU_CLIENT_PREVU`
  baissé ; le paquet d'archive porte aussi la piste d'audit et le PDF de la 2035 (INAL3c, 12/11/2026) ; INAL6, la copie des
  fichiers des dossiers sur un support du cabinet, préparée le 12/11/2026 (`copies_des_fichiers`, `COPIE_DES_FICHIERS_PREVUE`
  baissé), reprise le même jour : un seul ZIP écrit en flux (`lib/zipEnFlux.ts`, CFC-Q1), faite au seul manifeste rechargé
  (`attester_copie_des_fichiers`, CFC-Q2) → « LA COPIE DES FICHIERS REPRISE : UN SEUL ZIP EN FLUX », « INAL5 : LE DÉPART D'UN CLIENT, LES PAQUETS TÉLÉCHARGÉS ET LA CONSERVATION DIX ANS », « INAL3C : LA PISTE
  D'AUDIT ET LE PDF DE LA 2035 DANS LE PAQUET D'ARCHIVE », « LA COPIE DES FICHIERS SUR UN SUPPORT DU CABINET ».
- **Contre-calcul par l'expert-comptable** (ligne 23.3) : quatre dossiers de référence remis (2035, CA3, amortissements,
  bilan 2033-A) ; restent ses chiffres, l'analyse des écarts, puis ses chiffres en cas de référence → « LES DOSSIERS DE
  RÉFÉRENCE ».
- **La 2035 : les cases « dont » et les saisies du cabinet** (01/11/2026, MVP) : 2035S1, S2 et S6 faits sur la réponse (A)
  de 2035S-Q2 à Q5, confirmée par le cabinet le 02/11/2026 pour Q2 à Q4 — BY, BW, BZ et BU d'un poste qui
  les nomme (une seconde case AJOUTÉE, jamais retirée de la porteuse), BT des seules échéances de l'onglet Cotisations (les
  régimes obligatoires, l'écran le dit), DB des indemnités journalières ; une case « dont » plus forte que sa porteuse
  retient la validation (`cases-dont-incoherentes`, 03/11/2026) ; l'appel définitif du même mois remplace, au clic, la
  prévisionnelle qu'aucun paiement ne
  date, et une autre se dit en attention (`lib/previsionnelles.ts`) ; un modèle par millésime, le dernier livré sans le sien
  (`lib/modeles2035.ts`) — 2035S-Q5, contre la recommandation : imprimé sur le dernier millésime, l'avertissement dit à l'écran et sur le PDF ; les quatre postes neufs sont entrés le 01/11/2026 dans les listes fermées du FEC (ci-dessous).
  CC, CL et ses « dont », DE et le reste de DB (2035S3 à S5) : la table `saisies_2035` en production depuis le
  07/11/2026, au plan de sauvegarde (`SAISIES_2035_EN_BASE`), l'écran derrière `SAISIES_2035_EXPORTEES` baissé
  jusqu'à la 2035 déposée (2035S3-Q3) → « LA 2035 : LES SAISIES DU CABINET (2035S3 À S5) (PRÉPARÉE, PAS APPLIQUÉE) »,
  « LES SAISIES DE LA 2035 EN PRODUCTION (2035S3-Q3) » ; 2035S-Q1, regarder d'abord la 2035 déposée, à la répétition
  générale → « LES TROIS POINTS PLAUSIBLES DE LA RELECTURE DE LA 2035 : ÉTABLIS, ET LA CONCEPTION DE LEUR CORRECTION »,
  « LA 2035 : LES CASES « DONT », LA PRÉVISIONNELLE REMPLACÉE ET LE PDF D'UN MILLÉSIME (2035S1, S2 ET S6) »,
  « 2035S-Q5 : LE PDF D'UN MILLÉSIME ABSENT S'IMPRIME AVEC UN AVERTISSEMENT ».
- **Déclarations TNS** (ligne 27) : les médecins de secteur 1 et 2 estimés depuis le 07/11/2026, contre l'oracle ; le
  début d'activité, l'ACRE et le taux dentiste en production depuis le 07/11/2026 (`parametres_des_cotisations`, deux
  tables hors de `dossiers`, que le client lit ; l'estimation les reçoit en entrée obligatoire, sans début d'activité
  elle se tait ; `PARAMETRES_DES_COTISATIONS_EXPORTES` levé ; TNS-Q1, TNS-Q4) → « LES PARAMÈTRES DES COTISATIONS : LE
  DÉBUT D'ACTIVITÉ, L'ACRE ET LE TAUX DENTISTE » ; la retraite des quatre caisses estimée (ligne 27.1), la CIPAV en
  production depuis le 11/11/2026 (`professions_cipav`, `PROFESSIONS_CIPAV_PREVUES` levé) → « LA CIPAV DANS L'ESTIMATION
  DES COTISATIONS », « LE JOUR J DU 11/11/2026 » ; restent hors de l'estimation — revenus de remplacement,
  exonérations, outre-mer (une entrée en base chacun, que le moteur couvre sauf les DROM) ; la régularisation en
  production depuis le 07/11/2026 (`regularisation_des_cotisations` : l'organisme, l'année payée et la nature d'une
  échéance, et la part d'un prélèvement mixte qui régularise l'année d'avant, signée (TNS-Q2-B (B)) ;
  `lib/regularisationDesCotisations.ts`, muet sur ce qu'il ne sait pas ; `REGULARISATION_DES_COTISATIONS_EXPORTEE`
  levé ; TNS-Q2) ; DSCS proposée depuis la ligne 4 de la 2035-A, à confirmer sur une première déclaration réelle ; un
  banc de charge d'une année fictive (`outils/charge/`) mesure les calculs avant les données réelles → « LES
  COTISATIONS : CE QUE LE MOTEUR DE L'URSSAF PERMET D'ESTIMER EN PLUS (LIGNE 27) », « LA RÉGULARISATION DES
  COTISATIONS (LIGNE 27, TNS-Q2) », « LE BANC DE CHARGE D'UNE ANNÉE », « LA RÉGULARISATION ET LES PARAMÈTRES DES
  COTISATIONS EN PRODUCTION (LIGNE 27) ».
- **CFE et CVAE** (ligne 48) : la saisie par exercice de l'annexe (EM, EN, EK, ER, EU, EV, AH, BK ; nul « à saisir »)
  préparée le 11/11/2026 (`saisies_2035e`, `SAISIES_2035E_PREVUES` et `SAISIES_2035E_EXPORTEES` baissés) ; les dates
  d'activité jugées à la main (48-Q6) ; restent le millésime 2027, le plafonnement de la CET (plus tard, 48-Q9) → « L'ANNEXE
  2035-E SE TIRE DE LA 2035 DÉPOSÉE », « LA SAISIE DE L'ANNEXE 2035-E PAR EXERCICE, EN BASE ».
- **Télédéclaration de la TVA** (ligne 28) : étape 2, la transmission par un partenaire EDI — Teledec choisi, qui veut
  voir l'application fonctionner avant d'ouvrir son API ; ASPOne.fr l'autre voie. Rien n'est écrit.
- **Comptabilité d'engagement** (ligne 31) : le change et les frais bancaires à part, préparés le 12/11/2026 derrière
  `ECARTS_DE_REGLEMENT_PREVUS` baissé (`ecarts_de_reglement`, à coller ; CHG-Q1 à Q3) → « LE CHANGE ET LES FRAIS BANCAIRES
  À PART, EN ENGAGEMENT (LIGNE 31) » ; restent les auxiliaires des
  à-nouveaux et des soldes reportés, l'affectation du résultat d'une société, la TVA des livraisons de biens, la liasse
  (2033 ou 2050), les exercices décalés — conçus le 12/11/2026 (`docs/conceptions/42-exercices-decales.md`, EXD-Q1 à
  Q8 ; EXD1, `lib/exercices.ts`, en module : un BNC en trésorerie reste civil ; EXD2, la migration
  `exercices_du_dossier`, préparée, à coller avec EXD3) → « LES EXERCICES DÉCALÉS : LA CONCEPTION (LIGNE 42) »,
  « EXD2 : LES EXERCICES DU DOSSIER, EN BASE ».
- **FEC** (lignes 26.5 et 26.6, étape (e) ; MVP-D5) : les vingt-deux champs d'un BNC en trésorerie et les montants en
  devise, CONÇUS le 31/10/2026 — quatre valeurs lues, jamais devinées, jamais un nom de patient ; six lots, FEC22a à
  FEC22f, dont une migration (FEC22b), préalable à toute validation d'un exercice en trésorerie ; six questions au
  cabinet, tranchées le 31/10/2026 — Q1 selon le logiciel de l'expert-comptable (FEC22-E2), ModeRglt « Banque » pour le
  relevé, NatOp la nature et le poste de la 2035 (« Dépense — Achats »), IdClient le SIREN d'une entreprise, sinon le
  numéro de la facture, Q5 et Q6 à la recommandation —, et quatorze pour l'expert-comptable (FEC22-E1 à E14), à son
  rendez-vous ; FEC22a en module le 31/10/2026 (`lib/champsBncDuFec.ts`) ; FEC22c1, le fichier à vingt-deux colonnes, et
  FEC22c2 (01/11/2026 : la demande de validation porte les cinq clés, une ligne de charge et une de TVA par règlement
  d'une même date, le FEC d'un exercice validé relu des colonnes figées), derrière `CHAMPS_BNC_EXPORTES` baissé, qui ne
  se lève qu'avec FEC22-E2, avec `ECRITURE_PAR_REGLEMENT` de la copie de l'assistant (FEC22c3) ; FEC22b, la migration
  (`champs_bnc_du_fec`), en production depuis le 02/11/2026, `types.ts` basculé ; le 01/11/2026, les quatre postes neufs de la 2035 (2035S1) entrent dans ses listes fermées et
  dans la copie du filet, leurs empreintes et leurs retours suivant en chaîne, éprouvés sur la réplique de FEC22b, et leur
  NatOp porte la nature et le poste ; FEC22C2-Q1 (figer ce choix avec l'exercice validé), tranchée le 02/11/2026 : non ;
  FEC22-Q7, écrite le 02/11/2026 : le libellé d'une vente porte le nom d'une entreprise (le prédicat d'IdClient), sinon le
  numéro de la facture, une pièce de vente « Recette » et sa date, son 411 au compte « Clients divers » ; la règle dans
  `lib/libellesDesVentes.ts`, que garde un relevé de toute la source ; ce qui est déjà au brouillon garde son libellé,
  et rien ne le signale (FEC22Q7-Q1, le 03/11/2026) → « FEC22-Q7 : LE NOM DU CLIENT HORS DES LIBELLÉS D'UNE VENTE »,
  « UNE RÉPONSE DU CABINET : FEC22Q7-Q1 », « LE FEC D'UN BNC EN TRÉSORERIE : LES VINGT-DEUX CHAMPS, LA CONCEPTION », « HUIT RÉPONSES DU
  CABINET : C6-Q1, FEC22-Q1 À Q6 ET FEC22-E », « LES QUATRE CHAMPS DU FEC D'UN BNC EN TRÉSORERIE, EN MODULE (FEC22A) »,
  « LE FEC D'UN BNC EN TRÉSORERIE À VINGT-DEUX CHAMPS, DERRIÈRE SON DRAPEAU (FEC22C1, LIGNE 26.6, ÉTAPE E) », « LES
  QUATRE CHAMPS DU FEC D'UN BNC, EN BASE (FEC22B) (PRÉPARÉE, PAS APPLIQUÉE) », « LE FEC D'UN BNC : LES QUATRE POSTES
  NEUFS DE LA 2035 DANS LES LISTES FERMÉES (FEC22B ET LE FILET) », « LE FEC D'UN BNC : LA DEMANDE DE VALIDATION PORTE
  SES CLÉS (FEC22C2, DERRIÈRE SON DRAPEAU) », « LA CAISSE ET LE FEC D'UN BNC EN PRODUCTION : LES QUATRE MIGRATIONS DU
  02/11/2026 », « VINGT ET UNE RÉPONSES DU CABINET (PAGE DES ARBITRAGES, RELUE LE 02/11/2026) ».
- **Ligne 26.6** : reste (e), les vingt-deux champs et Test Compta Demat ; l'opération découverte après coup, conçue
  (B9, l'engagement, reste à l'expert-comptable). Aucun exercice n'est encore validé en base → « L'OPÉRATION DÉCOUVERTE
  APRÈS COUP ». Un dossier ne tient qu'UN compte bancaire : le relevé d'un second ne s'importe pas (doublons écartés en
  silence, ruptures fausses) tant que MCB n'est pas fait — un 512 par compte d'emblée (MCB-Q1 à Q8, 11/11/2026), huit lots ; MCB1, la base
  (`comptes_bancaires`, `compte_bancaire_id`), préparée derrière `COMPTES_BANCAIRES_PREVUS` ; MCB2, l'import par compte
  (`lib/importParCompte.ts` : aucun compte par défaut dès deux, dédoublonnage, recouvrement et suite des soldes par compte,
  un OFX confronté à la fin de son identifiant, une seconde migration préparée), derrière le même drapeau ; MCB3, le rapprochement
  par compte et le virement entre comptes ; MCB4, la suite des soldes, le 31 décembre par 512, les mois manquants et la
  validation par compte (`lib/releveParCompte.ts`), `couverture_du_releve` par compte préparée ; MCB5 (première partie), la jambe
  de banque au 512 du compte du mouvement : les dix fonctions du relevé préparées, à coller (`jambe_de_banque_par_compte`), la
  composition par `lib/banqueDuMouvement.ts` dans la fiche Banque, puis (seconde partie) dans Écritures, Virements,
  Cotisations, le lot des règles et les sept détecteurs (`banques`, paramètre obligatoire ; une banque inconnue ne se juge pas) ; MCB6, la carte « Comptes bancaires » (Informations) et la
  preuve du relevé par compte ; MCB7, « Ma banque » compte par compte (`lib/banqueClientParCompte.ts`, sans nouvelle fonction)
  → « « MA BANQUE » ET « MA SIMULATION » POUR PLUSIEURS COMPTES BANCAIRES (MCB7) », « LA JAMBE DE BANQUE PAR COMPTE BANCAIRE : LES DIX FONCTIONS DU RELEVÉ (MCB5) », « LA JAMBE DE BANQUE PAR COMPTE
  BANCAIRE : LES GESTES HORS DE BANQUE ET LES DÉTECTEURS (MCB5, SECONDE PARTIE) », « LES ÉCRANS
  DU CABINET POUR PLUSIEURS COMPTES BANCAIRES (MCB6) », « LA SUITE DES SOLDES, LE 31
  DÉCEMBRE, LA COUVERTURE ET LA VALIDATION PAR COMPTE BANCAIRE (MCB4) », « PLUSIEURS COMPTES
  BANCAIRES D'UN DOSSIER : LA CONCEPTION », « PLUSIEURS COMPTES BANCAIRES D'UN DOSSIER : D'EMBLÉE, LES LOTS, ET LA BASE
  (MCB1) », « L'IMPORT D'UN RELEVÉ PAR COMPTE BANCAIRE (MCB2) ». L'écriture d'un mouvement que ses encaissements classent porte un libellé composé (« Relevé du
  JJ/MM/AAAA — F… », `libelleDUnMouvementDesVentes`), jamais celui de la banque, qui nomme qui a payé ; un mouvement
  classé hors des ventes facturées porte « Crédit du relevé du JJ/MM/AAAA », ou « Débit du relevé du JJ/MM/AAAA » quand
  il rend ou défait l'argent d'un client (une ligne en classe 7 ou 41, la définition de VF9CQ1B), tout autre débit
  gardant le libellé de la banque (`lib/libellesDuReleve.ts`, JJ1-Q1, le 07/11/2026) ; la piste d'audit suit la même
  règle pour le libellé de la banque, tait le tiers d'une pièce de vente et le client d'une facture qui n'est pas une
  entreprise, et sa colonne du justificatif dit la date de dépôt et l'empreinte, jamais le nom du fichier (JJ1Q1-Q1
  et JJ1Q1-Q2 : le libellé d'une écriture d'achat sans fournisseur lu dit « Pièce du JJ/MM/AAAA ») → « JJ1 : LE NOM
  D'UN PATIENT NE PASSE PLUS AU FEC PAR LE LIBELLÉ DU RELEVÉ », « JJ1-Q1 : LE LIBELLÉ DE LA BANQUE HORS DES
  ÉCRITURES DU RELEVÉ », « JJ1Q1-Q1 : LA PISTE D'AUDIT NE NOMME PLUS UN PATIENT », « JJ1Q1-Q2 : LE LIBELLÉ D'UNE
  PIÈCE SANS FOURNISSEUR NE REPREND PLUS LE NOM DU FICHIER ».
- **Connexion bancaire** (ligne 24) : le prestataire définitif et son contrat ; le chemin du CLIENT, conçu (seul le
  titulaire donne l'accord ; le serveur importe ; étapes P8 et P9) ; la récupération automatique ou au clic (RGPD.md
  §8.8).
- **Clés historiques de Supabase** : reste leur désactivation dans le tableau de bord, un clic du cabinet ;
  `taux-change-bce` n'en dépend plus depuis qu'elle contrôle son appelant (ligne 23.4, à déployer).
- **Les pièces jointes écartées** (ligne 22.7) : reste, sur les comptes réels, la décision sur les éléments de l'e-mail
  qui ne sont pas des pièces jointes — au premier client réel, la session les relève à chaque reprise pendant un mois
  (le journal ne vit qu'un jour), une table des comptes sans nom seulement s'il faut plus de recul (S229-Q3) ; « autre
  disposition » non nul, le filtre des pièces jointes se normalise dans une étape à part (S229-Q4) ; une liste fermée
  d'extensions seulement si ces fichiers font du bruit et si le cabinet la choisit (S227-Q5) → « UNE PIÈCE JOINTE
  ÉCARTÉE À LA RÉCEPTION PAR E-MAIL SE DIT AU CABINET ».
- **Mot de passe oublié** : le premier essai réel du cabinet (iPhone), et celui du lien envoyé depuis l'onglet Accès ; au
  tableau de bord, la longueur minimale à 10 (à relever) et le modèle d'e-mail en français. Un compte dont le dernier
  accès au cabinet a été retiré se rattache de nouveau après une confirmation (23-Q2, écrit le 23/10/2026 ; 23Q2-Q1 et
  23Q2-Q2, écrites sur la recommandation, confirmées par le cabinet le 26/10/2026, avec 23Q2Q2-Q2 ; 23Q2Q2-Q1, écrit le
  26/10/2026 : le client d'un dossier du cabinet n'entre dans l'équipe qu'après une confirmation qui nomme l'adresse, le
  rôle et l'espace client perdu, `create-team-member` déployée le 27/10/2026 (v13), après la page ; 23Q2Q2Q1-Q1, écrit
  le 27/10/2026 sur la recommandation, confirmé par le cabinet le 28/10/2026 ; 23Q2Q2-Q3 — l'équipe ne se modifie que
  par son rôle : la migration `equipe_par_son_role`, appliquée le 27/10/2026 sur l'accord du cabinet) → « UN COMPTE QUE
  LE CABINET NE CONNAÎT PAS SE RATTACHE APRÈS UNE CONFIRMATION », « L'ÉQUIPE N'ACCUEILLE PAS LE CLIENT D'UN AUTRE
  CABINET », « LE CLIENT D'UN DOSSIER DU CABINET N'ENTRE DANS L'ÉQUIPE QU'APRÈS UNE CONFIRMATION », « L'ÉQUIPE NE CHANGE
  QUE PAR SON RÔLE », « LES DEUX MIGRATIONS DE 23Q2Q2-Q3 ET VF8F EN PRODUCTION ».
- **Facturation électronique** (ligne 28.5) : (a) à (c) en ligne, la réception et le dépôt à éprouver sur la plateforme
  réelle d'un client ; (d) « Encaissée » : d1 à d4 en ligne ; d5, le message CDAR, en module (ses quatre choix et MDT-95
  tranchés par le premier essai réel ; le matricule d'une plateforme, une colonne de la connexion) ; d6 reste (les Edge
  Functions qui écriront `transmissions_encaissements`, l'effet du 601) ; d7 en ligne, le premier relevé réel reste à
  faire ; l'essai réel sur le bac à sable de Super PDP. (e) l'e-reporting, onze étapes (le point 15 en hypothèse ;
  E6-Q8 : l'identifiant tiré au téléchargement, donné ensuite à la base, une migration) ; e6b (le bouton qui télécharge
  le fichier, tiré du contenu figé) et e5b2 (un encaissement retiré après la déclaration rend la période « à
  rectifier ») faits le 06/11/2026 derrière `IDENTIFIANT_DU_FICHIER_EXPORTE`, la migration de l'identifiant préparée, à
  coller (E6Q8-Q1) → « LE FICHIER D'UNE DÉCLARATION D'E-REPORTING, À L'ÉCRAN » ; e7a, la facture à un client établi hors
  de France, préparée le 07/11/2026 en base et en module (`facture_internationale` : le pays, le numéro de TVA et le
  régime de l'opération figés, quinze refus à la validation aux mots de `lib/factureInternationale.ts`, une facture sans
  eux validée comme hier ; à coller ; `FACTURE_INTERNATIONALE_EXPORTEE` baissé ; E7A-Q1 à Q4) → « LA FACTURE À UN CLIENT
  ÉTABLI HORS DE FRANCE, EN BASE » ; e7b, l'écran, fait le 10/11/2026 derrière le même drapeau
  (`lib/factureInternationaleVue.ts`) → « LA FACTURE À UN CLIENT ÉTABLI HORS DE FRANCE, À L'ÉCRAN » ; restent e7c (le CII
  et l'e-reporting) ; e8 : les recettes sans
  facture vendues à des particuliers — e7 et e8 se construiront après le MVP, 28.5e-Q1 ; e9 : `fluxEreporting` recopié
  dans `plateforme-agreee`) → « L'E-REPORTING : LA CONCEPTION », « LE FICHIER D'UNE DÉCLARATION D'E-REPORTING », « UNE
  RÉPONSE DU CABINET : 28.5E-Q8 ».
- **Défauts connus des Edge Functions** (0, `DEFAUTS_CONNUS` vide depuis le 12/11/2026, le décompte tenu au nombre
  près) : `taux-change-bce` contrôle son appelant comme `extract-piece`, déployée le 12/11/2026 (v6, par une ligne d'import ; 401 sans session) (ligne 23.4)
  → « TAUX-CHANGE-BCE CONTRÔLE SON APPELANT (LIGNE 23.4) » ; `receive-email` ne journalise plus que des comptes, ni
  objet, ni expéditeur, ni adresse, ni code de collecte (le contrat exige zéro recopie) → « RECEIVE-EMAIL NE JOURNALISE
  PLUS QUE DES COMPTES ».
- **Une vente entrée deux fois ; la facture validée, source de sa vente** (ligne 28.6 ; EC-Q3 a la sienne, la 28.65) :
  CONÇUE le 18/10/2026, LIVRÉE de VF1 à VF9c entre le 18 et le 28/10/2026, toutes ses questions tranchées à la
  recommandation ; aucun dossier n'a encore basculé ; reste VF9d (le pont dans l'assistant) après le MVP, et EC3-Q9 (la
  facture reprise) va à A8. Les règles qui ne sont pas ailleurs dans ce fichier :
  - la bascule se fait par dossier, par le chef du cabinet seul, sans effet rétroactif, irréversible dès la première
    facture source ; un accès « Ventes » en retient la baisse ; la garde date la bascule
    (`ventes_par_les_factures_depuis`) ; la carte « Source des ventes » de l'onglet Informations la dit et l'offre
    (`BASCULE_OFFERTE`, levé) → « LE RÉGLAGE DES VENTES, GARDÉ », « LA BASCULE DES VENTES, À L'ÉCRAN » ;
  - la frontière des encaissements d'une facture source se tient en base pour tout chemin, et le rattachement la juge
    sur le MOUVEMENT (le chèque du 31 décembre se rattache au crédit de janvier) → « LA FRONTIÈRE DES ENCAISSEMENTS, EN
    BASE » ;
  - `valider_exercice` refuse un mouvement réservé, un virement ou un prélèvement sans mouvement, une vente facturée pas
    écrite à jour (recomposée d'un bloc), et les préalables le disent avant le clic aux mots de la base ; l'instantané
    validé (version 2) compte les encaissements d'une ligne de la 2035, la version 1 se relit « — », jamais 0 → « LA
    VALIDATION REFUSE LES MANQUES DES VENTES FACTURÉES », « L'INSTANTANÉ VALIDÉ COMPTE SES ENCAISSEMENTS » ;
  - la validation de l'exercice d'une facture source fige la désignation de son exemplaire, et une telle facture ne
    reçoit plus qu'une première désignation, d'une pièce que rien ne marque → « LE GEL DES DÉSIGNATIONS » ;
  - ni une insertion directe (la restauration exceptée) ni un rattachement ne citent un mouvement classé par ses
    encaissements ; sur un mouvement classé et figé, le super-administrateur non plus → « L'INSERTION DIRECTE D'UN
    ENCAISSEMENT SUR UN MOUVEMENT CLASSÉ PAR SES ENCAISSEMENTS », « LA CONTRE-PASSATION SANS MOUVEMENT SUR UN MOUVEMENT
    FIGÉ » ;
  - le virement mixte — un crédit qui paie une facture source et une facture d'avant la bascule — se classe par ses
    encaissements avec l'exemplaire unique et validé de celle-ci, s'écrit sans sa part et date l'exemplaire
    (`partsEncaissees`) ; la désignation se refuse sous lui (VF5H-Q1), et le registre ne cite plus la facture d'avant
    d'un virement mixte classé → « LE VIREMENT MIXTE — CHANTIER EC-Q3 », « LES REFUS DU REGISTRE POUR LA FACTURE D'AVANT
    D'UN VIREMENT MIXTE » ;
  - la déclaration d'une vente hors des factures, `factures_du_pont`, G3, G4 et le journal des désignations (au cabinet
    seul) sont en base ; « Ma simulation » d'un client « Banque » reçoit les ventes facturées d'un dossier basculé
    → « LA JUMELLE INVERSÉE, EN BASE », « « MA SIMULATION » REÇOIT SES VENTES FACTURÉES ».
  Le récit, étape par étape : « LA FACTURE VALIDÉE, SOURCE DE SA VENTE : LA CONCEPTION », puis les entrées de VF1 à VF9
  dans HISTORIQUE.md (chercher « VF5 », « VF6 »…), et les mises en production → « LES CINQ MIGRATIONS DE VF5H2, VF7 ET
  VF8A EN PRODUCTION », « LES TROIS MIGRATIONS DE VF8E-Q1, VF8E ET VF5H2Q1-Q2 EN PRODUCTION », « LES DEUX MIGRATIONS DE
  23Q2Q2-Q3 ET VF8F EN PRODUCTION ».
- **Bac à sable Super PDP** : l'essai réel de l'émission avec le cabinet.
- **Révision des comptes** (ligne 41, neuf étapes R1 à R9) : R1 à R5 et R7 en ligne ; l'onglet Révision n'a pas encore
  les préalables de la validation ; R6 (Q1 : la révision retient la validation) attend un premier exercice réel révisé ;
  puis R8 (une citation de fichier, `fichier_id`, refusée jusque-là) et R9 → « LA RÉVISION DES COMPTES : LA
  CONCEPTION ».
- **L'espace client, logiciel de gestion du client** (décision du cabinet du 09/10/2026 : devis, factures et facture
  électronique, vue de la banque ; onze étapes P0 à P10) → « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT :
  LA CONCEPTION ». Restent :
  - P1-trace : garder qui a changé les droits d'un accès, et quand — en production depuis le 07/11/2026
    (`TRACE_DES_DROITS_PREVUE` levé, la table au plan de sauvegarde), à l'écran depuis le 10/11/2026 ; l'adresse d'un accès
    retiré (P1T-E2), en production depuis le 11/11/2026 (`ADRESSES_DES_ACCES_RETIRES_PREVUES` levé) → « P1T-E2 : L'ADRESSE D'UN ACCÈS RETIRÉ » ;
  - P4, la mention du mandataire : imprimée sous l'identité de l'émetteur et nommée à la confirmation depuis le
    06/11/2026, le nom du cabinet lu comme la base le lit → « LE MANDAT DE FACTURATION IMPRIMÉ ET NOMMÉ À LA
    CONFIRMATION (P4, LIGNE 51.5) » ;
  - P8 : la connexion bancaire du client ;
  - P5, les devis : EN PRODUCTION depuis le 05/11/2026 (trois migrations, dans l'export) et l'acompte depuis le
    06/11/2026 (`acomptes_des_devis`, collée ; elle remplace `enregistrer_facture`), tous leurs drapeaux levés : la vue
    « Devis » des deux espaces, la réponse, la facture tirée, l'aperçu, l'impression et l'envoi par e-mail
    (`send-email`), la case « Ventes » qui les nomme ; l'émetteur posé du dossier et aucun IBAN imprimé, comme la
    facture (A7) ; un mois de validité proposé, modifiable ; aucun modèle par métier ; une acceptation après la
    validité, sur une confirmation explicite ; un devis refusé ou expiré gardé trois ans, puis proposé à l'effacement,
    jamais effacé seul ; les devis de soins hors de l'application. L'acompte (P5b) — une facture d'acompte, puis une
    finale qui le reprend, la prop `acompte` obligatoire — ne couvre jamais tout le devis ni ne laisse de TVA négative
    (P5B-Q5) ; celui d'un devis de biens ou mixte se refuse, en base comme à l'écran (P5B3-Q1), un versement à venir
    aussi (P5B2-Q1) ; la CA3 date l'acompte de biens à son encaissement, sa part impayée à la livraison de la finale ;
    le CII porte l'acompte en 386, la finale en 380 sous le cadre 4 et un seul BG-3, l'avoir d'un acompte en 503 → « LES
    DEVIS, EN BASE », « LES DEVIS EN PRODUCTION : LA SECONDE MIGRATION COLLÉE ET LES DRAPEAUX LEVÉS », « L'ACOMPTE D'UN
    DEVIS : LA CONCEPTION (P5B) », « L'ACOMPTE D'UN DEVIS EN PRODUCTION : LA MIGRATION COLLÉE ET LES DRAPEAUX LEVÉS »,
    et les entrées « L'ACOMPTE D'UN DEVIS » de P5b2 à P5b5.
  - La suite, en trois parties (« au minimum faire comme le logiciel du client, et aller plus loin ») : le premier
    groupe, A1 à A11 ; la parité, B1 à B9 (achats, notes de frais, analyse, documents du cabinet, trois cases neuves
    « Achats », « Notes de frais », « Documents », le resserrement des pièces) ; « aller plus loin », C1 à C8
    (l'échéancier, l'état du dossier, les situations publiées). Toutes les questions sont tranchées sauf MEG2-Q10
    (combien de temps garder les documents du cabinet et ses demandes), ouverte → « L'ESPACE CLIENT, LOGICIEL DE GESTION
    DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ ».
  - « Aller plus loin », le 06/11/2026 : C1, « Mon échéancier » (à tout accès client, les montants sous « Banque »),
    sans migration ; C2 en production depuis le 07/11/2026 (`phase_des_exercices`, `ETAT_DU_DOSSIER_EXPORTE` levé, C2-Q1
    à Q4) ; C7, son premier temps (Contraintes de sécurité) → « « MON ÉCHÉANCIER » : L'ÉCHÉANCIER FISCAL ET SOCIAL DU
    CLIENT », « L'ÉTAT DU DOSSIER CHEZ LE CABINET, MONTRÉ AU CLIENT ». Préparées le même soir, en production depuis le
    07/11/2026 : C5, les relances d'une facture en retard (pénalités calculées et montrées, jamais facturées ;
    `send-email` v11 et `RELANCES_EXPORTEES` levés le 08/11/2026 ; C5-Q1 à Q3) ; C4a, les
    situations publiées et la case « Comptes » (`changer_droits_acces` à cinq paramètres ; C4A-Q1 et Q2 ; reprise le
    07/11/2026 par B1, elle exige P1-trace, dont la contrainte connaît d'avance les sept cases ;
    `situation_publiee_en_cours` ne répond qu'au cabinet et à l'accès « Comptes » du dossier), et ses écrans, C4b
    (« Publier au client » sous la situation intermédiaire, « Mes comptes » côté client, sous
    `SITUATIONS_PUBLIEES_EXPORTEES`, levé ; C4B-Q1) ; C3, la facture électronique et l'e-reporting en un coup d'œil (la
    fonction de l'état rend l'e-reporting en phases, rien du cabinet au-delà ; en production depuis le 07/11/2026,
    `APERCU_EREPORTING_EXPORTE` levé ; C3-Q1 à Q4) → « RELANCER SES CLIENTS (C5) », « LES SITUATIONS PUBLIÉES, EN BASE
    (C4A) », « LA RELECTURE DE SÉCURITÉ DE C4A ET C5 », « LES SITUATIONS PUBLIÉES, À L'ÉCRAN », « C3, LA FACTURE
    ÉLECTRONIQUE ET L'E-REPORTING EN UN COUP D'ŒIL », « C2 ET C3 EN PRODUCTION », « P1-TRACE, C4A, C5 ET DEVC EN
    PRODUCTION (LIGNE 51.5) ». Sans migration : B9a, « Mon analyse »
    (`/mon-analyse`, avec « Ventes » ou « Banque », l'analyse n'ayant pas de case à elle ; un chiffre muet sur une
    lecture partielle, jamais 0 ; B9A-Q1) ; B9b, le journal de l'espace client reconstitué des colonnes d'auteur, jamais
    un nom (`lib/journalDeLEspaceClient.ts`), et la carte « ce qui a bougé » du cabinet (B9B-Q1 et Q2) ; B9c, sa section
    dans « Mon analyse », chaque évènement sous la case de son domaine relue à la base, « par ton cabinet » là seulement
    où la base garde l'origine (B9C-Q1 et Q2) → « « MON ANALYSE » : LES INDICATEURS ET LES ÉTATS DU CLIENT (B9A) »,
    « « ESPACE CLIENT : CE QUI A BOUGÉ » », « « MON ANALYSE » : CE QUI A BOUGÉ, CÔTÉ CLIENT (B9C) ». Le 07/11/2026 : C6,
    le rapprochement proposé par l'encaissement, sans migration (la carte d'un mouvement réservé dit « proposé par le
    client le … » ; l'encaissement d'une facture d'avant la bascule enregistré avec son crédit propose en tête
    l'exemplaire de la facture, `rapprochementProposeParLEncaissement`, associé au clic du cabinet, et ce crédit sort
    des lots ; C6R-Q1 et Q2) ; B1 préparée (`trois_cases_de_l_acces`, après P1-trace et C4a : `droit_achats`,
    `droit_frais`, `droit_documents`, qui n'ouvrent encore rien, `changer_droits_acces` à huit paramètres ;
    `TROIS_CASES_EXPORTEES` baissé ; B1-Q1 et Q2) ; B2 préparée le 11/11/2026 (`documents_et_demandes` : cinq tables, le seau
    `documents-cabinet`, `DOCUMENTS_ET_DEMANDES_PREVUS` baissé ; B2-Q1 à Q4), ses écrans le même jour derrière le même
    drapeau (B3a : deux sections de l'onglet Documents administratifs, « Mes documents » et « Mes demandes » ; B3b, la
    relance par e-mail, préparée derrière ses drapeaux (sa migration à coller après B1 et B2)) → « B2 : LES DOCUMENTS ET LES DEMANDES DU CABINET, EN BASE », « B3A : LES DOCUMENTS ET LES
    DEMANDES, À L'ÉCRAN » ; B4 préparée le 11/11/2026 (`achats_du_client`, `ACHATS_DU_CLIENT_PREVUS` baissé ; la réception par « Achats » faite le 12/11/2026 dans `plateforme-agreee`, la pièce écrite par le serveur,
    à déployer après B1 → « B4R : LA RÉCEPTION PAR L'ACCÈS « ACHATS » »), ses écrans le même jour derrière le même drapeau (B5 : « Mes achats », la section de
    la fiche d'une pièce d'achat) → « B5 : LES ACHATS DU CLIENT, À L'ÉCRAN » ; B7 préparée le 11/11/2026 (`notes_de_frais`,
    le rôle `personnel` au 421000, `NOTES_DE_FRAIS_PREVUES` baissé ; B7-Q1 à Q4), ses écrans (B8) derrière le même drapeau
    → « B7 : LES NOTES DE FRAIS, EN BASE » ;
    « LE RAPPROCHEMENT PROPOSÉ PAR L'ENCAISSEMENT (C6, LIGNE 51.5) »,
    « TROIS CASES DE PLUS : « ACHATS », « NOTES DE FRAIS », « DOCUMENTS » (B1, LIGNE 51.5) ».
  - Du premier groupe, faits : A1 à A6 (sauf ce qui suit). Restent, dans l'ordre recommandé : A4B3-Q6 (la ligne
    d'en-tête et les noms des colonnes du fichier de l'ancien logiciel, ouverte) ; puis A7, la facture fige ses mentions
    : A7a, la base, EN PRODUCTION le 29/10/2026 sur A7-Q1 à Q3 et A7Q-Q1, tranchées à la recommandation (l'émetteur
    d'une facture validée par un accès « Ventes » est celui du dossier ; aucun texte libre que la facture imprime ne
    porte un IBAN valide ; sans dénomination, un accès « Ventes » ne valide pas) — `mentions_figees` collée par le
    cabinet, puis `iban_hors_des_parametres` par l'outil —, A7b l'écran (le formulaire et l'avoir disent ses refus avant
    le clic et nomment ce qui se fige, l'aperçu n'imprime que ce qui est figé ; `lib/mentionsFigeesVue.ts`), en ligne le
    30/10/2026 ; A7B-Q1 et Q2 le même jour (rien sous le nom d'un entrepreneur individuel ; la mention légale proposée
    ne garde que la TVA quand le dossier a ses paramètres) ; A7B-Q3, le bon de commande d'une entreprise, offert sur la
    facture seule le 06/11/2026 (`DocumentDeVente`, sans défaut) → « LE BON DE COMMANDE D'UNE ENTREPRISE, OFFERT DANS LA
    FACTURE », « LA FACTURE FIGE SES MENTIONS, EN BASE », « LA FACTURE FIGE SES MENTIONS, À L'ÉCRAN — ESPACE CLIENT, A7B
    (LIGNE 51.5) », « LA FACTURE FIGE SES MENTIONS : L'ÉMETTEUR DU DOSSIER ET L'IBAN HORS DES TEXTES LIBRES », « DEUX
    RÉPONSES DU CABINET : A7Q-Q1 ET VF9CQ1B2-Q1 », « A7Q-Q1 : UNE SOCIÉTÉ SANS DÉNOMINATION NE SE FACTURE PAS DEPUIS
    L'ESPACE CLIENT, DANS LA MIGRATION », « LES DEUX MIGRATIONS D'A7 EN PRODUCTION », « QUATRE RÉPONSES DU CABINET : LA
    MIGRATION DE C6 ET A7B-Q1 À Q3 » ; la liste des clients sans activité depuis trois ans et le devis qui cite son
    contact, en production depuis le 07/11/2026 (`DEVIS_CITENT_UN_CONTACT` levé ; DEVC-Q1) ; la suite du premier
    groupe, dont A8, les factures reprises, et A9, la numérotation (MEG1-Q5 : deux séries par dossier, celle du client
    et celle du mandataire, choisie selon qui valide, et la série de l'ancien logiciel qui continue), reconçues le
    06/11/2026, A8-Q1 à Q6 tranchées ; leur base — A8a, A9a, A8b, A8-Q5 — en production depuis le 10/11/2026, les
    lecteurs et le plan de sauvegarde ouverts (`FACTURES_IMPORTEES_PREVUES`, `NUMEROTATION_CONTINUE_PREVUE`,
    `PIECE_D_UNE_FACTURE_REPRISE_PREVUE` levés), la carte de la numérotation (A9b) offerte depuis
    le 11/11/2026 (`CARTE_DE_LA_NUMEROTATION_OFFERTE` levé, A9B-Q0) ; l'encaissement d'une reprise par le client
    « Ventes » (A8C-Q1) et ses pièces citées dans « Ma simulation » (A8Q5-Q2), en production depuis le 11/11/2026 (`reprises_au_client`,
    deux lectures `security definer` ; `REPRISES_AU_CLIENT_PREVUES` levé) ; l'écran d'import
    (A8d2b) et les originaux dans le seau des ventes (A8d2a, `originaux_des_imports`) en production depuis le 11/11/2026
    (`ORIGINAUX_DES_IMPORTS_PREVUS` et `IMPORT_DES_FACTURES_OFFERT` levés, A8D2B-Q3) ; reste la suite → « A8D2A : LES
    ORIGINAUX DES FACTURES REPRISES DANS LE SEAU DES VENTES, EN BASE », « A8D2B : L'ÉCRAN D'IMPORT DES FACTURES
    REPRISES », « LE JOUR J DU 11/11/2026 », « A8C-Q1 ET A8Q5-Q2 : LES FACTURES REPRISES, AU CLIENT (PRÉPARÉE, PAS APPLIQUÉE) », « A8
    ET A9, LES FACTURES REPRISES ET LA NUMÉROTATION QUI CONTINUE », « A8A : LES FACTURES REPRISES, EN BASE
    (PRÉPARÉE, PAS APPLIQUÉE) », « A8-Q5 : LA PIÈCE D'UNE FACTURE REPRISE, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) », « LE JOUR J DU 10/11/2026 : SEPT MIGRATIONS EN PRODUCTION (INAL1, INAL2, PC4, A8A, A9A, A8B, A8-Q5) ».
- **Bilan** (ligne 33) : restent l'affectation du résultat d'une société, la forme juridique du dossier (posée par A5b2,
  que le bilan lira : 33-Q6), l'impôt sur les sociétés, l'inventaire (35), les stocks (36), puis la liasse 2033 (37) ;
  sur l'ouverture, confronter une balance reprise (O33-Q2, plus tard) → « LE BILAN SE LIT DANS LES RUBRIQUES DU
  2033-A », « L'OUVERTURE CONFRONTÉE AU BILAN QUI LA PRÉCÈDE », « UN ÉCART D'OUVERTURE RETIENT LA VALIDATION ». Conçus
  le 12/11/2026, hors BNC, chacun avec ses questions : l'inventaire (`docs/conceptions/35-inventaire.md`, INV1 en module,
  `lib/inventaire.ts`), la liasse, les stocks et l'IS (`37-liasse-2033.md` ; LIA1, LIA3 en module, LIA6 le PDF 2033-SD
  derrière `LIASSE_EXPORTEE` baissé, LIA8 les acomptes et le solde de l'IS au calendrier derrière `CALENDRIER_IS_EXPORTE`
  baissé, la date légale gardée faute de texte qui la reporte, LIA8-Q1), l'affectation et l'approbation (`45-affectation-et-approbation.md`, AFF1 en module,
  `lib/affectationDuResultat.ts`) ; rien n'est à l'écran, et deux migrations sont préparées, à coller dans n'importe
  quel ordre avec MCB5g (INV2 `operations_d_inventaire`, LIA2 `stocks_de_cloture`) → « LES ÉCRITURES D'INVENTAIRE : LA
  CONCEPTION », « INV2 ET LIA2 : DEUX MIGRATIONS QUI SE COLLENT DANS LES DEUX ORDRES (LIGNES 35 ET 36) »,
  « LA LIASSE 2033, LES STOCKS ET L'IMPÔT SUR LES SOCIÉTÉS : LA CONCEPTION », « L'AFFECTATION DU RÉSULTAT ET
  L'APPROBATION DES COMPTES : LA CONCEPTION ».
- **Plan comptable personnalisable** (ligne 43, étapes PC1 à PC9) : PC1, PC2 et PC3a en ligne, NEUTRES (le plan de
  chaque dossier est vide) ; le reste de PC3 le 06/11/2026 — la banque, le report et les tiers du bilan, la révision, le
  libellé et le préfixe de chaque rôle (§ 3.9), le lettrage, l'auxiliaire du FEC et le sens des comptes de tiers, le FEC
  du plan par défaut identique à l'octet (`fecAuPlan.test.ts`) ; PC3b le 07/11/2026, l'assistant lit le plan du dossier
  (`plan_du_dossier` au jeton de l'appelant ; `comptesEnDur.test.ts` : plus aucun emploi hors du catalogue ; les gardes
  de copie sous deux plans) → « L'ASSISTANT LIT LE PLAN DU DOSSIER (LIGNE 43, PC3B) » ; PC4, en production depuis le
  10/11/2026 : `regler_plan_du_dossier` règle le plan entier et déplace le dirigeant avec son rôle (PC3-Q1), les deux
  contraintes devenues des contrôles contre le plan → « PC4 : RÉGLER LE PLAN D'UN DOSSIER, EN BASE (PRÉPARÉE, PAS
  APPLIQUÉE) » ; le dirigeant non associé au 467 ou au 468 (PC4-Q2, `dirigeant_au_468`, en production depuis le 11/11/2026,
  `DIRIGEANT_AU_468_PREVU` levé) ; PC6, la reprise qui propose le plan et range ses à-nouveaux sur lui, préparée le 11/11/2026
  (`plan_depuis_la_balance`, à coller APRÈS la levée de `PLAN_DEPUIS_LA_BALANCE_PREVU` ; tout 512… va à la banque du plan, MCB5g
  l'éclate), son écran (la carte de la balance en deux temps) fait derrière le même drapeau ; restent la levée, le
  déploiement, puis le collage → « PC6 : LA REPRISE PROPOSE LE PLAN (PRÉPARÉE, PAS APPLIQUÉE) », « PC6 : L'ÉCRAN DE LA
  REPRISE QUI PROPOSE LE PLAN (DERRIÈRE SON DRAPEAU) » ; PC5, le modèle du cabinet, préparé le 12/11/2026, par l'outil
  (`modele_de_plan_du_cabinet`, `MODELE_DU_CABINET_PREVU` baissé ; sa carte, « Nouveau dossier » et le bouton d'un dossier
  existant derrière le même drapeau) → « PC5 : LE MODÈLE DE PLAN DU CABINET (PRÉPARÉ, PAS APPLIQUÉ) », « PC5B : APPLIQUER LE
  MODÈLE DU CABINET À UN DOSSIER, À L'ÉCRAN (LIGNE 43) » ; PC7 préparée le même jour (`categories_du_dossier`, la garde de la table ; l'écran et le troisième temps de
  la balance derrière `CATEGORIES_DU_DOSSIER_PREVUES` baissé) → « PC7 : LES CATÉGORIES DU DOSSIER, DONT CELLES DE SA
  BALANCE » ; puis PC8 et PC9, sur décision → « LE PLAN COMPTABLE PERSONNALISABLE : LA CONCEPTION », « L'APPLICATION LIT LE
  PLAN ».

## Feuille de route — page Notion à tenir à jour

La feuille de route vit dans Notion, pas ici : « jd-precompta — état des lieux et route vers le cabinet autonome »
(https://app.notion.com/p/3df6a715e8ad81148546d58c449c593a), base inline « Feuille de route — du premier commit au
cabinet autonome », triée par `Ordre` : le livré (phase 0), puis le restant dans l'ordre de ses dépendances (phases 1 à
7).

- **Chantier terminé** : `État = Fait`, `Effort = Fait`, `Phase = 0 — Livré`, et `Quand / ce qui bloque` complété (la
  date, ce que le travail a changé, coûté ou révélé). Les autres lignes gardent leur `Ordre`.
- **Une ligne dit l'état et ce qui reste, en résumé** ; le récit va dans HISTORIQUE.md, jamais dans la ligne (décision
  du cabinet du 18/10/2026, qui a fait résumer les longues lignes, leurs étapes restantes intactes).
- **La case « MVP »** (28/10/2026) : cochée sur ce qui compte pour le premier dossier réel ; l'encadré « Le MVP » de la
  page de tête dit quelle partie de chaque ligne, et suit chaque changement de la case.
- **Un chantier apparu en route reçoit sa ligne** (souvent un défaut trouvé en passant), avec sa case « Hors BNC ».
- **Trois barres d'avancement en tête de page**, recomptées dans la même édition que la ligne, par une requête sur la
  base (`GROUP BY "Phase", "État"`), jamais de tête : la part des lignes à `État = Fait` parmi celles qui ne sont pas en
  phase « 7 — Hors d'atteinte » ; puis la même sans les lignes `"Hors BNC" = '__YES__'` (celles qui ne servent qu'aux
  dossiers BIC / IS — la case porte la décision, pas la phase). Dix cases, une 🟩 par dizaine faite, arrondie au plus
  proche. Une ligne vaut une ligne : la barre compte des chantiers, pas du temps, et la phrase sous elle le dit. Une
  troisième barre, « Le MVP » (décision du cabinet du 08/11/2026), compte de même les seules lignes cochées « MVP » hors
  de la phase 7, recomptée dans la même édition.
- **Installation sur site : en attente** (décision du cabinet du 25/09/2026, sous-page « Rester migrable vers une
  installation sur site ») : ne pas ouvrir ce chantier en passant (pas de module OCR ou LLM commun, pas de file
  d'attente, pas de SMTP). Seule exception admise : une fonction redéployée pour une AUTRE raison peut passer son
  domaine, son modèle ou sa région en variable d'environnement.

## Problèmes connus importants

### Advisors Supabase — ne pas repartir en chasse à chaque audit → « Les advisors de sécurité Supabase »

- `auth_leaked_password_protection` : l'organisation `dloewvpmposfbvdwtqfz` est au plan Pro depuis le 12/11/2026 ; le
  réglage est un geste du cabinet au tableau de bord (Authentication, protection contre les mots de passe divulgués),
  avec la longueur minimale et les classes de caractères.
- `anon_/authenticated_security_definer_function_executable` : vérifiés bénins par impersonation. Chaque fonction
  `SECURITY DEFINER` qui écrit contrôle l'accès avant toute lecture ; `garder_*`, `prochain_numero_facture` et
  `attribuer_numero_facture` ne sont exécutées par aucun rôle ; une lecture ne rend que ce que son essai vérifie. À
  revérifier : qu'une NOUVELLE fonction `SECURITY DEFINER` n'écrive pas sans contrôle interne.
- `rls_enabled_no_policy` sur `super_admins`, `superpdp_credentials`, `facture_numerotation`, `devis_numerotation`,
  `connexions_bancaires`, `connexions_plateformes`, `originaux_liberes` : volontaire. `function_search_path_mutable` sur `retour_declencheur` : bénin (`immutable`,
  ne nomme aucun objet).

### Base de données et schéma

- **Un export de schéma n'est pas un schéma** : des objets créés hors migration vivent dans `socle/`, que `socle.py` et
  `inventaire.py` comparent au catalogue ; l'export se REJOUE dans une base vide depuis le 07/11/2026
  (`supabase/schema/reprise/rejouer.py`, le socle intercalé objet par objet, PLAN_DE_REPRISE.md §4) et redonne la
  production, `signature.sql` égal sur ses neuf familles ; un écart créé hors migration (`pieces.uploaded_by` nullable)
  vit dans `reprise/ecarts_hors_export.sql` ; à rejouer après chaque lot de migrations → « UN EXPORT DE SCHÉMA N'EST PAS
  UN SCHÉMA », « L'EXPORT REJOUÉ DANS UNE BASE VIDE ».
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
  ou par vagues ; le plan Pro (depuis le 12/11/2026) sauvegarde la base chaque jour, jamais les fichiers du stockage.
- **Une table préparée et non appliquée se déclare au plan de sauvegarde derrière son drapeau** (`*_PREVU(E)S`,
  `auPlanAujourdHui`) : la lire avant sa migration ferait échouer toute sauvegarde → « LES DEVIS, EN BASE ».
- **Un type de `types.ts` décrit la table**, NOT NULL compris — et les déclencheurs comptent (`dossiers` remplit
  `cabinet_id` et `code_email` s'ils sont nuls) ; les quatre colonnes de `cotisations_declarees` posées par la
  régularisation y restent facultatives : une lecture par liste de colonnes distingue l'absente de la nulle
  (`lueAvecSaDescription`).
- **Un drapeau qui attend une migration se bascule d'abord en SIMULATION** (le fichier posé dans l'export, le drapeau
  levé, la suite ENTIÈRE). Une réplique se monte en UTF8 ; un ordre de texte qu'une fonction ou un essai doit tenir
  s'écrit `collate "C"` → « LA BANQUE DU CLIENT EN BASE ». Depuis le 06/11/2026, en PostgreSQL 17 et en ICU `en-US`,
  comme la production (PG 16 ignore MAINTAIN ; en libc, l'ordre des index diffère) → « LA RÉPLIQUE MÈRE EN POSTGRESQL
  17 ». La réplique mère, hors du dépôt, reste ARRÊTÉE et ne se supprime JAMAIS, même pour libérer le disque : on la
  copie (`cp -a`) → « LA RÉPLIQUE MÈRE REMONTÉE DEPUIS LE CATALOGUE ».

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
  d'un dossier rend un bilan ; celle d'un cabinet retire son logo PUBLIC depuis le 04/11/2026, la ligne d'abord, les
  fichiers de son seul préfixe ensuite (ligne 22.61) → « LA QUESTION QUI DÉCIDE N'A JAMAIS ÉTÉ POSÉE DU STOCKAGE »,
  « DELETE-CABINET RETIRE LE LOGO DU CABINET ».
- **Les bornes des seaux** (`lib/bornesStockage.ts`) : tout dépôt passe par un `preparer…` : le type décidé par
  l'application (jamais `file.type`) et la taille jugés AVANT l'envoi, un Blob RÉÉTIQUETÉ ; pièces PDF, JPEG, PNG, CSV,
  20 Mio ; packs ZIP, XLSX, 50 Mio ; logos PNG, JPEG, WebP, 500 Kio, jamais de SVG ; `ventes` 20 Mio, PNG, JPEG,
  PDF, texte brut et CSV depuis le 11/11/2026 (A8d2a), un logo de facture restant PNG ou JPEG, 500 Kio ; les mêmes en base (`bornesStockage.test.ts`, `depotsDansLesSeaux.test.ts`) → « LES BORNES DES SEAUX DU STOCKAGE ».
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
  répétées d'abord par `bordures.py`, le texte ENVOYÉ relu dans le journal → « LES BORDURES SE RECOPIENT ».
  `agent-comptable`, `extract-piece`, depuis le 02/11/2026 `send-email`, `plateforme-agreee` et `superpdp-emit`, depuis
  le 04/11/2026 `receive-email` et `delete-cabinet`, depuis le 11/11/2026 `create-client-access`, depuis le 12/11/2026 `taux-change-bce` ne se recopient plus (de 10 à 300 Ko ; la recopie de l'assistant
  est refusée ou coupée, celle des autres coûtait le fichier entier à chaque fois) : une ligne IMPORTE leur fichier du
  dépôt public à un commit écrit en entier, `allerretour.py` compare le fichier de ce commit au dépôt, et revenir en
  arrière ne change que le commit → « L'ASSISTANT SE DÉPLOIE PAR UNE LIGNE QUI IMPORTE LE DÉPÔT », « L'ASSISTANT ET EXTRACT-PIECE REDÉPLOYÉS
  (V51), CELLE-CI PAR UNE LIGNE QUI IMPORTE LE DÉPÔT », « LA FACTURE : LA MIGRATION EN PRODUCTION (FACTURE-Q1) ». **Un
  commit n'est pas un déploiement, un déploiement n'est pas une autorisation** ; `bright-task` (410, hors du dépôt) : à
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
  dans la même écriture. **Un lot parallèle réserve l'empreinte** dans un `Set` avant toute attente, partagé par TOUS
  les lots de l'écran (`ClientUpload`, un `useRef`), libérée à la fin du dépôt, réussi ou non (`lib/depot.ts`) → « LE
  MÊME FICHIER DÉPOSÉ DEUX FOIS ENTRE DEUX LOTS ».
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
  `candidatsDuMouvement`) n'entre dans aucun lot non plus, et le lot des règles le dit « à rapprocher » ; l'exemplaire d'une
  facture source (G4) n'est la paire, le candidat ni le justificatif d'aucun mouvement, et une pièce de vente que G3
  refuserait ne se valide dans aucun lot (`lib/lotsDeLaJumelleInversee.ts`, paramètres obligatoires) → « LES RÈGLES
  D'AFFECTATION PROPOSENT », « UN VIREMENT PERSONNEL S'ÉCRIT », « UNE ÉCHÉANCE D'EMPRUNT S'ÉCRIT », « UN MOUVEMENT SE
  VENTILE », « UN VIREMENT RÈGLE PLUSIEURS PIÈCES », « UNE RECETTE DU RELEVÉ D'UN DOSSIER ASSUJETTI », « UNE ÉCHÉANCE DE
  COTISATION RAPPROCHÉE », « UN MOUVEMENT DU RELEVÉ S'ÉCRIT SUR UN COMPTE DE BILAN », « LES FONCTIONS DU RELEVÉ NE
  TOUCHENT QUE LES LIGNES PROPRES AU MOUVEMENT », « LE RELEVÉ RECONNAÎT LES MOUVEMENTS DES VENTES FACTURÉES », « LES
  LOTS DU RELEVÉ ÉCARTENT LES MOUVEMENTS DES VENTES FACTURÉES », « LA FICHE D'UN CRÉDIT CLASSE, RETIRE ET RATTACHE LES
  ENCAISSEMENTS D'UNE FACTURE », « LA FICHE D'UN DÉBIT : L'IMPAYÉ ET LA SOMME RENDUE », « LES CANDIDATS DU RELEVÉ », « LES
  LOTS ET LE RELEVÉ ÉCARTENT L'EXEMPLAIRE D'UNE FACTURE SOURCE ».
- **Une cotisation payée depuis le compte PERSONNEL** est un apport (PCG art. 1211-10), face au compte du dirigeant, à
  la date saisie, jamais proposée ; un mouvement OU le compte personnel, jamais les deux → « UNE ÉCHÉANCE PAYÉE DEPUIS
  LE COMPTE PERSONNEL S'ÉCRIT ». Les écritures d'inventaire suivent la même règle → « LES DOTATIONS AUX AMORTISSEMENTS
  S'ÉCRIVENT », « L'ACQUISITION D'UN BIEN S'ÉCRIT », « LE FORFAIT KILOMÉTRIQUE S'ÉCRIT », « UNE NOTE DE FRAIS EN
  TRÉSORERIE » ; la 2035 se calcule depuis les sources et se compare aux écritures → « LA 2035 SE COMPARE AUX
  ÉCRITURES ».
- **La caisse d'un BNC** (ligne 26.6, MVP-D2) : `lib/caisse.ts` juge les saisies, une caisse bornée par son ouverture ;
  un dossier tient une caisse dès que sa reprise ou son relevé la portent, un dossier basculé aussi dès que les espèces
  d'une facture source y entrent (C6-Q1), et la fenêtre des encaissements juge la caisse avant le clic ; l'écran n'offre
  pas d'espèces sur un crédit, et la garde des encaissements le refuse (`especes_sans_mouvement`) ; une pièce se règle
  par la caisse (C8) — `PaiementDePiece` est une union, le relevé ou la caisse, quatrième paramètre obligatoire de
  `paiementsDesPieces`, la contrepartie au compte de la caisse du plan ; la fiche d'une pièce dit « Payée en espèces » à
  part de « Rapprochée », `caisse-a-reprendre` compte la contrepartie d'un paiement, une caisse lue en partie retient
  « Associer » ; la pièce à valider qu'un paiement cite retient la validation (le filet
  `validation_des_paiements_par_la_caisse`), un paiement qui laisserait la pièce à quelques centimes se refuse (C9-Q1),
  une pièce payée ne part d'aucune sélection, et la fiche d'un mouvement ne classe pas sur la caisse un mouvement
  d'avant l'ouverture ; l'assistant lit ces paiements sans drapeau (C13) et met une ligne de caisse au modèle sous son
  genre, sa date et son montant, jamais un libellé (C5) ; le droit « Caisse » d'un accès (C10, C11) et « Ma caisse »
  (C12a, C12b) suivent les règles de l'espace client → « LA CAISSE : LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE, DANS LES
  MOTEURS (C9A, LIGNE 26.6) », « LA CAISSE : LA RELECTURE DE C8 ET C9, ET SES CORRECTIONS », « LA CAISSE : LE
  RESSERREMENT (C6, LIGNE 26.6) », « LA CAISSE : LE DROIT « CAISSE » À L'ÉCRAN DU CABINET (C11, LIGNE 26.6) ».
- **Une échéance de cotisation se modifie et se réunit** (`lib/gestesDesEcheances.ts`, COT-Q1 et Q3, confirmées le
  04/11/2026) : la mise à jour retient la version lue ; rapprochée, le rapprochement reste et son écriture se réécrit
  dans le geste ; « Réunir » porte la gardée à la somme PUIS retire l'autre, un échec entre les deux se dit
  « inachevée ». Un mouvement classé par une catégorie au poste « Cotisations sociales personnelles », que plus rien ne
  propose, retient la validation (`cotisations-classees-par-categorie`, COT-Q2) → « LES COTISATIONS : RÉUNIR, MODIFIER,
  ET LE PRÉLÈVEMENT CLASSÉ PAR UNE CATÉGORIE (COT-Q1 À Q3) ».
- **Un bien acquis avant l'ouverture s'inscrit sans pièce** (« Ajouter un bien repris », `bienReprisSansPiece`, IMMO-Q2,
  confirmée le 04/11/2026) : aucune acquisition écrite, ses dotations si, et `immobilisationSansJustificatif` prend
  l'ouverture ; les candidates ne sont que des achats, hors des postes qui ne rangent jamais un bien
  (`achatsAImmobiliser`) ; la reprise se confronte au registre, compte par compte, en attention (IMMO-Q1) ; sous le
  barème, la catégorie « Carburant / déplacements » se dit (`carburant-sous-bareme`, VEH-Q1) → « LES IMMOBILISATIONS ET
  LE VÉHICULE : LE BIEN REPRIS, LA REPRISE CONFRONTÉE AU REGISTRE, LE CARBURANT SOUS LE BARÈME (IMMO-Q1, IMMO-Q2,
  VEH-Q1) ».
- **La validation confronte la banque au relevé** (MVPD7-Q2 à Q5, confirmées le 04/11/2026) : sans balance reprise, un
  premier relevé parti d'un solde la bloque (`ouverture-sans-reprise`) ; un 512 qui diffère du relevé du 31/12 avertit
  (`banque-au-releve`, `lib/releveAuTrenteEtUn.ts`, la règle de la preuve de la Révision) ; drapeau des quatre champs
  baissé, la carte et la confirmation disent l'exercice figé sans eux ; Clôture rappelle le relevé de janvier suivant ;
  le mois en double avertit → « LA VALIDATION : LA BANQUE CONFRONTÉE AU RELEVÉ, LE FEC DIT AVANT LE CLIC, LE RELEVÉ
  SUIVANT, LE MOIS EN DOUBLE EN AVERTISSEMENT (MVPD7-Q2 À Q5) ».
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
  (`lib/ouvertureConfrontee.ts`), et un écart retient la validation de N (O33-Q1 : `ouverture-en-ecart`, le même
  calcul sur les entrées de l'onglet Bilan ; sans confrontation, rien ne se retient), et la Checklist le dit aussi, en
  erreur, pour l'exercice qui suit le dernier validé (O33-Q3) → « LE BILAN SE LIT DANS LES RUBRIQUES DU 2033-A »,
  « L'OUVERTURE CONFRONTÉE AU BILAN QUI LA PRÉCÈDE », « UN ÉCART D'OUVERTURE RETIENT LA VALIDATION », « L'ÉCART
  D'OUVERTURE SE DIT DANS LA CHECKLIST ».
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
  627000 depuis VF4c2, VF4A-Q1 ; les quatre autres depuis VF4c3, VF4C2-Q1) ; écrit par `regler_plan_du_dossier` seule depuis PC4 (10/11/2026), la restauration exceptée ;
  catalogue hors sauvegarde (`PARENTS_HORS_PLAN_VOULUS`) ; la base et l'application le lisent — plan absent ou
  incomplet, aucun onglet ne se monte —, jamais un compte de rôle en dur (`comptesEnDur.test.ts`,
  `compositionsAuPlan.test.ts`) → « L'APPLICATION LIT LE PLAN ».
- **Montant retenu** : HT pour un assujetti, TTC pour un exonéré (`lib/montantRetenu.ts`) → « HT OU TTC ». **La 2035
  compte une pièce à la date de son PAIEMENT** (`paiementsDesPieces`, entrées obligatoires : le relevé, les parts des
  virements groupés, et celles des virements mixtes, lues avec les ventes facturées), le total payé étant la somme
  SIGNÉE de ses paiements (`paiementNet` : un rejet défait le paiement) ; le rejet se rapproche de la pièce dont un paiement
  a son montant opposé, puis la reprise, la fiche disant l'effet sur la 2035, aucun lot ne le prenant (`rejetAccepte`,
  `lib/rejetDuPaiement.ts`) → « LA 2035 COMPTE UNE PIÈCE À LA DATE DE SON PAIEMENT », « LE VIREMENT MIXTE — CHANTIER
  EC-Q3 », « LA 2035 D'UN BNC EXONÉRÉ : TROIS DÉFAUTS DE LA RELECTURE CORRIGÉS », « REJET-Q1 : LE PRÉLÈVEMENT REJETÉ PUIS
  REPRIS, RAPPROCHÉ DE SA PIÈCE ». **La CA3** : exigibilité à l'encaissement ou au
  paiement, arrondi fiscal par ligne, aucune somme négative sur un taux ; une déclaration enregistrée écrit sa
  liquidation → « LA TVA SE LIQUIDE ».
- **Le moteur de la 2035** : une ligne par poste ET par nature, un poste négatif reste négatif, une case n'appartient
  pas à la ligne en face (BH, BJ, BM groupent), AB et AC n'acceptent qu'une dépense, comptée en positif ;
  amortissements en CH ; la CSG-CRDS entière au 108 en trésorerie, 6,8
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
  → « UN EXERCICE VALIDÉ SE FIGE EN BASE » ; depuis le 10/11/2026, son empreinte en forme 2 scelle aussi les pièces
  citées et la 2035, et le stockage garde le fichier d'une pièce figée (`fichier_fige`) → « INAL1 ET INAL2 : LA PIÈCE
  FIGÉE DANS LE STOCKAGE ET L'EMPREINTE EN FORME 2 (PRÉPARÉES, PAS APPLIQUÉES) » ; la numérotation n'appelle plus les
  deux gardes par ligne là où elles ne refusent rien (deux jumeaux sous WHEN, préparés ; `jd.validation_exercice` ne se
  pose qu'après le verrou exclusif de la validation) → « LA VALIDATION D'UN GROS EXERCICE : LES GARDES ALLÉGÉES ».
  **Cinq chantiers préparés remplacent `valider_exercice`** (les gardes allégées, INV3, LIA5, AFF3, EXD3) : chacun part
  du corps EN PRODUCTION le jour de son collage et reprend les filets des précédents, jamais d'une copie d'avant ; de
  même, une colonne de source neuve du brouillon (MCB5g, INV2, LIA2, demain AFF2) laisse intacte la contrainte « sans
  autre source » d'hier et pose, si l'autre colonne est déjà là, une contrainte par PAIRE au même nom des deux côtés
  (`ecritures_brouillon_inventaire_hors_des_stocks`…), sa garde de tête acceptant les colonnes neuves des autres.

### Import, OCR, classification

- **Montants et dates bancaires** : `csv.ts` seul ; le contrôle de solde est CONSERVÉ → « Un relevé ne contient pas que
  des opérations ». **L'import d'un relevé par fichier** (`lib/importReleve.ts`) : l'aperçu et l'import passent par la
  même interprétation, montrée signée avant le clic ; un montant illisible s'écarte et se compte, jamais zéro ; le
  dédoublonnage compte par multiplicité ; un solde se reconnaît à sa forme ; un recouvrement se confirme ; l'OFX et le
  QIF se lisent au contenu, sans réglage de colonnes, par le même aval (`lib/releveOfxQif.ts`), et ce qui n'est pas sûr
  se refuse (plusieurs comptes, une carte, une autre devise, un ordre jour/mois non prouvé) → « L'IMPORT D'UN RELEVÉ PAR
  FICHIER, CORRIGÉ AVANT L'ANNÉE 2025 DU PRATICIEN », « LE RELEVÉ IMPORTÉ EN OFX OU EN QIF (LIGNE 26.6, MVP) ». **Une
  règle « Toujours ignorer »** retient le sens du mouvement qui l'a créée (nulle : les deux sens, toute règle d'avant),
  et `rapprocher_cotisation` refuse un mouvement ignoré (REGLES-Q1, en production depuis le 03/11/2026,
  `SENS_DES_REGLES_IGNOREES_EXPORTE` levé) ; « Ignorer » et « Toujours ignorer » n'écrivent que sur un mouvement encore
  à traiter EN BASE, et disent ce qu'ils n'ont pas écrit → « LE SENS DES RÈGLES « TOUJOURS IGNORER » ET LA COTISATION
  D'UN MOUVEMENT IGNORÉ, EN BASE (REGLES-Q1) (PRÉPARÉE, PAS APPLIQUÉE) », « LE SENS DES RÈGLES « TOUJOURS IGNORER » EN
  PRODUCTION (REGLES-Q1) », « « IGNORER » ET « TOUJOURS IGNORER » NE VISENT QU'UN MOUVEMENT ENCORE À TRAITER ».
  **Classification** : le bordereau d'abord, le sens par `orientationDe` → « Le sens d'une pièce est décidé par la
  classification ».
- **Une même dépense entrée deux fois se dit** (`lib/doublonsProbables.ts`, PIECES-Q2, confirmée le 04/11/2026) : deux
  dépenses de même montant retenu, à sept jours au plus, d'une même `cleFournisseur` (un fournisseur non lu se rapproche
  de tout), l'une au moins non réglée — en attention dans Justificatifs, les fiches, la Vue d'ensemble, Clôture et
  avant la validation, jamais bloquant. Une date déduite plafonne la confiance à « moyenne » aux quatre chemins du dépôt
  (`lib/dateDeduite.ts`, copié dans `receive-email`, PIECES-Q1 (A), sans trace gardée) ; « Valider la sélection » compte ce qui part et nomme avant
  le clic ce qu'elle écarte ou ce qui mérite un regard (`lib/validationDeLaSelection.ts`) → « RELECTURE : UNE ANNÉE DE
  PIÈCES, DU DÉPÔT À LA 2035 (MVP-D6) », « LES PIÈCES : LE DOUBLON PROBABLE, LA DATE DÉDUITE, LA VALIDATION EN LOT QUI
  DIT TOUT (PIECES-Q1, PIECES-Q2, D7) ».
- **Une facture se reconnaît à son titre** (`lib/titreDeFacture.ts`, copié dans `extract-piece`, PIECES-Q3) : une des
  dix premières lignes qui commence par « FACTURE » ou « NOTE D'HONORAIRES », avec un montant, l'emporte sur les mots
  croisés plus loin, après le bordereau et le nom d'un compte bancaire ; Documents dit « Facture probable » par la même
  règle. Une lecture ratée se dit au dépôt, la pièce non lue passe en tête de « À valider », et la relecture groupée
  n'écrit de montants que sur elle, ses conditions jugées en base (`lib/lectureDesPieces.ts`, PIECES-Q5) ; un PDF de
  plus de 10 Mo se dit avant l'envoi ; « Mes pièces » lit trois fichiers à la fois (`lib/reservoir.ts`, PIECES-Q4) et
  l'appel au modèle s'abandonne à 30 s ; Justificatifs lit en parallèle, le dernier chargement seul écrit, une fiche ne
  relit que son groupe (`relireLesPieces`) → « LES PIÈCES : LE CLASSEMENT DES FACTURES, LA LECTURE RATÉE DITE, LE DÉPÔT
  PAR PETITS LOTS, LES RECHARGEMENTS (PIECES-Q3 À Q5, D8) ».
- **Un fournisseur se reconnaît à une clé d'identité** (`cleFournisseur`), mot à mot, jamais par sous-chaîne.
  **« Textract sait le lire » n'est pas « l'application accepte ce fichier »** (`textractPeutLire`) ; une relecture OCR
  ne relit que ce qui manque.
- **Le texte OCR vit dans `piece_textes_ocr`** (doublons par `texte_md5`) ; une date déduite est dite « à vérifier ». Un
  ZIP écrase sans rien dire (`nomUnique`) ; un livrable incomplet le dit.

### Facturation électronique

- **La racine du mandataire (G1.45)** : deux séries par dossier, choisie selon QUI valide (MEG1-Q5), en base depuis le
  10/11/2026 (A9a) : le cabinet numérote en M<année>-, ses avoirs en MA<année>-, le client dans sa série ; deux séries
  ne produisent jamais un même numéro (`modeles_se_recouvrent`).
- **Pièges EN 16931 / Super PDP** : TVA sur chaque ligne, unité `C62`, n° de TVA du vendeur, `is_valid=false` sur des
  avertissements, SIRET = l'entreprise authentifiée → « Pièges EN16931/Super PDP ». **Le statut de TVA du dossier**
  décide de la mention et du motif → « LE STATUT DE TVA DU DOSSIER ». En franchise ou exonéré, le numéro de TVA tient à
  une case (`numero_tva_attribue`) ; sans elle, ses factures sans TVA ne partent pas (G1.47).
- **Le générateur CII** refuse avant le clic → « LA FACTURE ÉLECTRONIQUE S'ÉCRIT EN CII ». Depuis A7c (06/11/2026),
  une facture figée lui donne ses seules valeurs figées — TVA, unité et référence des lignes, bon de commande, RIB
  (BG-16 sous le moyen préféré, le code 1 sans moyen), conditions de paiement de `conditionsFigees`, celles du papier —
  et une facture d'avant s'écrit à l'octet près comme hier → « LA FACTURE ÉLECTRONIQUE LIT CE QUE LA FACTURE A FIGÉ
  (A7C, LIGNE 28.55) ». **Une facture validée est
  figée en base** ; la numérotation par `enregistrer_facture` seule → « UNE FACTURE VALIDÉE SE FIGE EN BASE ». Depuis
  le 02/11/2026, la garde refuse une date à venir ou d'avant la plus récente de sa série (dites avant le clic depuis le
  06/11/2026, au jour de Paris, celui de la date proposée et de l'aperçu de transmission), des mentions sans la
  mention de TVA au caractère près, et, au seul accès « Ventes », un statut de TVA à préciser ou un exonéré sans
  article ; le HT d'une ligne se compte sur ses décimaux exacts des deux côtés (`calculerLigne`,
  `centimes_ligne_facture`), confrontés par une batterie → « LA FACTURE : LA MIGRATION EN PRODUCTION (FACTURE-Q1) »,
  « LA FACTURE : LES DEUX REFUS DE DATE DITS AVANT LE CLIC (LIGNE 51.5) » ; une facture à une entreprise ou à un
  organisme public sans l'adresse du client, puis une ligne à 0 % d'un redevable sans article hors d'un régime d'e7a, se
  refusent, par un déclencheur qui suit la garde, en production depuis le 08/11/2026, et le formulaire le dit avant le
  clic (JJ-Q4 et A7C-Q1, `ADRESSE_DU_CLIENT_EXIGEE` levé) → « JJ-Q4 : UNE FACTURE À UNE ENTREPRISE SANS ADRESSE NE SE
  VALIDE PAS, ET LA LIGNE À 0 % D'UN REDEVABLE (A7C-Q1) », « JJ-Q4 ET A7C-Q1 EN PRODUCTION ». À sa
  validation, elle fige son statut et son numéro de TVA, l'identité légale, les paramètres, le RIB confirmé, le logo et
  le mandataire, et ses lignes leur provenance (A7a, en base depuis le 29/10/2026) ; l'aperçu d'une facture figée
  n'imprime que ses colonnes, le logo vérifié à son empreinte figée, une facture d'avant comme hier (A7b), et celle que
  le cabinet valide, la mention de son mandat, que la confirmation nomme (P4) → « LA FACTURE FIGE SES MENTIONS, EN
  BASE », « LA FACTURE FIGE SES MENTIONS, À L'ÉCRAN — ESPACE CLIENT, A7B (LIGNE 51.5) », « LE MANDAT DE FACTURATION
  IMPRIMÉ ET NOMMÉ À LA CONFIRMATION (P4, LIGNE 51.5) ».
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
  DEUX FOIS ». Le pont juge par RÉGIME (`RegimeDuPont`, la bascule et les sources en paramètres obligatoires) : une
  facture source compte sa vente elle-même, et seule une pièce validée qui n'est pas son exemplaire la double ; dans un
  dossier basculé, la pièce qu'il rattache sans désignation est « à désigner » → « LE PONT, SES MARQUES ET LA CHECKLIST
  DEVANT LA JUMELLE INVERSÉE ». **L'exemplaire d'une facture** (`pieces.facture_id`) : la jumelle ou le PDF, DÉSIGNÉ par le cabinet seul
  (`designer_exemplaire_facture`, `defaire_exemplaire_facture`), sur une facture VALIDÉE du même dossier et une pièce de
  VENTE, figé avec la pièce ; la garde refuse toute autre écriture, sauf la restauration ; la quatrième preuve du pont,
  dite la première, sans faire taire les autres ; l'exemplaire d'une facture SOURCE ne compte plus (VF3b), celui d'une
  autre compte comme hier ; à l'écran, la fiche d'une pièce de vente seule, côté cabinet, sur des factures lues en
  entier, et chaque confirmation dit ce que le geste change à ce qui se compte ; depuis VF6c, la section « Ce que cette
  pièce est » : une pièce validée d'un dossier basculé ne se défait plus, elle se remplace d'un seul geste (VF6-Q1) →
  « L'EXEMPLAIRE D'UNE FACTURE, EN BASE », « L'EXEMPLAIRE D'UNE FACTURE, À L'ÉCRAN ». **La source de la
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
  état que l'appelant choisit et que son écran dit (« Ma simulation », jusqu'à VF8e) → « LA 2035 LIT LES VENTES
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
  transmis, le registre, le relevé ; le 411 se lettre par facture ; la validation les numérote (VF7c), son FEC celui
  d'avant → « LE FEC, LA PISTE D'AUDIT ET LE LETTRAGE LISENT LES VENTES FACTURÉES ». **Connexion bancaire** : 90
  jours sans nouvel accord → « LA CONNEXION BANCAIRE RÉCUPÈRE ».
- **Les ventes du client** : les essais exigent un client d'essai SANS « Ventes » → « LES VENTES DU CLIENT, EN BASE ».
  **Les devis** : leurs refus, que `devis.ts` redit, se confrontent au texte exporté (`devis.test.ts`) et se rejouent
  par `devis.sql`. **Articles, contacts, paramètres** : une ligne, un client de facture gardent leur COPIE ; rien ne se supprime (un contact
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
- **L'organisation du travail** (décision du cabinet du 04/11/2026, sur une mesure de la session : les agents font 92 %
  des appels et relisent en moyenne 390 000 jetons à chacun ; le code, les tests et le SQL de l'application ne sont
  qu'environ 30 % du texte écrit) : une mission d'agent est courte et ciblée — un objectif, les fichiers à lire nommés,
  HISTORIQUE.md cherché par `grep`, jamais lu en entier, les sorties de tests réduites, une soixantaine d'étapes au
  plus ; la vérification est proportionnée — toute la rigueur (réplique, essais rejoués, mutations, banc du leurre) pour
  la base, la sécurité et les calculs fiscaux, les tests seuls pour un écran, sans programme de vérification jetable ;
  un lot par thème plutôt qu'un par question, son récit dans HISTORIQUE.md en dix à quinze lignes, la ligne Notion en
  une phrase → « L'ORGANISATION DU TRAVAIL : MOINS D'À-CÔTÉS, PLUS DE CODE ».
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
  (décision du cabinet du 25/09/2026) : elle pousse sur SA branche, ouvre la demande quand la barrière LOCALE passe
  (`tsc -b`, lint, `npm test -- --changed origin/main --passWithNoTests` ; depuis le 04/11/2026, la suite sous quatre
  fuseaux et le build ne tournent qu'en ligne), la fusionne quand `verifier`, la barrière complète, est vert sur la
  tête, sans conflit ni fil de revue ouvert, en passant `expectedHeadSha` ; jamais squash ni commit de fusion. Puis elle
  vérifie la mise en ligne, tient la feuille de route Notion, dit au cabinet ce qui est parti, et réaligne sa branche
  sur `origin/main` (égalité des arbres, `--force-with-lease`). Une fusion refusée se dit ; jamais de contournement. Une
  branche qui a fusionné `main` en elle ne se pousse pas telle quelle : on rejoue ses commits à la suite de `main` et
  l'égalité des arbres se contrôle avant de pousser.
- **La Routine quotidienne `trig_011WworgC5Yw9whbjhNq8WA5` est DÉSACTIVÉE** (25/09/2026, décision du cabinet) : elle
  poussait sur `main` pendant qu'une session travaillait sur sa branche. La réactiver est une décision du cabinet, qui
  dira qui écrit sur `main`.
- Avant de supprimer une table jugée morte, réunir les six preuves : 0 ligne, 0 clé étrangère entrante, 0 vue
  dépendante, 0 déclencheur, 0 fonction qui la nomme (`pg_proc.prosrc`), 0 référence dans le code (front **et** Edge
  Functions) — et distinguer « vide » (rien ne l'a exercée) de « morte » (contournée alors que sa fonctionnalité a
  tourné).
- **Ce fichier reste court** : une entrée nouvelle tient en quelques lignes et renvoie à son récit dans HISTORIQUE.md.
