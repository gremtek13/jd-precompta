# CLAUDE.md — jd-precompta

Documentation durable du projet : son état et les règles qui le gouvernent, à tenir à jour au fil des évolutions.

**Ce fichier est rechargé en entier à chaque reprise de la mémoire de travail, des dizaines de fois par jour : chaque
ligne s'y paie autant de fois.** Le 08/10/2026 il faisait 863 000 caractères, dont 81 % de récits de débogage, et une
reprise coûtait environ 475 000 tokens ; il a été réduit ce jour-là, à la demande du cabinet. Le texte complet d'avant
est dans **HISTORIQUE.md**, que rien ne charge automatiquement.

- Ici : l'état du projet et la règle, en quelques lignes. Le récit — comment un défaut a été trouvé et mesuré, ce que
  les mutations ont montré, les résultats négatifs à ne pas réenquêter — va dans HISTORIQUE.md (sous « Entrées
  postérieures au 08/10/2026 », daté) et dans la demande de fusion. Pas de compte de mutations, pas d'essai abandonné,
  pas de récit de session ici.
- Un renvoi `→ « … »` désigne un passage de HISTORIQUE.md : le chercher sans tenir compte de la casse, et le lire avant
  de toucher au domaine concerné. Un renvoi « voir CLAUDE.md » d'un commentaire ou d'un autre document vers un passage
  qui n'est plus ici se trouve dans HISTORIQUE.md, sous le même titre.

## Objectif et périmètre

Application de comptabilité pour cabinets comptables (multi-cabinets, multi-dossiers clients). Pour chaque dossier
(= client), le cabinet collecte les pièces, tient la comptabilité (rapprochement bancaire, écritures, validation des
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

## Architecture actuelle

- **SPA React sur Supabase** (Postgres, Auth, Storage, Edge Functions), sans backend applicatif : la logique serveur vit
  dans les policies RLS, les fonctions SQL et les Edge Functions Deno.
- **Trois profils d'accès** : cabinet (chef de cabinet, ou membre d'équipe assigné à des dossiers) ; client (un compte
  Supabase ordinaire créé par `create-client-access`, ouvert par e-mail et mot de passe — `signInWithPassword` dans
  `Login.tsx` est le seul chemin de connexion par mot de passe ; l'autre est le lien « Mot de passe oublié », dont la
  session passe par `NouveauMotDePasse` avant tout autre écran —, restreint à ses dossiers par `memberships`) ;
  super-admin (`SuperAdminPage`). **Aucun écran ne s'affiche sans session** (`App.tsx`) : il n'existe aucun chemin
  anonyme.
- **Routage** : `HashRouter` (react-router-dom 7), pour GitHub Pages sans réécriture serveur. L'onglet d'un dossier fait
  partie de l'URL (`/dossiers/:id/:tab`).
