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
  `Login.tsx` est le seul chemin de connexion —, restreint à ses dossiers par `memberships`) ; super-admin
  (`SuperAdminPage`). **Aucun écran ne s'affiche sans session** (`App.tsx`) : il n'existe aucun chemin anonyme.
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
  - `agent-comptable` — assistant IA (Bedrock) par dossier, plafond de coût mensuel par cabinet (alerte et blocage).
  - `create-cabinet`, `delete-cabinet` (super-admin) ; `create-team-member`, `create-client-access`.
  - `extract-piece` — OCR (Textract) puis citation des champs par un modèle ; réservée à un compte RATTACHÉ au cabinet
    et à `receive-email`, qui présente la clé secrète dans l'en-tête `apikey`.
  - `receive-email` (webhook Resend, par dossier) ; `send-email` (facture, relance ; domaine `precompta.jdarnis.fr`).
  - `superpdp-credentials`, `superpdp-sync`, `superpdp-emit` — Super PDP ; `superpdp-emit` transmet le CII de
    l'application, jugé avant tout appel, sous une transmission réservée.
  - `proposer-categorie` — la catégorie d'UNE pièce depuis son texte OCR, sur un clic ; rien d'écrit.
  - `evaluer-extraction` — harnais de MESURE ; ne facture que pendant une fenêtre datée ; `limite: 0` et la question
    « cles » sont gratuites.
  - `banque-connexion` — la connexion bancaire d'un dossier (Enable Banking, bac à sable) ; REND les mouvements, l'écran
    importe.
  - `plateforme-agreee` — la plateforme agréée du CLIENT, par l'API de flux que publient les plateformes ; REND les
    factures, l'écran importe ; DÉPOSE une facture émise et suit son accusé ; RELÈVE les statuts du cycle de vie des
    factures émises et les écrit elle-même (`statuts_factures_recus`) ; le secret de la connexion ne revient jamais au
    navigateur.
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
                  rien, client, chef de cabinet). Sans suppression en production (l'outil d'exécution la
                  soumet à une confirmation qui n'arrive pas) : ce qu'une suppression rencontre se joue sur une
                  réplique locale du schéma.
                  - rls.sql : toutes les tables et le stockage, boucle sur pg_class, se mute lui-même ;
                  - restauration.sql (sur une réplique : le plan de sauvegarde.ts, gardé par
                    restaurationEssai.test.ts) ; allerretour.py (copie déployée ↔ dépôt, après chaque déploiement) ;
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
                    identiteFacturesRecues, revisionSoldes, cotisationPersonnelle ;
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
                  d'erreur ; installable.mjs demande à Chromium si l'application est installable.
outils/cotisations/  oracle.mjs : les cas de référence des cotisations Urssaf, calculés par le moteur des
                  simulateurs de l'Urssaf (installé à la demande, jamais en dépendance).
outils/facturation/  valider.mjs : fait juger les factures d'exemple (exemples/*.xml, fictives) par le schéma CII
                  D16B et le Schematron EN 16931 (instruments hors du dépôt, versions vérifiées) ; écrit
                  exemples/valides.json, que factureCii.test.ts confronte aux exemples figés. cdar/valider.mjs : de
                  même pour les messages du statut « Encaissée » (cdar/exemples/*.xml) et le schéma CDAR D22B de
                  l'UN/CEFACT, que cdarEncaissee.test.ts confronte.
```

## Conventions de développement

- **Système visuel = `src/index.css` seul, aucune couleur d'accent en dur** : la charte d'un cabinet (`lib/branding.ts`)
  ne remplace que `--color-primary`, `-hover` et `-light` ; toute nuance dérivée se calcule par `color-mix()` depuis
  `--color-primary` (`--tint-primary`, `--tint-primary-strong`, `--ring-primary`, `--glow-primary`, `--wash-primary`).
  Fonds plats, ombres `--shadow-xs/sm/md/lg`, rayons `--radius-*`, transitions `var(--duree) var(--ease)`.
- **Pièges de positionnement** : jamais de `backdrop-filter`, `filter` ni `transform` sur `.sidebar` ; jamais de
  `container-type` sur un ancêtre d'éléments `position: fixed` (panneau central, grille, carte) — il en devient la
  référence, et les fenêtres superposées se décalent.
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
  combinaisons extrêmes des volets (il n'ouvre le volet de droite qu'à
  1 280 px et plus). Il admet un tableau qui défile : une capture vérifie qu'aucun bouton n'y passe hors de vue. Ne
  JAMAIS donner au navigateur le mandataire de l'environnement (voir l'en-tête de `vitrine.mjs`).
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
- **Les policies se REJOUENT** (`supabase/essais/rls.sql`) : trois profils, boucle sur `pg_class` (une table ajoutée sans
  policy est attrapée), écritures d'essai annulées par sous-transaction, refus exigé en 42501 nommément, quatorze
  mutations qui doivent virer au rouge. Le fichier se rejoue ENTIER (le 08/10/2026, pour la première fois depuis le
  19/09) : sans son en-tête ni ses `drop table`, tables de résultats `on commit drop`, et une ligne TEXTE qui rend
  l'empreinte du texte reçu, comparée à la copie transmise. Ce qui contourne la RLS (`SECURITY DEFINER`) se rejoue aussi ; un refus plpgsql arrive en
  P0001, donc on exige la RAISON → « CE QUI CONTOURNE LA RLS ».
- **Stockage** : le premier segment du chemin EST le dossier (`(storage.foldername(name))[1]::uuid`) — un chemin non-UUID
  fait lever le cast pour tout le monde. Une suppression de fichier ne se teste pas en SQL (`protect_objects_delete`
  refuse en 42501 pour tous) : gardée par une lecture du catalogue (RGPD.md §8.6).
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
  `RESEND_API_KEY` en secret Supabase. Un seul webhook : `email.received` → `receive-email`.
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
  packs ni autres onglets) — ne jamais les élargir sans décision explicite.
- **Secrets** côté Supabase, jamais au bundle ni dans un journal. `superpdp_credentials`, `connexions_bancaires` et
  `connexions_plateformes` n'ont aucune policy (refus total hors service role). La clé SECRÈTE de Supabase n'entre ni au
  dépôt (public) ni au navigateur (`clesSupabase.test.ts`, `lib/clePublique.ts`).
- **Variables d'environnement** : PLAN_DE_REPRISE.md (fin du §3) les nomme toutes, `variablesEnvironnement.test.ts` les
  compare au code ; leurs valeurs ne se vérifient qu'à la main.
- Les données sont fictives aujourd'hui, et traitées dès maintenant comme identifiantes : aucun service tiers hors de
  cette liste.

## Fonctionnalités déjà implémentées

- **Cabinets et accès** : multi-cabinets avec super-admin, charte graphique par cabinet ; équipe ; accès clients ; client
  à plusieurs sociétés (sélecteur, `<Outlet key>`) ; accueil client en tableau de bord, dont « Ce qu'il reste à envoyer »
  dit la même chose que `ClientUpload` et la Checklist (`lib/resteAEnvoyer.ts`).
- **Dossiers** : création, checklist, informations, code NAF ; interface d'ordinateur en trois volets (25/09/2026),
  volets redimensionnables (05/10/2026), application installable (PWA, 25/09/2026).
- **Pièces et documents** : dépôt, import en masse, OCR et citation des champs, classification, doublons (fichier et
  texte), validation ; texte OCR conservé et relu (pièces et documents) ; fil de précisions client ↔ cabinet ;
  proposition de catégorie (26/09/2026).
- **Banque** : import CSV et PDF (contrôle de solde conservé), rapprochement manuel et par lots, règles « toujours
  ignorer », connexion bancaire (Enable Banking, bac à sable, 30/09/2026).
- **Comptabilité d'un BNC** (ligne 26.6, du 29/09 au 05/10/2026) : chaque mouvement du relevé s'écrit — affectation à
  une catégorie, règles d'affectation en lot, virement personnel (108), échéance d'emprunt (164, 661, 616), ventilation,
  règlement de plusieurs pièces par un virement (ligne 26), taux de TVA d'une recette sans facture, échéance de
  cotisation (646, CSG-CRDS au 108), l'échéance payée depuis le compte personnel (09/10/2026, en base ; l'écran à venir)
  — ; dotations aux amortissements (prorata temporis), acquisition des biens (compte de
  la nature, 445620, 404), forfait kilométrique (625110), note de frais face au 108 en trésorerie ; la 2035 comparée aux
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
  reconnue comme la jumelle de sa facture émise, et la vente portée par plusieurs pièces dite par la Checklist (ligne
  28.6, 09/10/2026).
- **Financement** : emprunts et échéancier, situation intermédiaire, plan de trésorerie, échéancier des dettes et
  ratios, prévisionnel à 3 ans ; suppléments ; comptes courants d'associés.
- **Autres écrans** : immobilisations, cotisations sociales (lecture best-effort des avis), Clôture (dont la purge du
  texte OCR des pièces sensibles après clôture, 22/09/2026), Estimation, Balance des comptes (pilotage, comptes de tiers
  à une date), Virements ; assistant comptable IA avec plafond de coût.
- **Exports** : pack (ZIP + Excel), export d'un cabinet, sauvegarde et restauration d'un dossier — **une sauvegarde
  n'est pas un pack** : le pack porte les fichiers, la sauvegarde les lignes qui les relient (PLAN_DE_REPRISE.md).
- **Nouvelles clés d'API de Supabase** (30/09/2026).

## Fonctionnalités actuellement en cours

- **Proposition de catégorie** : à éprouver par un premier clic réel du cabinet.
- **Déclarations TNS** (ligne 27) : restent hors de l'estimation — médecins et chirurgiens-dentistes, retraite, revenus
  de remplacement, ACRE, exonérations, outre-mer, régularisation ; DSCS proposée depuis la ligne 4 de la 2035-A, à
  confirmer sur une première déclaration réelle.
- **CFE et CVAE** (ligne 48) : restent la saisie par exercice de la part déductible des loyers, du cadre des
  mono-établissements et de l'effectif (une table à créer), celle de BW, les dates d'activité d'un dossier qui cesse en
  cours d'année, le millésime 2027, le plafonnement de la CET — onze questions au cabinet du 09/10/2026 →
  « L'ANNEXE 2035-E SE TIRE DE LA 2035 DÉPOSÉE ».
- **Télédéclaration de la TVA** (ligne 28) : étape 2, la transmission par un partenaire EDI — Teledec choisi, qui veut
  voir l'application fonctionner avant d'ouvrir son API ; ASPOne.fr l'autre voie. Rien n'est écrit.
- **Comptabilité d'engagement** (ligne 31) : restent les écarts de change et les frais bancaires (le rapprochement règle
  encore la pièce sur la banque — à trancher avec le cabinet), les auxiliaires des à-nouveaux et des soldes reportés,
  l'affectation du résultat d'une société, la TVA des livraisons de biens, la liasse (2033 ou 2050), les exercices
  décalés.
- **FEC** : restent les vingt-deux champs d'un BNC en trésorerie et les montants en devise (réponse de
  l'expert-comptable du cabinet attendue).
- **Ligne 26.6** : reste (e), les vingt-deux champs et Test Compta Demat ; l'écran de l'échéance payée depuis le compte
  personnel et la migration de son retrait, à coller par le cabinet ; l'opération découverte après coup, conçue,
  questions au cabinet (B1 à B13). Aucun exercice n'est encore validé en base.
- **Connexion bancaire** (ligne 24) : le prestataire définitif et son contrat ; le chemin du CLIENT (seul le titulaire
  du compte donne l'accord) ; la récupération automatique ou au clic (RGPD.md §8.8).
- **Clés historiques de Supabase** : reste leur désactivation dans le tableau de bord, un clic du cabinet.
- **Facturation électronique** (ligne 28.5, décisions du cabinet du 07/10/2026) : (a), (b) et (c) en ligne — la
  réception et le dépôt à éprouver sur la plateforme réelle d'un client ; puis (d) le statut « Encaissée » — d1, le
  registre des encaissements, en base, d2, son module, et d3, son écran, le 08/10/2026 ; d4, la déclaration hors application et la contre-passation, en base le 08/10/2026
  et à l'écran le 09/10/2026 (la date d'une contre-passation à confirmer par le cabinet) (décisions du cabinet du
  08/10/2026) ; d5, le message CDAR du statut, en module le 09/10/2026 (ses quatre choix à trancher par un premier
  essai réel) ; d7, le cycle de vie des factures émises lu sur la plateforme du client, en base, dans
  `plateforme-agreee` et à l'écran le 09/10/2026 (le premier relevé réel reste à faire) ; l'essai réel sur le bac à sable de Super PDP — et (e)
  l'e-reporting, conçu le 09/10/2026 : onze étapes ; les soins exonérés n'y entrent pas, les achats à l'étranger d'un
  dossier, même exonéré, si (opérations du 01/09/2027) ; dix questions au cabinet ; e1 en cours → « L'E-REPORTING : LA
  CONCEPTION ».
- **Défauts connus des Edge Functions** (27, `DEFAUTS_CONNUS`) : vingt corps mal formés qui font lever neuf fonctions
  ou répondre deux en anglais (latents, à corriger au prochain déploiement de chacune) ; deux d'`evaluer-extraction` ;
  trois décisions du cabinet — le mot de passe d'un compte déjà rattaché changé avant un refus 409
  (`create-client-access`, `create-team-member`), l'objet et l'expéditeur d'un e-mail reçu au journal (`receive-email`),
  `taux-change-bce` sans contrôle d'appelant (fermer l'inscription publique et les clés historiques le referme).
- **Une vente entrée deux fois** (ligne 28.6) : le pont et la Checklist en ligne le 09/10/2026 ; restent la jumelle
  marquée dans les Justificatifs et leur fiche (phase C), et le PDF d'une facture émise, que rien ne relie encore à elle
  (Q1 au cabinet).
- **Bac à sable Super PDP** : l'essai réel de l'émission avec le cabinet.
- **Révision des comptes** (ligne 41) : conçue le 09/10/2026 — une décision immuable par solde de bilan, le travail et
  la revue par cycle, des preuves proposées et jamais appliquées seules, la mémoire d'un exercice à l'autre ; neuf
  étapes R1 à R9, douze questions au cabinet → « LA RÉVISION DES COMPTES : LA CONCEPTION » ; R1, la base des soldes
  révisés, en base le 09/10/2026 (Q2, Q3, Q7, Q8 et Q11 prises comme hypothèses, à confirmer) ; R2 (le module) et R3
  (l'écran) à venir ; R6 attend Q1 → « LA BASE DES SOLDES RÉVISÉS ».

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
- `anon_/authenticated_security_definer_function_executable` (5 et 14 fonctions au 09/10/2026) : vérifiés bénins par
  impersonation. Seules `enregistrer_facture`, `valider_exercice`, `abandonner_transmission`, `enregistrer_encaissement`, `retirer_encaissement`,
  `declarer_encaissement_hors_application`, `annuler_encaissement`, `justifier_solde` et
  `enregistrer_paiement_personnel_cotisation` écrivent, chacune avec son propre contrôle d'accès ; plus
  aucun rôle n'exécute `prochain_numero_facture` ni `attribuer_numero_facture`. Ce qu'il faut revérifier : qu'une
  NOUVELLE fonction `SECURITY DEFINER` n'écrive pas sans contrôle interne.
- `rls_enabled_no_policy` sur `super_admins`, `superpdp_credentials`, `facture_numerotation`, `connexions_bancaires`,
  `connexions_plateformes` : volontaire (refus total au client).
- `function_search_path_mutable` sur `retour_declencheur` : bénin (fonction `immutable` qui ne nomme aucun objet).

### Base de données et schéma

- **Un export de schéma n'est pas un schéma** : douze tables (`socle/1_tables_sans_migration.sql`) et onze objets
  (`socle/2_objets_sans_migration.sql`) avaient été créés hors migration ; `socle.py/.sql` les compare au caractère près
  et `inventaire.py/.sql` tout le reste nom par nom. La procédure qui rejouerait l'export dans une base vide n'a jamais
  tourné (PLAN_DE_REPRISE.md §4) → « UN EXPORT DE SCHÉMA N'EST PAS UN SCHÉMA ».
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
- **`dossier_id` NULLABLE** sur `categories` et `natures_immobilisation` (lignes partagées du cabinet) : jamais
  `WHERE dossier_id = ?` seul.
- **`id` n'est pas la clé primaire partout** (`CLES_PRIMAIRES`, épinglée au schéma) ; une table auto-référencée se
  restaure en deux passes ; le plan free n'a AUCUNE sauvegarde automatique (PLAN_DE_REPRISE.md).
- **Un type de `types.ts` décrit la table**, colonnes NOT NULL comprises — et les déclencheurs comptent : ceux de
  `dossiers` remplissent `cabinet_id` et `code_email` seulement s'ils sont nuls.
- **`pack_pieces` a été supprimée** (jamais écrite) : la composition d'un pack n'est pas modélisée. Avant de supprimer
  une table jugée morte, réunir les six preuves (voir les règles en fin de fichier).

### Lectures et écritures Supabase

- **Une écriture est vérifiée**, jamais supposée réussie (`{ error }` lu). Ce qui décide de la gravité : quelque chose
  recharge-t-il derrière ? Presque toujours dans `src/`, presque jamais dans une Edge Function
  (`edgeFunctionsEcritures.test.ts` : quatre portes `.from(`, `.rpc(`, `.auth.`, `.storage.`, résultat pris ou jeté à la
  tête de chaîne).
- **Qui prend `data` prend `error`** : une lecture dont l'échec ressemble à un résultat vide se vérifie comme une
  écriture (`lecturesVerifiees.test.ts`, `edgeFunctionsLectures.test.ts`). Légitime seulement si l'échec tombe du côté
  FERMÉ. **Le vide est une AFFIRMATION** : un état vide ne se dit que d'une liste lue en entier — et revenue : avant sa
  première lecture, l'écran dit « Chargement… » (ou ses squelettes), et ce qui s'en calcule attend aussi — un compte, un
  total, un tableau, un export, un formulaire ; une lecture dont la CLÉ change écran ouvert (l'exercice, la période)
  repart en chargement. `ecransAvantLecture.test.tsx` monte tous les écrans qui lisent la base sous un client qui ne rend
  rien (`src/test/clientRetenu.ts`) → « RÉCLAMAIT AU CLIENT AVANT D'AVOIR RIEN LU », « AUCUN ÉCRAN N'AFFIRME LE VIDE AVANT
  D'AVOIR LU ».
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
  l'écran montre ; un fichier sans ligne est un orphelin → « LA QUESTION QUI DÉCIDE N'A JAMAIS ÉTÉ POSÉE DU STOCKAGE ».
- **Une suppression se confirme, et la confirmation NOMME ce qu'on perd** ; une mise en garde se vérifie contre ce que le
  code FAIT, pas contre ce qu'elle a voulu dire → « UNE SUPPRESSION SE CONFIRME ».
- **Une suppression en lot dit son bilan** : la ligne d'abord, le fichier seulement si la base a RENDU la ligne
  supprimée (`.select('id').maybeSingle()` — zéro ligne n'est pas une erreur pour PostgREST) ; ce qui reste se compte et
  se dit avec sa raison, sans nom de fichier (`lib/bilanSuppression.ts`), sous un verrou relâché après la relecture.
  `PiecesTab.deleteSelection` et sept écritures unitaires dont `{ error }` n'est pas lu restent à reprendre →
  « LA SUPPRESSION D'UNE SÉLECTION DE DOCUMENTS ».
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
  un trait littéral, un double trait tous les vingt-cinq) → « Déployer une Edge Function via l'outil MCP décode les
  échappements », « LES BORDURES SE RECOPIENT ».
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
  de lire le corps. **L'inscription publique reste ouverte** (`disable_signup: false`) : à fermer par un clic du
  cabinet → « ET LA FONCTION DE LECTURE ÉTAIT OUVERTE ».
- **`evaluer-extraction` facture seulement dans sa fenêtre datée** (`ESSAI_OUVERT_JUSQU_A`) : mesurer = poser une date une
  heure devant, déployer, mesurer, attendre la fermeture, PUIS commiter (`categorisationIaCopie.test.ts` refuse une
  fenêtre ouverte) → « LE HARNAIS DE MESURE ÉTAIT UNE PORTE PUBLIQUE ».
- **Le mur d'une fonction est à 150 s** (plan free) : les budgets se déduisent du mur (`extractPieceBudget.test.ts`).
  Textract se pagine par `NextToken` (boucle sur un fournisseur de pages, testée).
- **Le compilateur des Edge Functions** (`tsconfig.edge.json`, `edgeFunctionsCodeMort.test.ts`) ne garantit que le CODE
  MORT ; le typage complet rend des erreurs connues (SDK non installés).
- **Copies gardées** : montants, dates, classification, orientation, statut de TVA, la lecture d'un statut reçu
  (`cdarRecu`, dans `plateforme-agreee`), blocs de l'assistant (un garde par
  bloc), et `historiqueDuClient`, seule barrière entre le fil envoyé par le navigateur et le modèle →
  « ET LE SEUL INVARIANT DE SÉCURITÉ DU DÉPÔT ».

- **Chaque Edge Function s'appelle en HTTP dans la suite** (ligne 23, `src/test/fonctionsEdge.ts`) : sa VRAIE source,
  transpilée, devant un monde factice qui journalise tout (`Deno.serve` capturé, clés fabriquées, base aux filtres et aux
  clés du schéma exporté, authentification, AWS, Resend, réseau fermé, `verify_jwt` lu dans `config.toml`) ;
  `contratsFonctions.ts` en joue les contrats (préflight mesuré sur le SDK, refus sans droit et AUCUNE dépense avant, corps
  mal formés, plafonds, ni secret ni valeur de pièce au journal) ; `edgeFunctionsHttp.test.ts` part de TOUT et compte
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
  l'écran montre ce qui vient d'être écrit. Deux clics se testent dans le MÊME `act`, et il en faut TROIS pour voir un
  verrou posé dans le `try` (`verrousExecution.test.ts`) → « Un verrou d'exécution est un `useRef` ». Ce test part
  des verrous qui EXISTENT : un gestionnaire sans aucun verrou ne se voit qu'au test d'écran à deux puis trois envois.
  Restent gardés par un état seul : membre d'équipe, cabinet, emprunt, suppléments et comptes courants, échéance de
  cotisation, pack, et trois appels facturés ou externes (assistant, extraction, Super PDP) → « NOUVEAU DOSSIER N'AVAIT
  QU'UN ÉTAT POUR VERROU ».
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
  les deux (la fonction et deux déclencheurs) → « UNE ÉCHÉANCE PAYÉE DEPUIS LE COMPTE PERSONNEL S'ÉCRIT ». L'opération
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
  « LA VALIDATION D'UN EXERCICE ÉCRIT L'OUVERTURE ».
- **Un contrôle qui part d'un côté d'une relation ne voit pas l'autre** : partir de l'écriture (`rupturesPisteAudit`,
  `ecrituresSansObjet`), du mouvement, du bien… Le contrôle des écritures compare le compte, le montant, la ventilation
  de la TVA et les dates attendues → « Un contrôle qui part d'un côté d'une relation ».
- **La révision des soldes** (ligne 41, R1) : une DÉCISION par solde d'un compte de bilan à la fin d'un exercice
  (justifié, accepté sur motif, anomalie), immuable : elle se REMPLACE (chaîne `remplace_id`) et, permanente, se REPREND
  l'exercice suivant. Seule `justifier_solde` l'écrit — treize refus dans un ordre fixé, sous le verrou de la
  validation puis celui de la révision, au solde de `solde_du_compte` (jumeau `soldeDuCompteCentimes`) ; une preuve
  RECOPIE l'empreinte de sa source, et une source citée ne se supprime plus (`garder_source_citee`, hypothèse Q8) :
  les écrans qui suppriment devront le dire avant le clic (R3) → « LA BASE DES SOLDES RÉVISÉS ».
- **Le plan comptable se cite dans sa numérotation du 1er janvier 2026** (règlement ANC n° 2014-03 consolidé : le 108
  et le résultat d'une entreprise individuelle passent au 101 selon l'art. 1211-10, ex-941-10) ; une migration déjà
  appliquée garde l'ancien numéro → « LE PLAN COMPTABLE A CHANGÉ DE NUMÉROTATION ».
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
- **Dotations** : le cumul s'arrondit, pas l'annuité ; même calcul en base, en entiers.
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
  obligatoire, datée du décaissement, entre l'encaissement et aujourd'hui à Paris — décision à confirmer par le
  cabinet), et la contre-passation se déclare à son tour sur la même plateforme. La garde ne compte, pour une
  déclaration d'hier (une restauration), que ce qui était connu avant elle. Les refus, dans l'ordre (huit et douze), le
  module les dit avant le clic (`refusDeclaration`, `refusContrePassation`). L'écran (`EncaissementsFactureModal`) lit
  les déclarations du dossier par `lireTout` — lues en partie, il n'offre AUCUN geste — ; dit de chaque encaissement
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
  jamais d'un montant, d'une date ni d'un nom ; deux preuves contraires ne font pas de jumelle. La Checklist dit la
  vente portée par plusieurs pièces et la pièce incohérente, muettes sur une lecture partielle ; la validation refuse
  la première (`ventes-en-double`) → « UNE VENTE PEUT ENTRER DEUX FOIS ».
- **Connexion bancaire** : sans nouvel accord, une banque ne rend que les 90 derniers jours ; le refus 422 se dit en
  français, avec le renouvellement → « LA CONNEXION BANCAIRE RÉCUPÈRE ».

## Tests

Vitest, 6617 tests, posés à côté de leur module ; `tsc -b` les type-vérifie avec le reste.

- **Deux projets** (`vitest.config.ts`) : « logique » (`src/**/*.test.ts`, node) et « écrans » (`src/**/*.test.tsx`, jsdom,
  Testing Library ; `src/test/ecrans.ts` démonte). Un test d'écran garde ce qu'aucun calcul pur ne voit : un verrou, un
  câblage, un bouton, un total. Tous les onglets et tous les écrans client ont le leur → « La couverture Vitest
  s'arrête à `src/lib` ».
- **Deux `fireEvent.click` de suite ne sont pas un double clic** : les deux dans le MÊME `act`. Un élément qui paraît
  après chargement se cherche HORS de l'`act`.
- **Un faux client APPLIQUE les filtres** qui décident de ce que l'écran voit (`src/test/filtresPostgrest.ts`, qui lève
  sur une forme inconnue), annonce un `count`, et se charge DANS la fabrique de `vi.mock`. Les jeux d'essai sont typés
  `Partial<T> => T`, sans `as`.
- **Un module de calcul n'importe jamais `supabase.ts`** (il lève sans variables d'environnement) ; un module couplé se
  teste en simulant le client — même pour une fonction pure du même module ; vérifier sans `.env`.
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
  `retouches` (Sonnet 5.5) pour le cosmétique. En cas de doute, l'`architecte`. Elle dit au cabinet, en une ligne,
  quel agent elle utilise, et garde l'orchestration : commits, demandes de fusion, fusion, déploiements, Notion. Les
  exécutions mécaniques (barrière, essais, banc) peuvent aller à un agent économe, qui ne rend que les chiffres.
- Avant toute modification de schéma ou de policy RLS, inspecter l'état réel en base (`list_tables`, `execute_sql`) —
  jamais se fier à ce document ou à une session précédente.
- Toute nouvelle table métier d'un dossier suit la convention `admin_du_dossier(dossier_id)`, porte `to authenticated`,
  et est vérifiée par impersonation réelle avant d'être crue.
- Après toute migration touchant une policy, rejouer `supabase/essais/rls.sql` (invariants à 0 en faute **et**
  quatorze mutations qui mordent) ; la CI n'a pas accès à la base.
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
- **Quand `apply_migration` attend une confirmation qui n'arrive pas** (un texte qui contient une suppression, même dans
  le corps d'une fonction), on ne contourne pas le détecteur — ni texte réécrit, ni `execute_sql`. Le cabinet colle la
  migration dans l'éditeur SQL de Supabase, dans une transaction, avec la ligne d'historique que l'outil aurait posée
  (`supabase_migrations.schema_migrations` : version, nom, texte) ; puis la session vérifie l'empreinte de l'historique
  (fins de ligne `\r\n` ramenées à `\n`) et rejoue les trois contrôles de l'export.
- Tout nouvel onglet de dossier rejoint `TABS_VALIDES` (`DossierDetail.tsx`) et `GROUPES_PARCOURS`
  (`lib/ongletsDossier.ts`).
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