- **Coque d'ordinateur en trois volets** (25/09/2026) : la barre latérale (`Layout.tsx`, `BarreDossiers.tsx` : « Nouveau
  dossier », recherche, navigation, le dossier ouvert avec tous ses écrans, les autres dossiers, le compte), réductible
  (préférence en `localStorage` ; réduite, la barre d'onglets `DossierParcours` réapparaît) ; le panneau central
  `.main` ; le panneau de droite. Le menu du compte et le menu « … » du téléphone portent les mêmes entrées, écrites une
  fois (`entreesDuCompte`). **Le mobile ne change pas** : barre du haut, navigation en bas. La liste des dossiers
  (`lib/listeDossiers.ts`) se relit au retour sur le tableau de bord, une fois par dossier ouvert inconnu et sur
  `signalerMajDossiers()` ; tronquée ou refusée, elle le dit.
- **Le panneau de droite** (`components/PanneauDroit.tsx`, `lib/panneauDroit.ts`) : un emplacement de la coque qu'un écran
  remplit par `<PanneauDroit nom="…">`, rendu par PORTAIL (le contenu reste dans l'arbre de l'écran qui l'ouvre). Un seul
  contenu à la fois, désigné par son nom ; `fermer()` ne ferme que s'il occupe encore le volet ; vide, l'emplacement
  n'existe pas (`:empty`). Sous 1 280 px il se superpose ; sur mobile il redevient la carte flottante, plein écran pour
  la fiche d'une pièce et d'un mouvement (`data-occupant`). Hors de la coque, `usePanneauDroit` lève. **Garde de
  sortie** (`useGardePanneau`) : `ouvrir()` et `fermer()` la consultent avant qu'un AUTRE contenu prenne la place, et
  rendent `false` quand elle refuse. Quitter l'onglet ou le dossier par la barre latérale n'est PAS couvert
  (`HashRouter` n'a pas de bloqueur de navigation).
- **Volets redimensionnables** (05/10/2026, `PoigneeRedimensionnement.tsx`, `lib/largeurVolets.ts`) : une seule
  contrainte décide des bornes, le panneau central garde au moins 560 px. Glisser, clavier, double-clic pour la largeur
  d'origine ; une largeur n'est retenue (`localStorage`) qu'après un vrai glissé. La coque pose `--largeur-barre` et
  `--largeur-panneau`, que seul l'ordinateur lit. La poignée du volet de droite vit AVANT l'emplacement (un enfant de
  plus ferait mentir `:empty`) et n'existe que tant qu'il a un contenu (`MutationObserver`).
- **La fiche d'une pièce** (`pages/dossier/FichePiece.tsx`) : sa place dans la liste AFFICHÉE en titre, précédent et
  suivant ; « Valider » enchaîne sur la prochaine pièce à valider, puis ferme ; clée par pièce ; une réponse pour une
  pièce déjà quittée ne déplace rien ; une pièce supprimée emporte sa fiche. Volet ouvert, la liste efface ses colonnes
  secondaires par une requête de conteneur posée sur `.liste-pieces` seule.
- **Le rapprochement d'un mouvement** (`pages/dossier/FicheMouvement.tsx`) : la pièce proposée se justifie par les
  signaux mesurés, et ce que la banque ne confirme pas est DIT ; quand plusieurs pièces conviennent aussi bien, aucune
  n'est proposée, toutes sont montrées ; après une action le mouvement reste affiché (l'onglet retient l'IDENTIFIANT et
  relit la ligne) ; le choix à la main ne part qu'au clic sur « Associer » (les flèches du clavier changent la valeur
  d'une liste qui a le focus).
- **Une page ne se remonte pas d'un dossier à l'autre** : `DossierDetail` reste monté (même route, autre `:id`). Les
  onglets vivent sous `AnneeProvider key={id}` ; ce qui vit au-dessus doit être clé par dossier (l'assistant :
  `key={dossierId}`) ou garder ce qu'il lit AVEC l'identifiant pour lequel il l'a lu. Côté client, changer de société
  ne quitte pas l'écran : `<Outlet key>` dans la coque → « LA BARRE LATÉRALE A ROUVERT UNE COURSE ».
- **Hébergement** : GitHub Pages, publié par `.github/workflows/deploy.yml` à chaque push sur `main` (Node 22, `npm test`
  puis `npm ci && npm run build`). Domaine `compta.jdarnis.fr` (`public/CNAME`, d'où `base: '/'` dans `vite.config.ts`).
- **Backend Supabase** : projet `jd-precompta`, id `mztayrhfgtsfjqighlue`, eu-west-1 — distinct de `jd-factu`.
- **Migrations** : uniquement par l'outil MCP `apply_migration`, jamais par `execute_sql` (onze objets créés ainsi
  manquaient à l'export). Consulter l'état réel (`list_tables`, `execute_sql`) plutôt que supposer. `supabase/schema/`
  porte un EXPORT (une migration par fichier, plus le socle de ce que les migrations ne créent pas) : ce n'est pas la
  source de vérité, et la procédure qui le rejouerait n'existe pas encore. Après toute migration : y ajouter son fichier
  et rejouer les trois contrôles de `supabase/schema/README.md` (dérive, socle, inventaire).
- **Edge Functions** (`supabase/functions/`, Deno, un dossier par fonction, déployées par MCP `deploy_edge_function`) :
  - `agent-comptable` — assistant IA (Bedrock) par dossier, plafond de coût mensuel par cabinet (alerte et blocage) ;
    sa consigne ne nomme aucun cabinet et dit de la facturation électronique et de l'autoliquidation ce qu'en dit
    `lib/statutTva.ts` (`agentComptableConsigne.test.ts`) ; aucun nom de cabinet dans le code exécuté (`cabinetEnDur.test.ts`).
  - `create-cabinet`, `delete-cabinet` (super-admin) ; `create-team-member`, `create-client-access`.
  - `extract-piece` — OCR (Textract) puis citation des champs par un modèle ; réservée à un compte RATTACHÉ au cabinet
    et à `receive-email`, qui présente la clé secrète dans l'en-tête `apikey`.
  - `receive-email` (webhook Resend, par dossier) : une pièce jointe hors des bornes d'une pièce (format, poids) y est
    écartée et consignée dans `pieces_jointes_ecartees`, une fois (l'empreinte des identifiants Resend), sans nom, comme
    celle qu'elle perd en chemin (« le dépôt a échoué », ligne 22.8) et celle qui arrive vide (ligne 22.91) ; les autres
    éléments de l'e-mail (« inline »…) ne se déposent pas : une ligne de journal les compte, sans nom (ligne 22.92) ;
    `send-email` (facture : le cabinet et le client « Ventes », trente e-mails par dossier et par jour de Paris pour un
    client, comptés avant Resend ; relance : le cabinet seul ; domaine `precompta.jdarnis.fr`).
  - `superpdp-credentials`, `superpdp-sync`, `superpdp-emit` — Super PDP ; `superpdp-emit` transmet le CII de
    l'application, jugé avant tout appel, sous une transmission réservée ; le client « Ventes » relie Super PDP (EC-Q4,
    hypothèse) et transmet, la réception (`superpdp-sync`) reste au cabinet.
  - `proposer-categorie` — la catégorie d'UNE pièce depuis son texte OCR, sur un clic ; rien d'écrit.
  - `evaluer-extraction` — harnais de MESURE ; ne facture que pendant une fenêtre datée ; `limite: 0` et la question
    « cles » sont gratuites.
  - `banque-connexion` — la connexion bancaire d'un dossier (Enable Banking, bac à sable) ; REND les mouvements, l'écran
    importe.
  - `plateforme-agreee` — la plateforme agréée du CLIENT, par l'API de flux que publient les plateformes ; REND les
    factures, l'écran importe ; DÉPOSE une facture émise et suit son accusé ; RELÈVE les statuts du cycle de vie des
    factures émises et les écrit elle-même (`statuts_factures_recus`) ; le secret de la connexion ne revient jamais au
    navigateur, ni ne part vers une adresse changée sans être ressaisi ; le client « Ventes » y fait tout sauf la
    réception des achats (P3).
  - `taux-change-bce` — le cours BCE d'une devise à une date.

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
  lib/            logique métier sans JSX (calculs, appels Supabase, formats, exports). Client Supabase :
                  lib/supabase.ts. Erreurs : lib/invokeErreur.ts, lib/messageErreur.ts. Lecture d'une
                  collection : lib/lectureComplete.ts (lireTout).
  components/     composants transverses (coque, PanneauDroit, modales, widgets, BarreRecherche).
                  BarreRecherche + lib/recherche.ts : le moteur de recherche commun (accents et casse ignorés,
                  termes en ET, virgule = point sur les montants) — tout écran de liste s'y branche.
  pages/          un composant par écran de premier niveau.
  pages/dossier/  les onglets d'un dossier et leurs modales. Liste et ordre : lib/ongletsDossier.ts
                  (GROUPES_PARCOURS, DossierTab), source UNIQUE de la barre latérale et de la barre d'onglets.
  test/           fabriques des tests (faux clients, dont `clientRetenu.ts`, le client qui ne rend rien tant qu'on ne
                  le libère pas, filtres PostgREST, factures fictives, le harnais des Edge Functions (`fonctionsEdge.ts`) et
                  leurs contrats (`contratsFonctions.ts`), la batterie des encaissements, tirée pour un jour donné et jouée sur une réplique par
                  supabase/essais/batterieEncaissements.mjs). Un tirage « au hasard » se fait par `tirage`
                  (src/test/encaissementsBatterie.ts), exact sur 32 bits, un entier par `entierTire` : le
                  congruentiel écrit en virgule flottante boucle sur 10 466 valeurs ; tirage.test.ts le refuse
                  dans tout le dépôt, avec `Math.random` dans un test → « TROIS TESTS TIRAIENT LEURS CAS ».
supabase/
  functions/      une Edge Function par sous-dossier, auto-portée.
  essais/         essais à REJOUER, jamais seulement relire, par impersonation (anonyme, compte rattaché à
                  rien, client, chef de cabinet). Sans suppression ni mise à jour sans `where` en production
                  (l'outil d'exécution les retient pour une confirmation qui n'arrive pas : l'appel expire à
                  60 s sans avoir atteint la base) : ce qu'une suppression rencontre se joue sur une réplique
                  locale du schéma.
                  - rls.sql : toutes les tables et le stockage, boucle sur pg_class, se mute lui-même ;
                  - restauration.sql (sur une réplique, par psql, arrêté à la première erreur : le plan de
                    sauvegarde.ts, gardé par restaurationEssai.test.ts ; une clé étrangère qu'il ne peut recopier se
                    nomme, et sans elles son verdict se dit EN FAUTE ; ses tables d'essai portent la génération, et
                    chaque insertion nomme ses colonnes sans celles que le code retire) ; allerretour.py (copie
                    déployée ↔ dépôt, après chaque déploiement) ;
                    bordures.py (les bordures répétées et comptées, avant de transcrire une fonction) ;
                    socle.py/.sql et inventaire.py/.sql (export ↔ catalogue, après chaque migration) ;
                    signature.sql (les neuf familles d'objets, réplique ↔ production, avant de croire ce qu'on joue
                    sur une réplique) ; batterieEncaissements.mjs (la batterie des encaissements jugée par la base
                    d'une réplique, au jour de la base) ;
                  - un essai par mécanisme, à rejouer après toute migration qui touche ses fonctions, ses tables
                    ou les contraintes de lignes_bancaires et ecritures_brouillon : affectation,
                    reglesAffectation, virementPersonnel, echeanceEmprunt, ventilation, connexionBancaire,
                    reglementGroupe, cotisationRapprochee, dotations, forfaitKilometrique, lettrageManuel,
                    compteBilan, reportDesSoldes, statutTva, receptionPlateforme, transmissionsFactures,
                    abandonTransmission, encaissementsFactures, transmissionsEncaissements, statutsFacturesRecus,
                    identiteFacturesRecues, revisionSoldes, revisionCycles, revueAnalytique, cotisationPersonnelle,
                    categoriesCommunes, notesInternes, droitsAcces, piecesHorsDeFrance, planComptable,
                    laBaseLitLePlan, regimesEreporting, declarationsEreporting, dossierPermanent,
                    piecesJointesEcartees, articles, etatFactureElectronique, contacts, importContacts,
                    parametresFacturation, dernierChangementDeRib, logoDesFactures ;
                    bornesStockage (le catalogue des quatre seaux, en LECTURE SEULE, après les migrations
                    `bornes_du_stockage` et `logo_des_factures`) ; logoDesFacturesSuppression (les suppressions du
                    seau des ventes, profil par profil : sur une RÉPLIQUE seulement, il porte des `delete`) ;
                    validationExercice, liquidationTva et factures se jouent en UNE transaction (psql -1 hors de l'outil).
  types/          prothèses de type des Edge Functions, HORS de functions/ (que des scanners énumèrent).
  schema/         export du schéma (voir PLAN_DE_REPRISE.md).
  config.toml     le réglage verify_jwt de chaque Edge Function, et rien d'autre.
public/CNAME      domaine GitHub Pages.
PLAN_DE_REPRISE.md  quoi faire le jour où quelque chose a disparu (dans Git, pas dans Notion).
RGPD.md           registre des traitements.
HISTORIQUE.md     le détail de ce que ce fichier résume (lu à la demande).
.github/workflows/  tests.yml (verifier : tests multi-fuseaux, lint, build), deploy.yml.
outils/captures/  banc de capture VERSIONNÉ : la vraie application servie par Vite avec un faux Supabase à
                  données fictives, photographiée par Playwright (mode d'emploi en tête de vitrine.mjs ; images
                  dans sorties/, ignoré par git). debordements.mjs mesure les débordements et rend un code
                  d'erreur ; installable.mjs demande à Chromium si l'application est installable. Le monde
                  d'e-reporting de l'atelier (d7) est daté de 2027 : ses visites `ereporting/*` posent l'horloge
                  au 5 novembre 2027 et restent EN FIN de `VISITES`.
outils/cotisations/  oracle.mjs : les cas de référence des cotisations Urssaf, calculés par le moteur des
                  simulateurs de l'Urssaf (installé à la demande, jamais en dépendance).
outils/facturation/  valider.mjs : fait juger les factures d'exemple (exemples/*.xml, fictives) par le schéma CII
                  D16B et le Schematron EN 16931 (instruments hors du dépôt, versions vérifiées) ; écrit
                  exemples/valides.json, que factureCii.test.ts confronte aux exemples figés. cdar/valider.mjs : de
                  même pour les messages du statut « Encaissée » (cdar/exemples/*.xml) et le schéma CDAR D22B de
                  l'UN/CEFACT, que cdarEncaissee.test.ts confronte. ereporting/valider.mjs : de même pour les fichiers
                  d'e-reporting (ereporting/exemples/*.xml, fictifs) et les cinq XSD du flux 10 de l'archive officielle
                  v3.2 de la DGFiP (archive et XSD à leur empreinte), que fluxEreporting.test.ts confronte.
outils/references/  les dossiers de référence (12/10/2026) : quatre dossiers fictifs que l'expert-comptable
                  du cabinet recalcule — `donnees.ts`, seule source ; le calcul de nos chiffres FIGÉ sur c506932, ni
                  compilé ni joué par la suite ; nos chiffres jamais commités, seule leur empreinte (README) ; les
                  scripts du document → « LES DOSSIERS DE RÉFÉRENCE ».
```

## Conventions de développement

- **Système visuel = `src/index.css` seul, aucune couleur d'accent en dur** : la charte d'un cabinet (`lib/branding.ts`)
  ne remplace que `--color-primary`, `-hover` et `-light` ; toute nuance dérivée se calcule par `color-mix()` depuis
  `--color-primary` (`--tint-primary`, `--tint-primary-strong`, `--ring-primary`, `--glow-primary`, `--wash-primary`).
  Fonds plats, ombres `--shadow-xs/sm/md/lg`, rayons `--radius-*`, transitions `var(--duree) var(--ease)`.
- **Pièges de positionnement** : jamais de `backdrop-filter`, `filter` ni `transform` sur `.sidebar` ; jamais de
  `container-type` sur un ancêtre d'éléments `position: fixed` (panneau central, grille, carte) — il en devient la
  référence, et les fenêtres superposées se décalent (le Chromium du banc ne le fait plus, mesuré le 14/10/2026 : la
  précaution reste pour les autres moteurs → « LA BARRE DU BAS NE RECOUVRE PAS LES BOUTONS D'UNE FENÊTRE »).
- **Tableaux de bord** : widgets partagés (`src/components/widgets/` : `KpiTile`, `ProgressRing`, `MonthlyBars`,
  `Widget`, `Avatar`) en grille `.bento` de 12 colonnes, qui suit SA largeur (conteneur `bento` ; sous 760 px, rangement
  du téléphone) ; une tuile remplit sa case ; le texte garde sa couleur et le statut se lit à une pastille ; une couleur
  de statut n'est jamais une série ; Manrope (Inter en repli) ; chargements en squelettes. Aucune fenêtre superposée
  dans une grille ni dans une carte.
- **Dans `.sidebar`, une seule `<nav>`** (sur mobile elle devient la barre du bas) ; le texte discret de la barre passe
  par `--color-text-barre` (contraste).
- **Une rangée de boutons ou de champs passe à la ligne** (`flex-wrap`), jamais ne déborde ; un tableau vit dans un
  `.table-scroll`. Sur téléphone la rangée devient une colonne en `nowrap` ; un bouton aligné sur le bas des champs
  passe par `.field-row.aligne-bas`, jamais par un `alignItems` en ligne. Un tableau qui se replie en fiches
  (`table-empilable`, cellules `data-libelle`) vit dans une enveloppe `.tableau-adaptable`, requête de conteneur sur
  l'enveloppe seule (`tableauxFormulaires.test.ts`) ; `table-empilable-etroite` ne se replie que sous 520 px. Le bloc
  téléphone ne comprime jamais un tableau (disposition automatique, aucune coupure de mot) : trop large, il défile ; un
  tableau dont une commande passerait hors de vue se replie sous 860 px de carte (`table-empilable`), un autre sous 520
  (`-etroite`) ; un nom de fichier porte `.nom-fichier` → « UN MOT NE SE COUPE PLUS AU MILIEU ».
- **Vérification visuelle** : `outils/captures/` après toute modification de `index.css` ou de la coque.
  `debordements.mjs` compte ce qui sort du panneau, d'une carte, d'une case de grille, le texte plus large que sa
  boîte, et un mot de 2 à 24 caractères coupé au milieu : 0 aux quatre largeurs de référence, à 720 px et aux
  combinaisons extrêmes des volets (il n'ouvre le volet de droite qu'à 1 280 px et plus). Il admet un tableau qui
  défile : une capture vérifie qu'aucun bouton n'y passe hors de vue. Il sonde aussi les boutons de la fenêtre
  superposée ouverte, défilée de bout en bout (le centre et le milieu des quatre bords, `elementFromPoint`) : un bouton
  qu'aucune position ne dégage est une faute — la barre du bas du téléphone est SOUS les fenêtres, et une rangée coupée
  au bord d'une carte qui défile n'est pas recouverte → « LA BARRE DU BAS NE RECOUVRE PAS LES BOUTONS D'UNE FENÊTRE ».
  La passe du client « Mes ventes » : `debordements.mjs <largeur> client` (ou `client-banque`), qui mesure aussi la
  barre du bas du téléphone. Ne JAMAIS donner au navigateur le mandataire de l'environnement (voir l'en-tête de
  `vitrine.mjs`).
  Sous un `node_modules` fait de liens (worktree d'agent), Vite refuse les polices et le banc mesure la police de
  repli sans échouer : `outils/captures/vite.config.ts` autorise le `node_modules` réel (`realpathSync` d'un paquet)
  et ne surveille pas `.claude` sous la racine (jamais en `**/.claude/**` : un worktree n'y verrait plus ses sources).
  Un montant affiché ne se coupe pas en fin de ligne : `formatMoney`, ou `formaterMontant(n)` (PDF) aux espaces
  passées en U+202F puis U+00A0 et « € » ; `getByText` ramène l'insécable à une espace : lire `textContent` → « LE
  BANC D'UN WORKTREE MESURAIT LA POLICE DE REPLI », « UN MONTANT SE COUPAIT EN FIN DE LIGNE ».
- **Ce qui s'imprime n'a aucune mise en page en ligne** (l'aperçu d'une facture) : un style en ligne l'emporte sur
  `@media print`, et la facture sortait avec ses boutons, en double, tronquée. Le bloc du téléphone (`max-width: 720px`)
  vaut aussi à l'impression (A4 ≈ 718 px) ; une impression se mesure sur un vrai PDF → « ET LA FACTURE IMPRIMÉE PORTAIT
  SES BOUTONS ».
- **Exercice partagé entre onglets** (`AnneeContext`, `useAnnee()`, choisi dans l'en-tête du dossier) : toute vue dont
  un total dépend de l'exercice le rejoint, au lieu d'un `useState` local. Le filtre « sans date » reste local à
  `PiecesTab`. Les onglets à `AnneeTabs` propre et l'année civile de `ChecklistTab` sont légitimes →
  « BALAYÉ LE 21/09/2026, RÉSULTAT NÉGATIF ».
- **Français partout** (noms, commentaires, libellés, messages) ; un commentaire dit le POURQUOI, jamais une paraphrase.
- **Mutations optimistes** quand c'est simple et sûr ; annuler et dire l'erreur si l'appel échoue.
- **Aucun appel réseau externe silencieux** : toute API tierce (SIRENE, Super PDP, IA, banque, plateforme du client) part
  d'un clic, jamais au chargement. Les polices sont servies par l'application (`lib/polices.ts`, `polices.test.ts`).
- **Rien n'est jamais validé ni importé automatiquement** : tout document importé arrive « à valider ».
- **Une facture validée est figée**, et c'est la base qui le garantit depuis le 07/10/2026 : on la corrige par un avoir
  puis une nouvelle facture, jamais en place.
- **Doublons** : SHA-256 du fichier avant tout dépôt ; l'empreinte du TEXTE OCR attrape deux exports du même document.
- **Edge Functions** : fichiers plats, un `Deno.serve`, helpers locaux au fichier.

## Décisions techniques déjà prises

- **RLS multi-cabinets** : `cabinet_admins`, `dossier_assignations`, fonctions `security definer`
  `est_chef_du_cabinet()`, `admin_du_dossier()`, `admin_du_cabinet()`, `is_super_admin()` (chacune inclut le
  super-admin). Toute table métier d'un dossier : une policy `FOR ALL to authenticated` sur `admin_du_dossier(dossier_id)` ;
  une table enfant remonte à son parent ; vérifiée par impersonation réelle avant d'être crue.
- **Un prédicat de policy ne doit JAMAIS pouvoir être vrai sans session** : une policy sans `to` vise `public`, donc
  `anon` (`dossier_id is null or …` fuyait). Les policies anciennes portent `{public}` sans faille, le prédicat fermant ;
  toute nouvelle porte `to authenticated` → « Une policy sans clause `to` s'applique à `public` ».
- **Les policies se REJOUENT** (`supabase/essais/rls.sql`) : quatre profils (le quatrième, depuis P1 : le client dont les
  accès portent les deux droits), boucle sur `pg_class` (une table ajoutée sans policy est attrapée), écritures d'essai
  annulées par sous-transaction, refus exigé en 42501 nommément, seize mutations qui doivent virer au rouge ; depuis
  P7 et P2, deux blocs de plus — « La banque du client » (3bis, 4bis, trois mutations) et « Les ventes du client »
  (3bis, 4bis, douze mutations), que les devis rejoignent dès leur migration (P5 ; témoin : la table `devis` ; avant,
  une ligne « EN ATTENTE »), et les articles dès la leur (A1 ; témoin : la table `articles` ; deux mutations de
  plus), et les adresses de réception dès la leur (A6a ; témoin : la table `adresses_reception` ; deux mutations
  de plus), et les contacts dès la leur (A4a ; témoin : la table `contacts` ; deux mutations de plus), et les paramètres
  de facturation dès la leur (A5a ; témoin : la table `parametres_facturation` ; deux mutations de plus) —, et depuis
  A5c1 un troisième, « Le seau des ventes » (SV0 à SV6, quatre mutations ; témoin : le seau `ventes`), qui se disent EN
  ATTENTE ou SANS OBJET tant que leurs migrations manquent ; celui de la banque se juge entier depuis le 10/10/2026 (les
  deux migrations de P7 en base : 0 en faute, 19 mutations sur 19 en production), celui des ventes depuis le même jour
  (les deux migrations de P2 en base : 35 lignes, 0 en faute, 31 mutations sur 31 en production ; les devis EN ATTENTE),
  et le 14/10/2026 avec les articles (35 lignes, 0 en faute, 33 mutations sur 33 en production), puis avec les adresses
  de réception (35 lignes, 0 en faute, 35 mutations sur 35 en production), et le 15/10/2026 avec les contacts (35
  lignes, 0 en faute, 37 mutations sur 37 en production), et le 16/10/2026 avec les paramètres de facturation (35
  lignes, 0 en faute, 39 mutations sur 39 en production), et le 17/10/2026 avec le seau des ventes (46 lignes, 0 en
  faute, 43 mutations sur 43 en production). Le fichier se rejoue ENTIER (le 08/10/2026, pour la première fois depuis le
  19/09) : sans son en-tête ni ses `drop table`, tables de résultats `on commit drop`, et une ligne TEXTE qui rend
  l'empreinte du texte reçu, comparée à la copie transmise. Ce qui contourne la RLS (`SECURITY DEFINER`) se rejoue
  aussi ; un refus plpgsql arrive en P0001, donc on exige la RAISON → « CE QUI CONTOURNE LA RLS ».
- **Stockage** : le premier segment du chemin EST le dossier (`(storage.foldername(name))[1]::uuid`) — un chemin non-UUID
  fait lever le cast pour tout le monde ; le seau `ventes` (A5c1) juge d'abord la FORME du chemin dans un `case` : un
  chemin qui n'est pas celui d'un dossier n'y ouvre rien et ne fait rien lever. Une suppression de fichier ne se teste
  pas en SQL (`protect_objects_delete` refuse en 42501 pour tous) : gardée par une lecture du catalogue (RGPD.md §8.6).
- **Une table que le CLIENT écrit** liste ses droits un par un (`piece_commentaires` : auteur = `auth.uid()`,
  `origine = 'cabinet'` ⇔ `admin_du_dossier`, cible du dossier annoncé). Une parole datée ne se réécrit pas : aucune
  policy `UPDATE` sur `piece_commentaires`.
- **Edge Functions auto-porteuses** : aucun import de `src/`. Une logique partagée est COPIÉE entre des bornes
  `── DÉBUT/FIN …`, et chaque copie est gardée par un test qui l'extrait de la vraie source, la transpile et l'exécute
  contre `src/lib` — contre une référence extérieure aux deux copies, jamais l'une contre l'autre →
  « Une Edge Function auto-portée duplique du code ».
- **Erreurs** : `supabase.functions.invoke()` lève avant de lire le corps — toujours `extraireErreurFonction(error, repli)`.
  Une erreur Postgrest du chemin non levant est un OBJET NU, pas une `Error` : tout message passe par
  `messageErreur(erreur, repli)` ; `erreursSupabase.test.ts` interdit le ternaire `instanceof Error ? … : repli` et tout
  `instanceof Error` hors de `invokeErreur.ts`. Côté Edge Functions on ne lève que des `new …`
  (`throw new Error(error.message)`) → « ET LE MÊME DÉFAUT VIVAIT SUR L'AUTRE PORTE ».
- **Extraction : le modèle CITE, il ne calcule jamais** (`lib/extractionChamps.ts`, branché dans `extract-piece`) : la
  chaîne telle qu'imprimée, vérifiée dans le texte source (blancs normalisés, casse ignorée ; blancs retirés pour les
  seuls montants ; accents jamais aplatis), puis passée aux analyseurs éprouvés. Étage 1 (OCR) obligatoire, étage 2
  (citation) best-effort ; la confiance est le pire de trois plafonds ; tokens et nombre de rejets journalisés, jamais
  les valeurs. Le garde de copie compare champs, prompts et modèle → « le modèle CITE, il ne calcule jamais ».
- **Modèle de citation : Haiku 4.5 (`MODELE_CITATION`)**, mesuré contre Sonnet 4.6 sur le dossier `test` dans la région
  de production. Changer de modèle demande une mesure ET un appel réel avec les identifiants de production (la policy IAM
  cadre par ressource) — jamais en passant → « HAIKU 4.5 CITE AUSSI FIDÈLEMENT ».
- **L'OCR local (marche 2) est écarté** (21/09/2026) ; seul un volume de milliers de pages par mois ou une exigence
  client le rouvrirait. **L'étage 2 tourne aussi sur les documents**, et c'est voulu : si un jour on le saute, c'est par
  un paramètre de l'APPELANT, jamais par la classification → « QUATRE CITATIONS SUR CINQ SONT PAYÉES PUIS JETÉES ».
- **Proposition de catégorie** (`lib/categorisationIa.ts`, `proposer-categorie`) : liste fermée filtrée sur le SENS
  (nature lue au compte, classe 6 ou 7), indice recopié vérifié dans le texte, rien d'écrit, règles apprises d'abord,
  sur clic sous verrou, journalisée sans plafond, modèle figé dans le test → « UN MODÈLE PEUT PROPOSER UNE CATÉGORIE ».
- **N° de TVA intracommunautaire** calculé du SIREN (`FR` + `(12 + 3 × (SIREN mod 97)) mod 97` + SIREN).
- **GitHub Pages** malgré un signalement Safe Browsing (remédié par la Search Console) ; à reconsidérer seulement s'il
  revient.

## Services externes et MCP utilisés

- **Supabase** (MCP `Supabase`) — base, auth, stockage, Edge Functions du projet `mztayrhfgtsfjqighlue`.
- **Resend** (MCP `Resend`) — `send-email` et `receive-email`, domaine `precompta.jdarnis.fr` vérifié dans les deux sens ;
  `RESEND_API_KEY` en secret Supabase. Un seul webhook : `email.received` → `receive-email`. Depuis le 09/10/2026, aussi
  le SMTP du service d'authentification de Supabase (le lien « Mot de passe oublié »), réglé au tableau de bord avec sa
  propre clé d'envoi, et non dans le dépôt ; ce lien reste lisible dans le journal des envois de Resend tant qu'il vaut.
- **Super PDP** (`api.superpdp.tech`) — plateforme agréée partenaire : réception des factures fournisseurs et émission
  des factures de vente. Une application OAuth par entreprise, donc des identifiants par dossier (`superpdp_credentials`).
  **Cet environnement ne peut pas atteindre `api.superpdp.tech`** : tout diagnostic passe par les journaux de production
  (`query_logs`) après un essai réel du cabinet.
- **API SIRENE** — code NAF depuis un SIRET (`lib/sirene.ts`), à la demande.
- **Enable Banking** (`api.enablebanking.com`) — agrégateur DSP2, en preuve de concept sur son BAC À SABLE ; jeton RS256
  signé par la clé privée de l'application (secret `ENABLE_BANKING_CLE_PRIVEE`, jamais dans le dépôt ni la
  conversation) ; retour déclaré `https://compta.jdarnis.fr/retour-banque.html`. Prestataire définitif sur devis.
- **La plateforme agréée de chaque client** — celle par laquelle il reçoit et émet ses factures depuis le 1er septembre
  2026 : une connexion par dossier (`connexions_plateformes`, identité OAuth2 que le client ouvre au cabinet), appelée
  sur clic ; Super PDP en est une. Aucune plateforme réelle n'a encore été appelée.
- **AWS** — Textract et Bedrock, régions de l'Union européenne seulement.
- **GitHub Actions** — `tests.yml` et `deploy.yml`.

## Contraintes de sécurité et RGPD

- **Registre : `RGPD.md`.** Les données de patients sont dans les FICHIERS, pas dans les tables ; le texte OCR est une
  copie dérivée sans durée légale propre (seul levier de minimisation) ; aucune pièce n'atteint ses 10 ans avant 2033.
- **Pas d'hébergement HDS** (24/09/2026, RGPD.md §8.7) : un praticien ne transmet pas ses bordereaux de télétransmission
  (secret médical), le relevé SNIR justifie les recettes. La condition est tenue par la consigne aux clients, pas par le
  code — décision du cabinet : ne rien changer au code, ne pas réenquêter.
- **Où partent les données** : `edgeFunctionsRegions.test.ts` (tout client AWS nomme une région de l'UE, un repli commun).
  Le secret `AWS_REGION` (`eu-central-1`) se relit par `evaluer-extraction` avec `limite: 0`, sans rien facturer.
- **Ce que les fonctions ont le droit de faire chez AWS** : `edgeFunctionsIam.test.ts` rend la surface d'actions IAM ; la
  policy elle-même vit chez AWS.
- **Qui voit quoi** : `rls.sql` pour les tables et le stockage (pas la suppression d'un fichier) ;
  `edgeFunctionsHttp.test.ts` pour les Edge Functions en HTTP, contre leur source et un monde factice.
- RLS activée sur toutes les tables. **Les accès clients sont restreints** (dépôt de pièces, pas de montants, catégories,
  packs ni autres onglets) — ne jamais les élargir sans décision explicite. **Trois domaines font exception** (décision
  du cabinet du 09/10/2026, « remplacer MEG ») : les devis, les factures et leur facture électronique, la vue de la
  banque — chacun pour un accès qui en porte le DROIT, posé par le cabinet, tenu en base (policy `to authenticated`,
  fonction qui le vérifie), jamais par l'écran seul ; le client y écrit par les mêmes fonctions que le cabinet, et une
  policy qui lui ouvre une lecture se présente au cabinet avant d'être appliquée. **Les droits sont en base depuis P1**
  (09/10/2026) : `memberships.droit_ventes` et `droit_banque`, faux par défaut, cochés par le cabinet dans l'onglet Accès
  par `changer_droits_acces` seule (aucune policy de mise à jour, pour personne ; un droit nul y est un droit inchangé) ;
  `client_du_dossier`, `gere_les_ventes`, `gere_la_banque` et `droits_sur_le_dossier` sont le prédicat des étapes
  suivantes ; depuis P7 (10/10/2026), « Banque » ouvre en base les deux registres de la banque du client et le contrôle
  de solde des relevés, et à l'écran « Ma simulation » et, depuis P9a (11/10/2026), « Ma banque » ; depuis P2
  (10/10/2026), « Ventes » ouvre en base la lecture
  des neuf tables des ventes de son dossier et leurs gestes par les fonctions du cabinet (`gere_les_ventes`), sans écran
  encore — désigner le mouvement d'un encaissement demande aussi « Banque » ; depuis A1 (14/10/2026), le catalogue des
  articles et ses trois fonctions, à l'écran depuis A2a (« Mes ventes › Articles ») ; depuis A6a (14/10/2026),
  l'adresse de réception de son dossier, son histoire et sa déclaration, à l'écran depuis A6b1 (« Tes plateformes »), et
  l'état de sa facture électronique, à l'écran depuis A6b2 (l'encart de son accueil), jamais un secret des connexions
  (`etat_facture_electronique`) ; depuis A4a (15/10/2026), le fichier des clients de son dossier — toutes ses
  colonnes, retirés et effacés compris — et ses quatre fonctions, l'effacement compris (MEG1-Q11), à l'écran
  depuis A4b1 (« Mes ventes › Clients ») et, depuis A4b2, dans le formulaire d'une facture ; depuis A4b3a
  (15/10/2026), l'import d'un fichier de clients par `importer_contacts` — mille lignes au plus, tout ou rien, sans
  jamais modifier un contact rangé —, à l'écran depuis A4b3b (« Importer des clients ») ; depuis A5a (16/10/2026), les
  paramètres de facturation de son dossier — toutes leurs versions, le RIB, son état et ses auteurs compris — et leur
  enregistrement, un RIB qu'il pose ou change n'étant que PROPOSÉ jusqu'à ce que le cabinet le confirme
  (`confirmer_rib`, le cabinet seul ; MEG1-Q12), à l'écran depuis A5b1 (« Mes ventes › Paramètres ») ; un accès qui ne
  porte que « Banque » ne les lit pas : il n'en apprend, par `dernier_changement_de_rib` seule, que le jour, l'auteur —
  le cabinet ou un accès client — et l'état du dernier changement du RIB, jamais le RIB (A5-Q2 ; A5b3a, 17/10/2026) ;
  l'identité légale du dossier (dénomination imprimée, ville du greffe, forme juridique, capital), le client la lit
  comme toute la fiche de son dossier et ne l'écrit jamais (MEG1-Q14) ; depuis A5c1 (17/10/2026), le seau des ventes de
  son dossier — y lire ce qui est déposé, y déposer un logo (PNG ou JPEG, 500 Kio), le désigner dans une version des
  paramètres, jamais modifier ni supprimer un fichier —, à l'écran depuis A5c2a (« Mes ventes › Paramètres ») ; un accès
  qui ne porte que « Banque » n'y lit rien. L'onglet
  Accès dit ce que la base ouvre à la SESSION du client, écran ou non, dans les quatre états des deux étapes
  (`ceQueDisentLesCases`, drapeaux `COUVERTURE_EXPORTEE` et `VENTES_DU_CLIENT_EXPORTEES`, chaque mot confronté à
  l'export) → « LES DROITS D'UN ACCÈS CLIENT, TENUS EN BASE », « AVANT LES VENTES DU CLIENT ». **Un texte libre que le
  cabinet saisit dans une table qu'un droit du client ouvre le dit dans son libellé** (« … le client qui porte la case
  « Ventes » les lit » : les notes d'une facture, le motif d'un avoir et d'une contre-passation, la note d'une
  déclaration ; `LIBELLE_*` de `lib/droitsAcces.ts`).
  **La banque sous la case « Banque »** (P7, les deux migrations appliquées le 10/10/2026) : un ordre, et il est la
  règle — d'abord ce qui s'ajoute (la couverture du relevé, des MOIS en un `date[]`, pour tout accès), puis la bascule
  de l'application, puis seulement le resserrement : une lecture que la RLS refuse rend ZÉRO ligne, sans erreur, et un
  écran d'avant croirait le relevé vide ; rebaisser `COUVERTURE_EXPORTEE` le ferait désormais → « LA BANQUE DU CLIENT
  EN BASE », « LA BANQUE DU CLIENT : LE RESSERREMENT APPLIQUÉ ».
  **Aujourd'hui la restriction est une règle d'ÉCRAN** : la base laisse déjà le client lire les montants de ses pièces et
  les catégories — son relevé, depuis P7, à la seule case « Banque » ; un texte du cabinet seul ne se range jamais dans
  une table que le client lit →
  « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION ». **Les notes internes du cabinet** vivent
  dans `notes_internes` (P0, 09/10/2026 ; `admin_du_dossier`, aucune branche client), lues à part par la fiche d'une
  pièce, écrites avant elle ; `pieces.notes`, `documents_divers.notes` et `dossiers.notes` ne se lisent ni ne s'écrivent
  plus (`notesInternesEcritures.test.ts`) et attendent leur suppression (EC-Q7, « oui » le 17/10/2026, à appliquer) :
  d'ici là le client lit leur copie figée → « LES NOTES INTERNES DU CABINET, HORS DE PORTÉE DU CLIENT ».
- **Les fonctions de la vente acceptent le client** (P3, 10/10/2026) : `plateforme-agreee`, `superpdp-emit`,
  `superpdp-credentials` et `send-email` lisent `droits_sur_le_dossier` au jeton de l'appelant (bloc `droitsDeLAppelant`,
  quatre copies), avant toute autre lecture et tout appel extérieur, puis jugent l'action par leur table `QUI_PEUT_QUOI`
  (une DONNÉE ; attendue dans `src/test/quiPeutQuoi.ts`, que la phrase des cases de l'onglet Accès nomme action par
  action) ; sans le droit, 404 « Dossier introuvable. », droits illisibles 503 ; `cree_par` à la réservation, `lu_par`
  au relevé ; le plafond d'e-mails se LIT, il ne se réserve pas → « LES FONCTIONS DE LA VENTE ACCEPTENT LE CLIENT ».
- **« Mes ventes » (P4a, 11/10/2026)** : route et entrée sous `mesVentesOuvertes(VENTES_DU_CLIENT_EXPORTEES, case
  « Ventes » de la société AFFICHÉE)` ; `ClientVentes` relit la société et les cases à la base (`lireLesDroitsVentes`), et
  une lecture ratée n'offre aucun geste. FacturesTab et ses fenêtres portent `espace` (OBLIGATOIRE, unions typées :
  `onAdresseUpdated` au cabinet seul, `banque` au client seul) ; sans « Banque », la fenêtre des encaissements ne lit ni
  relevé, ni règlements, ni pièces, et le dit. Les mots du client : variantes à côté des phrases d'écran, `pourLEspace`
  pour celles des modules partagés (copies gardées : jamais changées à la source) ; garde des mots `MOTS_DU_CABINET`
  (aucun onglet, jamais « le client » pour le titulaire, tutoiement), éprouvé sur les mêmes états montés pour le cabinet
  (`FacturesTabClient.test.tsx`) → « « MES VENTES › FACTURES » ». Depuis P4b (11/10/2026, EC-Q4 confirmée) :
  « Tes plateformes » ouvre `PlateformeClientModal` et `SuperPdpModal` en mode client (même propriété `espace` : la
  réception n'y existe pas, ni bouton ni texte, et le secret ne s'affiche jamais) ; les refus de `plateforme-agreee`,
  rédigés pour le cabinet, se réécrivent à l'affichage (`REECRITURES_CLIENT`, chaque `de` lu dans la source de la
  fonction) → « LES CONNEXIONS DU CLIENT ET LES TUILES DE SON ACCUEIL ».
- **« Par le client » côté cabinet** (P4c, 11/10/2026) : le client est un compte qui porte un accès du dossier
  (`memberships.user_id`), reconnu par `lib/auteursVentes.ts` (pur) sur une liste lue EN ENTIER
  (`lib/auteursVentesLecture.ts`, par l'onglet Factures du cabinet, une fois, passée aux deux fenêtres) ; en cours,
  partielle, refusée ou dans l'espace du client, il ne dit rien de personne, un auteur nul n'est personne, un accès retiré
  n'est pas deviné, et jamais « par le cabinet ». Pastille sur une validée (`valide_par`) ou un brouillon (`created_by`),
  filtre « Émises par le client » qui ne filtre que l'AFFICHAGE, mention dans les fenêtres (`cree_par`) ;
  `FactureEmise.valide_par` est obligatoire → « « PAR LE CLIENT » CÔTÉ CABINET ».
- **« Ma banque » (P9a, 11/10/2026)** : route, entrée et tuile d'accueil sous `maBanqueOuverte(COUVERTURE_EXPORTEE, case
  « Banque » de la société AFFICHÉE)` ; `ClientBanque` relit la case à la base (`lireLeDroitBanque`) dans la vague de ses
  lectures, et sans elle ne montre rien. Les mouvements du relevé importé (EC-Q5 confirmée : le client ne
  connecte pas sa banque, l'écran le dit), l'état de chacun DÉDUIT par `lib/banqueClient.ts` (pur, sur
  `mouvementJustifieParLeReleve`), le solde LU au dernier relevé contrôlé cohérent et daté, jamais calculé, les mois
  couverts ; jamais la catégorie ni l'écriture, d'une pièce seulement son nom et son jour de dépôt. Proposer une pièce
  (déjà déposée, ou `deposerFichier` puis proposée), retirer la sienne, écrire une précision : par les trois fonctions de
  P7 seules, refus redits avant le clic sous les mots de la migration (le refus 4, exercice figé, ne se dit pas d'avance
  au client : il ne lit pas `exercices_valides`), sous UN verrou relâché après la relecture ; propositions ou fil lus en
  partie : ni état ni geste → « « MA BANQUE » : L'ÉCRAN DU CLIENT « BANQUE » ».
- **« Ma banque » côté cabinet** (P9b, 11/10/2026) : la fiche d'un mouvement dit EN TÊTE la pièce que le client a
  proposée (`justificatifs_proposes`), « Proposée par le client le … » — l'origine est celle que la base a écrite, le
  compte reconnu parmi les accès lus en entier (`lib/banqueCabinet.ts`, pur ; `lib/banqueCabinetLecture.ts`), un accès
  retiré dit tel, jamais deviné ; elle s'associe par `onRapprocher` (le chemin et les refus du choix à la main), et ce
  qu'il en advient (retenue, mouvement classé ou figé, pièce payée ailleurs, figée, absente) se lit et se dit ; elle ne
  se retire jamais d'elle-même : le cabinet l'écarte (P9b2, P9B-Q1 : `retirer_proposition` seule, jamais celle que le
  mouvement retient) et supprime un message du fil (P9B-Q2 : la policy du cabinet, la ligne supprimée relue), sur une
  confirmation qui dit ce que le client verra ensuite, tirée d'`etatDuMouvement`. Le fil (`precisions_mouvements`) et « Demander au client » (`ecrire_precision_mouvement`
  seule, sous `sousVerrou`, `LIBELLE_QUESTION_MOUVEMENT`) ; le filtre « Proposés par le client » ne change que la liste
  affichée. Propositions et fil se lisent ENSEMBLE, remis « en cours » à chaque lecture : partiels ou pas revenus, rien
  n'est dit ni offert → « « MA BANQUE » CÔTÉ CABINET », « ÉCARTER UNE PROPOSITION, SUPPRIMER UN MESSAGE ».
- **« Règlements » (A3, 13/10/2026)** : une vue de l'onglet Factures, à côté de « Factures » (sélecteur `segmented`, la
  vue par défaut restant « Factures ») — au cabinet dans l'onglet, au client « Ventes » dans « Mes ventes » ; une ligne
  par encaissement ou contre-passation (`lib/reglements.ts`, pur), la contre-passation NÉGATIVE, le retiré marqué ; sa
  déclaration dite par `pastilleDeclaration` appelée sur CET encaissement seul, puis `encaissementsDeclares`,
  `obligationEncaissee` et `refusDeclaration` — aucune règle recopiée ; lue par `lireLesVentesDuDossier` (le registre
  avec `moyen`, `cree_par`, `cree_le`) et le relevé, comme la fenêtre le lit, avec « Banque » seulement
  (`lib/reglementsLecture.ts`) ; une source lue en partie : ni ligne, ni total, ni export ; totaux par moyen et par mois
  et CSV sur les lignes FILTRÉES ; « par le client » au cabinet, sur des accès lus en entier ; chaque ligne ouvre
  « Encaissements » de SA facture, rien ne s'écrit d'ici ; revenir à « Factures » relit l'onglet → « « MES VENTES ›
  RÈGLEMENTS » ».
- **« Articles » (A2a, 14/10/2026)** : la troisième vue de l'onglet Factures, sous `ARTICLES_EXPORTES`, au cabinet dans
  l'onglet et au client « Ventes » dans « Mes ventes » (`ArticlesVue`, `ArticleSaisieModal` ; `lib/articlesVue.ts`,
  pur) : la liste lue en entier, sa recherche (référence, désignation), le filtre « Retirés » ; créer et modifier un
  article (tous ses champs par `enregistrer_article`), le retirer, le reprendre. Les refus sont ceux de
  `lib/articles.ts`, sur la saisie TELLE QU'ELLE PART : un prix qui n'est pas un nombre fidèle est « illisible », jamais
  arrondi, et ni taux ni nature ne sont choisis à la place de qui saisit ; un prix s'affiche avec deux à six décimales.
  « Par le client » au cabinet seul, sur le DERNIER geste (créé, modifié ou retiré), d'après des accès lus en entier ;
  la désignation et la description disent qui les lit (`LIBELLE_*_ARTICLE`) ; rien avant la lecture ; lue en partie,
  aucun geste ; un verrou `useRef` pour les trois gestes, relâché après la relecture → « LA LISTE DES ARTICLES, À
  L'ÉCRAN ».
- **« Un article dans la facture » (A2b, 14/10/2026)** : le formulaire d'une facture (`FactureFormModal`, au cabinet et
  au client « Ventes ») lit les articles EN ENTIER à son ouverture et offre sous chaque ligne « Choisir un article »
  (`ArticleChoixModal`, jamais un retiré), « Mettre l'article à ce prix » et « Enregistrer comme article »
  (`ArticleSaisieModal` préremplie) ; `lib/articlesFacture.ts`, pur, ne recopie aucune règle. Le choix remplit la ligne
  par `ligneDepuisArticle` ; une ligne déjà saisie ne se remplace qu'après une confirmation qui NOMME ce qui part
  (`ConfirmationArticle`, dans la page) ; la mention de TVA reste celle que le formulaire propose. La ligne reste LIBRE,
  et sa PROVENANCE ne vit qu'en mémoire jusqu'à A7. « Mettre l'article à ce prix » écrit TOUS les champs de l'article
  tel que lu, le prix seul changé, après une confirmation ; « Enregistrer comme article » ne préremplit le taux que d'un
  dossier redevable. Un verrou `useRef` pour les deux gestes, relâché après la relecture, exclusif de l'enregistrement
  de la facture ; rien avant la lecture, aucun geste sur une lecture partielle → « UN ARTICLE DANS LA FACTURE ».
- **« L'adresse de réception » (A6b1, 14/10/2026)** : une fenêtre pour les deux espaces (`AdresseReceptionModal`,
  `espace` OBLIGATOIRE) — au cabinet depuis Justificatifs, au client « Ventes » depuis le troisième bloc de « Tes
  plateformes » (`ConnexionsClient`, relu à la fermeture). Les adresses lues en entier et le SIRET du dossier à part
  (`lib/adressesReceptionLecture.ts`, aucune des deux lectures ne rejette) : rien avant le retour, « aucune adresse »
  d'une liste lue en entier seulement ; lue en partie, refusée, rompue ou sans SIRET lisible, la fenêtre le dit et
  n'offre aucun geste (`peutDeclarer`). Elle dit la courante — « À venir : à partir du … » au jour de Paris, « non
  vérifiée », ce que la source établit (`lib/adressesReceptionVue.ts`, pur) —, l'historique dès deux versions et « par
  le client » au cabinet seul, sur des accès lus en entier. Déclarer : la maille CHOISIE (proposée seulement quand
  l'identifiant n'en admet qu'une), la version remplacée retenue à l'ouverture, le refus du module jugé sur la saisie
  TELLE QU'ELLE PART (blancs des bords retirés), `declarer_adresse_reception` seule (`lib/adressesReceptionEcriture.ts`)
  sous un verrou `declarationEnCours` relâché après la relecture. « Vérifier sur l'annuaire » est un LIEN vers le
  portail public, sur un clic ; le nom de la plateforme dit qui le lit (`LIBELLE_PLATEFORME_ADRESSE`), et deux refus de
  la base se réécrivent pour le client → « L'ADRESSE DE RÉCEPTION, À L'ÉCRAN ».
- **L'encart « Facture électronique » (A6b2, 14/10/2026)** : une carte pour les deux espaces
  (`EncartFactureElectronique`, `espace` OBLIGATOIRE, union typée) — à l'accueil du client « Ventes »
  (`AccueilVentesClient`, sous `mesVentesOuvertes`, clé par la société) et dans la Vue d'ensemble du cabinet
  (`ChecklistTab`, sans « ce qui attend »). L'état se lit par `lib/etatFactureElectroniqueLecture.ts` — pas revenu, lu,
  ILLISIBLE ou refusé ; jamais « active » ni « à compléter » d'une valeur non lue ; la lecture ne rejette jamais et se
  garde avec le dossier — et se dit par `lib/encartFactureElectronique.ts` (pur) : ce qui manque, l'adresse (« À
  venir », « Non vérifiée », ce que sa source établit : les phrases d'`adressesReceptionVue`), les plateformes et, chez
  le client seul, ce qui attend — les encaissements à déclarer et les factures refusées ou rejetées sur sa plateforme,
  de listes lues en entier seulement, et « pas encore relevés » tant qu'aucun relevé des statuts n'a eu lieu. UNE
  lecture des ventes sur l'accueil, `useVentesDuClient` (`lib/ventesDuClientLecture.ts`), que les tuiles « À encaisser »
  et « À déclarer » (qui ne lisent plus) et l'encart partagent ; l'encart l'attend, les cases relues à la base
  comprises : sans « Ventes », ni encart ni appel de l'état. Aucune fenêtre ne s'ouvre d'ici (la grille est un
  conteneur) : chaque ligne MÈNE à « Mes ventes » ou à Justificatifs ; sur téléphone, la carte du client est une tuile —
  le titre et l'état en une ligne, le corps replié par une requête de conteneur sur `.bento`, le lien qui la couvre. Les
  factures qui relèvent de la facture électronique et attendent leur transmission ne se comptent pas (A6B2-Q1) →
  « L'ENCART « FACTURE ÉLECTRONIQUE », À L'ÉCRAN ».
- **« Clients » (A4b1, 15/10/2026)** : la quatrième vue de l'onglet Factures, sous `CONTACTS_EXPORTES`, au cabinet dans
  l'onglet et au client « Ventes » dans « Mes ventes » (`ContactsVue`, `ContactSaisieModal` ; `lib/contactsVue.ts`,
  pur ; `lib/contactsLecture.ts`, `lib/contactsEcriture.ts`). La liste est lue en entier, effacés compris (l'unicité
  d'un SIRET s'y juge), et un effacé ne s'AFFICHE jamais, ni dans la recherche (nom, SIREN, SIRET) ; les retirés sous
  « Retirés ». Nouveau client et modifier écrivent TOUS les champs par `enregistrer_contact` (`saisieQuiPart`), le refus
  du module dit avant le clic, un champ que le type n'ouvre pas caché, aucune validation native ; retirer, reprendre et
  EFFACER — une confirmation qui nomme le contact et ce qui part, les factures gardant leur copie, dix ans — sous un
  verrou `useRef` relâché après la relecture ; rien avant la lecture, aucun geste sur une lecture partielle. Un dossier
  de soins dit sa règle au-dessus de la liste et signale le contact rangé avant le passage aux soins (A4-Q4) :
  « Modifier » offert (la règle refuse la saisie TELLE QUELLE), « Reprendre » grisé, « Effacer » proposé, jamais
  d'office ; ses deux refus se réécrivent pour le client (`REECRITURES_CLIENT`). Le nom, l'adresse et les observations
  disent qui les lit (`LIBELLE_*_CONTACT`) ; « par le client » au cabinet seul, sur le dernier geste → « « MES VENTES ›
  CLIENTS » ».
- **« Un client dans la facture » (A4b2, 15/10/2026)** : le formulaire d'une facture (`FactureFormModal`, au cabinet et
  au client « Ventes ») lit les contacts EN ENTIER à son ouverture (`lireLesContacts`, sous `CONTACTS_EXPORTES`, gardés
  avec le dossier) et offre sous le champ « Client » « Choisir un client » (`ContactChoixModal` : les clients en cours,
  jamais un retiré ni un effacé, ni — dossier de soins — ceux que la règle refuse, une ligne le dit) et « Enregistrer ce
  client » (`ContactSaisieModal` préremplie, `saisieDeDepart`) ; `lib/contactsFacture.ts`, pur, ne recopie aucune règle.
  Le choix remplit le client ENTIER (un champ que le contact n'a pas est vidé ; ni l'e-mail, que la facture n'a pas, ni
  le numéro d'engagement) et l'échéance (émission + délai, `ajouterJours`), calculée AU CHOIX : une date d'émission
  changée ensuite le DIT et offre « Recalculer l'échéance », jamais en silence ; un client déjà saisi ne se remplace
  qu'après une confirmation qui nomme ce qui part ; la provenance ne vit qu'en mémoire jusqu'à A7, et reste quand on
  retouche le client. « Enregistrer ce client » : `enregistrer_contact` seule, le refus du module dit avant le clic,
  sous un verrou `useRef` (`gesteContactEnCours`) exclusif, dans les deux sens, de l'enregistrement de la facture et des
  gestes d'article, relâché après la relecture. **La règle des soins se DIT et ne refuse rien** (A4B2-Q2, tranchée
  « comme recommandé ») : un particulier ou un client établi hors de France d'un dossier de soins reçoit une information
  (`.note-info`, teinte neutre) qui ne redit pas le refus d'« Enregistrer ce client », dit sous le bouton aux mots de la
  base → « UN CLIENT DANS LA FACTURE ».
- **« Importer des clients » (A4b3b, 15/10/2026)** : un geste de la vue « Clients » (au cabinet et au client
  « Ventes »), sous `IMPORT_CONTACTS_EXPORTE`, sur une liste lue EN ENTIER seulement, qui ouvre `ContactsImportModal`
  (`espace` OBLIGATOIRE). Le fichier est lu dans le navigateur et ne part nulle part (`lib/contactsImportFichier.ts`,
  pur) : la borne (10 Mio, A4B3B-Q1) jugée avant toute lecture ; l'encodage DIT — une marque d'ordre (UTF-8, UTF-16 LE
  ou BE) décide, en strict, sans elle l'UTF-8 strict puis windows-1252 (le jumeau du `decoder` de `BalanceCard`) — ; un
  U+0000 refuse le fichier avant tout envoi, sa ligne et sa cause probable dites ; un découpage À PART de `parseCsv`
  (séparateur proposé sur la première ligne hors guillemets, `;`, tabulation ou `,`, dit et changeable ; un guillemet
  jamais fermé refusé ; les lignes blanches comptées) ; l'en-tête oui par défaut (A4B3-Q6 ouverte : aucun nom de
  l'ancien logiciel supposé). Chaque colonne va à UN champ (« proposé » d'après son nom, casse, accents et ponctuation
  ignorés, contre les libellés de l'application) ou, explicitement, à « Ne pas importer », nommée par l'aperçu ; une
  colonne « à choisir » fait attendre l'aperçu. Le type : une colonne dont chaque valeur se fait correspondre (non
  reconnue : SA ligne refusée, dite), sinon un type unique choisi (A4B3B-Q2). Les valeurs prennent les formes de
  `saisieQuiPart`, sans qu'un champ que le type n'ouvre pas soit écarté : le module le refuse sur sa ligne (A4B3B-Q3).
  L'aperçu : `refusDesLignes` contre la liste lue, « Ligne N : » et la ligne du fichier ; aucune ligne ou plus de mille,
  refusé avant tout (`refusDuNombreDeLignes`) ; « Importer N clients » sans aucun refus seulement, « ne se défait pas »
  (A4B3-Q4). `importer_contacts` seule (`importerContacts`), sous le verrou `gesteEnCours` des quatre gestes, relâché
  après la relecture ; le refus de la base dit dans la fenêtre → « IMPORTER DES CLIENTS, À L'ÉCRAN ».
- **« Exporter la fiche » (A4b3c, 15/10/2026)** : un geste de chaque ligne AFFICHÉE de la vue « Clients » (au cabinet et
  au client « Ventes » ; en cours ou retiré, jamais un effacé), aux conditions des autres gestes de la ligne (liste lue
  EN ENTIER, grisé pendant une écriture) ; rien ne s'écrit, aucun verrou, aucune lecture de plus : le fichier se compose
  dans le navigateur depuis la ligne DÉJÀ LUE et part par `telechargerTexte`, ni stockage ni journal.
  `lib/contactsExport.ts` (pur) : un CSV que l'import d'A4b3b RELIT tel quel — marque UTF-8, `;`, CRLF, l'en-tête aux
  libellés de l'import, UNE ligne — en copie FIDÈLE (la valeur rangée, le type sous son libellé, rien d'arrondi ni de
  « nettoyé ») ; un champ à `;`, `"`, CR ou LF entre guillemets, ses retours à la ligne GARDÉS (jamais `champCsv`, qui
  les aplatit). L'aller-retour par l'import le prouve, les quatre types à leurs bornes ; un type nul (« à préciser »,
  que la base refuse à un contact rangé) n'y revient pas. Le nom : `fiche-client-<nom simplifié>-AAAA-MM-JJ.csv`, le
  jour de Paris donné par l'appelant. UNE phrase au-dessus de la liste dit, avant le clic, ce que le fichier contient —
  toute la fiche, observations comprises — et que les factures n'y sont pas (rien ne les relie à un contact avant A7) ;
  au cabinet, « contact » pour la fiche et « le client » pour le seul titulaire (RGPD.md §6) → « EXPORTER LA FICHE D'UN
  CLIENT ».
- **« Paramètres » (A5b1, 16/10/2026)** : la cinquième vue de l'onglet Factures, après « Clients », sous
  `PARAMETRES_FACTURATION_EXPORTES`, au cabinet dans l'onglet et au client « Ventes » dans « Mes ventes »
  (`ParametresVue`, `ParametresSaisieModal` ; `lib/parametresFacturationVue.ts`, pur ;
  `lib/parametresFacturationLecture.ts`, qui ne rejette jamais ; `lib/parametresFacturationEcriture.ts`) ; le sélecteur
  passe à la ligne (`.segmented-a-la-ligne`). Les versions lues EN ENTIER, gardées avec le dossier : rien avant le
  retour ; lue en partie, refusée ou rompue, la vue le dit et n'offre AUCUN geste. UNE phrase en tête : aucune facture
  ne les lit ni ne les imprime encore (A7). La courante, chaque champ en mots, l'IBAN par quatre à l'affichage
  seulement, l'état de son RIB par `ceQueDitLeRib` (qui l'a posé, qui l'a confirmé, d'un même geste ou ensuite, au jour
  et à l'heure de Paris) ; d'une courante PROPOSÉE, le RIB en vigueur (`ribEnVigueur`) dit pour QUAND les factures
  porteront un RIB ; l'historique dès deux versions, les champs changés nommés (« RIB posé », « retiré », « changé
  (IBAN…) ») ; « par le client » au cabinet seul, sur des accès lus en entier. « Renseigner les paramètres » (sans
  aucune version : les `PROPOSITIONS_PAR_DEFAUT`, dites propositions) et « Modifier les paramètres » (la courante, tous
  les champs, la version remplacée RETENUE à l'ouverture) : le refus du module sur la saisie TELLE QU'ELLE PART,
  « Enregistrer » grisé sous lui et tant que rien ne diffère, ce que deviendra le RIB d'après `etatDuRibEnregistre`
  (MEG1-Q12, A5-Q4, A5-Q5), aucune validation native ; le cabinet qui retouche le BIC ou le titulaire d'un RIB PROPOSÉ
  en garde l'IBAN, et l'enregistrement le confirme d'emblée : la fenêtre le dit avant le clic, avec le conseil de la
  confirmation (`CONSEIL_VERIFICATION_RIB`, une seule phrase pour les deux chemins). « Confirmer le RIB », au cabinet
  seul : une confirmation dans la page (`ConfirmationArticle`) qui NOMME le RIB et qui l'a proposé, et conseille de le
  vérifier par un autre moyen que l'application ; le client lit « en attente de la confirmation de ton cabinet ». Les
  deux fonctions seules, sous le verrou `gesteEnCours` relâché après la relecture, relue aussi sur un refus ; les cinq
  textes libres disent qui les lit (`LIBELLE_*_PARAMETRES`) → « LES PARAMÈTRES DE FACTURATION, À L'ÉCRAN ».
- **« Identité du dossier » (A5b2, 16/10/2026)** : la carte de l'onglet Informations du cabinet porte, avec le SIRET et
  l'adresse, la dénomination imprimée, la ville du greffe, la forme juridique (un `<select>` : « Non renseignée », puis
  les 260 catégories de l'INSEE sous leur code) et le capital (caché pour la forme `1000`) : UN formulaire, UNE écriture
  des six colonnes de `dossiers` (`.update()` sous `dossiers_update`, verrou `identiteEnCours` en `useRef`), relue par
  `.select(…).maybeSingle()` — aucune ligne rendue, rien d'écrit, dit ; `onIdentiteUpdated` et `DossierDetail` reçoivent
  les valeurs TELLES QUE LA BASE LES A RENDUES, le formulaire en repart. `lib/identiteLegaleVue.ts`, pur : le capital lu
  FIDÈLEMENT (`lireCapital` : chiffres, virgule ou point, deux décimales au plus telles que tapées, « 12,345 » et
  « 0,10000000000000000001 » illisibles, jamais arrondis), écrit au centime (`capitalPourSaisie`) ; le refus avant le
  clic = capital illisible, puis `refusIdentiteLegale` (aucun message recopié), « Enregistrer » grisé ; le refus de la
  base (23514 sous le nom d'une contrainte de `REFUS_IDENTITE_LEGALE`) dit sous les mots du module. Un entrepreneur
  individuel : la dénomination PROPOSÉE (« <nom> EI », R526-27) par un bouton, « Utiliser « … » », jamais d'elle-même,
  seulement si elle diffère ; son capital, lu ou saisi, est REMIS À NUL dans la même écriture et la carte le dit avant
  le clic. Une colonne ABSENTE de la lecture du dossier (`undefined`) n'est pas nulle : les quatre champs ne s'offrent
  pas (toutes ou aucune), la carte le dit, l'écriture ne porte que le SIRET et l'adresse. UNE phrase : aucune facture ne
  les lit ni ne les imprime encore (A7). L'adresse, la dénomination et la ville du greffe disent que « le client du
  dossier » les lit (`LIBELLE_*_IDENTITE` : `dossiers_select` ouvre la ligne à tout accès du dossier, pas au seul
  « Ventes ») → « L'IDENTITÉ LÉGALE DU DOSSIER, À L'ÉCRAN ».
- **« L'avis d'un changement de RIB » (A5b3b, 17/10/2026)** : une ligne pour les deux espaces
  (`components/AvisChangementDeRib.tsx`, `espace` OBLIGATOIRE, union typée) — EN TÊTE de la Vue d'ensemble du cabinet
  (`ChecklistTab`, `span-12`, au-dessus des tuiles), et sous la salutation de l'accueil du client (`ClientHome`, à côté
  de la ligne des pièces jointes écartées) pour la case que la société AFFICHÉE lui ouvre : « Ventes » — seule ou avec
  « Banque », elle lit l'avis « Ventes » — ou « Banque » seul, aucune sinon et alors AUCUN appel
  (`destinataireDuClient`). L'écran LIT par `useDernierChangementDeRib` (le seul `.rpc(`, A5b3a) et passe la lecture ;
  la règle et les mots vivent dans `lib/changementDeRib.ts` (pur) : `changementAMontrer(lu, destinataire, aujourdhui)` —
  le jour de Paris DONNÉ, lu au rendu —, `ceQueDitLAvis`, `DUREE_DE_L_AVIS_EN_JOURS = 30`. Durée (A5B3-Q4) : chez le
  cabinet, un RIB PROPOSÉ reste tant qu'il est le dernier changement (une confirmation, un retrait, un autre RIB est un
  changement nouveau) ; tout le reste — chez le client tout changement, proposition comprise — trente jours, le jour du
  changement compris (du J au J + 29) ; un jour futur et un « aujourd'hui » illisible se montrent ; aucune marque
  « vu », rien ne s'écrit. Rien avant le retour (la Vue d'ensemble ne l'attend pas) ni sur « le RIB n'a jamais
  changé » ; illisible ou refusée, UNE LIGNE DISCRÈTE (le motif en infobulle), jamais le silence. Pastille d'attention
  devant un RIB proposé, neutre sinon ; le cabinet est mené à l'onglet Factures (« Aller aux factures » : la vue
  « Paramètres » est un état local de l'onglet), le client « Ventes » à « Mes ventes », « Banque » seul n'a aucun lien.
  Les phrases sont celles d'`avisDuChangement`, jamais réécrites ; celles du client passent `MOTS_DU_CABINET` → « L'AVIS
  D'UN CHANGEMENT DE RIB, À L'ÉCRAN ».
- **« Le logo des factures » (A5c2a, 17/10/2026)** : un bloc de la carte « Paramètres en cours », sous le RIB, pour les
  deux espaces (`LogoDesFactures`, `espace` OBLIGATOIRE ; `lib/logoDesFacturesVue.ts`, pur ;
  `lib/logoDesFacturesLecture.ts`, qui ne rejette jamais ; `lib/logoDesFacturesEcriture.ts`) ; rien sans version des
  paramètres. Le fichier que la version désigne est relu dans le seau, son SHA-256 recalculé et son type relu à sa
  signature AVANT toute image (URL d'objet révoquée) ; absent, refusé, illisible ou d'une autre empreinte, une ligne le
  dit ; le dossier du chemin n'est pas rejugé, la contrainte `parametres_facturation_logo_chemin_forme` le tient.
  Choisir ne fait rien partir (`logoPret` juge, le refus de la base est prédit sur le fichier compté comme il sera dans
  le seau) ; « Poser ce logo » ou « Changer le logo » dépose (`upsert: false`) puis écrit UNE version qui ne change que
  le logo, sous le verrou `gesteEnCours` relâché après la relecture ; un nom déjà pris (`estUnDoublonDuStockage`, sur ce
  que le SDK porte) fait relire le fichier, désigné s'il a la même empreinte ; un dépôt dont la version est refusée
  laisse le fichier (A5C-Q3), et l'écran le dit. « Retirer le logo » : une version sans logo, après une confirmation
  dans la page → « LE LOGO DES FACTURES, À L'ÉCRAN ».
- **Les pièces jointes écartées, dites au client** (ligne 22.9, 13/10/2026 ; migration
  `pieces_jointes_ecartees_au_client`, appliquée sur l'accord du cabinet, S228B-Q1 à Q4 tranchées « comme
  recommandé ») : la table reste fermée au client ; `pieces_jointes_ecartees_du_client` (`SECURITY DEFINER`,
  `admin_du_dossier` ou `client_du_dossier(…, 'membre')`, l'accès avant toute lecture) rend en UNE valeur `jsonb` le
  jour à Paris, la raison et le poids de celles des 90 derniers jours, vues ou non par le cabinet — jamais
  l'identifiant, l'empreinte, la marque « vue » ni son auteur ; le client ne marque rien. « Mes pièces » la lit par un
  crochet que l'accueil partage (`useEcarteesDuClient`, `lib/piecesJointesEcarteesClientLecture.ts` ;
  `ECARTEES_DU_CLIENT_EXPORTEES` confronté à l'export), à part de ses autres lectures, gardée avec la société ; carte
  `PiecesJointesEcarteesClient` aux mots du client ; l'accueil n'en dit que le compte, sous la phrase partagée
  `titreDuSignalement`, et renvoie à « Mes pièces » (`PiecesJointesEcarteesAccueil`, ligne 22.94) — rien avant le retour
  ni sur un vide lu en entier, une ligne discrète sur une lecture manquée, jamais le silence d'une liste qu'on croirait
  vide ; l'onglet Accès dit la collecte par `CE_QUE_DIT_LA_COLLECTE` → « LE CLIENT VOIT UNE PIÈCE JOINTE ÉCARTÉE DANS
  « MES PIÈCES » », « L'ACCUEIL DU CLIENT SIGNALE UNE PIÈCE JOINTE ÉCARTÉE ET RENVOIE À « MES PIÈCES » ».
- **Secrets** côté Supabase, jamais au bundle ni dans un journal. `superpdp_credentials`, `connexions_bancaires` et
  `connexions_plateformes` n'ont aucune policy (refus total hors service role). La clé SECRÈTE de Supabase n'entre ni au
  dépôt (public) ni au navigateur (`clesSupabase.test.ts`, `lib/clePublique.ts`).
- **Mot de passe oublié** (`lib/recuperationMotDePasse.ts`, `pages/NouveauMotDePasse.tsx`) : flux IMPLICITE de Supabase,
  gardé — le PKCE lierait le lien au navigateur qui l'a demandé, et sur iPhone l'application installée n'est pas
  Safari ; `redirectTo` toujours passé, `https://compta.jdarnis.fr/`, sans « # » (le service ajoute le sien), et par
  TOUTE demande de lien de la source (`ADRESSE_DE_RETOUR`, garde de source dans `recuperationMotDePasse.test.ts`) ;
  `main.tsx` lit l'adresse AVANT le premier rendu ; la session se reconnaît au jeton du lien, jugé une fois, ou à
  `PASSWORD_RECOVERY`, et le compte en attente survit au rechargement (`localStorage`, effacé par toute absence de
  session) ; le message de la demande est NEUTRE ; un fragment qui commence par « / » est une route, jamais un retour ;
  un code d'erreur ne s'affiche que s'il en a la forme, une description jamais. Le cabinet envoie le MÊME lien depuis
  l'onglet Accès (10/10/2026) : même appel, sans session (rien de plus que l'écran de connexion), un clic confirmé qui
  nomme l'adresse, sous verrou, jamais sur une liste d'accès partielle ou pas encore revenue ; la durée du lien ne
  s'écrit nulle part (réglée au tableau de bord, jamais lue) → « MOT DE PASSE OUBLIÉ », « LE LIEN DE RÉINITIALISATION
  DEPUIS L'ONGLET ACCÈS ».
- **Créer un accès ne touche jamais au mot de passe d'un compte existant** (`create-client-access`,
  `create-team-member`, décision du cabinet du 10/10/2026) : un compte que le cabinet connaît déjà est repris tel qu'il
  est, la réponse dit `compte: "cree"` ou `"existant"`, et l'écran dit de ne pas communiquer un mot de passe qui n'a pas
  servi (`lib/creationDesComptes.ts`) ; le titulaire change le sien lui-même (« Mot de passe oublié », ou le lien de
  l'onglet Accès). D'un compte d'ailleurs, le 409 dit ce qu'il disait (il existe, il n'est pas rattaché) et rien de
  plus : une phrase unique, gardée par les contrats (`compteIntact`, `neDitQueLExistence`) →
  « LA CRÉATION D'UN ACCÈS NE CHANGE PLUS LE MOT DE PASSE D'UN COMPTE EXISTANT ».
- **La règle des mots de passe est celle du tableau de bord** (une minuscule, une majuscule, un chiffre, un symbole,
  posées par le cabinet le 10/10/2026 ; dix caractères) : les quatre écrans qui posent un mot de passe (Accès, équipe,
  nouveau cabinet, nouveau mot de passe) en portent un REFLET (`lib/recuperationMotDePasse.ts` :
  `REGLE_DU_MOT_DE_PASSE`, `refusDeLaRegle`, à côté de `LONGUEUR_MINIMALE_MOT_DE_PASSE`), dit sous le champ et appliqué
  avant tout appel ; un réglage changé au tableau de bord se reporte là et dans PLAN_DE_REPRISE.md (§3, point 6). Le
  service fait foi : les trois fonctions qui créent des comptes lisent son refus au CODE, jamais au statut (422 pour les
  deux) ni au message — `email_exists` ou `user_already_exists`, déjà inscrit ; `weak_password`, 400 en français avec ce
  qui manque, sans chercher aucun compte (bloc `refusDuService`, recopié, `refusDuServiceCopie.test.ts` ; le SDK
  installé joué par `refusDuServiceClient.test.ts`) → « UN MOT DE PASSE REFUSÉ SE DISAIT « UN COMPTE EXISTE DÉJÀ » ».
- **Variables d'environnement** : PLAN_DE_REPRISE.md (fin du §3) les nomme toutes, `variablesEnvironnement.test.ts` les
  compare au code ; leurs valeurs ne se vérifient qu'à la main.
- Les données sont fictives aujourd'hui, et traitées dès maintenant comme identifiantes : aucun service tiers hors de
  cette liste.

## Fonctionnalités déjà implémentées

- **Cabinets et accès** : multi-cabinets avec super-admin, charte graphique par cabinet ; équipe ; accès clients, et
  leurs droits « Ventes » et « Banque » (09/10/2026, enregistrés, lus par `AuthContext` ; « Banque » ouvre la lecture du
  relevé et « Ma simulation » depuis P7, « Ventes » la lecture des ventes et leurs gestes par la base depuis P2, et
  dans les quatre fonctions de la vente depuis P3, 10/10/2026) ; « Mes ventes › Factures » (P4a, 11/10/2026) : l'onglet
  Factures et ses fenêtres pour le client « Ventes » ; la liaison de sa plateforme et de Super PDP, et les tuiles « À
  encaisser » et « À déclarer » de son accueil (P4b, 11/10/2026) ; « par le client » côté cabinet — pastille, filtre et
  mention dans les fenêtres (P4c, 11/10/2026) ; « Ma banque » (P9a, 11/10/2026) : le relevé importé, l'état de chaque
  mouvement, le solde lu, et proposer une pièce, retirer sa proposition, écrire une précision ; « Ma banque » côté
  cabinet — la pièce proposée en tête de la fiche d'un mouvement, le fil et « Demander au client », le filtre « Proposés
  par le client » (P9b, 11/10/2026), écarter la pièce proposée et supprimer un message du fil (P9b2, 11/10/2026) ;
  « Règlements » (A3, 13/10/2026) : la liste de tous les encaissements d'un dossier, ses filtres, ses totaux par moyen
  et par mois, son export CSV, au cabinet et au client « Ventes » ; le catalogue des articles en base, que le cabinet
  et le client « Ventes » tiennent par trois fonctions (A1, 14/10/2026), et sa vue « Articles » dans l'onglet Factures
  et « Mes ventes » : la liste, la recherche, le filtre « Retirés », créer, modifier, retirer et reprendre un article
  (A2a, 14/10/2026) ; dans le formulaire d'une facture, « Choisir un article », « Mettre l'article à ce prix » et
  « Enregistrer comme article », un prix unitaire à six décimales compris (A2b, 14/10/2026) ; l'adresse de réception
  d'un dossier, déclarée et versionnée, et l'état de sa facture électronique, en base, que le cabinet et le client
  « Ventes » lisent et déclarent par deux fonctions (A6a, 14/10/2026), et l'adresse à l'écran — la lire avec son
  historique, la déclarer ou la remplacer, « Vérifier sur l'annuaire » —, au cabinet depuis Justificatifs et au client
  « Ventes » depuis « Tes plateformes » (A6b1, 14/10/2026) ; l'encart « Facture électronique » — l'état lu en base, ce
  qui manque, l'adresse et les plateformes, et pour le client ce qui attend —, à l'accueil du client « Ventes », une
  tuile sur téléphone, et dans la Vue d'ensemble du cabinet (A6b2, 14/10/2026) ; le fichier des clients d'un dossier,
  en base — ranger, modifier, retirer, reprendre ou effacer un contact —, que le cabinet et le client « Ventes »
  tiennent par quatre fonctions (A4a, 15/10/2026), et sa vue « Clients » dans l'onglet Factures et « Mes ventes » —
  la liste, la recherche, le filtre « Retirés », nouveau client, modifier, retirer, reprendre, effacer après une
  confirmation, le signalement d'un contact rangé avant le passage aux soins (A4b1, 15/10/2026), et, dans le
  formulaire d'une facture, « Choisir un client », « Enregistrer ce client », l'échéance proposée par le délai du
  contact et la règle des soins dite (A4b2, 15/10/2026) ; l'import d'un fichier de clients, en base — mille lignes au
  plus, tout ou rien, par la fonction d'un contact saisi —, que le cabinet et le client « Ventes » font par une
  fonction (A4b3a, 15/10/2026), et son écran, « Importer des clients » — un fichier CSV lu dans le navigateur, ses
  colonnes choisies, l'aperçu ligne par ligne, l'import d'un seul tenant (A4b3b, 15/10/2026) ; « Exporter la fiche » —
  la fiche complète d'un client dans un CSV que l'import relit, composé dans le navigateur (A4b3c, 15/10/2026) ; les
  paramètres de facturation d'un dossier, en base — délai, moyen, escompte, pénalités, mentions, pied de page et RIB,
  versionnés, le RIB proposé par le client « Ventes » et confirmé par le cabinet —, et l'identité légale du dossier
  (dénomination, ville du greffe, forme juridique, capital), écrite par le cabinet seul (A5a, 16/10/2026), son écran —
  les quatre champs dans la carte « Identité du dossier » de l'onglet Informations, écrits avec le SIRET et l'adresse,
  la dénomination d'un entrepreneur individuel proposée, son capital remis à nul (A5b2, 16/10/2026) —, et leur vue
  « Paramètres » dans l'onglet Factures et « Mes ventes » — la version courante et l'état de son RIB, le RIB en vigueur,
  l'historique, une version nouvelle, la confirmation d'un RIB par le cabinet (A5b1, 16/10/2026) ; le dernier changement
  du RIB des factures, en base — le jour, l'auteur et l'état, jamais le RIB —, que le cabinet et les accès « Ventes » et
  « Banque » lisent par une fonction (A5b3a, 17/10/2026), et son avis à l'écran — en tête de la Vue d'ensemble du
  cabinet et sur l'accueil du client « Ventes » ou « Banque » ; chez le cabinet, un RIB proposé tant qu'il attend sa
  confirmation, le reste trente jours (A5b3b, 17/10/2026) ; le logo des factures d'un dossier, en base — un seau privé,
  `ventes`, où le cabinet et le client « Ventes » lisent et déposent, le logo désigné par une version des paramètres, le
  seau vidé avec le dossier (A5c1, 17/10/2026), et son écran — le voir, son empreinte vérifiée, le poser, le changer, le
  retirer, dans la vue « Paramètres » (A5c2a, 17/10/2026) ; client à plusieurs sociétés (sélecteur, `<Outlet key>`) ;
  accueil
  client en tableau de bord, dont « Ce qu'il reste à envoyer » dit la même chose que `ClientUpload` et la Checklist
  (`lib/resteAEnvoyer.ts`) ; mot de passe oublié (lien par e-mail, nouveau mot de passe avant tout autre écran,
  09/10/2026), et le même lien envoyé par le cabinet depuis l'onglet Accès (10/10/2026) ; créer un accès ou un membre ne
  change plus le mot de passe d'un compte existant, et l'écran le dit (10/10/2026) ; la règle des mots de passe dite
  avant le clic par les quatre écrans qui en posent un, et le refus du service dit en français (10/10/2026, défaut
  23.5).
- **Dossiers** : création, checklist, informations, code NAF ; interface d'ordinateur en trois volets (25/09/2026),
  volets redimensionnables (05/10/2026), application installable (PWA, 25/09/2026).
- **Pièces et documents** : dépôt, import en masse, OCR et citation des champs, classification, doublons (fichier et
  texte), validation ; texte OCR conservé et relu (pièces et documents) ; fil de précisions client ↔ cabinet ; notes
  internes du cabinet dans leur propre table, hors de portée du client (09/10/2026) ; proposition de catégorie
  (26/09/2026) ; la fiche « fournisseur établi hors de France » d'un achat : voir, saisir une version, retirer, avec ses
  propositions (e-reporting, e3, 10/10/2026) ; les bornes du stockage — format et taille jugés avant tout dépôt et posés
  en base sur les trois seaux, plus de SVG pour le logo (ligne 22.6, 12 et 13/10/2026) ; la pièce jointe que la
  réception par e-mail écarte (format, poids), n'a pas pu déposer (ligne 22.8) ou reçoit vide (ligne 22.91), dite au
  cabinet en tête de Justificatifs, sans nom, et marquée vue par lui (ligne 22.7, 13/10/2026) ; et dite au client dans
  « Mes pièces » — le jour, la raison et le poids, 90 jours durant (ligne 22.9, 13/10/2026) ; « Mes pièces » montre
  aussi au client l'adresse de collecte de son dossier, avec ce qu'elle accepte et « Copier l'adresse », et la carte des
  pièces jointes écartées la nomme (ligne 22.93, 13/10/2026) ; l'accueil du client les signale par une ligne — combien,
  et un renvoi vers « Mes pièces » (ligne 22.94, 13/10/2026).
- **Banque** : import CSV et PDF (contrôle de solde conservé), rapprochement manuel et par lots, règles « toujours
  ignorer », connexion bancaire (Enable Banking, bac à sable, 30/09/2026).
- **Comptabilité d'un BNC** (ligne 26.6, du 29/09 au 05/10/2026) : chaque mouvement du relevé s'écrit — affectation à
  une catégorie, règles d'affectation en lot, virement personnel (108), échéance d'emprunt (164, 661, 616), ventilation,
  règlement de plusieurs pièces par un virement (ligne 26), taux de TVA d'une recette sans facture, échéance de
  cotisation (646, CSG-CRDS au 108), l'échéance payée depuis le compte personnel (09/10/2026, en base et à l'écran ; son
  retrait le 10/10/2026) — ; dotations aux amortissements (prorata temporis), acquisition des biens (compte de la nature,
  445620, 404), forfait kilométrique (625110), note de frais face au 108 en trésorerie ; la 2035 comparée aux
  écritures ; la validation d'un exercice, qui le fige en base.
- **Comptabilité d'engagement**, étape 1 (ligne 31, 28/09/2026) ; lettrage déduit du rapprochement (05/10) et fait à la
  main (06/10, ligne 32) ; mouvement vers un compte de bilan (ligne 26.7) ; TVA liquidée, payée et remboursée (ligne
  26.8) ; report des soldes à la validation (ligne 34, 07/10/2026).
- **Déclarations** : 2035 remplie (cadre 8 et report vers la 2042, 26/09/2026), comptant chaque pièce à la date de son
  paiement (28/09) ; volet social des praticiens conventionnés et estimation Urssaf (28/09) ; CA3 préparée case par case
  (28/09) ; FEC (article A47 A-1) et piste d'audit (CSV) ; à-nouveaux depuis une balance reprise (26/09) ; l'annexe 2035-E
  (valeur ajoutée, CVAE) en page 3 de la liasse, et le calendrier de la CFE, de la CVAE et de la liasse dans la
  Checklist (ligne 48, 09/10/2026).
- **Facturation** : factures à numérotation légale, avoirs, envoi par e-mail ; Super PDP (réception, émission) ; statut de
  TVA du dossier (28.5 a), réception par la plateforme du client (28.5 b), mentions de la facture et avoir d'un seul
  tenant, générateur CII jugé par le validateur officiel, facture validée figée en base et numérotation fermée (28.5 c,
  07/10/2026) ; transmission de la facture électronique par la plateforme du client et par Super PDP, sous une
  transmission réservée, depuis l'onglet Factures — mentions saisies avant la validation et imprimées, suivi, abandon
  d'une issue inconnue, statut de Super PDP reporté, avoir interne d'une facture rejetée, numéro de TVA d'un dossier en
  franchise ou exonéré (28.5 c3 à c5, 08/10/2026) ; les encaissements d'une facture émise — registre en base (d1), module
  (d2), et l'écran : pastille de l'onglet Factures et fenêtre « Encaissements » (d3, 08/10/2026) ; la déclaration hors
  application et la contre-passation, en base et à l'écran (d4, 08 et 09/10/2026) ; le cycle de vie des factures
  émises lu sur la plateforme du client — relevé sur un clic, dernier statut sur chaque facture, refus de l'acheteur dit
  avant tout geste (d7, 09/10/2026) ; la vente qui revient de la plateforme du client ou de Super PDP
  reconnue comme la jumelle de sa facture émise, et la vente portée par plusieurs pièces dite par la Checklist, marquée
  dans Justificatifs et sa fiche, dite au bilan d'un import et dans « Encaissements » (ligne 28.6, 09/10/2026).
- **Bilan** (ligne 33, première brique, 09/10/2026) : l'onglet Bilan range les soldes de l'exercice dans les
  rubriques et les cases du 2033-A-SD 2026, en centimes, sans rien écrire ; un BNC en trésorerie y voit ses comptes de
  bilan, avec l'avis qu'il n'en établit pas (CGI, art. 99) ; la colonne de l'exercice précédent, en net (11/10/2026) ;
  l'ouverture confrontée à la clôture qui la précède, compte par compte puis rubrique par rubrique (11/10/2026).
- **Financement** : emprunts et échéancier, situation intermédiaire, plan de trésorerie, échéancier des dettes et
  ratios, prévisionnel à 3 ans ; suppléments ; comptes courants d'associés.
- **Autres écrans** : immobilisations, cotisations sociales (lecture best-effort des avis), Clôture (dont la purge du
  texte OCR des pièces sensibles après clôture, 22/09/2026), Estimation, Balance des comptes (pilotage, comptes de tiers
  à une date), Virements ; assistant comptable IA avec plafond de coût.
- **Exports** : pack (ZIP + Excel), export d'un cabinet, sauvegarde et restauration d'un dossier — **une sauvegarde
  n'est pas un pack** : le pack porte les fichiers, la sauvegarde les lignes qui les relient (PLAN_DE_REPRISE.md) ; le
  logo des factures n'est ni dans l'un ni dans l'autre : chaque version des paramètres en garde le chemin et
  l'empreinte, le manifeste le dit (`horsPerimetre`), et PLAN_DE_REPRISE.md (§4, point 6) dit de le redéposer.
- **Nouvelles clés d'API de Supabase** (30/09/2026).

## Fonctionnalités actuellement en cours

- **Proposition de catégorie** : à éprouver par un premier clic réel du cabinet.
- **Contre-calcul par l'expert-comptable** (ligne 23.3) : quatre dossiers de référence remis le 12/10/2026 (2035, CA3,
  amortissements, bilan 2033-A) ; restent ses chiffres, l'analyse des écarts, puis ses chiffres en cas de référence →
  « LES DOSSIERS DE RÉFÉRENCE ».
- **Déclarations TNS** (ligne 27) : restent hors de l'estimation — médecins et chirurgiens-dentistes, retraite, revenus
  de remplacement, ACRE, exonérations, outre-mer, régularisation ; DSCS proposée depuis la ligne 4 de la 2035-A, à
  confirmer sur une première déclaration réelle.
- **CFE et CVAE** (ligne 48) : restent la saisie par exercice de la part déductible des loyers, du cadre des
  mono-établissements et de l'effectif (une table à créer), celle de BW, les dates d'activité d'un dossier qui cesse en
  cours d'année, le millésime 2027, le plafonnement de la CET (plus tard, 48-Q9) — onze questions, tranchées le
  17/10/2026 →
  « L'ANNEXE 2035-E SE TIRE DE LA 2035 DÉPOSÉE ».
- **Télédéclaration de la TVA** (ligne 28) : étape 2, la transmission par un partenaire EDI — Teledec choisi, qui veut
  voir l'application fonctionner avant d'ouvrir son API ; ASPOne.fr l'autre voie. Rien n'est écrit.
- **Comptabilité d'engagement** (ligne 31) : restent les écarts de change et les frais bancaires (le rapprochement règle
  encore la pièce sur la banque — à trancher avec le cabinet), les auxiliaires des à-nouveaux et des soldes reportés,
  l'affectation du résultat d'une société, la TVA des livraisons de biens, la liasse (2033 ou 2050), les exercices
  décalés.
- **FEC** : restent les vingt-deux champs d'un BNC en trésorerie et les montants en devise (réponse de
  l'expert-comptable du cabinet attendue).
- **Ligne 26.6** : reste (e), les vingt-deux champs et Test Compta Demat ; l'opération découverte après coup, conçue,
  ses questions tranchées le 17/10/2026 (B1 à B13, sauf B9 : l'engagement, pour l'expert-comptable). Aucun exercice
  n'est encore validé en base.
- **Connexion bancaire** (ligne 24) : le prestataire définitif et son contrat ; le chemin du CLIENT, conçu avec l'espace
  client le 09/10/2026 (seul le titulaire donne l'accord ; le serveur importe ; étapes P8 et P9) ; la récupération
  automatique ou au clic (RGPD.md §8.8).
- **Clés historiques de Supabase** : reste leur désactivation dans le tableau de bord, un clic du cabinet.
- **Les pièces jointes écartées** (ligne 22.7, S226-Q3) : en base, dans `receive-email` et à l'écran le 13/10/2026 ; ses
  six questions tranchées par le cabinet le même jour, comme recommandé — la porte de la restauration au
  super-administrateur et le geste « vue » gardés (S227-Q1, Q2), la durée de conservation celle du dossier (Q4), les
  fichiers qui ne sont jamais des pièces comptés d'abord sur les signalements réels, une liste fermée d'extensions tue
  seulement s'ils font du bruit et si le cabinet la choisit (Q5). « Le dépôt a échoué » (Q3, ligne 22.8), le
  13/10/2026 : la troisième raison, en base (`pieces_jointes_ecartees_depot`, sur l'accord du cabinet, S228-Q1), dans
  `receive-email` et à l'écran ; un rejeu qui réussit après un dépôt échoué ne change rien, le cabinet marque l'alerte
  vue (S228-Q3). La pièce jointe arrivée vide, sous une quatrième raison, « vide » (S228-Q2, ligne 22.91 ; en base sur
  l'accord du cabinet, S229-Q1), et les éléments de l'e-mail qui ne sont pas des pièces jointes, comptés au journal sans
  nom pour chaque e-mail d'un dossier connu, même à zéro (S228-Q4, S229-Q2, ligne 22.92), le 13/10/2026. « Mes pièces »
  le dit au client — le jour, la raison et le poids, 90 jours durant —, et l'onglet Accès nomme les quatre raisons (Q6,
  S229-Q5, ligne 22.9, le 13/10/2026 ; la lecture présentée au cabinet puis appliquée sur son accord, S228B-Q1 à Q4) ;
  il y lit aussi l'adresse de collecte de son dossier (S228B-Q5, ligne 22.93), et son accueil les lui signale par une
  ligne qui y renvoie (S228B-Q6, ligne 22.94), le 13/10/2026. Reste, sur les comptes réels, la décision sur ces
  éléments — au premier client réel, la session les relève à chacune de ses reprises pendant un mois (le journal ne se
  garde qu'un jour sur le plan gratuit), une table des comptes sans nom seulement si une décision demande plus de recul
  (S229-Q3) ; « autre disposition » non nul, le filtre des pièces jointes se normalise dans une étape à part (S229-Q4) —
  → « UNE PIÈCE JOINTE ÉCARTÉE À LA RÉCEPTION PAR E-MAIL SE DIT AU CABINET », « LE DÉPÔT A ÉCHOUÉ : LA TROISIÈME RAISON
  D'UNE PIÈCE JOINTE ÉCARTÉE », « ARRIVÉE VIDE : LA QUATRIÈME RAISON D'UNE PIÈCE JOINTE ÉCARTÉE », « LE CLIENT VOIT UNE
  PIÈCE JOINTE ÉCARTÉE DANS « MES PIÈCES » », « « MES PIÈCES » MONTRE L'ADRESSE DE COLLECTE DU DOSSIER », « L'ACCUEIL DU
  CLIENT SIGNALE UNE PIÈCE JOINTE ÉCARTÉE ET RENVOIE À « MES PIÈCES » ».
- **Mot de passe oublié** : le premier essai réel du cabinet (iPhone), et celui du lien envoyé depuis l'onglet Accès ;
  au tableau de bord, la longueur minimale à 10 (à relever) et le modèle d'e-mail en français ; l'inscription publique
  est fermée et les sortes de caractères exigées depuis le 10/10/2026. Un mot de passe de plus de 72 octets reçoit
  encore le refus anglais du service, en 500 (question au cabinet, défaut 23.5). Un compte dont le dernier accès au
  cabinet a été retiré n'y est plus « rattaché » : lui recréer un accès bute sur le 409 (question au cabinet, Q-23.2) →
  « LA CRÉATION D'UN ACCÈS NE CHANGE PLUS LE MOT DE PASSE D'UN COMPTE EXISTANT ».
- **Facturation électronique** (ligne 28.5, décisions du cabinet du 07/10/2026) : (a), (b) et (c) en ligne — la
  réception et le dépôt à éprouver sur la plateforme réelle d'un client ; puis (d) le statut « Encaissée » — d1, le
  registre des encaissements, en base, d2, son module, et d3, son écran, le 08/10/2026 ; d4, la déclaration hors application et la contre-passation, en base le 08/10/2026
  et à l'écran le 09/10/2026 (la date d'une contre-passation confirmée le 17/10/2026) (décisions du cabinet du
  08/10/2026) ; d5, le message CDAR du statut, en module le 09/10/2026 (ses quatre choix à trancher par un premier
  essai réel) ; d7, le cycle de vie des factures émises lu sur la plateforme du client, en base, dans
  `plateforme-agreee` et à l'écran le 09/10/2026 (le premier relevé réel reste à faire) ; l'essai réel sur le bac à sable de Super PDP — et (e)
  l'e-reporting, conçu le 09/10/2026 : onze étapes ; les soins exonérés n'y entrent pas, les achats à l'étranger d'un
  dossier, même exonéré, si (opérations du 01/09/2027) ; dix questions au cabinet, Q2 à Q7 tranchées le 17/10/2026 ;
  e1, l'obligation dite juste, le 09/10/2026 (`lib/periodesEreporting.ts`) ; e2, la fiche d'un achat hors de France, en
  base le 10/10/2026 (Q3 et Q7 confirmées, le point 15 en hypothèse) ; e3, son écran, le 10/10/2026 (le point 15 dit
  dans la saisie) ; e4, le contenu des déclarations d'une période, en module le 10/10/2026 (`lib/ereporting.ts`) ; e5a,
  le régime d'e-reporting confirmé et son histoire — celle du statut de TVA — et la pièce écartée, en base le 11/10/2026
  et lus par le contenu d'e4 ; e5b conçue — la déclaration hors application, Q6, la fiche déclarée qui retient sa
  pièce — et neuf questions au cabinet (Q4, E5-Q1 à E5-Q7, Q6) ; e5b1, la déclaration hors application — le contenu
  d'e4 figé et son empreinte, l'initiale et la rectificative, la pièce que sa fiche déclarée retient —, en base et en
  module le 11/10/2026 (E5-Q6 et E5-Q7 prises comme hypothèses ; Q6 tranchée le 17/10, e5b2 ; quatre questions
  nouvelles, E5B-Q1 à Q4) ; e5c, les écrans — la carte de l'onglet TVA et sa fenêtre, l'écart d'une pièce dans sa fiche,
  la pièce déclarée qui ne se supprime plus —, le 11/10/2026 (E5-Q2, E5-Q3, E5-Q5, E5-Q6, E5-Q7 et Q4 prises comme les
  recommandations ; la rectificative à zéro opération dite et jamais offerte) ; e6, le fichier FRR d'une déclaration, en
  module et instrument le 11/10/2026 (`lib/fluxEreporting.ts`, `outils/facturation/ereporting/valider.mjs`, six
  exemples fictifs validés par les XSD officiels ; quatre choix non vérifiés en paramètres et quatre questions de plus,
  E6-Q1 à E6-Q8) ; restent e5b2 (Q6), e6b (le bouton qui télécharge le fichier) et la suite → « LE FICHIER D'UNE
  DÉCLARATION D'E-REPORTING », « L'E-REPORTING : LA CONCEPTION », « LES ÉCRANS DE L'E-REPORTING : LA CARTE, LA FENÊTRE, L'ÉCART D'UNE
  PIÈCE », « L'E-REPORTING :
  L'OBLIGATION DITE JUSTE », « LA FICHE D'UN ACHAT HORS DE FRANCE, EN BASE », « LA FICHE D'UN ACHAT HORS DE FRANCE, À
  L'ÉCRAN », « LE CONTENU DES DÉCLARATIONS D'E-REPORTING », « LE RÉGIME D'E-REPORTING CONFIRMÉ ET LA PIÈCE ÉCARTÉE, EN
  BASE », « LA DÉCLARATION D'E-REPORTING HORS APPLICATION, EN BASE ».
- **Défauts connus des Edge Functions** (3, `DEFAUTS_CONNUS`) : deux décisions du cabinet seulement — l'objet et
  l'expéditeur d'un e-mail reçu au journal (`receive-email`), `taux-change-bce` sans contrôle d'appelant (l'inscription
  publique, fermée le 10/10/2026, n'admet plus un inconnu ; les clés historiques restent à désactiver). Plus aucune
  fonction ne lève ni ne répond en anglais sur un corps mal formé (JSON `null`, tableau, texte, nombre, champ d'une autre
  forme qu'un texte) : toutes le refusent en 400 français avant toute dépense (les quatre dernières, `delete-cabinet`,
  `superpdp-sync`, `proposer-categorie` et `evaluer-extraction`, le 11/10/2026) ; `evaluer-extraction` ne journalise
  plus la réponse illisible du modèle, seulement sa longueur → « LES DERNIERS CORPS MAL FORMÉS DES EDGE FUNCTIONS ».
- **Une vente entrée deux fois** (ligne 28.6) : le pont, la Checklist et l'écran (phase C) en ligne le 09/10/2026 ;
  reste le PDF d'une facture émise, que rien ne relie encore à elle (Q1, « oui » le 17/10/2026 : une migration, à
  écrire ; Q2, « pas maintenant », contredit EC-Q3 : la question est reposée au cabinet).
- **Bac à sable Super PDP** : l'essai réel de l'émission avec le cabinet.
- **Révision des comptes** (ligne 41) : conçue le 09/10/2026 — une décision immuable par solde de bilan, le travail et
  la revue par cycle, des preuves proposées et jamais appliquées seules, la mémoire d'un exercice à l'autre ; neuf
  étapes R1 à R9, douze questions au cabinet, tranchées le 17/10/2026 → « LA RÉVISION DES COMPTES : LA CONCEPTION » ;
  R1, la base des soldes révisés, en base le 09/10/2026 (Q2, Q3, Q7, Q8 et Q11, ses hypothèses, confirmées) ; R2, le
  module, le 10/10/2026 (quatre lectures de la conception dites dans le code, confirmées) ; R3, l'onglet Révision, le
  10/10/2026 (les préalables de la validation n'y sont pas encore) ; R4, les cycles — le programme de travail PROPOSÉ,
  la conclusion, le journal, la revue du chef —, en base et en module le 10/10/2026 (Q2, Q7 et Q11 confirmées,
  comme en R1 ; Q5 et Q6 tranchées le 17/10/2026), et à l'écran le même jour (phase C) ; R5, la revue analytique —
  le seuil de signification fixé et motivé par le cabinet, l'explication d'une variation, la source de N−1 dite —, en
  base et en module le 11/10/2026 (Q4, Q2, Q11 et Q7 confirmées), et à l'écran le même jour (phase C) →
  « LA REVUE ANALYTIQUE, EN BASE », « L'ÉCRAN DE LA REVUE ANALYTIQUE » ; R7, le dossier permanent — une entrée par
  élément de A9 (lettre de mission, description de l'entité, organisation comptable, statuts, baux et contrats), datée,
  valable pour une période, citant au plus une pièce ou un document, qui se remplace ou se retire et ne se modifie
  jamais —, en base le 12/10/2026 (Q2, Q7, Q8 et Q9 confirmées ; R7-Q1 à R7-Q6 au cabinet), et à l'écran le
  même jour (phase C), puis ses deux retouches (R7C-Q1 et R7C-Q2 tranchées « option B » par le cabinet le 12/10/2026,
  R7C2-Q1 « oui » le même jour ; R7C-Q3 reste ouverte) → « LE DOSSIER PERMANENT DE LA RÉVISION, EN BASE », « L'ÉCRAN DU
  DOSSIER PERMANENT DE LA RÉVISION », « LES DEUX RETOUCHES DU DOSSIER PERMANENT » ; R6 (Q1 : la révision retient la
  validation) attend un premier exercice réel révisé → « LA BASE DES SOLDES RÉVISÉS », « LE MODULE DE LA RÉVISION »,
  « L'ÉCRAN DE LA RÉVISION », « LES CYCLES DE LA RÉVISION », « L'ÉCRAN DES CYCLES DE LA RÉVISION ».
- **L'espace client, logiciel de gestion du client** (décision du cabinet du 09/10/2026 : devis, factures et facture
  électronique, vue de la banque) : conçu le 09/10/2026 — des droits par accès (Ventes, Banque) tenus en base, les
  portes du cabinet ouvertes au client, une série de factures par dossier, les devis, la banque du client (accord du
  titulaire, import par le serveur sur un lot signé, pièce déposée à côté du mouvement) ; onze étapes P0 à P10, sept
  questions au cabinet, tranchées le 17/10/2026 (EC-Q2 contredit MEG1-Q5, EC-Q3 contredit 28.6-Q2 : reposées) →
  « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION » ; P0, les notes
  internes hors de portée du client, en base et à l'écran le 09/10/2026 — reste la suppression des anciennes colonnes,
  écrite et éprouvée sur une réplique, que le cabinet a acceptée le 17/10/2026 (EC-Q7) et qui reste à appliquer (avec
  elle : trois essais, `types.ts`, `inventaire.py` et le socle) → « LES NOTES INTERNES DU CABINET, HORS DE PORTÉE DU
  CLIENT » ; P1, les droits d'un accès, en base, dans
  l'onglet Accès et dans `AuthContext` le 09/10/2026, sans rien ouvrir encore (EC-Q1, confirmée le 17/10/2026 ;
  l'invariant 3 bis de `rls.sql` se juge depuis P7 et P2) → « LES DROITS D'UN ACCÈS CLIENT, TENUS EN BASE ».
  P7, la banque du client en base (décision du cabinet du 10/10/2026 : les deux migrations, EC-Q1, les relevés déposés
  en fichier lisibles par tout accès) : FAITE le 10/10/2026 — `banque_du_client` (deux registres écrits par trois
  fonctions, la couverture du relevé), la bascule `COUVERTURE_EXPORTEE` en ligne, puis le resserrement
  `lectures_bancaires_au_droit_banque` (les trois lectures de la banque au droit « Banque ») ; ses écrans viendront avec
  P8 et P9 → « LA BANQUE DU CLIENT EN BASE », « LA BANQUE DU CLIENT : LA PREMIÈRE MIGRATION APPLIQUÉE », « LA BANQUE DU
  CLIENT : LE RESSERREMENT APPLIQUÉ ».
  P2, les ventes du client en base (décision du cabinet du 10/10/2026, à la condition des libellés, remplie avant —
  étape A) : FAITE le 10/10/2026 — `ventes_du_client` par `apply_migration` (neuf lectures au droit « Ventes », les
  fonctions des encaissements et l'abandon à `gere_les_ventes`, `valide_par`, `cree_par`), puis
  `ventes_du_client_facturation` collée par le cabinet (`enregistrer_facture` au même droit,
  `supprimer_brouillon_facture`), et la bascule (`VENTES_DU_CLIENT_EXPORTEES`, `SUPPRESSION_BROUILLON_EXPORTEE`) :
  l'onglet Accès dit ce que « Ventes » ouvre, l'onglet Factures supprime un brouillon par la fonction ; ses écrans
  viendront avec P3 et P4 → « LES VENTES DU CLIENT, EN BASE », « AVANT LES VENTES DU CLIENT », « LES VENTES DU CLIENT,
  APPLIQUÉES : LA BASCULE ». P3, les fonctions de la vente acceptent le client, le 10/10/2026 (EC-Q4, confirmée
  le 17/10/2026 ; la phrase des cases de l'onglet Accès dit ce qu'elles ouvrent) → « LES FONCTIONS DE LA VENTE ACCEPTENT
  LE CLIENT ». P4a, « Mes ventes › Factures », le 11/10/2026 (les gestes du cabinet retirés, la banque dite, les mots du
  client) ; P4b, les connexions du client (EC-Q4 confirmée) et les tuiles de son accueil, le 11/10/2026 ;
  P4c, « par le client » côté cabinet, le 11/10/2026 ; reste la mention du mandataire à l'impression (EC-Q2, retenue :
  le nom du cabinet figé avec la facture, une migration d'`enregistrer_facture`) → « « MES VENTES › FACTURES » », « LES
  CONNEXIONS DU CLIENT ET LES TUILES DE SON ACCUEIL », « « PAR LE CLIENT » CÔTÉ CABINET ». P9a, « Ma banque » côté
  client, le 11/10/2026 (EC-Q5 confirmée), P9b, le côté cabinet, et P9b2 (P9B-Q1 et P9B-Q2 tranchées « oui » par le
  cabinet : écarter une proposition, supprimer un message du fil) le même jour ; reste P8 (la connexion du client) →
  « « MA BANQUE » : L'ÉCRAN DU CLIENT « BANQUE » », « « MA BANQUE » CÔTÉ CABINET », « ÉCARTER UNE PROPOSITION, SUPPRIMER
  UN MESSAGE ».
  P5,
  les devis en base, préparée et éprouvée sur une réplique le 10/10/2026 : deux migrations (la seconde à coller, P2
  d'abord) et un retour arrière, présentés au cabinet, PAS appliqués ; le code suit derrière `DEVIS_EXPORTES`
  (`lib/devis.ts`, sa sauvegarde déclarée au plan PRÉVU) ; quatre questions au cabinet (EC-D1 la validité proposée,
  EC-D2 les mentions d'un métier, EC-D3 l'acompte, EC-D4 les données des clients du client) → « LES DEVIS, EN BASE ».
  La suite, conçue le 11/10/2026 en trois parties à la demande du cabinet (« au minimum faire comme le logiciel du
  client, et aller plus loin ») : dans les domaines ouverts, les articles, les règlements, les factures importées et la
  numérotation qui continue, les contacts, les paramètres de facturation, l'encart « Facture électronique » (A1 à A11) ;
  la parité — achats, notes de frais, analyse, documents du cabinet, trois cases neuves (« Achats », « Notes de frais »,
  « Documents »), le resserrement des pièces (B1 à B9) ; « aller plus loin » — l'échéancier, l'état du dossier, les
  situations publiées (C1 à C8) ; trente-cinq questions au cabinet → « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT :
  LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ ». A3, « Règlements », le 13/10/2026 (ses quatre questions, A3-Q1 à
  A3-Q4, tranchées « comme recommandé » le même jour : rien ne change) → « « MES VENTES › RÈGLEMENTS » ».
  A1, les articles en base, appliquée le 14/10/2026 sur l'accord du cabinet (A1-Q1 ; MEG1-Q1 et A1-Q2 à A1-Q4 tranchées
  « comme recommandé » le même jour), et la bascule (`ARTICLES_EXPORTES`) en ligne : la sauvegarde d'un dossier les
  emporte, l'onglet Accès dit que « Ventes » ouvre le catalogue et ses quatre gestes → « LES ARTICLES, EN BASE ». A2a,
  la vue « Articles » de l'onglet Factures et de « Mes ventes », la liste et ses gestes, le 14/10/2026 (ses cinq
  lectures de la conception, A2-Q1 à A2-Q5, tranchées « comme recommandé » le même jour) → « LA LISTE DES ARTICLES, À
  L'ÉCRAN ». A2b, un article dans le formulaire de facture, le 14/10/2026 (ses huit lectures, A2B-Q1 à A2B-Q8, tranchées
  « comme recommandé » le même jour) → « UN ARTICLE DANS LA FACTURE ». A6a, l'adresse de réception et l'état de la
  facture électronique en base, appliquée le 14/10/2026 sur l'accord du cabinet (A6-Q1 ; MEG1-Q16 et A6-Q2 à A6-Q4
  tranchées « comme recommandé » le même jour), et la bascule (`ADRESSES_RECEPTION_EXPORTEES`) en ligne : la sauvegarde
  d'un dossier emporte son adresse et son historique, par vagues ; l'onglet Accès dit que « Ventes » ouvre l'adresse,
  son histoire, sa déclaration et l'état → « L'ADRESSE DE RÉCEPTION ET L'ÉTAT DE LA FACTURE ÉLECTRONIQUE, EN BASE ».
  A6b1, l'adresse de réception à l'écran — sa fenêtre, au cabinet depuis Justificatifs et au client « Ventes » depuis
  « Tes plateformes » —, le 14/10/2026 (ses six lectures de la conception, A6B1-Q1 à A6B1-Q6, tranchées « comme
  recommandé » le même jour) → « L'ADRESSE DE RÉCEPTION, À L'ÉCRAN ». A6b2, l'encart « Facture électronique » — à
  l'accueil du client « Ventes » avec sa tuile du téléphone, et dans la Vue d'ensemble du cabinet —, le 14/10/2026 (ses
  cinq lectures de la conception, A6B2-Q1 à A6B2-Q5, tranchées « comme recommandé » le même jour) → « L'ENCART « FACTURE
  ÉLECTRONIQUE », À L'ÉCRAN ». A4a, les contacts en base, appliquée le 15/10/2026 sur l'accord du cabinet (A4-Q6 ;
  MEG1-Q9 à Q11 et A4-Q1 à A4-Q5 tranchées « comme recommandé » le même jour), et la bascule (`CONTACTS_EXPORTES`) en
  ligne : la sauvegarde d'un dossier emporte ses contacts ; l'onglet Accès dit que « Ventes » ouvre le fichier de ses
  clients et ses quatre gestes, l'effacement compris → « LES CONTACTS, EN BASE ». A4b1, la vue « Clients » de l'onglet
  Factures et de « Mes ventes » — la liste et ses gestes, l'effacement confirmé, le signalement d'un contact rangé avant
  le passage aux soins —, le 15/10/2026 (ses trois lectures de la conception, A4B1-Q1 à A4B1-Q3, tranchées « comme
  recommandé » le même jour) → « « MES VENTES › CLIENTS » ». A4b2, un client dans la facture — « Choisir un client »,
  « Enregistrer ce client », l'échéance proposée, la règle des soins dite —, le 15/10/2026 (ses quatre lectures,
  A4B2-Q1 à A4B2-Q4, tranchées « comme recommandé » le même jour) → « UN CLIENT DANS LA FACTURE ». A4b3a, l'import d'un
  fichier de clients en base — `importer_contacts`, tout ou rien, chaque ligne par `enregistrer_contact` elle-même —,
  appliquée le 15/10/2026 sur l'accord du cabinet (A4B3-Q5 ; A4B3-Q1 à A4B3-Q4 tranchées « comme recommandé » le même
  jour), et la bascule (`IMPORT_CONTACTS_EXPORTE`) en ligne : l'onglet Accès dit que « Ventes » ouvre l'import →
  « L'IMPORT D'UN FICHIER DE CLIENTS, EN BASE ». A4b3b, son écran — le fichier et son encodage, ses colonnes, l'aperçu
  ligne par ligne —, le 15/10/2026 (ses six questions, A4B3B-Q1 à Q6, tranchées « comme recommandé » le 16/10/2026) →
  « IMPORTER DES CLIENTS, À L'ÉCRAN ». A4b3c, « Exporter la fiche » — la copie fidèle de la fiche d'un client, dans un
  CSV que l'import relit —, le 15/10/2026 (ses six questions, A4B3C-Q1 à Q6, tranchées « comme recommandé » le
  16/10/2026) → « EXPORTER LA FICHE D'UN CLIENT ». A5a, les paramètres de facturation en base — par dossier, des
  versions : le délai, le moyen, l'escompte, les pénalités, des mentions, un pied de page et le RIB, proposé par le
  client « Ventes » et confirmé par le cabinet ; sur `dossiers`, l'identité légale —, appliquée le 16/10/2026 sur
  l'accord du cabinet (A5-Q1 ; MEG1-Q12 à Q14 et A5-Q2 à A5-Q10 tranchées « comme recommandé » le même jour), et la
  bascule (`PARAMETRES_FACTURATION_EXPORTES`) en ligne : la sauvegarde d'un dossier emporte ses versions, par vagues ;
  l'onglet Accès dit que « Ventes » ouvre les paramètres, leur histoire et leur enregistrement, et qu'un RIB que le
  client pose n'est que proposé → « LES PARAMÈTRES DE FACTURATION, EN BASE ». A5b1, l'écran des paramètres — la vue
  « Paramètres » de l'onglet Factures et de « Mes ventes » : la version courante et l'état de son RIB, l'historique, une
  version nouvelle, la confirmation d'un RIB par le cabinet —, le 16/10/2026 (ses huit questions, A5B1-Q1 à Q8,
  tranchées « comme recommandé » le 17/10/2026) → « LES PARAMÈTRES DE FACTURATION, À L'ÉCRAN ». A5b2, l'identité légale
  dans l'onglet Informations — les quatre champs avec le SIRET et l'adresse —, le 16/10/2026 (ses sept questions,
  A5B2-Q1 à Q7, tranchées « comme recommandé » le 17/10/2026) → « L'IDENTITÉ LÉGALE DU DOSSIER, À L'ÉCRAN ». A5b3a, le
  dernier changement du RIB en base — `dernier_changement_de_rib`, une fonction de lecture qui dit au cabinet et aux
  accès « Ventes » et « Banque » le jour, l'auteur et l'état du dernier changement du RIB des factures, jamais le RIB —,
  appliquée le 17/10/2026 sur l'accord du cabinet (A5B3-Q1 ; A5B3-Q2 à Q7 tranchées « comme recommandé » le même jour),
  et la bascule (`CHANGEMENT_DE_RIB_EXPORTE`) en ligne : l'onglet Accès dit ce que « Banque » en apprend → « LE DERNIER
  CHANGEMENT DU RIB, EN BASE ». A5b3b, l'avis de ce changement à l'écran — en tête de la Vue d'ensemble du cabinet, sur
  l'accueil du client « Ventes » ou « Banque » —, le 17/10/2026 (ses sept questions, A5B3B-Q1 à Q7, tranchées « comme
  recommandé » le même jour : rien ne change) → « L'AVIS D'UN CHANGEMENT DE RIB, À L'ÉCRAN ». MEG1-Q5, la numérotation,
  tranchée le même jour « comme recommandé » : deux séries par dossier, celle du client et celle du mandataire, choisie
  selon qui valide — le client valide ses factures, la série du cabinet ne sert qu'à le dépanner —, et la série de
  l'ancien logiciel qui continue ; rien n'en est encore écrit (A9). A5c1, le logo des factures et son seau en base — le
  seau privé `ventes` (500 Kio, PNG ou JPEG), ses trois policies (lire et déposer sous `<dossier>/logos/` :
  `gere_les_ventes` ; supprimer : le chef du cabinet du dossier ; aucune mise à jour), `logo_chemin` et `logo_sha256`
  sur `parametres_facturation`, le huitième rang d'`enregistrer_parametres_facturation` —, appliquée le 17/10/2026 sur
  l'accord du cabinet (A5C-Q1 ; A5C-Q2 à Q6 tranchées « comme recommandé » le même jour), et la bascule
  (`LOGO_DES_FACTURES_EXPORTE`) en ligne : la suppression d'un dossier vide le seau, la sauvegarde garde le chemin et
  l'empreinte du logo, pas le fichier, l'onglet Accès dit ce que « Ventes » ouvre de plus → « LE LOGO DES FACTURES ET
  SON SEAU, EN BASE ». A5c2a, l'écran du logo — le voir (son fichier relu, son empreinte recalculée), le poser ou le
  changer, le retirer, dans le bloc « Logo des factures » de « Paramètres » —, le 17/10/2026 (A5C2-Q1 à Q8 posées au
  cabinet) → « LE LOGO DES FACTURES, À L'ÉCRAN ». Restent, dans l'ordre recommandé, A4B3-Q6 (la ligne d'en-tête et les
  noms des colonnes du fichier de l'ancien logiciel, ouverte), A5c2b (le fichier du logo dans la sauvegarde, A5C-Q5) et
  le tableau de bord du cabinet (les dossiers dont un RIB proposé attend sa confirmation, dits en
  une fois par une fonction — A5B3-Q5), puis A7 (la facture fige ses mentions — l'unité, la référence et l'article sur
  la ligne enregistrée, le contact d'où vient son client, le RIB et les conditions en vigueur, le logo qu'elle imprime,
  les autres mentions de R123-237 (A5-Q9) —, une migration), la liste des clients sans activité depuis trois ans, qui
  lit les factures d'un contact (A7 les relie), et la suite du premier groupe.
- **Bilan** (ligne 33) : restent l'affectation du résultat d'une société, la forme juridique du dossier, l'impôt sur les
  sociétés, l'inventaire (35), les stocks (36), puis la liasse 2033 (37) ; neuf questions tranchées le 17/10/2026 (la
  forme juridique, posée au dossier par A5b2, que le bilan lira : 33-Q6), et deux sur l'ouverture, ouvertes (O33-Q1 : un
  écart retient-il la validation de N ; O33-Q2 : confronter une balance reprise) → « LE BILAN
  SE LIT DANS LES RUBRIQUES DU 2033-A », « L'OUVERTURE CONFRONTÉE AU BILAN QUI LA PRÉCÈDE ».
- **Plan comptable personnalisable** (ligne 43) : conçu le 09/10/2026 — le plan du dossier, sous les racines du PCG,
  lu par la base, figé à la première écriture ; étapes PC1 à PC9, douze questions tranchées le 17/10/2026 → « LE PLAN
  COMPTABLE PERSONNALISABLE : LA CONCEPTION » ; PC1, le catalogue des rôles et le plan d'un dossier, en base le
  10/10/2026 — NEUTRE : aucune policy ne l'écrit avant PC4, le plan de chaque dossier est vide (Q3 et Q5 confirmées) →
  « LE CATALOGUE DES RÔLES ET LE PLAN D'UN DOSSIER, EN BASE » ; PC2, la base lit le plan, en base le 11/10/2026 (six
  migrations : la première par l'outil, les cinq autres collées par le cabinet) — NEUTRE : les quatorze fonctions de la
  § 2.3 lisent chaque compte de rôle dans le plan, vide, donc à son défaut → « LA BASE LIT LE PLAN, SANS RIEN CHANGER »,
  « LA BASE LIT LE PLAN, APPLIQUÉE ET INTÉGRÉE » ; PC3a, l'application lit le plan, le 12/10/2026 — NEUTRE : lu avec le
  dossier, entier ou rien, il atteint chaque écriture composée (§ 2.1) et chaque contrôle qui la recompose ; restent la
  § 2.4 et la § 2.5 (13 fichiers, 63 emplois comptés par `comptesEnDur.test.ts`) et les libellés du plan (§ 3.9), puis
  PC3b, l'assistant (121) ; une question au cabinet (PC3-Q1) → « L'APPLICATION LIT LE PLAN ».

## Feuille de route — page Notion à tenir à jour

La feuille de route vit dans Notion, pas ici : « jd-precompta — état des lieux et route vers le cabinet autonome »
(https://app.notion.com/p/3df6a715e8ad81148546d58c449c593a), base inline « Feuille de route — du premier commit au
cabinet autonome », triée par `Ordre` : le livré (phase 0), puis le restant dans l'ordre de ses dépendances (phases 1
à 7).

- **Chantier terminé** : `État = Fait`, `Effort = Fait`, `Phase = 0 — Livré`, et `Quand / ce qui bloque` complété (la
  date, ce que le travail a changé, coûté ou révélé). Les autres lignes gardent leur `Ordre`.
- **Un chantier apparu en route reçoit sa ligne** — le plus souvent un défaut trouvé en travaillant sur autre chose —,
  avec sa case « Hors BNC ».
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
- `anon_/authenticated_security_definer_function_executable` (5 et 54 fonctions au 17/10/2026) : vérifiés bénins par
  impersonation. Seules `enregistrer_facture`, `valider_exercice`, `abandonner_transmission`,
  `enregistrer_encaissement`, `retirer_encaissement`, `declarer_encaissement_hors_application`, `annuler_encaissement`,
  `justifier_solde`, `enregistrer_paiement_personnel_cotisation`, `retirer_paiement_personnel_cotisation`,
  `changer_droits_acces`, `enregistrer_fiche_hors_de_france`, `retirer_fiche_hors_de_france`, `proposer_justificatif`,
  `retirer_proposition`, `ecrire_precision_mouvement`, `conclure_cycle`, `noter_revision`, `revoir_cycle`,
  `supprimer_brouillon_facture`, `fixer_seuil_de_signification`, `expliquer_variation`, `confirmer_regime_ereporting`,
  `retirer_regime_ereporting`, `ecarter_piece_ereporting`, `reprendre_piece_ereporting`,
  `declarer_ereporting_hors_application`, `consigner_au_dossier_permanent`, `retirer_du_dossier_permanent`,
  `marquer_pieces_jointes_vues`, `enregistrer_article`, `retirer_article`, `reprendre_article`,
  `declarer_adresse_reception`, `enregistrer_contact`, `retirer_contact`, `reprendre_contact`, `effacer_contact`,
  `importer_contacts`, `enregistrer_parametres_facturation` et `confirmer_rib` écrivent, chacune avec son propre
  contrôle d'accès (les trois de R4 : `admin_du_dossier` du dossier annoncé pour conclure et noter, le chef du cabinet
  du dossier — `est_chef_du_cabinet` — pour revoir ; depuis P2, les sept des ventes : `gere_les_ventes` du dossier
  annoncé, ou de celui de la transmission pour l'abandon ; les trois d'A1, celle d'A6a, les quatre d'A4a, celle d'A4b3a
  et `enregistrer_parametres_facturation` (A5a) : `gere_les_ventes` du dossier annoncé, et qu'il existe, avant toute
  lecture ; `confirmer_rib` (A5a) : `admin_du_dossier` du dossier annoncé, et qu'il existe, avant toute lecture ; les
  deux de R5, les quatre d'e5a, celle d'e5b1, les deux de R7 et celle de la ligne 22.7 : `admin_du_dossier` du dossier
  annoncé, avant toute lecture ; `garder_piece_ecartee`, `garder_piece_declaree` et `garder_source_citee`, gardes
  `SECURITY DEFINER`, ne sont exécutées par aucun rôle) ; `client_du_dossier`, `gere_les_ventes`, `gere_la_banque` et
  `droits_sur_le_dossier` ne lisent que les droits de l'appelant (`droitsAcces.sql`), `couverture_du_releve` que les
  mois du relevé d'un dossier où il a accès (`banqueClient.sql`), `pieces_jointes_ecartees_du_client` que le jour, la
  raison et le poids des pièces jointes écartées des 90 derniers jours d'un dossier où il a accès
  (`piecesJointesEcartees.sql`, 38a à 38r), `etat_facture_electronique` que des booléens, un nom et des dates des deux
  connexions et l'adresse courante d'un dossier où il a `gere_les_ventes` (`etatFactureElectronique.sql`),
  `dernier_changement_de_rib` que le jour, le geste, l'auteur (le cabinet, un accès client ou « inconnu »), l'état et
  l'effet sur le RIB en vigueur du dernier changement du RIB d'un dossier dont il est le cabinet ou un accès qui porte
  « Ventes » ou « Banque » (`dernierChangementDeRib.sql`) ; plus aucun rôle n'exécute `prochain_numero_facture` ni
  `attribuer_numero_facture`. Ce qu'il faut revérifier : qu'une NOUVELLE fonction `SECURITY DEFINER` n'écrive pas sans
  contrôle interne.
- `rls_enabled_no_policy` sur `super_admins`, `superpdp_credentials`, `facture_numerotation`, `connexions_bancaires`,
  `connexions_plateformes` : volontaire (refus total au client).
- `function_search_path_mutable` sur `retour_declencheur` : bénin (fonction `immutable` qui ne nomme aucun objet).

### Base de données et schéma

- **Un export de schéma n'est pas un schéma** : douze tables (`socle/1_tables_sans_migration.sql`) et onze objets
  (`socle/2_objets_sans_migration.sql`) avaient été créés hors migration ; `socle.py/.sql` les compare au caractère près
  et `inventaire.py/.sql` tout le reste nom par nom. La procédure qui rejouerait l'export dans une base vide n'a jamais
  tourné (PLAN_DE_REPRISE.md §4) → « UN EXPORT DE SCHÉMA N'EST PAS UN SCHÉMA ».
- **Une colonne GÉNÉRÉE ne se restaure pas, elle se recalcule** (Postgres refuse toute insertion qui la nomme, 428C9,
  même NULL, même à zéro ligne) : la sauvegarde la lit, le plan de réinsertion la retire de chaque ligne envoyée
  (`COLONNES_GENEREES`, `planReinsertion`) ; `sauvegardeColonnesGenerees.test.ts` la tire de l'export en partant du mot
  `generated` (une seule : `piece_textes_ocr.texte_md5`), et `restauration.sql` en porte la génération (`_generees`,
  insertions par liste de colonnes). Une empreinte qu'une GARDE doit vérifier reste une colonne ordinaire qu'elle
  recalcule (`declarations_ereporting.empreinte`) → « UNE COLONNE GÉNÉRÉE NE SE RESTAURE PAS, ELLE SE RECALCULE ».
- **Ce qui doit être tout ou rien vit dans une fonction SQL** (`SECURITY DEFINER` qui vérifie l'accès et énumère les
  colonnes qu'elle écrit). Ce qui est testé en TypeScript n'est pas réécrit en SQL — sauf quand la base doit VÉRIFIER
  une écriture : le calcul est alors le même des deux côtés, en entiers, confronté par un test à une table relevée en
  base (TVA incluse, dotations, barème kilométrique, report des soldes).
- **Un index unique PARTIEL ne peut pas être visé par un upsert** : contraintes uniques TOTALES (deux NULL ne se
  heurtent pas), `nulls not distinct` quand deux NULL doivent se heurter → « Un index unique PARTIEL ».
- **`ON DELETE SET NULL`** : les treize relations sont adjugées ; les cinq qui affirmaient une chose fausse sont gardées
  par un contrôle (`rupturesPisteAudit`, `mouvementsRapprochesSansObjet`, `immobilisationsSansJustificatif`). Il ne
  relâche rien à l'INSERTION : une restauration qui sacrifierait un lien le dit (`LienPerdu.effacable`) →
  « LA FAMILLE `ON DELETE SET NULL` EST CLOSE ».
- **`dossier_id` NULLABLE** sur `categories` et `natures_immobilisation` : une ligne à `dossier_id` nul est COMMUNE À TOUS
  LES CABINETS (pas de `cabinet_id`) et seul le super-administrateur l'écrit ; pour un autre, la policy écarte la ligne
  SANS LEVER. Jamais `WHERE dossier_id = ?` seul ; un écran qui en offre l'écriture le dit avant le clic et lit la ligne
  rendue (`lib/categoriesCommunes.ts`, `supabase/essais/categoriesCommunes.sql`) → « CINQ DÉFAUTS RELEVÉS EN CONCEVANT
  LE PLAN COMPTABLE PERSONNALISABLE ».
- **`id` n'est pas la clé primaire partout** (`CLES_PRIMAIRES`, épinglée au schéma), même d'un parent (`roles_comptables` :
  `role`) — `liensPerdus` compare sur `clePrimaire` ; une table auto-référencée se
  restaure en deux passes ; le plan free n'a AUCUNE sauvegarde automatique (PLAN_DE_REPRISE.md).
- **Une table préparée et non appliquée se déclare au plan de sauvegarde derrière son drapeau** (P5 : listes
  `*_PREVU(E)S`, filtre `auPlan`, `sauvegardeDevis.test.ts`) : la lire avant sa migration ferait échouer toute
  sauvegarde, et lever le drapeau suffit le jour de l'application ; `restauration.sql` la met au plan quand elle existe,
  ses rangs comptés depuis celui d'`exercices_valides` ; un drapeau par migration préparée (A1 : `auPlanDesArticles`,
  `sauvegardeArticles.test.ts` ; A6a : `auPlanDesAdressesReception`, `sauvegardeAdressesReception.test.ts` ; A4a :
  `auPlanDesContacts`, `sauvegardeContacts.test.ts` ; A5a : `auPlanDesParametresFacturation`,
  `sauvegardeParametresFacturation.test.ts`), réunis par `auPlanAujourdHui` ; une table auto-référencée y déclare
  d'avance sa vague (`TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES`) → « LES DEVIS, EN BASE », « LES ARTICLES, EN BASE »,
  « L'ADRESSE DE RÉCEPTION ET L'ÉTAT DE LA FACTURE ÉLECTRONIQUE, EN BASE », « LES CONTACTS, EN BASE », « LES PARAMÈTRES
  DE FACTURATION, EN BASE ».
- **Un type de `types.ts` décrit la table**, colonnes NOT NULL comprises — et les déclencheurs comptent : ceux de
  `dossiers` remplissent `cabinet_id` et `code_email` seulement s'ils sont nuls.
- **`pack_pieces` a été supprimée** (jamais écrite) : la composition d'un pack n'est pas modélisée. Avant de supprimer
  une table jugée morte, réunir les six preuves (voir les règles en fin de fichier).
- **Un drapeau qui attend une migration se bascule d'abord en SIMULATION** (le fichier posé dans l'export, le drapeau
  levé, la suite ENTIÈRE) : ce que la bascule demandera — gardes de source, doublures, plan de sauvegarde, ancres des
  défauts plantés — se voit avant elle, et se prépare en correctif d'application ; une réplique se monte en UTF8 (en
  SQL_ASCII, `length()` compte des octets, et `signature.sql` ne voit pas l'encodage) ; elle est en `C.UTF-8` quand
  la production est en `en_US.UTF-8` (ICU) : un ordre de texte qu'une fonction ou un essai doit tenir s'écrit
  `collate "C"`, la réplique ne verrait pas l'écart → « LA BANQUE DU CLIENT EN BASE », « L'IMPORT D'UN FICHIER DE
  CLIENTS, EN BASE ».

### Lectures et écritures Supabase

- **Une écriture est vérifiée**, jamais supposée réussie (`{ error }` lu). Ce qui décide de la gravité : quelque chose
  recharge-t-il derrière ? Presque toujours dans `src/`, presque jamais dans une Edge Function
  (`edgeFunctionsEcritures.test.ts` : quatre portes `.from(`, `.rpc(`, `.auth.`, `.storage.`, résultat pris ou jeté à la
  tête de chaîne).
- **Un lot d'insertion nomme l'UNION des clés de ses lignes** (postgrest-js, `columns=`), et le service met NULL dans ce
  qu'une ligne omet (`defaultToNull` vrai par défaut) : la restauration n'envoie que des lots dont les lignes nomment les
  mêmes colonnes (`lotsDEcriture` ; `undefined` n'est pas nommé), et son faux client écrit comme le service (NULL, 23502
  sur une clé NULL) → « UN LOT D'INSERTION NE MÊLE PLUS DES LIGNES DE FORMES DIFFÉRENTES ».
- **Une écriture du navigateur lit son erreur et la DIT** (`ecrituresVerifiees.test.ts`, depuis toute la source de
  `src/`) : tables, tout `.rpc(`, tout `functions.invoke` (argument de type compris), stockage et comptes qui écrivent ;
  résultat destructuré avec `error`, gardé entier, ou passé à un consommateur nommé — rendu, jeté ou non reconnu est
  une faute ; un `return` seul en fin de ligne JETTE l'écriture qui suit. Sa porte 2 exige qu'une suppression suivie
  d'un retrait de fichier lise la ligne supprimée (`.select`) → « LES ÉCRITURES DU NAVIGATEUR LISENT LEUR ERREUR ».
- **Qui prend `data` prend `error`** : une lecture dont l'échec ressemble à un résultat vide se vérifie comme une
  écriture (`lecturesVerifiees.test.ts`, `edgeFunctionsLectures.test.ts`). Légitime seulement si l'échec tombe du côté
  FERMÉ. **Le vide est une AFFIRMATION** : un état vide ne se dit que d'une liste lue en entier — et revenue : avant sa
  première lecture, l'écran dit « Chargement… » (ou ses squelettes), et ce qui s'en calcule attend aussi — un compte, un
  total, un tableau, un export, un formulaire ; une lecture dont la CLÉ change écran ouvert (l'exercice, la période)
  repart en chargement. `ecransAvantLecture.test.tsx` monte tous les écrans qui lisent la base sous un client qui ne rend
  rien (`src/test/clientRetenu.ts`) → « RÉCLAMAIT AU CLIENT AVANT D'AVOIR RIEN LU », « AUCUN ÉCRAN N'AFFIRME LE VIDE AVANT
  D'AVOIR LU ».
- **Une lecture que deux écrans comptent s'écrit une fois** (`lib/ventesLecture.ts` : les pastilles de l'onglet Factures
  et les tuiles de l'accueil du client, comptées par `compterLesPastilles` ; sur l'accueil, les tuiles et l'encart
  « Facture électronique » partagent UNE lecture des ventes, `useVentesDuClient` (`lib/ventesDuClientLecture.ts`) ; les
  pièces jointes écartées du client, que « Mes pièces » et l'accueil lisent par `useEcarteesDuClient`, le seul `.rpc(`
  de la fonction, gardé par `piecesJointesEcarteesClient.test.ts`) ; un compte ne se dit que de listes TOUTES lues en
  entier → « LES CONNEXIONS DU CLIENT ET LES TUILES DE SON ACCUEIL », « L'ACCUEIL DU CLIENT SIGNALE UNE PIÈCE JOINTE
  ÉCARTÉE ET RENVOIE À « MES PIÈCES » », « L'ENCART « FACTURE ÉLECTRONIQUE », À L'ÉCRAN ».
- **Lecture → formulaire → écriture de tous les champs** : une lecture ratée n'offre AUCUN formulaire, sinon le premier
  « Enregistrer » écrase → « ET LA MÊME LECTURE SERT À REMPLIR UN FORMULAIRE ».
- **PostgREST plafonne les lignes rendues sans le dire** : toute lecture de collection passe par `lireTout` (tranches,
  avance de ce qui est RENDU, compte annoncé `count: 'exact'`, tri TOTAL terminé par la clé primaire).
  `lecturesPaginees.test.ts`, `lecturesSignalees.test.ts` (le drapeau `complete` lu dans le bloc de la déclaration ou
  le rappel), `edgeFunctionsPaginees.test.ts` et `triTotal` le gardent → « Et la TABLE se pagine aussi »,
  « ET TOUS CES GARDES RÉPONDENT ».
- **Une lecture partielle se SIGNALE et ne COMMANDE aucune écriture — une lecture PAS ENCORE REVENUE non plus** :
  `BandeauLecturePartielle` dit sa conséquence propre (avec son `accord`) ; le geste qui écrirait depuis la liste
  tronquée, ou depuis la liste pendant sa lecture (la première comme une relecture), se suspend et le dit. Le second
  garde de `ecransAvantLecture.test.tsx` tente chaque geste de chaque écran, aucune réponse revenue : une écriture qui
  part sans liste se nomme avec sa raison → « ET UNE LECTURE PARTIELLE COMMANDAIT ENCORE DES ÉCRITURES »,
  « UNE ÉCRITURE COMMANDÉE PAR UNE LISTE PAS ENCORE REVENUE ».
- **Stockage** : tout retrait passe par `lib/stockage.ts::retirerFichiers` (journalise, ne lève jamais) ; plus aucun
  `.catch(() => {})` (`retraitsStockage.test.ts`) ; `list()` se pagine ; la suppression d'un dossier rend un bilan que
  l'écran montre ; un fichier sans ligne est un orphelin ; la suppression d'un cabinet laisse encore son logo PUBLIC
  dans `cabinet-logos`, orphelin (ligne 22.61) → « LA QUESTION QUI DÉCIDE N'A JAMAIS ÉTÉ POSÉE DU STOCKAGE ».
- **Les bornes des seaux** (ligne 22.6, `lib/bornesStockage.ts`) : tout dépôt passe par `preparerPiece`, `preparerLogo`
  ou `preparerContenu`, qui jugent AVANT l'envoi le type — décidé par l'application (extension, sinon signature ; un
  logo à sa seule signature), jamais `file.type` ni le type que déclare un expéditeur — et la taille, disent le refus
  avec le poids et la borne, et rendent un Blob RÉÉTIQUETÉ (storage-js ignore `contentType` pour un Blob,
  `bornesStockageClient.test.ts`). Pièces : PDF, JPEG, PNG, CSV (+ `text/plain` des plateformes), 20 Mio (S226-Q1,
  décision du cabinet du 13/10/2026 ; aucun autre format, S226-Q2) ; packs : ZIP et XLSX, 50 Mio ; logos : PNG, JPEG,
  WebP, 500 Kio, jamais de SVG (le seau est public) ; logos des factures (seau `ventes`, privé, A5c1) : PNG ou JPEG,
  500 Kio, par `preparerLogoDeFacture`, que `logoPret` appelle pour le dépôt de l'écran du logo (A5c2a). Les mêmes
  valeurs en base depuis le 13/10/2026 (migration `bornes_du_stockage`, et `logo_des_factures` pour `ventes` le
  17/10/2026 ; essai `bornesStockage.sql`), confrontées par `bornesStockage.test.ts` ; `depotsDansLesSeaux.test.ts` lit
  l'arbre de toute la source et exige que chaque dépôt envoie un type que la migration admet pour son seau — ni plus, ni
  moins (`logoPret` y est le préparateur du seau `ventes`) ; un refus 413 ou 415 du stockage se dit en français
  (`messageErreur`) → « LES BORNES DES SEAUX DU STOCKAGE », « LES BORNES DES SEAUX DU STOCKAGE, EN BASE ».
- **Une pièce jointe écartée se dit** (ligne 22.7, `pieces_jointes_ecartees`) : `receive-email` l'écrit à la clé secrète
  par un `upsert` qui ne fait rien sur la clé (le dossier, l'empreinte SHA-256 des identifiants Resend) — un rejeu de
  Resend n'écrit rien de plus, et un identifiant Resend gardé tel quel désignerait un e-mail relisible ; jamais le nom,
  l'extension, l'expéditeur ni l'objet ; son refus se journalise et la pièce jointe suivante se traite. Lecture
  `admin_du_dossier`, aucune branche client — le client n'en reçoit que le jour, la raison et le poids, par
  `pieces_jointes_ecartees_du_client` (ligne 22.9) ; insertion de RESTAURATION au super-administrateur (sans elle, la
  restauration d'un dossier qui en a s'arrêterait) ; « vue » par `marquer_pieces_jointes_vues` seule (l'accès d'abord),
  une fois, la garde n'admettant que ce passage. L'écran (`PiecesJointesEcartees`, en tête de Justificatifs) : l'attente
  dite avant la lecture, rien sur un vide lu en entier, le bandeau sur une lecture partielle, le geste sous
  `marquageEnCours` relâché après la relecture. Toute autre perte — Resend ne la rend pas, son téléchargement, la
  recherche de doublon, le stockage ou l'insertion échouent, une exception — s'écrit sous la raison `depot` (ligne
  22.8), au poids lu, ou INCONNU (null) quand rien n'a été lu : la base n'admet le poids inconnu que pour elle
  (`pieces_jointes_ecartees_poids_connu`) ; un doublon n'est pas une perte. Une pièce jointe ARRIVÉE VIDE s'écrit sous
  la raison `vide`, au poids zéro, que la base n'admet que d'elle (`pieces_jointes_ecartees_octets`, raison par raison,
  ligne 22.91), sans être ni déposée ni lue. Le journal ne porte ni le détail d'un refus de PostgREST (il recopie la
  ligne : nom du fichier, tiers, montants) ni le chemin d'un orphelin ; il COMPTE, une ligne par e-mail d'un dossier
  connu, les éléments de `attachments` qui ne sont pas des pièces jointes (disposition autre qu'`attachment`, absente
  comprise), par disposition et famille de type DÉCLARÉ — un compte, jamais une décision de dépôt —, sans nom, sans
  identifiant, sans disposition ni type recopiés (ligne 22.92). L'écran dit qu'un dépôt échoué n'est pas du fait du
  client, son poids s'il est connu — rien d'inventé sinon —, et de le renvoyer tel quel ; d'une pièce jointe arrivée
  vide, que le client vérifie son fichier avant de la renvoyer ; l'adresse de collecte ne se compose que dans
  `lib/adresseCollecte.ts` — un test refuse le domaine ailleurs dans `src/` — ; « Mes pièces » lit `code_email` de la
  société AFFICHÉE (la policy de lecture de `dossiers` l'ouvrait déjà), à part et gardé avec le dossier : rien avant le
  retour, une lecture ratée dite sans adresse, jamais une adresse devinée ; le « Copié ✓ » est le crochet
  `lib/copieDuTexte.ts`, partagé avec l'onglet Accès → « UNE PIÈCE JOINTE ÉCARTÉE À LA RÉCEPTION PAR E-MAIL SE DIT AU
  CABINET », « LE DÉPÔT A ÉCHOUÉ : LA TROISIÈME RAISON D'UNE PIÈCE JOINTE ÉCARTÉE », « ARRIVÉE VIDE : LA QUATRIÈME
  RAISON D'UNE PIÈCE JOINTE ÉCARTÉE », « « MES PIÈCES » MONTRE L'ADRESSE DE COLLECTE DU DOSSIER ».
- **Une suppression se confirme, et la confirmation NOMME ce qu'on perd** ; une mise en garde se vérifie contre ce que le
  code FAIT, pas contre ce qu'elle a voulu dire → « UNE SUPPRESSION SE CONFIRME ».
- **Une suppression en lot dit son bilan** : la ligne d'abord, le fichier seulement si la base a RENDU la ligne
  supprimée (`.select('id').maybeSingle()` — zéro ligne n'est pas une erreur pour PostgREST) ; ce qui reste se compte et
  se dit avec sa raison, sans nom de fichier (`lib/bilanSuppression.ts`, documents et pièces), sous un verrou relâché
  après la relecture ; la fiche d'une pièce lit aussi sa ligne supprimée → « LA SUPPRESSION D'UNE SÉLECTION DE
  DOCUMENTS », « LES ÉCRITURES DU NAVIGATEUR LISENT LEUR ERREUR ».
- **Un fichier s'ouvre par `lib/apercu.ts` seulement** : pas de `noopener` (succès et blocage indiscernables), retour de
  `window.open` lu, puis `opener = null` → « UN BOUTON QUI OUVRE UN FICHIER ».
- Les lectures d'une seule ligne n'ont pas de scanner : les scanners d'erreur les couvrent.
- **Une liste plafonnée dit qu'elle l'est** : les outils de l'assistant rendent le total réel et un drapeau `tronque`.

### Edge Functions : déploiement, clés, copies

- **`verify_jwt`** : `deploy_edge_function` le REMET à `true` si on l'omet. Toujours passer la valeur de
  `supabase/config.toml` (vérifiée contre `list_edge_functions`) ; `receive-email` à `false` (webhook sans JWT : l'oubli
  coupe les e-mails entrants sans un journal). `configFonctions.test.ts` garde le fichier (une clé mal orthographiée
  retomberait en silence sur `true`) → « ET DÉPLOYER PAR L'OUTIL MCP REMET `verify_jwt` ».
- **Un déploiement se vérifie** : comparer la copie déployée au dépôt AVANT d'écraser, déployer, puis aller-retour par
  `supabase/essais/allerretour.py` (lecture la plus récente du journal, suit un résultat écrit sur disque). L'outil
  décode les `\uXXXX` (sans conséquence — ne pas doubler les antislashs). Les longues bordures `─` se transcrivent mal,
  et une transcription refaite recopie les fautes de la précédente : les répéter d'abord par
  `supabase/essais/bordures.py`, qui les décode et les compte, sous une forme marquée (par cinq, quatre échappements et
  un trait littéral, un double trait tous les vingt-cinq) ; le texte ENVOYÉ, relu dans le journal de la session, se
  compare au dépôt avant de relire la copie déployée → « Déployer une Edge Function via l'outil MCP décode les
  échappements », « LES BORDURES SE RECOPIENT », « UN MOT DE PASSE REFUSÉ SE DISAIT « UN COMPTE EXISTE DÉJÀ » ».
- **Un commit n'est pas un déploiement, un déploiement n'est pas une autorisation** : `edgeFunctionsIam.test.ts` compte
  les actions IAM, pas les ressources (changer de modèle demande un appel réel). `bright-task` vit en production sans
  exister dans le dépôt, neutralisée (410) et non appelée : à supprimer le jour où un outil le permet, ne pas
  réenquêter → « UN DÉPLOIEMENT N'EST PAS UN COMMIT NON PLUS ».
- **Clés de Supabase** : les historiques sont quittées (coupées fin 2026). Toute fonction lit `SUPABASE_PUBLISHABLE_KEYS`
  et `SUPABASE_SECRET_KEYS` par le bloc `cleSupabase` copié à l'identique ; `verify_jwt` ne sait lire que les anciennes
  clés, donc une fonction appelée sans session d'utilisateur passe à `false` avec son propre contrôle
  (`clesSupabase.test.ts`) → « LES CLÉS HISTORIQUES DE SUPABASE SONT QUITTÉES ».
- **`extract-piece`** n'accepte qu'un compte RATTACHÉ (`cabinet_admins`, `memberships` ou `super_admins`, lus à la clé de
  service, session vérifiée auprès du service d'authentification) ou la clé secrète exacte en `apikey`, contrôlés avant
  de lire le corps. **L'inscription publique est fermée** depuis le 10/10/2026 (`disable_signup: true`, relu sur les
  réglages publics du service) → « ET LA FONCTION DE LECTURE ÉTAIT OUVERTE ».
- **`evaluer-extraction` facture seulement dans sa fenêtre datée** (`ESSAI_OUVERT_JUSQU_A`) : mesurer = poser une date une
  heure devant, déployer, mesurer, attendre la fermeture, PUIS commiter (`categorisationIaCopie.test.ts` refuse une
  fenêtre ouverte) → « LE HARNAIS DE MESURE ÉTAIT UNE PORTE PUBLIQUE ».
- **Le mur d'une fonction est à 150 s** (plan free) : les budgets se déduisent du mur (`extractPieceBudget.test.ts`).
  Textract se pagine par `NextToken` (boucle sur un fournisseur de pages, testée).
- **Le compilateur des Edge Functions** (`tsconfig.edge.json`, `edgeFunctionsCodeMort.test.ts`) ne garantit que le CODE
  MORT ; le typage complet rend des erreurs connues (SDK non installés).
- **Copies gardées** : montants, dates, classification, orientation, statut de TVA, la lecture d'un statut reçu
  (`cdarRecu`, dans `plateforme-agreee`), le refus du service d'authentification (`refusDuService`, dans les trois
  fonctions qui créent des comptes), les droits de l'appelant (`droitsDeLAppelant`, dans les quatre fonctions de la
  vente, `droitsDeLAppelantCopie.test.ts`), le fichier de l'e-reporting (`fluxEreporting`, bornes posées, recopié dans
  `plateforme-agreee` à e9 ; garde avant copie `fluxEreportingCopie.test.ts`), blocs de l'assistant (un garde par bloc),
  la borne et le type d'une pièce (`bornesDesPieces`, dans `receive-email`, `bornesDesPiecesCopie.test.ts`), et
  `historiqueDuClient`, seule barrière entre le fil envoyé par le navigateur et le modèle → « ET LE SEUL INVARIANT
  DE SÉCURITÉ DU DÉPÔT ».

- **Chaque Edge Function s'appelle en HTTP dans la suite** (ligne 23, `src/test/fonctionsEdge.ts`) : sa VRAIE source,
  transpilée, devant un monde factice qui journalise tout (`Deno.serve` capturé, clés fabriquées, base aux filtres et
  aux clés du schéma exporté, authentification, AWS, Resend, réseau fermé, `verify_jwt` lu dans `config.toml`) ;
  `contratsFonctions.ts` en joue les contrats (préflight mesuré sur le SDK, refus sans droit et AUCUNE dépense avant,
  corps mal formés, plafonds, ni secret ni valeur de pièce au journal ; un scénario se REJOUE — `dejaRecue`, la même
  requête reçue une fois avant, comme un webhook que Resend rejoue) ; `edgeFunctionsHttp.test.ts` part de TOUT et compte
  les défauts connus au nombre près (`DEFAUTS_CONNUS`) → « LES EDGE FUNCTIONS S'APPELLENT EN HTTP ».

### Scanners de source : la doctrine

- **Une liste d'inclusion tenue à la main ne contient que ce à quoi on a pensé** : un scanner part de TOUT (comme
  `rls.sql` de `pg_class`, les gardes des Edge Functions du dossier `supabase/functions/`) ; une forme non reconnue est
  une faute, jamais un saut ; une exception porte sa raison ET un nombre ; un plancher distingue « zéro faute »
  d'« aveugle ».
- **Lire l'EXPRESSION, jamais la ligne** (le formatage coupe les chaînes) ; un corps s'arrête au `.from(` suivant ; ne
  couper que les lignes entièrement en commentaire. Chaque scanner est éprouvé par un défaut PLANTÉ et par mutation.
- **Trois couches qui ne se recouvrent pas** : le scanner voit qu'on CALCULE, le compilateur (`noUnusedLocals`) qu'on
  LIT, le test d'écran que ça ATTEINT l'opérateur.
- `npx tsc --noEmit` ne vérifie rien dans ce dépôt : `npx tsc -b`. Et `cmd | tail && echo OK` ment : lire
  `${PIPESTATUS[0]}`.
- Une phrase qui annonce un test nomme son fichier, et le test existe → « UNE PHRASE QUI ANNONÇAIT SON PROPRE TEST ».
- **Chercher toutes les copies avant de corriger la première** — les jumeaux assumés (`depot.ts` côté client,
  `importFichiers.ts` côté cabinet), Edge Functions comprises : chercher la VALEUR, pas le nom de la fonction.
- **Le nom `notes` est réservé** dans les sources de production : `notesInternesEcritures.test.ts` (règles K et L) compte
  toute clé `notes` et toute lecture `.notes` ; une autre table nomme autrement ses notes (`journal`, R4).

### Dates et fuseaux

- **Tout calcul de date reste sur le calendrier civil** (`lib/format.ts` : `ajouterMois`, `dernierJourDuMois`,
  `aujourdHuiSql`, `anneeDe`, `moisDe`, `jourDe`…) ; un `created_at` est un INSTANT (`anneeLocaleDe`, `dateLocaleDe`).
  Jamais `toISOString().slice(0, 10)` sur « maintenant » (`datesUtc.test.ts`) ; côté Edge Functions, le jour de Paris
  par `Intl` (`formatToParts`, `Europe/Paris`) → « ET CETTE RÈGLE-LÀ N'ÉTAIT GARDÉE PAR RIEN ».
- **`formatDate` discrimine sur la FORME** (AAAA-MM-JJ = date civile) ; jamais `new Date(v).toLocale…String` sur une
  valeur (`datesAffichees.test.ts`) — l'outre-mer est la France → « UNE DATE CIVILE N'A PAS DE FUSEAU ».
- **« Maintenant » ne se lit jamais au chargement d'un module** (la SPA ne se recharge pas) ; l'année et les mois écoulés
  sortent d'un seul `Date` (`anneeEtMoisEcoules`) ; une lecture filtrée sur l'année porte son année
  (`maintenantFige.test.ts`) → « LU AU CHARGEMENT D'UN MODULE EST FIGÉ ».
- **Annualiser** : diviser par les mois RÉELLEMENT écoulés (`moisEcoulesDeLAnnee`), refuser sous un mois ; une période
  rapporte ses charges à elle-même → « ET LE MÊME ÉCRAN DIVISAIT PAR LE NUMÉRO DU MOIS ».
- **Au 1er janvier on réclame encore l'exercice précédent tant qu'il n'est pas CLÔTURÉ** (`lib/resteAEnvoyer.ts`,
  `exercices_clotures`) ; cocher la clôture purge aussi le texte OCR des pièces sensibles, et la confirmation nomme les
  deux → « ET AU 1ER JANVIER, LES TROIS ÉCRANS ».
- **`parseDate`** lit les douze mois français, ignore le jour de la semaine, relit sur le calendrier civil ; `toIsoDate`
  garantit quatre chiffres et refuse le futur (un jour de marge) → « Le dernier recours de `parseDate` »,
  « UNE CONTRAINTE JUSTIFIÉE PAR UN APPELANT ».
- **Le calendrier fiscal** (`lib/echeancesFiscales.ts`) se lit À PARIS, compte les jours ouvrés sur les onze jours
  fériés (Pâques calculée) et reporte la CFE au premier jour ouvré, comme la DGFiP ; chaque échéance dit sa condition.
- **Un test de date choisit son fuseau** (`process.env.TZ` est relu à chaque opération) ; `npm run test:fuseaux` ;
  `vi.useFakeTimers({ toFake: ['Date'] })` seulement (sinon `findByText` expire).

### Écrans : verrous, courses, signaux

- **Un verrou d'exécution est un `useRef`**, posé AVANT le `try` et relâché dans un `finally` — après la relecture quand
  l'écran montre ce qui vient d'être écrit —, sous un nom à lui dans son fichier (l'appariement se fait par nom). Deux
  clics se testent dans le MÊME `act`, et il en faut TROIS pour voir un verrou posé dans le `try`
  (`verrousExecution.test.ts`) → « Un verrou d'exécution est un `useRef` » ; une case à cocher contrôlée, grisée pendant
  l'écriture, arrête déjà le second clic (React la rend avant la fin de l'événement) : son verrou ne se voit qu'aux
  mutations d'ordre deux → « LES DROITS D'UN ACCÈS CLIENT, TENUS EN BASE ». Toute fonction d'écran qui écrit (une porte
  du client, ou une fonction de `src/lib` qui écrit) passe un verrou, une enveloppe à verrou (`sousVerrou`, `agir`) ou
  un appelant verrouillé ; sinon une catégorie comptée (mise à jour, suppression, session) ou une exception nommée avec
  sa raison (`verrousEcritures.test.ts`, qui ne voit ni le placement dans le `try`, ni ce qu'une suppression rejouée
  affirme) → « N'AVAIT QU'UN ÉTAT POUR VERROU », « LES GESTIONNAIRES D'ÉCRITURE SANS VERROU ».
- **Une lecture plus lente écrit en dernier** : un effet dont la dépendance change écran ouvert pose son drapeau
  d'annulation après les lectures et avant la première écriture. À chaque navigation ajoutée : ce composant se
  remonte-t-il quand cette dépendance change ? → « UNE LECTURE PLUS LENTE ÉCRIT EN DERNIER ».
- **`AuthContext` ne relit les rôles qu'au changement d'IDENTIFIANT** (Supabase renvoie une copie de la session à chaque
  retour sur l'onglet) ; le chargement est DÉDUIT → « UN RETOUR SUR L'ONGLET RECHARGEAIT ».
- **Banque** : un seul verrou pour toutes les écritures de rapprochement (`ecritureEnCours`), relâché après la relecture
  → « LE VOLET A OUVERT UNE COURSE ».
- **Une recherche filtre l'affichage, jamais un total ni un export** (`recherchesEtTotaux.test.ts`) ; « N sur M » : M
  après les filtres de l'écran, avant la recherche.
- **Un état qui porte un sous-ensemble le dit dans son nom** (`piecesValidees`, `recettesValidees`…) → « Un nom qui ment
  sur son filtre ».
- **Un point de Checklist vérifie que sa cible peut MONTRER ce qu'il compte** (`detailPiecesSansDate`) ; une donnée
  ABSENTE ne se signale que sur les pièces validées, une donnée démontrée FAUSSE sur les deux piles →
  « Un rapprochement qui hésite dit un symptôme ».
- **Un écran de saisie ne choisit pas l'exercice** à la place du cabinet ; un champ devenu sans objet est remis à zéro
  dans la même écriture.
- **Un lot parallèle réserve l'empreinte** dans un `Set` avant toute attente (`ClientUpload`) : une vérification en
  base ne protège pas des branches parties ensemble.
  Entre deux lots, rien ne la réserve : le même fichier déposé deux fois, le premier encore en vol, entre deux fois
  (question au cabinet → « LES GESTIONNAIRES D'ÉCRITURE SANS VERROU »).
- **Un constructeur de requête n'est pas une promesse** : `.then(f)` sur lui rend ce que SON `then` rend — rien, pour
  la doublure qui retient (`clientRetenu`). Un module qui reçoit une requête l'ATTEND (`await`), et une requête qui lève
  tombe du côté signalé (`lireLaCouverture`, `lireLeDroitBanque`) → « LA BANQUE DU CLIENT EN BASE ».
- **Les points de la Vue d'ensemble se calculent dans `lib/pointsDeLaChecklist.ts`** (pur : l'appelant donne l'année, les
  mois écoulés et le premier jour du mois) **et se lisent par `lib/checklistLecture.ts`** : la Checklist et la révision
  les disent des mêmes lectures. Un point s'y écrit `{ id: '…', …, severite: '…' }` : `revisionCycles.test.ts` et
  `prealablesValidation.test.ts` lisent cette source comme du texte → « L'ÉCRAN DE LA RÉVISION ».

### Comptabilité

- **La chaîne vers l'écriture a trois portes** : `categorie_id`, `compte_comptable` (trois chiffres en tête),
  `poste_2035` — les diagnostiquer ensemble.
- **Une valeur par défaut connue s'applique** (le compte et le poste suggérés d'une catégorie), elle ne s'affiche pas
  en attendant un clic.
- **Chaque mouvement du relevé s'écrit par une fonction SQL qui VÉRIFIE l'écriture composée par l'application** et
  l'écrit avec le classement, d'un seul tenant ; ce qu'elle refuserait est dit avant le clic, dans le même ordre ; les
  règles d'affectation PROPOSENT, le clic écrit, et un mouvement dont le justificatif est peut-être au dossier n'entre
  jamais dans un lot → « UN MOUVEMENT SANS JUSTIFICATIF S'AFFECTE », « LES RÈGLES D'AFFECTATION PROPOSENT »,
  « UN VIREMENT PERSONNEL S'ÉCRIT », « UNE ÉCHÉANCE D'EMPRUNT S'ÉCRIT », « UN MOUVEMENT SE VENTILE »,
  « UN VIREMENT RÈGLE PLUSIEURS PIÈCES », « UNE RECETTE DU RELEVÉ D'UN DOSSIER ASSUJETTI »,
  « UNE ÉCHÉANCE DE COTISATION RAPPROCHÉE », « UN MOUVEMENT DU RELEVÉ S'ÉCRIT SUR UN COMPTE DE BILAN ».
- **Une échéance de cotisation payée depuis le compte PERSONNEL** est un apport (PCG art. 1211-10) : face au compte du
  dirigeant (en trésorerie, la cotisation hors CSG-CRDS au 646000 face au 108000), datée du paiement que le cabinet
  saisit, jamais proposé, par `enregistrer_paiement_personnel_cotisation` ; un mouvement OU le compte personnel, jamais
  les deux (la fonction et deux déclencheurs) → « UNE ÉCHÉANCE PAYÉE DEPUIS LE COMPTE PERSONNEL S'ÉCRIT ». À l'écran
  (phase C) : la colonne « Paiement » de Cotisations offre le geste sur une échéance que rien ne paie, sur des listes
  lues en entier (ouverture comprise) ; la fenêtre ne propose jamais la date, dit le refus du module avant le clic et la
  confirmation qui nomme les comptes et l'exercice, sous le verrou du brouillon relâché après la relecture. « Retirer ce
  paiement » (`retirer_paiement_personnel_cotisation`, en base et dans l'export depuis le 10/10/2026 ; `RETRAIT_EXPORTE`
  tenu égal à l'export par le test du module) : refusé avant le clic sur un paiement ou une échéance d'un exercice
  validé ; sa confirmation nomme les lignes du brouillon TELLES QU'ELLES SONT — c'est le geste d'une écriture « À
  reprendre » —, sans les détailler sur un brouillon lu en partie → « LA PHASE C : L'ÉCRAN DU PAIEMENT PERSONNEL »,
  « LE RETRAIT D'UN PAIEMENT PERSONNEL, EXPORTÉ ET OFFERT ». L'opération
  découverte après la validation de son exercice est conçue, pas modélisée → « L'OPÉRATION DÉCOUVERTE APRÈS COUP ».
- **Les écritures d'inventaire** suivent la même règle → « LES DOTATIONS AUX AMORTISSEMENTS S'ÉCRIVENT »,
  « L'ACQUISITION D'UN BIEN S'ÉCRIT », « LE FORFAIT KILOMÉTRIQUE S'ÉCRIT », « UNE NOTE DE FRAIS EN TRÉSORERIE » ;
  et la 2035 reste calculée depuis les sources, comparée aux écritures source par source → « LA 2035 SE COMPARE AUX
  ÉCRITURES ».
- **Le modèle comptable** (trésorerie ou engagement) se règle par dossier tant que le brouillon est vide, et un
  déclencheur le garantit → « LA COMPTABILITÉ D'ENGAGEMENT ». Le lettrage se DÉDUIT du rapprochement, sans être stocké ;
  un lettrage fait à la main se revérifie à chaque lecture → « LE LETTRAGE SE DÉDUIT DU RAPPROCHEMENT »,
  « UNE COMPENSATION SANS MOUVEMENT BANCAIRE ».
- **Ouverture d'un exercice** : une balance reprise se lit à sa structure, se contrôle (débit = crédit, en centimes) et
  devient les à-nouveaux du dossier, une seule ouverture par dossier ; ensuite, un exercice n'a d'ouverture que si le
  précédent est validé (`soldes_reportes`), et les écrans le disent → « UNE BALANCE REPRISE DEVIENT LES À-NOUVEAUX »,
  « LA VALIDATION D'UN EXERCICE ÉCRIT L'OUVERTURE ». La reprise ne range que la banque, le 44566 et le 44571 : les autres
  comptes que l'application écrit elle-même s'ouvrent sous le numéro de la balance, et la carte le DIT avant le clic
  (`compteQueLApplicationEcrit`) ; les ranger est l'étape PC6.
- **Un contrôle qui part d'un côté d'une relation ne voit pas l'autre** : partir de l'écriture (`rupturesPisteAudit`,
  `ecrituresSansObjet`), du mouvement, du bien… Le contrôle des écritures compare le compte, le montant, la ventilation
  de la TVA et les dates attendues → « Un contrôle qui part d'un côté d'une relation ».
- **Le bilan se lit depuis les soldes** (`lib/bilan.ts`) : l'ouverture et les écritures de l'exercice ; rubriques du
  2033-A-SD (PCG, art. 822-1) ; aucune compensation (art. 112-2), le sens jugé compte par compte et tiers par tiers ;
  un compte qu'aucune rubrique ne nomme est « à classer », jamais rangé au jugé ; l'écart se juge au centime et se
  décompose. La colonne de l'exercice précédent (PCG, art. 811-3 ; en net, comme le 2033-A-SD) est le MÊME bilan
  calculé sur N−1 (`colonneDeLExercicePrecedent`), jamais l'ouverture de N relue ; elle n'a aucun chiffre quand N−1
  ne s'établit pas (ouverture en attente, antérieur à la reprise) ni quand N est le premier exercice, et l'en-tête
  dit pourquoi ; une rubrique ou un compte d'un seul exercice a sa ligne, vide de l'autre (`lignesDuBilan`,
  `detailDuBilan`) → « LE BILAN SE LIT DANS LES RUBRIQUES DU 2033-A », « LA COLONNE DE L'EXERCICE PRÉCÉDENT ».
  L'ouverture de N se confronte à la clôture de N−1 (C. com., art. L123-19, al. 3 ; PCG, art. 112-2) dans
  `lib/ouvertureConfrontee.ts`, pur : la clôture est la colonne N−1 (jamais l'ouverture relue) passée par
  `soldesAReporter` (la règle du report CITÉE : `compteDuResultat`, `compteQuiRecoit`), contre les soldes reportés lus ;
  les écarts compte par compte puis rubrique par rubrique (celles du bilan de N SANS ses écritures), ou « rien à
  confronter » et pourquoi ; rien sur une lecture partielle, rien d'écrit → « L'OUVERTURE CONFRONTÉE AU BILAN QUI LA
  PRÉCÈDE ».
- **La révision des soldes** (ligne 41, R1) : une DÉCISION par solde d'un compte de bilan à la fin d'un exercice
  (justifié, accepté sur motif, anomalie), immuable : elle se REMPLACE (chaîne `remplace_id`) et, permanente, se REPREND
  l'exercice suivant. Seule `justifier_solde` l'écrit — treize refus dans un ordre fixé, sous le verrou de la
  validation puis celui de la révision, au solde de `solde_du_compte` (jumeau `soldeDuCompteCentimes`) ; une preuve
  RECOPIE l'empreinte de sa source, et une source citée ne se supprime plus (`garder_source_citee`, Q8 confirmée) :
  Justificatifs (la sélection, la fiche) et Documents le disent avant le clic, sous les mots de la base
  (`lib/citationsRevisionLecture.ts`), et « C'est une facture » se refuse AVANT de créer la pièce — suspendue sur une
  lecture partielle des citations → « LA BASE DES SOLDES RÉVISÉS », « L'ÉCRAN DE LA RÉVISION ».
- **Le module de la révision** (ligne 41, R2 ; `lib/revision.ts`, `revisionCycles.ts`, `revisionPreuves.ts`, purs) :
  l'état d'un solde se DÉDUIT de la chaîne de ses décisions, du solde du jour et des empreintes relues, jamais stocké —
  une anomalie dont le solde a changé se revoit aussi ; chaque compte de bilan reçoit une preuve PROPOSÉE, qui dit ce
  qu'elle établit et n'établit pas et ne recopie aucun texte saisi ; plusieurs relevés au 31 décembre ne s'additionnent
  jamais (un relevé ne dit pas son compte) ; les refus de `justifier_solde` et de `garder_source_citee` se disent avant
  le clic, confrontés au texte des fonctions et rejoués sur l'essai de R1 (`revisionEssai.test.ts`) ; tout compte des
  classes 1 à 7 et tout contrôle de la Checklist et des préalables a son cycle, ou le test refuse, et seuls les comptes
  de BILAN et les contrôles qui ont quelque chose à dire ouvrent un cycle → « LE MODULE DE LA RÉVISION ».
- **L'onglet Révision** (ligne 41, R3 ; Comptabilité, après le Bilan) : il lit TOUT le dossier — les lectures de la Vue
  d'ensemble (`lib/checklistLecture.ts`), plus les soldes reportés, les contrôles de tous les relevés, les documents, les
  décisions et leurs preuves — et, sur une lecture partielle (relevés incohérents ou doublons illisibles compris), ne
  montre ni état, ni preuve, ni geste. Une carte par cycle : comptes, état déduit, preuve proposée, et les points de la
  Vue d'ensemble qui s'y rangent (`lib/controlesDeLaRevision.ts` : ceux du dossier, les documents attendus de l'exercice
  révisé seulement). Le panneau « justifier » (`FicheSolde`, volet `solde`) dit ce que la preuve établit et n'établit
  pas, la justification permanente de N−1 (elle remplit, n'écrit pas) et l'historique, empreintes relues ; chaque bouton
  passe `refusDeJustifierSolde` et se grise sous le refus dit ; `justifier_solde` seule écrit, sous un verrou `useRef`
  relâché après la relecture, relue aussi sur refus → « L'ÉCRAN DE LA RÉVISION ».
- **Les cycles de la révision** (ligne 41, R4) : on révise par COMPTE (R1) et par CYCLE pour le travail et la revue
  (NP 2300, A8 et A9 ; norme de management de la qualité, § 29, § 30 et A30-1). Par cycle et par exercice, une
  CONCLUSION immuable — « révisé » ou « anomalie », le programme de travail tel qu'il a été exécuté (`travaux`, jsonb,
  64 Kio), les points à suivre l'exercice suivant — qui se REMPLACE (chaîne `remplace_id`, une première par cycle) ; un
  JOURNAL qui ne fait que s'allonger (échange avec la direction, consultation, travail) ; une REVUE par conclusion,
  « approuvé » ou « à reprendre » motivé, par le chef du cabinet seul (Q2, confirmée ; il peut revoir ce qu'il a
  préparé, la trace le dit). `conclure_cycle`, `noter_revision` et `revoir_cycle` les écrivent seules, sous le verrou de
  la validation puis celui de la révision ; aucune policy d'écriture hors de la restauration, le client n'y voit rien.
  Le programme PROPOSÉ vit dans le code (`PROGRAMME_DES_CYCLES`, codes stables) ; l'ÉTAT d'un cycle se DÉDUIT
  (`cyclesDeLExercice` : non commencé, en cours, révisé, anomalie, à reprendre, revu, revue périmée…), jamais stocké ;
  le cycle « ensemble » porte la synthèse et ne se dit révisé que quand les autres le sont. `lib/revisionRevue.ts` redit
  les refus avant le clic, confronté au texte exporté des fonctions et rejoué sur l'essai → « LES CYCLES DE LA
  RÉVISION ». À l'écran (phase C) : chaque carte de l'onglet Révision porte l'état DÉDUIT de son cycle, ce qui le
  retient, sa conclusion courante et ce que l'exercice précédent a laissé à suivre ; le panneau `FicheCycle` (volet
  `cycle`, plein écran sur téléphone) le programme — celui de la courante, ou le proposé —, l'historique, le journal et
  la revue, offerte au chef seul (`estChef`). Les trois tables se lisent par `lireTout` avec le reste, et rien ne se
  montre sur une lecture partielle ; chaque bouton passe son refus du module et se grise ; une saisie RETIENT la
  conclusion qu'elle remplace (refus 10 dit avant le clic si une autre a été prise depuis) ; un verrou `cycleEnCours`,
  que la décision d'un solde partage, relâché après la relecture → « L'ÉCRAN DES CYCLES DE LA RÉVISION ».
- **La revue analytique** (ligne 41, R5 ; `revision_seuils`, `revision_explications`, `lib/revueAnalytique.ts`, pur) :
  N face à N−1 par poste de la 2035 (avec sa NATURE), par total et par compte des classes 1 à 7 (les autres dits « hors
  de la revue ») ; la source de N−1 se DÉDUIT ligne par ligne — la 2035 ou l'exercice VALIDÉ, sinon un repère annuel (un
  poste de dépenses à son nom exact, le chiffre d'affaires, le résultat net), sinon rien ; jamais un recalcul — ; le
  seuil de signification est fixé et MOTIVÉ par le cabinet (Q4), « au-delà » est strict ; l'état d'une ligne se DÉDUIT
  (à expliquer, expliquée, à revoir quand les montants ou la source commentés ont changé…), et aucune variation n'est
  dite « normale ». La base vérifie ce qu'elle sait lire (solde d'un compte, 2035 validée, repère) et garde le montant
  d'une 2035 calculée tel que l'écran l'a montré ; seules `fixer_seuil_de_signification` et `expliquer_variation`
  écrivent, sous les verrous de la validation puis de la révision, les repères de N−1 verrouillés en partage ; leurs
  refus sont redits avant le clic, confrontés au texte exporté et rejoués sur l'essai (`revueAnalytiqueEssai.test.ts`)
  → « LA REVUE ANALYTIQUE, EN BASE ». À l'écran (phase C, `lib/revueAnalytiqueEcran.ts`, pur) : une section de l'onglet
  Révision lit `revision_seuils`, `revision_explications` et les deux tables de repères EN ENTIER — ratées, elle seule se
  tait (ni tableau, ni état, ni geste) ; la 2035 de l'exercice est celle de Clôture (`declarationPourLaRevue`, jumelle
  gardée par un test qui relit `ClotureTab`) ; le volet `explication` (`FicheExplication`) dit les refus du module avant
  le clic ; un verrou `revueEnCours`, que la décision d'un solde et les gestes des cycles partagent, relâché après la
  relecture ; une saisie RETIENT le seuil ou l'explication qu'elle remplace → « L'ÉCRAN DE LA REVUE ANALYTIQUE ».
- **Le dossier permanent** (ligne 41, R7 ; `dossier_permanent`, `lib/dossierPermanent.ts`, pur ;
  `lib/dossierPermanentLecture.ts`) : ce qui vaut pour plusieurs exercices (NP 2300, § 16 et A9 ; décret n° 2012-432,
  art. 151) — huit natures, un titre, un texte, AU PLUS une pièce ou un document du dossier, cité en jsonb et par son
  empreinte recopiée (`fichier_id` refusé jusqu'à R8), une validité bornes comprises. Il n'appartient à aucun exercice :
  il s'écrit à tout moment (Q11 sans objet). Une entrée ne se modifie pas : une version la REMPLACE (`remplace_id`), la
  courante se RETIRE, une fois, et une retirée ne se remplace plus. Seules `consigner_au_dossier_permanent` (neuf rangs)
  et `retirer_du_dossier_permanent` (quatre) écrivent, sous le verrou partagé de la validation puis celui de la
  révision ; la garde prend le verrou de la révision PAR SA CLÉ (sous la RLS, un `FOR SHARE` sans policy de mise à jour
  ne rend aucune ligne). Une source citée ne se supprime plus ni ne change de dossier : `garder_source_citee` dit la
  révision d'un solde d'abord, mot pour mot, puis le dossier permanent par la NATURE, jamais le titre. Le module redit
  les refus avant le clic, confronté au texte exporté et rejouant l'essai → « LE DOSSIER PERMANENT DE LA RÉVISION, EN
  BASE ». À l'écran (phase C) : une section de l'onglet Révision, valable QUEL QUE SOIT l'exercice
  (`DossierPermanentSection`, volet `dossier-permanent` — `FicheDossierPermanent` —, mots et rangement purs dans
  `lib/dossierPermanentEcran.ts`) : les entrées courantes dans l'ordre de A9, leur validité, l'état de leur citation en
  mots, l'historique et les retirées repliés, et ce que A9 propose sans entrée, dit comme une INFORMATION — pour
  l'exercice choisi ou, sans exercice (« toutes », « sans date », dossier neuf sans aucune année), pour AUJOURD'HUI à
  Paris, lu au rendu (`vautLeJour`, bornes comprises) ; elle ne dépend que de SES lectures (les entrées, les pièces et
  les documents : `motifsDuPermanent`), et une autre lecture partielle de l'onglet ne la tait plus ; écriture par les
  deux fonctions seules sous `permanentEnCours`, que les trois autres verrous de l'onglet partagent, relâché après la
  relecture, relue aussi sur un refus. Une nouvelle version RETIENT celle qu'elle remplace, part de la courante, montre
  l'état de la citation reprise et reste grisée tant que rien ne diffère ; une citation reprise « changée » ou
  « disparue » suffit à la dégriser (R7C2-Q1), se dit avant le clic et fait confirmer l'enregistrement (la nouvelle
  version cite le fichier d'aujourd'hui : seul l'historique garde la trace) → « LES DEUX RETOUCHES DU DOSSIER
  PERMANENT ». La règle des sources citées (`lib/citationsRevisionLecture.ts`) lit aussi le dossier permanent :
  Justificatifs, Documents et « C'est une facture » disent le refus de `garder_source_citee` tout entier, un bandeau par
  lecture partielle → « L'ÉCRAN DU DOSSIER PERMANENT DE LA RÉVISION ».
- **Le plan comptable se cite dans sa numérotation du 1er janvier 2026, et sous ses intitulés** (règlement ANC n° 2014-03
  consolidé : le 108 et le résultat d'une entreprise individuelle passent au 101 selon l'art. 1211-10, ex-941-10) ; une
  migration déjà appliquée garde l'ancien numéro ; 467, 468, 658 et 758 ont changé d'intitulé depuis 2019
  (`comptes.test.ts` les épingle, recopiés de la nomenclature), et le refus du 468 sur un mouvement du relevé garde le
  sens de 2019 jusqu'à sa correction à part (Q12, « oui » le 17/10/2026 : il se traitera comme le 467) → « LE PLAN
  COMPTABLE A CHANGÉ DE NUMÉROTATION ».
- **Le plan comptable d'un dossier** (`plan_comptable_dossier`, ligne 43, PC1) : un rôle sans ligne prend le défaut du
  catalogue (`roles_comptables`, 26 rôles = les constantes de `comptes.ts`, confrontés à la migration et épinglés par
  `planComptable.test.ts`) ; `compte_du_role` (lève sur un rôle inconnu), `compte_du_dirigeant` (le `case` que cinq
  fonctions recopiaient) et `plan_du_dossier` le lisent ; le client n'en voit rien ; aucune
  policy d'écriture, et la garde n'admet que la restauration par le super-administrateur dans un dossier sans écriture,
  à-nouveau ni solde reporté (six chiffres — Q5 —, sous une racine du rôle, préfixe des seuls tiers). Le catalogue est
  hors de toute sauvegarde (`PARENTS_HORS_PLAN_VOULUS`) ; la restauration lit dans la base d'arrivée chaque rôle qu'un
  plan désigne avant d'écrire, et réinsère le plan juste après son dossier → « LE CATALOGUE DES RÔLES ET LE PLAN D'UN
  DOSSIER, EN BASE ». Depuis PC2 (11/10/2026), les quatorze fonctions qui écrivent ou vérifient un compte de rôle le
  lisent par `compte_du_role` ou `compte_du_dirigeant`, jamais en dur, dans le plan du dossier DE L'APPEL ; les douze
  qui écrivent prennent d'abord le verrou PARTAGÉ du dossier, à la clé de `cle_validation` écrite en ligne (leur
  appelant n'exécute pas `cle_validation`) ; `laBaseLitLePlan.sql` (le plan décalé posé par la restauration, dans des
  dossiers jetables), `planComptable.test.ts` (la forme, lue dans le texte exporté) et les confrontations aux clés de
  rôle (dont `liquidationTva.test.ts`) le gardent → « LA BASE LIT LE PLAN, SANS RIEN CHANGER ».
  Depuis PC3a (12/10/2026), la page d'un dossier le lit avec lui (`plan_du_dossier`, `lireLePlanDuDossier`, gardé avec
  l'identifiant lu) : absent, refusé, illisible ou incomplet, aucun onglet ne se monte et elle le dit. Le modèle
  comptable le porte (`ModeleComptable.plan`) ; une composition qui ne reçoit pas le modèle reçoit `plan`, obligatoire ;
  `CompteNotesDeFrais` est le compte de l'un des trois rôles du dirigeant DU PLAN (`modeleDuDossier(dossier, plan)` rend
  le refus sinon ; la contrainte de la base jusqu'à PC4). `compositionsAuPlan.test.ts` joue chaque composition sous
  `PLAN_DECALE` (aucun compte par défaut ; ramenée au défaut, la même au caractère près ; les 26 rôles exercés), et
  `comptesEnDur.test.ts` refuse un compte de rôle écrit en dur hors du catalogue — numéro, constante, alias ou plan par
  défaut —, exceptions comptées → « L'APPLICATION LIT LE PLAN ».
- **Montant retenu** : le HT pour un assujetti, le TTC pour un exonéré (`lib/montantRetenu.ts`, statut en paramètre
  obligatoire) → « HT OU TTC ».
- **La 2035 compte une pièce à la date de son PAIEMENT** (`lib/rattachement.ts`) ; les paiements d'une pièce viennent de
  `paiementsDesPieces` (rapprochements ET parts d'un virement groupé : un filtre sur `piece_id` les oublierait) ; une
  échéance de cotisation payée compte à son prélèvement, ou au jour de son paiement depuis le compte personnel. Les
  moteurs prennent leurs entrées en paramètres OBLIGATOIRES, sans valeur par défaut → « LA 2035 COMPTE UNE PIÈCE À LA
  DATE DE SON PAIEMENT ».
- **La CA3** (`lib/declarationTva.ts`) : exigibilité à l'encaissement ou au paiement, part de chaque paiement, aucune
  somme négative sur une ligne de taux, arrondi fiscal par ligne, taux reconnu ou pièce écartée, montants au centime des
  écritures ; une déclaration enregistrée écrit sa liquidation → « LA CA3 SE PRÉPARE », « LA TVA SE LIQUIDE ».
- **Le moteur de la 2035** garde une ligne par poste ET par nature ; un poste négatif reste négatif et la case négative
  se dit. Une case n'appartient pas à la ligne en face (BH, BJ, BM groupent des lignes) ; les amortissements vont en CH ;
  la CSG-CRDS passe entière au 108 en trésorerie, 6,8 points en BV, rien en ligne 25 ; le cadre 8 (revenu brut social,
  DC/DD) vaut depuis les revenus 2025, sans l'abattement de 26 % → « Sur la 2035-A, une case », « Le cadre 8 du 2035-B »,
  « ET LA MÊME QUESTION POSÉE AUX COTISATIONS ».
- **L'annexe 2035-E se tire de la 2035 déposée** (`lib/declaration2035E.ts`) : ses lignes viennent des cases À L'EURO,
  le seuil de 152 500 € se juge AU CENTIME ; sans saisie, les loyers ne se déduisent pas et l'écran dit leur montant ;
  ni le cadre des mono-établissements ni BW ne se remplissent à la place du cabinet ; lecture partielle, rien ne se
  juge ; « non due » vaut pour une année entière ; la page 3 se repère SEULE (`ancragesDesCodes` : « BK » y est
  l'effectif).
- **PDF de la 2035** : sans champ de formulaire (coordonnées tirées du texte, `gabarit2035.ts`) ;
  `Intl.NumberFormat('fr-FR')` casse pdf-lib (U+202F) ; pdf.js vide le tampon qu'on lui passe (`slice(0)`).
- **Barème kilométrique** : saisi par millésime, jamais emprunté à une autre année (2026 reprend la table de 2025) ;
  vit à TROIS endroits (`BAREMES`, `bareme_kilometrique()` en base, copie de l'assistant) ; la tranche choisit la
  formule, appliquée au total ; le forfait et les frais réels ne cohabitent pas (`doublonFraisVehicules`) →
  « Le barème kilométrique est saisi ».
- **Cotisations Urssaf des praticiens conventionnés** : testées contre le moteur de l'Urssaf à l'euro, dans son ordre
  d'opérations ; plafond de la sécurité sociale saisi par année → « L'ESTIMATION DES COTISATIONS URSSAF ».
- **Dotations** : le cumul s'arrondit, pas l'annuité ; même calcul en base, en entiers. Le compte d'amortissement est 28
  suivi du compte du bien sans son 2 ni ses zéros de fin, complété à six chiffres : un sixième chiffre significatif se
  garde (218311 → 2818311, « même ventilation », PCG art. 1121-1) — `compte_amortissement`, `compteAmortissement` et la
  copie de l'assistant, confrontés à une table relevée en base (`amortissements.test.ts`).
- **FEC** : article A47 A-1 (virgule décimale, une écriture = une date, numérotation partagée `numeroterFec` /
  `formaterFec`) ; Test Compta Demat a été lu, jamais exécuté ; ce n'est pas le FEC légal du dossier →
  « LE FEC SUIT L'ARTICLE A47 A-1 ».
- **La piste d'audit se PRODUIT** (`pisteAudit.ts`) : une ligne par écriture et par justificatif que rien ne
  comptabilise, l'empreinte SHA-256 pour preuve (vide plutôt qu'un nom de fichier). Un export CSV porte un BOM UTF-8 et
  passe chaque champ par `champCsv` → « Une piste d'audit se PRODUIT ».
- **Rapprochement** : valider automatiquement demande TROIS signaux (montant au centime, date avec appariement
  mutuellement unique, fournisseur retrouvé mot à mot) ; un lot n'écrit que ce qui n'a qu'un candidat dans les DEUX
  sens ; la banque fait foi sous un seuil `min(2 %, 5 €)` (`alignementBanque.ts`), jugé sur le total payé de la pièce →
  « Valider automatiquement demande TROIS signaux », « LA BANQUE FAIT FOI, MAIS SOUS UN SEUIL ».
- **Un mouvement est justifié par le relevé** (`mouvementJustifieParLeReleve`) ; ses liens exclusifs tiennent dans
  `lignes_bancaires_un_seul_rapprochement` (`num_nonnulls(…) <= 1`) ; chaque classement refuse un mouvement déjà classé
  ailleurs, avant le clic et en base.
- **Validation d'un exercice** : intangibilité par DÉCLENCHEURS (deux chemins écrivent sans fonction), frontière au
  31 décembre du dernier exercice validé, sources figées, deux sorties seulement (suppression du dossier, restauration) ;
  une échéance de cotisation se fige à la date qui la compte, `coalesce(mouvement, paiement personnel, échéance)`
  (`garder_cotisation_valide`) ; préalables dits avant le clic (`prealablesValidation.ts`,
  `POINTS_DE_LA_CHECKLIST_ECARTES`, `CARTES_DE_CLOTURE`) → « UN EXERCICE VALIDÉ SE FIGE EN BASE », « UN EXERCICE SE
  VALIDE DEPUIS CLÔTURE ».

### Import, OCR, classification

- **Montants et dates bancaires** : `csv.ts` seul les analyse ; le sens d'un PDF à deux colonnes se lit à l'abscisse ; la
  colonne libellé se choisit à la densité ; les lignes de solde se reconnaissent (libellé, largeur) ou se désignent à
  la main, et le contrôle de solde est CONSERVÉ (`controles_releves_bancaires`) → « Un relevé ne contient pas que des
  opérations ».
- **Classification** : le bordereau de télétransmission d'abord (une recette), les relevés d'activité et de situation en
  Documents ; le sens d'une pièce est décidé par `orientationDe`, dont `receive-email` porte une copie gardée →
  « Le sens d'une pièce est décidé par la classification ».
- **Un fournisseur se reconnaît à une clé d'identité** (`cleFournisseur`, sigles pointés recollés,
  `MOTS_SANS_IDENTITE`) ; deux noms se comparent mot à mot, jamais par sous-chaîne.
- **« Textract sait le lire » n'est pas « l'application accepte ce fichier »** (`textractPeutLire`, liste blanche). Une
  relecture coûte un appel facturé : elle ne relit que ce qui manque, n'écrit que la date et le texte, et disparaît quand
  la liste des textes est illisible (`PresenceTexteOcr`).
- **Doublons de contenu** : `piece_textes_ocr.texte_md5` (colonne générée), comparée à l'intérieur d'un dossier.
- **Le texte OCR vit dans `piece_textes_ocr`** (une pièce OU un document), jamais sur `pieces`, chargé à la demande et
  montré tel quel à l'arbitrage. Une date déduite (la première en ordre de lecture) est marquée `_date_deduite` et dite
  « à vérifier », jamais confondue avec une date lue.
- **Un ZIP écrase sans rien dire** (`nomUnique`) ; un filtre de période écarte les NULL (feuille « Pièces sans date ») ;
  un livrable incomplet le dit.

### Facturation électronique

- **La racine du mandataire (G1.45)** : une facture que le cabinet valide au nom du client est émise sous mandat, et la
  DGFiP demande alors une racine de numéro propre au mandataire ; l'hypothèse d'une seule série (P2, EC-Q2) ne la donne
  pas. Tranchée par le cabinet le 16/10/2026 (MEG1-Q5, « comme recommandé ») : deux séries par dossier, celle du client
  et celle du mandataire, choisie selon QUI valide ; le client valide ses factures, la série du cabinet ne sert qu'à le
  dépanner ; le client qui quitte son ancien logiciel continue sa série. Le 17/10/2026, la page des arbitrages a reçu
  pour EC-Q2 la réponse d'avant, « série unique » : la contradiction est reposée (ARB-EC-Q2), MEG1-Q5 vaut d'ici là.
  Rien n'en est encore écrit : la série du
  mandataire vient avec A9, ou avant si le cabinet doit valider une facture réelle d'ici là → « L'ESPACE CLIENT,
  LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ ».
- **Pièges EN 16931 / Super PDP** : la TVA sur chaque ligne (BR-S-08), l'unité `C62` (BR-23), le n° de TVA du vendeur
  (BR-S-02), `is_valid=false` porté aussi par un rapport fait d'avertissements, le SIRET du vendeur = l'entreprise
  authentifiée, le motif d'une ligne à 0 % selon le statut de TVA → « Pièges EN16931/Super PDP ».
- **Le statut de TVA du dossier** (redevable, franchise, exonéré avec son article, ou à préciser) décide de la mention,
  de ce qu'une facture peut valider et du motif transmis ; `assujetti_tva` en est déduit par un déclencheur →
  « LE STATUT DE TVA DU DOSSIER ».
- **Le générateur CII** (`lib/factureCii.ts`) : refus avant le clic, un refus par faute ; un avoir en montants positifs
  (type 381) ; validé par `outils/facturation/valider.mjs` sur des exemples figés → « LA FACTURE ÉLECTRONIQUE S'ÉCRIT EN
  CII ».
- **Une facture validée est figée en base** (`factures_emises_figees`, `facture_lignes_figees` ; `v_modifiables` = les
  seules colonnes écrites après coup, confrontées au code par `facturesFigees.test.ts`) ; la numérotation passe par
  `enregistrer_facture` seule (reprise depuis le plus haut numéro émis, verrou de la série) → « UNE FACTURE VALIDÉE SE
  FIGE EN BASE ».
- **Le dépôt d'une facture émise** (plateforme du client et Super PDP) : la facture se relit en base et se juge avant
  tout appel ; les deux fonctions l'assemblent par `donneesDeLaFacture` (les écrans aussi, avant la validation et avant
  le clic), et les trois
  blocs du générateur sont recopiés au caractère près dans les deux fonctions (`copiesFacturation.test.ts`) ; une seule
  transmission ACTIVE par facture, tous canaux confondus, RÉSERVÉE avant l'envoi (`transmissions_factures`) ; une issue
  inconnue laisse « envoi », jamais un nouvel essai, et `suivre` retrouve le dépôt par son identifiant de suivi → « LA
  FACTURE ÉLECTRONIQUE SE DÉPOSE ».
- **Une transmission restée « envoi »** bloque tout nouvel envoi : elle s'abandonne un quart d'heure après son départ,
  par le cabinet, vérification faite sur la plateforme (`abandonner_transmission`) ; un seul délai,
  `DELAI_AVANT_ABANDON_MS`, confronté à la migration et au suivi → « LES ÉCRANS DE LA FACTURE ÉLECTRONIQUE ».
- **Une facture rejetée ou refusée ne repart pas** : elle s'annule par un avoir interne, qui ne se transmet pas (DGFiP,
  § 3.6.4), et la base refuse l'une et l'autre ; le statut de Super PDP se reporte sur la transmission (213 et 501
  rejettent, 202 et la suite acceptent, un rejet l'emporte).
- **Les encaissements d'une facture émise** (statut « Encaissée », 212 ; `encaissements_factures`,
  `encaissements_factures_taux`, ligne 28.5 d1) : un REGISTRE, jamais déduit d'un rapprochement, que seule
  `enregistrer_encaissement` écrit — douze refus dans un ordre que d2 et d3 reprennent, plafonds de la facture, de chaque
  taux et du mouvement (seuil min(2 %, 5 €)) sous verrou, montants NETS des retirés et des annulations. Il ne se modifie
  pas : jamais déclaré, il se retire (`retirer_encaissement`) ; déclaré, il se contre-passe (`annuler_encaissement`, d4). Le TTC par taux est REFAIT en base comme `montantsDuDocument`, en double précision
  (`centimes_ligne_facture`), confronté à une table relevée en base (`encaissementsBase.test.ts`). La restauration
  écrit une annulation APRÈS sa cible, par vagues (`TABLES_AUTO_REFERENCEES_PAR_VAGUES`), jamais en deux passes. Le module
  `lib/encaissementsFactures.ts` (d2) le dit avant le clic : l'obligation, le plus sûr d'abord ; les refus de la base,
  dans son ordre et sous ses mots — confrontés au texte de la fonction, aux messages de l'essai et à une batterie de
  4 000 saisies jouée sur une réplique (`encaissementsBatterie.test.ts`, aucun écart) — ; le reste NET par taux de
  `montantsDuDocument` ; la répartition au prorata des restes (Q3) ; l'échéance ; des propositions dont chacune est un
  encaissement que la base accepterait. L'écran (d3) : une pastille par facture validée selon `resteAEncaisser`, muette
  pour un statut sans objet et sur une lecture incomplète (`lib/encaissementsAffichage.ts`) ; la fenêtre
  `EncaissementsFactureModal` lit tout par `lireTout`, n'offre rien sur une lecture partielle, dit les refus avant le clic
  et n'écrit que par les deux fonctions, sous un verrou relâché après la relecture ; `encaissementsEcritures.test.ts`
  refuse toute écriture directe du registre hors de la restauration (`sauvegardeDonnees.ts`, deux écritures à table
  variable) → « LES ENCAISSEMENTS D'UNE FACTURE ÉMISE », « LE MODULE DES ENCAISSEMENTS », « L'ÉCRAN DES ENCAISSEMENTS ».
- **La déclaration du statut « Encaissée »** (`transmissions_encaissements`, ligne 28.5 d4) : hors application d'abord
  (canal `manuel` : le cabinet ou le client saisit le statut sur la plateforme, `declarer_encaissement_hors_application`
  le garde, déposé, sans flux ni fichier), sur la plateforme QUI A ACCEPTÉ la facture (transmission acceptée, ou Super
  PDP déposée avec le statut 200) — une facture que l'application n'a pas transmise ne se déclare pas d'ici ; une seule
  déclaration ACTIVE par encaissement, tous canaux confondus (la plateforme de l'administration ne dédoublonne pas) ; un
  encaissement déclaré ne se retire plus, il se CONTRE-PASSE (`annuler_encaissement` : montant et parts opposés, motif
  obligatoire, datée du décaissement, entre l'encaissement et aujourd'hui à Paris — décision confirmée par le
  cabinet le 17/10/2026), et la contre-passation se déclare à son tour sur la même plateforme. La garde ne compte, pour
  une déclaration d'hier (une restauration), que ce qui était connu avant elle. Les refus, dans l'ordre (huit et douze),
  le module les dit avant le clic (`refusDeclaration`, `refusContrePassation`). L'écran (`EncaissementsFactureModal`)
  lit les déclarations du dossier par `lireTout` — lues en partie, il n'offre AUCUN geste — ; dit de chaque encaissement
  où il est déclaré, ou où et avant quand le déclarer, ou pourquoi pas d'ici ; « Déclaré sur la plateforme »
  (obligation due ou facultative) dit ce qu'il faut saisir champ par champ, de vérifier que l'acheteur n'a pas refusé
  la facture sur la plateforme du client (depuis d7, ce qui est SU : statuts lus jusqu'au bout et quand, ou pas encore, avec le bouton qui les relève), et confirme en nommant ce qui est déclaré ;
  « Contre-passer » remplace « Retirer » sur un déclaré, date jamais proposée. L'onglet Factures porte une SECONDE
  pastille, « À déclarer » / « Déclaration en retard », pour une obligation DUE et sur ce qui se déclare d'ici
  seulement (`pastilleDeclaration`), muette sur toute lecture incomplète. `encaissementsEcritures.test.ts` refuse toute
  écriture directe de `transmissions_encaissements` dans `src/` hors de la restauration, et nomme les Edge Functions
  qui l'écriront (aucune avant d6) → « LA DÉCLARATION HORS APPLICATION », « L'ÉCRAN DE LA DÉCLARATION HORS
  APPLICATION ».
- **Le message du statut « Encaissée »** (`lib/cdarEncaissee.ts`, ligne 28.5 d5) : le CDAR D22B de l'UN/CEFACT (les
  chemins de l'annexe 2 v2.3 sont ceux de ce schéma) ; un statut par encaissement, une caractéristique MEN par taux, la
  contre-passation négative et son motif ; MDT-74 s'écrit `false` (l'annexe écrit « False », que le schéma refuse),
  MDT-100 au format 204. Ce que l'annexe ne dit pas du message d'un FOURNISSEUR est un paramètre sans valeur par défaut
  (`ChoixCdar` : profil, parties, porteur de la date d'encaissement, fuseau) ; MDT-95 vient de l'appelant. Un montant se
  lit par `centimesExacts`, jamais par `decimal` (refus à tort dès 2²⁷ €). Le module ne juge ni si ni où le statut se
  déclare ; son bloc se recopie derrière ceux de la facture électronique (`cdarEncaisseeCopie.test.ts`), ses exemples
  passent par `outils/facturation/cdar/` → « LE MESSAGE DU STATUT « ENCAISSÉE » ».
- **Le cycle de vie des factures émises** (`statuts_factures_recus`, ligne 28.5 d7) : les statuts que la plateforme du
  client rend au vendeur (`CustomerInvoiceLC` entrants, CDAR) se relèvent sur un clic (`plateforme-agreee`, action
  `relever`), se lisent par `lib/cdarRecu.ts` sans jamais deviner (copie gardée par `cdarRecuCopie.test.ts`), se
  rattachent à une facture VALIDÉE du dossier par l'identité de G1.42 — numéro, année, SIREN FIGÉ à la validation — et
  s'écrivent une fois par flux, par la fonction seule ; ce qui ne se rattache à rien ne se garde pas, il se dit, et
  jamais avec ce que porte le message d'une autre entreprise. Un 210 ou un 213 lu a les conséquences d'un refus chez
  Super PDP, aux quatre endroits où la règle vit (refus 5, refus 6 et sa garde, transmission de la facture et de son
  avoir), sous les mêmes mots ; pour une écriture d'hier, seul le statut lu avant elle compte. Point de reprise à part
  (`cycle_vie_depuis`), règle de la réception (`repriseDesStatuts` confrontée à `pointDeReprise`). Le 601 se lit et se
  dit ; son effet appartient à d6. L'écran (phase C) : la table se LIT par `lireTout` (l'onglet Factures : le dossier ;
  les fenêtres des encaissements et de la transmission : la facture), lue en partie elle ne commande rien ; « Lire les
  statuts de la plateforme » et « Relire les statuts depuis le début » (confirmé) relèvent SUR UN CLIC, sous le verrou
  de l'écran relâché après la relecture, et disent leur bilan (`lib/statutsLus.ts`, `lib/releveStatuts.ts`) ; la
  pastille « Cycle de vie · … » montre le dernier statut sous le libellé de la DGFiP — le refus s'il y en a un — et un
  210 ou un 213 fait proposer l'« Avoir interne » ; la transmission refuse avant le clic une facture refusée sur sa
  plateforme → « LE CYCLE DE VIE DES FACTURES ÉMISES », « L'ÉCRAN DU CYCLE DE VIE DES FACTURES ÉMISES ».
- **L'e-reporting** (`lib/periodesEreporting.ts`, e1) : les ACHATS à un fournisseur établi hors de France se déclarent
  pour tout assujetti, exonéré et franchisé compris ; les ventes et les paiements selon le statut (« le cas échéant »
  pour un exonéré) ; à partir des factures du 1er septembre 2027. La fréquence est PROPOSÉE, jamais décidée ;
  l'échéance est la plus proche que laissent les sources ; aucune transmission à blanc ; `echeanceDeDeclaration` (d2)
  en tire sa période. Aucun écran ne dit plus d'un exonéré qu'il « n'y est pas tenu », ni d'un non-redevable qu'il
  « n'a pas de déclaration à déposer » → « L'E-REPORTING : L'OBLIGATION DITE JUSTE ».
- **La fiche d'un achat hors de France** (`pieces_hors_de_france`, `pieces_hors_de_france_taux`, ligne 28.5 e2) : ce que
  l'e-reporting des achats transmettra d'une facture d'un fournisseur établi hors de France (CGI, art. 290, I-3° ; flux
  10, bloc 10.1), SAISI par le cabinet sur une pièce d'achat ou une note de frais — rien ne s'en déduit. Elle ne se
  modifie jamais : une version nouvelle REMPLACE la courante (`remplace_id`, une chaîne par pièce), la courante se
  RETIRE (`retire_le`), rien ne se supprime sauf avec la pièce ou le dossier ; seules `enregistrer_fiche_hors_de_france`
  (48 refus, dans un ordre que `lib/piecesHorsDeFrance.ts` redit avant le clic) et `retirer_fiche_hors_de_france`
  l'écrivent, sous le verrou de la validation puis celui des fiches ; le client n'en voit rien. Elle suit le gel de sa
  pièce (`exercice_figeant_la_piece`, le critère de `garder_piece_validee`) ; une pièce qui en a une ne change plus de
  dossier ; une facture — numéro, année, fournisseur — ne se décrit qu'une fois par dossier. Q7 et Q3, confirmées le
  17/10/2026 : une TVA facturée met l'achat de côté, la fiche ne dépend pas du numéro de TVA du dossier ; le point 15
  reste en hypothèse (une acquisition dans l'Union sans autoliquidation est à trancher) ; ni la France, ni Monaco, ni
  l'outre-mer. Le test du module rejoue
  l'essai étape par étape ; la restauration la réinsère par vagues, avant le brouillon → « LA FICHE D'UN ACHAT HORS DE
  FRANCE, EN BASE ».
- **La fiche d'un achat hors de France, à l'écran** (e3, `pages/dossier/FicheHorsDeFrance.tsx`, dans la fiche d'une
  pièce) : les fiches et leur ventilation lues par l'onglet Pièces (`lib/piecesHorsDeFranceLecture.ts`, `lireTout`),
  relues seules après une écriture ; rien de montré ni d'offert sur une lecture absente ou partielle, sur un gel lu en
  partie, ni tant que le type ou les montants de la pièce portent une saisie (la base compare à la pièce ENREGISTRÉE) ;
  les refus des deux fonctions dits avant le clic par `lib/piecesHorsDeFrance.ts`, ceux de la pièce avant même la
  saisie ; le type se lit au signe, le schéma au pays ; la version courante est rejugée contre la pièce d'aujourd'hui ;
  une saisie s'ouvre sur la version courante, qu'une version enregistrée depuis fait relire ; écriture par les deux
  fonctions seules sous un verrou relâché après la relecture. Les propositions sont pures
  (`lib/propositionsHorsDeFrance.ts` : numéros de TVA de l'Union aux structures de VIES, mention d'autoliquidation,
  numéro de facture, fiche la plus récente d'un même fournisseur), chacune avec sa source et son extrait, jamais
  appliquée seule. La suppression d'une pièce (FichePiece) ou d'une sélection (PiecesTab) NOMME la fiche que la cascade
  emporte, ou dit qu'elle ne la sait pas → « LA FICHE D'UN ACHAT HORS DE FRANCE, À L'ÉCRAN ».
- **Le contenu des déclarations d'e-reporting** (`lib/ereporting.ts`, e4, pur) : pour une période d'e1 (`periodeDe` sous
  le régime confirmé qui couvre son premier jour — e5a —, sinon sous le statut d'aujourd'hui, proposé ; à cheval sur deux
  régimes, elle se refuse), trois déclarations qui ne se mêlent pas (G6.29, G7.52) : les ACHATS (10.1, acheteur ; la fiche courante non retirée
  d'e2, rejugée contre la pièce d'aujourd'hui ; numéro de TVA du dossier exigé, Q3), les VENTES à un particulier (10.3,
  par jour, TLB1 ou TPS1, option et taux, depuis les seules factures émises — `montantsDuDocument`, un avoir en moins et
  à sa date), leurs PAIEMENTS (10.4, par jour et taux, le registre de d1 net des retraits et des contre-passations). La
  facture décide de l'obligation, la réalisation range (point 6) ; un motif certain d'écarter (exonérée, biens, débits)
  l'emporte sur une donnée inconnue ; une facture à un client étranger se refuse jusqu'à e7. Quatre états, vingt-deux
  refus dans un ordre fixé (`REFUS_EREPORTING`, le premier est ce que e5 et e6 diront) ; jamais « rien à déclarer » sur
  une lecture partielle ni tant qu'une pièce candidate (les signaux d'e3) attend. Hypothèses nommées, passées sans
  défaut (`HYPOTHESES_DE_LA_CONCEPTION`) → « LE CONTENU DES DÉCLARATIONS D'E-REPORTING ».
- **Le régime d'e-reporting confirmé et la pièce écartée** (`regimes_ereporting`, `pieces_ecartees_ereporting`, e5a ;
  `lib/regimesEreporting.ts`) : le régime est une DONNÉE que le dossier a déclarée à sa plateforme (impots.gouv.fr,
  22/09/2026), confirmée par le cabinet et DATÉE — son histoire est celle du statut de TVA, jamais pour l'avenir ; une
  période se juge sous le régime de son premier jour (fréquence confirmée, statut, numéro de TVA de la période) ; à
  cheval sur deux régimes, elle se refuse (NON VÉRIFIÉ, E5-Q1) ; un onglet TVA qui le contredit la fait reconfirmer. Les
  fréquences des textes sont des contraintes de la table, celle d'un exonéré confirmée « chaque mois » par la fonction
  (Q4). Un régime et un écart ne se modifient pas : ils se RETIRENT ; seules `confirmer_regime_ereporting` (seize refus),
  `retirer_regime_ereporting`, `ecarter_piece_ereporting` et `reprendre_piece_ereporting` écrivent ; le client n'en voit
  rien. Une pièce qui a une fiche « hors de France » ne s'écarte pas, une fiche posée après l'écart l'emporte ; une pièce
  écartée ne change plus de dossier. Le module redit les refus et REJOUE l'essai appel par appel
  (`src/test/essaiSql.ts`) ; `lib/regimesEreportingLecture.ts` lit les deux tables en entier → « LE RÉGIME
  D'E-REPORTING CONFIRMÉ ET LA PIÈCE ÉCARTÉE, EN BASE ».
- **La déclaration d'e-reporting hors application** (`declarations_ereporting`, `declarations_ereporting_sources`, e5b1 ;
  `lib/declarationsEreporting.ts`) : le cabinet dit ce qu'il a déclaré sur la plateforme du dossier, et la base GARDE
  le contenu d'e4 figé et son empreinte SHA-256, qu'elle CALCULE sur le texte du `jsonb` (une colonne ordinaire que la
  garde recalcule) ; une seule active par dossier, objet et période, aucune qui en chevauche une autre ; une
  rectificative remplace la période ENTIÈRE (DGFiP, § 3.7.7, note 127). Seule `declarer_ereporting_hors_application`
  écrit — trente refus, l'accès d'abord, la période vérifiée en SQL (`periode_ereporting`, la grille d'e1 confrontée
  par le test), la période finie à Paris EN DERNIER, le contenu jugé à sa FORME, jamais à son calcul — ; le client
  n'en voit rien. Une pièce dont une fiche est source d'une déclaration ACTIVE ne se supprime plus (E5-Q6,
  `garder_piece_declaree`) ; un régime retiré reste désigné (E5-Q7). Le module redit les refus, REJOUE l'essai appel
  par appel et dit « à rectifier » par opération, jamais sur une lecture partielle → « LA DÉCLARATION D'E-REPORTING
  HORS APPLICATION, EN BASE ».
- **Les écrans de l'e-reporting** (`pages/dossier/EreportingCard.tsx`, `EreportingModal.tsx`, `lib/ereportingEcran.ts`
  pur, `lib/ereportingLecture.ts`, e5c) : la carte lit les régimes seuls ; la fenêtre lit douze tables EN ENTIER
  (`lireTout`) et, sur une lecture absente, partielle ou qui lève, ne dit ni n'offre rien et nomme ce qui manque ; les
  textes lus ne sont que ceux des achats qui peuvent entrer dans une période, par lots ; les refus des cinq fonctions
  se disent avant le clic par les modules, jamais réécrits ; un verrou par écran, relâché après la relecture, relue
  aussi sur un refus ; la déclaration dit ce qu'elle garde et nomme ce qu'elle déclare ; rien ne part vers une
  plateforme. Écarter et reprendre se font dans la FICHE de la pièce (candidate : sans fiche, un signal) ; une pièce dont
  la fiche est déclarée ne se supprime plus et la suppression le dit (E5-Q6) ; le CSV est le détail de la période, pas le
  fichier de la plateforme (e6) → « LES ÉCRANS DE L'E-REPORTING : LA CARTE, LA FENÊTRE, L'ÉCART D'UNE PIÈCE ».
- **Le fichier d'une déclaration d'e-reporting** (`lib/fluxEreporting.ts`, e6, pur) : le XML du flux 10 de la DGFiP
  (« FRR ») d'une déclaration ENREGISTRÉE (e5b1), depuis son contenu FIGÉ lu sans rien deviner (version 1), jamais
  recalculé ; TT-1 est l'identifiant de la déclaration, TT-4 IN ou RE, une remplacée ne se dépose plus ; un fichier ne
  porte que le bloc de son objet (G6.29, que le schéma laisse passer) ; soixante refus dans un ordre fixé (`REFUS_FRR`),
  chacun sa règle — celle du flux 10 : l'annexe 7 a une jumelle par flux (G1.43 pour la facture, G1.44 pour
  l'e-reporting), la colonne « RG applicable au F10 » tranche, et un test la confronte —, dits avant tout fichier ;
  l'émetteur (TG-3), le fuseau de TT-3, le code de l'option pour les débits et un paiement négatif sont des PARAMÈTRES
  sans défaut (`ChoixFrr`, E6-Q1 à E6-Q4) ; la raison sociale du déclarant (TT-14) n'est pas figée, l'appelant la donne ;
  G1.53 se juge sans sa tolérance d'un centime. Le bloc `fluxEreporting` (bornes posées, recopié à e9) ne nomme que
  cinq exports du bloc factureCii (`fluxEreportingCopie.test.ts`) ; `outils/facturation/ereporting/valider.mjs` en juge
  les exemples par les XSD de l'archive officielle → « LE FICHIER D'UNE DÉCLARATION D'E-REPORTING ».
- **Les statuts du cycle de vie s'affichent sous les libellés de la DGFiP** (tableau 8 des spécifications externes v3.2,
  § 3.6.4 ; 501 : annexe 2) — « Déposée », « Approuvée », « En litige », « Paiement transmis », « Encaissée »… :
  `superpdpStatuts.test.ts` les garde, recopiés de la source et non du module.
- **Le numéro de TVA d'un dossier en franchise ou exonéré** : une case par dossier (`numero_tva_attribue`, décision du
  cabinet du 08/10/2026), refusée par la base hors de ces statuts ; le numéro se calcule du SIREN ; sans elle, ses
  factures sans TVA ne partent pas (G1.47). La facture imprimée porte le numéro de l'émetteur (`numeroTvaImprime`),
  jamais pour un statut à préciser.
- **Réception par la plateforme du client** : la facture doit désigner le dossier (SIREN) ; un flux n'entre qu'une fois
  par dossier ; le point de reprise ne recule jamais et garde une heure de marge ; une page pleine dans le désordre
  arrête la lecture → « LA RÉCEPTION PAR LA PLATEFORME DU CLIENT ».
- **La pièce jumelle d'une facture émise** (`lib/ventesJumelles.ts`, ligne 28.6) : une facture émise ne compte nulle
  part, sa vente entre par la pièce qui revient de la plateforme ou de Super PDP, marquée, jamais refusée. Le lien se
  DÉDUIT (flux de la transmission, identifiant Super PDP, ou identité G1.42 gardée à l'import, `identite_*` immuables),
  jamais d'un montant, d'une date ni d'un nom ; deux preuves contraires ne font pas de jumelle.
  La Checklist dit la vente portée par plusieurs pièces et la pièce incohérente, muettes sur une lecture partielle ; la
  validation refuse la première (`ventes-en-double`). Justificatifs marque la pièce (« Facture émise F… », « Comptée
  deux fois », « À vérifier »), sa fiche le dit, sa recherche trouve le numéro ; le bilan d'un import et
  « Encaissements » distinguent la jumelle d'une autre pièce : tout par `marquesDesPieces`, `jumellesImportees`,
  `piecesJumelles`, et la lecture par `lib/ventesJumellesLecture.ts`, muette sur une lecture partielle →
  « UNE VENTE PEUT ENTRER DEUX FOIS », « LA PIÈCE JUMELLE SE VOIT ».
- **Connexion bancaire** : sans nouvel accord, une banque ne rend que les 90 derniers jours ; le refus 422 se dit en
  français, avec le renouvellement → « LA CONNEXION BANCAIRE RÉCUPÈRE ».
- **Les ventes du client** (P2, en base le 10/10/2026) : le module d2 dit le refus neuf d'`enregistrer_encaissement` —
  un mouvement ne se désigne qu'avec « Banque », au rang 2 — par `gereLaBanque`, obligatoire ; la batterie a une passe du
  client (au seul droit « Ventes »). Les six essais des ventes exigent un client d'essai SANS « Ventes » (sinon
  ESSAI_IMPOSSIBLE : ses refus y deviendraient des acceptations légitimes) et attendent le catalogue de l'état où la base
  se trouve, témoin `factures_emises.valide_par` ; `ventesClient.sql` se dit impossible avant les deux migrations, et
  se joue en production depuis (90 verdicts) ; un brouillon se supprime par `supprimer_brouillon_facture`, pour le
  cabinet comme pour le client « Ventes » — l'ancien chemin, direct, reste codé et éprouvé drapeau forcé
  (`FacturesTabSuppressionBrouillon.test.tsx`) → « LES VENTES DU CLIENT, EN BASE ».
- **Les devis** (P5, préparée le 10/10/2026, `lib/devis.ts`) : une série par dossier et par année (`D2026-0001`), prise
  à l'émission sous le verrou de la série, reprise du plus haut numéro émis, émise par le cabinet ou par le client ; un
  devis émis est figé par sa garde (seule la réponse s'écrit, une fois ; une acceptation après la validité se
  CONFIRME) ; les lignes en `jsonb` vérifiées et les totaux confrontés au centime (`centimes_ligne_facture`) ;
  `facturer_devis` tire une facture BROUILLON, une fois, sans la date d'exécution prévue ni les mentions légales ;
  quatre fonctions seules écrivent, l'accès d'abord (`gere_les_ventes`). Tant que l'export ne porte pas les migrations,
  `devis.sql` est la RÉFÉRENCE des refus du module (`devis.test.ts` : chaque refus exigé de la base, les écritures de
  l'essai rejouées) ; le contrôle 0c de `ventesClient.sql` attend les quatre fonctions dès la table `devis` →
  « LES DEVIS, EN BASE ».
- **Les articles** (A1, en base depuis le 14/10/2026, `lib/articles.ts`) : un catalogue par dossier (BT-153, 154, 155,
  130, 146, 152 et la nature) ; un article PRÉ-REMPLIT une ligne de facture, qui garde sa copie — la base ne lit jamais
  un article pour une facture ; il se modifie, se retire, se reprend, ne se supprime jamais ; la référence est unique
  par dossier, à la lettre près, retirés compris (contrainte TOTALE ; A1-Q2). `enregistrer_article` (neuf rangs,
  quatorze messages), `retirer_article` et `reprendre_article` écrivent seules, l'accès d'abord (`gere_les_ventes` : le
  cabinet et le client « Ventes », MEG1-Q1) ; aucune policy d'écriture hors de la restauration. `ligneDepuisArticle`
  applique le statut de TVA du jour (0 % hors redevable, « à préciser » compris, avec son avertissement, A1-Q3 ; la
  mention du module du statut) et met la description à la suite de la désignation (A1-Q4). `articles.test.ts` confronte
  le module au texte exporté et rejoue l'essai ; à l'écran (A2a), la désignation et la description que le cabinet saisit
  disent que le client « Ventes » les lit → « LES ARTICLES, EN BASE », « LA LISTE DES ARTICLES, À L'ÉCRAN ».
- **Un prix unitaire ne s'arrondit pas en silence** (A2b) : six décimales au plus (BT-146, G1.16 ; le générateur CII
  refuse au-delà, avant le clic), deux au moins — `formaterPrixUnitaire` (`lib/format.ts`, identique à `formatMoney` au
  centime) pour la liste des articles et l'aperçu d'une facture ; le champ « PU HT » du formulaire est en `step="any"`
  (le pas de 0,01 bloquait l'envoi) ; un MONTANT reste au centime (`formatMoney`). La fenêtre de l'avoir garde
  `step="0.01"` : elle n'est pas un `<form>`, rien n'y est bloqué → « UN ARTICLE DANS LA FACTURE ».
- **L'adresse de réception et l'état de la facture électronique** (A6a, en base depuis le 14/10/2026,
  `lib/adressesReception.ts`, `lib/etatFactureElectronique.ts`, purs) : l'adresse est DÉCLARÉE (MEG1-Q16 : l'annuaire
  réserve aux plateformes le matricule et la date de prise d'effet, annexe 3 v1.8, DT-7-6 et DT-7-3-1 ; son interface,
  aux partenaires) — la maille et l'identifiant (SIREN, SIREN_SIRET, SIREN_SIRET_routage, SIREN_suffixe : un identifiant
  seul ne dit pas toujours sa maille, elle se déclare avec lui), la plateforme, la prise d'effet, la vérification (le
  portail, la plateforme, ou aucune) ; versionnée (`remplace_id`, une chaîne par dossier), jamais modifiée ni supprimée
  hors de la cascade du dossier. `declarer_adresse_reception` seule écrit (sept rangs, dix-neuf messages, l'accès
  d'abord — `gere_les_ventes` —, sous un verrou par dossier ; le SIREN se tire du SIRET du dossier comme
  `sirenDuDossier`). `etat_facture_electronique` rend UNE valeur — plateforme agréée et Super PDP reliés ou non, nom et
  dates, l'adresse courante — et JAMAIS une adresse de service, un identifiant, un secret, une organisation ni une
  portée (l'essai les plante dans deux connexions d'essai et les cherche) ; le module la lit sans rien deviner et dit
  « active » ou « à compléter » et ce qui manque, au jour de Paris DONNÉ : seule la dernière déclaration compte (A6-Q2),
  une adresse déclarée sans vérification compte et l'encart le dit (A6-Q3). `adressesReception.test.ts` et
  `etatFactureElectronique.test.ts` confrontent les modules au texte exporté et rejouent l'essai ; à l'écran depuis
  A6b1, le nom de la plateforme que le cabinet saisit dit que le client « Ventes » le lit → « L'ADRESSE DE RÉCEPTION ET
  L'ÉTAT DE LA FACTURE ÉLECTRONIQUE, EN BASE », « L'ADRESSE DE RÉCEPTION, À L'ÉCRAN », « L'ENCART « FACTURE
  ÉLECTRONIQUE », À L'ÉCRAN ».
- **Les contacts** (A4a, en base depuis le 15/10/2026, `lib/contacts.ts`, pur) : le fichier des clients du client, par
  dossier — le genre (`client` seul, MEG1-Q9), le type (les quatre de la facture), le nom, l'adresse, le SIREN et le
  SIRET (formes et clés par la fonction ; le SIRET commence par le SIREN ; unicité TOTALE `(dossier_id, siret)`),
  l'adresse de facturation électronique (à une entreprise ou à un organisme public) et le code service (à un organisme
  public : la contrainte de la facture), l'e-mail (la forme du WHATWG), le délai (0 à 60 jours, pour tous, A4-Q5), les
  observations (le nom `notes` est réservé) ; aucun téléphone, aucune date de naissance. Un contact PRÉ-REMPLIT le
  client d'une facture (A4b2), qui en garde la COPIE : aucune clé, aucune garde ne lit un contact. Il se retire, se
  reprend, ou s'EFFACE (une mise à jour : ses données vidées, « Contact effacé le JJ/MM/AAAA » au jour de Paris, la
  ligne gardée) ; il ne se supprime jamais hors de la cascade du dossier. `enregistrer_contact` (douze rangs, vingt-sept
  messages, l'accès d'abord — `gere_les_ventes` —, un verrou par dossier pour l'unicité du SIRET, le contact qui le
  porte NOMMÉ), `retirer_contact`, `reprendre_contact` et `effacer_contact` écrivent seules ; le client « Ventes » lit
  tout le fichier de son dossier, retirés et effacés compris, et y écrit par les mêmes fonctions (MEG1-Q11). La règle
  des soins (MEG1-Q10 ; A4-Q1 à A4-Q4) : un dossier qui porte l'article des soins, exonéré ou redevable, ne range ni un
  non-assujetti sans SIREN ni un client établi hors de France, à l'écriture comme à la reprise ; la fonction ne réécrit
  rien d'elle-même. `contacts.test.ts` confronte le module au texte exporté et rejoue l'essai ; à l'écran (A4b1), le
  nom, l'adresse et les observations que le cabinet saisit disent que le client « Ventes » les lit (`LIBELLE_*_CONTACT`)
  → « LES CONTACTS, EN BASE », « « MES VENTES › CLIENTS » », « UN CLIENT DANS LA FACTURE ».
- **L'import d'un fichier de clients** (A4b3a, en base depuis le 15/10/2026, `lib/contactsImport.ts`, pur) :
  `importer_contacts(p_dossier_id, p_contacts)` range chaque ligne par `enregistrer_contact` ELLE-MÊME, dans l'ordre et
  dans la même transaction — tout ou rien, le premier refus dit « Ligne N : » puis le message et le code
  d'`enregistrer_contact` ; l'accès d'abord (`gere_les_ventes`), puis un tableau, d'au moins une ligne, de mille au plus
  (A4B3-Q1), puis chaque ligne : un objet, aux seuls champs qu'`enregistrer_contact` lit (une clé inconnue refusée,
  nommée, la première dans l'ordre des OCTETS — `collate "C"` —, A4B3-Q2 ; une clé absente vaut nul). Elle CRÉE
  seulement (« id » n'est pas un champ), rend les identifiants dans l'ordre ; le verrou d'`enregistrer_contact` tient
  jusqu'à la fin de l'import ; un import se reconnaît à son auteur et à son instant, et ne se défait pas d'un geste
  (A4B3-Q4). Le module redit le premier refus (`refusImportContacts`) et l'aperçu ligne par ligne (`refusDesLignes`),
  chaque ligne par `refusEnregistrementContact` contre la liste lue AUGMENTÉE des lignes qui la précèdent, jamais une
  règle recopiée ; un U+0000 fait refuser le JSON entier avant la fonction (22P05) : « Importer des clients » (A4b3b)
  refuse le fichier avant tout envoi et le dit.
  `contactsImport.test.ts` confronte le module au texte exporté et rejoue l'essai → « L'IMPORT D'UN FICHIER DE
  CLIENTS, EN BASE ».
- **Les paramètres de facturation** (A5a, en base depuis le 16/10/2026, `lib/parametresFacturation.ts`, pur ;
  `lib/categoriesJuridiques.ts`) : par dossier, une VERSION — le délai (0 à 60 jours), le moyen proposé (les huit du
  registre), l'escompte et les pénalités (300), des mentions (1 000), un pied de page (500), le RIB (l'IBAN sous sa
  forme électronique, sa clé ISO 13616 vérifiée en SQL ; le BIC, ISO 9362 ; le titulaire, 70, EPC AT-21 ; le BIC et le
  titulaire avec l'IBAN seulement), son état, ses auteurs ; une saisie REMPLACE la courante (`remplace_id`, une chaîne),
  rien ne se modifie sauf le RIB PROPOSÉ de la courante, que `confirmer_rib` confirme (le cabinet seul) ;
  `enregistrer_parametres_facturation` (sept rangs, dix-sept messages, l'accès d'abord — `gere_les_ventes` —, sous un
  verrou par dossier ; une clé inconnue NOMMÉE) : un RIB inchangé garde son état et sa confirmation, posé ou changé par
  le cabinet il est confirmé d'emblée, par le client seulement proposé (MEG1-Q12) ; le RIB qu'une facture verra remonte
  la chaîne au-delà des proposés (`ribEnVigueur`). Sur `dossiers`, la dénomination imprimée, la ville du greffe, la
  forme juridique (les 260 catégories de l'INSEE au niveau III, une liste FERMÉE, la même pour la ligne 33) et le
  capital (au centime, jamais pour un entrepreneur individuel), écrits par la policy du cabinet seule (MEG1-Q14). Les
  mentions proposées (MEG1-Q13) vivent dans le module. `parametresFacturation.test.ts` confronte le module au texte
  exporté et rejoue l'essai → « LES PARAMÈTRES DE FACTURATION, EN BASE ».
- **Le dernier changement du RIB** (A5b3a, en base depuis le 17/10/2026, `lib/changementDeRib.ts`, pur ;
  `lib/changementDeRibLecture.ts`) : `dernier_changement_de_rib(dossier)` (`SECURITY DEFINER`, `stable`, l'accès d'abord
  — le cabinet, l'accès « Ventes » ou « Banque », sur un dossier qui existe ; 42501 sinon) rend UNE valeur, toujours un
  objet : `{changement: null}` (le RIB n'a jamais changé : une affirmation) ou le jour à Paris, le geste (posé, changé,
  retiré, confirmé), l'auteur (cabinet ou client, tiré de ce que la version a écrit ; un retrait, « inconnu », A5B3-Q3),
  l'état et l'effet sur le RIB en vigueur (`ribEnVigueur`) — jamais l'IBAN, le BIC, le titulaire, un identifiant ni
  l'heure (A5-Q2, A5B3-Q7). Un changement : une version qui pose, change (le triplet IBAN, BIC, titulaire) ou retire le
  RIB, la confirmation d'un RIB proposé (A5B3-Q2) ; le dernier dans l'ordre de la CHAÎNE, jamais des instants (une
  transaction donne le même à tout ce qu'elle écrit). Le module lit la valeur sans rien deviner — quinze combinaisons,
  l'image exacte de la règle ; toute autre forme est illisible, jamais « aucun changement » — et écrit les avis du
  cabinet, du client « Ventes » et du client « Banque » seul ; la lecture, un `.rpc(` sous `CHANGEMENT_DE_RIB_EXPORTE`,
  ne rejette jamais et se garde avec le dossier. `changementDeRib.test.ts` confronte le module au texte exporté et
  rejoue l'essai, ses versions par une règle indépendante du SQL ; l'avis de la Vue d'ensemble du cabinet et de
  l'accueil du client la lit depuis A5b3b → « LE DERNIER CHANGEMENT DU RIB, EN BASE », « L'AVIS D'UN CHANGEMENT DE RIB,
  À L'ÉCRAN ».
- **Le logo des factures** (A5c1, en base depuis le 17/10/2026, `lib/logoDesFactures.ts`, pur) : un seau PRIVÉ,
  `ventes`, borné en base (500 Kio, PNG ou JPEG : un PDF ne porte une image que par `DCTDecode` ou `FlateDecode`,
  ISO 32000-1 §7.4 — ni WebP, ni SVG, qui porte du script ; A5C-Q4) ; le logo sous
  `<dossier>/logos/<empreinte>.png|jpg`, l'empreinte = le SHA-256 du fichier tel qu'il part ; lire (tout le préfixe du
  dossier, A5C-Q6) et déposer (la forme exacte d'un logo) : `gere_les_ventes` (le cabinet et le client « Ventes »,
  A5C-Q2) ; supprimer : le chef du cabinet du dossier seul, avec le dossier ; aucune mise à jour ; un logo qu'aucune
  version ne désigne plus reste dans le seau jusqu'à la suppression du dossier (A5C-Q3). Une version des paramètres le
  désigne (`logo_chemin`, `logo_sha256`, trois contraintes) ; `enregistrer_parametres_facturation` le juge au HUITIÈME
  rang (huit messages, après les dix-sept d'A5a, inchangés) — l'ensemble, l'empreinte, le chemin, le dossier, le nom,
  puis le fichier dans le seau, son type et son poids tels que le catalogue les dit ; un logo inchangé ne se rejuge
  pas ; une clé absente vaut « aucun logo » (le formulaire d'A5b1 reprend celui de la version remplacée,
  `parametresEnvoyes`). La sauvegarde en garde le chemin et l'empreinte, pas le fichier (A5C-Q5). Le module redit les
  refus (`refusDuLogo`) ; `logoDesFactures.test.ts` le confronte au texte exporté et REJOUE les appels de l'essai ; les
  suppressions se jouent sur une réplique seulement (`logoDesFacturesSuppression.sql`) → « LE LOGO DES FACTURES ET SON
  SEAU, EN BASE » ; à l'écran depuis A5c2a → « LE LOGO DES FACTURES, À L'ÉCRAN ».

## Tests

Vitest, 12 375 tests, posés à côté de leur module ; `tsc -b` les type-vérifie avec le reste.

- **Deux projets** (`vitest.config.ts`) : « logique » (`src/**/*.test.ts`, node) et « écrans » (`src/**/*.test.tsx`, jsdom,
  Testing Library ; `src/test/ecrans.ts` démonte). Un test d'écran garde ce qu'aucun calcul pur ne voit : un verrou, un
  câblage, un bouton, un total. Tous les onglets et tous les écrans client ont le leur → « La couverture Vitest
  s'arrête à `src/lib` ».
- **Deux `fireEvent.click` de suite ne sont pas un double clic** : les deux dans le MÊME `act`. Un élément qui paraît
  après chargement se cherche HORS de l'`act`.
- **Ce qu'un effet consigne se lit sous `waitFor`** quand le rendu vient de lectures finies hors d'un `act` (après un
  `render`, pas après un `act` qui les attend) : `findBy…` voit le rendu commis, l'effet passe dans une autre tâche de
  l'ordonnanceur, et sous la charge la liste se lit sans lui → « UN TEST LISAIT SES RENDUS AVANT LEUR EFFET ».
- **Un faux client APPLIQUE les filtres** qui décident de ce que l'écran voit (`src/test/filtresPostgrest.ts`, qui lève
  sur une forme inconnue), annonce un `count`, et se charge DANS la fabrique de `vi.mock`. Les jeux d'essai sont typés
  `Partial<T> => T`, sans `as`.
- **Un drapeau d'export levé garde son état d'avant éprouvé tant que son code existe** : un fichier le FORCE par
  `vi.mock` (`espaceClientAvantCouverture.test.tsx`), ou joue ses deux états par un accesseur
  (`get DRAPEAU() { return faux.drapeau }`, lu à chaque accès : `FacturesTabSuppressionBrouillon.test.tsx`). Une
  constante calculée au chargement d'un module (`CE_QUE_DISENT_LES_CASES`) ne suit pas l'accesseur : elle se teste par
  sa fonction, état par état.
- **Un module de calcul n'importe jamais `supabase.ts`** (il lève sans variables d'environnement) ; un module couplé se
  teste en simulant le client — même pour une fonction pure du même module ; vérifier sans `.env`.
- **Un calcul lourd se paie dans un `beforeAll`, jamais en relevant le délai d'un test** : les gardes de copie compilent
  leurs blocs en UN programme par fichier (`src/test/compilationSeparee.ts`, chaque source un module à elle, confronté
  au programme par source) → « LES GARDES DE COPIE COMPILAIENT DANS CHAQUE TEST ».
- **Le fuseau est porté par les scripts npm** (`fuseau.test.ts` le vérifie) ; `test:fuseaux` rejoue Paris, UTC, New York
  et Auckland.
- **Une mutation qui ne mord pas accuse d'abord la mutation, puis le jeu d'essai** ; une suite rouge AVANT la mutation
  fait passer toute mutation pour tuée.
- **Une fonction testée qui a une valeur par défaut mérite son propre test** : le chemin par défaut est l'angle mort.
- **Une modification non commitée se copie HORS du dépôt avant tout harnais qui manipule git** : `git checkout --` et
  `git checkout HEAD -- f` réécrivent l'index ou l'arbre, et la suite reste verte, simplement plus courte.
- **CI** : `tests.yml` (multi-fuseaux, lint, build) sur toutes les branches ; `deploy.yml` lance `npm test` avant de
  publier.

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

Déploiement du front : automatique sur push vers `main`. Edge Functions et migrations : exclusivement par les outils
MCP Supabase (`deploy_edge_function`, `apply_migration`, `execute_sql`, `query_logs`) ; la CLI Supabase n'est pas
utilisée, et `supabase/config.toml` ne porte que `verify_jwt`.

## Règles importantes pour les futures modifications

- **Délégation aux sous-agents** (`.claude/agents/`, demande du cabinet du 08/10/2026) : pour chaque demande, la session
  choisit d'elle-même le sous-agent adapté — `architecte` (Opus 5.5, effort maximal) pour tout ce qui touche la
  structure, la base, la sécurité ou la logique métier ; `dev` (Opus 5.5, effort élevé) pour les fonctionnalités ;
  `retouches` (Sonnet 5.5) pour le cosmétique. En cas de doute, l'`architecte`. Demande du cabinet du 11/10/2026 :
  quatre ou cinq agents au plus en même temps, et chacun sur le modèle le plus économe qui suffit à sa tâche — `dev`
  en Sonnet (paramètre `model`) pour un écran dont la logique est déjà en module et qui ne touche ni aux droits ni aux
  calculs, un agent Haiku ou un script pour une exécution mécanique. Elle dit au cabinet, en une ligne,
  quel agent elle utilise, et garde l'orchestration : commits, demandes de fusion, fusion, déploiements, Notion. Les
  exécutions mécaniques (barrière, essais, banc) peuvent aller à un agent économe, qui ne rend que les chiffres.
- Avant toute modification de schéma ou de policy RLS, inspecter l'état réel en base (`list_tables`, `execute_sql`) —
  jamais se fier à ce document ou à une session précédente.
- Toute nouvelle table métier d'un dossier suit la convention `admin_du_dossier(dossier_id)`, porte `to authenticated`,
  et est vérifiée par impersonation réelle avant d'être crue.
- Après toute migration touchant une policy, rejouer `supabase/essais/rls.sql` (invariants à 0 en faute **et** toutes
  ses mutations qui mordent — quarante-trois depuis A5c1 : dix-neuf avec P7, douze de plus avec les ventes, deux avec
  les articles, deux avec les adresses de réception, deux avec les contacts, deux avec les paramètres de facturation,
  quatre avec le seau des ventes) ; la CI n'a pas accès à la base.
- Toute Edge Function reste auto-porteuse ; lit les clés de Supabase par le bloc `cleSupabase` (jamais
  `SUPABASE_ANON_KEY` ni `SUPABASE_SERVICE_ROLE_KEY`) ; une nouvelle clé ne voyage que dans `apikey`, donc une fonction
  appelée sans session d'utilisateur passe à `verify_jwt = false` avec son propre contrôle avant toute dépense.
- Tout déploiement d'Edge Function passe `verify_jwt` EXPLICITEMENT, à la valeur de `supabase/config.toml` pour cette
  fonction (vérifiée contre `list_edge_functions`) ; une nouvelle fonction reçoit sa section avant son premier
  déploiement.
- Tout `supabase.functions.invoke()` gère l'erreur par `extraireErreurFonction()` ; tout message issu d'un `{ error }`
  passe par `messageErreur()`.
- **Les normes AFNOR XP Z12-012 et XP Z12-013 ne s'utilisent pas** : leur éditeur interdit, en page de garde, leur
  exploitation par une IA (décision du cabinet du 07/10/2026). Ce qu'on attend d'une plateforme agréée ou d'une facture
  électronique se tire des sources publiques — Légifrance, les spécifications externes de la DGFiP et leurs annexes, les
  artefacts de validation EN 16931 de la Commission européenne, les documentations publiques des plateformes, les RFC —
  et le code cite la sienne. Une bibliothèque tierce se lit pour des noms de champs, jamais pour en copier le code.
- **Ce que le cabinet doit coller ou recopier se donne DANS la conversation**, en bloc de code prêt à coller : il suit la
  session sur iPhone, qui n'ouvre pas les fichiers qu'elle lui envoie. Un fichier peut accompagner le texte, jamais le
  remplacer.
- **Les questions au cabinet ont leur page** (17/10/2026) : l'artefact privé « Arbitrages du cabinet », une fiche par
  question avec sa recommandation, ses réponses dans la collection `reponses`. À chaque reprise, la session relit cette
  collection (outil ArtifactData) et consigne ce qui a été tranché ; une question nouvelle y entre, une question
  tranchée ailleurs en sort. Son adresse n'entre pas au dépôt (public) : `Artifact list` la retrouve par son titre.
- **Quand `apply_migration` attend une confirmation qui n'arrive pas** (un texte qui contient une suppression, même dans
  le corps d'une fonction), on ne contourne pas le détecteur — ni texte réécrit, ni `execute_sql`. Le cabinet colle la
  migration dans l'éditeur SQL de Supabase, dans une transaction, avec la ligne d'historique que l'outil aurait posée
  (`supabase_migrations.schema_migrations` : version, nom, texte) ; puis la session vérifie l'empreinte de l'historique
  (fins de ligne `\r\n` ramenées à `\n`) et rejoue les trois contrôles de l'export.
- **Les outils MCP décodent les échappements `\uXXXX` de leurs paramètres**, `apply_migration` et `execute_sql` compris
  (l'outil d'écriture de fichiers aussi) : un texte SQL qui doit arriver tel quel — la classe des blancs d'une
  expression rationnelle, un jeu d'essai — écrit la barre oblique inverse de chaque échappement sous sa forme échappée,
  `\u005c`, suivie de « u » et des quatre chiffres ; l'empreinte que rend la base (la ligne d'historique, la ligne TEXTE
  d'un essai) le vérifie → « L'ADRESSE DE RÉCEPTION ET L'ÉTAT DE LA FACTURE ÉLECTRONIQUE, EN BASE ».
- Tout nouvel onglet de dossier rejoint `TABS_VALIDES` (`DossierDetail.tsx`), `GROUPES_PARCOURS`
  (`lib/ongletsDossier.ts`) et `ICONES_PARCOURS` (`components/icons.tsx`, fermée sur `DossierTab` : sans son icône, il ne
  compile pas) ; `DossierParcours.test.tsx` déroule chaque groupe et ouvre chaque écran.
- Jamais d'action réseau externe automatique ou silencieuse : toujours un clic explicite.
- Jamais de modification en place d'une facture validée : un avoir, puis une nouvelle facture.
- Facturation électronique : relire les pièges déjà rencontrés avant de les redécouvrir ; les journaux de production font
  foi en cas de rejet.
- Avant d'élargir le périmètre d'une fonctionnalité en cours de cadrage, le confirmer avec le cabinet.
- Un advisor au rouge n'est pas forcément une action : vérifier d'abord s'il est verrouillé par le plan ou volontaire.
- **Deux sessions ne poussent jamais sur la même branche.** Une session qui travaille depuis une autre machine prend sa
  propre branche.
- **`main` reste linéaire** (`git rev-list --count --merges origin/main` = 0) et **protégée** : rien n'y arrive sans une
  demande de fusion, fusionnée en « Rebase and merge » quand `verifier` est vert. **C'est la session qui fusionne**
  (décision du cabinet du 25/09/2026) : elle pousse sur SA branche, ouvre la demande quand la barrière passe en local
  (`tsc -b`, lint, `test:fuseaux`, build), la fusionne quand `verifier` est vert sur la tête, sans conflit ni fil de
  revue ouvert, en passant `expectedHeadSha` ; jamais squash ni commit de fusion. Puis elle vérifie la mise en ligne (le
  site sert le paquet construit en local), tient la feuille de route Notion, dit au cabinet ce qui est parti, et réaligne
  sa branche sur `origin/main` (égalité des arbres vérifiée, `--force-with-lease`). Une fusion refusée se dit ; jamais
  de contournement (poussée directe, protection assouplie). Une branche qui a fusionné `main` en elle ne se pousse pas
  telle quelle : on rejoue ses commits à la suite de `main` et l'égalité des arbres se contrôle avant de pousser.
- **La Routine quotidienne `trig_011WworgC5Yw9whbjhNq8WA5` est DÉSACTIVÉE** (25/09/2026, décision du cabinet) : elle
  poussait sur `main` pendant qu'une session travaillait sur sa branche. La réactiver est une décision du cabinet, qui
  dira qui écrit sur `main`.
- Avant de supprimer une table jugée morte, réunir les six preuves : 0 ligne, 0 clé étrangère entrante, 0 vue
  dépendante, 0 déclencheur, 0 fonction qui la nomme (`pg_proc.prosrc`), 0 référence dans le code (front **et** Edge
  Functions) — et distinguer « vide » (rien ne l'a exercée) de « morte » (contournée alors que sa fonctionnalité a
  tourné).
- **Ce fichier reste court** : une entrée nouvelle tient en quelques lignes et renvoie à son récit dans HISTORIQUE.md.
